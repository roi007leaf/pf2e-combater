// Shared card picker: a grid of image/icon cards backed by native radio or
// checkbox inputs, so dialogs read values with ordinary form handling
// (form.elements.namedItem(name).value for radios).

export const CARD_DIALOG_CLASS = "pf2e-combater-card-dialog";

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(value ?? ""))
    : String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function cardArt(option) {
  if (option.img) return `<img src="${escapeHtml(option.img)}" alt="">`;
  return `<i class="fa-solid ${escapeHtml(option.icon ?? "fa-circle")}" aria-hidden="true"></i>`;
}

export function cardPickerHtml({ name, options = [], type = "radio", compact = false, extraClass = "" } = {}) {
  const cards = options.map((option) => `<label class="combater-pick-card${option.tone ? ` is-${escapeHtml(option.tone)}` : ""}"${option.search ? ` data-pick-search="${escapeHtml(option.search)}"` : ""}>
      <input type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(option.value)}"${option.checked ? " checked" : ""}>
      <span class="combater-pick-art">${cardArt(option)}</span>
      <span class="combater-pick-text"><strong>${escapeHtml(option.label)}</strong>${option.detail ? `<small>${escapeHtml(option.detail)}</small>` : ""}</span>
      <i class="fa-solid fa-circle-check combater-pick-check" aria-hidden="true"></i>
    </label>`).join("");
  return `<div class="combater-pick-grid${compact ? " is-compact" : ""}${extraClass ? ` ${escapeHtml(extraClass)}` : ""}" role="${type === "radio" ? "radiogroup" : "group"}">${cards}</div>`;
}

export function checkedValue(form, name) {
  return String(form?.querySelector?.(`input[name="${name}"]:checked`)?.value ?? "");
}

export function checkedValues(form, name) {
  return Array.from(form?.querySelectorAll?.(`input[name="${name}"]:checked`) ?? [], (input) => input.value);
}

// Filters cards in place by their data-pick-search text.
export function bindCardSearch(input, grid) {
  if (!input || !grid) return;
  input.addEventListener("input", () => {
    const terms = String(input.value ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    for (const card of grid.querySelectorAll(".combater-pick-card")) {
      const haystack = String(card.dataset.pickSearch ?? card.textContent ?? "").toLowerCase();
      card.hidden = terms.length > 0 && !card.querySelector("input:checked") && !terms.every((term) => haystack.includes(term));
    }
  });
}
