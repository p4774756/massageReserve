/**
 * 網頁「獎勵式影片」沒有像 Android AdMob 那樣一支 SDK 通吃；常見做法是
 * Google Ad Manager / IMA SDK 或遊戲中介層。此模組提供：
 * 1) `window.__MR_rewardedShow` 若由站方注入，則優先呼叫（便於之後接真實廣告）
 * 2) 否則顯示站內模擬覆蓋層（示範用，非真實廣告）
 */

function h<K extends keyof HTMLElementTagNameMap>(
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

function simulatedOverlay(strings: {
  title: string;
  body: string;
  completeLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = h("div", { class: "rewarded-ad-backdrop", role: "dialog" });
    backdrop.setAttribute("aria-modal", "true");
    const box = h("div", { class: "rewarded-ad-dialog" }, [
      h("h2", { class: "rewarded-ad-dialog__title" }, [strings.title]),
      h("p", { class: "rewarded-ad-dialog__body" }, [strings.body]),
      h("div", { class: "rewarded-ad-dialog__actions" }, [
        h(
          "button",
          { type: "button", class: "ghost", id: "rewarded-ad-cancel" },
          [strings.cancelLabel],
        ),
        h(
          "button",
          { type: "button", class: "primary", id: "rewarded-ad-ok" },
          [strings.completeLabel],
        ),
      ]),
    ]);
    backdrop.append(box);
    document.body.append(backdrop);

    const done = (ok: boolean) => {
      backdrop.remove();
      resolve(ok);
    };

    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) done(false);
    });
    box.querySelector("#rewarded-ad-cancel")?.addEventListener("click", () => done(false));
    box.querySelector("#rewarded-ad-ok")?.addEventListener("click", () => done(true));
  });
}

export async function showRewardedAdWeb(strings: {
  title: string;
  body: string;
  completeLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  const injected = typeof window !== "undefined" ? window.__MR_rewardedShow : undefined;
  if (typeof injected === "function") {
    try {
      return await injected();
    } catch {
      return false;
    }
  }
  return simulatedOverlay(strings);
}
