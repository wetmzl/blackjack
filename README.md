# House of Chances

Android 竖屏优先的单机 PWA：Blackjack、累积式俄罗斯轮盘、技能卡和角色对战。

## 本地运行

```bash
npm install
npm run dev
```

## 角色内容维护

角色档案、比赛结算文案、AI 参数、牌桌资源和对白统一维护在 `src/content/characters/data/*.json`。每个文件通过 `$schema` 引用带中文字段说明的 `src/content/characters/character.schema.json`；所有有限状态对白池均为必填且互斥解析。直接编辑 JSON 并运行测试即可；旧对白 WebUI 不再是当前维护流程的一部分。

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
