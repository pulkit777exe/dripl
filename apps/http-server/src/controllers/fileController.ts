import { Response } from "express";
import prisma from "@dripl/db";
import { randomUUID } from "crypto";
import { AuthRequest } from "../middlewares/authMiddleware";

export class FileController {
  static async getFiles(req: AuthRequest, res: Response): Promise<void> {
    try {
      const files = await prisma.file.findMany({
        where: {
          userId: req.userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          name: true,
          preview: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      res.json({
        files,
      });
    } catch (error) {
      console.error("Error fetching files:", error);
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }

  static async createFile(req: AuthRequest, res: Response): Promise<void> {
    const { name } = req.body;

    try {
      const file = await prisma.file.create({
        data: {
          id: randomUUID(),
          name: name || "Untitled",
          userId: req.userId!,
          content: "[]",
        },
      });

      res.status(201).json({
        status: "file created",
        file,
      });
    } catch (error) {
      console.error("Error creating file:", error);
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }

  static async getFile(req: AuthRequest, res: Response): Promise<void> {
    const { fileId } = req.params as { fileId: string };

    try {
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: req.userId,
        },
      });

      if (!file) {
        res.status(404).json({
          error: "File not found",
        });
        return;
      }

      res.json({
        file,
      });
    } catch (error) {
      console.error("Error fetching file:", error);
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }

  static async updateFile(req: AuthRequest, res: Response): Promise<void> {
    const { fileId } = req.params as { fileId: string };
    const { name, content } = req.body;

    try {
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: req.userId,
        },
      });

      if (!file) {
        res.status(404).json({
          error: "File not found",
        });
        return;
      }

      const updatedFile = await prisma.file.update({
        where: { id: fileId },
        data: {
          name,
          content,
        },
      });

      res.json({
        status: "file updated",
        file: updatedFile,
      });
    } catch (error) {
      console.error("Error updating file:", error);
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }

  static async deleteFile(req: AuthRequest, res: Response): Promise<void> {
    const { fileId } = req.params as { fileId: string };

    try {
      const file = await prisma.file.findFirst({
        where: {
          id: fileId,
          userId: req.userId,
        },
      });

      if (!file) {
        res.status(404).json({
          error: "File not found",
        });
        return;
      }

      await prisma.file.delete({
        where: { id: fileId },
      });

      res.json({
        status: "file deleted",
      });
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).json({
        error: "Internal server error",
      });
    }
  }
}
