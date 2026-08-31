export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

export interface Hand {
  readonly cards: readonly Card[];
}

export interface ShoeState {
  readonly cards: readonly Card[];
  readonly cursor: number;
  /** Number of times this shoe has been shuffled; useful for save/debug output. */
  readonly shuffleIndex: number;
}

export type RoundStarter = "player" | "opponent";
