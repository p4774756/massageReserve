/** `siteSettings/bookingCaps`：名額已滿時加價預約 */

export const DEFAULT_CAP_OVERFLOW_ENABLED = true;
export const DEFAULT_CAP_OVERFLOW_SURCHARGE_NTD = 100;
const SURCHARGE_MIN = 0;
const SURCHARGE_MAX = 50_000;

export type CapOverflowSettings = {
  enabled: boolean;
  surchargeNtd: number;
};

export function resolveCapOverflowSettings(raw: unknown): CapOverflowSettings {
  let enabled = DEFAULT_CAP_OVERFLOW_ENABLED;
  let surchargeNtd = DEFAULT_CAP_OVERFLOW_SURCHARGE_NTD;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.capOverflowEnabled === false) enabled = false;
    else if (o.capOverflowEnabled === true) enabled = true;
    const sRaw = o.capOverflowSurchargeNtd;
    const n = typeof sRaw === "number" && Number.isFinite(sRaw) ? Math.round(sRaw) : Number(sRaw);
    if (Number.isInteger(n) && n >= SURCHARGE_MIN && n <= SURCHARGE_MAX) {
      surchargeNtd = n;
    }
  }
  return { enabled, surchargeNtd };
}
