import { type Auth } from "firebase/auth";
import {
  type Firestore,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { setGuestbookPostAdminReplyCall } from "./firebase";
import { intlLocaleTag, localeApiParam, t } from "./i18n";

const COLLECTION = "guestbookPosts";
const MAX_REPLY = 800;

export type AdminGuestbookUnmount = () => void;

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

function formatTime(ts: { seconds?: number } | undefined): string {
  if (!ts?.seconds) return "";
  const d = new Date(ts.seconds * 1000);
  return d.toLocaleString(intlLocaleTag(), {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function snippet(s: string, max = 72): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type PostRow = {
  id: string;
  displayName?: unknown;
  text?: unknown;
  rating?: unknown;
  createdAt?: { seconds: number };
  adminReply?: unknown;
  adminRepliedAt?: { seconds: number };
};

/** 後台：心得列表 + 單則公開回覆（寫入 guestbookPosts，預約頁同步顯示） */
export function mountAdminGuestbook(db: Firestore, auth: Auth, mount: HTMLElement): AdminGuestbookUnmount {
  const wrap = el("div", { class: "admin-guestbook" }, []);
  const head = el("h3", {}, [t("adminGuestbook.title", "心得與評價回覆")]);
  const hint = el("p", { class: "hint" }, [
    t(
      "adminGuestbook.intro",
      "左側為最新心得（與預約頁相同資料）；點選後於右側撰寫一則店家回覆，儲存後會公開顯示在該則心得下方。可清除回覆以撤下公開內容。",
    ),
  ]);
  const statusLine = el("div", { class: "status-line" });
  const split = el("div", { class: "support-chat-admin-split" });
  const listCol = el("div", { class: "support-chat-admin-list" });
  const detailCol = el("div", { class: "support-chat-admin-detail" });
  split.append(listCol, detailCol);

  const listScroll = el("div", {
    class: "support-chat-admin-list-scroll",
    id: "admin-guestbook-list-scroll",
    role: "listbox",
    ariaLabel: t("adminGuestbook.listAria", "心得列表"),
  });
  listCol.append(el("h4", { class: "admin-subhead" }, [t("adminGuestbook.listHead", "心得列表")]), listScroll);

  const detailPlaceholder = el("p", { class: "hint" }, [t("adminGuestbook.pickPost", "請由左側選擇一則心得。")]);
  const detailHead = el("div", { class: "support-chat-admin-detail-head" });
  const postBody = el("div", { class: "admin-guestbook-post-body" });
  const replyLabel = el("label", { class: "field" }, [t("adminGuestbook.replyLabel", "店家公開回覆")]);
  const replyTa = el("textarea", {
    class: "support-chat-input",
    rows: 4,
    maxLength: MAX_REPLY,
    placeholder: t("adminGuestbook.replyPh", "感謝支持…（會顯示在預約頁該則心得下方）"),
  });
  replyLabel.append(replyTa);
  const actions = el("div", { class: "row-actions admin-guestbook-actions" });
  const saveBtn = el("button", { type: "button", class: "primary" }, [t("adminGuestbook.save", "儲存回覆")]);
  const clearBtn = el("button", { type: "button", class: "ghost" }, [t("adminGuestbook.clear", "清除公開回覆")]);
  actions.append(saveBtn, clearBtn);
  detailCol.append(detailPlaceholder, detailHead, postBody, replyLabel, actions);
  detailHead.hidden = true;
  postBody.hidden = true;
  replyLabel.hidden = true;
  actions.hidden = true;

  wrap.append(head, hint, statusLine, split);
  mount.append(wrap);

  let listUnsub: (() => void) | null = null;
  let latestDocs: PostRow[] = [];
  let selectedId: string | null = null;
  const btnById = new Map<string, HTMLButtonElement>();

  function postFromDoc(d: { id: string; data: () => Record<string, unknown> }): PostRow {
    const data = d.data();
    return { id: d.id, ...data };
  }

  function renderList() {
    listScroll.replaceChildren();
    btnById.clear();
    if (latestDocs.length === 0) {
      listScroll.append(
        el("p", { class: "support-chat-admin-list-empty" }, [t("adminGuestbook.empty", "尚無心得留言。")]),
      );
      return;
    }
    for (const row of latestDocs) {
      const name =
        typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : t("adminGuestbook.guestName", "訪客");
      const text = typeof row.text === "string" ? row.text : "";
      const rating = typeof row.rating === "number" && row.rating >= 1 && row.rating <= 5 ? row.rating : 0;
      const hasReply = typeof row.adminReply === "string" && row.adminReply.trim().length > 0;
      const b = el("button", {
        type: "button",
        class: "support-chat-thread-item",
        role: "option",
      });
      b.append(
        el("div", { class: "support-chat-thread-item-id" }, [
          `${"★".repeat(rating)}${rating ? " " : ""}${name}`,
        ]),
        el("div", { class: "support-chat-thread-item-preview" }, [snippet(text)]),
        el("div", { class: "support-chat-thread-item-status" }, [
          formatTime(row.createdAt),
          hasReply ? ` · ${t("adminGuestbook.hasReply", "已回覆")}` : "",
        ]),
      );
      b.addEventListener("click", () => selectPost(row.id));
      btnById.set(row.id, b);
      listScroll.append(b);
    }
    syncSelectionHighlight();
    if (selectedId && !latestDocs.some((x) => x.id === selectedId)) {
      selectedId = null;
      clearDetail();
    } else if (selectedId) {
      fillDetail(latestDocs.find((x) => x.id === selectedId)!);
    }
  }

  function syncSelectionHighlight() {
    for (const [id, b] of btnById) {
      b.classList.toggle("is-active", id === selectedId);
      b.setAttribute("aria-selected", id === selectedId ? "true" : "false");
    }
  }

  function clearDetail() {
    detailPlaceholder.hidden = false;
    detailHead.hidden = true;
    postBody.hidden = true;
    replyLabel.hidden = true;
    actions.hidden = true;
    detailHead.replaceChildren();
    postBody.replaceChildren();
    replyTa.value = "";
  }

  function fillDetail(row: PostRow) {
    detailPlaceholder.hidden = true;
    detailHead.hidden = false;
    postBody.hidden = false;
    replyLabel.hidden = false;
    actions.hidden = false;
    const name =
      typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : t("adminGuestbook.guestName", "訪客");
    const text = typeof row.text === "string" ? row.text : "";
    const rating = typeof row.rating === "number" && row.rating >= 1 && row.rating <= 5 ? row.rating : 0;
    detailHead.replaceChildren(
      el("strong", {}, [name]),
      el("code", { class: "support-chat-admin-uid" }, [row.id]),
      el("div", { class: "hint admin-guestbook-post-meta" }, [`${"★".repeat(rating)} · ${formatTime(row.createdAt)}`]),
    );
    postBody.replaceChildren(el("p", { class: "admin-guestbook-post-text" }, [text]));
    const existing = typeof row.adminReply === "string" ? row.adminReply : "";
    replyTa.value = existing;
  }

  function selectPost(id: string) {
    selectedId = id;
    syncSelectionHighlight();
    const row = latestDocs.find((x) => x.id === id);
    if (row) fillDetail(row);
    statusLine.textContent = "";
    statusLine.className = "status-line";
  }

  async function saveReply(clear: boolean) {
    if (!selectedId || !auth.currentUser) return;
    statusLine.textContent = "";
    statusLine.className = "status-line";
    const text = clear ? "" : replyTa.value.trim();
    if (!clear && text.length < 1) {
      statusLine.textContent = t("adminGuestbook.needText", "請輸入回覆內容，或改用「清除公開回覆」。");
      statusLine.classList.add("error");
      return;
    }
    saveBtn.setAttribute("disabled", "true");
    clearBtn.setAttribute("disabled", "true");
    try {
      const fn = setGuestbookPostAdminReplyCall();
      await fn({ postId: selectedId, text, ...localeApiParam() });
      if (clear) {
        replyTa.value = "";
        statusLine.textContent = t("adminGuestbook.clearedOk", "已清除公開回覆。");
      } else {
        statusLine.textContent = t("adminGuestbook.savedOk", "已儲存，預約頁將顯示此回覆。");
      }
      statusLine.classList.add("ok");
    } catch (e) {
      statusLine.textContent = firestorePermissionHint(e, t("adminGuestbook.saveFail", "儲存失敗"));
      statusLine.classList.add("error");
    } finally {
      saveBtn.removeAttribute("disabled");
      clearBtn.removeAttribute("disabled");
    }
  }

  saveBtn.addEventListener("click", () => void saveReply(false));
  clearBtn.addEventListener("click", () => {
    if (!selectedId) return;
    if (!window.confirm(t("adminGuestbook.clearConfirm", "確定要清除此則公開回覆嗎？"))) return;
    void saveReply(true);
  });

  listUnsub = onSnapshot(
    query(collection(db, COLLECTION), orderBy("createdAt", "desc"), limit(100)),
    (snap) => {
      latestDocs = snap.docs.map((d) => postFromDoc(d));
      renderList();
    },
    (e) => {
      statusLine.textContent = e instanceof Error ? e.message : t("adminGuestbook.listFail", "無法載入心得列表");
      statusLine.className = "status-line error";
    },
  );

  return () => {
    listUnsub?.();
    listUnsub = null;
    mount.replaceChildren();
  };
}
