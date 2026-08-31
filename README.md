# House of Chances

Android 竖屏优先的单机 PWA：Blackjack、累积式俄罗斯轮盘、技能卡和角色对战。

## 本地运行

```bash
npm install
npm run dev
```

## 对白维护台（仅开发入口）

```bash
npm run dialogue:admin
```

管理台默认监听 `4174`。它会优先检测名称包含 `tailscale` 的非内部 IPv4 并绑定该精确地址；没有可用地址时回退到 `127.0.0.1`，也可用 `--host`、`--port` 或 `DIALOGUE_ADMIN_HOST`、`DIALOGUE_ADMIN_PORT` 覆盖。管理台直接编辑 `src/content/characters/data/*.json`，不是游戏公开页面，也不使用 HTTPS。

## 验证

```bash
npm test
npm run test:e2e
npm run build
npm run test:dialogue-admin
```

领域逻辑位于 `src/core/`，不依赖 DOM、IndexedDB、音频或定时器。存档使用 Dexie + IndexedDB，并通过 Zod 验证和版本迁移。

开发环境或 URL 带 `?debug=1` 时会显示 Developer HUD。生产构建默认关闭。
