import { expect, test } from "@playwright/test";

test.describe("頁首標題與工具列", () => {
  test("標題獨立一列、語系／會員在下一列", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const titleRow = page.locator(".page-head-title-row");
    const controlsRow = page.locator(".page-head-controls-row");
    await expect(titleRow).toBeVisible();
    await expect(controlsRow).toBeVisible();
    const titleDisplay = await titleRow.evaluate((el) => getComputedStyle(el).display);
    const controlsDisplay = await controlsRow.evaluate((el) => getComputedStyle(el).display);
    expect(titleDisplay).toBe("block");
    expect(controlsDisplay).toBe("flex");
    await expect(titleRow.locator("h1")).toBeVisible();
    await expect(controlsRow.locator(".head-toolbar-aside")).toBeVisible();
  });

  test("語系／會員區窄寬仍單列（flex-wrap: nowrap）", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const aside = page.locator(".page-head-controls-row .head-toolbar-aside");
    await expect(aside).toBeVisible();
    const asideDir = await aside.evaluate((el) => getComputedStyle(el).flexDirection);
    const asideWrap = await aside.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(asideDir).toBe("row");
    expect(asideWrap).toBe("nowrap");
  });

  test("登入狀態字串可換行（非單行省略）", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const line = page.locator(".page-head-controls-row .page-head-session__line").first();
    await expect(line).toBeVisible();
    const ws = await line.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(ws).not.toBe("nowrap");
  });
});
