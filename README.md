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
  - **Strikes** (melee and ranged), with multiple attack penalty accounted for.
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
