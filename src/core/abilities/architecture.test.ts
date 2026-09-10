import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ABILITY_IDS = ["early-preparation", "hunter-instinct", "critical-judgment", "situation-assessment", "live-ammunition-bet", "prepaid-premium", "heart-hunter", "switcheroo", "rhodes-heartthrob", "night-queen", "scent-of-a-woman", "blueberry-and-dark-chocolate", "compound-interest", "counterclockwise-clock", "sissas-table", "a-single-coin", "mimic-eggplant", "carnival", "before-the-shuffle", "quetzal-memory", "pegasus-vision", "pegasus-vision-advantage", "sleight-of-hand", "silent-drizzle", "bomb-maniac", "w-night-queen", "sword-and-handcannon", "forge-heralds-the-year", "ai-sword-and-handcannon", "ai-forge-heralds-the-year", "copper-seal", "platinum-vision", "platinum-vision-advantage", "carnival-index", "carnival-heats-up", "carnival-index-value", "copper-seal-sealed", "player-point-advantage", "carnival-bust-bonus", "live-ammunition-bet-bonus", "prepaid-premium-covered", "heart-hunter-armed"] as const;

function productionTypeScript(directory: string): string {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScript(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [readFileSync(path, "utf8")] : [];
  }).join("\n");
}

describe("ability architecture boundaries", () => {
  it("keeps concrete skill identifiers out of match orchestration and the generic interpreter", () => {
    const match = productionTypeScript(join(CORE_ROOT, "match"));
    const interpreter = ["engine.ts", "conditions.ts", "effects.ts", "runtime.ts", "card-zone-adapter.ts", "roulette-adapter.ts"]
      .map((file) => readFileSync(join(CORE_ROOT, "abilities", file), "utf8")).join("\n");
    for (const id of ABILITY_IDS) {
      expect(match, `match layer contains ${id}`).not.toContain(id);
      expect(interpreter, `generic interpreter contains ${id}`).not.toContain(id);
    }
    expect(interpreter).not.toMatch(/(?:if|switch)\s*\([^)]*definitionId[^)]*\)/);
  });

  it("contains no character-id literal branch in core production code", () => {
    const core = productionTypeScript(CORE_ROOT);
    expect(core).not.toMatch(/(?:characterId|opponentId)\s*={2,3}\s*["'][a-z0-9-]+["']/);
  });
});
