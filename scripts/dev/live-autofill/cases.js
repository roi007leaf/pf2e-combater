// Live Auto-fill cases. Each: { id, group, title, t: [[ref, x, y, side, opts]], expect: [...] }.
// The first creature in `t` is the one planned for. ref: "iconic:Name" (level 5), "mc:Name"
// (Monster Core), "npc:Name" (NPC Core). Grid squares are 5 ft; x/y are square coordinates.
// opts: { name, hp (0..1), conds: [[slug, value]], hold: [weapon name parts], sheathe, tactic: { role, temperament },
//         intel: { saves: true, weaknesses: true, ... } (what the party has learned about this creature) }
// case options: intent: { lockTargets: [index], requiredSlug, noSpellSlots, stayRanged, preserveFinalAction },
//   horizon: "conserve" | "burst", playerView: true (plan as a player: intel limits what's known)
// expect: { top | notTop | top3 | never | first: RegExp, fn: (result) => true | "why", label }
// Plan text looks like: "Stride -> Longsword→Goblin A | Raise a Shield→Valeros".

const enemyCount = (minimum) => (result) => (result.context.battlefield?.enemies?.length ?? 0) >= minimum
  || `saw ${result.context.battlefield?.enemies?.length ?? 0} enemies`;

const topTargets = (result) => (result.plans[0]?.steps ?? []).map((step) => step?.suggestedTarget?.name ?? step?.preferredTarget?.name).filter(Boolean);

export const LIVE_AUTOFILL_CASES = [
  // ---- Martials --------------------------------------------------------------------------
  { id: "fighter-adjacent", group: "martial", title: "Fighter next to a goblin attacks it",
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy", { name: "Goblin A" }]],
    expect: [{ top: /Longsword|Double Slice|Power Attack|Shield Boss|Strike/, label: "attacks" }] },
  { id: "fighter-approach", group: "martial", title: "Fighter closes 20 ft and attacks",
    t: [["iconic:Valeros", 4, 10, "party"], ["mc:Goblin Warrior", 8, 10, "enemy", { name: "Goblin A" }]],
    expect: [{ top: /Stride|Sudden Charge/, label: "moves in" }, { top: /Longsword|Double Slice|Strike|Sudden Charge/, label: "and attacks" }] },
  { id: "fighter-far", group: "martial", title: "Fighter with the enemy 80 ft away moves, never attacks from range 80",
    t: [["iconic:Valeros", 2, 10, "party"], ["mc:Goblin Warrior", 18, 10, "enemy"]],
    expect: [{ top: /Stride/, label: "moves" }] },
  { id: "fighter-low-hp-shield", group: "martial", title: "Fighter at 30% HP between two goblins raises his shield",
    t: [["iconic:Valeros", 8, 10, "party", { hp: 0.3 }], ["mc:Goblin Warrior", 9, 10, "enemy", { name: "Goblin A" }], ["mc:Goblin Warrior", 7, 10, "enemy", { name: "Goblin B" }]],
    expect: [{ top3: /Raise a Shield/, label: "defends" }] },
  { id: "fighter-prone", group: "martial", title: "Prone fighter stands before acting",
    t: [["iconic:Valeros", 6, 10, "party", { conds: [["prone"]] }], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ top: /Stand/, label: "stands" }, { never: /^Stride/, label: "can't Stride while prone" }] },
  { id: "fighter-grabbed", group: "martial", title: "Grabbed fighter tries to Escape (or attacks the grabber)", maxMs: 1000,
    t: [["iconic:Valeros", 6, 10, "party", { conds: [["grabbed"]] }], ["mc:Hobgoblin Soldier", 7, 10, "enemy"]],
    expect: [{ never: /^Stride/, label: "can't Stride while grabbed" }] },
  { id: "barbarian-rage", group: "martial", title: "Barbarian rages and hits",
    t: [["iconic:Amiri", 6, 10, "party"], ["mc:Hobgoblin Soldier", 7, 10, "enemy"]],
    expect: [{ top: /Rage/, label: "rages" }] },
  { id: "rogue-weapons-drawn", group: "martial", title: "Rogue with rapier drawn attacks with it, not a fist",
    t: [["iconic:Merisiel", 5, 10, "party", { hold: ["rapier", "dagger"] }], ["mc:Hobgoblin Soldier", 6, 10, "enemy"]],
    expect: [{ top: /Rapier|Dagger/, label: "uses her weapons" }, { never: /Unarmed Attack/, label: "no fist" }] },
  { id: "rogue-sheathed", group: "martial", title: "Rogue with weapons sheathed draws one instead of punching",
    t: [["iconic:Merisiel", 5, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 6, 10, "enemy"]],
    expect: [{ notTop: /Unarmed Attack/, label: "doesn't punch" }, { top: /Draw|Rapier|Dagger|Shortbow/, label: "draws" }] },
  { id: "rogue-flank", group: "martial", title: "Rogue joins the fighter on the hobgoblin",
    t: [["iconic:Merisiel", 5, 7, "party", { hold: ["rapier", "dagger"] }], ["iconic:Valeros", 11, 10, "party"], ["mc:Hobgoblin Soldier", 12, 10, "enemy"]],
    expect: [{ top: /Rapier|Dagger/, label: "attacks the hobgoblin" }] },
  { id: "ranger-hunt", group: "martial", title: "Ranger with crossbow hunts prey and shoots",
    t: [["iconic:Harsk", 4, 10, "party", { hold: ["arbalest"] }], ["mc:Hobgoblin Soldier", 12, 10, "enemy"]],
    expect: [{ top: /Arbalest/, label: "shoots" }] },
  { id: "ranger-adjacent-crossbow", group: "martial", title: "Ranger holding a crossbow in both hands doesn't punch",
    t: [["iconic:Harsk", 10, 10, "party", { hold: ["arbalest"] }], ["mc:Kobold Warrior", 11, 10, "enemy"], ["mc:Hobgoblin Archer", 22, 10, "enemy"]],
    expect: [{ never: /Unarmed Attack/, label: "both hands on the crossbow" }] },
  { id: "monk-flurry", group: "martial", title: "Monk flurries",
    t: [["iconic:Sajan", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ top3: /Flurry/, label: "Flurry of Blows" }] },
  { id: "investigator-stratagem", group: "martial", title: "Investigator devises a stratagem",
    t: [["iconic:Quinn", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ top3: /Devise a Stratagem/, label: "Devise a Stratagem" }] },
  { id: "swashbuckler-panache", group: "martial", title: "Swashbuckler builds panache or finishes",
    t: [["iconic:Jirelle", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ top3: /Tumble|Bon Mot|Demoralize|Feint|Confident Finisher|Unbalancing|Finisher/, label: "panache play" }] },
  { id: "champion-ally-threatened", group: "martial", title: "Champion protects the wizard next to an ogre",
    t: [["iconic:Seelah", 9, 10, "party"], ["iconic:Ezren", 11, 11, "party"], ["mc:Ogre Warrior", 11, 9, "enemy"]],
    expect: [{ top: /Stride|Strike|Longsword|Raise a Shield|Champion|Shield/, label: "engages" }] },

  // ---- Casters -----------------------------------------------------------------------------
  { id: "wizard-fireball-ally", group: "caster", title: "Fireball on a goblin cluster without catching the fighter",
    t: [["iconic:Ezren", 3, 10, "party"], ["iconic:Valeros", 12, 10, "party"], ["mc:Goblin Warrior", 13, 9, "enemy", { name: "Goblin A" }],
      ["mc:Goblin Warrior", 13, 11, "enemy", { name: "Goblin B" }], ["mc:Goblin Warrior", 14, 10, "enemy", { name: "Goblin C" }]],
    expect: [{ top3: /Fireball/, label: "casts Fireball" }, { label: "Fireball avoids Valeros", fn: (result) => {
      const fireball = result.built.candidates.find((entry) => /fireball/i.test(entry.name));
      if (!fireball) return "no Fireball candidate";
      const best = fireball.activityProfile?.areaPlacementOptions?.[0];
      return !best || best.allyCount === 0 || `best placement catches ${best.allyCount} ally`;
    } }] },
  { id: "wizard-no-self-haste", group: "caster", title: "Wizard alone never hastes himself",
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Hobgoblin Soldier", 12, 10, "enemy"]],
    expect: [{ never: /Haste→Ezren/, label: "no self-Haste" }] },
  { id: "wizard-haste-fighter", group: "caster", title: "Haste goes to the fighter in range",
    t: [["iconic:Ezren", 6, 10, "party"], ["iconic:Valeros", 10, 10, "party"], ["mc:Hobgoblin Soldier", 11, 10, "enemy"]],
    expect: [{ never: /Haste→Ezren/, label: "not on himself" }] },
  { id: "wizard-far-target", group: "caster", title: "Wizard against a target 100 ft away stays in spell range",
    t: [["iconic:Ezren", 2, 10, "party"], ["mc:Hobgoblin Soldier", 22, 10, "enemy"]],
    expect: [] },
  { id: "cleric-heal-dying", group: "caster", title: "Cleric heals the dying fighter",
    t: [["iconic:Kyra", 5, 10, "party"], ["iconic:Valeros", 7, 10, "party", { hp: 0, conds: [["dying", 1]] }], ["mc:Ogre Warrior", 11, 10, "enemy"]],
    expect: [{ first: /Heal/, label: "Heal first" }, { top: /Heal[^|]*→Valeros/, label: "on Valeros" }] },
  { id: "druid-heal-dying", group: "caster", title: "Druid heals the dying barbarian instead of attacking",
    t: [["iconic:Lini", 5, 10, "party"], ["iconic:Amiri", 7, 10, "party", { hp: 0, conds: [["dying", 1], ["unconscious"]] }], ["mc:Wolf", 11, 10, "enemy"]],
    expect: [{ top: /Heal|Stabilize/, label: "heals or stabilizes" }] },
  { id: "cleric-heal-far", group: "caster", title: "Cleric reaches a dying ally 55 ft away",
    t: [["iconic:Kyra", 3, 10, "party"], ["iconic:Valeros", 14, 10, "party", { hp: 0, conds: [["dying", 1]] }], ["mc:Goblin Warrior", 18, 10, "enemy"]],
    expect: [{ top: /Heal|Stabilize/, label: "helps Valeros" }] },
  { id: "cleric-healthy-party", group: "caster", title: "Cleric doesn't heal a healthy party",
    t: [["iconic:Kyra", 5, 10, "party"], ["iconic:Valeros", 7, 10, "party"], ["mc:Goblin Warrior", 9, 10, "enemy"]],
    expect: [{ never: /Heal[^|]*→(Valeros|Kyra)/, label: "no pointless heal" }] },
  { id: "bard-composition", group: "caster", title: "Bard plays a composition for the party",
    t: [["iconic:Lem", 4, 10, "party"], ["iconic:Valeros", 8, 10, "party"], ["iconic:Amiri", 8, 12, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ top3: /Anthem|Composition|Courageous|Rallying|Song/, label: "composition" }] },
  { id: "sorcerer-blast", group: "caster", title: "Sorcerer damages an enemy at range",
    t: [["iconic:Seoni", 4, 10, "party"], ["mc:Hobgoblin Soldier", 10, 10, "enemy"]],
    expect: [] },

  // ---- NPCs ---------------------------------------------------------------------------------
  { id: "npc-goblin-melee", group: "npc", title: "Goblin attacks the adjacent fighter",
    t: [["mc:Goblin Warrior", 7, 10, "enemy"], ["iconic:Valeros", 6, 10, "party"]],
    expect: [{ top: /Dogslicer|Shortbow|Strike/, label: "attacks" }] },
  { id: "npc-archer-adjacent", group: "npc", title: "Hobgoblin archer with a fighter adjacent",
    t: [["mc:Hobgoblin Archer", 8, 10, "enemy"], ["iconic:Valeros", 9, 10, "party"], ["iconic:Ezren", 3, 14, "party"]],
    expect: [{ top: /Crossbow|Shortbow|Composite|Strike|Stride Away/, label: "shoots" }] },
  { id: "npc-wolf-pack", group: "npc", title: "Wolves bite, never Grapple or Disarm",
    t: [["mc:Wolf", 6, 10, "enemy", { name: "Wolf A" }], ["iconic:Valeros", 10, 10, "party"], ["iconic:Kyra", 12, 10, "party"], ["mc:Wolf", 14, 9, "enemy", { name: "Wolf B" }]],
    expect: [{ never: /Grapple|Disarm/, label: "no hands" }, { top: /Jaws/, label: "bites" }] },
  { id: "npc-wasp-swarm", group: "npc", title: "Wasp swarm flies onto the party and stings",
    t: [["mc:Wasp Swarm", 5, 4, "enemy"], ["iconic:Valeros", 8, 10, "party"], ["iconic:Ezren", 9, 11, "party"], ["iconic:Kyra", 7, 11, "party"]],
    expect: [{ top: /Swarming Stings/, label: "stings" }, { never: /Trip|Grapple|Shove/, label: "swarms can't maneuver" }] },
  { id: "npc-swarm-on-top", group: "npc", title: "Swarm already on the party stings every action",
    t: [["mc:Wasp Swarm", 8, 10, "enemy"], ["iconic:Valeros", 8, 10, "party"], ["iconic:Ezren", 9, 11, "party"]],
    expect: [{ fn: (result) => (result.plans[0]?.steps ?? []).filter((step) => /Swarming Stings/.test(step.name)).length >= 2 || "stings fewer than twice", label: "repeats stings" }] },
  { id: "npc-dragon-breath", group: "npc", title: "Dragon breathes on three clustered PCs",
    t: [["mc:Horned Dragon (Young)", 6, 8, "enemy"], ["iconic:Valeros", 11, 9, "party"], ["iconic:Merisiel", 11, 11, "party"], ["iconic:Ezren", 12, 10, "party"]],
    expect: [{ top3: /Breath/, label: "breath weapon considered" }] },
  { id: "npc-dragon-recharging", group: "npc", title: "Recharging breath is never planned",
    t: [["mc:Horned Dragon (Young)", 6, 8, "enemy"], ["iconic:Valeros", 9, 9, "party"], ["iconic:Merisiel", 9, 11, "party"]],
    setup: async ({ tokens, combat }) => {
      const dragon = tokens[0].actor;
      const breath = dragon.items.find((item) => /breath/i.test(item.name));
      if (breath) await dragon.setFlag("pf2e-combater", `npcRecharge.${breath.id}`, { combatId: combat.id, readyRound: (combat.round ?? 1) + 3, rounds: 3 });
    },
    expect: [{ never: /Breath/, label: "recharging" }] },
  { id: "npc-dragon-frenzy", group: "npc", title: "Dragon next to one PC uses Draconic Frenzy or bites",
    t: [["mc:Horned Dragon (Young)", 6, 9, "enemy"], ["iconic:Valeros", 8, 10, "party"]],
    expect: [{ top: /Frenzy|Jaws|Claw|Horn|Tail/, label: "attacks" }] },
  { id: "npc-zombie-mindless", group: "npc", title: "Mindless zombie never Demoralizes, Disarms or Feints",
    t: [["mc:Zombie Brute", 8, 10, "enemy"], ["iconic:Valeros", 9, 10, "party"], ["iconic:Ezren", 9, 12, "party"]],
    expect: [{ never: /Demoralize|Disarm|Feint|Create a Diversion/, label: "mindless" }] },
  { id: "npc-octopus-grab", group: "npc", title: "Grab only right after a Strike that lists it",
    t: [["mc:Giant Octopus", 7, 10, "enemy"], ["iconic:Valeros", 9, 10, "party"]],
    expect: [{ fn: (result) => {
      for (const plan of result.plans.slice(0, 3)) {
        const steps = plan.steps ?? [];
        for (const [index, step] of steps.entries()) {
          if (/^Grab/.test(step.name) && !(index > 0 && /Strike|Tentacle|Arm|Beak|Jaws|Bite|Writhing/i.test(steps[index - 1]?.name ?? ""))) return `Grab without a Strike before it: ${steps.map((entry) => entry.name).join(" | ")}`;
        }
      }
      return true;
    }, label: "Grab follows a Strike" }] },
  { id: "npc-ogre-boss-reactive", group: "npc", title: "Ogre boss next to the fighter keeps hitting him",
    t: [["mc:Ogre Boss", 9, 10, "enemy"], ["iconic:Valeros", 10, 10, "party"], ["iconic:Ezren", 4, 14, "party"]],
    expect: [{ notTop: /Stride Away/, label: "doesn't step away to throw javelins" }] },
  { id: "npc-coward-wounded", group: "npc", title: "Wounded cowardly kobold gets away",
    t: [["mc:Kobold Scout", 8, 10, "enemy", { hp: 0.25, tactic: { role: "auto", temperament: "coward" } }], ["iconic:Valeros", 9, 10, "party"]],
    expect: [{ top: /Stride Away|Step|Scamper|Stride/, label: "retreats" }] },
  { id: "npc-berserker", group: "npc", title: "Berserker at low HP keeps attacking",
    t: [["mc:Orc Commander", 8, 10, "enemy", { hp: 0.2, tactic: { role: "auto", temperament: "berserker" } }], ["iconic:Valeros", 9, 10, "party"]],
    expect: [{ notTop: /Stride Away/, label: "no retreat" }] },
  { id: "npc-rat-swarm", group: "npc", title: "Rat swarm never Trips or Grapples",
    t: [["mc:Rat Swarm", 7, 10, "enemy"], ["iconic:Valeros", 7, 10, "party"]],
    expect: [{ never: /Trip|Grapple|Shove|Disarm/, label: "swarm" }] },
  { id: "npc-priest", group: "npc", title: "Priest NPC acts (spells or strikes) without breaking range",
    t: [["npc:Priest of Sarenrae", 4, 10, "enemy"], ["iconic:Valeros", 10, 10, "party"], ["iconic:Merisiel", 11, 12, "party"]],
    expect: [] },

  // ---- Conditions and context -------------------------------------------------------------
  { id: "out-of-combat", group: "context", title: "Out of combat still sees allies and enemies", combat: false,
    t: [["iconic:Valeros", 5, 10, "party"], ["iconic:Merisiel", 5, 12, "party"], ["mc:Goblin Warrior", 12, 10, "enemy"]],
    expect: [{ fn: enemyCount(1), label: "sees the goblin" }] },
  { id: "slowed", group: "context", title: "Slowed 1 fighter plans at most 2 actions",
    t: [["iconic:Valeros", 6, 10, "party", { conds: [["slowed", 1]] }], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ fn: (result) => Number(result.plans[0]?.totalCost ?? 0) <= 2 || `plans ${result.plans[0]?.totalCost} actions`, label: "2 actions" }] },
  { id: "focus-fire", group: "team", title: "Fighter joins the rogue on the goblin she is fighting",
    t: [["iconic:Valeros", 8, 10, "party"], ["iconic:Merisiel", 10, 8, "party", { hold: ["rapier"] }], ["mc:Goblin Warrior", 9, 8, "enemy", { name: "Goblin A" }], ["mc:Goblin Warrior", 9, 12, "enemy", { name: "Goblin B" }]],
    expect: [{ fn: (result) => {
      const goblinA = result.tokens[2]?.id;
      const ids = (result.plans[0]?.steps ?? []).map((step) => step?.suggestedTarget?.id ?? step?.preferredTarget?.id).filter(Boolean);
      return ids.includes(goblinA) || `targets ${topTargets(result).join(", ")} (not the goblin Merisiel is fighting)`;
    }, label: "focus fire" }] },
];

// ---- Second batch: class features, conditions, target states, more monsters -------------------
const targetIdIs = (index) => (result) => {
  const wanted = result.tokens[index]?.id;
  const ids = (result.plans[0]?.steps ?? []).map((step) => step?.suggestedTarget?.id ?? step?.preferredTarget?.id).filter(Boolean);
  return ids.includes(wanted) || `targets ${topTargets(result).join(", ") || "nobody"}`;
};

LIVE_AUTOFILL_CASES.push(
  // Class features
  { id: "guardian-taunt", group: "class", title: "Guardian protects (Taunt, shield) when an ally is threatened",
    t: [["iconic:Grimmyr", 8, 10, "party"], ["iconic:Ezren", 10, 11, "party"], ["mc:Ogre Warrior", 10, 9, "enemy"]],
    expect: [{ top3: /Taunt|Raise a Shield|Intercept|Guardian|Strike|Stride/, label: "guards" }] },
  { id: "inventor-overdrive", group: "class", title: "Inventor uses an inventor action",
    t: [["iconic:Droven", 7, 10, "party"], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ top3: /Overdrive|Explode|Unstable|Strike|Warhammer/, label: "inventor play" }] },
  { id: "thaumaturge-exploit", group: "class", title: "Thaumaturge exploits a vulnerability",
    t: [["iconic:Mios", 7, 10, "party"], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ top3: /Exploit Vulnerability/, label: "Exploit Vulnerability" }] },
  { id: "thaumaturge-exploit-before-approach", group: "class", title: "Thaumaturge who must Stride still Exploits before the first Strike",
    t: [["iconic:Mios", 5, 10, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ fn: (result) => {
      const steps = result.plans[0]?.steps ?? [];
      const exploit = steps.findIndex((step) => /Exploit Vulnerability/.test(step.name));
      const strike = steps.findIndex((step) => step.activityProfile?.includesStrike === true || step.source === "strike");
      if (exploit < 0) return true;
      return strike < 0 || exploit < strike || `Exploit after the Strike: ${steps.map((step) => step.name).join(" | ")}`;
    }, label: "Exploit first" }] },
  { id: "draws-weapon-over-fist", group: "class", title: "Thaumaturge with weapons stowed draws one instead of punching",
    t: [["iconic:Mios", 7, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ top: /Draw/, label: "draws a weapon" }, { notTop: /Unarmed Attack|Fist/, label: "no fist" }] },
  { id: "swashbuckler-draws-best-weapon", group: "class", title: "Swashbuckler with weapons stowed draws the rapier, not the main-gauche",
    t: [["iconic:Jirelle", 7, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ top: /Rapier/, label: "draws the rapier" }, { notTop: /Main-Gauche|Dagger|Unarmed Attack/, label: "no lesser weapon" }] },
  { id: "swashbuckler-approach-draw", group: "class", title: "Swashbuckler with weapons stowed walks up and draws instead of punching",
    t: [["iconic:Jirelle", 5, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ top: /Rapier/, label: "draws the rapier" }, { notTop: /Unarmed Attack/, label: "no fist" }] },
  { id: "swashbuckler-default-loadout", group: "class", title: "Swashbuckler as shipped (buckler, weapons worn) walks up and draws the rapier",
    t: [["iconic:Jirelle", 5, 10, "party"], ["mc:Wolf", 10, 10, "enemy"]],
    expect: [{ top: /Rapier/, label: "draws the rapier" }, { notTop: /Main-Gauche|Unarmed Attack/, label: "no lesser weapon" }] },
  { id: "swashbuckler-draws-rapier-vs-boss", group: "class", title: "Swashbuckler walking up to an ogre boss still draws the rapier",
    t: [["iconic:Jirelle", 5, 10, "party"], ["mc:Ogre Boss", 9, 10, "enemy"]],
    expect: [{ top: /Rapier/, label: "draws the rapier" }, { notTop: /Main-Gauche|Unarmed Attack/, label: "no lesser weapon" }] },
  { id: "rogue-quick-draw-weapon", group: "class", title: "Rogue with weapons stowed: Quick Draw lands with a weapon, not the fist",
    t: [["iconic:Merisiel", 7, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ notTop: /Unarmed Attack/, label: "no fist Strike" },
      { fn: (result) => !(result.plans[0]?.steps ?? []).some((step) => step.activityProfile?.backingStrike?.item?.slug === "basic-unarmed") || "an activity lands with the fist", label: "no fist activity" }] },
  { id: "runesmith-invokes-traced-rune", group: "class", title: "Runesmith invokes the rune on the creature it traced",
    t: [["built:runesmith", 6, 10, "party"], ["mc:Hobgoblin Soldier", 7, 10, "enemy"], ["mc:Hobgoblin Archer", 7, 12, "enemy"]],
    expect: [{ fn: (result) => {
      const steps = result.plans[0]?.steps ?? [];
      const target = (step) => step.suggestedTarget?.id ?? step.preferredTarget?.id;
      const traced = steps.filter((step) => /trace-rune$/.test(String(step.slug ?? step.id))).map(target);
      const strays = steps.filter((step) => /invoke-rune$/.test(String(step.slug ?? step.id)) && traced.length && !traced.includes(target(step)));
      return !strays.length || "invokes a rune on a creature it didn't trace";
    }, label: "invoke matches trace" }] },
  { id: "magus-closes-to-spellstrike", group: "class", title: "Magus (built) 20 ft away walks in and Spellstrikes instead of casting from range",
    t: [["built:magus", 5, 10, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ top: /Spellstrike/, label: "Spellstrikes" }] },
  { id: "magus-starlit-ranged-spellstrike", group: "class", title: "Starlit Span magus Spellstrikes with its bow from 40 ft",
    t: [["built:magus-starlit", 5, 10, "party"], ["mc:Hobgoblin Soldier", 13, 10, "enemy"]],
    expect: [{ top: /Spellstrike/, label: "Spellstrikes" }, { notTop: /Stride/, label: "stays at range" }] },
  { id: "near-death-pc-survives", group: "condition", title: "Monk at 1 HP next to a soldier saves himself instead of attacking",
    t: [["iconic:Sajan", 7, 10, "party", { hp: 0.02 }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ top: /Elixir|Potion|Heal|Step|Stride|Retreat|Cover/, label: "heals or gets away" }] },
  { id: "healer-tops-up-critical-ally", group: "caster", title: "Druid heals an ally at 15% with an ogre next to him instead of attacking",
    t: [["iconic:Lini", 5, 10, "party"], ["iconic:Lem", 7, 11, "party", { hp: 0.15 }], ["mc:Ogre Warrior", 8, 11, "enemy"]],
    expect: [{ top: /Heal|Potion|Elixir/, label: "heals Lem" }] },
  { id: "summoner-eidolon-strikes", group: "class", title: "Summoner's turn includes its eidolon attacking (its Strikes or Act Together)",
    t: [["built:summoner", 5, 10, "party"], ["pfs:Three-Headed Goat Eidolon", 7, 10, "party", { elite: true, name: "Eidolon" }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ fn: (result) => (result.plans[0]?.steps ?? []).some((step) => step.activityProfile?.eidolonStrike || /Goat Bite|Hoof/.test(String(step.activityProfile?.minionPlan?.label ?? ""))) || "the eidolon does nothing this turn", label: "the eidolon attacks" }] },
  { id: "commander-pincer-when-flanking", group: "class", title: "Commander (Commanderer squad) issues a tactic its squad can use: fighter is next to the enemy",
    t: [["iconic:Ulka", 5, 10, "party", { commander: true }], ["iconic:Valeros", 8, 10, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ top: /Strike Hard|Pincer Attack|Coordinating Maneuvers/, label: "a useful tactic" }, { notTop: /Gather to Me/, label: "no pointless gather" }] },
  { id: "commander-no-squad-no-tactics", group: "class", title: "Commander with nobody in the squad doesn't spam tactics",
    t: [["iconic:Ulka", 5, 10, "party"], ["mc:Hobgoblin Soldier", 6, 10, "enemy"]],
    expect: [{ notTop: /Pincer Attack|Strike Hard|Gather to Me|Coordinating Maneuvers|Protective Screen/, label: "no tactics without a squad" }] },
  { id: "wizard-saves-slots-on-goblins", group: "caster", title: "Level-5 wizard keeps Fireball for a real threat against two goblin warriors",
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Goblin Warrior", 9, 9, "enemy"], ["mc:Goblin Warrior", 9, 11, "enemy"]],
    expect: [{ notTop: /Fireball|Lightning Bolt/, label: "no top-rank slot on goblins" }] },
  { id: "fighter-finishes-wounded", group: "tactics", title: "Fighter between two hobgoblins finishes the one at 20%",
    t: [["iconic:Valeros", 8, 10, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy", { name: "Fresh" }], ["mc:Hobgoblin Soldier", 7, 10, "enemy", { name: "Wounded", hp: 0.2 }]],
    expect: [{ fn: (result) => {
      const wounded = result.tokens[2]?.id;
      const attack = (result.plans[0]?.steps ?? []).find((step) => step.suggestedTarget?.type === "enemy" || /Slice|Strike|Sword/.test(step.name));
      return attack?.suggestedTarget?.id === wounded || `attacks ${attack?.suggestedTarget?.id} instead of the wounded one`;
    }, label: "hits the wounded one" }] },
  { id: "guardian-attacks-when-engaged", group: "class", title: "Guardian next to an ogre with an ally nearby still attacks",
    t: [["iconic:Grimmyr", 7, 10, "party"], ["iconic:Ezren", 5, 11, "party"], ["mc:Ogre Warrior", 8, 10, "enemy"]],
    expect: [{ top: /Gauntlet|Strike|Dagger|Axe|Hammer|Sword|Trip|Shove/, label: "attacks" }] },
  { id: "magus-recharges-spent-spellstrike", group: "class", title: "Magus with Spellstrike spent recharges it (or uses a conflux spell) before Spellstriking",
    t: [["built:magus", 7, 10, "party", { spellstrikeSpent: true }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ fn: (result) => {
      const steps = result.plans[0]?.steps ?? [];
      const strike = steps.findIndex((step) => step.activityProfile?.spellstrike === true);
      const recharge = steps.findIndex((step) => step.activityProfile?.rechargeSpellstrike === true || /Thunderous Strike/.test(step.name));
      return strike < 0 || (recharge >= 0 && recharge < strike) || "Spellstrikes while spent";
    }, label: "no spent Spellstrike" }] },
  { id: "melee-closes-on-far-archer", group: "tactics", title: "Runesmith with an archer 45 ft away uses its turn to close in",
    t: [["built:runesmith", 5, 10, "party"], ["mc:Hobgoblin Archer", 14, 10, "enemy"]],
    expect: [{ fn: (result) => Number(result.plans[0]?.totalCost ?? 0) >= 2 || `only ${result.plans[0]?.totalCost} action(s) used`, label: "uses its actions" }, { top: /Stride|Step/, label: "moves toward the enemy" }] },
  { id: "champion-protects-caster", group: "tactics", title: "Champion leaves a goblin to stand by the wizard an ogre is attacking",
    t: [["iconic:Seelah", 5, 10, "party"], ["mc:Goblin Warrior", 6, 9, "enemy"], ["iconic:Ezren", 10, 13, "party", { hp: 0.6 }], ["mc:Ogre Warrior", 11, 13, "enemy"]],
    expect: [{ fn: (result) => {
      const ogre = result.tokens[3]?.id;
      return (result.plans[0]?.steps ?? []).some((step) => step.suggestedTarget?.id === ogre) || "stays on the goblin";
    }, label: "goes to the ogre" }] },
  { id: "barbarian-draws-sword", group: "class", title: "Barbarian with the sword stowed doesn't charge with a fist",
    t: [["iconic:Amiri", 5, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ notTop: /Unarmed Attack/, label: "no fist Strike" },
      { fn: (result) => !(result.plans[0]?.steps ?? []).some((step) => step.activityProfile?.backingStrike?.item?.slug === "basic-unarmed") || "charges with the fist", label: "no fist charge" }] },
  { id: "draw-then-strike-again", group: "class", title: "Ranger with weapons stowed draws the war axe and attacks with it twice",
    t: [["iconic:Harsk", 7, 10, "party", { sheathe: true }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"]],
    expect: [{ top: /Draw[^|]*War Axe -> Strike[^|]*\|[^|]*War Axe/, label: "draw, strike, strike again" }, { notTop: /Unarmed Attack/, label: "no fist" }] },
  { id: "monk-prone-stands", group: "class", title: "Prone, hurt monk next to a soldier stands and fights",
    t: [["iconic:Sajan", 7, 10, "party", { hp: 0.47, conds: [["prone"]] }], ["mc:Hobgoblin Soldier", 8, 10, "enemy"], ["mc:Hobgoblin Archer", 14, 10, "enemy"]],
    expect: [{ first: /Stand/, label: "stands first" }, { top: /Flurry|Fist|Strike|Kick|Palm/, label: "attacks" }] },
  { id: "kineticist-impulse", group: "class", title: "Kineticist uses impulses",
    t: [["iconic:Yoon", 5, 10, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy"]],
    expect: [{ top3: /Elemental Blast|Channel Elements|Impulse|Blast|Flame|Fire|Wave|Burst/, label: "impulses" }] },
  { id: "alchemist-bombs", group: "class", title: "Alchemist throws bombs or brews",
    t: [["iconic:Fumbus", 5, 10, "party"], ["mc:Hobgoblin Soldier", 10, 10, "enemy"]],
    expect: [{ top3: /Bomb|Alchemist's Fire|Acid Flask|Frost Vial|Thunderstone|Quick Alchemy|Blight|Bottled/, label: "alchemy" }] },
  { id: "gunslinger-shoot", group: "class", title: "Gunslinger shoots and reloads sensibly",
    t: [["iconic:Nhalmika", 4, 10, "party"], ["mc:Hobgoblin Soldier", 10, 10, "enemy"]], expect: [] },
  { id: "witch-hex", group: "class", title: "Witch casts a hex or a spell",
    t: [["iconic:Feiya", 4, 10, "party"], ["mc:Hobgoblin Soldier", 9, 10, "enemy"], ["iconic:Valeros", 8, 11, "party"]], expect: [] },
  { id: "summoner-act", group: "class", title: "Summoner (built) acts",
    t: [["built:summoner", 5, 10, "party"], ["mc:Hobgoblin Soldier", 7, 10, "enemy"]], expect: [] },
  { id: "magus-spellstrike", group: "class", title: "Magus (built) with a longsword attacks",
    t: [["built:magus", 6, 10, "party"], ["mc:Hobgoblin Soldier", 7, 10, "enemy"]],
    expect: [{ top: /Longsword|Spellstrike|Strike|Arcane Cascade/, label: "attacks" }] },

  // Conditions on the actor
  { id: "stunned", group: "condition", title: "Stunned 1 fighter plans at most 2 actions",
    t: [["iconic:Valeros", 6, 10, "party", { conds: [["stunned", 1]] }], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ fn: (result) => Number(result.plans[0]?.totalCost ?? 0) <= 2 || `plans ${result.plans[0]?.totalCost} actions`, label: "loses an action" }] },
  { id: "quickened", group: "condition", title: "Quickened fighter uses at most 4 actions",
    t: [["iconic:Valeros", 6, 10, "party", { conds: [["quickened"]] }], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ fn: (result) => Number(result.plans[0]?.totalCost ?? 0) <= 4 || `plans ${result.plans[0]?.totalCost} actions`, label: "4 at most" }] },
  { id: "sickened", group: "condition", title: "Sickened fighter can Retch or fight",
    t: [["iconic:Valeros", 6, 10, "party", { conds: [["sickened", 2]] }], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ top3: /Retch|Longsword|Double Slice|Strike/, label: "acts" }] },

  // Target states
  { id: "target-prone", group: "target", title: "Never Trip a prone goblin",
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy", { conds: [["prone"]] }]],
    expect: [{ never: /Trip/, label: "already prone" }] },
  { id: "target-frightened", group: "target", title: "Don't Demoralize a goblin already frightened 2",
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy", { conds: [["frightened", 2]] }]],
    expect: [{ notTop: /Demoralize/, label: "already frightened" }] },
  { id: "target-mindless", group: "target", title: "Never Demoralize a mindless zombie",
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Zombie Shambler", 7, 10, "enemy"]],
    expect: [{ never: /Demoralize/, label: "mindless is immune" }] },
  { id: "target-finisher", group: "target", title: "Finish the nearly dead goblin",
    t: [["iconic:Valeros", 8, 10, "party"], ["mc:Goblin Warrior", 9, 9, "enemy", { name: "Goblin A" }], ["mc:Goblin Warrior", 9, 11, "enemy", { name: "Goblin B", hp: 0.1 }]],
    expect: [{ fn: targetIdIs(2), label: "attacks the wounded goblin" }] },

  // More monsters
  { id: "npc-troop", group: "npc", title: "Troop never makes Athletics maneuvers",
    t: [["npc:Bandit Gang", 7, 9, "enemy"], ["iconic:Valeros", 10, 10, "party"]],
    expect: [{ never: /Trip|Grapple|Shove|Disarm/, label: "troop" }] },
  { id: "npc-pyro-cluster", group: "npc", title: "Goblin pyro burns a cluster",
    t: [["mc:Goblin Pyro", 4, 10, "enemy"], ["iconic:Valeros", 9, 9, "party"], ["iconic:Merisiel", 9, 11, "party"], ["iconic:Ezren", 10, 10, "party"]],
    expect: [{ top3: /Breathe Fire|Fire|Burn|Ignition|Produce Flame|Flame/, label: "fire" }] },
  { id: "npc-archer-range", group: "npc", title: "Hobgoblin archer shoots from range",
    t: [["mc:Hobgoblin Archer", 3, 10, "enemy"], ["iconic:Valeros", 15, 10, "party"]],
    expect: [{ top: /Bow|Crossbow|Strike/, label: "shoots" }, { notTop: /^Stride→/, label: "doesn't walk into melee" }] },
  { id: "npc-basilisk", group: "npc", title: "Basilisk doesn't Demoralize (untrained)",
    t: [["mc:Basilisk", 7, 10, "enemy"], ["iconic:Valeros", 9, 10, "party"]],
    expect: [{ never: /Demoralize/, label: "untrained" }] },
  { id: "npc-ghoul", group: "npc", title: "Ghoul soldier attacks",
    t: [["mc:Ghoul Soldier", 7, 10, "enemy"], ["iconic:Valeros", 8, 10, "party"]],
    expect: [{ top: /Jaws|Claw|Strike|Spear|Stride/, label: "attacks" }] },
  { id: "npc-warg", group: "npc", title: "Warg closes and bites, no hands for Grapple",
    t: [["mc:Warg", 4, 10, "enemy"], ["iconic:Ezren", 9, 10, "party"]],
    expect: [{ top: /Jaws|Stride/, label: "attacks" }, { never: /Grapple|Disarm/, label: "no hands" }] },
);

// ---- Turn intent, resource horizon, intel and Recall Knowledge --------------------------------
const allTargetIds = (result) => (result.plans[0]?.steps ?? []).map((step) => step?.suggestedTarget?.id ?? step?.preferredTarget?.id).filter(Boolean);
const enemyTargetsOnly = (index) => (result) => {
  const wanted = result.tokens[index]?.id;
  const enemyIds = new Set(result.tokens.filter((token) => token.disposition === -1).map((token) => token.id));
  const hits = allTargetIds(result).filter((id) => enemyIds.has(id));
  return hits.every((id) => id === wanted) || `targets other enemies: ${topTargets(result).join(", ")}`;
};
const LEVELED_EZREN = /Fireball|Force Barrage|Haste|Dispel Magic|Thunderstrike|Mystic Armor|Blur|Invisibility|Acid Grip|Spider Sting|Grease/;

LIVE_AUTOFILL_CASES.push(
  // Turn intent
  { id: "intent-locked-target", group: "intent", title: "Locked target: every attack goes to goblin B",
    intent: { lockTargets: [2] },
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy", { name: "Goblin A" }], ["mc:Goblin Warrior", 7, 11, "enemy", { name: "Goblin B" }]],
    expect: [{ fn: enemyTargetsOnly(2), label: "only the locked target" }] },
  { id: "intent-no-spell-slots", group: "intent", title: "No spell slots: cantrips and actions only",
    intent: { noSpellSlots: true },
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Hobgoblin Soldier", 10, 10, "enemy"], ["mc:Hobgoblin Soldier", 10, 11, "enemy"]],
    expect: [{ never: LEVELED_EZREN, label: "no slotted spells" }] },
  { id: "intent-stay-ranged", group: "intent", title: "Stay ranged: the crossbow ranger never fights in melee",
    intent: { stayRanged: true },
    t: [["iconic:Harsk", 10, 10, "party", { hold: ["arbalest"] }], ["mc:Kobold Warrior", 11, 10, "enemy"]],
    expect: [{ never: /War Axe|Hatchet|Clan Dagger|Unarmed Attack/, label: "no melee" }] },
  { id: "intent-preserve-final", group: "intent", title: "Keep the last action free",
    intent: { preserveFinalAction: true },
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ fn: (result) => Number(result.plans[0]?.totalCost ?? 0) <= 2 || `plans ${result.plans[0]?.totalCost} actions`, label: "2 actions at most" }] },
  { id: "intent-required-action", group: "intent", title: "Required action: Raise a Shield is in the plan",
    intent: { requiredSlug: "raise-a-shield" },
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 7, 10, "enemy"]],
    expect: [{ top: /Raise a Shield/, label: "includes it" }] },

  // Resource horizon
  { id: "horizon-conserve", group: "horizon", title: "Conserve: the wizard saves slots against one goblin",
    horizon: "conserve",
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Goblin Warrior", 10, 10, "enemy"]],
    expect: [{ notTop: LEVELED_EZREN, label: "cantrips first" }] },
  { id: "horizon-burst", group: "horizon", title: "Burst: the wizard spends slots on a big threat",
    horizon: "burst",
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Ogre Warrior", 10, 10, "enemy"], ["mc:Ogre Warrior", 10, 12, "enemy"]],
    expect: [{ top3: LEVELED_EZREN, label: "uses slots" }] },

  // Intel and Recall Knowledge (as a player sees it; GMs see everything)
  { id: "intel-unknown-rk", group: "intel", title: "Player facing an unknown creature considers Recall Knowledge",
    playerView: true,
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Basilisk", 10, 10, "enemy"]],
    expect: [{ fn: (result) => {
      const recall = result.built.candidates.find((candidate) => candidate.slug === "recall-knowledge");
      if (!recall) return "no Recall Knowledge candidate";
      if (!(recall.score >= 80)) return `Recall Knowledge only scores ${recall.score} against an unknown creature`;
      const late = result.plans.find((plan) => {
        const names = plan.steps.map((step) => step.slug);
        const index = names.indexOf("recall-knowledge");
        return index > 0 && plan.steps.slice(0, index).some((step) => step.suggestedTarget?.type === "enemy" || /attack|damage/.test(step.role ?? ""));
      });
      return !late || `recalls after attacking: ${late.steps.map((step) => step.name).join(" | ")}`;
    }, label: "worth learning, and learned first" }] },
  { id: "intel-known-no-rk", group: "intel", title: "Player who already knows everything skips Recall Knowledge",
    playerView: true,
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Basilisk", 10, 10, "enemy", { intel: { identity: true, traits: true, saves: true, perception: true, weaknesses: true, resistances: true, immunities: true } }]],
    expect: [{ notTop: /Recall Knowledge/, label: "nothing left to learn" }] },
  { id: "intel-known-weakness", group: "intel", title: "Known fire weakness: the wizard uses fire",
    playerView: true,
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Mummy Guardian", 10, 10, "enemy", { intel: { identity: true, weaknesses: true } }]],
    expect: [{ top3: /Fireball|Ignition|Produce Flame|Fire/, label: "exploits the weakness" }] },
  { id: "intel-gm-view", group: "intel", title: "GM view never needs Recall Knowledge for NPC planning",
    t: [["mc:Hobgoblin Soldier", 7, 10, "enemy"], ["iconic:Valeros", 8, 10, "party"]],
    expect: [{ never: /Recall Knowledge/, label: "NPCs don't Recall" }] },
);

// ---- Defenses, area safety, reactions, stealth and scale ------------------------------------
// Allies whose token centre sits inside a planned burst (grid 100 px = 5 ft).
const alliesInBurst = (radiusFeet) => (result) => {
  const allies = result.tokens.filter((token) => token.disposition === 1).slice(1);
  for (const plan of result.plans.slice(0, 3)) {
    for (const step of plan.steps) {
      const center = step.activityProfile?.areaPlacementCenter;
      if (!center || step.targetingProfile?.area !== true) continue;
      const caught = allies.filter((token) => {
        const size = (token.width ?? 1) * 100;
        const feet = Math.hypot(token.x + size / 2 - center.x, token.y + size / 2 - center.y) / 100 * 5;
        return feet <= radiusFeet;
      });
      if (caught.length) return `${step.name} catches ${caught.map((token) => token.name).join(", ")}`;
    }
  }
  return true;
};
const firstMoveIsStep = (result) => {
  const move = (result.plans[0]?.steps ?? []).find((step) => /(^|-)(stride|step)$/.test(step.slug ?? "") || /^Stride/.test(step.name));
  return !move || /step/.test(move.slug ?? "") || `moves with ${move.name} next to a Reactive Strike`;
};

LIVE_AUTOFILL_CASES.push(
  { id: "defense-fire-immune", group: "defense", title: "Never fire spells at a fire-immune Living Wildfire",
    t: [["iconic:Ezren", 4, 10, "party"], ["mc:Living Wildfire", 9, 10, "enemy"]],
    expect: [{ never: /Ignition|Fireball|Breathe Fire|Produce Flame/, label: "fire is wasted" }] },
  { id: "defense-ally-in-fireball", group: "defense", title: "Fireball never lands on the fighter in the goblin pack",
    t: [["iconic:Ezren", 2, 10, "party"], ["iconic:Valeros", 10, 10, "party"],
      ["mc:Goblin Warrior", 11, 9, "enemy"], ["mc:Goblin Warrior", 11, 11, "enemy"], ["mc:Goblin Warrior", 12, 10, "enemy"], ["mc:Goblin Warrior", 9, 11, "enemy"]],
    expect: [{ fn: alliesInBurst(20), label: "no friendly fire" }] },
  { id: "reaction-step-away", group: "reaction", title: "Wizard next to a Reactive Strike hobgoblin Steps, never Strides, away",
    t: [["iconic:Ezren", 9, 10, "party"], ["mc:Hobgoblin Soldier", 10, 10, "enemy"]],
    expect: [{ fn: firstMoveIsStep, label: "Step out of reach" }] },
  { id: "stealth-invisible", group: "stealth", title: "Invisible goblin: Seek or hold, don't swing blind first",
    t: [["iconic:Valeros", 6, 10, "party"], ["mc:Goblin Warrior", 8, 10, "enemy", { conds: [["invisible"]] }]],
    expect: [{ fn: (result) => !/^(Longsword|Double Slice|Strike)/.test(result.plans[0]?.steps?.[0]?.name ?? "") || `opens with ${result.plans[0].steps[0].name}`, label: "not a blind swing first" }] },
  { id: "scale-big-fight", group: "scale", title: "Six heroes against eight goblins plans in time",
    maxMs: 1500,
    t: [["iconic:Valeros", 8, 10, "party"], ["iconic:Merisiel", 8, 12, "party"], ["iconic:Ezren", 5, 11, "party"], ["iconic:Kyra", 6, 9, "party"], ["iconic:Harsk", 4, 13, "party"], ["iconic:Seoni", 5, 8, "party"],
      ...[[11, 8], [11, 10], [11, 12], [12, 9], [12, 11], [13, 8], [13, 12], [14, 10]].map(([x, y]) => ["mc:Goblin Warrior", x, y, "enemy"])],
    expect: [{ fn: enemyCount(8), label: "sees all eight" }] },
);

// ---- High-level NPCs and spellcasters against a clustered level-5 party ------------------------
const CLUSTER = [["iconic:Valeros", 9, 9, "party"], ["iconic:Merisiel", 9, 11, "party"], ["iconic:Ezren", 10, 10, "party"], ["iconic:Kyra", 11, 10, "party"]];
const topPlans = (result) => result.plans.slice(0, 3);
const usesArea = (result) => topPlans(result).some((plan) => plan.steps.some((step) => step.targetingProfile?.area === true))
  || `no area attack in the top 3: ${topPlans(result).map((plan) => plan.steps.map((step) => step.name).join(" | ")).join(" || ")}`;
const castsSpell = (result) => topPlans(result).some((plan) => plan.steps.some((step) => String(step.source ?? "").startsWith("spell")))
  || `no spell in the top 3: ${topPlans(result).map((plan) => plan.steps.map((step) => step.name).join(" | ")).join(" || ")}`;

LIVE_AUTOFILL_CASES.push(
  { id: "high-lich", group: "highlevel", title: "Lich (12) casts its spells at the party",
    t: [["mc:Lich", 3, 10, "enemy"], ...CLUSTER], expect: [{ fn: castsSpell, label: "casts" }] },
  { id: "high-ghost-mage", group: "highlevel", title: "Ghost Mage (10) casts at the party",
    t: [["mc:Ghost Mage", 3, 10, "enemy"], ...CLUSTER], expect: [{ fn: castsSpell, label: "casts" }] },
  { id: "high-dragon-caster", group: "highlevel", title: "Conspirator Dragon (adult spellcaster, 12) breathes or casts into the cluster",
    t: [["mc:Conspirator Dragon (Adult, Spellcaster)", 3, 9, "enemy"], ...CLUSTER], expect: [{ fn: usesArea, label: "area" }] },
  { id: "high-mage-knight", group: "highlevel", title: "Mage Knight (10) fights with spells and steel",
    t: [["npc:Mage Knight", 7, 10, "enemy"], ...CLUSTER], expect: [{ top: /./, label: "acts" }] },
  { id: "high-peerless-healer", group: "highlevel", title: "Peerless Healer (15) heals the dying ally",
    t: [["npc:Peerless Healer", 3, 10, "enemy"], ["npc:Mage Knight", 4, 10, "enemy", { hp: 0.15 }], ...CLUSTER],
    expect: [{ top3: /Heal|Healing|Breath of Life|Soothe|Restor/, label: "heals" }] },
  { id: "high-eldritch-emeritus", group: "highlevel", title: "Eldritch Emeritus (17) drops an area spell on the cluster",
    t: [["npc:Eldritch Emeritus", 2, 10, "enemy"], ...CLUSTER], expect: [{ fn: usesArea, label: "area" }] },
  { id: "high-world-ender", group: "highlevel", title: "World Ender (16) uses its big spells",
    t: [["npc:World Ender", 2, 10, "enemy"], ...CLUSTER], expect: [{ fn: castsSpell, label: "casts" }] },
  { id: "high-tempest", group: "highlevel", title: "Tempest Incarnate (19) blasts the cluster",
    t: [["npc:Tempest Incarnate", 2, 10, "enemy"], ...CLUSTER], expect: [{ fn: usesArea, label: "area" }] },
  { id: "high-cloud-giant", group: "highlevel", title: "Cloud Giant (11) smashes with reach",
    t: [["mc:Cloud Giant", 6, 9, "enemy"], ...CLUSTER], expect: [{ never: /Recall Knowledge/, label: "no RK" }] },
  { id: "high-grandmaster", group: "highlevel", title: "Grandmaster (17) martial NPC attacks",
    t: [["npc:Grandmaster", 8, 10, "enemy"], ...CLUSTER], expect: [{ top: /./, label: "acts" }] },
  { id: "high-crag-linnorm", group: "highlevel", title: "Crag Linnorm (14) breathes on the cluster",
    t: [["mc:Crag Linnorm", 3, 9, "enemy"], ...CLUSTER], expect: [{ fn: usesArea, label: "area" }] },
);

// Every level-5 iconic against two goblins, 20 ft apart: no crash, a plan, invariants hold.
const ICONICS = ["Valeros", "Merisiel", "Ezren", "Kyra", "Harsk", "Seoni", "Amiri", "Lini", "Seelah", "Feiya", "Lem", "Jirelle",
  "Sajan", "Fumbus", "Quinn", "Yoon", "Korakai", "Thaleon", "Samo", "Daji", "Ulka", "Mios", "Droven", "Grimmyr", "Whirp",
  "Nahoa", "Nhalmika", "Droogami"];

// Classes with no level-5 iconic or pregen, assembled by the suite (class + signature actions + weapon).
const BUILT_CLASSES = ["magus", "summoner", "runesmith"];

export function iconicSmokeCases() {
  const goblins = [["mc:Goblin Warrior", 9, 9, "enemy", { name: "Goblin A" }], ["mc:Goblin Warrior", 9, 12, "enemy", { name: "Goblin B" }]];
  return [
    ...ICONICS.map((name) => ({ id: `iconic-${name.toLowerCase()}`, group: "iconic", title: `${name} vs two goblins`, t: [[`iconic:${name}`, 5, 10, "party"], ...goblins], expect: [] })),
    ...BUILT_CLASSES.map((name) => ({ id: `class-${name}`, group: "iconic", title: `${name} (built) vs two goblins`, t: [[`built:${name}`, 5, 10, "party"], ...goblins], expect: [] })),
  ];
}
