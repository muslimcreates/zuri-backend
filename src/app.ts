import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { attachUser } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./routes/auth";
import { categoriesRouter } from "./routes/categories";
import { productsRouter } from "./routes/products";
import { cartRouter } from "./routes/cart";
import { ordersRouter } from "./routes/orders";
import { addressesRouter } from "./routes/addresses";
import { adminProductsRouter } from "./routes/adminProducts";
import { adminOrdersRouter } from "./routes/adminOrders";
import { adminDashboardRouter } from "./routes/adminDashboard";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
      credentials: true, // required for the httpOnly session cookie to be sent cross-origin
    })
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachUser);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/addresses", addressesRouter);
  app.use("/api/admin/products", adminProductsRouter);
  app.use("/api/admin/orders", adminOrdersRouter);
  app.use("/api/admin/dashboard", adminDashboardRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
