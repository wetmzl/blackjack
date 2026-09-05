import { describe, expect, it } from "vitest";
import { cardValue, createCard, createDerivedCard, createStandardDeck, isDerivedCard, isPhysicalCard } from "./card";
import { createHand, handValue, handValueAtLimit, isBlackjack, isBust, isTwentyOne } from "./hand";
import { createShoe, dealInitialHands, drawCard, shuffle, shoeRemaining } from "./shoe";
import { getRoundStarter } from "./round";
import { createRng, deriveRng, SeededRng } from "../rng/seeded";

const h = (...cards: ReturnType<typeof createCard>[]) => createHand(cards);

describe("blackjack hand rules", () => {
  it("scores face cards as ten and aces as eleven when legal", () => {
    expect(cardValue("K")).toBe(10);
    expect(handValue(h(createCard("spades", "A"), createCard("hearts", "9")))).toBe(20);
    expect(handValue(h(createCard("spades", "A"), createCard("hearts", "A"), createCard("clubs", "9")))).toBe(21);
  });

  it("downgrades aces to one to avoid busting", () => {
    expect(handValue(h(
      createCard("spades", "A"),
      createCard("hearts", "K"),
      createCard("clubs", "9")
    ))).toBe(20);
  });

  it("scores aces against the active bust limit before comparison modifiers", () => {
    const cards = h(createCard("spades", "A"), createCard("hearts", "A"), createCard("clubs", "10"));
    expect(handValue(cards)).toBe(12);
    expect(handValueAtLimit(cards, 22)).toBe(22);
  });

  it("distinguishes a two-card blackjack from a later 21", () => {
    const blackjack = h(createCard("spades", "A"), createCard("hearts", "K"));
    const later21 = h(createCard("spades", "7"), createCard("hearts", "5"), createCard("clubs", "9"));
    expect(isBlackjack(blackjack)).toBe(true);
    expect(isBlackjack(later21)).toBe(false);
    expect(isTwentyOne(blackjack)).toBe(true);
    expect(isTwentyOne(later21)).toBe(true);
  });

  it("scores derived cards normally but never treats them as natural Blackjack", () => {
    const derivedAce = createDerivedCard("spades", "A");
    const hand = createHand([derivedAce, createCard("hearts", "K")]);
    expect(handValue(hand)).toBe(21);
    expect(hand.cards).toHaveLength(2);
    expect(new Set(hand.cards.map((card) => card.suit))).toEqual(new Set(["spades", "hearts"]));
    expect(isBlackjack(hand)).toBe(false);
    expect(isDerivedCard(derivedAce)).toBe(true);
    expect(isPhysicalCard(createCard("clubs", "2"))).toBe(true);
  });

  it("detects bust hands", () => {
    expect(isBust(h(createCard("spades", "K"), createCard("hearts", "9"), createCard("clubs", "5")))).toBe(true);
    expect(isBust(h(createCard("spades", "A"), createCard("hearts", "K"), createCard("clubs", "9")))).toBe(false);
  });
});

describe("seeded random streams", () => {
  it("replays exactly for the same seed", () => {
    const first = createRng("weekend-seed");
    const second = createRng("weekend-seed");
    expect(Array.from({ length: 12 }, () => first.next())).toEqual(Array.from({ length: 12 }, () => second.next()));
  });

  it("can restore a cursor from a serialized snapshot", () => {
    const rng = createRng("save-me");
    rng.next();
    rng.next();
    const snapshot = rng.snapshot();
    const restored = SeededRng.fromSnapshot(snapshot);
    expect(restored.next()).toBe(rng.next());
    expect(() => rng.nextInt(0)).toThrow(RangeError);
  });

  it("derives independent named streams", () => {
    const root = createRng("match");
    const deck = root.derive("deck");
    const roulette = deriveRng("match", "roulette");
    expect(deck.snapshot()).not.toEqual(roulette.snapshot());
    const replay = root.derive("deck");
    expect(Array.from({ length: 5 }, () => deck.next())).toEqual(Array.from({ length: 5 }, () => replay.next()));
  });
});

describe("shoe and deterministic dealing", () => {
  it("creates a complete 52-card shoe", () => {
    const deck = createStandardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((card) => `${card.rank}-${card.suit}`)).size).toBe(52);
    expect(deck.every(isPhysicalCard)).toBe(true);
  });

  it("shuffles deterministically without changing the cards", () => {
    const deck = createStandardDeck();
    const shuffledA = shuffle(deck, createRng("shuffle"));
    const shuffledB = shuffle(deck, createRng("shuffle"));
    expect(shuffledA).toEqual(shuffledB);
    expect([...shuffledA].sort((a, b) => `${a.suit}${a.rank}`.localeCompare(`${b.suit}${b.rank}`))).toEqual(
      [...deck].sort((a, b) => `${a.suit}${a.rank}`.localeCompare(`${b.suit}${b.rank}`))
    );
  });

  it("deals public/private pairs in a documented deterministic order", () => {
    const shoe = createShoe(createRng("deal"));
    const result = dealInitialHands(shoe);
    expect(result.player[0]).toEqual(shoe.cards[0]);
    expect(result.opponent[0]).toEqual(shoe.cards[1]);
    expect(result.player[1]).toEqual(shoe.cards[2]);
    expect(result.opponent[1]).toEqual(shoe.cards[3]);
    expect(result.shoe.cursor).toBe(4);
    expect(shoeRemaining(result.shoe)).toBe(48);
  });

  it("draws immutably and rejects an empty shoe", () => {
    const shoe = { cards: [createCard("clubs", "A")], cursor: 0, shuffleIndex: 1 };
    const result = drawCard(shoe);
    expect(result.card.rank).toBe("A");
    expect(result.shoe.cursor).toBe(1);
    expect(shoe.cursor).toBe(0);
    expect(() => drawCard(result.shoe)).toThrow("empty shoe");
  });
});

describe("round starter", () => {
  it("lets the opponent start every round", () => {
    expect([0, 1, 2, 3].map(getRoundStarter)).toEqual(["opponent", "opponent", "opponent", "opponent"]);
    expect(() => getRoundStarter(-1)).toThrow(RangeError);
  });
});
