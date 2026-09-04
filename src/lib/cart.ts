import { prisma } from "./prisma";

// Server-side cart: one row per user (created lazily), one CartItem per
// product in it. Every function here returns the cart's items freshly
// joined with live product data (including category) so the frontend never
// has to separately fetch the product list and merge it by id — the response
// from any of these is always ready to render.

const ITEM_INCLUDE = { product: { include: { category: true } } } as const;

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId } });
  if (existing) return existing;
  // Two near-simultaneous first-adds could both miss the findUnique above;
  // fall back to re-reading on a unique-constraint clash rather than crash.
  try {
    return await prisma.cart.create({ data: { userId } });
  } catch {
    const cart = await prisma.cart.findUnique({ where: { userId } });
    if (cart) return cart;
    throw new Error("Failed to get or create cart");
  }
}

function listItems(cartId: string) {
  return prisma.cartItem.findMany({
    where: { cartId },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

export async function getCartItems(userId: string) {
  const cart = await getOrCreateCart(userId);
  return listItems(cart.id);
}

/** Adds `quantity` to the item's existing quantity (creating it if new). */
export async function addCartItem(userId: string, productId: string, quantity: number) {
  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId } },
  });
  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
  } else {
    await prisma.cartItem.create({ data: { cartId: cart.id, productId, quantity } });
  }
  return listItems(cart.id);
}

/** Sets the item's quantity to an absolute value; <= 0 removes it. */
export async function setCartItemQuantity(userId: string, productId: string, quantity: number) {
  const cart = await getOrCreateCart(userId);
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  } else {
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      update: { quantity },
      create: { cartId: cart.id, productId, quantity },
    });
  }
  return listItems(cart.id);
}

export async function removeCartItem(userId: string, productId: string) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
  return listItems(cart.id);
}

export async function clearCart(userId: string) {
  const cart = await getOrCreateCart(userId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return [] as Awaited<ReturnType<typeof listItems>>;
}
