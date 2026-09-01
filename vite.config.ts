import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      // Character art is loaded on demand and must not make the install cache huge.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}", "assets/backgrounds/**/*.{png,jpg,jpeg,webp}", "assets/audio/**/*.{mp3,ogg}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/characters\/.*\.png$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "character-art-v1",
              expiration: { maxEntries: 32, maxAgeSeconds: 30 * 24 * 60 * 60 },
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
