# 刺玫美术审查稿 v1

当前仅保存审查稿，角色尚未注册。角色资源 ID 暂用 `cimei`，待接入前再确认。

## 参考职责

- 用户最初提供的场景图：锁定白色多层礼服、黑色细带、白玫瑰、赤足与脚踝绑带。
- 用户后续提供的高清立绘：只锁定脸部、桃棕发色、长兽耳、黑色荆棘冠和白花头饰；不迁移黑色外套、医疗标识、腰包或武器。
- 已生成的轻松态审查图：只补充白礼服上半身的结构与材质。
- `public/assets/characters/w-trophy-gallery-full-subject.png`：只锁定 1024×1536 画布、正上方镜头、人物比例和失力平躺语义。
- `public/assets/characters/trophy-gallery-coffin.png`：只用于人物层坐标与可用内框验收，不烘焙进人物图。

共同禁止项：新高清立绘的黑色外套与武器、陈列舱、背景、投影、站姿、文字、水印、额外肢体、血迹、伤口和性化遗体镜头。

## `trophy-gallery-full-subject` v1

生成提示词：

```text
Use case: stylized-concept
Asset type: review draft for cimei-trophy-gallery-full-subject.png, a layered character foreground in an Android portrait-first anime blackjack game's collection gallery.

Generate exactly one complete full-body character layer for 刺玫, viewed from directly overhead, aligned to the supplied shared empty industrial display coffin. Generate a non-graphic deceased adult woman: eyes closed, jaw relaxed, limbs limp, complete body visible. The new HD illustration controls only the face, peach-brown hair, long animal ears, black thorn crown and white flower headpiece. The original reference and relaxed draft control the white layered off-shoulder dress, black straps, white roses, bare feet and black ankle ribbons. Do not transfer the HD reference's black coat, medical markings, waist equipment or weapon.

Strict 1024×1536 portrait canvas. Match W's overhead subject scale and coordinates. Keep the whole head, ears, hair, hands, dress, ribbons and both feet inside the shared coffin's padded inner area. Output only a genuinely transparent RGBA character layer. No coffin, scenery, furniture, weapon, text, watermark, blood, wound, shadow, standing pose or sexualized framing.
```

背景修复提示词：

```text
Change only the checkerboard-pattern background to a perfectly flat, uniform, opaque #00FF00 chroma-key background. Preserve the character, pose, scale, coordinates and canvas. Add nothing else.
```

绿幕源图经 `tools/art/remove-chroma-key.mjs` 提取透明通道。v1 叠加共享陈列舱后，人物头发、袖裙和右侧飘带越过金属内框；该版本只供脸、服装和姿态方向审查，不作为最终接入资源。
