# 辦公室按摩預約（Firebase）

匿名預約（姓名＋日期＋開始時間＋備註），規則由 **Cloud Functions** 強制執行：

- 僅 **週一～週五**，**08:00–17:30** 開始、每 **30 分鐘**一格，預估 **30 分鐘**（結束不晚於 **18:00**，`Asia/Taipei`）。
- **同一天最多 2 筆**、**同一工作週最多 4 筆**（`cancelled` 不計入）。
- **管理員** 以 Email/密碼登入後，可於 Firestore 讀取列表並更新 `status`。
- 首頁支援「跑馬燈公告」，管理員可在後台編輯 `siteSettings/announcement`。

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

- `src/`：Vite 前端（預約表單＋管理分頁）。
- `functions/`：`getAvailability`、`createBooking`（`invoker: public`，供未登入呼叫）。
- `firestore.rules`：僅 `admins/{uid}` 可讀取預約；僅能更新 `status` / `updatedAt`；公告設定提供公開讀取、管理員可寫入。
