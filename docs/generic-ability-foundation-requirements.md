# 通用能力底座需求文档

状态：待实现  
目标版本：能力底座第一版  
适用范围：AI 与会者特殊机制、玩家技能牌  

## 1. 背景与现状

当前游戏的能力逻辑分散在技能定义、效果解释器、对局 reducer、存档 Schema 和 UI 中。技能虽然拥有数据定义，但每个新效果仍需要新增 TypeScript 分支和专用状态字段，例如 `rhodesArmed`、`nightQueenArmed`。角色数据目前只包含两个 AI 概率参数，无法声明角色特殊机制。

本次重构建立一套与角色 ID 无关的通用能力底座，让以下两类内容共享同一套运行机制：

- AI 与会者特殊机制：角色通过纯数据装备，被动触发或生成通用能力行动。
- 玩家技能牌：玩家通过牌组获得、消费和发动，效果由声明式规则执行。

当前底层事实：

- 牌库是一副标准 52 张扑克牌，不是多副牌靴。
- 剩余牌少于 12 张时，现有实现会重新洗混完整的 52 张牌并将游标归零。
- 双方各有一把容量为 6 的左轮，目前只保存子弹数量，没有实际弹巢位置和游标。
- 当前共有六个技能，必须全部迁移到新底座并保持现有规则行为。

## 2. 本期目标

### 2.1 必须完成

1. 建立统一的能力定义、触发规则、条件、效果、状态和次数限制模型。
2. 玩家现有六个技能全部改为声明式定义并通过通用解释器运行。
3. AI 角色数据可以声明特殊机制，不允许核心逻辑根据角色 ID 分支。
4. 主动能力统一进入合法行动系统；自动能力统一通过事件触发。
5. 随机效果使用可保存、可回放的独立随机流。
6. 新增能力通常只需增加数据；只有新增底层能力原语时才允许修改解释器。
7. 存档只保存运行时实例、状态和计数，不保存函数或完整定义副本。
8. 当前测试覆盖的六个技能行为在迁移后保持一致。

### 2.2 本期不做

- 不实现多副牌、弃牌堆、烧牌区、牌库构筑或详细洗牌规则。
- 不实现实体弹巢、弹巢位置、转轮游标、旋转和查看弹膛。
- 不重做 AI 的效用决策算法。
- 不在本期调整现有技能数值和平衡。
- 不新增正式角色特殊机制内容；只提供 Schema、测试夹具和运行能力。
- 不制作技能选择目标、选择手牌等复杂交互 UI；底座允许未来扩展，但当前迁移技能不依赖新弹窗。

## 3. 设计原则

### 3.1 角色纯数据

`src/core/` 内不得出现 `if (characterId === "...")`、角色 ID 到函数的映射或角色专属 reducer。

角色只能通过以下数据获得机制：

```json
{
  "mechanics": [
    {
      "definitionId": "example-pressure-mechanic",
      "enabled": true,
      "parameters": {
        "threshold": 3
      }
    }
  ]
}
```

机制定义本身也必须是可验证数据。若出现全新的游戏行为，应新增可复用的通用条件或效果原语，而不是新增角色函数。

### 3.2 所有者相对语义

能力规则不得把 `player` 或 `opponent` 写死为效果语义，应使用：

- `owner`：能力拥有者。
- `rival`：能力拥有者的对手。
- `action-actor`：当前行动者。
- `event-actor`：触发事件中的行动者。
- `penalty-target`：本轮惩罚目标。

玩家技能实例化时 `owner=player`；与会者机制实例化时 `owner=opponent`。同一条规则因此可以被双方复用。

### 3.3 数据不可执行任意代码

能力 JSON 不允许：

- JavaScript 表达式。
- 函数字符串。
- 任意属性路径读写。
- 动态导入模块。

所有条件、选择器和效果必须来自封闭的、由 Zod 验证的联合类型。

### 3.4 确定性与可回放

- 相同种子、相同定义版本、相同行动必须得到完全一致的结果。
- 随机选择必须使用能力专用 RNG，不得使用 `Math.random()`。
- 同一触发窗口内按 `priority`、能力实例创建顺序、规则索引稳定排序。
- 规则执行过程产生的领域事件必须进入历史记录。

## 4. 统一领域模型

### 4.1 能力来源

```ts
type AbilitySourceKind = "player-skill" | "character-mechanic";

interface AbilitySource {
  readonly kind: AbilitySourceKind;
  readonly definitionId: string;
  readonly owner: Actor;
  readonly instanceId: string;
}
```

`definitionId` 指向全局定义；`instanceId` 标识本局中的具体实例，用于计数、状态来源和事件历史。

主动技能牌的重复副本必须拥有不同实例 ID：

```ts
interface SkillCardInstance {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly owner: Actor;
}
```

- 玩家技能手牌由 `SkillCardInstance[]` 表示，不再只保存字符串 ID。
- `PLAY_ABILITY.instanceId` 对玩家主动技能指向被消费的卡牌实例。
- 对被动玩家技能或角色机制，`instanceId` 指向本局创建的常驻能力实例。
- 状态可以继续引用一个已经被消费的卡牌实例作为来源，直到状态结束。
- 非实例对象形式的技能牌数据视为不兼容存档，启动时整体丢弃。

### 4.2 能力定义

```ts
interface AbilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly sourceKind: AbilitySourceKind;
  readonly parameters?: Readonly<Record<string, AbilityParameterSpec>>;
  readonly activation: AbilityActivation;
  readonly rules: readonly AbilityRule[];
  readonly tags: readonly string[];
}

type AbilityActivation =
  | {
      readonly type: "action";
      readonly windows: readonly ActionWindow[];
      readonly consume: "card" | "none";
      readonly availability?: readonly Condition[];
    }
  | {
      readonly type: "automatic";
    }
  | {
      readonly type: "passive";
    };
```

说明：

- 玩家主动技能牌使用 `action + consume: card`。
- AI 自动特殊机制使用 `automatic`。
- 常驻修正使用 `passive`。
- 未来 AI 主动机制也使用 `action`，由合法行动系统生成动作，再由通用 AI 选择。

角色绑定机制时使用严格参数表：

```ts
interface AbilityBinding {
  readonly definitionId: string;
  readonly enabled: boolean;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

type AbilityParameterSpec =
  | { readonly type: "number"; readonly minimum?: number; readonly maximum?: number; readonly default?: number }
  | { readonly type: "boolean"; readonly default?: boolean }
  | { readonly type: "enum"; readonly values: readonly string[]; readonly default?: string };
```

- 参数必须在定义中预先声明。
- 未知参数、缺失必填参数和超出范围的参数必须在角色加载时失败。
- 条件和效果中的数值允许引用参数；普通数字是常量简写。
- 参数只能替换值，不能替换 trigger、condition type、effect type 或任意字段名。

### 4.3 建议目录结构

```text
src/core/abilities/
  types.ts              # 封闭联合类型
  schema.ts             # Zod Schema
  registry.ts           # 定义与状态目录
  engine.ts             # 规则收集和解释
  conditions.ts         # 条件原语
  effects.ts            # 效果原语
  runtime.ts            # 状态、计数、生命周期
  card-zone-adapter.ts  # 当前单副牌适配器
  roulette-adapter.ts   # 当前子弹计数适配器

src/content/abilities/
  player-skills/*.json
  character-mechanics/*.json
  statuses/*.json
```

技能与机制使用同一个 Schema 和解释器，但分目录维护，避免玩家内容、角色内容与核心代码混杂。所有 JSON 在启动或测试时一次性验证并注册。

### 4.4 规则

```ts
interface AbilityRule {
  readonly id: string;
  readonly trigger: AbilityTrigger;
  readonly priority?: number;
  readonly conditions?: readonly Condition[];
  readonly effects: readonly Effect[];
  readonly limit?: RuleLimit;
}

interface RuleLimit {
  readonly perEvent?: number;
  readonly perTurn?: number;
  readonly perRound?: number;
  readonly perMatch?: number;
}
```

条件数组默认执行 AND。第一版不提供任意布尔表达式；需要 OR 时使用：

```ts
{ type: "any", conditions: [...] }
{ type: "not", condition: ... }
```

### 4.5 通用状态

```ts
interface StatusDefinition {
  readonly id: string;
  readonly rules: readonly AbilityRule[];
  readonly defaultDuration: "turn" | "round" | "match" | "until-consumed";
  readonly blocksAbilityTags?: readonly string[];
}

interface AbilityStatus {
  readonly statusDefinitionId: string;
  readonly owner: Actor;
  readonly sourceInstanceId: string;
  readonly stacks: number;
  readonly duration: "turn" | "round" | "match" | "until-consumed";
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly createdAtSequence: number;
}
```

状态运行时只保存定义引用和参数，不复制规则。解释器通过 `statusDefinitionId` 从状态目录读取规则。状态统一替代所有技能专用布尔值。第一版迁移完成后，`SkillInventory` 不再包含 `rhodesArmed` 和 `nightQueenArmed`。

`blocksAbilityTags` 是通用行动限制。例如「暗夜女王」武装期间可阻止其他带 `hand-mutation` 标签的能力，避免保证下一次 Hit 的前提被另一项换牌能力破坏。

### 4.6 运行时状态

```ts
interface AbilityRuntimeState {
  readonly statuses: readonly AbilityStatus[];
  readonly counters: Readonly<Record<string, number>>;
  readonly sequence: number;
}
```

计数键由 `instanceId + ruleId + scope` 组成。进入新回合或新回合行动时，由引擎统一清理对应 scope，不允许技能自行清理计数。

## 5. 触发窗口

第一版必须支持以下触发器：

```ts
type AbilityTrigger =
  | "on-match-created"
  | "on-ability-played"
  | "before-card-draw"
  | "after-card-draw"
  | "after-hand-changed"
  | "before-round-resolution"
  | "before-bullet-load"
  | "after-bullet-load"
  | "before-trigger-pull"
  | "after-trigger-result"
  | "on-round-end";
```

第一版主动行动窗口：

```ts
type ActionWindow = "owner-turn" | "owner-roulette-reaction";
```

每个触发上下文至少包含：

```ts
interface AbilityEventContext {
  readonly trigger: AbilityTrigger;
  readonly sourceEventId: string;
  readonly eventActor?: Actor;
  readonly roundOutcome?: RoundOutcome;
  readonly pendingDraw?: PendingDraw;
  readonly pendingLoad?: PendingLoad;
  readonly pendingTrigger?: PendingTrigger;
}
```

`PendingDraw`、`PendingLoad` 和 `PendingTrigger` 是受控的待结算对象。能力效果只能通过专用效果原语修改它们，不能直接修改任意 MatchState 字段。

`on-ability-played` 是直接触发器：只收集本次 `PLAY_ABILITY.instanceId` 对应能力的该触发规则，不广播给其他能力。其余触发器是广播触发器，会从当前所有能力实例和状态中收集规则。

## 6. 第一版条件原语

以下条件足以迁移现有技能，并为角色机制提供最小可用空间：

```ts
type Condition =
  | { type: "actor-is"; actor: ActorSelector }
  | { type: "owner-has-card"; abilityId: string }
  | { type: "hand-card-count"; target: ActorSelector; operator: Compare; value: ScalarValue }
  | { type: "hand-total"; target: ActorSelector; operator: Compare; value: ScalarValue }
  | { type: "hand-all-same-suit"; target: ActorSelector }
  | { type: "card-candidate-exists"; target: ActorSelector; card: CardSelector; source: CardSource; candidate: CardCandidate }
  | { type: "hand-is-twenty-one"; target: ActorSelector }
  | { type: "gun-bullets"; target: ActorSelector; operator: Compare; value: ScalarValue }
  | { type: "gun-is-full"; target: ActorSelector; expected: boolean }
  | { type: "round-reason-is"; value: RoundReason }
  | { type: "round-penalty-target-is"; target: ActorSelector }
  | { type: "status-present"; target: ActorSelector; statusDefinitionId: string }
  | { type: "any"; conditions: readonly Condition[] }
  | { type: "not"; condition: Condition };
```

比较值允许常量或其他参与者属性：

```ts
type NumberValue =
  | { type: "constant"; value: number }
  | { type: "parameter"; key: string }
  | { type: "gun-bullets"; target: ActorSelector }
  | { type: "hand-total"; target: ActorSelector };

type ScalarValue = number | NumberValue;
type Compare = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
```

## 7. 第一版效果原语

```ts
type Effect =
  | { type: "draw-skill-cards"; target: ActorSelector; amount: ScalarValue }
  | { type: "publish-action-advice"; target: ActorSelector; policy: "current-optimal-hit-stand" }
  | { type: "replace-hand-card"; target: ActorSelector; card: CardSelector; source: CardSource; candidate: CardCandidate; pick: RandomPick }
  | { type: "add-status"; target: ActorSelector; statusDefinitionId: string; parameters?: Readonly<Record<string, string | number | boolean>> }
  | { type: "remove-status"; target: ActorSelector; statusDefinitionId: string; amount?: ScalarValue }
  | { type: "replace-pending-draw"; target: ActorSelector; policy: DrawReplacementPolicy }
  | { type: "add-to-pending-load"; target: ActorSelector; amount: ScalarValue }
  | { type: "multiply-pending-load"; target: ActorSelector; factor: ScalarValue }
  | { type: "cancel-pending-trigger"; target: ActorSelector };
```

第一版选择器：

```ts
type ActorSelector = "owner" | "rival" | "event-actor" | "penalty-target";
type CardSelector = "last-card";
type CardSource = "remaining-draw-pile";
type RandomPick = "uniform-ability-rng";

type CardCandidate =
  | { type: "resulting-hand-total-at-most"; value: ScalarValue }
  | { type: "resulting-hand-total-exactly"; value: ScalarValue };

type DrawReplacementPolicy =
  | {
      type: "exact-resulting-total";
      total: ScalarValue;
      fallback: "synthesize-compatible-card";
    };
```

说明：`synthesize-compatible-card` 是为了保持现有「暗夜女王」行为的兼容原语。详细牌库机制上线时应重新评估并优先移除该 fallback，避免生成牌破坏实体牌库守恒。

## 8. 事件解析流程

每个领域动作必须按以下固定流程执行：

1. reducer 验证基础行动是否合法。
2. 建立待结算对象，例如 `PendingDraw`。
3. 收集全局规则、双方角色机制、双方状态和技能产生的规则。
4. 按触发器筛选。
5. 检查条件和次数限制。
6. 按稳定顺序执行效果。
7. 提交待结算对象到 MatchState。
8. 记录能力触发事件和最终领域事件。
9. 清理 `until-consumed` 状态和对应计数。
10. 执行统一的手牌归一化：检查爆牌、21 自动停牌和回合结算。

事件解析必须设置最大嵌套深度，第一版建议为 16。超过深度应抛出带规则链信息的领域错误，防止两个状态互相无限触发。

同一事件中：

- `cancel-pending-trigger` 只能取消一次，后续取消无额外效果。
- 数值乘法按优先级依次执行。
- 最终装填仍受枪容量限制。
- 被取消的事件仍记录取消原因和来源能力。

## 9. 玩家技能牌与 AI 机制的差异

两者共享规则解释器，但生命周期不同。

### 9.1 玩家技能牌

- 来源：玩家已装备主动技能池。
- 运行时：对应 `SkillCardInstance` 存在于玩家技能手牌。
- 发动：生成 `PLAY_ABILITY` 合法行动。
- 消耗：合法性检查和效果解析成功后原子消费一张牌。
- 失败：如果目标或候选不存在，不得消费技能牌。
- UI：继续显示技能名称、数量、简述和完整规则。

### 9.2 AI 角色特殊机制

- 来源：角色 JSON 的 `mechanics` 配置。
- 自动／被动机制：对局创建时实例化，并持续监听触发事件。
- 主动机制：生成与玩家技能相同结构的能力行动，但不依赖玩家技能手牌。
- 使用次数和冷却由规则 limit 或状态控制。
- 角色机制的公开名称、说明和剩余次数必须可以由 UI 查询，禁止不可解释的隐藏加成。

第一版只要求自动和被动 AI 机制运行测试；主动 AI 机制的数据模型和合法行动必须可生成，实际 AI 选择策略可在后续 AI 重构中接入。

## 10. 现有六个技能的声明式迁移

### 10.1 早有准备

```yaml
activation: passive
rule:
  trigger: on-match-created
  effects:
    - draw-skill-cards owner 1
  limit:
    perMatch: 1
```

基础规则仍负责默认开局抽 1 张；该技能只追加 1 张。

### 10.2 猎手直觉

```yaml
activation:
  type: action
  windows: [owner-turn]
  consume: card
rule:
  trigger: on-ability-played
  effects:
    - publish-action-advice owner current-optimal-hit-stand
```

建议继续由下一次 Hit、Stand 或换轮事件清除。第一版保持现有策略函数，不在本次重构中修正“数学最优”问题。

### 10.3 偷梁换柱

定义标签：`hand-mutation`。

可用条件：

- 拥有至少一张手牌。
- 剩余抽牌区存在替换最后一张牌后不超过 21 的候选牌。

效果：

```yaml
- replace-hand-card:
    target: owner
    card: last-card
    source: remaining-draw-pile
    candidate:
      resulting-hand-total-at-most: 21
    pick: uniform-ability-rng
```

替换不算 Hit、不交出行动权，原手牌与候选牌交换位置。替换提交后由统一手牌归一化流程处理 21 自动停牌，不由技能自身声明专用自动停牌效果。

### 10.4 罗德岛万人迷

发动后添加 `rhodes-heartthrob-armed` 状态，持续到本轮结束且同轮不可重复添加。

状态规则：

```yaml
trigger: before-trigger-pull
conditions:
  - penalty-target is owner
  - owner gun is not full
effects:
  - cancel-pending-trigger owner
  - remove-status:
      target: owner
      statusDefinitionId: rhodes-heartthrob-armed
```

满膛时条件失败，技能不阻止扳机；状态仍在回合结束时统一清除。

### 10.5 暗夜女王

发动条件：

- 所有当前手牌同花色。
- 当前点数大于 10。
- 不存在同名武装状态。

发动后添加 `night-queen-armed` 状态。

该状态声明 `blocksAbilityTags: [hand-mutation]`。因此武装后仍可使用不修改手牌的能力，但不能在 Hit 前使用「偷梁换柱」或未来其他换牌能力。

状态规则：

```yaml
trigger: before-card-draw
conditions:
  - event actor is owner
effects:
  - replace-pending-draw:
      exact-resulting-total: 21
      fallback: synthesize-compatible-card
  - remove-status:
      target: owner
      statusDefinitionId: night-queen-armed
```

规则引擎必须保证下一次 Hit 不会进入无合法牌崩溃状态。兼容 fallback 需要根据 Hit 时的最新手牌重新计算合法牌；若因为异常运行状态或未来基础规则导致任何单张牌都无法形成 21，则保留原始待抽牌、消费武装状态并记录能力解析失败事件，不能调用 `nextInt(0)`。这是本次重构允许修复的现有崩溃缺陷，不属于技能平衡调整。

### 10.6 叙拉古人的愤怒

```yaml
activation: passive
rule:
  trigger: before-bullet-load
  conditions:
    - penalty target is rival
    - rival bullets < owner bullets
    - round reason is not blackjack
  effects:
    - multiply-pending-load rival 2
```

最终数量仍由枪容量截断；Blackjack 装填不翻倍。

## 11. 合法行动与原子性

新增通用行动：

```ts
type AbilityAction = {
  readonly type: "PLAY_ABILITY";
  readonly instanceId: string;
  readonly selections?: Readonly<Record<string, string | number>>;
};
```

快速开发阶段只保留 `PLAY_ABILITY`，不接受或转换旧 `USE_SKILL` 输入。

发动必须满足原子性：

- 先检查窗口、所有权、库存、条件、目标和候选。
- 再消费技能牌或次数。
- 再执行规则。
- 任一步失败，完整状态保持不变。

禁止出现“技能牌已消费，但效果因为没有候选而失败”的状态。

## 12. 领域事件与历史

第一版新增通用事件：

```ts
type AbilityEvent =
  | { type: "ABILITY_PLAYED"; instanceId: string; definitionId: string; owner: Actor }
  | { type: "ABILITY_TRIGGERED"; instanceId: string; definitionId: string; ruleId: string; owner: Actor }
  | { type: "ABILITY_RESOLUTION_FAILED"; instanceId: string; definitionId: string; ruleId: string; reason: string }
  | { type: "STATUS_ADDED"; statusDefinitionId: string; owner: Actor; sourceInstanceId: string }
  | { type: "STATUS_REMOVED"; statusDefinitionId: string; owner: Actor; reason: "consumed" | "expired" | "dispelled" }
  | { type: "PENDING_EVENT_MODIFIED"; eventId: string; effectType: string; sourceInstanceId: string }
  | { type: "PENDING_EVENT_CANCELLED"; eventId: string; sourceInstanceId: string };
```

只保留通用事件；不读取 `SKILL_USED`、`SKILL_ADVICE` 或 `TRIGGER_AVOIDED_BY_SKILL` 等旧事件。版本或结构不兼容的本地存档在启动时直接丢弃并重建，不提供迁移。

## 13. 存档要求

### 13.1 保存内容

- 已装备能力定义 ID。
- 玩家技能手牌中的卡牌实例 ID 与定义 ID。
- 当前能力实例 ID、owner 和 source kind。
- 状态定义 ID、参数、层数、持续时间和来源实例 ID。
- 能力计数器。
- 能力 RNG 快照。
- 能力目录版本或内容哈希。

### 13.2 不保存内容

- AbilityDefinition 完整副本。
- 条件或效果函数。
- 角色专属闭包。
- 可从定义目录重新推导的静态文案。

### 13.3 版本策略

快速开发阶段假设客户端与存档永远来自当前版本，不维护任何迁移路径：

- Schema 或能力目录版本不匹配时，启动流程直接丢弃整个本地存档并写入默认存档。
- 当前版本的导入、保存边界仍严格校验定义 ID、实例引用和目录版本。
- 不保留旧字段、旧事件、旧 action 或按版本分支的转换器。
- 结构变化时直接更新当前 Schema；不要为开发期存档增加迁移代码。

## 14. 为详细牌库预留的边界

能力底座不得直接依赖 `shoe.cards` 和 `shoe.cursor`。必须通过牌区服务读取和修改：

```ts
interface CardZoneService {
  list(zone: CardZoneSelector, viewer: Actor | "system"): readonly Card[];
  findCandidates(request: CardCandidateRequest): readonly CardReference[];
  move(request: CardMoveRequest): CardZoneMutation;
  replace(request: CardReplaceRequest): CardZoneMutation;
}
```

第一版适配器可以把：

```text
remaining-draw-pile -> shoe.cards.slice(shoe.cursor)
```

未来详细牌库可以在不修改技能定义的情况下替换为：

```text
多副牌 draw pile
discard pile
burn pile
revealed zone
临时保留区
```

技能定义应使用“剩余抽牌区”“最后一张手牌”等语义选择器，不使用数组索引和游标。

## 15. 为实体弹巢预留的边界

能力底座不得直接写入 `gun.bullets`。必须通过轮盘服务操作：

```ts
interface RouletteService {
  inspectSummary(target: Actor): GunSummary;
  modifyPendingLoad(request: LoadModifier): PendingLoad;
  cancelPendingTrigger(request: TriggerCancellation): PendingTrigger;
}
```

第一版 `GunSummary` 可以只有容量和子弹数。未来可扩展：

- 弹巢数组。
- 当前游标。
- 已公开弹巢。
- 实弹、空膛、哑弹、锁定等状态。

旧能力继续使用“修改装填”“取消扳机”等高层语义，不因枪内部结构变化而重写。

## 16. 测试需求

本次重构的核心验收标准是：现有技能不再依赖技能 ID 专属执行分支，仍能完整通过声明式底座运行。

### 16.1 架构测试

1. `src/core/match` 和通用解释器中不存在六个技能 ID 字符串。
2. 通用解释器不按 `definitionId` 分支。
3. `src/core/` 中不存在角色 ID 条件分支。
4. Character Schema 拒绝未知机制定义、未知参数和任意额外字段。
5. Ability Schema 拒绝未知 trigger、condition、effect 和 selector。

### 16.2 六个技能契约测试

每个技能至少覆盖：

- 定义可以通过 Schema。
- 合法窗口会生成 `PLAY_ABILITY`。
- 非法窗口不会生成行动。
- 无候选时不消费技能牌。
- 使用后产生通用能力事件。
- 相同种子结果一致。

现有行为专项：

- 早有准备：只在开局额外抽一张，且每局一次。
- 猎手直觉：给出当前策略建议，并在下一行动清除。
- 偷梁换柱：只选择不爆牌候选，交换牌库位置，不交出行动权；21 自动停牌。
- 罗德岛万人迷：非满膛取消一次扳机；满膛不取消；同轮不能重复武装。
- 暗夜女王：条件正确、下一次 Hit 为 21、状态被消费；武装后手牌被其他效果修改也不得崩溃。
- 叙拉古人的愤怒：只翻倍子弹更少的 rival 普通装填，不影响 Blackjack，最终受容量限制。

### 16.3 AI 机制夹具测试

增加至少两个不属于正式角色的测试机制：

1. 自动机制：owner 普通失败装填前将装填量减少 1。
2. 被动机制：rival 爆牌时额外给 rival 装填 1 发。

验证相同机制定义分别绑定到 player 和 opponent 时，`owner/rival` 选择器都能正确工作，证明机制没有写死阵营。

### 16.4 属性与模糊测试

- 随机生成合法手牌、枪状态、技能库存和事件顺序，执行至少 10,000 条随机合法动作。
- 不得出现 `nextInt(0)`、负装填、超过容量、重复消费或无穷触发。
- 状态进入新回合后按 duration 正确清理。
- 同一事件中的规则执行顺序稳定。
- 任意失败的能力行动保持状态完全不变。

### 16.5 回放与存档测试

- 同种子、同能力配置、同行动序列得到完全相同的 MatchState 和历史。
- 非当前版本或结构损坏的本地存档在启动时被整体替换为默认存档。
- 保存后恢复不会重复触发 `on-match-created`。
- 定义缺失时给出可定位的存档错误。

## 17. 完成定义

满足以下全部条件才视为能力底座第一版完成：

1. 六个现有技能均由 AbilityDefinition 数据描述。
2. 六个技能的运行路径中不存在按技能 ID 编写的效果分支。
3. AI 测试机制可以通过角色数据挂载并自动触发。
4. `owner/rival` 机制可双向复用。
5. 专用 armed 字段被通用状态替代。
6. 所有原有单元测试已迁移或保留通过。
7. 新增架构、契约、属性、回放和存档测试通过。
8. `npm test` 与 `npm run build` 通过。
9. 当前 UI 功能不回退：技能数量、可用状态、说明、建议和提示仍可显示。
10. 文档明确记录新增一个条件／效果原语和新增一个纯数据能力的工作流。

## 18. 后续实现顺序

1. 定义并验证 Ability、Rule、Condition、Effect、Status Schema。
2. 建立触发收集、稳定排序、次数限制和状态生命周期。
3. 接入 `PLAY_ABILITY` 与玩家技能手牌消费。
4. 迁移早有准备、猎手直觉和偷梁换柱。
5. 迁移状态型技能：罗德岛万人迷、暗夜女王。
6. 迁移结算修正型被动：叙拉古人的愤怒。
7. Character Schema 接入 mechanisms，并加入 AI 机制测试夹具。
8. 更新当前存档 Schema，并让旧活动对局整体失效。
9. 增加属性测试、回放测试和架构约束测试。
10. 清理旧解释器分支和专用状态字段。
