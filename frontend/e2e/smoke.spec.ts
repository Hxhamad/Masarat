import { test, expect } from '@playwright/test';

test('app loads and shows FIR selection modal', async ({ page }) => {
  await page.goto('/');
  // The FIR selection modal should appear on first load (no saved FIRs)
  await expect(page.locator('.fir-modal')).toBeVisible({ timeout: 10_000 });
});

test('sidebar panel is present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.adsb-panel')).toBeVisible({ timeout: 10_000 });
});

test('map container renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
});
