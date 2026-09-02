import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { setSessionCookie, clearSessionCookie } from "../lib/session";
import { ConflictError, UnauthorizedError } from "../lib/errors";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.email("Enter a valid email address.").trim(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

authRouter.post("/signup", async (req, res) => {
  const { name, email, password } = SignupSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError("An account with that email already exists.");

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: "CUSTOMER" },
  });

  setSessionCookie(res, { userId: user.id, role: user.role });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

const LoginSchema = z.object({
  email: z.email("Enter a valid email address.").trim(),
  password: z.string().min(1, "Password is required."),
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new UnauthorizedError("Incorrect email or password.");

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw new UnauthorizedError("Incorrect email or password.");

  setSessionCookie(res, { userId: user.id, role: user.role });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});
