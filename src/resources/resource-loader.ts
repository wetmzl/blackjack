import type { CharacterDefinition, CharacterMetadata } from "../content/characters/types";
import {
  LOBBY_BACKGROUND_URL,
  RESOURCE_ASSET_FETCH_OPTIONS,
  RESOURCE_PACK_CACHE_NAME,
  TABLE_BACKGROUND_URL
} from "./cache-policy";

export type ResourceLoadPriority = "visible" | "display" | "background";

export interface CharacterResourcePlan {
  /** Resources required by the first rendered table frame. */
  readonly visible: readonly string[];
  /** Remaining art used by later table and summary states. */
  readonly display: readonly string[];
  /** Profile, trophy, and any future data-driven assets for this attendee. */
  readonly background: readonly string[];
}

export interface CharacterResourcePlanOptions {
  readonly visibleArt?: readonly string[];
  readonly includeTableBase?: boolean;
}

interface ResourceLoaderDependencies {
  readonly fetch?: typeof fetch;
  readonly cacheStorage?: Pick<CacheStorage, "open">;
  readonly concurrency?: number;
}

interface QueueItem {
  readonly url: string;
  priority: number;
  readonly sequence: number;
  readonly resolve: (loaded: boolean) => void;
}

const PRIORITY: Readonly<Record<ResourceLoadPriority, number>> = {
  visible: 0,
  display: 1,
  background: 2
};

function uniqueUrls(urls: Iterable<string>): string[] {
  return [...new Set([...urls].filter((url) => url.startsWith("/assets/")))];
}

/** Recursively discovers media references so future character asset slots join the pack automatically. */
export function collectAssetUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      if (candidate.startsWith("/assets/")) urls.add(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    Object.values(candidate as Readonly<Record<string, unknown>>).forEach(visit);
  };
  visit(value);
  return [...urls];
}

/** The lobby never needs full definitions or trophy art, only unlocked attendee portraits. */
export function lobbyResourceUrls(characters: readonly CharacterMetadata[]): string[] {
  return uniqueUrls([
    LOBBY_BACKGROUND_URL,
    ...characters.map((character) => character.previewImage)
  ]);
}

export function characterResourcePlan(
  character: CharacterDefinition,
  options: CharacterResourcePlanOptions = {}
): CharacterResourcePlan {
  const visibleArt = options.visibleArt ?? [character.assets.relaxed];
  const visible = uniqueUrls([
    ...(options.includeTableBase === false ? [] : [TABLE_BACKGROUND_URL]),
    ...visibleArt,
    ...(options.includeTableBase === false ? [] : [character.assets.staffRevolver])
  ]);
  const visibleSet = new Set(visible);
  const display = uniqueUrls(Object.values(character.assets)).filter((url) => !visibleSet.has(url));
  const foreground = new Set([...visible, ...display]);
  const background = collectAssetUrls(character).filter((url) => !foreground.has(url));
  return { visible, display, background };
}

/**
 * A small priority queue shared by lobby and match transitions. Requests already
 * running are left alone, while newly visible art overtakes queued background art.
 */
export class ResourceLoader {
  private readonly requestFetch: typeof fetch;
  private readonly cacheStorage?: Pick<CacheStorage, "open">;
  private readonly concurrency: number;
  private readonly queued: QueueItem[] = [];
  private readonly pending = new Map<string, { readonly promise: Promise<boolean>; readonly item: QueueItem }>();
  private readonly loaded = new Set<string>();
  private active = 0;
  private activeBackground = 0;
  private sequence = 0;

  constructor(dependencies: ResourceLoaderDependencies = {}) {
    this.requestFetch = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.cacheStorage = dependencies.cacheStorage ?? globalThis.caches;
    this.concurrency = Math.max(1, dependencies.concurrency ?? 3);
  }

  enqueue(urls: readonly string[], priority: ResourceLoadPriority): Promise<readonly boolean[]> {
    const requests = uniqueUrls(urls).map((url) => this.enqueueOne(url, priority));
    this.drain();
    return Promise.all(requests);
  }

  private enqueueOne(url: string, priority: ResourceLoadPriority): Promise<boolean> {
    if (this.loaded.has(url)) return Promise.resolve(true);
    const existing = this.pending.get(url);
    if (existing) {
      existing.item.priority = Math.min(existing.item.priority, PRIORITY[priority]);
      return existing.promise;
    }
    let resolveRequest!: (loaded: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { resolveRequest = resolve; });
    const item: QueueItem = { url, priority: PRIORITY[priority], sequence: this.sequence++, resolve: resolveRequest };
    this.pending.set(url, { promise, item });
    this.queued.push(item);
    return promise;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queued.length > 0) {
      this.queued.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      const nextIndex = this.queued.findIndex((candidate) => (
        candidate.priority < PRIORITY.background
        || this.activeBackground < Math.max(1, this.concurrency - 1)
      ));
      if (nextIndex < 0) return;
      const [item] = this.queued.splice(nextIndex, 1);
      if (!item) return;
      this.active += 1;
      const isBackground = item.priority === PRIORITY.background;
      if (isBackground) this.activeBackground += 1;
      void this.load(item.url).then((loaded) => {
        if (loaded) this.loaded.add(item.url);
        this.pending.delete(item.url);
        item.resolve(loaded);
      }).finally(() => {
        this.active -= 1;
        if (isBackground) this.activeBackground -= 1;
        this.drain();
      });
    }
  }

  private async load(url: string): Promise<boolean> {
    try {
      const response = await this.requestFetch(url, {
        ...RESOURCE_ASSET_FETCH_OPTIONS,
        credentials: "same-origin"
      });
      if (!response.ok) return false;
      if (this.cacheStorage && typeof this.cacheStorage.open === "function") {
        const cache = await this.cacheStorage.open(RESOURCE_PACK_CACHE_NAME);
        await cache.put(url, response.clone());
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const resourceLoader = new ResourceLoader();
