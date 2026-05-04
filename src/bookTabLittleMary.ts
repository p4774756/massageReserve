import { onAuthStateChanged } from "firebase/auth";
import { getLocale } from "./i18n";
import { createLittleMarySfx } from "./bookTabLittleMaryAudio";
import {
  getFirebaseAuth,
  getMyWalletCall,
  isFirebaseConfigured,
  littleMaryHiLoAccountCall,
  littleMaryHiLoRollCall,
  littleMarySpinAccountCall,
  littleMarySpinCall,
} from "./firebase";

export type MountBookTabLittleMaryOptions = {
  /** 會員遊戲點於伺服端變動後（開獎／比大小／兌換）通知外層刷新錢包列 */
  onArcadeBalanceMutated?: () => void | Promise<void>;
};

/** 外圈 24 格：順時針由左上起，與 7×7 邊框格索引一致 */
export type LittleMarySymbol =
  | "cherry"
  | "lemon"
  | "orange"
  | "watermelon"
  | "bell"
  | "star"
  | "seven"
  | "bar";

/**
 * 外圈符號格數：櫻桃 5、檸檬 4、橘子 4、西瓜 3、鈴鐺 3、星星 2、７７ 2、BAR 1（合計 24）。
 * 順序依周邊索引打散，避免同圖過度連鄰。
 */
const LOOP_24: LittleMarySymbol[] = [
  "cherry",
  "orange",
  "lemon",
  "watermelon",
  "bell",
  "star",
  "bar",
  "seven",
  "cherry",
  "orange",
  "lemon",
  "watermelon",
  "bell",
  "star",
  "seven",
  "cherry",
  "orange",
  "lemon",
  "watermelon",
  "bell",
  "cherry",
  "orange",
  "lemon",
  "cherry",
];

type BetLine = {
  id: LittleMarySymbol;
  mult: number;
  zh: string;
  en: string;
};

type LmMsgTone = "hint" | "info" | "success" | "danger" | "warning";

/** 中獎後比大小：先選大／小／不賭；開點後須按確定關閉彈窗 */
type GamblePending =
  | null
  | { phase: "offer"; stake: number }
  | { phase: "result"; stake: number; roll: number; isHigh: boolean; hit: boolean };

/** 倍率與外圈格數大致成反比；檸檬 4 格取 12×（介於櫻桃與橘子之間） */
const BET_LINES: BetLine[] = [
  { id: "cherry", mult: 2, zh: "櫻桃", en: "Cherry" },
  { id: "lemon", mult: 12, zh: "檸檬", en: "Lemon" },
  { id: "orange", mult: 10, zh: "橘子", en: "Orange" },
  { id: "watermelon", mult: 20, zh: "西瓜", en: "Melon" },
  { id: "bell", mult: 20, zh: "鈴鐺", en: "Bell" },
  { id: "star", mult: 30, zh: "星星", en: "Stars" },
  { id: "seven", mult: 40, zh: "７７", en: "77" },
  { id: "bar", mult: 50, zh: "BAR", en: "BAR" },
];

/** `public/lm-icons/`：Twemoji SVG（CC-BY 4.0）＋自製 seven；bar 為使用者提供 PNG */
function lmIconSrc(file: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const norm = base.endsWith("/") ? base : `${base}/`;
  return `${norm}lm-icons/${file}`;
}

const SYM_TO_FILE: Record<LittleMarySymbol, string> = {
  cherry: "cherry.svg",
  lemon: "lemon.svg",
  orange: "orange.svg",
  watermelon: "watermelon.svg",
  bell: "bell.svg",
  star: "star.svg",
  seven: "seven.svg",
  bar: "bar.png",
};

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function symIconHtml(sym: LittleMarySymbol, label: string, cls: string): string {
  const file = SYM_TO_FILE[sym];
  const src = lmIconSrc(file);
  return `<img class="${cls}" src="${src}" alt="${escAttr(label)}" width="36" height="36" loading="lazy" decoding="async"/>`;
}

function betTileIconHtml(line: BetLine, en: boolean): string {
  return symIconHtml(line.id, en ? line.en : line.zh, "lm-ico lm-ico--bet");
}

/** 押注格 4×2：上 BAR→77→星→瓜，下 鈴→橘→檸→櫻 */
const BET_TILE_ORDER = [7, 6, 5, 3, 4, 2, 1, 0] as const;

function buildPerimeterMap(): (number | null)[][] {
  const m: (number | null)[][] = Array.from({ length: 7 }, () => Array(7).fill(null));
  let idx = 0;
  for (let c = 0; c < 7; c++) m[0]![c] = idx++;
  for (let r = 1; r < 6; r++) m[r]![6] = idx++;
  for (let c = 6; c >= 0; c--) m[6]![c] = idx++;
  for (let r = 5; r >= 1; r--) m[r]![0] = idx++;
  return m;
}

const PERIMETER_MAP = buildPerimeterMap();

function symbolLabel(sym: LittleMarySymbol, en: boolean): string {
  const row = BET_LINES.find((b) => b.id === sym);
  if (row) return en ? row.en : row.zh;
  return sym;
}

/**
 * 預約主面板分頁：復古「小瑪莉」跑燈。
 * 訪客／未驗證信箱：試玩分數於瀏覽器；已驗證會員且已設定 Firebase：遊戲點與開獎由 Cloud Functions 結算。
 */
export function mountBookTabLittleMary(host: HTMLElement, options?: MountBookTabLittleMaryOptions): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const div = document.createElement("div");
    div.className = "book-tab-lm-static";
    div.setAttribute("role", "img");
    div.setAttribute(
      "aria-label",
      getLocale() === "en" ? "Little Mary mini-game disabled when reduced motion is on." : "已開啟減少動態效果，小瑪莉未載入。",
    );
    host.append(div);
    return () => div.remove();
  }

  const en = getLocale() === "en";
  host.classList.add("book-tab-lm-mount--interactive");

  const onArcadeBalanceMutated = options?.onArcadeBalanceMutated;
  let accountPlay = false;
  /** 伺服器端目前遊戲點總額（含得分欄已入帳部分） */
  let lastServerArcade = 0;
  /** 本局伺服器結算之中獎分（供 resolveStop 與試玩邏輯對齊）；-1 表示用本地計算 */
  let pendingSpinHitGain = -1;

  const sfx = createLittleMarySfx();
  host.addEventListener(
    "pointerdown",
    () => {
      sfx.tryUnlock();
    },
    { once: true },
  );

  let credit = 32;
  let winPile = 0;
  const bets: number[] = BET_LINES.map(() => 0);

  function applyDemoDefaults() {
    accountPlay = false;
    credit = 32;
    winPile = 0;
    lastServerArcade = 0;
    pendingSpinHitGain = -1;
    bets.fill(0);
  }

  let lightIdx = 0;
  let spinning = false;
  let spinToken = 0;
  /** 中獎後可選「比大小」；`stake` 為本局剛入帳之得分（可加倍或扣回） */
  let gamblePending: GamblePending = null;
  let hiloResolving = false;

  const cabinet = document.createElement("div");
  cabinet.className = "lm-cabinet lm-cabinet--salon";

  const root = document.createElement("div");
  root.className = "lm-root lm-root--salon";

  const statusRow = document.createElement("div");
  statusRow.className = "lm-status lm-status--arcade";
  const winBox = document.createElement("div");
  winBox.className = "lm-status__group";
  winBox.innerHTML = `<span class="lm-status__label">${en ? "BONUS" : "得分"}</span><span class="lm-led lm-led--arcade" data-lm="win">0000</span>`;
  const creditBox = document.createElement("div");
  creditBox.className = "lm-status__group";
  creditBox.innerHTML = `<span class="lm-status__label">${en ? "CREDIT" : "總分"}</span><span class="lm-led lm-led--arcade" data-lm="credit">0032</span>`;
  statusRow.append(winBox, creditBox);

  const board = document.createElement("div");
  board.className = "lm-board lm-board--arcade";

  board.append(statusRow);

  const grid = document.createElement("div");
  grid.className = "lm-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", en ? "24-slot loop" : "24 格外圈跑燈");

  const slotEls: (HTMLElement | null)[] = Array(24).fill(null);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const si = PERIMETER_MAP[r]![c];
      if (si === null) {
        if (r === 1 && c === 1) {
          const hole = document.createElement("div");
          hole.className = "lm-grid__hole lm-grid__hole--center";
          hole.style.gridRow = "2 / span 5";
          hole.style.gridColumn = "2 / span 5";
          const heroSrc = lmIconSrc("lm-center-hero.png");
          hole.innerHTML = `
            <div class="lm-center">
              <div class="lm-center__title" lang="zh-Hant">小瑪莉</div>
              <div class="lm-center__art">
                <img class="lm-center-hero" src="${escAttr(heroSrc)}" width="512" height="512" alt="" decoding="async" draggable="false" />
              </div>
              <div class="lm-center__jp" aria-hidden="true">JP</div>
            </div>`;
          grid.appendChild(hole);
        }
        continue;
      }
      const sym = LOOP_24[si]!;
      const cell = document.createElement("div");
      cell.className = "lm-slot lm-slot--arcade";
      cell.style.gridRow = String(r + 1);
      cell.style.gridColumn = String(c + 1);
      cell.dataset.slotIndex = String(si);
      const lab = symbolLabel(sym, en);
      const icon = symIconHtml(sym, lab, "lm-ico lm-ico--slot");
      cell.setAttribute("aria-label", lab);
      cell.innerHTML = `<span class="lm-slot__led" aria-hidden="true"></span>${icon}`;
      if (si === lightIdx) cell.classList.add("lm-slot--lit");
      slotEls[si] = cell;
      grid.appendChild(cell);
    }
  }

  board.appendChild(grid);

  const betLedRow = document.createElement("div");
  betLedRow.className = "lm-bet-ledrow";
  betLedRow.setAttribute("role", "group");
  betLedRow.setAttribute("aria-label", en ? "Bet amount per symbol (read the red digits under each icon)" : "各圖示押注分數（圖示下方紅字）");
  const betMiniLedEls: (HTMLElement | undefined)[] = Array.from({
    length: BET_LINES.length,
  }) as (HTMLElement | undefined)[];
  for (const lineIndex of BET_TILE_ORDER) {
    const line = BET_LINES[lineIndex]!;
    const cell = document.createElement("div");
    cell.className = "lm-bet-ledcell";
    cell.innerHTML = `${betTileIconHtml(line, en)}<span class="lm-led lm-led--mini" data-bet-mini="${lineIndex}">0</span>`;
    betMiniLedEls[lineIndex] = cell.querySelector(`[data-bet-mini="${lineIndex}"]`) as HTMLElement;
    betLedRow.appendChild(cell);
  }
  board.appendChild(betLedRow);

  const betRow = document.createElement("div");
  betRow.className = "lm-bets";
  betRow.setAttribute("role", "group");
  betRow.setAttribute("aria-label", en ? "Bet grid, tap a symbol to add 1 credit" : "押注格，點圖示 +1 分");

  const betStrip = document.createElement("div");
  betStrip.className = "lm-bets-strip lm-bets-strip--arcade";
  const betGrid = document.createElement("div");
  betGrid.className = "lm-bets-grid lm-bets-grid--arcade";

  const betTiles: HTMLButtonElement[] = [];

  for (const lineIndex of BET_TILE_ORDER) {
    const line = BET_LINES[lineIndex]!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lm-bet-tile lm-bet-tile--arcade";
    btn.dataset.betIndex = String(lineIndex);
    btn.innerHTML = `
      <span class="lm-bet-tile__mult">${line.mult}x</span>
      ${betTileIconHtml(line, en)}
    `;
    btn.title = en ? `${line.en} ×${line.mult} · +1 credit` : `${line.zh} ×${line.mult} · +1 分`;
    btn.setAttribute("aria-label", en ? `Bet +1 on ${line.en}, ${line.mult}x` : `在${line.zh}押 +1（${line.mult}倍）`);
    btn.addEventListener("click", () => addBet(lineIndex));
    betTiles.push(btn);
    betGrid.appendChild(btn);
  }
  betStrip.appendChild(betGrid);
  betRow.appendChild(betStrip);

  const hiLoModal = document.createElement("div");
  hiLoModal.className = "lm-hilo-modal lm-hilo-modal--hidden";
  hiLoModal.setAttribute("aria-hidden", "true");
  const hiLoBackdrop = document.createElement("div");
  hiLoBackdrop.className = "lm-hilo-modal__backdrop";
  hiLoBackdrop.setAttribute("aria-hidden", "true");
  const hiLoDialog = document.createElement("div");
  hiLoDialog.className = "lm-hilo-modal__dialog";
  hiLoDialog.setAttribute("role", "dialog");
  hiLoDialog.setAttribute("aria-modal", "true");
  hiLoDialog.setAttribute("aria-labelledby", "lm-hilo-modal-title");
  const hiloModalTitle = document.createElement("h2");
  hiloModalTitle.id = "lm-hilo-modal-title";
  hiloModalTitle.className = "lm-hilo-modal__title";
  const hiloModalBody = document.createElement("p");
  hiloModalBody.className = "lm-hilo__rule lm-hilo-modal__body";
  hiloModalBody.id = "lm-hilo-modal-body";
  const hiloModalDice = document.createElement("div");
  hiloModalDice.className = "lm-hilo__dice lm-hilo-modal__dice";
  hiloModalDice.setAttribute("aria-live", "polite");

  const hiloChoiceActions = document.createElement("div");
  hiloChoiceActions.className = "lm-hilo-modal__actions";
  hiloChoiceActions.setAttribute("role", "group");
  hiloChoiceActions.setAttribute(
    "aria-label",
    en ? "Double-or-nothing: pick HIGH, LOW, or Skip" : "比大小：選大、小或不賭",
  );
  const btnHiloBig = document.createElement("button");
  btnHiloBig.type = "button";
  btnHiloBig.className = "lm-hilo__pick lm-hilo__pick--big";
  btnHiloBig.textContent = en ? "High" : "大";
  btnHiloBig.setAttribute(
    "aria-label",
    en ? "High: win if the next roll is 7–12." : "大：再開點數 7～12 為大。",
  );
  const btnHiloSmall = document.createElement("button");
  btnHiloSmall.type = "button";
  btnHiloSmall.className = "lm-hilo__pick lm-hilo__pick--small";
  btnHiloSmall.textContent = en ? "Low" : "小";
  btnHiloSmall.setAttribute(
    "aria-label",
    en ? "Low: win if the next roll is 1–6." : "小：再開點數 1～6 為小。",
  );
  const btnHiloSkip = document.createElement("button");
  btnHiloSkip.type = "button";
  btnHiloSkip.className = "lm-hilo__skip";
  btnHiloSkip.textContent = en ? "Skip" : "不賭";
  hiloChoiceActions.append(btnHiloBig, btnHiloSmall, btnHiloSkip);

  const hiloResultActions = document.createElement("div");
  hiloResultActions.className = "lm-hilo-modal__actions lm-hilo-modal__actions--result";
  hiloResultActions.hidden = true;
  const btnHiloOk = document.createElement("button");
  btnHiloOk.type = "button";
  btnHiloOk.className = "lm-hilo__pick lm-hilo__pick--ok";
  btnHiloOk.textContent = en ? "OK" : "確定";
  btnHiloOk.setAttribute("aria-label", en ? "Close result" : "關閉結果");
  hiloResultActions.append(btnHiloOk);

  hiLoDialog.append(hiloModalTitle, hiloModalBody, hiloModalDice, hiloChoiceActions, hiloResultActions);
  hiLoModal.append(hiLoBackdrop, hiLoDialog);

  const controls = document.createElement("div");
  controls.className = "lm-controls lm-controls--bar lm-controls--arcade";
  const btnStart = document.createElement("button");
  btnStart.type = "button";
  btnStart.className = "lm-controls__start";
  btnStart.textContent = en ? "Start" : "開始";
  const btnCollect = document.createElement("button");
  btnCollect.type = "button";
  btnCollect.className = "lm-controls__collect";
  btnCollect.textContent = en ? "Win → Credit" : "得分轉分數";
  const btnClear = document.createElement("button");
  btnClear.type = "button";
  btnClear.className = "lm-controls__clear";
  btnClear.textContent = en ? "Clear bets" : "清空押注";
  const btnBetAll = document.createElement("button");
  btnBetAll.type = "button";
  btnBetAll.className = "lm-controls__betall";
  btnBetAll.textContent = en ? "Bet all" : "全押";
  btnBetAll.title = en
    ? "Spend all credits on bets, +1 per line round-robin until balance is 0."
    : "將剩餘分數全數押入：依八條線輪流每次 +1，直到分數用盡。";
  btnBetAll.setAttribute(
    "aria-label",
    en ? "Bet all credits in round-robin across eight lines" : "全押：剩餘分數輪流押滿八條線",
  );

  controls.append(btnClear, btnBetAll, btnCollect, btnStart);

  const msg = document.createElement("p");
  msg.setAttribute("aria-live", "polite");
  function setLmMsg(text: string, tone: LmMsgTone) {
    msg.textContent = text;
    msg.className = `lm-msg lm-msg--${tone}`;
  }
  setLmMsg(en ? "Tap a symbol, then Start." : "點圖示押注，再按開始。", "hint");

  /** 訊息列置於跑燈盤＋押注 LED 列之後、押注白鍵格之前，靠近操作區（避免貼在機台最底） */
  root.append(board, msg, betRow, controls);
  cabinet.appendChild(root);
  cabinet.appendChild(hiLoModal);
  host.appendChild(cabinet);

  const elWin = root.querySelector('[data-lm="win"]') as HTMLElement;
  const elCredit = root.querySelector('[data-lm="credit"]') as HTMLElement;

  function pad4(n: number): string {
    return String(Math.min(9999, Math.max(0, Math.floor(n)))).padStart(4, "0");
  }

  function syncDisplays() {
    elWin.textContent = pad4(winPile);
    elCredit.textContent = pad4(credit);
    for (let i = 0; i < BET_LINES.length; i++) {
      const v = String(bets[i] ?? 0);
      const mini = betMiniLedEls[i];
      if (mini) mini.textContent = v;
    }
  }

  function updateInteractiveLock() {
    const g = gamblePending !== null;
    const tilesOff = spinning || g;
    for (const b of betTiles) {
      b.disabled = tilesOff;
    }
    btnStart.disabled = spinning || g || totalBet() === 0;
    btnClear.disabled = spinning || g || totalBet() === 0;
    btnBetAll.disabled = spinning || g || credit <= 0;
    btnCollect.disabled = winPile <= 0;
    const offer = gamblePending?.phase === "offer";
    const result = gamblePending?.phase === "result";
    btnHiloBig.disabled = spinning || !offer || hiloResolving;
    btnHiloSmall.disabled = spinning || !offer || hiloResolving;
    btnHiloSkip.disabled = spinning || !offer || hiloResolving;
    btnHiloOk.disabled = spinning || !result || hiloResolving;
  }

  async function refreshAccountArcadeFromWallet(): Promise<void> {
    if (!isFirebaseConfigured()) {
      applyDemoDefaults();
      syncDisplays();
      updateInteractiveLock();
      return;
    }
    const user = getFirebaseAuth().currentUser;
    if (!user?.emailVerified) {
      applyDemoDefaults();
      syncDisplays();
      updateInteractiveLock();
      return;
    }
    try {
      const res = await getMyWalletCall()({ locale: en ? "en" : "zh-Hant" });
      const data = res.data as { arcadePoints?: unknown };
      const ap = typeof data.arcadePoints === "number" && Number.isFinite(data.arcadePoints) ? Math.floor(data.arcadePoints) : 0;
      accountPlay = true;
      lastServerArcade = Math.min(999_999, Math.max(0, ap));
      credit = Math.max(0, lastServerArcade - winPile);
    } catch {
      applyDemoDefaults();
    }
    syncDisplays();
    updateInteractiveLock();
  }

  const unsubAuth = onAuthStateChanged(getFirebaseAuth(), () => {
    void refreshAccountArcadeFromWallet();
  });
  void refreshAccountArcadeFromWallet();

  function closeHiLoModalUi() {
    hiLoModal.classList.add("lm-hilo-modal--hidden");
    hiLoModal.setAttribute("aria-hidden", "true");
    hiloModalTitle.textContent = "";
    hiloModalBody.textContent = "";
    hiloModalDice.textContent = "";
    hiloChoiceActions.hidden = false;
    hiloResultActions.hidden = true;
  }

  function abandonHiLoIfOpen() {
    if (!gamblePending) return;
    gamblePending = null;
    hiloResolving = false;
    closeHiLoModalUi();
  }

  function offerHiLo(stake: number) {
    gamblePending = { phase: "offer", stake };
    hiloModalTitle.textContent = en ? "Double-or-nothing?" : "要比大小嗎？";
    hiloModalBody.textContent = en
      ? `You won +${stake} on this spin. Roll 1–12: HIGH = 7–12, LOW = 1–6 (50/50). Win → +${stake} more on your bonus; lose → −${stake} from bonus. Skip keeps your bonus as-is.`
      : `本局已入帳 +${stake} 得分。可再押一次：再開 1～12 點，大＝7～12、小＝1～6（各半）。猜中再 +${stake} 得分；猜錯從得分扣 ${stake}。按「不賭」則維持現狀。`;
    hiloModalDice.textContent = en ? `Bonus: +${stake}` : `本局入帳：+${stake} 得分`;
    hiloChoiceActions.hidden = false;
    hiloResultActions.hidden = true;
    hiLoModal.classList.remove("lm-hilo-modal--hidden");
    hiLoModal.setAttribute("aria-hidden", "false");
    updateInteractiveLock();
    btnHiloSkip.focus();
  }

  function skipHiLo() {
    if (!gamblePending || gamblePending.phase !== "offer" || hiloResolving) return;
    gamblePending = null;
    closeHiLoModalUi();
    updateInteractiveLock();
    setLmMsg(en ? "Skipped double-or-nothing." : "已略過比大小，得分不變。", "info");
  }

  function finishHiLoResultOk() {
    if (!gamblePending || gamblePending.phase !== "result") return;
    gamblePending = null;
    closeHiLoModalUi();
    if (accountPlay) {
      credit = Math.max(0, lastServerArcade - winPile);
    }
    updateInteractiveLock();
  }

  async function resolveHiLo(guessHigh: boolean) {
    if (!gamblePending || gamblePending.phase !== "offer" || hiloResolving) return;
    const { stake } = gamblePending;
    hiloResolving = true;
    updateInteractiveLock();
    const localePayload = en ? "en" : "zh-Hant";
    let roll: number;
    try {
      if (accountPlay) {
        const res = await littleMaryHiLoAccountCall()({ stake, guessHigh, locale: localePayload });
        const d = res.data as { roll?: unknown; arcadePoints?: unknown };
        const r = typeof d.roll === "number" ? Math.trunc(d.roll) : NaN;
        if (!Number.isFinite(r) || r < 1 || r > 12) throw new Error("bad roll");
        roll = r;
        if (typeof d.arcadePoints === "number") {
          lastServerArcade = Math.min(999_999, Math.max(0, Math.floor(d.arcadePoints)));
          void onArcadeBalanceMutated?.();
        }
      } else if (isFirebaseConfigured()) {
        const res = await littleMaryHiLoRollCall()({ stake, locale: localePayload });
        const data = res.data as { roll?: unknown };
        const r = typeof data.roll === "number" ? Math.trunc(data.roll) : NaN;
        if (!Number.isFinite(r) || r < 1 || r > 12) throw new Error("bad roll");
        roll = r;
      } else {
        roll = Math.floor(Math.random() * 12) + 1;
      }
    } catch {
      hiloResolving = false;
      updateInteractiveLock();
      sfx.playError();
      setLmMsg(
        en
          ? accountPlay
            ? "Could not settle hi-lo on the server. Try again."
            : "Could not roll hi-lo on the server. Try again."
          : accountPlay
            ? "比大小結算失敗，請稍後再試。"
            : "比大小開點失敗，請稍後再試。",
        "danger",
      );
      return;
    }
    const isHigh = roll >= 7;
    const hit = guessHigh ? isHigh : !isHigh;
    if (hit) {
      winPile = Math.min(9999, winPile + stake);
      sfx.playWin(stake);
      hiloModalTitle.textContent = en ? "You hit!" : "猜中了！";
      hiloModalBody.textContent = en
        ? `Rolled ${roll} (${isHigh ? "HIGH" : "LOW"}). +${stake} added to your bonus.`
        : `開出 ${roll} 點（${isHigh ? "大" : "小"}）。再 +${stake} 得分已入帳。`;
      setLmMsg(en ? `Hi-lo hit! Bonus +${stake}.` : `比大小猜中！再 +${stake} 得分。`, "success");
    } else {
      winPile = Math.max(0, winPile - stake);
      sfx.playMiss();
      hiloModalTitle.textContent = en ? "Missed" : "未猜中";
      hiloModalBody.textContent = en
        ? `Rolled ${roll} (${isHigh ? "HIGH" : "LOW"}). −${stake} taken from this win’s bonus.`
        : `開出 ${roll} 點（${isHigh ? "大" : "小"}）。自得分欄扣回 ${stake}。`;
      setLmMsg(en ? `Hi-lo miss. −${stake} from bonus.` : `比大小未中，自得分扣 ${stake}。`, "danger");
    }
    hiloModalDice.textContent = en
      ? `Roll: ${roll} · ${isHigh ? "HIGH" : "LOW"}`
      : `開點：${roll}（${isHigh ? "大" : "小"}）`;
    gamblePending = { phase: "result", stake, roll, isHigh, hit };
    hiloChoiceActions.hidden = true;
    hiloResultActions.hidden = false;
    hiloResolving = false;
    if (accountPlay) {
      credit = Math.max(0, lastServerArcade - winPile);
    }
    syncDisplays();
    updateInteractiveLock();
    btnHiloOk.focus();
  }

  function setLight(i: number) {
    const prev = lightIdx;
    lightIdx = ((i % 24) + 24) % 24;
    if (slotEls[prev]) slotEls[prev]!.classList.remove("lm-slot--lit");
    if (slotEls[lightIdx]) slotEls[lightIdx]!.classList.add("lm-slot--lit");
  }

  function totalBet(): number {
    return bets.reduce((a, b) => a + b, 0);
  }

  function addBet(lineIndex: number) {
    if (spinning) return;
    if (gamblePending) {
      sfx.playError();
      setLmMsg(
        en
          ? "Finish the double-or-nothing pop-up first (Skip, pick High/Low, or OK on the result)."
          : "請先處理比大小彈窗：略過、選大／小，或看完開點後按「確定」。",
        "warning",
      );
      return;
    }
    if (credit <= 0) {
      sfx.playNoCredit();
      setLmMsg(en ? "No credit." : "分數不足。", "warning");
      return;
    }
    credit -= 1;
    bets[lineIndex] = (bets[lineIndex] ?? 0) + 1;
    sfx.playBet();
    syncDisplays();
    updateInteractiveLock();
    setLmMsg(en ? "Bet placed." : "已押注。", "info");
  }

  function clearBets() {
    if (spinning) return;
    if (gamblePending) return;
    const sum = totalBet();
    if (sum === 0) return;
    credit += sum;
    bets.fill(0);
    sfx.playClear();
    syncDisplays();
    updateInteractiveLock();
    setLmMsg(en ? "Bets cleared." : "已退回押注。", "info");
  }

  function betAll() {
    if (spinning) return;
    if (gamblePending) {
      sfx.playError();
      setLmMsg(
        en
          ? "Finish the double-or-nothing pop-up first (Skip, pick High/Low, or OK on the result)."
          : "請先處理比大小彈窗：略過、選大／小，或看完開點後按「確定」。",
        "warning",
      );
      return;
    }
    if (credit <= 0) {
      sfx.playNoCredit();
      setLmMsg(en ? "No credit." : "分數不足。", "warning");
      return;
    }
    const order = [...BET_TILE_ORDER];
    let placed = 0;
    while (credit > 0) {
      for (const lineIndex of order) {
        if (credit <= 0) break;
        credit -= 1;
        bets[lineIndex] = (bets[lineIndex] ?? 0) + 1;
        placed += 1;
      }
    }
    sfx.playBet();
    syncDisplays();
    updateInteractiveLock();
    setLmMsg(
      en
        ? `All-in: ${placed} credit(s) placed round-robin on all lines.`
        : `已全押：共 ${placed} 分，依八條線輪流各 +1 直到分數用盡。`,
      "info",
    );
  }

  function collectWin() {
    if (spinning) return;
    if (winPile <= 0) return;
    if (gamblePending) {
      abandonHiLoIfOpen();
      updateInteractiveLock();
    }
    if (accountPlay) {
      credit = lastServerArcade;
    } else {
      credit += winPile;
    }
    winPile = 0;
    sfx.playCollect();
    syncDisplays();
    updateInteractiveLock();
    setLmMsg(en ? "Credited." : "已轉入分數。", "success");
  }

  function resolveStop(stopIdx: number) {
    const sym = LOOP_24[stopIdx]!;
    const line = BET_LINES.findIndex((b) => b.id === sym);
    const b = line >= 0 ? bets[line] ?? 0 : 0;
    const mult = line >= 0 ? BET_LINES[line]!.mult : 0;
    let hitGain = 0;
    if (accountPlay && pendingSpinHitGain >= 0) {
      hitGain = pendingSpinHitGain;
      pendingSpinHitGain = -1;
      if (hitGain > 0) {
        winPile = hitGain;
        sfx.playWin(hitGain);
        const hitLine = BET_LINES.findIndex((x) => x.id === sym);
        if (hitLine >= 0) {
          setLmMsg(
            en ? `Hit ${BET_LINES[hitLine]!.en}! +${hitGain}` : `開出 ${BET_LINES[hitLine]!.zh}！+${hitGain} 得分`,
            "success",
          );
        } else {
          setLmMsg(en ? `Hit +${hitGain}` : `中獎 +${hitGain} 得分`, "success");
        }
      } else {
        winPile = 0;
        sfx.playMiss();
        setLmMsg(en ? `Stopped on ${symbolLabel(sym, true)}.` : `停在「${symbolLabel(sym, false)}」。`, "info");
      }
      credit = Math.max(0, lastServerArcade - winPile);
    } else if (b > 0 && mult > 0) {
      hitGain = b * mult;
      winPile += hitGain;
      sfx.playWin(hitGain);
      setLmMsg(en ? `Hit ${BET_LINES[line]!.en}! +${hitGain}` : `開出 ${BET_LINES[line]!.zh}！+${hitGain} 得分`, "success");
    } else {
      sfx.playMiss();
      setLmMsg(en ? `Stopped on ${symbolLabel(sym, true)}.` : `停在「${symbolLabel(sym, false)}」。`, "info");
    }
    bets.fill(0);
    syncDisplays();
    if (hitGain > 0) {
      offerHiLo(hitGain);
    } else {
      updateInteractiveLock();
    }
  }

  function runSpin() {
    if (spinning) return;
    if (gamblePending) {
      sfx.playError();
      setLmMsg(
        en
          ? "Finish the double-or-nothing pop-up first (Skip, pick High/Low, or OK on the result)."
          : "請先處理比大小彈窗：略過、選大／小，或看完開點後按「確定」。",
        "warning",
      );
      return;
    }
    if (totalBet() === 0) {
      sfx.playError();
      setLmMsg(en ? "Place a bet first." : "請先押注。", "warning");
      return;
    }
    sfx.playSpinStart();
    spinning = true;
    updateInteractiveLock();
    const myToken = ++spinToken;
    const localePayload = en ? "en" : "zh-Hant";

    void (async () => {
      let target: number;
      try {
        if (accountPlay) {
          const res = await littleMarySpinAccountCall()({
            bets: bets.slice(),
            locale: localePayload,
          });
          const d = res.data as { stopIndex?: unknown; hitGain?: unknown; arcadePoints?: unknown };
          const t = typeof d.stopIndex === "number" ? Math.trunc(d.stopIndex) : NaN;
          const hg = typeof d.hitGain === "number" ? Math.trunc(d.hitGain) : 0;
          const ap = typeof d.arcadePoints === "number" ? Math.floor(d.arcadePoints) : 0;
          if (!Number.isFinite(t) || t < 0 || t > 23) throw new Error("bad stopIndex");
          pendingSpinHitGain = hg;
          lastServerArcade = Math.min(999_999, Math.max(0, ap));
          target = t;
          void onArcadeBalanceMutated?.();
        } else if (isFirebaseConfigured()) {
          const res = await littleMarySpinCall()({
            bets: bets.slice(),
            locale: localePayload,
          });
          const data = res.data as { stopIndex?: unknown };
          const t = typeof data.stopIndex === "number" ? Math.trunc(data.stopIndex) : NaN;
          if (!Number.isFinite(t) || t < 0 || t > 23) throw new Error("bad stopIndex");
          target = t;
        } else {
          target = Math.floor(Math.random() * 24);
        }
      } catch {
        if (myToken !== spinToken) return;
        spinning = false;
        updateInteractiveLock();
        sfx.playError();
        setLmMsg(
          en
            ? accountPlay
              ? "Could not settle spin on the server. Check network or deploy littleMarySpinAccount."
              : "Could not get spin from the server. Check network or deploy littleMarySpin."
            : accountPlay
              ? "無法從伺服器結算小瑪莉，請檢查網路或是否已部署 littleMarySpinAccount。"
              : "無法從伺服器取得開獎結果，請檢查網路或是否已部署 littleMarySpin。",
          "danger",
        );
        return;
      }

      if (myToken !== spinToken) {
        spinning = false;
        return;
      }

      const minLaps = 3;
      const startL = lightIdx;
      const totalSteps = minLaps * 24 + ((target - startL + 24) % 24);

      function easeDelay(progress: number): number {
        const x = progress * progress * progress;
        return 28 + x * 380;
      }

      let step = 0;
      function stepOnce() {
        if (myToken !== spinToken) return;
        setLight(lightIdx + 1);
        step += 1;
        sfx.playSpinTick(step / Math.max(1, totalSteps));
        if (step >= totalSteps) {
          spinning = false;
          resolveStop(lightIdx);
          return;
        }
        const delay = easeDelay(step / totalSteps);
        window.setTimeout(stepOnce, delay);
      }

      window.setTimeout(stepOnce, easeDelay(0));
    })();
  }

  btnStart.addEventListener("click", runSpin);
  btnCollect.addEventListener("click", collectWin);
  btnClear.addEventListener("click", clearBets);
  btnBetAll.addEventListener("click", betAll);
  btnHiloBig.addEventListener("click", () => void resolveHiLo(true));
  btnHiloSmall.addEventListener("click", () => void resolveHiLo(false));
  btnHiloSkip.addEventListener("click", () => skipHiLo());
  btnHiloOk.addEventListener("click", () => finishHiLoResultOk());

  let panelVisible = false;
  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[0];
      panelVisible = !!(e && e.isIntersecting && e.intersectionRatio > 0);
    },
    { root: null, threshold: [0, 0.01, 0.1] },
  );
  io.observe(host);

  function onKey(ev: KeyboardEvent) {
    if (!panelVisible) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (ev.code === "Escape" && gamblePending) {
      ev.preventDefault();
      if (gamblePending.phase === "offer") skipHiLo();
      else if (gamblePending.phase === "result") finishHiLoResultOk();
      return;
    }
    if (ev.code === "Space") {
      if (gamblePending) return;
      ev.preventDefault();
      runSpin();
    }
  }
  window.addEventListener("keydown", onKey);

  syncDisplays();
  updateInteractiveLock();

  return () => {
    spinToken += 1;
    unsubAuth();
    io.disconnect();
    window.removeEventListener("keydown", onKey);
    sfx.dispose();
    cabinet.remove();
    host.classList.remove("book-tab-lm-mount--interactive");
  };
}
