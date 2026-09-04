import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { addCartItem, clearCart, getCartItems, removeCartItem, setCartItemQuantity } from "../lib/cart";

export const cartRouter = Router();

// Every route here requires a signed-in user — the cart belongs to an
// account, not a browser (see prisma/schema.prisma's Cart model for why) —
// and a verified email, so an unconfirmed account can't be used to stage a
// cart it'll never be able to check out with (checkout requires
// verification too — see routes/orders.ts).
cartRouter.use(requireAuth, requireVerifiedEmail);

const AddItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive().default(1),
});

const SetQuantitySchema = z.object({
  quantity: z.coerce.number().int(),
});

// GET /api/cart — the current user's cart, items joined with live product data.
cartRouter.get("/", async (req, res) => {
  const items = await getCartItems(req.user!.userId);
  res.json(items);
});

// POST /api/cart/items — add a product (increments quantity if already in the cart).
cartRouter.post("/items", async (req, res) => {
  const { productId, quantity } = AddItemSchema.parse(req.body);
  const items = await addCartItem(req.user!.userId, productId, quantity);
  res.status(201).json(items);
});

// PUT /api/cart/items/:productId — set an absolute quantity; <= 0 removes it.
cartRouter.put("/items/:productId", async (req, res) => {
  const { quantity } = SetQuantitySchema.parse(req.body);
  const items = await setCartItemQuantity(req.user!.userId, String(req.params.productId), quantity);
  res.json(items);
});

// DELETE /api/cart/items/:productId — remove one product from the cart.
cartRouter.delete("/items/:productId", async (req, res) => {
  const items = await removeCartItem(req.user!.userId, String(req.params.productId));
  res.json(items);
});

// DELETE /api/cart — empty the whole cart (used by the "Clear cart" button;
// checkout also calls this internally once an order is placed).
cartRouter.delete("/", async (req, res) => {
  const items = await clearCart(req.user!.userId);
  res.json(items);
});
