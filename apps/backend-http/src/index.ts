import express, { NextFunction, Request, Response } from "express";
import authRoutes from "./routes/auth";
import chatRoutes from "./routes/chat";
import canvasRoutes from "./routes/canvas";
import { prismaClient } from "@repo/db";
import { createErrorResponse } from "./utils/responses";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3008", 10);
const app = express();

app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN
}));

app.use("/api/auth", authRoutes);
app.use("/api", chatRoutes);
app.use("/api", canvasRoutes);

app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use((req: Request, res: Response) => {
    res.status(404).json(createErrorResponse("Route not found", 404));
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json(createErrorResponse("Internal server error", 500));
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  await prismaClient.$disconnect();
  process.exit(0);
});
process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully");
  await prismaClient.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});