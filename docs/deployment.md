# 构建与部署

生产静态站点使用 Cloudflare Pages Direct Upload。本地 systemd 服务仍保留给当前机器的预览/局域网运行，但不是生产发布目标。

## 构建

```bash
npm ci
npm test
npm run build
```

构建输出为 `dist/`。如改动涉及用户交互，再运行：

```bash
npm run test:e2e
```

## Android Chrome 本地预览

项目使用以下三个预览档位。尺寸均为 CSS 像素；浏览器 UA 中的 Chrome 主版本会在启动时同步到本机 Google Chrome。

| 预设 | CSS 视口 | 屏幕 | DPR | Android UA 身份 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `project-390` | 390×844 | 390×844 | 2.625 | Android 14 / Pixel 7 / Mobile Chrome | 项目默认主验收基线 |
| `project-320` | 320×720 | 320×720 | 2.625 | Android 14 / Pixel 7 / Mobile Chrome | 窄屏与矮屏边界验收 |
| `pixel-7` | 412×839 | 412×915 | 2.625 | Android 14 / Pixel 7 / Mobile Chrome | 现实设备尺寸补充 |

390×844 和 320×720 是产品验收窗口，不对应某一台具体手机；Pixel 7 数据来自当前 Playwright 设备描述。实际 UA 形如 `Mozilla/5.0 (Linux; Android 14; Pixel 7) ... Chrome/<本机主版本>.0.0.0 Mobile Safari/537.36`。

构建最新 `dist/`、启动本地 `vite preview`，并用系统 Google Chrome 自动打开 390×844 Android 触屏预览：

```bash
npm run preview chrome
```

切换到其他预设：

```bash
npm run preview chrome -- --device=project-320
npm run preview chrome -- --device=pixel-7
```

可选预设为 `project-390`、`project-320` 和 `pixel-7`。脚本会从当前系统 Chrome 读取主版本号，并将对应设备描述中的 Android Mobile UA 同步到该版本；同时启用移动端布局、触控事件和 DPR。Chrome 使用 Playwright 的独立临时会话，不会改动日常浏览器资料。

默认每次先运行生产构建，确保预览的是当前源码生成的 `dist/`。已有可信构建时可跳过：

```bash
npm run preview chrome -- --no-build
```

其余参数继续传给 Vite，例如 `--port=4180`。不带 `chrome` 时，`npm run preview` 仍保持原行为，只启动 Vite 生产预览服务器。

## Cloudflare Pages 生产发布

- Pages 项目：`blackjack`
- 生产分支：`main`
- 生产地址：`https://blackjack-9bp.pages.dev`
- 首次发布使用的 Wrangler 版本：`4.128.0`

本机凭据位于被 Git 忽略的 `.env.local`，需要 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`。不得打印、复制到源码或提交其值。普通静态 Pages 发布不使用文件中的 R2/S3 变量。

从仓库根目录执行：

```bash
npm run deploy:pages
```

该脚本会在本地自动读取被 Git 忽略的 `.env.local`，在 CI 中则直接使用托管平台注入的 Secret。它会构建项目、发布 `dist/`，并验证生产地址返回 `200`。功能分支可将分支名作为参数传入，以创建预览部署：

```bash
bash scripts/deploy-pages.sh feature/my-branch
```

`blackjack` 项目已经存在，常规发布不要运行 `pages project create`。只有构建成功后才发布 `main`；功能分支可传实际分支名创建预览部署。

发布后验证稳定地址：

```bash
curl --fail --silent --show-error --location --output /dev/null \
  --write-out '%{http_code}\n' https://blackjack-9bp.pages.dev/
```

预期状态为 `200`。

## 托管 CI

在 CI 提供商的加密 Secret 中配置 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN`，不要在 runner 创建 `.env.local`。干净 runner 的发布步骤为：

```bash
npm ci
npm run deploy:pages
```

## 本地 systemd 服务

首次安装当前仓库附带的本地服务：

```bash
npm run systemd:install
```

代码更新后构建并重启本地 `blackjack.service`：

```bash
npm run deploy
```

该命令只重启监听 `0.0.0.0:4173` 的本地 systemd 服务，不会部署到 Cloudflare。查看日志：

```bash
sudo journalctl -u blackjack.service -f
```
