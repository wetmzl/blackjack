# 刺玫轻松态审查稿 v2

本轮从用户提供的两张原始参考图重新生成，不使用任何旧版刺玫生成图。角色尚未注册，资源 ID 暂用 `cimei`。

## 参考职责

- 图 1：只负责白色高领礼服、露肩结构、分离式蓬袖、黑色细带、层叠灰白蕾丝、白玫瑰与克制的浅色荆棘环。
- 图 2：独占脸部与头部身份。锁定紧凑的成年女性脸型、五官比例与眼距、棕琥珀色眼睛、桃棕色短层次刘海与鬓发、深色尖端的长耳、非对称白花和黑色荆棘冠。
- `public/assets/characters/w-relaxed.png`：只负责 1536×1024 横向画布、人物占比、头身比、腰部裁切与牌桌对面坐姿语义。
- `art/source/master-anime-style-sheet.png`：只负责项目画风、线条、赛璐璐明暗与光照。

旧版刺玫生成图不参与本轮。共同禁止项：图 1 的武器和背景、图 2 的黑色外套、医疗标识、腰带装备、武器与长靴、W 的身份和服装、桌椅、枪械、文字、水印、巨型光环、站姿、遮脸手势、幼态化和泛用狐娘化。

## 生成提示词

```text
Use case: stylized-concept
Asset type: a new base/relaxed table portrait review draft for the adult character 刺玫 in an Android portrait-first blackjack PWA. Generate from scratch and ignore all previously generated 刺玫 images.

Image 1 is costume-only: reconstruct its gathered white high-neck bodice, exposed shoulders, detached voluminous white sleeves, fine black cords and ribbon ties, layered white/gray ruffles and lace, small white roses, and restrained pale thorn-ring motif. Do not copy its face, staff, background, other figure, legs or feet.

Image 2 is the exclusive face/head identity anchor. Preserve its compact adult facial structure, cheek and jaw contour, small nose and mouth, exact eye size and spacing, amber-brown eyes with reddish warmth, straight layered peach-brown bangs, cheek-length side locks, long pointed brown animal ears with dark tips and inner tufts, asymmetric white flower cluster, and black thorn crown. Face fidelity to Image 2 overrides every other reference. Do not import Image 2's black/orange coat, uniform, medical markings, utility equipment, boots or weapon.

W relaxed is composition-only: match its 1536×1024 landscape canvas, head-to-body ratio, person scale, waist/upper-hip crop, seated-across-an-unseen-table semantics and phone-size face readability. The W style sheet is style-only: polished Japanese anime mobile-game rendering, crisp linework, restrained cel shading, material separation, warm key light and cool fill.

Create a calm relaxed table state with a front-facing, neutral-soft direct gaze and closed mouth. Keep the head silhouette and proportions close to Image 2; do not enlarge the eyes, ears, cheeks, bust or hair volume, and do not turn her into a generic cute fox girl. Both complete hands remain below the face. Seat her on the far side of an unseen card table with an upright, naturally relaxed posture and slight forward lean. Crop at the waist/upper hip while keeping the complete head, ear tips, crown, flowers, compact thorn ring, sleeves and hands inside the canvas.

Output a genuinely transparent RGBA character layer. No table, chair, scenery, shadow, staff, weapon, gun, cards, chips, text, logo, watermark, black armored figure, broad smile, open mouth, seductive expression, hand touching face, giant halo, chibi proportions, cropped anatomy, extra limbs or extra fingers.
```

生成器将透明棋盘格烘进 RGB 后，又执行了一次只替换背景为纯 `#00FF00` 的身份保持编辑，并通过 `tools/art/remove-chroma-key.mjs` 提取透明通道。
