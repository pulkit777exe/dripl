import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { requiredEnv } from '@dripl/utils';

dotenv.config();

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: requiredEnv('SMTP_USER'),
      pass: requiredEnv('SMTP_PASS'),
    },
  });
}

export const sendResetPasswordEmail = async (email: string, token: string) => {
  const resetLink = `${APP_URL}/reset-password?token=${token}`;

  await createTransporter().sendMail({
    from: `"Dripl" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Reset your password',
    html: `
      <h1>Password Reset</h1>
      <p>Click the link below to reset your password. This link will expire in 1 hour.</p>
      <a href="${resetLink}">Reset Password</a>
    `,
  });
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const verifyLink = `${APP_URL}/verify-email?token=${token}`;

  await createTransporter().sendMail({
    from: `"Dripl" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Verify your Dripl account',
    html: `
      <h1>Verify your account</h1>
      <p>Welcome to Dripl! Click the link below to verify your email address. This link will expire in 24 hours.</p>
      <a href="${verifyLink}">Verify Email</a>
      <p>If you didn't create an account, you can safely ignore this email.</p>
    `,
  });
};
