import { test, expect } from "@playwright/test";

test.describe("Theme Toggle", () => {
  test("default theme is dark", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("ipe-theme"));
    await page.goto("/");
    await page.waitForSelector(".plan-viewer");

    const theme = await page.locator("html").getAttribute("data-theme");
    expect(theme).toBe("dark");
  });

  test("click toggle switches to light", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("ipe-theme"));
    await page.goto("/");
    await page.waitForSelector(".plan-viewer");

    await page.locator("[aria-label='Toggle theme']").click();
    const theme = await page.locator("html").getAttribute("data-theme");
    expect(theme).toBe("light");
  });

  test("theme persists after reload", async ({ page }) => {
    // Start clean
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("ipe-theme"));
    await page.reload();
    await page.waitForSelector(".plan-viewer");

    // Switch to light
    await page.locator("[aria-label='Toggle theme']").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Reload — no addInitScript clearing localStorage this time
    await page.reload();
    await page.waitForSelector(".plan-viewer");

    const theme = await page.locator("html").getAttribute("data-theme");
    expect(theme).toBe("light");
  });

  test("toggle back to dark", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("ipe-theme"));
    await page.goto("/");
    await page.waitForSelector(".plan-viewer");

    // Switch to light
    await page.locator("[aria-label='Toggle theme']").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Toggle back
    await page.locator("[aria-label='Toggle theme']").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
