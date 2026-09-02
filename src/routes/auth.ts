import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../lib/prisma";
import { setSessionCookie, clearSessionCookie } from "../lib/session";
import { sendVerificationEmail } from "../lib/email";
import { BadRequestError, ConflictError, UnauthorizedError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

function toUserDTO(user: {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  avatarUrl?: string | null;
  emailVerified: boolean;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    emailVerified: user.emailVerified,
  };
}

// Verification tokens: generate a random value, email the raw value, store
// only its hash (same idea as a password) so a leaked database never hands
// out working verification links. 24 hour expiry.
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

async function issueVerificationEmail(user: { id: string; name: string; email: string }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationTokenHash: hashToken(rawToken),
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
  });

  const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
  const verifyUrl = `${clientOrigin}/verify-email?token=${rawToken}`;
  await sendVerificationEmail({ to: user.email, name: user.name, verifyUrl });
}

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.email("Enter a valid email address.").trim(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

authRouter.post("/signup", async (req, res) => {
  const { name, email, password } = SignupSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError("An account with that email already exists.");

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: "CUSTOMER" },
  });

  // Don't block signup on email delivery — issue the session either way,
  // and let issueVerificationEmail's own error handling (see lib/email.ts)
  // absorb a broken email provider.
  await issueVerificationEmail(user).catch((err) =>
    console.error("[auth] Failed to issue verification email:", err)
  );

  setSessionCookie(res, { userId: user.id, role: user.role });
  res.status(201).json(toUserDTO(user));
});

const LoginSchema = z.object({
  email: z.email("Enter a valid email address.").trim(),
  password: z.string().min(1, "Password is required."),
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new UnauthorizedError("Incorrect email or password.");

  if (!user.passwordHash) {
    throw new UnauthorizedError(
      "This account was created with Google Sign-In. Use the Google button instead of a password."
    );
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw new UnauthorizedError("Incorrect email or password.");

  setSessionCookie(res, { userId: user.id, role: user.role });
  res.json(toUserDTO(user));
});

// --- Google Sign-In ---
//
// The frontend uses Google Identity Services (a small script, no backend
// redirect dance needed) to get an ID token straight from Google in the
// browser, then POSTs it here as `credential`. We verify it was really
// issued by Google and really meant for *this* app (the audience check),
// then find-or-create the user and issue the same session cookie as
// email/password login. See README "Setting up Google Sign-In" for how to
// get a Client ID.
const googleClient = new OAuth2Client();

const GoogleAuthSchema = z.object({
  credential: z.string().min(1, "Missing Google credential."),
});

authRouter.post("/google", async (req, res) => {
  const { credential } = GoogleAuthSchema.parse(req.body);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "GOOGLE_CLIENT_ID is not set. Add it to your .env file (see .env.example)."
    );
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    throw new BadRequestError("Invalid Google credential.");
  }

  if (!payload?.email) {
    throw new BadRequestError("Google did not return an email address for this account.");
  }
  if (payload.email_verified === false) {
    throw new BadRequestError("Your Google email address isn't verified.");
  }

  const googleId = payload.sub;
  const email = payload.email;
  const name = payload.name ?? email.split("@")[0];
  const avatarUrl = payload.picture ?? null;

  // Already signed in with Google before -> just log them in.
  let user = await prisma.user.findUnique({ where: { googleId } });

  if (!user) {
    // Not linked yet: if an account with this email already exists (e.g.
    // they originally signed up with a password), link Google onto it
    // instead of creating a duplicate account. Google already verified
    // this email, so mark it verified either way.
    const existing = await prisma.user.findUnique({ where: { email } });
    user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { googleId, avatarUrl, emailVerified: true },
        })
      : await prisma.user.create({
          data: { name, email, googleId, avatarUrl, emailVerified: true, role: "CUSTOMER" },
        });
  }

  setSessionCookie(res, { userId: user.id, role: user.role });
  res.json(toUserDTO(user));
});

// --- Email verification ---

authRouter.get("/verify-email", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) throw new BadRequestError("Missing verification token.");

  const user = await prisma.user.findUnique({
    where: { emailVerificationTokenHash: hashToken(token) },
  });

  if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
    throw new BadRequestError("This verification link is invalid or has expired.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerificationTokenHash: null, emailVerificationExpires: null },
  });

  res.json({ verified: true });
});

// Lets a logged-in user request a fresh link, e.g. if the first one expired
// or landed in spam.
authRouter.post("/resend-verification", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

  if (user.emailVerified) {
    res.json({ alreadyVerified: true });
    return;
  }

  await issueVerificationEmail(user);
  res.json({ sent: true });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
  res.json(toUserDTO(user));
});
