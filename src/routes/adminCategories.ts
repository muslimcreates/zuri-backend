import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { ConflictError } from "../lib/errors";

export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(requireAdmin);

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const CategorySchema = z.object({
  name: z.string().trim().min(2),
});

// GET /api/admin/categories — same shape as the public GET /api/categories;
// kept here too so admin-side tooling never needs a second, differently
// authed fetch path.
adminCategoriesRouter.get("/", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  res.json(categories);
});

// POST /api/admin/categories — the catalog started as a handful of
// categories seeded once (prisma/seed.ts) and never needed a way to add
// more. Now that it's grown past groceries (e.g. Electronics), this is how
// a brand-new department gets created without touching the database
// directly.
adminCategoriesRouter.post("/", async (req, res) => {
  const { name } = CategorySchema.parse(req.body);
  const slug = slugify(name);

  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) {
    throw new ConflictError(`A category named "${existing.name}" already exists.`);
  }

  const category = await prisma.category.create({ data: { name, slug } });
  res.status(201).json(category);
});
