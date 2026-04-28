# 辦公室按摩預約（Firebase）

匿名預約（姓名＋日期＋開始時間＋備註），規則由 **Cloud Functions** 強制執行：

- 僅 **週一～週五**，**08:00–17:30** 開始、開始時間每 **15 分鐘**一格，單次服務約 **30 分鐘**（結束不晚於 **18:00**，`Asia/Taipei`）。
- **同一天最多 2 筆**、**同一工作週最多 4 筆**（`cancelled` 不計入）。
- **管理員** 以 Email/密碼登入後，可於 Firestore 讀取列表並更新 `status`。
- 首頁支援兩則跑馬燈（分開設定）：頂部文字 `siteSettings/marqueeText`、底部 LED `siteSettings/marqueeLed`（`text`、`enabled`；LED 另可選 `speed` 數字，像素／秒，後台以拉霸調整）。舊的 `siteSettings/announcement` 已不再使用，請在後台各別儲存兩項。

## 本機開發

1. 安裝依賴並建立環境變數：

   ```bash
   npm install
   cp .env.example .env
   ```

   將 `.env` 填入 Firebase Web 應用程式設定（`VITE_*`）。

2. 前端：

   ```bash
   npm run dev
   ```

3. Functions（可選，搭配 Emulator）：

   ```bash
   cd functions && npm install && npm run build
   ```

## Firebase 專案設定

1. 在 [Firebase Console](https://console.firebase.google.com/) 建立專案（或使用既有專案）。
2. 啟用 **Firestore**、**Authentication（Email/密碼）**、**Hosting**、**Functions**（Blaze 方案才能部署 Callable）。
3. 將 `.firebaserc` 的 `your-firebase-project-id` 改成你的 **Project ID**：

   ```bash
   npx -y firebase-tools@latest use --add <PROJECT_ID>
   ```

4. **管理員**：在 Authentication 建立你的帳號 → 複製該使用者的 **UID** → 在 Firestore 建立文件 `admins/<UID>`，內容可為 `{}`。

5. 部署：

   ```bash
   npm run build
   cd functions && npm run build && cd ..
   npx -y firebase-tools@latest deploy
   ```

   首次部署若提示缺少 **Composite Index**，可依錯誤連結在 Console 建立，或稍等 `firestore.indexes.json` 部署完成。

6. **Hosting 網域**：在 Firebase Console → Hosting / Authentication → 授權網域，加入你的正式網址（與本機 `localhost`）。

## GitHub Actions（選用）

在 Repo Secrets 新增 `FIREBASE_TOKEN`（本機執行 `npx -y firebase-tools@latest login:ci` 取得）。推送至 `main` 時 workflow 會建置並部署。

## 專案結構

- 架構與流程（含預約、錢包、輪盤、客服）：[`docs/architecture-and-flows.md`](docs/architecture-and-flows.md)。
- `src/`：Vite 前端（預約表單、會員中心、管理分頁；入口 `src/main.ts`，Firebase Callable 封裝 `src/firebase.ts`）。
- `functions/`：Cloud Functions 主程式 [`functions/src/index.ts`](functions/src/index.ts)；預約時段與上限規則 [`functions/src/bookingLogic.ts`](functions/src/bookingLogic.ts)；**Resend 寄信** [`functions/src/resendNotify.ts`](functions/src/resendNotify.ts)。
  - **Callable**（名稱與權限摘要見架構文件）：`getAvailability`、`recordSiteVisit`、`createBooking`、`getMyWallet`、`getAdminStatus`、`topupWallet`、`adjustSessionCreditsAdmin`、`grantDrawChancesAdmin`、`createMemberAccount`、`searchMemberUsers`、`listMembersAdmin`、`updateMemberNicknameAdmin`、`testSendMemberBookingStatusEmail`（依預約）、`testSendMemberStatusTestEmail`（依會員 UID）、`completeBooking`、`cancelBooking`、`listActiveWheelPrizes`、`spinWheel`、`seedWheelPrizes`、`sendSupportChatMessage`、`sendSupportChatAdminReply`、`setSupportThreadStatusAdmin`。
  - **Firestore 觸發器**（非 Callable）：`notifyMemberBookingStatusChange` — `bookings/{id}` 更新且 `status` 變更時，對會員預約寄送狀態通知信（訪客模式略過）。
- `firestore.rules`：僅 `admins/{uid}` 可讀取預約；管理員可更新 `status` / `updatedAt`（含軟刪除欄位），不開放硬刪除；公告設定提供公開讀取、管理員可寫入。

## 輪盤獎項初始化（必要）

可用腳本快速初始化：

```bash
# .env 須含 VITE_FIREBASE_* 與管理員帳密（同 Firestore admins/{uid}）
# SEED_WHEEL_ADMIN_EMAIL=…  SEED_WHEEL_ADMIN_PASSWORD=…
node --env-file=.env scripts/seed-wheel-prizes.mjs
```

若想手動建立，請在 Firestore 建立 `wheelPrizes` 文件（至少一筆 `active=true`），欄位範例：

- `name`: `+10 儲值金`
- `type`: `credit`（可用值：`credit` / `chance` / `thanks` / `penalty_text`）
- `value`: `10`
- `weight`: `20`
- `active`: `true`

## Playwright E2E（選用）

```bash
npm run test:e2e
```

若要跑完整「會員預約 -> 後台完成 -> 抽輪盤」流程，請先設定：

- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`

建議做法：

```bash
cp .env.e2e.example .env.e2e
npm run test:e2e:full
```
