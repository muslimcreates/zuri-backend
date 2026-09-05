import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const addressesRouter = Router();
addressesRouter.use(requireAuth);

// "Your saved address" — the row a user manages from /settings, entirely
// separate from the one-per-order snapshots createOrder() creates at
// checkout (see lib/orders.ts). See the isDefault field's doc comment in
// schema.prisma for why those two are never the same row.

// GET /api/addresses/default — null if the user has never saved one yet.
addressesRouter.get("/default", async (req, res) => {
  const address = await prisma.address.findFirst({
    where: { userId: req.user!.userId, isDefault: true },
  });
  res.json(address);
});

const AddressSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the recipient's full name."),
  phone: z.string().trim().min(7, "Enter a valid phone number."),
  city: z.string().trim().min(2, "Enter a city."),
  addressLine: z.string().trim().min(5, "Enter a delivery address."),
  postalCode: z.string().trim().min(3, "Enter a postal code."),
});

// PUT /api/addresses/default — create-or-replace. Upserts by looking up the
// existing default row (if any) rather than a DB-level upsert, since
// "default" isn't a unique key here (see schema.prisma) — just an
// application-enforced invariant of "at most one per user".
addressesRouter.put("/default", async (req, res) => {
  const data = AddressSchema.parse(req.body);
  const existing = await prisma.address.findFirst({
    where: { userId: req.user!.userId, isDefault: true },
  });

  const address = existing
    ? await prisma.address.update({ where: { id: existing.id }, data })
    : await prisma.address.create({ data: { ...data, userId: req.user!.userId, isDefault: true } });

  res.json(address);
});
