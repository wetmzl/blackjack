import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createDefaultSave, createRuntimeSave } from "../../src/persistence/boot";
import { createMatch, gameReducer } from "../../src/core/match/reducer";
import type { MatchHistoryRecord } from "../../src/core/match/history";
import type { MatchState } from "../../src/core/match/types";
import { getAiTurnDelayMs } from "../../src/presentation/ai-timing";
import { createCard, createDerivedCard } from "../../src/core/blackjack/card";
import { createHand } from "../../src/core/blackjack/hand";
import { INITIAL_PLAYER_SKILL_IDS } from "../../src/core/skills/definitions";
import type { AbilityBinding } from "../../src/core/abilities/types";

const wCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/w.json", import.meta.url), "utf8")) as {
  dialogue: { PLAYER_BLACKJACK: string[]; PLAYER_WIN_ROUND: string[] };
  aiSkills: AbilityBinding[];
};
const ireneCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/irene.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const lapplandCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/lappland-the-decadenza.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const hoOlheyakCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/ho-olheyak.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const dorothyCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/dorothy.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const wDialogue = wCharacterData.dialogue;

function findTurnsMatch(prefix: string) {
  for (let index = 0; index < 10_000; index += 1) {
    const match = createMatch(`${prefix}-${index}`);
    if (match.round.phase === "turns" && match.round.currentActor === "opponent") return match;
  }
  throw new Error("No deterministic turns fixture found");
}

function abilityToastMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const dealt = createMatch(`e2e-ability-toast-${index}`, {
      opponentId: "platinum",
      opponentAiSkills: [{ definitionId: "platinum-vision", enabled: true, parameters: {} }]
    });
    if (dealt.round.phase !== "turns") continue;
    const player = { ...dealt.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "6")]), stood: false, busted: false };
    const opponent = { ...dealt.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: false, busted: false };
    const hunterCard = { kind: "player-skill" as const, definitionId: "critical-judgment", owner: "player" as const, instanceId: "toast-judgment" };
    const scentCard = { kind: "player-skill" as const, definitionId: "scent-of-a-woman", owner: "player" as const, instanceId: "toast-scent" };
    const sequence = dealt.abilities.sequence + 1;
    return {
      ...dealt,
      player,
      opponent,
      round: { ...dealt.round, player, opponent, currentActor: "player" },
      playerSkills: {
        ...dealt.playerSkills,
        unlockedDefinitionIds: [...new Set([...dealt.playerSkills.unlockedDefinitionIds, "critical-judgment", "scent-of-a-woman"])],
        cards: [hunterCard, scentCard],
        advice: null
      },
      abilities: {
        ...dealt.abilities,
        instances: [
          ...dealt.abilities.instances.filter((instance) => instance.kind !== "player-skill"),
          { ...hunterCard, createdAtSequence: sequence, parameters: {} },
          { ...scentCard, createdAtSequence: sequence + 1, parameters: {} }
        ],
        sequence: sequence + 1
      },
      aiProfile: { P: -100, A: 0, B: 0, C: 0 },
      lastAiDecision: null
    };
  }
  throw new Error("No deterministic ability toast fixture found");
}

function switcherooKnowledgeMatch(): MatchState {
  const dealt = findTurnsMatch("e2e-switcheroo-knowledge");
  const card = { kind: "player-skill" as const, definitionId: "switcheroo", owner: "player" as const, instanceId: "e2e-switcheroo-card" };
  const sequence = dealt.abilities.sequence + 1;
  return {
    ...dealt,
    round: { ...dealt.round, currentActor: "player" },
    playerSkills: {
      ...dealt.playerSkills,
      unlockedDefinitionIds: [...new Set([...dealt.playerSkills.unlockedDefinitionIds, "switcheroo"])],
      cards: [card]
    },
    abilities: {
      ...dealt.abilities,
      instances: [...dealt.abilities.instances, { ...card, createdAtSequence: sequence, parameters: {} }],
      sequence
    }
  };
}

function earlyPreparationDrawMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const match = createMatch(`e2e-early-preparation-draw-${index}`, {
      opponentId: "plume",
      talentIds: ["early-preparation"],
      unlockedPlayerSkillIds: INITIAL_PLAYER_SKILL_IDS
    });
    if (match.round.phase !== "turns" || match.playerSkills.drawCount !== 1) continue;
    const playerTurn = { ...match, round: { ...match.round, currentActor: "player" as const } };
    if (playerTurn.round.currentActor === "player") return playerTurn;
  }
  throw new Error("No deterministic early-preparation draw fixture found");
}

function findPlayerBlackjackMatch() {
  for (let index = 0; index < 10_000; index += 1) {
    const match = createMatch(`e2e-player-blackjack-${index}`);
    if (match.round.outcome?.reason === "blackjack" && match.round.outcome.winner === "player") return match;
  }
  throw new Error("No deterministic player Blackjack fixture found");
}

function wInfoBarMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const dealt = createMatch(`e2e-w-info-${index}`, { opponentId: "w", opponentAiSkills: wCharacterData.aiSkills });
    if (dealt.round.phase !== "turns" || dealt.round.currentActor !== "opponent") continue;
    const hit = gameReducer(dealt, { type: "AI_HIT" });
    if (hit.round.phase !== "turns" || hit.opponent.hand.cards.length !== dealt.opponent.hand.cards.length + 1) continue;
    return { ...hit, round: { ...hit.round, currentActor: "player" } };
  }
  throw new Error("No deterministic W information-bar fixture found");
}

function ireneInfoBarMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const dealt = createMatch(`e2e-irene-info-${index}`, { opponentId: "irene", opponentAiSkills: ireneCharacterData.aiSkills });
    if (dealt.round.phase !== "turns") continue;
    return {
      ...dealt,
      history: [...dealt.history, { type: "PLAYER_HIT", value: 10 }, { type: "PLAYER_HIT", value: 12 }],
      round: { ...dealt.round, currentActor: "player" }
    };
  }
  throw new Error("No deterministic Irene information-bar fixture found");
}

function ireneMisfireRevealMatch(): MatchState {
  const match = ireneInfoBarMatch();
  const outcome = { winner: "player" as const, reason: "comparison" as const, penaltyTarget: "opponent" as const, bulletsAdded: 1 };
  return {
    ...match,
    roulette: { ...match.roulette, opponent: { capacity: 6, bullets: 3 } },
    round: { ...match.round, phase: "round-reveal", currentActor: null, outcome }
  };
}

function lapplandInfoBarMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const dealt = createMatch(`e2e-lappland-info-${index}`, { opponentId: "lappland-the-decadenza", opponentAiSkills: lapplandCharacterData.aiSkills });
    if (dealt.round.phase !== "turns") continue;
    const source = dealt.abilities.instances.find((instance) => instance.definitionId === "carnival-index");
    if (!source) continue;
    const sequence = dealt.abilities.sequence + 1;
    return {
      ...dealt,
      abilities: {
        ...dealt.abilities,
        statuses: [...dealt.abilities.statuses, {
          statusDefinitionId: "carnival-index-value",
          owner: "opponent",
          sourceInstanceId: source.instanceId,
          stacks: 19,
          duration: "match",
          parameters: {},
          createdAtSequence: sequence
        }],
        sequence
      }
    };
  }
  throw new Error("No deterministic Lappland information-bar fixture found");
}

function comparisonScoreDisplayMatch(): MatchState {
  const source = findTurnsMatch("e2e-comparison-score-display");
  const player = { ...source.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "7")]), stood: true, busted: false };
  const opponent = { ...source.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: true, busted: false };
  const outcome = {
    winner: "opponent" as const,
    reason: "comparison" as const,
    penaltyTarget: "player" as const,
    bulletsAdded: 1,
    comparisonScores: { player: 17, opponent: 20 }
  };
  return {
    ...source,
    player,
    opponent,
    round: { ...source.round, phase: "round-reveal", currentActor: null, player, opponent, outcome }
  };
}

function liveComparisonScoreDisplayMatch(): MatchState {
  const source = createMatch("e2e-live-comparison-score-display", {
    opponentId: "platinum",
    opponentAiSkills: [{ definitionId: "platinum-vision", enabled: true, parameters: {} }]
  });
  const ability = source.abilities.instances.find((instance) => instance.definitionId === "platinum-vision")!;
  const player = { ...source.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "7")]), stood: false, busted: false };
  const opponent = { ...source.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: true, busted: false };
  return {
    ...source,
    player,
    opponent,
    shoe: { cards: [createCard("clubs", "2")], cursor: 0, shuffleIndex: 1 },
    round: { ...source.round, phase: "turns", currentActor: "player", player, opponent, outcome: null },
    abilities: {
      ...source.abilities,
      statuses: [{ statusDefinitionId: "platinum-vision-advantage", owner: "opponent", sourceInstanceId: ability.instanceId, stacks: 2, duration: "match", parameters: {}, createdAtSequence: ability.createdAtSequence }]
    }
  };
}

function hoOlheyakInfoBarMatch(suit: "hearts" | "spades" = "hearts"): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const dealt = createMatch(`e2e-ho-olheyak-info-${index}`, { opponentId: "ho-olheyak", opponentAiSkills: hoOlheyakCharacterData.aiSkills });
    if (dealt.round.phase !== "turns") continue;
    const source = dealt.abilities.instances.find((instance) => instance.definitionId === "ho-olheyak-inheritance-terminal");
    if (!source) continue;
    return {
      ...dealt,
      abilities: {
        ...dealt.abilities,
        statuses: [...dealt.abilities.statuses, {
          statusDefinitionId: "ho-olheyak-memory-card",
          owner: "opponent",
          sourceInstanceId: source.instanceId,
          stacks: 1,
          duration: "match",
          parameters: { rank: "4", suit, source: "shoe" },
          createdAtSequence: dealt.abilities.sequence
        }]
      }
    };
  }
  throw new Error("No deterministic Ho-olheyak information-bar fixture found");
}

function dorothyInfoBarMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const dealt = createMatch(`e2e-dorothy-info-${index}`, { opponentId: "dorothy", opponentAiSkills: dorothyCharacterData.aiSkills });
    const status = dealt.abilities.statuses.find((entry) => entry.statusDefinitionId === "dorothy-resonance-suit");
    if (dealt.round.phase === "turns" && status && dealt.opponent.hand.cards[1]?.attributes.suit === status.parameters.suit) return dealt;
  }
  throw new Error("No deterministic Dorothy information-bar fixture found");
}

function playerWinSummary(opponentId = "w"): MatchState {
  const match = findTurnsMatch(`summary-${opponentId}`);
  return {
    ...match,
    opponentId,
    status: "finished",
    view: "match-summary",
    outcome: { winner: "player", reason: "opponent-killed" },
    round: { ...match.round, phase: "roulette-result", currentActor: null }
  };
}

function playerLossSummary(opponentId = "w"): MatchState {
  const match = findTurnsMatch(`loss-summary-${opponentId}`);
  return {
    ...match,
    opponentId,
    status: "finished",
    view: "match-summary",
    outcome: { winner: "opponent", reason: "player-killed" },
    round: { ...match.round, phase: "roulette-result", currentActor: null }
  };
}

function victoryRecord(id: string, opponentId: string, timestamp: string): MatchHistoryRecord {
  return {
    id,
    timestamp,
    opponentId,
    winner: "player",
    escaped: false,
    finalRoulette: { player: { capacity: 6, bullets: 1 }, opponent: { capacity: 6, bullets: 6 } },
    busts: { player: 0, opponent: 1 },
    blackjacks: { player: 0, opponent: 0 }
  };
}

function saveWithDefeats(...opponentIds: string[]) {
  const save = createDefaultSave("2026-08-30T00:00:00.000Z");
  save.defeats = opponentIds.map((opponentId, index) => ({ opponentId, timestamp: `2026-08-${String(20 + index).padStart(2, "0")}T00:00:00.000Z` }));
  save.profile = { ...save.profile, matchesPlayed: opponentIds.length, wins: opponentIds.length };
  return save;
}

function opponentPenaltyReveal(): MatchState {
  const match = findTurnsMatch("audio-confirm");
  const outcome = { winner: "player" as const, reason: "comparison" as const, penaltyTarget: "opponent" as const, bulletsAdded: 1 };
  return {
    ...match,
    roulette: { ...match.roulette, opponent: { capacity: 6, bullets: 6 } },
    round: { ...match.round, phase: "round-reveal", currentActor: null, outcome }
  };
}

async function enterCharacterSelection(page: Page): Promise<void> {
  const selection = page.locator("main.lobby-character-shell");
  if (await selection.isVisible()) return;
  const entry = page.locator("[data-enter-duel]");
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(selection).toBeVisible();
}

async function ensureGuestCandidate(page: Page, id: string): Promise<void> {
  const invite = page.locator(`[data-invite-character='${id}']`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await invite.count()) return;
    const refresh = page.locator("[data-refresh-guests]");
    if (!(await refresh.isVisible())) break;
    await refresh.click();
  }
  throw new Error(`Guest ${id} did not appear after refreshing the candidate list`);
}

async function inviteCharacter(page: Page, id: string): Promise<void> {
  await ensureGuestCandidate(page, id);
  await page.locator(`[data-invite-character='${id}']`).click();
  await expect(page.locator("#profile")).toBeVisible();
}

async function waitForInitialDeal(page: Page): Promise<void> {
  await expect(page.locator(".player-zone .card")).toHaveCount(2, { timeout: 8_000 });
  await expect(page.locator(".skill-draw-modal")).toHaveCount(0);
}

async function startCharacter(page: Page, id: string): Promise<void> {
  await inviteCharacter(page, id);
  await page.locator("[data-profile-start]").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await waitForInitialDeal(page);
}

async function openLobbySettings(page: Page): Promise<void> {
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();
  await page.locator("button.lobby-settings-button").click();
}

async function returnToLobbyMenu(page: Page): Promise<void> {
  const back = page.locator("[data-lobby-home]");
  if (await back.isVisible()) await back.click();
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();
}

async function swipeTrophyGallery(page: Page, direction: "left" | "right"): Promise<void> {
  const box = await page.locator(".trophy-gallery-stage").boundingBox();
  if (!box) throw new Error("Trophy gallery stage is not visible");
  const startX = box.x + box.width * (direction === "left" ? .72 : .28);
  const endX = box.x + box.width * (direction === "left" ? .28 : .72);
  const y = box.y + box.height * .62;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 5 });
  await page.mouse.up();
}

async function putSaveRecord(page: Page, id: "long-term" | "runtime", data: unknown): Promise<void> {
  await page.evaluate(async ({ id: recordId, data: recordData }) => {
    const request = indexedDB.open("house-of-chances");
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("saves", "readwrite");
        transaction.objectStore("saves").put({ id: recordId, data: recordData });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, { id, data });
}

async function installRuntimeSave(page: Page, match: MatchState): Promise<void> {
  await putSaveRecord(page, "runtime", createRuntimeSave(match, "2026-08-30T00:00:00.000Z"));
  await page.reload();
}

async function installLongTermSave(page: Page, save: ReturnType<typeof createDefaultSave>): Promise<void> {
  await putSaveRecord(page, "long-term", save);
  await page.reload();
}

function version8LongTermSave(matchesPlayed = 0) {
  const current = createDefaultSave("2026-08-30T00:00:00.000Z");
  return {
    format: current.format,
    schemaVersion: 8,
    gameVersion: current.gameVersion,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
    profile: { id: current.profile.id, displayName: current.profile.displayName, matchesPlayed, wins: 1, talentIds: ["early-preparation"] },
    settings: current.settings,
    skipTutorial: true,
    history: current.history,
    defeats: current.defeats
  };
}

test("移动端大厅、结果停顿、逃离与确认返回", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "绝命之夜" })).toBeVisible();
  await expect(page.locator(".menu-subtitle")).toContainText("终焉赌局");
  await expect(page.locator(".lobby-menu-button")).toHaveCount(4);
  await expect(page.locator(".button-number")).toHaveCount(0);
  await expect(page.locator("button.lobby-settings-button")).toBeVisible();
  await expect(page.locator(".lobby-title-block")).not.toContainText("今夜，古堡只接待有求之人");
  await expect(page.locator(".character-card")).toHaveCount(0);
  await expect(page.locator(".lobby-title-block")).toContainText("奉上自己的一切，包括自己的身体");
  await expect(page.locator(".lobby-title-block")).toContainText("祂终将有求必应");
  const menuStyle = await page.locator(".lobby-menu-shell").evaluate((shell) => getComputedStyle(shell).backgroundImage);
  expect(menuStyle).toContain("castle-lobby-night.png");
  const buttonColors = new Set(await page.locator(".lobby-menu-button").evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).backgroundColor)));
  expect(buttonColors.size).toBeLessThanOrEqual(3);
  const shellBox = await page.locator(".lobby-menu-shell").boundingBox();
  const titleBox = await page.locator(".lobby-title-block").boundingBox();
  const menuBox = await page.locator(".lobby-menu").boundingBox();
  const primaryBox = await page.locator(".lobby-primary-action").boundingBox();
  const secondaryBox = await page.locator(".lobby-secondary-menu").boundingBox();
  expect(shellBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(primaryBox).not.toBeNull();
  expect(secondaryBox).not.toBeNull();
  expect(Math.abs(primaryBox!.width - secondaryBox!.width)).toBeLessThanOrEqual(1);
  expect(menuBox!.y - (titleBox!.y + titleBox!.height)).toBeGreaterThan(60);
  expect(menuBox!.height).toBeLessThan(shellBox!.height * .3);
  await page.screenshot({ path: testInfo.outputPath("lobby-menu-390.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("lobby-menu-320.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const forbiddenSafetyProp = String.fromCharCode(27700, 26538);
  expect(await page.locator("body").innerText()).not.toContain(forbiddenSafetyProp);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "玩法说明" }).click();
  await expect(page.locator("#rules").getByRole("heading", { name: "玩法说明" })).toBeVisible();
  await expect(page.locator("#rules")).toContainText("黑杰克");
  await page.locator("#rules [data-close]").click();
  await enterCharacterSelection(page);
  await expect(page.locator("button.lobby-settings-button")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "候场宾客" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "已死亡宾客" })).toBeVisible();
  await expect(page.locator(".guest-section:not(.defeated-section) .character-card")).toHaveCount(1);
  await expect(page.locator(".defeated-section .character-card")).toHaveCount(0);
  await expect(page.locator("[data-character-id='w'], [data-character-id='nian']")).toHaveCount(0);
  const initialCandidateIds = await page.locator(".guest-section:not(.defeated-section) .character-card").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId ?? ""));
  expect(initialCandidateIds).toEqual(["plume"]);
  await inviteCharacter(page, "plume");
  const profile = page.locator("#profile");
  await expect(profile).toContainText("翎羽");
  await expect(profile.locator(".profile-ability")).toHaveCount(0);
  expect(await profile.locator("#profile-content").evaluate((content) => {
    const description = content.querySelector(".profile-description");
    return Boolean(description);
  })).toBe(true);
  const profileStartBox = await profile.locator("[data-profile-start]").boundingBox();
  const profileContentBox = await profile.locator("#profile-content").boundingBox();
  expect(profileStartBox).not.toBeNull();
  expect(profileContentBox).not.toBeNull();
  expect(profileStartBox!.height).toBeGreaterThanOrEqual(60);
  expect(Math.abs(profileStartBox!.width - profileContentBox!.width)).toBeLessThanOrEqual(1);
  const plumeCard = page.locator("[data-character-id='plume']");
  const portraitBox = await plumeCard.locator(".portrait").boundingBox();
  const inviteBox = await plumeCard.locator("[data-invite-character]").boundingBox();
  expect(portraitBox).not.toBeNull();
  expect(inviteBox).not.toBeNull();
  expect(Math.abs((portraitBox!.y + portraitBox!.height) - (inviteBox!.y + inviteBox!.height))).toBeLessThanOrEqual(2);
  await expect(plumeCard.locator(".card-invite")).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await profile.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const profileFonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, title: getComputedStyle(document.querySelector(".lobby-title-block h1") ?? document.body).fontFamily, skill: getComputedStyle(document.querySelector(".profile-ability summary") ?? document.body).fontFamily }));
  expect(Object.values(profileFonts).every((font) => !/(songti|stsong|simsun|noto serif)/i.test(font))).toBe(true);
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  const dialogue = page.locator("#dialogue-text");
  await expect(dialogue).toHaveAttribute("data-typing", "true");
  await waitForInitialDeal(page);
  await expect(page.locator(".player-zone .card")).toHaveCount(2);
  await expect(page.locator(".table-shell .gun-row")).toHaveCount(0);
  await expect(page.locator(".table-shell .felt-divider")).toHaveCount(0);
  await expect(page.locator(".gun-status-row")).toHaveCount(2);
  const gunRows = await page.locator(".gun-status-row").evaluateAll((rows) => rows.map((row) => ({ icon: row.querySelector(".gun-icon")?.getBoundingClientRect().x, name: row.querySelector(".gun-name")?.getBoundingClientRect().x, chambers: row.querySelector(".gun-chambers")?.getBoundingClientRect().x })));
  expect(Math.abs((gunRows[0]?.icon ?? 0) - (gunRows[1]?.icon ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((gunRows[0]?.name ?? 0) - (gunRows[1]?.name ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((gunRows[0]?.chambers ?? 0) - (gunRows[1]?.chambers ?? 0))).toBeLessThanOrEqual(1);
  const gunRight = await page.locator(".gun-status-row").first().evaluate((row) => row.getBoundingClientRect().right);
  const tableActions = await page.locator(".table-actions").boundingBox();
  expect(tableActions).not.toBeNull();
  expect(Math.abs(gunRight - (tableActions!.x + tableActions!.width))).toBeLessThanOrEqual(2);
  const opponentFirstCard = await page.locator(".opponent-zone .cards .card").first().boundingBox();
  const playerFirstCard = await page.locator(".player-zone .cards .card").first().boundingBox();
  expect(opponentFirstCard).not.toBeNull();
  expect(playerFirstCard).not.toBeNull();
  expect(Math.abs(opponentFirstCard!.x - playerFirstCard!.x)).toBeLessThanOrEqual(1);
  expect(playerFirstCard!.x).toBeGreaterThanOrEqual(68);
  expect(playerFirstCard!.x).toBeLessThanOrEqual(72);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const playerLayout = await page.locator(".player-layout").boundingBox();
  const actionDock = await page.locator(".action-dock").boundingBox();
  const playerZone = await page.locator(".player-zone").boundingBox();
  expect(playerLayout).not.toBeNull();
  expect(actionDock).not.toBeNull();
  expect(playerZone).not.toBeNull();
  expect(actionDock!.y).toBeGreaterThanOrEqual(playerLayout!.y + playerLayout!.height);
  expect(Math.abs((actionDock!.x + actionDock!.width) - (playerZone!.x + playerZone!.width))).toBeLessThanOrEqual(1);
  const devHud = page.locator("details.dev-hud");
  if (await devHud.isVisible() && await devHud.getAttribute("open") !== null) await devHud.locator("summary").click();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2)).toBe(true);
  await expect(page.locator(".table-shell")).not.toContainText("7mm 左轮");
  await expect(dialogue).toHaveAttribute("data-typing", "false", { timeout: 5_000 });
  await expect(dialogue).not.toHaveText("");
  await page.locator("button[data-action*='ESCAPE_MATCH']").click();
  await expect(page.getByRole("heading", { name: "已离席" })).toBeVisible();
  await page.getByRole("button", { name: "返回大厅" }).click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
});

test("W 的技能信息栏显示动态领先数并可打开说明", async ({ page }) => {
  await page.goto("/");
  await installRuntimeSave(page, wInfoBarMatch());

  const infoBar = page.locator(".ai-info-bar");
  const bustLimit = page.locator(".bust-limit-indicator");
  await expect(infoBar).toContainText("W领先优势");
  await expect(infoBar.locator(".ai-info-number")).toHaveText("1");
  await expect(bustLimit).toHaveAccessibleName("当前爆牌上限：22");
  await expect(bustLimit).toContainText("爆牌上限22");
  const bustBox = await bustLimit.boundingBox();
  const noticeBox = await page.locator(".round-notice").boundingBox();
  expect(bustBox).not.toBeNull();
  expect(noticeBox).not.toBeNull();
  expect(bustBox!.x + bustBox!.width).toBeLessThanOrEqual(noticeBox!.x);
  const lastGunRow = page.locator(".gun-status-row").last();
  const gunBox = await lastGunRow.boundingBox();
  const infoBox = await infoBar.boundingBox();
  expect(gunBox).not.toBeNull();
  expect(infoBox).not.toBeNull();
  expect(infoBox!.y).toBeGreaterThanOrEqual(gunBox!.y + gunBox!.height);

  await infoBar.getByRole("button", { name: "查看W领先优势说明" }).click();
  const dialog = page.locator("#ai-info-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "W领先优势" })).toBeVisible();
  await expect(dialog).toContainText("双方爆牌上限");
  await expect(dialog.locator(".ai-info-number")).toHaveText("1");
  await dialog.getByRole("button", { name: "关闭机制信息说明" }).click();
  await expect(dialog).not.toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("艾丽妮的信息栏显示本轮实际哑火概率", async ({ page }) => {
  await page.goto("/");
  await installRuntimeSave(page, ireneInfoBarMatch());

  const infoBar = page.locator(".ai-info-bar");
  await expect(infoBar).toContainText("本轮哑火概率");
  await expect(infoBar.locator(".ai-info-number")).toHaveText("66%");
  await infoBar.getByRole("button", { name: "查看本轮哑火概率说明" }).click();
  const dialog = page.locator("#ai-info-dialog");
  await expect(dialog).toContainText("策展人本轮每次 Hit 会增加手枪33%的哑火概率");
  await expect(dialog.locator(".ai-info-number")).toHaveText("66%");
});

test("剑与手炮在心跳等待窗口提前提示当前哑火概率", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "irene-misfire-window.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, ireneMisfireRevealMatch());

  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-trigger");
  const notice = page.locator("#ability-notices .ability-notice-ai");
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("艾丽妮发动「剑与手炮」：本轮哑火概率为66%");

  await page.getByRole("button", { name: "静观好戏" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-result");
  await expect(notice).toHaveCount(1);
});

test("拉普兰德的信息栏显示当前狂欢指标并说明两项机制", async ({ page }) => {
  await page.goto("/");
  await installRuntimeSave(page, lapplandInfoBarMatch());

  const infoBar = page.locator(".ai-info-bar");
  await expect(page.locator(".character-strip .eyebrow")).toContainText("拉普兰德 // S级");
  await expect(page.locator("img.character-portrait")).toHaveAttribute("src", /lappland-the-decadenza-(?:relaxed|conflicted|mocking)\.png/);
  await expect(infoBar).toContainText("狂欢指标");
  await expect(infoBar.locator(".ai-info-number")).toHaveText("19");
  await infoBar.getByRole("button", { name: "查看狂欢指标说明" }).click();
  const dialog = page.locator("#ai-info-dialog");
  await expect(dialog).toContainText("策展人达到指标会获得1点优势");
  await expect(dialog).toContainText("拉普兰德达到指标后，双方爆牌上限提高2点");
  await expect(dialog.locator(".ai-info-number")).toHaveText("19");
});

test("行动阶段实时展示点数优势，结算时保留拆分并隐藏零加成", async ({ page }) => {
  await page.goto("/");
  await installRuntimeSave(page, liveComparisonScoreDisplayMatch());

  const livePlayerScore = page.locator(".player-zone .hand-score");
  const liveOpponentScore = page.locator(".opponent-zone .hand-score");
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "turns");
  await expect(livePlayerScore).toHaveText("17");
  await expect(livePlayerScore.locator(".hand-score-modifier")).toHaveCount(0);
  await expect(liveOpponentScore).toHaveText("10+2");
  await expect(liveOpponentScore).toHaveAccessibleName("10加2，当前点数12");
  await page.getByRole("button", { name: "Hit 要牌" }).click();
  await expect(livePlayerScore).toHaveText("19");
  await expect(liveOpponentScore).toHaveText("10");
  await expect(liveOpponentScore.locator(".hand-score-modifier")).toHaveCount(0);

  await installRuntimeSave(page, comparisonScoreDisplayMatch());

  const playerScore = page.locator(".player-zone .hand-score");
  const opponentScore = page.locator(".opponent-zone .hand-score");
  await expect(playerScore).toHaveText("17");
  await expect(playerScore.locator(".hand-score-modifier")).toHaveCount(0);
  await expect(opponentScore.locator(".hand-score-base")).toHaveText("18");
  await expect(opponentScore.locator(".hand-score-modifier")).toHaveText("+2");
  await expect(opponentScore).toHaveAccessibleName("18加2，当前点数20");

  const fontSizes = await opponentScore.evaluate((score) => ({
    base: Number.parseFloat(getComputedStyle(score.querySelector(".hand-score-base")!).fontSize),
    modifier: Number.parseFloat(getComputedStyle(score.querySelector(".hand-score-modifier")!).fontSize)
  }));
  expect(fontSizes.modifier).toBeLessThan(fontSizes.base);
});

test("霍尔海雅的信息栏以花色在前并按红黑牌色显示记忆牌", async ({ page }) => {
  await page.goto("/");
  await installRuntimeSave(page, hoOlheyakInfoBarMatch());

  const infoBar = page.locator(".ai-info-bar");
  await expect(infoBar).toContainText("记忆牌");
  const rememberedCard = infoBar.locator(".ai-info-card");
  await expect(rememberedCard.locator("em")).toHaveText("♥");
  await expect(rememberedCard.locator("b")).toHaveText("4");
  await expect(rememberedCard.locator(".card-marker")).toHaveCount(0);
  await expect(rememberedCard).not.toContainText("◇");
  const faceOrder = await rememberedCard.evaluate((card) => ({
    suit: card.querySelector("em")!.getBoundingClientRect().x,
    rank: card.querySelector("b")!.getBoundingClientRect().x
  }));
  expect(faceOrder.suit).toBeLessThan(faceOrder.rank);
  const appearance = await rememberedCard.evaluate((element) => {
    const style = getComputedStyle(element);
    const suit = getComputedStyle(element.querySelector("em")!);
    const box = element.getBoundingClientRect();
    return { opacity: style.opacity, color: style.color, suitSize: Number.parseFloat(suit.fontSize), width: box.width, height: box.height };
  });
  expect(appearance.opacity).toBe("1");
  expect(appearance.color).toBe("rgb(201, 47, 78)");
  expect(appearance.suitSize).toBeGreaterThanOrEqual(14);
  expect(appearance.width).toBeGreaterThanOrEqual(43);
  expect(appearance.width).toBeLessThan(58);
  expect(appearance.height).toBe(24);
  await expect(rememberedCard).not.toHaveClass(/(?:^|\s)card(?:\s|$)/);

  await installRuntimeSave(page, hoOlheyakInfoBarMatch("spades"));
  const blackCard = page.locator(".ai-info-bar .ai-info-card.black");
  await expect(blackCard.locator("em")).toHaveText("♠");
  await expect(blackCard).toHaveCSS("color", "rgb(21, 26, 30)");
});

test("多萝西的信息栏显示共振花色且牌面实时计入共振优势", async ({ page }) => {
  const match = dorothyInfoBarMatch();
  const status = match.abilities.statuses.find((entry) => entry.statusDefinitionId === "dorothy-resonance-suit")!;
  const suit = status.parameters.suit as "spades" | "hearts" | "diamonds" | "clubs";
  const labels = { spades: "黑桃", hearts: "红桃", diamonds: "方块", clubs: "梅花" } as const;
  const symbols = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" } as const;
  const opponentCount = match.opponent.hand.cards.filter((card) => card.attributes.suit === suit).length;
  expect(opponentCount).toBe(Math.max(...Object.keys(labels).map((candidate) => match.opponent.hand.cards.filter((card) => card.attributes.suit === candidate).length)));
  await page.goto("/");
  await installRuntimeSave(page, match);

  const infoBar = page.locator(".ai-info-bar");
  await expect(infoBar).toContainText("共振牌");
  await expect(infoBar.locator(".ai-info-suit > span")).toHaveText(symbols[suit]);
  await expect(infoBar.locator(".ai-info-suit small")).toHaveText(labels[suit]);
  await expect(page.locator(".opponent-zone .hand-score-modifier")).toHaveText(`+${opponentCount * 2}`);
  for (const card of [...match.player.hand.cards, ...match.opponent.hand.cards]) {
    const marker = page.locator(`[data-card-id="${card.id}"] .card-marker-resonance`);
    await expect(marker).toHaveCount(card.attributes.suit === suit ? 1 : 0);
  }
  const hiddenResonance = match.opponent.hand.cards[1]!;
  const hiddenResonanceCard = page.locator(`[data-card-id="${hiddenResonance.id}"]`);
  await expect(hiddenResonanceCard).toHaveClass(/card-back/);
  await expect(hiddenResonanceCard).toHaveAttribute("aria-label", "牌背，共振牌");
  await expect(hiddenResonanceCard.locator(".card-marker-resonance")).toHaveText("◇");
  await expect(hiddenResonanceCard).not.toContainText(hiddenResonance.attributes.rank);
  await infoBar.getByRole("button", { name: "查看共振牌说明" }).click();
  await expect(page.locator("#ai-info-dialog")).toContainText("双方每持有一张该花色手牌，各自获得2点点数优势");
});

test("牌堆状态栏使用未知 compact 牌并随实体牌堆顶更新", async ({ page }) => {
  await page.goto("/");
  const match = wInfoBarMatch();
  const firstCard = match.shoe.cards[match.shoe.cursor]!;
  const secondCard = match.shoe.cards[match.shoe.cursor + 1]!;
  const initialRemaining = match.shoe.cards.length - match.shoe.cursor;
  await installRuntimeSave(page, match);

  const tableActions = page.locator(".table-actions");
  const statusOrder = await tableActions.evaluate((actions) => Array.from(actions.children)
    .filter((element) => element.tagName === "SECTION")
    .map((section) => section.className));
  expect(statusOrder).toEqual(["roulette-status", "shoe-status", "ai-info-bar"]);

  const shoeStatus = page.locator(".shoe-status");
  const compactCard = shoeStatus.locator(".card-compact");
  await expect(shoeStatus.locator(".shoe-status-label")).toHaveText("牌库");
  await expect(shoeStatus.locator(".shoe-status-arrow")).toHaveCount(0);
  await expect(shoeStatus.locator(".shoe-status-next-label")).toHaveText("next：");
  const alignment = await shoeStatus.evaluate((status) => ({
    label: status.querySelector<HTMLElement>(".shoe-status-label")!.getBoundingClientRect().left,
    next: status.querySelector<HTMLElement>(".shoe-status-next")!.getBoundingClientRect().left,
    innerLeft: status.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(status).paddingLeft)
  }));
  expect(Math.abs(alignment.label - alignment.innerLeft)).toBeLessThanOrEqual(1);
  expect(alignment.next).toBeGreaterThan(alignment.label);
  await expect(shoeStatus).not.toContainText(`×${initialRemaining}`);
  await expect(compactCard).toHaveAttribute("data-card-id", firstCard.id);
  await expect(compactCard.locator(".card-unknown")).toHaveText("??");
  await expect(compactCard).toHaveClass(/neutral/);
  await expect(compactCard).not.toHaveClass(/(?:^|\s)(?:red|black)(?:\s|$)/);
  await expect(compactCard).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(compactCard.locator(".card-rank, .card-suit")).toHaveCount(0);
  await expect(shoeStatus).toHaveAccessibleName(`牌库：下一张牌点数未知，花色未知，剩余 ${initialRemaining} 张`);

  const widths = await tableActions.evaluate((actions) => {
    const roulette = actions.querySelector<HTMLElement>(".roulette-status")!;
    const shoe = actions.querySelector<HTMLElement>(".shoe-status")!;
    const info = actions.querySelector<HTMLElement>(".ai-info-bar")!;
    return [roulette, shoe, info].map((element) => element.getBoundingClientRect().width);
  });
  expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThanOrEqual(1);
  expect(Math.abs(widths[1]! - widths[2]!)).toBeLessThanOrEqual(1);
  const palette = await tableActions.evaluate((actions) => {
    const gun = getComputedStyle(actions.querySelector<HTMLElement>(".gun-status-row")!);
    const shoe = getComputedStyle(actions.querySelector<HTMLElement>(".shoe-status")!);
    return {
      gun: [gun.backgroundColor, gun.borderTopColor],
      shoe: [shoe.backgroundColor, shoe.borderTopColor]
    };
  });
  expect(palette.shoe).toEqual(palette.gun);

  await shoeStatus.getByRole("button", { name: "查看牌库说明" }).click();
  const shoeDialog = page.locator("#shoe-info-dialog");
  await expect(shoeDialog).toBeVisible();
  await expect(shoeDialog.getByRole("heading", { name: "牌库" })).toBeVisible();
  await expect(shoeDialog.locator(".shoe-info-copy")).toHaveText("UI中的next指的是下一次hit后发出的牌，你可以用各种手段尝试揭开它的面纱。牌堆总大小为52张扑克牌（即不带大小王的一副扑克牌）。开局时洗匀整副牌，此后每轮开始前，在牌堆剩余少于 12 张时，从弃牌堆回收所有牌，并重新洗匀。");
  await shoeDialog.getByRole("button", { name: "关闭牌库说明" }).click();
  await expect(shoeDialog).not.toBeVisible();

  await page.getByRole("button", { name: "Hit 要牌" }).click();
  await expect(compactCard).toHaveAttribute("data-card-id", secondCard.id);
  await expect(shoeStatus).toHaveAccessibleName(`牌库：下一张牌点数未知，花色未知，剩余 ${initialRemaining - 1} 张`);
});

test("偷梁换柱塞回牌库顶的手牌保持点数与花色已知", async ({ page }) => {
  await page.goto("/");
  const match = switcherooKnowledgeMatch();
  const outgoing = match.player.hand.cards.at(-1)!;
  const remaining = match.shoe.cards.length - match.shoe.cursor;
  const suitNames = { spades: "黑桃", hearts: "红桃", diamonds: "方块", clubs: "梅花" } as const;
  const suitSymbols = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" } as const;
  await installRuntimeSave(page, match);

  await page.locator(".skill-drawer-toggle").click();
  await page.getByRole("button", { name: "使用偷梁换柱" }).click();

  const shoeStatus = page.locator(".shoe-status");
  const compactCard = shoeStatus.locator(".card-compact");
  await expect(compactCard).toHaveAttribute("data-card-id", outgoing.id);
  await expect(compactCard.locator(".card-rank")).toHaveText(outgoing.attributes.rank);
  await expect(compactCard.locator(".card-suit")).toHaveText(suitSymbols[outgoing.attributes.suit]);
  await expect(shoeStatus).toHaveAccessibleName(`牌库：下一张牌点数为${outgoing.attributes.rank}，花色为${suitNames[outgoing.attributes.suit]}，剩余 ${remaining} 张`);
});

test("早有准备提供一次主动抽卡且单击候选立即确认", async ({ page }) => {
  await page.goto("/?debug=1");
  const tutorialMatch = earlyPreparationDrawMatch();
  const beforePlayerCanAct: MatchState = {
    ...tutorialMatch,
    round: {
      ...tutorialMatch.round,
      phase: "round-reveal",
      currentActor: null,
      outcome: { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0 }
    }
  };
  await installRuntimeSave(page, beforePlayerCanAct);
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#tutorial-popover")).toHaveCount(0);
  await installRuntimeSave(page, tutorialMatch);
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  const tutorial = page.locator("#tutorial-popover");
  await expect(tutorial).toBeVisible();
  await expect(tutorial.getByRole("heading")).toHaveText("技能抽卡系统");
  await expect(tutorial).toContainText("机制介绍：page 1/1");
  await expect(tutorial).toContainText("你的对手会作弊，但你也可以。点击右下角的金色按钮抽取你的技能卡。");
  await expect(tutorial.getByRole("button")).toHaveCount(2);
  await expect(tutorial.getByRole("button", { name: "跳过" })).toBeVisible();
  await tutorial.getByRole("button", { name: "好的" }).click();
  await expect(tutorial).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open("house-of-chances");
    return new Promise<string[]>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("saves", "readonly");
        const get = transaction.objectStore("saves").get("long-term");
        get.onsuccess = () => resolve((get.result as { data: { tutorialProgress: { completedIds: string[] } } }).data.tutorialProgress.completedIds);
        get.onerror = () => reject(get.error);
      };
    });
  })).toContain("skill-draw-system");
  await installRuntimeSave(page, tutorialMatch);
  await expect(tutorial).toHaveCount(0);
  const drawButton = page.locator(".draw-skill-button");
  await expect(drawButton).toBeEnabled();
  await expect(drawButton).toHaveAttribute("aria-label", "抽取技能，剩余 1 次");
  await expect(drawButton.locator(".draw-skill-badge")).toHaveText("1");
  await drawButton.click();
  const offer = page.locator(".skill-draw-modal");
  await expect(offer.getByRole("heading")).toHaveText("选一张你心仪的技能卡");
  await expect(offer.locator(".skill-draw-card")).toHaveCount(3);
  expect((await offer.locator(".skill-draw-card > small").allTextContents()).every((domain) => ["赌徒", "老千", "情报官", "枪手"].includes(domain))).toBe(true);
  await expect(offer.getByRole("button", { name: /放弃|确认/ })).toHaveCount(0);
  await offer.locator(".skill-draw-card").first().click();
  await expect(offer).toHaveCount(0);
  const initialMatchDebug = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { playerSkills: { cards: string[]; drawCount: number }; talentIds: string[] } };
  expect(initialMatchDebug.relevantMatchState.playerSkills.cards).toHaveLength(1);
  expect(initialMatchDebug.relevantMatchState.playerSkills.drawCount).toBe(0);
  expect(initialMatchDebug.relevantMatchState.talentIds).toContain("early-preparation");
  await expect(page.locator("#skill-gain-announcement")).toHaveCount(0);
  const abilityNotices = page.locator("#ability-notices");
  if (await abilityNotices.count()) expect(await abilityNotices.textContent()).not.toContain("获得技能牌");
});

test("教程底部细条走满十秒后自动渐隐并完成教程", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-30T00:00:00.000Z") });
  await page.goto("/");
  await installRuntimeSave(page, earlyPreparationDrawMatch());

  const tutorial = page.locator("#tutorial-popover");
  const progress = tutorial.locator(".tutorial-auto-progress");
  await expect(tutorial).toBeVisible();
  await expect(progress).toHaveCount(1);
  const progressStyle = await progress.evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: style.height, border: style.borderStyle, background: style.backgroundImage, duration: style.animationDuration };
  });
  expect(progressStyle.height).toBe("2px");
  expect(progressStyle.border).toBe("none");
  expect(progressStyle.background).toContain("linear-gradient");
  expect(progressStyle.duration).toBe("10s");

  await page.clock.runFor(10_050);
  await expect(tutorial).toHaveClass(/is-auto-dismissing/);
  await page.clock.runFor(500);
  await expect(tutorial).toHaveCount(0);
});

test("点击教程非跳过区域可打断自动渐隐并停止自动跳过", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-30T00:00:00.000Z") });
  await page.goto("/");
  await installRuntimeSave(page, earlyPreparationDrawMatch());

  const tutorial = page.locator("#tutorial-popover");
  const progress = tutorial.locator(".tutorial-auto-progress");
  await expect(tutorial).toBeVisible();
  await page.clock.runFor(10_050);
  await expect(tutorial).toHaveClass(/is-auto-dismissing/);
  await tutorial.locator("p").dispatchEvent("click");
  await expect(tutorial).not.toHaveClass(/is-auto-dismissing/);
  await expect(tutorial).toHaveClass(/is-auto-skip-cancelled/);
  await expect(progress).toHaveCSS("animation-play-state", "paused");
  await page.clock.runFor(20_000);
  await expect(tutorial).toBeVisible();

  await tutorial.getByRole("button", { name: "跳过" }).click();
  await expect(tutorial).toHaveCount(0);
});

test("技能通知按最新在上堆叠并独立过期", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "ability-toast.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, abilityToastMatch());
  await expect(page.locator("main.table-shell")).toBeVisible();

  await page.locator(".skill-drawer-toggle").click();
  const hunter = page.locator(".skill-card[data-skill-id='critical-judgment']");
  const scent = page.locator(".skill-card[data-skill-id='scent-of-a-woman']");
  await hunter.click();
  const playerToasts = page.locator("#ability-notices .ability-notice-player");
  await expect(playerToasts).toHaveCount(1);
  await page.waitForTimeout(120);
  await scent.click();
  await expect(playerToasts).toHaveCount(2);
  const texts = await playerToasts.allTextContents();
  expect(texts[0]).toContain("闻香识女人");
  expect(texts[1]).toContain("临界判断");
  const hunterToast = playerToasts.filter({ hasText: "临界判断" });
  const scentToast = playerToasts.filter({ hasText: "闻香识女人" });
  const hunterLeaving = hunterToast.evaluate((element) => new Promise<void>((resolve) => {
    if (element.classList.contains("leaving")) { resolve(); return; }
    const observer = new MutationObserver(() => {
      if (!element.classList.contains("leaving")) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(element, { attributes: true, attributeFilter: ["class"] });
  }));
  await page.getByRole("button", { name: /Stand 停牌/ }).click();
  const aiToast = page.locator("#ability-notices .ability-notice-ai");
  await expect(aiToast).toHaveCount(1, { timeout: 1_000 });
  const aiStyle = await aiToast.evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderTopColor, text: style.color, background: style.backgroundColor };
  });
  const playerStyle = await playerToasts.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderTopColor, text: style.color, background: style.backgroundColor };
  });
  expect(["border", "text", "background"].some((key) => aiStyle[key as keyof typeof aiStyle] !== playerStyle[key as keyof typeof playerStyle])).toBe(true);

  await hunterLeaving;
  await expect(hunterToast).toHaveCount(0, { timeout: 1_000 });
  await expect(scentToast).toHaveCount(1);
  await expect(scentToast).toHaveCount(0, { timeout: 1_000 });
});

test("新版猎手直觉获得后只揭示当前牌堆顶的花色", async ({ page }) => {
  const imported = createDefaultSave("2026-09-08T00:00:00.000Z");
  const source = findTurnsMatch("hunter-rework-ui");
  const activeMatch: MatchState = {
    ...source,
    round: { ...source.round, currentActor: "player" },
    playerSkills: {
      ...source.playerSkills,
      unlockedDefinitionIds: [...new Set([...source.playerSkills.unlockedDefinitionIds, "hunter-instinct"])],
      drawCount: 1,
      drawOffer: { id: "hunter-rework-offer", candidateDefinitionIds: ["hunter-instinct"] }
    }
  };
  imported.settings.reducedMotion = true;
  await page.goto("/?debug=1");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "hunter-rework.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await page.locator(".skill-draw-card", { hasText: "猎手直觉" }).click();

  await expect(page.locator(".shoe-status .card-suit")).toHaveCount(1);
  await expect(page.locator(".shoe-status .card-rank")).toHaveText("?");
  await expect(page.locator(".skill-sidebar .passive-card"), "Hunter Instinct should now be a passive card").toContainText("猎手直觉");
  const debug = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: MatchState };
  expect(debug.relevantMatchState.history).toContainEqual(expect.objectContaining({ type: "DRAW_PILE_CARD_SUIT_REVEALED", viewer: "player" }));
});

test("技能通知位于人物机制槽下方且不溢出小屏", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "ability-toast-position.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, abilityToastMatch());
  await expect(page.locator(".ai-info-bar")).toBeVisible();
  await page.locator(".skill-drawer-toggle").click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 320) await expect(page.locator("#ability-notices .ability-notice")).toHaveCount(0, { timeout: 4_000 });
    await page.locator(`.skill-card[data-skill-id='${viewport.width === 390 ? "critical-judgment" : "scent-of-a-woman"}']`).click();
    const geometry = await page.locator("#ability-notices").evaluate((container) => {
      const toast = container.querySelector<HTMLElement>(".ability-notice");
      const anchor = document.querySelector<HTMLElement>(".ai-info-bar");
      if (!toast || !anchor) throw new Error("Ability notice or info bar is missing");
      const toastRect = container.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      return { top: toastRect.top, left: toastRect.left, right: toastRect.right, anchorBottom: anchorRect.bottom, viewportWidth: window.innerWidth };
    });
    expect(geometry.top - geometry.anchorBottom).toBeGreaterThanOrEqual(6);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
  }
});

test("技能牌库满时保留抽卡次数并禁用抽取按钮", async ({ page }) => {
  const source = findTurnsMatch("full-skill-draw-ui");
  const cards = Array.from({ length: 10 }, (_, index) => ({
    kind: "player-skill" as const,
    definitionId: "critical-judgment",
    owner: "player" as const,
    instanceId: `full-skill-draw-${index}`
  }));
  const baseSequence = source.abilities.sequence;
  const activeMatch: MatchState = {
    ...source,
    round: { ...source.round, phase: "turns", currentActor: "player" },
    playerSkills: { ...source.playerSkills, cards, drawCount: 3, drawOffer: null },
    abilities: {
      ...source.abilities,
      instances: [
        ...source.abilities.instances.filter((instance) => instance.kind !== "player-skill"),
        ...cards.map((card, index) => ({ ...card, createdAtSequence: baseSequence + index + 1, parameters: {} }))
      ],
      sequence: baseSequence + cards.length
    }
  };
  await page.goto("/");
  await installRuntimeSave(page, activeMatch);
  const drawButton = page.locator(".draw-skill-button");
  await expect(drawButton).toBeDisabled();
  await expect(drawButton).toHaveAttribute("aria-label", "抽取技能，剩余 3 次");
  await expect(drawButton.locator(".draw-skill-badge")).toHaveText("3");
  await expect(page.locator(".skill-draw-modal")).toHaveCount(0);
});

test("大厅仅加载轻量目录并按需载入所选角色定义", async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requestedPaths.push(decodeURIComponent(`${url.pathname}${url.search}`));
  });
  await page.goto("/");
  await installLongTermSave(page, saveWithDefeats("plume", "lappland-the-decadenza"));
  await expect(page.locator(".character-card")).toHaveCount(0);
  await enterCharacterSelection(page);
  await expect(page.locator(".guest-section:not(.defeated-section) .character-card")).toHaveCount(3);
  expect(requestedPaths.some((path) => path.includes("/content/characters/data/"))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/cimei\.json|\/assets\/cimei-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/nian\.json|\/assets\/nian-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/plume\.json|\/assets\/plume-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/platinum\.json|\/assets\/platinum-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/lappland-the-decadenza\.json|\/assets\/lappland-the-decadenza-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /texas-(conflicted|mocking|threatened|unconscious|defeated-summary)/.test(path))).toBe(false);
  await startCharacter(page, "texas");
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/texas\.json|\/assets\/texas-[^/]+\.js)(?:\?|$)/.test(path))).toBe(true);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/w\.json|\/assets\/w-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/nian\.json|\/assets\/nian-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/plume\.json|\/assets\/plume-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/(?:platinum|lappland-the-decadenza)\.json|\/assets\/(?:platinum|lappland-the-decadenza)-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);

  await page.locator("button[data-action*='ESCAPE_MATCH']").click();
  await expect(page.getByRole("heading", { name: "已离席" })).toBeVisible();
  await page.getByRole("button", { name: "返回大厅" }).click();
  await enterCharacterSelection(page);
  await expect(page.locator(".guest-section:not(.defeated-section) .character-card")).toHaveCount(3);
  const ireneRequestedPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    ireneRequestedPaths.push(decodeURIComponent(`${url.pathname}${url.search}`));
  });
  await startCharacter(page, "irene");
  expect(ireneRequestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(true);
  expect(ireneRequestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/(?:w|texas|cimei|nian|plume|platinum|lappland-the-decadenza)\.json|\/assets\/(?:w|texas|cimei|nian|plume|platinum|lappland-the-decadenza)-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
});

test("刺玫在击败三名不同对手后解锁并可进入牌桌", async ({ page }) => {
  const imported = saveWithDefeats("plume", "irene");
  imported.settings.reducedMotion = true;
  const activeMatch = playerWinSummary("texas");
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "cimei-unlock.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);

  const unlockPanel = page.locator(".character-unlock-panel");
  await expect(unlockPanel).toContainText("刺玫");
  await expect(unlockPanel).toContainText("击败 3 名不同与会者");
  await page.getByRole("button", { name: "返回大厅" }).click();
  await enterCharacterSelection(page);
  await ensureGuestCandidate(page, "cimei");
  await inviteCharacter(page, "cimei");
  await expect(page.locator("#profile")).toContainText("温室守着最后一株白玫瑰");
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.locator("#profile").evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  await page.locator("#profile [data-profile-start]").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".character-portrait")).toHaveAttribute("src", /cimei-relaxed\.png/);
  await expect.poll(() => page.locator(".character-portrait").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1536);
});

test("提丰在击败五名不同对手后解锁且显示永恒狩猎", async ({ page }) => {
  const imported = saveWithDefeats("plume", "irene", "texas", "w");
  imported.settings.reducedMotion = true;
  const activeMatch = playerWinSummary("nian");
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "typhon-unlock.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);

  const unlockPanel = page.locator(".character-unlock-panel");
  await expect(unlockPanel).toContainText("提丰");
  await expect(unlockPanel).toContainText("击败 5 名不同与会者");
  await page.getByRole("button", { name: "返回大厅" }).click();
  await enterCharacterSelection(page);
  await ensureGuestCandidate(page, "typhon");
  await inviteCharacter(page, "typhon");
  await expect(page.locator("#profile")).toContainText("萨米猎人，萨卡兹族，感染者");
  await expect(page.locator("#profile .profile-ability")).toHaveCount(1);
  await expect(page.locator("#profile .profile-ability summary strong")).toHaveText("永恒狩猎");
  await page.locator("#profile [data-profile-start]").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".character-portrait")).toHaveAttribute("src", /typhon-relaxed\.png/);
  await expect.poll(() => page.locator(".character-portrait").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1536);
});

test("首次胜利会显示第一阶段角色解锁，刷新候场时确保换人", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = playerWinSummary("texas");
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "character-unlock-summary.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);

  const unlockPanel = page.locator(".character-unlock-panel");
  await expect(unlockPanel).toContainText("新角色已解锁");
  await expect(unlockPanel).toContainText("W");
  await expect(unlockPanel).toContainText("艾丽妮");
  await expect(unlockPanel).toContainText("拉普兰德");
  await expect(unlockPanel).toContainText("击败任意角色");
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("character-unlock-summary-320.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回大厅" }).click();
  await enterCharacterSelection(page);

  const candidates = page.locator(".guest-section:not(.defeated-section) .character-card");
  const defeated = page.locator(".defeated-section .character-card");
  await expect(candidates).toHaveCount(3);
  await expect(defeated).toHaveCount(1);
  await expect(defeated).toHaveAttribute("data-character-id", "texas");
  await expect(defeated.locator("[data-invite-character]")).toHaveCount(1);
  const before = (await candidates.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId ?? ""))).sort();
  await page.getByRole("button", { name: "刷新候场宾客" }).click();
  const after = (await candidates.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId ?? ""))).sort();
  expect(after).not.toEqual(before);
  const availableAfterTexas = new Set(["w", "irene", "plume", "platinum", "lappland-the-decadenza"]);
  expect([...before, ...after].every((id) => availableAfterTexas.has(id))).toBe(true);
  expect(new Set([...before, ...after]).size).toBeGreaterThanOrEqual(4);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("guest-selection-unlocked-320.png"), fullPage: true });
});

test("已击败宾客按首次胜利时间倒序排列且可以再次邀请", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.history = [
    victoryRecord("irene-late", "irene", "2026-08-30T12:00:00.000Z"),
    victoryRecord("texas-first", "texas", "2026-08-29T12:00:00.000Z"),
    victoryRecord("texas-repeat", "texas", "2026-08-31T12:00:00.000Z")
  ];
  imported.defeats = [
    { opponentId: "irene", timestamp: "2026-08-30T12:00:00.000Z" },
    { opponentId: "texas", timestamp: "2026-08-29T12:00:00.000Z" }
  ];
  imported.profile = { ...imported.profile, matchesPlayed: 3, wins: 3 };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "defeated-guests.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await enterCharacterSelection(page);

  const candidateIds = await page.locator(".guest-section:not(.defeated-section) .character-card").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId));
  expect(candidateIds).toHaveLength(3);
  expect(candidateIds.every((id) => id !== undefined && ["w", "nian", "plume", "platinum", "lappland-the-decadenza"].includes(id))).toBe(true);
  const defeatedCards = page.locator(".defeated-section .character-card");
  await expect(defeatedCards).toHaveCount(2);
  expect(await defeatedCards.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId))).toEqual(["irene", "texas"]);
  await expect(defeatedCards.locator("[data-invite-character]")).toHaveCount(2);
  await defeatedCards.first().locator("[data-invite-character='irene']").click();
  await expect(page.locator("#profile")).toContainText("已经成为了一具尸体");
  await expect(page.locator("#profile [data-profile-start]")).toHaveCount(1);
  await page.locator("#profile [data-profile-start]").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
});

test("已击败宾客向下滚动时每批懒加载三名", async ({ page }) => {
  const imported = createDefaultSave("2026-09-01T00:00:00.000Z");
  const defeatedIds = ["plume", "w", "texas", "irene", "nian", "platinum", "lappland-the-decadenza", "ho-olheyak"];
  imported.defeats = defeatedIds.map((opponentId, index) => ({
    opponentId,
    timestamp: new Date(Date.UTC(2026, 8, index + 1)).toISOString()
  }));
  imported.profile = { ...imported.profile, matchesPlayed: defeatedIds.length, wins: defeatedIds.length };
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "lazy-defeated-guests.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await enterCharacterSelection(page);

  const defeatedCards = page.locator(".defeated-section .character-card");
  await expect(defeatedCards).toHaveCount(3);
  expect(await defeatedCards.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId))).toEqual([
    "ho-olheyak", "lappland-the-decadenza", "platinum"
  ]);
  await expect(page.locator("[data-load-more-defeated]")).toHaveAttribute("aria-label", /剩余 5 名/);

  await page.locator("[data-load-more-defeated]").evaluate((element) => element.scrollIntoView());
  await expect(defeatedCards).toHaveCount(6);
  await expect(page.locator("[data-load-more-defeated]")).toHaveAttribute("aria-label", /剩余 2 名/);
  await page.locator("[data-load-more-defeated]").evaluate((element) => element.scrollIntoView());
  await expect(defeatedCards).toHaveCount(8);
  expect(await defeatedCards.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId))).toEqual([
    "ho-olheyak", "lappland-the-decadenza", "platinum", "nian", "irene", "texas", "w", "plume"
  ]);
  await expect(page.locator("[data-load-more-defeated]")).toHaveCount(0);
});

test("年在击败 S 级角色后显示解离式档案并按需载入", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.history = [
    victoryRecord("unlock-w", "w", "2026-08-28T00:00:00.000Z")
  ];
  imported.defeats = [
    { opponentId: "w", timestamp: "2026-08-28T00:00:00.000Z" }
  ];
  imported.profile = { ...imported.profile, matchesPlayed: 1, wins: 1 };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "unlocked-nian.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await enterCharacterSelection(page);
  await expect(page.locator(".guest-section:not(.defeated-section) .character-card")).toHaveCount(3);
  await inviteCharacter(page, "nian");
  const profile = page.locator("#profile");
  await expect(profile).toContainText("年");
  await expect(profile.locator(".profile-ability")).toHaveCount(2);
  await expect(profile.locator(".profile-ability summary")).toContainText(["锡灼", "洪炉示岁"]);
  await expect(profile.locator("#profile-content")).toHaveText(/\S+/);
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await waitForInitialDeal(page);
  await expect(page.locator(".character-strip .eyebrow")).toContainText("年 // S级");
  await expect(page.locator("img.character-portrait")).toHaveAttribute("src", /nian-(?:relaxed|conflicted|mocking)\.png/);
});

test("正式角色档案显示各自已启用技能", async ({ page }) => {
  await page.goto("/");
  await installLongTermSave(page, saveWithDefeats("plume", "lappland-the-decadenza"));
  await enterCharacterSelection(page);
  for (const [id, names] of [
    ["texas", ["细雨无声"]],
    ["irene", ["剑与手炮"]],
    ["lappland-the-decadenza", ["狂欢指标", "狂欢升温"]]
  ] as const) {
    await inviteCharacter(page, id);
    const profile = page.locator("#profile");
    await expect(profile.locator(".profile-ability")).toHaveCount(names.length);
    await expect(profile.locator(".profile-ability summary strong")).toHaveText([...names]);
    await profile.locator("[data-close]").click();
  }
});

test("翎羽作为 B 级无机制角色显示档案并按需载入", async ({ page }, testInfo) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => requestedPaths.push(decodeURIComponent(new URL(request.url()).pathname)));
  await page.goto("/");
  await enterCharacterSelection(page);
  await ensureGuestCandidate(page, "plume");
  const card = page.locator("[data-character-id='plume']");
  const previewFrame = card.locator(".portrait");
  const preview = previewFrame.locator("img.scaled-character-art");
  await expect(preview).toHaveCSS("--character-art-scale", "1.3");
  await expect(previewFrame).toHaveCSS("overflow", "hidden");
  await card.scrollIntoViewIfNeeded();
  await expect.poll(() => preview.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath("plume-selection-390.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await card.screenshot({ path: testInfo.outputPath("plume-selection-320.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await inviteCharacter(page, "plume");
  const profile = page.locator("#profile");
  await expect(profile).toContainText("翎羽");
  await expect(profile).toContainText("B级");
  await expect(profile.locator(".profile-ability")).toHaveCount(0);
  await expect(profile).toContainText("再也不必眼睁睁看着珍视的人从身边消失");
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/plume\.json|\/assets\/plume-[^/]+\.js)$/.test(path))).toBe(true);
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await waitForInitialDeal(page);
  await expect(page.locator(".character-strip .eyebrow")).toContainText("翎羽 // B级");
  await expect(page.locator("#dialogue-text")).toHaveAttribute("data-typing", "false", { timeout: 5_000 });
  await expect(page.locator("#dialogue-text")).not.toContainText("台词占位");
});

test("暗置衍生牌只用边框区分且不泄露牌面", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const source = findTurnsMatch("derived-card-visibility");
  const opponent = { ...source.opponent, hand: { cards: [source.opponent.hand.cards[0]!, createDerivedCard("hearts", "K", "e2e-hidden-derived", "e2e-fixture")] } };
  const activeMatch = { ...source, opponent, round: { ...source.round, opponent } };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "derived.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  const hidden = page.locator(".opponent-zone .cards .card").nth(1);
  await expect(hidden).toHaveClass(/card-back/);
  await expect(hidden).toHaveClass(/card-derived/);
  await expect(hidden).toHaveCSS("border-style", "double");
  await expect(hidden).toHaveAttribute("data-card-source", "derived");
  await expect(hidden).toHaveAttribute("aria-label", "牌背");
  await expect(hidden.locator(".card-marker")).toHaveCount(0);
  await expect(hidden).not.toContainText("K");
  await expect(hidden).not.toContainText("♥");
});

test("设置原地保存并走中文导入导出", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "showSaveFilePicker", { value: undefined, configurable: true }));
  await page.goto("/");
  await openLobbySettings(page);
  const settings = page.locator("#settings");
  await expect(settings).toBeVisible();
  await settings.locator("input[data-setting='reducedMotion']").check();
  await expect(settings).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/reduced-motion/);
  const [download] = await Promise.all([page.waitForEvent("download"), settings.locator("[data-export]").click()]);
  expect(download.suggestedFilename()).toBe("house-of-chances-save.json");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = JSON.parse(readFileSync(downloadPath!, "utf8")) as Record<string, unknown>;
  expect(exported.skipTutorial).toBe(false);
  expect(exported.activeMatch).toBeUndefined();
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.profile.matchesPlayed = 7;
  await settings.locator("#save-file").setInputFiles({ name: "存档.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 7");
});

test("导入失败时提示迁移，旧版长期档可迁移后导入", async ({ page }) => {
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "v8.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(version8LongTermSave(6))) });
  const migration = page.locator("#save-migration");
  await expect(migration).toBeVisible();
  await expect(migration).toContainText("检测到旧版长期存档");
  await expect(migration.locator("[data-migrate-import]")).toBeEnabled();
  await expect(migration.locator("[data-export-import]")).toBeEnabled();
  await migration.locator("[data-migrate-import]").click();
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 6");

  await page.locator("[data-lobby-home]").click();
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{broken-json") });
  await expect(migration).toBeVisible();
  await expect(migration).toContainText("无法识别");
  await expect(migration.locator("[data-migrate-import]")).toBeDisabled();
  await expect(migration.locator("[data-export-import]")).toBeEnabled();
});

test("可用按钮提供极轻震动并服从减少动态效果设置", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { __hapticPatterns: Array<number | number[]> };
    target.__hapticPatterns = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        target.__hapticPatterns.push(pattern);
        return true;
      }
    });
  });
  await page.goto("/");

  await page.locator("button.lobby-settings-button").click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns)).toEqual([8]);

  await page.evaluate(() => {
    const button = document.createElement("button");
    button.disabled = true;
    document.body.append(button);
    button.click();
    button.remove();
  });
  expect(await page.evaluate(() => (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns)).toEqual([8]);

  await page.locator("#settings input[data-setting='reducedMotion']").check();
  await page.locator("#settings [data-close]").click();
  expect(await page.evaluate(() => (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns)).toEqual([8]);
});

test("设置可下载离线资源包并显示真实进度", async ({ page }) => {
  const assets = [
    { url: "/assets/test-pack/portrait.bin", bytes: 8 },
    { url: "/assets/test-pack/audio.bin", bytes: 4 }
  ];
  await page.route("**/resource-pack.json", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ version: "e2e-pack-v1", totalBytes: 12, assets })
  }));
  await page.route("**/assets/test-pack/*.bin", (route) => route.fulfill({
    contentType: "application/octet-stream",
    body: route.request().url().includes("portrait") ? "12345678" : "1234"
  }));
  await page.goto("/");
  await openLobbySettings(page);
  const settings = page.locator("#settings");
  const progress = settings.getByRole("progressbar", { name: "资源包下载进度" });
  await expect(progress).toHaveAttribute("value", "0");
  await settings.getByRole("button", { name: "下载资源包" }).click();
  await expect(settings.locator("[data-resource-progress-label]")).toContainText("下载完成");
  await expect(progress).toHaveAttribute("value", "100");
  await expect(settings.getByRole("button", { name: "重新下载" })).toBeEnabled();
  expect(await page.evaluate(async (urls) => {
    const cache = await caches.open("blackjack-resource-pack-v1");
    return Promise.all(urls.map(async (url) => Boolean(await cache.match(url))));
  }, assets.map((asset) => asset.url))).toEqual([true, true]);
});

test("技能管理展示严格装备状态，清档确认可取消或重置", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.profile.matchesPlayed = 5;
  imported.profile.wins = 3;
  imported.history.push({
    id: "history-skill-ui", timestamp: "2026-08-30T00:00:00.000Z", opponentId: "w", winner: "player", escaped: false,
    finalRoulette: { player: { capacity: 6, bullets: 1 }, opponent: { capacity: 6, bullets: 0 } },
    busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 }
  });
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "skills.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 5");
  await returnToLobbyMenu(page);
  await page.getByRole("button", { name: "技能与天赋" }).click();
  const skills = page.locator("#skills");
  await expect(skills.locator(".skill-tag-card img")).toHaveCount(4);
  await expect(skills.locator("[data-skill-tag-info]")).toHaveCount(4);
  await expect(skills.locator(".skill-tag-heading h3")).toHaveText("对应流派技能出现概率 ×4");
  await expect(skills).not.toContainText("选择你的流派");
  await skills.getByRole("button", { name: "查看赌徒流派说明" }).click();
  const tagInfo = page.locator("#skill-tag-info-dialog");
  await expect(tagInfo).toBeVisible();
  await expect(tagInfo).toContainText("赌徒流派");
  await expect(tagInfo).toContainText("操作自己的手牌");
  await expect(tagInfo).toContainText("做出更大的牌型");
  await expect(tagInfo).toContainText("避免自己爆牌");
  await expect(skills.locator('[data-skill-tag="gambler"]')).toHaveAttribute("aria-pressed", "false");
  await tagInfo.getByRole("button", { name: "关闭流派说明" }).click();
  await expect(tagInfo).toBeHidden();
  await expect(skills).toBeVisible();
  await expect(skills.locator(".loadout-skill")).toHaveCount(0);
  await skills.getByRole("button", { name: "技能大全" }).click();
  const catalog = page.locator("#skill-catalog");
  await expect(catalog).toBeVisible();
  await expect(catalog.locator(".skill-catalog-group")).toHaveCount(4);
  await expect(catalog.locator(".loadout-skill")).toHaveCount(22);
  await expect(catalog.locator(".loadout-skill:visible")).toHaveCount(0);
  await expect(catalog.locator('[data-primary-skill-tag="gambler"] .loadout-skill')).toHaveCount(8);
  await expect(catalog.locator('[data-primary-skill-tag="cheater"] .loadout-skill')).toHaveCount(5);
  await expect(catalog.locator('[data-primary-skill-tag="intelligence-officer"] .loadout-skill')).toHaveCount(4);
  await expect(catalog.locator('[data-primary-skill-tag="gunslinger"] .loadout-skill')).toHaveCount(5);
  for (const group of await catalog.locator(".skill-catalog-group").all()) await group.locator(":scope > summary").click();
  await expect(catalog.locator(".loadout-skill:visible")).toHaveCount(22);
  const sleightOfHand = catalog.locator(".loadout-skill").filter({ hasText: "顺手牵羊" });
  await expect(sleightOfHand).not.toHaveClass(/locked/);
  await expect(sleightOfHand).toContainText("不会生成衍生牌");
  await expect(catalog).not.toContainText("罗德岛万人迷");
  await expect(catalog.locator(".profile-ability[open]")).toHaveCount(0);
  await catalog.locator(".profile-ability").first().locator("summary").click();
  await expect(catalog.locator(".profile-ability").first().locator("p")).toBeVisible();
  await catalog.locator(".profile-ability").first().locator("summary").click();
  await catalog.locator(".profile-ability").nth(1).locator("summary").click();
  await expect(catalog.locator(".profile-ability[open]")).toHaveCount(1);
  await catalog.getByRole("button", { name: "关闭技能大全" }).click();
  await expect(skills).toBeVisible();
  await skills.getByRole("tab", { name: "天赋" }).click();
  await expect(skills.locator(".talent-checkpoint")).toHaveCount(5);
  await expect(skills.locator(".talent-placeholder")).toHaveCount(4);
  await expect(skills.locator('[data-talent-id="early-preparation"]')).toContainText("早有准备");
  await expect(skills.locator('[data-talent-id="early-preparation"]')).toContainText("未解锁");
  for (const threshold of [3, 5, 7, 10]) {
    await expect(skills.locator(`[data-threshold="${threshold}"]`)).toContainText("敬请期待");
  }
  await skills.getByRole("tab", { name: "技能" }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(skills.locator("input[data-equip-skill]")).toHaveCount(0);
  await skills.getByRole("button", { name: "技能大全" }).click();
  await catalog.locator('[data-primary-skill-tag="gambler"] > summary').click();
  const lockedNightQueen = catalog.locator(".loadout-skill").filter({ hasText: "暗夜女王" });
  await expect(lockedNightQueen).toHaveClass(/locked/);
  await lockedNightQueen.locator(".profile-ability summary").click();
  await expect(lockedNightQueen.locator(".profile-ability p")).toBeVisible();
  await catalog.getByRole("button", { name: "关闭技能大全" }).click();
  await skills.locator("[data-close]").click();
  await openLobbySettings(page);
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.locator("[data-reset]").click();
  await expect(page.locator("#settings")).toBeVisible();
  await page.locator("#settings [data-close]").click();
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 5");
  await returnToLobbyMenu(page);
  await openLobbySettings(page);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("[data-reset]").click();
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 0");
  await returnToLobbyMenu(page);
  await expect(page.locator("[data-open-trophies]")).toContainText("0 件");
});

test("技能流派最多选择两个并持久化，天赋按击败进度解锁", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { __hapticPatterns: Array<number | number[]> };
    target.__hapticPatterns = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        target.__hapticPatterns.push(pattern);
        return true;
      }
    });
  });
  await page.goto("/");
  await installLongTermSave(page, createDefaultSave("2026-08-30T00:00:00.000Z"));
  await page.getByRole("button", { name: "技能与天赋" }).click();
  const skills = page.locator("#skills");
  const tags = skills.locator("[data-skill-tag]");
  await expect(tags).toHaveCount(4);
  await expect(skills.locator(".skill-tag-card img")).toHaveCount(4);
  await expect(skills.locator("[data-skill-tag-info]")).toHaveCount(4);
  expect(await skills.locator(".skill-tag-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length)).toBe(2);
  await expect(skills.locator(".skill-tag-card img").nth(0)).toHaveAttribute("src", "/assets/skills/archetype-gambler.png");
  await page.evaluate(() => { (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns = []; });
  await tags.nth(0).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns)).toEqual([8, [22, 35, 28]]);
  await expect(tags.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(skills.locator(".skill-tag-card img").nth(0)).toHaveAttribute("src", "/assets/skills/archetype-gambler-selected.png");
  await skills.getByRole("button", { name: "查看老千流派说明" }).click();
  const tagInfo = page.locator("#skill-tag-info-dialog");
  await expect(tagInfo).toBeVisible();
  await expect(tagInfo).toContainText("操纵牌桌规则与全局局势");
  await expect(tagInfo).toContainText("提高爆牌上限");
  await tagInfo.getByRole("button", { name: "关闭流派说明" }).click();
  await expect(tags.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(tags.nth(1)).toHaveAttribute("aria-pressed", "false");
  await tags.nth(1).click();
  await expect(tags.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(tags.nth(1)).toHaveAttribute("aria-pressed", "true");
  await tags.nth(2).click();
  await expect(skills.locator("#skill-management-status")).toContainText("最多选择两个流派");
  await page.evaluate(() => { (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns = []; });
  await tags.nth(0).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns)).toEqual([8, [22, 35, 28]]);
  await expect(skills.locator(".skill-tag-card img").nth(0)).toHaveAttribute("src", "/assets/skills/archetype-gambler.png");
  await tags.nth(2).click();
  await expect(tags.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(tags.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(skills.locator("#skill-management-status")).toContainText("选择已保存");
  await skills.locator("[data-close]").click();
  await page.reload();
  await page.getByRole("button", { name: "技能与天赋" }).click();
  await expect(skills.locator("[data-skill-tag]").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(skills.locator("[data-skill-tag]").nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(skills.locator(".skill-tag-card img").nth(1)).toHaveAttribute("src", "/assets/skills/archetype-cheater-selected.png");
  await expect(skills.locator(".skill-tag-card img").nth(2)).toHaveAttribute("src", "/assets/skills/archetype-intelligence-officer-selected.png");
  await skills.getByRole("tab", { name: "天赋" }).click();
  await expect(skills.locator(".talent-checkpoint")).toHaveCount(5);
  await expect(skills.locator(".talent-placeholder")).toHaveCount(4);
  await expect(skills.locator('[data-talent-id="early-preparation"]')).toContainText("未解锁 · 进度 0/1");
  for (const threshold of [3, 5, 7, 10]) {
    await expect(skills.locator(`[data-threshold="${threshold}"]`)).toContainText("敬请期待");
  }
  await skills.locator("[data-close]").click();

  await installLongTermSave(page, saveWithDefeats("plume"));
  await page.getByRole("button", { name: "技能与天赋" }).click();
  await page.locator("#skills").getByRole("tab", { name: "天赋" }).click();
  await expect(page.locator('#skills [data-talent-id="early-preparation"].is-unlocked')).toContainText("早有准备");
  await expect(page.locator('#skills [data-talent-id="early-preparation"]')).toContainText("已解锁");
  await expect(page.locator("#skills .talent-checkpoint")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("旧版长期存档可先导出原件再手动迁移", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "showSaveFilePicker", { value: undefined, configurable: true }));
  const legacy = version8LongTermSave(9);
  await page.goto("/");
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await putSaveRecord(page, "long-term", legacy);
  await page.reload();
  const error = page.locator("main.error-shell");
  await expect(error).toBeVisible();
  await expect(error.locator("[data-reset-invalid-save]")).toBeEnabled();
  await expect(error.locator("[data-migrate-invalid-save]")).toBeEnabled();
  await expect(error.locator("[data-export-invalid-save]")).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), error.locator("[data-export-invalid-save]").click()]);
  expect(download.suggestedFilename()).toBe("house-of-chances-unmigrated-save.json");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  expect((JSON.parse(readFileSync(downloadPath!, "utf8")) as { schemaVersion: number }).schemaVersion).toBe(8);
  await error.locator("[data-migrate-invalid-save]").click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 9");
});

test("没有迁移路径的不兼容长期存档仍须确认删除", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await putSaveRecord(page, "long-term", { marker: "outdated-save", schemaVersion: 99 });
  await page.reload();
  await expect(page.locator("main.error-shell")).toBeVisible();
  await expect(page.locator("main.error-shell")).toContainText("长期存档");
  await expect(page.locator("[data-migrate-invalid-save]")).toBeDisabled();
  await expect(page.locator("[data-export-invalid-save]")).toBeEnabled();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("不会删除未完成牌局");
    await dialog.accept();
  });
  await page.locator("[data-reset-invalid-save]").click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("house-of-chances");
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("saves", "readonly");
        const get = transaction.objectStore("saves").get("long-term");
        get.onsuccess = () => resolve((get.result as { data: Record<string, unknown> }).data);
        get.onerror = () => reject(get.error);
      };
    });
  });
  expect(stored.schemaVersion).toBe(createDefaultSave().schemaVersion);
  expect(stored.skipTutorial).toBe(false);
  expect(stored.marker).toBeUndefined();
  await page.reload();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
});

test("不兼容运行时存档经一次确认后单独舍弃", async ({ page }) => {
  const durable = createDefaultSave("2026-08-30T00:00:00.000Z");
  durable.profile.matchesPlayed = 4;
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "durable.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(durable)) });
  await putSaveRecord(page, "runtime", { format: "house-of-chances-runtime", schemaVersion: 99, marker: "outdated-runtime" });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("只舍弃这局牌");
    expect(dialog.message()).toContain("长期战绩与解锁不会受到影响");
    await dialog.accept();
  });
  await page.reload();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await expect(page.locator("main.error-shell")).toHaveCount(0);
  await enterCharacterSelection(page);
  await expect(page.locator(".quiet-record")).toContainText("策展人记录 // 4");
  expect(await page.evaluate(async () => {
    const request = indexedDB.open("house-of-chances");
    return new Promise<boolean>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const get = request.result.transaction("saves", "readonly").objectStore("saves").get("runtime");
        get.onsuccess = () => resolve(Boolean(get.result));
        get.onerror = () => reject(get.error);
      };
    });
  })).toBe(false);
});

test("玩家胜利结算使用独立椅子全身图且不存在中央空黑块", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = playerWinSummary();
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "summary.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.getByRole("heading", { name: "策展人胜利" })).toBeVisible();
  await expect(page.locator(".summary-character")).toHaveAttribute("src", /w-defeated-summary-chair\.png/);
  await expect(page.locator(".unlock-panel:not(.character-unlock-panel)")).toContainText("暗夜女王");
  await expect(page.locator(".presentation")).toHaveCount(0);
  const summaryButtons = page.locator(".summary-actions button");
  await expect(summaryButtons).toHaveCount(2);
  await expect(page.getByRole("button", { name: "前往战利品陈列室" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回大厅" })).toBeVisible();
  const summaryButtonBoxes = await summaryButtons.evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(Math.abs(summaryButtonBoxes[0]!.width - summaryButtonBoxes[1]!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(summaryButtonBoxes[0]!.height - summaryButtonBoxes[1]!.height)).toBeLessThanOrEqual(1);
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs += 1; void dialog.dismiss(); });
  await page.getByRole("button", { name: "前往战利品陈列室" }).click();
  await expect(page.locator("main.trophy-shell")).toBeVisible();
  await expect(page.locator(".trophy-card")).toHaveCount(1);
  await page.locator("[data-trophy-back]").click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  expect(nativeDialogs).toBe(0);
  await page.getByRole("button", { name: "技能与天赋" }).click();
  await page.locator("#skills").getByRole("button", { name: "技能大全" }).click();
  await page.locator('#skill-catalog [data-primary-skill-tag="gambler"] > summary').click();
  const nightQueen = page.locator("#skill-catalog .loadout-skill").filter({ hasText: "暗夜女王" });
  await expect(nightQueen).not.toHaveClass(/locked/);
  await expect(nightQueen).toContainText("已解锁，可在牌局中掉落");
});

test("击败拉普兰德、霍尔海雅与白金会解锁各自的玩家技能", async ({ page }) => {
  const imported = createDefaultSave("2026-09-10T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "victory-skill-rewards.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });

  await installRuntimeSave(page, playerWinSummary("lappland-the-decadenza"));
  const lapplandReward = page.locator(".unlock-panel:not(.character-unlock-panel)");
  await expect(lapplandReward).toContainText("新技能已解锁");
  await expect(lapplandReward).toContainText("狂欢节");
  await expect(lapplandReward).toContainText("首次击败拉普兰德");
  await page.getByRole("button", { name: "返回大厅" }).click();
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();

  await installRuntimeSave(page, playerWinSummary("ho-olheyak"));
  const hoOlheyakReward = page.locator(".unlock-panel:not(.character-unlock-panel)");
  await expect(hoOlheyakReward).toContainText("羽蛇的记忆");
  await expect(hoOlheyakReward).toContainText("与最后一张手牌点数、花色相同");
  await expect(hoOlheyakReward).toContainText("首次击败霍尔海雅");
  await page.getByRole("button", { name: "返回大厅" }).click();
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();

  await installRuntimeSave(page, playerWinSummary("platinum"));
  const platinumReward = page.locator(".unlock-panel:not(.character-unlock-panel)");
  await expect(platinumReward).toContainText("天马视域");
  await expect(platinumReward).toContainText("持续5轮");
  await expect(platinumReward).toContainText("首次击败白金");
  await page.getByRole("button", { name: "返回大厅" }).click();
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();

  await page.getByRole("button", { name: "技能与天赋" }).click();
  await page.locator("#skills").getByRole("button", { name: "技能大全" }).click();
  await page.locator('#skill-catalog [data-primary-skill-tag="gambler"] > summary').click();
  await page.locator('#skill-catalog [data-primary-skill-tag="cheater"] > summary').click();
  for (const name of ["羽蛇的记忆", "狂欢节", "天马视域"]) {
    const skill = page.locator("#skill-catalog .loadout-skill").filter({ hasText: name });
    await expect(skill).not.toHaveClass(/locked/);
    await expect(skill).toContainText("已解锁，可在牌局中掉落");
  }
});

test("玩家落败结算可回溯并与同一名与会者重开", async ({ page }) => {
  const imported = saveWithDefeats("plume", "lappland-the-decadenza");
  const loss = playerLossSummary("texas");
  imported.settings.reducedMotion = true;
  await page.goto("/?debug=1");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "loss-summary.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, loss);
  await expect(page.getByRole("heading", { name: "策展人落败" })).toBeVisible();
  const summaryButtons = page.locator(".summary-actions button");
  await expect(summaryButtons).toHaveCount(2);
  await expect(page.getByRole("button", { name: "回溯时空（重开一局）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回大厅" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const summaryButtonBoxes = await summaryButtons.evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(Math.abs(summaryButtonBoxes[0]!.width - summaryButtonBoxes[1]!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(summaryButtonBoxes[0]!.height - summaryButtonBoxes[1]!.height)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "回溯时空（重开一局）" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  const restarted = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: MatchState };
  expect(restarted.relevantMatchState.opponentId).toBe(loss.opponentId);
  expect(restarted.relevantMatchState.id).not.toBe(loss.id);
  expect(restarted.relevantMatchState.status).toBe("active");
});

test("牌桌技能卡与扑克牌同尺寸，说明弹窗不消费技能且卡面仍可使用", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const source = findTurnsMatch("compact-skills");
  const oldCardIds = new Set(source.playerSkills.cards.map((card) => card.instanceId));
  const hunterCard = { kind: "player-skill" as const, definitionId: "critical-judgment", owner: "player" as const, instanceId: "e2e-critical-judgment" };
  const hunterSequence = source.abilities.sequence + 1;
  imported.settings.reducedMotion = true;
  const activeMatch: MatchState = {
    ...source,
    round: { ...source.round, currentActor: "player" },
    playerSkills: { ...source.playerSkills, unlockedDefinitionIds: [...new Set([...source.playerSkills.unlockedDefinitionIds, "critical-judgment"])], cards: [hunterCard], drawCount: 2 },
    abilities: {
      ...source.abilities,
      instances: [...source.abilities.instances.filter((instance) => !oldCardIds.has(instance.instanceId)), { ...hunterCard, createdAtSequence: hunterSequence, parameters: {} }],
      sequence: hunterSequence
    }
  };
  await page.goto("/?debug=1");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "compact-skills.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await page.addStyleTag({ content: ".dev-hud { display: none !important; }" });
  await expect(page.locator("main.table-shell")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/reduced-motion/);
  await expect(page.locator(".skill-sidebar .skill-tile")).toHaveCount(1);
  const actionButtons = page.locator(".table-action-controls > button");
  await expect(actionButtons).toHaveCount(3);
  await expect(page.locator(".draw-skill-button")).toHaveAttribute("aria-label", "抽取技能，剩余 2 次");
  const actionWidths = await actionButtons.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
  expect(actionWidths[0]).toBeGreaterThan(actionWidths[2] * 2);
  expect(actionWidths[1]).toBeGreaterThan(actionWidths[2] * 2);
  await expect(page.locator(".draw-skill-badge")).toHaveText("2");
  const debugBefore = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { playerSkills: { cards: Array<{ instanceId: string; definitionId: string }> } } };
  const playerCardElement = await page.locator(".player-zone .card").first().elementHandle();
  expect(playerCardElement).not.toBeNull();
  const drawerToggle = page.locator(".skill-drawer-toggle");
  await expect(drawerToggle).toHaveAttribute("aria-expanded", "false");
  await expect(drawerToggle.locator(".skill-drawer-arrow")).toHaveText("<");
  await expect(drawerToggle.locator(".skill-drawer-badge")).toHaveText(String(debugBefore.relevantMatchState.playerSkills.cards.length));
  await expect(page.locator(".skill-drawer-content")).not.toBeVisible();
  const layoutBefore = await page.locator(".player-layout").boundingBox();
  const dockBefore = await page.locator(".action-dock").boundingBox();
  const playerMainBefore = await page.locator(".player-main").boundingBox();
  const closedSidebar = await page.locator(".skill-sidebar").boundingBox();
  const closedToggle = await drawerToggle.boundingBox();
  const closedBadge = await drawerToggle.locator(".skill-drawer-badge").boundingBox();
  const closedPlayerCard = await page.locator(".player-zone .card").first().boundingBox();
  expect(layoutBefore).not.toBeNull();
  expect(dockBefore).not.toBeNull();
  expect(playerMainBefore).not.toBeNull();
  expect(closedSidebar).not.toBeNull();
  expect(closedToggle).not.toBeNull();
  expect(closedBadge).not.toBeNull();
  expect(closedPlayerCard).not.toBeNull();
  const closedDrawerStyle = await page.locator(".skill-sidebar").evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderTopColor,
    pointerEvents: getComputedStyle(element).pointerEvents
  }));
  expect(closedDrawerStyle).toEqual({
    background: "rgba(0, 0, 0, 0)",
    border: "rgba(0, 0, 0, 0)",
    pointerEvents: "none"
  });
  expect(Math.abs(closedToggle!.x + closedToggle!.width - (layoutBefore!.x + layoutBefore!.width))).toBeLessThanOrEqual(2);
  const closedIntersection = Math.max(0, Math.min(closedSidebar!.x + closedSidebar!.width, layoutBefore!.x + layoutBefore!.width) - Math.max(closedSidebar!.x, layoutBefore!.x));
  expect(closedIntersection).toBeLessThanOrEqual(.5);
  expect(closedBadge!.x + closedBadge!.width).toBeLessThanOrEqual(layoutBefore!.x + layoutBefore!.width);
  expect(closedBadge!.x + closedBadge!.width).toBeLessThanOrEqual(390);
  expect(closedPlayerCard!.y).toBeGreaterThanOrEqual(620);
  expect(closedPlayerCard!.y + closedPlayerCard!.height).toBeLessThan(dockBefore!.y);
  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute("aria-expanded", "true");
  await expect(drawerToggle.locator(".skill-drawer-arrow")).toHaveText(">");
  await expect(drawerToggle.locator(".skill-drawer-badge")).toBeHidden();
  await expect(page.locator(".skill-drawer-content")).toBeVisible();
  await expect(drawerToggle).toHaveAttribute("aria-label", /收起技能抽屉/);
  expect(await page.evaluate((element) => element === document.querySelector(".player-zone .card"), playerCardElement)).toBe(true);
  const layoutAfter = await page.locator(".player-layout").boundingBox();
  const dockAfter = await page.locator(".action-dock").boundingBox();
  const playerMainAfter = await page.locator(".player-main").boundingBox();
  for (const [before, after] of [[layoutBefore, layoutAfter], [dockBefore, dockAfter], [playerMainBefore, playerMainAfter]]) {
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(.5);
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(.5);
    expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(.5);
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(.5);
  }
  const drawerBox = await page.locator(".skill-sidebar").boundingBox();
  const openMain = await page.locator(".player-main").boundingBox();
  const openSidebar = await page.locator(".skill-sidebar").boundingBox();
  const openDock = await page.locator(".action-dock").boundingBox();
  const drawerBackground = await page.locator(".skill-sidebar").evaluate((element) => getComputedStyle(element).backgroundColor);
  const drawerStyle = await page.locator(".skill-sidebar").evaluate((element) => {
    const content = element.querySelector<HTMLElement>(".skill-drawer-content");
    const notice = document.querySelector<HTMLElement>(".round-notice");
    const point = element.getBoundingClientRect();
    const hit = document.elementFromPoint(point.left + 3, point.top + 3);
    return {
      position: getComputedStyle(element).position,
      zIndex: Number(getComputedStyle(element).zIndex),
      noticeZIndex: Number(notice ? getComputedStyle(notice).zIndex : "0"),
      columns: content ? getComputedStyle(content).gridTemplateColumns.trim().split(/\s+/).length : 0,
      contentBackground: content ? getComputedStyle(content).backgroundColor : "",
      hitInsideDrawer: Boolean(hit?.closest(".skill-sidebar"))
    };
  });
  expect(drawerBackground).toMatch(/rgba\(/);
  expect(drawerStyle.position).toBe("fixed");
  expect(drawerStyle.zIndex).toBeGreaterThan(drawerStyle.noticeZIndex);
  expect(drawerStyle.columns).toBe(2);
  expect(drawerStyle.contentBackground).toBe("rgba(0, 0, 0, 0)");
  expect(drawerStyle.hitInsideDrawer).toBe(true);
  expect(drawerBox).not.toBeNull();
  expect(openMain).not.toBeNull();
  expect(drawerBox!.x).toBeLessThan(openMain!.x + openMain!.width);
  expect(drawerBox!.x + drawerBox!.width).toBeGreaterThan(openMain!.x + openMain!.width - 2);
  expect(openSidebar).not.toBeNull();
  expect(openDock).not.toBeNull();
  expect(openSidebar!.y + openSidebar!.height).toBeLessThanOrEqual(openDock!.y);
  const activeSkill = page.locator(".skill-sidebar button.skill-card[data-action*='critical-judgment']");
  const activeCardsBefore = await activeSkill.allTextContents();
  expect(activeCardsBefore).toEqual(["临界判断主动"]);
  await expect(page.locator(".player-zone .card").first()).toHaveCSS("width", "46px");
  await expect(activeSkill).toHaveCSS("width", "46px");
  await expect(page.locator(".player-zone .card").first()).toHaveCSS("height", "66px");
  await expect(activeSkill).toHaveCSS("height", "66px");
  await expect(page.locator(".player-zone .card").first()).toHaveCSS("animation-name", "none");
  const playingCard = await page.locator(".player-zone .card").first().boundingBox();
  const skillCard = await activeSkill.boundingBox();
  expect(playingCard).not.toBeNull();
  expect(skillCard).not.toBeNull();
  expect(Math.abs(skillCard!.width - playingCard!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(skillCard!.height - playingCard!.height)).toBeLessThanOrEqual(1);
  await page.locator("[data-skill-info='critical-judgment']").click();
  await expect(page.locator("#skill-info-dialog")).toBeVisible();
  await expect(page.locator("#skill-info-dialog .profile-ability summary")).toContainText("临界判断：");
  await expect(page.locator("#skill-info-dialog .profile-ability[open]")).toHaveCount(0);
  await page.locator("#skill-info-dialog .profile-ability summary").click();
  await expect(page.locator("#skill-info-dialog #skill-info-lore")).toBeVisible();
  await expect(page.locator("#skill-info-dialog")).toContainText("Hit 是否会导致你爆牌");
  expect(await activeSkill.allTextContents()).toEqual(activeCardsBefore);
  const debugAfter = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { playerSkills: { cards: Array<{ instanceId: string; definitionId: string }> } } };
  expect(debugAfter.relevantMatchState.playerSkills.cards).toEqual(debugBefore.relevantMatchState.playerSkills.cards);
  await page.locator("[data-skill-close]").click();
  await expect(page.locator("#skill-info-dialog")).not.toBeVisible();
  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute("aria-expanded", "false");
  await expect(drawerToggle.locator(".skill-drawer-arrow")).toHaveText("<");
  await expect(drawerToggle.locator(".skill-drawer-badge")).toBeVisible();
  await expect(activeSkill).not.toBeVisible();
  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute("aria-expanded", "true");
  await expect(activeSkill).toBeVisible();
  await page.locator(".skill-sidebar button.skill-card:not(:disabled)").first().click();
  await expect(page.locator(".skill-advice")).toHaveCount(0);
  await expect(page.locator("#ability-notices .ability-notice-player")).toContainText(/策展人发动「临界判断」：现在 Hit (?:会|不会)导致爆牌。/);
  await expect(page.locator("#presentation")).not.toContainText("发动");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const shortViewportToggle = await drawerToggle.boundingBox();
  const shortViewportDrawer = await page.locator(".skill-sidebar").boundingBox();
  const shortViewportPlayerCard = await page.locator(".player-zone .card").first().boundingBox();
  const shortViewportPlayerHand = await page.locator(".player-zone .hand-row").boundingBox();
  expect(shortViewportToggle).not.toBeNull();
  expect(shortViewportDrawer).not.toBeNull();
  expect(shortViewportPlayerCard).not.toBeNull();
  expect(shortViewportPlayerHand).not.toBeNull();
  expect(shortViewportToggle!.y).toBeGreaterThanOrEqual(0);
  expect(shortViewportToggle!.y + shortViewportToggle!.height).toBeLessThanOrEqual(700);
  expect(shortViewportDrawer!.y).toBeGreaterThanOrEqual(0);
  expect(shortViewportDrawer!.y + shortViewportDrawer!.height).toBeLessThanOrEqual(700);
  expect(shortViewportPlayerCard!.y).toBeGreaterThanOrEqual(0);
  expect(shortViewportPlayerCard!.y + shortViewportPlayerCard!.height).toBeLessThanOrEqual(700);
  expect(shortViewportPlayerHand!.y + shortViewportPlayerHand!.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: testInfo.outputPath("skill-drawer-short-open.png") });
  await drawerToggle.click();
  await expect(drawerToggle).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: testInfo.outputPath("skill-drawer-short-closed.png") });
  await page.setViewportSize({ width: 360, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});

test("闻香识女人只在本轮显示对手当前所有暗牌花色", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const source = findTurnsMatch("scent-ui");
  const player = { ...source.player, hand: createHand([createCard("spades", "10"), createCard("clubs", "6")]) };
  const opponent = { ...source.opponent, hand: createHand([createCard("clubs", "10"), createCard("spades", "2"), createCard("diamonds", "4")]), stood: true, busted: false };
  const scentCard = { kind: "player-skill" as const, definitionId: "scent-of-a-woman", owner: "player" as const, instanceId: "scent-ui-card" };
  const sequence = source.abilities.sequence + 1;
  const activeMatch: MatchState = {
    ...source, player, opponent,
    round: { ...source.round, phase: "turns", currentActor: "player", player, opponent },
    playerSkills: { ...source.playerSkills, unlockedDefinitionIds: [...new Set([...source.playerSkills.unlockedDefinitionIds, "scent-of-a-woman"])], cards: [scentCard] },
    abilities: { ...source.abilities, instances: [...source.abilities.instances.filter((instance) => instance.kind !== "player-skill"), { ...scentCard, createdAtSequence: sequence, parameters: {} }], sequence }
  };
  await page.goto("/?debug=1");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "scent.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toBeVisible();
  await page.locator(".skill-drawer-toggle").click();
  const scentButton = page.locator(".skill-sidebar button.skill-card").filter({ hasText: "闻香识女人" });
  await expect(scentButton).toBeVisible();
  await scentButton.click();
  const hidden = page.locator(".opponent-zone .card-back");
  await expect(hidden).toHaveCount(2);
  await expect(hidden.nth(0)).toHaveAttribute("aria-label", /花色黑桃/);
  await expect(hidden.nth(1)).toHaveAttribute("aria-label", /花色方块/);
  await expect(hidden.locator(".card-suit")).toHaveCount(2);
  await expect(hidden.locator(".card-rank")).toHaveCount(0);
  await expect(hidden.locator(".card-back-emblem")).toHaveCount(0);
  await expect(hidden.nth(0).locator(".card-suit")).toHaveCSS("color", "rgb(21, 26, 30)");
  await expect(hidden.nth(0).locator(".card-suit")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const cardAppearance = await page.locator(".opponent-zone").evaluate((zone) => {
    const front = zone.querySelector<HTMLElement>(".card-front");
    const back = zone.querySelector<HTMLElement>(".card-back");
    const frontSuit = front?.querySelector<HTMLElement>(".card-suit");
    const backSuit = back?.querySelector<HTMLElement>(".card-suit");
    if (!front || !back || !frontSuit || !backSuit) throw new Error("Card suit fixture is incomplete");
    const frontStyle = getComputedStyle(frontSuit);
    const backStyle = getComputedStyle(backSuit);
    return {
      frontRight: frontStyle.right,
      backRight: backStyle.right,
      frontBottom: frontStyle.bottom,
      backBottom: backStyle.bottom,
      strokeColor: backStyle.webkitTextStrokeColor,
      strokeWidth: backStyle.webkitTextStrokeWidth
    };
  });
  expect(cardAppearance.frontRight).toBe("6px");
  expect(cardAppearance.backRight).toBe(cardAppearance.frontRight);
  expect(cardAppearance.frontBottom).toBe("6px");
  expect(cardAppearance.backBottom).toBe(cardAppearance.frontBottom);
  expect(cardAppearance.strokeColor).toBe("rgb(201, 155, 67)");
  expect(Number.parseFloat(cardAppearance.strokeWidth)).toBeGreaterThan(0);
  const rankOnlyAppearance = await hidden.nth(0).evaluate((card) => {
    const probe = card.cloneNode(true) as HTMLElement;
    probe.classList.remove("card-suit-visible");
    probe.classList.add("card-rank-visible");
    probe.querySelector(".card-suit")?.remove();
    const rank = document.createElement("b");
    rank.className = "card-rank";
    rank.textContent = "K";
    probe.querySelector(".card-surface")?.append(rank);
    probe.style.position = "fixed";
    probe.style.left = "-100px";
    document.body.append(probe);
    const style = getComputedStyle(rank);
    const appearance = { color: style.color, strokeColor: style.webkitTextStrokeColor };
    probe.remove();
    return appearance;
  });
  expect(rankOnlyAppearance).toEqual({ color: "rgb(255, 255, 255)", strokeColor: "rgb(201, 155, 67)" });
  await expect(page.locator("#ability-notices .ability-notice-player")).toContainText("策展人发动「闻香识女人」：对手当前所有手牌花色为梅花、黑桃、方块");
  await expect(page.locator("#presentation")).not.toContainText("闻香识女人");
  await page.getByRole("button", { name: /Stand 停牌/ }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");
  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "turns");
  await expect(page.locator(".opponent-zone .card-back .card-suit")).toHaveCount(0);
});

test("德克萨斯发动细雨无声时展示效果，点击被封锁技能给出短暂警告", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const base = createMatch("e2e-silent-drizzle", {
    opponentId: "texas",
    unlockedPlayerSkillIds: ["critical-judgment"],
    opponentAiSkills: [{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]
  });
  const hunterCard = { kind: "player-skill" as const, definitionId: "critical-judgment", owner: "player" as const, instanceId: "e2e-silent-drizzle-judgment" };
  const sequence = base.abilities.sequence + 1;
  const player = { ...base.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "6")]), stood: false, busted: false };
  const opponent = { ...base.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: false, busted: false };
  imported.settings.reducedMotion = true;
  const activeMatch: MatchState = {
    ...base,
    player,
    opponent,
    shoe: { cards: [createCard("clubs", "2"), createCard("spades", "3")], cursor: 0, shuffleIndex: 1 },
    round: { ...base.round, phase: "turns", currentActor: "opponent", player, opponent, outcome: null },
    playerSkills: { ...base.playerSkills, cards: [hunterCard] },
    abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...hunterCard, createdAtSequence: sequence, parameters: {} }], sequence },
    aiProfile: { P: -100, A: 0, B: 0, C: 0 },
    lastAiDecision: null
  };

  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "silent-drizzle.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("#ability-notices .ability-notice-ai"), "AI skill trigger should use the toast stack").toContainText("德克萨斯发动「细雨无声」", { timeout: 8_000 });
  await expect(page.locator("#ability-notices .ability-notice-ai")).toContainText("玩家下一手牌期间无法使用主动技能");
  await expect(page.locator("#presentation")).not.toContainText("细雨无声");

  await page.locator(".skill-drawer-toggle").click();
  const blockedSkill = page.locator(".skill-card[data-skill-id='critical-judgment']");
  await expect(blockedSkill).toHaveAttribute("aria-disabled", "true");
  const notifications = page.locator("#ability-notices .ability-notice-notification");
  await blockedSkill.click({ force: true });
  await expect(notifications).toHaveCount(1);
  expect(await notifications.first().evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 192, 189)");
  for (let index = 1; index < 7; index += 1) await blockedSkill.click({ force: true });
  await expect(notifications).toHaveCount(5);
  await expect(notifications).toHaveText(["技能被禁用", "技能被禁用", "技能被禁用", "技能被禁用", "技能被禁用"]);
  await expect(page.locator("#presentation")).not.toContainText("技能被禁用");

  await page.getByRole("button", { name: "Hit 要牌" }).click();
  await expect(blockedSkill).not.toHaveAttribute("aria-disabled", "true");
  await expect(blockedSkill).toBeEnabled();
});

test("牌桌全屏按钮安全切换并同步状态", async ({ page }) => {
  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(Document.prototype, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: async function(this: Element) { fullscreenElement = this; document.dispatchEvent(new Event("fullscreenchange")); } });
    Object.defineProperty(Document.prototype, "exitFullscreen", { configurable: true, value: async () => { fullscreenElement = null; document.dispatchEvent(new Event("fullscreenchange")); } });
  });
  await page.goto("/");
  await installLongTermSave(page, saveWithDefeats("plume", "lappland-the-decadenza"));
  await enterCharacterSelection(page);
  await startCharacter(page, "texas");
  const fullscreen = page.locator("[data-fullscreen]");
  await expect(fullscreen).toHaveAttribute("aria-label", "进入全屏");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-label", "退出全屏");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-label", "进入全屏");
  await page.evaluate(() => {
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: async () => { throw new Error("denied"); } });
  });
  await fullscreen.click();
  await expect(page.locator("#ability-notices .ability-notice-notification")).toContainText("全屏请求未获允许。");
  await expect(page.locator("#presentation")).not.toContainText("全屏请求未获允许。");
});

test("玩家 Blackjack 只使用 Blackjack 对话池", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = findPlayerBlackjackMatch();
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "blackjack-dialogue.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");
  const line = await page.locator("#dialogue-text").textContent();
  expect(wDialogue.PLAYER_BLACKJACK).toContain(line);
  expect(wDialogue.PLAYER_WIN_ROUND).not.toContain(line);
});

test("战利品陈列室只显示首次击败藏品，并可进入和清理独立对局记录", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const records: MatchHistoryRecord[] = [
    { id: "history-win", timestamp: "2026-08-29T20:10:00.000Z", opponentId: "nian", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 5, capacity: 6 } }, busts: { player: 1, opponent: 2 }, blackjacks: { player: 2, opponent: 1 } },
    { id: "history-loss", timestamp: "2026-08-30T20:10:00.000Z", opponentId: "texas", winner: "opponent", escaped: false, finalRoulette: { player: { bullets: 6, capacity: 6 }, opponent: { bullets: 2, capacity: 6 } }, busts: { player: 3, opponent: 0 }, blackjacks: { player: 0, opponent: 1 } }
  ];
  imported.history = records;
  imported.defeats = [
    { opponentId: "plume", timestamp: "2026-08-26T20:10:00.000Z" },
    { opponentId: "texas", timestamp: "2026-08-27T20:10:00.000Z" },
    { opponentId: "nian", timestamp: records[0].timestamp }
  ];
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await returnToLobbyMenu(page);
  await page.locator("[data-open-trophies]").click();
  await expect(page.locator("main.trophy-shell")).toBeVisible();
  await expect(page.locator(".trophy-card")).toHaveCount(3);
  expect(await page.locator("[data-trophy-character-id]").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.trophyCharacterId))).toEqual(["nian", "texas", "plume"]);
  const trophyBox = await page.locator(".trophy-card").first().boundingBox();
  expect(trophyBox).not.toBeNull();
  expect(trophyBox!.width / trophyBox!.height).toBeCloseTo(16 / 4.5, 1);
  const trophy = page.locator("[data-trophy-character-id='nian']");
  await expect(trophy.locator(".trophy-visual img")).toHaveAttribute("src", /nian-trophy-defeated\.png/);
  await expect(trophy.locator(".trophy-meta small")).toHaveText("S级战利品");
  await expect(trophy.locator(".trophy-meta strong")).toHaveText("年");
  await expect(trophy).not.toContainText("策展人胜利");
  for (const [id, label, color] of [["plume", "B级战利品", "rgb(80, 169, 255)"], ["texas", "A级战利品", "rgb(189, 120, 255)"], ["nian", "S级战利品", "rgb(242, 196, 107)"]] as const) {
    const card = page.locator(`[data-trophy-character-id='${id}']`);
    await expect(card.locator(".trophy-meta small")).toHaveText(label);
    expect(await card.evaluate((node) => ({ border: getComputedStyle(node).borderTopColor, label: getComputedStyle(node.querySelector("small")!).color }))).toEqual({ border: color, label: color });
  }
  await page.screenshot({ path: testInfo.outputPath("trophy-collection-390.png"), fullPage: true });
  await trophy.click();
  const detail = page.locator("#history-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("首次击败");
  await expect(detail.locator(".history-trophy-preview > img")).toHaveAttribute("src", /nian-trophy-gallery-headshot\.png/);
  await expect(detail.locator(".history-trophy-preview")).toContainText("战利品等级：S");
  await expect(detail.locator(".history-trophy-preview")).toContainText("年的死体展示");
  await expect(detail.locator(".history-trophy-preview")).not.toContainText("昏迷档案");
  await expect(detail.locator(".history-trophy-preview")).not.toContainText("败北记录");
  const headshotBox = await detail.locator(".history-trophy-preview > img").boundingBox();
  expect(headshotBox).not.toBeNull();
  expect(headshotBox!.width / headshotBox!.height).toBeCloseTo(5 / 7, 2);
  await detail.screenshot({ path: testInfo.outputPath("nian-trophy-history.png") });
  await detail.locator("[data-open-trophy-gallery]").click();
  const gallery = page.locator("#trophy-gallery");
  await expect(gallery).toBeVisible();
  await expect(gallery.locator(".trophy-gallery-background")).toHaveAttribute("src", /trophy-gallery-coffin\.png/);
  await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", /nian-trophy-gallery-full-subject\.png/);
  await expect(gallery.locator(".trophy-hotspot")).toHaveCount(5);
  await expect(gallery.locator(".trophy-gallery-stage figcaption")).toHaveText("正面 · 左右滑动或点按箭头翻转 · 点按圆环查看特写");
  const dossier = gallery.locator("#trophy-dossier-panel");
  const dossierToggle = gallery.locator("[data-dossier-toggle]");
  await expect(dossier).toHaveAttribute("aria-hidden", "true");
  await expect(dossierToggle).toHaveAttribute("aria-expanded", "false");
  await expect(dossierToggle).toContainText("档案");
  const collapsedDossierBox = await dossier.boundingBox();
  expect(collapsedDossierBox).not.toBeNull();
  expect(collapsedDossierBox!.x).toBeGreaterThanOrEqual(380);
  await dossierToggle.click();
  await expect(dossier).toHaveAttribute("aria-hidden", "false");
  await expect(dossierToggle).toHaveAttribute("aria-expanded", "true");
  await expect(dossierToggle).toHaveCSS("left", "-27px");
  await expect.poll(() => dossier.evaluate((element) => getComputedStyle(element).transform)).toBe("matrix(1, 0, 0, 1, 0, 0)");
  await expect(dossierToggle).toContainText("收起");
  await expect(dossier.locator(".trophy-dossier-main figure img")).toHaveAttribute("src", /nian-defeated-summary-chair\.png/);
  await expect(dossier.locator("[data-dossier-field]")).toHaveCount(6);
  await expect(dossier).toContainText("姓名：年");
  await expect(dossier).toContainText("种族：岁兽碎片");
  await expect(dossier).toContainText("处女性：未核验");
  await expect(dossier).toContainText("尸体状况");
  await expect(dossier).not.toContainText("处理结果");
  await expect(dossier).not.toContainText("点评");
  const [stageBox, openDossierBox] = await Promise.all([gallery.locator(".trophy-gallery-stage").boundingBox(), dossier.boundingBox()]);
  expect(stageBox).not.toBeNull();
  expect(openDossierBox).not.toBeNull();
  expect(Math.abs(openDossierBox!.y - stageBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(openDossierBox!.height - stageBox!.height)).toBeLessThanOrEqual(1);
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-dossier-open-390.png") });
  await dossierToggle.click();
  await expect(dossier).toHaveAttribute("aria-hidden", "true");
  const markerStyle = await gallery.locator(".trophy-hotspot").first().evaluate((marker) => {
    const ring = getComputedStyle(marker, "::before");
    const number = marker.querySelector("span");
    return {
      background: getComputedStyle(marker).backgroundColor,
      numberDisplay: number ? getComputedStyle(number).display : "missing",
      ringSize: ring.width,
      ringBorderStyle: ring.borderTopStyle,
      ringBorderWidth: ring.borderTopWidth,
      animationName: ring.animationName,
      animationDuration: ring.animationDuration
    };
  });
  expect(markerStyle).toEqual({
    background: "rgba(0, 0, 0, 0)",
    numberDisplay: "none",
    ringSize: "14px",
    ringBorderStyle: "solid",
    ringBorderWidth: "2px",
    animationName: "trophy-hotspot-glimmer",
    animationDuration: "3.6s"
  });
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-gallery.png") });
  await gallery.locator("[data-closeup-id='tail-root']").click();
  await expect(gallery.locator("#trophy-closeup-panel")).toHaveClass(/is-open/);
  await expect(gallery.locator("#trophy-closeup-panel")).toContainText("龙尾根部");
  await expect(gallery.locator("#trophy-closeup-panel .trophy-closeup-art img")).toHaveAttribute("src", /nian-trophy-detail-tail-root\.png/);
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-tail-root.png") });
  await gallery.locator("[data-closeup-id='feet-side']").click();
  await expect(gallery.locator("#trophy-closeup-panel")).toContainText("足部·侧面");
  const closeupArt = gallery.locator("#trophy-closeup-panel .trophy-closeup-art");
  await expect(closeupArt.locator("img")).toHaveAttribute("src", /nian-trophy-detail-feet-side\.png/);
  await expect(closeupArt).toContainText("p0 · 1/2");
  await closeupArt.click();
  await expect(gallery.locator("#trophy-closeup-panel .trophy-closeup-art img")).toHaveAttribute("src", /nian-trophy-detail-feet-side-p1\.png/);
  await expect(gallery.locator("#trophy-closeup-panel")).toContainText("卸下高跟鞋后再从足端观察");
  await expect(gallery.locator("#trophy-closeup-panel .trophy-closeup-art")).toContainText("p1 · 2/2");
  await gallery.locator("#trophy-closeup-panel .trophy-closeup-art").click();
  await expect(gallery.locator("#trophy-closeup-panel .trophy-closeup-art img")).toHaveAttribute("src", /nian-trophy-detail-feet-side\.png/);
  await expect(gallery.locator("#trophy-closeup-panel")).toContainText("换到低侧角度");
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(gallery.locator(".trophy-gallery-stage")).toBeInViewport();
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-feet-side-320.png") });
  await gallery.locator("[data-close-closeup]").click();
  await dossierToggle.click();
  await expect.poll(() => dossier.evaluate((element) => getComputedStyle(element).transform)).toBe("matrix(1, 0, 0, 1, 0, 0)");
  const [mobileStageBox, mobileDossierBox] = await Promise.all([gallery.locator(".trophy-gallery-stage").boundingBox(), dossier.boundingBox()]);
  expect(mobileStageBox).not.toBeNull();
  expect(mobileDossierBox).not.toBeNull();
  expect(Math.abs(mobileDossierBox!.y - mobileStageBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(mobileDossierBox!.height - mobileStageBox!.height)).toBeLessThanOrEqual(1);
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-dossier-open-320.png") });
  await dossierToggle.click();
  await gallery.locator("[data-gallery-close]").click();
  await expect(gallery).not.toBeVisible();
  await expect(detail).toBeVisible();
  await detail.locator("[data-history-close]").click();

  await page.getByRole("button", { name: "查看历史记录" }).click();
  await expect(page.locator("main.history-shell")).toBeVisible();
  await expect(page.locator(".trophy-card")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("match-history-320.png"), fullPage: true });
  await expect(page.locator("[data-history-id='history-loss'] .transparent-history-image")).toHaveAttribute("src", /^data:image\/gif/);
  await page.locator("[data-history-id='history-win']").click();
  await expect(detail).toContainText("策展人最终左轮");
  expect(await detail.locator(".history-stats dd").allTextContents()).toEqual(["3 / 6", "5 / 6", "1 次", "2 次", "2 次", "1 次"]);
  await detail.locator("[data-history-close]").click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("战利品、角色与技能解锁不会受到影响");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "清理对局记录" }).click();
  await expect(page.locator("main.history-shell .trophy-card")).toHaveCount(0);
  await page.getByRole("button", { name: "返回战利品陈列室" }).click();
  await expect(page.locator("[data-trophy-character-id]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "查看历史记录" })).toContainText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("多图兴趣点点击局部立绘时循环对应图片与描述", async ({ page }) => {
  await page.goto("/");
  await installLongTermSave(page, saveWithDefeats("w", "texas", "irene", "cimei", "nian", "plume", "platinum", "lappland-the-decadenza", "ho-olheyak", "dorothy", "typhon"));
  await page.locator("[data-open-trophies]").click();

  const cases = [
    { slug: "w", name: "W", point: "boots", p0: "w-trophy-detail-boots.png", p1: "w-trophy-detail-boots-p1.png", description: "长靴被移开后" },
    { slug: "texas", name: "德克萨斯", point: "boots", p0: "texas-trophy-detail-boots.png", p1: "texas-trophy-detail-boots-removed.png", description: "短靴被卸下并作为装备放在一旁" },
    { slug: "irene", name: "艾丽妮", point: "shoes", p0: "irene-trophy-detail-shoes.png", p1: "irene-trophy-detail-shoes-p1.png", description: "鞋履全部卸下后" },
    { slug: "cimei", name: "刺玫", point: "ankle-ribbons", p0: "cimei-trophy-detail-ankle-ribbons.png", p1: "cimei-trophy-detail-ankle-ribbons-p1.png", description: "按揉脚掌与足弓" },
    { slug: "nian", name: "年", point: "feet-overhead", p0: "nian-trophy-detail-feet-overhead.png", p1: "nian-trophy-detail-feet-overhead-p1.png", description: "白色高跟鞋已被移开" },
    { slug: "nian", name: "年", point: "feet-side", p0: "nian-trophy-detail-feet-side.png", p1: "nian-trophy-detail-feet-side-p1.png", description: "卸下高跟鞋后再从足端观察" },
    { slug: "plume", name: "翎羽", point: "boots", p0: "plume-trophy-detail-boots.png", p1: "plume-trophy-detail-boots-p1.png", description: "短靴被移开后" },
    { slug: "platinum", name: "白金", point: "feet", p0: "platinum-trophy-detail-feet.png", p1: "platinum-trophy-detail-feet-p1.png", description: "失去装备遮挡的轮廓" },
    { slug: "lappland-the-decadenza", name: "拉普兰德", point: "feet", p0: "lappland-the-decadenza-trophy-detail-feet-boots-p0.png", p1: "lappland-the-decadenza-trophy-detail-feet-white-socks.png", description: "白色罗纹短袜与黑色软垫" },
    { slug: "ho-olheyak", name: "霍尔海雅", point: "shoes", p0: "ho-olheyak-trophy-detail-shoes.png", p1: "ho-olheyak-trophy-detail-shoes-p1.png", description: "褪去精致的包装后" },
    { slug: "dorothy", name: "多萝西", point: "feet", p0: "dorothy-trophy-detail-boots-p0.png", p1: "dorothy-trophy-detail-boots-p1-white-socks.png", description: "剥下高筒靴" },
    { slug: "typhon", name: "提丰", point: "feet", p0: "typhon-trophy-detail-boots.png", p1: "typhon-trophy-detail-boots-p1.png", description: "黑丝踩脚袜" }
  ] as const;

  for (const entry of cases) {
    await page.locator(`[data-trophy-character-id='${entry.slug}']`).click();
    const detail = page.locator("#history-detail");
    await detail.locator("[data-open-trophy-gallery]").click();
    const gallery = page.locator("#trophy-gallery");
    const dossierToggle = gallery.locator("[data-dossier-toggle]");
    await dossierToggle.click();
    const dossier = gallery.locator("#trophy-dossier-panel");
    await expect(dossier.locator("[data-dossier-field='name'] dd")).toHaveText(entry.name);
    await expect(dossier.locator("[data-dossier-field]")).toHaveCount(6);
    await expect(dossier.locator(".trophy-dossier-main figure img")).toHaveAttribute("src", new RegExp(`${entry.slug}-defeated-summary-chair\\.png`));
    await dossierToggle.click();
    await gallery.locator(`[data-closeup-id='${entry.point}']`).click();
    const panel = gallery.locator("#trophy-closeup-panel");
    await expect(panel.locator(".trophy-closeup-art img")).toHaveAttribute("src", new RegExp(entry.p0.replace(".", "\\.")));
    await expect(panel.locator(".trophy-closeup-art")).toContainText("p0 · 1/2");
    await panel.locator(".trophy-closeup-art").click();
    await expect(panel.locator(".trophy-closeup-art img")).toHaveAttribute("src", new RegExp(entry.p1.replace(".", "\\.")));
    await expect(panel.locator(".trophy-closeup-art")).toContainText("p1 · 2/2");
    await expect(panel).toContainText(entry.description);
    await panel.locator(".trophy-closeup-art").click();
    await expect(panel.locator(".trophy-closeup-art img")).toHaveAttribute("src", new RegExp(entry.p0.replace(".", "\\.")));
    await gallery.locator("[data-gallery-close]").click();
    await detail.locator("[data-history-close]").click();
  }
});

test("全部角色可通过左右滑动与两侧箭头循环翻转四方向人物层", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const target = window as typeof window & { __hapticPatterns: Array<number | number[]> };
    target.__hapticPatterns = [];
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        target.__hapticPatterns.push(pattern);
        return true;
      }
    });
  });
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.history = [
    { id: "gallery-w", timestamp: "2026-08-27T20:10:00.000Z", opponentId: "w", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 1, opponent: 0 } },
    { id: "gallery-texas", timestamp: "2026-08-28T20:10:00.000Z", opponentId: "texas", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-irene", timestamp: "2026-08-29T20:10:00.000Z", opponentId: "irene", winner: "player", escaped: false, finalRoulette: { player: { bullets: 4, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 2 }, blackjacks: { player: 0, opponent: 1 } },
    { id: "gallery-nian", timestamp: "2026-08-30T20:10:00.000Z", opponentId: "nian", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-plume", timestamp: "2026-08-31T20:10:00.000Z", opponentId: "plume", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 0 }, blackjacks: { player: 1, opponent: 0 } },
    { id: "gallery-lappland", timestamp: "2026-09-01T20:10:00.000Z", opponentId: "lappland-the-decadenza", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-cimei", timestamp: "2026-09-02T20:10:00.000Z", opponentId: "cimei", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-dorothy", timestamp: "2026-09-03T20:10:00.000Z", opponentId: "dorothy", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-typhon", timestamp: "2026-09-04T20:10:00.000Z", opponentId: "typhon", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } }
  ];
  imported.defeats = [
    { opponentId: "w", timestamp: "2026-08-27T20:10:00.000Z" },
    { opponentId: "texas", timestamp: "2026-08-28T20:10:00.000Z" },
    { opponentId: "irene", timestamp: "2026-08-29T20:10:00.000Z" },
    { opponentId: "nian", timestamp: "2026-08-30T20:10:00.000Z" },
    { opponentId: "plume", timestamp: "2026-08-31T20:10:00.000Z" },
    { opponentId: "lappland-the-decadenza", timestamp: "2026-09-01T20:10:00.000Z" },
    { opponentId: "cimei", timestamp: "2026-09-02T20:10:00.000Z" },
    { opponentId: "dorothy", timestamp: "2026-09-03T20:10:00.000Z" },
    { opponentId: "typhon", timestamp: "2026-09-04T20:10:00.000Z" }
  ];
  const cases = [
    { id: "gallery-w", slug: "w", name: "W", tier: "S", closeupCount: 4, closeupId: "skirt-costume", closeupName: "黑红裙装", closeupAsset: "w-trophy-detail-skirt.png" },
    { id: "gallery-texas", slug: "texas", name: "德克萨斯", tier: "A", closeupCount: 2, closeupId: "boots", closeupName: "制服短靴", closeupAsset: "texas-trophy-detail-boots.png" },
    { id: "gallery-irene", slug: "irene", name: "艾丽妮", tier: "A", closeupCount: 4, closeupId: "hand", closeupName: "松开的手", closeupAsset: "irene-trophy-detail-hand.png" },
    { id: "gallery-nian", slug: "nian", name: "年", tier: "S", closeupCount: 5, closeupId: "tail-root", closeupName: "龙尾根部", closeupAsset: "nian-trophy-detail-tail-root.png" },
    { id: "gallery-plume", slug: "plume", name: "翎羽", tier: "B", closeupCount: 4, closeupId: "boots", closeupName: "平置短靴", closeupAsset: "plume-trophy-detail-boots.png" },
    { id: "gallery-lappland", slug: "lappland-the-decadenza", name: "拉普兰德", tier: "S", closeupCount: 4, closeupId: "feet", closeupName: "长靴与短袜", closeupAsset: "lappland-the-decadenza-trophy-detail-feet-boots-p0.png" },
    { id: "gallery-cimei", slug: "cimei", name: "刺玫", tier: "A", closeupCount: 4, closeupId: "bodice", closeupName: "白礼服束带", closeupAsset: "cimei-trophy-detail-bodice.png" },
    { id: "gallery-dorothy", slug: "dorothy", name: "多萝西", tier: "S", closeupCount: 5, closeupId: "face-inspected", closeupName: "面部摆弄特写", closeupAsset: "dorothy-trophy-detail-face-inspected.png" },
    { id: "gallery-typhon", slug: "typhon", name: "提丰", tier: "A", closeupCount: 4, closeupId: "waist-tail", closeupName: "腰部与尾巴", closeupAsset: "typhon-trophy-detail-thigh.png" }
  ] as const;

  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "gallery-cast.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await returnToLobbyMenu(page);
  await page.locator("[data-open-trophies]").click();

  for (const character of cases) {
    await page.locator(`[data-trophy-character-id='${character.slug}']`).click();
    const detail = page.locator("#history-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".history-trophy-preview > img")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-headshot\\.png`));
    await expect(detail.locator(".history-trophy-preview")).toContainText(`战利品等级：${character.tier}`);
    await expect(detail.locator(".history-trophy-preview")).toContainText(`${character.name}的死体展示`);
    await detail.locator("[data-open-trophy-gallery]").click();

    const gallery = page.locator("#trophy-gallery");
    await expect(gallery).toBeVisible();
    await expect(gallery.locator(".trophy-gallery-background")).toHaveAttribute("src", /trophy-gallery-coffin\.png/);
    await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-full-subject\\.png`));
    await expect(gallery.locator(".trophy-hotspot")).toHaveCount(character.closeupCount);
    await gallery.locator(`[data-closeup-id='${character.closeupId}']`).click();
    await expect(gallery.locator("#trophy-closeup-panel")).toContainText(character.closeupName);
    await expect(gallery.locator("#trophy-closeup-panel .trophy-closeup-art img")).toHaveAttribute("src", new RegExp(character.closeupAsset.replace(".", "\\.")));
    await expect(gallery.locator("[data-gallery-pose-id]")).toHaveCount(0);
    await expect(gallery.locator("[data-gallery-turn]")).toHaveCount(2);
    await expect(gallery.locator("[data-gallery-turn='-1']")).toHaveAttribute("aria-label", "向右翻转到右侧");
    await expect(gallery.locator("[data-gallery-turn='1']")).toHaveAttribute("aria-label", "向左翻转到左侧");
    if (character.slug === "w") {
      await page.evaluate(() => { (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns = []; });
      await swipeTrophyGallery(page, "left");
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __hapticPatterns: Array<number | number[]> }).__hapticPatterns)).toEqual([[25, 75, 25, 75, 25, 75, 25, 75]]);
      await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", /w-trophy-gallery-left-subject\.png/);
      await expect(gallery.locator("#trophy-closeup-panel")).not.toHaveClass(/is-open/);
      await expect(gallery.locator(".trophy-hotspot").first()).toBeHidden();
      await swipeTrophyGallery(page, "right");
      await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", /w-trophy-gallery-full-subject\.png/);
      await expect(gallery.locator(".trophy-hotspot").first()).toBeVisible();
    }
    for (const pose of ["left", "prone", "right"] as const) {
      await gallery.locator("[data-gallery-turn='1']").click();
      await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-${pose}-subject\\.png`));
      await expect(gallery.locator(".trophy-hotspot").first()).toBeHidden();
      await expect(gallery.locator("[data-gallery-caption]")).toContainText(`左右滑动或点按箭头翻转`);
      await gallery.screenshot({ path: testInfo.outputPath(`${character.slug}-trophy-gallery-${pose}-390.png`) });
    }
    await gallery.locator("[data-gallery-turn='1']").click();
    await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-full-subject\\.png`));
    await expect(gallery.locator(".trophy-hotspot").first()).toBeVisible();
    await gallery.locator("[data-gallery-turn='-1']").click();
    await expect(gallery.locator(".trophy-gallery-subject")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-right-subject\\.png`));
    await gallery.locator("[data-gallery-turn='1']").click();
    await gallery.screenshot({ path: testInfo.outputPath(`${character.slug}-trophy-gallery-390.png`) });
    await gallery.locator("[data-gallery-close]").click();
    await detail.locator("[data-history-close]").click();
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator("[data-trophy-character-id='cimei']").click();
  const detail = page.locator("#history-detail");
  await detail.locator("[data-open-trophy-gallery]").click();
  const gallery = page.locator("#trophy-gallery");
  await gallery.locator("[data-closeup-id='ankle-ribbons']").click();
  await expect(gallery.locator(".trophy-gallery-stage")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await gallery.screenshot({ path: testInfo.outputPath("cimei-trophy-gallery-320.png") });
});

test("开发者面板显示确定性诊断字段", async ({ page }) => {
  await page.goto("/?debug=1");
  await installLongTermSave(page, saveWithDefeats("plume", "lappland-the-decadenza"));
  await enterCharacterSelection(page);
  await startCharacter(page, "texas");
  const hud = page.locator(".dev-hud");
  await expect(hud).toBeVisible();
  for (const label of ["种子", "轮次 / 阶段", "牌库剩余", "玩家真实手牌", "对手真实手牌", "AI 参数 P / A / B / C", "Rmatch / Rplay", "上次手牌值 / 阈值 T", "上次行动", "上次领域事件"])
    await expect(hud).toContainText(label);
});

test("AI 发牌后强制等待并只在中点切换一次展示动作", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = findTurnsMatch("e2e-ai-wait");
  const historyLength = activeMatch.history.length;
  const delay = getAiTurnDelayMs(activeMatch);
  await page.goto("/?debug=1");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "ai-wait.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  const waiting = page.locator("#ai-wait");
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText("正在观察牌面");
  await page.waitForTimeout(Math.round(delay / 2) + 100);
  await expect(waiting).toBeVisible();
  await expect(waiting).toHaveAttribute("data-step", "shifted");
  await expect(page.locator(".character-portrait")).toHaveAttribute("src", /w-conflicted\.png/);
  const during = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { history: unknown[] } };
  expect(during.relevantMatchState.history).toHaveLength(historyLength);
  await expect(waiting).toHaveCount(0, { timeout: delay });
});

test("完整自动对局经过开牌与扣扳机结果停顿并回到大厅", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
      nativeSetTimeout(handler, typeof timeout === "number" && timeout >= 2_000 ? 25 : timeout, ...args)) as typeof window.setTimeout;
  });
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = createMatch("e2e-full-match");
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "active-match.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toBeVisible();
  await expect(page.locator(".dialogue")).not.toHaveText("“”");
  await expect(page.locator(".character-portrait")).not.toHaveClass(/character-shake/);
  let sawReveal = false;
  let sawTriggerResult = false;
  for (let step = 0; step < 260 && !(await page.locator("main.summary-shell").count()); step += 1) {
    const phase = await page.locator("main.table-shell").getAttribute("data-phase").catch(() => null);
    if (phase === "round-reveal") {
      sawReveal = true;
      await expect(page.locator(".round-notice")).toBeVisible();
      await expect(page.locator(".round-notice")).toContainText(/本轮|平局|胜利|爆牌|黑杰克/);
      const isPush = (await page.locator(".round-notice").textContent())?.includes("平局") ?? false;
      const ack = page.locator("button[data-action*='ACK_ROUND_RESULT']:not([disabled])");
      if (await ack.count()) {
        await expect(ack).toHaveText("确认结果");
        await ack.click();
        if (isPush) {
          await expect(page.locator("main.table-shell")).not.toHaveAttribute("data-phase", /roulette-(reaction|trigger)/);
        } else {
          await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", /roulette-(reaction|trigger)/);
        }
      } else await page.waitForTimeout(80);
    }
    else if (phase === "roulette-reaction" || phase === "roulette-trigger") {
      const trigger = page.locator("button[data-action*='TRIGGER_ROULETTE']:not([disabled])");
      if (await trigger.count()) {
        await trigger.click();
        await page.waitForFunction((previousPhase) => document.querySelector("main.table-shell")?.getAttribute("data-phase") !== previousPhase, phase);
      } else await page.waitForTimeout(80);
    }
    else if (phase === "roulette-result") { sawTriggerResult = true; const ack = page.locator("button[data-action*='ACK_TRIGGER_RESULT']:not([disabled])"); if (await ack.count()) await ack.click(); else await page.waitForTimeout(80); }
    else {
      const stand = page.locator("button[data-action*='PLAYER_STAND']:not([disabled])");
      if (await stand.count()) await stand.click();
      else await page.waitForTimeout(80);
    }
  }
  await expect(page.locator("main.summary-shell")).toBeVisible({ timeout: 8_000 });
  expect(sawReveal).toBe(true);
  expect(sawTriggerResult).toBe(true);
  const playerWon = await page.getByRole("heading", { name: "策展人胜利" }).isVisible();
  await page.getByRole("button", { name: "返回大厅" }).click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await page.locator("[data-open-trophies]").click();
  await expect(page.locator(".trophy-card")).toHaveCount(playerWon ? 1 : 0);
  await page.getByRole("button", { name: "查看历史记录" }).click();
  await expect(page.locator(".trophy-card")).toHaveCount(1);
});

test("确认结果启动循环心跳且扣扳机立即切换为击发音效", async ({ page }) => {
  await page.addInitScript(() => {
    type AudioEvent = { type: "start" | "stop"; duration: number; loop: boolean };
    const target = window as typeof window & { __audioEvents: AudioEvent[] };
    target.__audioEvents = [];
    const NativeAudioContext = window.AudioContext;
    class ObservedAudioContext extends NativeAudioContext {
      override createBufferSource(): AudioBufferSourceNode {
        const source = super.createBufferSource();
        const nativeStart = source.start.bind(source);
        const nativeStop = source.stop.bind(source);
        source.start = (...args) => {
          target.__audioEvents.push({ type: "start", duration: source.buffer?.duration ?? 0, loop: source.loop });
          nativeStart(...args);
        };
        source.stop = (...args) => {
          target.__audioEvents.push({ type: "stop", duration: source.buffer?.duration ?? 0, loop: source.loop });
          nativeStop(...args);
        };
        return source;
      }
    }
    Object.defineProperty(window, "AudioContext", { value: ObservedAudioContext, configurable: true });
  });
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = false;
  const activeMatch = opponentPenaltyReveal();
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "audio-reveal.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");

  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-trigger");
  await page.waitForFunction(() => {
    const events = (window as typeof window & { __audioEvents: Array<{ type: string; duration: number; loop: boolean }> }).__audioEvents;
    return events.some((event) => event.type === "start" && event.loop && event.duration > 10);
  });
  const afterConfirm = await page.evaluate(() => (window as typeof window & { __audioEvents: Array<{ type: string; duration: number; loop: boolean }> }).__audioEvents);
  expect(afterConfirm.some((event) => event.type === "start" && !event.loop && event.duration > 0.1 && event.duration < 0.4)).toBe(true);

  await page.getByRole("button", { name: "静观好戏" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-result");
  await page.waitForFunction(() => {
    const events = (window as typeof window & { __audioEvents: Array<{ type: string; duration: number; loop: boolean }> }).__audioEvents;
    return events.some((event) => event.type === "stop" && event.loop)
      && events.some((event) => event.type === "start" && !event.loop && event.duration > 0.4 && event.duration < 0.8);
  });
});

test("艾丽妮受罚时显示受胁迫立绘与工作人员左轮", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = { ...opponentPenaltyReveal(), opponentId: "irene" };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "irene-trigger.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");

  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-trigger");
  const strip = page.locator(".character-strip");
  const portrait = strip.locator("img.character-portrait");
  const revolver = strip.locator("img.trigger-prop");
  await expect(portrait).toHaveAttribute("src", /irene-threatened\.png/);
  await expect(revolver).toBeVisible();
  await expect(revolver).toHaveAttribute("src", /staff-revolver-7mm\.png/);
  const [portraitZIndex, revolverZIndex] = await Promise.all([
    portrait.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
    revolver.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10))
  ]);
  expect(revolverZIndex).toBeGreaterThan(portraitZIndex);
  await strip.screenshot({ path: testInfo.outputPath("irene-trigger.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await strip.screenshot({ path: testInfo.outputPath("irene-trigger-320.png") });
});

test("年受罚时只切换紧张立绘并叠加共享左轮", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = { ...opponentPenaltyReveal(), opponentId: "nian" };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "nian-trigger.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");

  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-trigger");
  const strip = page.locator(".character-strip");
  const portrait = strip.locator("img.character-portrait");
  const revolver = strip.locator("img.trigger-prop");
  await expect(portrait).toHaveAttribute("src", /nian-threatened\.png/);
  await expect(revolver).toBeVisible();
  await expect(revolver).toHaveAttribute("src", /staff-revolver-7mm\.png/);
  await expect(revolver).toHaveCSS("z-index", "6");
  await strip.screenshot({ path: testInfo.outputPath("nian-trigger.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await strip.screenshot({ path: testInfo.outputPath("nian-trigger-320.png") });
});

test("翎羽受罚时保持严肃紧张立绘并校准共享左轮", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-09-02T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const activeMatch = { ...opponentPenaltyReveal(), opponentId: "plume" };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "plume-trigger.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");

  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "roulette-trigger");
  const strip = page.locator(".character-strip");
  const portrait = strip.locator("img.character-portrait");
  const revolver = strip.locator("img.trigger-prop");
  await expect(portrait).toHaveAttribute("src", /plume-threatened\.png/);
  await expect(portrait).toHaveCSS("--character-art-scale", "1.3");
  await expect(revolver).toBeVisible();
  await expect(revolver).toHaveAttribute("src", /staff-revolver-7mm\.png/);
  await expect(revolver).toHaveCSS("z-index", "6");
  await strip.screenshot({ path: testInfo.outputPath("plume-trigger-390.png") });
  await page.setViewportSize({ width: 320, height: 720 });
  await strip.screenshot({ path: testInfo.outputPath("plume-trigger-320.png") });
});
