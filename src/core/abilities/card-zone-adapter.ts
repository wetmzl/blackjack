import { addCard, createHand, handValue } from "../blackjack/hand";
import { cardValue, createCard, createDerivedCard, isDerivedCard } from "../blackjack/card";
import { RANKS, SUITS, type Card, type Hand, type PhysicalCard, type ShoeState } from "../blackjack/types";
import type { SeededRng } from "../rng/seeded";

export interface CardCandidateResult { readonly card: PhysicalCard; readonly index: number; }
export function handCardCount(hand: Hand): number { return hand.cards.length; }
export function handTotal(hand: Hand): number { return handValue(hand); }
export function fixedCardValue(card: Card): number { return cardValue(card.rank); }

export function swapLastHandCardWithDrawPileTop(shoe: ShoeState, hand: Hand): { readonly hand: Hand; readonly shoe: ShoeState } | undefined {
  if (hand.cards.length === 0 || shoe.cursor >= shoe.cards.length) return undefined;
  const outgoing = hand.cards.at(-1)!;
  const top = shoe.cards[shoe.cursor]!;
  const cards = [...hand.cards.slice(0, -1), top];
  if (isDerivedCard(outgoing)) return { hand: createHand(cards), shoe: { ...shoe, cursor: shoe.cursor + 1 } };
  const shoeCards = [...shoe.cards];
  shoeCards[shoe.cursor] = outgoing;
  return { hand: createHand(cards), shoe: { ...shoe, cards: shoeCards } };
}

const SPLIT_RANKS = RANKS.map((rank) => ({ rank, value: cardValue(rank) }));
export function canSplitLastCard(hand: Hand): boolean {
  const value = hand.cards.at(-1) ? fixedCardValue(hand.cards.at(-1)!) : 0;
  return SPLIT_RANKS.some((left, index) => SPLIT_RANKS.some((right, rightIndex) => rightIndex >= index && left.value + right.value === value));
}
export function splitLastCardIntoDerived(hand: Hand, rng: SeededRng): { readonly hand: Hand; readonly cards: readonly Card[] } | undefined {
  const outgoing = hand.cards.at(-1);
  if (!outgoing) return undefined;
  const pairs = SPLIT_RANKS.flatMap((left, index) => SPLIT_RANKS.slice(index).filter((right) => left.value + right.value === fixedCardValue(outgoing)).map((right) => [left.rank, right.rank] as const));
  if (pairs.length === 0) return undefined;
  const [left, right] = pairs[rng.nextInt(pairs.length)]!;
  const cards = [createDerivedCard(SUITS[rng.nextInt(SUITS.length)]!, left), createDerivedCard(SUITS[rng.nextInt(SUITS.length)]!, right)];
  return { hand: createHand([...hand.cards.slice(0, -1), ...cards]), cards };
}

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

/**
 * Atomically replaces the last hand card with one remaining physical card.
 * A physical outgoing card returns to the shoe; a derived outgoing card
 * dissipates and the selected shoe card is consumed instead.
 */
export function replaceLastHandCard(shoe: ShoeState, hand: Hand, rng: SeededRng, target: "at-most" | "exactly", total: number): { readonly hand: Hand; readonly shoe: ShoeState } | undefined {
  const candidates = findCardCandidates(shoe, hand, target, total);
  if (candidates.length === 0 || hand.cards.length === 0) return undefined;
  const selected = candidates[rng.nextInt(candidates.length)]!;
  const handCards = [...hand.cards];
  const shoeCards = [...shoe.cards];
  const outgoing = handCards[handCards.length - 1]!;
  handCards[handCards.length - 1] = selected.card;
  if (!isDerivedCard(outgoing)) {
    shoeCards[selected.index] = outgoing;
    return { hand: createHand(handCards), shoe: { ...shoe, cards: shoeCards } };
  }
  [shoeCards[shoe.cursor], shoeCards[selected.index]] = [shoeCards[selected.index]!, shoeCards[shoe.cursor]!];
  return { hand: createHand(handCards), shoe: { ...shoe, cards: shoeCards, cursor: shoe.cursor + 1 } };
}

export interface ExactDrawResult { readonly card: Card; readonly shoe: ShoeState; readonly derived: boolean; }

/** Creates a temporary card that makes the hand's total exactly `total`.
 * This deliberately never consults or mutates the physical shoe. */
export function createDerivedCardForExactTotal(hand: Hand, rng: SeededRng, total: number): Card | undefined {
  const ranks = RANKS.filter((rank) => handValue(addCard(hand, createCard("spades", rank))) === total);
  if (ranks.length === 0) return undefined;
  return createDerivedCard(SUITS[rng.nextInt(SUITS.length)]!, ranks[rng.nextInt(ranks.length)]!);
}

/** Resolve a guaranteed total without ever asking the RNG for an empty range. */
export function drawExactResultingTotal(shoe: ShoeState, hand: Hand, rng: SeededRng, total: number): ExactDrawResult | undefined {
  const candidates = findDrawCandidates(shoe, hand, "exactly", total);
  if (candidates.length > 0) {
    const selected = candidates[rng.nextInt(candidates.length)]!;
    const cards = [...shoe.cards];
    [cards[shoe.cursor], cards[selected.index]] = [cards[selected.index]!, cards[shoe.cursor]!];
    return { card: cards[shoe.cursor]!, shoe: { ...shoe, cards, cursor: shoe.cursor + 1 }, derived: false };
  }
  const ranks = RANKS.filter((rank) => handValue(addCard(hand, createCard("spades", rank))) === total);
  if (ranks.length === 0) return undefined;
  const rank = ranks[rng.nextInt(ranks.length)]!;
  const suit = SUITS[rng.nextInt(SUITS.length)]!;
  return { card: createDerivedCard(suit, rank), shoe, derived: true };
}
