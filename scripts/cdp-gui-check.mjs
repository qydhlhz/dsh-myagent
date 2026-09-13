// scripts/cdp-gui-check.mjs — 用 CDP 真实驱动无头浏览器打开本地 dsh GUI，检查：
//   1) 插件加载期是否报 "Failed to load plugins" / "is not declared"（用户报告的原始症状）；
//   2) 控制台/页面错误；
//   3) myagent 左栏是否真的渲染出来（正面证据：「工作区」/「区文件树」文案）。
// 用法：node scripts/cdp-gui-check.mjs "<dsh web 的 URL（含 token）>" ["<chrome 可执行文件>"]
// 零依赖：Node 24 自带全局 WebSocket，CDP 走 raw WebSocket。
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
const chromePath = process.argv[3] ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 9333 + Math.floor(Math.random() * 400);
const profileDir = mkdtempSync(join(tmpdir(), "cdp-myagent-"));

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return res.json();
}

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetchJson("/json/list");
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 浏览器还没起来 */
    }
    await sleep(250);
  }
  throw new Error("CDP target not available");
}

const wsUrl = await targetWs();
const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const consoleLines = [];
const exceptions = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params.args ?? [])
      .map((a) => a.value ?? a.description ?? a.preview?.description ?? "")
      .join(" ");
    consoleLines.push(`[${msg.params.type}] ${text}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    exceptions.push(d.exception?.description ?? d.text);
  }
};

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Runtime.enable");
await send("Page.enable");

// 先导航到同源空白页，写入模式种子：mode-store 默认 "original"（未注册增强层），
// 只有 localStorage 里是 "myagent" 才注册左栏复合。真实用户的浏览器里已持久化为 myagent。
const origin = new URL(url).origin;
await send("Page.navigate", { url: `${origin}/?token=${new URL(url).searchParams.get("token")}` });
await sleep(2500);
await evaluate(`localStorage.setItem("dsh-myagent.mode", "myagent")`);

await send("Page.navigate", { url });
// SPA + 插件 roster 需要一点时间；给足 12 秒。
await sleep(12000);

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.text };
  return { value: res.result?.result?.value };
}

const report = {};
report.bootPresent = (await evaluate("typeof window.__DSH_BOOT__")).value;
report.title = (await evaluate("document.title")).value;
report.mode = (await evaluate(`localStorage.getItem("dsh-myagent.mode")`)).value;
report.bodyText = (
  await evaluate("document.body ? document.body.innerText.slice(0, 4000) : '(no body)'")
).value;
// 正面证据：myagent 左栏复合的区标题（工作沙盒 / 沙盒文件）。
report.hasWorkspaceHeading = (await evaluate("document.body.innerText.includes('工作沙盒')")).value;
report.hasFileTreeHeading = (await evaluate("document.body.innerText.includes('沙盒文件')")).value;
// 官方左栏的标题是"工作区"——它出现说明压槽没生效。
report.hasOfficialWorkspaceHeading = (
  await evaluate("document.body.innerText.includes('工作区')")
).value;
report.regionText = (
  await evaluate(`(() => {
    const el = document.querySelector('[class*=regionArea]');
    return el ? el.innerText.slice(0, 300) : null;
  })()`)
).value;
// 错误边界兜底文案：出现即说明 Composed 渲染抛错被降级。
report.errorBoundaryShown = (
  await evaluate("document.body.innerText.includes('工作沙盒列表') && document.body.innerText.includes('重试')")
).value;

const failure = /Failed to load plugins|is not declared/i;
report.pluginFailureShown = failure.test(report.bodyText ?? "");
report.failureExcerpt = report.pluginFailureShown
  ? (report.bodyText.match(/.{0,200}(Failed to load plugins|not declared).{0,400}/is) ?? [""])[0]
  : null;

console.log(JSON.stringify({ report, exceptions, consoleLines }, null, 2));

ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {
  /* 临时目录清理失败不影响结论 */
}
