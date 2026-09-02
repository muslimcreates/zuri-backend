import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { createOrder } from "../lib/orders";
import { MANUAL_PAYMENT_VALUES } from "../lib/payments";
import { NotFoundError, ForbiddenError } from "../lib/errors";

export const ordersRouter = Router();

const CheckoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().int().positive(),
      })
    )
    .min(1, "Cart is empty."),
  address: z.object({
    fullName: z.string().trim().min(2, "Enter the recipient's full name."),
    phone: z.string().trim().min(7, "Enter a valid phone number."),
    city: z.string().trim().min(2, "Enter a city."),
    addressLine: z.string().trim().min(5, "Enter a delivery address."),
    postalCode: z.string().trim().min(3, "Enter a postal code."),
  }),
  paymentMethod: z.enum(MANUAL_PAYMENT_VALUES),
});

// POST /api/orders — place an order from a cart payload (see src/lib/orders.ts
// for why the cart itself isn't persisted server-side).
ordersRouter.post("/", requireAuth, async (req, res) => {
  const { items, address, paymentMethod } = CheckoutSchema.parse(req.body);

  const order = await createOrder({
    userId: req.user!.userId,
    items,
    address,
    paymentMethod,
  });

  res.status(201).json(order);
});

// GET /api/orders — the current user's own order history
ordersRouter.get("/", requireAuth, async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user!.userId },
    include: { items: true, address: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(orders);
});

// GET /api/orders/:orderNumber — a single order, only if it belongs to you
ordersRouter.get("/:orderNumber", requireAuth, async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { orderNumber: String(req.params.orderNumber) },
    include: { items: true, address: true },
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.userId !== req.user!.userId) throw new ForbiddenError();
  res.json(order);
});
