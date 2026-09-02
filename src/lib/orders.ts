import { prisma } from "./prisma";
import { BadRequestError, ConflictError } from "./errors";
import type { ManualPaymentMethod } from "./payments";

function generateOrderNumber() {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ZE-${y}${m}${d}-${rand}`;
}

export type CartItemInput = { productId: string; quantity: number };

export type NewAddressInput = {
  fullName: string;
  phone: string;
  city: string;
  addressLine: string;
  postalCode: string;
};

/**
 * Creates an order from a cart payload the client sends at checkout time
 * (this API is stateless about carts — the frontend owns cart state, e.g.
 * in localStorage, and only tells the backend about it at checkout).
 * Looks up live product data server-side (never trusts client-sent prices),
 * snapshots name/price/fulfillment type onto each OrderItem, and decrements
 * stock inside a transaction so concurrent checkouts can't oversell.
 */
export async function createOrder({
  userId,
  items,
  address,
  paymentMethod,
}: {
  userId: string;
  items: CartItemInput[];
  address: NewAddressInput;
  paymentMethod: ManualPaymentMethod;
}) {
  if (items.length === 0) {
    throw new BadRequestError("Cart is empty.");
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) }, active: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = items
    .map((item) => {
      const product = byId.get(item.productId);
      if (!product) return null;
      const quantity =
        product.fulfillmentType === "STOCKED" && product.stock !== null
          ? Math.min(item.quantity, Math.max(product.stock, 0))
          : item.quantity;
      if (quantity <= 0) return null;
      return { product, quantity, lineTotalKurus: product.priceKurus * quantity };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (lines.length === 0) {
    throw new BadRequestError("None of the items in your cart are currently available.");
  }

  const subtotalKurus = lines.reduce((sum, l) => sum + l.lineTotalKurus, 0);

  const order = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.product.fulfillmentType === "STOCKED") {
        const fresh = await tx.product.findUnique({
          where: { id: line.product.id },
          select: { stock: true },
        });
        if (!fresh || (fresh.stock ?? 0) < line.quantity) {
          throw new ConflictError(`${line.product.name} no longer has enough stock.`);
        }
        await tx.product.update({
          where: { id: line.product.id },
          data: { stock: { decrement: line.quantity } },
        });
      }
    }

    const createdAddress = await tx.address.create({
      data: { userId, ...address },
    });

    return tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId,
        addressId: createdAddress.id,
        paymentMethod,
        subtotalKurus,
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            productName: l.product.name,
            unitPriceKurus: l.product.priceKurus,
            quantity: l.quantity,
            fulfillmentType: l.product.fulfillmentType,
            lineTotalKurus: l.lineTotalKurus,
          })),
        },
      },
      include: { items: true, address: true },
    });
  });

  return order;
}
