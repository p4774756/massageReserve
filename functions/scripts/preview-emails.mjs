#!/usr/bin/env node
/**
 * 產生通知信 HTML 預覽檔，可用瀏覽器直接開啟。
 *
 * 在 functions 目錄執行：
 *   npm run preview:emails
 *
 * 完成後開啟：
 *   email-previews/index.html
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBroadcastEmailHtml, buildNotifyEmailHtml } from "../lib/resendNotify.js";
import { formatDateKeyWithWeekdayZh } from "../lib/bookingLogic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "email-previews");

const dateKey = "2026-05-26";
const dateLabel = formatDateKeyWithWeekdayZh(dateKey);
/** 本機預覽：相對路徑指向 repo `public/media/email-logo.png` */
const previewLogoSrc = "../../public/media/email-logo.png";

const samples = [
  {
    file: "new-booking.html",
    label: "新預約通知（店主）",
    html: buildNotifyEmailHtml({
      title: "新預約通知",
      logoSrc: previewLogoSrc,
      introLines: ["有新的按摩預約，請至管理後台查看。"],
      rows: [
        { label: "預約編號", value: "preview-abc123" },
        { label: "姓名", value: "王小明", emphasize: true },
        { label: "日期", value: dateLabel },
        { label: "開始時間", value: "14:00" },
        { label: "付款方式", value: "會員｜次數扣 1 次" },
        { label: "備註", value: "肩頸較緊" },
      ],
      footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
    }),
  },
  {
    file: "status-update.html",
    label: "預約狀態更新（會員）",
    html: buildNotifyEmailHtml({
      title: "預約狀態更新",
      logoSrc: previewLogoSrc,
      greeting: "王小明 您好，",
      introLines: ["您在按摩預約系統中的預約狀態已更新。"],
      rows: [
        { label: "日期", value: dateLabel },
        { label: "開始時間", value: "14:00" },
        { label: "狀態", value: "待確認 → 已確認", emphasize: true },
        { label: "店家留言", value: "請提早 5 分鐘到達。" },
      ],
      outroLines: ["如有疑問請與店家聯繫。"],
      footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
    }),
  },
  {
    file: "status-test.html",
    label: "預約狀態通知（測試信）",
    html: buildNotifyEmailHtml({
      title: "預約狀態通知（測試）",
      logoSrc: previewLogoSrc,
      testBanner: true,
      greeting: "王小明 您好，",
      introLines: [
        "此信由管理員在後台寄出，您的預約狀態不會因此改變。",
        "以下為範例文案，用於確認信箱能否收到、版面是否正常。",
      ],
      rows: [
        { label: "日期", value: dateLabel },
        { label: "開始時間", value: "14:00" },
        { label: "狀態（僅示範）", value: "待確認 → 已確認", emphasize: true },
      ],
      outroLines: ["如有疑問請與店家聯繫。"],
      footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
    }),
  },
  {
    file: "broadcast.html",
    label: "店家群發",
    html: buildBroadcastEmailHtml("您好，\n\n下週三公休，當日預約將由系統取消，敬請見諒。\n\n謝謝。", previewLogoSrc),
  },
];

mkdirSync(outDir, { recursive: true });

for (const s of samples) {
  writeFileSync(join(outDir, s.file), s.html, "utf8");
}

const indexHtml = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>通知信預覽</title>
<style>
body { font-family: system-ui, sans-serif; margin: 24px; line-height: 1.5; }
h1 { font-size: 1.25rem; }
ul { padding-left: 1.25rem; }
code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
p.note { color: #555; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>按摩預約 — 通知信預覽</h1>
<p class="note">由 <code>npm run preview:emails</code> 產生；修改版型後請重新執行。</p>
<ul>
${samples.map((s) => `  <li><a href="${s.file}">${s.label}</a></li>`).join("\n")}
</ul>
</body>
</html>
`;

writeFileSync(join(outDir, "index.html"), indexHtml, "utf8");

console.log("已寫入預覽檔：");
for (const s of samples) {
  console.log(`  ${join(outDir, s.file)}`);
}
console.log(`  ${join(outDir, "index.html")}`);
console.log("\n請用瀏覽器開啟 index.html（可直接雙擊檔案）。");
