# 技术架构

本文描述当前实现，而不是未来愿望清单。改动架构时应同步更新本文件和相关测试。

## 运行形态与技术栈

应用由 Vite 构建为静态 PWA，运行时不需要业务后端。主要技术为 TypeScript、原生 DOM/CSS、Dexie/IndexedDB、Zod、Vitest、Playwright 与 `vite-plugin-pwa`。

```text
静态托管 / CDN
├── HTML、JS、CSS
├── Service Worker 与 Manifest
└── 图片、音频与可选离线资源包
```

## 目录职责

```text
src/
├── core/          # 纯领域逻辑：牌、轮盘、AI、能力、对局、RNG
├── content/       # 受 Schema 校验的角色、能力和状态数据
├── dialogue/      # 有限状态对白解析
├── persistence/   # Save Schema、Dexie、自动保存、导入导出
├── presentation/  # AI 表现时序与触觉等浏览器表现能力
├── audio/         # 音频边界
├── resources/     # 可选完整资源包下载与缓存
├── app.ts         # 应用编排、DOM 渲染和场景交互
└── main.ts        # 启动入口
```

`src/core/` 不得依赖 DOM、`window`、`document`、Dexie、音频或计时器，应可在测试运行器中独立执行。浏览器能力只能从外围模块进入。

## 状态与动作流

领域层遵循单向状态转换：

```text
DOM 事件
  ↓
getLegalActions(state)
  ↓
Action → gameReducer(state, action) → 新 MatchState + GameEvent[]
  ↓
DOM render / presentation / autosave
```

- UI 不自行推导规则或直接修改 `MatchState`。
- reducer 保持同步、纯净；动画等待、音频和姿态切换在表现层调度。
- `GameEvent` 是对白、历史、调试和演出的事实记录，状态仍由 reducer 决定。
- 已完成对局从牌桌确认进入 `match-summary`，再次确认后才切到 `lobby` 并由持久化层生成历史摘要。

`MatchState` 的核心组成包括双方状态、牌堆、两把左轮、玩家技能库存、剩余抽卡次数与当前抽卡候选、天赋 ID、能力运行时、轮次状态、历史、AI 配置、整局/每手 AI 噪声和各随机流快照。抽卡弹窗是玩家行动阶段上的持久化覆盖层，不是独立轮次阶段；打开弹窗后必须选择一张候选，完成后继续同一次行动。`execution-room` 是保留的表现层视图，当前致命演出仍在牌桌完成。

## 确定性与信息边界

所有领域随机行为使用 seeded PRNG。牌局种子派生独立的 deck、roulette、AI、loot、dialogue 流；能力运行时另保存 ability RNG。AI 流只在建局时生成 `Rmatch/Rplay`、后续每手开始时更新 `Rplay`，决策本身不消耗随机数。相同存档和相同行动应得到相同结果，增加对白不能改变牌序或枪击结果。

AI 只通过 `src/core/ai/observation.ts` 的过滤投影读取状态。牌的拥有者看到自己的私有牌；对手、未公开牌堆和未来随机结果不会进入 AI 输入。

## 角色内容

`src/content/characters/catalog.json` 只保存大厅、战利品和历史索引所需的元数据与安全 `dataFile`。`catalog.ts` 校验并冻结目录；`loader.ts` 通过 `import.meta.glob("./data/*.json")` 按需加载完整角色并缓存结果。

目录元数据包含自定义 `tags`；角色 tier 由 `getCharacterTags` 暴露为 `tier:s`、`tier:a` 等查询标签。`unlock` 使用通用条件引擎，支持击败任意角色、击败带标签角色、击败指定角色和按标签击败百分比。

进度层的 `CharacterDefeatRecord` 是击败事实的唯一来源，每名角色至多一条，只保存角色 ID 与首次击败时间。角色解锁、技能解锁、候场过滤、已击败名册和战利品时间线都读取该集合；完整 `MatchHistoryRecord` 只负责逐局结果和统计。确认结算时两者与 profile 原子写入，清理历史时只置空 `history`，不会修改 `defeats` 或 profile。

完整角色 JSON 由 `character.schema.json` 和运行时 Zod Schema 校验，包含档案、结算文案、资源、瞄准点、AI、机制和完整有限状态对白。未知 ID、不安全文件名、目录/数据不一致、非法机制绑定或缺少对白都会失败。新增角色的操作步骤见 [新增与会者工作流](adding-a-character.md)。

全屏战利品鉴赏采用表现层分层合成：应用固定加载共享 `trophy-gallery-coffin.png` 作为底图，角色 JSON 的 `trophyGallery.fullBody` 与可选 `poses` 只提供同尺寸透明角色层。局部记录坐标只绑定默认 `fullBody`；每个记录点以 `image` / `description` 作为 p0，并可用 `variants` 配置带独立描述的 p1、p2……循环差分。右侧纸质行政档案由必填的 `trophyDossier` 驱动，图片复用 `assets.defeatedSummary`；抽屉只属于表现层，收放状态、姿势和局部差分切换都不进入领域状态或存档。

## 技能与抽卡边界

`src/core/skills/` 负责 Player Skill 投影、解锁集合、10 张卡牌容量和确定性加权无放回抽取。候选读取建局时保存的全部已解锁 Player Skill，不读取大厅装备状态。候选数固定为 3；抽卡次数、库存空位和选择合法性都由核心逻辑决定，UI 只提交 `OPEN_SKILL_DRAW` 与 `SELECT_SKILL_DRAW` Action。

权重和规则修正是能力 Definition 的通用扩展点。Player Skill 以封闭 `skillTags`（gambler/cheater/intelligence-officer/gunslinger）声明流派；长期档快照的至多两个偏好流派在建局时写入 `MatchState.playerSkills`，匹配任一流派统一乘 4。活动 Definition 的 modifier 也只匹配 `skillTags`，所有其他命中因子继续累乘；`primaryDomain` 与开放式 `tags` 不进入流派权重空间。候选生成只依赖可保存的 loot RNG，不写具体技能或角色 ID。

## 能力底座

Player Skill、AI Skill、Talent 和状态共享 `src/core/abilities/` 的执行原语，但前三者拥有互斥的 Definition 类型、目录和 ID：

- `types.ts` 定义封闭的触发器、条件、选择器、效果与运行时类型。
- `schema.ts` 严格校验 JSON，拒绝额外字段与非法参数。
- `registry.ts` 导入、交叉校验并深度冻结规范定义。
- `engine.ts` 按优先级、实例创建顺序和规则索引确定性执行。
- `conditions.ts` 与 `effects.ts` 解释通用原语。
- `runtime.ts` 管理实例、状态、计数、生命周期和能力随机流。
- card/roulette adapter 为受控状态变更提供窄接口。

能力使用 `owner` / `rival` 等相对语义，不写死玩家、与会者或角色。待抽牌、待装填和待扣扳机通过受控 pending event 修改；单条能力解析失败时保持原子性，基础行动仍可安全继续。

被动 Player Skill 与被动 AI Skill 的 Definition 必须声明按回合或按成功触发次数计算的有限 TTL。实例化时把初始值写入运行时；规则成功提交后才扣触发 TTL，`on-round-end` 完成后才扣回合 TTL。归零实例不再进入普通规则收集，玩家实例同时移除对应真实卡牌并释放库存位；该实例创建的状态同步过期，随后可安全回收来源实例。Talent 和主动卡不使用 TTL。

显式 Stand 会广播 `after-stand`。`until-owner-action` 状态在目标下一次完成 Hit 或 Stand 后失效，并最迟在本轮结束时清理；状态的 `owner` 是受影响者，可以与来源能力实例的拥有者不同。主动技能牌统一使用 `active-skill-card` 标签，因此标签封锁不会影响被动技能或无卡角色行动。

表现层以 `ABILITY_TRIGGERED` 为技能发动事实，为每条可见事件生成独立技能通知气泡，显示发动者、技能名和规则级 `triggerNotice`；规则未声明时依次回退到定义级 `triggerNotice` 和 `description`。`before-trigger-pull` 的哑火修正是唯一的提前展示场景：进入心跳等待窗口时，以不提交 TTL、计数器或 RNG 的确定性预览计算最终概率并显示一次，实际扣扳机批次不重复提示。同批 `CARD_SUIT_REVEALED` 与 after 状态仍可用于补充行动建议和实际花色等结果数据。气泡按消息来源配色：策展人技能为金色、AI 技能为青色；技能耗尽、技能禁用和全屏异常统一视为系统通知并使用红色，不占用牌桌中央结果栏。通知按最新在上堆叠，最多同时保留 5 条，各自显示 2.5 秒后渐隐移除，不改变领域状态。仅 Player Skill 与 AI Skill 的发动事件进入气泡；Talent 以及仅用于内部状态清理的 `notify: false` 规则不提示。状态封锁查询复用能力引擎的标签判定；只有这一类不可用技能保留点击告警，其他非法 Action 不由 UI 自行解释或放行。

普通点数比较先按双方各自生效中的爆牌上限，计算手牌可取的不爆牌最大总点数，再让能力通过 pending comparison 叠加点数修正；修正值不参与爆牌判定。即使基础点数相同，也必须先完成该能力窗口才能判定平局。行动阶段的牌桌会针对当前状态只读预演同一个能力窗口，实时得到点数修正，但不提交 TTL、计数器、事件或 RNG；正式结算的最终比较分写入 `RoundOutcome.comparisonScores`。结算文案读取最终比较分，牌桌则以“基础点数 + 修正值”拆开展示且省略零修正；`on-round-end` 规则也可通过通用 `round-final-score` 标量读取这个最终比较分，并用 `set-status-stacks` 将它保存为下一轮的公开阈值。

角色 JSON 可选的单个 `infoBar` 是 AI Skill 的持续信息投影，不进入 `MatchState` 或存档。它通过 `sourceAbilityId` 绑定角色已启用的 AI Skill；实例 TTL 归零后投影失效。`core/abilities/info-bar.ts` 使用与能力解释器相同的 hand/gun adapter，并接收核心层从当前轮历史计算的 Hit 计数，把声明式数值表达式、概率、花色或牌解析为当前显示值；UI 只负责格式化和打开角色数据中的说明弹窗。未声明时不渲染空信息栏，核心逻辑与表现层都不得按角色 ID 特判。

`replace-pending-draw` 的 `create-derived-card` fallback 只在实体牌堆没有合适候选时创建衍生牌。衍生牌不修改实体牌堆、不进入弃牌堆，离开手牌或本轮结束后不作为实体牌保存回牌堆。

能力目录版本由 `ABILITY_CATALOG_VERSION` 标识。定义语义变化时提升版本；当前快速开发策略不迁移旧能力运行时。能力事件还提供爆牌检查、扳机前待处理修改、TTL 到期事实，以及主动能力成功后的观察广播；标量表达式和衍生牌效果均由能力 RNG 确定性解析。修改子弹判定的规则必须在 `before-trigger-pull` 提交，最终 `TRIGGER_PULLED` 明确记录命中、能力哑火或自然空膛；结果提示与音效可据此区分，角色对白则统一进入既有未击发存活状态池。新增能力流程见 [新增能力工作流](adding-an-ability.md)。

## 持久化

`src/persistence/` 通过 `SaveRepository` 隔离存储实现，生产实现使用 Dexie + IndexedDB。长期档与运行时档保存为独立记录；活动对局在重要领域动作后自动保存，应用启动时在长期档验证成功后单独恢复有效运行时档。确认最终结算时，长期结果写入与运行时档删除处于同一 IndexedDB 事务。

两个保存边界分别使用严格 Zod Schema，验证：

- 长期档：format、长期 schema version、profile、设置、`skipTutorial`、`tutorialProgress`、历史摘要与独立首次击败记录；
- 运行时档：format、运行时 schema version、角色与技能引用、牌、轮次、左轮和事件结构；
- 运行时能力实例、状态来源、参数、目录版本和卡牌实例一致性。

当前长期 Schema 版本为 9，运行时 Schema 版本为 5。长期档只保存至多两个 `selectedSkillTags`，天赋 ID 不再写入 profile，而是从 `defeats` 记录按 Talent 的 `unlock` 条件推导；运行时 MatchState 保留天赋与流派快照。教程完成状态使用开放字符串集合 `tutorialProgress.completedIds`，旧档缺失该字段时补为空集合；教程目录新增、删除或未知 ID 都不影响存档有效性，因此仅新增教程不得提升长期 Schema 版本。不兼容或损坏的运行时档只需要玩家确认舍弃，不会牵连长期档；长期档仍视为不可恢复，界面会明确要求玩家手动删除并再次确认，不自动迁移或覆盖。JSON 导入只接受长期档并明确报错；默认导出也只有长期档，优先使用 File System Access API，缺失时退回 Blob 下载。

教程目录与纯进度函数位于 `src/tutorials/`。应用编排层仅在真实领域状态变化或恢复后仍可观察到机制事实时派发 cue；右上角非模态弹窗负责分页、附加图片资源与完成交互。教程不写入运行时档、不进入 reducer、不影响 AI observation 或随机流。新增教程流程见 [新增教程](adding-a-tutorial.md)。

## PWA 与资源缓存

Vite PWA 配置生成 manifest 和 Service Worker。核心应用 shell 由 Workbox 预缓存，图片与音频使用运行时 NetworkFirst：在线时先请求服务器并更新缓存，离线时回退到缓存中的资源，确保同名文件内容更新后不会永久显示旧版本。自动资源加载由 `src/resources/resource-loader.ts` 分层调度：大厅只缓存当前已解锁角色的 `previewImage` 与大厅背景；音频首轮加载优先请求大厅 BGM，短暂延后后预载对局 BGM，短音效仍推迟到进入对局时获取。大厅与牌桌切换时，两条流媒体 BGM 做 800ms 交叉淡化。进入或恢复对局时，当前画面所需的角色图、牌桌背景和共享左轮使用最高优先级，剩余牌桌/结算立绘次优先，角色定义中递归发现的收藏图等资源进入后台队列。后台任务最多占用并发槽位中的 `n - 1` 个，保证对局可见资源随时能够插队。大型可选媒体仍可通过构建生成的 `/resource-pack.json` 及 `src/resources/` 下载器并发写入同一 Cache Storage。

## 验证边界

- `npm test`：领域、内容、对白、持久化、音频/表现与开发工具单元测试。
- `npm run test:e2e`：主应用和对白工具的浏览器流程。
- `npm run build`：TypeScript project references、Vite 构建、PWA 产物与资源清单。

部署拓扑和命令见 [构建与部署](deployment.md)。
