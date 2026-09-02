# Blackjack v0.1.0-preview.1 部署说明

## 运行要求

- Linux x86_64 或 arm64
- Node.js 20 或更高版本
- Caddy 已配置为反向代理 `127.0.0.1:3100`

发布包不需要 `npm install`，也不需要上传源码或 `node_modules`。

## 安装

假设压缩包已经上传到 `/tmp/blackjack-v0.1.0-preview.1.tar.gz`：

```bash
cd /tmp
sha256sum -c blackjack-v0.1.0-preview.1.tar.gz.sha256

sudo install -d -m 0755 /opt/blackjack/releases
sudo tar -xzf blackjack-v0.1.0-preview.1.tar.gz -C /opt/blackjack/releases
sudo ln -sfn /opt/blackjack/releases/blackjack-v0.1.0-preview.1 /opt/blackjack/current.next
sudo mv -Tf /opt/blackjack/current.next /opt/blackjack/current

sudo install -m 0644 \
  /opt/blackjack/current/deploy/blackjack-preview.service \
  /etc/systemd/system/blackjack-preview.service
sudo systemctl daemon-reload
sudo systemctl enable --now blackjack-preview.service
```

如果服务已经安装，切换版本后执行：

```bash
sudo systemctl restart blackjack-preview.service
```

## 验证

```bash
systemctl --no-pager --full status blackjack-preview.service
curl --fail --show-error http://127.0.0.1:3100/healthz
curl --fail --show-error --head http://127.0.0.1:3100/
```

Caddy 站点中对应的关键配置为：

```caddyfile
encode zstd gzip
reverse_proxy 127.0.0.1:3100
```

修改 Caddy 配置后先验证再重载：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 回滚

将 `/opt/blackjack/current` 原子切回上一个发布目录，然后重启服务：

```bash
sudo ln -sfn /opt/blackjack/releases/上一个版本 /opt/blackjack/current.next
sudo mv -Tf /opt/blackjack/current.next /opt/blackjack/current
sudo systemctl restart blackjack-preview.service
```
