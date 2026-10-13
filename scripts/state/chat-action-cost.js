import { slugify } from "../engine/action/text.js";

function numericCost(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 3 ? number : null;
}

// Only read the action heading. Description text often contains OTHER actions' glyphs.
function headingData(message) {
  const html = `${message.flavor ?? ""} ${message.content ?? ""}`;
  const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i)?.[0];
  const heading = (header ?? html).match(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/i)?.[0] ?? "";
  const glyph = heading.match(/<span\b[^>]*class=["'][^"']*(?:action-glyph|pf2-icon)[^"']*["'][^>]*>([^<]*)<\/span>/i)?.[1]?.trim();
  const cost = ({ A: 1, D: 2, T: 3, R: 0, F: 0, "1": 1, "2": 2, "3": 3 })[glyph] ?? null;
  const label = heading.replace(/<span\b[\s\S]*?<\/span>/gi, "").replace(/<[^>]*>/g, "").trim();
  return { cost, label };
}

export function readChatAction(message) {
  const flags = message?.flags?.pf2e ?? {};
  const context = flags.context ?? {};
  const type = context.type ?? message?.rolls?.[0]?.options?.type ?? "";
  if (message?.isDamageRoll || message?.isReroll || context.isReroll
    || ["damage-roll", "saving-throw", "flat-check", "initiative", "initiative-roll", "recovery-check", "counteract-check"].includes(type)) return null;
  const options = Array.from(context.options ?? []);
  if (options.some((option) => /^(?:self:)?action:cost:(?:reaction|free)$/.test(option))) return null;
  const explicit = options.find((option) => /^self:action:cost:[0-3]$/.test(option))
    ?? options.find((option) => /^action:cost:[0-3]$/.test(option));
  const heading = headingData(message);
  let item;
  try { item = message.item; } catch (_error) { /* A deleted origin must not break chat. */ }
  const itemCost = item?.actionCost;
  const actionType = itemCost?.type ?? item?.system?.actionType?.value;
  if (["reaction", "free", "passive"].includes(actionType)) return null;
  const isStrike = type === "attack-roll" && (options.includes("action:strike")
    || ["weapon", "melee"].includes(item?.type));
  const cost = numericCost(explicit?.split(":").at(-1)) ?? heading.cost
    ?? numericCost(itemCost?.value ?? item?.system?.actions?.value ?? (item?.type === "spell" ? item?.system?.time?.value : null))
    ?? (isStrike ? 1 : null);
  if (!cost) return null;
  const slug = isStrike ? "strike" : options.find((option) => /^action:[^:]+$/.test(option))?.slice(7)
    ?? item?.slug ?? item?.system?.slug ?? slugify(heading.label);
  return {
    cost,
    slug,
    label: item?.name ?? heading.label ?? slug,
    origin: flags.origin?.uuid ?? (context.type === "self-effect" ? context.item : null),
    phase: type.endsWith("-roll") || type.endsWith("-check") ? "roll" : "card",
    spell: item?.type === "spell" || Boolean(flags.casting),
    movement: ["stride", "step", "swim", "fly", "climb", "burrow", "leap"].includes(slug),
  };
}
