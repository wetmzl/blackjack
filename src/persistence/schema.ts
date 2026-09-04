import { z } from "zod";
import type { MatchHistoryRecord } from "../core/match/history";
import type { MatchState } from "../core/match/types";
import type { CharacterDefeatRecord } from "../core/progression/defeats";
import { getSkillDefinition } from "../core/skills/definitions";
import { unlockedSkillIdsForDefeats } from "../core/skills/skills";
import { ABILITY_CATALOG_VERSION, getAbilityDefinition, getStatusDefinition, supportsAbilitySourceKind, validateAbilityBinding } from "../core/abilities/registry";
import characterCatalog from "../content/characters/catalog.json" with { type: "json" };

export const LONG_TERM_SAVE_FORMAT = "house-of-chances-save" as const;
export const RUNTIME_SAVE_FORMAT = "house-of-chances-runtime" as const;
export const CURRENT_LONG_TERM_SCHEMA_VERSION = 7 as const;
export const CURRENT_RUNTIME_SCHEMA_VERSION = 1 as const;
export const CURRENT_GAME_VERSION = "0.1.0" as const;

const CardFaceSchema = {
  suit: z.enum(["spades", "hearts", "diamonds", "clubs"]),
  rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"])
};
const PhysicalCardSchema = z.object({ ...CardFaceSchema, origin: z.literal("shoe") }).strict();
const DerivedCardSchema = z.object({ ...CardFaceSchema, origin: z.literal("derived") }).strict();
const CardSchema = z.discriminatedUnion("origin", [PhysicalCardSchema, DerivedCardSchema]);
const HandSchema = z.object({ cards: z.array(CardSchema) }).strict();
const RngSnapshotSchema = z.object({ seed: z.string(), state: z.number().int().min(0).max(0xffffffff) }).strict();
const CHARACTER_IDS = new Set(characterCatalog.characters.map((character) => character.id));
const CharacterIdSchema = z.string().min(1).refine((id) => CHARACTER_IDS.has(id), "unknown character");
const ShoeSchema = z.object({ cards: z.array(PhysicalCardSchema), cursor: z.number().int().min(0), shuffleIndex: z.number().int().min(0) }).strict()
  .refine((shoe) => shoe.cursor <= shoe.cards.length, "cursor cannot exceed cards length");
const GunSchema = z.object({ capacity: z.number().int().positive(), bullets: z.number().int().min(0) }).strict()
  .refine((gun) => gun.bullets <= gun.capacity, "bullets cannot exceed capacity");
const RouletteSchema = z.object({ player: GunSchema, opponent: GunSchema }).strict();
const ParticipantSchema = z.object({
  id: z.enum(["player", "opponent"]), hand: HandSchema, stood: z.boolean(), busted: z.boolean(), bustLimit: z.number().finite().optional()
}).strict();
const RoundOutcomeSchema = z.object({
  winner: z.enum(["player", "opponent"]).nullable(),
  reason: z.enum(["blackjack", "bust", "comparison", "push"]),
  penaltyTarget: z.enum(["player", "opponent"]).nullable(),
  bulletsAdded: z.number().int().min(0),
  playerSkillReward: z.number().int().min(0)
}).strict();
const RoundSchema = z.object({
  index: z.number().int().min(0),
  phase: z.enum(["dealing", "initial-blackjack-check", "turns", "settlement", "round-reveal", "roulette-reaction", "roulette-trigger", "roulette-result", "reward", "round-end"]),
  starter: z.enum(["player", "opponent"]),
  currentActor: z.enum(["player", "opponent"]).nullable(),
  player: ParticipantSchema,
  opponent: ParticipantSchema,
  outcome: RoundOutcomeSchema.nullable()
}).strict();
const AiProfileSchema = z.object({ P: z.number().finite(), A: z.number().finite(), B: z.number().finite(), C: z.number().finite() }).strict();
const AiNoiseSchema = z.object({ match: z.number().min(-0.3).max(0.3), play: z.number().min(-0.3).max(0.3) }).strict();
const AiDecisionSchema = z.object({
  handValue: z.number().int().min(0), threshold: z.number().finite(), bulletDifference: z.number().int(),
  matchNoise: z.number().min(-0.3).max(0.3), playNoise: z.number().min(-0.3).max(0.3), action: z.enum(["hit", "stand"])
}).strict();
const AbilityCardSchema = z.object({ kind: z.literal("player-skill"), definitionId: z.string().min(1), owner: z.enum(["player", "opponent"]), instanceId: z.string().min(1) }).strict();
const AbilityInstanceSchema = z.object({ kind: z.enum(["player-skill", "character-mechanic"]), definitionId: z.string().min(1), owner: z.enum(["player", "opponent"]), instanceId: z.string().min(1), createdAtSequence: z.number().int().min(0), parameters: z.record(z.union([z.string(), z.number().finite(), z.boolean()])) }).strict();
const AbilityStatusSchema = z.object({ statusDefinitionId: z.string().min(1), owner: z.enum(["player", "opponent"]), sourceInstanceId: z.string().min(1), stacks: z.number().int().positive(), duration: z.enum(["turn", "round", "match", "until-owner-action", "until-consumed"]), parameters: z.record(z.union([z.string(), z.number().finite(), z.boolean()])), createdAtSequence: z.number().int().min(0) }).strict();
const AbilityRuntimeSchema = z.object({ instances: z.array(AbilityInstanceSchema), statuses: z.array(AbilityStatusSchema), counters: z.record(z.number().int().min(0)), sequence: z.number().int().min(0), catalogVersion: z.string().min(1), rng: RngSnapshotSchema }).strict().superRefine((runtime, ctx) => {
  if (runtime.catalogVersion !== ABILITY_CATALOG_VERSION) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["catalogVersion"], message: "unsupported ability catalog version" });
  const instanceIds = new Set<string>();
  runtime.instances.forEach((instance, index) => {
    if (instanceIds.has(instance.instanceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["instances", index, "instanceId"], message: "duplicate ability instance id" });
    instanceIds.add(instance.instanceId);
    if (instance.createdAtSequence > runtime.sequence) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["instances", index, "createdAtSequence"], message: "instance sequence exceeds runtime sequence" });
    const definition = getAbilityDefinition(instance.definitionId);
    if (!definition) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["instances", index, "definitionId"], message: "unknown ability definition" });
    else {
      if (!supportsAbilitySourceKind(definition, instance.kind)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["instances", index, "kind"], message: "instance kind does not match definition source kind" });
      try { validateAbilityBinding({ definitionId: instance.definitionId, enabled: true, parameters: instance.parameters }); } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["instances", index, "parameters"], message: error instanceof Error ? error.message : "invalid ability parameters" }); }
    }
  });
  runtime.statuses.forEach((status, index) => {
    if (status.createdAtSequence > runtime.sequence) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses", index, "createdAtSequence"], message: "status sequence exceeds runtime sequence" });
    if (!getStatusDefinition(status.statusDefinitionId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses", index, "statusDefinitionId"], message: "unknown status definition" });
    if (!instanceIds.has(status.sourceInstanceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statuses", index, "sourceInstanceId"], message: "status source instance does not exist" });
  });
});

const GameEventSchema = z.union([
  z.object({ type: z.literal("ABILITY_PLAYED"), instanceId: z.string().min(1), definitionId: z.string().min(1), owner: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("ABILITY_TRIGGERED"), instanceId: z.string().min(1), definitionId: z.string().min(1), ruleId: z.string().min(1), owner: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("ABILITY_RESOLUTION_FAILED"), instanceId: z.string().min(1), definitionId: z.string().min(1), ruleId: z.string().min(1), reason: z.string().min(1) }).strict(),
  z.object({ type: z.literal("STATUS_ADDED"), statusDefinitionId: z.string().min(1), owner: z.enum(["player", "opponent"]), sourceInstanceId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("STATUS_REMOVED"), statusDefinitionId: z.string().min(1), owner: z.enum(["player", "opponent"]), reason: z.enum(["consumed", "expired", "dispelled"]) }).strict(),
  z.object({ type: z.literal("PENDING_EVENT_MODIFIED"), eventId: z.string().min(1), effectType: z.string().min(1), sourceInstanceId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("PENDING_EVENT_CANCELLED"), eventId: z.string().min(1), sourceInstanceId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("CARD_SUIT_REVEALED"), viewer: z.enum(["player", "opponent"]), target: z.enum(["player", "opponent"]), cardIndex: z.number().int().min(0), suit: z.enum(["spades", "hearts", "diamonds", "clubs"]) }).strict(),
  z.object({ type: z.literal("ROUND_STARTED"), roundIndex: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("CARD_DEALT"), actor: z.enum(["player", "opponent"]), card: CardSchema, private: z.boolean() }).strict(),
  z.object({ type: z.literal("INITIAL_BLACKJACK_CHECK"), player: z.boolean(), opponent: z.boolean() }).strict(),
  z.object({ type: z.enum(["PLAYER_HIT", "OPPONENT_HIT"]), value: z.number().int().min(0) }).strict(),
  z.object({ type: z.enum(["PLAYER_STOOD", "OPPONENT_STOOD"]) }).strict(),
  z.object({ type: z.literal("BLACKJACK"), actor: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("BUST"), actor: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("ROUND_RESOLVED"), outcome: RoundOutcomeSchema }).strict(),
  z.object({ type: z.literal("ROUND_RESULT_ACKNOWLEDGED") }).strict(),
  z.object({ type: z.literal("BULLET_ADDED"), actor: z.enum(["player", "opponent"]), amount: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("TRIGGER_PULLED"), actor: z.enum(["player", "opponent"]), probability: z.number().min(0).max(1), fired: z.boolean() }).strict(),
  z.object({ type: z.literal("TRIGGER_SURVIVED"), actor: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("TRIGGER_RESULT_ACKNOWLEDGED") }).strict(),
  z.object({ type: z.literal("PARTICIPANT_KILLED"), actor: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("SKILL_GAINED"), skillId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("MATCH_FINISHED"), reason: z.enum(["player-killed", "opponent-killed", "escaped"]) }).strict(),
  z.object({ type: z.literal("MATCH_ESCAPED"), }).strict(),
  z.object({ type: z.literal("MATCH_RESULT_ACKNOWLEDGED"), }).strict(),
  z.object({ type: z.literal("AI_DECISION"), decision: AiDecisionSchema }).strict()
]);

export const MatchStateSchema = z.object({
  id: z.string().min(1), seed: z.string(), opponentId: CharacterIdSchema,
  status: z.enum(["active", "finished"]), scene: z.enum(["lobby", "match", "trophy-room"]),
  view: z.enum(["table", "execution-room", "match-summary"]), roundIndex: z.number().int().min(0),
  player: ParticipantSchema, opponent: ParticipantSchema, shoe: ShoeSchema, roulette: RouletteSchema,
  skills: z.object({ equippedSkillIds: z.array(z.string().min(1)).max(4), cards: z.array(AbilityCardSchema), advice: z.enum(["hit", "stand"]).nullable() }).strict().superRefine((skills, ctx) => { const defs = skills.equippedSkillIds.map(getSkillDefinition); if (new Set(skills.equippedSkillIds).size !== skills.equippedSkillIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate equipped skill" }); if (defs.some((skill) => !skill)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown equipped skill" }); if (defs.filter((skill) => skill?.category === "passive").length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at most one passive skill" }); const ids = new Set<string>(); for (const card of skills.cards) { if (ids.has(card.instanceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate skill card instance" }); ids.add(card.instanceId); const skill = getSkillDefinition(card.definitionId); if (!skill || skill.category !== "active" || card.owner !== "player" || !skills.equippedSkillIds.includes(card.definitionId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "skill card must be equipped active skill" }); } }), round: RoundSchema,
  abilities: AbilityRuntimeSchema,
  outcome: z.object({ winner: z.enum(["player", "opponent"]).nullable(), reason: z.enum(["player-killed", "opponent-killed", "escaped"]) }).strict().optional(),
  history: z.array(GameEventSchema),
  rng: z.object({ deck: RngSnapshotSchema, roulette: RngSnapshotSchema, ai: RngSnapshotSchema, loot: RngSnapshotSchema, dialogue: RngSnapshotSchema }).strict(),
  aiProfile: AiProfileSchema, aiNoise: AiNoiseSchema, lastAiDecision: AiDecisionSchema.nullable()
}).strict().superRefine((match, ctx) => {
  const instances = new Map(match.abilities.instances.map((instance) => [instance.instanceId, instance]));
  match.skills.cards.forEach((card, index) => {
    const instance = instances.get(card.instanceId);
    if (!instance) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills", "cards", index, "instanceId"], message: "card runtime instance is missing" });
    else if (instance.kind !== "player-skill" || instance.definitionId !== card.definitionId || instance.owner !== card.owner) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["skills", "cards", index], message: "card does not match runtime instance" });
  });
  match.abilities.instances.forEach((instance, index) => {
    const isPassive = getSkillDefinition(instance.definitionId)?.category === "passive";
    const isStatusSource = match.abilities.statuses.some((status) => status.sourceInstanceId === instance.instanceId);
    if (instance.kind === "player-skill" && !isPassive && !isStatusSource && !match.skills.cards.some((card) => card.instanceId === instance.instanceId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["abilities", "instances", index], message: "player-skill runtime instance is neither a card, passive, nor status source" });
  });
});

export const PlayerProfileSchema = z.object({
  id: z.string().min(1), displayName: z.string().min(1), matchesPlayed: z.number().int().min(0),
  wins: z.number().int().min(0), equippedSkillIds: z.array(z.string().min(1)).max(4)
}).strict().superRefine((profile, ctx) => { if (new Set(profile.equippedSkillIds).size !== profile.equippedSkillIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate equipped skill" }); for (const id of profile.equippedSkillIds) if (!getSkillDefinition(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown skill" }); if (profile.equippedSkillIds.filter((id) => getSkillDefinition(id)?.category === "passive").length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at most one passive skill" }); });
export const GameSettingsSchema = z.object({ soundEnabled: z.boolean(), reducedMotion: z.boolean() }).strict();
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;
export type GameSettings = z.infer<typeof GameSettingsSchema>;
const HistoryGunSchema = z.object({ capacity: z.number().int().positive(), bullets: z.number().int().min(0) }).strict()
  .refine((gun) => gun.bullets <= gun.capacity, "bullets cannot exceed capacity");
const HistoryCountsSchema = z.object({ player: z.number().int().min(0), opponent: z.number().int().min(0) }).strict();
export const MatchHistoryRecordSchema = z.object({
  id: z.string().min(1), timestamp: z.string().datetime({ offset: true }), opponentId: CharacterIdSchema,
  winner: z.enum(["player", "opponent"]).nullable(), escaped: z.boolean(),
  finalRoulette: z.object({ player: HistoryGunSchema, opponent: HistoryGunSchema }).strict(),
  busts: HistoryCountsSchema, blackjacks: HistoryCountsSchema
}).strict();
export const CharacterDefeatRecordSchema = z.object({
  opponentId: CharacterIdSchema,
  timestamp: z.string().datetime({ offset: true })
}).strict();
export type { MatchHistoryRecord } from "../core/match/history";
export type { CharacterDefeatRecord } from "../core/progression/defeats";
export const LongTermSaveSchema = z.object({
  format: z.literal(LONG_TERM_SAVE_FORMAT), schemaVersion: z.literal(CURRENT_LONG_TERM_SCHEMA_VERSION), gameVersion: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  profile: PlayerProfileSchema, settings: GameSettingsSchema, skipTutorial: z.boolean(),
  history: z.array(MatchHistoryRecordSchema),
  defeats: z.array(CharacterDefeatRecordSchema)
}).strict().superRefine((save, ctx) => {
  const opponentIds = new Set<string>();
  save.defeats.forEach((record, index) => {
    if (opponentIds.has(record.opponentId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defeats", index, "opponentId"], message: "duplicate defeated character" });
    opponentIds.add(record.opponentId);
  });
  const unlockedSkills = new Set(unlockedSkillIdsForDefeats(save.defeats as CharacterDefeatRecord[]));
  save.profile.equippedSkillIds.forEach((id, index) => {
    if (!unlockedSkills.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["profile", "equippedSkillIds", index], message: "equipped skill must be unlocked by a recorded defeat" });
  });
});

export const RuntimeSaveSchema = z.object({
  format: z.literal(RUNTIME_SAVE_FORMAT), schemaVersion: z.literal(CURRENT_RUNTIME_SCHEMA_VERSION), gameVersion: z.string().min(1),
  updatedAt: z.string().datetime({ offset: true }), activeMatch: MatchStateSchema
}).strict();

export type LongTermSave = Omit<z.infer<typeof LongTermSaveSchema>, "history" | "defeats"> & { history: MatchHistoryRecord[]; defeats: CharacterDefeatRecord[] };
/** Runtime schema uses mutable arrays; the domain-facing save type preserves MatchState immutability. */
export type RuntimeSave = Omit<z.infer<typeof RuntimeSaveSchema>, "activeMatch"> & { activeMatch: MatchState };
export type SaveKind = "long-term" | "runtime";

export class SaveValidationError extends Error {
  constructor(readonly kind: SaveKind, message: string) { super(message); this.name = "SaveValidationError"; }
}

export function validateLongTermSave(input: unknown): LongTermSave {
  const parsed = LongTermSaveSchema.safeParse(input);
  if (!parsed.success) throw new SaveValidationError("long-term", `Invalid long-term save data: ${parsed.error.issues[0]?.path.join(".") || "root"} ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data as LongTermSave;
}

export function validateRuntimeSave(input: unknown): RuntimeSave {
  const parsed = RuntimeSaveSchema.safeParse(input);
  if (!parsed.success) throw new SaveValidationError("runtime", `Invalid runtime save data: ${parsed.error.issues[0]?.path.join(".") || "root"} ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data as RuntimeSave;
}

export function assertMatchStateForSave(match: MatchState): MatchState {
  const result = MatchStateSchema.safeParse(match);
  if (!result.success) throw new SaveValidationError("runtime", `Cannot save invalid match state: ${result.error.issues[0]?.path.join(".") || "root"}`);
  return match;
}
