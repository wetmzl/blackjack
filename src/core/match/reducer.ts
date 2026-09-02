import { addCard, createHand, handValue, isBlackjack, isBust, isTwentyOne } from "../blackjack/hand";
import { dealInitialHands, drawCard, reshuffleIfLow, createShoe } from "../blackjack/shoe";
import type { Card } from "../blackjack/types";
import { deriveRng, SeededRng } from "../rng/seeded";
import { addBullets, createGun, pullTrigger } from "../roulette/roulette";
import { INITIAL_SKILL_IDS, getSkillDefinition, isActiveSkill } from "../skills/definitions";
import { drawRandomSkill, validateLoadout } from "../skills/skills";
import { decideAiAction } from "../ai/policy";
import { buildObservation } from "../ai/observation";
import { decideOptimalAction } from "../ai/policy";
import { getRoundStarter } from "../blackjack/round";
import { createAbilityRuntime, addAbilityInstance, clearCounters, clearEventCounters, expireStatuses, garbageCollectAbilityInstances } from "../abilities/runtime";
import { getAbilityDefinition, instantiateAbility, validateAbilityBinding } from "../abilities/registry";
import { canPlayAbility, playAbility, resolveAbilityEvent, AbilityResolutionError } from "../abilities/engine";
import type { AbilityBinding, AbilityEventContext, AbilityInstance, AbilityWorld, PendingDraw, PendingLoad, PendingTrigger, SkillCardInstance } from "../abilities/types";
import type { Action, Actor, GameEvent, MatchOutcome, MatchState, ParticipantState, RoundOutcome, RoundPhase, RoundState } from "./types";
import { RECKLESS_B_PROFILE, type AiProfile } from "../ai/types";

export interface CreateMatchOptions { readonly id?: string; readonly opponentId?: string; readonly aiProfile?: AiProfile; readonly equippedSkillIds?: readonly string[]; readonly opponentMechanics?: readonly AbilityBinding[]; readonly playerMechanics?: readonly AbilityBinding[]; }

function normalizeEquipped(ids: readonly string[] | undefined): string[] {
  const values = ids ? [...ids] : [...INITIAL_SKILL_IDS];
  const result = validateLoadout(values, values);
  if (!result.valid) throw new RangeError(`Invalid skill loadout: ${result.reason}`);
  return [...result.equippedSkillIds];
}
function skillState(state: MatchState, patch: Partial<MatchState["skills"]> = {}): MatchState["skills"] { return { ...state.skills, ...patch }; }
function participant(id: Actor, cards: readonly Card[]): ParticipantState { return { id, hand: createHand(cards), stood: false, busted: false }; }
function append(state: MatchState, ...events: readonly GameEvent[]): MatchState { return events.length === 0 ? state : { ...state, history: [...state.history, ...events] }; }
function makeRound(index: number, shoe: MatchState["shoe"], deckRng: SeededRng) {
  const deal = dealInitialHands(reshuffleIfLow(shoe, deckRng, 12));
  return { player: participant("player", deal.player), opponent: participant("opponent", deal.opponent), shoe: deal.shoe, starter: getRoundStarter(index), deckRng, events: [
    { type: "ROUND_STARTED", roundIndex: index }, { type: "CARD_DEALT", actor: "player", card: deal.player[0], private: false }, { type: "CARD_DEALT", actor: "opponent", card: deal.opponent[0], private: false }, { type: "CARD_DEALT", actor: "player", card: deal.player[1], private: true }, { type: "CARD_DEALT", actor: "opponent", card: deal.opponent[1], private: true }
  ] as const };
}
function withRound(state: MatchState, round: RoundState, extra: Partial<MatchState> = {}): MatchState { return { ...state, ...extra, player: round.player, opponent: round.opponent, round, roundIndex: round.index }; }
function expireLifecycle(state: MatchState, duration: "turn" | "round" | "match"): MatchState {
  const before = state.abilities.statuses;
  const runtime = garbageCollectAbilityInstances(expireStatuses(clearCounters(state.abilities, duration), duration), state.skills.cards);
  const expired = before.filter((status) => !runtime.statuses.includes(status)).map((status) => ({ type: "STATUS_REMOVED" as const, statusDefinitionId: status.statusDefinitionId, owner: status.owner, reason: "expired" as const }));
  return append({ ...state, abilities: runtime }, ...expired);
}
function expireAllStatuses(state: MatchState): MatchState {
  const runtimeWithNoCounters = (["event", "turn", "round", "match"] as const)
    .reduce((runtime, scope) => clearCounters(runtime, scope), state.abilities);
  const runtime = garbageCollectAbilityInstances({ ...runtimeWithNoCounters, statuses: [] }, state.skills.cards);
  const expired = state.abilities.statuses.map((status) => ({ type: "STATUS_REMOVED" as const, statusDefinitionId: status.statusDefinitionId, owner: status.owner, reason: "expired" as const }));
  return append({ ...state, abilities: runtime }, ...expired);
}
function setPhase(state: MatchState, phase: RoundPhase, currentActor: Actor | null): MatchState {
  const changedTurn = state.round.phase === "turns" && phase === "turns" && currentActor !== state.round.currentActor;
  const lifecycle = changedTurn ? expireLifecycle(state, "turn") : state;
  return withRound({ ...lifecycle, abilities: garbageCollectAbilityInstances(lifecycle.abilities, lifecycle.skills.cards) }, { ...lifecycle.round, phase, currentActor });
}

export function abilityWorld(state: MatchState): AbilityWorld { return { hands: { player: state.player.hand, opponent: state.opponent.hand }, guns: state.roulette, shoe: state.shoe, cards: state.skills.cards, statuses: state.abilities.statuses, advice: state.skills.advice }; }
export function commitAbilityWorld(state: MatchState, world: AbilityWorld): MatchState {
  return { ...state, player: { ...state.player, hand: world.hands.player }, opponent: { ...state.opponent, hand: world.hands.opponent }, shoe: world.shoe, roulette: world.guns, skills: skillState(state, { cards: [...world.cards], advice: world.advice ?? null }), abilities: { ...state.abilities, statuses: [...world.statuses] } };
}

function changedHandActors(before: AbilityWorld, after: AbilityWorld): Actor[] {
  return (["player", "opponent"] as const).filter((actor) => before.hands[actor].cards !== after.hands[actor].cards);
}

function broadcastHandChanges(state: MatchState, actors: readonly Actor[], sourceEventId: string): MatchState {
  return actors.reduce((next, actor) => runAbilityEvent(next, { trigger: "after-hand-changed", sourceEventId: `${sourceEventId}:${actor}`, eventActor: actor }, {}).state, state);
}

function drawSkillCards(state: MatchState, owner: Actor, amount: number, world: AbilityWorld, rng: SeededRng): readonly SkillCardInstance[] {
  if (owner !== "player") return [];
  const pool = state.skills.equippedSkillIds.filter(isActiveSkill);
  const result: SkillCardInstance[] = [];
  const used = new Set([...state.abilities.instances.map((instance) => instance.instanceId), ...world.cards.map((card) => card.instanceId)]);
  let serial = state.abilities.sequence;
  for (let index = 0; index < amount; index += 1) {
    const drawn = drawRandomSkill(rng, pool);
    let instanceId = `ability-card-${++serial}`;
    while (used.has(instanceId)) instanceId = `ability-card-${++serial}`;
    used.add(instanceId);
    result.push({ kind: "player-skill", definitionId: drawn.skill.id, owner: "player", instanceId });
  }
  return result;
}
function abilityServices(state: MatchState) {
  return {
    drawSkillCards: (owner: Actor, amount: number, world: AbilityWorld, rng: SeededRng) => drawSkillCards(state, owner, amount, world, rng),
    publishAdvice: (owner: Actor) => owner === "player" ? decideOptimalAction(buildObservation(state, "player")) : "stand" as const
  };
}
function runAbilityEvent(state: MatchState, event: AbilityEventContext, pending: { draw?: PendingDraw; load?: PendingLoad; trigger?: PendingTrigger } = {}, directInstanceId?: string): { readonly state: MatchState; readonly pendingDraw?: PendingDraw; readonly pendingLoad?: PendingLoad; readonly pendingTrigger?: PendingTrigger; readonly failed: boolean } {
  try {
    const result = resolveAbilityEvent({ world: abilityWorld(state), runtime: state.abilities, event, pendingDraw: pending.draw, pendingLoad: pending.load, pendingTrigger: pending.trigger, directInstanceId, ...abilityServices(state) });
    let next = commitAbilityWorld(state, result.world);
    const cards = result.world.cards.filter((card) => !state.skills.cards.some((old) => old.instanceId === card.instanceId));
    const firstSequence = Math.max(state.abilities.sequence, result.runtime.sequence);
    const instances: AbilityInstance[] = cards.map((card, index) => ({ ...card, createdAtSequence: firstSequence + index + 1, parameters: {} }));
    next = { ...next, abilities: { ...next.abilities, ...result.runtime, instances: [...result.runtime.instances, ...instances], sequence: Math.max(result.runtime.sequence, firstSequence + instances.length) } };
    next = { ...next, abilities: clearEventCounters(next.abilities, event.sourceEventId) };
    next = { ...next, abilities: garbageCollectAbilityInstances(next.abilities, next.skills.cards) };
    return { state: append(next, ...result.events as GameEvent[], ...cards.map((card) => ({ type: "SKILL_GAINED" as const, skillId: card.definitionId }))), pendingDraw: result.pendingDraw, pendingLoad: result.pendingLoad, pendingTrigger: result.pendingTrigger, failed: false };
  } catch (error) {
    // A failed ability event is atomic. The caller may continue with the
    // unmodified pending event so the base game action remains safe.
    if (error instanceof AbilityResolutionError && error.instanceId && error.definitionId) return { state: append(state, { type: "ABILITY_RESOLUTION_FAILED", instanceId: error.instanceId, definitionId: error.definitionId, ruleId: error.ruleId ?? "ability-resolution", reason: error.message }), ...pending, failed: true };
    throw error;
  }
}

function gainSkills(state: MatchState, amount: number): MatchState {
  const active = state.skills.equippedSkillIds.filter(isActiveSkill);
  if (active.length === 0 || amount <= 0) return state;
  const rng = SeededRng.fromSnapshot(state.rng.loot);
  const result = drawSkillCards(state, "player", amount, abilityWorld(state), rng);
  const firstSequence = state.abilities.sequence;
  const instances = result.map((card, index) => ({ ...card, createdAtSequence: firstSequence + index + 1, parameters: {} }));
  return append({ ...state, skills: skillState(state, { cards: [...state.skills.cards, ...result] }), abilities: { ...state.abilities, instances: [...state.abilities.instances, ...instances], sequence: firstSequence + instances.length }, rng: { ...state.rng, loot: rng.snapshot() } }, ...result.map((card) => ({ type: "SKILL_GAINED" as const, skillId: card.definitionId })));
}

function resolveComparison(state: MatchState): MatchState { const p = handValue(state.player.hand); const o = handValue(state.opponent.hand); const winner: Actor | null = p === o ? null : p > o ? "player" : "opponent"; return resolveRound(state, { winner, reason: winner === null ? "push" : "comparison", penaltyTarget: winner === null ? null : winner === "player" ? "opponent" : "player", bulletsAdded: winner === "player" ? 1 : winner === "opponent" ? 1 : 0, playerSkillReward: winner === "player" ? 1 : 0 }); }

export function resolveRound(state: MatchState, outcome: RoundOutcome): MatchState {
  let next = runAbilityEvent(state, { trigger: "before-round-resolution", sourceEventId: `round-resolution:${state.roundIndex}:${state.history.length}`, eventActor: outcome.winner ?? undefined, roundOutcome: outcome }, {}).state;
  if (!outcome.penaltyTarget) {
    next = append(withRound(next, { ...next.round, phase: "round-reveal", currentActor: null, outcome }), { type: "ROUND_RESOLVED", outcome });
    return next;
  }
  const pendingLoad: PendingLoad = { id: `load:${state.roundIndex}:${state.history.length}`, actor: outcome.penaltyTarget, amount: outcome.bulletsAdded, reason: outcome.reason };
  const loaded = runAbilityEvent(next, { trigger: "before-bullet-load", sourceEventId: pendingLoad.id, eventActor: outcome.penaltyTarget, roundOutcome: outcome }, { load: pendingLoad });
  const finalPending = loaded.pendingLoad ?? pendingLoad;
  const gun = addBullets(loaded.state.roulette[finalPending.actor], finalPending.amount);
  next = commitAbilityWorld(loaded.state, { ...abilityWorld(loaded.state), guns: { ...loaded.state.roulette, [finalPending.actor]: gun } });
  next = append(next, { type: "ROUND_RESOLVED", outcome: { ...outcome, bulletsAdded: finalPending.amount } }, { type: "BULLET_ADDED", actor: finalPending.actor, amount: finalPending.amount });
  const afterLoad = runAbilityEvent(next, { trigger: "after-bullet-load", sourceEventId: `after:${finalPending.id}`, eventActor: finalPending.actor, roundOutcome: outcome }, {}).state;
  if (outcome.playerSkillReward > 0) return gainSkills(withRound(afterLoad, { ...afterLoad.round, phase: "round-reveal", currentActor: null, outcome: { ...outcome, bulletsAdded: finalPending.amount } }), outcome.playerSkillReward);
  return withRound(afterLoad, { ...afterLoad.round, phase: "round-reveal", currentActor: null, outcome: { ...outcome, bulletsAdded: finalPending.amount } });
}

function resolveBust(state: MatchState, actor: Actor): MatchState { const winner: Actor = actor === "player" ? "opponent" : "player"; return resolveRound(state, { winner, reason: "bust", penaltyTarget: actor, bulletsAdded: 1, playerSkillReward: winner === "player" ? 1 : 0 }); }

function drawFor(state: MatchState, actor: Actor): MatchState {
  const base = drawCard(state.shoe);
  const pending: PendingDraw = { id: `draw:${state.roundIndex}:${state.history.length}`, actor, card: base.card };
  const prepared = runAbilityEvent({ ...state, skills: actor === "player" ? skillState(state, { advice: null }) : state.skills }, { trigger: "before-card-draw", sourceEventId: pending.id, eventActor: actor }, { draw: pending });
  const replacement = prepared.pendingDraw?.replacement;
  const card = replacement ?? base.card;
  const shoe = replacement ? prepared.state.shoe : base.shoe;
  let next = commitAbilityWorld(prepared.state, { ...abilityWorld(prepared.state), shoe });
  const current = next[actor];
  const updated = { ...current, hand: addCard(current.hand, card) };
  next = withRound(next, { ...next.round, [actor]: updated } as RoundState);
  next = append(next, { type: actor === "player" ? "PLAYER_HIT" : "OPPONENT_HIT", value: handValue(updated.hand) }, { type: "CARD_DEALT", actor, card, private: true });
  const beforeAfterDraw = abilityWorld(next);
  const afterDraw = runAbilityEvent(next, { trigger: "after-card-draw", sourceEventId: `after:${pending.id}`, eventActor: actor }, {}).state;
  const changedActors = [...new Set<Actor>([actor, ...changedHandActors(beforeAfterDraw, abilityWorld(afterDraw))])];
  let changed = normalizeAbilityHands(broadcastHandChanges(afterDraw, changedActors, `hand:${pending.id}`));
  if (changed.round.phase !== "turns") return changed;
  if (changed[actor].stood) return setPhase(changed, "turns", actor === "player" ? "opponent" : "player");
  const other = actor === "player" ? "opponent" : "player";
  return setPhase(changed, "turns", changed[other].stood ? actor : other);
}

function standFor(state: MatchState, actor: Actor): MatchState { const next = append(withRound({ ...state, skills: actor === "player" ? skillState(state, { advice: null }) : state.skills }, { ...state.round, [actor]: { ...state[actor], stood: true } } as RoundState), { type: actor === "player" ? "PLAYER_STOOD" : "OPPONENT_STOOD" }); const other = actor === "player" ? "opponent" : "player"; return next[other].stood ? resolveComparison(next) : setPhase(next, "turns", other); }

function startNextRound(state: MatchState): MatchState {
  const index = state.roundIndex + 1; const deck = SeededRng.fromSnapshot(state.rng.deck); const nextRound = makeRound(index, state.shoe, deck);
  const round: RoundState = { index, phase: "initial-blackjack-check", starter: nextRound.starter, currentActor: null, player: nextRound.player, opponent: nextRound.opponent, outcome: null };
  let next = runAbilityEvent(state, { trigger: "on-round-end", sourceEventId: `round-end:${state.roundIndex}`, roundOutcome: state.round.outcome ?? undefined }, {}).state;
  const runtime = garbageCollectAbilityInstances(expireStatuses(clearCounters(next.abilities, "round"), "round"), next.skills.cards);
  const expired = next.abilities.statuses.filter((status) => !runtime.statuses.includes(status)).map((status) => ({ type: "STATUS_REMOVED" as const, statusDefinitionId: status.statusDefinitionId, owner: status.owner, reason: "expired" as const }));
  next = withRound({ ...next, shoe: nextRound.shoe, abilities: runtime, skills: skillState(next, { advice: null }), rng: { ...next.rng, deck: nextRound.deckRng.snapshot() } }, round);
  return resolveInitialBlackjack(append(next, ...expired, ...nextRound.events));
}
function resolveInitialBlackjack(state: MatchState): MatchState { const p = isBlackjack(state.player.hand); const o = isBlackjack(state.opponent.hand); let next = append(state, { type: "INITIAL_BLACKJACK_CHECK", player: p, opponent: o }); if (!p && !o) return setPhase(next, "turns", state.round.starter); if (p) next = append(next, { type: "BLACKJACK", actor: "player" }); if (o) next = append(next, { type: "BLACKJACK", actor: "opponent" }); if (p && o) return resolveRound(next, { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0, playerSkillReward: 0 }); const winner: Actor = p ? "player" : "opponent"; return resolveRound(next, { winner, reason: "blackjack", penaltyTarget: winner === "player" ? "opponent" : "player", bulletsAdded: 2, playerSkillReward: winner === "player" ? 2 : 0 }); }

function triggerFor(state: MatchState, actor: Actor): MatchState {
  const pending: PendingTrigger = { id: `trigger:${state.roundIndex}:${state.history.length}`, actor };
  const prepared = runAbilityEvent(state, { trigger: "before-trigger-pull", sourceEventId: pending.id, eventActor: actor, roundOutcome: state.round.outcome ?? undefined }, { trigger: pending });
  if (prepared.pendingTrigger?.cancelled) return startNextRound(prepared.state);
  const trigger = pullTrigger(prepared.state.roulette[actor], SeededRng.fromSnapshot(prepared.state.rng.roulette));
  let next = append(withRound({ ...prepared.state, rng: { ...prepared.state.rng, roulette: trigger.rng } }, { ...prepared.state.round, phase: "roulette-result", currentActor: null }), { type: "TRIGGER_PULLED", actor, probability: trigger.result.probability, fired: trigger.result.fired });
  next = runAbilityEvent(next, { trigger: "after-trigger-result", sourceEventId: `after:${pending.id}`, eventActor: actor, roundOutcome: state.round.outcome ?? undefined }, {}).state;
  if (!trigger.result.fired) return append(next, { type: "TRIGGER_SURVIVED", actor });
  const winner: Actor = actor === "player" ? "opponent" : "player"; const reason = actor === "player" ? "player-killed" : "opponent-killed"; const outcome: MatchOutcome = { winner, reason };
  next = runAbilityEvent(next, { trigger: "on-round-end", sourceEventId: `round-end:${state.roundIndex}:match-finished`, roundOutcome: state.round.outcome ?? undefined }, {}).state;
  next = expireAllStatuses(next);
  return append({ ...next, status: "finished", view: "table", scene: "match", outcome }, { type: "PARTICIPANT_KILLED", actor }, { type: "MATCH_FINISHED", reason });
}

export function normalizeAbilityHands(state: MatchState): MatchState {
  if (state.round.phase !== "turns") return state;
  let next = state;
  const busts: Actor[] = [];
  for (const actor of ["player", "opponent"] as const) {
    if (isBust(next[actor].hand)) {
      busts.push(actor);
      if (!next[actor].busted) {
        next = withRound(next, { ...next.round, [actor]: { ...next[actor], busted: true, stood: true } } as RoundState);
        next = append(next, { type: "BUST", actor });
      }
    } else if (!next[actor].stood && isTwentyOne(next[actor].hand)) {
      next = withRound(next, { ...next.round, [actor]: { ...next[actor], stood: true } } as RoundState);
      next = append(next, { type: actor === "player" ? "PLAYER_STOOD" : "OPPONENT_STOOD" });
    }
  }
  if (busts.length > 1) return resolveRound(next, { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0, playerSkillReward: 0 });
  if (busts.length === 1) return resolveBust(next, busts[0]!);
  if (next.player.stood && next.opponent.stood) return resolveComparison(next);
  return next;
}

function play(state: MatchState, instanceId: string): MatchState {
  const instance = state.abilities.instances.find((candidate) => candidate.instanceId === instanceId); if (!instance) return state;
  if (state.round.phase === "roulette-reaction" && state.round.outcome?.penaltyTarget !== instance.owner) return state;
  const window = state.round.phase === "roulette-reaction" ? "owner-roulette-reaction" : state.round.phase === "turns" && state.round.currentActor === instance.owner ? "owner-turn" : null;
  if (!window) return state;
  const input: Parameters<typeof canPlayAbility>[0] = { world: abilityWorld(state), runtime: state.abilities, instanceId, owner: instance.owner, window, ...abilityServices(state) };
  if (!canPlayAbility(input)) return state;
  try {
    const result = playAbility(input);
    const handChanges = changedHandActors(input.world, result.world);
    let next = commitAbilityWorld(state, result.world);
    next = { ...next, abilities: clearEventCounters({ ...result.runtime, statuses: result.world.statuses }, `ability:${instanceId}`) };
    next = { ...next, abilities: garbageCollectAbilityInstances(next.abilities, next.skills.cards) };
    next = append(next, ...result.events as GameEvent[]);
    if (handChanges.length > 0) next = broadcastHandChanges(next, handChanges, `ability-hand:${instanceId}:${state.history.length}`);
    if (next.round.phase === "turns") {
      next = normalizeAbilityHands(next);
      if (next.round.phase !== "turns") return next;
      if (next[instance.owner].stood) return setPhase(next, "turns", instance.owner === "player" ? "opponent" : "player");
    }
    return next;
  } catch { return state; }
}

export function createMatch(seed: string, options: CreateMatchOptions = {}): MatchState {
  const root = deriveRng(seed, "root"); const deck = root.derive("deck"); const roulette = root.derive("roulette"); const ai = root.derive("ai"); const loot = root.derive("loot"); const dialogue = root.derive("dialogue"); const ability = root.derive("ability"); const initial = makeRound(0, createShoe(deck), deck); const equipped = normalizeEquipped(options.equippedSkillIds);
  let runtime = createAbilityRuntime(ability.snapshot());
  let instanceSerial = 0;
  for (const id of equipped) { const skill = getSkillDefinition(id); if (skill?.category === "passive") runtime = addAbilityInstance(runtime, instantiateAbility(validateAbilityBinding({ definitionId: id, enabled: true, parameters: {} }), "player", `ability-player-${id}`, ++instanceSerial)); }
  for (const [owner, bindings] of [["player", options.playerMechanics ?? []], ["opponent", options.opponentMechanics ?? []]] as const) {
    for (const binding of bindings) {
      const valid = validateAbilityBinding(binding);
      if (getAbilityDefinition(valid.definitionId)?.sourceKind !== "character-mechanic") throw new RangeError(`Match mechanic must reference a character-mechanic definition: ${valid.definitionId}`);
      if (valid.enabled) runtime = addAbilityInstance(runtime, instantiateAbility(valid, owner, `ability-${owner}-${valid.definitionId}-${++instanceSerial}`, instanceSerial));
    }
  }
  const base: MatchState = { id: options.id ?? `match-${seed}`, seed, opponentId: options.opponentId ?? "w", status: "active", scene: "match", view: "table", roundIndex: 0, player: initial.player, opponent: initial.opponent, shoe: initial.shoe, roulette: { player: createGun(), opponent: createGun() }, skills: { equippedSkillIds: equipped, cards: [], advice: null }, abilities: runtime, round: { index: 0, phase: "initial-blackjack-check", starter: initial.starter, currentActor: null, player: initial.player, opponent: initial.opponent, outcome: null }, history: initial.events, rng: { deck: initial.deckRng.snapshot(), roulette: roulette.snapshot(), ai: ai.snapshot(), loot: loot.snapshot(), dialogue: dialogue.snapshot() }, aiProfile: options.aiProfile ?? RECKLESS_B_PROFILE, lastAiDecision: null };
  const opened = gainSkills(base, 1); const created = runAbilityEvent(opened, { trigger: "on-match-created", sourceEventId: `match-created:${opened.id}` }, {}).state;
  return resolveInitialBlackjack(created);
}

export function getLegalActions(state: MatchState): Action[] {
  if (state.scene !== "match") return []; if (state.status === "finished") return state.view === "table" && state.round.phase === "roulette-result" ? [{ type: "ACK_TRIGGER_RESULT" }] : state.view === "match-summary" ? [{ type: "ACK_MATCH_RESULT" }] : [];
  const actions: Action[] = [{ type: "ESCAPE_MATCH" }]; if (state.round.phase === "turns" && state.round.currentActor === "player" && !state.player.stood && !state.player.busted) actions.push({ type: "PLAYER_HIT" }, { type: "PLAYER_STAND" }); if (state.round.phase === "turns" && state.round.currentActor === "opponent") actions.push({ type: "AI_TURN" }); if (state.round.phase === "round-reveal") actions.push({ type: "ACK_ROUND_RESULT" }); if (state.round.phase === "roulette-reaction" || state.round.phase === "roulette-trigger") actions.push({ type: "TRIGGER_ROULETTE" }); if (state.round.phase === "roulette-result") actions.push({ type: "ACK_TRIGGER_RESULT" });
  const window: "owner-turn" | "owner-roulette-reaction" | null = state.round.phase === "roulette-reaction" ? "owner-roulette-reaction" : state.round.phase === "turns" ? "owner-turn" : null;
  if (window) for (const instance of state.abilities.instances) { const definition = getAbilityDefinition(instance.definitionId); const expectedOwner = window === "owner-roulette-reaction" ? state.round.outcome?.penaltyTarget : state.round.currentActor; if (definition?.activation.type === "action" && instance.owner === expectedOwner && (definition.activation.consume === "none" || state.skills.cards.some((card) => card.instanceId === instance.instanceId)) && canPlayAbility({ world: abilityWorld(state), runtime: state.abilities, instanceId: instance.instanceId, owner: instance.owner, window, ...abilityServices(state) })) actions.push({ type: "PLAY_ABILITY", instanceId: instance.instanceId }); }
  return actions;
}

export function gameReducer(state: MatchState, action: Action): MatchState {
  if (action.type === "ESCAPE_MATCH") return state.status === "active" ? append({ ...expireAllStatuses(state), status: "finished", view: "match-summary", outcome: { winner: null, reason: "escaped" } }, { type: "MATCH_ESCAPED" }, { type: "MATCH_FINISHED", reason: "escaped" }) : state;
  if (action.type === "ACK_MATCH_RESULT") return state.status === "finished" && state.view === "match-summary" ? append({ ...state, scene: "lobby" }, { type: "MATCH_RESULT_ACKNOWLEDGED" }) : state;
  if (action.type === "ACK_ROUND_RESULT") { if (state.status !== "active" || state.round.phase !== "round-reveal") return state; const next = append(state, { type: "ROUND_RESULT_ACKNOWLEDGED" }); return next.round.outcome?.penaltyTarget ? setPhase(next, next.round.outcome.penaltyTarget === "opponent" ? "roulette-trigger" : "roulette-reaction", null) : startNextRound(next); }
  if (action.type === "ACK_TRIGGER_RESULT") { if (state.round.phase !== "roulette-result") return state; const next = append(state, { type: "TRIGGER_RESULT_ACKNOWLEDGED" }); return state.status === "finished" ? { ...next, view: "match-summary" } : startNextRound(next); }
  if (state.status !== "active" || state.scene !== "match") return state;
  switch (action.type) {
    case "PLAYER_HIT": return state.round.phase === "turns" && state.round.currentActor === "player" && !state.player.stood ? drawFor(state, "player") : state;
    case "PLAYER_STAND": return state.round.phase === "turns" && state.round.currentActor === "player" && !state.player.stood ? standFor(state, "player") : state;
    case "AI_HIT": case "OPPONENT_HIT": return state.round.phase === "turns" && state.round.currentActor === "opponent" && !state.opponent.stood ? drawFor(state, "opponent") : state;
    case "AI_STAND": case "OPPONENT_STAND": return state.round.phase === "turns" && state.round.currentActor === "opponent" && !state.opponent.stood ? standFor(state, "opponent") : state;
    case "AI_TURN": { if (state.round.phase !== "turns" || state.round.currentActor !== "opponent") return state; const decision = decideAiAction(buildObservation(state, "opponent"), state.aiProfile, SeededRng.fromSnapshot(state.rng.ai)); const next = append({ ...state, rng: { ...state.rng, ai: decision.rng }, lastAiDecision: decision.decision }, { type: "AI_DECISION", decision: decision.decision }); return decision.decision.action === "hit" ? drawFor(next, "opponent") : standFor(next, "opponent"); }
    case "PLAY_ABILITY": return play(state, action.instanceId);
    case "TRIGGER_ROULETTE": return state.round.phase === "roulette-reaction" || state.round.phase === "roulette-trigger" ? triggerFor(state, state.round.outcome?.penaltyTarget ?? "player") : state;
    case "CONTINUE_ROUND": return state.round.phase === "round-end" ? startNextRound(state) : state;
    default: return state;
  }
}
