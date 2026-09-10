# 提丰基础美术审查稿 v1

状态：`relaxed` 母版与 trophy gallery 默认正面层已通过用户审核；基础人物图与四组 trophy 局部特写均已完成。资源已进入 `public/assets/characters/`，但提丰角色数据尚未注册。

## 输入职责

- 用户提供的图 1：只负责精细日式二次元手游的面部表现、线稿、赛璐璐渐变和材质完成度，不继承其夸张身体比例。
- 用户提供的图 2：提丰身份、淡紫色长卷发、双角、黑白灰机能服、束带、银色环扣、铜色机械细节、腿部结构和鞋履的权威来源。
- `public/assets/characters/ho-olheyak-relaxed.png`：只负责横向透明人物层与牌桌对面坐姿的项目语言。
- `public/assets/characters/ho-olheyak-trophy-gallery-full-subject.png`：只负责默认收藏人物层的俯视镜头、人物比例和共同画布。
- `public/assets/characters/trophy-gallery-coffin.png`：只负责收藏人物层的定位边界、冷色光照与最终合成检查；不得烘焙进人物层。

## 牌桌构图锁定

提丰的所有牌桌人物图统一使用比现有常规角色更远的机位：人物坐在桌子较远一侧，画面至少保留到膝部，完整显示双角、主要发卷、双手和膝部。后续 `mocking`、`conflicted`、`threatened`、`unconscious-reclined` 等状态以 `relaxed` 为身份和位置母版，只改变该状态必要的表情、手部紧张度与受击姿态，不擅自拉近镜头或改回腰部裁切。

## 已验收母版

- `art/source/typhon/typhon-relaxed-review-v1.png`：1536×1024 RGBA 透明人物层；较远牌桌对面坐姿，膝部可见。
- `art/source/typhon/typhon-trophy-gallery-full-subject-review-v3.png`：1024×1536 RGBA 透明人物层；正上方俯视、完整仰躺，人物与长发收在共享陈列舱软垫范围内。
- `art/source/typhon/typhon-trophy-gallery-full-composite-review-v3.png`：人物层与共享陈列舱的本地合成审查图，不作为游戏运行时资源。

两张人物层均使用内置 `imagegen` 参考图生成；生成器的 `#00FF00` 绿幕通过 `tools/art/remove-chroma-key.mjs` 提取真实透明通道。trophy gallery v3 仅在 v2 透明层上做等比缩小与共同画布居中，没有重绘人物。

## 完成资源

- `typhon-relaxed.png`、`typhon-conflicted.png`、`typhon-mocking.png`、`typhon-threatened.png`、`typhon-unconscious-reclined.png`：1536×1024 RGBA 牌桌人物层；统一保留较远机位和膝部可见关系。
- `typhon-defeated-summary-chair.png`：1024×1536 RGBA；完整人物、双鞋和四脚工业椅均未裁切。
- `typhon-trophy-defeated.png`：1600×450 RGBA；人物完整横躺于横向工业收纳舱，舱体外透明。
- `typhon-trophy-gallery-headshot.png`：1000×1400；档案式头肩像，完整保留双角、下巴和领口。
- `typhon-trophy-gallery-full-subject.png`、`typhon-trophy-gallery-left-subject.png`、`typhon-trophy-gallery-prone-subject.png`、`typhon-trophy-gallery-right-subject.png`：1024×1536 RGBA 透明人物层；运行时统一叠加 `trophy-gallery-coffin.png`。
- `typhon-trophy-detail-face.png`：1024×1024 头部特写；两只黑色手套从左右轻压脸颊，仅保留脸、角、头发和领口。
- `typhon-trophy-detail-chest-costume.png`：1024×1024 胸前服装特写；集中展示银色项圈、黑色机能面料、交叉束带、环扣与洋红点缀。
- `typhon-trophy-detail-thigh.png`：1024×1024 大腿服装特写；从既有全身透明层取样重排，展示健康肉感、非对称袜带、铜色扣件与长袜上缘。
- `typhon-trophy-detail-boots.png`、`typhon-trophy-detail-boots-p1.png`：1024×1024 足部差分；人物均为仰躺，后侧小腿与脚跟落在软垫上。原态穿完整机能靴，差分脱靴并展示黑色踩脚袜的包覆、露趾与露跟结构。

所有局部特写均锁定为 1:1 近摄，画面不得出现膝盖或膝盖骨；足部两张还必须保持同一仰躺机位，不得呈现站立或脚掌承重姿态。

## 派生提示词与处理

- `conflicted`：只把母版改为向牌面集中注意、轻微蹙眉和手指收紧，不改变镜头与坐姿。
- `mocking`：只加入克制的闭口讥笑和略微眯起的眼神，不改成人物近景或夸张表演。
- `threatened`：只加入临刑紧张表情、绷紧肩手，并在太阳穴一侧给共享左轮图层留出空间；角色图内不生成枪。
- `unconscious-reclined`：上身后仰约 10–15°、头部轻微侧倾、眼口失去控制、手臂松弛；仍保留到膝部的牌桌构图。
- `defeated-summary-chair`：独立生成完整工业椅构图，人物失力瘫坐，显示双鞋和椅子四脚。
- `trophy-defeated`：独立生成正上方横向收纳舱，头在右、足在左；最终等比缩放进入 1600×450 透明画布，没有横向拉伸人物或舱体。
- `headshot`：独立生成 5:7 深色绗缝档案头肩构图，完整保留双角和领口。
- 收藏左侧、俯卧、右侧姿势分别从默认正面层派生；俯卧时背部由服装和外套完整覆盖。人物层按不同比例做受控等比缩放并居中，使长发、角、外套、手和鞋全部留在共享陈列舱内。
- `detail-face`：极近脸部构图，两只黑色手套只对脸颊做对称轻压，眼睛闭合，不扩展到胸部或四肢。
- `detail-chest-costume`：服装结构近摄，以项圈、束带、环扣和面料为主体，不扩展到腿部。
- `detail-thigh`：内置生成两次因输出审核被拒，最终从已验收的全身透明层截取短裤下缘至长袜上缘，并在深色方形展垫上等比重排；没有重绘身体或服设。
- `detail-boots`：从脚端低角度表现仰躺足部，软垫连续出现在脚后与脚下，鞋底不承重；`p1` 只移除靴子并露出黑色踩脚袜，保持同一姿态、机位和裁切。

所有生成稿使用内置 `imagegen`；透明资源保留对应的 `#00FF00` 绿幕源图。后处理仅包含色键提取、等比缩放、居中和规定尺寸裁切。图 2 的巨型弓具与外置机械结构不进入牌桌人物层或陈列舱人物层，服装本体、束带、环扣、铜色细节与鞋履保持连续。
