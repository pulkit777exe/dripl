import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prismaClient } from "@repo/db";
import { UserSchema, SignInSchema } from "@repo/common-config/config";
import { createErrorResponse, createSuccessResponse } from "../utils/responses";
import dotenv from "dotenv";

dotenv.config();

const authRoutes: Router = Router();

const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY = "7d";
const JWT_ISSUER = "chat-app";
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not defined");
  process.exit(1);
}

const generateToken = (userId: string, email: string): string => {
  return jwt.sign({ userId, email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
    issuer: JWT_ISSUER,
  });
};

const isPasswordStrong = (
  password: string
): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters" };
  }
  return { valid: true };
};

authRoutes.post(
  "/signup",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = UserSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(
            createErrorResponse(
              "Invalid input: " +
                parsed.error.errors.map((e) => e.message).join(", ")
            )
          );
        return;
      }

      const { email, password, name } = parsed.data;

      const passwordCheck = isPasswordStrong(password);
      if (!passwordCheck.valid) {
        res.status(400).json(createErrorResponse(passwordCheck.message!));
        return;
      }

      const normalizedEmail = email.toLowerCase().trim();

      const existingUser = await prismaClient.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      if (existingUser) {
        res
          .status(409)
          .json(
            createErrorResponse(
              "An account with this email already exists",
              409
            )
          );
        return;
      }

      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const newUser = await prismaClient.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name: name.trim(),
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });

      const token = generateToken(newUser.id, newUser.email);

      res
        .status(201)
        .json(
          createSuccessResponse(
            { user: newUser, token },
            "Account created successfully"
          )
        );
    } catch (error) {
      console.error("Signup error:", {
        email: req.body?.email,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      res
        .status(500)
        .json(
          createErrorResponse(
            "Failed to create account. Please try again.",
            500
          )
        );
    }
  }
);

authRoutes.post(
  "/signin",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = SignInSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(
            createErrorResponse(
              "Invalid input: " +
                parsed.error.errors.map((e) => e.message).join(", ")
            )
          );
        return;
      }

      const { email, password } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      const user = await prismaClient.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          name: true,
          password: true,
        },
      });

      const invalidCredentialsError = createErrorResponse(
        "Invalid email or password",
        401
      );

      if (!user) {
        res.status(401).json(invalidCredentialsError);
        return;
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        res.status(401).json(invalidCredentialsError);
        return;
      }

      const token = generateToken(user.id, user.email);

      const { password: _, ...userWithoutPassword } = user;

      res.json(
        createSuccessResponse(
          {
            user: userWithoutPassword,
            token,
            expiresIn: JWT_EXPIRY,
          },
          "Sign-in successful"
        )
      );
    } catch (error) {
      console.error("Signin error:", {
        email: req.body?.email,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      res
        .status(500)
        .json(createErrorResponse("Failed to sign in. Please try again.", 500));
    }
  }
);

export default authRoutes;
