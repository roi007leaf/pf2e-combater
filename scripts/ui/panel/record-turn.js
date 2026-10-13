import { t } from "../../i18n.js";
import { CARD_DIALOG_CLASS, cardPickerHtml, checkedValue } from "../card-picker.js";
import {
  RECORDED_TURNS_DIR,
  buildRecordedTurn,
  recordedTurnFileName,
} from "../../engine/planner/turn-snapshot.js";

// GM-only "Save this turn as a test": snapshot the Auto-fill input and the GM's verdict into
// tests/recorded-turns/, where the planner quality lab picks it up (npm run planner:quality).

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML?.(String(value ?? "")) ?? String(value ?? "");
}

function filePickerClass() {
  return globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker ?? null;
}

async function ensureDirectory(picker, path) {
  let current = "";
  for (const part of path.split("/")) {
    current = current ? `${current}/${part}` : part;
    try {
      await picker.createDirectory("data", current, {});
    } catch {
      // Already exists (or not creatable -- the upload below reports the real failure).
    }
  }
}

async function saveRecordedTurn(turn) {
  const json = JSON.stringify(turn, null, 2);
  const fileName = recordedTurnFileName(turn);
  const picker = filePickerClass();
  if (picker?.upload && globalThis.File) {
    try {
      await ensureDirectory(picker, RECORDED_TURNS_DIR);
      const file = new File([json], fileName, { type: "application/json" });
      const result = await picker.upload("data", RECORDED_TURNS_DIR, file, {}, { notify: false });
      if (result !== false && result?.status !== "error") return `${RECORDED_TURNS_DIR}/${fileName}`;
    } catch (error) {
      console.warn("PF2e Combater | Recorded turn upload failed; downloading instead.", error);
    }
  }
  const save = globalThis.foundry?.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  save?.(json, "application/json", fileName);
  return null;
}

function verdictOptions(plans) {
  const top = plans[0];
  return [
    ...plans.slice(0, 4).map((plan, index) => ({
      value: `correct:${index}`,
      label: index === 0
        ? t("RecordTurn.TopIsRight", "Auto-fill got it right")
        : t("RecordTurn.AlternativeIsRight", "Alternative {number} is the right turn", { number: index + 1 }),
      detail: plan?.summary ?? "",
      icon: index === 0 ? "fa-check" : "fa-arrow-up",
      tone: index === 0 ? "green" : "",
      checked: index === 0,
    })),
    {
      value: "wrong",
      label: t("RecordTurn.TopIsWrong", "Auto-fill's top plan is wrong"),
      detail: top?.summary ?? "",
      icon: "fa-xmark",
      tone: "red",
    },
  ];
}

export async function recordPanelTurn(panel) {
  if (game?.user?.isGM !== true) return;
  const context = panel._autoFillContext ?? panel._context;
  const candidates = panel._autoFillPreparationCache?.autoFillBuild?.candidates ?? panel._candidates ?? [];
  const approachCandidates = panel._autoFillPreparationCache?.autoFillBuild?.approachable ?? [];
  const plans = panel._autoFillPlans ?? [];
  if (!context || !plans.length) {
    ui.notifications?.warn(t("RecordTurn.NothingToRecord", "There is no Auto-fill plan to record yet."));
    return;
  }
  const content = `<form class="combater-record-turn">
    <p class="hint">${escapeHtml(t("RecordTurn.Hint", "Saves this turn's Auto-fill input as a planner test. Pick what the right answer was."))}</p>
    ${cardPickerHtml({ name: "verdict", options: verdictOptions(plans), compact: true })}
    <label class="combater-record-note">${escapeHtml(t("RecordTurn.Note", "What should it have done?"))}
      <input type="text" name="note" placeholder="${escapeHtml(t("RecordTurn.NotePlaceholder", "e.g. Stride and Strike with the rapier"))}">
    </label>
  </form>`;
  const result = await globalThis.foundry.applications.api.DialogV2.prompt({
    classes: [CARD_DIALOG_CLASS, "pf2e-combater-record-dialog"],
    position: { width: 520, height: "auto" },
    window: { title: t("RecordTurn.Title", "Save turn as a planner test"), icon: "fa-solid fa-flask" },
    content,
    ok: {
      label: t("RecordTurn.Save", "Save test"),
      icon: "fa-solid fa-floppy-disk",
      callback: (_event, button) => ({
        verdict: checkedValue(button.form, "verdict"),
        note: String(button.form.elements.note?.value ?? "").trim(),
      }),
    },
    rejectClose: false,
  });
  if (!result?.verdict) return;
  const [kind, index] = result.verdict.split(":");
  const turn = buildRecordedTurn({
    context,
    candidates,
    approachCandidates,
    plans,
    verdict: { kind, planIndex: Number(index) || 0 },
    note: result.note,
  });
  const path = await saveRecordedTurn(turn);
  ui.notifications?.info(path
    ? t("RecordTurn.Saved", "Saved {path}. Run npm run planner:quality to replay it.", { path })
    : t("RecordTurn.Downloaded", "Downloaded {file}. Put it in tests/recorded-turns/ to replay it.", { file: recordedTurnFileName(turn) }));
}
