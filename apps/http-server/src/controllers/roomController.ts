import { Response } from "express";
import prisma from "@dripl/db";
import { AuthRequest } from "../middlewares/authMiddleware";
import crypto from "crypto";

function generateSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }
  return slug;
}

export class RoomController {
  static async getRooms(req: AuthRequest, res: Response): Promise<void> {
    try {
      const rooms = await prisma.canvasRoom.findMany({
        where: {
          OR: [
            { ownerId: req.userId },
            {
              members: {
                some: {
                  userId: req.userId,
                },
              },
            },
          ],
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          slug: true,
          name: true,
          isPublic: true,
          createdAt: true,
          updatedAt: true,
          ownerId: true,
        },
      });

      res.json({ rooms });
    } catch (error) {
      console.error("Error fetching rooms:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async createRoom(req: AuthRequest, res: Response): Promise<void> {
    const { name, isPublic = false } = req.body;

    try {
      let slug = generateSlug();
      let attempts = 0;
      while (attempts < 5) {
        const existing = await prisma.canvasRoom.findUnique({
          where: { slug },
        });
        if (!existing) break;
        slug = generateSlug();
        attempts++;
      }

      const room = await prisma.canvasRoom.create({
        data: {
          slug,
          name: name || "Untitled Room",
          ownerId: req.userId!,
          isPublic,
          content: "[]",
        },
      });

      res.status(201).json({
        status: "room created",
        room,
      });
    } catch (error) {
      console.error("Error creating room:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getRoom(req: AuthRequest, res: Response): Promise<void> {
    const { slug } = req.params as { slug: string };

    try {
      const room = await prisma.canvasRoom.findUnique({
        where: { slug },
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          members: {
            select: {
              userId: true,
              role: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      const isOwner = room.ownerId === req.userId;
      const isMember = room.members.some((m) => m.userId === req.userId);

      if (!room.isPublic && !isOwner && !isMember) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      res.json({ room });
    } catch (error) {
      console.error("Error fetching room:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async updateRoom(req: AuthRequest, res: Response): Promise<void> {
    const { slug } = req.params as { slug: string };
    const { name, isPublic, content } = req.body;

    try {
      const room = await prisma.canvasRoom.findUnique({ where: { slug } });

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (room.ownerId !== req.userId) {
        res.status(403).json({ error: "Only the owner can update this room" });
        return;
      }

      const updatedRoom = await prisma.canvasRoom.update({
        where: { slug },
        data: {
          ...(name !== undefined && { name }),
          ...(isPublic !== undefined && { isPublic }),
          ...(content !== undefined && { content }),
        },
      });

      res.json({
        status: "room updated",
        room: updatedRoom,
      });
    } catch (error) {
      console.error("Error updating room:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async deleteRoom(req: AuthRequest, res: Response): Promise<void> {
    const { slug } = req.params as { slug: string };

    try {
      const room = await prisma.canvasRoom.findUnique({ where: { slug } });

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (room.ownerId !== req.userId) {
        res.status(403).json({ error: "Only the owner can delete this room" });
        return;
      }

      await prisma.canvasRoomMember.deleteMany({
        where: { roomId: room.id },
      });

      await prisma.canvasRoom.delete({ where: { slug } });

      res.json({ status: "room deleted" });
    } catch (error) {
      console.error("Error deleting room:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async addMember(req: AuthRequest, res: Response): Promise<void> {
    const { slug } = req.params as { slug: string };
    const { userId, role = "EDITOR" } = req.body;

    if (!userId) {
      res.status(400).json({ error: "User ID is required" });
      return;
    }

    if (!["EDITOR", "VIEWER"].includes(role)) {
      res
        .status(400)
        .json({ error: "Invalid role. Must be 'EDITOR' or 'VIEWER'" });
      return;
    }

    try {
      const room = await prisma.canvasRoom.findUnique({ where: { slug } });

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (room.ownerId !== req.userId) {
        res.status(403).json({ error: "Only the owner can add members" });
        return;
      }

      const existingMember = await prisma.canvasRoomMember.findUnique({
        where: {
          roomId_userId: {
            roomId: room.id,
            userId,
          },
        },
      });

      if (existingMember) {
        res
          .status(409)
          .json({ error: "User is already a member of this room" });
        return;
      }

      const member = await prisma.canvasRoomMember.create({
        data: {
          roomId: room.id,
          userId,
          role,
        },
      });

      res.status(201).json({
        status: "member added",
        member,
      });
    } catch (error) {
      console.error("Error adding member:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async removeMember(req: AuthRequest, res: Response): Promise<void> {
    const { slug, userId } = req.params as { slug: string; userId: string };

    try {
      const room = await prisma.canvasRoom.findUnique({ where: { slug } });

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (room.ownerId !== req.userId) {
        res.status(403).json({ error: "Only the owner can remove members" });
        return;
      }

      if (room.ownerId === userId) {
        res
          .status(400)
          .json({ error: "Owner cannot remove themselves from the room" });
        return;
      }

      await prisma.canvasRoomMember.deleteMany({
        where: {
          roomId: room.id,
          userId,
        },
      });

      res.json({ status: "member removed" });
    } catch (error) {
      console.error("Error removing member:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async shareRoom(req: AuthRequest, res: Response): Promise<void> {
    const { slug } = req.params as { slug: string };
    const { permission = "view", expiresIn = 24 } = req.body;

    if (!["view", "edit"].includes(permission)) {
      res
        .status(400)
        .json({ error: "Invalid permission. Must be 'view' or 'edit'" });
      return;
    }

    try {
      const room = await prisma.canvasRoom.findUnique({ where: { slug } });

      if (!room) {
        res.status(404).json({ error: "Room not found" });
        return;
      }

      if (room.ownerId !== req.userId) {
        res.status(403).json({ error: "Only the owner can share this room" });
        return;
      }

      const token = `${slug}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const expiresAt = new Date(Date.now() + expiresIn * 60 * 60 * 1000);

      const shareLink = await prisma.shareLink.create({
        data: {
          token,
          roomId: room.id,
          permission: permission.toUpperCase() as "VIEW" | "EDIT",
          expiresAt,
          createdById: req.userId!,
        },
      });

      res.status(201).json({
        status: "share link created",
        token: shareLink.token,
        url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/board/${shareLink.token}`,
        permission: shareLink.permission,
        expiresAt: shareLink.expiresAt,
      });
    } catch (error) {
      console.error("Error creating share link:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getShareLink(req: AuthRequest, res: Response): Promise<void> {
    const { token } = req.params as { token: string };

    try {
      const shareLink = await prisma.shareLink.findUnique({
        where: { token },
        include: {
          room: {
            select: {
              id: true,
              slug: true,
              name: true,
              content: true,
              isPublic: true,
            },
          },
        },
      });

      if (!shareLink) {
        res.status(404).json({ error: "Share link not found" });
        return;
      }

      if (shareLink.expiresAt < new Date()) {
        res.status(410).json({ error: "Share link has expired" });
        return;
      }

      res.json({
        room: shareLink.room,
        permission: shareLink.permission,
        expiresAt: shareLink.expiresAt,
      });
    } catch (error) {
      console.error("Error fetching share link:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  static async getSharedRooms(req: AuthRequest, res: Response): Promise<void> {
    try {
      const sharedRooms = await prisma.canvasRoomMember.findMany({
        where: { userId: req.userId },
        include: {
          room: {
            select: {
              id: true,
              slug: true,
              name: true,
              isPublic: true,
              createdAt: true,
              updatedAt: true,
              owner: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.json({ rooms: sharedRooms });
    } catch (error) {
      console.error("Error fetching shared rooms:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
}
