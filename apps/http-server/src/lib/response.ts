import type { Response } from 'express';
import type { ApiError } from '@dripl/common';

export function sendError(
  res: Response,
  statusCode: number,
  error: string,
  message: string,
): Response {
  return res.status(statusCode).json({ error, message, statusCode } satisfies ApiError);
}
