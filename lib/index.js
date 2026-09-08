import fs, { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path, { join } from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
//#region src/path.ts
const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;
/** 相对路径白名单：非空、非 .、无盘符、不以 / 或 \ 开头、无越界 .. 段。 */
function isSafeRel(rel) {
	if (!rel || rel === ".") return false;
	if (WIN_DRIVE.test(rel)) return false;
	if (rel.startsWith("/") || rel.startsWith("\\")) return false;
	const parts = rel.split(/[\\/]+/);
	let depth = 0;
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			depth -= 1;
			if (depth < 0) return false;
		} else depth += 1;
	}
	return depth > 0;
}
/** 校验并拼接；不合法返回 null。root 必须是绝对路径。 */
function safeJoin(root, rel) {
	if (!isSafeRel(rel)) return null;
	return join(root, ...rel.split(/[\\/]+/).filter((p) => p !== "."));
}
//#endregion
//#region src/mime.ts
const TEXT_MAX_BYTES = 524288;
const PDF_MAX_BYTES = 104857600;
const AUDIO_MAX_BYTES = 104857600;
const VIDEO_MAX_BYTES = 209715200;
const TEXT_EXT = /* @__PURE__ */ new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"md",
	"markdown",
	"txt",
	"css",
	"scss",
	"html",
	"htm",
	"xml",
	"yaml",
	"yml",
	"py",
	"r",
	"sh",
	"bat",
	"ps1",
	"csv",
	"log",
	"sql",
	"toml",
	"ini",
	"env",
	"gitignore",
	"tsv"
]);
const IMAGE_EXT = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon"
};
const AUDIO_EXT = {
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	m4a: "audio/mp4",
	aac: "audio/aac",
	flac: "audio/flac",
	opus: "audio/opus"
};
const VIDEO_EXT = {
	mp4: "video/mp4",
	webm: "video/webm",
	ogv: "video/ogg",
	mov: "video/quicktime",
	m4v: "video/x-m4v",
	avi: "video/x-msvideo"
};
const OFFICE_EXT = {
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	odt: "application/vnd.oasis.opendocument.text",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
	odp: "application/vnd.oasis.opendocument.presentation",
	rtf: "application/rtf"
};
const TEXT_MIME = {
	json: "application/json",
	html: "text/html",
	htm: "text/html",
	svg: "image/svg+xml"
};
function sniff(name) {
	const dot = name.lastIndexOf(".");
	const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
	const imageMime = IMAGE_EXT[ext];
	if (imageMime) return {
		kind: "image",
		mime: imageMime
	};
	if (ext === "pdf") return {
		kind: "pdf",
		mime: "application/pdf"
	};
	const audioMime = AUDIO_EXT[ext];
	if (audioMime) return {
		kind: "audio",
		mime: audioMime
	};
	const videoMime = VIDEO_EXT[ext];
	if (videoMime) return {
		kind: "video",
		mime: videoMime
	};
	const officeMime = OFFICE_EXT[ext];
	if (officeMime) return {
		kind: "binary",
		mime: officeMime
	};
	if (ext !== "" && !TEXT_EXT.has(ext)) return {
		kind: "binary",
		mime: "application/octet-stream"
	};
	return {
		kind: "text",
		mime: TEXT_MIME[ext] ?? "text/plain; charset=utf-8"
	};
}
//#endregion
//#region src/limits.ts
function classify(name, size) {
	const { kind, mime } = sniff(name);
	if (kind === "image" && size <= 5242880) return {
		kind,
		mime,
		truncated: false,
		editable: false
	};
	if (kind === "image") return {
		kind: "binary",
		mime,
		truncated: true,
		editable: false
	};
	if (kind === "text" && size <= 524288) return {
		kind,
		mime,
		truncated: false,
		editable: true
	};
	if (kind === "text") return {
		kind,
		mime,
		truncated: true,
		editable: false
	};
	if (kind === "pdf" && size <= 104857600) return {
		kind,
		mime,
		truncated: false,
		editable: false
	};
	if (kind === "pdf") return {
		kind: "binary",
		mime,
		truncated: true,
		editable: false
	};
	if (kind === "audio" && size <= 104857600) return {
		kind,
		mime,
		truncated: false,
		editable: false
	};
	if (kind === "audio") return {
		kind: "binary",
		mime,
		truncated: true,
		editable: false
	};
	if (kind === "video" && size <= 209715200) return {
		kind,
		mime,
		truncated: false,
		editable: false
	};
	if (kind === "video") return {
		kind: "binary",
		mime,
		truncated: true,
		editable: false
	};
	return {
		kind: "binary",
		mime,
		truncated: false,
		editable: false
	};
}
//#endregion
//#region src/runner.ts
/** 默认进程执行器：no-shell spawn + 超时 kill + 捕获 stdout/stderr。 */
const runProcess = (command, args, options) => new Promise((resolve, reject) => {
	const child = spawn(command, args, {
		cwd: options.cwd,
		shell: false,
		windowsHide: true,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		]
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
	child.stdout?.on("data", (d) => {
		stdout += d.toString();
	});
	child.stderr?.on("data", (d) => {
		stderr += d.toString();
	});
	child.on("error", (err) => {
		if (settled) return;
		settled = true;
		cleanup();
		reject(Object.assign(err, { code: err.code ?? "SPAWN_ERROR" }));
	});
	child.on("close", (code, signal) => {
		if (settled) return;
		settled = true;
		cleanup();
		resolve({
			exitCode: code,
			signal: signal ?? void 0,
			stdout,
			stderr,
			timedOut
		});
	});
});
/** Windows 上常见的 R 安装目录；macOS/Linux 走 PATH 中的 Rscript。 */
function candidateRscriptPaths() {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const push = (p) => {
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
			process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "R") : ""
		].filter((p) => typeof p === "string" && p.length > 0);
		for (const root of roots) try {
			for (const dir of readdirSync(root)) if (/^R-[\d.]+$/.test(dir)) {
				const candidate = path.join(root, dir, "bin", "Rscript.exe");
				if (existsSync(candidate)) push(candidate);
			}
		} catch {}
	}
	push("Rscript");
	return out;
}
/** 解析当前文件应使用的运行命令；不支持时返回 null。 */
function resolveRunPlan(rel, abs, config = {}) {
	const name = rel.split("/").pop() ?? rel;
	switch (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "") {
		case "py": return {
			command: config.pythonPath ?? "python",
			args: [abs]
		};
		case "r": return {
			command: config.rscriptPath ?? candidateRscriptPaths()[0] ?? "Rscript",
			args: [abs]
		};
		case "js":
		case "mjs":
		case "cjs": return {
			command: config.nodePath ?? process.execPath,
			args: [abs]
		};
		case "sh": return {
			command: "bash",
			args: [abs]
		};
		default: return null;
	}
}
//#endregion
//#region src/service.ts
const OP_ALLOW$1 = /* @__PURE__ */ new Set([
	"mkdir",
	"rename",
	"move"
]);
var FileService = class {
	fs;
	runner;
	runtime;
	constructor(fs, runner = runProcess, runtime = {}) {
		this.fs = fs;
		this.runner = runner;
		this.runtime = runtime;
	}
	async target(root, rel) {
		const joined = safeJoin(root, rel);
		if (!joined) throw Object.assign(/* @__PURE__ */ new Error("path out of root"), { code: "OUT_OF_ROOT" });
		return this.fs.resolve(joined, { cwd: root });
	}
	async tree(root, rel) {
		const t = rel === "" ? await this.fs.resolve(root, { cwd: root }) : await this.target(root, rel);
		const entries = (await this.fs.listDir(t)).filter((e) => !(rel === "" && e.name === ".myagent")).map((e) => ({
			name: e.name,
			path: rel === "" ? e.name : `${rel}/${e.name}`,
			kind: e.type === "dir" || e.type === "directory" ? "dir" : "file",
			...e.size !== void 0 ? { size: e.size } : {}
		}));
		return {
			name: rel === "" ? "(root)" : rel.split("/").pop(),
			path: rel,
			entries
		};
	}
	async read(root, rel) {
		const t = await this.target(root, rel);
		const meta = await this.fs.stat(t);
		if (!meta) throw Object.assign(/* @__PURE__ */ new Error("not found"), { code: "NOT_FOUND" });
		const c = classify(rel.split("/").pop() ?? "", meta.size ?? 0);
		if (c.kind === "image") {
			const bytes = await this.fs.readBytes(t, void 0, meta.size ?? 1);
			return {
				...c,
				path: rel,
				size: meta.size,
				version: meta.version,
				content: Buffer.from(bytes).toString("base64")
			};
		}
		const kind = c.kind;
		if (kind === "binary" || kind === "pdf" || kind === "audio" || kind === "video") return {
			...c,
			path: rel,
			size: meta.size,
			version: meta.version
		};
		const bytes = await this.fs.readBytes(t, void 0, 524289);
		const content = Buffer.from(bytes).toString("utf8");
		return {
			...c,
			path: rel,
			size: meta.size,
			version: meta.version,
			content: c.truncated ? content.slice(0, TEXT_MAX_BYTES) : content
		};
	}
	async readRaw(root, rel, maxBytes) {
		const t = await this.target(root, rel);
		const meta = await this.fs.stat(t);
		if (!meta) throw Object.assign(/* @__PURE__ */ new Error("not found"), { code: "NOT_FOUND" });
		const bytes = await this.fs.readBytes(t, void 0, maxBytes ?? meta.size ?? 0);
		return {
			mime: sniff(rel.split("/").pop() ?? "").mime,
			bytes
		};
	}
	/** 运行可执行代码文件：先经过 target 门禁，再按扩展名解析解释器并执行。 */
	async run(root, rel) {
		const t = await this.target(root, rel);
		if (!await this.fs.stat(t)) throw Object.assign(/* @__PURE__ */ new Error("not found"), { code: "NOT_FOUND" });
		const abs = this.fs.processPath(t);
		const plan = resolveRunPlan(rel, abs, this.runtime);
		if (!plan) throw Object.assign(/* @__PURE__ */ new Error("unsupported language"), { code: "UNSUPPORTED_LANGUAGE" });
		const dir = path.dirname(abs);
		return this.runner(plan.command, plan.args, {
			cwd: dir,
			timeoutMs: this.runtime.timeoutMs ?? 15e3
		});
	}
	async write(root, rel, content, expectedVersion) {
		const t = await this.target(root, rel);
		const meta = await this.fs.stat(t);
		if (meta && (meta.size ?? 0) > 524288) throw Object.assign(/* @__PURE__ */ new Error("too large to edit"), { code: "TOO_LARGE" });
		if (expectedVersion !== void 0) return { version: (await this.fs.writeText(t, content, {
			kind: "replaceIfVersion",
			version: expectedVersion
		}, void 0, {
			mode: "workspace-write",
			workspaceRoot: root
		})).version };
		const version = meta?.version;
		return { version: (await this.fs.writeText(t, content, version !== void 0 ? {
			kind: "replaceIfVersion",
			version
		} : void 0, void 0, {
			mode: "workspace-write",
			workspaceRoot: root
		})).version };
	}
	async op(root, op, rel, to) {
		if (!OP_ALLOW$1.has(op)) throw Object.assign(/* @__PURE__ */ new Error("bad op"), { code: "BAD_REQUEST" });
		const t = await this.target(root, rel);
		const rootT = await this.fs.resolve(root, { cwd: root });
		if (!this.fs.contains(rootT, t)) throw Object.assign(/* @__PURE__ */ new Error("out of root"), { code: "OUT_OF_ROOT" });
		const from = this.fs.processPath(t);
		if (op === "mkdir") {
			if (await this.fs.stat(t)) throw Object.assign(/* @__PURE__ */ new Error("exists"), { code: "EXISTS" });
			mkdirSync(from, { recursive: false });
			return {};
		}
		if (!to) throw Object.assign(/* @__PURE__ */ new Error("missing to"), { code: "BAD_REQUEST" });
		const joined = safeJoin(root, to);
		if (!joined) throw Object.assign(/* @__PURE__ */ new Error("path out of root"), { code: "OUT_OF_ROOT" });
		const toTarget = await this.fs.resolve(joined, { cwd: root });
		if (!this.fs.contains(rootT, toTarget)) throw Object.assign(/* @__PURE__ */ new Error("out of root"), { code: "OUT_OF_ROOT" });
		renameSync(from, this.fs.processPath(toTarget));
		return {};
	}
	async remove(root, rel) {
		const t = await this.target(root, rel);
		const rootT = await this.fs.resolve(root, { cwd: root });
		if (!this.fs.contains(rootT, t)) throw Object.assign(/* @__PURE__ */ new Error("out of root"), { code: "OUT_OF_ROOT" });
		rmSync(this.fs.processPath(t), {
			recursive: true,
			force: false
		});
		return {};
	}
};
//#endregion
//#region src/routes.ts
const CODE_STATUS = {
	OUT_OF_ROOT: 403,
	NOT_FOUND: 404,
	EXISTS: 409,
	CONFLICT: 409,
	TOO_LARGE: 413,
	BAD_REQUEST: 400,
	ROW_NOT_FOUND: 404,
	TOGGLE_LOCKED: 403,
	SELF_LOCKED: 403,
	UNTRUSTED_HOST: 403,
	METHOD_NOT_ALLOWED: 405,
	ENOENT: 404,
	EACCES: 403,
	EPERM: 403,
	EEXIST: 409,
	ENOTEMPTY: 409,
	EISDIR: 409,
	FS_NOT_FOUND: 404,
	FS_NOT_DIRECTORY: 404,
	FS_TOO_LARGE: 413,
	FS_STALE_VERSION: 409,
	FS_PERMISSION_DENIED: 403,
	FS_SANDBOX_DENIED: 403,
	FS_NOT_TEXT: 422,
	FS_NOT_REGULAR_FILE: 422
};
const OP_ALLOW = /* @__PURE__ */ new Set([
	"mkdir",
	"rename",
	"move",
	"remove"
]);
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(payload));
}
function sendError(res, err) {
	const e = err;
	const code = e.code ?? "INTERNAL";
	sendJson(res, CODE_STATUS[code] ?? 500, {
		ok: false,
		status: CODE_STATUS[code] ?? 500,
		code,
		message: e.message ?? String(err)
	});
}
const BODY_MAX_BYTES = 1048576;
async function readBody(req) {
	return req._body ?? new Promise((resolve, reject) => {
		let raw = "";
		let total = 0;
		req.on("data", (c) => {
			total += c.length;
			if (total > BODY_MAX_BYTES) {
				req.removeAllListeners?.("data");
				reject(Object.assign(/* @__PURE__ */ new Error("body too large"), { code: "TOO_LARGE" }));
				return;
			}
			raw += c.toString();
		});
		req.on("end", () => {
			try {
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				resolve({});
			}
		});
	});
}
function createHandlers(service, trustedHosts, allowed) {
	const trust = trustedHosts && trustedHosts.length > 0 ? trustedHosts : null;
	function guard(req) {
		if (!trust) return true;
		const host = req.headers?.host ?? "";
		return trust.some((t) => host === t || host.startsWith(t + ":"));
	}
	const q = (req) => new URL(req.url, "http://x").searchParams;
	async function rootFor(req, kind) {
		if (kind === "query") return q(req).get("root");
		const body = await readBody(req);
		req._body = body;
		return typeof body?.root === "string" ? body.root : null;
	}
	async function precheck(req, res, kind) {
		if (!guard(req)) {
			sendError(res, Object.assign(/* @__PURE__ */ new Error("untrusted host"), { code: "UNTRUSTED_HOST" }));
			return false;
		}
		try {
			if (allowed) {
				const root = await rootFor(req, kind);
				if (!root) {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("missing root"), { code: "BAD_REQUEST" }));
					return false;
				}
				if (!allowed(root)) {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("root not allowed"), { code: "OUT_OF_ROOT" }));
					return false;
				}
			}
		} catch (err) {
			sendError(res, err);
			return false;
		}
		return true;
	}
	function methodAllowed(req, methods) {
		return !methods || !!req.method && methods.includes(req.method);
	}
	async function route(req, res, kind, fn, methods) {
		if (!methodAllowed(req, methods)) return sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
		if (!await precheck(req, res, kind)) return;
		try {
			sendJson(res, 200, {
				ok: true,
				data: await fn()
			});
		} catch (err) {
			sendError(res, err);
		}
	}
	return {
		async tree(req, res) {
			await route(req, res, "query", async () => {
				const root = q(req).get("root");
				const path = q(req).get("path");
				if (!root || path === null) throw Object.assign(/* @__PURE__ */ new Error("missing root/path"), { code: "BAD_REQUEST" });
				return service.tree(root, path);
			}, ["GET"]);
		},
		async read(req, res) {
			if (q(req).get("raw") === "1") {
				if (!methodAllowed(req, ["GET"])) return sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
				if (!await precheck(req, res, "query")) return;
				try {
					const root = q(req).get("root");
					const path = q(req).get("path");
					if (!root || path === null) throw Object.assign(/* @__PURE__ */ new Error("missing root/path"), { code: "BAD_REQUEST" });
					const fileName = path.split("/").pop() ?? "file";
					const inline = q(req).get("inline") === "1";
					const { kind } = sniff(fileName);
					const inlineMax = inline ? kind === "pdf" ? PDF_MAX_BYTES : kind === "audio" ? AUDIO_MAX_BYTES : kind === "video" ? VIDEO_MAX_BYTES : void 0 : void 0;
					const { mime, bytes } = await service.readRaw(root, path, inlineMax);
					res.statusCode = 200;
					res.setHeader("Content-Type", mime);
					res.setHeader("X-Content-Type-Options", "nosniff");
					const disposition = inline && (kind === "pdf" || kind === "audio" || kind === "video") ? "inline" : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
					res.setHeader("Content-Disposition", disposition);
					res.end(Buffer.from(bytes));
				} catch (err) {
					sendError(res, err);
				}
				return;
			}
			await route(req, res, "query", async () => {
				const root = q(req).get("root");
				const path = q(req).get("path");
				if (!root || path === null) throw Object.assign(/* @__PURE__ */ new Error("missing root/path"), { code: "BAD_REQUEST" });
				return service.read(root, path);
			}, ["GET"]);
		},
		async write(req, res) {
			await route(req, res, "body", async () => {
				const body = await readBody(req);
				if (typeof body?.root !== "string" || typeof body?.path !== "string" || typeof body?.content !== "string") throw Object.assign(/* @__PURE__ */ new Error("bad body"), { code: "BAD_REQUEST" });
				const expectedVersion = typeof body.expectedVersion === "string" || typeof body.expectedVersion === "number" ? body.expectedVersion : void 0;
				return service.write(body.root, body.path, body.content, expectedVersion);
			}, ["PUT"]);
		},
		async op(req, res) {
			await route(req, res, "body", async () => {
				const body = await readBody(req);
				if (typeof body?.root !== "string" || typeof body?.op !== "string" || typeof body?.path !== "string") throw Object.assign(/* @__PURE__ */ new Error("bad body"), { code: "BAD_REQUEST" });
				if (!OP_ALLOW.has(body.op)) throw Object.assign(/* @__PURE__ */ new Error("bad op"), { code: "BAD_REQUEST" });
				if ((body.op === "rename" || body.op === "move") && typeof body.to !== "string") throw Object.assign(/* @__PURE__ */ new Error("bad to"), { code: "BAD_REQUEST" });
				if (body.op === "remove") {
					if (service.remove) return service.remove(body.root, body.path);
					return service.op(body.root, body.op, body.path, body.to);
				}
				return service.op(body.root, body.op, body.path, body.to);
			}, ["POST"]);
		},
		async run(req, res) {
			await route(req, res, "body", async () => {
				const body = await readBody(req);
				if (typeof body?.root !== "string" || typeof body?.path !== "string") throw Object.assign(/* @__PURE__ */ new Error("bad body"), { code: "BAD_REQUEST" });
				return service.run(body.root, body.path);
			}, ["POST"]);
		}
	};
}
//#endregion
//#region src/client/group-store.ts
const DEFAULT_GROUP_ID = "default";
//#endregion
//#region src/client/organizer.ts
function norm$1(s) {
	return s.trim().toLocaleLowerCase();
}
const STOP_TOKENS = /* @__PURE__ */ new Set([
	"工作",
	"项目",
	"对话",
	"关于",
	"这个",
	"那个",
	"一个",
	"进行",
	"使用",
	"如何",
	"什么",
	"怎么",
	"为什么",
	"可以",
	"需要",
	"没有",
	"就是",
	"还是",
	"因为",
	"所以",
	"但是",
	"如果",
	"然后",
	"现在",
	"今天",
	"昨天",
	"明天",
	"学习",
	"开发",
	"测试",
	"修复",
	"实现",
	"的",
	"了",
	"是",
	"在",
	"我",
	"你",
	"他",
	"她",
	"它",
	"我们",
	"你们",
	"他们",
	"它们",
	"and",
	"the",
	"for",
	"with"
]);
const JUNK_GROUP_NAMES = /* @__PURE__ */ new Set([
	"的对",
	"的对话",
	"关于",
	"对话",
	"关于的",
	"的的"
]);
const COARSE_GROUP_NAMES = /* @__PURE__ */ new Set([
	"插件",
	"dsh",
	"项目",
	"工作",
	"开发",
	"测试",
	"讨论",
	"其他",
	"相关",
	"默认",
	"杂项"
]);
function isJunkGroupName(name) {
	const n = name.trim();
	if (!n) return true;
	if (JUNK_GROUP_NAMES.has(n)) return true;
	if (n.length <= 1) return true;
	return false;
}
function isCoarseGroupName(name) {
	const n = name.trim();
	if (COARSE_GROUP_NAMES.has(n)) return true;
	return n.length <= 2 && !isJunkGroupName(n);
}
/** 判断是否为“项目无关”的旧式分组名：宽泛词本身，或“宽泛词+阶段”（如“插件开发”“插件配置”）。
*  这类分组可能是旧版按用途/阶段拆分产生的，里面混了多个项目，需要按项目名重新拆分。 */
const PHASE_SUFFIXES = [
	"开发",
	"实现",
	"配置",
	"安装",
	"部署",
	"设置",
	"讨论",
	"咨询",
	"修复",
	"调试",
	"调研",
	"规划",
	"测试",
	"移植",
	"封装",
	"执行"
];
function isProjectAgnosticGroupName(name) {
	const n = name.trim();
	if (isCoarseGroupName(n)) return true;
	for (const suffix of PHASE_SUFFIXES) if (n.endsWith(suffix)) {
		if (isCoarseGroupName(n.slice(0, n.length - suffix.length))) return true;
	}
	return false;
}
/** 从一组会话的标题/简述中提取一个最合适的主题词作为分组名。 */
function suggestNameFromSessions(sessions) {
	const texts = sessions.map((s) => `${s.title} ${s.brief}`).filter((t) => t.trim());
	if (texts.length === 0) return "";
	const project = commonProject(sessions);
	if (project) return project;
	const tokenCount = /* @__PURE__ */ new Map();
	for (const text of texts) {
		const tokens = new Set(tokenize(text));
		for (const t of tokens) {
			if (JUNK_GROUP_NAMES.has(t)) continue;
			tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
		}
	}
	const isChinese = (t) => /[一-鿿]/.test(t);
	const ranked = [...tokenCount.entries()].filter(([t, count]) => count >= 2 && !isJunkGroupName(t) && isChinese(t)).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
	if (ranked.length > 0) return specificGroupName(sessions, ranked[0][0]);
	for (const text of texts) {
		const tokens = tokenize(text).filter((t) => !isJunkGroupName(t) && isChinese(t));
		if (tokens.length > 0) return specificGroupName(sessions, tokens[0]);
	}
	return "";
}
/** 根据标题/简述判断会话阶段/目的，返回中文阶段词（如“配置”“移植”“讨论”）。 */
function phaseOf(text) {
	if (/配置|安装|部署|设置|接入/.test(text)) return "配置";
	if (/移植|封装|复制|迁移/.test(text)) return "移植封装";
	if (/开发|实现|编码|编写|构建/.test(text)) return "开发";
	if (/讨论|咨询|问答|了解|探究/.test(text)) return "讨论";
	if (/修复|调试|排查|解决|报错/.test(text)) return "修复";
	if (/调研|搜索|查询|查找|对比/.test(text)) return "调研";
	if (/规划|计划|方案|设计/.test(text)) return "规划";
	if (/测试|验证|试用/.test(text)) return "测试";
	return "";
}
/** 识别会话所属项目名；优先按项目名分组，而不是按用途/阶段跨项目归类。 */
const PROJECT_NAMES = [
	{
		name: "MYAGENT",
		test: /dsh-myagent|myagent|my agent/i
	},
	{
		name: "dsh-file-manager",
		test: /dsh-file-manager|file[-_ ]?manager/i
	},
	{
		name: "MA-logo",
		test: /ma-logo|ma[-_ ]?logo|ma 图标|ma图标/i
	},
	{
		name: "dsh-vision-any",
		test: /dsh-vision-any|vision-any/i
	},
	{
		name: "dsh-anchored-standard",
		test: /dsh-anchored-standard|anchored-standard/i
	},
	{
		name: "opencode",
		test: /opencode/i
	},
	{
		name: "GitHub MCP",
		test: /github[-_ ]?mcp|github mcp/i
	},
	{
		name: "xingli",
		test: /xingli/i
	},
	{
		name: "dsh",
		test: /\bdsh\b/i
	}
];
function projectOf(s) {
	for (const p of PROJECT_NAMES) if (p.test.test(s.title)) return p.name;
	for (const p of PROJECT_NAMES) if (p.test.test(s.brief)) return p.name;
	return "";
}
function commonProject(sessions) {
	const projects = sessions.map((s) => projectOf(s)).filter(Boolean);
	const first = projects[0];
	if (first && projects.every((p) => p === first)) return first;
	return "";
}
/** 从一组会话中推断一个更具体的分组名：主题词 + 阶段词，避免只叫“插件”。 */
function specificGroupName(sessions, topic) {
	const phaseCount = /* @__PURE__ */ new Map();
	for (const s of sessions) {
		const phase = phaseOf(`${s.title} ${s.brief}`);
		if (phase) phaseCount.set(phase, (phaseCount.get(phase) ?? 0) + 1);
	}
	const topPhase = [...phaseCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
	if (topPhase && !topic.includes(topPhase)) return `${topic}${topPhase}`;
	return topic;
}
/** 从标题/简述中提取候选主题词：拉丁词 + 中文二元组。 */
function tokenize(text) {
	const lower = text.toLocaleLowerCase();
	const tokens = /* @__PURE__ */ new Set();
	for (const m of lower.match(/[a-z0-9]{2,}/g) ?? []) if (!STOP_TOKENS.has(m)) tokens.add(m);
	const han = lower.replace(/[^一-鿿]/g, "");
	for (let i = 0; i < han.length - 1; i++) {
		const bigram = han.slice(i, i + 2);
		if (!STOP_TOKENS.has(bigram)) tokens.add(bigram);
	}
	return [...tokens];
}
function defaultBriefFor(kind, name) {
	const trimmed = name.trim();
	if (!trimmed) return "";
	if (kind === "workspace") return `工作沙盒：${trimmed}`;
	if (kind === "group") return `分组：${trimmed}`;
	return `对话：${trimmed}`;
}
function str(v) {
	return typeof v === "string" ? v : "";
}
function isRecord(v) {
	return typeof v === "object" && v !== null;
}
/** 把外部（agent）返回的整理建议 JSON 规范化为内部 OrganizePlan，丢弃字段不全的动作。 */
function normalizeOrganizePlan(input) {
	if (!isRecord(input) || !Array.isArray(input.actions)) return { actions: [] };
	const actions = [];
	for (const raw of input.actions) {
		if (!isRecord(raw)) continue;
		const kind = raw.kind;
		const workspaceId = str(raw.workspaceId);
		if (!workspaceId) continue;
		switch (kind) {
			case "createGroup": {
				const groupId = str(raw.groupId);
				const name = str(raw.name);
				if (groupId && name) actions.push({
					kind,
					workspaceId,
					groupId,
					name,
					reason: str(raw.reason)
				});
				break;
			}
			case "renameGroup": {
				const groupId = str(raw.groupId);
				const oldName = str(raw.oldName);
				const newName = str(raw.newName);
				if (groupId && newName) actions.push({
					kind,
					workspaceId,
					groupId,
					oldName: oldName || newName,
					newName,
					reason: str(raw.reason)
				});
				break;
			}
			case "deleteGroup": {
				const groupId = str(raw.groupId);
				const name = str(raw.name);
				if (groupId) actions.push({
					kind,
					workspaceId,
					groupId,
					name: name || groupId,
					reason: str(raw.reason)
				});
				break;
			}
			case "mergeGroup": {
				const fromGroupId = str(raw.fromGroupId);
				const fromName = str(raw.fromName);
				const toGroupId = str(raw.toGroupId);
				const toName = str(raw.toName);
				if (fromGroupId && toGroupId) actions.push({
					kind,
					workspaceId,
					fromGroupId,
					fromName: fromName || fromGroupId,
					toGroupId,
					toName: toName || toGroupId,
					reason: str(raw.reason)
				});
				break;
			}
			case "moveSession": {
				const sessionId = str(raw.sessionId);
				const sessionTitle = str(raw.sessionTitle);
				const fromGroupId = str(raw.fromGroupId);
				const fromGroupName = str(raw.fromGroupName);
				const toGroupId = str(raw.toGroupId);
				const toGroupName = str(raw.toGroupName);
				if (sessionId && toGroupId) actions.push({
					kind,
					workspaceId,
					sessionId,
					sessionTitle: sessionTitle || sessionId,
					fromGroupId: fromGroupId || "default",
					fromGroupName: fromGroupName || "默认分组",
					toGroupId,
					toGroupName: toGroupName || toGroupId,
					reason: str(raw.reason)
				});
				break;
			}
			case "updateBrief": {
				const entity = raw.entity;
				if (entity !== "workspace" && entity !== "group" && entity !== "session") break;
				const entityName = str(raw.entityName);
				const newBrief = str(raw.newBrief);
				if (entityName && newBrief) {
					const base = {
						kind,
						entity,
						workspaceId,
						entityName,
						oldBrief: str(raw.oldBrief),
						newBrief,
						reason: str(raw.reason)
					};
					if (entity === "workspace") actions.push(base);
					else if (entity === "group") {
						const groupId = str(raw.groupId);
						if (groupId) actions.push({
							...base,
							groupId
						});
					} else {
						const sessionId = str(raw.sessionId);
						if (sessionId) actions.push({
							...base,
							sessionId
						});
					}
				}
				break;
			}
		}
	}
	const moveTargets = new Set(actions.filter((a) => a.kind === "moveSession").map((a) => a.toGroupId));
	return { actions: actions.filter((a) => a.kind !== "createGroup" || moveTargets.has(a.groupId)) };
}
/** 当默认分组中有多个未归类的会话时，先按项目名新建分组并移入；无法识别项目的再按共同主题词兜底。 */
function suggestNewGroups(ws, actions, matched) {
	const defaultGroup = ws.groups.find((g) => g.id === DEFAULT_GROUP_ID);
	if (!defaultGroup) return;
	const sessionById = new Map(ws.sessions.map((s) => [s.id, s]));
	const candidates = defaultGroup.sessionIds.map((id) => sessionById.get(id)).filter((s) => !!s && !matched.has(s.id) && Boolean(s.title.trim() || s.brief.trim()));
	if (candidates.length === 0) return;
	const existingNames = new Set(ws.groups.filter((g) => g.id !== DEFAULT_GROUP_ID).map((g) => norm$1(g.name)));
	const createdNames = /* @__PURE__ */ new Set();
	const moved = new Set(matched);
	let created = 0;
	const byProject = /* @__PURE__ */ new Map();
	const unprojected = [];
	for (const s of candidates) {
		const project = projectOf(s);
		if (project) {
			const arr = byProject.get(project) ?? [];
			arr.push(s);
			byProject.set(project, arr);
		} else unprojected.push(s);
	}
	for (const [project, arr] of byProject) {
		const name = project;
		const existing = ws.groups.find((g) => g.id !== "default" && norm$1(g.name) === norm$1(name));
		const groupId = existing?.id ?? `g_org_${ws.id.replace(/\W/g, "_")}_${created}_${Math.random().toString(36).slice(2, 8)}`;
		if (!existing) {
			if (existingNames.has(norm$1(name)) || createdNames.has(norm$1(name))) continue;
			actions.push({
				kind: "createGroup",
				workspaceId: ws.id,
				groupId,
				name,
				reason: `按项目名新建分组“${name}”`
			});
			createdNames.add(norm$1(name));
		}
		for (const s of arr) {
			if (moved.has(s.id)) continue;
			actions.push({
				kind: "moveSession",
				workspaceId: ws.id,
				sessionId: s.id,
				sessionTitle: s.title || s.id,
				fromGroupId: DEFAULT_GROUP_ID,
				fromGroupName: defaultGroup.name,
				toGroupId: groupId,
				toGroupName: name,
				reason: `会话“${s.title || s.id}”属于项目“${name}”，移入项目分组`
			});
			moved.add(s.id);
		}
		created++;
	}
	const remaining = unprojected.filter((s) => !moved.has(s.id));
	if (remaining.length < 2) return;
	const tokenCount = /* @__PURE__ */ new Map();
	const tokenSessions = /* @__PURE__ */ new Map();
	for (const s of remaining) {
		const tokens = new Set(tokenize(`${s.title} ${s.brief}`));
		for (const t of tokens) {
			tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
			const arr = tokenSessions.get(t) ?? [];
			arr.push(s.id);
			tokenSessions.set(t, arr);
		}
	}
	const isChinese = (t) => /[一-鿿]/.test(t);
	const ranked = [...tokenCount.entries()].filter(([t, count]) => count >= 2 && isChinese(t) && !isJunkGroupName(t)).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
	for (const [token, count] of ranked) {
		if (created >= 5) break;
		const ids = (tokenSessions.get(token) ?? []).filter((id) => !moved.has(id));
		if (ids.length < 2) continue;
		const name = specificGroupName(ids.map((id) => sessionById.get(id)).filter((s) => !!s), token);
		if (existingNames.has(norm$1(name)) || createdNames.has(norm$1(name))) continue;
		const groupId = `g_org_${ws.id.replace(/\W/g, "_")}_${created}_${Math.random().toString(36).slice(2, 8)}`;
		actions.push({
			kind: "createGroup",
			workspaceId: ws.id,
			groupId,
			name,
			reason: `根据 ${count} 个会话的共同主题“${token}”新建分组“${name}”`
		});
		for (const id of ids) {
			const s = sessionById.get(id);
			actions.push({
				kind: "moveSession",
				workspaceId: ws.id,
				sessionId: id,
				sessionTitle: s?.title || id,
				fromGroupId: DEFAULT_GROUP_ID,
				fromGroupName: defaultGroup.name,
				toGroupId: groupId,
				toGroupName: name,
				reason: `会话“${s?.title || id}”与新建分组“${name}”匹配`
			});
			moved.add(id);
		}
		createdNames.add(norm$1(name));
		created++;
	}
}
/** 拆分宽泛分组：如果一个大组里混了多个项目，按项目名拆成更清晰的项目分组。 */
function splitCoarseGroup(ws, group, actions) {
	if (!isProjectAgnosticGroupName(group.name)) return;
	const sessionById = new Map(ws.sessions.map((s) => [s.id, s]));
	const members = group.sessionIds.map((id) => sessionById.get(id)).filter((s) => !!s);
	if (members.length < 2) return;
	const byProject = /* @__PURE__ */ new Map();
	const unprojected = [];
	for (const s of members) {
		const project = projectOf(s);
		if (project) {
			const arr = byProject.get(project) ?? [];
			arr.push(s);
			byProject.set(project, arr);
		} else unprojected.push(s);
	}
	if (byProject.size === 0) return;
	const existingNames = new Set(ws.groups.filter((g) => g.id !== DEFAULT_GROUP_ID).map((g) => norm$1(g.name)));
	const createdNames = /* @__PURE__ */ new Set();
	const moved = /* @__PURE__ */ new Set();
	let createdIndex = 0;
	for (const [project, arr] of byProject) {
		const name = project;
		const existing = ws.groups.find((g) => g.id !== "default" && g.id !== group.id && norm$1(g.name) === norm$1(name));
		const groupId = existing?.id ?? `g_split_${ws.id.replace(/\W/g, "_")}_${createdIndex}_${Math.random().toString(36).slice(2, 8)}`;
		if (!existing) {
			if (existingNames.has(norm$1(name)) || createdNames.has(norm$1(name))) continue;
			actions.push({
				kind: "createGroup",
				workspaceId: ws.id,
				groupId,
				name,
				reason: `拆分宽泛分组“${group.name}”：按项目“${name}”归类`
			});
			createdNames.add(norm$1(name));
		}
		for (const s of arr) {
			actions.push({
				kind: "moveSession",
				workspaceId: ws.id,
				sessionId: s.id,
				sessionTitle: s.title || s.id,
				fromGroupId: group.id,
				fromGroupName: group.name,
				toGroupId: groupId,
				toGroupName: name,
				reason: `会话“${s.title || s.id}”属于项目“${name}”，移入项目分组`
			});
			moved.add(s.id);
		}
		createdIndex++;
	}
	if (moved.size > 0 && moved.size === members.length) actions.push({
		kind: "deleteGroup",
		workspaceId: ws.id,
		groupId: group.id,
		name: group.name,
		reason: `宽泛分组“${group.name}”的会话已全部分入项目分组`
	});
}
/** 本地确定性整理建议：补齐简述、合并重名分组、删除空命名分组、按名称把默认分组会话归入匹配分组。 */
function buildOrganizePlan(snapshot) {
	const actions = [];
	for (const ws of snapshot.workspaces) {
		if (!ws.brief.trim()) actions.push({
			kind: "updateBrief",
			entity: "workspace",
			workspaceId: ws.id,
			entityName: ws.title || ws.id,
			oldBrief: "",
			newBrief: defaultBriefFor("workspace", ws.title || ws.id),
			reason: "工作沙盒缺少一句话标注"
		});
		for (const group of ws.groups) if (!group.brief.trim()) actions.push({
			kind: "updateBrief",
			entity: "group",
			workspaceId: ws.id,
			groupId: group.id,
			entityName: group.name,
			oldBrief: "",
			newBrief: defaultBriefFor("group", group.name),
			reason: "分组缺少一句话标注"
		});
		for (const session of ws.sessions) if (!session.brief.trim() && session.title.trim()) actions.push({
			kind: "updateBrief",
			entity: "session",
			workspaceId: ws.id,
			sessionId: session.id,
			entityName: session.title || session.id,
			oldBrief: "",
			newBrief: defaultBriefFor("session", session.title || session.id),
			reason: "会话缺少一句话标注"
		});
		const seen = /* @__PURE__ */ new Map();
		const mergedFrom = /* @__PURE__ */ new Set();
		for (const group of ws.groups) {
			if (group.id === "default") continue;
			const key = norm$1(group.name);
			if (!key) continue;
			const firstId = seen.get(key);
			if (firstId === void 0) {
				seen.set(key, group.id);
				continue;
			}
			const first = ws.groups.find((g) => g.id === firstId);
			if (first) {
				actions.push({
					kind: "mergeGroup",
					workspaceId: ws.id,
					fromGroupId: group.id,
					fromName: group.name,
					toGroupId: first.id,
					toName: first.name,
					reason: `存在重名分组“${group.name}”，合并到先创建的“${first.name}”`
				});
				mergedFrom.add(group.id);
			}
		}
		const removedGroupIds = new Set(mergedFrom);
		for (const group of ws.groups) {
			if (group.id === "default" || mergedFrom.has(group.id)) continue;
			if (group.sessionIds.length === 0) {
				actions.push({
					kind: "deleteGroup",
					workspaceId: ws.id,
					groupId: group.id,
					name: group.name,
					reason: `分组“${group.name}”中没有聊天框`
				});
				removedGroupIds.add(group.id);
			}
		}
		const matchedByMove = /* @__PURE__ */ new Set();
		const namedGroups = ws.groups.filter((g) => g.id !== "default" && !removedGroupIds.has(g.id));
		const defaultGroup = ws.groups.find((g) => g.id === DEFAULT_GROUP_ID);
		for (const session of ws.sessions) {
			if (!defaultGroup?.sessionIds.includes(session.id)) continue;
			const haystack = `${session.title} ${session.brief}`.toLocaleLowerCase();
			let best;
			for (const group of namedGroups) {
				if (!group.name.trim()) continue;
				if (haystack.includes(norm$1(group.name))) {
					if (!best || group.name.length > best.name.length) best = group;
				}
			}
			if (best) {
				actions.push({
					kind: "moveSession",
					workspaceId: ws.id,
					sessionId: session.id,
					sessionTitle: session.title || session.id,
					fromGroupId: DEFAULT_GROUP_ID,
					fromGroupName: defaultGroup?.name ?? "default",
					toGroupId: best.id,
					toGroupName: best.name,
					reason: `会话“${session.title || session.id}”的内容与分组“${best.name}”匹配`
				});
				matchedByMove.add(session.id);
			}
		}
		suggestNewGroups(ws, actions, matchedByMove);
		const sessionById = new Map(ws.sessions.map((s) => [s.id, s]));
		for (const group of ws.groups) {
			if (group.id === "default") continue;
			if (!isJunkGroupName(group.name)) continue;
			const memberSessions = group.sessionIds.map((id) => sessionById.get(id)).filter((s) => !!s);
			if (memberSessions.length === 0) continue;
			const suggested = suggestNameFromSessions(memberSessions);
			if (suggested && norm$1(suggested) !== norm$1(group.name)) actions.push({
				kind: "renameGroup",
				workspaceId: ws.id,
				groupId: group.id,
				oldName: group.name,
				newName: suggested,
				reason: `原分组名“${group.name}”来自旧版错误简介，根据最新会话内容建议改为“${suggested}”`
			});
		}
		for (const group of ws.groups) {
			if (group.id === "default") continue;
			splitCoarseGroup(ws, group, actions);
		}
	}
	return { actions };
}
//#endregion
//#region src/organizer-agent.ts
let organizerHandle = null;
let organizerAgent = null;
let organizerReady = null;
const ORGANIZER_SESSION_ID = "dsh-myagent-sandbox-organizer";
function withTimeout(promise, ms, signal) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener?.("abort", onAbort);
			reject(/* @__PURE__ */ new Error("organizer agent timeout"));
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("organizer request aborted"));
		};
		if (signal?.aborted) {
			clearTimeout(timer);
			reject(/* @__PURE__ */ new Error("organizer request aborted"));
			return;
		}
		signal?.addEventListener?.("abort", onAbort, { once: true });
		promise.then((value) => {
			clearTimeout(timer);
			signal?.removeEventListener?.("abort", onAbort);
			resolve(value);
		}, (err) => {
			clearTimeout(timer);
			signal?.removeEventListener?.("abort", onAbort);
			reject(err);
		});
	});
}
async function ensureOrganizerAgent(ctx, signal) {
	if (organizerAgent) return;
	if (organizerReady) return organizerReady;
	organizerReady = (async () => {
		const agents = ctx?.get?.("agents") ?? ctx?.agents;
		if (!agents?.create) throw new Error("agents service unavailable");
		const setup = (agentCtx) => {
			try {
				agentCtx?.tools?.restrict?.({ allow: [] });
			} catch {}
			try {
				agentCtx?.systemPrompt?.section?.({
					name: "dsh-myagent-sandbox-organizer",
					order: -1e3,
					complete: true,
					text: "你是管家。你只根据用户提供的 JSON 快照输出整理建议 JSON；快照只包含未归档、未删除的可见会话。快照中的 title 和 brief 是你整理的核心原料。分组时先按项目名归类，例如“MYAGENT”“dsh-file-manager”，不要按用途/阶段把不同项目混到同一组；项目分组内的会话标题写成“主题+阶段”（如“登录讨论”“配置执行”）。你不读取文件、不调用工具、不解释、不输出 JSON 以外的内容。"
				});
			} catch {}
			try {
				agentCtx?.systemPrompt?.suppressRuntimeContext?.();
			} catch {}
		};
		try {
			const handle = await agents.create({
				sessionId: ORGANIZER_SESSION_ID,
				meta: { cwd: process.cwd() },
				agentOptions: {},
				setup,
				signal
			});
			organizerHandle = handle;
			organizerAgent = handle?.agent;
		} catch (err) {
			if (agents.resume) {
				const handle = await agents.resume({
					resumeSessionId: ORGANIZER_SESSION_ID,
					agentOptions: {},
					setup,
					signal
				});
				organizerHandle = handle;
				organizerAgent = handle?.agent;
			} else throw err;
		}
	})().finally(() => {
		organizerReady = null;
	});
	return organizerReady;
}
function extractJson(text) {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {}
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) try {
		return JSON.parse(fence[1].trim());
	} catch {}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start !== -1 && end > start) try {
		return JSON.parse(trimmed.slice(start, end + 1));
	} catch {}
	throw new Error("organizer agent returned invalid JSON");
}
function lastAssistantText(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role !== "assistant") continue;
		const text = (m.content ?? []).filter((b) => b?.type === "text").map((b) => b?.text ?? "").join("\n").trim();
		if (text) return text;
	}
	return "";
}
/** 向常驻整理员发送一次整理请求，返回规范化后的建议 JSON。 */
async function requestOrganizerPlan(ctx, snapshot, signal) {
	await ensureOrganizerAgent(ctx, signal);
	if (!organizerAgent) throw new Error("organizer agent not ready");
	const prompt = `你是管家。请根据下面的工作沙盒树、分组名、会话标题（title）与一句话简介（brief），输出一份整理建议 JSON。
要求：
- 只输出 JSON，不要解释。
- JSON 结构：{"actions":[...]}
- action 的 kind 只能是：createGroup、renameGroup、deleteGroup、mergeGroup、moveSession、updateBrief。
- 每个 action 必须包含 workspaceId，以及该类型所需的字段（groupId/name/sessionId/toGroupId/entity/newBrief 等）。
- 分组第一优先按项目名，例如“MYAGENT”“dsh-file-manager”；不要把不同项目的同一用途/阶段混到同一组。
- 只处理快照中出现的会话；不要为已归档、已删除或未出现在快照中的会话生成任何建议。
- 项目分组内的会话标题写成“主题+阶段”（如“登录讨论”“配置执行”），简介一句话说明该对话具体在做什么。
- 对会话的 updateBrief：entity 为 "session"，entityName 填整理后的中文标题，newBrief 填一句话中文简介；不要用“关于”开头，长度控制在 40 字以内。
- 如果会话/分组标题是旧版占位（如“关于…”“你是谁”“未命名会话”）或过于宽泛，应同时通过 updateBrief 修正标题和简介。
- 建议要保守：只建议明确合理的改动，不要臆造不存在的实体。
- 如果默认分组中有多个会话，应新建有意义的命名分组并移入对应会话。
- 分组要尽量细分，不要只根据一个宽泛关键词（如“插件”“dsh”“项目”）把所有会话归为一组。
- 在一个项目分组内，用会话标题/简介区分目的和阶段（如“登录讨论”“配置执行”），但不要把这些不同阶段建成跨项目的分组。
- 不要按“配置/开发/讨论”等环节把不同项目合并到同一组；同一项目下的不同环节用会话标题体现，而不是拆成跨项目分组。
- 分组名使用中文；除非是 GitHub、MCP、API 等专有名词，否则不要用英文单词作分组名。
- 如果当前只有默认分组，优先考虑新建 2-5 个具体、细分的命名分组，让整理后不再只有默认分组。
- 不要调用任何工具。

快照：
${JSON.stringify(snapshot, null, 2)}`;
	const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
	organizerAgent.followup({
		id: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "user",
		content: [{
			type: "text",
			text: prompt
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-myagent"
		}
	});
	const idlePromise = organizerAgent.whenIdle?.();
	if (idlePromise) await withTimeout(Promise.resolve(idlePromise), 6e4, signal);
	const assistantText = lastAssistantText((organizerAgent.session?.deriveMessages?.() ?? []).slice(before));
	if (!assistantText) throw new Error("organizer agent returned no output");
	const parsed = extractJson(assistantText);
	const plan = normalizeOrganizePlan(parsed);
	if (plan.actions.length === 0 && !Array.isArray(parsed?.actions)) throw new Error("organizer agent returned invalid plan");
	return {
		plan,
		source: "agent"
	};
}
/** 让常驻整理员把一段会话内容总结为一句话简介。 */
async function requestSessionSummary(ctx, _sessionId, messages, signal) {
	await ensureOrganizerAgent(ctx, signal);
	if (!organizerAgent) throw new Error("organizer agent not ready");
	const prompt = `请根据下面的对话内容，用一句中文概括这个对话的用途或主题。
要求：
- 只输出这一句概括，不要解释，不要用“关于”开头。
- 优先写成“做什么/解决什么”的动宾结构，而不是“关于什么”。
- 如果对话属于某个项目（如 MYAGENT、dsh-file-manager），在概括中带上项目名。
- 用“主题+阶段”的语感（如“登录讨论”“配置执行”）。
- 长度控制在 40 字以内。

对话内容：
${messages.slice(0, 20).map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.text}`).join("\n")}`;
	const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
	organizerAgent.followup({
		id: `sum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "user",
		content: [{
			type: "text",
			text: prompt
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-myagent"
		}
	});
	const idlePromise = organizerAgent.whenIdle?.();
	if (idlePromise) await withTimeout(Promise.resolve(idlePromise), 3e4, signal);
	const summary = lastAssistantText((organizerAgent.session?.deriveMessages?.() ?? []).slice(before));
	if (!summary) throw new Error("organizer agent returned no summary");
	return summary.replace(/\s+/g, " ").trim();
}
/** 让常驻整理员把一段会话内容重新总结为一个标题。 */
async function requestSessionTitle(ctx, _sessionId, messages, signal) {
	await ensureOrganizerAgent(ctx, signal);
	if (!organizerAgent) throw new Error("organizer agent not ready");
	const prompt = `请根据下面的对话内容，用一句中文给这个对话起一个标题。
要求：
- 只输出标题，不要解释，不要用“关于”开头。
- 使用“主题+阶段”的语感，例如“登录讨论”“配置执行”。
- 长度控制在 20 字以内。

对话内容：
${messages.slice(0, 20).map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.text}`).join("\n")}`;
	const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
	organizerAgent.followup({
		id: `title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "user",
		content: [{
			type: "text",
			text: prompt
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-myagent"
		}
	});
	const idlePromise = organizerAgent.whenIdle?.();
	if (idlePromise) await withTimeout(Promise.resolve(idlePromise), 3e4, signal);
	const title = lastAssistantText((organizerAgent.session?.deriveMessages?.() ?? []).slice(before));
	if (!title) throw new Error("organizer agent returned no title");
	return title.replace(/\s+/g, " ").trim();
}
/** 让常驻整理员根据“最后一次记忆 md”内容，输出对话标题和简介。 */
async function requestMemoryMeta(ctx, memoryText, signal) {
	await ensureOrganizerAgent(ctx, signal);
	if (!organizerAgent) throw new Error("organizer agent not ready");
	const prompt = `请根据下面的“最后一次记忆”内容，输出这个对话的标题和一句话简介。
要求：
- 只输出 JSON，不要解释，不要用“关于”开头。
- JSON 结构：{"title":"...","brief":"..."}
- title 使用“主题+阶段”语感，长度控制在 20 字以内。
- brief 使用“做什么/解决什么”的动宾结构，长度控制在 40 字以内。

最后一次记忆：
${memoryText.slice(0, 3e3)}`;
	const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
	organizerAgent.followup({
		id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: "user",
		content: [{
			type: "text",
			text: prompt
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-myagent"
		}
	});
	const idlePromise = organizerAgent.whenIdle?.();
	if (idlePromise) await withTimeout(Promise.resolve(idlePromise), 3e4, signal);
	const text = lastAssistantText((organizerAgent.session?.deriveMessages?.() ?? []).slice(before));
	if (!text) throw new Error("organizer agent returned no memory summary");
	const parsed = extractJson(text);
	if (!parsed || typeof parsed !== "object") throw new Error("organizer agent returned invalid memory summary");
	const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
	const brief = typeof parsed.brief === "string" ? parsed.brief.trim() : "";
	if (!title || !brief) throw new Error("organizer agent returned incomplete memory summary");
	return {
		title,
		brief
	};
}
/** 本地确定性整理器（无 agent 或 agent 失败时降级）。 */
function localOrganizerPlan(snapshot) {
	return buildOrganizePlan(snapshot);
}
/** 插件卸载时释放常驻 agent。 */
function disposeOrganizerAgent() {
	const handle = organizerHandle;
	organizerHandle = null;
	organizerAgent = null;
	return handle?.dispose?.();
}
//#endregion
//#region src/session-summary.ts
function textFromContent(content) {
	if (!Array.isArray(content)) return "";
	return content.filter((b) => b?.type === "text").map((b) => b?.text ?? "").join(" ").trim();
}
function isRealUserText(text) {
	return !/Workspace instruction files exist|AGENTS\.md|<system-reminder>|Current runtime context|The approval policy changed/.test(text);
}
/** 从 live session 或持久化存储中读取会话消息。 */
async function getSessionMessages(ctx, sessionId) {
	const live = ctx?.sessions?.get?.(sessionId);
	if (live?.deriveMessages) return live.deriveMessages().map((m) => ({
		role: m.role,
		text: textFromContent(m.content)
	}));
	const persistence = ctx?.sessionPersistence;
	if (persistence?.inspect) {
		const { events } = await persistence.inspect(sessionId);
		return events.filter((e) => e.type === "user/message" || e.type === "assistant/message").map((e) => ({
			role: e.data?.role ?? (e.type === "user/message" ? "user" : "assistant"),
			text: textFromContent(e.data?.content)
		}));
	}
	return [];
}
/** 从 live session 或持久化存储中读取会话的工作目录（用于定位项目记忆 md）。 */
async function getSessionCwd(ctx, sessionId) {
	const live = ctx?.sessions?.get?.(sessionId);
	if (live?.session?.cwd && typeof live.session.cwd === "string") return live.session.cwd;
	const persistence = ctx?.sessionPersistence;
	if (persistence?.inspect) {
		const { events } = await persistence.inspect(sessionId);
		const sessionEvent = events.find((e) => e.type === "session");
		if (sessionEvent?.data?.cwd && typeof sessionEvent.data.cwd === "string") return sessionEvent.data.cwd;
	}
	return null;
}
/** 重新总结单个会话的标题和/或简介（基于会话内容，不读记忆 md）。 */
async function resummarizeSession(ctx, sessionId, mode, signal) {
	const messages = await getSessionMessages(ctx, sessionId);
	const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
	const result = {};
	if (mode === "title" || mode === "both") try {
		const title = await requestSessionTitle(ctx, sessionId, messages, signal);
		if (title) result.title = title;
	} catch {
		const first = realUser[0]?.text.replace(/\s+/g, " ").trim() ?? sessionId;
		result.title = first.length > 20 ? `${first.slice(0, 20)}…` : first;
	}
	if (mode === "brief" || mode === "both") try {
		const brief = await requestSessionSummary(ctx, sessionId, messages, signal);
		if (brief) result.brief = brief;
	} catch {
		const first = realUser[0]?.text.replace(/\s+/g, " ").trim() ?? "";
		result.brief = first.length > 60 ? `${first.slice(0, 60)}…` : first;
	}
	return result;
}
/**
* 统计真实用户消息数；达到 4 次后生成简介。
* 优先用常驻整理员 agent 总结，失败时降级为第一条真实用户消息。
*/
async function summarizeSession(ctx, sessionId, signal) {
	const messages = await getSessionMessages(ctx, sessionId);
	const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
	if (realUser.length < 4) return {
		ready: false,
		count: realUser.length
	};
	try {
		const brief = await requestSessionSummary(ctx, sessionId, messages, signal);
		if (brief) return {
			ready: true,
			brief,
			count: realUser.length
		};
	} catch {}
	const first = realUser[0].text.replace(/\s+/g, " ").trim();
	return {
		ready: true,
		brief: first.length > 60 ? `${first.slice(0, 60)}…` : first,
		count: realUser.length
	};
}
//#endregion
//#region src/memory-summary.ts
function findMemoryMd(cwd) {
	const candidates = [
		path.join(cwd, "Claude_memory.md"),
		path.join(cwd, "CLAUDE.md"),
		path.join(cwd, "memory.md"),
		path.join(cwd, "记忆.md")
	];
	for (const file of candidates) try {
		if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
	} catch {}
	return null;
}
/** 读取项目记忆 md 的最后一个 `## ` 小节，作为“最后一次记忆”。 */
function readLastMemorySection(cwd) {
	const file = findMemoryMd(cwd);
	if (!file) return null;
	try {
		const parts = fs.readFileSync(file, "utf8").split(/\n(?=## )/);
		const last = parts[parts.length - 1]?.trim() ?? "";
		return last.length > 0 ? last.slice(0, 3e3) : null;
	} catch {
		return null;
	}
}
/** 批量读取每个会话项目里的最后一次记忆 md，并让“管家”生成新的标题和简介。 */
async function resummarizeAllFromMemory(ctx, sessions, signal) {
	const updates = [];
	for (const session of sessions) try {
		const cwd = await getSessionCwd(ctx, session.id);
		if (!cwd) {
			updates.push({
				sessionId: session.id,
				skipped: true
			});
			continue;
		}
		const memory = readLastMemorySection(cwd);
		if (!memory) {
			updates.push({
				sessionId: session.id,
				skipped: true
			});
			continue;
		}
		const meta = await requestMemoryMeta(ctx, memory, signal);
		updates.push({
			sessionId: session.id,
			title: meta.title,
			brief: meta.brief
		});
	} catch {
		updates.push({
			sessionId: session.id,
			skipped: true
		});
	}
	return updates;
}
//#endregion
//#region src/index.ts
const name = "myagent";
const inject = ["webServer", "fs"];
/** 根路径归一化：win32 大小写不敏感（toLowerCase）+ 去掉尾部 / 与 \。加入与判定都过同一 norm。 */
function norm(root) {
	let r = root.replace(/[\\/]+$/, "");
	if (process.platform === "win32") r = r.toLowerCase();
	return r;
}
/** 静态集合：config.allowedRoots（Array.isArray 守卫，非数组按 [] 处理）∪ 启动目录；apply 时重建。 */
let staticRoots = /* @__PURE__ */ new Set();
let lastProbe = 0;
let cached = /* @__PURE__ */ new Set();
let warnShown = false;
let activeCtx = null;
const PROBE_TTL = 5e3;
/** 动态解析 workspaceRegistry 的已注册工作沙盒根（只收 typeof w.path === "string" 的 path）。
*  全程 try/catch：异常返回空集合（仅静态集合生效），console.warn 限频（同一错误只 warn 一次）。 */
function liveWorkspaceRoots() {
	const now = Date.now();
	if (cached.size > 0 && now - lastProbe < PROBE_TTL) return cached;
	try {
		const ws = activeCtx?.get?.("workspaceRegistry");
		const next = /* @__PURE__ */ new Set();
		for (const w of ws?.list?.() ?? []) if (typeof w?.path === "string") next.add(norm(w.path));
		cached = next;
		lastProbe = now;
		warnShown = false;
	} catch (err) {
		if (!warnShown) {
			warnShown = true;
			console.warn("[dsh-myagent] workspaceRegistry unavailable; static roots only", err);
		}
		cached = /* @__PURE__ */ new Set();
	}
	return cached;
}
/** 白名单判定：静态集合或动态 workspace 根命中即放行（两侧元素都已过 norm）。 */
function allowed(root) {
	const n = norm(root);
	return staticRoots.has(n) || liveWorkspaceRoots().has(n);
}
function apply(ctx, config) {
	activeCtx = ctx;
	staticRoots = /* @__PURE__ */ new Set();
	if (Array.isArray(config.allowedRoots)) {
		for (const r of config.allowedRoots) if (typeof r === "string") staticRoots.add(norm(r));
	}
	staticRoots.add(norm(process.cwd()));
	const handlers = createHandlers(new FileService(ctx.fs, void 0, {
		pythonPath: typeof config.pythonPath === "string" ? config.pythonPath : void 0,
		rscriptPath: typeof config.rscriptPath === "string" ? config.rscriptPath : void 0,
		nodePath: typeof config.nodePath === "string" ? config.nodePath : void 0,
		timeoutMs: typeof config.timeoutMs === "number" ? config.timeoutMs : void 0
	}), config.trustedHosts ?? [], allowed);
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/tree",
		handler: handlers.tree
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/read",
		handler: handlers.read
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/write",
		handler: handlers.write
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/op",
		handler: handlers.op
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/run",
		handler: handlers.run
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/organize/plan",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
				return;
			}
			try {
				const snapshot = (await readBody(req))?.snapshot;
				if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("bad snapshot"), { code: "BAD_REQUEST" }));
					return;
				}
				try {
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), 15e3);
					try {
						const result = await requestOrganizerPlan(ctx, snapshot, controller.signal);
						sendJson(res, 200, {
							ok: true,
							data: {
								plan: result.plan,
								source: result.source
							}
						});
					} finally {
						clearTimeout(timer);
					}
				} catch (err) {
					sendJson(res, 200, {
						ok: true,
						data: {
							plan: localOrganizerPlan(snapshot),
							source: "local"
						}
					});
				}
			} catch (err) {
				sendError(res, err);
			}
		}
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/session/summary",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
				return;
			}
			try {
				const sessionId = (await readBody(req))?.sessionId;
				if (typeof sessionId !== "string" || !sessionId) {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("bad sessionId"), { code: "BAD_REQUEST" }));
					return;
				}
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 15e3);
				try {
					sendJson(res, 200, {
						ok: true,
						data: await summarizeSession(ctx, sessionId, controller.signal)
					});
				} finally {
					clearTimeout(timer);
				}
			} catch (err) {
				sendError(res, err);
			}
		}
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/session/resummarize",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
				return;
			}
			try {
				const body = await readBody(req);
				const sessionId = body?.sessionId;
				const mode = body?.mode;
				if (typeof sessionId !== "string" || !sessionId || mode !== "title" && mode !== "brief" && mode !== "both") {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("bad sessionId/mode"), { code: "BAD_REQUEST" }));
					return;
				}
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 2e4);
				try {
					sendJson(res, 200, {
						ok: true,
						data: await resummarizeSession(ctx, sessionId, mode, controller.signal)
					});
				} finally {
					clearTimeout(timer);
				}
			} catch (err) {
				sendError(res, err);
			}
		}
	}));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/api/myagent/organize/resummarize-all",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
				return;
			}
			try {
				const sessions = (await readBody(req))?.sessions;
				if (!Array.isArray(sessions) || sessions.some((s) => !s || typeof s.id !== "string")) {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("bad sessions"), { code: "BAD_REQUEST" }));
					return;
				}
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 6e4);
				try {
					sendJson(res, 200, {
						ok: true,
						data: { updates: await resummarizeAllFromMemory(ctx, sessions, controller.signal) }
					});
				} finally {
					clearTimeout(timer);
				}
			} catch (err) {
				sendError(res, err);
			}
		}
	}));
	ctx.effect(() => () => {
		disposeOrganizerAgent();
	});
	console.log("[dsh-myagent] host half loaded");
}
//#endregion
export { apply, inject, name };
