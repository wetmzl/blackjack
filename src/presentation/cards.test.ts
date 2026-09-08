import { describe, expect, it } from "vitest";
import { createCard, createDerivedCard } from "../core/blackjack/card";
import { cardDisplayMarkup, describeCard, describeCards, type CardMarker } from "./cards";

describe("card display descriptions", () => {
  it("projects surface, rank and suit as independent dimensions", () => {
    const card = createCard("hearts", "8", "physical-8-heart");
    const display = describeCard(card, { surface: "back", showRank: true, showSuit: false });
    expect(display).toMatchObject({ cardId: "physical-8-heart", surface: "back", rank: "8", suit: null, markers: [] });
    const markup = cardDisplayMarkup(display);
    expect(markup).toContain("card-back");
    expect(markup).toContain("card-rank-visible");
    expect(markup).not.toContain("card-suit-visible");
    expect(markup).toContain("card-rank\">8");
    expect(markup).not.toContain("card-suit");
    expect(markup).not.toContain("card-back-emblem");
  });

  it("adds tag-driven and arbitrary corner markers through one renderer", () => {
    const markers: CardMarker[] = [
      { type: "watch", position: "top-left", label: "监视标记", visual: { kind: "image", src: "/marker.png", alt: "监视" } },
      { type: "intel", position: "bottom-left", label: "情报标记", visual: { kind: "css", className: "intel-pip" } },
      { type: "lock", position: "bottom-right", label: "锁定标记", visual: { kind: "text", text: "×" } }
    ];
    const card = createDerivedCard("spades", "Q", "derived-q", "night-queen");
    const display = describeCard(card, { surface: "back", showRank: false, showSuit: true, markers });
    expect(new Set(display.markers.map((marker) => marker.position))).toEqual(new Set(["top-left", "top-right", "bottom-left", "bottom-right"]));
    const markup = cardDisplayMarkup(display);
    expect(markup).toContain('data-card-id="derived-q"');
    expect(markup).toContain("card-marker-top-left");
    expect(markup).toContain("card-marker-top-right");
    expect(markup).toContain("card-marker-bottom-left");
    expect(markup).toContain("card-marker-bottom-right");
    expect(markup).toContain('src="/marker.png"');
    expect(markup).toContain("card-suit-visible");
    expect(markup).toContain("♠");
    expect(markup).not.toContain("card-rank");
    expect(markup).not.toContain("card-back-emblem");
  });

  it("keeps partial hand knowledge attached to card identity", () => {
    const oldPrivate = createCard("hearts", "8", "old-private");
    const replacement = createCard("clubs", "K", "replacement");
    const knownSuitIds = new Set([oldPrivate.id]);
    expect(describeCards([oldPrivate], { suitVisibleCardIds: knownSuitIds })[0]).toMatchObject({ surface: "back", rank: null, suit: "hearts" });
    expect(describeCards([replacement], { suitVisibleCardIds: knownSuitIds })[0]).toMatchObject({ surface: "back", rank: null, suit: null });
  });
});
