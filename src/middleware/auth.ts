import type { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verifySession } from "../lib/session";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";
import { prisma } from "../lib/prisma";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { userId: string; role: "CUSTOMER" | "ADMIN" };
    }
  }
}

/** Reads the session cookie (if any) and attaches req.user. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) {
    const session = verifySession(token);
    if (session) req.user = session;
  }
  next();
}

/** Requires any logged-in user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new UnauthorizedError();
  next();
}

/** Requires a logged-in admin. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new UnauthorizedError();
  if (req.user.role !== "ADMIN") throw new ForbiddenError("Admin access required");
  next();
}

/**
 * Requires a logged-in user whose email is confirmed — used on the cart and
 * checkout routes so an account can't actually be used to buy anything
 * until it's verified (by code or link — see routes/auth.ts). Deliberately
 * NOT applied to admin routes: admin access is already gated by role, and
 * the seeded admin account's email is a placeholder that can't receive
 * real mail, so requiring verification there would just lock the admin
 * out. Looks the flag up fresh rather than trusting the session JWT, since
 * a 7-day-old token could easily predate the user actually verifying.
 */
export async function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new UnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { emailVerified: true },
  });
  if (!user?.emailVerified) {
    throw new ForbiddenError("Please verify your email address before continuing.");
  }
  next();
}
