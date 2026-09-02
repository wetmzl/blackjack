import { addCard, createHand, handValue } from "../blackjack/hand";
import { createCard } from "../blackjack/card";
import { RANKS, SUITS, type Card, type Hand, type ShoeState } from "../blackjack/types";
import type { SeededRng } from "../rng/seeded";

export interface CardCandidateResult { readonly card: Card; readonly index: number; }
export function handCardCount(hand: Hand): number { return hand.cards.length; }
export function handTotal(hand: Hand): number { return handValue(hand); }

export function findCardCandidates(shoe: ShoeState, hand: Hand, target: "at-most" | "exactly", total: number): readonly CardCandidateResult[] {
  return shoe.cards.slice(shoe.cursor).map((card, offset) => ({ card, index: shoe.cursor + offset })).filter(({ card }) => {
    const value = handValue(addCard({ cards: hand.cards.slice(0, -1) }, card));
    return target === "at-most" ? value <= total : value === total;
  });
}

export function findDrawCandidates(shoe: ShoeState, hand: Hand, target: "at-most" | "exactly", total: number): readonly CardCandidateResult[] {
  return shoe.cards.slice(shoe.cursor).map((card, offset) => ({ card, index: shoe.cursor + offset })).filter(({ card }) => {
    const value = handValue(addCard(hand, card));
    return target === "at-most" ? value <= total : value === total;
  });
}

/** Atomically swaps the last hand card with one remaining card. */
export function replaceLastHandCard(shoe: ShoeState, hand: Hand, rng: SeededRng, target: "at-most" | "exactly", total: number): { readonly hand: Hand; readonly shoe: ShoeState } | undefined {
  const candidates = findCardCandidates(shoe, hand, target, total);
  if (candidates.length === 0 || hand.cards.length === 0) return undefined;
  const selected = candidates[rng.nextInt(candidates.length)]!;
  const handCards = [...hand.cards];
  const shoeCards = [...shoe.cards];
  [handCards[handCards.length - 1], shoeCards[selected.index]] = [shoeCards[selected.index]!, handCards[handCards.length - 1]!];
  return { hand: createHand(handCards), shoe: { ...shoe, cards: shoeCards } };
}

export interface ExactDrawResult { readonly card: Card; readonly shoe: ShoeState; readonly synthesized: boolean; }

/** Resolve a guaranteed total without ever asking the RNG for an empty range. */
export function drawExactResultingTotal(shoe: ShoeState, hand: Hand, rng: SeededRng, total: number): ExactDrawResult | undefined {
  const candidates = findDrawCandidates(shoe, hand, "exactly", total);
  if (candidates.length > 0) {
    const selected = candidates[rng.nextInt(candidates.length)]!;
    const cards = [...shoe.cards];
    [cards[shoe.cursor], cards[selected.index]] = [cards[selected.index]!, cards[shoe.cursor]!];
    return { card: cards[shoe.cursor]!, shoe: { ...shoe, cards, cursor: shoe.cursor + 1 }, synthesized: false };
  }
  const ranks = RANKS.filter((rank) => handValue(addCard(hand, createCard("spades", rank))) === total);
  if (ranks.length === 0) return undefined;
  const rank = ranks[rng.nextInt(ranks.length)]!;
  const suit = SUITS[rng.nextInt(SUITS.length)]!;
  const card = createCard(suit, rank);
  const cards = [...shoe.cards];
  if (shoe.cursor < cards.length) cards[shoe.cursor] = card; else cards.push(card);
  return { card, shoe: { ...shoe, cards, cursor: shoe.cursor + 1 }, synthesized: true };
}
