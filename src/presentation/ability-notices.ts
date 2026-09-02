import { getAbilityDefinition } from "../core/abilities/registry";
import type { GameEvent } from "../core/match/types";

export function abilityTriggerNotice(events: readonly GameEvent[], opponentName: string): string | null {
  const seen = new Set<string>();
  const notices: string[] = [];
  for (const event of events) {
    if (event.type !== "ABILITY_TRIGGERED") continue;
    const key = `${event.owner}:${event.definitionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const definition = getAbilityDefinition(event.definitionId);
    if (!definition) continue;
    const actor = event.owner === "player" ? "策展人" : opponentName;
    const effect = definition.triggerNotice ?? definition.description;
    notices.push(`${actor}发动了技能「${definition.name}」：${effect}`);
  }
  return notices.length > 0 ? notices.join("；") : null;
}
