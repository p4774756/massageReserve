import { expect, test } from "@playwright/test";

function nextWeekdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("送出預約前會顯示確認摘要視窗", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  test.skip(!email || !password, "需設定 E2E_USER_EMAIL / E2E_USER_PASSWORD");

  await page.goto("/");

  await page.getByRole("button", { name: "會員登入" }).click();
  await expect(page.getByRole("heading", { name: "會員登入" })).toBeVisible();
  await page.getByRole("textbox", { name: /^Email$/ }).fill(email!);
  await page.getByLabel("密碼").first().fill(password!);
  await page.getByRole("button", { name: "會員登入" }).click();
  await expect(page.getByRole("button", { name: "會員中心" })).toBeVisible();

  await page.getByRole("textbox", { name: /姓名/ }).fill("Playwright 測試");
  await page.getByRole("textbox", { name: /日期（週一至週五）/ }).fill(nextWeekdayDateString());

  const startTime = page.getByRole("combobox", { name: /開始時間（30 分鐘一格）/ });
  await expect(startTime).toBeEnabled();
  const chosen = await startTime.evaluate((el) => {
    const select = el as HTMLSelectElement;
    for (const option of Array.from(select.options)) {
      if (!option.value) continue;
      if (option.disabled) continue;
      return option.value;
    }
    return null;
  });
  expect(chosen).not.toBeNull();
  await startTime.selectOption(chosen!);

  await page.getByRole("combobox", { name: /付款方式/ }).selectOption("member_cash");
  await page.getByRole("textbox", { name: /備註（選填）/ }).fill("背部痠痛，請加強按壓");
  await page.getByRole("button", { name: "送出預約" }).click();

  await expect(page.getByRole("heading", { name: "確認送出預約" })).toBeVisible();
  await expect(page.locator(".modal-message")).toContainText("姓名：Playwright 測試");
  await expect(page.locator(".modal-message")).toContainText("付款方式：會員現金");
  await expect(page.locator(".modal-message")).toContainText("備註：背部痠痛，請加強按壓");

  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByText("已取消送出。")).toBeVisible();
});
