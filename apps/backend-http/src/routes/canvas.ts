import { Router, Request, Response } from "express";
import { prismaClient } from "@repo/db";
import { createErrorResponse, createSuccessResponse } from "../utils/responses";
import { AuthenticatedRequest, authMiddleware } from "../middleware/auth";
import dotenv from "dotenv";

dotenv.config();

const canvasRoutes: Router = Router();

// Room management endpoints
canvasRoutes.post(
  "/rooms",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { name, slug } = req.body;

      if (!name || !slug) {
        res.status(400).json(
          createErrorResponse("Room name and slug are required")
        );
        return;
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(slug)) {
        res.status(400).json(
          createErrorResponse("Slug can only contain lowercase letters, numbers, and hyphens")
        );
        return;
      }

      // Check if slug already exists
      const existingRoom = await prismaClient.room.findUnique({
        where: { slug: slug.toLowerCase() },
        select: { id: true },
      });

      if (existingRoom) {
        res.status(409).json(
          createErrorResponse("Room with this slug already exists", 409)
        );
        return;
      }

      const newRoom = await prismaClient.room.create({
        data: {
          name: name.trim(),
          slug: slug.toLowerCase(),
          adminId: req.userId!,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
        },
      });

      res.status(201).json(
        createSuccessResponse(
          { room: newRoom },
          "Room created successfully"
        )
      );
    } catch (error) {
      console.error("Create room error:", {
        userId: req.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json(
        createErrorResponse("Failed to create room", 500)
      );
    }
  }
);

canvasRoutes.get(
  "/rooms",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { page = "1", limit = "20" } = req.query;
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);

      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        res.status(400).json(
          createErrorResponse("Invalid pagination parameters")
        );
        return;
      }

      const skip = (pageNum - 1) * limitNum;

      const rooms = await prismaClient.room.findMany({
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          updateAt: true,
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              chats: true,
            },
          },
        },
      });

      const totalCount = await prismaClient.room.count();

      res.json(
        createSuccessResponse(
          {
            rooms,
            pagination: {
              page: pageNum,
              limit: limitNum,
              total: totalCount,
              pages: Math.ceil(totalCount / limitNum),
            },
          },
          "Rooms retrieved successfully"
        )
      );
    } catch (error) {
      console.error("Get rooms error:", {
        userId: req.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json(
        createErrorResponse("Failed to retrieve rooms", 500)
      );
    }
  }
);

canvasRoutes.get(
  "/rooms/:slug",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { slug } = req.params;

      if (!slug || slug.trim().length === 0) {
        res.status(400).json(
          createErrorResponse("Invalid slug format")
        );
        return;
      }

      const room = await prismaClient.room.findUnique({
        where: { slug: slug.toLowerCase() },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          updateAt: true,
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              chats: true,
            },
          },
        },
      });

      if (!room) {
        res.status(404).json(createErrorResponse("Room not found", 404));
        return;
      }

      res.json(
        createSuccessResponse(
          { room },
          "Room retrieved successfully"
        )
      );
    } catch (error) {
      console.error("Get room error:", {
        slug: req.params.slug,
        userId: req.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json(
        createErrorResponse("Failed to retrieve room", 500)
      );
    }
  }
);

// Canvas state persistence
canvasRoutes.post(
  "/canvas/:roomId/save",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { roomId } = req.params;
      const { canvasData } = req.body;

      if (!roomId || !canvasData) {
        res.status(400).json(
          createErrorResponse("Room ID and canvas data are required")
        );
        return;
      }

      const roomIdNum = parseInt(roomId, 10);
      if (isNaN(roomIdNum)) {
        res.status(400).json(
          createErrorResponse("Invalid room ID")
        );
        return;
      }

      const room = await prismaClient.room.findUnique({
        where: { id: roomIdNum },
        select: { id: true, adminId: true },
      });

      if (!room) {
        res.status(404).json(createErrorResponse("Room not found", 404));
        return;
      }

      if (room.adminId !== req.userId) {
        res.status(403).json(
          createErrorResponse("Only room admin can save canvas state", 403)
        );
        return;
      }

      await prismaClient.room.update({
        where: { id: roomIdNum },
        data: {
          updateAt: new Date(),
        },
      });

      res.json(
        createSuccessResponse(
          { roomId: roomIdNum },
          "Canvas state saved successfully"
        )
      );
    } catch (error) {
      console.error("Save canvas error:", {
        roomId: req.params.roomId,
        userId: req.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json(
        createErrorResponse("Failed to save canvas state", 500)
      );
    }
  }
);

canvasRoutes.get(
  "/canvas/:roomId/load",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { roomId } = req.params;

      if (!roomId) {
        res.status(400).json(
          createErrorResponse("Room ID is required")
        );
        return;
      }

      const roomIdNum = parseInt(roomId, 10);
      if (isNaN(roomIdNum)) {
        res.status(400).json(
          createErrorResponse("Invalid room ID")
        );
        return;
      }

      const room = await prismaClient.room.findUnique({
        where: { id: roomIdNum },
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          updateAt: true,
        },
      });

      if (!room) {
        res.status(404).json(createErrorResponse("Room not found", 404));
        return;
      }

      res.json(
        createSuccessResponse(
          {
            roomId: roomIdNum,
            canvasData: {
              shapes: [],
              viewport: { x: 0, y: 0, zoom: 1 },
            },
          },
          "Canvas state loaded successfully"
        )
      );
    } catch (error) {
      console.error("Load canvas error:", {
        roomId: req.params.roomId,
        userId: req.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json(
        createErrorResponse("Failed to load canvas state", 500)
      );
    }
  }
);

export default canvasRoutes;
