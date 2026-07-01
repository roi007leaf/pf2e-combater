[![Latest Version](https://img.shields.io/github/v/release/roi007leaf/pf2e-combater?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roi007leaf/pf2e-combater/releases/latest)

[![GitHub all releases](https://img.shields.io/github/downloads/roi007leaf/pf2e-combater/total)](https://github.com/roi007leaf/pf2e-combater/releases)

# PF2e Combater – Tactical Turn Planner

PF2e Combater is a floating combat advisor for Foundry VTT's Pathfinder 2e system. It reads the
acting creature's real options — strikes, spells, feats, generic actions — together with the
battlefield around it, and helps you **plan a whole turn, see it on the canvas, and execute it step
by step** (with one-click undo). GMs get tactical recommendations for the creatures they run;
players plan their own turns.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)

---

## ✨ What it does

- **Turn planner panel.** A floating window for the active combatant showing a draft plan, the
  remaining action budget (slowed / stunned / quickened aware), and a browsable list of everything
  the creature can actually do this turn.
- **Auto-fill.** One click builds a sensible turn from the highest-value actions and fits it to the
  action economy — moving into reach, attacking, casting, or repositioning as the situation calls
  for.
- **Real action sources.** Options are read from the actor itself, not a fixed list:
  - **Strikes** (melee and ranged), with the multiple attack penalty accounted for — and a
    per-strike MAP button to pin a level when an ability keeps MAP flat across attacks.
  - **Spells** — curated catalog plus inferred classification (damage, save, area, control,
    healing, buff…), respecting slots, focus points, and prepared/spontaneous/innate entries.
  - **Generic & skill actions** (Stride, Step, Demoralize, Trip, Grapple, Recall Knowledge, …),
    gated by whether they're usable right now.
  - **Class & system feats/actions** detected from the actor's items.
- **Move-and-strike composites.** When a target is a stride or two away, the planner offers
  combined "Stride → Strike" (and "Stride → Stride → Strike") plays, with the destination computed
  to land in reach.
- **Positional tactics (GM NPCs).** Recommends **Skirmish/Kite** (optional melee → stride out of
  threat → ranged Strike or offensive spell) and **Flank-and-Strike** (stride to a flanking square
  for an off-guard hit) when the situation favors them.
- **Situational remedies.** A dedicated section surfaces condition responses only when they apply —
  Stand / Crawl while prone, Retch while sickened, Escape while grabbed/restrained.
- **Weapon & position handling.** Draw, **Sheathe**, Release (drop), and Reload for the right
  weapons; a 1-action Drop Prone when it helps.
- **GM aggro targeting.** For GM-run NPCs, the planner weighs which player character is the best
  target (healer, caster, controller, defender, low HP) and pre-picks it.

## 🎯 On the canvas

- **Movement preview** for strides: the path, reachable squares, the starting square, and the
  landing square — all clamped to the creature's actual Speed and the scene's diagonal rule.
- **Choose the movement type.** When a creature has more than one Speed, a Stride can travel on
  **fly, burrow, swim, or climb** — the chosen speed sizes the reachable range and is the movement
  the token uses on execute (land-only creatures see no extra control).
- **Vertical movement** for fly and burrow: hold **Shift** and scroll while placing a waypoint to
  raise or lower its elevation. Each waypoint keeps its own height (so a path can climb, level off,
  then dive), the elevation is shown on the waypoint, and every leg's vertical distance counts
  against Speed.
- **Teleport destinations.** Translocate and other teleports show a **range ring** and let you click
  the target space; executing casts the spell and repositions the token instantly, and reverting
  returns it to where it started.
- **Range and area overlays** when hovering ranged or template spells, so you can see where a spell
  reaches before committing.
- **Area templates with auto-expiry.** Placing a lingering area (cloud, wall, darkness) creates a
  linked PF2e countdown effect on the caster and removes the template automatically when the
  duration ends — in encounter or exploration.

## ▶️ Execute & undo

- Run the plan **step by step**, or each step on its own. Strikes read your current target; moves
  go to the planned destination; spells cast through the system.
- **Revert** a completed step's real effect — movement returns the token, Stand re-applies prone,
  area actions delete their template — and **Reset** undoes the whole turn in reverse. Effects that
  can't be safely auto-undone (e.g. a condition applied to another token) are flagged for manual
  cleanup.

## 👥 Players & GM

- Players plan and execute their own combatant; the GM window follows the **selected token**.
- Players can **share** their draft with the GM, who can execute it on their behalf if they go AFK.

---

## 🧠 How Auto-fill decides

> **No AI, no LLM, no cloud.** Auto-fill is 100% deterministic, rules-based math that runs entirely
> in your browser. Nothing is sent anywhere, it works offline, and the same board always produces the
> same plan. It reads the PF2e rules and the battlefield — it doesn't "ask a model."

Auto-fill isn't a fixed script — it **scores every action the creature can take, then searches for the
best combination that fits the turn.** Two stages:

### 1. Score each action

Every option starts from a base value by how confidently it's understood (curated spell > strike >
generic action), then gets adjusted for the actual situation:

- **Disqualified outright** (never suggested) when there's no valid target, the target is out of
  range, the target is *immune* to the effect, or the action would be redundant (a buff the target
  already has, an aura that's already up, an untrained skill).
- **Rewarded** for expected impact: a Strike that's in range and hits hard, damage that lands on a
  **weakness**, a save spell weighed by the target's *actual* save odds against your DC (crit-fail
  through success are each probability-weighted), and hitting the **most valuable enemy** (low HP,
  healer, caster, whoever's threatening you in melee).
- **Penalized** for waste: repositioning to a target already in reach, firing a volley weapon
  point-blank, or re-applying a buff someone already has.

### 2. Build the turn

- Works out your real **action budget** — 3 actions, minus Slowed / Stunned / already-spent, plus one
  if you're Quickened.
- Explores legal combinations of the highest-scoring actions and throws out the nonsensical ones:
  two moves in a row, Drop Prone → Stride, a Step you don't need because the attack already reaches,
  more than two Strikes, or using a Quickened action on something other than Strike/Stride.
- Accounts for the **multiple attack penalty** as attacks stack up, and prefers plans that **use your
  whole turn** rather than leaving actions on the table.
- Orders the result sensibly — setup before payoff (Demoralize/Feint first, Stand before you move).

The highest-scoring plan is what lands in the panel. It's always a **suggestion** — every step is
editable, and **Browse** lets you build the turn by hand instead.

---

## ✅ Requirements

- Foundry VTT **v14**
- Pathfinder 2e system

## 🔌 Installation

1. In Foundry, open **Add-on Modules → Install Module**.
2. Paste the manifest URL:
   `https://github.com/roi007leaf/pf2e-combater/releases/latest/download/module.json`
3. Enable **PF2e Combater** in your world.

## 🕹️ Getting started

- Open the panel from the **Token Controls** toolbar (the Combater tool), or it opens automatically
  on a combatant's turn (configurable in module settings).
- Hit **Auto-fill** for a suggested turn, or **Browse** to pick actions yourself, then execute.

---

## 📜 License & Credits

- GPL-3.0 license. See `LICENSE`.
- Built for the community-maintained PF2e system for Foundry VTT.
- Thanks to everyone who tested and gave feedback.
