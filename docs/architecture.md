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

`MatchState` 的核心组成包括双方状态、牌堆、两把左轮、技能表现外观、能力运行时、轮次状态、历史、AI 配置和各随机流快照。`execution-room` 是保留的表现层视图，当前致命演出仍在牌桌完成。

## 确定性与信息边界

所有领域随机行为使用 seeded PRNG。牌局种子派生独立的 deck、roulette、AI、loot、dialogue 流；能力运行时另保存 ability RNG。相同存档和相同行动应得到相同结果，增加对白不能改变牌序或枪击结果。

AI 只通过 `src/core/ai/observation.ts` 的过滤投影读取状态。牌的拥有者看到自己的私有牌；对手、未公开牌堆和未来随机结果不会进入 AI 输入。

## 角色内容

`src/content/characters/catalog.json` 只保存大厅和历史索引所需的元数据与安全 `dataFile`。`catalog.ts` 校验并冻结目录；`loader.ts` 通过 `import.meta.glob("./data/*.json")` 按需加载完整角色并缓存结果。

完整角色 JSON 由 `character.schema.json` 和运行时 Zod Schema 校验，包含档案、结算文案、资源、瞄准点、AI、机制和完整有限状态对白。未知 ID、不安全文件名、目录/数据不一致、非法机制绑定或缺少对白都会失败。新增角色的操作步骤见 [新增与会者工作流](adding-a-character.md)。

## 能力底座

玩家技能、角色机制和状态共享 `src/core/abilities/`：

- `types.ts` 定义封闭的触发器、条件、选择器、效果与运行时类型。
- `schema.ts` 严格校验 JSON，拒绝额外字段与非法参数。
- `registry.ts` 导入、交叉校验并深度冻结规范定义。
- `engine.ts` 按优先级、实例创建顺序和规则索引确定性执行。
- `conditions.ts` 与 `effects.ts` 解释通用原语。
- `runtime.ts` 管理实例、状态、计数、生命周期和能力随机流。
- card/roulette adapter 为受控状态变更提供窄接口。

能力使用 `owner` / `rival` 等相对语义，不写死玩家、与会者或角色。待抽牌、待装填和待扣扳机通过受控 pending event 修改；单条能力解析失败时保持原子性，基础行动仍可安全继续。

`replace-pending-draw` 的 `create-derived-card` fallback 只在实体牌堆没有合适候选时创建衍生牌。衍生牌不修改实体牌堆、不进入弃牌堆，离开手牌或本轮结束后不作为实体牌保存回牌堆。

能力目录版本由 `ABILITY_CATALOG_VERSION` 标识。定义语义变化时提升版本；当前快速开发策略不迁移旧能力运行时。新增能力流程见 [新增能力工作流](adding-an-ability.md)。

## 持久化

`src/persistence/` 通过 `SaveRepository` 隔离存储实现，生产实现使用 Dexie + IndexedDB。活动对局在重要领域动作后自动保存；应用启动时恢复有效活动对局。

保存和导入边界使用严格 Zod Schema，验证：

- save format、schema version、角色与技能引用；
- 牌、轮次、左轮和事件结构；
- 能力实例、状态来源、参数、目录版本和卡牌实例一致性；
- 历史摘要结构。

不兼容或损坏的本地存档在启动时被视为不可恢复并替换为新档。JSON 导入会明确报错；导出优先使用 File System Access API，缺失时退回 Blob 下载。

## PWA 与资源缓存

Vite PWA 配置生成 manifest 和 Service Worker。核心应用 shell 由 Workbox 预缓存，图片与音频使用运行时 CacheFirst。大型可选媒体通过构建生成的 `/resource-pack.json` 及 `src/resources/` 下载器并发写入独立 Cache Storage。

## 验证边界

- `npm test`：领域、内容、对白、持久化、音频/表现与开发工具单元测试。
- `npm run test:e2e`：主应用和对白工具的浏览器流程。
- `npm run build`：TypeScript project references、Vite 构建、PWA 产物与资源清单。

部署拓扑和命令见 [构建与部署](deployment.md)。
