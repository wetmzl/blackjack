# 战利品陈列室分层素材

本批资源使用内置 `imagegen` 的图像编辑模式制作，目标是把原先五张各自生成的“人物 + 棺材”合成图拆成一张共享棺材底图和二十张透明人物层。每名角色都有正面、左侧、俯卧、右侧四个连续翻身方向；所有输出固定为 1024×1536，并在相同画布坐标中叠加。

## 共享棺材

参考 `art/source/trophy-gallery/w-trophy-gallery-full.png`，移除人物及所有人物投影，补全被遮挡的黑色菱形绗缝软垫；保持工业金属框、红色状态灯、俯视镜头、透视、冷色灯光与画布边界完全不变。画面不得出现人物、肢体、衣物、文字或新道具。

输出：`public/assets/characters/trophy-gallery-coffin.png`。

## 默认人物层

分别以 `art/source/trophy-gallery/` 中 W、德克萨斯、艾丽妮、年、翎羽原有的 `*-trophy-gallery-full.png` 为身份与位置参考。保留人物及其头发、耳/角、服装、手足、鞋靴、尾巴或翅膀的原始尺寸、姿态、光影和画布坐标；移除棺材、绗缝、金属框、灯光背景及环境投影。编辑阶段先换成纯 `#00FF00` 绿幕，再用仓库色键工具提取真实透明通道并清除边缘溢色。不得裁切角色特征、增加肢体或重设计服装。

输出：

- `w-trophy-gallery-full-subject.png`（只有一条箭头形尾巴）
- `texas-trophy-gallery-full-subject.png`
- `irene-trophy-gallery-full-subject.png`
- `nian-trophy-gallery-full-subject.png`（完整保留龙尾与绿色手串）
- `plume-trophy-gallery-full-subject.png`（完整保留不对称双翼）

## 四方向姿势组

共同姿势提示：以目标角色自己的正面收藏源图锁定身份、服装、配件、种族特征与人物比例；W 对应姿势只负责锁定俯视镜头、受力状态和翻身阶段，不得迁移 W 的服装、尾巴或露背结构。角色完整置于纯 `#00FF00` 的 2:3 画布中，背景不得包含棺材、投影、纹理或棋盘格。四张按“正面 → 左侧 → 俯卧 → 右侧”排列：左右两张的脸、躯干、屈膝和鞋尖分别明确朝向画面对应一侧，肩胯与松散四肢表现被翻动的失力感而非安稳睡姿；俯卧时背部朝上、头无力扭向一边。所有长发、尾巴、翅膀、手指与双鞋必须完整入画。

最终命名统一为 `<id>-trophy-gallery-left-subject.png`、`<id>-trophy-gallery-prone-subject.png`、`<id>-trophy-gallery-right-subject.png`。W 的俯卧图额外保持大面积露背设计、红色靴底，以及从裙底/臀后中央钻出并轻微顶起裙摆的唯一一条尾巴；其他角色不得继承这些 W 专属特征。德克萨斯无尾巴并保留长发与狼耳；艾丽妮背部完整覆盖且长裙保持遮盖；年保留覆盖式旗袍后背、绿色手串和完整龙尾；翎羽保留两片结构不同且左右关系不互换的翅膀。

用于 W 姿势确认的带棺材合成源图保存在 `art/source/trophy-gallery/`；游戏只注册透明人物层，运行时统一叠加共享棺材。绿幕图通过 `tools/art/remove-chroma-key.mjs` 提取透明通道，边缘去色仅作用于与已移除背景相邻的窄带，避免误删年的绿色手串。
