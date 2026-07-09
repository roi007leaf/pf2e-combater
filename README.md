[![Latest Version](https://img.shields.io/github/v/release/roi007leaf/pf2e-combater?display_name=tag&sort=semver&label=Latest%20Version)](https://github.com/roi007leaf/pf2e-combater/releases/latest)

[![GitHub all releases](https://img.shields.io/github/downloads/roi007leaf/pf2e-combater/total)](https://github.com/roi007leaf/pf2e-combater/releases)

# PF2e Combater – Tactical Turn Planner And Executioner

PF2e Combater is a floating combat advisor for Foundry VTT's Pathfinder 2e system. It reads the
acting creature's real options — strikes, spells, feats, generic actions — together with the
battlefield around it, and helps you **plan a whole turn, see it on the canvas, and execute it step
by step** (with one-click undo). GMs get tactical recommendations for the creatures they run;
players plan their own turns.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/roileaf)

---
<img width="1712" height="1115" alt="image" src="https://github.com/user-attachments/assets/24d3aecb-0fe5-4b94-bd71-024ba41555f6" />
<img width="1907" height="1022" alt="image" src="https://github.com/user-attachments/assets/2a7b22aa-0ec2-472b-9865-8d74b55802ed" />
<img width="1886" height="1108" alt="image" src="https://github.com/user-attachments/assets/d310dd82-6024-4693-b6f9-3e62a27f2a9f" />
<img width="747" height="381" alt="image" src="https://github.com/user-attachments/assets/15ec9258-a9f0-4884-aed2-fcf4e05088d6" />
<img width="852" height="926" alt="image" src="https://github.com/user-attachments/assets/a226ba6d-b0d7-449e-88bf-36047c8b7ab7" />
<img width="1533" height="773" alt="image" src="https://github.com/user-attachments/assets/52a8f8d5-f4ba-44dd-b82e-15b656a99270" />


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
- **GM tactic personalities.** NPC turns get a tactic chip where the GM can set a role preset
  (Boss, Lieutenant, Minion, Brute, Skirmisher, Artillery, Controller, Defender, Support), a
  temperament (Aggressive, Cautious, Opportunist, Berserker, Coward), and optional custom priorities.
  Auto-fill and Shuffle use that profile when ranking actions and choosing targets.
- **Recall Knowledge Intel.** GMs can reveal individual NPC facts — traits, save DCs, weaknesses,
  resistances, and immunities — and players can inspect only those revealed facts. Player Auto-fill
  and Shuffle use revealed Intel, but never unrevealed defenses.
- **Companion/minion support.** Command an Animal appears when a commandable companion, familiar, or
  minion is detected, and its recommendation can show the two-action minion subturn it is trying to
  set up.

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
- If a player is **not currently connected** (e.g. their PC is being run by the GM for the session),
  the GM gets full Auto-fill/edit/execute rights on that character — same as any NPC. The read-only
  "mirror the player's live plan" mode only applies while the owning player is actually online.
- GMs can save an NPC tactic profile as an **actor default** for every copy of that creature, or as a
  **token override** when one battlefield copy should behave differently.
- GMs reveal Recall Knowledge Intel from the NPC's Combater panel. The Intel ledger is saved on the
  NPC actor, so the same creature keeps those revealed facts in later combats.
- Players see revealed NPC Intel from their own Combater panel's **Intel** button, the brain button
  on visible NPC combat tracker rows, or by clicking an NPC target label inside a suggested/drafted
  step. Players never get the GM editor and never see unrevealed NPC facts.

---

## 🧠 How Auto-fill decides

> **🚧 Work in progress.** The **Auto-fill planner**, **NPC tactic personality**, and **GM
> aggro/target-picking engine** are actively evolving. The exact scores, weights, and heuristics
> below are current-but-not-final and *will* change as they're tuned — treat the numbers as
> illustrative, not a contract. Feedback, disagreements, and "it picked a weird turn here" reports
> are genuinely wanted: please
> [open an issue](https://github.com/roi007leaf/pf2e-combater/issues) with the situation.

<!-- -->

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
- **Rewarded** for expected impact: a Strike that's in range and hits hard, useful movement, setup
  that enables a payoff, and good action economy. GM-run NPCs can also use full hidden defenses and
  aggro target priorities. Players only get defense-aware bonuses or penalties when the GM has
  revealed the exact matching Recall Knowledge Intel — see
  [No metagaming](#no-metagaming-players-only-use-revealed-enemy-intel) below.
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

### No metagaming: players only use revealed enemy intel

> Hidden target data stays hidden. Player Auto-fill never reads unrevealed NPC weaknesses,
> resistances, immunities, save DCs, hidden traits, AC, or skill DCs. The only exception is
> **Recall Knowledge Intel** the GM explicitly revealed, and even then only the exact revealed fact is
> usable.

That splits the scoring into two honest modes:

- **Player auto-fill** ranks actions on what the player legitimately knows: the action's base value,
  whether the target is in range, the player's **own** average damage, the multiple attack penalty,
  movement, action economy, the player's own conditions, and any exact Recall Knowledge facts the GM
  revealed for that NPC.
- **GM auto-fill** (for the NPCs the GM runs) adds the full defense-aware math below — the GM already
  knows their monsters' stats, so there's no metagaming.

### The numbers, roughly

**Every** action the creature has lands in exactly one "source" bucket, and the bucket sets the
starting score. The bucket reflects *how confidently Combater understands the action*, not how good it
is — it's just a small tie-breaking prior. The situational math below (a Strike in range is already
`+24`, damage adds up to `+40`, etc.) easily overturns it, and a great-fit action from a low bucket
beats a poor-fit one from a high bucket every time.

| Source bucket | Base | What falls here |
| --- | --- | --- |
| `spell-curated` | **50** | A spell in the hand-tuned catalog (known role, targeting, save profile). |
| `custom-curated` | **48** | An actor-specific action Combater recognizes (a class feature/impulse). |
| `strike` | **46** | Any weapon or unarmed Strike read off the actor. |
| `system-inferred` | **44** | A non-spell action recognized by pattern (feats, system actions). |
| `spell-inferred` | **44** | A spell auto-classified by pattern (damage / save / area / buff / heal…). |
| `generic` | **42** | The basic actions — Stride, Step, Demoralize, Trip, Grapple, Seek… |
| *(anything else)* | **20** | The fallback: a spell that couldn't be classified at all (`spell-unknown`) or any action with an unrecognized source. Still offered, just ranked cautiously. |

So there's no spell or action that gets *ignored* — unrecognized ones simply start at **20** and rise
or fall on their situational fit like everything else.

Beyond the base, a few of the actual values the engine uses (🔒 = hidden-knowledge factor: GM-only
by default; player auto-fill uses it only when the exact matching Recall Knowledge Intel is revealed):

| Factor | Effect on score |
| --- | --- |
| Base value (by source) | see the source table above |
| Strike is in range/reach | **+24** |
| Strike damage (your own weapon) | `min(avg damage × 2, 40)` |
| 🔒 Target **weakness** to the damage type | `+min(weakness × 4, 45)` |
| 🔒 Target **resistance** | `−min(resistance × 3, 35)` |
| 🔒 Target **immunity** | **−70** (effectively removes it) |
| 🔒 Save spell vs target's save DC | expected-damage multiplier (see below) |
| 🔒 Skill action vs target's defense DC | **degree-of-success** delta from your skill **modifier** vs the target's Will/Reflex/Fort/Perception DC (Demoralize→Will, Trip/Disarm/Tumble Through→Reflex, Grapple/Shove/Reposition→Fort, Feint/Create a Diversion→Perception). A likely **critical** success is worth extra (crit Demoralize = frightened 2, etc.); a likely crit failure costs. |
| 🔒 Incapacitation spell vs a much higher-level target | resistance modeled — a target of more than **twice the spell's rank** saves one degree better, so hard control (Slow, Paralyze…) is scored down against over-leveled foes |
| 🔒 Poor skill odds (< 35% success) | `−4` |
| Untrained (proficiency rank 0) in the skill | `−6`, and the action is hidden entirely if *Hide untrained skill actions* is on |
| Untrained Athletics for a melee maneuver (own skill) | `−80` (PC) / `−42` (NPC), `−110` for a primary spellcaster; low Athletics (mod < 5) `−12` |
| Multiple attack penalty (2nd / 3rd attack) | `−15 / −30` (agile: `−12 / −24`) |
| Target is **hidden** (detected only by an imprecise sense) | attack-like actions have their target-dependent gain discounted **50%**, since a DC 11 flat check can fail before the attack roll or save even matters. Not GM-only — your own creature's detection of the target isn't a hidden enemy stat. |
| Heal when you or an ally is **injured** (< 50% HP) | `+34`; if nobody is hurt, `−10` (don't waste the spell) |
| Area spell hits **multiple** enemies | `+34 + 18 per enemy`; a single enemy in the blast `+14`; **no** enemy in it `−28` |
| An **ally** caught in your area | `−18 each`; a clean placement that hits 2+ enemies and no allies `+8` |
| 🔒 Debuff spell on an enemy | `+20` |
| Setup that enables a follow-up (Feint, Recall, etc.) | `+20`, or `+28` if it specifically sets up **precision damage** (sneak attack) |
| Draw a weapon then Strike | `+82` if nothing else is in reach, `+18` if an in-hand Strike is already available, `−40` if still out of range after drawing |
| Stand up while prone | **+18**, `+22` if an enemy is in melee |
| Stride/Step that actually closes distance | Stride `+8`, Step `+4` |
| Move toward a target already in reach | forced to **−10** (won't pad the turn) |
| Volley weapon fired inside its volley range | **−10** |
| Leftover unused action | `−1` each (nudges toward a full turn) |

Hard limits: max **2** Strike steps per plan, an action budget of **3** (± Slowed / Stunned /
Quickened), and a Quickened action may only be a Strike or Stride.

**When the actor is hurt** (own HP < 50%), self-preservation factors climb — healing, defensive, and
retreat options gain extra weight — so a badly wounded creature is nudged toward staying alive rather
than trading blows.

### 🎯 The aggro engine: which target is worth hitting 🔒

Everything above scores *actions*. The **aggro engine** answers the other half — *who* to point them
at — and it's **GM-only, for the NPCs a GM runs**. When a player auto-fills, aggro contributes
**nothing** (it would require reading party members' kits), so this whole layer is skipped.

For each possible target, the engine builds an **aggro profile** by reading that creature's kit — the
slugs, names, and traits of its spells, feats, and actions (identity fields only, not the rules prose,
so a description that merely *mentions* a condition doesn't trip a false match) — and matching them
against role cue-words. Each role a target fills adds to its priority:

| Target role | Priority | How it's detected |
| --- | --- | --- |
| **Finisher target** — nearly down | `+24` (`+34` at ≤ 20% HP) | HP ≤ 35%, or **dying** (not the *wounded* counter, which can sit on a full-HP creature) |
| **Immediate threat** — in your face | `+10` (`+18` at ≤ 5 ft) | within 10 ft |
| **Healer** | `+42` | kit has heal / lay on hands / battle medicine / restore… |
| **Controller** | `+26` | kit has slow / fear / grapple / wall / command… |
| **Caster** | `+18` + `2 per spell` (max `+12`) | has spells or a spellcasting entry |
| **Main attacker** | `+8`, scaled by stacked offense (`+3` per weapon, `+4` per damage feat/impulse/spell, capped) | so a glass-cannon striker outranks a one-weapon mook, instead of everyone with a weapon reading the same |
| **Main defender** | `+18` | AC a clear margin **above the average of the other targets** in the fight (whoever's hardest to hit *here*), or shield/guardian/intercept cues |

Then the target's priority is **weighted by the action you'd use on it**, so the engine spends the
*right tool* on the *right enemy*:

- **Caster / controller** → control, debuff, and grab actions are worth **~1.7–1.8×**, plain damage
  only **~0.8×** — shut the dangerous ones down rather than chip their HP.
- **Finisher target** → control/debuff **×4**, everything else **×1.15** — lock in the kill.
- **Main defender (the tank)** → almost everything is **discouraged** (`×−0.45`), only control
  `×0.35` — don't waste swings on the wall built to eat them.
- **Immediate threat** → a mild damper (`×0.65`) so the NPC isn't tunnel-visioned on whoever's
  adjacent.

The finisher and immediate-threat cues need no hidden data, but because the whole layer only runs for
**GM-controlled NPCs**, players never see or benefit from any of it.

### NPC tactic personality: how the GM steers monster behavior

For NPC turns, the tactic chip can stay on **Auto** or be set manually. Auto infers a role and
temperament from the NPC's sheet and the current fight: ranged strikes and combat spells lean
Artillery, healing and ally buffs lean Support, heavy melee and grab tools lean Brute, shield/guard
tools lean Defender, level gaps can imply Boss or Minion, and low HP or melee pressure can shift the
temperament.

Manual presets override that inference. The role and temperament then add action and target weights:
Bosses favor high-impact turns, Artillery favors ranged/spell pressure, Defenders value protection and
control, Support values allies, Aggressive creatures push damage, Cautious creatures value survival,
and Opportunists chase openings. The optional **Customize preset** layer exposes sliders for action
style and target style, such as finishing wounded enemies, pressuring casters/healers/controllers,
avoiding hard defenders, or preferring the nearest reachable enemy.

These profiles never change PF2e legality or creature stats. They only bias which legal plan Auto-fill
and Shuffle prefer.

### Worked examples

**"Swing twice, or hit and run?"** — Fighter with a non-agile weapon (avg 11 damage), one goblin in
reach, three actions.

- Strike #1 ≈ `46 + 24 + 22` = **92**
- Strike #2 = `92 − 15` (MAP) = **77**
- A third Strike is blocked (2-Strike cap), so the last action goes to the next-best legal option —
  Raise a Shield, Demoralize the goblin, or Stride to a second enemy.
- Result: **Strike → Strike → Demoralize**, not three flailing swings.

**"Which damage type?"** 🔒 *(GM-run NPC)* — an enemy caster with both a fire and a cold spell,
targeting a PC with **fire weakness 5**.

- Fire spell: `+min(5 × 4, 45)` = **+20**
- Cold spell (no weakness): **+0** → the fire spell is picked. If the PC were fire-*immune*, the fire
  spell takes **−70** and drops out of consideration entirely.
- When that **PC** plans their own turn, they get no such adjustment against enemies unless the GM has
  revealed the matching weakness, resistance, or immunity as Recall Knowledge Intel.

**"Is the save spell worth it?"** 🔒 *(GM-run NPC)* — an enemy caster's Fireball (basic Reflex) at a
PC. The engine rolls the PC's save against the spell DC across all 20 die faces and weights the
outcomes:
`multiplier = P(crit fail) × 2 + P(fail) × 1 + P(success) × 0.5`. A weak-save target pushes the
multiplier up (bigger odds bonus *and* bigger expected-damage bonus); a strong-save target drags it
below a plain Strike. For a **player**, this comparison only happens if the GM revealed that exact
save DC as Recall Knowledge Intel; otherwise the save spell is scored on its base value alone.

**"Is Demoralize worth an action?"** 🔒 *(GM-run NPC)* — an NPC deciding between Demoralize
(Intimidation) on two PCs. The engine rolls the Intimidation modifier against each PC's **Will DC**
across all 20 die faces and weights the **degrees of success** — a critical success (frightened 2)
counts extra, a critical failure counts against it. Against a low-Will PC that means frequent
successes and the occasional crit, so Demoralize scores well; against a high-Will PC it slides toward
failure and the NPC leans on the softer target. An **untrained** NPC also eats `−6` (or the action is
hidden outright). Proficiency **rank** and skill **modifier** both feed this — rank gates/penalizes,
the modifier drives the odds. For a **player**, target DC math only turns on for exact revealed Intel,
so unrevealed DCs stay out of scoring.

**"Buffs, but only useful ones."** — Heroism on a martial ally: `12 (ally) + 24 (attack buff on a
martial)` = **+36**. The *same* ally who already has Heroism: **−60** → never suggested. A wounded
ally under fire nudges it up a further `+14`. (This one works for players too — it reads *ally* class
and buff state, not hidden enemy stats.)

**"Heal now, or keep swinging?"** — a cleric with a Heal spell. If nobody is below half HP, the Heal
takes `−10` and a Strike wins. The moment the cleric *or* an ally drops under 50%, Heal gains `+34` and
jumps ahead — and if a party member is **dying**, the healing role is prioritized outright. (Reads
*ally* HP, not hidden enemy stats, so it works for players too.)

**"Fireball placement."** 🔒 *(GM-run NPC)* — a caster's Fireball. Two PCs clustered with no allies
nearby: `34 + 18 × 2` = **+70**, plus the Reflex-save math. Drag the same blast so it also clips an
NPC ally: each ally in the radius is `−18`, quickly dropping it below a single-target spell — so the
engine prefers the clean placement.

**"Who do I hit?"** 🔒 *(GM-run NPC)* — a monster faces a fighter (AC 26, sword) and an enemy cleric
(spells, a Heal). The cleric profiles as **healer + caster** (`42 + ~20`), the fighter as
**main-defender + main-attacker**. A damaging Strike aimed at the cleric keeps most of that priority,
but aimed at the tank it's *multiplied by −0.45* — so the engine steers the attack at the healer. Had
the monster a **Slow** spell, it'd weight even harder toward the caster (control ×1.8). Whenever a PC
drops to dying, that PC lights up as a **finisher target** and jumps the queue.

**"Don't waste the spare action."** — Enemy already in reach with one action to spare: a generic
Stride toward it is forced to **−10**, which is worse than the `−1` for simply leaving the action
unused — so the planner leaves it empty rather than tack on a pointless move. (Still addable by hand
in **Browse**.)

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
- On an NPC turn, use the **Tactic** chip to set monster behavior and the **Intel** chip to reveal
  Recall Knowledge facts players are allowed to use.

---

## 📜 License & Credits

- GPL-3.0 license. See `LICENSE`.
- Built for the community-maintained PF2e system for Foundry VTT.
- Thanks to everyone who tested and gave feedback.
