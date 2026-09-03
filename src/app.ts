import "./styles.css";
import { handValue } from "./core/blackjack/hand";
import type { Card } from "./core/blackjack/types";
import type { MatchHistoryRecord } from "./core/match/history";
import { buildObservation } from "./core/ai/observation";
import { abilityWorld, createMatch, getLegalActions } from "./core/match/reducer";
import type { Action, GameEvent, MatchState } from "./core/match/types";
import { SeededRng } from "./core/rng/seeded";
import { getSkillDefinition, SKILL_DEFINITIONS, isActiveSkill, isPassiveSkill } from "./core/skills/definitions";
import { skillsUnlockedForVictory, validateLoadout } from "./core/skills/skills";
import { getAbilityDefinition } from "./core/abilities/registry";
import { isAbilityBlockedByStatus } from "./core/abilities/engine";
import { chooseDialogue } from "./dialogue/types";
import { resolveDialogueState } from "./dialogue/state";
import { CHARACTER_CATALOG, DEFAULT_CHARACTER_ID, defeatedCharacterIdsByFirstVictory, getCharacterMetadata, isCharacterUnlocked, loadCharacter, newlyUnlockedForVictory, type CharacterDefinition, type CharacterTrophyGallery, type TrophyCloseupPoint, type CharacterUnlockCondition } from "./content/characters";
import { bootLoad, resetSave } from "./persistence/boot";
import { createAutosaveController, type AutosaveController } from "./persistence/autosave";
import { downloadSave, importSave, openSaveWithFileSystemAccess } from "./persistence/json";
import { IndexedDbSaveRepository } from "./persistence/dexie-repository";
import { requestPersistentStorage } from "./persistence/storage";
import { SaveValidationError, type SaveFile } from "./persistence/schema";
import { getAiTurnDelayMs } from "./presentation/ai-timing";
import { abilityTriggerNotice } from "./presentation/ability-notices";
import { presentMatchHaptics } from "./presentation/haptics";
import { gameAudio } from "./audio/game-audio";
import { presentMatchAudio, presentOpeningMatchAudio, syncMatchAudioState } from "./audio/match-audio";
import { downloadResourcePack, ResourcePackDownloadError, type ResourcePackProgress } from "./resources/resource-pack";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("App root is missing");
const root: HTMLDivElement = appRoot;
const repository = new IndexedDbSaveRepository();
let save: SaveFile;
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
let skillGainQueue: string[] = [];
let skillGainTimer: number | undefined;
let fullscreenChangeAttached = false;
type LobbyLayer = "menu" | "characters";
let lobbyLayer: LobbyLayer = "menu";
let guestSelectionIds: string[] = [];
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const RESET_CONFIRM_MESSAGE = "清理当前数据将删除战绩、历史、角色与技能解锁和未完成对局，确定继续吗？";

function secureSeed(): string {
  const bytes = new Uint32Array(4);
  if (!globalThis.crypto?.getRandomValues) throw new Error("当前环境没有可用的安全随机数，无法安全开始对局。");
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(8, "0")).join("");
}
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character); }
function uiError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (/save|JSON|schema|match state|cursor|future/i.test(message)) return "存档无效：请检查文件格式与版本。";
  return fallback;
}
function cardLabel(card: Card): string { return `${card.rank}${card.suit === "hearts" ? "♥" : card.suit === "diamonds" ? "♦" : card.suit === "clubs" ? "♣" : "♠"}`; }
function cardMarkup(card: Card | null, hidden = false, revealedSuit?: Card["suit"]): string {
  if (hidden || !card) {
    if (hidden && revealedSuit) {
      const symbol = revealedSuit === "hearts" ? "♥" : revealedSuit === "diamonds" ? "♦" : revealedSuit === "clubs" ? "♣" : "♠";
      const label = revealedSuit === "hearts" ? "红桃" : revealedSuit === "diamonds" ? "方块" : revealedSuit === "clubs" ? "梅花" : "黑桃";
      return `<span class="card card-back revealed-suit ${revealedSuit === "hearts" || revealedSuit === "diamonds" ? "red" : "black"}"${card ? ` data-card-origin="${card.origin}"` : ""} aria-label="暗牌，已识破花色${label}"><i>${symbol}</i></span>`;
    }
    return `<span class="card card-back"${card ? ` data-card-origin="${card.origin}"` : ""} aria-label="暗牌"><i>✦</i></span>`;
  }
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return `<span class="card ${red ? "red" : ""}" data-card-origin="${card.origin}" aria-label="${cardLabel(card)}"><b>${escapeHtml(card.rank)}</b><em>${card.suit === "hearts" ? "♥" : card.suit === "diamonds" ? "♦" : card.suit === "clubs" ? "♣" : "♠"}</em></span>`;
}
function revealedOpponentSuit(state: MatchState): Card["suit"] | undefined {
  let start = -1;
  state.history.forEach((event, index) => { if (event.type === "ROUND_STARTED") start = index; });
  const event = [...state.history.slice(start + 1)].reverse().find((entry) => entry.type === "CARD_SUIT_REVEALED" && entry.viewer === "player" && entry.target === "opponent" && entry.cardIndex === 1);
  return event?.type === "CARD_SUIT_REVEALED" ? event.suit : undefined;
}
function gunStatusMarkup(label: string, bullets: number, capacity: number): string {
  const chambers = Array.from({ length: capacity }, (_, index) => `<i class="${index < bullets ? "loaded" : ""}" aria-hidden="true"></i>`).join("");
  return `<div class="gun-status-row" aria-label="${escapeHtml(label)}：${capacity} 个弹巢，已装填 ${bullets} 发"><span class="gun-icon"><img src="/assets/characters/staff-revolver-7mm.png" alt="" aria-hidden="true"></span><span class="gun-name">${escapeHtml(label)}</span><span class="gun-chambers">${chambers}</span></div>`;
}
function showNextSkillGain(): void {
  if (skillGainTimer !== undefined || skillGainQueue.length === 0) return;
  const skillId = skillGainQueue.shift() ?? "";
  const announcement = document.createElement("div");
  announcement.id = "skill-gain-announcement";
  announcement.className = "skill-gain-announcement";
  announcement.setAttribute("role", "status");
  announcement.textContent = `获得技能牌：${getSkillDefinition(skillId)?.name ?? skillId}`;
  document.body.append(announcement);
  skillGainTimer = window.setTimeout(() => {
    announcement.remove(); skillGainTimer = undefined; showNextSkillGain();
  }, 1000);
}
function enqueueSkillGains(events: readonly GameEvent[]): void {
  events.filter((event): event is Extract<GameEvent, { type: "SKILL_GAINED" }> => event.type === "SKILL_GAINED").forEach((event) => skillGainQueue.push(event.skillId));
  showNextSkillGain();
}
function clearSkillGainQueue(): void {
  skillGainQueue = []; window.clearTimeout(skillGainTimer); skillGainTimer = undefined; document.querySelectorAll(".skill-gain-announcement").forEach((node) => node.remove());
}
function syncFullscreenButton(): void {
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
}
function attachFullscreenListener(): void {
  if (fullscreenChangeAttached) return;
  document.addEventListener("fullscreenchange", syncFullscreenButton); fullscreenChangeAttached = true;
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => present("无法退出全屏。")); return; }
  if (!document.documentElement.requestFullscreen) { present("当前环境不支持全屏。"); return; }
  void document.documentElement.requestFullscreen().catch(() => present("全屏请求未获允许。"));
}
const PHASE_LABELS: Readonly<Record<MatchState["round"]["phase"], string>> = {
  dealing: "发牌中", "initial-blackjack-check": "检查黑杰克", turns: "行动阶段", settlement: "结算中",
  "round-reveal": "翻牌结果", "roulette-reaction": "轮盘反应", "roulette-trigger": "准备扣扳机",
  "roulette-result": "扳机结果", reward: "奖励结算", "round-end": "等待下一轮"
};
function phaseLabel(phase: MatchState["round"]["phase"]): string { return PHASE_LABELS[phase]; }
const ACTION_LABELS: Readonly<Record<Action["type"], string>> = {
  PLAYER_HIT: "策展人 Hit 要牌", PLAYER_STAND: "策展人 Stand 停牌", AI_TURN: "对手行动一次",
  AI_HIT: "对手 Hit 要牌", OPPONENT_HIT: "对手 Hit 要牌", AI_STAND: "对手 Stand 停牌", OPPONENT_STAND: "对手 Stand 停牌",
  PLAY_ABILITY: "使用能力", TRIGGER_ROULETTE: "扣下扳机", ACK_ROUND_RESULT: "确认本轮结果",
  ACK_TRIGGER_RESULT: "确认扳机结果", CONTINUE_ROUND: "进入下一轮", ESCAPE_MATCH: "逃离对局", ACK_MATCH_RESULT: "确认最终结果"
};
const EVENT_LABELS: Readonly<Record<GameEvent["type"], string>> = {
  ABILITY_PLAYED: "使用能力", ABILITY_TRIGGERED: "能力触发", ABILITY_RESOLUTION_FAILED: "能力解析失败",
  STATUS_ADDED: "获得状态", STATUS_REMOVED: "状态移除", PENDING_EVENT_MODIFIED: "修改待结算事件", PENDING_EVENT_CANCELLED: "取消待结算事件",
  ROUND_STARTED: "本轮开始", CARD_DEALT: "发牌", INITIAL_BLACKJACK_CHECK: "检查黑杰克",
  PLAYER_HIT: "策展人 Hit 要牌", OPPONENT_HIT: "对手 Hit 要牌", PLAYER_STOOD: "策展人 Stand 停牌", OPPONENT_STOOD: "对手 Stand 停牌",
  BLACKJACK: "黑杰克", BUST: "爆牌", ROUND_RESOLVED: "本轮结算", ROUND_RESULT_ACKNOWLEDGED: "已确认本轮结果",
  BULLET_ADDED: "装填子弹", TRIGGER_PULLED: "已扣下扳机", TRIGGER_SURVIVED: "空枪幸存", TRIGGER_RESULT_ACKNOWLEDGED: "已确认扳机结果",
  PARTICIPANT_KILLED: "参与者倒下", SKILL_GAINED: "获得技能", MATCH_FINISHED: "对局结束",
  MATCH_ESCAPED: "策展人离席", MATCH_RESULT_ACKNOWLEDGED: "已确认最终结果", AI_DECISION: "对手完成决策",
  CARD_SUIT_REVEALED: "识破暗牌花色"
};
function decisionLabel(action: "hit" | "stand" | undefined): string { return action === "hit" ? "Hit 要牌" : action === "stand" ? "Stand 停牌" : "—"; }
function roundResultText(state: MatchState, opponentName: string): string {
  const outcome = state.round.outcome;
  if (!outcome) return "本轮结果待揭晓。";
  const player = handValue(state.player.hand);
  const opponent = handValue(state.opponent.hand);
  const scores = `策展人 ${player}｜${opponentName} ${opponent}`;
  if (!outcome.winner) return `本轮平局｜${scores}｜双方都没有获得惩罚。`;
  const winner = outcome.winner === "player" ? "你获胜" : `${opponentName} 获胜`;
  const reason = outcome.reason === "blackjack" ? "黑杰克" : outcome.reason === "bust" ? `${outcome.penaltyTarget === "player" ? "策展人" : opponentName} 爆牌` : "点数更接近 21";
  const bullets = outcome.bulletsAdded > 0 ? `｜为${outcome.penaltyTarget === "player" ? "策展人" : opponentName}装填 ${outcome.bulletsAdded} 发` : "";
  return `${winner}｜${scores}｜${reason}${bullets}。`;
}
function legal(state: MatchState, action: Action): boolean { return getLegalActions(state).some((candidate) => JSON.stringify(candidate) === JSON.stringify(action)); }
function actionButton(label: string, action: Action, state: MatchState, className = "secondary-button"): string { const enabled = legal(state, action); return `<button class="${className}" data-action='${JSON.stringify(action)}' ${enabled ? "" : "disabled"}>${label}</button>`; }
function historyResultLabel(record: MatchHistoryRecord): string { return record.escaped ? "策展人离席" : record.winner === "player" ? "策展人胜利" : "策展人落败"; }
function historyDate(timestamp: string): string { return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp)); }

function renderSkillList(): string {
  const unlocked = new Set(save.profile.unlockedSkillIds);
  const equipped = new Set(save.profile.equippedSkillIds);
  const activeCount = [...equipped].filter(isActiveSkill).length;
  const passiveCount = [...equipped].filter(isPassiveSkill).length;
  const cards = SKILL_DEFINITIONS.map((skill) => {
    const available = unlocked.has(skill.id);
    const checked = equipped.has(skill.id);
    const source = skill.unlock ? `解锁来源：${skill.unlock.label}` : "初始技能";
    return `<div class="loadout-skill ${available ? "" : "locked"}"><label class="loadout-checkbox"><input type="checkbox" data-equip-skill="${escapeHtml(skill.id)}" aria-label="装备${escapeHtml(skill.name)}" ${checked ? "checked" : ""} ${available ? "" : "disabled"}></label><div><details class="profile-ability"><summary><strong>${escapeHtml(skill.name)}</strong><span>：${escapeHtml(skill.description)}</span></summary><p>${escapeHtml(skill.profileLore)}</p></details><small>${skill.category === "passive" ? "被动" : "主动"} · ${escapeHtml(source)}</small></div></div>`;
  }).join("");
  return `<p class="loadout-count">已装备 ${activeCount + passiveCount} / 4　主动 ${activeCount}　被动 ${passiveCount} / 1</p><div class="loadout-list">${cards}</div><p class="status-line" id="skill-status"></p>`;
}

function refreshLoadoutCount(): void {
  const node = root.querySelector<HTMLElement>(".loadout-count");
  if (!node) return;
  const equipped = save.profile.equippedSkillIds;
  const active = equipped.filter(isActiveSkill).length;
  const passive = equipped.filter(isPassiveSkill).length;
  node.textContent = `已装备 ${equipped.length} / 4　主动 ${active}　被动 ${passive} / 1`;
}

async function updateLoadout(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const id = input.dataset.equipSkill;
  if (!id) return;
  const unlocked = new Set(save.profile.unlockedSkillIds);
  const equipped = new Set(save.profile.equippedSkillIds);
  if (!unlocked.has(id)) { input.checked = false; return; }
  if (input.checked) equipped.add(id); else equipped.delete(id);
  const ids = [...equipped];
  const status = root.querySelector<HTMLParagraphElement>("#skill-status");
  const validation = validateLoadout(save.profile.unlockedSkillIds, ids);
  if (!validation.valid) {
    input.checked = !input.checked;
    refreshLoadoutCount();
    if (status) status.textContent = validation.reason === "too-many-passives" ? "被动技能最多装备 1 个。" : validation.reason === "too-many" ? "最多装备 4 个技能。" : "只能装备已解锁技能。";
    return;
  }
  save = { ...save, profile: { ...save.profile, equippedSkillIds: [...validation.equippedSkillIds] }, updatedAt: new Date().toISOString() };
  await repository.save(save);
  refreshLoadoutCount();
  if (status) status.textContent = "技能配置已保存。";
}

function openSkillManagement(): void {
  const dialog = root.querySelector<HTMLDialogElement>("#skills");
  const content = root.querySelector<HTMLDivElement>("#skill-content");
  if (!dialog || !content) return;
  content.innerHTML = renderSkillList();
  content.querySelectorAll<HTMLInputElement>("[data-equip-skill]").forEach((input) => input.addEventListener("change", (event) => void updateLoadout(event)));
  dialog.showModal();
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
      portrait.alt = `${currentCharacter.name} 改换姿势，重新估量牌势`;
      portrait.classList.add("character-shake");
      aiPoseShakeTimer = window.setTimeout(() => portrait.classList.remove("character-shake"), 360);
    }
    const waiting = root.querySelector<HTMLElement>("#ai-wait");
    if (waiting) {
      waiting.textContent = `${currentCharacter.name} 改换姿势，重新估量……`;
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
  const latest = resolveDialogueState(state).event;
  const rng = SeededRng.fromSnapshot(state.rng.dialogue);
  for (let index = 0; index < state.history.length; index += 1) rng.next();
  return chooseDialogue(currentCharacter.dialogue, latest, rng).line ?? "牌桌正在等你下注。";
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
  enqueueSkillGains(events);
  const abilityNotice = abilityTriggerNotice(events, currentCharacter.name);
  if (abilityNotice) { present(abilityNotice, "gold", 2200); return; }
  const event = events.find((candidate) => candidate.type === "PENDING_EVENT_CANCELLED") ?? events.find((candidate) => candidate.type === "TRIGGER_PULLED") ?? events.find((candidate) => candidate.type === "BUST") ?? events.find((candidate) => candidate.type === "BLACKJACK") ?? events.find((candidate) => candidate.type === "BULLET_ADDED") ?? events.find((candidate) => candidate.type === "TRIGGER_SURVIVED");
  if (event) {
    if (event.type === "BUST") present(`${event.actor === "player" ? "策展人" : currentCharacter.name} 爆牌`, "danger");
    else if (event.type === "BLACKJACK") present("黑杰克", "gold");
    else if (event.type === "BULLET_ADDED") present(`已装填 ${event.amount} 发子弹`, "danger");
    else if (event.type === "TRIGGER_PULLED") present(event.fired ? "砰！" : "咔哒……", event.fired ? "danger" : "gold");
    else if (event.type === "TRIGGER_SURVIVED") present("空枪，暂时活下来了", "gold");
    else if (event.type === "PENDING_EVENT_CANCELLED") {
      const source = before.abilities.instances.find((instance) => instance.instanceId === event.sourceInstanceId);
      present(`${source ? getAbilityDefinition(source.definitionId)?.name ?? "能力" : "能力"}：免除本次扳机`, "gold");
    }
    return;
  }
  const played = events.find((candidate) => candidate.type === "ABILITY_PLAYED");
  if (played) { present(`已使用技能：${getSkillDefinition(played.definitionId)?.name ?? "未知技能"}`, "gold"); return; }
  if (events.some((candidate) => candidate.type === "CARD_DEALT" && candidate.actor === "player") && handValue(after.player.hand) === 21) present("21 · 自动停牌", "gold");
}
function wireActions(container: ParentNode, handler: (action: Action) => void): void { container.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((element) => element.addEventListener("click", () => handler(JSON.parse(element.dataset.action ?? "{}") as Action))); }
function requestDispatch(action: Action): void { dispatch(action); }

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
  return `<dialog id="rules" class="modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">终焉赌局 // 公开规则</p><h2>玩法说明</h2><p>目标是接近 21 点但不要爆牌。用 Hit 要牌，准备好后用 Stand 停牌。</p><p>两张牌正好 21 点是黑杰克；入场会获得技能牌，普通胜利获得 1 张，黑杰克获得 2 张。技能牌只来自本轮携带的主动技能。</p><p>败者的左轮会被装入子弹。与会者由发牌员瞄准头部；策展人的枪口朝向天花板。与会者若赢下整局，可以向策展人索取一个愿望。</p></dialog><dialog id="skills" class="modal skills-modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">策展人的牌组</p><h2>技能管理</h2><div id="skill-content"></div></dialog><dialog id="profile" class="modal profile-modal"><button class="modal-close" data-close aria-label="关闭">×</button><div id="profile-content"></div></dialog><dialog id="settings" class="modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">古堡牌桌</p><h2>设置</h2><label class="setting"><input type="checkbox" data-setting="soundEnabled" ${save.settings.soundEnabled ? "checked" : ""}> 开启声音</label><label class="setting"><input type="checkbox" data-setting="reducedMotion" ${save.settings.reducedMotion ? "checked" : ""}> 减少动态效果</label>${resourcePackControlsMarkup()}<div class="save-actions"><button class="secondary-button" data-export>导出存档</button><button class="secondary-button" data-import>导入存档</button><button class="danger-button" data-reset>清理当前数据</button><input id="save-file" type="file" accept="application/json,.json" hidden></div><p class="status-line" id="lobby-status"></p></dialog>`;
}

function randomUnit(): number {
  const bytes = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(bytes)[0] / 0x100000000;
  return Math.random();
}

function eligibleGuestIds(): string[] {
  const defeated = new Set(defeatedCharacterIdsByFirstVictory(save.history));
  const unlocked = new Set(save.profile.unlockedCharacterIds);
  return CHARACTER_CATALOG
    .filter((character) => unlocked.has(character.id) && isCharacterUnlocked(character, save.history) && !defeated.has(character.id))
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

function renderLobby(layer: LobbyLayer = "menu"): void {
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer);
  gameAudio.stopHeartbeat();
  clearSkillGainQueue();
  detachFullscreenListener();
  lastDialogueKey = null;
  autosave = null;
  lobbyLayer = layer;
  if (layer === "characters") {
    const eligible = new Set(eligibleGuestIds());
    const expectedCount = Math.min(3, eligible.size);
    if (guestSelectionIds.length !== expectedCount || guestSelectionIds.some((id) => !eligible.has(id))) guestSelectionIds = selectGuestIds();
  }
  const guestCharacters = guestSelectionIds.map((id) => getCharacterMetadata(id)).filter((character): character is NonNullable<typeof character> => Boolean(character));
  const defeatedIds = defeatedCharacterIdsByFirstVictory(save.history);
  const defeatedCharacters = defeatedIds.map((id) => getCharacterMetadata(id)).filter((character): character is NonNullable<typeof character> => Boolean(character));
  const characterCards = guestCharacters.map((character) => characterCardMarkup(character)).join("");
  const defeatedCards = defeatedCharacters.map((character) => characterCardMarkup(character, { defeated: true })).join("");
  root.innerHTML = layer === "menu"
    ? `<main class="lobby-shell lobby-menu-shell"><header class="lobby-invitation"><span>Blackjack & Roulette</span><button type="button" class="icon-button lobby-settings-button" data-open="settings" aria-label="打开设置">⚙</button></header><section class="lobby-title-block" aria-labelledby="lobby-title"><h1 id="lobby-title">绝命之夜</h1><div class="menu-subtitle"><span></span><strong>终焉赌局</strong></div><div class="menu-oath"><p>奉上自己的一切，包括自己的身体。</p><p>一点点的技巧和运气，以及全部的决心。</p><strong>祂终将有求必应。</strong></div></section><nav class="lobby-menu" aria-label="古堡主菜单"><button type="button" class="lobby-menu-button lobby-primary-action" data-enter-duel><span class="button-copy"><strong>对决</strong><small>选择一名与会者</small></span><span class="button-arrow" aria-hidden="true">›</span></button><div class="lobby-secondary-menu"><button type="button" class="lobby-menu-button lobby-secondary-action" data-open="rules"><strong>玩法说明</strong></button><button type="button" class="lobby-menu-button lobby-secondary-action" data-open="skills"><strong>技能管理</strong></button><button type="button" class="lobby-menu-button lobby-secondary-action" data-open-trophies><strong>战利品陈列室</strong><small>${save.history.length} 局</small></button></div></nav>${lobbyDialogsMarkup()}</main>`
    : `<main class="lobby-shell lobby-character-shell"><header class="topbar"><button class="icon-button" data-lobby-home aria-label="返回绝命之夜主菜单">←</button><span class="eyebrow">古堡二层 // 与会者名册</span><span class="topbar-balance" aria-hidden="true"></span></header><section class="hero selection-hero"><p class="kicker">回应邀请之人</p><h1>选择<br><em>与会者</em></h1><p class="hero-copy">他们带着未竟的执念走进古堡，<br>换上指定的服装，等待终焉赌局开场。</p><div class="hero-rule"><span></span><b>02</b><span></span></div></section><section class="guest-section" aria-labelledby="guest-title"><div class="guest-heading"><div><p class="kicker">等待入场</p><h2 id="guest-title">候场宾客</h2></div><button type="button" class="quiet-button" data-refresh-guests aria-label="刷新候场宾客">刷新</button></div><section class="character-list">${characterCards || `<div class="empty-history"><span>◇</span><p>暂时没有可赴约的宾客。</p></div>`}</section></section><section class="guest-section defeated-section" aria-labelledby="defeated-title"><div class="guest-heading"><div><p class="kicker">回想</p><h2 id="defeated-title">已死亡宾客</h2></div></div><section class="character-list">${defeatedCards || `<div class="empty-history"><span>◇</span><p>完成胜利后，宾客会按首次击败时间记录在这里。</p></div>`}</section></section><div class="lobby-tools"><span class="quiet-record">策展人记录 // ${save.profile.matchesPlayed}</span></div><footer class="footer"><span>古堡牌室 // 02</span><span>${defeatedCharacters.length} 名已击败宾客</span></footer>${lobbyDialogsMarkup()}</main>`;
  root.querySelector<HTMLButtonElement>("[data-enter-duel]")?.addEventListener("click", () => { guestSelectionIds = []; renderLobby("characters"); });
  root.querySelector<HTMLButtonElement>("[data-lobby-home]")?.addEventListener("click", () => renderLobby("menu"));
  root.querySelector<HTMLButtonElement>("[data-refresh-guests]")?.addEventListener("click", () => { guestSelectionIds = selectGuestIds(); renderLobby("characters"); });
  root.querySelectorAll<HTMLButtonElement>("[data-open]:not([data-open=skills])").forEach((button) => button.addEventListener("click", () => document.querySelector<HTMLDialogElement>(`#${button.dataset.open}`)?.showModal()));
  root.querySelector<HTMLButtonElement>("[data-open=skills]")?.addEventListener("click", openSkillManagement);
  root.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()));
  root.querySelectorAll<HTMLButtonElement>("[data-invite-character]").forEach((button) => button.addEventListener("click", () => void openProfile(button.dataset.inviteCharacter ?? "")));
  root.querySelector<HTMLButtonElement>("[data-open-trophies]")?.addEventListener("click", renderTrophyRoom);
  root.querySelectorAll<HTMLInputElement>("[data-setting]").forEach((input) => input.addEventListener("change", updateSettings));
  root.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener("click", () => void exportSave());
  root.querySelector<HTMLButtonElement>("[data-import]")?.addEventListener("click", () => void requestImport());
  root.querySelector<HTMLInputElement>("#save-file")?.addEventListener("change", importFile);
  root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => { if (!confirmResetCurrentData()) return; void resetCurrentData(); });
  root.querySelector<HTMLButtonElement>("[data-download-resources]")?.addEventListener("click", (event) => void startResourcePackDownload(event.currentTarget as HTMLButtonElement));
}

async function resetCurrentData(): Promise<void> {
  save = resetSave();
  autosave = null;
  clearAiSchedule();
  gameAudio.stopHeartbeat();
  document.body.classList.remove("reduced-motion");
  gameAudio.configure(save.settings.soundEnabled);
  await repository.save(save);
  renderLobby(lobbyLayer);
}
function confirmResetCurrentData(): boolean { return window.confirm(RESET_CONFIRM_MESSAGE); }
function renderTrophyRoom(): void {
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer); autosave = null;
  const records = [...save.history].reverse();
  const cards = records.map((record) => {
    const character = getCharacterMetadata(record.opponentId)!;
    const won = record.winner === "player" && !record.escaped;
    const image = won
      ? `<img src="${character.trophyImage}" alt="被策展人战胜后平躺的${escapeHtml(character.name)}" />`
      : `<img class="transparent-history-image" src="${TRANSPARENT_PIXEL}" alt="本局未获得胜利图像" />`;
    return `<button class="trophy-card ${won ? "is-victory" : "is-empty"}" data-history-id="${escapeHtml(record.id)}"><span class="trophy-visual">${image}</span><span class="trophy-meta"><small>${historyResultLabel(record)}</small><strong>策展人 VS ${escapeHtml(character.name)}</strong><time datetime="${escapeHtml(record.timestamp)}">${historyDate(record.timestamp)}</time></span></button>`;
  }).join("");
  root.innerHTML = `<main class="trophy-shell"><header class="topbar"><button class="icon-button" data-trophy-back aria-label="返回大厅">←</button><span class="eyebrow">历史对局</span><span class="history-count">${records.length}</span></header><section class="trophy-heading"><p class="kicker">策展人的牌桌记录</p><h1>战利品<br><em>陈列室</em></h1><p>胜利留下角色纪念图；未取胜的牌局暂时只保留透明席位与数据。</p></section><section class="trophy-list">${cards || `<div class="empty-history"><span>◇</span><h2>还没有历史对局</h2><p>完成一场牌局后，记录会出现在这里。</p></div>`}</section><dialog id="history-detail" class="modal history-modal"><button class="modal-close" data-history-close aria-label="关闭">×</button><div id="history-detail-content"></div></dialog><dialog id="trophy-gallery" class="trophy-gallery-dialog" aria-label="角色昏迷鉴赏"><div id="trophy-gallery-content"></div></dialog></main>`;
  root.querySelector<HTMLButtonElement>("[data-trophy-back]")?.addEventListener("click", () => renderLobby("menu"));
  root.querySelector<HTMLButtonElement>("[data-history-close]")?.addEventListener("click", () => {
    root.querySelector<HTMLDialogElement>("#trophy-gallery")?.close();
    root.querySelector<HTMLDialogElement>("#history-detail")?.close();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-history-id]").forEach((button) => button.addEventListener("click", () => void openHistoryDetail(button.dataset.historyId ?? "")));
}
function closeupMarkup(point: TrophyCloseupPoint, index: number): string {
  return `<img src="${escapeHtml(point.image)}" alt="${escapeHtml(point.name)}方形局部特写" /><div><p class="eyebrow">局部特写 // ${String(index + 1).padStart(2, "0")}</p><h2>${escapeHtml(point.name)}</h2><p>${escapeHtml(point.description)}</p></div><button class="trophy-closeup-close" data-close-closeup aria-label="收起局部特写">×</button>`;
}
function openTrophyGallery(character: CharacterDefinition, gallery: CharacterTrophyGallery): void {
  const dialog = root.querySelector<HTMLDialogElement>("#trophy-gallery");
  const content = root.querySelector<HTMLDivElement>("#trophy-gallery-content");
  if (!dialog || !content) return;
  const hotspots = gallery.closeups.map((point, index) => `<button type="button" class="trophy-hotspot" data-closeup-id="${escapeHtml(point.id)}" style="--hotspot-x:${point.x}%;--hotspot-y:${point.y}%" aria-label="查看特写：${escapeHtml(point.name)}" aria-pressed="false"><span>${index + 1}</span></button>`).join("");
  content.innerHTML = `<div class="trophy-gallery-viewer"><header class="trophy-gallery-header"><div><p class="eyebrow">战利品鉴赏 // ${escapeHtml(character.name)}</p><h1>死体展示</h1></div><button class="trophy-gallery-close" data-gallery-close aria-label="关闭全屏鉴赏">×</button></header><div class="trophy-gallery-canvas"><figure class="trophy-gallery-stage"><img src="${escapeHtml(gallery.fullBody)}" alt="昏迷中的${escapeHtml(character.name)}竖屏全身鉴赏" />${hotspots}<figcaption>点按圆环标记查看局部特写</figcaption></figure><aside id="trophy-closeup-panel" class="trophy-closeup-panel" aria-live="polite"><p>选择画面中的特写点。</p></aside></div></div>`;
  const panel = content.querySelector<HTMLElement>("#trophy-closeup-panel");
  const buttons = [...content.querySelectorAll<HTMLButtonElement>("[data-closeup-id]")];
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
    panel.innerHTML = closeupMarkup(point, index);
    panel.classList.add("is-open");
    buttons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    panel.querySelector<HTMLButtonElement>("[data-close-closeup]")?.addEventListener("click", hideCloseup);
  }));
  content.querySelector<HTMLButtonElement>("[data-gallery-close]")?.addEventListener("click", () => dialog.close());
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
  const galleryPreview = gallery ? `<section class="history-trophy-preview"><img src="${escapeHtml(gallery.headshot)}" alt="昏迷中的${escapeHtml(metadata.name)}头部特写" /><div><p class="eyebrow">战利品等级：${metadata.tier}</p><strong>${escapeHtml(metadata.name)}的死体展示</strong><button type="button" class="text-button" data-open-trophy-gallery>进入全屏鉴赏 <span>→</span></button></div></section>` : "";
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
      const abilities = character.mechanics
        .filter((binding) => binding.enabled)
        .map((binding) => getAbilityDefinition(binding.definitionId))
        .filter((definition): definition is NonNullable<ReturnType<typeof getAbilityDefinition>> => Boolean(definition));
      const abilityMarkup = abilities.length === 0 ? "" : `<section class="profile-abilities" aria-label="角色技能"><h3>技能</h3>${abilities.map((ability) => `<details class="profile-ability"><summary><strong>${escapeHtml(ability.name)}</strong><span>：${escapeHtml(ability.description)}</span></summary><p>${escapeHtml(ability.profileLore ?? ability.description)}</p></details>`).join("")}</section>`;
      const defeated = defeatedCharacterIdsByFirstVictory(save.history).includes(character.id);
      const unlocked = save.profile.unlockedCharacterIds.includes(character.id) && isCharacterUnlocked(character, save.history);
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
  const tagLabel = (tag: string): string => {
    const tier = /^tier:([dcbas])$/.exec(tag)?.[1];
    return tier ? `${tier.toUpperCase()}级` : `带有「${tag}」标签的`;
  };
  if (condition.type === "defeat-any-tag") return `击败一名${tagLabel(condition.tag)}角色`;
  if (condition.type === "defeat-character") return `击败指定角色 ${getCharacterMetadata(condition.characterId)?.name ?? condition.characterId}`;
  return `击败${tagLabel(condition.tag)}角色的 ${condition.percentage}%`;
}
async function updateSettings(event: Event): Promise<void> { const input = event.target as HTMLInputElement; const setting = input.dataset.setting === "reducedMotion" ? "reducedMotion" : "soundEnabled"; save = { ...save, settings: { ...save.settings, [setting]: input.checked }, updatedAt: new Date().toISOString() }; document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); if (setting === "soundEnabled") { gameAudio.unlock(); gameAudio.configure(input.checked); } const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = "设置已保存。"; await repository.save(save); }
async function exportSave(): Promise<void> { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); try { const method = await downloadSave(autosave?.getSave() ?? save); if (status) status.textContent = method === "file-system-access" ? "存档已写入。" : "已开始下载存档。"; } catch (error) { if (status) status.textContent = uiError(error, "导出失败。"); } }
async function applyImportedSave(next: SaveFile): Promise<void> { try { save = next; document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); gameAudio.configure(save.settings.soundEnabled); await repository.save(save); if (save.activeMatch) await resumeMatch(save.activeMatch); else renderLobby(lobbyLayer); } catch (error) { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = uiError(error, "导入失败。"); } }
function importFile(event: Event): void { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; void importSave(file).then(applyImportedSave).catch((error: unknown) => { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = uiError(error, "导入失败。"); }); }
async function requestImport(): Promise<void> { try { await applyImportedSave(await openSaveWithFileSystemAccess()); } catch (error) { if (error instanceof Error && error.message.includes("unavailable")) root.querySelector<HTMLInputElement>("#save-file")?.click(); else { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = uiError(error, "导入失败。"); } } }
async function startMatch(characterId = selectedCharacterId): Promise<void> {
  if (characterLoadInFlight) return;
  skillDrawerOpen = false;
  clearSkillGainQueue();
  detachFullscreenListener();
  gameAudio.unlock();
  gameAudio.play("shuffle");
  const requestToken = ++characterLoadToken;
  characterLoadInFlight = true;
  root.querySelectorAll<HTMLButtonElement>("[data-invite-character], [data-profile-start]").forEach((button) => { button.disabled = true; });
  try {
    const metadata = getCharacterMetadata(characterId);
    if (!metadata) throw new Error("所选对手不可用。");
    const defeated = defeatedCharacterIdsByFirstVictory(save.history).includes(metadata.id);
    if (!defeated && (!save.profile.unlockedCharacterIds.includes(metadata.id) || !isCharacterUnlocked(metadata, save.history))) throw new Error("该角色尚未解锁。");
    const character = await loadCharacter(metadata.id);
    if (requestToken !== characterLoadToken) return;
    currentCharacter = character;
    selectedCharacterId = character.id;
    lastAction = null;
    lastDomainEvent = null;
    const match = createMatch(secureSeed(), { opponentId: character.id, aiProfile: character.ai, equippedSkillIds: save.profile.equippedSkillIds, opponentMechanics: character.mechanics });
    await resumeMatch(match, character);
    const openingAbilityNotice = abilityTriggerNotice(match.history, character.name);
    if (openingAbilityNotice) present(openingAbilityNotice, "gold", 2200);
    enqueueSkillGains(match.history);
    presentOpeningMatchAudio(gameAudio, match);
  } catch (error) {
    if (error instanceof Error && /尚未解锁|已经败北/.test(error.message)) {
      const status = root.querySelector<HTMLParagraphElement>("#lobby-status");
      if (status) status.textContent = error.message;
    } else renderError(error);
  } finally { if (requestToken === characterLoadToken) characterLoadInFlight = false; }
}
async function resumeMatch(match: MatchState, loadedCharacter?: CharacterDefinition): Promise<void> {
  clearAiSchedule();
  currentCharacter = loadedCharacter ?? await loadCharacter(match.opponentId);
  selectedCharacterId = currentCharacter.id;
  autosave = createAutosaveController(repository, save, match);
  const state = autosave.getState();
  if (state.view === "match-summary") renderSummary(state);
  else { renderMatch(state); syncMatchAudioState(gameAudio, state); scheduleAiTurn(state); }
}
function dispatch(action: Action): void { if (!autosave) return; const before = autosave.getState(); const after = autosave.dispatch(action); if (after === before) return; lastAction = action; lastDomainEvent = after.history.at(-1)?.type ?? null; if (after.scene === "match" && after.view === "match-summary") renderSummary(after); else if (after.scene === "match") renderMatch(after); presentDelta(before, after); presentMatchAudio(gameAudio, before, after); presentMatchHaptics(before, after, !save.settings.reducedMotion); scheduleAiTurn(after); }

function renderMatch(state: MatchState): void {
  const character = currentCharacter;
  const observation = buildObservation(state, "player");
  const reveal = state.round.phase !== "turns";
  const opponentSuit = revealedOpponentSuit(state);
  const opponentCards = reveal ? state.opponent.hand.cards.map((card) => cardMarkup(card)).join("") : observation.opponent.cards.map((card, index) => cardMarkup(card ?? state.opponent.hand.cards[index] ?? null, index > 0, index === 1 ? opponentSuit : undefined)).join("");
  const playerCards = state.player.hand.cards.map((card) => cardMarkup(card)).join("");
  const counts = new Map<string, number>(); state.skills.cards.forEach((card) => { const id = card.definitionId; counts.set(id, (counts.get(id) ?? 0) + 1); });
  const activeSkills = [...new Set(state.skills.equippedSkillIds)].filter((id) => isActiveSkill(id)).map((id) => {
    const count = counts.get(id) ?? 0;
    const skill = getSkillDefinition(id);
    if (!skill) return "";
    const firstCard = state.skills.cards.find((card) => card.definitionId === id);
    const action = firstCard
      ? { type: "PLAY_ABILITY" as const, instanceId: firstCard.instanceId }
      : { type: "PLAY_ABILITY" as const, instanceId: `unavailable-${id}` };
    const enabled = legal(state, action);
    const ability = getAbilityDefinition(skill.id);
    const statusBlocked = Boolean(firstCard && ability && isAbilityBlockedByStatus(abilityWorld(state), firstCard.owner, ability));
    const interaction = statusBlocked
      ? `data-skill-blocked="true" aria-disabled="true"`
      : `data-action='${JSON.stringify(action)}' ${enabled ? "" : "disabled"}`;
    return `<span class="skill-tile ${enabled ? "" : "is-disabled"}"><button class="skill-card" data-skill-id="${escapeHtml(skill.id)}" ${interaction} aria-label="${statusBlocked ? "技能被禁用：" : "使用"}${escapeHtml(skill.name)}"><b>${escapeHtml(skill.name)}</b><small>×${count}</small></button><button class="skill-info" type="button" data-skill-info="${escapeHtml(skill.id)}" aria-label="查看${escapeHtml(skill.name)}说明">i</button></span>`;
  }).join("");
  const passiveSkills = state.skills.equippedSkillIds.map((id) => getSkillDefinition(id)).filter((skill): skill is NonNullable<typeof skill> => Boolean(skill && skill.category === "passive")).map((skill) => `<span class="skill-tile passive"><span class="skill-card passive-card"><b>${escapeHtml(skill.name)}</b><small>被动</small></span><button class="skill-info" type="button" data-skill-info="${escapeHtml(skill.id)}" aria-label="查看${escapeHtml(skill.name)}说明">i</button></span>`).join("");
  const skills = activeSkills + passiveSkills;
  const totalSkills = state.skills.cards.length + state.skills.equippedSkillIds.filter((id) => isPassiveSkill(id)).length;
  const advice = state.skills.advice ? `<div class="skill-advice" aria-live="polite">猎手直觉：建议 ${state.skills.advice === "hit" ? "Hit 要牌" : "Stand 停牌"}</div>` : "";
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
    controls = `${actionButton("Hit 要牌", { type: "PLAYER_HIT" }, state, "primary-button")} ${actionButton("Stand 停牌", { type: "PLAYER_STAND" }, state)}`;
  }
  const dialogue = currentDialogue(state);
  const key = dialogueKey(state);
  const shouldType = key !== lastDialogueKey;
  const staffProp = state.round.phase === "roulette-trigger" && state.round.outcome?.penaltyTarget === "opponent"
    ? `<img class="trigger-prop" style="--revolver-top:${character.revolverPlacement.top}px;--revolver-left:${character.revolverPlacement.left}px;--revolver-mobile-top:${character.revolverPlacement.mobileTop}px;--revolver-mobile-left:${character.revolverPlacement.mobileLeft}px" src="${character.assets.staffRevolver}" alt="工作人员用 7mm 左轮对准 ${character.name} 的太阳穴" />` : "";
  const notice = state.round.phase === "round-reveal" ? roundResultText(state, character.name) : "";
  const gunStatuses = `<section class="roulette-status" aria-label="轮盘弹巢状态">${gunStatusMarkup(character.name, state.roulette.opponent.bullets, state.roulette.opponent.capacity)}${gunStatusMarkup("策展人", state.roulette.player.bullets, state.roulette.player.capacity)}</section>`;
  const skillDrawerMarkup = `<aside class="skill-sidebar ${skillDrawerOpen ? "is-open" : ""}" aria-label="技能抽屉"><button class="skill-drawer-toggle" type="button" aria-expanded="${skillDrawerOpen}" aria-label="${skillDrawerOpen ? "收起" : "展开"}技能抽屉，共 ${totalSkills} 张"><span class="skill-drawer-arrow" aria-hidden="true">${skillDrawerOpen ? ">" : "<"}</span><span class="skill-drawer-badge"${skillDrawerOpen ? " hidden" : ""}>${totalSkills}</span></button><div class="skill-drawer-content">${skills || "<span class='empty-skills'>暂无技能卡</span>"}</div></aside>`;
  root.innerHTML = `<main class="table-shell" data-phase="${state.round.phase}"><header class="table-top"><div><span class="eyebrow">第 ${state.roundIndex + 1} 轮 // ${phaseLabel(state.round.phase)}</span><h1>命运牌桌</h1></div><div class="table-actions"><div class="table-action-row"><button class="icon-button fullscreen-button" type="button" data-fullscreen aria-label="进入全屏">⛶</button><button class="icon-button" data-action='${JSON.stringify({ type: "ESCAPE_MATCH" })}' ${legal(state, { type: "ESCAPE_MATCH" }) ? "" : "disabled"} aria-label="离开牌桌">×</button></div>${gunStatuses}</div></header><section class="opponent-zone"><div class="character-strip"><img class="character-portrait scaled-character-art portrait-${portraitState(state)}" style="--character-art-scale:${character.portraitScales.table}" src="${tablePortrait(state, character)}" alt="${portraitAlt(state, character)}" />${staffProp}<div><span class="eyebrow">${character.name} // ${character.tier}级</span><p class="dialogue">“<span id="dialogue-text" data-typing="false">${shouldType ? "" : escapeHtml(dialogue)}</span>”</p></div></div><div class="hand-row"><span class="hand-label">${character.name} <strong>${reveal ? handValue(state.opponent.hand) : observation.opponent.value ?? "?"}</strong></span><div class="cards">${opponentCards}</div></div></section><section class="round-notice"><div id="presentation" class="presentation" data-default="${escapeHtml(notice)}" role="status" aria-live="polite">${escapeHtml(notice)}</div></section><section class="player-zone"><div class="player-layout"><div class="player-main"><div class="hand-row"><span class="hand-label">策展人 <strong>${handValue(state.player.hand)}</strong></span><div class="cards">${playerCards}</div></div>${advice}</div></div><div class="controls action-dock">${controls}</div></section><dialog id="skill-info-dialog" class="modal skill-info-modal" aria-labelledby="skill-info-title"><button class="modal-close" type="button" data-skill-close aria-label="关闭技能说明">×</button><p class="eyebrow" id="skill-info-kind"></p><details class="profile-ability"><summary><strong id="skill-info-title"></strong><span>：</span><span id="skill-info-description"></span></summary><p id="skill-info-lore"></p></details><p id="skill-info-usage"></p><p class="status-line" id="skill-info-status"></p></dialog>${devHud(state)}</main>${skillDrawerMarkup}`;
  wireActions(root, requestDispatch); root.querySelector<HTMLButtonElement>("[data-copy-debug]")?.addEventListener("click", () => { const text = root.querySelector<HTMLTextAreaElement>("#debug-json")?.value ?? ""; void navigator.clipboard?.writeText(text); });
  root.querySelectorAll<HTMLButtonElement>("[data-skill-blocked]").forEach((button) => button.addEventListener("click", () => present("技能被禁用", "danger")));
  attachFullscreenListener(); syncFullscreenButton();
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
    const skill = getSkillDefinition(button.dataset.skillInfo ?? "");
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
    if (status) status.textContent = skill.category === "active" ? `当前数量：${counts.get(skill.id) ?? 0} 张` : "当前状态：已装备";
    const details = dialog.querySelector<HTMLDetailsElement>(".profile-ability");
    if (details) details.open = false;
    dialog.showModal();
  }));
  root.querySelector<HTMLButtonElement>("[data-skill-close]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#skill-info-dialog")?.close());
  if (shouldType) { lastDialogueKey = key; startTypewriter(dialogue); }
}
function devHud(state: MatchState): string {
  const dev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  if (!dev && !new URLSearchParams(window.location.search).has("debug")) return "";
  const ai = state.lastAiDecision;
  const text = JSON.stringify({ gameVersion: save.gameVersion, seed: state.seed, round: state.roundIndex, phase: state.round.phase, currentActor: state.round.currentActor, relevantMatchState: state, recentActionsOrEvents: state.history.slice(-8), lastAction, lastDomainEvent, aiDecision: ai }, null, 2);
  const profile = state.aiProfile;
  return `<details class="dev-hud" open><summary>开发者面板</summary><dl><dt>种子</dt><dd>${state.seed}</dd><dt>轮次 / 阶段</dt><dd>${state.roundIndex} / ${phaseLabel(state.round.phase)}</dd><dt>当前行动者</dt><dd>${state.round.currentActor === "player" ? "玩家" : state.round.currentActor === "opponent" ? currentCharacter.name : "—"}</dd><dt>牌库剩余</dt><dd>${state.shoe.cards.length - state.shoe.cursor}</dd><dt>玩家真实手牌</dt><dd>${state.player.hand.cards.map(cardLabel).join(" ")}</dd><dt>对手真实手牌</dt><dd>${state.opponent.hand.cards.map(cardLabel).join(" ")}</dd><dt>玩家 / 对手子弹</dt><dd>${state.roulette.player.bullets} / ${state.roulette.opponent.bullets}</dd><dt>AI 参数 P / A / B / C</dt><dd>${profile.P} / ${profile.A} / ${profile.B} / ${profile.C}</dd><dt>Rmatch / Rplay</dt><dd>${state.aiNoise.match.toFixed(3)} / ${state.aiNoise.play.toFixed(3)}</dd><dt>上次手牌值 / 阈值 T</dt><dd>${ai ? `${ai.handValue} / ${ai.threshold.toFixed(3)}` : "—"}</dd><dt>上次子弹差 Bp - Ba</dt><dd>${ai?.bulletDifference ?? "—"}</dd><dt>对手上次决策</dt><dd>${decisionLabel(ai?.action)}</dd><dt>上次行动</dt><dd>${lastAction ? ACTION_LABELS[lastAction.type] : "—"}</dd><dt>上次领域事件</dt><dd>${lastDomainEvent ? EVENT_LABELS[lastDomainEvent] : "—"}</dd></dl><button class="quiet-button" data-copy-debug>复制调试状态</button><textarea id="debug-json" readonly hidden>${escapeHtml(text)}</textarea></details>`;
}
function renderSummary(state: MatchState): void {
  const winner = state.outcome?.winner;
  const escaped = state.outcome?.reason === "escaped";
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer); gameAudio.stopHeartbeat(); clearSkillGainQueue(); detachFullscreenListener(); lastDialogueKey = null;
  const playerWon = winner === "player";
  const image = playerWon ? currentCharacter.assets.defeatedSummary : escaped ? currentCharacter.assets.conflicted : currentCharacter.assets.relaxed;
  const imageAlt = playerWon ? `${currentCharacter.name} 全身无力地瘫坐在椅子上` : currentCharacter.name;
  const summaryCopy = escaped ? currentCharacter.matchSummary.escaped : playerWon ? currentCharacter.matchSummary.playerVictory : currentCharacter.matchSummary.playerDefeat;
  const alreadyUnlocked = new Set(save.profile.unlockedSkillIds);
  const newlyUnlocked = playerWon && !escaped
    ? skillsUnlockedForVictory(state.opponentId, winner, escaped).filter((id) => !alreadyUnlocked.has(id))
    : [];
  const newlyUnlockedCharacters = playerWon && !escaped ? newlyUnlockedForVictory(save.history, state.opponentId) : [];
  const characterUnlockPanel = newlyUnlockedCharacters.length
    ? `<section class="unlock-panel character-unlock-panel" aria-live="polite"><p class="eyebrow">新角色已解锁</p>${newlyUnlockedCharacters.map((id) => { const character = getCharacterMetadata(id); if (!character) return ""; return `<div class="unlock-skill"><strong>${escapeHtml(character.name)}</strong><span>${escapeHtml(character.tier)}级与会者 · 已可在候场宾客中邀请</span><small>${escapeHtml(unlockConditionLabel(character.unlock))}</small></div>`; }).join("")}</section>`
    : "";
  const unlockPanel = newlyUnlocked.length
    ? `<section class="unlock-panel" aria-live="polite"><p class="eyebrow">新技能已解锁</p>${newlyUnlocked.map((id) => { const skill = getSkillDefinition(id); if (!skill) return ""; return `<div class="unlock-skill"><strong>${escapeHtml(skill.name)}</strong><span>${skill.category === "active" ? "主动" : "被动"} · ${escapeHtml(skill.description)}</span><small>${escapeHtml(skill.unlock?.label ?? "胜利奖励")}</small></div>`; }).join("")}</section>`
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
  clearAiSchedule();
  clearSkillGainQueue();
  detachFullscreenListener();
  const incompatibleSave = error instanceof SaveValidationError;
  const action = incompatibleSave
    ? `<button class="danger-button" data-reset-invalid-save>删除旧存档并重新开始</button><button class="secondary-button" data-retry>重新检查</button>`
    : `<button class="primary-button" data-retry>重试</button>`;
  const message = incompatibleSave ? "当前版本不兼容这份旧存档。请删除旧存档后重新开始。" : uiError(error, "游戏无法启动。");
  const heading = incompatibleSave ? "需要清理<br><em>旧存档</em>" : "出现了<br><em>意外回合</em>";
  root.innerHTML = `<main class="error-shell"><p class="kicker">牌桌暂时离线</p><h1>${heading}</h1><p>${escapeHtml(message)}</p>${action}</main>`;
  root.querySelector("[data-retry]")?.addEventListener("click", () => void boot());
  root.querySelector("[data-reset-invalid-save]")?.addEventListener("click", () => void resetCurrentData());
}
async function boot(): Promise<void> { clearAiSchedule(); root.innerHTML = `<main class="loading-shell"><span class="mark">✦</span><p>正在洗牌……</p></main>`; try { save = await bootLoad(repository); document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); gameAudio.configure(save.settings.soundEnabled); gameAudio.preload(); const unlockAudio = () => { gameAudio.unlock(); const state = autosave?.getState(); if (state) syncMatchAudioState(gameAudio, state); }; document.addEventListener("pointerdown", unlockAudio, { capture: true, once: true }); document.addEventListener("keydown", unlockAudio, { capture: true, once: true }); document.addEventListener("visibilitychange", () => { if (document.hidden) gameAudio.pauseBgm(); else gameAudio.restoreBgm(); }); void requestPersistentStorage(); if (save.activeMatch) await resumeMatch(save.activeMatch); else renderLobby(); } catch (error) { renderError(error); } }
void boot();
