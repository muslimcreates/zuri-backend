import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { createOrder } from "../lib/orders";
import { MANUAL_PAYMENT_VALUES } from "../lib/payments";
import { NotFoundError, ForbiddenError } from "../lib/errors";
import { sendNewOrderNotification } from "../lib/email";
import { clearCart, getCartItems } from "../lib/cart";

export const ordersRouter = Router();

const CheckoutSchema = z.object({
  address: z.object({
    fullName: z.string().trim().min(2, "Enter the recipient's full name."),
    phone: z.string().trim().min(7, "Enter a valid phone number."),
    city: z.string().trim().min(2, "Enter a city."),
    addressLine: z.string().trim().min(5, "Enter a delivery address."),
    postalCode: z.string().trim().min(3, "Enter a postal code."),
  }),
  paymentMethod: z.enum(MANUAL_PAYMENT_VALUES),
});

// POST /api/orders — place an order from the caller's server-side cart (see
// src/lib/cart.ts). The client only supplies delivery address + payment
// method; the items themselves always come from the cart we hold, never
// from anything the client sends, so there's no way to check out items you
// never actually added.
ordersRouter.post("/", requireAuth, requireVerifiedEmail, async (req, res) => {
  const { address, paymentMethod } = CheckoutSchema.parse(req.body);

  const cartItems = await getCartItems(req.user!.userId);
  const items = cartItems.map((ci) => ({ productId: ci.productId, quantity: ci.quantity }));

  const order = await createOrder({
    userId: req.user!.userId,
    items,
    address,
    paymentMethod,
  });

  // Only reached once the order is actually created — if createOrder threw
  // (empty cart, out of stock, etc.) the cart is left exactly as it was.
  await clearCart(req.user!.userId);

  // Fire-and-forget: the admin's only heads-up that a new order exists
  // today is this email (see lib/email.ts). Never let it hold up or break
  // the checkout response.
  const customer = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (customer) {
    sendNewOrderNotification({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: customer.name,
      customerEmail: customer.email,
      totalKurus: order.subtotalKurus,
      paymentMethod: order.paymentMethod,
      itemsSummary: order.items.map((i) => `${i.quantity}x ${i.productName}`).join(", "),
    }).catch((err) => console.error("[orders] Failed to send new-order notification:", err));
  }

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
