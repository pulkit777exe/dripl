import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), "../../.env.local"), override: true });

import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { filesRouter } from "./routes/files";
import { foldersRouter } from "./routes/folders";
import { shareRouter } from "./routes/share";

const app = express();
const port = Number(process.env.PORT ?? 3002);
const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 250,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/share", shareRouter);
app.use("/api/files", authMiddleware, filesRouter);
app.use("/api/folders", authMiddleware, foldersRouter);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("http-server error", error);
  res.status(500).json({
    error: "Internal server error",
  });
});

app.listen(port, () => {
  console.log(`HTTP server listening on port ${port}`);
});
