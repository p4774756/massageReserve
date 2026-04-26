import { expect, test } from "@playwright/test";

test.describe("頁首標題列（標題與語言／會員）", () => {
  test("視窗寬 720px 時標題與工具列同一 flex 橫列", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const topRow = page.locator(".page-head-top-row");
    await expect(topRow).toBeVisible();
    const display = await topRow.evaluate((el) => getComputedStyle(el).display);
    const flexDir = await topRow.evaluate((el) => getComputedStyle(el).flexDirection);
    expect(display).toBe("flex");
    expect(flexDir).toBe("row");
  });

  test("視窗 620px 時語系／會員區仍為橫向（與標題同列設計）", async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const aside = page.locator(".page-head-top-row .head-toolbar-aside");
    await expect(aside).toBeVisible();
    const asideDir = await aside.evaluate((el) => getComputedStyle(el).flexDirection);
    expect(asideDir).toBe("row");
  });

  test("視窗寬 400px 時標題列可換行且仍為 flex", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const topRow = page.locator(".page-head-top-row");
    await expect(topRow).toBeVisible();
    const display = await topRow.evaluate((el) => getComputedStyle(el).display);
    const flexWrap = await topRow.evaluate((el) => getComputedStyle(el).flexWrap);
    expect(display).toBe("flex");
    expect(flexWrap).toBe("wrap");
  });
});
