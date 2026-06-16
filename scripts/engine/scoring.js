function firstTarget(context) {
  return context?.targets?.[0] ?? context?.battlefield?.targets?.[0] ?? null;
}

function allies(context) {
  return context?.allies ?? context?.battlefield?.allies ?? [];
}

function enemies(context) {
  return context?.enemies ?? context?.battlefield?.enemies ?? context?.targets ?? context?.battlefield?.targets ?? [];
}

function actorTarget(context) {
  const actor = context?.actor ?? context?.combatant?.actor ?? null;
  if (!actor) return { type: "self", name: "Self" };
  return {
    type: "self",
    id: actor.id ?? actor.document?.id ?? null,
    uuid: actor.uuid ?? actor.document?.uuid ?? null,
    name: actor.name ?? actor.document?.name ?? "Self",
  };
}

function targetRef(entity, fallbackType = "target") {
  if (!entity) return null;
  return {
    type: fallbackType,
    id: entity.id ?? entity.actor?.id ?? null,
    uuid: entity.uuid ?? entity.actor?.uuid ?? null,
    name: entity.name ?? entity.actor?.name ?? "Unknown target",
  };
}

function maxRange(action) {
  const max = Number(action?.range?.max);
  if (Number.isFinite(max) && max > 0) return max;

  const profileMax = Number(action?.targetingProfile?.maxRange ?? action?.targetingProfile?.range);
  if (Number.isFinite(profileMax) && profileMax > 0) return profileMax;

  const increment = Number(action?.range?.increment);
  if (Number.isFinite(increment) && increment > 0) return increment;

  if (action.source === "strike") return 5;
  return Infinity;
}

function inRange(action, target) {
  if (!target) return false;
  return (target.distance ?? Infinity) <= maxRange(action);
}

function bestTargetForAction(context, action, role) {
  if (action?.preferredTarget) return action.preferredTarget;

  const target = firstTarget(context);
  const enemyValues = enemies(context);

  if (action.source === "strike") {
    if (target && inRange(action, target)) return target;
    return enemyValues.find((enemy) => inRange(action, enemy)) ?? target;
  }

  if (role === "damage" || role === "grab" || role === "control" || role === "save-damage") {
    return target ?? enemyValues[0] ?? null;
  }

  return target;
}

function hpPercent(entity) {
  const nested = Number(entity?.hp?.percent);
  if (Number.isFinite(nested)) return nested;

  const flat = Number(entity?.hpPercent);
  if (Number.isFinite(flat)) return flat;

  return 1;
}

function hasCondition(entity, slug) {
  const conditions = entity?.conditions;
  if (!conditions) return false;

  if (Array.isArray(conditions)) {
    return conditions.some((condition) => condition === slug || condition?.slug === slug);
  }

  if (Array.isArray(conditions.slugs) && conditions.slugs.includes(slug)) return true;

  const value = Number(conditions.values?.[slug]);
  if (Number.isFinite(value)) return value > 0;

  return false;
}

function hasAnyCondition(entity, slugs) {
  return slugs.some((slug) => hasCondition(entity, slug));
}

function dyingAlly(context) {
  return allies(context).find((ally) => hasCondition(ally, "dying"));
}

function bleedingAlly(context) {
  return allies(context).find((ally) => hasCondition(ally, "persistent-bleed"));
}

function enemyInMelee(context) {
  const target = firstTarget(context);
  return Boolean(target && (target.distance ?? Infinity) <= 5);
}

function profileSpeed(profile) {
  const speed = Number(profile?.speed ?? profile?.landSpeed);
  return Number.isFinite(speed) && speed > 0 ? speed : 25;
}

function profileReach(profile) {
  const reach = Number(profile?.reach ?? profile?.meleeReach);
  return Number.isFinite(reach) && reach > 0 ? reach : 5;
}

function inProfileReach(profile, target) {
  return Boolean(target && (target.distance ?? Infinity) <= profileReach(profile));
}

function inActionReach(profile, action, target) {
  if (action?.targetingProfile?.maxRange) return inRange(action, target);
  return inProfileReach(profile, target);
}

function profileMoveReach(profile, strideCount = 1) {
  return profileSpeed(profile) * Math.max(1, Number(strideCount) || 1) + profileReach(profile);
}

function areaDistance(action) {
  const distance = Number(action?.targetingProfile?.distance ?? action?.targetingProfile?.radius);
  return Number.isFinite(distance) && distance > 0 ? distance : 30;
}

function entitiesInArea(action, values) {
  const distance = areaDistance(action);
  return values.filter((entity) => (entity?.distance ?? Infinity) <= distance);
}

function nearbyCorpse(context, profile) {
  const reach = profileReach(profile);
  return [...enemies(context), ...allies(context)].find((entity) =>
    (entity?.distance ?? Infinity) <= reach
      && (hpPercent(entity) <= 0 || hasCondition(entity, "dead") || hasCondition(entity, "destroyed")),
  );
}

function plural(count, singular, pluralValue) {
  return count === 1 ? singular : pluralValue;
}

function baseScore(action) {
  if (action.source === "spell-curated") return 50;
  if (action.source === "custom-curated") return 48;
  if (action.source === "strike") return 46;
  if (action.source === "system-inferred") return 44;
  if (action.source === "spell-inferred") return 44;
  if (action.source === "generic") return 42;
  return 20;
}

function defaultReason(action) {
  if (action.source === "custom-curated") return "Actor-specific action is recognized.";
  if (action.source === "system-inferred") return "System action pattern is recognized.";
  if (action.source === "spell-curated") return "Curated spell is available.";
  if (action.source === "spell-inferred") return "Spell pattern is recognized.";
  return "Action is available.";
}

function isCurated(action) {
  return action.source === "spell-curated"
    || action.source === "custom-curated"
    || action.source === "system-inferred"
    || action.source === "spell-inferred";
}

function canUseTargetDefenses(context) {
  if (typeof context?.isGM === "boolean") return context.isGM;
  return globalThis.game?.user?.isGM === true;
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signed(number) {
  return number >= 0 ? `+${number}` : String(number);
}

function skillEntry(profile, slug) {
  const skill = profile?.skills?.[slug];
  if (skill === undefined || skill === null) return null;
  if (Number.isFinite(Number(skill))) {
    return { mod: Number(skill), rank: null };
  }

  const mod = Number(skill.mod ?? skill.totalModifier ?? skill.value);
  if (!Number.isFinite(mod)) return null;

  const rank = Number(skill.rank ?? skill.proficiency?.rank);
  return {
    mod,
    rank: Number.isFinite(rank) ? rank : null,
  };
}

function actionSkillDcSlug(action) {
  if (action.targetDefense) return action.targetDefense;
  if (action.targetSave) return action.targetSave;

  switch (action.slug) {
    case "demoralize":
      return "will";
    case "trip":
    case "disarm":
    case "tumble-through":
      return "reflex";
    case "grapple":
    case "reposition":
    case "shove":
      return "fortitude";
    case "feint":
    case "create-a-diversion":
      return "perception";
    default:
      return null;
  }
}

function numericDc(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function targetDc(target, dcSlug) {
  if (!target || !dcSlug) return null;
  if (dcSlug === "perception") {
    return numericDc(
      target.perception?.dc,
      target.perceptionDC,
      target.defenses?.perception,
      target.perception,
    );
  }

  return numericDc(
    target.saves?.[dcSlug]?.dc,
    target.saves?.[dcSlug],
    target.defenses?.[dcSlug],
    target[`${dcSlug}DC`],
  );
}

function successChance(mod, dc) {
  const needed = dc - mod;
  if (needed <= 1) return 0.95;
  if (needed > 20) return 0.05;
  return Math.max(0.05, Math.min(0.95, (21 - needed) / 20));
}

function skillCheckScore(profile, target, action) {
  if (!action.skill) return null;

  const skill = skillEntry(profile, action.skill);
  const dcSlug = actionSkillDcSlug(action);
  const dc = targetDc(target, dcSlug);
  if (!skill || !Number.isFinite(dc)) return null;

  const chance = successChance(skill.mod, dc);
  let scoreDelta = Math.round((chance - 0.5) * 40);
  const reasons = [`${titleCase(action.skill)} ${signed(skill.mod)} vs ${titleCase(dcSlug)} DC ${dc}.`];

  if (skill.rank === 0) {
    scoreDelta -= 6;
    reasons.push(`Untrained in ${titleCase(action.skill)}; reliability reduced.`);
  }

  if (chance < 0.35) {
    scoreDelta -= 4;
    reasons.push(`${titleCase(action.skill)} success odds are poor.`);
  }

  return {
    skill: action.skill,
    skillLabel: titleCase(action.skill),
    mod: skill.mod,
    rank: skill.rank,
    dcSlug,
    dcLabel: titleCase(dcSlug),
    dc,
    chance,
    scoreDelta,
    label: `${titleCase(action.skill)} ${signed(skill.mod)} vs ${titleCase(dcSlug)} DC ${dc}`,
    reasons,
  };
}

function suggestedTargetFor(context, action, role, preferredTarget = firstTarget(context)) {
  const target = preferredTarget;

  if (action.source === "strike") {
    return target ? targetRef(target, "enemy") : actorTarget(context);
  }

  if (
    role === "defense"
    || ["raise-a-shield", "take-cover", "hide", "sneak", "step", "stride"].includes(action.slug)
  ) {
    return actorTarget(context);
  }

  if (role === "healing") {
    const dying = dyingAlly(context);
    if (dying) return targetRef(dying, "ally");
    const bleeding = bleedingAlly(context);
    if (bleeding) return targetRef(bleeding, "ally");
    const injuredAlly = allies(context).find((ally) => hpPercent(ally) < 0.5);
    if (injuredAlly) return targetRef(injuredAlly, "ally");
    return actorTarget(context);
  }

  if (["buff", "setup", "summon", "utility", "transformation", "mobility"].includes(role)) {
    const targeting = action.targetingProfile ?? {};
    // Enemy-targeted setups (Taunt, Feint, Hunt Prey, off-guard setups) point at
    // the enemy; ally/self effects point at an ally or the actor.
    if (targeting.enemy) {
      if (target) return targetRef(target, "enemy");
      const enemy = enemies(context)[0];
      if (enemy) return targetRef(enemy, "enemy");
    }
    if (targeting.ally && !targeting.self) {
      const ally = allies(context)[0];
      if (ally) return targetRef(ally, "ally");
    }
    return actorTarget(context);
  }

  if (target && inRange(action, target)) return targetRef(target, "enemy");
  return actorTarget(context);
}

export function scoreCandidate(context, action) {
  const profile = context?.profile ?? context?.actor?.profile ?? {};
  const role = action.curated?.role ?? action.role;
  const target = bestTargetForAction(context, action, role);
  const suggestedTarget = suggestedTargetFor(context, action, role, target);
  const reasons = [...(action.reasons ?? [])];
  const skillCheck = canUseTargetDefenses(context) ? skillCheckScore(profile, target, action) : null;
  let score = baseScore(action);

  if (action.source === "strike" && target && !inRange(action, target)) {
    return {
      ...action,
      score: -999,
      suggestedTarget: null,
      reason: "Target is out of range.",
      reasons: ["Target is out of range."],
    };
  }

  if (action.source === "strike" && inRange(action, target)) {
    score += 24;
    reasons.push(maxRange(action) > 10 ? "Target is in range." : "Melee target is in reach.");

    // Break ties between strikes by expected damage so a harder-hitting weapon
    // (e.g. Jaws 2d10) outranks a smaller one (Claw 2d8) for the opening attack.
    // Agile weapons still win follow-ups via their lower multiple-attack penalty.
    const average = Number(action.averageDamage);
    if (Number.isFinite(average) && average > 0) {
      score += Math.min(average * 0.5, 20);
      reasons.push(`Average damage about ${Math.round(average)}.`);
    }
  }

  if (["step", "stride"].includes(action.slug) && action.source === "generic" && target) {
    const distance = Number(target.distance ?? Infinity);
    const reach = profileReach(profile);
    if (distance <= reach) {
      score -= 26;
      reasons.push("Target already in reach; repositioning is low priority.");
    } else {
      score += action.slug === "stride" ? 8 : 4;
      reasons.push("Closes distance toward the target.");
    }
  }

  if (action.slug === "demoralize" && target && !hasCondition(target, "frightened")) {
    score += 22;
    reasons.push("Target is not frightened.");
  }

  if (action.slug === "trip" && target && !hasCondition(target, "prone")) {
    score += 18;
    reasons.push("Target is standing and can be knocked prone.");
  }

  if (action.slug === "grapple" && target && !hasCondition(target, "grabbed")) {
    score += 16;
    reasons.push("Target is not grabbed.");
  }

  if (action.slug === "disarm" && target) {
    score += 10;
    reasons.push("Can pressure enemy weapon or held item.");
  }

  if (action.slug === "reposition" && target) {
    score += 12;
    reasons.push("Can move target into a better square.");
  }

  if (action.slug === "shove" && target) {
    score += 12;
    reasons.push("Can push target out of position.");
  }

  if (action.slug === "feint" && enemyInMelee(context) && !hasCondition(target, "off-guard")) {
    score += 18;
    reasons.push("Target is in melee and not off-guard.");
  }

  if (action.slug === "create-a-diversion" && target && !hasCondition(profile, "hidden")) {
    score += 12;
    reasons.push("Can create a hidden opening.");
  }

  if (action.slug === "tumble-through" && target && !hasCondition(target, "off-guard")) {
    score += 14;
    reasons.push("Can move through enemy and set up off-guard pressure.");
  }

  if (["balance", "climb", "swim", "high-jump", "long-jump"].includes(action.slug)) {
    score += 6;
    reasons.push("Terrain makes this movement action relevant.");
  }

  if (action.slug === "force-open") {
    score += 8;
    reasons.push("Obstacle or object can be forced open.");
  }

  if (action.slug === "seek") {
    score += 8;
    reasons.push("Useful when hidden enemies or hazards may matter.");
  }

  if (action.slug === "sense-motive" && target) {
    score += 6;
    reasons.push("Useful when enemy intent is unclear.");
  }

  if (action.slug === "recall-knowledge" && target) {
    score += 16;
    reasons.push(`Identify ${target.name} defenses and weaknesses.`);
  }

  if (action.slug === "raise-a-shield" && profile.hasShield) {
    score += hpPercent(profile) < 0.5 ? 24 : 12;
    reasons.push("Shield equipped.");
  }

  if (action.slug === "take-cover") {
    score += hpPercent(profile) < 0.5 ? 18 : 10;
    reasons.push("Cover is available.");
  }

  if (action.slug === "escape") {
    score += 30;
    reasons.push("Actor is grabbed or restrained.");
  }

  if (action.slug === "hide") {
    score += 12;
    reasons.push("Cover or concealment supports hiding.");
  }

  if (action.slug === "sneak") {
    score += 10;
    reasons.push("Can reposition while hidden or covered.");
  }

  if (action.slug === "steal" && target) {
    score -= 4;
    reasons.push("Combat theft is situational.");
  }

  if (action.slug === "palm-an-object") {
    score -= 2;
    reasons.push("Nearby object can be palmed, but combat value is situational.");
  }

  if (action.slug === "command-an-animal") {
    score += 18;
    reasons.push("Companion or minion can contribute this turn.");
  }

  if (action.slug === "administer-first-aid") {
    const ally = dyingAlly(context) ?? bleedingAlly(context);
    if (ally) {
      score += 36;
      reasons.push(`${ally.name} needs immediate aid.`);
    }
  }

  if (action.slug === "stabilize") {
    const ally = dyingAlly(context);
    if (ally) {
      score += 40;
      reasons.push(`${ally.name} is dying.`);
    }
  }

  if (isCurated(action) && role === "healing") {
    const injuredAlly = allies(context).find((ally) => hpPercent(ally) < 0.5);
    if (injuredAlly) {
      score += 34;
      reasons.push(`${injuredAlly.name} is badly injured.`);
    } else {
      score -= 10;
      reasons.push("No ally is badly injured.");
    }
  }

  if (isCurated(action) && role === "damage" && target && !action.activityProfile?.drawsWeapon) {
    score += 18;
    reasons.push(`${action.name} can damage ${target.name}.`);
  }

  if (action.activityProfile?.drawsWeapon && target) {
    const weaponName = action.activityProfile.weaponName ?? action.item?.name ?? action.name;
    if (inActionReach(profile, action, target)) {
      // Drawing a weapon costs an action. It is the strong play only when no
      // enemy is already in melee reach; otherwise an in-hand Strike on the
      // adjacent enemy is the better use of the turn.
      score += enemyInMelee(context) ? 18 : 82;
      reasons.unshift(`Draw ${weaponName} and Strike ${target.name}.`);
    } else {
      score -= 40;
      reasons.unshift(`${weaponName} is still out of range after drawing.`);
    }
  }

  if (isCurated(action) && role === "debuff" && target) {
    score += 20;
    reasons.push(`Debuff spell can pressure ${target.name}.`);
  }

  if (isCurated(action) && role === "setup" && target) {
    score += action.activityProfile?.precisionDamageSetup ? 28 : 20;
    reasons.unshift(`${action.name} sets up stronger follow-up attacks.`);
  }

  if (isCurated(action) && role === "mobility") {
    const strideCount = Number(action.activityProfile?.strideCount ?? 1);
    const distance = Number(target?.distance ?? Infinity);
    const moveReach = profileMoveReach(profile, strideCount);
    if (action.activityProfile?.retreat && enemyInMelee(context)) {
      score += 24;
      reasons.unshift(`${action.name} can disengage from melee.`);
    } else if (target && distance > profileReach(profile) && distance <= moveReach) {
      score += 18;
      reasons.unshift(`${action.name} can improve position toward ${target.name}.`);
    } else {
      score += 8;
      reasons.unshift(`${action.name} improves position.`);
    }
    if (action.activityProfile?.safeMovement) {
      score += 6;
      reasons.push("Movement reduces reaction risk.");
    }
  }

  if (isCurated(action) && role === "drain" && target) {
    const required = action.activityProfile?.requiresAnyTargetCondition ?? [];
    if (required.length && !hasAnyCondition(target, required)) {
      score -= 28;
      reasons.unshift(`${action.name} needs a grabbed, restrained, paralyzed, or unconscious target.`);
    } else {
      score += hpPercent(profile) < 0.5 ? 58 : 42;
      reasons.unshift(`${action.name} can drain ${target.name} and recover Hit Points.`);
    }
  }

  if (isCurated(action) && role === "self-healing") {
    const corpse = nearbyCorpse(context, profile);
    if (action.activityProfile?.requiresCorpse && !corpse) {
      score -= 24;
      reasons.unshift(`${action.name} needs an adjacent corpse.`);
    } else {
      score += hpPercent(profile) < 0.5 ? 46 : 20;
      reasons.unshift(corpse ? `${action.name} can use ${corpse.name}.` : `${action.name} can recover Hit Points.`);
    }
  }

  if (isCurated(action) && role === "resource-recovery") {
    score += 8;
    reasons.unshift(`${action.name} can recover an expended combat resource.`);
  }

  if (isCurated(action) && role === "transformation") {
    score += 6;
    reasons.unshift(`${action.name} may alter movement or attack options.`);
  }

  if (isCurated(action) && role === "area-damage") {
    const enemiesInArea = entitiesInArea(action, enemies(context));
    const alliesInArea = entitiesInArea(action, allies(context));
    if (enemiesInArea.length > 0) {
      score += 34 + enemiesInArea.length * 18;
      reasons.unshift(`${action.name} can hit ${enemiesInArea.length} ${plural(enemiesInArea.length, "enemy", "enemies")}.`);
    } else {
      score -= 28;
      reasons.unshift(`No enemy is in ${action.name} area.`);
    }
    if (alliesInArea.length > 0) {
      score -= alliesInArea.length * 18;
      reasons.push(`${alliesInArea.length} ${plural(alliesInArea.length, "ally", "allies")} may be in the area.`);
    }
  }

  if (isCurated(action) && role === "save-damage" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    if (requiredCondition && !hasCondition(target, requiredCondition)) {
      score -= 24;
      reasons.unshift(`${action.name} wants a ${requiredCondition} target.`);
    } else {
      score += requiredCondition ? 52 : 34;
      reasons.unshift(`${action.name} can force a ${action.saveProfile?.stat ?? "save"} save.`);
    }
  }

  if (isCurated(action) && role === "grab" && target) {
    if (hasCondition(target, "grabbed") || hasCondition(target, "restrained")) {
      score -= 14;
      reasons.unshift(`${target.name} is already grabbed.`);
    } else if (inProfileReach(profile, target)) {
      score += 42;
      reasons.unshift(`${action.name} can grab ${target.name}.`);
    } else {
      score -= 24;
      reasons.unshift(`${action.name} target is out of reach.`);
    }
  }

  if (isCurated(action) && role === "control" && target) {
    const requiredCondition = action.activityProfile?.requiresTargetCondition;
    const appliedCondition = action.activityProfile?.appliesCondition;
    if (requiredCondition && !hasCondition(target, requiredCondition)) {
      score -= 24;
      reasons.unshift(`${action.name} wants a ${requiredCondition} target.`);
    } else if (appliedCondition && hasCondition(target, appliedCondition)) {
      score -= 10;
      reasons.unshift(`${target.name} already has ${appliedCondition}.`);
    } else {
      score += 32;
      reasons.unshift(`${action.name} can control ${target.name}.`);
    }
  }

  if (isCurated(action) && role === "reaction-attack") {
    score += 26;
    reasons.unshift("Reaction can punish the current trigger.");
  }

  if (isCurated(action) && role === "defense") {
    score += hpPercent(profile) < 0.5 ? 34 : 18;
    reasons.unshift("Defensive reaction is available for the trigger.");
  }

  if (isCurated(action) && role === "buff") {
    const allyTarget = action.activityProfile?.ally && allies(context).length > 0;
    score += allyTarget ? 16 : 12;
    reasons.unshift(allyTarget
      ? `${action.name} can boost an ally.`
      : `${action.name} grants the actor a beneficial effect.`);
  }

  if (isCurated(action) && role === "summon") {
    score += 14;
    reasons.unshift(`${action.name} brings an ally or construct onto the battlefield.`);
  }

  // Last-resort options: recognized but no tactical pattern. Push well below the
  // basics so they only surface when nothing stronger fills the turn.
  if (role === "utility") {
    score -= 30;
    reasons.unshift(`${action.name} is available; no stronger pattern recognized.`);
  }

  if (action.slug === "rage" && !hasCondition(profile, "rage") && !hasCondition(profile, "raging")) {
    score += 46;
    reasons.push("Rage sets up this turn's attack.");
  }

  if (action.slug === "sudden-charge" && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const chargeReach = speed * 2 + reach;

    if (distance > reach && distance <= chargeReach) {
      score += 72;
      reasons.push(`Closes ${distance} ft and attacks in one activity.`);
    } else if (distance <= reach) {
      score -= 18;
      reasons.push("Already in reach; Sudden Charge has less value.");
    } else {
      score -= 24;
      reasons.push("Target is beyond Sudden Charge reach.");
    }
  }

  if (action.activityProfile?.includesStrike && action.activityProfile?.strideCount > 0 && target) {
    const speed = profileSpeed(profile);
    const reach = profileReach(profile);
    const distance = Number(target.distance ?? Infinity);
    const moveReach = speed * Number(action.activityProfile.strideCount ?? 1) + reach;

    if (distance > reach && distance <= moveReach) {
      score += 60;
      reasons.unshift(`Moves into reach and attacks ${target.name}.`);
    } else if (distance <= reach) {
      score += 18;
      reasons.unshift(`${target.name} is already in reach for the attack.`);
    } else {
      score -= 30;
      reasons.unshift("Target is beyond this move-and-attack activity.");
    }
  }

  if (isCurated(action) && action.activityProfile?.strideCount > 0 && action.saveProfile && action.damageProfile) {
    const moveReach = profileMoveReach(profile, action.activityProfile.strideCount);
    const reachableEnemies = enemies(context).filter((enemy) => (enemy?.distance ?? Infinity) <= moveReach);
    if (reachableEnemies.length > 0) {
      score += 24 + reachableEnemies.length * 12;
      reasons.unshift(`${action.name} can move through ${reachableEnemies.length} ${plural(reachableEnemies.length, "enemy", "enemies")}.`);
    } else {
      score -= 18;
      reasons.unshift(`No enemy is reachable for ${action.name}.`);
    }
  }

  if (action.activityProfile?.focusedStrike && target && !action.activityProfile?.strideCount) {
    if (inActionReach(profile, action, target)) {
      score += 72;
      reasons.unshift(`${action.name} focuses attacks on ${target.name}.`);
    } else {
      score -= 40;
      reasons.unshift(`${action.name} target is out of range.`);
    }
  }

  if (action.activityProfile?.multiStrike) {
    const reachableEnemies = enemies(context).filter((enemy) => inProfileReach(profile, enemy));
    if (reachableEnemies.length >= 2) {
      score += 76;
      reasons.unshift(`${reachableEnemies.length} enemies are in reach for separate Strikes.`);
    } else if (inProfileReach(profile, target)) {
      score += 36;
      reasons.unshift("Only one enemy is in reach; focused offense is usually better.");
    } else {
      score -= 40;
      reasons.unshift(`No enemy is in reach for ${action.name}.`);
    }
  }

  if (isCurated(action) && (action.curated?.friendlyFireRisk ?? action.friendlyFireRisk)) {
    if (allies(context).some((ally) => (ally?.distance ?? Infinity) <= 20)) score -= 18;
    reasons.push("Area spell has friendly-fire risk.");
  }

  // A multi-action offensive action commits several actions to one effect (a
  // 2-action nuke, or a Stride -> Stride -> Strike that closes a gap and attacks).
  // The planner sums per-step scores, so without this it is out-summed by the cheap
  // 1-action fillers it displaces and never surfaces. Credit each extra action it
  // costs at a representative realized action value (~55) so it competes as the
  // whole-turn investment it is.
  const multiActionOffensive = String(action.source).startsWith("spell")
    ? ["damage", "area-damage", "save-damage", "control"].includes(role)
    : ["mobility-attack", "multiattack"].includes(role);
  if (multiActionOffensive && Number(action.actionCost) >= 2 && score > baseScore(action)) {
    const extraActions = Math.min(2, Number(action.actionCost) - 1);
    score += extraActions * 55;
    reasons.push(`Commits ${action.actionCost} actions to one effect.`);
  }

  if (skillCheck) {
    score += skillCheck.scoreDelta;
    reasons.push(...skillCheck.reasons);
  }

  return {
    ...action,
    score,
    skillCheck,
    suggestedTarget,
    reason: reasons[0] ?? defaultReason(action),
    reasons,
  };
}
