import { test, expect } from '@playwright/test'
import { loadEnvFiles, getEnvVar } from '../helpers/autoqa-env.js'

loadEnvFiles()

const baseUrl = getEnvVar('AUTOQA_BASE_URL')
const password = getEnvVar('AUTOQA_PASSWORD')
const username = getEnvVar('AUTOQA_USERNAME')

test('saucedemo 02 sorting', async ({ page }) => {
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
  // Step 6: Verify the inventory page shows a list of products, each with name/price and an "Add to cart" button
  const locator6_1 = page.getByText('Sauce Labs Backpack');
  await expect(locator6_1.nth(0)).toBeVisible();
  const locator6_2 = page.getByText('Add to cart');
  await expect(locator6_2.nth(0)).toBeVisible();
  // Step 7: Verify the sort dropdown is present (e.g. allows sorting by Name / Price)
  const locator7_1 = page.locator('[data-test="product-sort-container"]');
  await expect(locator7_1).toHaveCount(1);
  await expect(locator7_1).toBeVisible();
  const locator7_2 = page.getByText('Name (A to Z)');
  await expect(locator7_2.nth(0)).toBeVisible();
  // Step 8: Click the sort dropdown and select "Price (low to high)"
  await page.locator('[data-test="product-sort-container"]').click();
  // Step 9: Verify the product list is sorted by ascending price
  const locator9_1 = page.getByText('$7.99');
  await expect(locator9_1.nth(0)).toBeVisible();
  const locator9_2 = page.getByText('Sauce Labs Onesie');
  await expect(locator9_2.nth(0)).toBeVisible();
  // Step 10: Click the sort dropdown and select "Name (Z to A)"
  await page.locator('[data-test="product-sort-container"]').click();
  // Step 11: Verify the product list is sorted by name descending
  const locator11_1 = page.getByText('Test.allTheThings() T-Shirt (Red)');
  await expect(locator11_1.nth(0)).toBeVisible();
  const locator11_2 = page.getByText('Sauce Labs Backpack');
  await expect(locator11_2.nth(0)).toBeVisible();
})
