import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("Cloudflare Web Analytics", () => {
  it("loads one valid beacon with a site token", () => {
    const beacons = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js["'][^>]*>/g)];

    expect(beacons).toHaveLength(1);
    expect(beacons[0]?.[0]).toMatch(/\btype=["']module["']/);
    expect(beacons[0]?.[0]).toMatch(/\bdata-cf-beacon=["']\{"token":"[a-f0-9]{32}"\}["']/);
  });
});
