import { describe, expect, it } from "vitest";
import { addFirstCharacterDefeat } from "./defeats";

describe("character defeat progression", () => {
  it("keeps the first acquisition timestamp across rematches", () => {
    const first = addFirstCharacterDefeat([], "texas", "2026-01-01T00:00:00.000Z");
    const repeated = addFirstCharacterDefeat(first, "texas", "2026-02-01T00:00:00.000Z");
    expect(repeated).toBe(first);
    expect(repeated).toEqual([{ opponentId: "texas", timestamp: "2026-01-01T00:00:00.000Z" }]);
  });
});
