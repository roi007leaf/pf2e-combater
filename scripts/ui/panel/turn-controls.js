import { t, pf2eActionName } from "../../i18n.js";
import { SETTINGS, settingOrDefault } from "../../settings.js";
import { isSocketReady, requestTurnControl } from "../../socket.js";
import {
  attacksThisTurn, delayedTurn, delayTargets, delayUnavailableReason, handleTurnControl, ownsTurn,
  reactionUsed, readiedAction, readyUnavailableReason, turnCombatantName, turnIdentity,
} from "../../state/turn-controls.js";
import { bindPopoverMenu } from "./utility-menu.js";
import { chooseDestination } from "../destination-picker.js";
import { clearActionPreview } from "../action/preview.js";
import { showHoverGhost, showMovementPreview } from "../movement-preview.js";
import { cancelPanelPickers } from "./picker-workflow.js";
import { executeMovement } from "../../engine/execution/movement.js";

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
    hasMovement: Boolean(ready.movement?.destination),
    moveLabel: t("TurnControls.ReadiedMove", "Change destination"),
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

const READY_BASIC_ICONS = {
  stride: "fa-person-walking",
  step: "fa-shoe-prints",
  "raise-a-shield": "fa-shield-halved",
  interact: "fa-hand",
};

function strikeIsAgile(action) {
  const traits = [
    ...(action?.traits ?? []).map((trait) => trait?.name ?? trait),
    ...(action?.item?.system?.traits?.value ?? []),
  ].map((trait) => String(trait).toLowerCase());
  return traits.includes("agile");
}

function signed(value) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

// Ready takes a single action or free action. Strikes come first: they are the
// common case and the only ones whose MAP must be remembered.
export function readyChoices(actor) {
  const strikes = readyStrikes(actor).map((action) => {
    const label = action.label ?? action.name ?? action.slug;
    const total = Number(action.totalModifier);
    const step = strikeIsAgile(action) ? 4 : 5;
    const bonuses = Number.isFinite(total) ? [total, total - step, total - step * 2].map(signed) : [];
    return {
      value: `strike:${action.slug}`, strike: action.slug, label,
      text: t("TurnControls.ReadyStrike", "Strike: {weapon}", { weapon: label }),
      img: action.imageUrl ?? action.item?.img ?? "",
      detail: bonuses.length
        ? t("TurnControls.ReadyStrikeDetail", "Strike · {bonus}", { bonus: bonuses[0] })
        : t("TurnControls.ReadyStrikeShort", "Strike"),
      bonuses,
      mapSteps: step === 4 ? ["0", "−4", "−8"] : ["0", "−5", "−10"],
    };
  });
  const basics = ["stride", "step", ...(actor?.heldShield ? ["raise-a-shield"] : []), "interact"].map((slug) => {
    const label = pf2eActionName(slug);
    const ownItem = (actor?.itemTypes?.action ?? []).find?.((item) => (item.slug ?? item.system?.slug) === slug);
    const img = ownItem?.img ?? globalThis.game?.pf2e?.actions?.get?.(slug)?.img ?? "";
    return {
      value: `action:${slug}`, strike: null, label, text: label, img: /default-icons/.test(img) ? "" : img,
      icon: READY_BASIC_ICONS[slug] ?? "fa-bolt", detail: t("TurnControls.ReadyBasic", "Basic action"),
    };
  });
  return [...strikes, ...basics, {
    value: "other", strike: null, label: "", text: t("TurnControls.ReadyOther", "Another action…"),
    icon: "fa-pen", detail: t("TurnControls.ReadyOtherDetail", "Describe it"),
  }];
}

function readyCardHtml(choice, checked) {
  const art = choice.img
    ? `<img src="${escapeHtml(choice.img)}" alt="">`
    : `<i class="fa-solid ${escapeHtml(choice.icon ?? "fa-bolt")}" aria-hidden="true"></i>`;
  const classes = ["combater-ready-card", choice.strike ? "is-strike" : "", choice.value === "other" ? "is-other" : ""].filter(Boolean).join(" ");
  return `<label class="${classes}">
    <input type="radio" name="choice" value="${escapeHtml(choice.value)}"${checked ? " checked" : ""}
      data-bonuses="${escapeHtml((choice.bonuses ?? []).join(","))}" data-map-steps="${escapeHtml((choice.mapSteps ?? []).join(","))}">
    <span class="combater-ready-card-art">${art}</span>
    <span class="combater-ready-card-text"><strong>${escapeHtml(choice.value === "other" ? choice.text : choice.label)}</strong><small>${escapeHtml(choice.detail ?? "")}</small></span>
    <i class="fa-solid fa-circle-check combater-ready-card-check" aria-hidden="true"></i>
  </label>`;
}

async function promptReady(combat) {
  const combatant = combat.combatant;
  const choices = readyChoices(combatant?.actor);
  const attacks = Math.min(2, attacksThisTurn(combat));
  const attackNames = [
    t("TurnControls.ReadyAttack1", "1st attack"),
    t("TurnControls.ReadyAttack2", "2nd attack"),
    t("TurnControls.ReadyAttack3", "3rd attack"),
  ];
  const mapCards = attackNames.map((name, index) => `<label class="combater-ready-map">
        <input type="radio" name="mapIndex" value="${index}"${index === attacks ? " checked" : ""}>
        <strong data-ready-map-bonus="${index}"></strong><span>${escapeHtml(name)}</span><small data-ready-map-step="${index}"></small>
      </label>`).join("");
  const content = `<div class="combater-ready-form">
    <p class="combater-ready-rule">${escapeHtml(t("TurnControls.ReadyRuleNoTrigger", "Spend 2 actions and end your turn. Declare the trigger at the table; if it happens before your next turn starts, use the action as a reaction."))}</p>
    <fieldset class="combater-ready-group">
      <legend>${escapeHtml(t("TurnControls.ReadyAction", "Action"))}</legend>
      <div class="combater-ready-cards">${choices.map((choice, index) => readyCardHtml(choice, index === 0)).join("")}</div>
    </fieldset>
    <label class="combater-ready-field" data-ready-custom hidden><span>${escapeHtml(t("TurnControls.ReadyCustom", "Describe the action"))}</span>
      <input type="text" name="custom" maxlength="80" placeholder="${escapeHtml(t("TurnControls.ReadyCustomPlaceholder", "Cast Shield"))}"></label>
    <fieldset class="combater-ready-group" data-ready-map>
      <legend>${escapeHtml(t("TurnControls.ReadyMapLabel", "Attack penalty"))}</legend>
      <div class="combater-ready-maps">${mapCards}</div>
      <small class="combater-ready-hint">${escapeHtml(t("TurnControls.ReadyMapHint", "A readied attack keeps the multiple attack penalty you have now."))}</small>
    </fieldset>
  </div>`;
  const noMapLabel = t("TurnControls.ReadyNoMap", "No MAP");
  const result = await globalThis.foundry.applications.api.DialogV2.prompt({
    classes: ["pf2e-combater-delay-dialog", "pf2e-combater-ready-dialog"],
    position: { width: 500, height: "auto" },
    window: {
      title: t("TurnControls.ReadyTitle", "Ready an action for {name}", { name: turnCombatantName(combatant) }),
      icon: "fa-solid fa-bullseye",
    },
    content,
    render: (_event, dialog) => {
      const form = (dialog.element ?? dialog).querySelector?.("form");
      if (!form) return;
      // Strikes show their real bonus at each MAP step; other actions hide the penalty.
      const sync = () => {
        const selected = form.querySelector("input[name='choice']:checked");
        const value = selected?.value ?? "";
        form.querySelector("[data-ready-custom]").hidden = value !== "other";
        form.querySelector("[data-ready-map]").hidden = !value.startsWith("strike:");
        const bonuses = String(selected?.dataset.bonuses ?? "").split(",");
        const steps = String(selected?.dataset.mapSteps ?? "").split(",");
        for (let index = 0; index < 3; index += 1) {
          const bonus = form.querySelector(`[data-ready-map-bonus="${index}"]`);
          const step = form.querySelector(`[data-ready-map-step="${index}"]`);
          if (bonus) bonus.textContent = bonuses[index] || "";
          if (step) step.textContent = steps[index] && steps[index] !== "0" ? `MAP ${steps[index]}` : noMapLabel;
        }
        if (value === "other") form.querySelector("[name='custom']")?.focus();
      };
      for (const input of form.querySelectorAll("input[name='choice']")) input.addEventListener("change", sync);
      sync();
    },
    ok: {
      label: t("TurnControls.ReadyConfirm", "Ready (2 actions)"),
      icon: "fa-solid fa-bullseye",
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
  const movementSlug = ["action:stride", "action:step"].includes(choice?.value) ? choice.value.slice(7) : null;
  return { label, strike: choice?.strike ?? null, mapIndex: choice?.strike ? Number(result.mapIndex) || 0 : 0, movementSlug };
}

// The planner's own Stride/Step candidate carries the creature's Speed and footprint,
// so the picker shows the same reachable area as a planned move.
function readyMovementAction(panel, slug) {
  const candidates = [...(panel?._candidates ?? []), ...(panel?._detected ?? [])];
  return candidates.find((candidate) => (candidate?.slug ?? candidate?.id) === slug)
    ?? { id: slug, slug, name: pf2eActionName(slug), actionCost: 1, requiresDestination: true };
}

// Registered on the panel like the minion-step picker: background refreshes
// leave a picker in progress alone only while panel._destinationPicker is set.
function pickReadyDestination(panel, slug) {
  return new Promise((resolve) => {
    const context = panel?._context;
    const action = { ...readyMovementAction(panel, slug), requiresDestination: true };
    const pickerId = `ready:${context?.combatant?.id ?? "token"}:${slug}`;
    const previewStep = (preview = {}) => ({
      ...action,
      ...(preview.destination ? { destination: preview.destination } : {}),
      ...(preview.movementPlan ? { movementPlan: preview.movementPlan } : {}),
      ...(Number.isFinite(preview.elevation) ? { plannedElevation: preview.elevation } : {}),
    });
    const finish = (result) => {
      if (panel?._destinationPicker?.instanceId === pickerId) panel._destinationPicker = null;
      clearActionPreview();
      resolve(result);
    };
    cancelPanelPickers(panel);
    if (panel) panel._destinationPicker = { instanceId: pickerId, native: false, minion: true, context, action };
    globalThis.ui?.notifications?.info?.(t("TurnControls.ReadyPickDestination", "Choose where {action} will move when the trigger happens.", { action: pf2eActionName(slug) }));
    const picker = chooseDestination({
      context,
      action,
      enableWaypoints: true,
      onPreview: (destination, metadata = {}) => {
        if (metadata.hoverOnly) {
          showHoverGhost(context, { ...action, ...(metadata.movementPlan ? { movementPlan: metadata.movementPlan } : {}) }, destination);
          return;
        }
        const preview = { destination, movementPlan: metadata.movementPlan ?? null, elevation: metadata.elevation };
        if (panel) panel._destinationPicker = { instanceId: pickerId, native: false, minion: true, context, action, preview };
        showMovementPreview(context, previewStep(preview));
      },
      onChoose: (destination, metadata = {}) => finish({ slug, destination, movementPlan: metadata.movementPlan ?? null }),
      onCancel: () => finish(null),
    });
    if (!picker) {
      globalThis.ui?.notifications?.warn?.(t("Notify.NoDestinationPicker", "Canvas destination picker is not available."));
      finish(null);
      return;
    }
    if (panel) panel._destinationPicker = { instanceId: pickerId, native: picker.native === true, minion: true, context, action };
    if (!picker.native) showMovementPreview(context, previewStep());
  });
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
function readiedContext(panel, combatant) {
  if (panel?._context?.combatant?.id === combatant?.id) return panel._context;
  return { combat: combatant?.combat ?? globalThis.game?.combat, combatant, actor: combatant?.actor, token: combatant?.token };
}

async function useReadied(panel, combatant, event) {
  const ready = readiedAction(combatant);
  if (!ready) return false;
  if (ready.movement) {
    const result = await executeMovement({
      context: readiedContext(panel, combatant),
      step: { destination: ready.movement.destination, movementPlan: ready.movement.movementPlan },
      action: readyMovementAction(panel, ready.movement.slug),
      choices: { reaction: true },
    });
    if (result?.status !== "done") throw Error(result?.error ?? t("TurnControls.ReadiedMoveFailed", "The readied movement could not be completed."));
  }
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

// Hovering a readied Stride/Step draws its stored route, like hovering a planned move.
function bindReadiedPreview(panel, element) {
  const banner = element.querySelector("[data-readied-preview]");
  if (!banner) return;
  banner.addEventListener("pointerenter", () => {
    const combatant = globalThis.game?.combat?.combatants?.get?.(banner.dataset.readiedPreview);
    const movement = readiedAction(combatant)?.movement;
    if (!movement?.destination) return;
    showMovementPreview(readiedContext(panel, combatant), {
      ...readyMovementAction(panel, movement.slug),
      requiresDestination: true,
      destination: movement.destination,
      ...(movement.movementPlan ? { movementPlan: movement.movementPlan } : {}),
    });
  });
  const clear = (event) => panel._clearActionPreviewUnlessPicking?.(event);
  banner.addEventListener("pointerleave", clear);
  banner.addEventListener("pointercancel", clear);
}

export function activateTurnControlBindings(panel, element) {
  bindReadiedPreview(panel, element);
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
          const { movementSlug, ...ready } = (await promptReady(combat)) ?? {};
          if (!ready.label) return;
          if (movementSlug) {
            const movement = await pickReadyDestination(panel, movementSlug);
            if (!movement) return;
            ready.movement = movement;
          }
          Object.assign(request, ready);
          announce = { combatant: combat.combatant, ready };
        } else if (request.action === "return") request.delayedId = button.dataset.delayedId;
        else if (request.action === "ready-move") {
          const combatant = combat?.combatants?.get?.(button.dataset.readiedId);
          const slug = readiedAction(combatant)?.movement?.slug;
          if (!slug) return;
          const movement = await pickReadyDestination(panel, slug);
          if (!movement) return;
          request.readiedId = button.dataset.readiedId;
          request.movement = movement;
        } else if (request.action === "ready-use" || request.action === "ready-clear") {
          const combatant = combat?.combatants?.get?.(button.dataset.readiedId);
          if (request.action === "ready-use" && !(await useReadied(panel, combatant, event))) return;
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
