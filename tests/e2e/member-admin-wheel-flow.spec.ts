import { expect, test } from "@playwright/test";

function nextWeekdayDateString(daysAhead = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test("會員預約 -> 後台完成 -> 前台抽輪盤", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  test.skip(!email || !password, "需設定 E2E_USER_EMAIL / E2E_USER_PASSWORD");

  const bookingName = `PW-E2E-${Date.now()}`;
  await page.goto("/");

  // 前台會員登入
  await page.getByRole("button", { name: "會員登入" }).click();
  await expect(page.getByRole("heading", { name: "會員登入／註冊" })).toBeVisible();
  await page.getByRole("textbox", { name: /^Email$/ }).fill(email!);
  await page.getByLabel("密碼").first().fill(password!);
  await page.getByRole("dialog").getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("button", { name: "會員中心" })).toBeVisible();

  // 建立會員現金預約（避免依賴儲值餘額）
  await page.getByRole("textbox", { name: /姓名/ }).fill(bookingName);
  await page.getByRole("textbox", { name: /日期（週一至週五）/ }).fill(nextWeekdayDateString());
  const startTime = page.getByRole("combobox", { name: /開始時間（15 分鐘一格）/ });
  await expect(startTime).toBeEnabled();
  const chosen = await startTime.evaluate((el) => {
    const select = el as HTMLSelectElement;
    for (const option of Array.from(select.options)) {
      if (!option.value || option.disabled) continue;
      return option.value;
    }
    return null;
  });
  expect(chosen).not.toBeNull();
  await startTime.selectOption(chosen!);
  await page.getByRole("combobox", { name: /付款方式/ }).selectOption("member_cash");
  await page.getByRole("textbox", { name: /備註（選填）/ }).fill("E2E 流程測試");
  await page.getByRole("button", { name: "送出預約" }).click();
  await page.getByRole("button", { name: "確認送出" }).click();
  await expect(page.getByText("已送出！狀態為「待確認」")).toBeVisible();

  // 切到後台，將該筆預約改為已完成（觸發抽獎次數 +1）
  await page.goto("/admin");
  await expect(page.getByText("已登入：")).toBeVisible();
  const row = page.locator("tr", { hasText: bookingName }).first();
  await expect(row).toBeVisible();
  await row.getByRole("combobox").selectOption("done");
  await expect(page.getByText("已更新")).toBeVisible();

  // 回前台抽輪盤，驗證可抽與結果顯示
  await page.goto("/");
  await expect(page.getByRole("button", { name: "抽輪盤" })).toBeEnabled();
  await page.getByRole("button", { name: "抽輪盤" }).click();
  await expect(page.getByText("抽獎完成！")).toBeVisible();
  await expect(page.getByText("抽中：")).toBeVisible();
});
