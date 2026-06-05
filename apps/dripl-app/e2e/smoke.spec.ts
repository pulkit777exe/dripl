import { test, expect } from '@playwright/test';

test.describe('App Landing', () => {
  test('loads the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Dripl/);
  });

  test('has login and get started links', async ({ page }) => {
    await page.goto('/');
    const loginLink = page.getByRole('link', { name: /sign in/i });
    const getStartedLink = page.getByRole('link', { name: /get started/i });
    await expect(loginLink).toBeVisible();
    await expect(getStartedLink).toBeVisible();
  });
});

test.describe('Signup Page', () => {
  test('loads the signup form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByPlaceholder('Full name')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up with email/i })).toBeVisible();
  });
});

test.describe('Login Page', () => {
  test('loads the login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder('Enter your email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
