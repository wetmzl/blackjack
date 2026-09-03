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
