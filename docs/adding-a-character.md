# 新增与会者工作流

本流程以 W 为金样本，适用于与会者美术、档案、数据接入和最终验收。每名与会者都必须有明确的执念、回应策展人邀请的理由，并在古堡中换上策展人指定的服装。除非任务明确要求完整接入，否则先交付可复用的美术资源和档案草案，不用旧角色对白填充新角色。

## 1. 先确认范围与参考职责

1. 阅读 `AGENTS.md`、`docs/game-design.md`、`tools/art/README.md`、`src/content/characters/types.ts`、`character.schema.json`、`catalog.json` 和 W 的角色数据。
2. 检查工作区已有修改；未提交内容一律视为用户工作，不覆盖、不回滚。
3. 给每张参考图指定唯一职责：
   - 用户角色图：锁定身份、发型、策展人指定服装、配色、饰品和身体标记。
   - W 对应状态图：锁定头身比、人物占比、裁切、状态表现和日式二次元渲染。
   - 不把 W 的服装、瞳色、饰品或角色特征迁移到新角色。
4. 开始生成前列出禁止项，尤其是站姿、额外武器、文字、水印、背景和未经授权的服装改造。

## 2. 固定美术槽位与规格

每名与会者使用七张基础专属图；发牌员左轮继续复用 `staff-revolver-7mm.png`。完整交付还必须包含纸质战利品档案、档案头肩像、竖屏遗体图和商定数量的方形记录图。现有全部角色都已按这一结构接入；`trophyGallery` 在 Schema 中保持可选，只用于允许明确不做深度收藏记录的与会者或渐进式资源交付。`trophyDossier` 对所有角色必填，并复用 `assets.defeatedSummary` 作为左上角椅子档案图。`staff`、`unconscious`、`defeated` 与 `trophy` 是兼容性代码命名，说明和画面语义分别按“发牌员”“死亡”“遗体”“收藏记录”处理。

| 槽位 | 文件名 | 最终规格 | 构图约束 |
| --- | --- | --- | --- |
| 轻松 | `<id>-relaxed.png` | 1536×1024 RGBA | 桌子对面、坐姿语义、腰部截止；不画桌椅和枪 |
| 纠结 | `<id>-conflicted.png` | 1536×1024 RGBA | 沿用轻松态镜头，只改专注表情和小幅手势 |
| 嘲讽 | `<id>-mocking.png` | 1536×1024 RGBA | 沿用腰部镜头，表情在手机尺寸下清楚 |
| 紧张 | `<id>-threatened.png` | 1536×1024 RGBA | 只做临刑紧张表情；枪与发牌员手臂由共享图层叠加 |
| 死亡 | `<id>-unconscious-reclined.png` | 1536×1024 RGBA | 实弹击发后的腰部桌面层，仅轻微后仰；禁止椅子、床和枪 |
| 策展人胜利总结 | `<id>-defeated-summary-chair.png` | 1024×1536 RGBA | 遗体完整瘫坐在有靠背、有扶手、四脚稳定的工业椅；
| 收藏横幅 | `<id>-trophy-defeated.png` | 1600×450 RGBA | 遗体完整横躺在窄工业收纳舱；舱体外透明 |
| 档案头肩像 | `<id>-trophy-gallery-headshot.png` | 5:7（建议 1000×1400） | 死亡后的头部与肩部，档案式紧凑构图 |
| 共享陈列舱底图 | `trophy-gallery-coffin.png` | 1024×1536 RGB/RGBA | 空的深色软垫工业陈列舱；所有角色与姿势复用同一张图 |
| 默认竖屏角色层 | `<id>-trophy-gallery-full-subject.png` | 1024×1536 RGBA | 透明背景的完整遗体，与共享陈列舱逐像素对齐，并作为记录点坐标基准 |
| 可选姿势角色层 | `<id>-trophy-gallery-<pose>-subject.png` | 1024×1536 RGBA | 透明背景的其他姿势，与共享陈列舱逐像素对齐；不显示默认姿势的记录点 |
| 局部记录 | `<id>-trophy-detail-<point>.png`、`<id>-trophy-detail-<point>-p1.png`… | 1:1 | `image` 为默认 p0；同一兴趣点可附加多张差分并逐张使用独立描述 |

牌桌基线以 `TABLE_ART_BASELINE` 为准：W、1536×1024、`horizontal-seated`、`normalSittingScale = 1`。轻量目录中的 `portraitScales` 为角色选择页和牌桌共用的分场景缩放配置：`selection`、`table` 均默认 1，允许范围为 0.75–1.5。只有经过手机实机验收才覆盖对应场景，不能用缩放补救错误画布或构图；角色选择框会裁切变换后的图像，避免立绘越出卡框。

## 3. 生成顺序

1. 先生成轻松态母版。提示词同时锁定角色参考图和 W 的画面比例，明确“腰部截止、人物在桌对面、非站姿”。
2. 验收母版的人脸、发型、服装、饰品、手指、画布和人物占比；母版不合格时不继续批量衍生。
3. 纠结、嘲讽、紧张从同一母版做身份保持编辑，每次只改变一个状态变量。
4. 紧张态不生成枪械；枪口抵近和动画属于 DOM 的共享发牌员图层。
5. 死亡态独立编辑，但仍保持牌桌腰部构图，不复用总结页椅子图。
6. 总结页与收藏图单独生成；它们的完整身体构图不能回流到牌桌状态。
7. 每张生成图都逐一检查，不把“生成成功”当成“验收成功”。

## 4. 收藏记录生成步骤

年的实现是这部分的金样本。以后新角色以及补齐旧角色时按以下顺序执行：

1. 先锁定输入职责：角色参考图负责身份、发型、策展人指定服装、饰品、鞋、身体标记与尾巴等种族特征；该角色已经验收的牌桌/总结/横版收藏图负责项目画风和死亡状态。不得用 W 或年的服装细节替代目标角色自己的设计。
2. 生成 `headshot`：严格 5:7，推荐 1000×1400；采用死亡档案式头肩构图，完整保留头顶、角/耳、下巴和领口。角色必须明显失去生命体征，禁止用普通头像裁切冒充。
3. 先单独生成并验收空的 `trophy-gallery-coffin.png`。角色不得烘焙进这张底图，后续所有角色和姿势都必须复用它，避免陈列舱形状、绗缝、金属框和灯光漂移。
4. 生成 `fullBody` 角色层：严格 1024×1536 RGBA，只保留透明背景上的完整人物；以共享陈列舱为定位参考，使用竖屏俯视构图，头在上、足在下。双手、双鞋、长发、尾巴/翅膀等角色特征都不得裁切，也不得使用站姿。可选 `poses` 同样输出整张透明画布，不得自带陈列舱或改变镜头。
5. 逐张生成 `closeups`：严格 1:1，一点一图。可以改变镜头高度与观察角度，但人物身份、服装、饰品、材质、死亡状态和陈列环境必须与默认 `fullBody` 合成画面一致；需要角度变化时应独立生成，不得只把全身图机械放大冒充新视角。所有局部图必须保持中性的角色、服装或装备档案视角，不制作身体排泄物、私密部位或性化的遗体特写；液体材质需求只能表现为来源明确的外部清水，并远离私密区域。
6. 先验收“共享陈列舱 + 默认 `fullBody`”合成画面，再量记录点坐标。`x`、`y` 均是相对完整 2:3 合成画布左上角的 0–100 百分比；记录点只在默认姿势显示。不同部位或观察角度使用不同 ID 和略微错开的记录点，例如 `feet-overhead` 与 `feet-side`；同一兴趣点的连续状态或装备差分则放入该点的 `variants`，不要拆成重叠热点。
7. 每个局部记录对象写入唯一 `id`、面向策展人的 `name`、`x`、`y`、作为 p0 的方形 `image` 和对应 `description`。可选的 `variants` 按 p1、p2……顺序保存 `{ image, description }`；打开兴趣点后点击局部立绘会依次循环并回到 p0。兴趣点和差分数组均没有统一数量要求。
8. 为纸质行政档案填写必需的 `trophyDossier`。标题、档案编号、展开/收起标签、六组字段标签和值，以及尸体状况标题和正文全部写入角色 JSON；UI 不补默认文案。六个字段 ID 固定为 `name`、`race`、`gender`、`tier`、`weight`、`virginity`，各出现一次并按 JSON 数组顺序排版。无法确认的值明确写“未记录”或“未核验”，不能由 UI 猜测。收藏卡片的等级、角色名和首次击败日期仍由目录元数据与记录生成。
9. 只有策展人胜利、与会者死亡后产生的首次击败藏品，且角色存在 `trophyGallery` 时，才显示头肩像和全屏入口；策展人落败或中止牌局时不得加载或泄露收藏图。对局历史被单独清理后，藏品与深度鉴赏仍须可用。
10. 保存最终生成提示词与参考图职责。至少截图验收 390×844 和 320×720：头像比例、全身完整性、记录点位置、姿势切换、方形图、名称、描述、关闭/返回链路都必须可用。

## 5. 透明通道与受控后处理

1. 优先要求图像工具直接输出真实透明背景。
2. 如果工具把棋盘格烘进 RGB，且角色包含大量白发、浅色皮肤或白色服装，不要直接用宽松的中性色阈值清理，以免误删角色。
3. 可先把背景编辑成纯 `#00FF00` 绿幕，再执行：

   ```bash
   node tools/art/remove-chroma-key.mjs input.png output.png
   ```

4. 收藏横幅源图需要受控裁切时使用：

   ```bash
   node tools/art/crop-resize-png.mjs input.png output.png SOURCE_X SOURCE_Y SOURCE_WIDTH SOURCE_HEIGHT 1600 450
   ```

5. 后处理只允许裁切、缩放、透明提取和边缘去色；不得用滤镜掩盖身份或服装偏差。

## 6. 档案与数据接入

美术阶段可以先在 `src/content/characters/data/<id>-profile.md` 保存可直接使用的 `profile.description`，但必须标明尚未注册。

完整接入时再完成以下步骤：

1. 新建 `src/content/characters/data/<id>.json`，满足 `character.schema.json` 的全部字段和全部有限状态对白池；必填的 `trophyDossier` 结构如下。它的左上图无需新增路径，展示层固定复用同一 JSON 的 `assets.defeatedSummary`。

   ```json
   {
     "trophyDossier": {
       "title": "人物档案",
       "recordLabel": "档案 // 09",
       "openLabel": "档案",
       "closeLabel": "收起",
       "fields": [
         { "id": "name", "label": "姓名", "value": "角色名" },
         { "id": "race", "label": "种族", "value": "种族" },
         { "id": "gender", "label": "性别", "value": "性别" },
         { "id": "tier", "label": "评级", "value": "B" },
         { "id": "weight", "label": "重量", "value": "未记录" },
         { "id": "virginity", "label": "处女性", "value": "未核验" }
       ],
       "condition": {
         "label": "尸体状况",
         "description": "确认死亡；遗体已完成初步收容，服装与随身物品保存完整。"
       }
     }
   }
   ```
2. 在 `catalog.json` 添加唯一的 `id`、名称、副标题、等级、多个 `tags`、预览图、收藏横幅和数据文件名。`tier:<小写等级>` 会由目录自动生成，不能在自定义 tag 中重复声明。需要门槛时再配置 `unlock`：可使用 `defeat-any`、`defeat-any-tag`、`defeat-character` 或 `defeat-tag-percentage`；引用的角色和 tag 必须已经存在于同一目录。
3. 为角色单独配置 AI 阈值参数 `P/A/B/C`、结算文案和 `revolverPlacement`；参数默认值为 `0/1/1/1`，含义与公式见 [玩法与叙事设计](game-design.md#ai-与信息权限)。选择页或牌局内立绘只有在实机验收明确要求时，才在 `catalog.json` 设置 `portraitScales.selection` 或 `portraitScales.table`。不要复制 W 的人物对白充数。
4. `staffRevolver` 指向共享发牌员资源；根据紧张态头部位置分别校准桌面端和移动端坐标。
5. 只有在任务明确要求时才新增该角色解锁的 Player Skill；通过其 `unlock.opponentId` 声明解锁来源，局内抽卡会从全部已解锁且允许掉落的技能中生成候选。
6. 深度收藏资源写入可选的 `trophyGallery`：`headshot`、透明角色层 `fullBody`、可选 `poses` 和 `closeups`。每个 `poses` 对象包含与会者内唯一 `id`、按钮名称和透明角色层路径；每个 `closeups` 对象必须包含与会者内唯一 `id`、名称、0–100 的 `x/y` 百分比坐标、作为 p0 的方形 `image` 和对应 `description`，可选 `variants` 为 p1、p2……分别提供图片与描述。姿势和兴趣点数组均由 Schema 校验唯一 ID。

角色档案中的技能栏由 `aiSkills` 自动生成：角色 JSON 只绑定 `{ definitionId, enabled, parameters }`，且 Definition 必须来自独立 AI Skill Catalog，不重复技能名称、规则或文案。技能名称与规则说明来自能力注册表；文学化的档案描写写在能力定义的可选 `profileLore` 字段中。只有 `enabled: true` 且能在注册表中找到的绑定会显示，未配置技能的角色不显示空栏。

### 6.1 添加单一角色信息栏

牌桌右上角在双方弹量下方保留一个可选的角色机制信息槽。需要持续公开 AI Skill 的变量、花色或牌时，只修改角色 JSON 的单个 `infoBar`；不要在 `app.ts`、reducer 或能力解释器中加入角色 ID 分支。

添加步骤：

1. 先在角色的 `aiSkills` 中绑定并启用负责该信息的 AI Skill。
2. 新增一个 `infoBar`。`sourceAbilityId` 必须等于上述某个 `enabled: true` 的 `definitionId`；技能 TTL 归零后，数值栏显示 0，牌或花色栏显示暂无。
3. `label` 使用能放入窄栏的中文短标题；`description` 完整解释当前值、变化条件、上下限和失效条件，供信息按钮弹窗显示。
4. 用 `value` 声明投影内容：
   - `number`：可读取 `gun-bullets`、`hand-total`、`hand-card-count`、`round-hit-count`、`status-stacks`，并用 `add`、`subtract`、`multiply`、`min`、`max` 组合；也可直接使用数字或 `constant`。
   - `suit` / `card`：从 `last-card` 或 `first-private-card` 读取花色或整张牌。
   - `owner` 始终指该与会者，`rival` 始终指策展人。`round-hit-count` 从当前轮最新 `ROUND_STARTED` 之后计数。
   - 跨轮记忆牌使用 `{ "type": "card", "source": "status-card", "statusDefinitionId": "..." }`；该状态应由能力原语保存完整 rank、suit、source 与原始 cardId。信息栏复用统一牌面 renderer（例如“♥ 4”），状态尚未建立时显示暂无。
5. 数值默认原样显示；概率使用顶层 `"format": "percent"`，底座值保持 0–1，例如 `0.66` 显示为 `66%`。
6. 运行 `npm test`、`npm run build`，并为新类型或新交互补充聚焦测试。若配置会公开与会者暗牌，必须确认这确实是该机制有意授予策展人的信息，不能无意绕过牌面信息边界。
7. 若现有投影原语不够，先同步扩展 `core/abilities/types.ts`、`core/abilities/info-bar.ts`、角色 Zod Schema、`character.schema.json` 和聚焦测试，再让角色 JSON 使用新原语；不要把新算法直接写进 UI。

W 的领先张数配置如下：

```json
"infoBar": {
  "sourceAbilityId": "bomb-maniac",
  "label": "W领先优势",
  "description": "W当前比策展人领先的手牌张数,每领先一张，双方爆牌上限就提升一点。",
  "value": {
    "type": "number",
    "value": {
      "type": "max",
      "left": 0,
      "right": {
        "type": "subtract",
        "left": { "type": "hand-card-count", "target": "owner" },
        "right": { "type": "hand-card-count", "target": "rival" }
      }
    }
  }
}
```

艾丽妮使用同一底座把本轮策展人的 Hit 次数换算成哑火概率，并封顶为 100%：

```json
"infoBar": {
  "sourceAbilityId": "ai-sword-and-handcannon",
  "label": "本轮哑火概率",
  "description": "若艾丽妮在本轮承受轮盘惩罚……",
  "format": "percent",
  "value": {
    "type": "number",
    "value": {
      "type": "min",
      "left": 1,
      "right": {
        "type": "multiply",
        "left": { "type": "round-hit-count", "target": "rival" },
        "right": 0.33
      }
    }
  }
}
```

## 7. 验收清单

- 所有牌桌图都是 1536×1024、真实 RGBA、腰部截止、无桌椅、无枪、无背景。
- 角色的人脸、发色、角/耳、服装、饰品、纹样与用户参考一致；各状态身份不漂移。
- 紧张态与共享发牌员左轮在桌面和 Android 竖屏上都能对准与会者头部。
- 总结图完整包含人物、双鞋和有靠背工业椅；不是站姿或高脚凳。
- 收藏横幅严格为 1600×450，人物与舱体无裁切，舱体外透明。
- 档案头肩像为严格 5:7；共享陈列舱和所有竖屏角色层为 1024×1536，角色层具有真实透明通道并在叠加后完整贴合舱内；所有局部记录为 1:1，记录点实际落在默认姿势的对应部位且不会越出 0–100 坐标范围。
- 全屏鉴赏右侧默认只露出档案边缘和可点击标签，不遮挡既有控制；展开后纸质档案与陈列舱等高。左上角完整显示 `assets.defeatedSummary`，右侧恰有六个字段，下方只保留“尸体状况”，正文落在第一条分割线上。390×844 与 320×720 均不得产生页面横向滚动。
- 只有策展人胜利且与会者死亡的首次击败藏品显示头肩像与全屏收藏入口；策展人落败或中止牌局不得提前显示收藏资源，清理对局历史不得移除藏品。
- 卡片与详情的收藏等级、角色名来自目录元数据，不在 `trophyGallery` 重复维护；卡片日期来自独立首次击败记录。
- 透明像素、半透明边缘和不透明主体同时存在；没有绿边、棋盘格或误删的白发/服装。
- 完整数据接入后运行 `npm test`、`npm run build`，并用目标 Android 竖屏尺寸检查大厅、牌桌、总结页和收藏弹窗。
- 最终交付列出所有资源路径、最终提示词/提示词组、使用的图像生成模式，以及尚未接入的内容。
