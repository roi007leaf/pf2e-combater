import { t } from "../i18n.js";

// Retch's Fortitude save is rolled against the DC of the effect that sickened the actor — and only
// the GM knows that DC and owns the final ruling. The flow is: GM sets the DC -> the player rolls
// the save -> GM sets the result. The player↔GM hand-off runs over socketlib (see scripts/socket.js
// and the registration in main.js): these prompt functions are registered as the GM-side handlers
// and are also called directly when a GM executes Retch itself. Returns:
//   promptRetchDc     -> a DC number, or null if dismissed
//   promptRetchResult -> { succeeded, critical }, or null if dismissed

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "");
}

function readDcFromButton(button) {
  const input = button?.form?.elements?.namedItem?.("dc") ?? button?.form?.elements?.dc;
  const value = Number(input?.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// A short phrase describing how the rolled save landed, shown to the GM so they can rule accordingly.
function degreeHint(rolled) {
  if (!rolled) return "";
  if (rolled.critical === true) return t("Dialog.Retch.DegreeCritSuccess", "The save was a critical success.");
  if (rolled.succeeded === true) return t("Dialog.Retch.DegreeSuccess", "The save succeeded.");
  if (rolled.succeeded === false) return t("Dialog.Retch.DegreeFailure", "The save failed.");
  return "";
}

// GM: ask for the DC of the effect that sickened the actor. Resolves to a DC number, or null when
// dismissed. Registered as the socketlib "promptRetchDc" handler and called directly by a GM.
export async function promptRetchDc({ actorName } = {}) {
  const name = actorName ?? t("Dialog.Retch.DefaultActor", "the creature");
  const message = t("Dialog.Retch.DcMessage", "Set {actor}'s Retch save DC (the DC of the effect that sickened them).", { actor: name });
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialog?.wait === "function") {
    const dc = await dialog.wait({
      window: { title: t("Dialog.Retch.DcTitle", "Retch save DC") },
      content: `<p>${escapeHtml(message)}</p>`
        + `<div class="form-group"><label>${escapeHtml(t("Dialog.Retch.DcLabel", "Save DC"))}</label>`
        + `<input type="number" name="dc" min="1" step="1" autofocus placeholder="${escapeHtml(t("Dialog.Retch.DcPlaceholder", "e.g. 18"))}"></div>`,
      buttons: [
        { action: "ok", label: t("Dialog.Retch.SetDc", "Set DC"), default: true, callback: (_event, button) => readDcFromButton(button) },
        { action: "cancel", label: t("Dialog.Cancel", "Cancel"), callback: () => null },
      ],
      rejectClose: false,
    }).catch(() => null);
    return Number.isFinite(dc) ? dc : null;
  }
  const raw = globalThis.window?.prompt?.(message);
  const dc = Number(raw);
  return Number.isFinite(dc) && dc > 0 ? dc : null;
}

// GM: rule on the result of the save the player just rolled (the rolled degree, if known, pre-selects
// the matching button). Resolves to { succeeded, critical } or null when dismissed. Registered as the
// socketlib "promptRetchResult" handler and called directly by a GM.
export async function promptRetchResult({ actorName, rolled } = {}) {
  const name = actorName ?? t("Dialog.Retch.DefaultActor", "the creature");
  const hint = degreeHint(rolled);
  const message = `${t("Dialog.Retch.ResultMessage", "Set the result of {actor}'s Retch save.", { actor: name })}${hint ? ` ${hint}` : ""}`;
  const fallbackAction = rolled?.critical === true ? "crit" : rolled?.succeeded === true ? "reduce" : "none";
  const dialog = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialog?.wait === "function") {
    const decision = await dialog.wait({
      window: { title: t("Dialog.Retch.Title", "Retch result") },
      content: `<p>${escapeHtml(message)}</p>`,
      buttons: [
        { action: "crit", label: t("Dialog.Retch.Reduce2", "Reduce by 2"), default: fallbackAction === "crit", callback: () => ({ succeeded: true, critical: true }) },
        { action: "reduce", label: t("Dialog.Retch.Reduce", "Reduce sickened"), default: fallbackAction === "reduce", callback: () => ({ succeeded: true, critical: false }) },
        { action: "none", label: t("Dialog.Retch.NoReduction", "No reduction"), default: fallbackAction === "none", callback: () => ({ succeeded: false, critical: false }) },
      ],
      rejectClose: false,
    }).catch(() => null);
    return decision ?? null;
  }
  // Headless / no DialogV2: settle to the rolled degree when known, otherwise no reduction.
  return rolled ? { succeeded: rolled.succeeded === true, critical: rolled.critical === true } : { succeeded: false, critical: false };
}
