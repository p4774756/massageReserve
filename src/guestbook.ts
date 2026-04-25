import { onAuthStateChanged, signInAnonymously, type Auth, type User } from "firebase/auth";
import {
  type Firestore,
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

const COLLECTION = "guestbookPosts";
const MAX_TEXT = 800;
const MAX_NAME = 48;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  for (const [k, v] of Object.entries(props)) {
    if (k === "class" || v === undefined) continue;
    Reflect.set(node, k, v);
  }
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function formatPostTime(ts: { seconds?: number } | undefined): string {
  if (!ts?.seconds) return "";
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firestoreHint(err: unknown, context: string): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  const msg = err instanceof Error && err.message ? err.message : "";
  if (code === "permission-denied") {
    return `${context}（權限不足）若已更新規則，請部署：firebase deploy --only firestore:rules。${msg || ""}`;
  }
  if (msg) return `${context}（${code || "錯誤"}）：${msg}`;
  return context;
}

function starRowStatic(rating: number): HTMLElement {
  const row = el("div", { class: "guestbook-stars guestbook-stars--static", title: `${rating} 星` }, []);
  for (let i = 1; i <= 5; i++) {
    row.append(
      el("span", { class: i <= rating ? "guestbook-star guestbook-star--on" : "guestbook-star" }, [
        "★",
      ]),
    );
  }
  return row;
}

export type GuestbookUnmount = () => void;

/** 預約頁底部：公開心得列表＋評分留言（需已登入或匿名身分寫入） */
export function mountGuestbook(db: Firestore, auth: Auth, mount: HTMLElement): GuestbookUnmount {
  const section = el("section", { class: "guestbook" }, []);
  const head = el("h2", { class: "guestbook__title" }, ["心得與評價"]);
  const intro = el("p", { class: "hint guestbook__intro" }, [
    "歡迎分享體驗並給予 1～5 星評分。未註冊者送出時會建立匿名身分（與「聯絡店家」訪客相同）；會員登入後則以會員身分顯示。",
  ]);
  const listHost = el("div", { class: "guestbook-list" }, []);
  const emptyHint = el("p", { class: "hint guestbook-empty" }, ["尚無留言，歡迎成為第一位。"]);
  const writeBlock = el("div", { class: "guestbook-write" }, []);
  const composer = el("div", { class: "guestbook-composer" }, []);
  const guestGate = el("div", { class: "guestbook-guest-gate" }, []);
  const guestHint = el("p", { class: "hint" }, [
    "若要發表心得，請先啟用身分（不需註冊）：",
  ]);
  const guestBtn = el("button", { type: "button", class: "primary" }, ["以訪客身分啟用留言"]);
  guestGate.append(guestHint, guestBtn);
  const nameLabel = el("label", { class: "field" }, ["顯示名稱"]);
  const nameInput = el("input", {
    type: "text",
    maxLength: MAX_NAME,
    autocomplete: "name",
    placeholder: "例如：王小明",
  });
  nameLabel.append(nameInput);
  const ratingLabel = el("div", { class: "guestbook-rating-field" }, []);
  ratingLabel.append(el("span", { class: "guestbook-rating-label" }, ["評分（必填）"]));
  const starPick = el("div", { class: "guestbook-stars guestbook-stars--pick", role: "group" }, []);
  starPick.setAttribute("aria-label", "星等 1 到 5");
  let selectedStars = 0;
  const starBtns: HTMLButtonElement[] = [];
  for (let i = 1; i <= 5; i++) {
    const n = i;
    const b = el("button", {
      type: "button",
      class: "guestbook-star-btn",
      ariaLabel: `${n} 星`,
    });
    b.textContent = "★";
    b.addEventListener("click", () => {
      selectedStars = n;
      syncStarButtons();
    });
    starBtns.push(b);
    starPick.append(b);
  }
  function syncStarButtons() {
    for (let i = 0; i < 5; i++) {
      const on = i < selectedStars;
      starBtns[i].classList.toggle("guestbook-star-btn--on", on);
      starBtns[i].setAttribute("aria-pressed", String(on));
    }
  }
  syncStarButtons();
  ratingLabel.append(starPick);
  const textLabel = el("label", { class: "field" }, ["心得內容"]);
  const textArea = el("textarea", {
    class: "guestbook-textarea",
    rows: 4,
    maxLength: MAX_TEXT,
    placeholder: "寫下您的感受…",
  });
  textLabel.append(textArea);
  const submitRow = el("div", { class: "row-actions" }, []);
  const submitBtn = el("button", { type: "button", class: "primary" }, ["送出留言"]);
  submitRow.append(submitBtn);
  const statusLine = el("div", { class: "status-line" });
  composer.append(nameLabel, ratingLabel, textLabel, submitRow);
  writeBlock.append(guestGate, composer, statusLine);
  section.append(head, intro, listHost, emptyHint, writeBlock);
  mount.append(section);

  let listUnsub: (() => void) | null = null;
  let authUnsub: (() => void) | null = null;

  function setComposerForUser(u: User | null) {
    const canWrite = u != null;
    guestGate.hidden = canWrite;
    composer.hidden = !canWrite;
    statusLine.textContent = "";
    statusLine.className = "status-line";
    if (canWrite && u.displayName?.trim() && !nameInput.value.trim()) {
      nameInput.value = u.displayName.trim().slice(0, MAX_NAME);
    }
  }

  function renderList(
    rows: {
      id: string;
      displayName?: string;
      text?: string;
      rating?: number;
      createdAt?: { seconds: number };
    }[],
  ) {
    listHost.replaceChildren();
    const hasAny = rows.length > 0;
    emptyHint.hidden = hasAny;
    for (const r of rows) {
      const name = typeof r.displayName === "string" && r.displayName.trim() ? r.displayName.trim() : "訪客";
      const text = typeof r.text === "string" ? r.text : "";
      const rating = typeof r.rating === "number" && r.rating >= 1 && r.rating <= 5 ? r.rating : 0;
      const timeEl = el("time", { class: "guestbook-card__time" }, [formatPostTime(r.createdAt)]);
      if (r.createdAt?.seconds) {
        timeEl.dateTime = new Date(r.createdAt.seconds * 1000).toISOString();
      }
      const card = el("article", { class: "guestbook-card" }, [
        el("header", { class: "guestbook-card__head" }, [
          starRowStatic(rating),
          el("span", { class: "guestbook-card__name" }, [name]),
          timeEl,
        ]),
        el("p", { class: "guestbook-card__text" }, [text]),
      ]);
      listHost.append(card);
    }
  }

  function startListListener() {
    listUnsub?.();
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"), limit(50));
    listUnsub = onSnapshot(
      q,
      (snap) => {
        emptyHint.classList.remove("error");
        emptyHint.textContent = "尚無留言，歡迎成為第一位。";
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderList(rows);
      },
      (err) => {
        emptyHint.textContent = firestoreHint(err, "無法載入留言");
        emptyHint.classList.add("error");
        emptyHint.hidden = false;
      },
    );
  }

  guestBtn.addEventListener("click", async () => {
    statusLine.textContent = "";
    statusLine.className = "status-line";
    guestBtn.setAttribute("disabled", "true");
    try {
      await signInAnonymously(auth);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "無法啟用訪客身分";
      statusLine.textContent =
        raw.includes("OPERATION_NOT_ALLOWED") || raw.includes("admin-restricted-operation")
          ? "專案尚未啟用「匿名登入」：請至 Firebase Console → Authentication → Sign-in method 開啟 Anonymous。"
          : raw;
      statusLine.className = "status-line error";
    } finally {
      guestBtn.removeAttribute("disabled");
    }
  });

  submitBtn.addEventListener("click", async () => {
    statusLine.textContent = "";
    statusLine.className = "status-line";
    const u = auth.currentUser;
    if (!u) {
      statusLine.textContent = "請先啟用訪客身分或登入會員。";
      statusLine.classList.add("error");
      return;
    }
    const displayName = nameInput.value.trim();
    const text = textArea.value.trim();
    if (!displayName) {
      statusLine.textContent = "請填寫顯示名稱。";
      statusLine.classList.add("error");
      return;
    }
    if (selectedStars < 1 || selectedStars > 5) {
      statusLine.textContent = "請點選 1～5 星評分。";
      statusLine.classList.add("error");
      return;
    }
    if (!text) {
      statusLine.textContent = "請填寫心得內容。";
      statusLine.classList.add("error");
      return;
    }
    submitBtn.setAttribute("disabled", "true");
    try {
      await addDoc(collection(db, COLLECTION), {
        authorUid: u.uid,
        displayName,
        text,
        rating: selectedStars,
        createdAt: serverTimestamp(),
      });
      textArea.value = "";
      selectedStars = 0;
      syncStarButtons();
      statusLine.textContent = "已送出，感謝您的回饋！";
      statusLine.classList.add("ok");
    } catch (e) {
      statusLine.textContent = firestoreHint(e, "送出失敗");
      statusLine.classList.add("error");
    } finally {
      submitBtn.removeAttribute("disabled");
    }
  });

  startListListener();
  setComposerForUser(auth.currentUser);
  authUnsub = onAuthStateChanged(auth, (u) => setComposerForUser(u));

  return () => {
    listUnsub?.();
    listUnsub = null;
    authUnsub?.();
    authUnsub = null;
    mount.replaceChildren();
  };
}
