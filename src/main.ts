import "./style.css";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  doc,
} from "firebase/firestore";
import {
  createBookingCall,
  getAvailabilityCall,
  getDb,
  getFirebaseAuth,
  isFirebaseConfigured,
} from "./firebase";
import { allStartSlots } from "./slots";

type Booking = {
  id: string;
  displayName: string;
  note: string;
  dateKey: string;
  startSlot: string;
  status: string;
  startAt?: { seconds: number };
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "待確認" },
  { value: "confirmed", label: "已確認" },
  { value: "done", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

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

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "發生錯誤";
}

function isDateKeyMonFri(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  if (!y || !m || !d) return false;
  const dow = new Date(y, m - 1, d).getDay();
  return dow >= 1 && dow <= 5;
}

function formatWhen(b: Booking): string {
  const base = `${b.dateKey} ${b.startSlot}`;
  if (!b.startAt?.seconds) return base;
  const d = new Date(b.startAt.seconds * 1000);
  return `${base}（${d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}）`;
}

function render() {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = "";

  if (!isFirebaseConfigured()) {
    root.append(
      el("div", { class: "banner" }, [
        "尚未設定 Firebase：請複製 `.env.example` 為 `.env`，填入專案設定後執行 `npm run dev`。",
      ]),
    );
    return;
  }

  const auth = getFirebaseAuth();
  const db = getDb();

  let tab: "book" | "admin" = "book";

  const titleBlock = el("div", {}, [
    el("h1", {}, ["辦公室按摩預約"]),
    el("p", {}, ["週一至週五 · 以 30 分鐘估算 · 最晚 17:30 開始、18:00 前結束"]),
  ]);

  const tabs = el("div", { class: "tabs" }, []);
  const tabBook = el("button", { class: "tab", type: "button" }, ["預約"]);
  const tabAdmin = el("button", { class: "tab", type: "button" }, ["管理後台"]);
  tabBook.setAttribute("aria-selected", "true");
  tabAdmin.setAttribute("aria-selected", "false");
  tabs.append(tabBook, tabAdmin);

  const panelBook = el("main", { class: "panel" });
  const panelAdmin = el("main", { class: "panel", hidden: true });

  const shell = el("div", { class: "shell" }, [
    el("header", { class: "page-head" }, [titleBlock, tabs]),
    panelBook,
    panelAdmin,
  ]);

  root.append(shell);

  const announcementBox = el("div", { class: "marquee", hidden: true });
  onSnapshot(
    doc(db, "siteSettings", "announcement"),
    (snap) => {
      const data = snap.data() as { text?: unknown; enabled?: unknown } | undefined;
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      const enabled = typeof data?.enabled === "boolean" ? data.enabled : false;
      if (!enabled || !text) {
        announcementBox.hidden = true;
        announcementBox.textContent = "";
        return;
      }
      announcementBox.hidden = false;
      announcementBox.innerHTML = "";
      announcementBox.append(el("div", { class: "marquee-track" }, [text, "  •  ", text]));
    },
    () => {
      announcementBox.hidden = true;
      announcementBox.textContent = "";
    },
  );
  shell.prepend(announcementBox);

  /** --- 預約表單 --- */
  const nameInput = el("input", { type: "text", autocomplete: "name", maxLength: 80 });
  const dateInput = el("input", { type: "date" });
  const slotSelect = el("select", {}, []);
  const noteInput = el("textarea", { maxLength: 500 });
  const submitBtn = el("button", { class: "primary", type: "button" }, ["送出預約"]);
  const bookStatus = el("div", { class: "status-line" });
  const meta = el("div", { class: "meta-pills" });

  function refillSlots(taken: Set<string>, disabled: boolean) {
    slotSelect.innerHTML = "";
    slotSelect.disabled = disabled;
    const opt0 = el("option", { value: "" }, ["請選擇開始時間"]);
    slotSelect.append(opt0);
    for (const s of allStartSlots()) {
      const takenHere = taken.has(s);
      const o = el("option", { value: s, disabled: takenHere }, [
        `${s}${takenHere ? "（已佔用）" : ""}`,
      ]);
      slotSelect.append(o);
    }
  }

  refillSlots(new Set(), true);

  async function refreshAvailability() {
    bookStatus.textContent = "";
    bookStatus.className = "status-line";
    meta.innerHTML = "";
    const dk = dateInput.value;
    if (!dk) {
      refillSlots(new Set(), true);
      meta.append(
        el("span", { class: "pill" }, ["先選擇日期後，會顯示可選時段與名額"]),
      );
      return;
    }

    if (!isDateKeyMonFri(dk)) {
      refillSlots(new Set(), true);
      bookStatus.textContent = "僅能預約週一到週五。";
      bookStatus.classList.add("error");
      return;
    }

    try {
      const fn = getAvailabilityCall();
      const res = await fn({ dateKey: dk });
      const data = res.data as {
        taken: string[];
        dayCount: number;
        weekCount: number;
        dayCap: number;
        weekCap: number;
      };
      const taken = new Set(data.taken);
      const dayFull = data.dayCount >= data.dayCap;
      const weekFull = data.weekCount >= data.weekCap;
      const blocked = dayFull || weekFull;

      refillSlots(taken, blocked);
      meta.append(
        el("span", { class: "pill" }, [
          "當日已預約 ",
          el("strong", {}, [String(data.dayCount)]),
          ` / ${data.dayCap}`,
        ]),
        el("span", { class: "pill" }, [
          "本工作週已預約 ",
          el("strong", {}, [String(data.weekCount)]),
          ` / ${data.weekCap}`,
        ]),
      );
      if (dayFull) {
        bookStatus.textContent = "這一天已額滿。";
        bookStatus.classList.add("error");
      } else if (weekFull) {
        bookStatus.textContent = "本工作週已達上限。";
        bookStatus.classList.add("error");
      }
    } catch (e) {
      console.error(e);
      refillSlots(new Set(), true);
      bookStatus.textContent = "無法載入空檔，請稍後再試。";
      bookStatus.classList.add("error");
    }
  }

  dateInput.addEventListener("change", refreshAvailability);

  submitBtn.addEventListener("click", async () => {
    bookStatus.textContent = "";
    bookStatus.className = "status-line";
    const displayName = nameInput.value.trim();
    const dateKey = dateInput.value;
    const startSlot = slotSelect.value;
    const note = noteInput.value.trim();
    if (!displayName) {
      bookStatus.textContent = "請填寫姓名。";
      bookStatus.classList.add("error");
      return;
    }
    if (!dateKey || !startSlot) {
      bookStatus.textContent = "請選擇日期與開始時間。";
      bookStatus.classList.add("error");
      return;
    }
    submitBtn.setAttribute("disabled", "true");
    try {
      const fn = createBookingCall();
      await fn({ displayName, note, dateKey, startSlot });
      bookStatus.textContent = "已送出！狀態為「待確認」，實際時間會依現場情況微調。";
      bookStatus.classList.add("ok");
      nameInput.value = "";
      noteInput.value = "";
      await refreshAvailability();
    } catch (e) {
      bookStatus.textContent = errorMessage(e);
      bookStatus.classList.add("error");
    } finally {
      submitBtn.removeAttribute("disabled");
    }
  });

  panelBook.append(
    el("div", { class: "grid grid-2" }, [
      el("label", { class: "field" }, [
        "姓名",
        nameInput,
        el("span", { class: "hint" }, ["不需登入；僅作為辦公室內辨識用"]),
      ]),
      el("label", { class: "field" }, [
        "日期（週一至週五）",
        dateInput,
        el("span", { class: "hint" }, ["請選擇你有空的上班日"]),
      ]),
    ]),
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        "開始時間（30 分鐘一格）",
        slotSelect,
        el("span", { class: "hint" }, ["系統以約 30 分鐘估算；實際長度依情況調整"]),
      ]),
    ]),
    meta,
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, ["備註（選填）", noteInput]),
    ]),
    el("div", { class: "row-actions" }, [submitBtn]),
    bookStatus,
    el("div", { class: "footer-note" }, [
      "規則：同一天最多兩位、同一工作週最多四筆；已取消的不計入名額。",
    ]),
  );

  /** --- 管理後台 --- */
  const adminWrap = el("div", {}, []);
  panelAdmin.append(adminWrap);

  let adminUnsub: (() => void) | null = null;
  let adminAnnouncementUnsub: (() => void) | null = null;

  function stopAdminListener() {
    if (adminUnsub) {
      adminUnsub();
      adminUnsub = null;
    }
    if (adminAnnouncementUnsub) {
      adminAnnouncementUnsub();
      adminAnnouncementUnsub = null;
    }
  }

  function renderAdminLoggedOut() {
    stopAdminListener();
    adminWrap.innerHTML = "";
    const box = el("div", { class: "admin-login" }, []);
    const email = el("input", { type: "email", autocomplete: "username" });
    const password = el("input", { type: "password", autocomplete: "current-password" });
    const loginBtn = el("button", { class: "primary", type: "button" }, ["登入"]);
    const adminStatus = el("div", { class: "status-line" });
    loginBtn.addEventListener("click", async () => {
      adminStatus.textContent = "";
      adminStatus.className = "status-line";
      loginBtn.setAttribute("disabled", "true");
      try {
        await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      } catch (e) {
        adminStatus.textContent = e instanceof Error ? e.message : "登入失敗";
        adminStatus.classList.add("error");
      } finally {
        loginBtn.removeAttribute("disabled");
      }
    });
    box.append(
      el("p", { class: "hint" }, [
        "僅限管理員。請先在 Firebase Console 建立 Email/Password 帳號，並在 Firestore 新增文件 ",
        el("code", {}, ["admins/<你的 UID>"]),
        "（可用空物件 `{}`）。",
      ]),
      el("label", { class: "field" }, ["Email", email]),
      el("label", { class: "field" }, ["密碼", password]),
      loginBtn,
      adminStatus,
    );
    adminWrap.append(box);
  }

  function renderAdminTable(userId: string) {
    stopAdminListener();
    adminWrap.innerHTML = "";
    const top = el("div", { class: "row-actions" }, []);
    const who = el("span", { class: "hint" }, [`已登入：${userId}`]);
    const outBtn = el("button", { class: "ghost", type: "button" }, ["登出"]);
    outBtn.addEventListener("click", () => signOut(auth));
    top.append(who, outBtn);

    const adminStatus = el("div", { class: "status-line" });
    const announcementSection = el("div", { class: "admin-announce" }, []);
    const announcementEnabled = el("input", { type: "checkbox" });
    const announcementText = el("textarea", {
      maxLength: 240,
      placeholder: "輸入公告內容，例如：本週三 15:00-16:00 暫停服務",
    });
    const saveAnnouncementBtn = el("button", { class: "ghost", type: "button" }, ["儲存公告"]);
    const announcementStatus = el("div", { class: "status-line" });

    const announcementDocRef = doc(db, "siteSettings", "announcement");
    adminAnnouncementUnsub = onSnapshot(
      announcementDocRef,
      (snap) => {
        const data = snap.data() as { text?: unknown; enabled?: unknown } | undefined;
        announcementText.value = typeof data?.text === "string" ? data.text : "";
        announcementEnabled.checked = typeof data?.enabled === "boolean" ? data.enabled : false;
      },
      () => {
        announcementStatus.textContent = "無法讀取公告設定。";
        announcementStatus.className = "status-line error";
      },
    );
    saveAnnouncementBtn.addEventListener("click", async () => {
      announcementStatus.textContent = "儲存中…";
      announcementStatus.className = "status-line";
      saveAnnouncementBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          announcementDocRef,
          {
            text: announcementText.value.trim(),
            enabled: announcementEnabled.checked,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        announcementStatus.textContent = "公告已更新";
        announcementStatus.classList.add("ok");
      } catch (e) {
        announcementStatus.textContent = e instanceof Error ? e.message : "公告更新失敗";
        announcementStatus.classList.add("error");
      } finally {
        saveAnnouncementBtn.removeAttribute("disabled");
      }
    });

    announcementSection.append(
      el("h3", {}, ["跑馬燈公告"]),
      el("label", { class: "field" }, ["公告內容", announcementText]),
      el("label", { class: "field checkbox-field" }, [
        announcementEnabled,
        el("span", {}, ["啟用公告"]),
      ]),
      el("div", { class: "row-actions" }, [saveAnnouncementBtn]),
      announcementStatus,
    );
    const tableHolder = el("div", { class: "table-wrap" });
    const table = el("table", {}, []);
    table.append(
      el("tr", {}, [
        el("th", {}, ["時間"]),
        el("th", {}, ["姓名"]),
        el("th", {}, ["備註"]),
        el("th", {}, ["狀態"]),
      ]),
    );
    tableHolder.append(table);

    adminWrap.append(top, announcementSection, adminStatus, tableHolder);

    const q = query(collection(db, "bookings"), orderBy("startAt", "desc"));
    adminUnsub = onSnapshot(
      q,
      (snap) => {
        adminStatus.textContent = "";
        adminStatus.className = "status-line";
        // 保留表頭
        table.innerHTML = "";
        table.append(
          el("tr", {}, [
            el("th", {}, ["時間"]),
            el("th", {}, ["姓名"]),
            el("th", {}, ["備註"]),
            el("th", {}, ["狀態"]),
          ]),
        );
        for (const d of snap.docs) {
          const b = { id: d.id, ...d.data() } as Booking;
          const sel = el("select", {}, []);
          for (const opt of STATUS_OPTIONS) {
            const o = el("option", { value: opt.value }, [opt.label]);
            if (opt.value === b.status) o.setAttribute("selected", "selected");
            sel.append(o);
          }
          sel.addEventListener("change", async () => {
            adminStatus.textContent = "更新中…";
            try {
              await updateDoc(doc(db, "bookings", b.id), {
                status: sel.value,
                updatedAt: serverTimestamp(),
              });
              adminStatus.textContent = "已更新";
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent =
                e instanceof Error ? e.message : "更新失敗（你是否已加入 admins 集合？）";
              adminStatus.classList.add("error");
            }
          });
          table.append(
            el("tr", {}, [
              el("td", { class: "mono" }, [formatWhen(b)]),
              el("td", {}, [b.displayName ?? ""]),
              el("td", {}, [b.note ?? ""]),
              el("td", {}, [sel]),
            ]),
          );
        }
      },
      (err) => {
        console.error(err);
        adminStatus.textContent =
          "無法讀取預約（常見原因：Firestore Rules 拒絕，或尚未建立索引／admins 文件）。";
        adminStatus.classList.add("error");
      },
    );
  }

  onAuthStateChanged(auth, (user) => {
    if (tab !== "admin") return;
    if (!user) renderAdminLoggedOut();
    else renderAdminTable(user.uid);
  });

  function setTab(next: "book" | "admin") {
    tab = next;
    const isBook = next === "book";
    tabBook.setAttribute("aria-selected", isBook ? "true" : "false");
    tabAdmin.setAttribute("aria-selected", isBook ? "false" : "true");
    panelBook.hidden = !isBook;
    panelAdmin.hidden = isBook;
    if (isBook) {
      stopAdminListener();
    } else if (auth.currentUser) {
      renderAdminTable(auth.currentUser.uid);
    } else {
      renderAdminLoggedOut();
    }
  }

  tabBook.addEventListener("click", () => setTab("book"));
  tabAdmin.addEventListener("click", () => setTab("admin"));

  setTab("book");
}

render();
