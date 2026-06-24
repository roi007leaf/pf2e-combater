function normalizeSlug(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const EVENT_ALIASES = new Map([
  ["initiative-roll", "initiative"],
  ["initiative-rolled", "initiative"],
  ["rolled-initiative", "initiative"],
  ["turn-begins", "turn-start"],
  ["start-turn", "turn-start"],
  ["start-of-turn", "turn-start"],
  ["failed-save", "after-check-fail"],
  ["fail-save", "after-check-fail"],
  ["save-fail", "after-check-fail"],
  ["failed-check", "after-check-fail"],
  ["check-fail", "after-check-fail"],
  ["skill-check-fail", "after-check-fail"],
  ["successful-strike", "after-strike"],
  ["last-strike", "after-strike"],
  ["provokes", "provokes-reaction"],
  ["reaction-trigger", "provokes-reaction"],
  ["targeted-by-attack", "attacked"],
  ["hit", "attacked"],
  ["damaged-you", "damaged"],
]);

export function normalizeEventKey(value) {
  const slug = normalizeSlug(value);
  return EVENT_ALIASES.get(slug) ?? slug;
}

function add(keys, ...values) {
  for (const value of values) keys.add(normalizeEventKey(value));
}

export function eventKeysForText(value) {
  const text = String(value ?? "").toLowerCase();
  const keys = new Set();

  if (/\broll(?:ed)? initiative\b|\babout to roll initiative\b/.test(text)) {
    add(keys, "initiative");
  }
  if (/\bturn begins\b|\bstart of your turn\b|\byour turn begins\b/.test(text)) {
    add(keys, "turn-start");
  }
  if (/\bend of (?:a|any|your|another) .*turn\b/.test(text)) {
    add(keys, "turn-end");
  }
  if (
    /\bfail(?:ed|s)? (?:a )?(?:saving throw|save|skill check|check)\b/.test(text)
    || /\bfailed (?:save|saving throw|skill check|check)\b/.test(text)
  ) {
    add(keys, "after-check-fail");
  }
  if (/\bbefore .* roll\b|\babout to roll\b/.test(text)) {
    add(keys, "before-roll");
  }
  if (/\bafter .* strike\b|\blast action\b.{0,40}\bstrike\b|\bsuccessful strike\b/.test(text)) {
    add(keys, "after-strike");
  }
  if (/\bprevious action\b|\blast action\b|\bmost recent action\b/.test(text)) {
    add(keys, "previous-action");
  }
  if (/\btargeted\b|\btargets you\b/.test(text)) {
    add(keys, "targeted");
  }
  if (/\bhits? you\b|\battack\b/.test(text)) {
    add(keys, "attacked");
  }
  if (/\bdamages? you\b/.test(text)) {
    add(keys, "damaged");
  }
  if (/\bcast(?:s)? a spell\b/.test(text)) {
    add(keys, "spell-cast");
  }
  if (/\bmanipulate\b|\bmove action\b|\branged attack\b|\bleaves a square\b/.test(text)) {
    add(keys, "provokes-reaction");
  }

  return [...keys];
}

export function contextTriggerEvents(context) {
  const raw = context?.triggerEvents ?? context?.events ?? context?.battlefield?.triggerEvents ?? [];
  return new Set((Array.isArray(raw) ? raw : [raw])
    .filter(Boolean)
    .map(normalizeEventKey));
}

export function triggerMatchesContext(trigger, context) {
  const events = contextTriggerEvents(context);
  const keys = eventKeysForText(trigger);
  return keys.some((key) => events.has(key));
}
