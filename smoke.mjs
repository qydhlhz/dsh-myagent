// smoke.mjs — 验证 bundle 契约与 patch 合成，不启动 dsh。
// @deepseek-ai/dsh-app-boot 解析顺序：
//   1. 环境变量 DSH_APP_BOOT（绝对路径或 file: URL）
//   2. 项目依赖树（node_modules 可解析时）
//   3. 全局 npm 安装目录常见位置（Windows / macOS / Linux，兼容
//      @deepseek-ai/dsh 内嵌与直接安装两种布局）
// 全部失败时报错并给出 DSH_APP_BOOT 设置方法，不再依赖任何机器特定路径。
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function bootCandidates() {
  const list = [];
  const env = process.env.DSH_APP_BOOT;
  if (env) list.push(pathToFileURL(resolve(env)).href);

  // 项目 / 依赖树内直接可解析
  list.push("@deepseek-ai/dsh-app-boot/lib/index.js");

  // 全局 npm node_modules：dsh 内嵌（…/dsh/node_modules/…）与直接安装两种布局
  const globals = [];
  if (process.env.APPDATA) globals.push(join(process.env.APPDATA, "npm", "node_modules"));
  globals.push(
    join(homedir(), "AppData", "Roaming", "npm", "node_modules"),
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
    join(homedir(), ".local", "lib", "node_modules"),
    join(homedir(), ".npm-global", "lib", "node_modules"),
  );
  for (const g of globals) {
    list.push(
      pathToFileURL(join(g, "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js")).href,
      pathToFileURL(join(g, "@deepseek-ai", "dsh-app-boot", "lib", "index.js")).href,
    );
  }
  return [...new Set(list.filter(Boolean))];
}

async function loadBoot() {
  const tried = [];
  for (const spec of bootCandidates()) {
    try {
      const url = spec.includes("://") ? spec : import.meta.resolve(spec);
      const mod = await import(url);
      return { mod, source: url };
    } catch (err) {
      tried.push(`${spec} (${err?.code ?? "ERR_UNKNOWN"})`);
    }
  }
  throw new Error(
    `cannot resolve @deepseek-ai/dsh-app-boot.\n` +
      `Set DSH_APP_BOOT to the absolute path of dsh-app-boot/lib/index.js, e.g.:\n` +
      `  DSH_APP_BOOT=.../@deepseek-ai/dsh-app-boot/lib/index.js npm run smoke\n` +
      `Tried:\n${tried.map((t) => `  - ${t}`).join("\n")}`,
  );
}

const { mod: BOOT, source } = await loadBoot();
const { composeEntries, loadOverlayPatches } = BOOT;
const manifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
if (manifest.dsh?.bundle?.patch !== "./cordis.patch.yml") throw new Error("missing dsh.bundle.patch");
if (manifest.dsh?.client?.platform !== "web") throw new Error("missing dsh.client.platform");

const patch = loadOverlayPatches("smoke", join(here, "cordis.patch.yml"));
const rows = composeEntries([patch], (m) => console.warn("[compose]", m));
const row = rows.find((r) => r.id === "myagent");
if (!row || row.name !== "dsh-myagent") throw new Error("myagent row not composed");
console.log("smoke OK:", JSON.stringify(row));
console.log(`smoke OK: dsh-app-boot resolved at ${source}`);

if (!existsSync(join(here, "lib", "index.js"))) throw new Error("lib/index.js missing — run npm run build");
if (!existsSync(join(here, "lib", "client.js"))) throw new Error("lib/client.js missing — run npm run build");
console.log("smoke OK: host + client artifacts present");
