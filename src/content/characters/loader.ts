import { CHARACTER_CATALOG, DEFAULT_CHARACTER_ID, getCharacterMetadata } from "./catalog";
import { CharacterDataSchema } from "./schema";
import type { CharacterData, CharacterDefinition, CharacterMetadata } from "./types";
import { validateAbilityBinding } from "../../core/abilities/registry";

type DataLoader = () => Promise<{ default: unknown }>;

const DATA_LOADERS = import.meta.glob<{ default: unknown }>("./data/*.json");
const METADATA_KEYS = ["id", "name", "subtitle", "tier", "tags", "unlock", "previewImage", "trophyImage", "portraitScales"] as const satisfies readonly (keyof CharacterMetadata)[];

function dataPath(dataFile: string): string {
  return `./data/${dataFile}`;
}

for (const metadata of CHARACTER_CATALOG) {
  if (!/^[a-z0-9][a-z0-9_-]*\.json$/.test(metadata.dataFile)) throw new Error(`角色数据文件名不安全：${metadata.id}`);
  if (!DATA_LOADERS[dataPath(metadata.dataFile)]) throw new Error(`角色缺少完整数据：${metadata.id}`);
}

const cache = new Map<string, Promise<CharacterDefinition>>();

export function loadCharacter(id: string): Promise<CharacterDefinition> {
  const metadata = getCharacterMetadata(id);
  const loader: DataLoader | undefined = metadata ? DATA_LOADERS[dataPath(metadata.dataFile)] : undefined;
  if (!metadata || !loader) {
    return Promise.reject(new Error(`未知角色：${id}`));
  }
  const cached = cache.get(id);
  if (cached) return cached;
  const pending = loader().then(({ default: rawData }) => {
    const data = CharacterDataSchema.parse(rawData) as CharacterData;
    for (const binding of data.aiSkills) validateAbilityBinding(binding);
    const definition: CharacterDefinition = { ...metadata, ...data };
    for (const key of METADATA_KEYS) {
      if (definition[key] !== metadata[key]) throw new Error(`角色定义与目录不一致：${id}.${key}`);
    }
    return definition;
  });
  cache.set(id, pending);
  void pending.catch(() => cache.delete(id));
  return pending;
}

export function loadDefaultCharacter(): Promise<CharacterDefinition> {
  return loadCharacter(DEFAULT_CHARACTER_ID);
}

export function clearCharacterCache(): void {
  cache.clear();
}

export { DEFAULT_CHARACTER_ID };
