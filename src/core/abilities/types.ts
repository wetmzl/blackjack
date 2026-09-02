import type { Card, CardOrigin, Hand, Rank, ShoeState } from "../blackjack/types";
import type { GunState } from "../roulette/types";
import type { RngSnapshot } from "../rng/seeded";

export type AbilityActor = "player" | "opponent";
export type AbilitySourceKind = "player-skill" | "character-mechanic";
export type AbilityDefinitionSourceKind = AbilitySourceKind | "shared";
export type AbilityTrigger =
  | "on-match-created" | "on-ability-played" | "before-card-draw" | "after-card-draw"
  | "after-hand-changed" | "after-stand" | "before-bust-check" | "before-round-resolution" | "before-bullet-load" | "after-bullet-load"
  | "before-trigger-pull" | "after-trigger-result" | "on-round-end";
  /** Emitted after an active ability card has completed successfully. */
export type AbilityBroadcastTrigger = AbilityTrigger | "after-ability-played";
export type ActionWindow = "owner-turn" | "owner-roulette-reaction";
export type StatusDuration = "turn" | "round" | "match" | "until-owner-action" | "until-consumed";
export type Compare = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
export type ScalarValue = number | NumberValue;
export type NumberValue =
  | { readonly type: "constant"; readonly value: number }
  | { readonly type: "parameter"; readonly key: string }
  | { readonly type: "gun-bullets"; readonly target: ActorSelector }
  | { readonly type: "hand-total"; readonly target: ActorSelector }
  | { readonly type: "hand-card-count"; readonly target: ActorSelector }
  | { readonly type: "round-hit-count"; readonly target: ActorSelector }
  | { readonly type: "add" | "subtract" | "multiply"; readonly left: ScalarValue; readonly right: ScalarValue };
export type ActorSelector = "owner" | "rival" | "event-actor" | "penalty-target";
export type CardSelector = "last-card" | "first-private-card";
export type CardSource = "remaining-draw-pile";
export type RandomPick = "uniform-ability-rng";
export type CardCandidate =
  | { readonly type: "resulting-hand-total-at-most"; readonly value: ScalarValue }
  | { readonly type: "resulting-hand-total-exactly"; readonly value: ScalarValue };
export type DrawReplacementPolicy = { readonly type: "exact-resulting-total"; readonly total: ScalarValue; readonly fallback: "create-derived-card" };

export type Condition =
  | { readonly type: "actor-is"; readonly actor: ActorSelector }
  | { readonly type: "owner-has-card"; readonly abilityId: string }
  | { readonly type: "hand-card-count"; readonly target: ActorSelector; readonly operator: Compare; readonly value: ScalarValue }
  | { readonly type: "hand-total"; readonly target: ActorSelector; readonly operator: Compare; readonly value: ScalarValue }
  | { readonly type: "round-hit-count"; readonly target: ActorSelector; readonly operator: Compare; readonly value: ScalarValue }
  | { readonly type: "hand-all-same-suit"; readonly target: ActorSelector }
  | { readonly type: "hand-all-color"; readonly target: ActorSelector; readonly color: "red" | "black" }
  | { readonly type: "hand-rank-has-suit-partner"; readonly target: ActorSelector; readonly rank: Rank }
  | { readonly type: "hand-card-origin-is"; readonly target: ActorSelector; readonly card: CardSelector; readonly origin: CardOrigin }
  | { readonly type: "card-candidate-exists"; readonly target: ActorSelector; readonly card: CardSelector; readonly source: CardSource; readonly candidate: CardCandidate }
  | { readonly type: "draw-pile-card-exists" }
  | { readonly type: "hand-last-card-splittable"; readonly target: ActorSelector }
  | { readonly type: "hand-is-twenty-one"; readonly target: ActorSelector }
  | { readonly type: "gun-bullets"; readonly target: ActorSelector; readonly operator: Compare; readonly value: ScalarValue }
  | { readonly type: "gun-is-full"; readonly target: ActorSelector; readonly expected: boolean }
  | { readonly type: "round-reason-is"; readonly value: "blackjack" | "bust" | "comparison" | "push" }
  | { readonly type: "round-penalty-target-is"; readonly target: ActorSelector }
  | { readonly type: "event-ability-kind-is"; readonly kind: AbilitySourceKind }
  | { readonly type: "status-present"; readonly target: ActorSelector; readonly statusDefinitionId: string }
  | { readonly type: "any"; readonly conditions: readonly Condition[] }
  | { readonly type: "not"; readonly condition: Condition };

export type Effect =
  | { readonly type: "draw-skill-cards"; readonly target: ActorSelector; readonly amount: ScalarValue }
  | { readonly type: "publish-action-advice"; readonly target: ActorSelector; readonly policy: "current-optimal-hit-stand" }
  | { readonly type: "replace-hand-card"; readonly target: ActorSelector; readonly card: CardSelector; readonly source: CardSource; readonly candidate: CardCandidate; readonly pick: RandomPick }
  | { readonly type: "swap-last-hand-card-with-draw-pile-top"; readonly target: ActorSelector }
  | { readonly type: "reveal-hand-card-suit"; readonly target: ActorSelector; readonly card: "first-private-card"; readonly viewer: ActorSelector }
  | { readonly type: "split-last-card-into-derived"; readonly target: ActorSelector }
  | { readonly type: "add-status"; readonly target: ActorSelector; readonly statusDefinitionId: string; readonly parameters?: Readonly<Record<string, string | number | boolean>> }
  | { readonly type: "remove-status"; readonly target: ActorSelector; readonly statusDefinitionId: string; readonly amount?: ScalarValue }
  | { readonly type: "replace-pending-draw"; readonly target: ActorSelector; readonly policy: DrawReplacementPolicy }
  | { readonly type: "add-derived-card-for-exact-total"; readonly target: ActorSelector; readonly total: ScalarValue }
  | { readonly type: "add-to-pending-bust-limit"; readonly target: ActorSelector; readonly amount: ScalarValue }
  | { readonly type: "add-to-pending-trigger-misfire-chance"; readonly target: ActorSelector; readonly amount: ScalarValue }
  | { readonly type: "add-to-pending-load"; readonly target: ActorSelector; readonly amount: ScalarValue }
  | { readonly type: "multiply-pending-load"; readonly target: ActorSelector; readonly factor: ScalarValue }
  | { readonly type: "cancel-pending-trigger"; readonly target: ActorSelector };

export interface AbilityParameterSpec { readonly type: "number" | "boolean" | "enum"; readonly minimum?: number; readonly maximum?: number; readonly values?: readonly string[]; readonly default?: number | boolean | string; }
export interface AbilityBinding { readonly definitionId: string; readonly enabled: boolean; readonly parameters: Readonly<Record<string, string | number | boolean>>; }
export interface AbilitySource { readonly kind: AbilitySourceKind; readonly definitionId: string; readonly owner: AbilityActor; readonly instanceId: string; }
export interface SkillCardInstance extends AbilitySource { readonly kind: "player-skill"; }
export interface AbilityInstance extends AbilitySource { readonly createdAtSequence: number; readonly parameters: Readonly<Record<string, string | number | boolean>>; }
export interface RuleLimit { readonly perEvent?: number; readonly perTurn?: number; readonly perRound?: number; readonly perMatch?: number; }
export interface AbilityRule { readonly id: string; readonly trigger: AbilityBroadcastTrigger; readonly priority?: number; readonly conditions?: readonly Condition[]; readonly effects: readonly Effect[]; readonly limit?: RuleLimit; }
export type AbilityActivation =
  | { readonly type: "action"; readonly windows: readonly ActionWindow[]; readonly consume: "card" | "none"; readonly availability?: readonly Condition[] }
  | { readonly type: "automatic" } | { readonly type: "passive" };
export interface AbilityDefinition { readonly id: string; readonly name: string; readonly description: string; readonly usage?: string; readonly triggerNotice?: string; readonly profileLore?: string; readonly hidden?: boolean; readonly sourceKind: AbilityDefinitionSourceKind; readonly parameters?: Readonly<Record<string, AbilityParameterSpec>>; readonly activation: AbilityActivation; readonly rules: readonly AbilityRule[]; readonly tags: readonly string[]; readonly unlock?: { readonly opponentId: string; readonly label: string }; }
export interface StatusDefinition { readonly id: string; readonly rules: readonly AbilityRule[]; readonly defaultDuration: StatusDuration; readonly blocksAbilityTags?: readonly string[]; }
export interface AbilityStatus { readonly statusDefinitionId: string; readonly owner: AbilityActor; readonly sourceInstanceId: string; readonly stacks: number; readonly duration: StatusDuration; readonly parameters: Readonly<Record<string, string | number | boolean>>; readonly createdAtSequence: number; }
export interface AbilityRuntimeState { readonly instances: readonly AbilityInstance[]; readonly statuses: readonly AbilityStatus[]; readonly counters: Readonly<Record<string, number>>; readonly sequence: number; readonly catalogVersion: string; readonly rng: RngSnapshot; }

export interface PendingDraw { readonly id: string; readonly actor: AbilityActor; readonly card?: Card; readonly replacement?: Card; readonly cancelled?: boolean; }
export interface PendingLoad { readonly id: string; readonly actor: AbilityActor; readonly amount: number; readonly reason: "blackjack" | "bust" | "comparison" | "push"; }
export interface PendingBustCheck { readonly id: string; readonly actor: AbilityActor; readonly limit: number; }
export interface PendingTrigger { readonly id: string; readonly actor: AbilityActor; readonly misfireChance?: number; readonly cancelled?: boolean; readonly cancelSourceInstanceId?: string; }
export interface AbilityEventContext { readonly trigger: AbilityTrigger | "after-ability-played"; readonly sourceEventId: string; readonly eventActor?: AbilityActor; readonly playedAbilityKind?: AbilitySourceKind; readonly roundHitCounts?: Readonly<Record<AbilityActor, number>>; readonly roundOutcome?: { readonly reason: "blackjack" | "bust" | "comparison" | "push"; readonly penaltyTarget: AbilityActor | null }; readonly pendingDraw?: PendingDraw; readonly pendingLoad?: PendingLoad; readonly pendingBust?: PendingBustCheck; readonly pendingTrigger?: PendingTrigger; }

export interface AbilityWorld { readonly hands: Readonly<Record<AbilityActor, Hand>>; readonly guns: Readonly<Record<AbilityActor, GunState>>; readonly shoe: ShoeState; readonly cards: readonly SkillCardInstance[]; readonly statuses: readonly AbilityStatus[]; readonly advice?: "hit" | "stand" | null; }
export interface AbilityEffectResult { readonly world: AbilityWorld; readonly pendingDraw?: PendingDraw; readonly pendingLoad?: PendingLoad; readonly pendingBust?: PendingBustCheck; readonly pendingTrigger?: PendingTrigger; readonly runtime: AbilityRuntimeState; readonly events: readonly AbilityDomainEvent[]; }
export type AbilityDomainEvent =
  | { readonly type: "ABILITY_PLAYED"; readonly instanceId: string; readonly definitionId: string; readonly owner: AbilityActor }
  | { readonly type: "ABILITY_TRIGGERED"; readonly instanceId: string; readonly definitionId: string; readonly ruleId: string; readonly owner: AbilityActor }
  | { readonly type: "ABILITY_RESOLUTION_FAILED"; readonly instanceId: string; readonly definitionId: string; readonly ruleId: string; readonly reason: string }
  | { readonly type: "STATUS_ADDED"; readonly statusDefinitionId: string; readonly owner: AbilityActor; readonly sourceInstanceId: string }
  | { readonly type: "STATUS_REMOVED"; readonly statusDefinitionId: string; readonly owner: AbilityActor; readonly reason: "consumed" | "expired" | "dispelled" }
  | { readonly type: "PENDING_EVENT_MODIFIED"; readonly eventId: string; readonly effectType: string; readonly sourceInstanceId: string }
  | { readonly type: "PENDING_EVENT_CANCELLED"; readonly eventId: string; readonly sourceInstanceId: string }
  | { readonly type: "CARD_SUIT_REVEALED"; readonly viewer: AbilityActor; readonly target: AbilityActor; readonly cardIndex: number; readonly suit: Card["suit"] };
export type AbilityEvent = AbilityDomainEvent;
