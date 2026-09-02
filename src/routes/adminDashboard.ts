import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";

export const adminDashboardRouter = Router();
adminDashboardRouter.use(requireAdmin);

// GET /api/admin/dashboard — summary stats for an admin home screen
adminDashboardRouter.get("/", async (_req, res) => {
  const [pendingOrders, totalOrders, activeProducts, lowStock, recentOrders] =
    await Promise.all([
      prisma.order.count({ where: { status: "PENDING_PAYMENT" } }),
      prisma.order.count(),
      prisma.product.count({ where: { active: true } }),
      prisma.product.findMany({
        where: { fulfillmentType: "STOCKED", active: true, stock: { lte: 3 } },
        orderBy: { stock: "asc" },
      }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { items: true },
      }),
    ]);

  res.json({ pendingOrders, totalOrders, activeProducts, lowStock, recentOrders });
});
