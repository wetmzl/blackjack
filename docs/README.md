# 文档索引

`AGENTS.md` 只保存长期有效的设计与协作约束；细节按职责维护在以下文档中。

## 设计与架构

- [玩法与叙事设计](game-design.md)：世界观、术语、牌局规则、场景流转、AI 信息边界和移动端体验。
- [技术架构](architecture.md)：模块边界、状态流、确定性、数据驱动内容、能力引擎、持久化与 PWA。

## 内容工作流

- [新增与会者](adding-a-character.md)：角色美术、档案、目录、Schema、AI 信息栏、对白与验收。
- [新增能力](adding-an-ability.md)：能力 JSON、通用原语、注册、版本与测试。
- [美术资源管线](../tools/art/README.md)：源图职责、透明通道、裁切缩放和资源落盘。

## 运行与交付

- [项目 README](../README.md)：项目概览、本地启动和常用验证命令。
- [构建与部署](deployment.md)：Cloudflare Pages 生产发布、本地 systemd 服务与验证。

## 维护原则

- 游戏行为以 `src/core/`、Schema 和自动化测试为事实来源。
- 角色与能力的当前内容以 `src/content/` 下的 JSON 和注册表为事实来源。
- 已完成的一次性需求说明不继续充当架构文档；实现落地后，把稳定结论合并到上述专题文档并删除旧需求稿。
