import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { userRouter } from "../routes/UserRoute.js";
import { fileRouter } from "../routes/FileRoute.js";
import roomRoutes from "../routes/roomRoutes.js";

function createTestApp(): Express {
  const app: Express = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: "*",
      credentials: true,
    }),
  );
  app.use("/api/users", userRouter);
  app.use("/api/files", fileRouter);
  app.use("/api/rooms", roomRoutes);
  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });
  return app;
}

const app = createTestApp();

describe("HTTP Server Routes", () => {
  describe("GET /health", () => {
    it("should return 200 with status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("POST /api/users/signup", () => {
    it("should return 400 when email is missing", async () => {
      const res = await request(app)
        .post("/api/users/signup")
        .send({ password: "testpassword123" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("email and password");
    });

    it("should return 400 when password is too short", async () => {
      const res = await request(app)
        .post("/api/users/signup")
        .send({ email: "test@example.com", password: "short" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("8 characters");
    });

    it("should return 400 for invalid email format", async () => {
      const res = await request(app)
        .post("/api/users/signup")
        .send({ email: "invalid-email", password: "testpassword123" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("email format");
    });
  });

  describe("POST /api/users/login", () => {
    it("should return 400 when email is missing", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send({ password: "testpassword123" });
      expect(res.status).toBe(400);
    });

    it("should return 401 for non-existent user", async () => {
      const res = await request(app)
        .post("/api/users/login")
        .send({
          email: "nonexistent@example.com",
          password: "testpassword123",
        });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/rooms", () => {
    it("should return 401 without auth token", async () => {
      const res = await request(app).get("/api/rooms");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/rooms", () => {
    it("should return 401 without auth token", async () => {
      const res = await request(app).post("/api/rooms").send({ name: "Test" });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/rooms/:slug/share", () => {
    it("should return 401 without auth token", async () => {
      const res = await request(app)
        .post("/api/rooms/test-slug/share")
        .send({ permission: "view" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/files", () => {
    it("should return 401 without auth token", async () => {
      const res = await request(app).get("/api/files");
      expect(res.status).toBe(401);
    });
  });
});
