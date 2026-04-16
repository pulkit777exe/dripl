import { Response } from 'express';
import { db as prisma } from '@dripl/db';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { AuthRequest, generateToken } from '../middlewares/authMiddleware';

const isProduction = process.env.NODE_ENV === 'production';

export class UserController {
  static async signup(req: AuthRequest, res: Response): Promise<void> {
    const { email, name, password, image } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'Email and password are required',
      });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({
        error: 'Password must be at least 8 characters long',
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({
        error: 'Invalid email format',
      });
      return;
    }

    try {
      const userExists = await prisma.user.findUnique({
        where: { email },
      });

      if (userExists) {
        res.status(409).json({
          error: 'User with this email already exists',
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await prisma.user.create({
        data: {
          id: randomUUID(),
          email,
          password: hashedPassword,
          name: name || null,
          image: image || null,
        },
      });

      const token = generateToken(newUser.id);

      res.cookie('token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.status(201).json({
        status: 'user created',
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          image: newUser.image,
        },
        token,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'create_user_error',
          error: error instanceof Error ? error.message : String(error),
        })
      );
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }

  static async login(req: AuthRequest, res: Response): Promise<void> {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        error: 'Email and password are required',
      });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        res.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      if (!user.password) {
        res.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        res.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      const token = generateToken(user.id);

      res.cookie('token', token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json({
        status: 'login successful',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        },
        token,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'login_error',
          error: error instanceof Error ? error.message : String(error),
        })
      );
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }

  static async logout(req: AuthRequest, res: Response): Promise<void> {
    res.clearCookie('token');
    res.json({
      status: 'logout successful',
    });
  }

  static async getProfile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        res.status(404).json({
          error: 'User not found',
        });
        return;
      }

      res.json({
        user,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'fetch_profile_error',
          error: error instanceof Error ? error.message : String(error),
        })
      );
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }

  static async updateProfile(req: AuthRequest, res: Response): Promise<void> {
    const { name, image } = req.body;

    try {
      const updatedUser = await prisma.user.update({
        where: { id: req.userId },
        data: {
          name,
          image,
        },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
        },
      });

      res.json({
        status: 'profile updated',
        user: updatedUser,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'update_profile_error',
          error: error instanceof Error ? error.message : String(error),
        })
      );
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
}
