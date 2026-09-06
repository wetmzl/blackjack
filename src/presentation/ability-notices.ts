import { getAbilityDefinition } from "../core/abilities/registry";
import type { MatchState, GameEvent } from "../core/match/types";
import type { AbilityRule, Effect } from "../core/abilities/types";

export type AbilityNoticeTone = "player" | "ai";

export interface AbilityNotice {
  readonly owner: "player" | "opponent";
  readonly tone: AbilityNoticeTone;
  readonly text: string;
}

function actorName(owner: "player" | "opponent", opponentName: string): string {
  return owner === "player" ? "策展人" : opponentName;
}

function suitLabel(suit: "hearts" | "diamonds" | "clubs" | "spades"): string {
  if (suit === "hearts") return "红桃";
  if (suit === "diamonds") return "方块";
  if (suit === "clubs") return "梅花";
  return "黑桃";
}

function effectResultNotice(
  effect: Effect,
  event: Extract<GameEvent, { type: "ABILITY_TRIGGERED" }>,
  events: readonly GameEvent[],
  after?: MatchState
): string | null {
  if (effect.type === "add-to-pending-trigger-misfire-chance") {
    const trigger = [...events].reverse().find((candidate): candidate is Extract<GameEvent, { type: "TRIGGER_PULLED" }> => candidate.type === "TRIGGER_PULLED" && candidate.actor === event.owner);
    if (trigger) return `本轮哑火概率为${Math.round(trigger.misfireChance * 100)}%`;
  }
  if (effect.type === "publish-action-advice" && after?.playerSkills.advice) {
    return `建议${after.playerSkills.advice === "hit" ? " Hit 要牌" : " Stand 停牌"}`;
  }
  if (effect.type === "reveal-hand-card-suit") {
    const revealed = events.find((candidate): candidate is Extract<GameEvent, { type: "CARD_SUIT_REVEALED" }> => candidate.type === "CARD_SUIT_REVEALED" && candidate.viewer === event.owner);
    if (revealed) return `对手暗牌花色为${suitLabel(revealed.suit)}`;
  }
  if (effect.type === "cancel-pending-trigger") return "本次免于扣扳机";
  if (effect.type === "add-to-pending-bust-limit" && after) {
    const bust = [...events].reverse().find((candidate): candidate is Extract<GameEvent, { type: "BUST" }> => candidate.type === "BUST");
    const hit = [...events].reverse().find((candidate): candidate is Extract<GameEvent, { type: "PLAYER_HIT" | "OPPONENT_HIT" }> => candidate.type === "PLAYER_HIT" || candidate.type === "OPPONENT_HIT");
    const actor = bust?.actor ?? (hit?.type === "PLAYER_HIT" ? "player" : hit?.type === "OPPONENT_HIT" ? "opponent" : undefined);
    if (actor) {
      const limit = after[actor].bustLimit;
      if (limit !== undefined) return `本轮爆牌上限为${limit}点`;
    }
  }
  if (effect.type === "set-status-stacks" && after) {
    const status = after.abilities.statuses.find((candidate) => candidate.owner === event.owner && candidate.statusDefinitionId === effect.statusDefinitionId);
    if (status) return `当前值为${status.stacks}`;
  }
  return null;
}

function ruleNotice(
  event: Extract<GameEvent, { type: "ABILITY_TRIGGERED" }>,
  rule: AbilityRule | undefined,
  definition: NonNullable<ReturnType<typeof getAbilityDefinition>>,
  events: readonly GameEvent[],
  after?: MatchState
): string {
  if (events.some((candidate) => candidate.type === "PENDING_EVENT_CANCELLED" && candidate.sourceInstanceId === event.instanceId)) return "本次免于扣扳机";
  const dynamic = rule?.effects
    .map((effect) => effectResultNotice(effect, event, events, after))
    .find((notice): notice is string => Boolean(notice));
  const fallback = dynamic ?? rule?.triggerNotice ?? definition.triggerNotice ?? definition.description;
  return fallback.trim().replace(/^技能(?:效果)?[：:]\s*/, "");
}

/** Present each visible ability trigger independently; talents are not table toasts. */
export function abilityTriggerNotice(events: readonly GameEvent[], opponentName: string, after?: MatchState): AbilityNotice[] {
  const notices: AbilityNotice[] = [];
  for (const event of events) {
    if (event.type !== "ABILITY_TRIGGERED") continue;
    const definition = getAbilityDefinition(event.definitionId);
    if (!definition || (definition.sourceKind !== "player-skill" && definition.sourceKind !== "ai-skill")) continue;
    const rule = definition.rules.find((candidate) => candidate.id === event.ruleId);
    if (rule?.notify === false) continue;
    const name = actorName(event.owner, opponentName);
    notices.push({
      owner: event.owner,
      tone: event.owner === "player" ? "player" : "ai",
      text: `${name}发动「${definition.name}」：${ruleNotice(event, rule, definition, events, after)}`
    });
  }
  return notices;
}
