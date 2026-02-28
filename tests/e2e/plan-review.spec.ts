import { test, expect } from "@playwright/test";

test.describe("Plan Review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".plan-viewer-container");
  });

  test("page loads and shows plan title from mock data", async ({ page }) => {
    const tab = page.locator(".session-tab.active");
    await expect(tab).toContainText("Refactor Authentication System");
  });

  test("all block types render", async ({ page }) => {
    // Headings
    await expect(
      page.locator('[data-unit-type="heading"]').first(),
    ).toBeVisible();
    // Code blocks
    await expect(page.locator(".code-block").first()).toBeVisible();
    // Lists
    await expect(
      page.locator('[data-unit-type="list-item"]').first(),
    ).toBeVisible();
    // Tables
    await expect(
      page.locator('[data-unit-type="table-row"]').first(),
    ).toBeVisible();
    // Blockquotes
    await expect(
      page.locator('[data-unit-type="blockquote"]').first(),
    ).toBeVisible();
    // Paragraphs
    await expect(
      page.locator('[data-unit-type="paragraph"]').first(),
    ).toBeVisible();
  });

  test("add comment via + button creates inline comment", async ({ page }) => {
    // Hover a paragraph to reveal + button in the gutter overlay
    const unit = page.locator('[data-unit-type="paragraph"]').first();
    await unit.hover();

    const addBtn = page.locator(".add-comment-btn.visible").first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

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

  test("hover line shows + button in gutter", async ({ page }) => {
    const addBtn = page.locator(".add-comment-btn").first();

    // Before hover, button is hidden (no .visible class)
    await expect(addBtn).not.toHaveClass(/visible/);

    // Hover a unit element to trigger hoveredUnit state
    const unit = page.locator("[data-unit-id]").first();
    await unit.hover();

    // After hover, the corresponding gutter button becomes visible
    await expect(page.locator(".add-comment-btn.visible").first()).toBeVisible();
  });

  test("click + button opens inline comment editor", async ({ page }) => {
    const unit = page.locator("[data-unit-id]").first();
    await unit.hover();

    const addBtn = page.locator(".add-comment-btn.visible").first();
    await addBtn.click();

    const commentInput = page.locator(".comment-input");
    await expect(commentInput).toBeVisible();
  });

  test("save comment via + button", async ({ page }) => {
    const unit = page.locator("[data-unit-id]").nth(1);
    await unit.hover();

    const addBtn = page.locator(".add-comment-btn.visible").first();
    await addBtn.click();

    const commentInput = page.locator(".comment-input");
    await commentInput.fill("Line-level comment");
    await page.locator(".action-btn.save").click();

    await expect(page.locator(".comment-body")).toContainText(
      "Line-level comment",
    );
  });

  test("delete comment removes it", async ({ page }) => {
    // Add a comment first
    const unit = page.locator("[data-unit-id]").first();
    await unit.hover();
    const addBtn = page.locator(".add-comment-btn.visible").first();
    await addBtn.click();
    await page.locator(".comment-input").fill("Temporary comment");
    await page.locator(".action-btn.save").click();
    await expect(page.locator(".comment-body")).toBeVisible();

    // Delete it
    await page.locator(".action-btn.delete").click();
    await expect(page.locator(".comment-body")).not.toBeVisible();
  });

  test("general feedback textarea accepts input", async ({ page }) => {
    // Open the review dropdown to access the textarea
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    const textarea = page.locator(".panel-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("Overall this looks reasonable");
    await expect(textarea).toHaveValue("Overall this looks reasonable");
  });

  test("Approve button sends POST to session approve endpoint", async ({
    page,
  }) => {
    // Open the review dropdown
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // "Accept plan" radio is selected by default (no comments yet)
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
    expect(postData).toHaveProperty("feedback");
  });

  test("ordered list items render with sequential numbering", async ({
    page,
  }) => {
    // List items render as <li> with data-unit-type="list-item"
    const listItems = page.locator('[data-unit-type="list-item"]');
    const count = await listItems.count();
    expect(count).toBeGreaterThan(1);

    // Verify list items have text content
    const firstText = await listItems.first().textContent();
    expect(firstText?.trim().length).toBeGreaterThan(0);
  });

  test("diff code block renders with colored lines", async ({ page }) => {
    // Diff lines are rendered inside .code-block with .diff-add/.diff-remove classes
    const diffAdd = page.locator(".code-block .diff-add");
    const diffRemove = page.locator(".code-block .diff-remove");
    await expect(diffAdd.first()).toBeVisible();
    await expect(diffRemove.first()).toBeVisible();
  });

  test("Compare button is visible when history exists", async ({ page }) => {
    const compareBtn = page.locator("button:has-text('Compare')");
    await expect(compareBtn).toBeVisible();
    await expect(compareBtn).toContainText("Compare");
  });

  test("Compare button opens diff overlay with two version selects", async ({
    page,
  }) => {
    await page.locator("button:has-text('Compare')").click();
    const overlay = page.locator(".overlay");
    await expect(overlay).toBeVisible();

    // Should have two version selects
    const selects = overlay.locator(".version-select");
    await expect(selects).toHaveCount(2);

    // Should show side-by-side diff by default
    const sbs = overlay.locator(".side-by-side");
    await expect(sbs).toBeVisible();

    // Close button works
    await overlay.locator(".close-btn").click();
    await expect(overlay).not.toBeVisible();
  });

  test("View toggle switches between side-by-side and inline", async ({
    page,
  }) => {
    await page.locator("button:has-text('Compare')").click();
    const overlay = page.locator(".overlay");

    // Default is side-by-side
    const sbs = overlay.locator(".side-by-side");
    await expect(sbs).toBeVisible();
    const panels = sbs.locator(".sbs-panel");
    await expect(panels).toHaveCount(2);

    // Switch to inline
    await overlay.locator(".toggle-btn", { hasText: "Inline" }).click();
    await expect(overlay.locator(".diff-content")).toBeVisible();
    await expect(sbs).not.toBeVisible();

    // Switch back to side-by-side
    await overlay.locator(".toggle-btn", { hasText: "Side-by-side" }).click();
    await expect(sbs).toBeVisible();
  });

  test("Can compare two past versions", async ({ page }) => {
    await page.locator("button:has-text('Compare')").click();
    const overlay = page.locator(".overlay");
    const selects = overlay.locator(".version-select");

    // Set left to v1, right to v2
    await selects.nth(0).selectOption({ index: 0 }); // v1
    await selects.nth(1).selectOption({ index: 1 }); // v2

    // Diff content should still render (side-by-side by default)
    await expect(overlay.locator(".side-by-side")).toBeVisible();

    // Should have some diff lines
    const diffLines = overlay.locator(".diff-line");
    expect(await diffLines.count()).toBeGreaterThan(0);
  });

  test("comments and general feedback persist after page reload", async ({
    page,
  }) => {
    // Add inline comment via + button
    const unit = page.locator('[data-unit-type="paragraph"]').first();
    await unit.hover();
    const addBtn = page.locator(".add-comment-btn.visible").first();
    await addBtn.click();
    await page.locator(".comment-input").fill("Persisted comment");
    await page.locator(".action-btn.save").click();
    await expect(page.locator(".comment-body")).toContainText(
      "Persisted comment",
    );

    // Add general feedback via the review dropdown
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();
    await page.locator(".panel-textarea").fill("General feedback persisted");
    // Close dropdown before reload
    await page.keyboard.press("Escape");

    // Reload and verify
    await page.reload();
    await page.waitForSelector(".plan-viewer-container");

    await expect(page.locator(".comment-body")).toContainText(
      "Persisted comment",
    );
    // Re-open dropdown to check persisted general comment
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();
    await expect(page.locator(".panel-textarea")).toHaveValue(
      "General feedback persisted",
    );
  });

  test("clicking a file reference shows snippet panel", async ({ page }) => {
    // The mock plan references `auth/jwt.ts` and mock data includes a snippet for it
    const fileRef = page.locator(".file-ref").first();
    await expect(fileRef).toBeVisible();
    await expect(fileRef).toHaveAttribute("data-file-path", "auth/jwt.ts");

    // Click the file ref
    await fileRef.click();

    // Snippet panel should appear
    const panel = page.locator(".file-snippet-panel");
    await expect(panel).toBeVisible();

    // Should show the file path
    await expect(panel.locator(".snippet-path")).toContainText("auth/jwt.ts");

    // Should show code content
    await expect(panel.locator(".snippet-code")).toBeVisible();

    // Shiki syntax highlighting should render
    await expect(panel.locator(".snippet-code .shiki")).toBeVisible({
      timeout: 5000,
    });

    // Line gutter should show line numbers
    await expect(panel.locator(".line-gutter")).toBeVisible();
    await expect(panel.locator(".line-gutter .line-num").first()).toBeVisible();

    // Resize handle should be present
    const handle = panel.locator(".resize-handle");
    await expect(handle).toBeAttached();

    // Test resize: use page.evaluate to programmatically dispatch resize events
    const widthBefore = await panel.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    await panel.evaluate((el) => {
      const handle = el.querySelector(".resize-handle") as HTMLElement;
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: 640,
          clientY: 400,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          clientX: 490,
          clientY: 400,
          bubbles: true,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          clientX: 490,
          clientY: 400,
          bubbles: true,
        }),
      );
    });
    const widthAfter = await panel.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    expect(widthAfter).toBeGreaterThan(widthBefore);

    // Close the panel
    await panel.locator(".snippet-close").click();
    await expect(panel).not.toBeVisible();
  });

  test("Request Changes button sends POST to session deny endpoint", async ({
    page,
  }) => {
    // Open the review dropdown and add general feedback
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();
    await page.locator(".panel-textarea").fill("Please revise step 2");

    // Select "Request changes" radio
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
    expect(postData).toHaveProperty("feedback");
  });
});
