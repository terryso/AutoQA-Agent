import { test, expect } from '@playwright/test'
import { loadEnvFiles, getEnvVar } from '../../src/test-utils/autoqa-env'

loadEnvFiles()

const baseUrl = getEnvVar('AUTOQA_BASE_URL')
const password = getEnvVar('AUTOQA_PASSWORD')
const username = getEnvVar('AUTOQA_USERNAME')

test('saucedemo 03 cart', async ({ page }) => {
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
  // Step 6: (Optional) Open the left menu (hamburger/menu button)
  await page.locator('#react-burger-menu-btn').click();
  // Step 7: (Optional) Click "Reset App State"
  await page.locator('#reset_sidebar_link').click();
  // Step 8: Verify the cart badge is not shown (or shows 0)
  const locator8_1 = page.getByText('Add to cart');
  await expect(locator8_1.nth(0)).toBeVisible();
  const locator8_2 = page.locator('#add-to-cart-sauce-labs-backpack');
  await expect(locator8_2).toHaveCount(1);
  await expect(locator8_2).toBeVisible();
  // Step 9: Click "Add to cart" for any product
  await page.locator('#add-to-cart-sauce-labs-backpack').click();
  // Step 10: Verify the button for that product changes to "Remove"
  const locator10_1 = page.getByText('Remove');
  await expect(locator10_1.nth(0)).toBeVisible();
  // Step 11: Verify the cart icon badge count becomes 1
  const locator11_1 = page.getByText('1');
  await expect(locator11_1.nth(0)).toBeVisible();
  // Step 12: Click "Add to cart" for another product
  await page.locator('#add-to-cart-sauce-labs-bike-light').click();
  // Step 13: Verify the cart icon badge count becomes 2
  const locator13_1 = page.getByText('2');
  await expect(locator13_1.nth(0)).toBeVisible();
  // Step 14: Click the cart icon
  await page.locator('[data-test="shopping-cart-badge"]').click();
  // Step 15: Verify the cart page shows "Your Cart" and lists the selected products
  const locator15_1 = page.getByText('Your Cart');
  await expect(locator15_1.nth(0)).toBeVisible();
  const locator15_2 = page.getByText('Sauce Labs Backpack');
  await expect(locator15_2.nth(0)).toBeVisible();
  const locator15_3 = page.getByText('Sauce Labs Bike Light');
  await expect(locator15_3.nth(0)).toBeVisible();
  // Step 16: Click "Remove" for one of the items in the cart
  await page.locator('#remove-sauce-labs-bike-light').click();
  // Step 17: Verify the removed item disappears from the cart list
  const locator17_1 = page.getByText('Sauce Labs Backpack');
  await expect(locator17_1.nth(0)).toBeVisible();
  // Step 18: Verify the cart icon badge count decreases by 1
  const locator18_1 = page.getByText('1');
  await expect(locator18_1.nth(0)).toBeVisible();
  // Step 19: Click "Continue Shopping"
  await page.locator('#continue-shopping').click();
  // Step 20: Verify the user returns to the inventory/products page
  const locator20_1 = page.getByText('Products');
  await expect(locator20_1.nth(0)).toBeVisible();
})
