import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDialogueAdminServer } from "../../tools/dialogue-admin/server.mjs";

let fixture = "";
let baseUrl = "";
let admin: ReturnType<typeof createDialogueAdminServer>;

const characterData = {
  assets: { relaxed: "r", conflicted: "c", mocking: "m", threatened: "t", staffRevolver: "s", unconscious: "u", defeatedSummary: "d" },
  revolverPlacement: { top: 1, left: 2, mobileTop: 3, mobileLeft: 4 },
  ai: { P: 0, A: 1, B: 1, C: 1 },
  dialogue: { MATCH_START: ["原始开局对白"] }
};

test.beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), "dialogue-admin-e2e-"));
  await writeFile(join(fixture, "catalog.json"), JSON.stringify({
    defaultCharacterId: "w",
    characters: [{ id: "w", name: "W", subtitle: "样例", tier: "B", previewImage: "/w.png", trophyImage: "/w-trophy.png", dataFile: "w.json" }]
  }));
  await writeFile(join(fixture, "w.json"), JSON.stringify(characterData, null, 2));
  admin = createDialogueAdminServer({ catalogPath: join(fixture, "catalog.json"), dataDir: fixture, publicDir: join(process.cwd(), "tools/dialogue-admin") });
  await new Promise<void>((resolve) => admin.server.listen(0, "127.0.0.1", resolve));
  const address = admin.server.address();
  if (!address || typeof address === "string") throw new Error("管理台测试端口不可用");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => admin.server.close((error?: Error) => error ? reject(error) : resolve()));
  await rm(fixture, { recursive: true, force: true });
});

test("对白管理台可在浏览器中增删改独立对白组", async ({ page }) => {
  await page.goto(baseUrl);
  await expect(page.getByRole("heading", { name: "对白管理台" })).toBeVisible();
  await page.getByRole("button", { name: /W/ }).click();

  const matchStart = page.locator("article[data-event='MATCH_START']");
  await expect(matchStart).toContainText("开局");
  await matchStart.locator("textarea").fill("修改后的开局对白");
  await matchStart.locator("[data-save='MATCH_START']").click();
  await expect(page.locator("#status")).toHaveText("本组对白已保存。");

  await page.locator("#event-code").selectOption("PLAYER_HIT");
  await page.locator("#new-line").fill("新建的要牌对白");
  await page.locator("#new-event").evaluate((form: HTMLFormElement) => form.requestSubmit());
  const playerHit = page.locator("article[data-event='PLAYER_HIT']");
  await expect(playerHit.locator("textarea")).toHaveValue("新建的要牌对白");

  page.once("dialog", (dialog) => dialog.accept());
  await playerHit.locator("[data-delete='PLAYER_HIT']").click();
  await expect(playerHit).toHaveCount(0);

  const saved = JSON.parse(await readFile(join(fixture, "w.json"), "utf8"));
  expect(saved.dialogue.MATCH_START).toEqual(["修改后的开局对白"]);
  expect(saved.dialogue.PLAYER_HIT).toBeUndefined();
  expect(saved.assets).toEqual(characterData.assets);
});
