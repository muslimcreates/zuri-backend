import jwt from "jsonwebtoken";
import type { Response } from "express";

// JWT stored in an httpOnly cookie. Kept as a small, auditable module
// instead of pulling in a full auth library — swap it out later if social
// login or MFA is ever needed; nothing else in the app depends on how the
// session is implemented, only on the three functions exported here.

const COOKIE_NAME = "ze_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionPayload = {
  userId: string;
  role: "CUSTOMER" | "ADMIN";
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to your .env file (see .env.example)."
    );
  }
  return secret;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getSecret()) as SessionPayload & jwt.JwtPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, payload: SessionPayload) {
  const token = signSession(payload);
  // The frontend and backend are deployed on two different domains
  // (e.g. a Netlify site calling a Render API) — that's a genuinely
  // cross-site request, and browsers only attach a SameSite=Lax cookie to
  // same-site requests. Without SameSite=None here, login looks like it
  // works (the response body still comes back and sets who's logged in)
  // but the cookie never gets sent back on the very next request, so
  // anything that follows — loading the cart, /api/auth/me, checkout —
  // silently fails as if you'd never logged in. SameSite=None requires
  // Secure, which is exactly what `secure` below already is in production,
  // so the two stay correctly paired. Locally, both frontend and backend
  // run on localhost — same-site — so Lax (the safer default) is fine.
  const crossSite = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? "none" : "lax",
    maxAge: SESSION_DURATION_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  // Must match setSessionCookie's attributes (path, secure, sameSite) —
  // browsers key cookie deletion on the full attribute set, not just the
  // name, so a mismatched Secure/SameSite here can silently fail to clear
  // the cookie that was actually set.
  const crossSite = process.env.NODE_ENV === "production";
  res.clearCookie(COOKIE_NAME, { path: "/", secure: crossSite, sameSite: crossSite ? "none" : "lax" });
}

export { COOKIE_NAME };
