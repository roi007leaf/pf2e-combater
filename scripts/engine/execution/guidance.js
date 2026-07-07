import { t } from "../../i18n.js";

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

export async function createGuidance(action, actor) {
  const content = `<strong>${escapeHtml(action?.name ?? t("Exec.ActionName", "Action"))}</strong><br>${escapeHtml(action?.reason ?? t("Exec.ReviewActionLong", "Review this action before resolving it."))}`;
  if (globalThis.ChatMessage?.create) {
    await globalThis.ChatMessage.create({
      speaker: globalThis.ChatMessage.getSpeaker?.({ actor }) ?? {},
      content,
      whisper: globalThis.game?.user?.id ? [globalThis.game.user.id] : undefined,
    });
    return true;
  }
  globalThis.ui?.notifications?.info?.(`${action?.name ?? t("Exec.ActionName", "Action")}: ${action?.reason ?? t("Exec.ReviewAction", "Review this action.")}`);
  return true;
}
