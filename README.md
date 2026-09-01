# House of Chances

Android 竖屏优先的单机 PWA：Blackjack、累积式俄罗斯轮盘、技能卡，以及策展人与泰拉与会者之间的死亡对决。

玩家是来自高位面的“策展人”，向整个泰拉发出邀请。怀着执念的与会者进入古堡、换上指定服装，参加魔鬼游戏“黑杰克轮盘赌”：败局会不断向左轮填弹；与会者受罚时由发牌员瞄准头部，实弹击发即当场死亡。策展人的枪口只朝向天花板；与会者若赢下整局，公开回报是由策展人实现任意一个愿望。

策展人落败后能够回溯到本局以前并重开，直到与会者死亡。这是与会者永远无法得知的隐藏真相。代码中的 `player` 指策展人，`opponent` / `AI` 指与会者；`player-killed`、`unconscious` 和 `trophy` 等现有标识暂为兼容性名称，不代表策展人真的死亡，也不再把与会者中枪解释为昏迷。

## 本地运行

```bash
npm install
npm run dev
```

## 角色内容维护

与会者档案、参局执念、比赛结算文案、AI 参数、牌桌资源和对白统一维护在 `src/content/characters/data/*.json`。每个文件通过 `$schema` 引用带中文字段说明的 `src/content/characters/character.schema.json`；所有有限状态对白池均为必填且互斥解析。直接编辑 JSON 并运行测试即可；旧对白 WebUI 不再是当前维护流程的一部分。

## 验证

```bash
npm test
npm run test:e2e
npm run build
```

## systemd 部署

生产网页服务由 `blackjack.service` 维护，监听 `0.0.0.0:4173`，使用构建后的 `dist/`。

首次安装并启动：

```bash
npm run systemd:install
```

代码上线后执行：

```bash
npm run deploy
```

该命令会先构建，成功后执行 `systemctl daemon-reload`、重启服务并检查首页。查看日志：

```bash
sudo journalctl -u blackjack.service -f
```

领域逻辑位于 `src/core/`，不依赖 DOM、IndexedDB、音频或定时器。存档使用 Dexie + IndexedDB，并通过 Zod 验证和版本迁移。

开发环境或 URL 带 `?debug=1` 时会显示 Developer HUD。生产构建默认关闭。
