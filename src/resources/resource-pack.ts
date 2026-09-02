export const RESOURCE_PACK_MANIFEST_URL = "/resource-pack.json";
export const RESOURCE_PACK_CACHE_NAME = "blackjack-resource-pack-v1";

export interface ResourcePackEntry {
  readonly url: string;
  readonly bytes: number;
}

export interface ResourcePackManifest {
  readonly version: string;
  readonly totalBytes: number;
  readonly assets: readonly ResourcePackEntry[];
}

export interface ResourcePackProgress {
  readonly completed: number;
  readonly total: number;
  readonly processedBytes: number;
  readonly totalBytes: number;
  readonly percent: number;
  readonly currentUrl?: string;
}

export interface ResourcePackFailure {
  readonly url: string;
  readonly reason: string;
}

interface ResourcePackDependencies {
  readonly fetch?: typeof fetch;
  readonly cacheStorage?: Pick<CacheStorage, "open">;
  readonly concurrency?: number;
}

export class ResourcePackDownloadError extends Error {
  constructor(readonly failures: readonly ResourcePackFailure[]) {
    super(`资源包中有 ${failures.length} 项下载失败。`);
    this.name = "ResourcePackDownloadError";
  }
}

function isResourcePackManifest(value: unknown): value is ResourcePackManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResourcePackManifest>;
  return typeof candidate.version === "string"
    && typeof candidate.totalBytes === "number"
    && Array.isArray(candidate.assets)
    && candidate.assets.every((entry) => entry
      && typeof entry === "object"
      && typeof (entry as ResourcePackEntry).url === "string"
      && (entry as ResourcePackEntry).url.startsWith("/assets/")
      && Number.isFinite((entry as ResourcePackEntry).bytes)
      && (entry as ResourcePackEntry).bytes >= 0);
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchResourcePackManifest(requestFetch: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<ResourcePackManifest> {
  const response = await requestFetch(RESOURCE_PACK_MANIFEST_URL, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`无法读取资源清单（HTTP ${response.status}）。`);
  const manifest: unknown = await response.json();
  if (!isResourcePackManifest(manifest)) throw new Error("资源清单格式无效。");
  return manifest;
}

/** Downloads every optional media asset and places it in the cache used by the PWA runtime route. */
export async function downloadResourcePack(
  onProgress: (progress: ResourcePackProgress) => void,
  dependencies: ResourcePackDependencies = {}
): Promise<ResourcePackManifest> {
  const requestFetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const cacheStorage = dependencies.cacheStorage ?? globalThis.caches;
  if (!cacheStorage || typeof cacheStorage.open !== "function") {
    throw new Error(typeof window !== "undefined" && window.isSecureContext === false
      ? "离线缓存需要 HTTPS 或 localhost，请通过安全连接打开游戏。"
      : "当前浏览器或内嵌环境不支持 Cache Storage。");
  }

  const manifest = await fetchResourcePackManifest(requestFetch);
  const cache = await cacheStorage.open(RESOURCE_PACK_CACHE_NAME);
  const failures: ResourcePackFailure[] = [];
  let nextIndex = 0;
  let completed = 0;
  let processedBytes = 0;

  const report = (currentUrl?: string): void => {
    const percent = manifest.totalBytes > 0
      ? Math.min(100, Math.round((processedBytes / manifest.totalBytes) * 100))
      : Math.round((completed / Math.max(1, manifest.assets.length)) * 100);
    onProgress({ completed, total: manifest.assets.length, processedBytes, totalBytes: manifest.totalBytes, percent, currentUrl });
  };

  report();
  const worker = async (): Promise<void> => {
    while (nextIndex < manifest.assets.length) {
      const entry = manifest.assets[nextIndex++];
      try {
        const response = await requestFetch(entry.url, { cache: "no-cache", credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await cache.put(entry.url, response);
      } catch (error) {
        failures.push({ url: entry.url, reason: failureReason(error) });
      } finally {
        completed += 1;
        processedBytes += entry.bytes;
        report(entry.url);
      }
    }
  };

  const concurrency = Math.max(1, Math.min(dependencies.concurrency ?? 3, manifest.assets.length || 1));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (failures.length > 0) throw new ResourcePackDownloadError(failures);
  return manifest;
}
