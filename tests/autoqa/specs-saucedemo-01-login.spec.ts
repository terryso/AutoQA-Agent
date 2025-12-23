import { test, expect } from '@playwright/test'
import { loadEnvFiles, getEnvVar } from '../helpers/autoqa-env.js'

loadEnvFiles()

const baseUrl = getEnvVar('AUTOQA_BASE_URL')
const password = getEnvVar('AUTOQA_PASSWORD')
const username = getEnvVar('AUTOQA_USERNAME')

test('saucedemo 01 login', async ({ page }) => {
  // Step 1: Navigate to /
  await page.goto(new URL('/', baseUrl).toString());
  // Step 2: Verify the page shows the login form with fields "Username" and "Password"
  const locator2_1 = page.getByPlaceholder('Username');
  await expect(locator2_1).toHaveCount(1);
  await expect(locator2_1).toBeVisible();
  const locator2_2 = page.getByPlaceholder('Password');
  await expect(locator2_2).toHaveCount(1);
  await expect(locator2_2).toBeVisible();
  // Step 3: Fill the "Username" field with AUTOQA_USERNAME
  await page.getByPlaceholder('Username').fill(username);
  // Step 4: Fill the "Password" field with AUTOQA_PASSWORD
  await page.getByPlaceholder('Password').fill(password);
  // Step 5: Click the "Login" button
  await page.locator('#login-button').click();
  // Step 6: Verify the user is logged in and sees the inventory/products page (e.g. header shows "Products")
  const locator6_1 = page.getByText('Products');
  await expect(locator6_1.nth(0)).toBeVisible();
  const locator6_2 = page.locator('[data-test="title"]');
  await expect(locator6_2).toHaveCount(1);
  await expect(locator6_2).toBeVisible();
})
