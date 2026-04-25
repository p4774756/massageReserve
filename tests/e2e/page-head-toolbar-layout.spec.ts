import { expect, test } from "@playwright/test";

test.describe("頁首工具列（音樂／語言／登入）", () => {
  test("視窗寬 720px 時工具列為兩欄 grid（音樂 | 語言＋登入直向）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const toolbar = page.locator(".page-head-toolbar");
    await expect(toolbar).toBeVisible();
    const display = await toolbar.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("grid");
  });

  test("視窗 620px 時右欄仍為直向（語言在上），不因 max-width:640px 誤設成橫排", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 620, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const aside = page.locator(".head-toolbar-aside");
    await expect(aside).toBeVisible();
    const asideDir = await aside.evaluate((el) => getComputedStyle(el).flexDirection);
    expect(asideDir).toBe("column");
  });

  test("視窗寬 400px 時工具列為直向 flex", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const toolbar = page.locator(".page-head-toolbar");
    await expect(toolbar).toBeVisible();
    const display = await toolbar.evaluate((el) => getComputedStyle(el).display);
    const flexDir = await toolbar.evaluate((el) => getComputedStyle(el).flexDirection);
    expect(display).toBe("flex");
    expect(flexDir).toBe("column");
  });
});
