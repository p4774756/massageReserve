import { el } from "./domUtil";
import { t } from "./i18n";

/** 運動按摩技術員證掃描圖（請置於 `public/media/therapist-cert-rsm.png`） */
export const THERAPIST_CERT_IMAGE_SRC = `${import.meta.env.BASE_URL}media/therapist-cert-rsm.png`;

export function createTherapistCredentialStrip(): {
  element: HTMLElement;
  setVisible: (visible: boolean) => void;
} {
  const wrap = el("div", { class: "therapist-credential", hidden: true });

  const openBtn = el("button", {
    type: "button",
    class: "therapist-credential__open",
  });
  openBtn.setAttribute("aria-haspopup", "dialog");

  const thumb = el("img", {
    class: "therapist-credential__thumb",
    src: THERAPIST_CERT_IMAGE_SRC,
    loading: "lazy",
    decoding: "async",
  });
  thumb.alt = t("credential.thumbAlt", "運動按摩技術員證縮圖");

  const textCol = el("div", { class: "therapist-credential__text" });
  textCol.append(
    el("span", { class: "therapist-credential__title" }, [t("credential.title", "運動按摩技術員證")]),
    el("span", { class: "therapist-credential__org hint" }, [
      t("credential.org", "中華民國健身運動協會"),
    ]),
    el("span", { class: "therapist-credential__validity hint" }, [
      t("credential.validity", "效期 2026/05/23–2029/06/30"),
    ]),
    el("span", { class: "therapist-credential__tap hint" }, [
      t("credential.tapToView", "點擊查看證照"),
    ]),
  );
  openBtn.append(thumb, textCol);

  function openLightbox(): void {
    const overlay = el("div", { class: "modal-overlay therapist-credential-overlay" });
    const dialog = el("div", { class: "modal-card therapist-credential-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const titleId = "therapist-credential-modal-title";
    dialog.setAttribute("aria-labelledby", titleId);

    const heading = el("h3", { id: titleId }, [t("credential.modalTitle", "運動按摩技術員證")]);
    const figure = el("figure", { class: "therapist-credential-modal__figure" });
    const img = el("img", {
      class: "therapist-credential-modal__img",
      src: THERAPIST_CERT_IMAGE_SRC,
    });
    img.alt = t(
      "credential.modalImgAlt",
      "運動按摩技術員證（中華民國健身運動協會，效期 2026/05/23–2029/06/30）",
    );
    figure.append(
      img,
      el("figcaption", { class: "hint therapist-credential-modal__caption" }, [
        t(
          "credential.modalCaption",
          "中華民國健身運動協會 · 效期 2026/05/23–2029/06/30",
        ),
      ]),
    );
    const closeBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
    dialog.append(heading, figure, el("div", { class: "modal-actions" }, [closeBtn]));
    overlay.append(dialog);

    const close = () => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      openBtn.focus();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    };

    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.append(overlay);
    closeBtn.focus();
  }

  openBtn.addEventListener("click", openLightbox);
  wrap.append(openBtn);

  return {
    element: wrap,
    setVisible(visible: boolean) {
      wrap.hidden = !visible;
    },
  };
}
