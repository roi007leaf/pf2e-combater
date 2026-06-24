import { COMMON_ACTIONS } from './class-actions/common.js';
import { ALCHEMIST_ACTIONS } from './class-actions/alchemist.js';
import { ANIMIST_ACTIONS } from './class-actions/animist.js';
import { BARBARIAN_ACTIONS } from './class-actions/barbarian.js';
import { BARD_ACTIONS } from './class-actions/bard.js';
import { CHAMPION_ACTIONS } from './class-actions/champion.js';
import { CLERIC_ACTIONS } from './class-actions/cleric.js';
import { COMMANDER_ACTIONS } from './class-actions/commander.js';
import { DRUID_ACTIONS } from './class-actions/druid.js';
import { EXEMPLAR_ACTIONS } from './class-actions/exemplar.js';
import { FIGHTER_ACTIONS } from './class-actions/fighter.js';
import { GUARDIAN_ACTIONS } from './class-actions/guardian.js';
import { GUNSLINGER_ACTIONS } from './class-actions/gunslinger.js';
import { INVENTOR_ACTIONS } from './class-actions/inventor.js';
import { INVESTIGATOR_ACTIONS } from './class-actions/investigator.js';
import { KINETICIST_ACTIONS } from './class-actions/kineticist.js';
import { MAGUS_ACTIONS } from './class-actions/magus.js';
import { MONK_ACTIONS } from './class-actions/monk.js';
import { ORACLE_ACTIONS } from './class-actions/oracle.js';
import { PSYCHIC_ACTIONS } from './class-actions/psychic.js';
import { RANGER_ACTIONS } from './class-actions/ranger.js';
import { ROGUE_ACTIONS } from './class-actions/rogue.js';
import { RUNESMITH_ACTIONS } from './class-actions/runesmith.js';
import { SORCERER_ACTIONS } from './class-actions/sorcerer.js';
import { SUMMONER_ACTIONS } from './class-actions/summoner.js';
import { SWASHBUCKLER_ACTIONS } from './class-actions/swashbuckler.js';
import { THAUMATURGE_ACTIONS } from './class-actions/thaumaturge.js';
import { WITCH_ACTIONS } from './class-actions/witch.js';
import { WIZARD_ACTIONS } from './class-actions/wizard.js';

export const CUSTOM_ACTION_TACTICS = [
  ...COMMON_ACTIONS,
  ...ALCHEMIST_ACTIONS,
  ...ANIMIST_ACTIONS,
  ...BARBARIAN_ACTIONS,
  ...BARD_ACTIONS,
  ...CHAMPION_ACTIONS,
  ...CLERIC_ACTIONS,
  ...COMMANDER_ACTIONS,
  ...DRUID_ACTIONS,
  ...EXEMPLAR_ACTIONS,
  ...FIGHTER_ACTIONS,
  ...GUARDIAN_ACTIONS,
  ...GUNSLINGER_ACTIONS,
  ...INVENTOR_ACTIONS,
  ...INVESTIGATOR_ACTIONS,
  ...KINETICIST_ACTIONS,
  ...MAGUS_ACTIONS,
  ...MONK_ACTIONS,
  ...ORACLE_ACTIONS,
  ...PSYCHIC_ACTIONS,
  ...RANGER_ACTIONS,
  ...ROGUE_ACTIONS,
  ...RUNESMITH_ACTIONS,
  ...SORCERER_ACTIONS,
  ...SUMMONER_ACTIONS,
  ...SWASHBUCKLER_ACTIONS,
  ...THAUMATURGE_ACTIONS,
  ...WITCH_ACTIONS,
  ...WIZARD_ACTIONS,
];

export function findCustomActionTactics(slug) {
  return CUSTOM_ACTION_TACTICS.find((entry) => entry.slug === slug) ?? null;
}

export const CUSTOM_ACTIONS = CUSTOM_ACTION_TACTICS;
export const findCustomAction = findCustomActionTactics;
