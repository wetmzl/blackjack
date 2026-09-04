# W、德克萨斯、艾丽妮：收藏记录提示词

本组资源使用内置 `imagegen`，每个最终资源独立生成；文件名和字段中的 `trophy` 是兼容性命名。用户参考图负责锁定与会者身份、发型、策展人指定服装、鞋和饰品；项目内已有角色图负责锁定项目的日式二次元手游渲染；年的 `trophyGallery` 负责锁定 5:7、2:3、1:1 三类输出规格和深色软垫收藏环境。

## 共用提示词约束

- 成人女性角色，清晰线稿、控制良好的赛璐璐上色、克制的柔和高光。
- `headshot` 为 5:7 档案式头肩近景，输出后严格缩放为 1000×1400。
- `fullBody` 为 1024×1536 透明角色层，正上方俯视陈列构图，人物头朝上、足朝下；预览时叠加共享 `trophy-gallery-coffin.png`，禁止站姿、裁断四肢、改变服装或把棺材烘焙进角色层。
- `closeups` 为 1:1，一点一图，保持人物身份、服装材质与全身图一致。
- 三名与会者均已在轮盘实弹击发后死亡；使用中性的角色/指定服装/装备档案视角，服装完整，不表现裸露、身体排泄物、开放性伤口、血迹、枪械、额外肢体、文字、Logo 或水印。

## W

身份锁定：短白发、橙色眼睛、黑红不对称帽与面具、黑红怪盗服、交叉胸前束带、黑手套、黑色丝袜、带红边和金属扣的尖头长靴、黑红尾饰。

- `w-trophy-gallery-headshot.png`：5:7 头肩近景，双眼自然闭合，完整保留帽饰、短发、下巴、交叉束带和领口；深色软垫头枕。
- `w-trophy-gallery-full-subject.png`：2:3 正上方俯视透明角色层，W 完整平躺，帽、手、双靴和唯一一条尾巴全部入画。
- `w-trophy-gallery-left-subject.png`：2:3 透明角色层，W 被翻向画面左侧的失力姿势，肩胯与四肢具有受动翻转感，避免安稳睡姿。
- `w-trophy-gallery-prone-subject.png`：2:3 透明角色层，W 背部朝上趴卧，头无力扭向一边；保留大面积露背设计、红色靴底，尾巴从裙底/臀后中央钻出并轻微掀起裙摆。
- `w-trophy-gallery-right-subject.png`：2:3 透明角色层，从俯卧继续翻到另一侧，脸、躯干、屈膝和靴尖明确朝画面右侧；姿态与左侧相反，但不机械镜像不对称服装。
- `w-trophy-detail-face-dazed.png`：1:1 面部近景，橙色双眼失焦、表情安静呆滞，保留帽檐和短白发。
- `w-trophy-detail-chest-costume.png`：1:1 中性服装结构近景，只记录交叉束带、金属扣、黑红领口和上身衣料，不使用挑逗姿势。
- `w-trophy-detail-skirt.png`：1:1 中性裙装结构近景，从已验收的 2:3 全身图以 `x=256, y=380, width=512, height=512` 受控裁切并缩放为 1254×1254；严格保留原图中的双层腰带、不对称黑红裙片、侧面蝴蝶结、袜口束带与尾饰，不重新设计服装。
- `w-trophy-detail-boots.png`：1:1 装备近景，两只黑色尖头长靴保持穿着，准确表现红色镶边与金属扣件。

## 德克萨斯

身份锁定：深蓝长发、黑色狼耳与浅色耳内毛、琥珀色眼睛、白衬衫、黑色马甲/束身结构、蓝色领带、手套、黑色不透明袜和黑蓝短靴。

- `texas-trophy-gallery-headshot.png`：5:7 头肩近景，双眼自然闭合，完整保留狼耳、长发、领带和衣领。
- `texas-trophy-gallery-full-subject.png`：2:3 正上方俯视透明角色层，完整人物平躺，黑色短裤、袜和短靴与角色参考一致。
- `texas-trophy-gallery-left-subject.png`、`texas-trophy-gallery-prone-subject.png`、`texas-trophy-gallery-right-subject.png`：连续翻身三姿势；完整保留超长深蓝发、狼耳、制服与双靴，不生成尾巴。俯卧展示被制服覆盖的背部，左右姿势的脸和屈膝方向必须相反。
- `texas-trophy-detail-face-dazed.png`：1:1 面部近景，琥珀色双眼失焦，保留狼耳与深蓝发色。
- `texas-trophy-detail-boots.png`：1:1 装备近景，短靴保持穿着，表现黑色鞋体、蓝色束带与鞋带结构。
- `texas-trophy-detail-boots-removed.png`：1:1 中性装备陈列，空短靴放在仍被不透明袜完整覆盖的双足旁；无裸足、无裸露。

## 艾丽妮

身份锁定：银白长马尾、黑色尖状羽饰与中央白色褶饰、紫色眼睛、黑白洋红礼服、长款象牙白外裙、白色不透明袜、黑色圆头玛丽珍鞋。

- `irene-trophy-gallery-headshot.png`：5:7 头肩近景，双眼自然闭合，完整保留头饰、马尾发根、衣领和星形胸饰。
- `irene-trophy-gallery-full-subject.png`：2:3 正上方俯视透明角色层，完整人物平躺，长马尾、长裙、双手与双鞋全部入画。
- `irene-trophy-gallery-left-subject.png`、`irene-trophy-gallery-prone-subject.png`、`irene-trophy-gallery-right-subject.png`：连续翻身三姿势；长马尾与完整长裙随重力铺开但不裁切、不掀起。俯卧背部由黑色礼服上衣完整覆盖，禁止继承 W 的露背设计。
- `irene-trophy-detail-face-unwilling.png`：1:1 面部近景，紫色目光保留克制的不甘和不满，不使用夸张痛苦表情。
- `irene-trophy-detail-hand.png`：1:1 斜俯视手部近景，一只戴黑色手套的手掌心向下自然松开，五指完整，白色荷叶袖口、黑色袖管和洋红礼服侧片与全身图一致。
- `irene-trophy-detail-shoes.png`：1:1 从小腿下段到地面的装备近景，黑色圆头玛丽珍鞋、细搭扣、白色不透明袜和脚踝褶边完整入画。
- `irene-trophy-detail-stockings.png`：1:1 从膝下到踝上的中性纺织品近景，只记录暖白色不透明袜料、细微接缝和自然褶皱；不出现脚、上腿或私密区域。
