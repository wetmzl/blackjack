/** Shared by the generated Service Worker and the optional pack downloader. */
export const RESOURCE_PACK_CACHE_NAME = "blackjack-resource-pack-v1";
export const RESOURCE_ASSET_URL_PATTERN = /\/assets\/(?:audio|backgrounds|characters|skills)\//i;
export const RESOURCE_ASSET_RUNTIME_HANDLER = "NetworkFirst" as const;
export const RESOURCE_ASSET_FETCH_OPTIONS = { cache: "no-cache" as const };

/** Small shared resources needed before a match-specific pack is selected. */
export const LOBBY_BACKGROUND_URL = "/assets/backgrounds/castle-lobby-night.png";
export const TABLE_BACKGROUND_URL = "/assets/backgrounds/rhodes-card-room.png";
export const LOBBY_BGM_URL = "/assets/audio/bgm/lobby.mp3";
export const TABLE_BGM_URL = "/assets/audio/bgm/table-theme.mp3";
