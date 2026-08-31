import { handValue } from "../core/blackjack/hand";
import type { GameEvent, MatchState } from "../core/match/types";
import type { DialogueEvent } from "./types";

/**
 * Selects dialogue that depends on the completed hands rather than one event.
 */
export function roundOverrideDialogueEvent(state: MatchState): DialogueEvent | null {
  let resolutionIndex = -1;
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (state.history[index]?.type === "ROUND_RESOLVED") { resolutionIndex = index; break; }
  }
  if (resolutionIndex < 0) return null;
  const resolution = state.history[resolutionIndex];
  if (resolution.type !== "ROUND_RESOLVED") return null;
  if (state.round.phase !== "round-reveal") return null;

  let roundStartIndex = resolutionIndex;
  while (roundStartIndex >= 0 && state.history[roundStartIndex]?.type !== "ROUND_STARTED") roundStartIndex -= 1;
  const cards = state.history.slice(Math.max(0, roundStartIndex), resolutionIndex)
    .filter((event): event is Extract<GameEvent, { type: "CARD_DEALT" }> => event.type === "CARD_DEALT");
  const playerCards = cards.filter((event) => event.actor === "player").map((event) => event.card);
  const opponentCards = cards.filter((event) => event.actor === "opponent").map((event) => event.card);
  if (playerCards.length < 2 || opponentCards.length < 2) return resolution.outcome.winner === null ? "PUSH_ROUND" : null;

  const playerValue = handValue({ cards: playerCards });
  const opponentValue = handValue({ cards: opponentCards });
  if (playerValue === 21 && opponentValue === 21) return "SPECIAL_TWENTY_ONE_PUSH";
  if ((playerValue === 21 && playerCards.length >= 4 && playerCards.length <= 5)
    || (opponentValue === 21 && opponentCards.length >= 4 && opponentCards.length <= 5)) return "SPECIAL_SMALL_HAND_TWENTY_ONE";
  if (resolution.outcome.winner && resolution.outcome.reason === "comparison"
    && Math.abs(playerValue - opponentValue) === 1 && Math.max(playerValue, opponentValue) >= 20) return "SPECIAL_ONE_POINT_FINISH";
  if (resolution.outcome.winner === null && playerValue === opponentValue && playerValue >= 12 && playerValue <= 16) return "SPECIAL_LOW_PUSH";
  return resolution.outcome.winner === null ? "PUSH_ROUND" : null;
}
