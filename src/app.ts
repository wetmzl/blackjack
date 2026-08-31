import "./styles.css";
import { handValue } from "./core/blackjack/hand";
import type { Card } from "./core/blackjack/types";
import type { MatchHistoryRecord } from "./core/match/history";
import { buildObservation } from "./core/ai/observation";
import { createMatch, getLegalActions } from "./core/match/reducer";
import type { Action, GameEvent, MatchState } from "./core/match/types";
import { SeededRng } from "./core/rng/seeded";
import { getSkillDefinition, SKILL_DEFINITIONS, isActiveSkill, isPassiveSkill } from "./core/skills/definitions";
import { addUnlockedSkills, validateLoadout } from "./core/skills/skills";
import { chooseDialogue } from "./dialogue/types";
import { resolveDialogueState } from "./dialogue/state";
import { CHARACTER_CATALOG, DEFAULT_CHARACTER_ID, getCharacterMetadata, loadCharacter, type CharacterDefinition } from "./content/characters";
import { bootLoad, resetSave } from "./persistence/boot";
import { createAutosaveController, type AutosaveController } from "./persistence/autosave";
import { downloadRawSave, downloadSave, importSave, openSaveWithFileSystemAccess } from "./persistence/json";
import { IndexedDbSaveRepository } from "./persistence/dexie-repository";
import { requestPersistentStorage } from "./persistence/storage";
import { SaveValidationError, type SaveFile } from "./persistence/schema";
import { getAiTurnDelayMs } from "./presentation/ai-timing";
import { presentMatchHaptics } from "./presentation/haptics";
import { gameAudio } from "./audio/game-audio";
import { presentMatchAudio, presentOpeningMatchAudio, syncMatchAudioState } from "./audio/match-audio";

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
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const RESET_CONFIRM_MESSAGE = "清理当前数据将删除战绩、历史、技能解锁和未完成对局，确定继续吗？";

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
function cardMarkup(card: Card | null, hidden = false): string {
  if (hidden || !card) return `<span class="card card-back" aria-label="暗牌"><i>✦</i></span>`;
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return `<span class="card ${red ? "red" : ""}" aria-label="${cardLabel(card)}"><b>${escapeHtml(card.rank)}</b><em>${card.suit === "hearts" ? "♥" : card.suit === "diamonds" ? "♦" : card.suit === "clubs" ? "♣" : "♠"}</em></span>`;
}
function gunMarkup(bullets: number, capacity: number): string { return `<div class="gun" aria-label="${capacity} 个弹位中已装填 ${bullets} 发">${Array.from({ length: capacity }, (_, index) => `<i class="${index < bullets ? "loaded" : ""}"></i>`).join("")}</div>`; }
const PHASE_LABELS: Readonly<Record<MatchState["round"]["phase"], string>> = {
  dealing: "发牌中", "initial-blackjack-check": "检查黑杰克", turns: "行动阶段", settlement: "结算中",
  "round-reveal": "翻牌结果", "roulette-reaction": "轮盘反应", "roulette-trigger": "准备扣扳机",
  "roulette-result": "扳机结果", reward: "奖励结算", "round-end": "等待下一轮"
};
function phaseLabel(phase: MatchState["round"]["phase"]): string { return PHASE_LABELS[phase]; }
const ACTION_LABELS: Readonly<Record<Action["type"], string>> = {
  PLAYER_HIT: "博士 Hit 要牌", PLAYER_STAND: "博士 Stand 停牌", AI_TURN: "对手行动一次",
  AI_HIT: "对手 Hit 要牌", OPPONENT_HIT: "对手 Hit 要牌", AI_STAND: "对手 Stand 停牌", OPPONENT_STAND: "对手 Stand 停牌",
  USE_SKILL: "使用技能", TRIGGER_ROULETTE: "扣下扳机", ACK_ROUND_RESULT: "确认本轮结果",
  ACK_TRIGGER_RESULT: "确认扳机结果", CONTINUE_ROUND: "进入下一轮", ESCAPE_MATCH: "逃离对局", ACK_MATCH_RESULT: "确认最终结果"
};
const EVENT_LABELS: Readonly<Record<GameEvent["type"], string>> = {
  ROUND_STARTED: "本轮开始", CARD_DEALT: "发牌", INITIAL_BLACKJACK_CHECK: "检查黑杰克",
  PLAYER_HIT: "博士 Hit 要牌", OPPONENT_HIT: "对手 Hit 要牌", PLAYER_STOOD: "博士 Stand 停牌", OPPONENT_STOOD: "对手 Stand 停牌",
  BLACKJACK: "黑杰克", BUST: "爆牌", ROUND_RESOLVED: "本轮结算", ROUND_RESULT_ACKNOWLEDGED: "已确认本轮结果",
  BULLET_ADDED: "装填子弹", TRIGGER_PULLED: "已扣下扳机", TRIGGER_SURVIVED: "空枪幸存", TRIGGER_AVOIDED_BY_SKILL: "技能免除扳机", TRIGGER_RESULT_ACKNOWLEDGED: "已确认扳机结果",
  PARTICIPANT_KILLED: "参与者倒下", SKILL_GAINED: "获得技能", SKILL_USED: "使用技能", SKILL_ADVICE: "获得行动建议", MATCH_FINISHED: "对局结束",
  MATCH_ESCAPED: "博士离席", MATCH_RESULT_ACKNOWLEDGED: "已确认最终结果", AI_DECISION: "对手完成决策"
};
function decisionLabel(action: "hit" | "stand" | undefined): string { return action === "hit" ? "Hit 要牌" : action === "stand" ? "Stand 停牌" : "—"; }
function roundResultText(state: MatchState, opponentName: string): string {
  const outcome = state.round.outcome;
  if (!outcome) return "本轮结果待揭晓。";
  const player = handValue(state.player.hand);
  const opponent = handValue(state.opponent.hand);
  const scores = `博士 ${player}｜${opponentName} ${opponent}`;
  if (!outcome.winner) return `本轮平局｜${scores}｜双方都没有获得惩罚。`;
  const winner = outcome.winner === "player" ? "你获胜" : `${opponentName} 获胜`;
  const reason = outcome.reason === "blackjack" ? "黑杰克" : outcome.reason === "bust" ? `${outcome.penaltyTarget === "player" ? "博士" : opponentName} 爆牌` : "点数更接近 21";
  const bullets = outcome.bulletsAdded > 0 ? `｜为${outcome.penaltyTarget === "player" ? "博士" : opponentName}装填 ${outcome.bulletsAdded} 发` : "";
  return `${winner}｜${scores}｜${reason}${bullets}。`;
}
function legal(state: MatchState, action: Action): boolean { return getLegalActions(state).some((candidate) => JSON.stringify(candidate) === JSON.stringify(action)); }
function actionButton(label: string, action: Action, state: MatchState, className = "secondary-button"): string { const enabled = legal(state, action); return `<button class="${className}" data-action='${JSON.stringify(action)}' ${enabled ? "" : "disabled"}>${label}</button>`; }
function historyResultLabel(record: MatchHistoryRecord): string { return record.escaped ? "博士离席" : record.winner === "player" ? "博士胜利" : "博士落败"; }
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
    return `<label class="loadout-skill ${available ? "" : "locked"}"><input type="checkbox" data-equip-skill="${skill.id}" ${checked ? "checked" : ""} ${available ? "" : "disabled"}><span><b>${skill.name}</b><small>${skill.category === "passive" ? "被动" : "主动"} · ${source}</small><em>${skill.description}</em></span></label>`;
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
function present(text: string, tone = "normal"): void {
  const node = document.querySelector<HTMLDivElement>("#presentation"); if (!node) return;
  node.textContent = text; node.dataset.tone = tone; node.classList.remove("show"); window.clearTimeout(presentationTimer); window.clearTimeout(presentationHideTimer);
  if (!save.settings.reducedMotion) document.body.classList.add("shake");
  presentationTimer = window.setTimeout(() => { node.classList.add("show"); document.body.classList.remove("shake"); }, save.settings.reducedMotion ? 0 : 40);
  presentationHideTimer = window.setTimeout(() => { node.classList.remove("show"); document.body.classList.remove("shake"); }, 1000);
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
  const event = events.find((candidate) => candidate.type === "TRIGGER_AVOIDED_BY_SKILL") ?? events.find((candidate) => candidate.type === "TRIGGER_PULLED") ?? events.find((candidate) => candidate.type === "BUST") ?? events.find((candidate) => candidate.type === "BLACKJACK") ?? events.find((candidate) => candidate.type === "BULLET_ADDED") ?? events.find((candidate) => candidate.type === "TRIGGER_SURVIVED");
  if (event) {
    if (event.type === "BUST") present(`${event.actor === "player" ? "博士" : currentCharacter.name} 爆牌`, "danger");
    else if (event.type === "BLACKJACK") present("黑杰克", "gold");
    else if (event.type === "BULLET_ADDED") present(`已装填 ${event.amount} 发子弹`, "danger");
    else if (event.type === "TRIGGER_PULLED") present(event.fired ? "砰！" : "咔哒……", event.fired ? "danger" : "gold");
    else if (event.type === "TRIGGER_SURVIVED") present("空枪，暂时活下来了", "gold");
    else if (event.type === "TRIGGER_AVOIDED_BY_SKILL") present("罗德岛万人迷：免除本次扳机", "gold");
    return;
  }
  const skill = events.find((candidate) => candidate.type === "SKILL_USED");
  if (skill) { present(`已使用技能：${getSkillDefinition(skill.skillId)?.name ?? "未知技能"}`, "gold"); return; }
  if (events.some((candidate) => candidate.type === "CARD_DEALT" && candidate.actor === "player") && handValue(after.player.hand) === 21) present("21 · 自动停牌", "gold");
}
function wireActions(container: ParentNode, handler: (action: Action) => void): void { container.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((element) => element.addEventListener("click", () => handler(JSON.parse(element.dataset.action ?? "{}") as Action))); }
function requestDispatch(action: Action): void { dispatch(action); }

function renderLobby(): void {
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer);
  gameAudio.stopHeartbeat();
  lastDialogueKey = null;
  autosave = null;
  const characterCards = CHARACTER_CATALOG.map((character) => `<article class="character-card"><div class="portrait"><img src="${character.previewImage}" alt="${character.name}" loading="lazy" decoding="async" /></div><div class="character-copy"><p class="eyebrow">对手 // ${character.tier}级</p><h2>${character.name}</h2><p>${character.subtitle}</p><button class="text-button" data-profile-id="${character.id}">查看档案 <span>→</span></button></div><button class="card-start" data-start-character="${character.id}">开始对局</button></article>`).join("");
  root.innerHTML = `<main class="lobby-shell"><header class="topbar"><span class="mark">✦</span><span class="eyebrow">假面舞会 // 余兴牌桌</span><button class="icon-button" data-open="settings" aria-label="打开设置">⚙</button></header><section class="hero"><p class="kicker">博士的舞会余兴</p><h1>命运<br><em>牌桌</em></h1><p class="hero-copy">和熟悉的干员读牌，也读彼此。<br>7mm 左轮与胜负，都是今夜的危险节目。</p><div class="hero-rule"><span></span><b>01</b><span></span></div></section><section class="character-list">${characterCards}</section><div class="actions"><button class="secondary-button" data-open="rules">玩法说明</button><button class="secondary-button" data-open="skills">技能管理</button></div><div class="lobby-tools"><button class="quiet-button" data-open="settings">设置</button><button class="quiet-button" data-open-trophies>战利品陈列室 <small>${save.history.length} 局</small></button></div><footer class="footer"><span>舞会大厅 // 01</span><span>博士战绩 // ${save.profile.matchesPlayed}</span></footer><dialog id="rules" class="modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">余兴规则</p><h2>怎么玩</h2><p>目标是接近21点但不要爆牌。用 Hit 要牌，准备好后用 Stand 停牌。</p><p>两张牌正好21点是黑杰克；入场会获得技能牌，普通胜利获得1张，黑杰克获得2张。技能牌只来自本轮携带的主动技能。</p><p>被动技能会持续生效，不会进入牌池。技能管理中最多装备4个技能，其中被动最多1个。</p></dialog><dialog id="skills" class="modal skills-modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">博士的牌组</p><h2>技能管理</h2><div id="skill-content"></div></dialog><dialog id="profile" class="modal profile-modal"><button class="modal-close" data-close aria-label="关闭">×</button><div id="profile-content"></div></dialog><dialog id="settings" class="modal"><button class="modal-close" data-close aria-label="关闭">×</button><p class="eyebrow">牌桌设置</p><h2>设置</h2><label class="setting"><input type="checkbox" data-setting="soundEnabled" ${save.settings.soundEnabled ? "checked" : ""}> 开启声音</label><label class="setting"><input type="checkbox" data-setting="reducedMotion" ${save.settings.reducedMotion ? "checked" : ""}> 减少动态效果</label><div class="save-actions"><button class="secondary-button" data-export>导出存档</button><button class="secondary-button" data-import>导入存档</button><button class="danger-button" data-reset>清理当前数据</button><input id="save-file" type="file" accept="application/json,.json" hidden></div><p class="status-line" id="lobby-status"></p></dialog></main>`;
  root.querySelectorAll<HTMLButtonElement>("[data-open]:not([data-open=skills])").forEach((button) => button.addEventListener("click", () => document.querySelector<HTMLDialogElement>(`#${button.dataset.open}`)?.showModal()));
  root.querySelector<HTMLButtonElement>("[data-open=skills]")?.addEventListener("click", openSkillManagement);
  root.querySelectorAll<HTMLButtonElement>("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()));
  root.querySelectorAll<HTMLButtonElement>("[data-start-character]").forEach((button) => button.addEventListener("click", () => void startMatch(button.dataset.startCharacter)));
  root.querySelectorAll<HTMLButtonElement>("[data-profile-id]").forEach((button) => button.addEventListener("click", () => void openProfile(button.dataset.profileId ?? "")));
  root.querySelector<HTMLButtonElement>("[data-open-trophies]")?.addEventListener("click", renderTrophyRoom);
  root.querySelectorAll<HTMLInputElement>("[data-setting]").forEach((input) => input.addEventListener("change", updateSettings));
  root.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener("click", () => void exportSave());
  root.querySelector<HTMLButtonElement>("[data-import]")?.addEventListener("click", () => void requestImport());
  root.querySelector<HTMLInputElement>("#save-file")?.addEventListener("change", importFile);
  root.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => { if (!confirmResetCurrentData()) return; void resetCurrentData(); });
}

async function resetCurrentData(): Promise<void> {
  save = resetSave();
  autosave = null;
  clearAiSchedule();
  gameAudio.stopHeartbeat();
  document.body.classList.remove("reduced-motion");
  gameAudio.configure(save.settings.soundEnabled);
  await repository.save(save);
  renderLobby();
}
function confirmResetCurrentData(): boolean { return window.confirm(RESET_CONFIRM_MESSAGE); }
function renderTrophyRoom(): void {
  clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer); autosave = null;
  const records = [...save.history].reverse();
  const cards = records.map((record) => {
    const character = getCharacterMetadata(record.opponentId) ?? getCharacterMetadata(DEFAULT_CHARACTER_ID)!;
    const won = record.winner === "player" && !record.escaped;
    const image = won
      ? `<img src="${character.trophyImage}" alt="被博士战胜后平躺的${escapeHtml(character.name)}" />`
      : `<img class="transparent-history-image" src="${TRANSPARENT_PIXEL}" alt="本局未获得胜利图像" />`;
    return `<button class="trophy-card ${won ? "is-victory" : "is-empty"}" data-history-id="${escapeHtml(record.id)}"><span class="trophy-visual">${image}</span><span class="trophy-meta"><small>${historyResultLabel(record)}</small><strong>博士 VS ${escapeHtml(character.name)}</strong><time datetime="${escapeHtml(record.timestamp)}">${historyDate(record.timestamp)}</time></span></button>`;
  }).join("");
  root.innerHTML = `<main class="trophy-shell"><header class="topbar"><button class="icon-button" data-trophy-back aria-label="返回大厅">←</button><span class="eyebrow">假面舞会 // 历史对局</span><span class="history-count">${records.length}</span></header><section class="trophy-heading"><p class="kicker">博士的牌桌记录</p><h1>战利品<br><em>陈列室</em></h1><p>胜利留下角色纪念图；未取胜的牌局暂时只保留透明席位与数据。</p></section><section class="trophy-list">${cards || `<div class="empty-history"><span>◇</span><h2>还没有历史对局</h2><p>完成一场余兴牌局后，记录会出现在这里。</p></div>`}</section><dialog id="history-detail" class="modal history-modal"><button class="modal-close" data-history-close aria-label="关闭">×</button><div id="history-detail-content"></div></dialog></main>`;
  root.querySelector<HTMLButtonElement>("[data-trophy-back]")?.addEventListener("click", renderLobby);
  root.querySelector<HTMLButtonElement>("[data-history-close]")?.addEventListener("click", () => root.querySelector<HTMLDialogElement>("#history-detail")?.close());
  root.querySelectorAll<HTMLButtonElement>("[data-history-id]").forEach((button) => button.addEventListener("click", () => openHistoryDetail(button.dataset.historyId ?? "")));
}
function openHistoryDetail(id: string): void {
  const record = save.history.find((entry) => entry.id === id);
  const dialog = root.querySelector<HTMLDialogElement>("#history-detail");
  const content = root.querySelector<HTMLDivElement>("#history-detail-content");
  if (!record || !dialog || !content) return;
  const character = getCharacterMetadata(record.opponentId) ?? getCharacterMetadata(DEFAULT_CHARACTER_ID)!;
  content.innerHTML = `<p class="eyebrow">${historyDate(record.timestamp)}</p><h2>${historyResultLabel(record)}</h2><p class="history-opponent">博士 VS ${escapeHtml(character.name)}</p><dl class="history-stats"><dt>博士最终左轮</dt><dd>${record.finalRoulette.player.bullets} / ${record.finalRoulette.player.capacity}</dd><dt>${escapeHtml(character.name)}最终左轮</dt><dd>${record.finalRoulette.opponent.bullets} / ${record.finalRoulette.opponent.capacity}</dd><dt>博士爆牌</dt><dd>${record.busts.player} 次</dd><dt>${escapeHtml(character.name)}爆牌</dt><dd>${record.busts.opponent} 次</dd><dt>博士黑杰克</dt><dd>${record.blackjacks.player} 次</dd><dt>${escapeHtml(character.name)}黑杰克</dt><dd>${record.blackjacks.opponent} 次</dd></dl>`;
  dialog.showModal();
}
async function openProfile(id: string): Promise<void> { const metadata = getCharacterMetadata(id); if (!metadata) return; try { const character = await loadCharacter(metadata.id); selectedCharacterId = character.id; const content = root.querySelector<HTMLDivElement>("#profile-content"); if (content) content.innerHTML = `<img src="${character.previewImage}" alt="${character.name}" loading="lazy" decoding="async" /><p class="eyebrow">角色档案 // ${character.tier}级</p><h2>${character.name}</h2><p>${escapeHtml(character.profile.description)}</p><button class="primary-button" data-profile-start="${character.id}">开始对局 <span>→</span></button>`; content?.querySelector<HTMLButtonElement>("[data-profile-start]")?.addEventListener("click", () => { document.querySelector<HTMLDialogElement>("#profile")?.close(); void startMatch(character.id); }); document.querySelector<HTMLDialogElement>("#profile")?.showModal(); } catch (error) { renderError(error); } }
async function updateSettings(event: Event): Promise<void> { const input = event.target as HTMLInputElement; const setting = input.dataset.setting === "reducedMotion" ? "reducedMotion" : "soundEnabled"; save = { ...save, settings: { ...save.settings, [setting]: input.checked }, updatedAt: new Date().toISOString() }; document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); if (setting === "soundEnabled") { gameAudio.unlock(); gameAudio.configure(input.checked); } const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = "设置已保存。"; await repository.save(save); }
async function exportSave(): Promise<void> { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); try { const method = await downloadSave(autosave?.getSave() ?? save); if (status) status.textContent = method === "file-system-access" ? "存档已写入。" : "已开始下载存档。"; } catch (error) { if (status) status.textContent = uiError(error, "导出失败。"); } }
async function applyImportedSave(next: SaveFile): Promise<void> { try { save = next; gameAudio.configure(save.settings.soundEnabled); await repository.save(save); if (save.activeMatch) await resumeMatch(save.activeMatch); else renderLobby(); } catch (error) { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = uiError(error, "导入失败。"); } }
function importFile(event: Event): void { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; void importSave(file).then(applyImportedSave).catch((error: unknown) => { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = uiError(error, "导入失败。"); }); }
async function requestImport(): Promise<void> { try { await applyImportedSave(await openSaveWithFileSystemAccess()); } catch (error) { if (error instanceof Error && error.message.includes("unavailable")) root.querySelector<HTMLInputElement>("#save-file")?.click(); else { const status = root.querySelector<HTMLParagraphElement>("#lobby-status"); if (status) status.textContent = uiError(error, "导入失败。"); } } }
async function startMatch(characterId = selectedCharacterId): Promise<void> {
  if (characterLoadInFlight) return;
  gameAudio.unlock();
  gameAudio.play("shuffle");
  const requestToken = ++characterLoadToken;
  characterLoadInFlight = true;
  root.querySelectorAll<HTMLButtonElement>("[data-start-character], [data-profile-start]").forEach((button) => { button.disabled = true; });
  try {
    const metadata = getCharacterMetadata(characterId);
    if (!metadata) throw new Error("所选对手不可用。");
    const character = await loadCharacter(metadata.id);
    if (requestToken !== characterLoadToken) return;
    currentCharacter = character;
    selectedCharacterId = character.id;
    lastAction = null;
    lastDomainEvent = null;
    const match = createMatch(secureSeed(), { opponentId: character.id, aiProfile: character.ai, equippedSkillIds: save.profile.equippedSkillIds });
    await resumeMatch(match, character);
    presentOpeningMatchAudio(gameAudio, match);
  } catch (error) { renderError(error); }
  finally { if (requestToken === characterLoadToken) characterLoadInFlight = false; }
}
async function resumeMatch(match: MatchState, loadedCharacter?: CharacterDefinition): Promise<void> {
  clearAiSchedule();
  currentCharacter = loadedCharacter ?? await loadCharacter(getCharacterMetadata(match.opponentId)?.id ?? DEFAULT_CHARACTER_ID);
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
  const opponentCards = reveal ? state.opponent.hand.cards.map((card) => cardMarkup(card)).join("") : observation.opponent.cards.map((card, index) => cardMarkup(card, index > 0)).join("");
  const playerCards = state.player.hand.cards.map((card) => cardMarkup(card)).join("");
  const counts = new Map<string, number>(); state.skills.cards.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const skills = [...counts.entries()].map(([id, count]) => { const skill = getSkillDefinition(id); if (!skill || !isActiveSkill(id)) return ""; return `<button class="skill-card" data-action='${JSON.stringify({ type: "USE_SKILL", skillId: id })}' ${legal(state, { type: "USE_SKILL", skillId: id }) ? "" : "disabled"}><b>${skill.name}${count > 1 ? ` ×${count}` : ""}</b><small>${skill.description}</small></button>`; }).join("");
  const passiveSkills = state.skills.equippedSkillIds.map((id) => getSkillDefinition(id)).filter((skill): skill is NonNullable<typeof skill> => Boolean(skill && skill.category === "passive")).map((skill) => `<span class="passive-skill"><b>被动：${skill.name}</b><small>${skill.description}</small></span>`).join("");
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
  root.innerHTML = `<main class="table-shell" data-phase="${state.round.phase}"><header class="table-top"><div><span class="eyebrow">第 ${state.roundIndex + 1} 轮 // ${phaseLabel(state.round.phase)}</span><h1>命运牌桌</h1></div><button class="icon-button" data-action='${JSON.stringify({ type: "ESCAPE_MATCH" })}' ${legal(state, { type: "ESCAPE_MATCH" }) ? "" : "disabled"} aria-label="离开余兴牌桌">×</button></header><section class="opponent-zone"><div class="character-strip"><img class="character-portrait portrait-${portraitState(state)}" src="${tablePortrait(state, character)}" alt="${portraitAlt(state, character)}" />${staffProp}<div><span class="eyebrow">${character.name} // ${character.tier}级</span><p class="dialogue">“<span id="dialogue-text" data-typing="false">${shouldType ? "" : escapeHtml(dialogue)}</span>”</p></div></div><div class="hand-row"><span class="hand-label">${character.name} <strong>${reveal ? handValue(state.opponent.hand) : observation.opponent.value ?? "?"}</strong></span><div class="cards">${opponentCards}</div></div><div class="gun-row"><span>${character.name} 的 7mm 左轮</span>${gunMarkup(state.roulette.opponent.bullets, state.roulette.opponent.capacity)}</div></section><section class="felt-divider"><span>牌桌</span></section><section class="player-zone">${state.round.phase === "round-reveal" ? `<div class="round-result" aria-live="polite">${escapeHtml(roundResultText(state, character.name))}</div>` : ""}<div class="gun-row"><span>博士的 7mm 左轮</span>${gunMarkup(state.roulette.player.bullets, state.roulette.player.capacity)}</div><div class="hand-row"><span class="hand-label">博士 <strong>${handValue(state.player.hand)}</strong></span><div class="cards">${playerCards}</div></div>${advice}<div class="skill-row">${skills || "<span class='empty-skills'>暂无技能卡</span>"}</div><div class="passive-row">${passiveSkills}</div><div class="controls">${controls}</div></section><div id="presentation" class="presentation" role="status"></div>${devHud(state)}</main>`;
  wireActions(root, requestDispatch); root.querySelector<HTMLButtonElement>("[data-copy-debug]")?.addEventListener("click", () => { const text = root.querySelector<HTMLTextAreaElement>("#debug-json")?.value ?? ""; void navigator.clipboard?.writeText(text); });
  if (shouldType) { lastDialogueKey = key; startTypewriter(dialogue); }
}
function devHud(state: MatchState): string { const dev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV); if (!dev && !new URLSearchParams(window.location.search).has("debug")) return ""; const ai = state.lastAiDecision; const text = JSON.stringify({ gameVersion: save.gameVersion, seed: state.seed, round: state.roundIndex, phase: state.round.phase, currentActor: state.round.currentActor, relevantMatchState: state, recentActionsOrEvents: state.history.slice(-8), lastAction, lastDomainEvent, aiDecision: ai }, null, 2); return `<details class="dev-hud" open><summary>开发者面板</summary><dl><dt>种子</dt><dd>${state.seed}</dd><dt>轮次 / 阶段</dt><dd>${state.roundIndex} / ${phaseLabel(state.round.phase)}</dd><dt>当前行动者</dt><dd>${state.round.currentActor === "player" ? "玩家" : state.round.currentActor === "opponent" ? currentCharacter.name : "—"}</dd><dt>牌库剩余</dt><dd>${state.shoe.cards.length - state.shoe.cursor}</dd><dt>玩家真实手牌</dt><dd>${state.player.hand.cards.map(cardLabel).join(" ")}</dd><dt>对手真实手牌</dt><dd>${state.opponent.hand.cards.map(cardLabel).join(" ")}</dd><dt>玩家 / 对手子弹</dt><dd>${state.roulette.player.bullets} / ${state.roulette.opponent.bullets}</dd><dt>对手最优动作</dt><dd>${decisionLabel(ai?.optimalAction)}</dd><dt>对手理性程度</dt><dd>${ai ? `${(ai.rationality * 100).toFixed(0)}%` : "—"}</dd><dt>性格要牌倾向</dt><dd>${ai ? `${(ai.personalityHitProbability * 100).toFixed(0)}%` : "—"}</dd><dt>最终要牌概率</dt><dd>${ai ? `${(ai.finalHitProbability * 100).toFixed(0)}%` : "—"}</dd><dt>决策随机数</dt><dd>${ai ? `${(ai.roll * 100).toFixed(0)}%` : "—"}</dd><dt>对手上次决策</dt><dd>${decisionLabel(ai?.action)}</dd><dt>上次行动</dt><dd>${lastAction ? ACTION_LABELS[lastAction.type] : "—"}</dd><dt>上次领域事件</dt><dd>${lastDomainEvent ? EVENT_LABELS[lastDomainEvent] : "—"}</dd></dl><button class="quiet-button" data-copy-debug>复制调试状态</button><textarea id="debug-json" readonly hidden>${escapeHtml(text)}</textarea></details>`; }
function renderSummary(state: MatchState): void { const winner = state.outcome?.winner; const escaped = state.outcome?.reason === "escaped"; clearAiSchedule(); window.clearInterval(dialogueTimer); window.clearTimeout(dialogueShakeTimer); gameAudio.stopHeartbeat(); lastDialogueKey = null; const playerWon = winner === "player"; const image = playerWon ? currentCharacter.assets.defeatedSummary : escaped ? currentCharacter.assets.conflicted : currentCharacter.assets.relaxed; const imageAlt = playerWon ? `${currentCharacter.name} 全身无力地瘫坐在椅子上` : currentCharacter.name; const summaryCopy = escaped ? currentCharacter.matchSummary.escaped : playerWon ? currentCharacter.matchSummary.playerVictory : currentCharacter.matchSummary.playerDefeat; root.innerHTML = `<main class="summary-shell"><p class="eyebrow">假面舞会余兴 // 最终结果</p><img class="summary-character" src="${image}" alt="${imageAlt}" /><p class="kicker">${escaped ? "博士提前离席" : playerWon ? "今夜的余兴归博士" : "干员拿下了这一局"}</p><h1>${escaped ? "已离席" : playerWon ? "博士胜利" : "博士落败"}</h1><p class="summary-copy">${escapeHtml(summaryCopy)}</p>${actionButton("返回舞会大厅", { type: "ACK_MATCH_RESULT" }, state, "primary-button")}</main>`; wireActions(root, (action) => { requestDispatch(action); if (action.type === "ACK_MATCH_RESULT") void returnToLobby(); }); }
async function returnToLobby(): Promise<void> { if (!autosave) return; await autosave.flush(); save = autosave.getSave(); const match = autosave.getState(); const winner = match.outcome?.winner ?? null; const escaped = match.outcome?.reason === "escaped"; const unlockedSkillIds = addUnlockedSkills(save.profile.unlockedSkillIds, match.opponentId, winner, escaped); const newlyUnlocked = unlockedSkillIds.filter((id) => !save.profile.unlockedSkillIds.includes(id)); save = { ...save, profile: { ...save.profile, matchesPlayed: save.profile.matchesPlayed + 1, wins: save.profile.wins + (winner === "player" && !escaped ? 1 : 0), unlockedSkillIds }, updatedAt: new Date().toISOString() }; await repository.save(save); autosave = null; renderLobby(); if (newlyUnlocked.length) window.setTimeout(() => window.alert(`已解锁技能：${newlyUnlocked.map((id) => getSkillDefinition(id)?.name ?? id).join("、")}`), 0); }
function renderError(error: unknown): void {
  clearAiSchedule();
  const invalidSave = error instanceof SaveValidationError;
  root.innerHTML = `<main class="error-shell"><p class="kicker">牌桌暂时离线</p><h1>出现了<br><em>意外回合</em></h1><p>${escapeHtml(uiError(error, "游戏无法启动。"))}</p><button class="primary-button" data-retry>重试</button>${invalidSave ? `<button class="secondary-button" data-export-invalid>导出存档</button><button class="danger-button" data-reset-invalid>清理数据</button><p class="status-line" id="error-status" role="status"></p>` : ""}</main>`;
  root.querySelector("[data-retry]")?.addEventListener("click", () => void boot());
  if (!invalidSave) return;
  root.querySelector<HTMLButtonElement>("[data-export-invalid]")?.addEventListener("click", () => void (async () => {
    const status = root.querySelector<HTMLParagraphElement>("#error-status");
    try {
      const raw = await repository.loadRaw();
      if (raw == null) throw new Error("没有找到可导出的原始存档。");
      const method = await downloadRawSave(raw);
      if (status) status.textContent = method === "file-system-access" ? "原始存档已写入。" : "已开始下载原始存档。";
    } catch (exportError) { if (status) status.textContent = exportError instanceof Error ? exportError.message : "原始存档导出失败。"; }
  })());
  root.querySelector<HTMLButtonElement>("[data-reset-invalid]")?.addEventListener("click", () => { if (confirmResetCurrentData()) void resetCurrentData(); });
}
async function boot(): Promise<void> { clearAiSchedule(); root.innerHTML = `<main class="loading-shell"><span class="mark">✦</span><p>正在洗牌……</p></main>`; try { save = await bootLoad(repository); document.body.classList.toggle("reduced-motion", save.settings.reducedMotion); gameAudio.configure(save.settings.soundEnabled); gameAudio.preload(); const unlockAudio = () => { gameAudio.unlock(); const state = autosave?.getState(); if (state) syncMatchAudioState(gameAudio, state); }; document.addEventListener("pointerdown", unlockAudio, { capture: true, once: true }); document.addEventListener("keydown", unlockAudio, { capture: true, once: true }); document.addEventListener("visibilitychange", () => { if (document.hidden) gameAudio.pauseBgm(); else gameAudio.restoreBgm(); }); void requestPersistentStorage(); if (save.activeMatch) await resumeMatch(save.activeMatch); else renderLobby(); } catch (error) { renderError(error); } }
void boot();
