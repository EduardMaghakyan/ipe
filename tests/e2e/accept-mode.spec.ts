import { test, expect } from "@playwright/test";

test.describe("Accept Mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".plan-viewer-container");
  });

  test("accept modes panel is visible when approve is selected", async ({
    page,
  }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // Accept modes section is visible (approve is default when no comments)
    const acceptModes = page.locator(".accept-modes");
    await expect(acceptModes).toBeVisible();

    // Both options are visible
    await expect(
      acceptModes.locator(".radio-label", {
        hasText: "Approve, manually approve edits",
      }),
    ).toBeVisible();
    await expect(
      acceptModes.locator(".radio-label", {
        hasText: "Approve, auto-accept edits",
      }),
    ).toBeVisible();

    // "normal" is selected by default
    await expect(
      acceptModes.locator('input[type="radio"][value="normal"]'),
    ).toBeChecked();
  });

  test("accept modes panel is hidden when Request changes is selected", async ({
    page,
  }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // Switch to deny
    await page.locator('input[type="radio"][value="deny"]').check();
    await expect(page.locator(".accept-modes")).not.toBeVisible();

    // Switch back to approve — accept modes reappear
    await page.locator('input[type="radio"][value="approve"]').check();
    await expect(page.locator(".accept-modes")).toBeVisible();
  });

  test("normal accept sends acceptMode in POST body", async ({ page }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/approve") &&
          req.url().includes("/api/sessions/"),
      ),
      page.locator(".btn-submit.approve").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData.acceptMode).toBe("normal");
  });

  test("auto-approve mode sends acceptMode in POST body", async ({ page }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // Select auto-approve
    await page
      .locator('.accept-modes input[type="radio"][value="auto-approve"]')
      .check();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/approve") &&
          req.url().includes("/api/sessions/"),
      ),
      page.locator(".btn-submit.approve").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData.acceptMode).toBe("auto-approve");
  });

  test("acceptMode is not sent when denying", async ({ page }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // Select approve + auto-approve first
    await page
      .locator('.accept-modes input[type="radio"][value="auto-approve"]')
      .check();

    // Switch to deny
    await page.locator('input[type="radio"][value="deny"]').check();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/deny") && req.url().includes("/api/sessions/"),
      ),
      page.locator(".btn-submit").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData.acceptMode).toBeUndefined();
  });

  test("Cmd+Enter sends selected accept mode", async ({ page }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // Select auto-approve
    await page
      .locator('.accept-modes input[type="radio"][value="auto-approve"]')
      .check();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/approve") &&
          req.url().includes("/api/sessions/"),
      ),
      page.keyboard.press("Meta+Enter"),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData.acceptMode).toBe("auto-approve");
  });
});

test.describe("Accept Mode - Diff Review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".session-tab", { hasText: "Diff Review" }).click();
    await page.waitForSelector(".diff-review-layout");
  });

  test("accept modes panel is visible in diff review", async ({ page }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    await expect(page.locator(".accept-modes")).toBeVisible();

    // Both options present
    const acceptModes = page.locator(".accept-modes");
    await expect(acceptModes.locator('input[value="normal"]')).toBeVisible();
    await expect(
      acceptModes.locator('input[value="auto-approve"]'),
    ).toBeVisible();
  });

  test("auto-approve mode sends acceptMode in POST body for diff review", async ({
    page,
  }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // Select auto-approve
    await page
      .locator('.accept-modes input[type="radio"][value="auto-approve"]')
      .check();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/approve") &&
          req.url().includes("/api/sessions/"),
      ),
      page.locator(".btn-submit.approve").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData.acceptMode).toBe("auto-approve");
  });
});
