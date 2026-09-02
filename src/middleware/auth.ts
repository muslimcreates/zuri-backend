import type { Request, Response, NextFunction } from "express";
import { COOKIE_NAME, verifySession } from "../lib/session";
import { UnauthorizedError, ForbiddenError } from "../lib/errors";

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
