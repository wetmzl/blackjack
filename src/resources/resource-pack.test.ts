import { describe, expect, it, vi } from "vitest";
import { downloadResourcePack, RESOURCE_PACK_CACHE_NAME } from "./resource-pack";
import { RESOURCE_ASSET_FETCH_OPTIONS, RESOURCE_ASSET_RUNTIME_HANDLER, RESOURCE_ASSET_URL_PATTERN } from "./cache-policy";

class MemoryCache {
  private readonly entries = new Map<string, Response>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    this.entries.set(url, response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    return this.entries.get(url)?.clone();
  }
}

describe("resource pack updates", () => {
  it("uses a network-first route with revalidation for stable asset URLs", () => {
    expect(RESOURCE_ASSET_RUNTIME_HANDLER).toBe("NetworkFirst");
    expect(RESOURCE_ASSET_FETCH_OPTIONS).toEqual({ cache: "no-cache" });
    expect(RESOURCE_ASSET_URL_PATTERN.test("/assets/characters/w-relaxed.png")).toBe(true);
  });

  it("replaces a cached response when a same-name asset changes", async () => {
    const cache = new MemoryCache();
    let assetBody = "old-image-bytes";
    const requestFetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === "/resource-pack.json") {
        return new Response(JSON.stringify({
          version: "same-name-update",
          totalBytes: assetBody.length,
          assets: [{ url: "/assets/characters/w-relaxed.png", bytes: assetBody.length }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(assetBody, { status: 200 });
    });
    const cacheStorage = { open: vi.fn(async (name: string) => {
      expect(name).toBe(RESOURCE_PACK_CACHE_NAME);
      return cache;
    }) } as unknown as Pick<CacheStorage, "open">;

    await downloadResourcePack(() => undefined, { fetch: requestFetch, cacheStorage });
    assetBody = "new-image-bytes";
    await downloadResourcePack(() => undefined, { fetch: requestFetch, cacheStorage });

    await expect((await cache.match("/assets/characters/w-relaxed.png"))?.text()).resolves.toBe("new-image-bytes");
    expect(requestFetch).toHaveBeenCalledWith("/assets/characters/w-relaxed.png", { cache: "no-cache", credentials: "same-origin" });
  });
});
