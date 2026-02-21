import { test, expect } from "@playwright/test";

test.describe("Plan Review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".plan-viewer");
  });

  test("page loads and shows plan title from mock data", async ({ page }) => {
    const title = page.locator(".toolbar-title");
    await expect(title).toContainText("Refactor Authentication System");
  });

  test("all block types render", async ({ page }) => {
    // Headings
    await expect(page.locator(".block.heading").first()).toBeVisible();
    // Code blocks
    await expect(page.locator(".block.code").first()).toBeVisible();
    // Lists
    await expect(page.locator(".block.list").first()).toBeVisible();
    // Tables
    await expect(page.locator(".block.table").first()).toBeVisible();
    // Blockquotes
    await expect(page.locator(".block.blockquote").first()).toBeVisible();
    // Paragraphs
    await expect(page.locator(".block.paragraph").first()).toBeVisible();
  });

  test("text selection shows Add Comment popup", async ({ page }) => {
    const paragraph = page.locator(".block.paragraph").first();

    // Programmatically select text within the paragraph, then trigger mouseup
    await paragraph.evaluate((el) => {
      const textNode = el.querySelector("p")?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(10, textNode.textContent!.length));
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    // Dispatch mouseup on the block to trigger the Svelte handler
    await paragraph.dispatchEvent("mouseup");

    const popup = page.locator(".popup-btn");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("Add Comment");
  });

  test("add comment via selection popup creates inline comment", async ({
    page,
  }) => {
    const paragraph = page.locator(".block.paragraph").first();

    // Programmatically select text
    await paragraph.evaluate((el) => {
      const textNode = el.querySelector("p")?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(10, textNode.textContent!.length));
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await paragraph.dispatchEvent("mouseup");

    await page.locator(".popup-btn").click();

    // Inline comment editor should appear
    const commentInput = page.locator(".comment-input");
    await expect(commentInput).toBeVisible();

    // Type and save
    await commentInput.fill("This needs clarification");
    await page.locator(".action-btn.save").click();

    // Comment body should be visible
    const commentBody = page.locator(".comment-body");
    await expect(commentBody).toContainText("This needs clarification");

    // Edit and Delete buttons visible
    await expect(page.locator(".action-btn.edit")).toBeVisible();
    await expect(page.locator(".action-btn.delete")).toBeVisible();
  });

  test("hover block shows + button in gutter", async ({ page }) => {
    const block = page.locator(".block").first();
    const addBtn = block.locator(".add-comment-btn");

    // Before hover, button is hidden (opacity: 0)
    await expect(addBtn).toHaveCSS("opacity", "0");

    await block.hover();

    // After hover, button becomes visible
    await expect(addBtn).toHaveCSS("opacity", "1");
  });

  test("click + button opens inline comment editor", async ({ page }) => {
    const block = page.locator(".block").first();
    await block.hover();
    await block.locator(".add-comment-btn").click();

    const commentInput = page.locator(".comment-input");
    await expect(commentInput).toBeVisible();
  });

  test("save comment via + button", async ({ page }) => {
    const block = page.locator(".block").nth(1);
    await block.hover();
    await block.locator(".add-comment-btn").click();

    const commentInput = page.locator(".comment-input");
    await commentInput.fill("Block-level comment");
    await page.locator(".action-btn.save").click();

    await expect(page.locator(".comment-body")).toContainText(
      "Block-level comment",
    );
  });

  test("delete comment removes it", async ({ page }) => {
    // Add a comment first
    const block = page.locator(".block").first();
    await block.hover();
    await block.locator(".add-comment-btn").click();
    await page.locator(".comment-input").fill("Temporary comment");
    await page.locator(".action-btn.save").click();
    await expect(page.locator(".comment-body")).toBeVisible();

    // Delete it
    await page.locator(".action-btn.delete").click();
    await expect(page.locator(".comment-body")).not.toBeVisible();
  });

  test("general feedback textarea accepts input", async ({ page }) => {
    const textarea = page.locator(".general-comment-input");
    await expect(textarea).toBeVisible();
    await textarea.fill("Overall this looks reasonable");
    await expect(textarea).toHaveValue("Overall this looks reasonable");
  });

  test("Approve button sends POST /api/approve", async ({ page }) => {
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes("/api/approve")),
      page.locator(".btn-approve").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData).toHaveProperty("feedback");
  });

  test("Request Changes button sends POST /api/deny", async ({ page }) => {
    // Add general feedback first
    await page.locator(".general-comment-input").fill("Please revise step 2");

    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes("/api/deny")),
      page.locator(".btn-deny").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData).toHaveProperty("feedback");
  });
});
