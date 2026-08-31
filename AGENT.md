# 项目总提示词：Android 优先的日式二次元 PWA 黑杰克 × 俄罗斯轮盘小游戏

你正在开发一个**周末规模、纯 vibe coding、Android 客户端优先**的单机 PWA 小游戏。

请将以下内容视为本项目当前版本的 **Game Design Contract + Architecture Contract**。

你的首要目标是：

1. 快速做出可玩的 MVP。
2. 保持领域逻辑清晰、确定性强、容易调试。
3. 不进行不必要的工程复杂化。
4. 保持角色、技能、战利品陈列室和未来处刑室可继续扩展。
5. 优先保证 Android Chrome / 安装为 PWA 后的体验。
6. 所有核心游戏逻辑必须能够脱离 DOM 独立运行和测试。
7. 不要擅自修改已经确定的游戏规则。如果发现规则冲突或确实缺少定义，应采用最小、最符合现有设计的实现，并在代码注释或 TODO 中明确标记。

---

# 1. 产品概述

这是一个以：

**黑杰克 + 填弹式俄罗斯轮盘 + 技能卡 + 角色对战**

为核心的单机小游戏。

整体视觉为：

**简洁、清晰的日式二次元手游视觉。**

本项目是《明日方舟》的非商业同人小游戏。示范角色为 W，人物外观以用户提供的参考图为准；不要直接搬运或解包原作游戏素材，项目内使用重新绘制的同人立绘与场景。

剧情定位：玩家是干员们熟悉的“博士”，不是初次见面的陌生赌客。整场牌局是假面舞会中的余兴节目；牌、真实 7mm 左轮、昏迷与败北姿态构成危险而夸张的演出。大厅、说明、角色档案、对话和结算文案必须始终符合这一前提。

注意：

* 人脸、眼睛、表情和动作必须清楚可辨。
* 人物采用半身立绘，自然位于牌桌之后，并通过撑桌、持道具、倒在桌上等姿势建立前后层次。
* 画面保持简洁，不追求过度繁复的服饰细节或特效堆叠。
* UI、牌桌和人物需要共享统一的色彩、光照与二次元游戏视觉语言。
* 面向玩家的 UI 文案一律使用中文；Hit、Stand 等约定俗成的牌桌术语可保留英文并附中文。

项目主要目标设备是：

**竖屏 Android 手机。**

这是单机游戏。

不存在：

* 登录
* 联机
* 云同步
* 排行榜
* PvP
* 服务器权威状态
* 反作弊

---

# 2. 技术栈

使用：

* Vite
* TypeScript
* 原生 DOM
* 原生 CSS
* IndexedDB
* Dexie
* Zod
* vite-plugin-pwa

不要引入 React、Vue、Svelte、Phaser 或其他游戏引擎。

除非确实发现浏览器兼容问题，否则不要引入大型状态管理框架。

原则：

> DOM + CSS 负责表现。
> TypeScript 领域层负责游戏。

可以按需使用轻量音频库，但 MVP 中音频系统也可以先自行封装 HTMLAudioElement。

---

# 3. 不要建设真正的后端

这个项目当前不需要业务服务器。

部署结构应理解为：

```text
Static Host / CDN
│
├── HTML
├── JS
├── CSS
├── PWA Manifest
├── Service Worker
└── Assets
```

可以部署到任意静态托管服务。

核心游戏在浏览器本地完成：

* 所有规则计算
* 所有 AI 决策
* RNG
* 游戏状态
* 存档
* 角色状态
* 技能状态

所谓“后端提供资源”，MVP 实际上只需要静态资源托管。

---

# 4. PWA 与离线要求

游戏应该可以安装为 PWA。

核心资源需要加入离线缓存。

至少包括：

* HTML / JS / CSS
* 基础 UI
* 扑克牌素材
* 第一个角色
* 桌面
* 基础图标
* 核心音效（如果已有）

目标是：

> 玩家已经打开过游戏后，即使没有网络，也可以继续完整进行游戏。

使用 vite-plugin-pwa / Workbox 完成这一层。

---

# 5. 顶层页面状态机

完整设计最终有三个顶层场景：

```ts
type AppScene =
  | "lobby"
  | "match"
  | "trophy-room";
```

分别为：

1. 游戏大厅 Lobby
2. 对局 Match
3. 战利品陈列室 Trophy Room

当前版本真正实现 Lobby、Match/Table 和 Trophy Room。

Trophy Room 是本地历史对局查看器：从主菜单进入，按新到旧显示结果。博士胜利的记录使用该角色独立的横版平躺败北图；失败或离席记录暂时使用透明图像占位。点击记录必须打开 Modal，显示最终双方左轮子弹数/容量、双方爆牌次数和双方黑杰克次数，不能使用卡片内展开。

不要使用前端 URL Router 来表示游戏状态。

场景切换属于应用状态机。

---

# 6. 对局内部场景

Match 最终有：

```ts
type MatchView =
  | "table"
  | "execution-room"
  | "match-summary";
```

其中：

## table

牌桌。

这是当前 MVP 的核心玩法。

## execution-room

处刑室。

未来版本的重要演出场景。

MVP 不需要完整制作。

当前轮盘开枪效果可以直接在 Table 里通过 overlay / animation 表现。

但架构必须允许未来：

```text
Table
↓
Execution Room
↓
Table / Match End
```

而无需修改底层 Roulette 规则。

## match-summary

对局结束后的结果页面。

这一层非常重要。

**Match 不允许直接跳回 Lobby。**

必须：

```text
MATCH
↓
MATCH_FINISHED
↓
MATCH_SUMMARY
↓
玩家确认结果
↓
LOBBY
```

无论：

* 玩家胜利
* 玩家失败
* 玩家逃跑

都必须经过 Match Summary。

不存在合法状态：

```text
ACTIVE MATCH
→
LOBBY
```

---

# 7. 强退与恢复

因为是单机 PWA：

如果玩家正在进行 Match，然后：

* 关闭浏览器
* 杀掉 App
* 手机重启

下一次启动后应该恢复正在进行的 Match。

启动逻辑：

```text
BOOT
↓
load save

activeMatch exists?
├── YES → restore Match
└── NO  → Lobby
```

不要因为刷新页面而结束对局。

---

# 8. Lobby MVP

Lobby 是：

* 游戏主菜单
* 玩家第一次进入游戏看到的界面

MVP 包括：

## 简单说明书

一个非常短的规则说明入口。

可以是按钮：

```text
玩法说明
```

点击弹出说明窗口。

说明：

* 黑杰克基础目标
* Hit
* Stand
* 黑杰克
* 爆牌
* 俄罗斯轮盘惩罚
* 技能卡

不要设计复杂教程系统。

## 对战对象选择

显示可选角色。

当前版本提供 **W 与德克萨斯两个角色**，以后继续通过 CharacterDefinition 扩展。

每个角色卡显示：

* 头像
* 名字
* Tier
* 简短称号

点击角色：

弹出角色介绍 Modal。

显示：

* 更大的角色头像
* 名字
* Tier
* 人物简介
* 开始对战按钮

按钮：

```text
开始对局
```

随后创建新的 Match。

未来增加角色必须主要通过增加 CharacterDefinition 实现，而不需要修改 Lobby 业务逻辑。

---

# 9. 角色必须 Data Driven

禁止出现：

```ts
if (character === "foo") { ... }
if (character === "bar") { ... }
```

这种角色特判。

建议：

```ts
interface CharacterDefinition {
  id: string;

  name: string;
  subtitle?: string;

  tier: Tier;

  description: string;

  assets: CharacterAssets;

  // 校准共享工作人员 7mm 左轮图层，使枪口对准该角色受胁迫立绘的太阳穴
  revolverPlacement: {
    top: number;
    left: number;
    mobileTop: number;
    mobileLeft: number;
  };

  ai: CharacterAiProfile;

  dialogue: CharacterDialogue;
}
```

大厅与牌桌角色目录：

```text
src/content/characters/
├── types.ts                 # 元数据、完整定义与 W 牌桌基准类型
├── catalog.json             # defaultCharacterId 与可索引角色元数据
├── catalog.ts               # Zod 校验、冻结目录与 O(1) metadata 查找
├── loader.ts                # 按 dataFile 动态加载 JSON 并缓存完整 definition
├── data/
│   ├── w.json               # W 完整 AI、对白与牌桌资源
│   └── texas.json           # 德克萨斯完整 AI、对白与牌桌资源
└── index.ts                 # 仅导出 catalog/loader/types，不静态导出完整角色
```

`catalog.json` 只包含大厅、档案和历史索引所需元数据及安全的 `dataFile` basename；牌桌、AI、对白和完整结算资源必须通过 `loadCharacter(id)` 按需加载。loader 使用 `import.meta.glob("./data/*.json")`，组合并运行时校验 JSON，未知 id、路径穿越、未知对白事件和空对白必须拒绝；definition 与 metadata 的 id 必须一致，默认角色由 `defaultCharacterId` 指定。W 是固定牌桌美术金样本：参考画布为 1536×1024，常规横向坐姿使用统一 scale 1 的布局，其他角色不得提供 portraitScale 覆盖入口。

后续增加角色应该主要是：

```text
新增 catalog 元数据与 data/<id>.json
+
新增美术资源
+
在 JSON 中新增对白
```

而不是修改 Game Core。

对白维护台位于 `tools/dialogue-admin/`，使用 Node 内建 HTTP/FS 模块直接编辑角色 data JSON：运行 `npm run dialogue:admin`，默认端口 4174。它优先绑定名称包含 `tailscale` 的非内部 IPv4，找不到时回退并提示 `127.0.0.1`；可用 `--host`、`--port` 或对应环境变量覆盖。该入口只供开发维护，不是游戏公开页面，不部署 HTTPS。

---

# 10. 当前样例角色

首个示范角色使用《明日方舟》的 W，并以用户提供的参考图为视觉依据重新绘制同人立绘。第二个角色为德克萨斯：理性程度更高、个性要牌倾向更低，语气和表情均比 W 沉稳克制。

角色应该具有：

* 明确名字
* 明确 Tier
* 非常鲜明的性格
* 足够测试 AI personality 系统
* 多种表情与动作状态
* 一套简短但有特色的对局对白

建议让 MVP 角色偏鲁莽，这样比较容易肉眼观察性格 AI 是否生效。

例如可以采用：

```text
Tier: B
Rationality: 0.80
Recklessness: 1.00
```

角色立绘至少包括：轻松、纠结、嘲笑、被工作人员从画面外以 7mm 左轮抵住太阳穴时的紧张状态，以及双眼上翻、上身微微后仰的牌桌昏迷状态。除一两张具有明确特殊用途的结算或陈列图外，常规牌桌立绘必须以横向半身坐姿为主：身体重心落在座位后，手臂自然靠近桌沿，但透明资源中不画出椅子或桌子。牌桌昏迷立绘同样不得增加椅子、桌子或其他状态立绘中没有的家具。每名角色还必须拥有一张独立的胜利结算专用立绘：角色全身无力地瘫坐在椅子上、人物和椅子均完整可见；这张图只能用于博士最终获胜后的 Match Summary，不得替代牌桌状态立绘。另需一张 16:4.5 的超宽败北图供 Trophy Room 的胜利记录使用，角色应全身仰躺在窄棺木式工业收纳舱中。扳机状态使用独立、可复用的“工作人员手 + 深色钢制 7mm 左轮”透明图层；工作人员使用中性灰白制服，枪口从画面右侧朝向当前受罚角色的太阳穴，角色本人不得持枪。

对白需符合 W 轻佻、危险、爱看热闹的气质，但不得直接复制原作台词。

---

# 11. MatchState

核心 MatchState 应类似：

```ts
interface MatchState {
  id: string;

  seed: string;

  opponentId: string;

  status:
    | "active"
    | "finished";

  view: MatchView;

  roundIndex: number;

  player: ParticipantState;

  opponent: ParticipantState;

  shoe: ShoeState;

  roulette: RouletteState;

  skills: SkillInventory;

  round: RoundState | null;

  outcome?: MatchOutcome;

  history: GameEvent[];
}
```

双方的 Blackjack 状态尽可能保持对称。

不要因为 AI 是 NPC 就创造完全不同的牌局数据结构。

区别应该主要体现在：

```text
PLAYER
→ 可以使用技能

OPPONENT
→ 使用 AI Brain
```

---

# 12. Game Core 必须是纯 TypeScript

核心架构原则：

```text
GameState
↓
Action
↓
Reducer
↓
Next GameState
```

例如：

```ts
const nextState =
  gameReducer(state, action);
```

UI 不能直接修改 GameState。

DOM 事件只能：

```ts
dispatch({
  type: "PLAYER_HIT"
});
```

禁止：

```ts
state.player.cards.push(...)
```

---

# 13. Core 层禁止依赖 UI

建议目录：

```text
src/
├── core/
│   ├── app/
│   ├── match/
│   ├── blackjack/
│   ├── roulette/
│   ├── skills/
│   ├── ai/
│   └── rng/
│
├── content/
│   ├── characters/
│   └── skills/
│
├── dialogue/
│
├── ui/
│   ├── lobby/
│   ├── table/
│   └── components/
│
├── persistence/
│
├── assets/
│
├── app.ts
└── main.ts
```

硬性规则：

```text
src/core/**
```

不得 import：

* src/ui/**
* DOM API
* document
* window
* HTMLElement
* CSS
* Dexie
* Audio
* setTimeout
* setInterval

Core 应该可以在 Node / Test Runner 中独立运行。

---

# 14. Blackjack 核心规则

这是一个受到 Blackjack 启发、但规则已经修改过的游戏。

不要默认按照赌场规则擅自添加功能。

## 不存在 Split

MVP 永远不显示 Split。

## 暂时不存在 Double Down

当前只实现：

* HIT
* STAND

不要增加 DOUBLE。

## 初始牌

每轮开始：

玩家和 AI 各自获得两张牌：

```text
1 张公开牌
+
1 张私人牌
```

即：

PLAYER：

```text
public
private
```

OPPONENT：

```text
public
private
```

“private”表示：

> 牌的主人知道，对方不知道。

玩家自己的 private card 必须对玩家显示。

不要把 private 错误实现成“自己也看不到”。

---

# 15. Hit 规则

每次 HIT：

获得一张新的：

```text
private card
```

牌的主人知道。

对方不知道。

HIT 后立即进行：

* Bust 判定
* 21 点判定

如果：

```text
value > 21
```

则 Bust。

如果：

```text
value === 21
```

则自动 Stand。

不要允许 21 后继续 Hit。

---

# 16. Blackjack 与 21 必须区分

Blackjack：

```text
初始两张牌
+
点数正好 21
```

例如：

```ts
function isBlackjack(hand: Hand): boolean {
  return hand.cards.length === 2
    && handValue(hand) === 21;
}
```

下面这种：

```text
7 + 5 + 9 = 21
```

只是 21。

不是 Blackjack。

这个区别会影响：

* 轮盘惩罚
* 技能奖励
* 对话
* UI

---

# 17. 初始 Blackjack 判定

发完双方两张初始牌后：

立即执行：

```text
INITIAL_BLACKJACK_CHECK
```

情况：

## 双方都 Blackjack

平局。

双方都：

* 不加子弹
* 不扣扳机
* 不获得 Blackjack 胜利奖励

先开牌、显示平局原因并等待玩家确认，然后进入下一轮。

## 玩家 Blackjack，AI 没有

玩家立即赢得本轮。

AI：

```text
+2 bullets
↓
开牌并说明结果
↓
玩家点击“静观好戏”
↓
AI trigger roulette
```

玩家获得：

```text
2 skill cards
```

## AI Blackjack，玩家没有

AI 立即赢得本轮。

玩家：

```text
+2 bullets
↓
开牌并说明结果
↓
玩家点击“接受判罚”
↓
skill reaction window
↓
trigger roulette
```

玩家不获得技能。

如果 Blackjack 已经决定胜负，则不要进入正常 Hit / Stand 阶段。

---

# 18. 回合行动顺序

每一个 Round：

```text
AI 先手
```

例如：

```text
Round 1:
AI → Player

Round 2:
AI → Player

Round 3:
AI → Player
```

使用一个清晰函数决定：

```ts
getRoundStarter(roundIndex)
```

不要把这个逻辑散落在 UI。

---

# 19. Stand 行为

Stand 是：

```text
本 Round 永久 Stand
```

一旦某人 Stand：

这个 Round 中不再获得行动。

例如：

```text
AI STAND
↓
PLAYER HIT
↓
AI 已经 stood，跳过
↓
PLAYER HIT
↓
PLAYER STAND
↓
双方比较
```

不是每一个行动循环都重新询问 AI 是否 Stand。

---

# 20. 正常 Round 结束

正常情况下：

只有双方都：

```text
STAND
```

才进行大小比较。

特殊情况 Bust 可以立即决定 Round 胜负。

比较 Blackjack hand value。

胜者不承担枪械惩罚。

输家：

```text
+1 bullet
↓
trigger roulette
```

如果平局：

```text
没人加子弹
没人扣扳机
```

无论谁赢或平局，Round 结果确定后都必须先：

```text
翻开双方私人牌
↓
显示双方点数、胜负原因和装填结果
↓
等待玩家交互
```

玩家赢时，这个确认按钮显示“静观好戏”，一次点击直接进入对手对自己进行轮盘判定的悬念演出，不要再次要求点击同名按钮。玩家输时，确认后才进入反应技能窗口，再由玩家点击“扣下扳机”。

任何扳机判定完成后都不能自动进入下一轮或对局总结；必须停留在判定结果画面。空枪时按钮变为“下一轮”，命中时按钮变为“查看结局”。

---

# 21. RoundOutcome 统一结算

不要把胜负、奖励、子弹惩罚逻辑散在 UI / AI / Hit / Stand 中。

创建统一纯函数，例如：

```ts
resolveRound(...)
```

结果结构建议：

```ts
interface RoundOutcome {
  winner:
    | "player"
    | "opponent"
    | null;

  reason:
    | "blackjack"
    | "bust"
    | "comparison"
    | "push";

  penaltyTarget:
    | "player"
    | "opponent"
    | null;

  bulletsAdded: number;

  playerSkillReward: number;
}
```

例如：

普通玩家胜利：

```text
winner = player
bulletsAdded = 1 to opponent
playerSkillReward = 1
```

玩家 Blackjack：

```text
winner = player
bulletsAdded = 2 to opponent
playerSkillReward = 2
```

平局：

```text
winner = null
bulletsAdded = 0
playerSkillReward = 0
```

---

# 22. 俄罗斯轮盘规则

MVP 使用简单的：

**填弹模型。**

不要模拟弹巢具体槽位。

使用：

```ts
interface GunState {
  capacity: number;
  bullets: number;
}
```

默认：

```text
capacity = 6
```

当一方输掉普通 Round：

```text
bullets += 1
```

Blackjack 输：

```text
bullets += 2
```

最多不超过 capacity。

随后扣动扳机。

MVP 概率：

```text
deathProbability =
  bullets / capacity
```

也就是说：

```text
1 / 6
2 / 6
3 / 6
...
```

存活后：

**枪内子弹不清空。**

风险会在 Match 中不断累积。

---

# 23. 玩家轮盘反应窗口

如果 PLAYER 输掉 Round：

顺序：

```text
Player loses
↓
add bullets
↓
ROULETTE_REACTION
↓
玩家有机会使用允许此时使用的技能
↓
trigger roulette
```

这使得例如：

```text
移除一颗子弹
```

这种技能具有意义。

AI 不能使用技能。

如果 AI 输：

```text
AI loses
↓
add bullets
↓
直接 trigger roulette
```

---

# 24. 对局结束

如果 Roulette 判定某一方死亡：

Match 结束。

可能结果：

```ts
type MatchEndReason =
  | "player-killed"
  | "opponent-killed"
  | "escaped";
```

然后：

```text
MATCH_FINISHED
↓
MATCH_SUMMARY
```

之后玩家主动确认：

```text
ACK_MATCH_RESULT
```

才回到 Lobby。

---

# 25. 玩家可以逃跑

架构必须支持：

```text
ESCAPE_MATCH
```

逃跑也：

```text
MATCH
↓
MATCH_SUMMARY
↓
LOBBY
```

不要直接切 Lobby。

MVP UI 可以把逃跑按钮放在设置 / 菜单里，不需要突出展示。

---

# 26. 技能卡系统

AI 不能使用任何技能。

技能只属于玩家。

## Match 开始

玩家随机获得：

```text
1 skill card
```

## 玩家普通获胜

获得：

```text
1 skill card
```

包括：

* 比大小胜利
* 对手 Bust 导致的胜利

## 玩家 Blackjack

获得：

```text
2 skill cards
```

如果双方 Blackjack 平局则不奖励。

技能属于：

```text
Match-local resources
```

Match 结束后清空。

不是永久库存。

未来永久成长可以通过：

```text
解锁新的 Skill Definition 进入随机池
```

实现。

---

# 27. MVP 技能

至少实现两个技能，证明系统可扩展。

## 技能 A：移除子弹

例如：

```text
从自己的枪中移除一颗子弹。
```

可以在：

```text
roulette-reaction
```

使用。

不能把子弹减成负数。

## 技能 B：窥视下一张牌

例如：

```text
查看牌库的下一张牌。
```

只能对玩家展示。

不能改变牌库顺序。

AI 不应该因为玩家使用该技能而获得这条信息。

---

# 28. 技能系统 Data Driven

不要给每张技能创建任意 JS callback。

优先使用：

```ts
type SkillEffect =
  | {
      type: "remove-bullet";
      amount: number;
    }
  | {
      type: "peek-next-card";
      count: number;
    };
```

SkillDefinition：

```ts
interface SkillDefinition {
  id: string;
  name: string;
  description: string;

  timing: SkillTiming[];

  effect: SkillEffect;
}
```

统一：

```ts
applySkillEffect(...)
```

这样以后可以快速增加很多技能，而不会破坏 Core。

---

# 29. 牌库

建议整个 Match 使用同一个 Shoe。

例如：

```ts
interface ShoeState {
  cards: Card[];
  cursor: number;
  shuffleIndex: number;
}
```

Match 开始时创建并洗牌。

Round 结束后：

继续使用剩余牌。

这意味着：

```text
查看下一张牌
```

是真实且有长期价值的信息。

当剩余牌数不足以安全开始下一 Round 时：

在下一 Round 发牌前重新洗牌。

例如可以使用：

```text
remaining < 12
```

作为 MVP 阈值。

不要在 Round 中途突然洗牌。

---

# 30. 扑克牌数据

Card 应该是纯逻辑数据，例如：

```ts
interface Card {
  suit:
    | "spades"
    | "hearts"
    | "diamonds"
    | "clubs";

  rank:
    | "A"
    | "2"
    | "3"
    | ...
    | "K";
}
```

实现标准 Blackjack Ace：

```text
A 可以是 1 或 11
```

handValue 应自动选择不 Bust 的最大合法点数。

---

# 31. 信息权限非常重要

游戏存在：

```text
public information
private information
```

不要把完整 MatchState 直接交给 AI。

必须创建：

```ts
buildObservation(
  state,
  viewer
)
```

例如真实状态：

```text
PLAYER:
8♠
9♥ private

AI:
10♣
6♦ private
```

PLAYER observation：

```text
PLAYER:
8♠
9♥

AI:
10♣
??
```

AI observation：

```text
PLAYER:
8♠
??

AI:
10♣
6♦
```

---

# 32. AI 不允许作弊

AI 决策函数：

禁止：

```ts
aiDecide(matchState)
```

应该：

```ts
aiDecide(
  buildObservation(
    matchState,
    "opponent"
  )
)
```

AI 不允许知道：

* 玩家 private cards
* 下一张牌
* 未公开牌堆顺序
* Roulette RNG 结果
* 未来随机数
* 玩家技能窥视结果

这必须由架构保证，而不是靠程序员“记得不看”。

---

# 33. AI 分为 Brain 和 Dialogue 两个系统

Opponent：

```text
Opponent
├── Brain
└── Dialogue
```

两个系统禁止互相承担职责。

## Brain

只负责游戏决策：

```text
HIT
STAND
```

## Dialogue

只负责：

* 台词
* 表情
* 情绪演出

不要因为一句台词随机选择而改变 AI 游戏行为。

---

# 34. AI 最优策略说明

注意：

这个游戏并不是标准赌场 Blackjack。

因为这里存在：

* 双方轮流行动
* 双方都有 private cards
* 累积式俄罗斯轮盘
* Blackjack 造成双倍填弹
* Survival utility

因此严格意义上的“数学最优策略”与标准 Blackjack Basic Strategy 并不相同。

MVP 不需要解决真正的全局最优策略。

请设计策略接口：

```ts
interface AiPolicy {
  decideOptimalAction(
    observation: MatchObservation
  ): "hit" | "stand";
}
```

MVP 可以实现：

```text
blackjackHeuristicPolicy
```

作为近似的“理性策略”。

以后应该能够替换成：

```text
survivalExpectedValuePolicy
```

而无需修改 Character 或 UI。

---

# 35. AI Personality 混合公式

角色行为使用：

```text
数学 / 理性策略
+
性格偏好
```

混合。

定义：

```text
optimalHit ∈ {0, 1}
```

如果理性策略认为 HIT：

```text
optimalHit = 1
```

认为 STAND：

```text
optimalHit = 0
```

角色拥有：

```text
rationality ∈ [0,1]
```

以及：

```text
personalityHitProbability ∈ [0,1]
```

例如极度鲁莽：

```text
personalityHitProbability = 1
```

极度保守：

```text
personalityHitProbability = 0
```

最终：

```text
P(HIT) =
    rationality * optimalHit
  + (1 - rationality) * personalityHitProbability
```

例如：

```text
optimal = STAND
optimalHit = 0

Tier B:
rationality = 0.8

extremely reckless:
personalityHitProbability = 1
```

得到：

```text
P(HIT)
=
0 × 0.8
+
1 × 0.2
=
0.20
```

也就是这个角色有 20% 概率违背理性策略继续 Hit。

---

# 36. Tier

MVP 可以使用以下默认 Rationality，全部定义在一个易修改配置中：

```text
D = 0.55
C = 0.70
B = 0.80
A = 0.90
S = 0.97
```

设计原则：

```text
Tier
→ 决定有多经常遵从理性策略

Personality
→ 决定偏离理性策略时偏向什么行为
```

不要把这些数字硬编码散落到项目各处。

---

# 37. AI Decision Debug 信息

AiDecision 最好保存可解释信息：

```ts
interface AiDecision {
  optimalAction:
    | "hit"
    | "stand";

  optimalHit: number;

  personalityHitProbability: number;

  rationality: number;

  finalHitProbability: number;

  roll: number;

  action:
    | "hit"
    | "stand";
}
```

这样 Developer HUD 可以显示：

```text
Optimal: STAND

Rationality:
80%

Personality HIT:
100%

Final P(HIT):
20%

RNG Roll:
14%

Decision:
HIT
```

---

# 38. Dialogue 系统

Dialogue 必须是：

```text
Domain Event
↓
Dialogue Director
↓
Character dialogue pool
↓
选择台词
```

例如事件：

```text
MATCH_START
PLAYER_HIT
PLAYER_STAND
PLAYER_BLACKJACK
OPPONENT_BLACKJACK
PLAYER_BUST
OPPONENT_BUST
PLAYER_SURVIVED_TRIGGER
OPPONENT_SURVIVED_TRIGGER
PLAYER_WIN_ROUND
OPPONENT_WIN_ROUND
MATCH_WIN
MATCH_LOSS
PLAYER_ESCAPE
```

CharacterDefinition 提供对应台词池。

例如：

```ts
dialogue: {
  matchStart: [...],
  playerHit: [...],
  playerBlackjack: [...],
  selfBust: [...]
}
```

不要把对话文本写进 reducer。

---

# 39. Dialogue 不能影响游戏 RNG

随机数必须拆分。

禁止所有系统共享同一个 global RNG。

从 Match seed 派生不同 RNG stream：

```text
match seed
├── deck RNG
├── roulette RNG
├── AI RNG
├── loot RNG
└── dialogue RNG
```

例如：

```ts
const rng = {
  deck: createRng(seed + ":deck"),
  roulette: createRng(seed + ":roulette"),
  ai: createRng(seed + ":ai"),
  loot: createRng(seed + ":loot"),
  dialogue: createRng(seed + ":dialogue")
};
```

目标：

> 添加一句随机对白绝对不能改变后面的发牌、AI 决策或枪是否击发。

---

# 40. RNG 必须可复现

不要直接依赖：

```ts
Math.random()
```

核心随机系统必须是 seeded PRNG。

存档应保存足以恢复确定性游戏的信息。

可以：

* 保存 seed + RNG state
* 或保存已经 shuffle 后的 deck 和 cursor
* roulette / AI / loot 也保存各自 RNG state

目标是：

相同存档 + 相同行动：

```text
得到相同结果。
```

这对于 vibe coding debug 非常重要。

---

# 41. Domain Events

核心逻辑建议产生 Event：

```ts
type GameEvent =
  | ...
```

例如：

```text
ROUND_STARTED
CARD_DEALT
PLAYER_HIT
OPPONENT_HIT
PLAYER_STOOD
OPPONENT_STOOD
BLACKJACK
BUST
ROUND_RESOLVED
BULLET_ADDED
TRIGGER_PULLED
TRIGGER_SURVIVED
PARTICIPANT_KILLED
SKILL_GAINED
SKILL_USED
MATCH_FINISHED
```

这些 Event 可以供：

* Dialogue
* Presentation
* Debugger
* History
* Replay

使用。

Reducer 仍然负责真正状态。

---

# 42. UI 与 Presentation 分离

DOM Renderer：

负责根据当前 state 显示正确内容。

Animation / Presentation Controller：

负责：

* 发牌动画
* 翻牌
* 对话出现
* screen shake
* delay
* 音效
* 枪击演出

Core 不知道动画。

建议流程：

```text
Action
↓
Reducer
↓
New State
↓
Renderer
+
Presentation Controller
```

---

# 43. 禁止在 Reducer 中执行异步演出

绝对不要：

```ts
case "PLAYER_STAND":
  setTimeout(...)
```

Reducer 必须 pure。

AI 行动仍必须由显式合法动作调度，但调度者是 Presentation Controller：

```text
发牌完成或行动权交给 AI
↓
启动确定性的 2–4 秒表现层等待
↓
等待中点只切换一次角色姿态，不修改 MatchState
↓
等待结束后 dispatch(AI_TURN)
↓
只计算并执行一次 AI_HIT 或 AI_STAND
↓
render
```

一次调度最多只能产生一次 AI 动作。即使玩家已经 Stand、AI Hit 后仍是 AI 行动，也必须重新开始一段新的 2–4 秒等待，禁止一个计时器递归推进多个 AI 动作。

“观察牌面”只能是短暂的 Presentation 文案与一次姿态切换，不能成为 RoundPhase、持久化状态或领域状态机。只有本节定义的单次等待控制器可以在结束后派发一个 AI_TURN；离开牌桌、读档或行动权变化时必须取消旧计时器。

游戏逻辑时间和表现时间必须分离。

---

# 44. Table MVP 布局

手机竖屏。

可以采用：

```text
┌─────────────────────────┐
│ Character Name   Tier B │
│ portrait / expression   │
│ dialogue                │
│                         │
│     AI CARDS            │
│    10   ??   ??         │
│                         │
│    AI Gun: ●●○○○○       │
│                         │
│ ─────── TABLE ────────  │
│                         │
│ Player Gun: ●○○○○○      │
│                         │
│   PLAYER CARDS          │
│    8    7    3          │
│                         │
│ [skill] [skill] [skill] │
│                         │
│      HIT      STAND      │
└─────────────────────────┘
```

这是概念布局，不要求机械照搬。

重点：

* AI 角色必须是桌面的视觉核心之一。
* 角色表情和台词存在感明显。
* 牌桌仍然是信息最重要的区域。
* 操作按钮需要适合手指。
* 不要制作拥挤的小尺寸 PC UI。

---

# 45. Android 优先布局

以 Android 竖屏优先。

建议 CSS 设计基准约：

```text
390 × 844
```

但必须响应式。

需要考虑：

```css
env(safe-area-inset-top)
env(safe-area-inset-bottom)
```

按钮需要大触控区域。

不要设计：

* hover 才能发现的信息
* 很细小的按钮
* 依赖鼠标右键
* PC 优先横屏布局

桌面浏览器只需要正常可玩，不是第一优先级。

---

# 46. 视觉风格：简洁的日式二次元手游

美术统一方向：

**高清日式二次元角色立绘 + 有空间层次的竖屏牌桌。**

关键词：

```text
anime game illustration
clean expressive character art
clear facial features
expressive eyes
readable facial expression
controlled linework
restrained but rich palette
warm dramatic lighting
mobile game composition
layered card-table staging
```

目标：

* 人物是牌桌后的视觉主体，使用清晰的半身立绘。
* 牌桌前缘必须可见，牌、枪膛和操作区落在明确的桌面空间内。
* 人物、桌面、背景之间有自然遮挡关系；撑桌、侧身、轻微后仰等姿势能改变画面层次。
* 表情和姿势变化明确，但整体用色、线条和光照稳定一致。

避免：

```text
模糊或低清的面部
写实照片质感
过度繁复的服饰纹理
特效遮挡人物表情
人物悬浮在桌面前方
拥挤的小尺寸 PC 游戏界面
```

---

# 47. GPT Image 2 美术工作流

所有主要同人美术计划使用图像生成工具制作，并将用户提供的角色图片作为参考。

它主要负责：

```text
Art Direction
Concept Art
Character Source Art
Expression Source
Environment Source
Decorative UI Source
```

最终美术需要可复现的裁切、透明背景检查和尺寸处理。

---

# 48. 必须先建立 Master Art Direction Sheet

在批量制作角色之前，首先制作一份：

```text
MASTER STYLE SHEET
```

定义：

* 人物比例
* 脸部画法
* 眼睛比例
* 头发表现
* 线条粗细与收束方式
* 明暗层级
* 主光方向
* 轮廓光
* palette
* 桌面透视
* 卡牌尺寸
* UI border
* 按钮风格
* icon 风格
* portrait framing
* expression intensity
* 枪械图标风格
* 对话框风格

后续生成角色时，将 Style Sheet 作为 image reference。

要求：

```text
保持人物风格、光照、清晰度、比例和 UI 语言一致。
```

---

# 49. MVP 需要的美术资源

制作 Lobby、Table、Match Summary 与 Trophy Room 所需资源。

至少需要：

## Character

当前角色 W 与德克萨斯：

* 轻松：默认状态，以坐姿自然撑在桌边
* 纠结：思考手牌或高压状态
* 嘲笑：玩家失误或 W 赢下一轮
* 被瞄准：工作人员从画面右侧将 7mm 左轮抵近角色太阳穴，角色双手保持低位并显得紧张；德克萨斯的紧张表现可以更克制
* 昏迷：双眼上翻、上身微微后仰，不增加椅子、桌子或其他家具

人物身份、服装、比例、线条和光照必须在所有状态间保持一致。除结算和陈列等少量特殊图外，常规状态统一使用横向半身坐姿，并严格以 W 的 1536×1024、scale 1 构图为牌桌基准；其他角色不得增加可变 portraitScale 入口。立绘应优先使用透明背景；扳机演出使用“被瞄准的紧张人物立绘 + 独立工作人员手持深色钢制 7mm 左轮”的 DOM 分层组合，工作人员图层应为中性灰白制服并可跨角色复用；每名角色必须通过 `CharacterDefinition.revolverPlacement` 的 `top`、`left`、`mobileTop`、`mobileLeft` 分别校准桌面与窄屏道具，使枪口准确贴合该角色 threatened 立绘的太阳穴。`.trigger-prop` 必须位于角色立绘之上（明确更高 z-index，避免被角色缩放堆叠上下文遮挡），但不得遮挡对话可读性；合成后的枪口只能朝向当前受罚角色的太阳穴，不能朝博士或第三者。

## Table

* 原创牌桌背景
* 桌面纹理
* 背景环境
* 角色所在区域

## Cards

AI 可以制作：

* card frame
* card back
* decorative suit style reference

但不要让 Image Model 生成完整 52 张有具体数字和花色的牌。

## Roulette

* revolver / chamber indicator 图形
* bullet icon
* muzzle flash / impact source art

## UI

* panel frame
* dialog frame
* button frame
* tier badge
* skill card frame
* modal frame
* decorative divider
* basic icons

---

# 50. 52 张牌必须程序化生成

不要使用 GPT Image 2 分别生成：

```text
A♥
2♥
...
K♠
```

AI 很容易生成错误：

* 数字错误
* 花色数量错误
* 左右标记不一致
* 字符变形

应该：

```text
Card Frame
+
Rank Glyph
+
Suit Glyph
```

通过 HTML/CSS/DOM 组合。

这也意味着：

* 牌面永远准确
* 可以换皮
* 可以做无障碍
* 可以动态放大

---

# 51. 美术资源后处理

为美术建立：

```text
tools/art/
```

概念 pipeline：

```text
GPT Image 2 Source
↓
crop
↓
background cleanup
↓
controlled resize
↓
palette / contrast adjustment if required
↓
manual review
↓
final web asset
```

不要进行不可控的自动滤镜堆叠。

人物立绘需要保留平滑透明边缘、清晰五官和稳定线条。缩放时使用浏览器默认高质量采样，不添加颗粒滤镜、网点滤镜或人为锯齿。

---

# 52. Animation 原则

这个游戏的“游戏感”很大一部分来自微动画，而不是复杂引擎。

重点实现：

## 发牌

```text
card leaves deck
↓
translate + slight rotate
↓
lands
↓
tiny impact
```

## Flip

private / reveal 时使用简短 flip。

## Hit

快速、明确。

## 21

有：

* 短暂停顿
* 视觉强调
* 音效 hook

## Bust

有：

* 卡牌 / 点数强调
* 角色 reaction
* 轻微 screen shake

## Bullet Added

明确看到：

```text
○ → ●
```

## Trigger

需要明显 suspense：

```text
pause
↓
trigger
↓
click OR fire
```

不要因为是 DOM 就让整个体验看起来像普通网页。

---

# 53. Character Dialogue 演出

AI 决策不是生成式大模型运行时调用。

MVP 不需要连接任何 LLM API。

角色台词是静态 Content。

Dialogue Director 根据局势选择。

对话应该：

* 短
* 有角色性格
* 不频繁遮挡操作
* 一眼能读完
* 适合手机

同一个 Event 应提供多条变体，避免重复感。

---

# 54. Lobby UI 美术

Lobby 应该具有游戏大厅感，而不是传统 Web Dashboard。

需要：

* 明确 Logo / Title 区
* 角色选择视觉区域
* Tier badge
* character card
* How To Play
* Trophy Room 历史对局入口与记录数量
* 简洁设置入口

不要出现：

* 企业 Web 风格 sidebar
* Bootstrap dashboard
* Material Design 普通列表
* 过多文字
* 大面积纯白网页

---

# 55. 存档

使用：

```text
Dexie + IndexedDB
```

不要使用 localStorage 保存完整游戏。

可以使用 localStorage 保存极小、不重要、可丢失的 UI preference，但没有必要。

---

# 56. 存档结构必须版本化

例如：

```ts
interface SaveFile {
  format: "project-save";
  schemaVersion: number;
  gameVersion: string;

  createdAt: string;
  updatedAt: string;

  profile: PlayerProfile;

  activeMatch: MatchState | null;

  settings: GameSettings;
}
```

具体 format 名称可以根据最终项目名调整。

但必须有：

```text
schemaVersion
```

---

# 57. Zod 验证与 Migration

导入存档：

```text
JSON
↓
Zod Validation
↓
Migration
↓
Current Save Schema
```

预留：

```ts
migrateV1ToV2()
```

之类结构。

未来 schema 改动不能直接让旧档损坏。

---

# 58. 自动存档

重要领域状态变化后自动保存。

例如：

* Match start
* Hit
* Stand
* Skill use
* Round resolved
* Roulette result
* Reward obtained
* Match finished

无需每一帧保存。

DOM animation progress 不保存。

---

# 59. 不保存 Presentation State

保存：

* deck
* cards
* RNG
* current phase
* gun bullets
* skills
* Match outcome
* profile
* unlocked content

不保存：

* 卡牌当前 CSS x/y
* tween progress
* screen shake
* 粒子
* DOM 节点
* animation frame
* Modal transition progress

恢复：

```text
Domain State
↓
重新 render UI
```

---

# 60. Persistent Storage

PWA 启动并正常运行后，可以尝试：

```ts
navigator.storage.persist()
```

将其封装为 capability。

失败不能影响游戏。

不要在第一次打开页面时制造恼人的权限 UX。

---

# 61. 导出 / 导入进度

必须提供：

```text
Export Save
Import Save
```

导出的文件为 JSON。

例如：

```text
game-save-2026-xx-xx.json
```

优先尝试浏览器支持的 File System Access 能力。

如果不可用：

使用：

```text
Blob
+
download
```

fallback。

不要让 File System Access 成为游戏启动条件。

---

# 62. Save Repository 抽象

定义：

```ts
interface SaveRepository {
  load(): Promise<SaveFile | null>;
  save(save: SaveFile): Promise<void>;
}
```

例如：

```text
IndexedDbSaveRepository
JsonFileExporter
JsonFileImporter
```

未来如果套 Capacitor：

可以再增加：

```text
NativeSaveRepository
```

而不用修改 Game Core。

---

# 63. Developer HUD

开发模式必须实现 Developer HUD。

生产模式默认关闭。

至少显示：

```text
seed

round index

round phase

current actor

shoe remaining

player real hand

opponent real hand

player gun bullets

opponent gun bullets

AI optimal action

AI rationality

AI personality preference

AI final P(HIT)

AI RNG roll

last action

last domain event
```

允许 Developer HUD 看到完整隐藏牌。

因为它是调试工具。

---

# 64. Copy Debug State

Developer HUD 增加：

```text
COPY DEBUG STATE
```

复制一个 JSON，包括：

```text
gameVersion
seed
round
phase
relevant MatchState
recent actions/events
AI decision debug
```

目标：

可以把这个 JSON 直接交给 Coding Agent 复现 Bug。

---

# 65. 测试

核心规则至少给以下纯函数写单元测试：

```text
handValue
isBlackjack
isBust
shuffle determinism
deal
getRoundStarter
resolveRound
roulette probability input
skill effects
buildObservation
AI personality formula
save schema validation
```

必须测试：

```text
相同 seed
+
相同行动
=
相同结果
```

以及：

```text
AI observation 看不到 player private cards
```

---

# 66. MVP Round 状态机

建议使用：

```ts
type RoundPhase =
  | "dealing"
  | "initial-blackjack-check"
  | "turns"
  | "round-reveal"
  | "roulette-reaction"
  | "roulette-result";
```

概念流程：

```text
ROUND START
↓
DEALING
↓
INITIAL BLACKJACK CHECK
├── Blackjack resolves → penalty / roulette
└── none
     ↓
   TURNS
     ↓
HIT / STAND
     ↓
BUST OR BOTH STAND
     ↓
ROUND REVEAL / RESULT COPY / WAIT FOR ACK
     ↓
ADD BULLET
     ↓
├── player penalized → ROULETTE REACTION / SKILL / TRIGGER
└── opponent penalized → one “静观好戏” click / TRIGGER
     ↓
ROULETTE RESULT / WAIT FOR ACK
     ↓
├── survived → NEXT ROUND
└── hit → MATCH SUMMARY
```

实现时允许为了纯度略微细化状态名称，但不要改变规则。

---

# 67. Legal Actions

不要让 UI 自己判断按钮是否应该可用。

提供：

```ts
getLegalActions(state)
```

UI 根据这个函数：

* 显示
* enable
* disable

HIT、STAND、Skill、Continue 等操作的合法性必须来自 Domain。

例如：

```text
不是 Player Turn
→ HIT disabled
```

```text
21
→ HIT disabled
```

```text
roulette reaction
→ 只显示该 timing 合法的技能
```

---

# 68. MVP 明确不做的东西

为了控制周末项目 Scope，当前不要开发：

* Split
* Double Down
* multiplayer
* server backend
* account
* cloud save
* monetization
* battle pass
* achievements system
* complicated inventory
* real-time generated dialogue
* LLM runtime calls
* AI 使用技能
* 复杂弹巢物理位置
* 真正 execution-room 完整场景
* 几十个角色
* 卡牌编辑器
* shader
* canvas game engine
* procedural character generation at runtime

先把：

```text
Lobby
+
2 Characters
+
Table
+
完整 Match Loop
+
2 Skills
+
AI Brain
+
Dialogue
+
Save
+
PWA
```

做扎实。

---

# 69. 推荐实现顺序

不要一次性生成整个项目后再修。

按照以下顺序完成，并保证每一步项目都可运行：

## Phase 1

工程基础：

```text
Vite
TypeScript
CSS reset
PWA
basic directory structure
```

## Phase 2

纯 Domain：

```text
Card
Deck
RNG
Hand
Blackjack rules
```

配套 tests。

## Phase 3

Round / Match State Machine：

```text
Action
Reducer
RoundOutcome
Roulette
```

配套 tests。

## Phase 4

AI：

```text
Observation
Heuristic Policy
Personality mixer
AI debug output
```

配套 tests。

## Phase 5

Skill：

```text
Skill definitions
Skill inventory
Skill effects
Reward
```

## Phase 6

Persistence：

```text
Dexie
Zod
Save schema
autosave
restore
JSON export/import
```

## Phase 7

Lobby：

```text
sample character
character card
modal
how to play
start match
```

## Phase 8

Table：

```text
cards
gun indicator
HIT
STAND
skills
dialogue
AI turns
full match loop
```

## Phase 9

Presentation：

```text
deal
flip
shake
roulette suspense
character reactions
```

## Phase 10

Developer HUD + polish.

---

# 70. 代码质量目标

这是周末项目。

优先：

```text
清晰
简单
容易修改
容易被 Coding Agent 理解
```

而不是：

```text
过度抽象
Enterprise Architecture
过多 Factory
过多 Dependency Injection
复杂 Event Bus
复杂 ECS
```

如果一个抽象只是为了“以后也许有用”，默认不要加。

但以下边界必须严格保留：

```text
Domain / UI
AI / Dialogue
State / Presentation
Save / Game Core
Content / Logic
```

---

# 71. Codex 工作规则

每次进行代码修改前：

1. 阅读现有相关文件。
2. 遵循上述 Domain Contract。
3. 不擅自重构整个项目。
4. 优先做最小完整改动。
5. 修改规则时同步测试。
6. 新增角色不得产生角色特判。
7. 新增技能优先复用已有 SkillEffect primitive。
8. UI 不得直接修改 MatchState。
9. AI 永远只接收 filtered observation。
10. 不使用 Math.random() 执行领域随机行为。
11. 不在 reducer 中执行 async / DOM / audio。
12. 不为了“更现代”擅自换框架。

如果需求可以在现有结构内完成：

**不要引入新依赖。**

---

# 72. 第一阶段完成标准

MVP 成功标准：

玩家可以：

```text
打开 PWA
↓
进入 Lobby
↓
查看玩法说明
↓
看到示范角色 W
↓
查看角色介绍与 Tier
↓
开始对局
↓
双方发牌
↓
正确执行 Blackjack check
↓
AI 按策略和 personality 行动
↓
玩家 HIT / STAND
↓
正确判定 Bust / 21 / 比大小
↓
失败者填弹
↓
玩家必要时使用轮盘反应技能
↓
扣动扳机
↓
继续下一 Round
↓
玩家获得技能
↓
直到一方死亡或玩家逃跑
↓
进入 MATCH SUMMARY
↓
确认
↓
回到 Lobby
```

同时：

```text
刷新页面
```

不会丢失当前 Match。

并且：

```text
Export Save
Import Save
```

可以正常工作。

---

# 73. 体验原则

最终判断一个实现是否优秀，不只看规则是否能运行。

这个游戏必须感觉像：

```text
一个游戏
```

而不是：

```text
一个带 Blackjack 逻辑的网页表单。
```

重点投入到：

* 角色存在感
* 卡牌落桌手感
* 对话节奏
* AI 每次动作前 2–4 秒等待与一次中途姿态切换（仅属于 Presentation）
* Blackjack 瞬间
* 子弹增加的压力
* 扣动扳机前的 suspense
* Skill 使用反馈
* 输赢后的角色 reaction

但所有这些 Presentation：

**永远不能污染 Game Core。**

---

请现在基于这份 Contract 开始项目。

优先建立：

1. 推荐目录结构
2. TypeScript Domain Types
3. seeded RNG
4. Blackjack rules
5. Match / Round reducer
6. 单元测试

完成 Domain 骨架后，再实现 Lobby 和 Table DOM。

每一阶段都保持项目可以运行、可以测试，不要一次性生成大量不可验证代码。
