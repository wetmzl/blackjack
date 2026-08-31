import { z } from "zod";
import type { MatchHistoryRecord } from "../core/match/history";
import type { MatchState } from "../core/match/types";
import { getSkillDefinition } from "../core/skills/definitions";

export const SAVE_FORMAT = "house-of-chances-save" as const;
export const CURRENT_SCHEMA_VERSION = 3 as const;
export const CURRENT_GAME_VERSION = "0.1.0" as const;

const CardSchema = z.object({
  suit: z.enum(["spades", "hearts", "diamonds", "clubs"]),
  rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"])
}).strict();
const HandSchema = z.object({ cards: z.array(CardSchema) }).strict();
const RngSnapshotSchema = z.object({ seed: z.string(), state: z.number().int().min(0).max(0xffffffff) }).strict();
const ShoeSchema = z.object({ cards: z.array(CardSchema), cursor: z.number().int().min(0), shuffleIndex: z.number().int().min(0) }).strict()
  .refine((shoe) => shoe.cursor <= shoe.cards.length, "cursor cannot exceed cards length");
const GunSchema = z.object({ capacity: z.number().int().positive(), bullets: z.number().int().min(0) }).strict()
  .refine((gun) => gun.bullets <= gun.capacity, "bullets cannot exceed capacity");
const RouletteSchema = z.object({ player: GunSchema, opponent: GunSchema }).strict();
const ParticipantSchema = z.object({
  id: z.enum(["player", "opponent"]), hand: HandSchema, stood: z.boolean(), busted: z.boolean()
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
const AiProfileSchema = z.object({ rationality: z.number().min(0).max(1), personalityHitProbability: z.number().min(0).max(1) }).strict();
const AiDecisionSchema = z.object({
  optimalAction: z.enum(["hit", "stand"]), optimalHit: z.union([z.literal(0), z.literal(1)]),
  personalityHitProbability: z.number().min(0).max(1), rationality: z.number().min(0).max(1),
  finalHitProbability: z.number().min(0).max(1), roll: z.number().min(0).lt(1), action: z.enum(["hit", "stand"])
}).strict();

const GameEventSchema = z.union([
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
  z.object({ type: z.literal("TRIGGER_AVOIDED_BY_SKILL"), actor: z.enum(["player", "opponent"]), skillId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("TRIGGER_RESULT_ACKNOWLEDGED") }).strict(),
  z.object({ type: z.literal("PARTICIPANT_KILLED"), actor: z.enum(["player", "opponent"]) }).strict(),
  z.object({ type: z.literal("SKILL_GAINED"), skillId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("SKILL_USED"), skillId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("SKILL_ADVICE"), advice: z.enum(["hit", "stand"]) }).strict(),
  z.object({ type: z.literal("MATCH_FINISHED"), reason: z.enum(["player-killed", "opponent-killed", "escaped"]) }).strict(),
  z.object({ type: z.literal("MATCH_ESCAPED"), }).strict(),
  z.object({ type: z.literal("MATCH_RESULT_ACKNOWLEDGED"), }).strict(),
  z.object({ type: z.literal("AI_DECISION"), decision: AiDecisionSchema }).strict()
]);

export const MatchStateSchema = z.object({
  id: z.string().min(1), seed: z.string(), opponentId: z.string().min(1),
  status: z.enum(["active", "finished"]), scene: z.enum(["lobby", "match", "trophy-room"]),
  view: z.enum(["table", "execution-room", "match-summary"]), roundIndex: z.number().int().min(0),
  player: ParticipantSchema, opponent: ParticipantSchema, shoe: ShoeSchema, roulette: RouletteSchema,
  skills: z.object({ equippedSkillIds: z.array(z.string().min(1)).max(4), cards: z.array(z.string().min(1)), advice: z.enum(["hit", "stand"]).nullable(), rhodesArmed: z.boolean(), nightQueenArmed: z.boolean() }).strict().superRefine((skills, ctx) => { const defs = skills.equippedSkillIds.map(getSkillDefinition); if (new Set(skills.equippedSkillIds).size !== skills.equippedSkillIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate equipped skill" }); if (defs.some((skill) => !skill)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown equipped skill" }); if (defs.filter((skill) => skill?.category === "passive").length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at most one passive skill" }); if (skills.rhodesArmed && !defs.some((skill) => skill?.effect.type === "rhodes-heartthrob")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rhodes armed requires equipped skill" }); if (skills.nightQueenArmed && !defs.some((skill) => skill?.effect.type === "night-queen")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "night queen armed requires equipped skill" }); for (const id of skills.cards) { const skill = getSkillDefinition(id); if (!skill || skill.category !== "active" || !skills.equippedSkillIds.includes(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "skill card must be equipped active skill" }); } }), round: RoundSchema,
  outcome: z.object({ winner: z.enum(["player", "opponent"]).nullable(), reason: z.enum(["player-killed", "opponent-killed", "escaped"]) }).strict().optional(),
  history: z.array(GameEventSchema),
  rng: z.object({ deck: RngSnapshotSchema, roulette: RngSnapshotSchema, ai: RngSnapshotSchema, loot: RngSnapshotSchema, skill: RngSnapshotSchema, dialogue: RngSnapshotSchema }).strict(),
  aiProfile: AiProfileSchema, lastAiDecision: AiDecisionSchema.nullable()
}).strict();

export const PlayerProfileSchema = z.object({
  id: z.string().min(1), displayName: z.string().min(1), matchesPlayed: z.number().int().min(0),
  wins: z.number().int().min(0), unlockedCharacterIds: z.array(z.string().min(1)),
  unlockedSkillIds: z.array(z.string().min(1)), equippedSkillIds: z.array(z.string().min(1)).max(4)
}).strict().superRefine((profile, ctx) => { const unlocked = new Set(profile.unlockedSkillIds); if (new Set(profile.unlockedSkillIds).size !== profile.unlockedSkillIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate unlocked skill" }); if (new Set(profile.equippedSkillIds).size !== profile.equippedSkillIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate equipped skill" }); for (const id of profile.unlockedSkillIds) if (!getSkillDefinition(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown unlocked skill" }); for (const id of profile.equippedSkillIds) { if (!unlocked.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "equipped skill must be unlocked" }); const skill = getSkillDefinition(id); if (!skill) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown skill" }); } if (profile.equippedSkillIds.filter((id) => getSkillDefinition(id)?.category === "passive").length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at most one passive skill" }); });
export const GameSettingsSchema = z.object({ soundEnabled: z.boolean(), reducedMotion: z.boolean() }).strict();
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;
export type GameSettings = z.infer<typeof GameSettingsSchema>;
const HistoryGunSchema = z.object({ capacity: z.number().int().positive(), bullets: z.number().int().min(0) }).strict()
  .refine((gun) => gun.bullets <= gun.capacity, "bullets cannot exceed capacity");
const HistoryCountsSchema = z.object({ player: z.number().int().min(0), opponent: z.number().int().min(0) }).strict();
export const MatchHistoryRecordSchema = z.object({
  id: z.string().min(1), timestamp: z.string().datetime({ offset: true }), opponentId: z.string().min(1),
  winner: z.enum(["player", "opponent"]).nullable(), escaped: z.boolean(),
  finalRoulette: z.object({ player: HistoryGunSchema, opponent: HistoryGunSchema }).strict(),
  busts: HistoryCountsSchema, blackjacks: HistoryCountsSchema
}).strict();
export type { MatchHistoryRecord } from "../core/match/history";
const SaveEnvelopeSchema = z.object({ format: z.literal(SAVE_FORMAT), schemaVersion: z.number().int(), gameVersion: z.string(), createdAt: z.string(), updatedAt: z.string(), profile: z.unknown(), activeMatch: z.unknown().nullable(), settings: z.unknown(), history: z.unknown().optional() }).strict();

export const SaveFileV3Schema = z.object({
  format: z.literal(SAVE_FORMAT), schemaVersion: z.literal(3), gameVersion: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  profile: PlayerProfileSchema, activeMatch: MatchStateSchema.nullable(), settings: GameSettingsSchema,
  history: z.array(MatchHistoryRecordSchema)
}).strict();
export const CurrentSaveFileSchema = SaveFileV3Schema;
export type SaveFileV3 = z.infer<typeof SaveFileV3Schema>;
/** Runtime schema uses mutable arrays; the domain-facing save type preserves MatchState immutability. */
export type SaveFile = Omit<SaveFileV3, "activeMatch" | "history"> & { activeMatch: MatchState | null; history: MatchHistoryRecord[] };

export class SaveValidationError extends Error {
  constructor(message: string) { super(message); this.name = "SaveValidationError"; }
}

export function validateAndMigrateSave(input: unknown): SaveFile {
  const envelope = SaveEnvelopeSchema.safeParse(input);
  if (!envelope.success) throw new SaveValidationError(`Invalid save envelope: ${envelope.error.issues[0]?.message ?? "unknown error"}`);
  if (envelope.data.schemaVersion > CURRENT_SCHEMA_VERSION) throw new SaveValidationError(`Unsupported future save schema version: ${envelope.data.schemaVersion}`);
  if (envelope.data.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new SaveValidationError(`Unsupported old save schema version: ${envelope.data.schemaVersion}`);
  const parsed = SaveFileV3Schema.safeParse(input);
  if (!parsed.success) throw new SaveValidationError(`Invalid save data: ${parsed.error.issues[0]?.path.join(".") || "root"} ${parsed.error.issues[0]?.message ?? "unknown error"}`);
  return parsed.data as SaveFile;
}

export function assertMatchStateForSave(match: MatchState): MatchState {
  const result = MatchStateSchema.safeParse(match);
  if (!result.success) throw new SaveValidationError(`Cannot save invalid match state: ${result.error.issues[0]?.path.join(".") || "root"}`);
  return match;
}
