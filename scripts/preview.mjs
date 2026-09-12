import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const processRegistryDir = path.join(rootDir, ".preview-processes");

function processIdentity(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function registerPreviewProcess(server) {
  mkdirSync(processRegistryDir, { recursive: true });
  const markerPath = path.join(processRegistryDir, `${process.pid}.json`);
  writeFileSync(markerPath, JSON.stringify({
    managerPid: process.pid,
    managerIdentity: processIdentity(process.pid),
    serverPid: server.pid,
    startedAt: new Date().toISOString()
  }));
  return () => {
    try {
      unlinkSync(markerPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };
}

function isProjectViteProcess(pid) {
  const identity = processIdentity(pid);
  return identity.includes(rootDir) && identity.includes("vite") && identity.includes("preview");
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
    return false;
  }
}

async function stopPreviewProcesses() {
  let markerNames;
  try {
    markerNames = readdirSync(processRegistryDir).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("没有由本项目管理的活跃预览进程。");
      return;
    }
    throw error;
  }

  const records = markerNames.flatMap((name) => {
    const markerPath = path.join(processRegistryDir, name);
    try {
      return [{ markerPath, ...JSON.parse(readFileSync(markerPath, "utf8")) }];
    } catch {
      try {
        unlinkSync(markerPath);
      } catch {}
      return [];
    }
  });
  const signaled = new Set();

  for (const record of records) {
    if (record.managerIdentity && processIdentity(record.managerPid) === record.managerIdentity) {
      if (signalProcess(record.managerPid, "SIGTERM")) signaled.add(record.managerPid);
    }
    if (record.serverPid && isProjectViteProcess(record.serverPid)) {
      if (signalProcess(record.serverPid, "SIGTERM")) signaled.add(record.serverPid);
    }
    try {
      unlinkSync(record.markerPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const record of records) {
    if (record.serverPid && isProjectViteProcess(record.serverPid)) signalProcess(record.serverPid, "SIGKILL");
  }

  if (signaled.size === 0) console.log("没有由本项目管理的活跃预览进程；已清理过期记录。");
  else console.log(`已停止 ${records.length} 个预览会话（${signaled.size} 个受管理进程）。`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} ${signal ? `收到 ${signal}` : `退出码 ${code}`}`));
    });
  });
}

function readOption(args, name, fallback) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function removeOption(args, name) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith(`${name}=`)) continue;
    if (args[index] === name) {
      index += 1;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

function hasOption(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

async function waitForServer(url, getChildExit) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const childExit = getChildExit();
    if (childExit) throw new Error(`Vite preview 启动失败：${childExit}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待 ${url} 超时`);
}

function alignUserAgentWithChrome(userAgent, browserVersion) {
  const major = browserVersion.match(/(\d+)\./)?.[1];
  return major ? userAgent.replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`) : userAgent;
}

async function launchChromePreview(rawArgs) {
  if (rawArgs.includes("--help")) {
    console.log(`用法：npm run preview chrome -- [选项]

选项：
  --device=project-390  390×844 项目主基线（默认）
  --device=project-320  320×720 项目窄屏基线
  --device=pixel-7      412×839 Pixel 7 设备描述
  --no-build            跳过 npm run build
  --port=<端口>         Vite preview 端口（默认 4173）
  --host=<地址>         Vite 监听地址（默认 127.0.0.1）`);
    return;
  }

  const { chromium, devices } = await import("@playwright/test");
  const devicePresets = {
    "project-390": {
      ...devices["Pixel 7"],
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 }
    },
    "project-320": {
      ...devices["Pixel 7"],
      viewport: { width: 320, height: 720 },
      screen: { width: 320, height: 720 }
    },
    "pixel-7": devices["Pixel 7"]
  };

  const presetName = readOption(rawArgs, "--device", "project-390");
  const preset = devicePresets[presetName];
  if (!preset) {
    throw new Error(`未知设备 ${presetName}；可选值：${Object.keys(devicePresets).join(", ")}`);
  }

  const noBuild = rawArgs.includes("--no-build");
  let viteArgs = rawArgs.filter((arg) => arg !== "--no-build");
  viteArgs = removeOption(viteArgs, "--device");

  const port = Number(readOption(viteArgs, "--port", "4173"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`无效端口：${port}`);
  if (!hasOption(viteArgs, "--host")) viteArgs.push("--host", "127.0.0.1");
  if (!hasOption(viteArgs, "--port")) viteArgs.push("--port", String(port));
  if (!viteArgs.includes("--strictPort")) viteArgs.push("--strictPort");

  if (!noBuild) await run(npmBin, ["run", "build"]);

  const server = spawn(viteBin, ["preview", ...viteArgs], { cwd: rootDir, stdio: "inherit" });
  const unregisterPreviewProcess = registerPreviewProcess(server);
  let serverExit;
  server.once("exit", (code, signal) => {
    serverExit = signal ? `收到 ${signal}` : `退出码 ${code}`;
  });
  const url = `http://127.0.0.1:${port}/`;
  let browser;
  let stopping = false;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (browser?.isConnected()) await browser.close().catch(() => {});
    if (!server.killed) server.kill("SIGTERM");
    unregisterPreviewProcess();
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());

  try {
    await waitForServer(url, () => serverExit);
    browser = await chromium.launch({ channel: "chrome", headless: false });
    const { defaultBrowserType: _defaultBrowserType, ...contextOptions } = preset;
    const context = await browser.newContext({
      ...contextOptions,
      userAgent: alignUserAgentWithChrome(contextOptions.userAgent, browser.version())
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const dimensions = `${contextOptions.viewport.width}×${contextOptions.viewport.height}`;
    console.log(`\n已用 Google Chrome 打开 ${url}`);
    console.log(`设备：${presetName}，CSS 视口：${dimensions}，DPR：${contextOptions.deviceScaleFactor}`);
    console.log(`UA：${await page.evaluate(() => navigator.userAgent)}`);
    console.log("关闭该 Chrome 窗口或按 Ctrl+C 可停止预览。\n");

    await Promise.race([
      new Promise((resolve) => browser.once("disconnected", resolve)),
      new Promise((resolve) => server.once("exit", resolve))
    ]);
  } finally {
    await stop();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "stop") {
    await stopPreviewProcesses();
    return;
  }
  if (args[0] === "chrome") {
    await launchChromePreview(args.slice(1));
    return;
  }

  const server = spawn(viteBin, ["preview", ...args], { cwd: rootDir, stdio: "inherit" });
  const unregisterPreviewProcess = registerPreviewProcess(server);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (!server.killed) server.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.once("error", (error) => {
    unregisterPreviewProcess();
    console.error(error);
    process.exitCode = 1;
  });
  server.once("exit", (code) => {
    unregisterPreviewProcess();
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
