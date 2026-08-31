import { cardValue } from "./card";
import type { Card, Hand } from "./types";

export function createHand(cards: readonly Card[] = []): Hand {
  return { cards: [...cards] };
}

export function addCard(hand: Hand, card: Card): Hand {
  return { cards: [...hand.cards, card] };
}

/** Returns the highest legal total, treating aces as 1 when 11 would bust. */
export function handValue(hand: Hand): number {
  let total = 0;
  let aces = 0;
  for (const card of hand.cards) {
    total += cardValue(card.rank);
    if (card.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function isBlackjack(hand: Hand): boolean {
  return hand.cards.length === 2 && handValue(hand) === 21;
}

export function isBust(hand: Hand): boolean {
  return handValue(hand) > 21;
}

export function isTwentyOne(hand: Hand): boolean {
  return handValue(hand) === 21;
}
