# 翎羽基础立绘审查稿 v1

状态：基础母版已验收并完成第五名与会者接入；完整续作提示词与资源清单见 [`plume-complete-art-prompts.md`](plume-complete-art-prompts.md)。

## 输入职责

- 用户本轮提供的翎羽全身参考图：唯一身份与服装来源，锁定短黑发、金瞳、贝雷帽与长帽羽、围巾、灰黑白战术服、护臂、青色臂环及左右不对称羽翼结构。
- `public/assets/characters/w-relaxed.png`：只锁定 1536×1024 横向画布、头身比、人物占比、腰部裁切和牌桌对面坐姿语义。
- `art/source/master-anime-style-sheet.png`：只锁定线稿、赛璐璐上色和手机尺寸下的人脸可读性。

## 最终生成提示词

```text
Create one base/relaxed portrait of the adult woman 翎羽 (Plume) for review. Preserve her exact identity, hairstyle, serious temperament, costume construction, colors, accessories, and feather structures from the user's supplied full-body reference. Use W only for the project's visual language, head-to-body ratio, character scale, and waist-up seated-at-the-opposite-side-of-the-table composition.

Keep a slim athletic adult build; short layered charcoal-black bob with feather-like ends and long side locks; amber-gold eyes; the exact tilted black beret, long upright dark feather and small gold feather accent; high black-gray scarf/cowl; angular white shoulder structure; fitted light-gray tunic with black edging and geometric seams; black harness straps and belts; restrained gold triangular details; black armored gloves and forearm bracers with the small teal accent band. Preserve the asymmetric feather structures: the long black checkered feather-cloak panel on one side and layered gray-to-black wing feathers on the other.

Expression: quiet, serious, observant and closed-mouth, with no broad smile or laughter. Pose: seated on the far side of an unseen card table, leaning only slightly forward; one gloved forearm may rest near the unseen table edge and the other hand remains relaxed. Seated semantics must remain clear although no chair or table is drawn.

Strict landscape 3:2 canvas for 1536×1024. Match W's table portrait scale and head-to-body ratio. Crop at the waist/upper hip; keep the complete head, beret, upright feather, shoulders, hands and important upper portions of both asymmetric feather structures visible. This is not a standing or full-body pose and must not show legs or feet.

Polished Japanese anime mobile-game illustration, crisp controlled linework, restrained cel shading, clear separation of cloth, armor, leather and feathers, with the same restrained warm key light and cool fill as W. Genuinely transparent background and clean cutout edges.

Do not transfer W's identity, white hair, hat, mask, red-black costume, tail or expressions. No redesign, standing pose, full body, visible chair, visible table, polearm, weapon, gun, cards, chips, text, logo, watermark, scenery, colored backdrop, open-mouth grin, chibi proportions, oversized head, extra limbs, extra fingers, fused feathers or cropped hands.
```

生成模式：内置 `imagegen` 参考图生成。生成器输出的浅色棋盘格使用 `tools/art/remove-checkerboard.mjs` 提取为透明通道，未做重绘或滤镜修饰。

审查稿：`art/source/plume-relaxed-review-v1.png`。
