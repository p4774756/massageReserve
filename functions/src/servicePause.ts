export const SERVICE_PAUSE_DOC_ID = "servicePause";

export const DEFAULT_SERVICE_PAUSE_MESSAGE = "目前暫停接受新預約，恢復後會更新公告。";

const MESSAGE_MAX_LEN = 400;

export type ServicePauseSettings = {
  paused: boolean;
  message: string;
  resumeOn?: string;
};

function normalizeResumeOn(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return s;
}

/** 解析 `siteSettings/servicePause` */
export function parseServicePause(raw: unknown): ServicePauseSettings {
  if (!raw || typeof raw !== "object") {
    return { paused: false, message: DEFAULT_SERVICE_PAUSE_MESSAGE };
  }
  const o = raw as Record<string, unknown>;
  const paused = o.paused === true;
  let message =
    typeof o.message === "string" ? o.message.trim().slice(0, MESSAGE_MAX_LEN) : "";
  if (!message) message = DEFAULT_SERVICE_PAUSE_MESSAGE;
  const resumeOn = normalizeResumeOn(o.resumeOn);
  return resumeOn ? { paused, message, resumeOn } : { paused, message };
}

export function isServicePaused(raw: unknown): boolean {
  return parseServicePause(raw).paused;
}
