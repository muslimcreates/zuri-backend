import crypto from "node:crypto";

// Shared by routes/auth.ts (issuing + checking) and smoke-test.ts (seeding a
// known code/token directly via Prisma to test the HTTP endpoints without
// needing a real inbox). Keeping the hashing/generation in one place means
// the test can't silently drift from what the route actually does.

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Same idea as a password: only the hash is ever stored. */
export function hashVerificationSecret(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Long, unguessable — used in the emailed link (`?token=...`). */
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Short and typeable — used for manual code entry on the verify page. */
export function generateVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}
