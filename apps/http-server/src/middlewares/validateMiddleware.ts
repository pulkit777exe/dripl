import { Request, Response, NextFunction } from "express";

export const validateSignup = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      error: "Email and password are required",
    });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({
      error: "Password must be at least 8 characters long",
    });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({
      error: "Invalid email format",
    });
    return;
  }

  next();
};

export const validateLogin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({
      error: "Email and password are required",
    });
    return;
  }

  next();
};