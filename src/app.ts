import "./styles.css";
import { handValue } from "./core/blackjack/hand";
import { cardRank, cardSuit } from "./core/blackjack/card";
import type { Card } from "./core/blackjack/types";
import type { MatchHistoryRecord } from "./core/match/history";
import { buildObservation } from "./core/ai/observation";
import { abilityWorld, createMatch, getActiveBustLimit, getLegalActions, getRoundHitCounts, previewComparisonScores, previewPendingTrigger } from "./core/match/reducer";
import type { Action, GameEvent, MatchState } from "./core/match/types";
import { getPlayerSkillDefinition, PLAYER_SKILL_DEFINITIONS } from "./core/skills/definitions";
import { SKILL_TAG_METADATA, SKILL_TAGS, type SkillTag } from "./core/skills/types";
import { playerSkillsUnlockedForVictory, unlockedPlayerSkillIdsForDefeats } from "./core/skills/skills";
import { TALENT_DEFINITIONS, unlockedTalentIdsForDefeats } from "./core/talents/definitions";
import { getAbilityDefinition } from "./core/abilities/registry";
import { isAbilityBlockedByStatus } from "./core/abilities/engine";
import { resolveAbilityInfoValue, type ResolvedInfoBarValue } from "./core/abilities/info-bar";
import { resolveDialogueLine, resolveDialogueState } from "./dialogue/state";
import { CHARACTER_CATALOG, DEFAULT_CHARACTER_ID, defeatedCharacterIdsByFirstDefeat, getCharacterMetadata, isCharacterUnlocked, loadCharacter, newlyUnlockedForDefeat, type CharacterDefinition, type CharacterTrophyGallery, type TrophyCloseupPoint, type CharacterUnlockCondition } from "./content/characters";
import { bootLoad, clearMatchHistory, resetSave, restoreActiveMatch } from "./persistence/boot";
import { createAutosaveController, type AutosaveController } from "./persistence/autosave";
import { downloadRawSave, downloadSave, importSave, openSaveWithFileSystemAccess } from "./persistence/json";
import { canMigrateLongTermSave, migrateLongTermSave } from "./persistence/migrations";
import { IndexedDbSaveRepository } from "./persistence/dexie-repository";
import { requestPersistentStorage } from "./persistence/storage";
import { SaveValidationError, type CharacterDefeatRecord, type LongTermSave } from "./persistence/schema";
import { getAiTurnDelayMs } from "./presentation/ai-timing";
import { abilityExpiredNotices, abilityTriggerNotice, pendingTriggerAbilityNotices, type AbilityNotice } from "./presentation/ability-notices";
import { presentBodyMovedHaptic, presentInteractionHaptic, presentMatchHaptics, presentSkillSelectionHaptic } from "./presentation/haptics";
import { roundResultText, triggerResultText } from "./presentation/round-notice";
import { cardDisplayMarkup, describeCard, describeCards, diamondCardMarker, suitPresentation, type CardMarker } from "./presentation/cards";
import { gameAudio } from "./audio/game-audio";
import { presentMatchAudio, presentOpeningMatchAudio, syncMatchAudioState } from "./audio/match-audio";
import { downloadResourcePack, ResourcePackDownloadError, type ResourcePackProgress } from "./resources/resource-pack";
import { characterResourcePlan, lobbyResourceUrls, resourceLoader } from "./resources/resource-loader";
import { SKILL_ARCHETYPE_ART, SKILL_ARCHETYPE_ART_URLS } from "./resources/skill-archetype-art";
import { completeTutorial, firstTutorialForCue, type TutorialCue, type TutorialDefinition, type TutorialResource } from "./tutorials/tutorials";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("App root is missing");
const root: HTMLDivElement = appRoot;
const repository = new IndexedDbSaveRepository();
let save: LongTermSave;
let autosave: AutosaveController | null = null;
let currentCharacter!: CharacterDefinition;
let selectedCharacterId = DEFAULT_CHARACTER_ID;
let presentationTimer: number | undefined;
let presentationHideTimer: number | undefined;
let dialogueTimer: number | undefined;
let dialogueShakeTimer: number | undefined;
let aiActionTimer: number | undefined;
let aiPoseTimer: number | undefined;
let aiPoseShakeTimer: number | undefined;
let aiScheduleKey: string | null = null;
let characterLoadInFlight = false;
let characterLoadToken = 0;
let lastAction: Action | null = null;
let lastDomainEvent: GameEvent["type"] | null = null;
let lastDialogueKey: string | null = null;
let skillDrawerOpen = false;
let activeTutorial: { readonly definition: TutorialDefinition; readonly pageIndex: number; readonly autoSkipCancelled: boolean } | null = null;
let tutorialAutoSkipTimer: number | undefined;
let tutorialDismissAnimation: Animation | null = null;
const TUTORIAL_AUTO_SKIP_MS = 10_000;
const TUTORIAL_DISMISS_MS = 420;
const abilityNoticeTimers = new Map<HTMLElement, { readonly expire: number; readonly remove: number }>();
const ABILITY_NOTICE_TTL_MS = 2500;
const ABILITY_NOTICE_LEAVE_MS = 280;
const MAX_ABILITY_NOTICES = 5;
let fullscreenChangeAttached = false;
let abilityNoticePositionAttached = false;
let interactionHapticsAttached = false;
type LobbyLayer = "menu" | "characters";
let lobbyLayer: LobbyLayer = "menu";
let guestSelectionIds: string[] = [];
let defeatedGuestObserver: IntersectionObserver | null = null;
let pendingImportedSave: unknown;
const DEFEATED_GUEST_BATCH_SIZE = 3;
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const TROPHY_GALLERY_COFFIN_IMAGE = "/assets/characters/trophy-gallery-coffin.png";
const RESET_CONFIRM_MESSAGE = "删除长期存档将清除战绩、历史、角色与技能解锁及设置，但不会删除未完成牌局。确定继续吗？";
const RESET_RUNTIME_CONFIRM_MESSAGE = "未完成牌局与当前版本不兼容。确认后将只舍弃这局牌，长期战绩与解锁不会受到影响。";
const CLEAR_HISTORY_CONFIRM_MESSAGE = "清理全部对局记录？战利品、角色与技能解锁不会受到影响。";

function secureSeed(): string {
  const bytes = new Uint32Array(4);
  if (!globalThis.crypto?.getRandomValues) throw new Error("当前环境没有可用的安全随机数，无法安全开始对局。");
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(8, "0")).join("");
}
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character); }
function tutorialResourceMarkup(resource: TutorialResource): string {
  if (resource.type !== "image") return "";
  return `<figure class="tutorial-resource"><img src="${escapeHtml(resource.src)}" alt="${escapeHtml(resource.alt)}">${resource.caption ? `<figcaption>${escapeHtml(resource.caption)}</figcaption>` : ""}</figure>`;
}
function clearTutorialAutoSkip(): void {
  window.clearTimeout(tutorialAutoSkipTimer);
  tutorialAutoSkipTimer = undefined;
  tutorialDismissAnimation?.cancel();
  tutorialDismissAnimation = null;
}
function clearTutorialSurface(): void {
  clearTutorialAutoSkip();
  document.querySelector("#tutorial-popover")?.remove();
}
function discardActiveTutorial(): void {
  activeTutorial = null;
  clearTutorialSurface();
}
function cancelTutorialAutoSkip(surface: HTMLElement): void {
  if (!activeTutorial || activeTutorial.autoSkipCancelled) return;
  activeTutorial = { ...activeTutorial, autoSkipCancelled: true };
  clearTutorialAutoSkip();
  surface.classList.remove("is-auto-dismissing");
  surface.classList.add("is-auto-skip-cancelled");
}
function startTutorialAutoSkip(surface: HTMLElement): void {
  if (!activeTutorial || activeTutorial.autoSkipCancelled) return;
  tutorialAutoSkipTimer = window.setTimeout(() => {
    tutorialAutoSkipTimer = undefined;
    if (!activeTutorial || activeTutorial.autoSkipCancelled || !surface.isConnected) return;
    surface.classList.add("is-auto-dismissing");
    const animation = surface.animate([
      { opacity: 1, transform: "translateY(0) scale(1)" },
      { opacity: 0, transform: "translateY(-6px) scale(.985)" }
    ], { duration: save.settings.reducedMotion ? 1 : TUTORIAL_DISMISS_MS, easing: "ease", fill: "forwards" });
    tutorialDismissAnimation = animation;
    void animation.finished.then(() => {
      if (tutorialDismissAnimation !== animation || !surface.isConnected || activeTutorial?.autoSkipCancelled) return;
      tutorialDismissAnimation = null;
      finishActiveTutorial();
    }).catch(() => undefined);
  }, TUTORIAL_AUTO_SKIP_MS);
}
function finishActiveTutorial(): void {
  if (!activeTutorial) return;
  const progress = completeTutorial(save.tutorialProgress, activeTutorial.definition.id);
  activeTutorial = null;
  clearTutorialSurface();
  if (progress === save.tutorialProgress) return;
  save = { ...save, tutorialProgress: { completedIds: [...progress.completedIds] }, updatedAt: new Date().toISOString() };
  if (autosave) {
    autosave.updateSave(save);
    void autosave.flush().catch(() => enqueueNotification("教程进度保存失败，请稍后重试。"));
  } else void repository.saveLongTerm(save).catch(() => enqueueNotification("教程进度保存失败，请稍后重试。"));
}
function renderTutorialSurface(): void {
  clearTutorialSurface();
  if (!activeTutorial) return;
  const { definition, pageIndex, autoSkipCancelled } = activeTutorial;
  const page = definition.pages[pageIndex];
  if (!page) return;
  const surface = document.createElement("aside");
  surface.id = "tutorial-popover";
  surface.className = `tutorial-popover${autoSkipCancelled ? " is-auto-skip-cancelled" : ""}`;
  surface.dataset.tutorialId = definition.id;
  surface.setAttribute("role", "dialog");
  surface.setAttribute("aria-modal", "false");
  surface.setAttribute("aria-labelledby", "tutorial-title");
  const lastPage = pageIndex === definition.pages.length - 1;
  const resources = page.resources?.map(tutorialResourceMarkup).join("") ?? "";
  surface.innerHTML = `<div class="tutorial-heading"><span>机制介绍：page ${pageIndex + 1}/${definition.pages.length}</span><h2 id="tutorial-title">${escapeHtml(definition.title)}</h2></div><p>${escapeHtml(page.body)}</p>${resources ? `<div class="tutorial-resources">${resources}</div>` : ""}<div class="tutorial-actions"><button type="button" class="tutorial-skip" data-tutorial-skip>跳过</button><button type="button" class="tutorial-next" data-tutorial-next>${lastPage ? "好的" : "下一步"}</button></div><span class="tutorial-auto-progress" aria-hidden="true"></span>`;
  document.body.append(surface);
  surface.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-tutorial-skip]")) cancelTutorialAutoSkip(surface);
  }, { capture: true });
  surface.querySelector<HTMLButtonElement>("[data-tutorial-skip]")?.addEventListener("click", finishActiveTutorial);
  surface.querySelector<HTMLButtonElement>("[data-tutorial-next]")?.addEventListener("click", () => {
    if (lastPage) { finishActiveTutorial(); return; }
    activeTutorial = { definition, pageIndex: pageIndex + 1, autoSkipCancelled: activeTutorial?.autoSkipCancelled ?? autoSkipCancelled };
    renderTutorialSurface();
  });
  startTutorialAutoSkip(surface);
}
function offerTutorial(cue: TutorialCue): void {
  if (activeTutorial) return;
  const definition = firstTutorialForCue(cue, save.tutorialProgress, save.skipTutorial);
  if (!definition) return;
  activeTutorial = { definition, pageIndex: 0, autoSkipCancelled: false };
  renderTutorialSurface();
}
function uiError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (/save|JSON|schema|match state|cursor|future/i.test(message)) return "存档无效：请检查文件格式与版本。";
  return fallback;
}
function cardLabel(card: Card): string { return `${cardRank(card)}${suitPresentation(cardSuit(card)).symbol}`; }
function infoBarValueText(value: ResolvedInfoBarValue, format: "number" | "percent" = "number"): string {
  if (value === null) return "暂无";
  if (typeof value === "number") return format === "percent" ? `${Math.round(value * 100)}%` : String(value);
  if (typeof value === "string") return suitPresentation(value).label;
  return `${suitPresentation(cardSuit(value)).symbol} ${cardRank(value)}`;
}
function infoBarValueMarkup(value: ResolvedInfoBarValue, format: "number" | "percent" = "number"): string {
  if (value === null) return `<span class="ai-info-empty">—</span>`;
  if (typeof value === "number") return `<strong class="ai-info-number">${escapeHtml(infoBarValueText(value, format))}</strong>`;
  const suit = suitPresentation(typeof value === "string" ? value : cardSuit(value));
  if (typeof value === "string") return `<span class="ai-info-suit ${suit.red ? "red" : "black"}" aria-label="${suit.label}"><span aria-hidden="true">${suit.symbol}</span><small>${suit.label}</small></span>`;
  return cardDisplayMarkup(describeCard(value, { surface: "front", showRank: true, showSuit: true, variant: "compact" }));
}
function resolveCharacterInfoBarValue(character: CharacterDefinition, state: MatchState): ResolvedInfoBarValue {
  if (!character.infoBar) return null;
  const sourceActive = state.abilities.instances.some((instance) => instance.owner === "opponent" && instance.definitionId === character.infoBar?.sourceAbilityId && instance.ttl?.remaining !== 0);
  return resolveAbilityInfoValue(character.infoBar.value, abilityWorld(state), "opponent", {
    roundHitCounts: getRoundHitCounts(state),
    sourceActive
  });
}
function characterInfoBarMarkup(character: CharacterDefinition, value: ResolvedInfoBarValue): string {
  if (!character.infoBar) return "";
  const format = character.infoBar.format ?? "number";
  const accessibleValue = infoBarValueText(value, format);
  return `<section class="ai-info-bar" aria-label="${escapeHtml(character.infoBar.label)}：${escapeHtml(accessibleValue)}"><span class="ai-info-label">${escapeHtml(character.infoBar.label)}</span><output class="ai-info-value" aria-label="当前值：${escapeHtml(accessibleValue)}">${infoBarValueMarkup(value, format)}</output><button class="ai-info-button" type="button" data-ai-info aria-label="查看${escapeHtml(character.infoBar.label)}说明">i</button></section>`;
}
function matchingSuitCardMarkers(character: CharacterDefinition, state: MatchState, value: ResolvedInfoBarValue): Readonly<Record<string, readonly CardMarker[]>> | undefined {
  const markerDefinition = character.infoBar?.matchingSuitMarker;
  if (!markerDefinition || typeof value !== "string") return undefined;
  const marker = diamondCardMarker(markerDefinition.type, markerDefinition.label);
  const matchingCards = [...state.player.hand.cards, ...state.opponent.hand.cards].filter((card) => cardSuit(card) === value);
  return Object.fromEntries(matchingCards.map((card) => [card.id, [marker]]));
}
function revealedOpponentCardIds(state: MatchState): ReadonlySet<string> {
  let start = -1;
  state.history.forEach((event, index) => { if (event.type === "ROUND_STARTED") start = index; });
  return new Set(state.history.slice(start + 1)
    .filter((entry) => entry.type === "CARD_SUIT_REVEALED" && entry.viewer === "player" && entry.target === "opponent")
    .map((entry) => entry.type === "CARD_SUIT_REVEALED" ? entry.cardId : ""));
}
function revealedDrawPileSuitCardIds(state: MatchState): ReadonlySet<string> {
  let start = -1;
  state.history.forEach((event, index) => { if (event.type === "ROUND_STARTED") start = index; });
  return new Set(state.history.slice(start + 1).flatMap((entry) =>
    (entry.type === "DRAW_PILE_CARD_SUIT_REVEALED" || entry.type === "DRAW_PILE_CARD_REVEALED") && entry.viewer === "player" ? [entry.cardId] : []));
}
function revealedDrawPileRankCardIds(state: MatchState): ReadonlySet<string> {
  let start = -1;
  state.history.forEach((event, index) => { if (event.type === "ROUND_STARTED") start = index; });
  return new Set(state.history.slice(start + 1).flatMap((entry) =>
    entry.type === "DRAW_PILE_CARD_REVEALED" && entry.viewer === "player" ? [entry.cardId] : []));
}
function gunStatusMarkup(label: string, bullets: number, capacity: number): string {
  const chambers = Array.from({ length: capacity }, (_, index) => `<i class="${index < bullets ? "loaded" : ""}" aria-hidden="true"></i>`).join("");
  return `<div class="gun-status-row" aria-label="${escapeHtml(label)}：${capacity} 个弹巢，已装填 ${bullets} 发"><span class="gun-icon"><img src="/assets/characters/staff-revolver-7mm.png" alt="" aria-hidden="true"></span><span class="gun-name">${escapeHtml(label)}</span><span class="gun-chambers">${chambers}</span></div>`;
}
function abilityNoticeContainer(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>("#ability-notices");
  if (existing) return existing;
  const container = document.createElement("div");
  container.id = "ability-notices";
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "false");
  document.body.append(container);
  return container;
}
function syncAbilityNoticePosition(): void {
  const container = document.querySelector<HTMLDivElement>("#ability-notices");
  if (!container) return;
  const anchor = root.querySelector<HTMLElement>(".ai-info-bar") ?? root.querySelector<HTMLElement>(".shoe-status") ?? root.querySelector<HTMLElement>(".roulette-status");
  if (!anchor) return;
  const anchorRect = anchor.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const containerWidth = container.getBoundingClientRect().width;
  const sideInset = 10;
  const rawRight = viewportWidth - anchorRect.right;
  const maxRight = Math.max(sideInset, viewportWidth - sideInset - containerWidth);
  const right = Math.min(Math.max(rawRight, sideInset), maxRight);
  container.style.top = `${Math.max(sideInset, anchorRect.bottom + 8)}px`;
  container.style.right = `${right}px`;
  container.style.left = "auto";
}
function attachAbilityNoticePositionListener(): void {
  if (abilityNoticePositionAttached) return;
  window.addEventListener("resize", syncAbilityNoticePosition);
  abilityNoticePositionAttached = true;
}
function detachAbilityNoticePositionListener(): void {
  if (!abilityNoticePositionAttached) return;
  window.removeEventListener("resize", syncAbilityNoticePosition);
  abilityNoticePositionAttached = false;
}
function removeAbilityNotice(node: HTMLElement): void {
  const timers = abilityNoticeTimers.get(node);
  if (timers) { window.clearTimeout(timers.expire); window.clearTimeout(timers.remove); abilityNoticeTimers.delete(node); }
  node.remove();
}
function expireAbilityNotice(node: HTMLElement): void {
  if (!node.isConnected) { removeAbilityNotice(node); return; }
  node.classList.add("leaving");
  const remove = window.setTimeout(() => removeAbilityNotice(node), ABILITY_NOTICE_LEAVE_MS);
  const timers = abilityNoticeTimers.get(node);
  if (timers) abilityNoticeTimers.set(node, { ...timers, remove });
}
function enqueueAbilityNotices(notices: readonly AbilityNotice[]): void {
  if (notices.length === 0) return;
  const container = abilityNoticeContainer();
  syncAbilityNoticePosition();
  for (const notice of notices) {
    const node = document.createElement("div");
    node.className = `ability-notice ability-notice-${notice.tone}`;
    node.dataset.owner = notice.owner;
    node.dataset.tone = notice.tone;
    node.setAttribute("role", "status");
    node.textContent = notice.text;
    node.addEventListener("animationend", (event) => {
      if (event.animationName === "ability-notice-leave") removeAbilityNotice(node);
    });
    container.prepend(node);
    const expire = window.setTimeout(() => expireAbilityNotice(node), ABILITY_NOTICE_TTL_MS);
    abilityNoticeTimers.set(node, { expire, remove: 0 });
    while (container.childElementCount > MAX_ABILITY_NOTICES) {
      const oldest = container.lastElementChild;
      if (oldest instanceof HTMLElement) removeAbilityNotice(oldest);
      else break;
    }
  }
}
function enqueueNotification(text: string): void {
  enqueueAbilityNotices([{ owner: "system", tone: "notification", text }]);
}
function clearAbilityNoticeQueue(): void {
  for (const node of [...abilityNoticeTimers.keys()]) removeAbilityNotice(node);
  document.querySelectorAll("#ability-notices .ability-notice").forEach((node) => node.remove());
}
function syncFullscreenButton(): void {
  syncAbilityNoticePosition();
  const button = root.querySelector<HTMLButtonElement>("[data-fullscreen]");
  if (!button) return;
  const active = Boolean(document.fullscreenElement);
  button.textContent = active ? "⛶" : "⛶";
  button.setAttribute("aria-label", active ? "退出全屏" : "进入全屏");
  button.title = active ? "退出全屏" : "进入全屏";
}
function detachFullscreenListener(): void {
  if (!fullscreenChangeAttached) return;
  document.removeEventListener("fullscreenchange", syncFullscreenButton); fullscreenChangeAttached = false;
  detachAbilityNoticePositionListener();
}
function attachFullscreenListener(): void {
  if (fullscreenChangeAttached) return;
  document.addEventListener("fullscreenchange", syncFullscreenButton); fullscreenChangeAttached = true;
  attachAbilityNoticePositionListener();
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => enqueueNotification("无法退出全屏。")); return; }
  if (!document.documentElement.requestFullscreen) { enqueueNotification("当前环境不支持全屏。"); return; }
  void document.documentElement.requestFullscreen().catch(() => enqueueNotification("全屏请求未获允许。"));
}
const PHASE_LABELS: Readonly<Record<MatchState["round"]["phase"], string>> = {
  dealing: "发牌中", "initial-blackjack-check": "检查黑杰克", turns: "行动阶段", settlement: "结算中",
  "round-reveal": "翻牌结果", "roulette-reaction": "轮盘反应", "roulette-trigger": "准备扣扳机",
  "roulette-result": "扳机结果", "round-end": "等待下一轮"
};
function phaseLabel(phase: MatchState["round"]["phase"]): string { return PHASE_LABELS[phase]; }
const ACTION_LABELS: Readonly<Record<Action["type"], string>> = {
  PLAYER_HIT: "策展人 Hit 要牌", PLAYER_STAND: "策展人 Stand 停牌", AI_TURN: "对手行动一次",
  AI_HIT: "对手 Hit 要牌", OPPONENT_HIT: "对手 Hit 要牌", AI_STAND: "对手 Stand 停牌", OPPONENT_STAND: "对手 Stand 停牌",
  PLAY_ABILITY: "使用能力", OPEN_SKILL_DRAW: "抽取技能", SELECT_SKILL_DRAW: "选择技能", TRIGGER_ROULETTE: "扣下扳机", ACK_ROUND_RESULT: "确认本轮结果",
  ACK_TRIGGER_RESULT: "确认扳机结果", CONTINUE_ROUND: "进入下一轮", ESCAPE_MATCH: "逃离对局", ACK_MATCH_RESULT: "确认最终结果"
};
const EVENT_LABELS: Readonly<Record<GameEvent["type"], string>> = {
  ABILITY_PLAYED: "使用能力", ABILITY_TRIGGERED: "能力触发", ABILITY_EXPIRED: "能力耗尽", ABILITY_RESOLUTION_FAILED: "能力解析失败",
  STATUS_ADDED: "获得状态", STATUS_REMOVED: "状态移除", PENDING_EVENT_MODIFIED: "修改待结算事件", PENDING_EVENT_CANCELLED: "取消待结算事件",
  ROUND_STARTED: "本轮开始", CARD_DEALT: "发牌", INITIAL_BLACKJACK_CHECK: "检查黑杰克",
  TURN_SKIPPED: "跳过回合",
  PLAYER_HIT: "策展人 Hit 要牌", OPPONENT_HIT: "对手 Hit 要牌", PLAYER_STOOD: "策展人 Stand 停牌", OPPONENT_STOOD: "对手 Stand 停牌",
  BLACKJACK: "黑杰克", BUST: "爆牌", ROUND_RESOLVED: "本轮结算", ROUND_RESULT_ACKNOWLEDGED: "已确认本轮结果",
  BULLET_ADDED: "装填子弹", TRIGGER_PULLED: "已扣下扳机", TRIGGER_SURVIVED: "空枪幸存", TRIGGER_RESULT_ACKNOWLEDGED: "已确认扳机结果",
  PARTICIPANT_KILLED: "参与者倒下", SKILL_GAINED: "获得技能", MATCH_FINISHED: "对局结束",
  SKILL_DRAWS_ADDED: "获得抽卡次数", SKILL_DRAW_OPENED: "生成技能候选", SKILL_DRAW_RESOLVED: "完成技能抽取",
  MATCH_ESCAPED: "策展人离席", MATCH_RESULT_ACKNOWLEDGED: "已确认最终结果", AI_DECISION: "对手完成决策",
  CARD_SUIT_REVEALED: "识破暗牌花色", DRAW_PILE_CARD_SUIT_REVEALED: "识破牌堆顶花色", DRAW_PILE_CARD_REVEALED: "识破牌堆顶牌面", ABILITY_RESULT: "能力结果"
};
function decisionLabel(action: "hit" | "stand" | undefined): string { return action === "hit" ? "Hit 要牌" : action === "stand" ? "Stand 停牌" : "—"; }
function displayedHandValueMarkup(baseScore: number | "?", modifier: number): string {
  if (modifier === 0) return `<output class="hand-score"><span class="hand-score-base">${baseScore}</span></output>`;
  const sign = modifier > 0 ? "+" : "−";
  const accessibleOperation = modifier > 0 ? "加" : "减";
  const finalScore = typeof baseScore === "number" ? baseScore + modifier : "未知";
  return `<output class="hand-score" aria-label="${baseScore}${accessibleOperation}${Math.abs(modifier)}，当前点数${finalScore}"><span class="hand-score-base">${baseScore}</span><small class="hand-score-modifier" aria-hidden="true">${sign}${Math.abs(modifier)}</small></output>`;
}
function legal(state: MatchState, action: Action): boolean { return getLegalActions(state).some((candidate) => JSON.stringify(candidate) === JSON.stringify(action)); }
function actionButton(label: string, action: Action, state: MatchState, className = "secondary-button"): string { const enabled = legal(state, action); return `<button class="${className}" data-action='${JSON.stringify(action)}' ${enabled ? "" : "disabled"}>${label}</button>`; }
function historyResultLabel(record: MatchHistoryRecord): string { return record.escaped ? "策展人离席" : record.winner === "player" ? "策展人胜利" : "策展人落败"; }
function historyDate(timestamp: string): string { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)); }

let skillManagementTab: "skills" | "talents" = "skills";
let skillSaveRequest = 0;
let skillManagementSelectedTags: SkillTag[] | null = null;
const TALENT_PLACEHOLDER_MILESTONES = Object.freeze([3, 5, 7, 10]);

function skillCatalogCardMarkup(skill: (typeof PLAYER_SKILL_DEFINITIONS)[number], unlocked: ReadonlySet<string>): string {
  const available = unlocked.has(skill.id);
  const source = skill.unlock ? `解锁来源：${skill.unlock.label}` : "初始技能";
  const tags = skill.skillTags.map((tag) => `<span class="skill-tag-label">${SKILL_TAG_METADATA[tag].label}</span>`).join("");
  return `<div class="loadout-skill ${available ? "" : "locked"}"><div><details class="profile-ability"><summary><strong>${escapeHtml(skill.name)}</strong><span>：${escapeHtml(skill.description)}</span></summary><p>${escapeHtml(skill.profileLore)}</p></details><div class="skill-list-meta"><span>${skill.category === "passive" ? "被动" : "主动"}</span>${tags}</div><small>${escapeHtml(source)} · ${available ? "已解锁，可在牌局中掉落" : "尚未解锁"}</small></div></div>`;
}

function skillCatalogMarkup(): string {
  const unlocked = new Set(unlockedPlayerSkillIdsForDefeats(save.defeats));
  return SKILL_TAGS.map((tag) => {
    const metadata = SKILL_TAG_METADATA[tag];
    const skills = PLAYER_SKILL_DEFINITIONS.filter((skill) => skill.skillTags[0] === tag);
    return `<details class="skill-catalog-group" data-primary-skill-tag="${tag}"><summary><span class="skill-catalog-group-title"><span aria-hidden="true">${metadata.symbol}</span>${metadata.label}</span><small>${skills.length} 项技能</small></summary><div class="skill-catalog-group-list">${skills.map((skill) => skillCatalogCardMarkup(skill, unlocked)).join("")}</div></details>`;
  }).join("");
}

function talentRoadMarkup(): string {
  const defeatCount = defeatedCharacterIdsByFirstDefeat(save.defeats).length;
  const unlockedTalentIds = new Set(unlockedTalentIdsForDefeats(save.defeats));
  const talentNodes = TALENT_DEFINITIONS
    .filter((talent) => !talent.hidden)
    .map((talent) => ({
      id: talent.id,
      count: talent.unlock.count,
      unlockLabel: talent.unlock.label,
      name: talent.name,
      description: talent.description,
      placeholder: false,
      unlocked: unlockedTalentIds.has(talent.id)
    }));
  const occupiedMilestones = new Set(talentNodes.map((node) => node.count));
  const nodes = [
    ...talentNodes,
    ...TALENT_PLACEHOLDER_MILESTONES
      .filter((count) => !occupiedMilestones.has(count))
      .map((count) => ({
        id: `preview-${count}`,
        count,
        unlockLabel: `击败 ${count} 名与会者`,
        name: "敬请期待",
        description: "新的策展人天赋仍在筹备中。",
        placeholder: true,
        unlocked: false
      }))
  ].sort((left, right) => left.count - right.count);
  const lastReachedIndex = nodes.reduce((result, node, index) => defeatCount >= node.count ? index : result, -1);
  const progress = nodes.length > 1 && lastReachedIndex >= 0 ? lastReachedIndex / (nodes.length - 1) : 0;
  const checkpoints = nodes.map((node) => {
    const reached = defeatCount >= node.count;
    const stateClass = node.placeholder ? (reached ? "is-reached" : "is-locked") : (node.unlocked ? "is-unlocked" : "is-locked");
    const progressCount = Math.min(defeatCount, node.count);
    const status = node.placeholder
      ? (reached ? "里程碑已到达" : `进度 ${progressCount}/${node.count}`)
      : (node.unlocked ? "已解锁" : `未解锁 · 进度 ${progressCount}/${node.count}`);
    return `<article class="talent-checkpoint ${node.placeholder ? "talent-placeholder" : ""} ${stateClass}" data-threshold="${node.count}" ${node.placeholder ? "" : `data-talent-id="${escapeHtml(node.id)}"`}><span class="talent-checkpoint-dot" aria-hidden="true"><b>${node.count}</b><small>胜</small></span><div class="talent-stage-card"><p class="eyebrow">${node.placeholder ? "未公开天赋" : `天赋奖励 · ${escapeHtml(node.unlockLabel)}`}</p><h3>${escapeHtml(node.name)}</h3><p>${escapeHtml(node.description)}</p><small>${status}</small></div></article>`;
  }).join("");
  return `<div class="talent-road-heading"><div><p class="eyebrow">策展人成长轨迹</p><h3>天赋路线</h3></div><output>已击败 ${defeatCount} 名与会者</output></div><div class="talent-progress-line" style="--talent-road-progress:${progress}">${checkpoints}</div>`;
}

function renderSkillList(statusMessage = ""): string {
  const selected = new Set(skillManagementSelectedTags ?? save.profile.selectedSkillTags);
  const selectedCount = selected.size;
  const tagCards = SKILL_TAGS.map((tag) => {
    const metadata = SKILL_TAG_METADATA[tag];
    const pressed = selected.has(tag);
    const art = SKILL_ARCHETYPE_ART[tag];
    return `<div class="skill-tag-frame"><button type="button" class="skill-tag-card ${pressed ? "is-selected" : ""}" data-skill-tag="${tag}" aria-label="${pressed ? `取消选择${metadata.label}流派` : `选择${metadata.label}流派`}" aria-pressed="${pressed ? "true" : "false"}"><img src="${pressed ? art.selected : art.default}" alt="" aria-hidden="true" decoding="async"><span class="skill-tag-card-shade" aria-hidden="true"></span><span class="skill-tag-card-copy"><span class="skill-tag-symbol" aria-hidden="true">${metadata.symbol}</span><strong>${metadata.label}</strong><small>${pressed ? "已选择" : "选择流派"}</small></span><span class="skill-tag-check" aria-hidden="true">✓</span></button><button type="button" class="skill-tag-info-button" data-skill-tag-info="${tag}" aria-controls="skill-tag-info-dialog" aria-haspopup="dialog" aria-label="查看${metadata.label}流派说明"><span aria-hidden="true">i</span></button></div>`;
  }).join("");
  return `<div class="skill-management-tabs" role="tablist" aria-label="技能与天赋"><button type="button" role="tab" id="skill-tab" aria-controls="skill-panel" aria-selected="${skillManagementTab === "skills"}" class="skill-management-tab ${skillManagementTab === "skills" ? "is-active" : ""}" data-skill-tab="skills">技能</button><button type="button" role="tab" id="talent-tab" aria-controls="talent-panel" aria-selected="${skillManagementTab === "talents"}" class="skill-management-tab ${skillManagementTab === "talents" ? "is-active" : ""}" data-skill-tab="talents">天赋</button></div>${skillManagementTab === "skills" ? `<section id="skill-panel" role="tabpanel" aria-labelledby="skill-tab" class="skill-management-panel"><div class="skill-tag-heading"><h3>对应流派技能出现概率 ×4</h3><output aria-live="polite">已选 ${selectedCount}/2</output></div><div class="skill-tag-grid">${tagCards}</div><p id="skill-management-status" class="status-line" role="status" aria-live="polite">${escapeHtml(statusMessage)}</p><div class="skill-panel-footer"><p>局内候选来自全部已解锁技能；天赋不进入技能牌库。</p><button type="button" class="secondary-button skill-catalog-button" data-open-skill-catalog aria-controls="skill-catalog">技能大全</button></div></section>` : `<section id="talent-panel" role="tabpanel" aria-labelledby="talent-tab" class="skill-management-panel talent-panel">${talentRoadMarkup()}</section>`}`;
}

function showSkillTagInfo(tag: SkillTag): void {
  if (!SKILL_TAGS.includes(tag)) return;
  const dialog = root.querySelector<HTMLDialogElement>("#skill-tag-info-dialog");
  const title = root.querySelector<HTMLElement>("#skill-tag-info-title");
  const copy = root.querySelector<HTMLElement>("#skill-tag-info-copy");
  if (!dialog || !title || !copy) return;
  title.textContent = `${SKILL_TAG_METADATA[tag].label}流派`;
  copy.textContent = SKILL_TAG_METADATA[tag].summary;
  if (!dialog.open) dialog.showModal();
}

function renderSkillManagement(statusMessage = ""): void {
  const dialog = root.querySelector<HTMLDialogElement>("#skills");
  const content = root.querySelector<HTMLDivElement>("#skill-content");
  if (!dialog || !content) return;
  content.innerHTML = renderSkillList(statusMessage);
  content.onclick = (event) => {
    const target = event.target as Element;
    const tab = target.closest<HTMLButtonElement>("[data-skill-tab]");
    if (tab) {
      skillManagementTab = tab.dataset.skillTab === "talents" ? "talents" : "skills";
      renderSkillManagement();
      return;
    }
    const infoButton = target.closest<HTMLButtonElement>("[data-skill-tag-info]");
    if (infoButton) {
      showSkillTagInfo(infoButton.dataset.skillTagInfo as SkillTag);
      return;
    }
    const tagButton = target.closest<HTMLButtonElement>("[data-skill-tag]");
    if (tagButton) void toggleSkillTag(tagButton.dataset.skillTag as SkillTag);
    const catalogButton = target.closest<HTMLButtonElement>("[data-open-skill-catalog]");
    if (catalogButton) openSkillCatalog();
  };
}

function openSkillCatalog(): void {
  const dialog = root.querySelector<HTMLDialogElement>("#skill-catalog");
  const content = root.querySelector<HTMLDivElement>("#skill-catalog-content");
  if (!dialog || !content) return;
  content.innerHTML = skillCatalogMarkup();
  if (!dialog.open) dialog.showModal();
}

async function toggleSkillTag(tag: SkillTag): Promise<void> {
  if (!SKILL_TAGS.includes(tag)) return;
  const selected = [...save.profile.selectedSkillTags];
  const index = selected.indexOf(tag);
  if (index >= 0) selected.splice(index, 1);
  else if (selected.length >= 2) { renderSkillManagement("最多选择两个流派"); return; }
  else selected.push(tag);
  const nextSave = { ...save, profile: { ...save.profile, selectedSkillTags: selected }, updatedAt: new Date().toISOString() };
  save = nextSave;
  skillManagementSelectedTags = selected;
  gameAudio.play(index >= 0 ? "archetypeDeselect" : "archetypeSelect");
  presentSkillSelectionHaptic(!save.settings.reducedMotion);
  const request = ++skillSaveRequest;
  renderSkillManagement("正在保存…");
  try {
    await repository.saveLongTerm(nextSave);
    if (request === skillSaveRequest) renderSkillManagement("选择已保存");
  } catch {
    if (request === skillSaveRequest) renderSkillManagement("保存失败，请重试");
  }
}

function openSkillManagement(): void {
  skillManagementTab = "skills";
  skillManagementSelectedTags = [...save.profile.selectedSkillTags];
  renderSkillManagement();
  const dialog = root.querySelector<HTMLDialogElement>("#skills");
  if (dialog && !dialog.open) dialog.showModal();
}

function isAiTurn(state: MatchState): boolean {
  return state.status === "active"
    && state.scene === "match"
    && state.view === "table"
    && state.round.phase === "turns"
    && state.round.currentActor === "opponent"
    && legal(state, { type: "AI_TURN" });
}

function clearAiSchedule(): void {
  window.clearTimeout(aiActionTimer);
  window.clearTimeout(aiPoseTimer);
  window.clearTimeout(aiPoseShakeTimer);
  aiActionTimer = undefined;
  aiPoseTimer = undefined;
  aiPoseShakeTimer = undefined;
  aiScheduleKey = null;
}

function scheduleAiTurn(state: MatchState): void {
  if (!isAiTurn(state)) { clearAiSchedule(); return; }
  const key = `${state.id}:${state.roundIndex}:${state.history.length}`;
  if (aiScheduleKey === key) return;
  clearAiSchedule();
  aiScheduleKey = key;
  const delay = getAiTurnDelayMs(state);
  aiPoseTimer = window.setTimeout(() => {
    if (aiScheduleKey !== key) return;
    const live = autosave?.getState();
    if (!live || !isAiTurn(live)) { clearAiSchedule(); return; }
    const portrait = root.querySelector<HTMLImageElement>(".character-portrait");
    if (portrait) {
      portrait.src = currentCharacter.assets.conflicted;
      portrait.alt = `${currentCharacter.name} 正在思考中……`;
      portrait.classList.add("character-shake");
      aiPoseShakeTimer = window.setTimeout(() => portrait.classList.remove("character-shake"), 360);
    }
    const waiting = root.querySelector<HTMLElement>("#ai-wait");
    if (waiting) {
      waiting.textContent = `${currentCharacter.name} 正在思考中……`;
      waiting.dataset.step = "shifted";
    }
  }, Math.round(delay / 2));
  aiActionTimer = window.setTimeout(() => {
    if (aiScheduleKey !== key) return;
    const live = autosave?.getState();
    clearAiSchedule();
    if (live && isAiTurn(live)) dispatch({ type: "AI_TURN" });
  }, delay);
}

function currentDialogue(state: MatchState): string {
  return resolveDialogueLine(state, currentCharacter.dialogue) ?? "牌桌正在等你下注。";
}
function dialogueKey(state: MatchState): string { return resolveDialogueState(state).key; }
function tablePortrait(state: MatchState, character: CharacterDefinition): string {
  if (state.round.phase === "roulette-result" && state.outcome?.reason === "opponent-killed") return character.assets.unconscious;
  if (state.round.phase === "roulette-trigger" && state.round.outcome?.penaltyTarget === "opponent") return character.assets.threatened;
  if (state.round.phase === "round-reveal" && state.round.outcome?.winner === "opponent") return character.assets.mocking;
  return character.assets.relaxed;
}
function portraitState(state: MatchState): string {
  if (state.round.phase === "roulette-result" && state.outcome?.reason === "opponent-killed") return "unconscious";
  if (state.round.phase === "roulette-trigger" && state.round.outcome?.penaltyTarget === "opponent") return "trigger";
  if (state.round.phase === "round-reveal" && state.round.outcome?.winner === "opponent") return "mocking";
  return "relaxed";
}
function portraitAlt(state: MatchState, character: CharacterDefinition): string {
  const stateName = portraitState(state);
  if (stateName === "trigger") return `${character.name} 被工作人员用左轮抵住太阳穴，神情紧张`;
  if (stateName === "mocking") return `${character.name} 正在嘲讽`;
  if (stateName === "conflicted") return `${character.name} 正在判断牌势`;
  if (stateName === "unconscious") return `${character.name} 双眼上翻，微微后仰`;
  return `${character.name} 放松地看着牌桌`;
}
function present(text: string, tone = "normal", durationMs = 1000): void {
  const node = document.querySelector<HTMLDivElement>("#presentation"); if (!node) return;
  node.textContent = text; node.dataset.tone = tone; node.classList.remove("show"); window.clearTimeout(presentationTimer); window.clearTimeout(presentationHideTimer);
  if (!save.settings.reducedMotion) document.body.classList.add("shake");
  presentationTimer = window.setTimeout(() => { node.classList.add("show"); document.body.classList.remove("shake"); }, save.settings.reducedMotion ? 0 : 40);
  presentationHideTimer = window.setTimeout(() => { node.textContent = node.dataset.default ?? ""; node.dataset.tone = "normal"; node.classList.remove("show"); document.body.classList.remove("shake"); }, durationMs);
}
function startTypewriter(text: string): void {
  window.clearInterval(dialogueTimer);
  window.clearTimeout(dialogueShakeTimer);
  const node = root.querySelector<HTMLElement>("#dialogue-text");
  const portrait = root.querySelector<HTMLElement>(".character-strip img");
  if (!node) return;
  node.textContent = "";
  node.dataset.typing = save.settings.reducedMotion ? "false" : "true";
  if (save.settings.reducedMotion) { node.textContent = text; return; }
  portrait?.classList.add("character-shake");
  dialogueShakeTimer = window.setTimeout(() => portrait?.classList.remove("character-shake"), 360);
  let index = 0;
  dialogueTimer = window.setInterval(() => {
    index += 1;
    node.textContent = text.slice(0, index);
    if (index >= text.length) { window.clearInterval(dialogueTimer); node.dataset.typing = "false"; }
  }, 24);
}
function presentDelta(before: MatchState, after: MatchState): void {
  const events = after.history.slice(before.history.length);
  const triggerWindowOpened = events.some((event) => event.type === "ROUND_RESULT_ACKNOWLEDGED")
    && (after.round.phase === "roulette-reaction" || after.round.phase === "roulette-trigger");
  const triggerPreview = triggerWindowOpened ? previewPendingTrigger(after) : null;
  const abilityNotices = after.scene === "match" && after.view === "table"
    ? [
        ...abilityTriggerNotice(events, currentCharacter.name, after),
        ...(triggerPreview ? pendingTriggerAbilityNotices(triggerPreview, currentCharacter.name) : []),
        ...abilityExpiredNotices(events)
      ]
    : [];
  if (abilityNotices.length > 0) enqueueAbilityNotices(abilityNotices);
  const trigger = events.find((candidate) => candidate.type === "TRIGGER_PULLED");
  if (trigger) present(triggerResultText(trigger), trigger.fired ? "danger" : "gold");
  if (legal(after, { type: "OPEN_SKILL_DRAW" })) offerTutorial("skill-draw-available");
}
function wireActions(container: ParentNode, handler: (action: Action) => void): void { container.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((element) => element.addEventListener("click", () => handler(JSON.parse(element.dataset.action ?? "{}") as Action))); }
function requestDispatch(action: Action): void { dispatch(action); }
function attachInteractionHaptics(): void {
  if (interactionHapticsAttached) return;
  document.addEventListener("click", (event) => {
    const button = event.composedPath().find((entry): entry is HTMLButtonElement => entry instanceof HTMLButtonElement);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;
    presentInteractionHaptic(!document.body.classList.contains("reduced-motion"));
  }, { capture: true });
  interactionHapticsAttached = true;
}
attachInteractionHaptics();

const RESOURCE_PACK_STATUS_KEY = "blackjack-resource-pack-status";

interface StoredResourcePackStatus {
  readonly version: string;
  readonly totalBytes: number;
  readonly completedAt: string;
}

function formatResourceBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function storedResourcePackStatus(): StoredResourcePackStatus | null {
  try {
    const raw = localStorage.getItem(RESOURCE_PACK_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredResourcePackStatus>;
    return typeof parsed.version === "string" && typeof parsed.totalBytes === "number" && typeof parsed.completedAt === "string"
      ? parsed as StoredResourcePackStatus
      : null;
  } catch {
    return null;
  }
}

function resourcePackSupportIssue(): string | null {
  if (typeof window !== "undefined" && window.isSecureContext === false) return "离线缓存需要 HTTPS 或 localhost";
  if (!("caches" in globalThis) || typeof globalThis.caches?.open !== "function") return "当前浏览器或内嵌环境未提供 Cache Storage";
  return null;
}

function resourcePackControlsMarkup(): string {
  const previous = storedResourcePackStatus();
  const supportIssue = resourcePackSupportIssue();
  const supported = !supportIssue;
  const progress = previous ? 100 : 0;
  const status = !supported
    ? supportIssue
    : previous
      ? `上次下载完成 · ${formatResourceBytes(previous.totalBytes)}`
      : "尚未下载";
  return `<section class="resource-pack-control" data-state="${!supported ? "error" : previous ? "complete" : "idle"}"><div class="resource-pack-heading"><strong>离线资源包</strong><small>预先保存角色图片、背景与音效</small></div><button type="button" class="secondary-button resource-pack-button" data-download-resources ${supported ? "" : "disabled"}>${previous ? "更新资源包" : "下载资源包"}</button><div class="resource-pack-progress"><progress max="100" value="${progress}" data-resource-progress aria-label="资源包下载进度"></progress><span data-resource-progress-label aria-live="polite">${status}</span></div></section>`;
}

async function startResourcePackDownload(button: HTMLButtonElement): Promise<void> {
  const control = button.closest<HTMLElement>(".resource-pack-control");
  const progress = control?.querySelector<HTMLProgressElement>("[data-resource-progress]");
  const label = control?.querySelector<HTMLElement>("[data-resource-progress-label]");
  if (!control || !progress || !label) return;
  button.disabled = true;
  button.textContent = "下载中…";
  control.dataset.state = "downloading";
  progress.value = 0;
  label.textContent = "正在读取资源清单…";
  const update = (state: ResourcePackProgress): void => {
    progress.value = state.percent;
    label.textContent = `已下载 ${formatResourceBytes(state.processedBytes)} · ${state.completed}/${state.total}`;
  };
  try {
    const manifest = await downloadResourcePack(update);
    progress.value = 100;
    control.dataset.state = "complete";
    label.textContent = `下载完成 · ${formatResourceBytes(manifest.totalBytes)} · ${manifest.assets.length} 项`;
    button.textContent = "重新下载";
    try {
      localStorage.setItem(RESOURCE_PACK_STATUS_KEY, JSON.stringify({ version: manifest.version, totalBytes: manifest.totalBytes, completedAt: new Date().toISOString() }));
    } catch { /* Cache contents remain usable when persistent status is unavailable. */ }
  } catch (error) {
    control.dataset.state = "error";
    label.textContent = error instanceof ResourcePackDownloadError
      ? `下载未完成 · ${error.failures.length} 项失败，可重试`
      : uiError(error, "资源包下载失败，请重试。");
    button.textContent = "重试下载";
  } finally {
    button.disabled = false;
  }
}

function lobbyDialogsMarkup(): string {
  return `<dialog id="rules" class="modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">终焉赌局 // 公开规则</p><h2>玩法说明</h2><p>目标是在不超过当前爆牌上限的前提下取得更高点数。用 Hit 要牌，准备好后用 Stand 停牌；达到 21 点不会自动停牌。</p><p>每轮结果会增加抽卡次数：策展人以黑杰克获胜增加 2 次，普通胜利、失败与平局增加 1 次。轮到策展人行动时可点击“抽取技能”，从固定 3 张候选中选择 1 张；局内最多持有 10 张主动或被动技能牌。</p><p>败者的左轮会被装入子弹。与会者由发牌员瞄准头部；策展人的枪口朝向天花板。与会者若赢下整局，可以向策展人索取一个愿望。</p></dialog><dialog id="skills" class="modal skills-modal" aria-labelledby="skills-title"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">策展人的收藏</p><h2 id="skills-title">技能与天赋</h2><div id="skill-content"></div></dialog><dialog id="skill-tag-info-dialog" class="modal skill-tag-info-dialog" aria-labelledby="skill-tag-info-title"><button class="modal-close" data-close aria-label="关闭流派说明">×</button><p class="eyebrow">流派说明</p><h2 id="skill-tag-info-title"></h2><p id="skill-tag-info-copy"></p></dialog><dialog id="skill-catalog" class="modal skill-catalog-modal" aria-labelledby="skill-catalog-title"><button class="modal-close" data-close aria-label="关闭技能大全">×</button><p class="eyebrow">策展人的收藏</p><h2 id="skill-catalog-title">技能大全</h2><p class="loadout-count">当前版本的全部技能与解锁状态。</p><div id="skill-catalog-content" class="loadout-list"></div></dialog><dialog id="profile" class="modal profile-modal"><button class="modal-close" data-close aria-label="关闭">×</button><div id="profile-content"></div></dialog><dialog id="settings" class="modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">古堡牌桌</p><h2>设置</h2><label class="setting"><input type="checkbox" data-setting="soundEnabled" ${save.settings.soundEnabled ? "checked" : ""}> 开启声音</label><label class="setting"><input type="checkbox" data-setting="reducedMotion" ${save.settings.reducedMotion ? "checked" : ""}> 减少动态效果</label>${resourcePackControlsMarkup()}<div class="save-actions"><button class="secondary-button" data-export>导出存档</button><button class="secondary-button" data-import>导入存档</button><button class="danger-button" data-reset>删除长期存档</button><input id="save-file" type="file" accept="application/json,.json" hidden></div><p class="status-line" id="lobby-status"></p></dialog><dialog id="save-migration" class="modal" aria-labelledby="save-migration-title"><button class="modal-close" data-close aria-label="关闭迁移提示">×</button><p class="eyebrow">存档版本不合牌桌规矩</p><h2 id="save-migration-title">导入失败</h2><p id="save-migration-copy"></p><div class="save-actions"><button class="primary-button" data-migrate-import>迁移并导入</button><button class="secondary-button" data-export-import>导出原始存档</button><button class="secondary-button" data-close>暂不处理</button></div><p class="status-line" data-migration-status></p></dialog>`;
}

function randomUnit(): number {
  const bytes = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes)[0] / 0x100000000;
  return Math.random();
}

function eligibleGuestIds(): string[] {
  const defeated = new Set(defeatedCharacterIdsByFirstDefeat(save.defeats));
  return CHARACTER_CATALOG
    .filter((character) => isCharacterUnlocked(character, save.defeats) && !defeated.has(character.id))
    .map((character) => character.id);
}

function selectGuestIds(): string[] {
  const available = eligibleGuestIds().map((id) => getCharacterMetadata(id)).filter((character): character is NonNullable<typeof character> => Boolean(character));
  const shuffled = [...available];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(randomUnit() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  const next = shuffled.slice(0, 3).map((character) => character.id);
  if (available.length > 3 && guestSelectionIds.length > 0) {
    const current = new Set(guestSelectionIds);
    if (next.every((id) => current.has(id))) {
      const replacement = shuffled.find((character) => !current.has(character.id));
      if (replacement) next[Math.floor(randomUnit() * next.length)] = replacement.id;
    }
  } else if (next.length > 1 && next.join(",") === guestSelectionIds.join(",")) {
    [next[0], next[1]] = [next[1], next[0]];
  }
  return next;
}

function characterCardMarkup(character: (typeof CHARACTER_CATALOG)[number], options: { defeated?: boolean } = {}): string {
  const defeated = options.defeated === true;
  return `<article class="character-card ${defeated ? "is-defeated" : "is-guest"}" data-character-id="${escapeHtml(character.id)}"><div class="portrait"><img class="scaled-character-art" style="--character-art-scale:${character.portraitScales.selection}" src="${escapeHtml(character.previewImage)}" alt="${escapeHtml(character.name)}" loading="lazy" decoding="async" /></div><div class="character-copy"><p class="eyebrow">与会者 // ${escapeHtml(character.tier)}级</p><h2>${escapeHtml(character.name)}</h2><p>${escapeHtml(character.subtitle)}</p><button class="card-invite" data-invite-character="${escapeHtml(character.id)}">邀请 <span>→</span></button></div></article>`;
}

function defeatedCharactersNewestFirst(): (typeof CHARACTER_CATALOG)[number][] {
  return [...defeatedCharacterIdsByFirstDefeat(save.defeats)]
    .reverse()
    .map((id) => getCharacterMetadata(id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character));
}

function defeatedLoadMoreMarkup(remaining: number): string {
  if (remaining <= 0) return "";
  return `<button type="button" class="defeated-load-more" data-load-more-defeated aria-controls="defeated-character-list" aria-label="加载更多已击败宾客，剩余 ${remaining} 名"><span>继续下拉查看</span><small>剩余 ${remaining} 名</small><i aria-hidden="true">⌄</i></button>`;
}

function wireInviteButtons(container: ParentNode): void {
  container.querySelectorAll<HTMLButtonElement>("[data-invite-character]:not([data-invite-wired])").forEach((button) => {
    button.dataset.inviteWired = "true";
    button.addEventListener("click", () => void openProfile(button.dataset.inviteCharacter ?? ""));
  });
}

function loadMoreDefeatedGuests(): void {
  const list = root.querySelector<HTMLElement>("#defeated-character-list");
  const control = root.querySelector<HTMLButtonElement>("[data-load-more-defeated]");
  if (!list || !control) return;
  const defeatedCharacters = defeatedCharactersNewestFirst();
  const visibleCount = list.querySelectorAll(":scope > .character-card").length;
  const nextCharacters = defeatedCharacters.slice(visibleCount, visibleCount + DEFEATED_GUEST_BATCH_SIZE);
  list.insertAdjacentHTML("beforeend", nextCharacters.map((character) => characterCardMarkup(character, { defeated: true })).join(""));
  wireInviteButtons(list);
  const remaining = defeatedCharacters.length - visibleCount - nextCharacters.length;
  if (remaining <= 0) {
    defeatedGuestObserver?.disconnect();
    defeatedGuestObserver = null;
    control.remove();
    return;
  }
  control.setAttribute("aria-label", `加载更多已击败宾客，剩余 ${remaining} 名`);
  const count = control.querySelector("small");
  if (count) count.textContent = `剩余 ${remaining} 名`;
}

function wireDefeatedGuestLoader(): void {
  const control = root.querySelector<HTMLButtonElement>("[data-load-more-defeated]");
  if (!control) return;
  control.addEventListener("click", loadMoreDefeatedGuests);
  if (!("IntersectionObserver" in window)) return;
  defeatedGuestObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadMoreDefeatedGuests();
  }, { rootMargin: "0px 0px 160px" });
  defeatedGuestObserver.observe(control);
}

function renderLobby(layer: LobbyLayer = "menu"): void {
  discardActiveTutorial();
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer);
  gameAudio.stopHeartbeat();
  gameAudio.setBgmScene("lobby");
  clearAbilityNoticeQueue();
  detachFullscreenListener();
  lastDialogueKey = null;
  autosave = null;
  lobbyLayer = layer;
  void resourceLoader.enqueue(lobbyResourceUrls(
    CHARACTER_CATALOG.filter((character) => isCharacterUnlocked(character, save.defeats))
  ), "background");
  void resourceLoader.enqueue(SKILL_ARCHETYPE_ART_URLS, "deferred");
  defeatedGuestObserver?.disconnect();
  defeatedGuestObserver = null;
  if (layer === "characters") {
    const eligible = new Set(eligibleGuestIds());
    const expectedCount = Math.min(3, eligible.size);
    if (guestSelectionIds.length !== expectedCount || guestSelectionIds.some((id) => !eligible.has(id))) guestSelectionIds = selectGuestIds();
  }
  const guestCharacters = guestSelectionIds.map((id) => getCharacterMetadata(id)).filter((character): character is NonNullable<typeof character> => Boolean(character));
  const defeatedCharacters = defeatedCharactersNewestFirst();
  const visibleDefeatedCharacters = defeatedCharacters.slice(0, DEFEATED_GUEST_BATCH_SIZE);
  const characterCards = guestCharacters.map((character) => characterCardMarkup(character)).join("");
  const defeatedCards = visibleDefeatedCharacters.map((character) => characterCardMarkup(character, { defeated: true })).join("");
  const defeatedGuestsRemaining = defeatedCharacters.length - visibleDefeatedCharacters.length;
  root.innerHTML = layer === "menu"
    ? `<main class="lobby-shell lobby-menu-shell"><header class="lobby-invitation"><span>Blackjack & Roulette</span><button type="button" class="icon-button lobby-settings-button" data-open="settings" aria-label="打开设置">⚙</button></header><section class="lobby-title-block" aria-labelledby="lobby-title"><h1 id="lobby-title">绝命之夜</h1><div class="menu-subtitle"><span></span><strong>终焉赌局</strong></div><div class="menu-oath"><p>奉上自己的一切，包括自己的身体。</p><p>一点点的技巧和运气，以及全部的决心。</p><strong>祂终将有求必应。</strong></div></section><nav class="lobby-menu" aria-label="古堡主菜单"><button type="button" class="lobby-menu-button lobby-primary-action" data-enter-duel><span class="button-copy"><strong>对决</strong><small>选择一名与会者</small></span><span class="button-arrow" aria-hidden="true">›</span></button><div class="lobby-secondary-menu"><button type="button" class="lobby-menu-button lobby-secondary-action" data-open="rules"><strong>玩法说明</strong></button><button type="button" class="lobby-menu-button lobby-secondary-action" data-open="skills"><strong>技能与天赋</strong></button><button type="button" class="lobby-menu-button lobby-secondary-action" data-open-trophies><strong>战利品陈列室</strong><small>${save.defeats.length} 件</small></button></div></nav>${lobbyDialogsMarkup()}</main>`
    : `<main class="lobby-shell lobby-character-shell"><header class="topbar"><button class="icon-button" data-lobby-home aria-label="返回绝命之夜主菜单">←</button><span class="eyebrow">古堡二层 // 与会者名册</span><span class="topbar-balance" aria-hidden="true"></span></header><section class="hero selection-hero"><p class="kicker">回应邀请之人</p><h1>选择<br><em>与会者</em></h1><p class="hero-copy">她们因为渴求走进古堡，<br>却被永远留在了这里。</p><div class="hero-rule"><span></span><b>02</b><span></span></div></section><section class="guest-section" aria-labelledby="guest-title"><div class="guest-heading"><div><p class="kicker">等待入场</p><h2 id="guest-title">候场宾客</h2></div><button type="button" class="quiet-button" data-refresh-guests aria-label="刷新候场宾客">刷新</button></div><section class="character-list">${characterCards || `<div class="empty-history"><span>◇</span><p>暂时没有可赴约的宾客。</p></div>`}</section></section><section class="guest-section defeated-section" aria-labelledby="defeated-title"><div class="guest-heading"><div><p class="kicker">回想</p><h2 id="defeated-title">已死亡宾客</h2></div></div><section id="defeated-character-list" class="character-list" aria-live="polite">${defeatedCards || `<div class="empty-history"><span>◇</span><p>还没有战利品呢，快去狩猎吧。</p></div>`}</section>${defeatedLoadMoreMarkup(defeatedGuestsRemaining)}</section><div class="lobby-tools"><span class="quiet-record">策展人记录 // ${save.profile.matchesPlayed}</span></div><footer class="footer"><span>古堡牌室 // 02</span><span>${defeatedCharacters.length} 名已击败宾客</span></footer>${lobbyDialogsMarkup()}</main>`;
  root.querySelector<HTMLButtonElement>("[data-enter-duel]")?.addEventListener("click", () => { guestSelectionIds = []; renderLobby("characters"); });
  root.querySelector<HTMLButtonElement>("[data-lobby-home]")?.addEventListener("click", () => renderLobby("menu"));
  root.querySelector<HTMLButtonElement>("[data-refresh-guests]")?.addEventListener("click", () => { guestSelectionIds = selectGuestIds(); renderLobby("characters"); });
  root.querySelectorAll<HTMLButtonElement>("[data-open]:not([data-open=skills])").forEach((button) => button.addEventListener("click", () => document.querySelector<HTMLDialogElement>(`#${button.dataset.open}`)?.showModal()));
  root.querySelector<HTMLButtonElement>("[data-open=skills]")?.addEventListener("click", openSkillManagement);
  root.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()));
  wireInviteButtons(root);
  wireDefeatedGuestLoader();
  root.querySelector<HTMLButtonElement>("[data-open-trophies]")?.addEventListener("click", renderTrophyRoom);
  root.querySelectorAll<HTMLInputElement>("[data-setting]").forEach((input) => input.addEventListener("change", updateSettings));
  root.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener("click", () => void exportSave());
  root.querySelector<HTMLButtonElement>("[data-import]")?.addEventListener("click", () => void requestImport());
  root.querySelector<HTMLInputElement>("#save-file")?.addEventListener("change", importFile);
  root.querySelector<HTMLButtonElement>("[data-migrate-import]")?.addEventListener("click", () => void migrateImportedSave());
  root.querySelector<HTMLButtonElement>("[data-export-import]")?.addEventListener("click", () => void exportFailedImport());
  root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => { if (!confirmResetCurrentData()) return; void resetCurrentData(); });
  root.querySelector<HTMLButtonElement>("[data-download-resources]")?.addEventListener("click", (event) => void startResourcePackDownload(event.currentTarget as HTMLButtonElement));
}

async function resetCurrentData(): Promise<void> {
  await repository.deleteLongTerm();
  save = resetSave();
  autosave = null;
  clearAiSchedule();
  gameAudio.stopHeartbeat();
  document.body.classList.remove("reduced-motion");
  gameAudio.configure(save.settings.soundEnabled);
  await repository.saveLongTerm(save);
  renderLobby(lobbyLayer);
}
function confirmResetCurrentData(): boolean { return window.confirm(RESET_CONFIRM_MESSAGE); }

function showcaseDialogsMarkup(): string {
  return `<dialog id="history-detail" class="modal history-modal"><button class="modal-close" data-history-close aria-label="关闭">×</button><div id="history-detail-content"></div></dialog><dialog id="trophy-gallery" class="trophy-gallery-dialog" aria-label="角色收藏鉴赏"><div id="trophy-gallery-content"></div></dialog>`;
}

function historyCardMarkup(record: MatchHistoryRecord): string {
  const character = getCharacterMetadata(record.opponentId)!;
  const won = record.winner === "player" && !record.escaped;
  const image = won
    ? `<img src="${character.trophyImage}" alt="被策展人战胜后平躺的${escapeHtml(character.name)}" />`
    : `<img class="transparent-history-image" src="${TRANSPARENT_PIXEL}" alt="本局未获得胜利图像" />`;
  return `<button class="trophy-card ${won ? "is-victory" : "is-empty"}" data-history-id="${escapeHtml(record.id)}"><span class="trophy-visual">${image}</span><span class="trophy-meta"><small>${historyResultLabel(record)}</small><strong>策展人 VS ${escapeHtml(character.name)}</strong><time datetime="${escapeHtml(record.timestamp)}">${historyDate(record.timestamp)}</time></span></button>`;
}

function trophyCardMarkup(record: CharacterDefeatRecord): string {
  const character = getCharacterMetadata(record.opponentId)!;
  return `<button class="trophy-card is-victory tier-trophy" data-tier="${escapeHtml(character.tier)}" data-trophy-character-id="${escapeHtml(record.opponentId)}"><span class="trophy-visual"><img src="${escapeHtml(character.trophyImage)}" alt="${escapeHtml(character.name)}的战利品收藏记录" /></span><span class="trophy-meta"><small>${escapeHtml(character.tier)}级战利品</small><strong>${escapeHtml(character.name)}</strong><time datetime="${escapeHtml(record.timestamp)}">${historyDate(record.timestamp)}</time></span></button>`;
}

function renderTrophyRoom(): void {
  discardActiveTutorial();
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer); autosave = null;
  gameAudio.setBgmScene("lobby");
  const records = [...save.defeats].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const cards = records.map(trophyCardMarkup).join("");
  root.innerHTML = `<main class="trophy-shell"><header class="topbar"><button class="icon-button" data-trophy-back aria-label="返回大厅">←</button><span class="eyebrow">独特藏品</span><button type="button" class="history-shortcut" data-open-history><span>查看历史记录</span><small>${save.history.length}</small></button></header><section class="trophy-heading"><p class="kicker">你的战利品收藏</p><h1>死体<br><em>陈列室</em></h1><p>你可以尽情享用，她们已经没法反抗了不是吗。</p></section><section class="trophy-list">${cards || `<div class="empty-history"><span>◇</span><h2>还没有战利品</h2><p>首次击败一名与会者后，藏品会出现在这里。</p></div>`}</section>${showcaseDialogsMarkup()}</main>`;
  root.querySelector<HTMLButtonElement>("[data-trophy-back]")?.addEventListener("click", () => renderLobby("menu"));
  root.querySelector<HTMLButtonElement>("[data-open-history]")?.addEventListener("click", renderMatchHistory);
  root.querySelector<HTMLButtonElement>("[data-history-close]")?.addEventListener("click", () => {
    root.querySelector<HTMLDialogElement>("#trophy-gallery")?.close();
    root.querySelector<HTMLDialogElement>("#history-detail")?.close();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-trophy-character-id]").forEach((button) => button.addEventListener("click", () => void openTrophyDetail(button.dataset.trophyCharacterId ?? "")));
}

function renderMatchHistory(): void {
  const records = [...save.history].reverse();
  const cards = records.map(historyCardMarkup).join("");
  root.innerHTML = `<main class="trophy-shell history-shell"><header class="topbar"><button class="icon-button" data-history-back aria-label="返回战利品陈列室">←</button><span class="eyebrow">对局记录</span><span class="history-count">${records.length}</span></header><section class="trophy-heading history-heading"><p class="kicker">你的对局记录</p><h1>历史<br><em>记录</em></h1><p>这里保留每一局的结果与统计，可随时单独清理。</p><button type="button" class="danger-button clear-history-button" data-clear-history ${records.length === 0 ? "disabled" : ""}>清理对局记录</button></section><section class="trophy-list">${cards || `<div class="empty-history"><span>◇</span><h2>还没有对局记录</h2><p>完成一场牌局后，统计会出现在这里。</p></div>`}</section>${showcaseDialogsMarkup()}</main>`;
  root.querySelector<HTMLButtonElement>("[data-history-back]")?.addEventListener("click", renderTrophyRoom);
  root.querySelector<HTMLButtonElement>("[data-clear-history]")?.addEventListener("click", () => void clearHistoryFromUi());
  root.querySelector<HTMLButtonElement>("[data-history-close]")?.addEventListener("click", () => {
    root.querySelector<HTMLDialogElement>("#trophy-gallery")?.close();
    root.querySelector<HTMLDialogElement>("#history-detail")?.close();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-history-id]").forEach((button) => button.addEventListener("click", () => void openHistoryDetail(button.dataset.historyId ?? "")));
}

async function clearHistoryFromUi(): Promise<void> {
  if (save.history.length === 0 || !window.confirm(CLEAR_HISTORY_CONFIRM_MESSAGE)) return;
  save = clearMatchHistory(save);
  await repository.saveLongTerm(save);
  renderMatchHistory();
}
function closeupMarkup(point: TrophyCloseupPoint, pointIndex: number, variantIndex: number): string {
  const variants = [{ image: point.image, description: point.description }, ...(point.variants ?? [])];
  const variant = variants[variantIndex] ?? variants[0];
  const nextIndex = (variantIndex + 1) % variants.length;
  const art = variants.length > 1
    ? `<button type="button" class="trophy-closeup-art is-switchable" data-next-closeup-variant aria-label="切换${escapeHtml(point.name)}至 p${nextIndex}"><img src="${escapeHtml(variant.image)}" alt="${escapeHtml(point.name)}方形局部特写 p${variantIndex}" /><span>p${variantIndex} · ${variantIndex + 1}/${variants.length}</span></button>`
    : `<div class="trophy-closeup-art"><img src="${escapeHtml(variant.image)}" alt="${escapeHtml(point.name)}方形局部特写" /></div>`;
  return `${art}<div><p class="eyebrow">局部特写 // ${String(pointIndex + 1).padStart(2, "0")}${variants.length > 1 ? ` · p${variantIndex}` : ""}</p><h2>${escapeHtml(point.name)}</h2><p>${escapeHtml(variant.description)}</p></div><button class="trophy-closeup-close" data-close-closeup aria-label="收起局部特写">×</button>`;
}

function trophyDossierMarkup(character: CharacterDefinition): string {
  const dossier = character.trophyDossier;
  const fields = dossier.fields.map((field) => `<div class="trophy-dossier-field" data-dossier-field="${escapeHtml(field.id)}"><dt>${escapeHtml(field.label)}：</dt><dd>${escapeHtml(field.value)}</dd></div>`).join("");
  return `<section class="trophy-dossier-shell" data-dossier-shell data-open="false"><aside id="trophy-dossier-panel" class="trophy-dossier" aria-hidden="true"><div class="trophy-dossier-heading"><h2>${escapeHtml(dossier.title)}</h2><span>${escapeHtml(dossier.recordLabel)}</span></div><div class="trophy-dossier-main"><figure><img src="${escapeHtml(character.assets.defeatedSummary)}" alt="${escapeHtml(dossier.fields[0]?.value ?? character.name)}的椅子档案图" draggable="false" /></figure><dl>${fields}</dl></div><section class="trophy-dossier-condition"><h3>${escapeHtml(dossier.condition.label)}</h3><div class="trophy-dossier-condition-lines"><p>${escapeHtml(dossier.condition.description)}</p><span></span><span></span></div></section></aside><button type="button" class="trophy-dossier-toggle" data-dossier-toggle aria-controls="trophy-dossier-panel" aria-expanded="false" aria-label="${escapeHtml(dossier.openLabel)}"><span>${escapeHtml(dossier.openLabel)}</span></button></section>`;
}

function openTrophyGallery(character: CharacterDefinition, gallery: CharacterTrophyGallery): void {
  const dialog = root.querySelector<HTMLDialogElement>("#trophy-gallery");
  const content = root.querySelector<HTMLDivElement>("#trophy-gallery-content");
  if (!dialog || !content) return;
  const poses = [{ id: "default", name: "正面", image: gallery.fullBody }, ...(gallery.poses ?? [])];
  const hotspots = gallery.closeups.map((point, index) => `<button type="button" class="trophy-hotspot" data-closeup-id="${escapeHtml(point.id)}" style="--hotspot-x:${point.x}%;--hotspot-y:${point.y}%" aria-label="查看特写：${escapeHtml(point.name)}" aria-pressed="false"><span>${index + 1}</span></button>`).join("");
  const turnControls = poses.length > 1 ? `<nav class="trophy-gallery-turn-controls" aria-label="翻转人物视角"><button type="button" class="trophy-gallery-turn is-previous" data-gallery-turn="-1" aria-controls="trophy-gallery-subject"><span aria-hidden="true">‹</span></button><button type="button" class="trophy-gallery-turn is-next" data-gallery-turn="1" aria-controls="trophy-gallery-subject"><span aria-hidden="true">›</span></button></nav>` : "";
  content.innerHTML = `<div class="trophy-gallery-viewer"><header class="trophy-gallery-header"><div><p class="eyebrow">战利品鉴赏 // ${escapeHtml(character.name)}</p><h1>死体展示</h1></div><button class="trophy-gallery-close" data-gallery-close aria-label="关闭全屏鉴赏">×</button></header><div class="trophy-gallery-canvas"><figure class="trophy-gallery-stage" data-gallery-pose="${escapeHtml(poses[0].id)}"><img class="trophy-gallery-background" src="${TROPHY_GALLERY_COFFIN_IMAGE}" alt="" aria-hidden="true" draggable="false" /><img id="trophy-gallery-subject" class="trophy-gallery-subject" data-gallery-subject src="${escapeHtml(poses[0].image)}" alt="死亡后的${escapeHtml(character.name)}正面竖屏全身鉴赏" draggable="false" />${hotspots}${turnControls}<figcaption data-gallery-caption aria-live="polite" aria-atomic="true">正面 · 左右滑动或点按箭头翻转 · 点按圆环查看特写</figcaption></figure>${trophyDossierMarkup(character)}<aside id="trophy-closeup-panel" class="trophy-closeup-panel" aria-live="polite"><p>选择画面中的特写点。</p></aside></div></div>`;
  const panel = content.querySelector<HTMLElement>("#trophy-closeup-panel");
  const stage = content.querySelector<HTMLElement>(".trophy-gallery-stage");
  const subject = content.querySelector<HTMLImageElement>("[data-gallery-subject]");
  const caption = content.querySelector<HTMLElement>("[data-gallery-caption]");
  const buttons = [...content.querySelectorAll<HTMLButtonElement>("[data-closeup-id]")];
  const turnButtons = [...content.querySelectorAll<HTMLButtonElement>("[data-gallery-turn]")];
  const dossierShell = content.querySelector<HTMLElement>("[data-dossier-shell]");
  const dossierPanel = content.querySelector<HTMLElement>("#trophy-dossier-panel");
  const dossierToggle = content.querySelector<HTMLButtonElement>("[data-dossier-toggle]");
  const dossierToggleLabel = dossierToggle?.querySelector<HTMLElement>("span");
  const setDossierOpen = (open: boolean): void => {
    if (!dossierShell || !dossierPanel || !dossierToggle || !dossierToggleLabel) return;
    dossierShell.dataset.open = String(open);
    dossierPanel.setAttribute("aria-hidden", String(!open));
    dossierToggle.setAttribute("aria-expanded", String(open));
    const label = open ? character.trophyDossier.closeLabel : character.trophyDossier.openLabel;
    dossierToggle.setAttribute("aria-label", label);
    dossierToggleLabel.textContent = label;
  };
  let currentPoseIndex = 0;
  const hideCloseup = (): void => {
    if (!panel) return;
    panel.classList.remove("is-open");
    panel.innerHTML = "<p>选择画面中的特写点。</p>";
    buttons.forEach((button) => button.setAttribute("aria-pressed", "false"));
  };
  buttons.forEach((button) => button.addEventListener("click", () => {
    const index = gallery.closeups.findIndex((point) => point.id === button.dataset.closeupId);
    const point = gallery.closeups[index];
    if (!point || !panel) return;
    const variantCount = 1 + (point.variants?.length ?? 0);
    const renderCloseup = (variantIndex: number, focusArt = false): void => {
      panel.innerHTML = closeupMarkup(point, index, variantIndex);
      panel.querySelector<HTMLButtonElement>("[data-close-closeup]")?.addEventListener("click", hideCloseup);
      const art = panel.querySelector<HTMLButtonElement>("[data-next-closeup-variant]");
      art?.addEventListener("click", () => renderCloseup((variantIndex + 1) % variantCount, true));
      if (focusArt) art?.focus();
    };
    renderCloseup(0);
    panel.classList.add("is-open");
    buttons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
  }));
  dossierToggle?.addEventListener("click", () => {
    const open = dossierShell?.dataset.open !== "true";
    if (open) hideCloseup();
    setDossierOpen(open);
  });
  const showPose = (requestedIndex: number, direction: -1 | 1, withFeedback = false): void => {
    if (!subject || !caption || !stage) return;
    currentPoseIndex = (requestedIndex + poses.length) % poses.length;
    const pose = poses[currentPoseIndex];
    const isDefault = currentPoseIndex === 0;
    hideCloseup();
    subject.src = pose.image;
    subject.alt = `死亡后的${character.name}${pose.name}竖屏全身鉴赏`;
    subject.classList.remove("is-turning-previous", "is-turning-next");
    void subject.offsetWidth;
    subject.classList.add(direction < 0 ? "is-turning-previous" : "is-turning-next");
    stage.dataset.galleryPose = pose.id;
    buttons.forEach((hotspot) => { hotspot.hidden = !isDefault; });
    caption.textContent = `${pose.name} · 左右滑动或点按箭头翻转${isDefault ? " · 点按圆环查看特写" : ""}`;
    if (withFeedback) {
      gameAudio.play("bodyMoved");
      presentBodyMovedHaptic(!save.settings.reducedMotion);
    }
    const previousPose = poses[(currentPoseIndex - 1 + poses.length) % poses.length];
    const nextPose = poses[(currentPoseIndex + 1) % poses.length];
    turnButtons.forEach((button) => {
      const step = button.dataset.galleryTurn === "-1" ? -1 : 1;
      const targetPose = step < 0 ? previousPose : nextPose;
      button.setAttribute("aria-label", `${step < 0 ? "向右" : "向左"}翻转到${targetPose.name}`);
    });
  };
  turnButtons.forEach((button) => button.addEventListener("click", () => {
    const direction = button.dataset.galleryTurn === "-1" ? -1 : 1;
    showPose(currentPoseIndex + direction, direction, true);
  }));
  showPose(0, 1);
  subject?.classList.remove("is-turning-previous", "is-turning-next");

  let swipeStart: { pointerId: number; x: number; y: number } | undefined;
  stage?.addEventListener("pointerdown", (event) => {
    if ((event.pointerType === "mouse" && event.button !== 0) || (event.target instanceof Element && event.target.closest("button"))) return;
    swipeStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
  });
  stage?.addEventListener("pointerup", (event) => {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
    const { x, y } = swipeStart;
    swipeStart = undefined;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    const horizontalDistance = event.clientX - x;
    const verticalDistance = event.clientY - y;
    const swipeThreshold = Math.max(36, stage.clientWidth * .1);
    if (Math.abs(horizontalDistance) < swipeThreshold || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;
    const direction = horizontalDistance < 0 ? 1 : -1;
    showPose(currentPoseIndex + direction, direction, true);
  });
  const cancelSwipe = (event: PointerEvent): void => {
    if (swipeStart?.pointerId !== event.pointerId) return;
    swipeStart = undefined;
  };
  stage?.addEventListener("pointercancel", cancelSwipe);
  stage?.addEventListener("lostpointercapture", cancelSwipe);
  content.querySelector<HTMLButtonElement>("[data-gallery-close]")?.addEventListener("click", () => dialog.close());
  dialog.showModal();
}

function trophyGalleryPreviewMarkup(character: CharacterDefinition, gallery: CharacterTrophyGallery): string {
  return `<section class="history-trophy-preview" data-tier="${escapeHtml(character.tier)}"><img src="${escapeHtml(gallery.headshot)}" alt="死亡后的${escapeHtml(character.name)}头部特写" /><div><p class="eyebrow">战利品等级：${escapeHtml(character.tier)}</p><strong>${escapeHtml(character.name)}的死体展示</strong><button type="button" class="text-button" data-open-trophy-gallery>进入全屏鉴赏 <span>→</span></button></div></section>`;
}

async function openTrophyDetail(opponentId: string): Promise<void> {
  const record = save.defeats.find((entry) => entry.opponentId === opponentId);
  const metadata = getCharacterMetadata(opponentId);
  const dialog = root.querySelector<HTMLDialogElement>("#history-detail");
  const content = root.querySelector<HTMLDivElement>("#history-detail-content");
  if (!record || !metadata || !dialog || !content) return;
  const character = await loadCharacter(opponentId).catch(() => undefined);
  const gallery = character?.trophyGallery;
  content.innerHTML = `<p class="eyebrow">首次击败 // ${historyDate(record.timestamp)}</p><h2>${escapeHtml(metadata.tier)}级战利品</h2><p class="history-opponent">${escapeHtml(metadata.name)}</p>${character && gallery ? trophyGalleryPreviewMarkup(character, gallery) : `<p class="status-line">该藏品暂未配置深度鉴赏记录。</p>`}`;
  if (character && gallery) content.querySelector<HTMLButtonElement>("[data-open-trophy-gallery]")?.addEventListener("click", () => openTrophyGallery(character, gallery));
  dialog.showModal();
}

async function openHistoryDetail(id: string): Promise<void> {
  const record = save.history.find((entry) => entry.id === id);
  const dialog = root.querySelector<HTMLDialogElement>("#history-detail");
  const content = root.querySelector<HTMLDivElement>("#history-detail-content");
  if (!record || !dialog || !content) return;
  const metadata = getCharacterMetadata(record.opponentId)!;
  const won = record.winner === "player" && !record.escaped;
  const character = won ? await loadCharacter(metadata.id).catch(() => undefined) : undefined;
  const gallery = character?.trophyGallery;
  const galleryPreview = character && gallery ? trophyGalleryPreviewMarkup(character, gallery) : "";
  content.innerHTML = `<p class="eyebrow">${historyDate(record.timestamp)}</p><h2>${historyResultLabel(record)}</h2><p class="history-opponent">策展人 VS ${escapeHtml(metadata.name)}</p>${galleryPreview}<dl class="history-stats"><dt>策展人最终左轮</dt><dd>${record.finalRoulette.player.bullets} / ${record.finalRoulette.player.capacity}</dd><dt>${escapeHtml(metadata.name)}最终左轮</dt><dd>${record.finalRoulette.opponent.bullets} / ${record.finalRoulette.opponent.capacity}</dd><dt>策展人爆牌</dt><dd>${record.busts.player} 次</dd><dt>${escapeHtml(metadata.name)}爆牌</dt><dd>${record.busts.opponent} 次</dd><dt>策展人黑杰克</dt><dd>${record.blackjacks.player} 次</dd><dt>${escapeHtml(metadata.name)}黑杰克</dt><dd>${record.blackjacks.opponent} 次</dd></dl>`;
  if (character && gallery) content.querySelector<HTMLButtonElement>("[data-open-trophy-gallery]")?.addEventListener("click", () => openTrophyGallery(character, gallery));
  dialog.showModal();
}
async function openProfile(id: string): Promise<void> {
  const metadata = getCharacterMetadata(id);
  if (!metadata) return;
  try {
    const character = await loadCharacter(metadata.id);
    selectedCharacterId = character.id;
    const content = root.querySelector<HTMLDivElement>("#profile-content");
    if (content) {
      const abilities = character.aiSkills
        .filter((binding) => binding.enabled)
        .map((binding) => getAbilityDefinition(binding.definitionId))
        .filter((definition): definition is NonNullable<ReturnType<typeof getAbilityDefinition>> => Boolean(definition));
      const abilityMarkup = abilities.length === 0 ? "" : `<section class="profile-abilities" aria-label="角色技能"><h3>技能</h3>${abilities.map((ability) => `<details class="profile-ability"><summary><strong>${escapeHtml(ability.name)}</strong><span>：${escapeHtml(ability.description)}</span></summary><p>${escapeHtml(ability.profileLore ?? ability.description)}</p></details>`).join("")}</section>`;
      const defeated = defeatedCharacterIdsByFirstDefeat(save.defeats).includes(character.id);
      const unlocked = isCharacterUnlocked(character, save.defeats);
      const actionMarkup = defeated
        ? `<p class="status-line">她已经成为了一具尸体，但不妨碍你和她继续对局。</p><button class="primary-button profile-start" data-profile-start="${escapeHtml(character.id)}">开始对局 <span>→</span></button>`
        : unlocked
          ? `<button class="primary-button profile-start" data-profile-start="${escapeHtml(character.id)}">开始对局 <span>→</span></button>`
          : `<p class="status-line">尚未解锁：${escapeHtml(unlockConditionLabel(character.unlock))}</p>`;
      content.innerHTML = `<img src="${escapeHtml(character.previewImage)}" alt="${escapeHtml(character.name)}" loading="lazy" decoding="async" /><p class="eyebrow">角色档案 // ${escapeHtml(character.tier)}级</p><h2>${escapeHtml(character.name)}</h2>${abilityMarkup}<p class="profile-description">${escapeHtml(character.profile.description)}</p>${actionMarkup}`;
    }
    content?.querySelector<HTMLButtonElement>("[data-profile-start]")?.addEventListener("click", () => { document.querySelector<HTMLDialogElement>("#profile")?.close(); void startMatch(character.id); });
    document.querySelector<HTMLDialogElement>("#profile")?.showModal();
  } catch (error) { renderError(error); }
}
function unlockConditionLabel(condition: CharacterUnlockCondition | undefined): string {
  if (!condition) return "完成条件后";
  if (condition.type === "defeat-any") return "击败任意角色";
  if (condition.type === "defeat-count") return `击败 ${condition.count} 名不同与会者`;
  const tagLabel = (tag: string): string => {
    const tier = /^tier:(d|c|b|a|s|ss)$/.exec(tag)?.[1];
    return tier ? `${tier.toUpperCase()}级` : `带有「${tag}」标签的`;
  };
  if (condition.type === "defeat-any-tag") return `击败一名${tagLabel(condition.tag)}角色`;
  if (condition.type === "defeat-character") return `击败指定角色 ${getCharacterMetadata(condition.characterId)?.name ?? condition.characterId}`;
  return `击败${tagLabel(condition.tag)}角色的 ${condition.percentage}%`;
}
async function updateSettings(event: Event): Promise<void> { const input = event.target as HTMLInputElement; const setting = input.dataset.setting === "reducedMotion" ? "reducedMotion" : "soundEnabled"; save = { ...save, settings: { ...save.settings, [setting]: input.checked }, updatedAt: new Date().toISOString() }; document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); if (setting === "soundEnabled") { gameAudio.unlock(); gameAudio.configure(input.checked); } const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = "设置已保存。"; await repository.saveLongTerm(save); }
async function exportSave(): Promise<void> { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); try { const method = await downloadSave(autosave?.getSave() ?? save); if (status) status.textContent = method === "file-system-access" ? "存档已写入。" : "已开始下载存档。"; } catch (error) { if (status) status.textContent = uiError(error, "导出失败。"); } }
async function applyImportedSave(next: LongTermSave): Promise<void> { save = next; document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); gameAudio.configure(save.settings.soundEnabled); await repository.saveLongTerm(save); pendingImportedSave = undefined; renderLobby(lobbyLayer); }
function showImportMigrationPrompt(error: SaveValidationError): void {
  pendingImportedSave = error.input;
  const supported = canMigrateLongTermSave(pendingImportedSave);
  const dialog = root.querySelector<HTMLDialogElement>("#save-migration");
  const copy = dialog?.querySelector<HTMLParagraphElement>("#save-migration-copy");
  const migrateButton = dialog?.querySelector<HTMLButtonElement>("[data-migrate-import]");
  const status = root.querySelector<HTMLParagraphElement>("#lobby-status");
  if (copy) copy.textContent = supported
    ? "检测到旧版长期存档。可以先导出原件留底，再按当前版本的迁移链转换并导入。"
    : "这份文件无法识别，或目前没有完整迁移路径。原件仍可导出留底，迁移按钮暂不可用。";
  if (migrateButton) migrateButton.disabled = !supported;
  if (status) status.textContent = "导入失败：请在迁移提示中选择后续处理。";
  dialog?.showModal();
}
function handleImportFailure(error: unknown): void {
  if (error instanceof SaveValidationError && error.kind === "long-term") { showImportMigrationPrompt(error); return; }
  const status = root.querySelector<HTMLParagraphElement>("#lobby-status");
  if (status) status.textContent = uiError(error, "导入失败。");
}
async function migrateImportedSave(): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-migration-status]");
  try { await applyImportedSave(migrateLongTermSave(pendingImportedSave)); }
  catch (error) { if (status) status.textContent = uiError(error, "迁移失败，原存档未被覆盖。"); }
}
async function exportFailedImport(): Promise<void> {
  const status = root.querySelector<HTMLElement>("[data-migration-status]");
  try {
    const method = await downloadRawSave(pendingImportedSave);
    if (status) status.textContent = method === "file-system-access" ? "原始存档已写入。" : "已开始下载原始存档。";
  } catch (error) { if (status) status.textContent = uiError(error, "原始存档导出失败。"); }
}
function importFile(event: Event): void { const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return; void importSave(file).then(applyImportedSave).catch(handleImportFailure).finally(() => { input.value = ""; }); }
async function requestImport(): Promise<void> { try { await applyImportedSave(await openSaveWithFileSystemAccess()); } catch (error) { if (error instanceof Error && error.message.includes("unavailable")) root.querySelector<HTMLInputElement>("#save-file")?.click(); else handleImportFailure(error); } }
async function startMatch(characterId = selectedCharacterId): Promise<void> {
  if (characterLoadInFlight) return;
  skillDrawerOpen = false;
  clearAbilityNoticeQueue();
  detachFullscreenListener();
  gameAudio.setBgmScene("match");
  gameAudio.unlock();
  gameAudio.preloadMatch();
  gameAudio.play("shuffle");
  const requestToken = ++characterLoadToken;
  characterLoadInFlight = true;
  root.querySelectorAll<HTMLButtonElement>("[data-invite-character], [data-profile-start]").forEach((button) => { button.disabled = true; });
  try {
    const metadata = getCharacterMetadata(characterId);
    if (!metadata) throw new Error("所选对手不可用。");
    const defeated = defeatedCharacterIdsByFirstDefeat(save.defeats).includes(metadata.id);
    if (!defeated && !isCharacterUnlocked(metadata, save.defeats)) throw new Error("该角色尚未解锁。");
    const character = await loadCharacter(metadata.id);
    if (requestToken !== characterLoadToken) return;
    root.innerHTML = `<main class="loading-shell"><span class="mark">✦</span><p>正在布置牌桌……</p></main>`;
    currentCharacter = character;
    selectedCharacterId = character.id;
    lastAction = null;
    lastDomainEvent = null;
    const match = createMatch(secureSeed(), {
      opponentId: character.id,
      aiProfile: character.ai,
      unlockedPlayerSkillIds: unlockedPlayerSkillIdsForDefeats(save.defeats),
      selectedSkillTags: save.profile.selectedSkillTags,
      talentIds: unlockedTalentIdsForDefeats(save.defeats),
      opponentAiSkills: character.aiSkills
    });
    await resumeMatch(match, character);
    enqueueAbilityNotices(abilityTriggerNotice(match.history, character.name, match));
    presentOpeningMatchAudio(gameAudio, match);
  } catch (error) {
    if (error instanceof Error && /尚未解锁|已经败北/.test(error.message)) {
      const status = root.querySelector<HTMLParagraphElement>("#lobby-status");
      if (status) status.textContent = error.message;
    } else renderError(error);
  } finally { if (requestToken === characterLoadToken) characterLoadInFlight = false; }
}
function initiallyVisibleCharacterArt(character: CharacterDefinition, state: MatchState): string {
  if (state.view !== "match-summary") return tablePortrait(state, character);
  if (state.outcome?.winner === "player") return character.assets.defeatedSummary;
  if (state.outcome?.reason === "escaped") return character.assets.conflicted;
  return character.assets.relaxed;
}
async function prepareMatchResources(character: CharacterDefinition, state: MatchState): Promise<void> {
  const plan = characterResourcePlan(character, {
    visibleArt: [initiallyVisibleCharacterArt(character, state)],
    includeTableBase: state.view === "table"
  });
  const visible = resourceLoader.enqueue(plan.visible, "visible");
  void resourceLoader.enqueue(plan.display, "display");
  void resourceLoader.enqueue(plan.background, "background");
  await visible;
}
async function resumeMatch(match: MatchState, loadedCharacter?: CharacterDefinition): Promise<void> {
  clearAiSchedule();
  gameAudio.setBgmScene("match");
  currentCharacter = loadedCharacter ?? await loadCharacter(match.opponentId);
  gameAudio.preloadMatch();
  await prepareMatchResources(currentCharacter, match);
  selectedCharacterId = currentCharacter.id;
  autosave = createAutosaveController(repository, save, match);
  const state = autosave.getState();
  if (state.view === "match-summary") renderSummary(state);
  else {
    renderMatch(state);
    const triggerPreview = state.round.phase === "roulette-reaction" || state.round.phase === "roulette-trigger"
      ? previewPendingTrigger(state)
      : null;
    if (triggerPreview) enqueueAbilityNotices(pendingTriggerAbilityNotices(triggerPreview, currentCharacter.name));
    syncMatchAudioState(gameAudio, state);
    if (legal(state, { type: "OPEN_SKILL_DRAW" })) offerTutorial("skill-draw-available");
    scheduleAiTurn(state);
  }
}
function dispatch(action: Action): void { if (!autosave) return; const before = autosave.getState(); const after = autosave.dispatch(action); if (after === before) return; lastAction = action; lastDomainEvent = after.history.at(-1)?.type ?? null; if (after.scene === "match" && after.view === "match-summary") renderSummary(after); else if (after.scene === "match") renderMatch(after); presentDelta(before, after); presentMatchAudio(gameAudio, before, after); presentMatchHaptics(before, after, !save.settings.reducedMotion); scheduleAiTurn(after); }

function renderMatch(state: MatchState): void {
  const character = currentCharacter;
  const observation = buildObservation(state, "player");
  const reveal = state.round.phase !== "turns";
  const comparisonPreview = previewComparisonScores(state);
  const hasFinalComparison = state.round.outcome?.comparisonScores !== undefined;
  const playerBaseScore = hasFinalComparison ? comparisonPreview.baseScores.player : handValue(state.player.hand);
  const opponentBaseScore = hasFinalComparison
    ? comparisonPreview.baseScores.opponent
    : reveal ? handValue(state.opponent.hand) : observation.opponent.value ?? "?";
  const playerScoreModifier = comparisonPreview.scores.player - comparisonPreview.baseScores.player;
  const opponentScoreModifier = comparisonPreview.scores.opponent - comparisonPreview.baseScores.opponent;
  const revealedOpponentCards = revealedOpponentCardIds(state);
  const opponentFaceUpIds = new Set(state.opponent.hand.cards.filter((_card, index) => observation.opponent.cards[index] !== null).map((card) => card.id));
  const resolvedInfoBarValue = resolveCharacterInfoBarValue(character, state);
  const markersByCardId = matchingSuitCardMarkers(character, state, resolvedInfoBarValue);
  const opponentCards = describeCards(state.opponent.hand.cards, { revealAll: reveal, faceUpCardIds: opponentFaceUpIds, suitVisibleCardIds: revealedOpponentCards, markersByCardId }).map(cardDisplayMarkup).join("");
  const playerCards = describeCards(state.player.hand.cards, { revealAll: true, markersByCardId }).map(cardDisplayMarkup).join("");
  const skills = state.playerSkills.cards.map((card, index) => {
    const skill = getPlayerSkillDefinition(card.definitionId);
    if (!skill) return "";
    if (skill.category === "passive") {
      const ttl = state.abilities.instances.find((instance) => instance.instanceId === card.instanceId)?.ttl;
      const ttlLabel = ttl ? ttl.type === "triggers" ? `剩${ttl.remaining}次` : `剩${ttl.remaining}轮` : "被动";
      return `<span class="skill-tile passive" data-skill-instance="${escapeHtml(card.instanceId)}"><span class="skill-card passive-card" aria-label="被动技能${escapeHtml(skill.name)}，${escapeHtml(ttlLabel)}"><b>${escapeHtml(skill.name)}</b><small>${escapeHtml(ttlLabel)}</small></span><button class="skill-info" type="button" data-skill-info="${escapeHtml(skill.id)}" aria-label="查看${escapeHtml(skill.name)}说明">i</button></span>`;
    }
    const action = { type: "PLAY_ABILITY" as const, instanceId: card.instanceId };
    const enabled = legal(state, action);
    const ability = getAbilityDefinition(skill.id);
    const statusBlocked = Boolean(ability && isAbilityBlockedByStatus(abilityWorld(state), card.owner, ability));
    const interaction = statusBlocked
      ? `data-skill-blocked="true" aria-disabled="true"`
      : `data-action='${JSON.stringify(action)}' ${enabled ? "" : "disabled"}`;
    return `<span class="skill-tile ${enabled ? "" : "is-disabled"}" data-skill-instance="${escapeHtml(card.instanceId)}" style="--skill-index:${index}"><button class="skill-card" data-skill-id="${escapeHtml(skill.id)}" ${interaction} aria-label="${statusBlocked ? "技能被禁用：" : "使用"}${escapeHtml(skill.name)}"><b>${escapeHtml(skill.name)}</b><small>主动</small></button><button class="skill-info" type="button" data-skill-info="${escapeHtml(skill.id)}" aria-label="查看${escapeHtml(skill.name)}说明">i</button></span>`;
  }).join("");
  const totalSkills = state.playerSkills.cards.length;
  const advice = state.playerSkills.advice ? `<div class="skill-advice" aria-live="polite">猎手直觉：建议 ${state.playerSkills.advice === "hit" ? "Hit 要牌" : "Stand 停牌"}</div>` : "";
  let controls: string;
  if (state.round.phase === "round-reveal") {
    controls = actionButton("确认结果", { type: "ACK_ROUND_RESULT" }, state, "primary-button");
  } else if (state.round.phase === "roulette-reaction" || state.round.phase === "roulette-trigger") {
    controls = actionButton(state.round.outcome?.penaltyTarget === "opponent" ? "静观好戏" : "扣下扳机", { type: "TRIGGER_ROULETTE" }, state, "primary-button");
  } else if (state.round.phase === "roulette-result") {
    controls = actionButton(state.status === "finished" ? "查看结局" : "下一轮", { type: "ACK_TRIGGER_RESULT" }, state, "primary-button");
  } else if (state.round.phase === "round-end") {
    controls = actionButton("下一轮", { type: "CONTINUE_ROUND" }, state, "primary-button");
  } else if (state.round.currentActor === "opponent") {
    controls = `<div class="ai-wait" id="ai-wait" role="status" aria-live="polite" data-step="watching">${character.name} 正在观察牌面……</div>`;
  } else {
    const drawAction = { type: "OPEN_SKILL_DRAW" as const };
    controls = `<div class="table-action-controls">${actionButton("Hit 要牌", { type: "PLAYER_HIT" }, state, "primary-button")}${actionButton("Stand 停牌", { type: "PLAYER_STAND" }, state)}<button type="button" class="draw-skill-button" data-action='${JSON.stringify(drawAction)}' ${legal(state, drawAction) ? "" : "disabled"} aria-label="抽取技能，剩余 ${state.playerSkills.drawCount} 次"><span class="draw-skill-icon" aria-hidden="true"><i></i><i></i><i></i></span><span class="draw-skill-badge" aria-hidden="true">${state.playerSkills.drawCount}</span></button></div>`;
  }
  const dialogue = currentDialogue(state);
  const key = dialogueKey(state);
  const shouldType = key !== lastDialogueKey;
  const dialogueMarkup = shouldType ? "" : escapeHtml(dialogue);
  const staffProp = state.round.phase === "roulette-trigger" && state.round.outcome?.penaltyTarget === "opponent"
    ? `<img class="trigger-prop" style="--revolver-top:${character.revolverPlacement.top}px;--revolver-left:${character.revolverPlacement.left}px;--revolver-mobile-top:${character.revolverPlacement.mobileTop}px;--revolver-mobile-left:${character.revolverPlacement.mobileLeft}px" src="${character.assets.staffRevolver}" alt="工作人员用 7mm 左轮对准 ${character.name} 的太阳穴" />` : "";
  const penaltyPreview = state.round.phase === "round-reveal" ? previewPendingTrigger(state) : null;
  const notice = state.round.phase === "round-reveal" ? roundResultText(state, character.name, penaltyPreview?.cancelled ?? false) : "";
  const bustLimitActor = state.round.currentActor ?? "player";
  const bustLimit = getActiveBustLimit(state, bustLimitActor);
  const gunStatuses = `<section class="roulette-status" aria-label="轮盘弹巢状态">${gunStatusMarkup(character.name, state.roulette.opponent.bullets, state.roulette.opponent.capacity)}${gunStatusMarkup("策展人", state.roulette.player.bullets, state.roulette.player.capacity)}</section>`;
  const shoeRemaining = Math.max(0, state.shoe.cards.length - state.shoe.cursor);
  const nextShoeCard = state.shoe.cards[state.shoe.cursor];
  const nextShoeSuitVisible = Boolean(nextShoeCard && revealedDrawPileSuitCardIds(state).has(nextShoeCard.id));
  const nextShoeRankVisible = Boolean(nextShoeCard && revealedDrawPileRankCardIds(state).has(nextShoeCard.id));
  const shoeCard = nextShoeCard
    ? cardDisplayMarkup(describeCard(nextShoeCard, { surface: "back", showRank: nextShoeRankVisible, showSuit: nextShoeSuitVisible, variant: "compact" }))
    : `<span class="shoe-status-empty" aria-hidden="true">—</span>`;
  const shoeKnowledge = nextShoeCard ? `下一张牌点数${nextShoeRankVisible ? `为${cardRank(nextShoeCard)}` : "未知"}，花色${nextShoeSuitVisible ? `为${suitPresentation(cardSuit(nextShoeCard)).label}` : "未知"}` : "没有下一张牌";
  const shoeStatus = `<section class="shoe-status" aria-label="牌库：${shoeKnowledge}，剩余 ${shoeRemaining} 张"><span class="shoe-status-label">牌库</span><span class="shoe-status-next"><span class="shoe-status-next-label">next：</span>${shoeCard}</span><button class="shoe-info-button" type="button" data-shoe-info aria-label="查看牌库说明">i</button></section>`;
  const shoeInfoDialog = `<dialog id="shoe-info-dialog" class="modal shoe-info-modal" aria-labelledby="shoe-info-title"><button class="modal-close" type="button" data-shoe-info-close aria-label="关闭牌库说明">×</button><p class="eyebrow">牌桌 // 公共牌堆</p><h2 id="shoe-info-title">牌库</h2><p class="shoe-info-copy">UI中的next指的是下一次hit后发出的牌，你可以用各种手段尝试揭开它的面纱。<strong>牌堆总大小</strong>为52张扑克牌（即不带大小王的一副扑克牌）。开局时洗匀整副牌，此后每轮开始前，在牌堆剩余少于 12 张时，从弃牌堆回收所有牌，并重新洗匀。</p></dialog>`;
  const infoBar = characterInfoBarMarkup(character, resolvedInfoBarValue);
  const skillDrawerMarkup = `<aside class="skill-sidebar ${skillDrawerOpen ? "is-open" : ""}" aria-label="技能抽屉"><button class="skill-drawer-toggle" type="button" aria-expanded="${skillDrawerOpen}" aria-label="${skillDrawerOpen ? "收起" : "展开"}技能抽屉，共 ${totalSkills} 张"><span class="skill-drawer-arrow" aria-hidden="true">${skillDrawerOpen ? ">" : "<"}</span><span class="skill-drawer-badge"${skillDrawerOpen ? " hidden" : ""}>${totalSkills}</span></button><div class="skill-drawer-content">${skills || "<span class='empty-skills'>暂无技能卡</span>"}</div></aside>`;
  const drawOffer = state.playerSkills.drawOffer;
  const drawCards = drawOffer?.candidateDefinitionIds.map((id) => {
    const skill = getPlayerSkillDefinition(id);
    if (!skill) return "";
    const action = { type: "SELECT_SKILL_DRAW" as const, definitionId: id };
    return `<span class="skill-draw-tile"><button type="button" class="skill-draw-card" data-action='${JSON.stringify(action)}'><span>${skill.category === "active" ? "主动" : "被动"}</span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(SKILL_TAG_METADATA[skill.primaryDomain].label)}</small></button><button class="skill-info draw-skill-info" type="button" data-skill-info="${escapeHtml(skill.id)}" aria-label="查看${escapeHtml(skill.name)}说明">i</button></span>`;
  }).join("") ?? "";
  const drawMarkup = drawOffer ? `<section class="skill-draw-backdrop is-entering"><div class="skill-draw-modal" role="dialog" aria-modal="true" aria-labelledby="skill-draw-title"><h2 id="skill-draw-title">选一张你心仪的技能卡</h2><div class="skill-draw-grid">${drawCards}</div></div></section>` : "";
  root.innerHTML = `<main class="table-shell" data-phase="${state.round.phase}"><header class="table-top"><div><span class="eyebrow">第 ${state.roundIndex + 1} 轮 // ${phaseLabel(state.round.phase)}</span><h1>命运牌桌</h1></div><div class="table-actions"><div class="table-action-row"><button class="icon-button fullscreen-button" type="button" data-fullscreen aria-label="进入全屏">⛶</button><button class="icon-button" data-action='${JSON.stringify({ type: "ESCAPE_MATCH" })}' ${legal(state, { type: "ESCAPE_MATCH" }) ? "" : "disabled"} aria-label="离开牌桌">×</button></div>${gunStatuses}${shoeStatus}${infoBar}</div></header><section class="opponent-zone"><div class="character-strip"><img class="character-portrait scaled-character-art portrait-${portraitState(state)}" style="--character-art-scale:${character.portraitScales.table}" src="${tablePortrait(state, character)}" alt="${portraitAlt(state, character)}" />${staffProp}<div><span class="eyebrow">${character.name} // ${character.tier}级</span><p class="dialogue">“<span id="dialogue-text" data-typing="false">${dialogueMarkup}</span>”</p></div></div><div class="hand-row"><span class="hand-label">${character.name} ${displayedHandValueMarkup(opponentBaseScore, opponentScoreModifier)}</span><div class="cards">${opponentCards}</div></div></section><div class="table-notice-row"><output class="bust-limit-indicator" aria-label="当前爆牌上限：${bustLimit}" data-actor="${bustLimitActor}"><span>爆牌上限</span><strong>${bustLimit}</strong></output><section class="round-notice"><div id="presentation" class="presentation" data-default="${escapeHtml(notice)}" role="status" aria-live="polite">${escapeHtml(notice)}</div></section></div><section class="player-zone"><div class="player-layout"><div class="player-main"><div class="hand-row"><span class="hand-label">策展人 ${displayedHandValueMarkup(playerBaseScore, playerScoreModifier)}</span><div class="cards">${playerCards}</div></div>${advice}</div></div><div class="controls action-dock">${controls}</div></section><dialog id="skill-info-dialog" class="modal skill-info-modal" aria-labelledby="skill-info-title"><button class="modal-close" type="button" data-skill-close aria-label="关闭技能说明">×</button><p class="eyebrow" id="skill-info-kind"></p><details class="profile-ability"><summary><strong id="skill-info-title"></strong><span>：</span><span id="skill-info-description"></span></summary><p id="skill-info-lore"></p></details><p id="skill-info-usage"></p><p class="status-line" id="skill-info-status"></p></dialog>${character.infoBar ? `<dialog id="ai-info-dialog" class="modal ai-info-modal" aria-labelledby="ai-info-title"><button class="modal-close" type="button" data-ai-info-close aria-label="关闭机制信息说明">×</button><p class="eyebrow">${escapeHtml(character.name)} // 机制信息</p><h2 id="ai-info-title">${escapeHtml(character.infoBar.label)}</h2><div class="ai-info-current"><span>当前值</span><output aria-label="当前值：${escapeHtml(infoBarValueText(resolvedInfoBarValue, character.infoBar.format))}">${infoBarValueMarkup(resolvedInfoBarValue, character.infoBar.format)}</output></div><p>${escapeHtml(character.infoBar.description)}</p></dialog>` : ""}${devHud(state)}</main>${skillDrawerMarkup}${drawMarkup}`;
  root.querySelector("main")?.insertAdjacentHTML("beforeend", shoeInfoDialog);
  wireActions(root, requestDispatch); root.querySelector<HTMLButtonElement>("[data-copy-debug]")?.addEventListener("click", () => { const text = root.querySelector<HTMLTextAreaElement>("#debug-json")?.value ?? ""; void navigator.clipboard?.writeText(text); });
  root.querySelectorAll<HTMLButtonElement>("[data-skill-blocked]").forEach((button) => button.addEventListener("click", () => enqueueNotification("技能被禁用")));
  attachFullscreenListener(); syncFullscreenButton(); syncAbilityNoticePosition();
  root.querySelector<HTMLButtonElement>("[data-fullscreen]")?.addEventListener("click", toggleFullscreen);
  const skillDrawer = root.querySelector<HTMLElement>(".skill-sidebar");
  const skillDrawerToggle = root.querySelector<HTMLButtonElement>(".skill-drawer-toggle");
  skillDrawerToggle?.addEventListener("click", () => {
    skillDrawerOpen = !skillDrawerOpen;
    skillDrawer?.classList.toggle("is-open", skillDrawerOpen);
    const arrow = skillDrawerToggle.querySelector<HTMLElement>(".skill-drawer-arrow");
    const badge = skillDrawerToggle.querySelector<HTMLElement>(".skill-drawer-badge");
    if (arrow) arrow.textContent = skillDrawerOpen ? ">" : "<";
    if (badge) badge.hidden = skillDrawerOpen;
    skillDrawerToggle.setAttribute("aria-expanded", String(skillDrawerOpen));
    skillDrawerToggle.setAttribute("aria-label", `${skillDrawerOpen ? "收起" : "展开"}技能抽屉，共 ${totalSkills} 张`);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-skill-info]").forEach((button) => button.addEventListener("click", () => {
    const skill = getPlayerSkillDefinition(button.dataset.skillInfo ?? "");
    const dialog = root.querySelector<HTMLDialogElement>("#skill-info-dialog");
    if (!skill || !dialog) return;
    const kind = root.querySelector("#skill-info-kind");
    const title = root.querySelector("#skill-info-title");
    const description = root.querySelector("#skill-info-description");
    const lore = root.querySelector("#skill-info-lore");
    const usage = root.querySelector("#skill-info-usage");
    const status = root.querySelector("#skill-info-status");
    if (kind) kind.textContent = skill.category === "active" ? "主动技能" : "被动技能";
    if (title) title.textContent = skill.name;
    if (description) description.textContent = skill.description;
    if (lore) lore.textContent = skill.profileLore;
    if (usage) usage.textContent = skill.usage;
    if (status) {
      const instanceTtl = state.abilities.instances.find((instance) => instance.definitionId === skill.id && instance.owner === "player")?.ttl;
      const ttl = instanceTtl ?? (skill.ttl ? { type: skill.ttl.type, remaining: skill.ttl.amount } : undefined);
      const ttlText = ttl ? ttl.type === "triggers" ? `，剩余 ${ttl.remaining} 次触发` : `，剩余 ${ttl.remaining} 轮` : "";
      status.textContent = skill.category === "active" ? "主动技能牌：使用后消耗此实例" : `被动技能牌：占用牌库位置并持续生效${ttlText}`;
    }
    const details = dialog.querySelector<HTMLDetailsElement>(".profile-ability");
    if (details) details.open = false;
    dialog.showModal();
  }));
  root.querySelector<HTMLButtonElement>("[data-skill-close]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#skill-info-dialog")?.close());
  root.querySelector<HTMLButtonElement>("[data-shoe-info]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#shoe-info-dialog")?.showModal());
  root.querySelector<HTMLButtonElement>("[data-shoe-info-close]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#shoe-info-dialog")?.close());
  root.querySelector<HTMLButtonElement>("[data-ai-info]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#ai-info-dialog")?.showModal());
  root.querySelector<HTMLButtonElement>("[data-ai-info-close]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#ai-info-dialog")?.close());
  if (shouldType) { lastDialogueKey = key; startTypewriter(dialogue); }
}
function devHud(state: MatchState): string {
  if (!new URLSearchParams(window.location.search).has("debug")) return "";
  const ai = state.lastAiDecision;
  const text = JSON.stringify({ gameVersion: save.gameVersion, seed: state.seed, round: state.roundIndex, phase: state.round.phase, currentActor: state.round.currentActor, relevantMatchState: state, recentActionsOrEvents: state.history.slice(-8), lastAction, lastDomainEvent, aiDecision: ai }, null, 2);
  const profile = state.aiProfile;
  return `<details class="dev-hud" open><summary>开发者面板</summary><dl><dt>种子</dt><dd>${state.seed}</dd><dt>轮次 / 阶段</dt><dd>${state.roundIndex} / ${phaseLabel(state.round.phase)}</dd><dt>当前行动者</dt><dd>${state.round.currentActor === "player" ? "玩家" : state.round.currentActor === "opponent" ? currentCharacter.name : "—"}</dd><dt>牌库剩余</dt><dd>${state.shoe.cards.length - state.shoe.cursor}</dd><dt>玩家真实手牌</dt><dd>${state.player.hand.cards.map(cardLabel).join(" ")}</dd><dt>对手真实手牌</dt><dd>${state.opponent.hand.cards.map(cardLabel).join(" ")}</dd><dt>玩家 / 对手子弹</dt><dd>${state.roulette.player.bullets} / ${state.roulette.opponent.bullets}</dd><dt>AI 参数 P / A / B / C</dt><dd>${profile.P} / ${profile.A} / ${profile.B} / ${profile.C}</dd><dt>Rmatch / Rplay</dt><dd>${state.aiNoise.match.toFixed(3)} / ${state.aiNoise.play.toFixed(3)}</dd><dt>技能阈值 bySkill</dt><dd>${ai?.bySkill ?? "—"}</dd><dt>上次手牌值 / 阈值 T</dt><dd>${ai ? `${ai.handValue} / ${ai.threshold.toFixed(3)}` : "—"}</dd><dt>上次子弹差 Bp - Ba</dt><dd>${ai?.bulletDifference ?? "—"}</dd><dt>对手上次决策</dt><dd>${decisionLabel(ai?.action)}</dd><dt>上次行动</dt><dd>${lastAction ? ACTION_LABELS[lastAction.type] : "—"}</dd><dt>上次领域事件</dt><dd>${lastDomainEvent ? EVENT_LABELS[lastDomainEvent] : "—"}</dd></dl><button class="quiet-button" data-copy-debug>复制调试状态</button><textarea id="debug-json" readonly hidden>${escapeHtml(text)}</textarea></details>`;
}
function renderSummary(state: MatchState): void {
  const winner = state.outcome?.winner;
  const escaped = state.outcome?.reason === "escaped";
  discardActiveTutorial();
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer); gameAudio.stopHeartbeat(); clearAbilityNoticeQueue(); detachFullscreenListener(); lastDialogueKey = null;
  const playerWon = winner === "player";
  const image = playerWon ? currentCharacter.assets.defeatedSummary : escaped ? currentCharacter.assets.conflicted : currentCharacter.assets.relaxed;
  const imageAlt = playerWon ? `${currentCharacter.name} 全身无力地瘫坐在椅子上` : currentCharacter.name;
  const summaryCopy = escaped ? currentCharacter.matchSummary.escaped : playerWon ? currentCharacter.matchSummary.playerVictory : currentCharacter.matchSummary.playerDefeat;
  const alreadyUnlocked = new Set(unlockedPlayerSkillIdsForDefeats(save.defeats));
  const newlyUnlocked = playerWon && !escaped
    ? playerSkillsUnlockedForVictory(state.opponentId, winner, escaped).filter((id) => !alreadyUnlocked.has(id))
    : [];
  const newlyUnlockedCharacters = playerWon && !escaped ? newlyUnlockedForDefeat(save.defeats, state.opponentId) : [];
  const characterUnlockPanel = newlyUnlockedCharacters.length
    ? `<section class="unlock-panel character-unlock-panel" aria-live="polite"><p class="eyebrow">新角色已解锁</p>${newlyUnlockedCharacters.map((id) => { const character = getCharacterMetadata(id); if (!character) return ""; return `<div class="unlock-skill"><strong>${escapeHtml(character.name)}</strong><span>${escapeHtml(character.tier)}级与会者 · 已可在候场宾客中邀请</span><small>${escapeHtml(unlockConditionLabel(character.unlock))}</small></div>`; }).join("")}</section>`
    : "";
  const unlockPanel = newlyUnlocked.length
    ? `<section class="unlock-panel" aria-live="polite"><p class="eyebrow">新技能已解锁</p>${newlyUnlocked.map((id) => { const skill = getPlayerSkillDefinition(id); if (!skill) return ""; return `<div class="unlock-skill"><strong>${escapeHtml(skill.name)}</strong><span>${skill.category === "active" ? "主动" : "被动"} · ${escapeHtml(skill.description)}</span><small>${escapeHtml(skill.unlock?.label ?? "胜利奖励")}</small></div>`; }).join("")}</section>`
    : "";
  const summaryButton = (label: string, destination: "trophy" | "rewind" | "lobby", className: string): string => {
    const action: Action = { type: "ACK_MATCH_RESULT" };
    return `<button class="${className}" data-action='${JSON.stringify(action)}' data-summary-action="${destination}" ${legal(state, action) ? "" : "disabled"}>${label}</button>`;
  };
  const summaryActions = escaped
    ? summaryButton("返回大厅", "lobby", "primary-button")
    : playerWon
      ? `<div class="controls action-dock summary-actions">${summaryButton("前往战利品陈列室", "trophy", "primary-button")}${summaryButton("返回大厅", "lobby", "secondary-button")}</div>`
      : `<div class="controls action-dock summary-actions">${summaryButton("回溯时空（重开一局）", "rewind", "primary-button")}${summaryButton("返回大厅", "lobby", "secondary-button")}</div>`;
  root.innerHTML = `<main class="summary-shell"><p class="eyebrow">终局</p><img class="summary-character" src="${image}" alt="${imageAlt}" /><p class="kicker">${escaped ? "策展人提前离席" : playerWon ? "死亡确认" : "干员拿下了这一局"}</p><h1>${escaped ? "已离席" : playerWon ? "策展人胜利" : "策展人落败"}</h1><p class="summary-copy">${escapeHtml(summaryCopy)}</p>${characterUnlockPanel}${unlockPanel}${summaryActions}</main>`;
  let summaryActionInFlight = false;
  root.querySelectorAll<HTMLButtonElement>("[data-summary-action]").forEach((button) => button.addEventListener("click", () => {
    if (summaryActionInFlight) return;
    summaryActionInFlight = true;
    root.querySelectorAll<HTMLButtonElement>("[data-summary-action]").forEach((candidate) => { candidate.disabled = true; });
    const destination = button.dataset.summaryAction;
    requestDispatch({ type: "ACK_MATCH_RESULT" });
    void completeMatch(destination === "trophy" || destination === "rewind" ? destination : "lobby");
  }));
}
async function completeMatch(destination: "trophy" | "rewind" | "lobby"): Promise<void> {
  if (!autosave) return;
  await autosave.flush();
  save = autosave.getSave();
  const match = autosave.getState();
  const winner = match.outcome?.winner ?? null;
  const escaped = match.outcome?.reason === "escaped";
  const opponentId = match.opponentId;
  autosave = null;
  if (destination === "trophy" && winner === "player" && !escaped) renderTrophyRoom();
  else if (destination === "rewind" && winner !== "player" && !escaped) await startMatch(opponentId);
  else renderLobby();
}
function renderError(error: unknown): void {
  discardActiveTutorial();
  clearAiSchedule();
  clearAbilityNoticeQueue();
  detachFullscreenListener();
  const incompatibleLongTerm = error instanceof SaveValidationError && error.kind === "long-term";
  const incompatibleRuntime = error instanceof SaveValidationError && error.kind === "runtime";
  const invalidLongTermInput = incompatibleLongTerm ? error.input : undefined;
  const migrationAvailable = incompatibleLongTerm && canMigrateLongTermSave(invalidLongTermInput);
  const action = incompatibleLongTerm
    ? `<div class="error-actions"><button class="danger-button" data-reset-invalid-save>删除长期存档并重新开始</button><button class="primary-button" data-migrate-invalid-save ${migrationAvailable ? "" : "disabled"}>迁移长期存档</button><button class="secondary-button" data-export-invalid-save ${invalidLongTermInput === undefined ? "disabled" : ""}>导出原始存档</button><button class="secondary-button" data-retry>重新检查</button></div><p class="status-line" data-error-status></p>`
    : incompatibleRuntime
      ? `<button class="primary-button" data-reset-invalid-runtime>舍弃未完成牌局</button><button class="secondary-button" data-retry>重新检查</button>`
    : `<button class="primary-button" data-retry>重试</button>`;
  const message = incompatibleLongTerm
    ? migrationAvailable
      ? "当前版本不兼容这份长期存档。你可以迁移后继续，也可以先导出原件留底；只有手动删除并确认后，才会清除战绩与解锁。"
      : "当前版本不兼容这份长期存档，且没有完整迁移路径。你仍可导出原件留底，或手动删除并确认清除战绩与解锁。"
    : incompatibleRuntime
      ? "未完成牌局与当前版本不兼容。舍弃它不会影响长期战绩与解锁。"
      : uiError(error, "游戏无法启动。");
  const heading = incompatibleLongTerm ? "需要清理<br><em>长期存档</em>" : incompatibleRuntime ? "无法恢复<br><em>未完成牌局</em>" : "出现了<br><em>意外回合</em>";
  root.innerHTML = `<main class="error-shell"><p class="kicker">牌桌暂时离线</p><h1>${heading}</h1><p>${escapeHtml(message)}</p>${action}</main>`;
  root.querySelector("[data-retry]")?.addEventListener("click", () => void boot());
  root.querySelector("[data-reset-invalid-save]")?.addEventListener("click", () => {
    if (!confirmResetCurrentData()) return;
    void repository.deleteLongTerm().then(() => boot()).catch(renderError);
  });
  root.querySelector("[data-migrate-invalid-save]")?.addEventListener("click", () => {
    const status = root.querySelector<HTMLElement>("[data-error-status]");
    void repository.saveLongTerm(migrateLongTermSave(invalidLongTermInput)).then(() => boot()).catch((migrationError: unknown) => {
      if (status) status.textContent = uiError(migrationError, "迁移失败，原存档未被覆盖。");
    });
  });
  root.querySelector("[data-export-invalid-save]")?.addEventListener("click", () => {
    const status = root.querySelector<HTMLElement>("[data-error-status]");
    void downloadRawSave(invalidLongTermInput).then((method) => {
      if (status) status.textContent = method === "file-system-access" ? "原始存档已写入。" : "已开始下载原始存档。";
    }).catch((exportError: unknown) => { if (status) status.textContent = uiError(exportError, "原始存档导出失败。"); });
  });
  root.querySelector("[data-reset-invalid-runtime]")?.addEventListener("click", () => void repository.deleteRuntime().then(() => boot()).catch(renderError));
}
async function boot(): Promise<void> {
  clearAiSchedule();
  root.innerHTML = `<main class="loading-shell"><span class="mark">✦</span><p>正在洗牌……</p></main>`;
  try {
    save = await bootLoad(repository);
    let activeMatch: MatchState | null;
    try { activeMatch = await restoreActiveMatch(repository); }
    catch (error) {
      if (!(error instanceof SaveValidationError) || error.kind !== "runtime" || !window.confirm(RESET_RUNTIME_CONFIRM_MESSAGE)) throw error;
      await repository.deleteRuntime();
      activeMatch = null;
    }
    document.body.classList.toggle("reduced-motion", save.settings.reducedMotion);
    gameAudio.configure(save.settings.soundEnabled);
    gameAudio.preloadLobby();
    const unlockAudio = () => { gameAudio.unlock(); const state = autosave?.getState(); if (state) syncMatchAudioState(gameAudio, state); };
    document.addEventListener("pointerdown", unlockAudio, { capture: true, once: true });
    document.addEventListener("keydown", unlockAudio, { capture: true, once: true });
    document.addEventListener("visibilitychange", () => { if (document.hidden) gameAudio.pauseBgm(); else gameAudio.restoreBgm(); });
    void requestPersistentStorage();
    if (activeMatch) await resumeMatch(activeMatch); else renderLobby();
  } catch (error) { renderError(error); }
}
void boot();
