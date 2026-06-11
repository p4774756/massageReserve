/** 會員中心「預覽拉霸特效」：後台開關（管理員永遠可見，不受此設定影響） */

export function resolveWheelPreviewSettingsClient(raw: unknown): { previewEnabledForMembers: boolean } {
  let previewEnabledForMembers = false;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.previewEnabledForMembers === true) previewEnabledForMembers = true;
  }
  return { previewEnabledForMembers };
}
