import { RANKS, SUITS, type Card, type DerivedCard, type PhysicalCard, type Rank, type Suit } from "./types";

export function createCard(suit: Suit, rank: Rank): PhysicalCard {
  return { suit, rank, origin: "shoe" };
}

export function createDerivedCard(suit: Suit, rank: Rank): DerivedCard {
  return { suit, rank, origin: "derived" };
}

export function isPhysicalCard(card: Card): card is PhysicalCard {
  return card.origin === "shoe";
}

export function isDerivedCard(card: Card): card is DerivedCard {
  return card.origin === "derived";
}

export function createStandardDeck(): PhysicalCard[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => createCard(suit, rank)));
}

export function cardValue(rank: Rank): number {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return Number(rank);
}
