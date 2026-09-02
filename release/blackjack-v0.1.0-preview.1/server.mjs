import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "3100", 10);
const DIST_ROOT = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const RELEASE_FILE = fileURLToPath(new URL("./release.json", import.meta.url));

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT ?? "3100"}`);
}

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

const release = JSON.parse(await readFile(RELEASE_FILE, "utf8"));

function commonHeaders() {
  return {
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function cacheControl(filePath) {
  const name = filePath.slice(filePath.lastIndexOf(sep) + 1);
  if (["index.html", "sw.js", "registerSW.js", "manifest.webmanifest"].includes(name)) {
    return "no-cache";
  }
  if (/-[A-Za-z0-9_-]{8,}\.(?:css|js|woff2?)$/i.test(name)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=0, must-revalidate";
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value ?? "");
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || start > end) {
    return null;
  }
  return [start, Math.min(end, size - 1)];
}

function sendText(response, status, message, extraHeaders = {}) {
  const body = Buffer.from(message);
  response.writeHead(status, {
    ...commonHeaders(),
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      const body = Buffer.from(JSON.stringify({ status: "ok", ...release }) + "\n");
      response.writeHead(200, {
        ...commonHeaders(),
        "Cache-Control": "no-store",
        "Content-Length": body.byteLength,
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendText(response, 400, "Bad Request\n");
      return;
    }

    if (pathname === "/") pathname = "/index.html";
    const filePath = resolve(DIST_ROOT, `.${pathname}`);
    if (filePath !== DIST_ROOT && !filePath.startsWith(`${DIST_ROOT}${sep}`)) {
      sendText(response, 403, "Forbidden\n");
      return;
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      sendText(response, 404, "Not Found\n");
      return;
    }
    if (!fileStat.isFile()) {
      sendText(response, 404, "Not Found\n");
      return;
    }

    const etag = `W/\"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}\"`;
    const headers = {
      ...commonHeaders(),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl(filePath),
      "Content-Type": MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
      ETag: etag,
      "Last-Modified": fileStat.mtime.toUTCString()
    };

    if (!request.headers.range && request.headers["if-none-match"] === etag) {
      response.writeHead(304, headers);
      response.end();
      return;
    }

    let start = 0;
    let end = fileStat.size - 1;
    let status = 200;
    if (request.headers.range) {
      const range = parseRange(request.headers.range, fileStat.size);
      if (!range) {
        response.writeHead(416, {
          ...headers,
          "Content-Range": `bytes */${fileStat.size}`
        });
        response.end();
        return;
      }
      [start, end] = range;
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${fileStat.size}`;
    }
    headers["Content-Length"] = String(end - start + 1);

    response.writeHead(status, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath, { start, end })
      .on("error", (error) => {
        console.error("Static file stream failed", error);
        response.destroy(error);
      })
      .pipe(response);
  } catch (error) {
    console.error("Request failed", error);
    if (!response.headersSent) sendText(response, 500, "Internal Server Error\n");
    else response.destroy(error);
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`Blackjack preview ${release.version} (${release.commit}) listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close((error) => {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
