import { signInAnonymously, type Auth, type User } from "firebase/auth";
import {
  type Firestore,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import {
  listMembersAdminCall,
  sendSupportChatAdminReplyCall,
  sendSupportChatMessageCall,
  setSupportThreadStatusAdminCall,
} from "./firebase";

const THREADS = "supportThreads";
const MAX_MSG = 2000;
type ThreadStatus = "open" | "closed";
type CustomerKind = "member" | "guest";

export type SupportChatUnmount = () => void;

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

function formatMsgTime(ts: { seconds?: number } | undefined): string {
  if (!ts?.seconds) return "";
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function firestorePermissionHint(err: unknown, context: string): string {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
  const msg = err instanceof Error && err.message ? err.message : "";
  if (code === "permission-denied" || code === "functions/permission-denied") {
    return `${context}（${code}）若已部署 Cloud Functions，請執行：firebase deploy --only functions。訊息：${msg || "—"}`;
  }
  if (msg) return `${context}（${code || "錯誤"}）：${msg}`;
  return context;
}

/** 前台：單一對話串（文件 id = Auth uid，含匿名訪客），即時訊息 */
export function mountMemberSupportChat(db: Firestore, auth: Auth, mount: HTMLElement): SupportChatUnmount {
  const wrap = el("section", { class: "support-chat support-chat--member" }, []);
  const head = el("h4", { class: "admin-subhead" }, ["聯絡店家"]);
  const hint = el("p", { class: "hint" }, []);
  const statusLine = el("div", { class: "status-line" });
  const guestGate = el("div", { class: "support-chat-guest-gate" });
  const guestGateHint = el("p", { class: "hint" }, [
    "不需註冊即可留言：按下後會在此裝置建立匿名身分（僅用於客服對話）。若要儲值或管理預約，請使用右上角「會員登入」。",
  ]);
  const guestStartBtn = el("button", { type: "button", class: "primary" }, ["以訪客身分開始留言"]);
  guestGate.append(guestGateHint, guestStartBtn);
  const log = el("div", { class: "support-chat-log", tabIndex: 0 });
  const reopenRow = el("div", { class: "row-actions support-chat-reopen" });
  const reopenBtn = el("button", { type: "button", class: "ghost" }, ["繼續諮詢（重新開啟對話）"]);
  reopenRow.append(reopenBtn);
  const inputRow = el("div", { class: "support-chat-input-row" });
  const ta = el("textarea", {
    class: "support-chat-input",
    rows: 2,
    maxLength: MAX_MSG,
    placeholder: "輸入訊息…",
  });
  const sendBtn = el("button", { type: "button", class: "primary" }, ["送出"]);
  inputRow.append(ta, sendBtn);
  wrap.append(head, hint, statusLine, guestGate, log, reopenRow, inputRow);
  mount.append(wrap);

  let threadUnsub: (() => void) | null = null;
  let msgsUnsub: (() => void) | null = null;
  let threadStatus: ThreadStatus | null = null;
  let uid: string | null = null;

  function clearListeners() {
    threadUnsub?.();
    threadUnsub = null;
    msgsUnsub?.();
    msgsUnsub = null;
  }

  function renderMessages(
    snapList: { id: string; text?: string; sender?: string; createdAt?: { seconds: number } }[],
  ) {
    log.replaceChildren();
    for (const m of snapList) {
      const text = typeof m.text === "string" ? m.text : "";
      const who = m.sender === "admin" ? "店家" : "我";
      const bubble = el("div", { class: `support-chat-bubble support-chat-bubble--${m.sender === "admin" ? "them" : "me"}` }, [
        el("div", { class: "support-chat-bubble-meta" }, [`${who} · ${formatMsgTime(m.createdAt)}`]),
        el("div", { class: "support-chat-bubble-text" }, [text]),
      ]);
      log.append(bubble);
    }
    log.scrollTop = log.scrollHeight;
  }

  function setHintForUser(u: User | null) {
    hint.replaceChildren();
    if (!u) {
      hint.append(
        "已登入會員可在此聯絡店家；未登入者請先按下方按鈕以訪客身分開始。送出後店家會於後台回覆。",
      );
      return;
    }
    if (u.isAnonymous) {
      hint.append(
        "您正以訪客身分留言；紀錄綁在此瀏覽器與裝置。若清除網站資料或換裝置，可能無法延續同一對話。登入會員後可使用儲值與預約紀錄（訪客對話不會自動合併）。",
      );
      return;
    }
    hint.append("已使用會員帳號登入；留言後店家會於後台看到並回覆。");
  }

  function syncThreadUi() {
    const closed = threadStatus === "closed";
    reopenRow.hidden = !closed;
    inputRow.hidden = closed;
    ta.disabled = closed;
    sendBtn.disabled = closed;
  }

  async function sendMessage() {
    statusLine.textContent = "";
    statusLine.className = "status-line";
    const text = ta.value.trim();
    if (!text) {
      statusLine.textContent = "請輸入內容。";
      statusLine.classList.add("error");
      return;
    }
    sendBtn.setAttribute("disabled", "true");
    try {
      const fn = sendSupportChatMessageCall();
      await fn({ text });
      ta.value = "";
    } catch (e) {
      statusLine.textContent = firestorePermissionHint(e, "送出失敗");
      statusLine.classList.add("error");
    } finally {
      sendBtn.removeAttribute("disabled");
    }
  }

  reopenBtn.addEventListener("click", async () => {
    if (!uid) return;
    statusLine.textContent = "";
    statusLine.className = "status-line";
    reopenBtn.setAttribute("disabled", "true");
    try {
      const fn = sendSupportChatMessageCall();
      await fn({ reopen: true });
    } catch (e) {
      statusLine.textContent = firestorePermissionHint(e, "無法重新開啟");
      statusLine.classList.add("error");
    } finally {
      reopenBtn.removeAttribute("disabled");
    }
  });

  guestStartBtn.addEventListener("click", async () => {
    statusLine.textContent = "";
    statusLine.className = "status-line";
    guestStartBtn.setAttribute("disabled", "true");
    try {
      await signInAnonymously(auth);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "無法開始訪客留言";
      statusLine.textContent =
        raw.includes("OPERATION_NOT_ALLOWED") || raw.includes("admin-restricted-operation")
          ? "專案尚未啟用「匿名登入」：請至 Firebase Console → Authentication → Sign-in method 開啟 Anonymous。"
          : raw;
      statusLine.classList.add("error");
    } finally {
      guestStartBtn.removeAttribute("disabled");
    }
  });

  sendBtn.addEventListener("click", () => {
    if (auth.currentUser) void sendMessage();
  });

  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      if (auth.currentUser) void sendMessage();
    }
  });

  function attachForUser(u: User) {
    clearListeners();
    uid = u.uid;
    wrap.hidden = false;
    guestGate.hidden = true;
    threadUnsub = onSnapshot(
      doc(db, THREADS, u.uid),
      (snap) => {
        if (!snap.exists()) {
          threadStatus = "open";
          syncThreadUi();
          return;
        }
        const st = snap.data()?.status;
        threadStatus = st === "closed" ? "closed" : "open";
        syncThreadUi();
      },
      (err) => {
        statusLine.textContent = firestorePermissionHint(err, "無法載入對話狀態");
        statusLine.className = "status-line error";
      },
    );
    const q = query(collection(db, THREADS, u.uid, "messages"), orderBy("createdAt", "asc"), limit(200));
    msgsUnsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as {
          id: string;
          text?: string;
          sender?: string;
          createdAt?: { seconds: number };
        }[];
        renderMessages(list);
      },
      (err) => {
        statusLine.textContent = firestorePermissionHint(err, "無法載入訊息");
        statusLine.className = "status-line error";
      },
    );
  }

  const offAuth = auth.onAuthStateChanged((u) => {
    clearListeners();
    statusLine.textContent = "";
    statusLine.className = "status-line";
    setHintForUser(u);
    if (!u) {
      uid = null;
      wrap.hidden = false;
      guestGate.hidden = false;
      log.replaceChildren();
      reopenRow.hidden = true;
      inputRow.hidden = true;
      ta.disabled = true;
      sendBtn.disabled = true;
      threadStatus = null;
      return;
    }
    attachForUser(u);
  });

  return () => {
    offAuth();
    clearListeners();
    wrap.remove();
  };
}

/** 後台：對話列表 + 回覆 */
export function mountAdminSupportChat(db: Firestore, auth: Auth, mount: HTMLElement): SupportChatUnmount {
  const wrap = el("div", { class: "support-chat support-chat--admin" }, []);
  const head = el("h3", {}, ["客服對話"]);
  const hint = el("p", { class: "hint" }, [
    "左側為會員對話列表（進行中優先、各組內依最近更新排序）；點選後於右側回覆。Firestore：",
    el("code", {}, [`${THREADS}/{會員UID}`]),
    " 與子集合 ",
    el("code", {}, ["messages"]),
    "。",
  ]);
  const statusLine = el("div", { class: "status-line" });
  const split = el("div", { class: "support-chat-admin-split" });
  const listCol = el("div", { class: "support-chat-admin-list" });
  const detailCol = el("div", { class: "support-chat-admin-detail" });
  split.append(listCol, detailCol);

  const listScroll = el("div", { class: "support-chat-admin-list-scroll" });
  listCol.append(el("h4", { class: "admin-subhead" }, ["對話列表"]), listScroll);

  const detailPlaceholder = el("p", { class: "hint" }, ["請由左側選擇一則對話。"]);
  const detailHead = el("div", { class: "support-chat-admin-detail-head" });
  const closeRow = el("div", { class: "row-actions" });
  const closeBtn = el("button", { type: "button", class: "ghost" }, ["標記為已結束"]);
  const reopenAdminBtn = el("button", { type: "button", class: "ghost" }, ["重新開啟"]);
  closeRow.append(closeBtn, reopenAdminBtn);
  const log = el("div", { class: "support-chat-log" });
  const inputRow = el("div", { class: "support-chat-input-row" });
  const ta = el("textarea", {
    class: "support-chat-input",
    rows: 2,
    maxLength: MAX_MSG,
    placeholder: "回覆會員…",
  });
  const sendBtn = el("button", { type: "button", class: "primary" }, ["回覆"]);
  inputRow.append(ta, sendBtn);
  detailCol.append(detailPlaceholder, detailHead, closeRow, log, inputRow);
  detailHead.hidden = true;
  closeRow.hidden = true;
  log.hidden = true;
  inputRow.hidden = true;

  wrap.append(head, hint, statusLine, split);
  mount.append(wrap);

  let listUnsub: (() => void) | null = null;
  let msgsUnsub: (() => void) | null = null;
  let selectedCustomerId: string | null = null;
  let selectedStatus: ThreadStatus = "open";
  const threadDataByCustomer = new Map<string, Record<string, unknown>>();
  const identityByCustomer = new Map<string, { kind: CustomerKind; label: string }>();
  const memberDirectory = new Map<string, { nickname: string; email: string; emailVerified: boolean }>();
  let memberDirectoryReady = false;
  let latestThreadDocs: { id: string; data: () => Record<string, unknown> }[] = [];
  async function ensureMemberDirectoryLoaded() {
    if (memberDirectoryReady) return;
    memberDirectoryReady = true;
    try {
      const fn = listMembersAdminCall();
      const res = await fn({});
      const rows = Array.isArray((res.data as { members?: unknown }).members)
        ? ((res.data as { members: unknown[] }).members ?? [])
        : [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const uid = typeof (row as { uid?: unknown }).uid === "string" ? (row as { uid: string }).uid : "";
        if (!uid) continue;
        memberDirectory.set(uid, {
          nickname:
            typeof (row as { nickname?: unknown }).nickname === "string"
              ? (row as { nickname: string }).nickname.trim()
              : "",
          email:
            typeof (row as { email?: unknown }).email === "string" ? (row as { email: string }).email.trim() : "",
          emailVerified: (row as { emailVerified?: unknown }).emailVerified === true,
        });
      }
      if (latestThreadDocs.length > 0) {
        renderThreadList(latestThreadDocs);
      }
    } catch {
      // 會員資料載入失敗時，仍可回退到 thread/customers 判斷，不阻斷客服功能。
    }
  }

  function inferIdentityFromKnownData(customerId: string, data?: Record<string, unknown>): { kind: CustomerKind; label: string } {
    const fromMember = memberDirectory.get(customerId);
    if (fromMember) {
      if (!fromMember.email || !fromMember.emailVerified) return { kind: "guest", label: "訪客" };
      return { kind: "member", label: fromMember.nickname || "會員" };
    }
    return threadIdentityHint(data) ?? { kind: "guest", label: "訪客" };
  }


  const threadBtnByCustomer = new Map<string, HTMLButtonElement>();

  function clearDetailListeners() {
    msgsUnsub?.();
    msgsUnsub = null;
  }

  function threadIdentityHint(data: Record<string, unknown> | undefined): { kind: CustomerKind; label: string } | null {
    if (!data) return null;
    const labelRaw = typeof data.customerLabel === "string" ? data.customerLabel.trim() : "";
    const typeRaw = typeof data.customerType === "string" ? data.customerType.trim() : "";
    const isAnonymous = data.isAnonymous === true;
    if (typeRaw === "guest" || isAnonymous) return { kind: "guest", label: "訪客" };
    if (labelRaw) return { kind: "member", label: labelRaw };
    if (typeRaw === "member") return { kind: "member", label: "會員" };
    return null;
  }

  async function resolveCustomerIdentity(customerId: string): Promise<{ kind: CustomerKind; label: string }> {
    const cached = identityByCustomer.get(customerId);
    if (cached) return cached;
    await ensureMemberDirectoryLoaded();
    const member = memberDirectory.get(customerId);
    if (member) {
      if (!member.email || !member.emailVerified) {
        const guest = { kind: "guest" as const, label: "訪客" };
        identityByCustomer.set(customerId, guest);
        return guest;
      }
      const display = member.nickname || "會員";
      const identity = { kind: "member" as const, label: display };
      identityByCustomer.set(customerId, identity);
      return identity;
    }
    const hinted = threadIdentityHint(threadDataByCustomer.get(customerId));
    if (hinted) {
      identityByCustomer.set(customerId, hinted);
      return hinted;
    }
    try {
      const snap = await getDoc(doc(db, "customers", customerId));
      if (!snap.exists()) {
        const guest = { kind: "guest" as const, label: "訪客" };
        identityByCustomer.set(customerId, guest);
        return guest;
      }
      const data = snap.data();
      const nickname = typeof data?.nickname === "string" ? data.nickname.trim() : "";
      const member = { kind: "member" as const, label: nickname || "會員" };
      identityByCustomer.set(customerId, member);
      return member;
    } catch {
      const fallback = { kind: "member" as const, label: "會員" };
      identityByCustomer.set(customerId, fallback);
      return fallback;
    }
  }

  function renderDetailHead(customerId: string, identity?: { kind: CustomerKind; label: string }) {
    const name = identity?.label || "辨識中…";
    const role = identity ? (identity.kind === "member" ? "會員" : "") : "";
    detailHead.replaceChildren(
      el("div", { class: "support-chat-admin-detail-title" }, [`對象 ${name}${role ? `（${role}）` : ""}`]),
      el("code", { class: "mono support-chat-admin-uid" }, [`UID ${customerId}`]),
    );
  }

  function selectCustomer(customerId: string) {
    selectedCustomerId = customerId;
    for (const [id, btn] of threadBtnByCustomer) {
      btn.classList.toggle("is-active", id === customerId);
    }
    detailPlaceholder.hidden = true;
    detailHead.hidden = false;
    closeRow.hidden = false;
    log.hidden = false;
    inputRow.hidden = false;
    renderDetailHead(customerId, identityByCustomer.get(customerId));
    void resolveCustomerIdentity(customerId).then((identity) => {
      if (selectedCustomerId !== customerId) return;
      renderDetailHead(customerId, identity);
    });
    clearDetailListeners();
    const q = query(collection(db, THREADS, customerId, "messages"), orderBy("createdAt", "asc"), limit(300));
    msgsUnsub = onSnapshot(
      q,
      (snap) => {
        log.replaceChildren();
        for (const d of snap.docs) {
          const m = d.data() as { text?: string; sender?: string; createdAt?: { seconds: number } };
          const text = typeof m.text === "string" ? m.text : "";
          const who = m.sender === "admin" ? "店家" : "會員";
          const bubble = el("div", { class: `support-chat-bubble support-chat-bubble--${m.sender === "admin" ? "me" : "them"}` }, [
            el("div", { class: "support-chat-bubble-meta" }, [`${who} · ${formatMsgTime(m.createdAt)}`]),
            el("div", { class: "support-chat-bubble-text" }, [text]),
          ]);
          log.append(bubble);
        }
        log.scrollTop = log.scrollHeight;
      },
      () => {
        statusLine.textContent = "無法載入訊息。";
        statusLine.className = "status-line error";
      },
    );
    void getDoc(doc(db, THREADS, customerId)).then((s) => {
      const st = s.data()?.status;
      selectedStatus = st === "closed" ? "closed" : "open";
      ta.disabled = selectedStatus === "closed";
      sendBtn.disabled = selectedStatus === "closed";
      closeBtn.hidden = selectedStatus === "closed";
      reopenAdminBtn.hidden = selectedStatus === "open";
    });
  }

  function renderThreadList(
    docs: { id: string; data: () => Record<string, unknown> }[],
  ) {
    listScroll.replaceChildren();
    threadBtnByCustomer.clear();
    const sortedDocs = [...docs].sort((a, b) => {
      const aData = a.data();
      const bData = b.data();
      const aClosed = aData.status === "closed";
      const bClosed = bData.status === "closed";
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      const aUpdated =
        typeof aData.updatedAt === "object" &&
        aData.updatedAt !== null &&
        "seconds" in aData.updatedAt &&
        typeof (aData.updatedAt as { seconds?: unknown }).seconds === "number"
          ? ((aData.updatedAt as { seconds: number }).seconds ?? 0)
          : 0;
      const bUpdated =
        typeof bData.updatedAt === "object" &&
        bData.updatedAt !== null &&
        "seconds" in bData.updatedAt &&
        typeof (bData.updatedAt as { seconds?: unknown }).seconds === "number"
          ? ((bData.updatedAt as { seconds: number }).seconds ?? 0)
          : 0;
      return bUpdated - aUpdated;
    });
    for (const d of sortedDocs) {
      const id = d.id;
      const data = d.data();
      threadDataByCustomer.set(id, data);
      const identity = inferIdentityFromKnownData(id, data);
      identityByCustomer.set(id, identity);
      const preview = typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : "（尚無預覽）";
      const st = data.status === "closed" ? "已結束" : "進行中";
      const btn = el("button", { type: "button", class: "support-chat-thread-item" }, []);
      btn.classList.toggle("is-active", id === selectedCustomerId);
      btn.append(
        el("div", { class: "support-chat-thread-item-id" }, [identity.label]),
        el("div", { class: "support-chat-thread-item-uid mono" }, [`UID ${truncateUid(id)}`]),
        el("div", { class: "support-chat-thread-item-preview" }, [preview]),
        el("div", { class: "support-chat-thread-item-status" }, [st]),
      );
      btn.addEventListener("click", () => selectCustomer(id));
      threadBtnByCustomer.set(id, btn);
      listScroll.append(btn);
    }
  }

  function truncateUid(uid: string): string {
    if (uid.length <= 12) return uid;
    return `${uid.slice(0, 6)}…${uid.slice(-4)}`;
  }

  listUnsub = onSnapshot(
    query(collection(db, THREADS), orderBy("updatedAt", "desc"), limit(80)),
    (snap) => {
      statusLine.textContent = "";
      statusLine.className = "status-line";
      latestThreadDocs = snap.docs;
      void ensureMemberDirectoryLoaded();
      renderThreadList(snap.docs);
      if (selectedCustomerId && !snap.docs.some((x) => x.id === selectedCustomerId)) {
        selectedCustomerId = null;
        clearDetailListeners();
        detailPlaceholder.hidden = false;
        detailHead.hidden = true;
        closeRow.hidden = true;
        log.hidden = true;
        inputRow.hidden = true;
      }
    },
    (e) => {
      statusLine.textContent = e instanceof Error ? e.message : "無法載入列表";
      statusLine.className = "status-line error";
    },
  );

  async function sendAdminReply() {
    if (!selectedCustomerId || !auth.currentUser) return;
    statusLine.textContent = "";
    statusLine.className = "status-line";
    const text = ta.value.trim();
    if (!text) {
      statusLine.textContent = "請輸入回覆內容。";
      statusLine.classList.add("error");
      return;
    }
    const cid = selectedCustomerId;
    sendBtn.setAttribute("disabled", "true");
    try {
      const fn = sendSupportChatAdminReplyCall();
      await fn({ customerId: cid, text });
      ta.value = "";
    } catch (e) {
      statusLine.textContent = firestorePermissionHint(e, "送出失敗");
      statusLine.classList.add("error");
    } finally {
      sendBtn.removeAttribute("disabled");
    }
  }

  sendBtn.addEventListener("click", () => void sendAdminReply());
  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void sendAdminReply();
    }
  });

  closeBtn.addEventListener("click", async () => {
    if (!selectedCustomerId) return;
    closeBtn.setAttribute("disabled", "true");
    try {
      const fn = setSupportThreadStatusAdminCall();
      await fn({ customerId: selectedCustomerId, status: "closed" });
      selectedStatus = "closed";
      ta.disabled = true;
      sendBtn.disabled = true;
      closeBtn.hidden = true;
      reopenAdminBtn.hidden = false;
    } catch (e) {
      statusLine.textContent = e instanceof Error ? e.message : "更新失敗";
      statusLine.className = "status-line error";
    } finally {
      closeBtn.removeAttribute("disabled");
    }
  });

  reopenAdminBtn.addEventListener("click", async () => {
    if (!selectedCustomerId) return;
    reopenAdminBtn.setAttribute("disabled", "true");
    try {
      const fn = setSupportThreadStatusAdminCall();
      await fn({ customerId: selectedCustomerId, status: "open" });
      selectedStatus = "open";
      ta.disabled = false;
      sendBtn.disabled = false;
      closeBtn.hidden = false;
      reopenAdminBtn.hidden = true;
    } catch (e) {
      statusLine.textContent = e instanceof Error ? e.message : "更新失敗";
      statusLine.className = "status-line error";
    } finally {
      reopenAdminBtn.removeAttribute("disabled");
    }
  });

  return () => {
    listUnsub?.();
    listUnsub = null;
    clearDetailListeners();
    wrap.remove();
  };
}
