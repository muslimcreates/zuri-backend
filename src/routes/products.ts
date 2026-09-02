import { Router } from "express";
import { prisma } from "../lib/prisma";
import { NotFoundError } from "../lib/errors";

export const productsRouter = Router();

// GET /api/products?category=spices
productsRouter.get("/", async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : undefined;

  const products = await prisma.product.findMany({
    where: {
      active: true,
      ...(category ? { category: { slug: category } } : {}),
    },
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(products);
});

productsRouter.get("/:slug", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { slug: req.params.slug },
    include: { category: true },
  });
  if (!product || !product.active) throw new NotFoundError("Product not found");
  res.json(product);
});
