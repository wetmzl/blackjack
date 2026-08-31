import { expect, test } from "@playwright/test";
import { createDefaultSave } from "../../src/persistence/boot";
import { createMatch } from "../../src/core/match/reducer";
import type { MatchHistoryRecord } from "../../src/core/match/history";
import type { MatchState } from "../../src/core/match/types";
import { getAiTurnDelayMs } from "../../src/presentation/ai-timing";

function findTurnsMatch(prefix: string) {
  for (let index = 0; index < 10_000; index += 1) {
    const match = createMatch(`${prefix}-${index}`);
    if (match.round.phase === "turns" && match.round.currentActor === "opponent") return match;
  }
  throw new Error("No deterministic turns fixture found");
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

test("移动端大厅、结果停顿、逃离与确认返回", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /命运\s*牌桌/ })).toBeVisible();
  await expect(page.locator(".character-card")).toHaveCount(2);
  const forbiddenSafetyProp = String.fromCharCode(27700, 26538);
  expect(await page.locator("body").innerText()).not.toContain(forbiddenSafetyProp);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "玩法说明" }).click();
  await expect(page.getByRole("heading", { name: "怎么玩" })).toBeVisible();
  await expect(page.locator("#rules")).toContainText("黑杰克");
  await page.locator("#rules [data-close]").click();
  await page.getByRole("button", { name: "查看档案" }).first().click();
  const profile = page.locator("#profile");
  await expect(profile).toContainText("W");
  await profile.getByRole("button", { name: "开始对局" }).click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".player-zone .card")).toHaveCount(2);
  const dialogue = page.locator("#dialogue-text");
  await expect(dialogue).toHaveAttribute("data-typing", "true");
  await expect(dialogue).toHaveAttribute("data-typing", "false", { timeout: 5_000 });
  await expect(dialogue).not.toHaveText("");
  await page.locator("button[data-action*='ESCAPE_MATCH']").click();
  await expect(page.getByRole("heading", { name: "已离席" })).toBeVisible();
  await page.getByRole("button", { name: "返回舞会大厅" }).click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
});

test("大厅仅加载轻量目录并按需载入所选角色定义", async ({ page }) => {
  const requestedPaths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requestedPaths.push(decodeURIComponent(`${url.pathname}${url.search}`));
  });
  await page.goto("/");
  await expect(page.locator(".character-card")).toHaveCount(2);
  expect(requestedPaths.some((path) => path.includes("/content/characters/data/"))).toBe(false);
  expect(requestedPaths.some((path) => /texas-(conflicted|mocking|threatened|unconscious|defeated-summary)/.test(path))).toBe(false);
  await page.locator("[data-start-character='texas']").click();
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/texas\.json|\/assets\/texas-[^/]+\.js)(?:\?|$)/.test(path))).toBe(true);
  expect(requestedPaths.some((path) => /(?:\/src\/content\/characters\/data\/w\.json|\/assets\/w-[^/]+\.js)(?:\?|$)/.test(path))).toBe(false);
});

test("旧存档中的未知角色安全回退到 W", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  imported.activeMatch = { ...findTurnsMatch("retired-character"), opponentId: "retired-character" };
  await page.goto("/");
  await page.locator("button.quiet-button[data-open='settings']").click();
  await page.locator("#save-file").setInputFiles({ name: "retired.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator("main.table-shell")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".character-strip .eyebrow")).toContainText("W // B级");
  await expect(page.locator(".character-portrait")).toHaveAttribute("src", /w-(relaxed|conflicted)\.png/);
});

test("设置原地保存并走中文导入导出", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "showSaveFilePicker", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.locator("button.quiet-button[data-open='settings']").click();
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
  await expect(page.locator(".footer")).toContainText("博士战绩 // 7");
});

test("玩家胜利结算使用独立椅子全身图且不存在中央空黑块", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  imported.activeMatch = playerWinSummary();
  await page.goto("/");
  await page.locator("button.quiet-button[data-open='settings']").click();
  await page.locator("#save-file").setInputFiles({ name: "summary.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByRole("heading", { name: "博士胜利" })).toBeVisible();
  await expect(page.locator(".summary-character")).toHaveAttribute("src", /w-defeated-summary-chair\.png/);
  await expect(page.locator(".presentation")).toHaveCount(0);
});

test("战利品陈列室显示胜利横图、失败透明图并用弹窗查看统计", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  const records: MatchHistoryRecord[] = [
    { id: "history-win", timestamp: "2026-08-29T20:10:00.000Z", opponentId: "w", winner: "player", escaped: false, finalRoulette: { player: { bullets: 3, capacity: 6 }, opponent: { bullets: 5, capacity: 6 } }, busts: { player: 1, opponent: 2 }, blackjacks: { player: 2, opponent: 1 } },
    { id: "history-loss", timestamp: "2026-08-30T20:10:00.000Z", opponentId: "texas", winner: "opponent", escaped: false, finalRoulette: { player: { bullets: 6, capacity: 6 }, opponent: { bullets: 2, capacity: 6 } }, busts: { player: 3, opponent: 0 }, blackjacks: { player: 0, opponent: 1 } }
  ];
  imported.history = records;
  await page.goto("/");
  await page.locator("button.quiet-button[data-open='settings']").click();
  await page.locator("#save-file").setInputFiles({ name: "history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await page.locator("[data-open-trophies]").click();
  await expect(page.locator("main.trophy-shell")).toBeVisible();
  await expect(page.locator(".trophy-card")).toHaveCount(2);
  const trophyBox = await page.locator(".trophy-card").first().boundingBox();
  expect(trophyBox).not.toBeNull();
  expect(trophyBox!.width / trophyBox!.height).toBeCloseTo(16 / 4.5, 1);
  await expect(page.locator("[data-history-id='history-win'] .trophy-visual img")).toHaveAttribute("src", /w-trophy-defeated\.png/);
  await expect(page.locator("[data-history-id='history-loss'] .transparent-history-image")).toHaveAttribute("src", /^data:image\/gif/);
  await page.locator("[data-history-id='history-win']").click();
  const detail = page.locator("#history-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("博士最终左轮");
  await expect(detail).toContainText("3 / 6");
  await expect(detail).toContainText("W最终左轮");
  await expect(detail).toContainText("5 / 6");
  await expect(detail).toContainText("博士爆牌");
  await expect(detail).toContainText("1 次");
  await expect(detail).toContainText("W爆牌");
  await expect(detail).toContainText("2 次");
  await expect(detail).toContainText("博士黑杰克");
  await expect(detail).toContainText("2 次");
  await expect(detail).toContainText("W黑杰克");
  expect(await detail.locator(".history-stats dd").allTextContents()).toEqual(["3 / 6", "5 / 6", "1 次", "2 次", "2 次", "1 次"]);
});

test("开发者面板显示确定性诊断字段", async ({ page }) => {
  await page.goto("/?debug=1");
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
  await page.locator("button.quiet-button[data-open='settings']").click();
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
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
      nativeSetTimeout(handler, typeof timeout === "number" && timeout >= 2_000 ? 25 : timeout, ...args)) as typeof window.setTimeout;
  });
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  imported.activeMatch = createMatch("e2e-full-match");
  await page.goto("/");
  await page.locator("button.quiet-button[data-open='settings']").click();
  await page.locator("#save-file").setInputFiles({ name: "active-match.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator("#dialogue-text")).toHaveAttribute("data-typing", "false");
  await expect(page.locator(".character-portrait")).not.toHaveClass(/character-shake/);
  let sawReveal = false;
  let sawTriggerResult = false;
  for (let step = 0; step < 260 && !(await page.locator("main.summary-shell").count()); step += 1) {
    const phase = await page.locator("main.table-shell").getAttribute("data-phase").catch(() => null);
    if (phase === "round-reveal") {
      sawReveal = true;
      await expect(page.locator(".round-result")).toBeVisible();
      await expect(page.locator(".round-result")).toContainText(/本轮|平局|获胜|爆牌|黑杰克/);
      const ack = page.locator("button[data-action*='ACK_ROUND_RESULT']:not([disabled])");
      if (await ack.count()) {
        await ack.click();
        await page.waitForFunction(() => document.querySelector("main.table-shell")?.getAttribute("data-phase") !== "round-reveal");
      } else await page.waitForTimeout(80);
    }
    else if (phase === "roulette-reaction") {
      const trigger = page.locator("button[data-action*='TRIGGER_ROULETTE']:not([disabled])");
      if (await trigger.count()) {
        await trigger.click();
        await page.waitForFunction(() => document.querySelector("main.table-shell")?.getAttribute("data-phase") !== "roulette-reaction");
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
