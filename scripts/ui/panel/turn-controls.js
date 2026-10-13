import { t, pf2eActionName } from "../../i18n.js";
import { SETTINGS, settingOrDefault } from "../../settings.js";
import { isSocketReady, requestTurnControl } from "../../socket.js";
import {
  attacksThisTurn, delayedTurn, delayTargets, delayUnavailableReason, handleTurnControl, ownsTurn,
  reactionUsed, readiedAction, readyUnavailableReason, turnCombatantName, turnIdentity,
} from "../../state/turn-controls.js";
import { bindPopoverMenu } from "./utility-menu.js";

export function turnControlsView(context, combat = globalThis.game?.combat, user = globalThis.game?.user) {
  if (!settingOrDefault(SETTINGS.showTurnNavigation, true)) return { visible: false };
  if (!context || !combat?.started || context.combat?.id !== combat.id) return { visible: false };
  const active = combat.combatant;
  const ownCurrent = context.combatant?.id === active?.id && ownsTurn(active, user);
  const controlsCurrent = Boolean(active && (user?.isGM || ownCurrent));
  const connected = Boolean(user?.isGM || (globalThis.game?.users?.activeGM && isSocketReady()));
  const selected = combat.turns.find((entry) => entry.id === context.combatant?.id);
  const waiting = delayedTurn(selected);
  const after = combat.turns.find((entry) => entry.id === waiting?.afterId);
  const unavailable = t("TurnControls.Unavailable", "An active GM is required for turn controls.");
  const delayReason = connected ? delayUnavailableReason(combat) : unavailable;
  const readyReason = connected ? readyUnavailableReason(combat) : unavailable;
  const canDelay = controlsCurrent && connected && !delayReason && delayTargets(combat, user).length > 0;
  const canReady = controlsCurrent && connected && !readyReason;
  const delayed = user?.isGM ? combat.turns.filter((entry) => delayedTurn(entry) && entry.id !== active?.id).map((entry) => ({
    id: entry.id, name: turnCombatantName(entry, user),
    tooltip: t("TurnControls.BringInHint", "End the current turn and bring {name} in now.", { name: turnCombatantName(entry, user) }),
  })) : [];
  const ready = readiedAction(selected);
  const readied = ready ? {
    id: selected.id, label: ready.label,
    title: t("TurnControls.ReadiedTitle", "Readied · {action}", { action: ready.label }),
    hint: t("TurnControls.ReadiedHint", "Use it as a reaction when the declared trigger happens, before this creature's next turn."),
    canUse: connected && ownsTurn(selected, user),
    useLabel: t("TurnControls.ReadiedUse", "Use"),
    clearLabel: t("TurnControls.ReadiedClear", "Discard"),
  } : null;
  return {
    visible: controlsCurrent || Boolean(waiting) || delayed.length > 0 || Boolean(readied) || reactionUsed(selected),
    reactionUsedLabel: reactionUsed(selected) ? t("TurnControls.ReactionUsed", "Reaction used") : "",
    reactionUsedHint: t("TurnControls.ReactionUsedHint", "Regained at the start of this creature's next turn."),
    controlsCurrent, canEnd: controlsCurrent && connected, canDelay, canReady,
    canOpenMenu: controlsCurrent,
    delayHint: delayReason || t("TurnControls.DelayHint", "Choose whose turn to return after."),
    delayDetail: canDelay ? t("TurnControls.DelayDetail", "Leave initiative and return after another creature.") : delayReason,
    readyDetail: canReady ? t("TurnControls.ReadyDetail", "2 actions: act on a trigger before your next turn.") : readyReason,
    endHint: connected
      ? t("TurnControls.EndHint", "End {name}'s current turn.", { name: turnCombatantName(active, user) })
      : delayReason,
    endLabel: user?.isGM && context.combatant?.id !== active?.id
      ? t("TurnControls.EndNamed", "End {name}'s turn", { name: turnCombatantName(active, user) })
      : t("TurnControls.End", "End turn"),
    moreLabel: t("TurnControls.More", "More turn options"),
    delayLabel: t("TurnControls.Delay", "Delay"),
    readyLabel: t("TurnControls.Ready", "Ready"),
    bringInLabel: t("TurnControls.BringIn", "Bring in now"),
    waitingLabel: waiting ? t("TurnControls.WaitingAfter", "Delaying · after {name}", { name: after ? turnCombatantName(after, user) : t("TurnControls.Unknown", "Unknown creature") }) : "",
    waitingHint: t("TurnControls.WaitingHint", "Your turn resumes at the chosen position. No reactions while delaying."),
    delayed,
    readied,
  };
}

const escapeHtml = (value) => globalThis.foundry.utils.escapeHTML(String(value ?? ""));

function readyStrikes(actor) {
  return (actor?.system?.actions ?? []).filter((action) => action?.type === "strike" && action.visible !== false
    && action.ready !== false && action.slug);
}

// Ready takes a single action or free action. Strikes come first: they are the
// common case and the only ones whose MAP must be remembered.
export function readyChoices(actor) {
  const strikes = readyStrikes(actor).map((action) => ({
    value: `strike:${action.slug}`, strike: action.slug, label: action.label ?? action.name ?? action.slug,
    text: t("TurnControls.ReadyStrike", "Strike: {weapon}", { weapon: action.label ?? action.name ?? action.slug }),
  }));
  const basics = ["stride", "step", ...(actor?.heldShield ? ["raise-a-shield"] : []), "interact"].map((slug) => {
    const label = pf2eActionName(slug);
    return { value: `action:${slug}`, strike: null, label, text: label };
  });
  return [...strikes, ...basics, { value: "other", strike: null, label: "", text: t("TurnControls.ReadyOther", "Another action…") }];
}

async function promptReady(combat) {
  const combatant = combat.combatant;
  const choices = readyChoices(combatant?.actor);
  const attacks = Math.min(2, attacksThisTurn(combat));
  const maps = [
    t("TurnControls.ReadyMap0", "No penalty (first attack)"),
    t("TurnControls.ReadyMap1", "−5 / agile −4 (second attack)"),
    t("TurnControls.ReadyMap2", "−10 / agile −8 (third attack)"),
  ];
  const content = `<div class="combater-ready-form">
    <p class="combater-ready-rule">${escapeHtml(t("TurnControls.ReadyRuleNoTrigger", "Spend 2 actions and end your turn. Declare the trigger at the table; if it happens before your next turn starts, use the action as a reaction."))}</p>
    <label class="combater-ready-field"><span>${escapeHtml(t("TurnControls.ReadyAction", "Action"))}</span>
      <select name="choice">${choices.map((choice, index) => `<option value="${escapeHtml(choice.value)}"${index === 0 ? " selected" : ""}>${escapeHtml(choice.text)}</option>`).join("")}</select></label>
    <label class="combater-ready-field" data-ready-custom${choices[0].value === "other" ? "" : " hidden"}><span>${escapeHtml(t("TurnControls.ReadyCustom", "Describe the action"))}</span>
      <input type="text" name="custom" maxlength="80" placeholder="${escapeHtml(t("TurnControls.ReadyCustomPlaceholder", "Cast Shield"))}"></label>
    <label class="combater-ready-field" data-ready-map><span>${escapeHtml(t("TurnControls.ReadyMapLabel", "Attack penalty"))}</span>
      <select name="mapIndex">${maps.map((label, index) => `<option value="${index}"${index === attacks ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>
      <small>${escapeHtml(t("TurnControls.ReadyMapHint", "A readied attack keeps the multiple attack penalty you have now."))}</small></label>
  </div>`;
  const result = await globalThis.foundry.applications.api.DialogV2.prompt({
    classes: ["pf2e-combater-delay-dialog", "pf2e-combater-ready-dialog"],
    position: { width: 440, height: "auto" },
    window: { title: t("TurnControls.ReadyTitle", "Ready an action for {name}", { name: turnCombatantName(combatant) }) },
    content,
    render: (_event, dialog) => {
      const form = (dialog.element ?? dialog).querySelector?.("form");
      const select = form?.elements?.choice;
      const sync = () => {
        const value = select.value;
        form.querySelector("[data-ready-custom]").hidden = value !== "other";
        form.querySelector("[data-ready-map]").hidden = !value.startsWith("strike:");
      };
      select?.addEventListener("change", sync);
      if (select) sync();
    },
    ok: {
      label: t("TurnControls.Ready", "Ready"),
      callback: (_event, button) => {
        const elements = button.form.elements;
        return { choice: elements.choice.value, custom: elements.custom.value, mapIndex: elements.mapIndex.value };
      },
    },
    rejectClose: false,
  });
  if (!result) return null;
  const choice = choices.find((entry) => entry.value === result.choice);
  const label = (choice?.value === "other" ? result.custom : choice?.label)?.trim();
  if (!label) throw Error(t("TurnControls.ReadyIncomplete", "Choose an action to ready."));
  return { label, strike: choice?.strike ?? null, mapIndex: choice?.strike ? Number(result.mapIndex) || 0 : 0 };
}

function chatSpeaker(combatant) {
  const ChatMessage = globalThis.ChatMessage;
  return ChatMessage?.getSpeaker?.({ actor: combatant?.actor, token: combatant?.token }) ?? {};
}

// A GM-run creature's trigger stays secret from players.
function chatVisibility(combatant) {
  if (combatant?.actor?.hasPlayerOwner) return {};
  return { whisper: globalThis.ChatMessage?.getWhisperRecipients?.("GM")?.map((user) => user.id) ?? [] };
}

async function announceReady(combatant, ready) {
  const name = escapeHtml(turnCombatantName(combatant));
  await globalThis.ChatMessage?.create?.({
    speaker: chatSpeaker(combatant), ...chatVisibility(combatant),
    content: `<div class="pf2e-combater-ready-card"><p>${t("TurnControls.ReadyChat", "{name} readies <strong>{action}</strong>.", { name, action: escapeHtml(ready.label) })}</p></div>`,
  });
}

// Strikes roll through PF2e's native variant (it reads game.user.targets) at the
// stored MAP. Other actions are announced; the player resolves them normally.
async function useReadied(combatant, event) {
  const ready = readiedAction(combatant);
  if (!ready) return false;
  if (ready.strike) {
    const strike = readyStrikes(combatant.actor).find((action) => action.slug === ready.strike);
    const variant = strike?.variants?.[ready.mapIndex] ?? strike?.variants?.[0];
    if (!variant?.roll) throw Error(t("TurnControls.ReadiedMissing", "{action} is no longer available.", { action: ready.label }));
    const roll = await variant.roll({ event });
    return roll !== null && roll !== undefined;
  }
  const name = escapeHtml(turnCombatantName(combatant));
  await globalThis.ChatMessage?.create?.({
    speaker: chatSpeaker(combatant), ...chatVisibility(combatant),
    content: `<div class="pf2e-combater-ready-card"><p>${t("TurnControls.ReadiedUsed", "{name} uses readied <strong>{action}</strong> as a reaction.", { name, action: escapeHtml(ready.label) })}</p></div>`,
  });
  return true;
}

async function sendTurnControl(request) {
  const user = globalThis.game?.user;
  const activeGM = globalThis.game?.users?.activeGM;
  const result = user?.isGM && (!activeGM || activeGM.id === user.id)
    ? await handleTurnControl.call({ socketdata: { userId: user.id } }, request)
    : await requestTurnControl(request);
  if (!result) throw Error(t("TurnControls.Unavailable", "An active GM is required for turn controls."));
  return result;
}

export function activateTurnControlBindings(panel, element) {
  bindPopoverMenu(element, element.querySelector("[data-turn-menu-toggle]"), element.querySelector("[data-turn-menu]"),
    { closeOn: "button[data-turn-control]" });
  for (const button of element.querySelectorAll("[data-turn-control]")) {
    button.addEventListener("click", async (event) => {
      if (panel._turnControlInFlight) return;
      panel._turnControlInFlight = true;
      button.disabled = true;
      try {
        const combat = globalThis.game?.combat;
        const request = { ...turnIdentity(combat), action: button.dataset.turnControl };
        let announce = null;
        if (request.action === "delay") {
          const choices = delayTargets(combat);
          if (!choices.length) return;
          const escape = globalThis.foundry.utils.escapeHTML;
          const suffix = t("TurnControls.NextRound", "next round");
          const initiativeLabel = escape(t("TurnControls.Initiative", "Initiative"));
          const choicesHtml = choices.map((entry, index) => `<label class="combater-delay-choice">
            <input type="radio" name="afterId" value="${escape(entry.id)}"${index === 0 ? " checked" : ""} required>
            <span class="combater-delay-order" aria-label="${escape(t("TurnControls.Order", "Turn order {order}", { order: entry.order }))}">#${entry.order}</span>
            <img class="combater-delay-portrait" src="${escape(entry.img)}" alt="">
            <span class="combater-delay-identity"><span class="combater-delay-name">${escape(entry.name)}</span>${entry.nextRound ? `<span class="combater-delay-round">${escape(suffix)}</span>` : ""}</span>
            <span class="combater-delay-initiative"><small>${initiativeLabel}</small><strong>${entry.initiative}</strong></span>
            <span class="combater-delay-check" aria-hidden="true"></span>
          </label>`).join("");
          const afterId = await globalThis.foundry.applications.api.DialogV2.prompt({
            classes: ["pf2e-combater-delay-dialog"],
            position: { width: 460, height: "auto" },
            window: { title: t("TurnControls.DelayTitle", "Delay {name}'s turn", { name: turnCombatantName(combat.combatant) }) },
            content: `<fieldset class="combater-delay-targets"><legend>${escape(t("TurnControls.DelayPrompt", "Return after whose turn?"))}</legend><div class="combater-delay-choices">${choicesHtml}</div></fieldset>`,
            ok: { label: t("TurnControls.Delay", "Delay"), callback: (_event, button) => button.form.elements.afterId.value },
            rejectClose: false,
          });
          if (!afterId) return;
          request.afterId = afterId;
        } else if (request.action === "ready") {
          const ready = await promptReady(combat);
          if (!ready) return;
          Object.assign(request, ready);
          announce = { combatant: combat.combatant, ready };
        } else if (request.action === "return") request.delayedId = button.dataset.delayedId;
        else if (request.action === "ready-use" || request.action === "ready-clear") {
          const combatant = combat?.combatants?.get?.(button.dataset.readiedId);
          if (request.action === "ready-use" && !(await useReadied(combatant, event))) return;
          request.used = request.action === "ready-use";
          request.action = "ready-clear";
          request.readiedId = button.dataset.readiedId;
        }
        await sendTurnControl(request);
        if (announce) await announceReady(announce.combatant, announce.ready);
        await panel.refresh("turn-controls");
      } catch (error) {
        globalThis.ui?.notifications?.warn?.(error.message);
      } finally {
        panel._turnControlInFlight = false;
        button.disabled = false;
      }
    });
  }
}
