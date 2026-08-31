import { z } from "zod";
import { DIALOGUE_EVENT_CODES } from "../../dialogue/types";

const safeDataFile = z.string().regex(/^[a-z0-9][a-z0-9_-]*\.json$/, "dataFile 必须是安全文件名");
const metadataEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().min(1), subtitle: z.string().min(1),
  tier: z.enum(["D", "C", "B", "A", "S"]), description: z.string().min(1),
  previewImage: z.string().min(1), trophyImage: z.string().min(1), dataFile: safeDataFile
}).strict();
export const CharacterCatalogSchema = z.object({ defaultCharacterId: z.string().min(1), characters: z.array(metadataEntry).min(1) }).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  const dataFiles = new Set<string>();
  for (const [index, character] of catalog.characters.entries()) {
    if (ids.has(character.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "id"], message: `角色 ID 重复：${character.id}` });
    if (dataFiles.has(character.dataFile)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "dataFile"], message: `角色数据文件重复：${character.dataFile}` });
    ids.add(character.id);
    dataFiles.add(character.dataFile);
  }
  if (!ids.has(catalog.defaultCharacterId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultCharacterId"], message: "默认角色未注册" });
});

const dialogue = z.record(z.array(z.string().min(1)).min(1)).superRefine((value, ctx) => {
  const known = new Set<string>(DIALOGUE_EVENT_CODES);
  for (const code of Object.keys(value)) if (!known.has(code)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `未知对白事件：${code}` });
});
export const CharacterDataSchema = z.object({
  assets: z.object({
    relaxed: z.string().min(1), conflicted: z.string().min(1), mocking: z.string().min(1), threatened: z.string().min(1),
    staffRevolver: z.string().min(1), unconscious: z.string().min(1), defeatedSummary: z.string().min(1)
  }).strict(),
  revolverPlacement: z.object({ top: z.number().finite(), left: z.number().finite(), mobileTop: z.number().finite(), mobileLeft: z.number().finite() }).strict(),
  ai: z.object({ rationality: z.number().min(0).max(1), personalityHitProbability: z.number().min(0).max(1) }).strict(),
  dialogue: dialogue
}).strict();

export { DIALOGUE_EVENT_CODES };
