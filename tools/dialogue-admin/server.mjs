import { createHash, randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "../..");
const MAX_BODY_BYTES = 256 * 1024;
const EVENT_DEFINITIONS = JSON.parse(readFileSync(resolve(HERE, "../../src/dialogue/events.json"), "utf8"));
const EVENT_LABELS = Object.freeze(Object.fromEntries(EVENT_DEFINITIONS.map((event) => [event.code, event.label])));
const EVENT_CODES = Object.freeze(Object.keys(EVENT_LABELS));
const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer"
});
const JSON_HEADERS = { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function safeDataFile(value) { return typeof value === "string" && basename(value) === value && /^[a-z0-9][a-z0-9_-]*\.json$/.test(value); }
function jsonText(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function revision(value) { return createHash("sha256").update(jsonText(value)).digest("hex"); }
function errorBody(message, details) { return { error: message, ...(details ? { details } : {}) }; }

function detectTailscaleHost() {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!/tailscale/i.test(name)) continue;
    const address = addresses?.find((item) => !item.internal && (item.family === "IPv4" || item.family === 4));
    if (address) return address.address;
  }
  return "127.0.0.1";
}

export function resolveAdminHost(explicit) {
  return explicit || process.env.DIALOGUE_ADMIN_HOST || detectTailscaleHost();
}
export function resolveAdminPort(explicit) {
  const value = explicit ?? process.env.DIALOGUE_ADMIN_PORT ?? "4174";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("端口必须是 0 到 65535 的整数。");
  return port;
}

export function createDialogueAdminServer(options = {}) {
  const rootDir = resolve(options.rootDir ?? PROJECT_ROOT);
  const catalogPath = resolve(options.catalogPath ?? join(rootDir, "src/content/characters/catalog.json"));
  const dataDir = resolve(options.dataDir ?? join(rootDir, "src/content/characters/data"));
  const publicDir = resolve(options.publicDir ?? HERE);
  const fileLocks = new Map();

  async function readCatalog() {
    const value = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    if (!value || typeof value !== "object" || !Array.isArray(value.characters)) throw new Error("角色目录格式无效。");
    const ids = new Set();
    const files = new Set();
    for (const character of value.characters) {
      if (!character || typeof character.id !== "string" || ids.has(character.id) || !safeDataFile(character.dataFile) || files.has(character.dataFile)) throw new Error("角色目录包含无效或重复条目。");
      ids.add(character.id);
      files.add(character.dataFile);
    }
    return value;
  }
  async function entryFor(id) {
    const catalog = await readCatalog();
    const entry = catalog.characters.find((character) => character.id === id);
    if (!entry) return null;
    const filePath = resolve(dataDir, entry.dataFile);
    if (dirname(filePath) !== dataDir || !safeDataFile(entry.dataFile)) throw new Error("角色数据路径不安全。");
    return { catalog, entry, filePath };
  }
  async function readEntry(id) {
    const target = await entryFor(id);
    if (!target) return null;
    const data = JSON.parse(await fs.readFile(target.filePath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data) || !data.dialogue || typeof data.dialogue !== "object" || Array.isArray(data.dialogue)) throw new Error("角色对白数据格式无效。");
    for (const [code, lines] of Object.entries(data.dialogue)) {
      if (!EVENT_LABELS[code] || !Array.isArray(lines) || lines.length === 0 || lines.some((line) => typeof line !== "string" || !line.trim())) throw new Error("角色对白数据格式无效。");
    }
    return { ...target, data, revision: revision(data) };
  }
  async function atomicWrite(filePath, data) {
    const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await fs.writeFile(tempPath, jsonText(data), { encoding: "utf8", flag: "wx" });
      await fs.rename(tempPath, filePath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }
  async function withFileLock(filePath, task) {
    const previous = fileLocks.get(filePath) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const current = previous.then(() => gate);
    fileLocks.set(filePath, current);
    await previous;
    try { return await task(); }
    finally { release(); if (fileLocks.get(filePath) === current) fileLocks.delete(filePath); }
  }
  async function bodyJson(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw Object.assign(new Error("请求必须使用 application/json。"), { statusCode: 415 });
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    for await (const chunk of request) {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk); else tooLarge = true;
    }
    if (tooLarge) throw Object.assign(new Error("请求内容过大。"), { statusCode: 413 });
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw Object.assign(new Error("请求 JSON 无效。"), { statusCode: 400 }); }
  }
  function expectedRevision(request, body) {
    const header = request.headers["if-match"];
    const value = Array.isArray(header) ? header[0] : header;
    return (value || body?.revision || "").replace(/^W\//, "").replace(/^"|"$/g, "");
  }
  function send(response, status, value, headers = {}) { response.writeHead(status, { ...JSON_HEADERS, ...headers }); response.end(JSON.stringify(value)); }
  function checkOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === request.headers.host && new URL(origin).protocol === "http:"; }
    catch { return false; }
  }
  async function api(request, response, url) {
    if (!checkOrigin(request)) return send(response, 403, errorBody("请求来源不被允许。"));
    if (url.pathname === "/api/characters" && request.method === "GET") {
      const catalog = await readCatalog();
      return send(response, 200, { defaultCharacterId: catalog.defaultCharacterId, characters: catalog.characters, events: EVENT_CODES.map((code) => ({ code, label: EVENT_LABELS[code] })) });
    }
    const match = url.pathname.match(/^\/api\/characters\/([^/]+)\/dialogue(?:\/([^/]+))?$/);
    if (!match) return send(response, 404, errorBody("接口不存在。"));
    const id = decodeURIComponent(match[1]);
    const event = match[2] ? decodeURIComponent(match[2]) : undefined;
    const current = await readEntry(id);
    if (!current) return send(response, 404, errorBody("角色不存在。"));
    if (request.method === "GET" && !event) {
      const presentEvents = Object.keys(current.data.dialogue ?? {}).filter((code) => EVENT_LABELS[code]).map((code) => ({ code, label: EVENT_LABELS[code], lines: current.data.dialogue[code] }));
      return send(response, 200, { id, name: current.entry.name, revision: current.revision, dialogue: current.data.dialogue ?? {}, events: presentEvents, schema: EVENT_CODES.map((code) => ({ code, label: EVENT_LABELS[code] })) }, { etag: `"${current.revision}"` });
    }
    if (event && !EVENT_LABELS[event]) return send(response, 400, errorBody("未知对白事件。"));
    if (!["POST", "PUT", "DELETE"].includes(request.method)) return send(response, 405, errorBody("不支持的请求方法。"));
    const body = request.method === "DELETE" ? {} : await bodyJson(request);
    const targetEvent = event || body.event;
    if (!EVENT_LABELS[targetEvent]) return send(response, 400, errorBody("未知对白事件。"));
    const lines = body.lines;
    if (request.method !== "DELETE" && (!Array.isArray(lines) || lines.length === 0 || lines.some((line) => typeof line !== "string" || !line.trim()))) return send(response, 400, errorBody("对白必须是至少包含一项的非空字符串数组。"));
    const expected = expectedRevision(request, body);
    if (!expected) return send(response, 428, errorBody("修改对白必须提供 revision。"));
    return withFileLock(current.filePath, async () => {
      const latest = await readEntry(id);
      if (!latest) return send(response, 404, errorBody("角色不存在。"));
      if (expected !== latest.revision) return send(response, 409, errorBody("对白已被其他修改覆盖，请重新加载。", { revision: latest.revision }));
      const dialogue = { ...(latest.data.dialogue ?? {}) };
      if (request.method === "POST" && dialogue[targetEvent]) return send(response, 409, errorBody("该对白事件已存在。"));
      if (request.method === "PUT" && !dialogue[targetEvent]) return send(response, 404, errorBody("对白事件不存在，请先创建。"));
      if (request.method === "DELETE" && !dialogue[targetEvent]) return send(response, 404, errorBody("对白事件不存在。"));
      if (request.method === "DELETE") delete dialogue[targetEvent]; else dialogue[targetEvent] = lines;
      const nextData = { ...latest.data, dialogue };
      await atomicWrite(latest.filePath, nextData);
      const nextRevision = revision(nextData);
      return send(response, 200, { id, revision: nextRevision, dialogue, events: EVENT_CODES.filter((code) => dialogue[code]).map((code) => ({ code, label: EVENT_LABELS[code], lines: dialogue[code] })) });
    });
  }
  async function handler(request, response) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(request, response, url);
      if (request.method !== "GET") return send(response, 405, errorBody("仅支持读取页面。"));
      const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (file.includes("..") || !["index.html", "app.js", "styles.css"].includes(file)) return send(response, 404, errorBody("页面不存在。"));
      const contents = await fs.readFile(join(publicDir, file));
      const contentType = extname(file) === ".html" ? "text/html; charset=utf-8" : extname(file) === ".js" ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8";
      response.writeHead(200, { ...SECURITY_HEADERS, "content-type": contentType, "cache-control": "no-store" }); response.end(contents);
    } catch (error) { send(response, error.statusCode ?? 500, errorBody(error.statusCode ? error.message : "服务器读取失败。")); }
  }
  const server = createServer((request, response) => void handler(request, response));
  return { server, handler, readCatalog, readEntry, paths: { rootDir, catalogPath, dataDir } };
}

function parseCli(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--host") options.host = argv[++index];
    if (argv[index] === "--port") options.port = argv[++index];
  }
  return options;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const host = resolveAdminHost(options.host);
  const port = resolveAdminPort(options.port);
  const app = createDialogueAdminServer();
  app.server.listen(port, host, () => console.log(`对白管理台已启动：http://${host}:${port}/（仅开发维护使用）`));
  if (host === "127.0.0.1") console.log("未找到 Tailscale IPv4，已回退到 127.0.0.1；可用 --host 或 DIALOGUE_ADMIN_HOST 覆盖。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
