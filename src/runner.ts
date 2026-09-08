// src/runner.ts — 运行代码的最小后端：按扩展名解析解释器命令，用 child_process.spawn
// 执行并捕获 stdout/stderr。安全边界沿用 FileService 的 target/白名单；这里只负责
// “命令解析 + 进程执行”，不直接接触路径门禁。
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export interface RunResult {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
}

export type ProcessRunner = (command: string, args: string[], options: RunOptions) => Promise<RunResult>;

export interface RuntimeConfig {
  pythonPath?: string;
  rscriptPath?: string;
  nodePath?: string;
  timeoutMs?: number;
}

/** 默认进程执行器：no-shell spawn + 超时 kill + 捕获 stdout/stderr。 */
export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    const cleanup = () => clearTimeout(timer);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Object.assign(err, { code: (err as NodeJS.ErrnoException).code ?? "SPAWN_ERROR" }));
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ exitCode: code, signal: signal ?? undefined, stdout, stderr, timedOut });
    });
  });

/** Windows 上常见的 R 安装目录；macOS/Linux 走 PATH 中的 Rscript。 */
function candidateRscriptPaths(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  const env = process.env.RSCRIPT_PATH;
  if (env) push(env);
  if (process.platform === "win32") {
    const roots = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      "C:\\Program Files\\R",
      "C:\\Program Files (x86)\\R",
      "C:\\R",
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "R") : "",
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    for (const root of roots) {
      try {
        for (const dir of readdirSync(root)) {
          if (/^R-[\d.]+$/.test(dir)) {
            const candidate = path.join(root, dir, "bin", "Rscript.exe");
            if (existsSync(candidate)) push(candidate);
          }
        }
      } catch {
        // 目录不存在/不可读就跳过
      }
    }
  }
  // PATH 中的 Rscript 作为最后兜底（Windows 上通常不在 PATH，优先上面的绝对路径）。
  push("Rscript");
  return out;
}

/** 解析当前文件应使用的运行命令；不支持时返回 null。 */
export function resolveRunPlan(rel: string, abs: string, config: RuntimeConfig = {}): { command: string; args: string[] } | null {
  const name = rel.split("/").pop() ?? rel;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "py":
      return { command: config.pythonPath ?? "python", args: [abs] };
    case "r":
      return { command: config.rscriptPath ?? candidateRscriptPaths()[0] ?? "Rscript", args: [abs] };
    case "js":
    case "mjs":
    case "cjs":
      return { command: config.nodePath ?? process.execPath, args: [abs] };
    case "sh":
      return { command: "bash", args: [abs] };
    default:
      return null;
  }
}
