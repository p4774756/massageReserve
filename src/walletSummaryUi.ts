import { el } from "./domUtil";
import { t } from "./i18n";

export type MemberWalletSummaryOpts = {
  sessions: number;
  points: number;
  per: number;
  chances: number;
  legacy: string;
};

/** 會員餘額列：條列呈現，避免長句難掃讀 */
export function paintMemberWalletSummary(host: HTMLElement, opts: MemberWalletSummaryOpts): void {
  host.replaceChildren();
  host.className = "status-line ok member-wallet-summary";
  const head = el("div", { class: "member-wallet-summary__head" }, [
    t("member.walletSummaryTitle", "會員"),
  ]);
  const list = el("ul", { class: "member-wallet-summary__list" });
  list.append(
    el("li", {}, [t("member.walletItemSessions", "預約次數：{{n}} 次", { n: opts.sessions })]),
    el("li", {}, [
      t("member.walletItemWheel", "輪盤點：{{pts}}／滿 {{per}} 點可換 1 次預約", {
        pts: opts.points,
        per: opts.per,
      }),
    ]),
    el("li", {}, [t("member.walletItemDraw", "可拉霸開獎：{{n}} 次", { n: opts.chances })]),
  );
  host.append(head, list);
  if (opts.legacy.trim()) {
    host.append(el("p", { class: "member-wallet-summary__legacy hint" }, [opts.legacy]));
  }
}
