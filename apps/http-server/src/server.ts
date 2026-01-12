import express, { Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { userRouter } from "./routes/UserRoute";
import { fileRouter } from "./routes/FileRoute";
import roomRoutes from "./routes/roomRoutes";

const app: Express = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use("/api/users", userRouter);
app.use("/api/files", fileRouter);
app.use("/api/rooms", roomRoutes);
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
