import { getLocale } from "./i18n";
import { createLittleMarySfx } from "./bookTabLittleMaryAudio";

/** 外圈 24 格：順時針由左上起，與 7×7 邊框格索引一致 */
export type LittleMarySymbol =
  | "apple"
  | "watermelon"
  | "star"
  | "seven"
  | "bar"
  | "bell"
  | "mango"
  | "orange"
  | "cherry"
  | "once_more";

const LOOP_24: LittleMarySymbol[] = [
  "orange",
  "bell",
  "watermelon",
  "bar",
  "apple",
  "watermelon",
  "mango",
  "apple",
  "once_more",
  "watermelon",
  "star",
  "mango",
  "watermelon",
  "apple",
  "seven",
  "watermelon",
  "bell",
  "orange",
  "watermelon",
  "apple",
  "once_more",
  "apple",
  "star",
  "mango",
];

type BetLine = {
  id: LittleMarySymbol;
  mult: number;
  zh: string;
  en: string;
};

const BET_LINES: BetLine[] = [
  { id: "apple", mult: 5, zh: "蘋果", en: "Apple" },
  { id: "watermelon", mult: 20, zh: "西瓜", en: "Melon" },
  { id: "star", mult: 30, zh: "星星", en: "Stars" },
  { id: "seven", mult: 40, zh: "７７", en: "77" },
  { id: "bar", mult: 50, zh: "BAR", en: "BAR" },
  { id: "bell", mult: 20, zh: "鈴鐺", en: "Bell" },
  { id: "mango", mult: 15, zh: "芒果", en: "Mango" },
  { id: "orange", mult: 10, zh: "橘子", en: "Orange" },
  { id: "cherry", mult: 2, zh: "櫻桃", en: "Cherry" },
];

/** `public/lm-icons/`：Twemoji SVG（CC-BY 4.0）＋自製 bar／seven */
function lmIconSrc(file: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const norm = base.endsWith("/") ? base : `${base}/`;
  return `${norm}lm-icons/${file}`;
}

const SYM_TO_FILE: Record<LittleMarySymbol, string> = {
  apple: "apple.svg",
  watermelon: "watermelon.svg",
  star: "star.svg",
  seven: "seven.svg",
  bar: "bar.svg",
  bell: "bell.svg",
  mango: "mango.svg",
  orange: "orange.svg",
  cherry: "cherry.svg",
  once_more: "once.svg",
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

/** 實機控制台：上排 BAR→77→星→瓜，下排鈴→芒→橘→蘋，底排櫻桃 */
const BET_TILE_ORDER = [4, 3, 2, 1, 5, 6, 7, 0, 8] as const;

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
  if (sym === "once_more") return en ? "ONCE MORE" : "再來";
  const row = BET_LINES.find((b) => b.id === sym);
  if (row) return en ? row.en : row.zh;
  return sym;
}

/**
 * 預約主面板分頁：復古「小瑪莉」跑燈（純前端、無真實金流／後端）。
 */
export function mountBookTabLittleMary(host: HTMLElement): () => void {
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
  let lightIdx = 0;
  let spinning = false;
  let spinToken = 0;

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
      cell.innerHTML = `<span class="lm-slot__led" aria-hidden="true"></span>${icon}<span class="lm-slot__txt">${escAttr(lab)}</span>`;
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
  const betMiniLedEls: (HTMLElement | undefined)[] = Array(9);
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

  function setBetTilesDisabled(dis: boolean) {
    for (const b of betTiles) {
      b.disabled = dis;
    }
  }

  for (const lineIndex of BET_TILE_ORDER) {
    const line = BET_LINES[lineIndex]!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lm-bet-tile lm-bet-tile--arcade";
    if (lineIndex === 8) btn.classList.add("lm-bet-tile--fullrow");
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

  controls.append(btnClear, btnCollect, btnStart);

  const msg = document.createElement("p");
  msg.className = "lm-msg";
  msg.setAttribute("aria-live", "polite");
  msg.textContent = en ? "Tap a symbol, then Start." : "點圖示押注，再按開始。";

  root.append(board, betRow, controls, msg);
  cabinet.appendChild(root);
  host.appendChild(cabinet);

  const elWin = root.querySelector('[data-lm="win"]') as HTMLElement;
  const elCredit = root.querySelector('[data-lm="credit"]') as HTMLElement;

  function pad4(n: number): string {
    return String(Math.min(9999, Math.max(0, Math.floor(n)))).padStart(4, "0");
  }

  function syncDisplays() {
    elWin.textContent = pad4(winPile);
    elCredit.textContent = pad4(credit);
    for (let i = 0; i < 9; i++) {
      const v = String(bets[i] ?? 0);
      const mini = betMiniLedEls[i];
      if (mini) mini.textContent = v;
    }
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
    if (credit <= 0) {
      sfx.playNoCredit();
      msg.textContent = en ? "No credit." : "分數不足。";
      return;
    }
    credit -= 1;
    bets[lineIndex] = (bets[lineIndex] ?? 0) + 1;
    sfx.playBet();
    syncDisplays();
    msg.textContent = en ? "Bet placed." : "已押注。";
  }

  function clearBets() {
    if (spinning) return;
    const sum = totalBet();
    if (sum === 0) return;
    credit += sum;
    bets.fill(0);
    sfx.playClear();
    syncDisplays();
    msg.textContent = en ? "Bets cleared." : "已退回押注。";
  }

  function collectWin() {
    if (spinning) return;
    if (winPile <= 0) return;
    credit += winPile;
    winPile = 0;
    sfx.playCollect();
    syncDisplays();
    msg.textContent = en ? "Credited." : "已轉入分數。";
  }

  function resolveStop(stopIdx: number) {
    const sym = LOOP_24[stopIdx]!;
    if (sym === "once_more") {
      credit += 8;
      sfx.playOnceMore();
      msg.textContent = en ? "ONCE MORE — +8 credit!" : "再來！獲得 8 分。";
    } else {
      const line = BET_LINES.findIndex((b) => b.id === sym);
      const b = line >= 0 ? bets[line] ?? 0 : 0;
      const mult = line >= 0 ? BET_LINES[line]!.mult : 0;
      if (b > 0 && mult > 0) {
        const gain = b * mult;
        winPile += gain;
        sfx.playWin(gain);
        msg.textContent = en ? `Hit ${BET_LINES[line]!.en}! +${gain}` : `開出 ${BET_LINES[line]!.zh}！+${gain} 得分`;
      } else {
        sfx.playMiss();
        msg.textContent = en ? `Stopped on ${symbolLabel(sym, true)}.` : `停在「${symbolLabel(sym, false)}」。`;
      }
    }
    bets.fill(0);
    syncDisplays();
  }

  function runSpin() {
    if (spinning) return;
    if (totalBet() === 0) {
      sfx.playError();
      msg.textContent = en ? "Place a bet first." : "請先押注。";
      return;
    }
    sfx.playSpinStart();
    spinning = true;
    setBetTilesDisabled(true);
    const myToken = ++spinToken;
    const target = Math.floor(Math.random() * 24);
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
        setBetTilesDisabled(false);
        resolveStop(lightIdx);
        return;
      }
      const delay = easeDelay(step / totalSteps);
      window.setTimeout(stepOnce, delay);
    }

    window.setTimeout(stepOnce, easeDelay(0));
  }

  btnStart.addEventListener("click", runSpin);
  btnCollect.addEventListener("click", collectWin);
  btnClear.addEventListener("click", clearBets);

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
    if (ev.code === "Space") {
      ev.preventDefault();
      runSpin();
    }
  }
  window.addEventListener("keydown", onKey);

  syncDisplays();

  return () => {
    spinToken += 1;
    io.disconnect();
    window.removeEventListener("keydown", onKey);
    sfx.dispose();
    cabinet.remove();
    host.classList.remove("book-tab-lm-mount--interactive");
  };
}
