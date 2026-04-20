# 按摩預約系統規劃（現金免登入 + 儲值需登入 + 輪盤）

## 1. 目標與前提

本規劃目標是建立一套可先上線的 MVP，支援：

- 單次按摩固定收費 `50` 元
- 可儲值（不送儲值回饋）
- 單次預約可免登入（現金交易）
- 儲值與餘額扣款需登入帳號
- 每次完成消費可抽輪盤
- 輪盤可有「輕處罰」，但不影響金流

已確認的營運規則：

- 儲值目前不做加贈
- 儲值餘額不設定到期
- 取消不扣款（若已扣款則全退）

---

## 2. 產品規則（MVP）

### 2.0 身分與付款模式

- 未登入使用者：可直接預約，付款方式為現金（或現場轉帳）
- 已登入使用者：可選擇現金付款，或使用儲值餘額扣款
- 儲值行為（加值、查餘額、扣款、退款）皆需有 `customerId`（登入身分）
- 不提供「未登入但可儲值」模式，避免餘額歸屬爭議

### 2.1 消費與付款

- 預約完成一次，費用固定為 `50`
- 先採「不混合支付」：  
  - 餘額 `>= 50`：扣錢包 `50`  
  - 餘額 `< 50`：整筆現金或轉帳 `50`

> 備註：混合支付可在後續版本加上（先扣錢包，不足再補現金）。

### 2.2 取消規則

- 取消預約不扣款
- 若該筆預約已從錢包扣款，取消時全額退回錢包

### 2.3 輪盤規則

- 每次「完成消費 50 元」發放 `1` 次抽獎機會
- 輪盤以獎勵為主，輕處罰為輔
- 處罰不得影響金流（不可扣錢、不可加價、不可取消既有權益）

---

## 3. 前台/後台顯示與操作

### 3.1 前台（客人端）

- 未登入：
  - 不顯示錢包餘額
  - 可進行預約與查看預約結果
  - 付款方式文案顯示「現金付款」
- 已登入：
  - 可查看自己的餘額與可抽次數
  - 可使用餘額扣款
  - 可顯示：預約成功、是否獲得抽獎機會、輪盤結果

### 3.2 後台（店家/員工）

- 可查詢顧客餘額與交易明細
- 以 `customerId` 或匿名識別碼查詢（如：系統碼、暱稱+手機末四碼）
- 無登入身分建立的單次現金預約，允許顯示為「訪客單」

### 3.3 可選擴充（半匿名自助查詢）

- 後續可加入 `lookupCode + PIN` 查餘額，不綁真實身份

---

## 4. Firestore 資料模型（建議）

## `customers/{customerId}`

- `displayName` (string)
- `anonCode` (string, 唯一匿名碼)
- `phoneLast4` (string, optional)
- `walletBalance` (number)
- `drawChances` (number)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## `bookings/{bookingId}`

- `customerId` (string, optional；訪客現金單可為 null)
- `bookingMode` (`guest_cash | member_cash | member_wallet`)
- `status` (`reserved | completed | cancelled`)
- `price` (number, 固定 50)
- `walletDeducted` (number, MVP 為 0 或 50)
- `paidCash` (number, MVP 為 0 或 50)
- `drawGranted` (boolean, 防止重複發抽獎次數)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## `walletTransactions/{txId}`

- `customerId` (string)
- `bookingId` (string, optional)
- `type` (`topup | charge | refund | adjust | prize_credit`)
- `amount` (number, 正負皆可)
- `note` (string, optional)
- `operatorId` (string)
- `createdAt` (timestamp)

## `wheelPrizes/{prizeId}`

- `name` (string)
- `type` (`credit | chance | thanks | penalty_text`)
- `value` (number)
- `weight` (number)
- `active` (boolean)
- `cooldownDays` (number, optional)
- `updatedAt` (timestamp)

## `wheelSpins/{spinId}`

- `customerId` (string)
- `bookingId` (string, optional)
- `prizeId` (string)
- `prizeSnapshot` (map, 保留抽中當下獎項內容)
- `operatorId` (string)
- `createdAt` (timestamp)

---

## 5. 核心流程（需 transaction 保證一致）

### 5.1 完成預約 `completeBooking(bookingId)`

1. 驗證 booking 狀態必須是 `reserved`
2. 依 `bookingMode` 決定付款方式：
   - `guest_cash` / `member_cash`：`paidCash=50`
   - `member_wallet`：讀取顧客餘額並扣款 `walletDeducted=50`
3. 在單一 transaction 內完成：
   - 更新 booking 為 `completed`
   - 若錢包扣款，新增 `walletTransactions(type=charge, amount=-50)` 並更新餘額
   - 若 `customerId` 存在且 `drawGranted=false`，顧客 `drawChances + 1` 並寫回 `drawGranted=true`

### 5.2 取消預約 `cancelBooking(bookingId)`

1. 驗證 booking 可取消
2. 若 `customerId` 存在且 `walletDeducted > 0`，於 transaction 內：
   - 新增 `walletTransactions(type=refund, amount=+walletDeducted)`
   - 回補 `walletBalance`
3. 更新 booking 狀態為 `cancelled`

### 5.3 抽輪盤 `spinWheel(customerId)`

1. 驗證 `drawChances >= 1`
2. transaction 內先扣 `drawChances - 1`
3. 依獎項 `weight` 抽一個有效獎項
4. 發獎：
   - `credit`：寫 `walletTransactions(type=prize_credit, amount=+value)` 並加餘額
   - `chance`：`drawChances + value`
   - `thanks/penalty_text`：僅記錄結果，不改金流
5. 寫入 `wheelSpins` 並保存 `prizeSnapshot`

---

## 6. 輪盤獎項初版（可直接上線）

建議初始權重（總權重 100）：

- `+10 儲值金`：20
- `+5 儲值金`：25
- `再抽一次`：15
- `銘謝惠顧`：30
- `小處罰文案`：10

處罰文案範例：

- 「今天手氣差一點，下一次更好！」
- 「神秘能量不足，請再接再厲！」

---

## 7. 權限與安全（MVP 必做）

- 前端不可直接寫入：
  - `walletBalance`
  - `drawChances`
  - 中獎結果
- 金流與中獎結果僅能由後端（Cloud Functions / Admin SDK）寫入
- 每筆交易必須保留 `operatorId` 與 `createdAt`
- 同一 booking 僅能發一次抽獎機會（`drawGranted`）
- 可加上每日抽獎上限（例如每人每日最多 3 次）

---

## 8. 後台介面最低需求

- 顧客查詢頁：
  - 匿名碼/暱稱搜尋
  - 顯示目前餘額
  - 顯示可抽次數
- 交易明細頁：
  - 顯示最近 N 筆 `walletTransactions`
  - 支援依日期/顧客過濾
- 輪盤記錄頁：
  - 顯示最近 N 筆 `wheelSpins`
  - 可追溯到 booking 與操作人

---

## 9. 上線階段建議

### 階段 1（本次 MVP）

- 完成儲值、扣款、退款、抽獎機會發放
- 完成輪盤抽獎與結果記錄
- 完成後台查詢與對帳基本畫面

### 階段 2（後續優化）

- 混合支付
- 半匿名客人自助查詢（lookupCode + PIN）
- 大獎冷卻與精細風控
- 行銷活動（節日權重、任務式獎勵）

---

## 10. 驗收清單（開發完成後）

- 完成預約後，餘額與交易明細一致
- 取消已扣款預約，餘額可完整退回
- 同一 booking 不會重複發放抽獎機會
- 抽輪盤不會在低餘額或高併發下產生錯帳
- 前台不會暴露匿名客戶的餘額資訊

