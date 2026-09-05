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
import type { AbilityBinding } from "../../src/core/abilities/types";

const wCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/w.json", import.meta.url), "utf8")) as {
  dialogue: { PLAYER_BLACKJACK: string[]; PLAYER_WIN_ROUND: string[] };
  aiSkills: AbilityBinding[];
};
const ireneCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/irene.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const lapplandCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/lappland-the-decadenza.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const hoOlheyakCharacterData = JSON.parse(readFileSync(new URL("../../src/content/characters/data/ho-olheyak.json", import.meta.url), "utf8")) as { aiSkills: AbilityBinding[] };
const wDialogue = wCharacterData.dialogue;

function findTurnsMatch(prefix: string) {
  for (let index = 0; index < 10_000; index += 1) {
    const match = createMatch(`${prefix}-${index}`);
    if (match.round.phase === "turns" && match.round.currentActor === "opponent") return match;
  }
  throw new Error("No deterministic turns fixture found");
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
          parameters: { rank: "4", suit, origin: "shoe" },
          createdAtSequence: dealt.abilities.sequence
        }]
      }
    };
  }
  throw new Error("No deterministic Ho-olheyak information-bar fixture found");
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
  const entry = page.locator("[data-enter-duel]");
  if (await entry.isVisible()) await entry.click();
  await expect(page.locator("main.lobby-character-shell")).toBeVisible();
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
  await expect(page.locator(".guest-section:not(.defeated-section) .character-card")).toHaveCount(3);
  await expect(page.locator(".defeated-section .character-card")).toHaveCount(0);
  await expect(page.locator("[data-character-id='w'], [data-character-id='nian']")).toHaveCount(0);
  const initialCandidateIds = await page.locator(".guest-section:not(.defeated-section) .character-card").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId ?? ""));
  expect(initialCandidateIds.every((id) => ["texas", "irene", "plume", "platinum", "lappland-the-decadenza"].includes(id))).toBe(true);
  await inviteCharacter(page, "texas");
  const profile = page.locator("#profile");
  await expect(profile).toContainText("德克萨斯");
  await expect(profile.locator(".profile-ability")).toHaveCount(1);
  await expect(profile.locator(".profile-ability summary").first()).toContainText("细雨无声");
  await expect(profile.locator(".profile-ability summary").first()).toContainText("主动选择 Stand 后");
  await expect(profile.locator(".profile-ability[open]")).toHaveCount(0);
  expect(await profile.locator("#profile-content").evaluate((content) => {
    const abilities = content.querySelector(".profile-abilities");
    const description = content.querySelector(".profile-description");
    return Boolean(abilities && description && (abilities.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  const profileStartBox = await profile.locator("[data-profile-start]").boundingBox();
  const profileContentBox = await profile.locator("#profile-content").boundingBox();
  expect(profileStartBox).not.toBeNull();
  expect(profileContentBox).not.toBeNull();
  expect(profileStartBox!.height).toBeGreaterThanOrEqual(60);
  expect(Math.abs(profileStartBox!.width - profileContentBox!.width)).toBeLessThanOrEqual(1);
  const texasCard = page.locator("[data-character-id='texas']");
  const portraitBox = await texasCard.locator(".portrait").boundingBox();
  const inviteBox = await texasCard.locator("[data-invite-character]").boundingBox();
  expect(portraitBox).not.toBeNull();
  expect(inviteBox).not.toBeNull();
  expect(Math.abs((portraitBox!.y + portraitBox!.height) - (inviteBox!.y + inviteBox!.height))).toBeLessThanOrEqual(2);
  await expect(texasCard.locator(".card-invite")).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await profile.evaluate((element) => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await profile.locator(".profile-ability").first().locator("summary").click();
  await expect(profile.locator(".profile-ability").first().locator("p")).toBeVisible();
  const skillTypography = await profile.locator(".profile-ability").first().evaluate((ability) => ({ name: getComputedStyle(ability.querySelector("summary strong")!).fontWeight, description: getComputedStyle(ability.querySelector("summary span")!).fontWeight, lore: getComputedStyle(ability.querySelector("p")!).fontWeight, summarySize: parseFloat(getComputedStyle(ability.querySelector("summary")!).fontSize), loreSize: parseFloat(getComputedStyle(ability.querySelector("p")!).fontSize) }));
  expect(skillTypography.name).toBe("700");
  expect(skillTypography.description).toBe("400");
  expect(skillTypography.lore).toBe("300");
  expect(skillTypography.loreSize).toBeLessThan(skillTypography.summarySize);
  const profileFonts = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, title: getComputedStyle(document.querySelector(".lobby-title-block h1") ?? document.body).fontFamily, skill: getComputedStyle(document.querySelector(".profile-ability summary") ?? document.body).fontFamily }));
  expect(Object.values(profileFonts).every((font) => !/(songti|stsong|simsun|noto serif)/i.test(font))).toBe(true);
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
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
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2)).toBe(true);
  await expect(page.locator(".table-shell")).not.toContainText("7mm 左轮");
  const dialogue = page.locator("#dialogue-text");
  await expect(dialogue).toHaveAttribute("data-typing", "true");
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

test("霍尔海雅的信息栏以花色在前并按红黑牌色显示记忆牌", async ({ page }) => {
  await page.goto("/");
  await installRuntimeSave(page, hoOlheyakInfoBarMatch());

  const infoBar = page.locator(".ai-info-bar");
  await expect(infoBar).toContainText("记忆牌");
  const rememberedCard = infoBar.locator(".ai-info-card");
  await expect(rememberedCard.locator("em")).toHaveText("♥");
  await expect(rememberedCard.locator("b")).toHaveText("4");
  expect(await rememberedCard.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => node.tagName))).toEqual(["EM", "B"]);
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
  expect(appearance.height).toBeGreaterThanOrEqual(24);

  await installRuntimeSave(page, hoOlheyakInfoBarMatch("spades"));
  const blackCard = page.locator(".ai-info-bar .ai-info-card.black");
  await expect(blackCard.locator("em")).toHaveText("♠");
  await expect(blackCard).toHaveCSS("color", "rgb(21, 26, 30)");
});

test("早有准备提供一次主动抽卡且单击候选立即确认", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as typeof window & { __skillGainEntries: Array<{ text: string; at: number }> };
    target.__skillGainEntries = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.matches("#skill-gain-announcement")) continue;
        target.__skillGainEntries.push({ text: node.textContent ?? "", at: performance.now() });
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto("/?debug=1");
  await enterCharacterSelection(page);
  await inviteCharacter(page, "texas");
  await page.locator("[data-profile-start]").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  const drawButton = page.locator(".draw-skill-button");
  await expect(drawButton).toBeEnabled({ timeout: 8_000 });
  await expect(drawButton).toHaveAttribute("aria-label", "抽取技能，剩余 1 次");
  await expect(drawButton.locator(".draw-skill-badge")).toHaveText("1");
  await drawButton.click();
  const offer = page.locator(".skill-draw-modal");
  await expect(offer.getByRole("heading")).toHaveText("选一张你心仪的技能卡");
  await expect(offer.locator(".skill-draw-card")).toHaveCount(3);
  await expect(offer.getByRole("button", { name: /放弃|确认/ })).toHaveCount(0);
  await offer.locator(".skill-draw-card").first().click();
  await expect(offer).toHaveCount(0);
  const initialMatchDebug = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { playerSkills: { cards: string[]; drawCount: number }; talentIds: string[] } };
  expect(initialMatchDebug.relevantMatchState.playerSkills.cards).toHaveLength(1);
  expect(initialMatchDebug.relevantMatchState.playerSkills.drawCount).toBe(0);
  expect(initialMatchDebug.relevantMatchState.talentIds).toContain("early-preparation");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __skillGainEntries: unknown[] }).__skillGainEntries.length), { timeout: 5_000 }).toBe(1);
  const entries = await page.evaluate(() => (window as typeof window & { __skillGainEntries: Array<{ text: string; at: number }> }).__skillGainEntries);
  expect(entries.every((entry) => entry.text.startsWith("获得技能牌："))).toBe(true);
  await expect(page.locator("#skill-gain-announcement")).toHaveCount(0, { timeout: 2_500 });
});

test("技能牌库满时保留抽卡次数并禁用抽取按钮", async ({ page }) => {
  const source = findTurnsMatch("full-skill-draw-ui");
  const cards = Array.from({ length: 10 }, (_, index) => ({
    kind: "player-skill" as const,
    definitionId: "hunter-instinct",
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
  await expect(page.locator(".character-card")).toHaveCount(0);
  await enterCharacterSelection(page);
  await expect(page.locator(".character-card")).toHaveCount(3);
  expect(requestedPaths.some((path) => path.includes("/content/characters/data/"))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
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
  await expect(page.locator(".character-card")).toHaveCount(3);
  const ireneRequestedPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    ireneRequestedPaths.push(decodeURIComponent(`${url.pathname}${url.search}`));
  });
  await startCharacter(page, "irene");
  expect(ireneRequestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(true);
  expect(ireneRequestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/(?:w|texas|nian|plume|platinum|lappland-the-decadenza)\.json|\/assets\/(?:w|texas|nian|plume|platinum|lappland-the-decadenza)-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
});

test("击败 A 级角色会显示 S 级解锁，刷新候场时确保换人", async ({ page }, testInfo) => {
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
  await expect(unlockPanel).toContainText("年");
  await expect(unlockPanel).toContainText("击败一名A级角色");
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
  const availableAfterTexas = new Set(["w", "irene", "nian", "plume", "platinum", "lappland-the-decadenza"]);
  expect([...before, ...after].every((id) => availableAfterTexas.has(id))).toBe(true);
  expect(new Set([...before, ...after]).size).toBeGreaterThanOrEqual(4);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath("guest-selection-unlocked-320.png"), fullPage: true });
});

test("已击败宾客按首次胜利时间去重排列且可以再次邀请", async ({ page }) => {
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
  expect(await defeatedCards.evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.characterId))).toEqual(["texas", "irene"]);
  await expect(defeatedCards.locator("[data-invite-character]")).toHaveCount(2);
  await defeatedCards.first().locator("[data-invite-character='texas']").click();
  await expect(page.locator("#profile")).toContainText("已经成为了一具尸体");
  await expect(page.locator("#profile [data-profile-start]")).toHaveCount(1);
  await page.locator("#profile [data-profile-start]").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
});

test("年作为第四角色显示解离式档案并按需载入", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.history = [
    victoryRecord("unlock-texas", "texas", "2026-08-28T00:00:00.000Z"),
    victoryRecord("unlock-irene", "irene", "2026-08-29T00:00:00.000Z")
  ];
  imported.defeats = [
    { opponentId: "texas", timestamp: "2026-08-28T00:00:00.000Z" },
    { opponentId: "irene", timestamp: "2026-08-29T00:00:00.000Z" }
  ];
  imported.profile = { ...imported.profile, matchesPlayed: 2, wins: 2 };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "unlocked-nian.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await enterCharacterSelection(page);
  await expect(page.locator(".character-card")).toHaveCount(5);
  await inviteCharacter(page, "nian");
  const profile = page.locator("#profile");
  await expect(profile).toContainText("年");
  await expect(profile.locator(".profile-ability")).toHaveCount(2);
  await expect(profile.locator(".profile-ability summary")).toContainText(["洪炉示岁", "铜印"]);
  await expect(profile.locator("#profile-content")).toHaveText(/\S+/);
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await waitForInitialDeal(page);
  await expect(page.locator(".character-strip .eyebrow")).toContainText("年 // S级");
  await expect(page.locator("img.character-portrait")).toHaveAttribute("src", /nian-(?:relaxed|conflicted|mocking)\.png/);
});

test("正式角色档案显示各自已启用技能", async ({ page }) => {
  await page.goto("/");
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

test("暗置衍生牌暴露来源标记但不泄露牌面", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  const source = findTurnsMatch("derived-card-visibility");
  const opponent = { ...source.opponent, hand: { cards: [source.opponent.hand.cards[0]!, createDerivedCard("hearts", "K")] } };
  const activeMatch = { ...source, opponent, round: { ...source.round, opponent } };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "derived.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await installRuntimeSave(page, activeMatch);
  const hidden = page.locator(".opponent-zone .cards .card").nth(1);
  await expect(hidden).toHaveClass(/card-back/);
  await expect(hidden).toHaveAttribute("data-card-origin", "derived");
  await expect(hidden).toHaveAttribute("aria-label", "暗牌");
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
  await expect(skills.locator(".loadout-skill")).toHaveCount(8);
  await expect(skills.locator(".loadout-skill.talent")).toContainText("早有准备");
  await expect(skills).not.toContainText("罗德岛万人迷");
  await expect(skills.locator(".profile-ability[open]")).toHaveCount(0);
  await skills.locator(".profile-ability").first().locator("summary").click();
  await expect(skills.locator(".profile-ability").first().locator("p")).toBeVisible();
  await skills.locator(".profile-ability").first().locator("summary").click();
  await skills.locator(".profile-ability").nth(1).locator("summary").click();
  await expect(skills.locator(".profile-ability[open]")).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(skills.locator("input[data-equip-skill]")).toHaveCount(0);
  const lockedNightQueen = skills.locator(".loadout-skill").filter({ hasText: "暗夜女王" });
  await expect(lockedNightQueen).toHaveClass(/locked/);
  await lockedNightQueen.locator(".profile-ability summary").click();
  await expect(lockedNightQueen.locator(".profile-ability p")).toBeVisible();
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

test("不兼容长期存档必须手动点击并确认删除", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await putSaveRecord(page, "long-term", { marker: "outdated-save", schemaVersion: 99 });
  await page.reload();
  await expect(page.locator("main.error-shell")).toBeVisible();
  await expect(page.locator("main.error-shell")).toContainText("长期存档");
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
  const nightQueen = page.locator("#skills .loadout-skill").filter({ hasText: "暗夜女王" });
  await expect(nightQueen).not.toHaveClass(/locked/);
  await expect(nightQueen).toContainText("已解锁，可在牌局中掉落");
});

test("玩家落败结算可回溯并与同一名与会者重开", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
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
  const hunterCard = { kind: "player-skill" as const, definitionId: "hunter-instinct", owner: "player" as const, instanceId: "e2e-hunter-instinct" };
  const hunterSequence = source.abilities.sequence + 1;
  imported.settings.reducedMotion = true;
  const activeMatch: MatchState = {
    ...source,
    round: { ...source.round, currentActor: "player" },
    playerSkills: { ...source.playerSkills, unlockedDefinitionIds: [...new Set([...source.playerSkills.unlockedDefinitionIds, "hunter-instinct"])], cards: [hunterCard], drawCount: 2 },
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
  const activeSkill = page.locator(".skill-sidebar button.skill-card[data-action*='hunter-instinct']");
  const activeCardsBefore = await activeSkill.allTextContents();
  expect(activeCardsBefore).toEqual(["猎手直觉主动"]);
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
  await page.locator("[data-skill-info='hunter-instinct']").click();
  await expect(page.locator("#skill-info-dialog")).toBeVisible();
  await expect(page.locator("#skill-info-dialog .profile-ability summary")).toContainText("猎手直觉：");
  await expect(page.locator("#skill-info-dialog .profile-ability[open]")).toHaveCount(0);
  await page.locator("#skill-info-dialog .profile-ability summary").click();
  await expect(page.locator("#skill-info-dialog #skill-info-lore")).toBeVisible();
  await expect(page.locator("#skill-info-dialog")).toContainText("数学最优 Hit / Stand");
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
  await expect(page.locator(".skill-advice")).toBeVisible();
  await expect(page.locator("#presentation")).toContainText("策展人发动了技能「猎手直觉」");
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

test("闻香识女人只在本轮显示对手暗牌花色", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const source = findTurnsMatch("scent-ui");
  const player = { ...source.player, hand: createHand([createCard("spades", "10"), createCard("clubs", "6")]) };
  const opponent = { ...source.opponent, hand: createHand([createCard("clubs", "10"), createCard("hearts", "6")]), stood: true, busted: false };
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
  const hidden = page.locator(".opponent-zone .card-back").first();
  await expect(hidden).toHaveAttribute("aria-label", /花色红桃/);
  await expect(hidden).not.toContainText("6");
  await expect(page.locator("#presentation")).toContainText("闻香识女人");
  await page.getByRole("button", { name: /Stand 停牌/ }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");
  await page.getByRole("button", { name: "确认结果" }).click();
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "turns");
  await expect(page.locator(".opponent-zone .card-back").first()).not.toHaveClass(/revealed-suit/);
});

test("德克萨斯发动细雨无声时展示效果，点击被封锁技能给出短暂警告", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const base = createMatch("e2e-silent-drizzle", {
    opponentId: "texas",
    unlockedPlayerSkillIds: ["hunter-instinct"],
    opponentAiSkills: [{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]
  });
  const hunterCard = { kind: "player-skill" as const, definitionId: "hunter-instinct", owner: "player" as const, instanceId: "e2e-silent-drizzle-hunter" };
  const sequence = base.abilities.sequence + 1;
  const player = { ...base.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "6")]), stood: false, busted: false };
  const opponent = { ...base.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: false, busted: false };
  imported.settings.reducedMotion = true;
  const activeMatch: MatchState = {
    ...base,
    player,
    opponent,
    shoe: { cards: [createCard("clubs", "2")], cursor: 0, shuffleIndex: 1 },
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
  await expect(page.locator("#presentation")).toContainText("德克萨斯发动了技能「细雨无声」", { timeout: 8_000 });
  await expect(page.locator("#presentation")).toContainText("玩家下一手牌期间无法使用主动技能");

  await page.locator(".skill-drawer-toggle").click();
  const blockedSkill = page.locator(".skill-card[data-skill-id='hunter-instinct']");
  await expect(blockedSkill).toHaveAttribute("aria-disabled", "true");
  await blockedSkill.click({ force: true });
  await expect(page.locator("#presentation")).toContainText("技能被禁用");

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
  await enterCharacterSelection(page);
  await startCharacter(page, "texas");
  const fullscreen = page.locator("[data-fullscreen]");
  await expect(fullscreen).toHaveAttribute("aria-label", "进入全屏");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-label", "退出全屏");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-label", "进入全屏");
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
  await expect(gallery.locator(".trophy-hotspot")).toHaveCount(4);
  await expect(gallery.locator(".trophy-gallery-stage figcaption")).toHaveText("正面 · 左右滑动或点按箭头翻转 · 点按圆环查看特写");
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
  await expect(gallery.locator("#trophy-closeup-panel > img")).toHaveAttribute("src", /nian-trophy-detail-tail-root\.png/);
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-tail-root.png") });
  await gallery.locator("[data-closeup-id='feet-side']").click();
  await expect(gallery.locator("#trophy-closeup-panel")).toContainText("足部·侧面");
  await expect(gallery.locator("#trophy-closeup-panel > img")).toHaveAttribute("src", /nian-trophy-detail-feet-side\.png/);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(gallery.locator(".trophy-gallery-stage")).toBeInViewport();
  await gallery.screenshot({ path: testInfo.outputPath("nian-trophy-feet-side-320.png") });
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

test("全部角色可通过左右滑动与两侧箭头循环翻转四方向人物层", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.history = [
    { id: "gallery-w", timestamp: "2026-08-27T20:10:00.000Z", opponentId: "w", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 1, opponent: 0 } },
    { id: "gallery-texas", timestamp: "2026-08-28T20:10:00.000Z", opponentId: "texas", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-irene", timestamp: "2026-08-29T20:10:00.000Z", opponentId: "irene", winner: "player", escaped: false, finalRoulette: { player: { bullets: 4, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 2 }, blackjacks: { player: 0, opponent: 1 } },
    { id: "gallery-nian", timestamp: "2026-08-30T20:10:00.000Z", opponentId: "nian", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-plume", timestamp: "2026-08-31T20:10:00.000Z", opponentId: "plume", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 0 }, blackjacks: { player: 1, opponent: 0 } },
    { id: "gallery-lappland", timestamp: "2026-09-01T20:10:00.000Z", opponentId: "lappland-the-decadenza", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } }
  ];
  imported.defeats = [
    { opponentId: "w", timestamp: "2026-08-27T20:10:00.000Z" },
    { opponentId: "texas", timestamp: "2026-08-28T20:10:00.000Z" },
    { opponentId: "irene", timestamp: "2026-08-29T20:10:00.000Z" },
    { opponentId: "nian", timestamp: "2026-08-30T20:10:00.000Z" },
    { opponentId: "plume", timestamp: "2026-08-31T20:10:00.000Z" },
    { opponentId: "lappland-the-decadenza", timestamp: "2026-09-01T20:10:00.000Z" }
  ];
  const cases = [
    { id: "gallery-w", slug: "w", name: "W", tier: "S", closeupCount: 4, closeupId: "skirt-costume", closeupName: "黑红裙装", closeupAsset: "w-trophy-detail-skirt.png" },
    { id: "gallery-texas", slug: "texas", name: "德克萨斯", tier: "A", closeupCount: 3, closeupId: "boots-removed", closeupName: "卸下的短靴", closeupAsset: "texas-trophy-detail-boots-removed.png" },
    { id: "gallery-irene", slug: "irene", name: "艾丽妮", tier: "A", closeupCount: 4, closeupId: "hand", closeupName: "松开的手", closeupAsset: "irene-trophy-detail-hand.png" },
    { id: "gallery-nian", slug: "nian", name: "年", tier: "S", closeupCount: 4, closeupId: "tail-root", closeupName: "龙尾根部", closeupAsset: "nian-trophy-detail-tail-root.png" },
    { id: "gallery-plume", slug: "plume", name: "翎羽", tier: "B", closeupCount: 4, closeupId: "boots", closeupName: "平置短靴", closeupAsset: "plume-trophy-detail-boots.png" },
    { id: "gallery-lappland", slug: "lappland-the-decadenza", name: "拉普兰德", tier: "S", closeupCount: 4, closeupId: "feet-white-socks", closeupName: "卸下长靴", closeupAsset: "lappland-the-decadenza-trophy-detail-feet-white-socks.png" }
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
    await expect(gallery.locator("#trophy-closeup-panel > img")).toHaveAttribute("src", new RegExp(character.closeupAsset.replace(".", "\\.")));
    await expect(gallery.locator("[data-gallery-pose-id]")).toHaveCount(0);
    await expect(gallery.locator("[data-gallery-turn]")).toHaveCount(2);
    await expect(gallery.locator("[data-gallery-turn='-1']")).toHaveAttribute("aria-label", "向右翻转到右侧");
    await expect(gallery.locator("[data-gallery-turn='1']")).toHaveAttribute("aria-label", "向左翻转到左侧");
    if (character.slug === "w") {
      await swipeTrophyGallery(page, "left");
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
  await page.locator("[data-trophy-character-id='irene']").click();
  const detail = page.locator("#history-detail");
  await detail.locator("[data-open-trophy-gallery]").click();
  const gallery = page.locator("#trophy-gallery");
  await gallery.locator("[data-closeup-id='shoes']").click();
  await expect(gallery.locator(".trophy-gallery-stage")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await gallery.screenshot({ path: testInfo.outputPath("irene-trophy-gallery-320.png") });
});

test("开发者面板显示确定性诊断字段", async ({ page }) => {
  await page.goto("/?debug=1");
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
      await expect(page.locator(".round-notice")).toContainText(/本轮|平局|获胜|爆牌|黑杰克/);
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
