import { cardHasTag, cardSource, cardSuit, cardRank } from "../core/blackjack/card";
import type { Card, Rank, Suit } from "../core/blackjack/types";

export type CardSurface = "front" | "back";
export type CardMarkerPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type CardMarkerVisual =
  | { readonly kind: "css"; readonly className: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "image"; readonly src: string; readonly alt: string };

export interface CardMarker {
  readonly type: string;
  readonly position: CardMarkerPosition;
  readonly label: string;
  readonly visual: CardMarkerVisual;
}

export interface CardDisplayDescription {
  readonly cardId: string;
  readonly source: Card["attributes"]["source"];
  readonly tags: readonly string[];
  readonly surface: CardSurface;
  readonly rank: Rank | null;
  readonly suit: Suit | null;
  readonly markers: readonly CardMarker[];
  readonly variant?: "table" | "compact";
}

export interface CardVisibility {
  readonly surface: CardSurface;
  readonly showRank: boolean;
  readonly showSuit: boolean;
  readonly markers?: readonly CardMarker[];
  readonly variant?: CardDisplayDescription["variant"];
}

export interface HandCardKnowledge {
  readonly revealAll?: boolean;
  readonly faceUpCardIds?: ReadonlySet<string>;
  readonly rankVisibleCardIds?: ReadonlySet<string>;
  readonly suitVisibleCardIds?: ReadonlySet<string>;
  readonly markersByCardId?: Readonly<Record<string, readonly CardMarker[]>>;
  readonly variant?: CardDisplayDescription["variant"];
}

const DERIVED_MARKER: CardMarker = {
  type: "derived",
  position: "top-right",
  label: "衍生牌",
  visual: { kind: "text", text: "◇" }
};

/** Tag-driven decoration registry. New card treatments do not alter the renderer. */
const TAG_MARKERS: readonly { readonly tag: string; readonly marker: CardMarker }[] = [
  { tag: "derived", marker: DERIVED_MARKER }
];

export function describeCard(card: Card, visibility: CardVisibility): CardDisplayDescription {
  const tagMarkers = TAG_MARKERS.filter(({ tag }) => cardHasTag(card, tag)).map(({ marker }) => marker);
  return {
    cardId: card.id,
    source: cardSource(card),
    tags: [...card.tags],
    surface: visibility.surface,
    rank: visibility.showRank ? cardRank(card) : null,
    suit: visibility.showSuit ? cardSuit(card) : null,
    markers: [...tagMarkers, ...(visibility.markers ?? [])],
    variant: visibility.variant
  };
}

/** Converts observer knowledge into renderer-ready descriptions without card-kind branches. */
export function describeCards(cards: readonly Card[], knowledge: HandCardKnowledge): readonly CardDisplayDescription[] {
  return cards.map((card) => {
    const faceUp = knowledge.revealAll === true || knowledge.faceUpCardIds?.has(card.id) === true;
    return describeCard(card, {
      surface: faceUp ? "front" : "back",
      showRank: faceUp || knowledge.rankVisibleCardIds?.has(card.id) === true,
      showSuit: faceUp || knowledge.suitVisibleCardIds?.has(card.id) === true,
      markers: knowledge.markersByCardId?.[card.id],
      variant: knowledge.variant
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export function suitPresentation(suit: Suit): { readonly symbol: string; readonly label: string; readonly red: boolean } {
  if (suit === "hearts") return { symbol: "♥", label: "红桃", red: true };
  if (suit === "diamonds") return { symbol: "♦", label: "方块", red: true };
  if (suit === "clubs") return { symbol: "♣", label: "梅花", red: false };
  return { symbol: "♠", label: "黑桃", red: false };
}

function markerMarkup(marker: CardMarker): string {
  const base = `card-marker card-marker-${marker.position} card-marker-${escapeHtml(marker.type)}`;
  if (marker.visual.kind === "image") return `<span class="${base}" aria-label="${escapeHtml(marker.label)}"><img src="${escapeHtml(marker.visual.src)}" alt="${escapeHtml(marker.visual.alt)}"></span>`;
  if (marker.visual.kind === "text") return `<span class="${base}" aria-label="${escapeHtml(marker.label)}">${escapeHtml(marker.visual.text)}</span>`;
  return `<span class="${base} ${escapeHtml(marker.visual.className)}" aria-label="${escapeHtml(marker.label)}"></span>`;
}

/** The sole HTML renderer for actual playing-card entities. */
export function cardDisplayMarkup(display: CardDisplayDescription): string {
  const suit = display.suit ? suitPresentation(display.suit) : null;
  const visibleFacts = [display.rank ? `点数${display.rank}` : "", suit ? `花色${suit.label}` : ""].filter(Boolean).join("，");
  const surfaceLabel = display.surface === "front" ? "正面" : "牌背";
  const markerLabels = display.markers.map((marker) => marker.label).join("、");
  const aria = [surfaceLabel, visibleFacts, markerLabels].filter(Boolean).join("，");
  const classes = [
    "card",
    `card-${display.surface}`,
    suit?.red ? "red" : "black",
    display.rank ? "card-rank-visible" : "",
    suit ? "card-suit-visible" : "",
    display.variant === "compact" ? "card-compact ai-info-card" : "",
    cardHasDisplayTag(display, "derived") ? "card-derived" : ""
  ].filter(Boolean).join(" ");
  return `<span class="${classes}" data-card-id="${escapeHtml(display.cardId)}" data-card-source="${display.source}" aria-label="${escapeHtml(aria)}"><span class="card-surface" aria-hidden="true">${suit ? `<em class="card-suit">${suit.symbol}</em>` : ""}${display.rank ? `<b class="card-rank">${escapeHtml(display.rank)}</b>` : ""}</span>${display.markers.map(markerMarkup).join("")}</span>`;
}

function cardHasDisplayTag(display: CardDisplayDescription, tag: string): boolean {
  return display.tags.includes(tag);
}
