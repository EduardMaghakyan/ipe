import { test, expect } from "@playwright/test";

test.describe("Diff Review", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Click the "Diff Review" tab to switch to the diff-review session
    await page.locator(".session-tab", { hasText: "Diff Review" }).click();
    await page.waitForSelector(".diff-review-layout");
  });

  test("page loads with diff review layout", async ({ page }) => {
    // Toolbar shows "Diff Review" title
    await expect(page.locator(".toolbar-title")).toContainText("Diff Review");

    // Diff mode toggle buttons are visible
    await expect(page.locator("button.mode-btn", { hasText: /^Unstaged$/ })).toBeVisible();
    await expect(page.locator("button.mode-btn", { hasText: /^Staged$/ })).toBeVisible();
    await expect(page.locator("button.mode-btn", { hasText: /^All$/ })).toBeVisible();

    // "Unstaged" is active by default
    await expect(
      page.locator("button.mode-btn", { hasText: /^Unstaged$/ }),
    ).toHaveClass(/active/);
  });

  test("file list shows all changed files with status indicators", async ({
    page,
  }) => {
    const fileItems = page.locator(".file-item");
    await expect(fileItems).toHaveCount(4);

    // Header shows file count
    await expect(page.locator(".file-list-header")).toContainText("4");

    // First file is selected by default
    await expect(fileItems.first()).toHaveClass(/selected/);

    // Status labels are shown (M for modified, A for added, D for deleted)
    const statuses = page.locator(".file-status");
    await expect(statuses.nth(0)).toContainText("M");
    await expect(statuses.nth(1)).toContainText("A");
    await expect(statuses.nth(3)).toContainText("D");
  });

  test("file list shows add/remove line counts", async ({ page }) => {
    // First file (modified) should show both + and - counts
    const firstFile = page.locator(".file-item").first();
    await expect(firstFile.locator(".stat-add")).toBeVisible();
    await expect(firstFile.locator(".stat-remove")).toBeVisible();
  });

  test("clicking a file in the sidebar shows its diff", async ({ page }) => {
    // Click the second file (errors.ts - added)
    const secondFile = page.locator(".file-item").nth(1);
    await secondFile.click();

    // Should become selected
    await expect(secondFile).toHaveClass(/selected/);

    // Diff viewer header shows the file path
    await expect(page.locator(".diff-file-header .file-path")).toContainText(
      "src/auth/errors.ts",
    );

    // All lines should be "add" type (new file)
    const addLines = page.locator(".line-add");
    expect(await addLines.count()).toBeGreaterThan(0);
    const removeLines = page.locator(".line-remove");
    expect(await removeLines.count()).toBe(0);
  });

  test("diff viewer renders hunk headers, add, remove, and context lines", async ({
    page,
  }) => {
    // First file (login.ts) is selected by default
    await expect(page.locator(".diff-file-header .file-path")).toContainText(
      "src/auth/login.ts",
    );

    // Hunk header
    await expect(page.locator(".hunk-header").first()).toBeVisible();

    // Add, remove, and context lines
    await expect(page.locator(".line-add").first()).toBeVisible();
    await expect(page.locator(".line-remove").first()).toBeVisible();
    await expect(page.locator(".line-context").first()).toBeVisible();

    // Line numbers are present
    await expect(page.locator(".old-no").first()).toBeVisible();
    await expect(page.locator(".new-no").first()).toBeVisible();
  });

  test("hover line shows + button", async ({ page }) => {
    // Find a diff line (not hunk header)
    const line = page.locator(".line-add").first();
    const addBtn = line.locator(".add-comment-btn");

    // Before hover, button is invisible (opacity 0)
    await expect(addBtn).not.toHaveClass(/visible/);

    // Hover the line
    await line.hover();

    // After hover, button becomes visible
    await expect(addBtn).toHaveClass(/visible/);
  });

  test("click + button creates inline comment editor", async ({ page }) => {
    const line = page.locator(".line-add").first();
    await line.hover();

    const addBtn = line.locator(".add-comment-btn");
    await addBtn.click();

    // Inline comment editor appears
    const commentInput = page.locator(".comment-input");
    await expect(commentInput).toBeVisible();
  });

  test("save inline comment on a diff line", async ({ page }) => {
    const line = page.locator(".line-add").first();
    await line.hover();
    await line.locator(".add-comment-btn").click();

    // Type and save
    const commentInput = page.locator(".comment-input");
    await commentInput.fill("This change looks wrong");
    await page.locator(".action-btn.save").click();

    // Comment body appears
    await expect(page.locator(".comment-body")).toContainText(
      "This change looks wrong",
    );

    // Edit and Delete buttons visible
    await expect(page.locator(".action-btn.edit")).toBeVisible();
    await expect(page.locator(".action-btn.delete")).toBeVisible();
  });

  test("delete inline comment removes it", async ({ page }) => {
    // Add a comment
    const line = page.locator(".line-add").first();
    await line.hover();
    await line.locator(".add-comment-btn").click();
    await page.locator(".comment-input").fill("Temp comment");
    await page.locator(".action-btn.save").click();
    await expect(page.locator(".comment-body")).toBeVisible();

    // Delete it
    await page.locator(".action-btn.delete").click();
    await expect(page.locator(".comment-body")).not.toBeVisible();
  });

  test("comment count badge appears in file list after adding comment", async ({
    page,
  }) => {
    // Initially no badges
    await expect(page.locator(".comment-badge")).not.toBeVisible();

    // Add a comment on a line
    const line = page.locator(".line-add").first();
    await line.hover();
    await line.locator(".add-comment-btn").click();
    await page.locator(".comment-input").fill("Review note");
    await page.locator(".action-btn.save").click();

    // Badge appears on the first file
    const badge = page.locator(".file-item").first().locator(".comment-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("1");
  });

  test("general feedback textarea accepts input", async ({ page }) => {
    // Open the review dropdown
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    const textarea = page.locator(".panel-textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill("Overall the changes look good");
    await expect(textarea).toHaveValue("Overall the changes look good");
  });

  test("Approve button sends POST to session approve endpoint", async ({
    page,
  }) => {
    // Open the review dropdown
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // "Approve" radio is selected by default (no comments)
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

  test("Request Changes button sends POST to session deny endpoint", async ({
    page,
  }) => {
    // Add a comment first so deny is auto-selected
    const line = page.locator(".line-add").first();
    await line.hover();
    await line.locator(".add-comment-btn").click();
    await page.locator(".comment-input").fill("Please fix this");
    await page.locator(".action-btn.save").click();

    // Open dropdown — "Request changes" should be auto-selected due to comment
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/deny") && req.url().includes("/api/sessions/"),
      ),
      page.locator(".btn-submit").click(),
    ]);
    expect(request.method()).toBe("POST");
    const postData = request.postDataJSON();
    expect(postData.feedback).toContain("Please fix this");
  });

  test("submit button shows 'Approve' not 'Accept plan'", async ({ page }) => {
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();

    // The approve radio label should say "Approve"
    const approveLabel = page.locator(".radio-label").first();
    await expect(approveLabel).toContainText("Approve");
    await expect(approveLabel).not.toContainText("Accept plan");

    // The submit button should say "Approve"
    const submitBtn = page.locator(".btn-submit");
    await expect(submitBtn).toContainText("Approve");
  });

  test("comments persist after switching files and back", async ({ page }) => {
    // Add a comment on first file
    const line = page.locator(".line-add").first();
    await line.hover();
    await line.locator(".add-comment-btn").click();
    await page.locator(".comment-input").fill("First file comment");
    await page.locator(".action-btn.save").click();
    await expect(page.locator(".comment-body")).toContainText(
      "First file comment",
    );

    // Switch to second file
    await page.locator(".file-item").nth(1).click();
    await expect(page.locator(".diff-file-header .file-path")).toContainText(
      "src/auth/errors.ts",
    );

    // Switch back to first file
    await page.locator(".file-item").first().click();

    // Comment should still be there
    await expect(page.locator(".comment-body")).toContainText(
      "First file comment",
    );
  });

  test("draft is saved to localStorage", async ({ page }) => {
    // Add inline comment
    const line = page.locator(".line-add").first();
    await line.hover();
    await line.locator(".add-comment-btn").click();
    await page.locator(".comment-input").fill("Draft comment");
    await page.locator(".action-btn.save").click();
    await expect(page.locator(".comment-body")).toContainText("Draft comment");

    // Add general feedback
    await page.locator(".btn-trigger").click();
    await expect(page.locator(".dropdown-panel")).toBeVisible();
    await page.locator(".panel-textarea").fill("General draft note");
    await page.keyboard.press("Escape");

    // Verify localStorage was written
    const draft = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("ipe-diff-draft-"),
      );
      return key ? JSON.parse(localStorage.getItem(key)!) : null;
    });
    expect(draft).not.toBeNull();
    expect(draft.annotations.length).toBe(1);
    expect(draft.annotations[0].comment).toBe("Draft comment");
    expect(draft.generalComment).toBe("General draft note");
  });

  test("deleted file shows all lines as removed", async ({ page }) => {
    // Click the last file (deleted)
    await page.locator(".file-item").last().click();

    // File header shows the path
    await expect(page.locator(".diff-file-header .file-path")).toContainText(
      "src/legacy/old-auth.ts",
    );

    // All diff lines should be remove type
    const removeLines = page.locator(".line-remove");
    expect(await removeLines.count()).toBeGreaterThan(0);
    const addLines = page.locator(".line-add");
    expect(await addLines.count()).toBe(0);
  });
});
