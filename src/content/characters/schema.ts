import { z } from "zod";
import { DIALOGUE_EVENT_CODES, type DialogueEvent } from "../../dialogue/types";
import { AbilityBindingSchema } from "../../core/abilities/schema";
import { getAbilityDefinition, supportsAbilitySourceKind, validateAbilityBinding } from "../../core/abilities/registry";

const safeDataFile = z.string().regex(/^[a-z0-9][a-z0-9_-]*\.json$/, "dataFile 必须是安全文件名");
const portraitScale = z.number().finite().min(0.75).max(1.5).default(1);
const portraitScales = z.object({ selection: portraitScale, table: portraitScale }).strict().default({ selection: 1, table: 1 });
const characterTag = z.string().min(1).regex(/^[a-z0-9][a-z0-9:_-]*$/, "角色 tag 必须是安全标识");
const unlockCondition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("defeat-any") }).strict(),
  z.object({ type: z.literal("defeat-any-tag"), tag: characterTag }).strict(),
  z.object({ type: z.literal("defeat-character"), characterId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("defeat-tag-percentage"), tag: characterTag, percentage: z.number().finite().gt(0).max(100) }).strict()
]);
const metadataEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), name: z.string().min(1), subtitle: z.string().min(1),
  tier: z.enum(["D", "C", "B", "A", "S", "SS"]), tags: z.array(characterTag).default([]), unlock: unlockCondition.optional(),
  previewImage: z.string().min(1), trophyImage: z.string().min(1), portraitScales, dataFile: safeDataFile
}).strict();
export const CharacterCatalogSchema = z.object({ defaultCharacterId: z.string().min(1), characters: z.array(metadataEntry).min(1) }).strict().superRefine((catalog, ctx) => {
  const ids = new Set<string>();
  const dataFiles = new Set<string>();
  for (const [index, character] of catalog.characters.entries()) {
    if (ids.has(character.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "id"], message: `角色 ID 重复：${character.id}` });
    if (dataFiles.has(character.dataFile)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "dataFile"], message: `角色数据文件重复：${character.dataFile}` });
    ids.add(character.id);
    dataFiles.add(character.dataFile);
    if (new Set(character.tags).size !== character.tags.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "tags"], message: "角色 tag 重复" });
    if (character.tags.some((tag) => tag.startsWith("tier:"))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "tags"], message: "tier: 命名空间由角色等级自动生成" });
    const condition = character.unlock;
    if (condition?.type === "defeat-character" && !catalog.characters.some((entry) => entry.id === condition.characterId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "unlock", "characterId"], message: "解锁条件引用了未知角色" });
    }
    if (condition && (condition.type === "defeat-any-tag" || condition.type === "defeat-tag-percentage")) {
      const knownTags = new Set(catalog.characters.flatMap((entry) => [`tier:${entry.tier.toLowerCase()}`, ...entry.tags]));
      if (!knownTags.has(condition.tag)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["characters", index, "unlock", "tag"], message: "解锁条件引用了未知 tag" });
    }
  }
  const defaultCharacter = catalog.characters.find((character) => character.id === catalog.defaultCharacterId);
  if (!defaultCharacter) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultCharacterId"], message: "默认角色未注册" });
  else if (defaultCharacter.unlock) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultCharacterId"], message: "默认角色必须初始解锁" });
});

const dialoguePool = z.array(z.string().min(1)).min(1);
const infoBarActor = z.enum(["owner", "rival"]);
const infoBarScalar: z.ZodType<unknown> = z.lazy(() => z.union([
  z.number().finite(),
  z.object({ type: z.literal("constant"), value: z.number().finite() }).strict(),
  z.object({ type: z.enum(["gun-bullets", "hand-total", "hand-card-count", "round-hit-count"]), target: infoBarActor }).strict(),
  z.object({ type: z.literal("status-stacks"), target: infoBarActor, statusDefinitionId: z.string().min(1) }).strict(),
  z.object({ type: z.enum(["add", "subtract", "multiply", "min", "max"]), left: infoBarScalar, right: infoBarScalar }).strict()
]));
const infoBar = z.object({
  sourceAbilityId: z.string().min(1), label: z.string().min(1), description: z.string().min(1), format: z.enum(["number", "percent"]).optional(),
  value: z.union([
    z.object({ type: z.literal("number"), value: infoBarScalar }).strict(),
    z.object({ type: z.enum(["card", "suit"]), target: infoBarActor, card: z.enum(["last-card", "first-private-card"]) }).strict(),
    z.object({ type: z.enum(["card", "suit"]), source: z.literal("status-card"), statusDefinitionId: z.string().min(1) }).strict()
  ])
}).strict().superRefine((bar, ctx) => {
  if (bar.format === "percent" && bar.value.type !== "number") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["format"], message: "百分比格式只适用于数值信息" });
});
const dialogueShape = Object.fromEntries(DIALOGUE_EVENT_CODES.map((code) => [code, dialoguePool])) as Record<DialogueEvent, typeof dialoguePool>;
const dialogue = z.object(dialogueShape).strict();
const trophyGallery = z.object({
  headshot: z.string().min(1),
  fullBody: z.string().min(1),
  poses: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    image: z.string().min(1)
  }).strict()).min(1).optional(),
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
  const poseIds = new Set<string>();
  for (const [index, pose] of (gallery.poses ?? []).entries()) {
    if (poseIds.has(pose.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["poses", index, "id"], message: `陈列姿势 ID 重复：${pose.id}` });
    poseIds.add(pose.id);
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
  infoBar: infoBar.optional(),
  trophyGallery: trophyGallery.optional(),
  revolverPlacement: z.object({ top: z.number().finite(), left: z.number().finite(), mobileTop: z.number().finite(), mobileLeft: z.number().finite() }).strict(),
  ai: z.object({ P: z.number().finite(), A: z.number().finite(), B: z.number().finite(), C: z.number().finite() }).strict(),
  aiSkills: z.array(AbilityBindingSchema).default([]).superRefine((aiSkills, ctx) => {
    for (const [index, binding] of aiSkills.entries()) {
      const definition = getAbilityDefinition(binding.definitionId);
      if (!definition) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "definitionId"], message: `未知能力机制：${binding.definitionId}` }); continue; }
      if (!supportsAbilitySourceKind(definition, "ai-skill")) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "definitionId"], message: "角色技能必须引用 AI Skill 定义" });
      try { validateAbilityBinding(binding); } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "parameters"], message: error instanceof Error ? error.message : String(error) }); }
    }
  }),
  dialogue: dialogue
}).strict().superRefine((character, ctx) => {
  if (character.infoBar && !character.aiSkills.some((binding) => binding.enabled && binding.definitionId === character.infoBar?.sourceAbilityId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["infoBar", "sourceAbilityId"], message: "信息栏必须绑定角色已启用的 AI Skill" });
  }
});

export { DIALOGUE_EVENT_CODES };
