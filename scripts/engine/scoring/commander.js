// Commander tactics, valued with PF2e Commanderer's state: a tactic is worth what its eligible
// responders (squadmates on the scene, inside the banner aura when it needs one) can actually do
// right now. Without Commanderer this adds nothing.
import { commanderTacticState } from "../../integrations/commanderer.js";
import { contextActorDocument } from "../actor-context.js";
import { contextEnemies } from "../target-pool.js";
import { t } from "../../i18n.js";

const BLOCKED = -999;

function enemyTokens(context) {
  const tokens = globalThis.canvas?.tokens;
  return contextEnemies(context)
    .filter((enemy) => enemy?.hpPercent !== 0)
    .map((enemy) => tokens?.get?.(enemy?.id) ?? null)
    .filter(Boolean);
}

function distance(from, to) {
  try {
    const value = from?.distanceTo?.(to);
    return Number.isFinite(value) ? value : Infinity;
  } catch (_error) {
    return Infinity;
  }
}

function meleeReach(token) {
  const reach = Number(token?.actor?.getReach?.({ action: "attack" }) ?? token?.actor?.system?.attributes?.reach?.base);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function hpPercent(token) {
  const value = Number(token?.actor?.system?.attributes?.hp?.value);
  const max = Number(token?.actor?.system?.attributes?.hp?.max);
  return Number.isFinite(value) && max > 0 ? value / max : 1;
}

// Responders that have an enemy within their reach.
function engaged(responders, enemies) {
  return responders.filter((member) => enemies.some((enemy) => distance(member.token, enemy) <= meleeReach(member.token)));
}

function adjacentEnemies(responders, enemies) {
  return enemies.filter((enemy) => responders.some((member) => distance(member.token, enemy) <= 5));
}

const TACTIC_VALUE = {
  // One squadmate Strikes as a reaction: worth it when one can reach an enemy.
  "strike-hard": (state, enemies) => (engaged(state.responders, enemies).length ? 60 : -60),
  // Enemies next to responders become off-guard: one per such enemy.
  "pincer-attack": (state, enemies) => {
    const count = adjacentEnemies(state.responders, enemies).length;
    return count ? 20 + 15 * count : -60;
  },
  // A squadmate next to an enemy Steps and Repositions it.
  "coordinating-maneuvers": (state, enemies) => (engaged(state.responders, enemies).length ? 25 : -60),
  "double-team": (state, enemies) => (engaged(state.responders, enemies).length ? 25 : -60),
  // Pull the squad back into the aura: only when some squadmates are outside it.
  "gather-to-me": (state) => {
    const outside = state.members.filter((member) => !member.inAura).length;
    return outside ? 10 + 12 * outside : -60;
  },
  // A squadmate moves to shield a hurt ally.
  "protective-screen": (state) => (state.members.some((member) => hpPercent(member.token) < 0.5) ? 30 : -40),
  // Step away: when the squad is hurt and engaged.
  "defensive-retreat": (state, enemies) => {
    const hurt = engaged(state.responders, enemies).filter((member) => hpPercent(member.token) < 0.5).length;
    return hurt ? 15 + 15 * hurt : -50;
  },
  "shields-up": (state, enemies) => (enemies.length ? 8 + 4 * state.responders.length : -40),
};

export function commanderTacticAdjustment(context, action) {
  const actor = contextActorDocument(context);
  const state = commanderTacticState(actor, action?.item);
  if (!state) return null;
  if (!state.prepared) {
    return { blocked: true, scoreDelta: BLOCKED, reasons: [t("ScoreReason.TacticNotPrepared", "{tactic} isn't prepared today.", { tactic: action.name })] };
  }
  if (state.auraNeeded && !state.bannerActive) {
    return { blocked: true, scoreDelta: BLOCKED, reasons: [t("ScoreReason.TacticNeedsBanner", "{tactic} needs the banner aura active.", { tactic: action.name })] };
  }
  if (!state.responders.length) {
    return { blocked: true, scoreDelta: BLOCKED, reasons: [t("ScoreReason.TacticNoResponders", "No squadmate can respond to {tactic}.", { tactic: action.name })] };
  }
  const enemies = enemyTokens(context);
  const valueOf = TACTIC_VALUE[state.slug];
  const scoreDelta = valueOf ? valueOf(state, enemies) : 6 * state.responders.length;
  const reasons = [scoreDelta >= 0
    ? t("ScoreReason.TacticResponders", "{count} squadmates can answer {tactic}.", { count: state.responders.length, tactic: action.name })
    : t("ScoreReason.TacticNothingToDo", "{tactic} has nothing to do right now.", { tactic: action.name })];
  return { blocked: false, scoreDelta, reasons };
}
