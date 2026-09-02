import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const publicAssetsDirectory = fileURLToPath(new URL("./public/assets", import.meta.url));

function resourcePackManifest(): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(publicAssetsDirectory);
  files.sort();
  const hash = createHash("sha256");
  const assets = files.map((path) => {
    const assetPath = relative(publicAssetsDirectory, path).split(sep).join("/");
    const bytes = statSync(path).size;
    hash.update(assetPath);
    hash.update(readFileSync(path));
    return { url: `/assets/${assetPath}`, bytes };
  });
  return JSON.stringify({
    version: hash.digest("hex").slice(0, 16),
    totalBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
    assets
  });
}

function resourcePackManifestPlugin(): Plugin {
  return {
    name: "resource-pack-manifest",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== "/resource-pack.json") return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(resourcePackManifest());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "resource-pack.json", source: resourcePackManifest() });
    }
  };
}

export default defineConfig({
  plugins: [
    resourcePackManifestPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      // Large media stays optional. The settings screen can download it as one offline pack.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:audio|backgrounds|characters)\//i,
            handler: "CacheFirst",
            options: {
              cacheName: "blackjack-resource-pack-v1",
              expiration: { maxEntries: 128, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: "命运牌桌",
        short_name: "命运牌桌",
        description: "来自高位面的策展人在古堡中邀请泰拉与会者参加致命的黑杰克轮盘赌。",
        theme_color: "#171421",
        background_color: "#171421",
        display: "standalone",
        orientation: "portrait",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      }
    })
  ],
  build: { target: "es2022" }
});
