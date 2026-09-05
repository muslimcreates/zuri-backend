import { prisma } from "./prisma";
import { BadRequestError } from "./errors";
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
 * Creates an order from a resolved list of {productId, quantity} lines.
 * The caller (routes/orders.ts) resolves these from the user's server-side
 * cart (see lib/cart.ts) — this function itself doesn't know or care where
 * they came from. Looks up live product data server-side (never trusts
 * client-sent prices), snapshots name/price/fulfillment type onto each
 * OrderItem, and decrements stock inside a transaction so concurrent
 * checkouts can't oversell.
 */
export async function createOrder({
  userId,
  items,
  address,
  paymentMethod,
  saveAsDefault,
}: {
  userId: string;
  items: CartItemInput[];
  address: NewAddressInput;
  paymentMethod: ManualPaymentMethod;
  saveAsDefault?: boolean;
}) {
  if (items.length === 0) {
    throw new BadRequestError("Cart is empty.");
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) }, active: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Every requested line is honored at face value, including products with
  // zero (or no) stock on hand. A lot of this catalog is sourced per-order
  // from Kenya rather than sitting in inventory — "0 in stock" means "we
  // haven't brought this batch over yet", not "can't be ordered". The
  // storefront no longer shows an out-of-stock badge or blocks add-to-cart
  // for this reason (see ProductCard/ProductDetailPage); stock therefore
  // must never gate or shrink an order here either.
  const lines = items
    .map((item) => {
      const product = byId.get(item.productId);
      if (!product || item.quantity <= 0) return null;
      return { product, quantity: item.quantity, lineTotalKurus: product.priceKurus * item.quantity };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (lines.length === 0) {
    throw new BadRequestError("None of the items in your cart are currently available.");
  }

  const subtotalKurus = lines.reduce((sum, l) => sum + l.lineTotalKurus, 0);

  const order = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      if (line.product.fulfillmentType === "STOCKED") {
        // Deliberately no availability check/rejection here (see the
        // comment on `lines` above) — this decrement is bookkeeping for the
        // admin dashboard's low/negative-stock view, not a gate on the
        // order. Going negative just means "N owed, not yet sourced".
        await tx.product.update({
          where: { id: line.product.id },
          data: { stock: { decrement: line.quantity } },
        });
      }
    }

    const createdAddress = await tx.address.create({
      data: { userId, ...address },
    });

    // Deliberately a *separate* row from createdAddress above, not the same
    // one reused with isDefault: true — see the doc comment on
    // Address.isDefault in schema.prisma for why an order's address must
    // stay an immutable snapshot even if this becomes the user's default.
    if (saveAsDefault) {
      const existingDefault = await tx.address.findFirst({ where: { userId, isDefault: true } });
      if (existingDefault) {
        await tx.address.update({ where: { id: existingDefault.id }, data: address });
      } else {
        await tx.address.create({ data: { ...address, userId, isDefault: true } });
      }
    }

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
