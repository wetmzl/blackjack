import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDialogueAdminServer } from "./server.mjs";
import eventDefinitions from "../../src/dialogue/events.json" with { type: "json" };

let fixture;
let app;
let base;
const data = { assets: { relaxed: "r", conflicted: "c", mocking: "m", threatened: "t", staffRevolver: "s", unconscious: "u", defeatedSummary: "d" }, revolverPlacement: { top: 1, left: 2, mobileTop: 3, mobileLeft: 4 }, ai: { rationality: 0.8, personalityHitProbability: 1 }, dialogue: { MATCH_START: ["你好", "再来"] } };

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), "dialogue-admin-"));
  await writeFile(join(fixture, "catalog.json"), JSON.stringify({ defaultCharacterId: "w", characters: [{ id: "w", name: "W", dataFile: "w.json" }] }));
  await writeFile(join(fixture, "w.json"), JSON.stringify({ ...data, preserved: { value: 42 } }, null, 2));
  app = createDialogueAdminServer({ catalogPath: join(fixture, "catalog.json"), dataDir: fixture, publicDir: join(process.cwd(), "tools/dialogue-admin") });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise((resolve) => app.server.close(resolve)); await rm(fixture, { recursive: true, force: true }); });
async function call(path, options) { const response = await fetch(`${base}${path}`, options); return { status: response.status, headers: response.headers, body: await response.json() }; }

describe("dialogue admin API", () => {
  it("lists registered characters and known event labels", async () => {
    const result = await call("/api/characters");
    expect(result.status).toBe(200);
    expect(result.body.characters[0].id).toBe("w");
    expect(result.body.events).toEqual(eventDefinitions);
  });
  it("gets, creates, updates, and deletes an event set", async () => {
    const initial = await call("/api/characters/w/dialogue");
    expect(initial.body.dialogue.MATCH_START).toEqual(["你好", "再来"]);
    expect(initial.headers.get("etag")).toBe(`"${initial.body.revision}"`);
    const created = await call("/api/characters/w/dialogue", { method: "POST", headers: { "content-type": "application/json", "if-match": initial.body.revision }, body: JSON.stringify({ event: "PLAYER_HIT", lines: ["继续"] }) });
    expect(created.status).toBe(200);
    const updated = await call("/api/characters/w/dialogue/PLAYER_HIT", { method: "PUT", headers: { "content-type": "application/json", "if-match": created.body.revision }, body: JSON.stringify({ lines: ["继续要牌"] }) });
    expect(updated.body.dialogue.PLAYER_HIT).toEqual(["继续要牌"]);
    const deleted = await call("/api/characters/w/dialogue/PLAYER_HIT", { method: "DELETE", headers: { "if-match": updated.body.revision } });
    expect(deleted.body.dialogue.PLAYER_HIT).toBeUndefined();
    const missing = await call("/api/characters/w/dialogue/PLAYER_HIT", { method: "DELETE", headers: { "if-match": deleted.body.revision } });
    expect(missing.status).toBe(404);
  });
  it("rejects stale revisions, unknown events, unknown ids, and unsafe catalog paths", async () => {
    const initial = await call("/api/characters/w/dialogue");
    const stale = await call("/api/characters/w/dialogue/MATCH_START", { method: "PUT", headers: { "content-type": "application/json", "if-match": "stale" }, body: JSON.stringify({ lines: ["x"] }) });
    expect(stale.status).toBe(409);
    const unknownEvent = await call("/api/characters/w/dialogue/NOT_AN_EVENT", { method: "PUT", headers: { "content-type": "application/json", "if-match": initial.body.revision }, body: JSON.stringify({ lines: ["x"] }) });
    expect(unknownEvent.status).toBe(400);
    expect((await call("/api/characters/../dialogue")).status).toBe(404);
    expect((await call("/api/characters/unknown/dialogue")).status).toBe(404);
    await writeFile(join(fixture, "catalog.json"), JSON.stringify({ defaultCharacterId: "w", characters: [{ id: "w", name: "W", dataFile: "../w.json" }] }));
    expect((await call("/api/characters")).status).toBe(500);
  });
  it("preserves non-dialogue data and writes formatted JSON atomically", async () => {
    const initial = await call("/api/characters/w/dialogue");
    await call("/api/characters/w/dialogue/MATCH_START", { method: "PUT", headers: { "content-type": "application/json", "if-match": initial.body.revision }, body: JSON.stringify({ lines: ["更新"] }) });
    const saved = JSON.parse(await readFile(join(fixture, "w.json"), "utf8"));
    expect(saved.preserved).toEqual({ value: 42 });
    expect(saved.dialogue.MATCH_START).toEqual(["更新"]);
    expect((await readFile(join(fixture, "w.json"), "utf8")).endsWith("\n")).toBe(true);
  });
  it("serializes mutations so one shared revision cannot be written twice", async () => {
    const initial = await call("/api/characters/w/dialogue");
    const options = { method: "PUT", headers: { "content-type": "application/json", "if-match": initial.body.revision }, body: JSON.stringify({ lines: ["并发"] }) };
    const results = await Promise.all([call("/api/characters/w/dialogue/MATCH_START", options), call("/api/characters/w/dialogue/MATCH_START", options)]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });
  it("requires safe JSON mutations and same-origin browser requests", async () => {
    const initial = await call("/api/characters/w/dialogue");
    const missingRevision = await call("/api/characters/w/dialogue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "PLAYER_HIT", lines: ["继续"] }) });
    expect(missingRevision.status).toBe(428);
    const empty = await call("/api/characters/w/dialogue/MATCH_START", { method: "PUT", headers: { "content-type": "application/json", "if-match": initial.body.revision }, body: JSON.stringify({ lines: [] }) });
    expect(empty.status).toBe(400);
    const wrongType = await call("/api/characters/w/dialogue/MATCH_START", { method: "PUT", headers: { "content-type": "text/plain", "if-match": initial.body.revision }, body: JSON.stringify({ lines: ["继续"] }) });
    expect(wrongType.status).toBe(415);
    const foreign = await call("/api/characters", { headers: { origin: "http://attacker.invalid" } });
    expect(foreign.status).toBe(403);
    expect(initial.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const oversized = await call("/api/characters/w/dialogue/MATCH_START", { method: "PUT", headers: { "content-type": "application/json", "if-match": initial.body.revision }, body: JSON.stringify({ lines: ["x".repeat(257 * 1024)] }) });
    expect(oversized.status).toBe(413);
  });
});
