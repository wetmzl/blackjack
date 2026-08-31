import { addCard, createHand, handValue } from "../blackjack/hand";
import { createCard } from "../blackjack/card";
import { RANKS, SUITS, type Card, type Hand, type ShoeState } from "../blackjack/types";
import type { MatchObservation } from "../ai/types";
import { decideOptimalAction } from "../ai/policy";
import type { SeededRng, RngSnapshot } from "../rng/seeded";
import type { GunState } from "../roulette/types";
import type { SkillDefinition, SkillInventory, SkillUseResult } from "./types";

export interface SkillEffectContext {
  readonly inventory: SkillInventory;
  readonly gun: GunState;
  readonly shoe: ShoeState;
  readonly playerHand: Hand;
  readonly observation: MatchObservation;
  readonly skillRng: SeededRng;
}

export interface SkillEffectResult extends SkillUseResult {
  readonly gun: GunState;
  readonly shoe: ShoeState;
  readonly playerHand: Hand;
  readonly skillRng: RngSnapshot;
}

function consume(inventory: SkillInventory, id: string): SkillInventory {
  const index = inventory.cards.indexOf(id);
  if (index < 0) throw new Error(`Skill is not in inventory: ${id}`);
  const cards = [...inventory.cards]; cards.splice(index, 1);
  return { ...inventory, cards };
}

function exactTwentyOneCandidates(hand: Hand, shoe: ShoeState): Array<{ card: Card; index: number }> {
  return shoe.cards.map((card, index) => ({ card, index })).filter(({ card, index }) => index >= shoe.cursor && handValue(addCard(hand, card)) === 21);
}

/** Single data-driven interpreter. It owns effect semantics; reducer only applies its result. */
export function applySkillEffect(skill: SkillDefinition, context: SkillEffectContext): SkillEffectResult {
  let inventory = consume(context.inventory, skill.id);
  let playerHand = context.playerHand;
  let shoe = context.shoe;
  const skillRng = context.skillRng;
  if (skill.effect.type === "hunter-advice") inventory = { ...inventory, advice: decideOptimalAction(context.observation) };
  else if (skill.effect.type === "rhodes-heartthrob") inventory = { ...inventory, rhodesArmed: true };
  else if (skill.effect.type === "night-queen") inventory = { ...inventory, nightQueenArmed: true };
  else if (skill.effect.type === "switcheroo") {
    const last = playerHand.cards.length - 1;
    const candidates = shoe.cards.map((card, index) => ({ card, index })).filter(({ card, index }) => index >= shoe.cursor && handValue({ cards: [...playerHand.cards.slice(0, last), card] }) <= 21);
    if (candidates.length > 0) {
      const chosen = candidates[skillRng.nextInt(candidates.length)]!;
      const shoeCards = [...shoe.cards]; const handCards = [...playerHand.cards];
      [handCards[last], shoeCards[chosen.index]] = [shoeCards[chosen.index]!, handCards[last]!];
      playerHand = createHand(handCards); shoe = { ...shoe, cards: shoeCards };
    }
  }
  return { inventory, gun: context.gun, shoe, playerHand, skillRng: skillRng.snapshot() };
}

/** Resolve a guaranteed 21 draw, swapping an existing shoe card when possible.
 * If the shoe has no matching card, a magic card is synthesized at its cursor.
 */
export function drawNightQueenCard(hand: Hand, shoe: ShoeState, skillRng: SeededRng): { readonly card: Card; readonly shoe: ShoeState; readonly rng: RngSnapshot } {
  const target = 21 - handValue(hand);
  const candidates = exactTwentyOneCandidates(hand, shoe).filter(({ card }) => target !== 10 || ["10", "J", "Q", "K"].includes(card.rank));
  if (candidates.length > 0) {
    const selected = candidates[skillRng.nextInt(candidates.length)]!;
    const cards = [...shoe.cards]; [cards[shoe.cursor], cards[selected.index]] = [cards[selected.index]!, cards[shoe.cursor]!];
    return { card: cards[shoe.cursor]!, shoe: { ...shoe, cards, cursor: shoe.cursor + 1 }, rng: skillRng.snapshot() };
  }
  const validRanks = RANKS.filter((rank) => handValue(addCard(hand, createCard("spades", rank))) === 21);
  const ranks = target === 10 ? (["10", "J", "Q", "K"] as const) : validRanks;
  const rank = ranks[skillRng.nextInt(ranks.length)]!;
  const suit = SUITS[skillRng.nextInt(SUITS.length)]!;
  const card = createCard(suit, rank);
  const cards = [...shoe.cards];
  if (shoe.cursor < cards.length) cards[shoe.cursor] = card; else cards.push(card);
  return { card, shoe: { ...shoe, cards, cursor: shoe.cursor + 1 }, rng: skillRng.snapshot() };
}
