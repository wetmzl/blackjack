import { addCard, createHand, handValue, isBlackjack, isBust, isTwentyOne } from "../blackjack/hand";
import { dealInitialHands, drawCard, reshuffleIfLow, createShoe } from "../blackjack/shoe";
import type { Card, RoundStarter } from "../blackjack/types";
import { deriveRng, SeededRng } from "../rng/seeded";
import { addBullets, createGun, pullTrigger } from "../roulette/roulette";
import type { RouletteState } from "../roulette/types";
import { getSkillDefinition } from "../skills/definitions";
import { applySkillEffect } from "../skills/effects";
import { drawRandomSkill } from "../skills/skills";
import { decideAiAction } from "../ai/policy";
import { buildObservation } from "../ai/observation";
import { getRoundStarter } from "../blackjack/round";
import type {
  Action, Actor, GameEvent, MatchOutcome, MatchState, ParticipantState, RoundOutcome, RoundPhase, RoundState
} from "./types";
import { RECKLESS_B_PROFILE, type AiProfile } from "../ai/types";

export interface CreateMatchOptions {
  readonly id?: string;
  readonly opponentId?: string;
  readonly aiProfile?: AiProfile;
}

function participant(id: Actor, cards: readonly Card[]): ParticipantState {
  return { id, hand: createHand(cards), stood: false, busted: false };
}

function append(state: MatchState, ...events: readonly GameEvent[]): MatchState {
  return { ...state, history: [...state.history, ...events] };
}

function makeRound(index: number, shoe: MatchState["shoe"], deckRng: SeededRng): { readonly player: ParticipantState; readonly opponent: ParticipantState; readonly shoe: MatchState["shoe"]; readonly starter: RoundStarter; readonly events: readonly GameEvent[]; readonly deckRng: SeededRng } {
  const freshShoe = reshuffleIfLow(shoe, deckRng, 12);
  const deal = dealInitialHands(freshShoe);
  return {
    player: participant("player", deal.player),
    opponent: participant("opponent", deal.opponent),
    shoe: deal.shoe,
    starter: getRoundStarter(index),
    deckRng,
    events: [
      { type: "ROUND_STARTED", roundIndex: index },
      { type: "CARD_DEALT", actor: "player", card: deal.player[0], private: false },
      { type: "CARD_DEALT", actor: "opponent", card: deal.opponent[0], private: false },
      { type: "CARD_DEALT", actor: "player", card: deal.player[1], private: true },
      { type: "CARD_DEALT", actor: "opponent", card: deal.opponent[1], private: true }
    ]
  };
}

function withRound(state: MatchState, round: RoundState, extra: Partial<MatchState> = {}): MatchState {
  return { ...state, ...extra, player: round.player, opponent: round.opponent, round, roundIndex: round.index };
}

function setPhase(state: MatchState, phase: RoundPhase, currentActor: Actor | null): MatchState {
  return withRound(state, { ...state.round, phase, currentActor });
}

function gainSkills(state: MatchState, amount: number): MatchState {
  let next = state;
  let rng = SeededRng.fromSnapshot(state.rng.loot);
  const events: GameEvent[] = [];
  for (let index = 0; index < amount; index += 1) {
    const drawn = drawRandomSkill(rng);
    rng = SeededRng.fromSnapshot(drawn.rng);
    next = { ...next, skills: { cards: [...next.skills.cards, drawn.skill.id] } };
    events.push({ type: "SKILL_GAINED", skillId: drawn.skill.id });
  }
  return append({ ...next, rng: { ...next.rng, loot: rng.snapshot() } }, ...events);
}

function resolveComparison(state: MatchState): MatchState {
  const playerValue = handValue(state.player.hand);
  const opponentValue = handValue(state.opponent.hand);
  const winner: Actor | null = playerValue === opponentValue ? null : playerValue > opponentValue ? "player" : "opponent";
  return resolveRound(state, {
    winner,
    reason: winner === null ? "push" : "comparison",
    penaltyTarget: winner === null ? null : winner === "player" ? "opponent" : "player",
    bulletsAdded: winner === null ? 0 : 1,
    playerSkillReward: winner === "player" ? 1 : 0
  });
}

export function resolveRound(state: MatchState, outcome: RoundOutcome): MatchState {
  // Resolution is deliberately a pause.  The table must reveal both hands and
  // let the player acknowledge the result before anybody touches the revolver.
  let next = append(
    setPhase(state, "round-reveal", null),
    { type: "ROUND_RESOLVED", outcome }
  );
  next = withRound(next, { ...next.round, phase: "round-reveal", currentActor: null, outcome });
  if (!outcome.penaltyTarget) return next;

  const targetGun = next.roulette[outcome.penaltyTarget];
  const updatedGun = addBullets(targetGun, outcome.bulletsAdded);
  const roulette: RouletteState = { ...next.roulette, [outcome.penaltyTarget]: updatedGun };
  next = append(
    { ...next, roulette },
    { type: "BULLET_ADDED", actor: outcome.penaltyTarget, amount: outcome.bulletsAdded }
  );
  if (outcome.playerSkillReward > 0) next = gainSkills(next, outcome.playerSkillReward);

  return setPhase(next, "round-reveal", null);
}

function startNextRound(state: MatchState): MatchState {
  const index = state.roundIndex + 1;
  const deckRng = SeededRng.fromSnapshot(state.rng.deck);
  const next = makeRound(index, state.shoe, deckRng);
  const round: RoundState = {
    index,
    phase: "initial-blackjack-check",
    starter: next.starter,
    currentActor: null,
    player: next.player,
    opponent: next.opponent,
    outcome: null
  };
  const stateWithRound = withRound({ ...state, shoe: next.shoe, peekedCards: [], rng: { ...state.rng, deck: next.deckRng.snapshot() } }, round);
  return resolveInitialBlackjack(append(stateWithRound, ...next.events));
}

function resolveInitialBlackjack(state: MatchState): MatchState {
  const playerBlackjack = isBlackjack(state.player.hand);
  const opponentBlackjack = isBlackjack(state.opponent.hand);
  let next = append(state, { type: "INITIAL_BLACKJACK_CHECK", player: playerBlackjack, opponent: opponentBlackjack });
  if (!playerBlackjack && !opponentBlackjack) {
    return append(setPhase(next, "turns", state.round.starter), ...[]);
  }
  if (playerBlackjack) next = append(next, { type: "BLACKJACK", actor: "player" });
  if (opponentBlackjack) next = append(next, { type: "BLACKJACK", actor: "opponent" });
  if (playerBlackjack && opponentBlackjack) {
    return resolveRound(next, {
      winner: null,
      reason: "push",
      penaltyTarget: null,
      bulletsAdded: 0,
      playerSkillReward: 0
    });
  }
  const winner: Actor = playerBlackjack ? "player" : "opponent";
  return resolveRound(next, {
    winner,
    reason: "blackjack",
    penaltyTarget: winner === "player" ? "opponent" : "player",
    bulletsAdded: 2,
    playerSkillReward: winner === "player" ? 2 : 0
  });
}

function drawFor(state: MatchState, actor: Actor): MatchState {
  const drawn = drawCard(state.shoe);
  const current = state[actor];
  const updated: ParticipantState = { ...current, hand: addCard(current.hand, drawn.card) };
  const round = { ...state.round, [actor]: updated } as RoundState;
  let next = withRound({ ...state, shoe: drawn.shoe, peekedCards: [] }, round);
  next = append(next,
    { type: actor === "player" ? "PLAYER_HIT" : "OPPONENT_HIT", value: handValue(updated.hand) },
    { type: "CARD_DEALT", actor, card: drawn.card, private: true }
  );
  if (isBust(updated.hand)) {
    const busted = { ...updated, busted: true, stood: true };
    const bustedRound = { ...next.round, [actor]: busted } as RoundState;
    next = withRound(next, bustedRound);
    return resolveBust(append(next, { type: "BUST", actor }), actor);
  }
  if (isTwentyOne(updated.hand)) {
    const stood = { ...updated, stood: true };
    const stoodRound = { ...next.round, [actor]: stood } as RoundState;
    next = append(withRound(next, stoodRound), { type: actor === "player" ? "PLAYER_STOOD" : "OPPONENT_STOOD" });
    if (next[actor === "player" ? "opponent" : "player"].stood) return resolveComparison(next);
    return setPhase(next, "turns", actor === "player" ? "opponent" : "player");
  }
  const other = actor === "player" ? "opponent" : "player";
  return setPhase(next, "turns", next[other].stood ? actor : other);
}

function resolveBust(state: MatchState, bustedActor: Actor): MatchState {
  const winner: Actor = bustedActor === "player" ? "opponent" : "player";
  return resolveRound(state, {
    winner,
    reason: "bust",
    penaltyTarget: bustedActor,
    bulletsAdded: 1,
    playerSkillReward: winner === "player" ? 1 : 0
  });
}

function standFor(state: MatchState, actor: Actor): MatchState {
  const updated = { ...state[actor], stood: true };
  const round = { ...state.round, [actor]: updated } as RoundState;
  let next = append(withRound(state, round), { type: actor === "player" ? "PLAYER_STOOD" : "OPPONENT_STOOD" });
  const other = actor === "player" ? "opponent" : "player";
  if (next[other].stood) return resolveComparison(next);
  return setPhase(next, "turns", next[other].stood ? actor : other);
}

function pullTriggerFor(state: MatchState, actor: Actor): MatchState {
  const rng = SeededRng.fromSnapshot(state.rng.roulette);
  const trigger = pullTrigger(state.roulette[actor], rng);
  let next = append(
    withRound({ ...state, rng: { ...state.rng, roulette: trigger.rng } }, { ...state.round, phase: "roulette-result", currentActor: null }),
    { type: "TRIGGER_PULLED", actor, probability: trigger.result.probability, fired: trigger.result.fired }
  );
  if (trigger.result.fired) {
    const winner: Actor = actor === "player" ? "opponent" : "player";
    const reason = actor === "player" ? "player-killed" : "opponent-killed";
    const outcome: MatchOutcome = { winner, reason };
    next = append(
      { ...next, status: "finished", view: "table", scene: "match", outcome },
      { type: "PARTICIPANT_KILLED", actor },
      { type: "MATCH_FINISHED", reason }
    );
    return next;
  }
  next = append(next, { type: "TRIGGER_SURVIVED", actor });
  return next;
}

function timingAllowsSkill(state: MatchState, skillId: string): boolean {
  const skill = getSkillDefinition(skillId);
  if (!skill || !state.skills.cards.includes(skillId)) return false;
  const timing = state.round.phase === "roulette-reaction" ? "roulette-reaction" : state.round.phase === "turns" && state.round.currentActor === "player" ? "player-turn" : null;
  if (!timing || !skill.timing.includes(timing)) return false;
  if (skill.effect.type === "remove-bullet" && state.roulette.player.bullets <= 0) return false;
  return true;
}

function useSkill(state: MatchState, skillId: string): MatchState {
  if (!timingAllowsSkill(state, skillId)) return state;
  const skill = getSkillDefinition(skillId);
  if (!skill) return state;
  const applied = applySkillEffect(skill, {
    inventory: state.skills,
    gun: state.roulette.player,
    shoe: state.shoe,
    peekedCards: state.peekedCards
  });
  const next = {
    ...state,
    skills: applied.inventory,
    peekedCards: applied.peekedCards,
    roulette: { ...state.roulette, player: applied.gun }
  };
  return append(next, { type: "SKILL_USED", skillId });
}

export function createMatch(seed: string, options: CreateMatchOptions = {}): MatchState {
  const root = deriveRng(seed, "root");
  const deck = root.derive("deck");
  const roulette = root.derive("roulette");
  const ai = root.derive("ai");
  const loot = root.derive("loot");
  const dialogue = root.derive("dialogue");
  const shoe = createShoe(deck);
  const initial = makeRound(0, shoe, deck);
  const round: RoundState = {
    index: 0,
    phase: "initial-blackjack-check",
    starter: initial.starter,
    currentActor: null,
    player: initial.player,
    opponent: initial.opponent,
    outcome: null
  };
  const base: MatchState = {
    id: options.id ?? `match-${seed}`,
    seed,
    opponentId: options.opponentId ?? "w",
    status: "active",
    scene: "match",
    view: "table",
    roundIndex: 0,
    player: initial.player,
    opponent: initial.opponent,
    shoe: initial.shoe,
    roulette: { player: createGun(), opponent: createGun() },
    skills: { cards: [] },
    peekedCards: [],
    round,
    history: initial.events,
    rng: { deck: initial.deckRng.snapshot(), roulette: roulette.snapshot(), ai: ai.snapshot(), loot: loot.snapshot(), dialogue: dialogue.snapshot() },
    aiProfile: options.aiProfile ?? RECKLESS_B_PROFILE,
    lastAiDecision: null
  };
  const withOpeningSkill = gainSkills(base, 1);
  return resolveInitialBlackjack(withOpeningSkill);
}

export function getLegalActions(state: MatchState): Action[] {
  if (state.scene !== "match") return [];
  if (state.status === "finished") {
    // A fired chamber is still presented on the table.  It has its own
    // acknowledgement before the summary becomes available.
    if (state.view === "table" && state.round.phase === "roulette-result") return [{ type: "ACK_TRIGGER_RESULT" }];
    if (state.view === "match-summary") return [{ type: "ACK_MATCH_RESULT" }];
    return [];
  }
  const actions: Action[] = [{ type: "ESCAPE_MATCH" }];
  if (state.round.phase === "turns" && state.round.currentActor === "player") {
    if (!state.player.stood && !state.player.busted) actions.push({ type: "PLAYER_HIT" }, { type: "PLAYER_STAND" });
  }
  if (state.round.phase === "turns" && state.round.currentActor === "opponent") {
    actions.push({ type: "AI_TURN" });
  }
  if (state.round.phase === "round-reveal") actions.push({ type: "ACK_ROUND_RESULT" });
  if (state.round.phase === "roulette-reaction") actions.push({ type: "TRIGGER_ROULETTE" });
  if (state.round.phase === "roulette-trigger") actions.push({ type: "TRIGGER_ROULETTE" });
  if (state.round.phase === "roulette-result") actions.push({ type: "ACK_TRIGGER_RESULT" });
  if (state.round.phase === "round-end") actions.push({ type: "CONTINUE_ROUND" });
  if (state.round.phase === "turns" && state.round.currentActor === "player" || state.round.phase === "roulette-reaction") {
    for (const id of new Set(state.skills.cards)) if (timingAllowsSkill(state, id)) actions.push({ type: "USE_SKILL", skillId: id });
  }
  return actions;
}

export function gameReducer(state: MatchState, action: Action): MatchState {
  if (action.type === "ESCAPE_MATCH") {
    if (state.status !== "active") return state;
    return append({ ...state, status: "finished", view: "match-summary", scene: "match", outcome: { winner: null, reason: "escaped" } }, { type: "MATCH_ESCAPED" }, { type: "MATCH_FINISHED", reason: "escaped" });
  }
  if (action.type === "ACK_MATCH_RESULT") {
    if (state.status !== "finished" || state.view !== "match-summary") return state;
    return append({ ...state, scene: "lobby" }, { type: "MATCH_RESULT_ACKNOWLEDGED" });
  }
  if (action.type === "ACK_ROUND_RESULT") {
    if (state.status !== "active" || state.scene !== "match" || state.round.phase !== "round-reveal") return state;
    const acknowledged = append(state, { type: "ROUND_RESULT_ACKNOWLEDGED" });
    return acknowledged.round.outcome?.penaltyTarget === "opponent"
      ? pullTriggerFor(setPhase(acknowledged, "roulette-trigger", null), "opponent")
      : acknowledged.round.outcome?.penaltyTarget === "player"
        ? setPhase(acknowledged, "roulette-reaction", null)
      : startNextRound(acknowledged);
  }
  if (action.type === "ACK_TRIGGER_RESULT") {
    if (state.scene !== "match" || state.round.phase !== "roulette-result") return state;
    const acknowledged = append(state, { type: "TRIGGER_RESULT_ACKNOWLEDGED" });
    if (state.status === "finished") return { ...acknowledged, view: "match-summary" };
    return startNextRound(acknowledged);
  }
  if (state.status !== "active" || state.scene !== "match") return state;
  switch (action.type) {
    case "PLAYER_HIT": return state.round.phase === "turns" && state.round.currentActor === "player" && !state.player.stood ? drawFor(state, "player") : state;
    case "PLAYER_STAND": return state.round.phase === "turns" && state.round.currentActor === "player" && !state.player.stood ? standFor(state, "player") : state;
    case "AI_HIT":
    case "OPPONENT_HIT": return state.round.phase === "turns" && state.round.currentActor === "opponent" && !state.opponent.stood ? drawFor(state, "opponent") : state;
    case "AI_STAND":
    case "OPPONENT_STAND": return state.round.phase === "turns" && state.round.currentActor === "opponent" && !state.opponent.stood ? standFor(state, "opponent") : state;
    case "AI_TURN": {
      if (state.round.phase !== "turns" || state.round.currentActor !== "opponent") return state;
      const decision = decideAiAction(buildObservation(state, "opponent"), state.aiProfile, SeededRng.fromSnapshot(state.rng.ai));
      const withDecision = append({ ...state, rng: { ...state.rng, ai: decision.rng }, lastAiDecision: decision.decision }, { type: "AI_DECISION", decision: decision.decision });
      return decision.decision.action === "hit" ? drawFor(withDecision, "opponent") : standFor(withDecision, "opponent");
    }
    case "USE_SKILL": return useSkill(state, action.skillId);
    case "TRIGGER_ROULETTE": return state.round.phase === "roulette-reaction" || state.round.phase === "roulette-trigger" ? pullTriggerFor(state, state.round.outcome?.penaltyTarget ?? "player") : state;
    case "CONTINUE_ROUND": return state.round.phase === "round-end" ? startNextRound(state) : state;
    default: return state;
  }
}
