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
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export { COOKIE_NAME };
