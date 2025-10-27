import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { createErrorResponse } from "../utils/responses";
import { configDotenv } from "dotenv";

configDotenv();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = "chat-app";

if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not defined");
  process.exit(1);
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  email?: string;
}

interface JWTPayload {
  userId: string;
  email: string;
  iss?: string;
  exp?: number;
}

const extractToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  
  return parts[1]?.trim() || null;
};

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers["authorization"];
    const token = extractToken(authHeader);

    if (!token) {
      res.status(401).json(
        createErrorResponse("Authentication token required", 401)
      );
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET!, {
      issuer: JWT_ISSUER,
    }) as JWTPayload;

    if (!decoded.userId || !decoded.email) {
      res.status(401).json(
        createErrorResponse("Invalid token payload", 401)
      );
      return;
    }

    (req as AuthenticatedRequest).userId = decoded.userId;
    (req as AuthenticatedRequest).email = decoded.email;

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json(
        createErrorResponse("Token has expired", 401)
      );
      return;
    }

    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json(
        createErrorResponse("Invalid token", 401)
      );
      return;
    }

    console.error("Authentication error:", {
      error: err instanceof Error ? err.message : "Unknown error",
      path: req.path,
      method: req.method,
    });

    res.status(401).json(
      createErrorResponse("Authentication failed", 401)
    );
    return;
  }
};