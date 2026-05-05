import { expect, test } from "@playwright/test";

test.describe("頁首標題與工具列", () => {
  test("標題與語系／會員在同一列", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const topRow = page.locator(".page-head-top-row");
    await expect(topRow).toBeVisible();
    const topDisplay = await topRow.evaluate((el) => getComputedStyle(el).display);
    expect(topDisplay).toBe("flex");
    await expect(topRow.locator("h1")).toBeVisible();
    await expect(topRow.locator(".head-toolbar-aside")).toBeVisible();
    const h1Box = await topRow.locator("h1").boundingBox();
    const asideBox = await topRow.locator(".head-toolbar-aside").boundingBox();
    expect(h1Box && asideBox).toBeTruthy();
    if (h1Box && asideBox) {
      const rowTop = Math.min(h1Box.y, asideBox.y);
      const rowBottom = Math.max(h1Box.y + h1Box.height, asideBox.y + asideBox.height);
      expect(rowBottom - rowTop).toBeLessThan(Math.max(h1Box.height, asideBox.height) * 1.85);
    }
  });

  test("語系／會員區窄寬仍單列（flex-wrap: nowrap）", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");

    if ((await page.locator("header.page-head").count()) === 0) {
      test.skip(true, "未載入預約頁（例如尚未設定 Firebase）");
    }

    const aside = page.locator(".page-head-top-row .head-toolbar-aside");
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

    const line = page.locator(".page-head-top-row .page-head-session__line").first();
    await expect(line).toBeVisible();
    const ws = await line.evaluate((el) => getComputedStyle(el).whiteSpace);
    expect(ws).not.toBe("nowrap");
  });
});
