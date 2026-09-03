/** Shared by the generated Service Worker and the optional pack downloader. */
export const RESOURCE_PACK_CACHE_NAME = "blackjack-resource-pack-v1";
export const RESOURCE_ASSET_URL_PATTERN = /\/assets\/(?:audio|backgrounds|characters)\//i;
export const RESOURCE_ASSET_RUNTIME_HANDLER = "NetworkFirst" as const;
export const RESOURCE_ASSET_FETCH_OPTIONS = { cache: "no-cache" as const };
