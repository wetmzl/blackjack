import { z } from "zod";
import type { AbilityBinding, AbilityDefinition, Condition, ScalarValue } from "./types";

const actorSelector = z.enum(["owner", "rival", "event-actor", "penalty-target"]);
const scalar: z.ZodType<ScalarValue> = z.lazy(() => z.union([z.number().finite(), z.object({ type: z.literal("constant"), value: z.number().finite() }).strict(), z.object({ type: z.literal("parameter"), key: z.string().min(1) }).strict(), z.object({ type: z.enum(["gun-bullets", "hand-total", "round-final-score", "hand-card-count", "round-hit-count"]), target: actorSelector }).strict(), z.object({ type: z.literal("status-stacks"), target: actorSelector, statusDefinitionId: z.string().min(1) }).strict(), z.object({ type: z.enum(["add", "subtract", "multiply"]), left: scalar, right: scalar }).strict()])) as z.ZodType<ScalarValue>;
const compare = z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]);
const trigger = z.enum(["on-match-created", "on-ability-played", "after-ability-played", "before-card-draw", "after-card-draw", "after-hand-changed", "after-stand", "before-bust-check", "before-round-resolution", "before-bullet-load", "after-bullet-load", "before-trigger-pull", "after-trigger-result", "on-round-end"]);
const candidate = z.union([
  z.object({ type: z.literal("resulting-hand-total-at-most"), value: scalar }).strict(),
  z.object({ type: z.literal("resulting-hand-total-exactly"), value: scalar }).strict()
]);
const condition: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ type: z.literal("actor-is"), actor: actorSelector }).strict(),
  z.object({ type: z.literal("owner-has-card"), abilityId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("hand-card-count"), target: actorSelector, operator: compare, value: scalar }).strict(),
  z.object({ type: z.literal("hand-total"), target: actorSelector, operator: compare, value: scalar }).strict(),
  z.object({ type: z.literal("round-hit-count"), target: actorSelector, operator: compare, value: scalar }).strict(),
  z.object({ type: z.literal("hand-all-same-suit"), target: actorSelector }).strict(),
  z.object({ type: z.literal("hand-all-color"), target: actorSelector, color: z.enum(["red", "black"]) }).strict(),
  z.object({ type: z.literal("hand-rank-has-suit-partner"), target: actorSelector, rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) }).strict(),
  z.object({ type: z.literal("draw-pile-card-exists") }).strict(),
  z.object({ type: z.literal("hand-last-card-splittable"), target: actorSelector }).strict(),
  z.object({ type: z.literal("hand-card-origin-is"), target: actorSelector, card: z.literal("last-card"), origin: z.enum(["shoe", "derived"]) }).strict(),
  z.object({ type: z.literal("card-candidate-exists"), target: actorSelector, card: z.literal("last-card"), source: z.literal("remaining-draw-pile"), candidate }).strict(),
  z.object({ type: z.literal("hand-is-twenty-one"), target: actorSelector }).strict(),
  z.object({ type: z.literal("pending-bust-would-bust"), target: actorSelector }).strict(),
  z.object({ type: z.literal("status-card-rank-is"), target: actorSelector, statusDefinitionId: z.string().min(1), rank: z.enum(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) }).strict(),
  z.object({ type: z.literal("gun-bullets"), target: actorSelector, operator: compare, value: scalar }).strict(),
  z.object({ type: z.literal("gun-is-full"), target: actorSelector, expected: z.boolean() }).strict(),
  z.object({ type: z.literal("round-reason-is"), value: z.enum(["blackjack", "bust", "comparison", "push"]) }).strict(),
  z.object({ type: z.literal("round-penalty-target-is"), target: actorSelector }).strict(),
  z.object({ type: z.literal("event-ability-kind-is"), kind: z.enum(["player-skill", "ai-skill", "talent"]) }).strict(),
  z.object({ type: z.literal("status-present"), target: actorSelector, statusDefinitionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("any"), conditions: z.array(condition) }).strict(),
  z.object({ type: z.literal("not"), condition }).strict()
]));
const effect = z.union([
  z.object({ type: z.literal("add-skill-draws"), target: actorSelector, amount: scalar }).strict(),
  z.object({ type: z.literal("publish-action-advice"), target: actorSelector, policy: z.literal("current-optimal-hit-stand") }).strict(),
  z.object({ type: z.literal("replace-hand-card"), target: actorSelector, card: z.literal("last-card"), source: z.literal("remaining-draw-pile"), candidate, pick: z.literal("uniform-ability-rng") }).strict(),
  z.object({ type: z.literal("swap-last-hand-card-with-draw-pile-top"), target: actorSelector }).strict(),
  z.object({ type: z.literal("reveal-hand-card-suit"), target: actorSelector, card: z.literal("first-private-card"), viewer: actorSelector }).strict(),
  z.object({ type: z.literal("split-last-card-into-derived"), target: actorSelector }).strict(),
  z.object({ type: z.literal("add-status"), target: actorSelector, statusDefinitionId: z.string().min(1), parameters: z.record(z.union([z.string(), z.number().finite(), z.boolean()])).optional() }).strict(),
  z.object({ type: z.literal("set-status-stacks"), target: actorSelector, statusDefinitionId: z.string().min(1), amount: scalar }).strict(),
  z.object({ type: z.literal("remove-status"), target: actorSelector, statusDefinitionId: z.string().min(1), amount: scalar.optional() }).strict(),
  z.object({ type: z.literal("replace-pending-draw"), target: actorSelector, policy: z.object({ type: z.literal("exact-resulting-total"), total: scalar, fallback: z.literal("create-derived-card") }).strict() }).strict(),
  z.object({ type: z.literal("remember-last-card"), target: actorSelector, cardTarget: actorSelector, statusDefinitionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("replace-bust-hand-card-with-memory-card"), target: actorSelector, statusDefinitionId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("add-derived-card-for-exact-total"), target: actorSelector, total: scalar }).strict(),
  z.object({ type: z.literal("add-to-pending-bust-limit"), target: actorSelector, amount: scalar }).strict(),
  z.object({ type: z.literal("add-to-pending-trigger-misfire-chance"), target: actorSelector, amount: scalar }).strict(),
  z.object({ type: z.literal("add-to-pending-load"), target: actorSelector, amount: scalar }).strict(),
  z.object({ type: z.literal("multiply-pending-load"), target: actorSelector, factor: scalar }).strict(),
  z.object({ type: z.literal("add-to-pending-comparison-score"), target: actorSelector, amount: scalar }).strict(),
  z.object({ type: z.literal("cancel-pending-trigger"), target: actorSelector }).strict()
]);
const limit = z.object({ perEvent: z.number().int().positive().optional(), perTurn: z.number().int().positive().optional(), perRound: z.number().int().positive().optional(), perMatch: z.number().int().positive().optional() }).strict();
export const AbilityRuleSchema = z.object({ id: z.string().min(1), trigger, priority: z.number().int().optional(), notify: z.boolean().optional(), triggerNotice: z.string().min(1).optional(), conditions: z.array(condition).optional(), effects: z.array(effect).min(1), limit: limit.optional() }).strict();
const parameterSpec = z.union([
  z.object({ type: z.literal("number"), minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), default: z.number().finite().optional() }).strict().superRefine((value, ctx) => { if (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "minimum cannot exceed maximum" }); if (value.default !== undefined && ((value.minimum !== undefined && value.default < value.minimum) || (value.maximum !== undefined && value.default > value.maximum))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "default is outside parameter range" }); }),
  z.object({ type: z.literal("boolean"), default: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("enum"), values: z.array(z.string().min(1)).min(1), default: z.string().optional() }).strict().superRefine((value, ctx) => { if (value.default !== undefined && !value.values.includes(value.default)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "enum default must be one of values" }); })
]);
const activation = z.union([
  z.object({ type: z.literal("action"), windows: z.array(z.enum(["owner-turn", "owner-roulette-reaction"])).min(1), consume: z.enum(["card", "none"]), availability: z.array(condition).optional() }).strict(),
  z.object({ type: z.literal("automatic") }).strict(), z.object({ type: z.literal("passive") }).strict()
]);
const abilityTtl = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rounds"), amount: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("triggers"), amount: z.number().int().positive() }).strict()
]);
const primaryDomain = z.enum(["blackjack", "roulette", "information", "skill-economy", "rule-control"]);
const tags = z.array(z.string().min(1)).min(1).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ability tags must be unique" });
});
const skillDrawWeightModifier = z.object({ tag: z.string().min(1), factor: z.number().finite().nonnegative() }).strict();
const definitionBase = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().min(1), description: z.string().min(1),
  usage: z.string().min(1).optional(), triggerNotice: z.string().min(1).optional(), profileLore: z.string().min(1).optional(), hidden: z.boolean().default(false),
  primaryDomain, tags, parameters: z.record(parameterSpec).optional(), activation, ttl: abilityTtl.optional(), rules: z.array(AbilityRuleSchema),
  skillDrawWeightModifiers: z.array(skillDrawWeightModifier).optional()
});
const playerSkillDefinition = definitionBase.extend({
  sourceKind: z.literal("player-skill"), drop: z.object({ enabled: z.boolean(), baseWeight: z.number().finite().positive() }).strict(), stackable: z.boolean().default(false),
  unlock: z.object({ opponentId: z.string().min(1), label: z.string().min(1) }).strict().optional()
}).strict();
const aiSkillDefinition = definitionBase.extend({ sourceKind: z.literal("ai-skill") }).strict();
const talentDefinition = definitionBase.extend({ sourceKind: z.literal("talent") }).strict();
export const AbilityDefinitionSchema = z.discriminatedUnion("sourceKind", [playerSkillDefinition, aiSkillDefinition, talentDefinition]).superRefine((definition, ctx) => {
  if (definition.sourceKind === "talent" && definition.ttl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ttl"], message: "Talents cannot expire inside a match" });
  if (definition.activation.type === "action" && definition.ttl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ttl"], message: "Active abilities are consumed explicitly and cannot declare TTL" });
  if (definition.sourceKind !== "talent" && definition.activation.type === "passive" && !definition.ttl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ttl"], message: "Passive skills must declare TTL" });
  if (definition.activation.type !== "action") return;
  if (definition.sourceKind === "player-skill" && definition.activation.consume !== "card") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["activation", "consume"], message: "player-skill actions must consume a card" });
  if (definition.sourceKind !== "player-skill" && definition.activation.consume !== "none") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["activation", "consume"], message: `${definition.sourceKind} actions cannot consume a player card` });
});
export const StatusDefinitionSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), rules: z.array(AbilityRuleSchema), defaultDuration: z.enum(["turn", "round", "match", "until-owner-action", "until-consumed"]), blocksAbilityTags: z.array(z.string().min(1)).optional() }).strict();
export const AbilityBindingSchema = z.object({ definitionId: z.string().min(1), enabled: z.boolean(), parameters: z.record(z.union([z.string(), z.number().finite(), z.boolean()])) }).strict();

export type AbilityDefinitionInput = z.infer<typeof AbilityDefinitionSchema>;
export type StatusDefinitionInput = z.infer<typeof StatusDefinitionSchema>;

export function validateBinding(binding: unknown, definition: AbilityDefinition | AbilityDefinitionInput): AbilityBinding {
  const parsed = AbilityBindingSchema.parse(binding) as AbilityBinding;
  const specs = definition.parameters ?? {};
  for (const key of Object.keys(parsed.parameters)) if (!Object.hasOwn(specs, key)) throw new Error(`Unknown parameter ${key} for ability ${definition.id}`);
  for (const [key, spec] of Object.entries(specs)) {
    const value = parsed.parameters[key];
    if (value === undefined) { if (spec.default === undefined) throw new Error(`Missing parameter ${key} for ability ${definition.id}`); continue; }
    if (spec.type === "number" && (typeof value !== "number" || (spec.minimum !== undefined && value < spec.minimum) || (spec.maximum !== undefined && value > spec.maximum))) throw new Error(`Invalid parameter ${key} for ability ${definition.id}`);
    if (spec.type === "boolean" && typeof value !== "boolean") throw new Error(`Invalid parameter ${key} for ability ${definition.id}`);
    if (spec.type === "enum" && (typeof value !== "string" || !spec.values.includes(value))) throw new Error(`Invalid parameter ${key} for ability ${definition.id}`);
  }
  const parameters: Record<string, string | number | boolean> = { ...parsed.parameters };
  for (const [key, spec] of Object.entries(specs)) if (parameters[key] === undefined && spec.default !== undefined) parameters[key] = spec.default;
  return { ...parsed, parameters };
}
