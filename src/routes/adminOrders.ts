import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { NotFoundError } from "../lib/errors";

export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAdmin);

adminOrdersRouter.get("/", async (_req, res) => {
  const orders = await prisma.order.findMany({
    include: { items: true, address: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

adminOrdersRouter.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true, address: true, user: { select: { name: true, email: true } } },
  });
  if (!order) throw new NotFoundError("Order not found");
  res.json(order);
});

const StatusSchema = z.object({
  status: z.enum([
    "PENDING_PAYMENT",
    "PAYMENT_RECEIVED",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ]),
  paymentNote: z.string().optional(),
});

adminOrdersRouter.patch("/:id", async (req, res) => {
  const { status, paymentNote } = StatusSchema.parse(req.body);
  const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new NotFoundError("Order not found");

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { status, ...(paymentNote !== undefined ? { paymentNote } : {}) },
    include: { items: true, address: true },
  });
  res.json(order);
});
