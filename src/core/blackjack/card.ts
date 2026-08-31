import { RANKS, SUITS, type Card, type Rank, type Suit } from "./types";

export function createCard(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function createStandardDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => createCard(suit, rank)));
}

export function cardValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}
