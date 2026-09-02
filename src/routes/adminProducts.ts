import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { tryToKurus } from "../lib/money";
import { NotFoundError } from "../lib/errors";

export const adminProductsRouter = Router();
adminProductsRouter.use(requireAdmin);

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const ProductSchema = z
  .object({
    name: z.string().trim().min(2),
    description: z.string().trim().min(1),
    imageUrl: z.url(),
    priceTRY: z.coerce.number().positive(),
    categoryId: z.string().min(1),
    fulfillmentType: z.enum(["STOCKED", "ON_REQUEST"]),
    stock: z.coerce.number().int().min(0).optional(),
    leadTimeDays: z.coerce.number().int().min(1).optional(),
    active: z.boolean().optional(),
  })
  .transform((data) => ({ ...data, priceKurus: tryToKurus(data.priceTRY) }));

// GET /api/admin/products — includes inactive/hidden products, unlike the public list
adminProductsRouter.get("/", async (_req, res) => {
  const products = await prisma.product.findMany({
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(products);
});

adminProductsRouter.post("/", async (req, res) => {
  const data = ProductSchema.parse(req.body);

  const product = await prisma.product.create({
    data: {
      name: data.name,
      slug: `${slugify(data.name)}-${Math.random().toString(36).slice(2, 6)}`,
      description: data.description,
      imageUrl: data.imageUrl,
      priceKurus: data.priceKurus,
      categoryId: data.categoryId,
      fulfillmentType: data.fulfillmentType,
      stock: data.fulfillmentType === "STOCKED" ? data.stock ?? 0 : null,
      leadTimeDays: data.fulfillmentType === "ON_REQUEST" ? data.leadTimeDays ?? 14 : null,
      active: data.active ?? true,
    },
  });
  res.status(201).json(product);
});

adminProductsRouter.put("/:id", async (req, res) => {
  const data = ProductSchema.parse(req.body);
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError("Product not found");

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: {
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      priceKurus: data.priceKurus,
      categoryId: data.categoryId,
      fulfillmentType: data.fulfillmentType,
      stock: data.fulfillmentType === "STOCKED" ? data.stock ?? 0 : null,
      leadTimeDays: data.fulfillmentType === "ON_REQUEST" ? data.leadTimeDays ?? 14 : null,
      active: data.active ?? true,
    },
  });
  res.json(product);
});

// Soft delete: products referenced by past orders can't be hard-deleted (FK
// constraint) — deactivating keeps order history intact while hiding it
// from the shop.
adminProductsRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError("Product not found");

  await prisma.product.update({ where: { id: req.params.id }, data: { active: false } });
  res.status(204).send();
});
