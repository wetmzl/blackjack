# 美术资源管线

美术的详细槽位、尺寸、构图与角色接入验收以 [`docs/adding-a-character.md`](../../docs/adding-a-character.md) 为准。本文只记录通用生产流程和仓库内工具，角色专属提示词保存在 `docs/art/`。

## 输入职责

- 用户提供的目标角色参考负责身份、发型、服装、配色、饰品与身体标记。
- `art/source/master-anime-style-sheet.png` 和已经验收的 W 牌桌资源负责项目画风、光照、头身比与构图基线。
- 图像模型只生成插画源图，不生成扑克牌数字、花色、规则文本、水印或 UI 文案。

## 生产流程

1. 为每张参考图和输出图指定唯一职责，先列出禁止项。
2. 先完成并验收目标角色的轻松态母版，再以身份保持编辑衍生其他牌桌状态。
3. 牌桌紧张态不生成枪；发牌员手与左轮使用共享透明图层，并在角色数据中校准 `revolverPlacement`。
4. 牌桌死亡态、总结页椅子图、收藏横幅、档案头肩像、竖屏全身图和局部记录分别生成，不混用构图。竖屏收藏先固定一张共享空陈列舱，再为每个角色/姿势输出同尺寸透明前景，禁止重复生成带角色的陈列舱。
5. 检查身份、姿态、画布、裁切、透明通道和手机尺寸可读性，再做受控后处理。
6. 最终 Web 资源进入 `public/assets/characters/`，源图与可复用母版进入 `art/source/`，最终提示词进入 `docs/art/`。

只允许裁切、缩放、透明提取和必要的边缘去色；不使用不可复现的滤镜掩盖身份、服装或构图问题。

## 仓库工具

从指定区域裁切并缩放 PNG：

```bash
node tools/art/crop-resize-png.mjs \
  input.png output.png X Y WIDTH HEIGHT OUTPUT_WIDTH OUTPUT_HEIGHT
```

从饱和 `#00FF00` 绿幕提取透明通道，可一次处理多组输入输出：

```bash
node tools/art/remove-chroma-key.mjs input.png output.png
```

清除被烘进 RGB 的浅色棋盘格：

```bash
node tools/art/remove-checkerboard.mjs input.png output.png
```

将上下堆叠的两张收藏横幅拆成 1600×450 PNG：

```bash
node tools/art/split-stacked-trophy-sheet.mjs \
  input.png top-output.png bottom-output.png
```

这些工具使用 Playwright/Chromium。处理完成后必须检查输出尺寸，并确认透明、半透明与不透明像素符合预期；白发、浅色服装和高光不得被误删。
