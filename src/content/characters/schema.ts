import { z } from "zod";
import { DIALOGUE_EVENT_CODES, type DialogueEvent } from "../../dialogue/types";
import { AbilityBindingSchema } from "../../core/abilities/schema";
import { getAbilityDefinition, validateAbilityBinding } from "../../core/abilities/registry";

const safeDataFile = z.string().regex(/^[a-z0-9][a-z0-9_-]*\.json$/, "dataFile 必须是安全文件名");
const metadataEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().min(1), subtitle: z.string().min(1),
  tier: z.enum(["D", "C", "B", "A", "S"]),
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

const dialoguePool = z.array(z.string().min(1)).min(1);
const dialogueShape = Object.fromEntries(DIALOGUE_EVENT_CODES.map((code) => [code, dialoguePool])) as Record<DialogueEvent, typeof dialoguePool>;
const dialogue = z.object(dialogueShape).strict();
const trophyGallery = z.object({
  headshot: z.string().min(1),
  fullBody: z.string().min(1),
  closeups: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    x: z.number().finite().min(0).max(100),
    y: z.number().finite().min(0).max(100),
    image: z.string().min(1),
    description: z.string().min(1)
  }).strict())
}).strict().superRefine((gallery, ctx) => {
  const ids = new Set<string>();
  for (const [index, point] of gallery.closeups.entries()) {
    if (ids.has(point.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["closeups", index, "id"], message: `特写点 ID 重复：${point.id}` });
    ids.add(point.id);
  }
});
export const CharacterDataSchema = z.object({
  $schema: z.literal("../character.schema.json"),
  assets: z.object({
    relaxed: z.string().min(1), conflicted: z.string().min(1), mocking: z.string().min(1), threatened: z.string().min(1),
    staffRevolver: z.string().min(1), unconscious: z.string().min(1), defeatedSummary: z.string().min(1)
  }).strict(),
  profile: z.object({ description: z.string().min(1) }).strict(),
  matchSummary: z.object({ playerVictory: z.string().min(1), playerDefeat: z.string().min(1), escaped: z.string().min(1) }).strict(),
  trophyGallery: trophyGallery.optional(),
  revolverPlacement: z.object({ top: z.number().finite(), left: z.number().finite(), mobileTop: z.number().finite(), mobileLeft: z.number().finite() }).strict(),
  ai: z.object({ P: z.number().finite(), A: z.number().finite(), B: z.number().finite(), C: z.number().finite() }).strict(),
  mechanics: z.array(AbilityBindingSchema).default([]).superRefine((mechanics, ctx) => {
    for (const [index, binding] of mechanics.entries()) {
      const definition = getAbilityDefinition(binding.definitionId);
      if (!definition) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "definitionId"], message: `未知能力机制：${binding.definitionId}` }); continue; }
      if (definition.sourceKind !== "character-mechanic") ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "definitionId"], message: "角色机制必须引用 character-mechanic 定义" });
      try { validateAbilityBinding(binding); } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "parameters"], message: error instanceof Error ? error.message : String(error) }); }
    }
  }),
  dialogue: dialogue
}).strict();

export { DIALOGUE_EVENT_CODES };
