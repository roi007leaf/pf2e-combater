function versionParts(value) {
  return String(value ?? "")
    .split(/[.+-]/, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

function supports(version, compatibility = {}) {
  if (compatibility.minimum && compareVersions(version, compatibility.minimum) < 0) return false;
  if (compatibility.maximum && compareVersions(version, compatibility.maximum) > 0) return false;
  return true;
}

function includes(source, text) {
  return String(source ?? "").includes(text);
}

/** Inspect installed Foundry/PF2e artifacts against every version-sensitive contract we consume. */
export function inspectInstalledRuntimeContract({
  moduleManifest,
  foundryManifest,
  pf2eManifest,
  foundryTokenSource,
  pf2eSource,
} = {}) {
  const foundryVersion = String(foundryManifest?.version ?? "");
  const pf2eVersion = String(pf2eManifest?.version ?? "");
  const pf2eRelationship = (moduleManifest?.relationships?.systems ?? [])
    .find((relationship) => relationship?.id === "pf2e");
  const contracts = Object.freeze({
    nativeMovement: includes(foundryTokenSource, "async move(waypoints"),
    recordedMovementUndo: includes(foundryTokenSource, "async revertRecordedMovement(movementId)"),
    movementMeasurement: includes(foundryTokenSource, "measureMovementPath(waypoints"),
    movementHook: includes(foundryTokenSource, 'Hooks.callAll("moveToken"'),
    pf2eActionLookup: includes(pf2eSource, "game.pf2e.actions.get("),
    pf2eActionUse: includes(pf2eSource, ".use({"),
    spellCast: includes(pf2eSource, ".cast(spell, {"),
    spellSlotState: includes(pf2eSource, "setSlotExpendedState("),
    itemMacro: includes(pf2eSource, "rollItemMacro("),
  });
  const foundrySupported = Boolean(foundryVersion)
    && supports(foundryVersion, moduleManifest?.compatibility);
  const pf2eSupported = pf2eManifest?.id === "pf2e"
    && Boolean(pf2eVersion)
    && supports(pf2eVersion, pf2eRelationship?.compatibility);
  const failures = [];
  if (!foundrySupported) failures.push(`Installed Foundry ${foundryVersion || "unknown"} is outside module compatibility.`);
  if (!pf2eSupported) failures.push(`Installed PF2e ${pf2eVersion || "unknown"} is outside module compatibility.`);
  for (const [contract, available] of Object.entries(contracts)) {
    if (!available) failures.push(`Installed runtime contract is missing: ${contract}.`);
  }
  return Object.freeze({
    ok: failures.length === 0,
    foundry: Object.freeze({ version: foundryVersion, supported: foundrySupported }),
    pf2e: Object.freeze({ version: pf2eVersion, supported: pf2eSupported }),
    contracts,
    failures: Object.freeze(failures),
  });
}
