import { PrismaClient } from "@prisma/client";

// A single shared Prisma client for the whole process. Node (unlike
// Next.js dev mode) doesn't hot-reload modules by default, so no
// globalThis-caching dance is needed here — this file is only ever
// evaluated once per process.
export const prisma = new PrismaClient();
