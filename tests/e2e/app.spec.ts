import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createDefaultSave } from "../../src/persistence/boot";
import { createMatch } from "../../src/core/match/reducer";
import type { MatchHistoryRecord } from "../../src/core/match/history";
import type { MatchState } from "../../src/core/match/types";
import { getAiTurnDelayMs } from "../../src/presentation/ai-timing";

const wDialogue = (JSON.parse(readFileSync(new URL("../../src/content/characters/data/w.json", import.meta.url), "utf8")) as {
  dialogue: { PLAYER_BLACKJACK: string[]; PLAYER_WIN_ROUND: string[] };
}).dialogue;

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

function opponentPenaltyReveal(): MatchState {
  const match = findTurnsMatch("audio-confirm");
  const outcome = { winner: "player" as const, reason: "comparison" as const, penaltyTarget: "opponent" as const, bulletsAdded: 1, playerSkillReward: 1 };
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

async function openLobbySettings(page: Page): Promise<void> {
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();
  await page.locator("button.lobby-settings-button").click();
}

async function returnToLobbyMenu(page: Page): Promise<void> {
  const back = page.locator("[data-lobby-home]");
  if (await back.isVisible()) await back.click();
  await expect(page.locator("main.lobby-menu-shell")).toBeVisible();
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
  await expect(page.locator(".character-card")).toHaveCount(4);
  await page.getByRole("button", { name: "查看档案" }).first().click();
  const profile = page.locator("#profile");
  await expect(profile).toContainText("W");
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator("#skill-gain-announcement")).toContainText("获得技能牌：", { timeout: 5_000 });
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
  if (await page.locator("main.table-shell").getAttribute("data-phase") === "turns") {
    await expect(page.locator("#presentation")).toHaveText("");
  }
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
  await page.getByRole("button", { name: "返回舞会大厅" }).click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
});

test("新对局逐张展示早有准备带来的两张技能牌", async ({ page }) => {
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
  await page.locator("[data-start-character='w']").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  const initialMatchDebug = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { skills: { cards: string[]; equippedSkillIds: string[] }; history: Array<{ type: string; actor?: string }> } };
  const playerBlackjack = initialMatchDebug.relevantMatchState.history.some((event) => event.type === "BLACKJACK" && event.actor === "player");
  const expectedInitialGains = 2 + (playerBlackjack ? 2 : 0);
  expect(initialMatchDebug.relevantMatchState.skills.cards).toHaveLength(expectedInitialGains);
  expect(initialMatchDebug.relevantMatchState.skills.equippedSkillIds).toContain("early-preparation");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __skillGainEntries: unknown[] }).__skillGainEntries.length), { timeout: 5_000 }).toBe(expectedInitialGains);
  const entries = await page.evaluate(() => (window as typeof window & { __skillGainEntries: Array<{ text: string; at: number }> }).__skillGainEntries);
  expect(entries.every((entry) => entry.text.startsWith("获得技能牌："))).toBe(true);
  expect(entries[1]!.at - entries[0]!.at).toBeGreaterThanOrEqual(900);
  await expect(page.locator("#skill-gain-announcement")).toHaveCount(0, { timeout: 2_500 });
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
  await expect(page.locator(".character-card")).toHaveCount(4);
  expect(requestedPaths.some((path) => path.includes("/content/characters/data/"))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/nian\.json|\/assets\/nian-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /texas-(conflicted|mocking|threatened|unconscious|defeated-summary)/.test(path))).toBe(false);
  await page.locator("[data-start-character='texas']").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/texas\.json|\/assets\/texas-[^/]+\.js)(?:\?|$)/.test(path))).toBe(true);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/w\.json|\/assets\/w-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/nian\.json|\/assets\/nian-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);

  await page.locator("button[aria-label='离开余兴牌桌']").click();
  await expect(page.getByRole("heading", { name: "已离席" })).toBeVisible();
  await page.getByRole("button", { name: "返回舞会大厅" }).click();
  await enterCharacterSelection(page);
  await expect(page.locator(".character-card")).toHaveCount(4);
  const ireneRequestedPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    ireneRequestedPaths.push(decodeURIComponent(`${url.pathname}${url.search}`));
  });
  await page.locator("[data-start-character='irene']").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  expect(ireneRequestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/irene\.json|\/assets\/irene-[^/]+\.js)(?:\?|$)/.test(path))).toBe(true);
  expect(ireneRequestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/(?:w|texas|nian)\.json|\/assets\/(?:w|texas|nian)-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
});

test("年作为第四角色显示解离式档案并按需载入", async ({ page }) => {
  await page.goto("/");
  await enterCharacterSelection(page);
  await expect(page.locator(".character-card")).toHaveCount(4);
  await page.locator("[data-profile-id='nian']").click();
  const profile = page.locator("#profile");
  await expect(profile).toContainText("年");
  await expect(profile.locator("#profile-content")).toHaveText(/\S+/);
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".character-strip .eyebrow")).toContainText("年 // S级");
  await expect(page.locator("img.character-portrait")).toHaveAttribute("src", /nian-(?:relaxed|conflicted)\.png/);
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
  await page.getByRole("button", { name: "技能管理" }).click();
  const skills = page.locator("#skills");
  await expect(skills.locator(".loadout-skill")).toHaveCount(6);
  await expect(skills.locator("input[data-equip-skill]:checked")).toHaveCount(4);
  await expect(skills.locator("input[data-equip-skill='night-queen']")).toBeDisabled();
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
  await expect(page.locator("[data-open-trophies]")).toContainText("0 局");
});

test("旧版 IndexedDB 存档在启动时直接丢弃并覆盖", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("house-of-chances");
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("saves", "readwrite");
        transaction.objectStore("saves").put({ id: "current", data: { marker: "outdated-save", schemaVersion: 99 } });
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open("house-of-chances");
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("saves", "readonly");
        const get = transaction.objectStore("saves").get("current");
        get.onsuccess = () => resolve((get.result as { data: Record<string, unknown> }).data);
        get.onerror = () => reject(get.error);
      };
    });
  });
  expect(stored.schemaVersion).toBe(createDefaultSave().schemaVersion);
  expect(stored.marker).toBeUndefined();
  await page.reload();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
});

test("玩家胜利结算使用独立椅子全身图且不存在中央空黑块", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  imported.activeMatch = playerWinSummary();
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "summary.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole("heading", { name: "博士胜利" })).toBeVisible();
  await expect(page.locator(".summary-character")).toHaveAttribute("src", /w-defeated-summary-chair\.png/);
  await expect(page.locator(".unlock-panel")).toContainText("暗夜女王");
  await expect(page.locator(".presentation")).toHaveCount(0);
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => { nativeDialogs += 1; void dialog.dismiss(); });
  await page.getByRole("button", { name: "返回舞会大厅" }).click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  expect(nativeDialogs).toBe(0);
  await page.getByRole("button", { name: "技能管理" }).click();
  await expect(page.locator("#skills input[data-equip-skill='night-queen']")).toBeEnabled();
});

test("牌桌技能卡与扑克牌同尺寸，说明弹窗不消费技能且卡面仍可使用", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const source = findTurnsMatch("compact-skills");
  const oldCardIds = new Set(source.skills.cards.map((card) => card.instanceId));
  const hunterCard = { kind: "player-skill" as const, definitionId: "hunter-instinct", owner: "player" as const, instanceId: "e2e-hunter-instinct" };
  const hunterSequence = source.abilities.sequence + 1;
  imported.settings.reducedMotion = true;
  imported.activeMatch = {
    ...source,
    round: { ...source.round, currentActor: "player" },
    skills: { ...source.skills, cards: [hunterCard] },
    abilities: {
      ...source.abilities,
      instances: [...source.abilities.instances.filter((instance) => !oldCardIds.has(instance.instanceId)), { ...hunterCard, createdAtSequence: hunterSequence, parameters: {} }],
      sequence: hunterSequence
    }
  };
  await page.goto("/?debug=1");
  await page.addStyleTag({ content: ".dev-hud { display: none !important; }" });
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "compact-skills.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator("main.table-shell")).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/reduced-motion/);
  await expect(page.locator(".skill-sidebar .skill-tile")).toHaveCount(4);
  const debugBefore = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { skills: { cards: Array<{ instanceId: string; definitionId: string }> } } };
  const playerCardElement = await page.locator(".player-zone .card").first().elementHandle();
  expect(playerCardElement).not.toBeNull();
  const drawerToggle = page.locator(".skill-drawer-toggle");
  await expect(drawerToggle).toHaveAttribute("aria-expanded", "false");
  await expect(drawerToggle.locator(".skill-drawer-arrow")).toHaveText("<");
  await expect(drawerToggle.locator(".skill-drawer-badge")).toHaveText(String(debugBefore.relevantMatchState.skills.cards.length + 1));
  await expect(page.locator(".skill-drawer-content")).not.toBeVisible();
  await expect(page.locator(".skill-card[data-action*='switcheroo'] small")).toHaveText("×0");
  await expect(page.locator(".skill-card[data-action*='switcheroo']")).toBeDisabled();
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
  expect(activeCardsBefore).toEqual(["猎手直觉"]);
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
  await expect(page.locator("#skill-info-dialog")).toContainText("数学最优 Hit / Stand");
  expect(await activeSkill.allTextContents()).toEqual(activeCardsBefore);
  const debugAfter = JSON.parse(await page.locator("#debug-json").inputValue()) as { relevantMatchState: { skills: { cards: Array<{ instanceId: string; definitionId: string }> } } };
  expect(debugAfter.relevantMatchState.skills.cards).toEqual(debugBefore.relevantMatchState.skills.cards);
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

test("牌桌全屏按钮安全切换并同步状态", async ({ page }) => {
  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(Document.prototype, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: async function(this: Element) { fullscreenElement = this; document.dispatchEvent(new Event("fullscreenchange")); } });
    Object.defineProperty(Document.prototype, "exitFullscreen", { configurable: true, value: async () => { fullscreenElement = null; document.dispatchEvent(new Event("fullscreenchange")); } });
  });
  await page.goto("/");
  await enterCharacterSelection(page);
  await page.locator("[data-start-character='w']").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
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
  imported.activeMatch = findPlayerBlackjackMatch();
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "blackjack-dialogue.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");
  const line = await page.locator("#dialogue-text").textContent();
  expect(wDialogue.PLAYER_BLACKJACK).toContain(line);
  expect(wDialogue.PLAYER_WIN_ROUND).not.toContain(line);
});

test("战利品陈列室显示胜利美术、统计和年的全屏特写鉴赏", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const records: MatchHistoryRecord[] = [
    { id: "history-win", timestamp: "2026-08-29T20:10:00.000Z", opponentId: "nian", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 5, capacity: 6 } }, busts: { player: 1, opponent: 2 }, blackjacks: { player: 2, opponent: 1 } },
    { id: "history-loss", timestamp: "2026-08-30T20:10:00.000Z", opponentId: "texas", winner: "opponent", escaped: false, finalRoulette: { player: { bullets: 6, capacity: 6 }, opponent: { bullets: 2, capacity: 6 } }, busts: { player: 3, opponent: 0 }, blackjacks: { player: 0, opponent: 1 } }
  ];
  imported.history = records;
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await returnToLobbyMenu(page);
  await page.locator("[data-open-trophies]").click();
  await expect(page.locator("main.trophy-shell")).toBeVisible();
  await expect(page.locator(".trophy-card")).toHaveCount(2);
  const trophyBox = await page.locator(".trophy-card").first().boundingBox();
  expect(trophyBox).not.toBeNull();
  expect(trophyBox!.width / trophyBox!.height).toBeCloseTo(16 / 4.5, 1);
  await expect(page.locator("[data-history-id='history-win'] .trophy-visual img")).toHaveAttribute("src", /nian-trophy-defeated\.png/);
  await expect(page.locator("[data-history-id='history-loss'] .transparent-history-image")).toHaveAttribute("src", /^data:image\/gif/);
  await page.locator("[data-history-id='history-win']").click();
  const detail = page.locator("#history-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("博士最终左轮");
  await expect(detail).toContainText("3 / 6");
  await expect(detail.locator(".history-trophy-preview > img")).toHaveAttribute("src", /nian-trophy-gallery-headshot\.png/);
  await expect(detail.locator(".history-trophy-preview")).toContainText("战利品等级：S");
  await expect(detail.locator(".history-trophy-preview")).toContainText("年的死体展示");
  await expect(detail.locator(".history-trophy-preview")).not.toContainText("昏迷档案");
  await expect(detail.locator(".history-trophy-preview")).not.toContainText("败北记录");
  const headshotBox = await detail.locator(".history-trophy-preview > img").boundingBox();
  expect(headshotBox).not.toBeNull();
  expect(headshotBox!.width / headshotBox!.height).toBeCloseTo(5 / 7, 2);
  await detail.screenshot({ path: testInfo.outputPath("nian-trophy-history.png") });
  await expect(detail).toContainText("年最终左轮");
  await expect(detail).toContainText("5 / 6");
  await expect(detail).toContainText("博士爆牌");
  await expect(detail).toContainText("1 次");
  await expect(detail).toContainText("年爆牌");
  await expect(detail).toContainText("2 次");
  await expect(detail).toContainText("博士黑杰克");
  await expect(detail).toContainText("2 次");
  await expect(detail).toContainText("年黑杰克");
  expect(await detail.locator(".history-stats dd").allTextContents()).toEqual(["3 / 6", "5 / 6", "1 次", "2 次", "2 次", "1 次"]);
  await detail.locator("[data-open-trophy-gallery]").click();
  const gallery = page.locator("#trophy-gallery");
  await expect(gallery).toBeVisible();
  await expect(gallery.locator(".trophy-gallery-stage > img")).toHaveAttribute("src", /nian-trophy-gallery-full\.png/);
  await expect(gallery.locator(".trophy-hotspot")).toHaveCount(4);
  await expect(gallery.locator(".trophy-gallery-stage figcaption")).toHaveText("点按圆环标记查看局部特写");
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
});

test("W、德克萨斯和艾丽妮使用各自的深度鉴赏资源", async ({ page }, testInfo) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.history = [
    { id: "gallery-w", timestamp: "2026-08-27T20:10:00.000Z", opponentId: "w", winner: "player", escaped: false, finalRoulette: { player: { bullets: 2, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 0, opponent: 1 }, blackjacks: { player: 1, opponent: 0 } },
    { id: "gallery-texas", timestamp: "2026-08-28T20:10:00.000Z", opponentId: "texas", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 1 }, blackjacks: { player: 0, opponent: 0 } },
    { id: "gallery-irene", timestamp: "2026-08-29T20:10:00.000Z", opponentId: "irene", winner: "player", escaped: false, finalRoulette: { player: { bullets: 4, capacity: 6 }, opponent: { bullets: 6, capacity: 6 } }, busts: { player: 1, opponent: 2 }, blackjacks: { player: 0, opponent: 1 } }
  ];
  const cases = [
    { id: "gallery-w", slug: "w", name: "W", tier: "B", closeupCount: 4, closeupId: "skirt-costume", closeupName: "黑红裙装", closeupAsset: "w-trophy-detail-skirt.png" },
    { id: "gallery-texas", slug: "texas", name: "德克萨斯", tier: "A", closeupCount: 3, closeupId: "boots-removed", closeupName: "卸下的短靴", closeupAsset: "texas-trophy-detail-boots-removed.png" },
    { id: "gallery-irene", slug: "irene", name: "艾丽妮", tier: "A", closeupCount: 4, closeupId: "hand", closeupName: "松开的手", closeupAsset: "irene-trophy-detail-hand.png" }
  ] as const;

  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "gallery-cast.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await returnToLobbyMenu(page);
  await page.locator("[data-open-trophies]").click();

  for (const character of cases) {
    await page.locator(`[data-history-id='${character.id}']`).click();
    const detail = page.locator("#history-detail");
    await expect(detail).toBeVisible();
    await expect(detail.locator(".history-trophy-preview > img")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-headshot\\.png`));
    await expect(detail.locator(".history-trophy-preview")).toContainText(`战利品等级：${character.tier}`);
    await expect(detail.locator(".history-trophy-preview")).toContainText(`${character.name}的死体展示`);
    await detail.locator("[data-open-trophy-gallery]").click();

    const gallery = page.locator("#trophy-gallery");
    await expect(gallery).toBeVisible();
    await expect(gallery.locator(".trophy-gallery-stage > img")).toHaveAttribute("src", new RegExp(`${character.slug}-trophy-gallery-full\\.png`));
    await expect(gallery.locator(".trophy-hotspot")).toHaveCount(character.closeupCount);
    await gallery.locator(`[data-closeup-id='${character.closeupId}']`).click();
    await expect(gallery.locator("#trophy-closeup-panel")).toContainText(character.closeupName);
    await expect(gallery.locator("#trophy-closeup-panel > img")).toHaveAttribute("src", new RegExp(character.closeupAsset.replace(".", "\\.")));
    await gallery.screenshot({ path: testInfo.outputPath(`${character.slug}-trophy-gallery-390.png`) });
    await gallery.locator("[data-gallery-close]").click();
    await detail.locator("[data-history-close]").click();
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator("[data-history-id='gallery-irene']").click();
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
  await page.locator(".card-start").first().click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  const hud = page.locator(".dev-hud");
  await expect(hud).toBeVisible();
  for (const label of ["种子", "轮次 / 阶段", "牌库剩余", "玩家真实手牌", "对手真实手牌", "对手理性程度", "最终要牌概率", "上次行动", "上次领域事件"])
    await expect(hud).toContainText(label);
});

test("AI 发牌后强制等待并只在中点切换一次展示动作", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  imported.activeMatch = findTurnsMatch("e2e-ai-wait");
  const historyLength = imported.activeMatch.history.length;
  const delay = getAiTurnDelayMs(imported.activeMatch);
  await page.goto("/?debug=1");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "ai-wait.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
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
  imported.activeMatch = createMatch("e2e-full-match");
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "active-match.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
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
  await page.getByRole("button", { name: "返回舞会大厅" }).click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await page.locator("[data-open-trophies]").click();
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
  imported.activeMatch = opponentPenaltyReveal();
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "audio-reveal.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
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
  imported.activeMatch = { ...opponentPenaltyReveal(), opponentId: "irene" };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "irene-trigger.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
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
  imported.activeMatch = { ...opponentPenaltyReveal(), opponentId: "nian" };
  await page.goto("/");
  await openLobbySettings(page);
  await page.locator("#save-file").setInputFiles({ name: "nian-trigger.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
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
