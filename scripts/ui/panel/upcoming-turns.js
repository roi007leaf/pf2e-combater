import { t } from "../../i18n.js";
import { SETTINGS, settingOrDefault } from "../../settings.js";
import { turnCombatantName } from "../../state/turn-controls.js";

// Token disposition as a style key. Secret stays secret: players see it as neutral.
function dispositionKey(combatant, user) {
  const value = Number(combatant?.token?.disposition ?? combatant?.token?.document?.disposition);
  if (value === 1) return "friendly";
  if (value === -1) return "hostile";
  if (value === -2) return user?.isGM ? "secret" : "neutral";
  return "neutral";
}

export function upcomingTurnsView(combat = globalThis.game?.combat, user = globalThis.game?.user) {
  const turns = combat?.turns ?? [];
  if (!settingOrDefault(SETTINGS.showTurnNavigation, true) || !combat?.started || !turns.length) return { visible: false, entries: [] };
  const current = combat.turn ?? -1;
  const entries = [];
  // One circuit includes the current creature's next-round turn in small
  // encounters, without repeating a single creature in both preview slots.
  for (let offset = 1; offset <= turns.length && entries.length < 2; offset += 1) {
    const position = current + offset;
    const combatant = turns[position % turns.length];
    if (combat.settings?.skipDefeated && combatant.isDefeated) continue;
    if (!user?.isGM && (combatant.hidden || combatant.visible === false)) continue;
    const next = entries.length === 0;
    const name = turnCombatantName(combatant, user);
    const label = next ? t("UpcomingTurns.Next", "Next turn") : t("UpcomingTurns.Then", "Then");
    const round = combat.round + Math.floor(position / turns.length);
    const roundLabel = t("UpcomingTurns.Round", "Round {round}", { round });
    entries.push({
      id: combatant.id, name, label, next, round,
      disposition: dispositionKey(combatant, user),
      img: combatant.img || combatant.actor?.img || "icons/svg/mystery-man.svg",
      nextRound: round > combat.round,
      roundLabel,
      tooltip: `${label}: ${name} · ${roundLabel}. ${t("UpcomingTurns.PanHint", "Click to pan to this combatant.")}`,
    });
  }
  return {
    visible: entries.length > 0, entries, label: t("UpcomingTurns.Label", "Upcoming turns"),
    combatId: combat.id, turnKey: `${combat.round}:${current}:${turns[current]?.id ?? ""}`,
  };
}

export async function panToUpcomingCombatant(id, combatId) {
  const combat = globalThis.game?.combat;
  if (combat?.id !== combatId || !upcomingTurnsView(combat).entries.some((entry) => entry.id === id)) return false;
  const combatant = combat.turns.find((entry) => entry.id === id);
  const canvas = globalThis.canvas;
  // Resolve the placeable on the current canvas directly: a combat not linked to
  // this scene can leave the combatant's own scene/token references unset.
  const token = canvas?.tokens?.get?.(combatant?.tokenId) ?? combatant?.token?.object;
  const sceneId = combatant?.sceneId ?? combatant?.token?.parent?.id ?? token?.document?.parent?.id;
  const onScene = Boolean(token) && (!sceneId || sceneId === canvas?.scene?.id);
  // The GM can always pan to a token on the scene; players need it in their vision.
  const visible = globalThis.game?.user?.isGM === true || token?.isVisible === true || token?.visible === true;
  if (!canvas?.ready || !onScene || !visible) {
    globalThis.ui?.notifications?.warn?.(t("UpcomingTurns.PanUnavailable", "This combatant's token is not visible on the current scene."));
    return false;
  }
  await canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 350 });
  return true;
}

// Capture before ApplicationV2 replaces its HTML. Relative coordinates keep the
// slide local to the carousel even if the panel moves or changes size.
export function captureUpcomingTurns(element) {
  const track = element?.querySelector(".combater-upcoming-track");
  if (!track?.isConnected) return null;
  const origin = track.getBoundingClientRect();
  return {
    combatId: track.dataset.combatId, turnKey: track.dataset.turnKey,
    entries: Array.from(track.querySelectorAll("[data-upcoming-combatant]"), (card) => {
      const rect = card.getBoundingClientRect();
      return {
        id: card.dataset.upcomingCombatant, round: card.dataset.upcomingRound,
        name: card.querySelector(".combater-upcoming-name")?.textContent,
        x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height,
        clone: card.cloneNode(true),
      };
    }),
  };
}

export function activateUpcomingTurnBindings(panel, element) {
  const previous = panel._upcomingBeforeRender;
  panel._upcomingBeforeRender = null;
  const track = element.querySelector(".combater-upcoming-track");
  if (!track) return;
  const cards = Array.from(track.querySelectorAll("[data-upcoming-combatant]"));
  for (const card of cards) {
    card.addEventListener("click", () => {
      panToUpcomingCombatant(card.dataset.upcomingCombatant, track.dataset.combatId)
        .catch((error) => globalThis.ui?.notifications?.warn?.(error.message));
    });
  }
  if (!previous || previous.combatId !== track.dataset.combatId || previous.turnKey === track.dataset.turnKey
    || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const origin = track.getBoundingClientRect();
  const options = { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
  const matches = (old, card) => old.id === card.dataset.upcomingCombatant && old.round === card.dataset.upcomingRound;
  for (const card of cards) {
    const old = previous.entries.find((entry) => matches(entry, card));
    const rect = card.getBoundingClientRect();
    const start = old && rect.width && rect.height
      ? `translate(${old.x - (rect.left - origin.left)}px, ${old.y - (rect.top - origin.top)}px) scale(${old.width / rect.width}, ${old.height / rect.height})`
      : "translateX(72px) scale(0.88)";
    card.animate?.([
      { transform: start, opacity: old ? 1 : 0 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
    ], options);
  }
  for (const old of previous.entries) {
    if (cards.some((card) => matches(old, card))) continue;
    const combatant = globalThis.game?.combat?.turns.find((entry) => entry.id === old.id);
    const user = globalThis.game?.user;
    // Never keep a stale portrait/name visible after its visibility changes.
    if (!combatant || (!user?.isGM && (combatant.hidden || combatant.visible === false))
      || turnCombatantName(combatant, user) !== old.name) continue;
    const clone = old.clone;
    clone.removeAttribute("data-upcoming-combatant");
    clone.removeAttribute("data-tooltip");
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    clone.classList.add("is-leaving");
    Object.assign(clone.style, { left: `${old.x}px`, top: `${old.y}px`, width: `${old.width}px`, height: `${old.height}px` });
    track.append(clone);
    const animation = clone.animate?.([
      { transform: "translateX(0)", opacity: 1 },
      { transform: "translateX(-72px) scale(0.88)", opacity: 0 },
    ], options);
    if (animation) animation.finished.then(() => clone.remove(), () => clone.remove());
    else clone.remove();
  }
}

export function registerUpcomingTurnHooks(refresh) {
  Hooks.on("pf2e-combater.turnNavigationChanged", () => refresh("turn-navigation-setting"));
  const relevantCombat = (combat) => combat?.id === globalThis.game?.combat?.id;
  // Initiative edits, additions, and removals can change the preview without
  // advancing a turn. Combatant updates also cover Delay and GM return changes.
  for (const event of ["createCombatant", "updateCombatant", "deleteCombatant"]) {
    Hooks.on(event, (combatant) => { if (relevantCombat(combatant.parent)) refresh("upcoming-turns"); });
  }
  Hooks.on("updateSetting", (setting) => {
    if (["core.combatTrackerConfig", "pf2e.metagame_tokenSetsNameVisibility"].includes(setting.key)) refresh("upcoming-turns");
  });
  for (const [event, kind] of [["updateActor", "actor"], ["updateToken", "token"]]) {
    Hooks.on(event, (document, changed) => {
      if (!("name" in changed || "img" in changed || "texture" in changed || "hidden" in changed || "flags" in changed)) return;
      const entries = globalThis.game?.combat?.turns ?? [];
      if (entries.some((entry) => entry[kind]?.id === document.id)) refresh("upcoming-turns");
    });
  }
}
