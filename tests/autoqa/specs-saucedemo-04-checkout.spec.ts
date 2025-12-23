import { test, expect } from '@playwright/test'
import { loadEnvFiles, getEnvVar } from '../helpers/autoqa-env.js'

loadEnvFiles()

const baseUrl = getEnvVar('AUTOQA_BASE_URL')
const password = getEnvVar('AUTOQA_PASSWORD')
const username = getEnvVar('AUTOQA_USERNAME')

test('saucedemo 04 checkout', async ({ page }) => {
  // Step 1: Navigate to /
  await page.goto(new URL('/', baseUrl).toString());
  // Step 2: Fill the "Username" field with AUTOQA_USERNAME
  await page.getByPlaceholder('Username').fill(username);
  // Step 3: Fill the "Password" field with AUTOQA_PASSWORD
  await page.getByPlaceholder('Password').fill(password);
  // Step 4: Click the "Login" button
  await page.locator('#login-button').click();
  // Step 5: Verify the user is logged in and sees the inventory/products page (e.g. header shows "Products")
  const locator5_1 = page.getByText('Products');
  await expect(locator5_1.nth(0)).toBeVisible();
  // Step 6: Click "Add to cart" for any product
  await page.locator('#add-to-cart-sauce-labs-backpack').click();
  // Step 7: Verify the cart icon badge count becomes 1
  const locator7_1 = page.getByText('1');
  await expect(locator7_1.nth(0)).toBeVisible();
  // Step 8: Click the cart icon
  await page.locator('[data-test="shopping-cart-badge"]').click();
  // Step 9: Verify the cart page shows "Your Cart" and contains at least 1 item
  const locator9_1 = page.getByText('Your Cart');
  await expect(locator9_1.nth(0)).toBeVisible();
  const locator9_2 = page.getByText('Sauce Labs Backpack');
  await expect(locator9_2.nth(0)).toBeVisible();
  // Step 10: Click the "Checkout" button
  await page.locator('#checkout').click();
  // Step 11: Verify the checkout information page is shown (e.g. title contains "Checkout: Your Information")
  const locator11_1 = page.getByText('Checkout: Your Information');
  await expect(locator11_1.nth(0)).toBeVisible();
  // Step 12: Fill in First Name with Test
  await page.getByPlaceholder('First Name').fill('Test');
  // Step 13: Fill in Last Name with User
  await page.getByPlaceholder('Last Name').fill('User');
  // Step 14: Fill in Postal Code/Zip with 100000
  await page.getByPlaceholder('Zip/Postal Code').fill('100000');
  // Step 15: Click the "Continue" button
  await page.locator('#continue').click();
  // Step 16: Verify the checkout overview page is shown (e.g. title contains "Checkout: Overview")
  const locator16_1 = page.getByText('Checkout: Overview');
  await expect(locator16_1.nth(0)).toBeVisible();
  // Step 17: Verify the overview shows:
  const locator17_1 = page.getByText('Payment Information');
  await expect(locator17_1.nth(0)).toBeVisible();
  const locator17_2 = page.getByText('Shipping Information');
  await expect(locator17_2.nth(0)).toBeVisible();
  const locator17_3 = page.getByText('Price Total');
  await expect(locator17_3.nth(0)).toBeVisible();
  // Step 18: Click the "Finish" button
  await page.locator('#finish').click();
  // Step 19: Verify the checkout complete page is shown (e.g. title contains "Checkout: Complete!")
  const locator19_1 = page.getByText('Checkout: Complete!');
  await expect(locator19_1.nth(0)).toBeVisible();
  // Step 20: Verify the page shows an order confirmation (e.g. "Thank you for your order!")
  const locator20_1 = page.getByText('Thank you for your order!');
  await expect(locator20_1.nth(0)).toBeVisible();
  // Step 21: Click the "Back Home" button
  await page.locator('#back-to-products').click();
  // Step 22: Verify the user returns to the inventory/products page
  const locator22_1 = page.getByText('Products');
  await expect(locator22_1.nth(0)).toBeVisible();
})
