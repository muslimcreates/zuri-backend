import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../lib/prisma";
import { setSessionCookie, clearSessionCookie } from "../lib/session";
import { BadRequestError, ConflictError, UnauthorizedError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

function toUserDTO(user: {
  id: string;
  name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  avatarUrl?: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
  };
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
    // instead of creating a duplicate account.
    const existing = await prisma.user.findUnique({ where: { email } });
    user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { googleId, avatarUrl } })
      : await prisma.user.create({
          data: { name, email, googleId, avatarUrl, role: "CUSTOMER" },
        });
  }

  setSessionCookie(res, { userId: user.id, role: user.role });
  res.json(toUserDTO(user));
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
  res.json(toUserDTO(user));
});
