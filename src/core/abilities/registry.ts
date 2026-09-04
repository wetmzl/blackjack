import hunterInstinct from "../../content/abilities/player-skills/hunter-instinct.json" with { type: "json" };
import switcheroo from "../../content/abilities/player-skills/switcheroo.json" with { type: "json" };
import rhodesHeartthrob from "../../content/abilities/player-skills/rhodes-heartthrob.json" with { type: "json" };
import nightQueen from "../../content/abilities/player-skills/night-queen.json" with { type: "json" };
import scentOfAWoman from "../../content/abilities/player-skills/scent-of-a-woman.json" with { type: "json" };
import blueberryAndDarkChocolate from "../../content/abilities/player-skills/blueberry-and-dark-chocolate.json" with { type: "json" };
import playerSwordAndHandcannon from "../../content/abilities/player-skills/sword-and-handcannon.json" with { type: "json" };
import playerForgeHeraldsTheYear from "../../content/abilities/player-skills/forge-heralds-the-year.json" with { type: "json" };
import ownerLoadPenalty from "../../content/abilities/ai-skills/owner-load-penalty.json" with { type: "json" };
import rivalBustLoad from "../../content/abilities/ai-skills/rival-bust-load.json" with { type: "json" };
import actionAdviceMechanic from "../../content/abilities/ai-skills/action-advice-mechanic.json" with { type: "json" };
import handChangeObserver from "../../content/abilities/ai-skills/hand-change-observer.json" with { type: "json" };
import silentDrizzle from "../../content/abilities/ai-skills/silent-drizzle.json" with { type: "json" };
import bombManiac from "../../content/abilities/ai-skills/bomb-maniac.json" with { type: "json" };
import wNightQueen from "../../content/abilities/ai-skills/w-night-queen.json" with { type: "json" };
import aiSwordAndHandcannon from "../../content/abilities/ai-skills/ai-sword-and-handcannon.json" with { type: "json" };
import aiForgeHeraldsTheYear from "../../content/abilities/ai-skills/ai-forge-heralds-the-year.json" with { type: "json" };
import copperSeal from "../../content/abilities/ai-skills/copper-seal.json" with { type: "json" };
import earlyPreparation from "../../content/abilities/talents/early-preparation.json" with { type: "json" };
import rhodesHeartthrobStatus from "../../content/abilities/statuses/rhodes-heartthrob-armed.json" with { type: "json" };
import silentDrizzleStatus from "../../content/abilities/statuses/silent-drizzle-silenced.json" with { type: "json" };
import copperSealStatus from "../../content/abilities/statuses/copper-seal-sealed.json" with { type: "json" };
import { AbilityDefinitionSchema, StatusDefinitionSchema, validateBinding } from "./schema";
import type { AbilityBinding, AbilityDefinition, AbilityInstance, AbilitySourceKind, AiSkillAbilityDefinition, PlayerSkillAbilityDefinition, StatusDefinition, TalentAbilityDefinition } from "./types";

export const ABILITY_CATALOG_VERSION = "abilities-v8" as const;
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const definitions = [hunterInstinct, switcheroo, rhodesHeartthrob, nightQueen, scentOfAWoman, blueberryAndDarkChocolate, playerSwordAndHandcannon, playerForgeHeraldsTheYear, ownerLoadPenalty, rivalBustLoad, actionAdviceMechanic, handChangeObserver, silentDrizzle, bombManiac, wNightQueen, aiSwordAndHandcannon, aiForgeHeraldsTheYear, copperSeal, earlyPreparation]
  .map((value) => deepFreeze(AbilityDefinitionSchema.parse(value) as AbilityDefinition));
const statuses = [rhodesHeartthrobStatus, silentDrizzleStatus, copperSealStatus].map((value) => deepFreeze(StatusDefinitionSchema.parse(value) as StatusDefinition));
if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) throw new Error("Duplicate ability definition id across Player Skill, AI Skill, and Talent catalogs");
if (new Set(statuses.map((status) => status.id)).size !== statuses.length) throw new Error("Duplicate status definition id");
export const ABILITY_DEFINITIONS: readonly AbilityDefinition[] = Object.freeze(definitions);
export const PLAYER_SKILL_ABILITY_DEFINITIONS: readonly PlayerSkillAbilityDefinition[] = Object.freeze(definitions.filter((definition): definition is PlayerSkillAbilityDefinition => definition.sourceKind === "player-skill"));
export const AI_SKILL_ABILITY_DEFINITIONS: readonly AiSkillAbilityDefinition[] = Object.freeze(definitions.filter((definition): definition is AiSkillAbilityDefinition => definition.sourceKind === "ai-skill"));
export const TALENT_ABILITY_DEFINITIONS: readonly TalentAbilityDefinition[] = Object.freeze(definitions.filter((definition): definition is TalentAbilityDefinition => definition.sourceKind === "talent"));
export const STATUS_DEFINITIONS: readonly StatusDefinition[] = Object.freeze(statuses);
export const ABILITY_DEFINITIONS_BY_ID: Readonly<Record<string, AbilityDefinition>> = Object.freeze(Object.fromEntries(definitions.map((definition) => [definition.id, definition])));
export const STATUS_DEFINITIONS_BY_ID: Readonly<Record<string, StatusDefinition>> = Object.freeze(Object.fromEntries(statuses.map((definition) => [definition.id, definition])));

function validateRuleReferences(definition: AbilityDefinition | StatusDefinition, abilityIds: ReadonlySet<string>, statusIds: ReadonlySet<string>): void {
  const rules = definition.rules;
  const ids = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    if (ids.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id} in ${definition.id} at index ${index}`);
    ids.add(rule.id);
    const visit = (value: unknown, path: string): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "parameter" && typeof record.key === "string" && !(definition as AbilityDefinition).parameters?.[record.key]) throw new Error(`Unknown parameter ${record.key} in ${definition.id}.${rule.id}`);
      if (record.type === "owner-has-card" && typeof record.abilityId === "string" && !abilityIds.has(record.abilityId)) throw new Error(`Unknown ability ${record.abilityId} in ${definition.id}.${rule.id}`);
      if ((record.type === "add-status" || record.type === "remove-status" || record.type === "status-present") && typeof record.statusDefinitionId === "string" && !statusIds.has(record.statusDefinitionId)) throw new Error(`Unknown status ${record.statusDefinitionId} in ${definition.id}.${rule.id}`);
      for (const [key, child] of Object.entries(record)) visit(child, `${path}.${key}`);
    };
    visit(rule, rule.id);
  }
  if ("activation" in definition) {
    const visitActivation = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "parameter" && typeof record.key === "string" && !definition.parameters?.[record.key]) throw new Error(`Unknown parameter ${record.key} in ${definition.id}.activation`);
      if (record.type === "owner-has-card" && typeof record.abilityId === "string" && !abilityIds.has(record.abilityId)) throw new Error(`Unknown ability ${record.abilityId} in ${definition.id}.activation`);
      if (record.type === "status-present" && typeof record.statusDefinitionId === "string" && !statusIds.has(record.statusDefinitionId)) throw new Error(`Unknown status ${record.statusDefinitionId} in ${definition.id}.activation`);
      for (const child of Object.values(record)) visitActivation(child);
    };
    visitActivation(definition.activation);
  }
}
const canonicalAbilityIds = new Set(definitions.map((definition) => definition.id));
const canonicalStatusIds = new Set(statuses.map((status) => status.id));
for (const definition of definitions) validateRuleReferences(definition, canonicalAbilityIds, canonicalStatusIds);
for (const definition of statuses) validateRuleReferences(definition, canonicalAbilityIds, canonicalStatusIds);

export interface AbilityRegistry {
  readonly catalogVersion: string;
  readonly definitions: readonly AbilityDefinition[];
  readonly statuses: readonly StatusDefinition[];
  readonly definitionsById: Readonly<Record<string, AbilityDefinition>>;
  readonly statusesById: Readonly<Record<string, StatusDefinition>>;
}

export const ABILITY_REGISTRY: AbilityRegistry = Object.freeze({
  catalogVersion: ABILITY_CATALOG_VERSION,
  definitions: ABILITY_DEFINITIONS,
  statuses: STATUS_DEFINITIONS,
  definitionsById: ABILITY_DEFINITIONS_BY_ID,
  statusesById: STATUS_DEFINITIONS_BY_ID
});

/** Build an isolated registry for tests or an expansion pack without touching the global catalog. */
export function createAbilityRegistry(extraDefinitions: readonly unknown[] = [], extraStatuses: readonly unknown[] = [], catalogVersion: string = ABILITY_CATALOG_VERSION): AbilityRegistry {
  const parsedDefinitions = [...definitions, ...extraDefinitions.map((value) => deepFreeze(AbilityDefinitionSchema.parse(value) as AbilityDefinition))];
  const parsedStatuses = [...statuses, ...extraStatuses.map((value) => deepFreeze(StatusDefinitionSchema.parse(value) as StatusDefinition))];
  if (new Set(parsedDefinitions.map((definition) => definition.id)).size !== parsedDefinitions.length) throw new Error("Duplicate ability definition id");
  if (new Set(parsedStatuses.map((definition) => definition.id)).size !== parsedStatuses.length) throw new Error("Duplicate status definition id");
  const abilityIds = new Set(parsedDefinitions.map((definition) => definition.id));
  const statusIds = new Set(parsedStatuses.map((status) => status.id));
  for (const definition of [...parsedDefinitions, ...parsedStatuses]) validateRuleReferences(definition, abilityIds, statusIds);
  return Object.freeze({ catalogVersion, definitions: Object.freeze(parsedDefinitions), statuses: Object.freeze(parsedStatuses), definitionsById: Object.freeze(Object.fromEntries(parsedDefinitions.map((definition) => [definition.id, definition]))), statusesById: Object.freeze(Object.fromEntries(parsedStatuses.map((definition) => [definition.id, definition]))) });
}

export function getAbilityDefinition(id: string): AbilityDefinition | undefined { return ABILITY_DEFINITIONS_BY_ID[id]; }
export function getStatusDefinition(id: string): StatusDefinition | undefined { return STATUS_DEFINITIONS_BY_ID[id]; }

export function supportsAbilitySourceKind(definition: AbilityDefinition, kind: AbilitySourceKind): boolean {
  return definition.sourceKind === kind;
}

export function validateAbilityBinding(binding: unknown, registry?: AbilityRegistry): AbilityBinding {
  const candidate = binding as { definitionId?: unknown };
  if (typeof candidate.definitionId !== "string") throw new Error("Ability binding requires definitionId");
  const definition = registry?.definitionsById[candidate.definitionId] ?? getAbilityDefinition(candidate.definitionId);
  if (!definition) throw new Error(`Unknown ability definition: ${candidate.definitionId}`);
  return validateBinding(binding, definition) as AbilityBinding;
}

export function instantiateAbility(binding: AbilityBinding, owner: "player" | "opponent", instanceId: string, createdAtSequence: number, registry?: AbilityRegistry, sourceKind: AbilitySourceKind = "player-skill"): AbilityInstance {
  const valid = validateAbilityBinding(binding, registry);
  const definition = registry?.definitionsById[valid.definitionId] ?? getAbilityDefinition(valid.definitionId);
  if (!definition) throw new Error(`Unknown ability definition: ${valid.definitionId}`);
  if (!supportsAbilitySourceKind(definition, sourceKind)) throw new Error(`Ability definition ${definition.id} does not support ${sourceKind}`);
  const ttl = definition.ttl ? Object.freeze({ type: definition.ttl.type, remaining: definition.ttl.amount }) : undefined;
  return Object.freeze({ kind: sourceKind, definitionId: valid.definitionId, owner, instanceId, createdAtSequence, parameters: Object.freeze({ ...valid.parameters }), ...(ttl ? { ttl } : {}) });
}

export function assertCatalogVersion(version: string): void {
  if (version !== ABILITY_CATALOG_VERSION) throw new Error(`Unsupported ability catalog version: ${version}`);
}
