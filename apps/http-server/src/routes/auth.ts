import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@dripl/db";
import {
  authMiddleware,
  clearSessionCookie,
  setSessionCookie,
  signSessionToken,
  type AuthenticatedRequest,
} from "../middleware/auth.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const authRouter: Router = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid registration payload",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const existing = await db.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });

    if (existing) {
      res.status(409).json({ error: "Email is already registered" });
      return;
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);

    const user = await db.user.create({
      data: {
        id: randomUUID(),
        email: parsed.data.email,
        name: parsed.data.name ?? null,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    const token = signSessionToken(user.id);
    setSessionCookie(res, token);

    res.status(201).json({ user });
  } catch (error) {
    console.error("register error", error);
    res.status(500).json({ error: "Failed to register user" });
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid login payload",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const user = await db.user.findUnique({
      where: { email: parsed.data.email },
    });

    if (!user) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const isValid = await bcrypt.compare(parsed.data.password, user.password);
    if (!isValid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signSessionToken(user.id);
    setSessionCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    });
  } catch (error) {
    console.error("login error", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", authMiddleware, async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const user = await db.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user });
  } catch (error) {
    console.error("me error", error);
    res.status(500).json({ error: "Failed to load user profile" });
  }
});

export { authRouter };
