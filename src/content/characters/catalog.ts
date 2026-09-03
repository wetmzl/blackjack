import rawCatalog from "./catalog.json" with { type: "json" };
import { CharacterCatalogSchema } from "./schema";
import type { CharacterMetadata } from "./types";

const parsedCatalog = CharacterCatalogSchema.parse(rawCatalog);
export const DEFAULT_CHARACTER_ID = parsedCatalog.defaultCharacterId;
const RAW_CHARACTER_CATALOG: readonly CharacterMetadata[] = parsedCatalog.characters;

function createCatalog(entries: readonly CharacterMetadata[]): readonly CharacterMetadata[] {
  const ids = new Set<string>();
  const dataFiles = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`角色目录 ID 重复：${entry.id}`);
    if (dataFiles.has(entry.dataFile)) throw new Error(`角色数据文件重复：${entry.dataFile}`);
    ids.add(entry.id);
    dataFiles.add(entry.dataFile);
  }
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    tags: Object.freeze([...entry.tags]),
    unlock: entry.unlock ? Object.freeze({ ...entry.unlock }) : undefined,
    portraitScales: Object.freeze({ ...entry.portraitScales })
  })));
}

export const CHARACTER_CATALOG = createCatalog(RAW_CHARACTER_CATALOG);

export const CHARACTER_METADATA_BY_ID: Readonly<Record<string, CharacterMetadata>> = Object.freeze(
  Object.fromEntries(CHARACTER_CATALOG.map((metadata) => [metadata.id, metadata]))
);

if (!CHARACTER_METADATA_BY_ID[DEFAULT_CHARACTER_ID]) {
  throw new Error(`默认角色未注册：${DEFAULT_CHARACTER_ID}`);
}

export function getCharacterMetadata(id: string): CharacterMetadata | undefined {
  return CHARACTER_METADATA_BY_ID[id];
}

/** Returns custom tags plus a namespaced, lower-case tier tag. */
export function getCharacterTags(character: Pick<CharacterMetadata, "tier" | "tags">): readonly string[] {
  return Object.freeze([...new Set([`tier:${character.tier.toLowerCase()}`, ...character.tags])]);
}

export function characterHasTag(character: Pick<CharacterMetadata, "tier" | "tags">, tag: string): boolean {
  return getCharacterTags(character).includes(tag.toLowerCase());
}
