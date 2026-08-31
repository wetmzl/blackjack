import { expect, test } from "@playwright/test";
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
  await page.locator("button.quiet-button[data-open='settings']").click();
  await page.locator("#save-file").setInputFiles({ name: "skills.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator(".footer")).toContainText("博士战绩 // 5");
  await page.getByRole("button", { name: "技能管理" }).click();
  const skills = page.locator("#skills");
  await expect(skills.locator(".loadout-skill")).toHaveCount(6);
  await expect(skills.locator("input[data-equip-skill]:checked")).toHaveCount(4);
  await expect(skills.locator("input[data-equip-skill='night-queen']")).toBeDisabled();
  await skills.locator("[data-close]").click();
  await page.locator("button.quiet-button[data-open='settings']").click();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.locator("[data-reset]").click();
  await expect(page.locator(".footer")).toContainText("博士战绩 // 5");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("[data-reset]").click();
  await expect(page.locator(".footer")).toContainText("博士战绩 // 0");
  await expect(page.locator("[data-open-trophies]")).toContainText("0 局");
});

test("无效 IndexedDB 存档可导出原始标记，清理取消或确认均安全", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "showSaveFilePicker", { value: undefined, configurable: true }));
  await page.goto("/");
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open("house-of-chances");
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction("saves", "readwrite");
        transaction.objectStore("saves").put({ id: "current", data: { marker: "raw-invalid-record", schemaVersion: 3 } });
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.reload();
  await expect(page.locator("main.error-shell")).toContainText("存档无效");
  await expect(page.locator("[data-export-invalid]")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export-invalid]").click()]);
  expect(download.suggestedFilename()).toBe("house-of-chances-invalid-save.json");
  const exportedPath = await download.path();
  expect(exportedPath ? readFileSync(exportedPath, "utf8") : "").toContain("raw-invalid-record");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.locator("[data-reset-invalid]").click();
  await expect(page.locator("main.error-shell")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator("[data-reset-invalid]").click();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
  await page.reload();
  await expect(page.locator("main.lobby-shell")).toBeVisible();
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

test("玩家 Blackjack 只使用 Blackjack 对话池", async ({ page }) => {
  const imported = createDefaultSave("2026-08-30T00:00:00.000Z");
  imported.settings.reducedMotion = true;
  imported.activeMatch = findPlayerBlackjackMatch();
  await page.goto("/");
  await page.locator("button.quiet-button[data-open='settings']").click();
  await page.locator("#save-file").setInputFiles({ name: "blackjack-dialogue.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator("main.table-shell")).toHaveAttribute("data-phase", "round-reveal");
  const line = await page.locator("#dialogue-text").textContent();
  expect(wDialogue.PLAYER_BLACKJACK).toContain(line);
  expect(wDialogue.PLAYER_WIN_ROUND).not.toContain(line);
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
  await page.locator("button.quiet-button[data-open='settings']").click();
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
      await expect(page.locator(".round-result")).toBeVisible();
      await expect(page.locator(".round-result")).toContainText(/本轮|平局|获胜|爆牌|黑杰克/);
      const isPush = (await page.locator(".round-result").textContent())?.includes("平局") ?? false;
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
  await page.locator("button.quiet-button[data-open='settings']").click();
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
