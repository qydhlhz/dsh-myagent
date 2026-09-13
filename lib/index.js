import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
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
//#region src/client/organizer.ts
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
//#endregion
//#region src/organizer-agent.ts
/**
* 管家会话的上下文预算。
*
* 【历史】原为 `40_000`：超预算就换一个新会话 id（轮换）。理由见下 —— 每次请求的提示词
* 都是**自包含**的（会话内容/快照全在提示词里），历史消息对结果毫无贡献却会被整段重发；
* 实测涨到 `inputTokens + cacheReadTokens ≈ 19.4 万` 时，单次耗时从 1.7s 涨到 4s+。
* 同一个 id 无法清空（会话已存在 → create 撞 SessionAlreadyExists → 只能 resume 回放全部历史），
* 所以轮换只能靠"换一个新会话 id"，旧会话文件留在 sessions 目录里（不在任何工作区
* 的 sessionIds 中，GUI 列表看不到）。
*
* 【2026 用户定案：改成 1M】管家要当"记得住上下文、能持续思考分区策略"的常驻角色，
* 40k 会让它每隔几次就失忆一次。代价是**明确知道并且接受**的：阈值抬到 1M 之后同一个
* 会话会长期累积、历史每次全量重发，请求会越来越慢越来越贵 —— 这是用成本换"管家有连续
* 记忆"的有意取舍，不是疏漏。
*/
const ORGANIZER_CONTEXT_BUDGET_TOKENS = 1e6;
function makeSlot(key, base, fixedReasoningEffort) {
	return {
		key,
		base,
		fixedReasoningEffort,
		handle: null,
		agent: null,
		ready: null,
		sessionId: base,
		contextTokens: 0,
		stats: {
			ready: false,
			provider: "",
			model: "",
			sessionId: base,
			requests: 0,
			contextTokens: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCacheReadTokens: 0,
			totalReasoningTokens: 0,
			lastRequestAt: null,
			rotations: 0,
			contextBudgetTokens: ORGANIZER_CONTEXT_BUDGET_TOKENS
		}
	};
}
/** 命名/简介用（不传推理档，要快）。 */
const butlerSlot = makeSlot("butler", "dsh-myagent-sandbox-organizer");
/** 分区建议专用（固定 `low`）。 */
const plannerSlot = makeSlot("planner", "dsh-myagent-sandbox-organizer-plan", "low");
/**
* 系统提示词 = **绑死的规则**（用户定案："把这个流程直接绑死设定好，而不是真的每次发送
* 自然语言说明给它"）。
*
* 为什么必须搬到这里：实测每次调用的提示词里「固定规则」占 60–76%（`plan` 2214 B /
* `meta` 775 B / `brief` 384 B），而批量跑 N 条会话时规则会被**重发 N 次**。搬进系统提示词后
* 只在建会话时发一次，之后每次命中 prompt cache（`cacheReadTokens` 计费远低于新增输入）——
* 单条命名从 613 B 降到 229 B（省 63%）。
*
* 调用方（`requestConversationBrief` / `requestTitleFromBrief` / `requestConversationMeta` /
* `requestOrganizerPlan`）因此只发**固定短命令 + 数据**，不再复述规则。
*/
const BUTLER_SYSTEM_PROMPT = "你是区管家里负责「三级命名」的角色：给一个对话写一句话简介，并给它起标题。你不读文件、不调用工具、不寒暄、不解释，只输出被要求的内容。\n输出形态由命令指定，严格只输出对应内容：\n· 「写简介」→ 只输出那一句话简介，不要 JSON、不要引号。\n· 「写标题」→ 只输出标题本身。\n· 「写简介和标题」→ 只输出 JSON：{\"brief\":\"...\",\"title\":\"...\"}，brief 必须写在 title 之前。\n固定规则（不可更改）：\n· 简介：一句话说明**这个对话在做什么工作**。动宾结构，说清对象与当前进展，25～40 字。\n  不要用引号、不要用“关于”开头、不要写项目名、不要写成项目层面的进展综述。\n· 标题：依据简介起。固定格式 **主题：进度**，中文全角“：”只出现一次。\n  例：meta分析：已检索完文献 / 插件适配：修槽位报错 / 论文写作：改讨论部分\n  主题 2～10 字，进度 2～12 字，总长不超过 20 字。不要照抄简介整句，不要写项目名。\n· 内容一律以用户给的对话内容为准。项目记忆、项目层面的历史都不是这个对话的事，不要拿它们当标题 —— 那样同一项目下所有对话会得到同一个名字。";
const PLANNER_SYSTEM_PROMPT = "你是区管家里负责「二级分组」的角色：按下面的固定规则输出一份整理建议 JSON。你不读文件、不调用工具、不解释，只输出 JSON。\n固定规则（不可更改）：\n- JSON 结构：{\"actions\":[...]}\n- action 的 kind 只能是：createGroup、renameGroup、deleteGroup、mergeGroup、moveSession、updateBrief。\n- 每个 action 必须包含 workspaceId，以及该类型所需的字段（groupId/name/sessionId/toGroupId/entity/newBrief 等）。\n- 分组第一优先按项目名，例如“MYAGENT”“dsh-file-manager”；不要把不同项目的同一用途/阶段混到同一组。\n- 只处理输入里出现的会话；不要为已归档、已删除或未出现在输入里的会话生成任何建议。\n- 项目分组内的会话标题写成“主题+阶段”（如“登录讨论”“配置执行”），简介一句话说明该对话具体在做什么。\n- 对会话的 updateBrief：entity 为 \"session\"，entityName 填整理后的中文标题，newBrief 填一句话中文简介；不要用“关于”开头，长度控制在 40 字以内。\n- 如果会话/分组标题是旧版占位（如“关于…”“你是谁”“未命名会话”）或过于宽泛，应同时通过 updateBrief 修正标题和简介。\n- 建议要保守：只建议明确合理的改动，不要臆造不存在的实体。\n- 如果默认分组中有多个会话，应新建有意义的命名分组并移入对应会话。\n- 分组要尽量细分，不要只根据一个宽泛关键词（如“插件”“dsh”“项目”）把所有会话归为一组。\n- 在一个项目分组内，用会话标题/简介区分目的和阶段（如“登录讨论”“配置执行”），但不要把这些不同阶段建成跨项目的分组。\n- 不要按“配置/开发/讨论”等环节把不同项目合并到同一组；同一项目下的不同环节用会话标题体现。\n- 分组名使用中文；除非是 GitHub、MCP、API 等专有名词，否则不要用英文单词作分组名。\n- 如果当前只有默认分组，优先考虑新建 2-5 个具体、细分的命名分组，让整理后不再只有默认分组。\n你的上下文**跨调用保留**：首次会收到完整快照，之后只会收到「当前索引（真值）」+ 自上次以来的变化。\n· 请把变化合并进你已经掌握的状态，**不要要求重发未变化的内容**。\n· 索引是当前真值：发现它与你记忆不一致时，以索引为准并自行校正。\n· 与上次的判断**保持一致** —— 除非变化本身要求调整，否则不要反复改动同一批分组。";
/** 取一个槽位绑定的系统提示词。 */
function systemPromptFor(slot) {
	return slot.key === "planner" ? PLANNER_SYSTEM_PROMPT : BUTLER_SYSTEM_PROMPT;
}
/**
* 紧凑索引：分组一行、会话一行，只含**核对与产出 action 所必需**的字段
* （实体的完整 id + 现名 + 归属）。每次调用都发它，作为"当前真值"供模型对照记忆。
*
* 为什么 id 不能截短：模型要靠它产出 `moveSession` / `renameGroup` 等的 groupId / sessionId，
* 截短后对不上真实实体。所以这里用完整 id —— 索引因此比"纯展示用"的版本大一些，
* 但仍远小于全量快照（实测 50 会话：索引约 3.9 KB vs 全量 15.3 KB）。
*/
function snapshotIndex(snapshot) {
	const ownerName = (ws, sessionId) => {
		const g = ws.groups.find((x) => x.sessionIds.includes(sessionId));
		return g === void 0 ? "（未分组）" : `「${g.name}」`;
	};
	const lines = [];
	for (const ws of snapshot.workspaces) {
		lines.push(`工作区 ${ws.id}「${ws.title}」默认分组「${ws.defaultGroupName}」`);
		for (const g of ws.groups) lines.push(`  组 ${g.id}「${g.name}」`);
		for (const s of ws.sessions) lines.push(`  会话 ${s.id}「${s.title}」→ ${ownerName(ws, s.id)}`);
	}
	return lines.join("\n");
}
/**
* 算出「自上次成功发送以来有什么变化」。返回 null = 没有任何变化。
* 未列出的实体一律视为"与模型记忆中一致"，模型不需要、也不应该改动它们。
*/
function snapshotDelta(prev, next) {
	const out = [];
	const prevWs = new Map(prev.workspaces.map((w) => [w.id, w]));
	const ownerName = (ws, sessionId) => ws.groups.find((g) => g.sessionIds.includes(sessionId))?.name ?? "（未分组）";
	for (const ws of next.workspaces) {
		const p = prevWs.get(ws.id);
		if (p === void 0) {
			out.push(`+ 新增工作区 ${ws.id}「${ws.title}」`);
			continue;
		}
		if (p.title !== ws.title) out.push(`~ 工作区改名 ${ws.id}：「${p.title}」→「${ws.title}」`);
		if (p.brief !== ws.brief) out.push(`~ 工作区简介 ${ws.id}：「${ws.brief}」`);
		const pg = new Map(p.groups.map((g) => [g.id, g]));
		const ng = new Set(ws.groups.map((g) => g.id));
		for (const g of ws.groups) {
			const old = pg.get(g.id);
			if (old === void 0) out.push(`+ 新增分组 ${g.id}「${g.name}」`);
			else if (old.name !== g.name) out.push(`~ 分组改名 ${g.id}：「${old.name}」→「${g.name}」`);
			else if (old.brief !== g.brief) out.push(`~ 分组简介 ${g.id}：「${g.brief}」`);
		}
		for (const g of p.groups) if (!ng.has(g.id)) out.push(`- 已删除分组 ${g.id}「${g.name}」`);
		const ps = new Map(p.sessions.map((s) => [s.id, s]));
		const ns = new Set(ws.sessions.map((s) => s.id));
		for (const s of ws.sessions) {
			const old = ps.get(s.id);
			if (old === void 0) {
				out.push(`+ 新增会话 ${s.id}「${s.title}」简介「${s.brief}」→ ${ownerName(ws, s.id)}`);
				continue;
			}
			if (old.title !== s.title || old.brief !== s.brief) out.push(`~ 会话 ${s.id} 标题「${s.title}」简介「${s.brief}」`);
			const from = ownerName(p, s.id);
			const to = ownerName(ws, s.id);
			if (from !== to) out.push(`~ 会话 ${s.id} 归属：「${from}」→「${to}」`);
		}
		for (const s of p.sessions) if (!ns.has(s.id)) out.push(`- 已删除会话 ${s.id}「${s.title}」`);
	}
	for (const w of prev.workspaces) if (!next.workspaces.some((n) => n.id === w.id)) out.push(`- 已删除工作区 ${w.id}「${w.title}」`);
	return out.length > 0 ? out.join("\n") : null;
}
/**
* 读一份统计快照（浅拷贝，调用方可以安全序列化）。
* 主体是命名用的 butler 槽位（面板的「管家信息」沿用原语义），另附 planner 摘要。
*/
function organizerInfo() {
	const p = plannerSlot;
	return {
		...butlerSlot.stats,
		sessionId: butlerSlot.sessionId,
		planner: {
			ready: p.stats.ready,
			reasoningEffort: p.reasoningEffort ?? null,
			sessionId: p.sessionId,
			requests: p.stats.requests,
			contextTokens: p.stats.contextTokens,
			totalReasoningTokens: p.stats.totalReasoningTokens,
			contextBudgetTokens: ORGANIZER_CONTEXT_BUDGET_TOKENS
		}
	};
}
/**
* 让管家 agent 就绪（区管家面板打开时也调一次）。
*
* 面板需要"我是什么模型"这类常规信息：不预热的话，用户没点过任何命令时面板只能显示
* "尚未启动"，看起来就是"消耗显示不好使"。预热**不发模型请求**，只建会话 + 解析 provider/model。
*/
async function prepareOrganizer(ctx) {
	try {
		await ensureSlot(ctx, butlerSlot);
	} catch (err) {
		console.warn("[dsh-myagent] organizer agent not ready", err);
	}
	return organizerInfo();
}
/**
* 从**当前管家会话日志**里汇总真实用量。
*
* 为什么要读日志而不是只用内存计数：内存计数随 dsh 重启清零，用户重启一次 GUI 就看到
* "累计 0 token"，自然觉得"消耗显示不好使"。管家会话是持久化的，日志里的
* `assistant/message.usage` 才是可跨重启的真相。读一次 ~350KB 的多帧 zstd，
* 只在打开面板 / 每次命令后调用，开销可接受。
*/
async function readOrganizerUsage(ctx) {
	try {
		const persistence = ctx?.sessionPersistence;
		if (!persistence?.open) return null;
		const handle = await persistence.open(butlerSlot.sessionId, "read");
		try {
			const { events } = await handle.read();
			let requests = 0;
			let inputTokens = 0;
			let outputTokens = 0;
			let cacheReadTokens = 0;
			let reasoningTokens = 0;
			let contextTokens = 0;
			for (const e of events) {
				if (e?.type !== "assistant/message") continue;
				const u = e?.data?.usage;
				if (!u) continue;
				requests += 1;
				inputTokens += Number(u.inputTokens ?? 0);
				outputTokens += Number(u.outputTokens ?? 0);
				cacheReadTokens += Number(u.cacheReadTokens ?? 0);
				reasoningTokens += Number(u.reasoningTokens ?? 0);
				contextTokens = Number(u.inputTokens ?? 0) + Number(u.cacheReadTokens ?? 0);
			}
			let sessionBytes = null;
			try {
				const snapshot = await persistence.stat(butlerSlot.sessionId);
				sessionBytes = typeof snapshot?.sizeBytes === "number" ? snapshot.sizeBytes : null;
			} catch {}
			return {
				requests,
				contextTokens,
				inputTokens,
				outputTokens,
				cacheReadTokens,
				reasoningTokens,
				sessionBytes
			};
		} finally {
			await handle.close?.();
		}
	} catch (err) {
		if (!/not found/i.test(String(err?.message ?? err))) console.warn("[dsh-myagent] cannot read organizer usage", err);
		return null;
	}
}
/**
* 累计用量并判断是否该轮换会话。
* `usage.totalTokens` 在 dsh 里 = input + cacheRead + output，即**这次请求处理的上下文**，
* 直接当"上下文已用"最直观。
*/
function noteUsage(slot, usage) {
	if (!usage || typeof usage !== "object") return;
	const input = Number(usage.inputTokens ?? 0);
	const output = Number(usage.outputTokens ?? 0);
	const cacheRead = Number(usage.cacheReadTokens ?? 0);
	const reasoning = Number(usage.reasoningTokens ?? 0);
	slot.stats.requests += 1;
	slot.stats.totalInputTokens += input;
	slot.stats.totalOutputTokens += output;
	slot.stats.totalCacheReadTokens += cacheRead;
	slot.stats.totalReasoningTokens += reasoning;
	slot.stats.contextTokens = input + cacheRead;
	slot.stats.lastRequestAt = (/* @__PURE__ */ new Date()).toISOString();
	slot.contextTokens = slot.stats.contextTokens;
}
/** 上下文超预算 → 换一个新会话 id（下一次 ensure 会 create 出干净上下文）。 */
async function rotateIfNeeded(slot) {
	if (slot.contextTokens < ORGANIZER_CONTEXT_BUDGET_TOKENS) return;
	const previous = slot.sessionId;
	await disposeSlot(slot);
	slot.sessionId = `${slot.base}-${Date.now().toString(36)}`;
	slot.contextTokens = 0;
	slot.lastPlanSnapshot = void 0;
	slot.stats.contextTokens = 0;
	slot.stats.rotations += 1;
	console.log(`[dsh-myagent] organizer context rotated (${slot.key}): ${previous} → ${slot.sessionId}`);
}
let resolveDefaultModel = null;
/** 由 apply() 注入默认模型解析器（agentDefaultModel 服务就绪时调用）。 */
function setDefaultModelResolver(fn) {
	resolveDefaultModel = fn;
}
/** 取当前默认模型选择；服务缺失/异常一律返回 null（调用方据此提前失败）。 */
function currentDefaultModel(ctx) {
	try {
		const direct = ctx?.get?.("agentDefaultModel");
		if (direct?.currentSelection) return direct.currentSelection();
	} catch {}
	try {
		return resolveDefaultModel?.() ?? null;
	} catch {
		return null;
	}
}
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
async function ensureSlot(ctx, slot, signal) {
	if (slot.agent) return;
	if (slot.ready) return slot.ready;
	slot.ready = (async () => {
		const agents = ctx?.get?.("agents") ?? ctx?.agents;
		if (!agents?.create) throw new Error("agents service unavailable");
		const selection = currentDefaultModel(ctx);
		const provider = selection?.provider ?? "";
		const model = selection?.model ?? "";
		if (!provider || !model) throw new Error(`default model unavailable (provider=${provider || "?"} model=${model || "?"}); agentDefaultModel service not resolved — see settings key "agent-default-model"`);
		const reasoningEffort = selection?.reasoningEffort !== void 0 ? slot.fixedReasoningEffort : void 0;
		slot.reasoningEffort = reasoningEffort;
		const setup = (agentCtx) => {
			try {
				agentCtx?.tools?.restrict?.({ allow: [] });
			} catch {}
			try {
				agentCtx?.systemPrompt?.section?.({
					name: `dsh-myagent-organizer-${slot.key}`,
					order: -1e3,
					complete: true,
					text: systemPromptFor(slot)
				});
			} catch {}
			try {
				agentCtx?.systemPrompt?.suppressRuntimeContext?.();
			} catch {}
		};
		try {
			const handle = await openSlotAgent(agents, slot, {
				provider,
				model,
				reasoningEffort,
				setup,
				signal
			});
			slot.handle = handle;
			slot.agent = handle?.agent;
			slot.lastPlanSnapshot = void 0;
		} catch (err) {
			slot.handle = null;
			slot.agent = null;
			throw err;
		}
		slot.stats.ready = true;
		slot.stats.provider = provider;
		slot.stats.model = model;
		slot.stats.sessionId = slot.sessionId;
		console.log(`[dsh-myagent] organizer agent ready (${slot.key}: ${provider}/${model}${reasoningEffort === void 0 ? "" : ` reasoning=${reasoningEffort}`}) session=${slot.sessionId}`);
	})().finally(() => {
		slot.ready = null;
	});
	return slot.ready;
}
/**
* 打开常驻管家会话，**保证拿到一个能用的 agent**。
*
* 三级退让（2026-09-12 实测踩到第 3 级）：
*  1. `create(主 id)`；
*  2. 会话已存在（热重载/重复启动）→ `resume(主 id)`；
*  3. **主 id 被别的 dsh 实例占着**（同一个 DSH_HOME 被两个 `dsh web` 打开时必然发生，
*     实测报 `SessionAlreadyOwnedError: session "…" is already owned by an active write handle`）
*     → 换一个**本次进程专属**的新会话 id 重建。
* 没有第 3 级时，第二个实例的管家永远起不来，所有总结会静默退化成本地提取
* （表面"功能正常"，实际标题全是"主题：进行中"）。
*/
async function openSlotAgent(agents, slot, options) {
	const { provider, model, reasoningEffort, setup, signal } = options;
	const agentOptions = reasoningEffort === void 0 ? {
		provider,
		model
	} : {
		provider,
		model,
		reasoningEffort
	};
	const attempts = [
		{
			id: slot.sessionId,
			via: "create"
		},
		{
			id: slot.sessionId,
			via: "resume"
		},
		{
			id: `${slot.base}-${process.pid.toString(36)}`,
			via: "create"
		}
	];
	let lastError = null;
	for (const attempt of attempts) try {
		if (attempt.via === "create") {
			const handle = await agents.create({
				sessionId: attempt.id,
				meta: { cwd: process.cwd() },
				agentOptions,
				setup,
				signal
			});
			if (attempt.id !== slot.sessionId) {
				console.log(`[dsh-myagent] organizer session "${slot.sessionId}" is taken; using "${attempt.id}"`);
				slot.sessionId = attempt.id;
				slot.stats.sessionId = attempt.id;
			}
			return handle;
		}
		if (!agents.resume) throw new Error("agents.resume unavailable");
		return await agents.resume({
			resumeSessionId: attempt.id,
			agentOptions,
			setup,
			signal
		});
	} catch (err) {
		lastError = err;
	}
	throw lastError ?? /* @__PURE__ */ new Error("cannot open organizer agent");
}
/** 释放一个槽位的常驻 agent。 */
async function disposeSlot(slot) {
	const handle = slot.handle;
	slot.handle = null;
	slot.agent = null;
	await handle?.dispose?.();
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
/**
* 向**分区建议专用槽位**（planner，开推理）发送一次整理请求，返回规范化后的建议 JSON。
*
* 【为什么不再有本地兜底】用户定案："分区策略也得是模型思考后的" —— 旧的 `localOrganizerPlan`
* 是一套确定性规则（补简介 / 合并重名分组 / 删空分组 / 按名称归类），**没有语义分区能力**，
* 一旦触发，返回的"整理建议"就不是模型想的了。现在模型拿不出计划就**如实报错**，
* 绝不用本地规则冒充。
*/
async function requestOrganizerPlan(ctx, snapshot, signal) {
	const timeoutMs = 15e4;
	await ensureSlot(ctx, plannerSlot, signal);
	const prev = plannerSlot.lastPlanSnapshot;
	const detail = prev === void 0 ? null : snapshotDelta(prev, snapshot);
	const prompt = prev === void 0 ? `整理全部。工作区快照（首次，完整）：

${JSON.stringify(snapshot, null, 2)}` : detail === null ? `核对。工作区当前索引（真值）：
${snapshotIndex(snapshot)}

自上次以来**没有任何变化**。若你上次的判断仍然成立，只输出 {"actions":[]}。` : `核对并整理。工作区当前索引（真值）：
${snapshotIndex(snapshot)}

自上次以来有这些变化（**未列出的实体与你记忆中一致，不要改动它们**）：
${detail}`;
	let text;
	try {
		text = await askSlot(ctx, plannerSlot, `org-${Date.now()}`, prompt, timeoutMs, signal);
	} catch (err) {
		plannerSlot.lastPlanSnapshot = void 0;
		throw err;
	}
	const parsed = extractJson(text);
	const plan = normalizeOrganizePlan(parsed);
	if (plan.actions.length === 0 && !Array.isArray(parsed?.actions)) {
		plannerSlot.lastPlanSnapshot = void 0;
		throw new Error("organizer agent returned invalid plan");
	}
	plannerSlot.lastPlanSnapshot = snapshot;
	return {
		plan,
		source: "agent"
	};
}
/**
* 从会话日志尾部找最近一条**模型层**错误。
*
* 为什么需要：模型调用失败时（没 API key、超时、限流…）agent 循环会把原因写进
* `turn/end.data.reason.error`，但 `followup()` **不抛异常**、`deriveMessages()` 也拿不到它，
* 于是 askSlot 只能报"没有产出"。而按用户定案本地不再兜底，"为什么没有建议"就是用户
* 唯一能拿到的信息 —— 必须把真实原因带出来，否则只剩一句无从下手的诊断。
*/
async function lastSessionError(ctx, sessionId) {
	try {
		const persistence = ctx?.sessionPersistence;
		if (!persistence?.open) return null;
		const handle = await persistence.open(sessionId, "read");
		try {
			const { events } = await handle.read();
			for (let i = events.length - 1; i >= 0; i--) {
				const e = events[i];
				if (e?.type !== "turn/end") continue;
				const err = e?.data?.reason?.error;
				if (err?.message) return String(err.message);
			}
			return null;
		} finally {
			await handle.close?.();
		}
	} catch {
		return null;
	}
}
/**
* 向指定槽位投喂一段提示词并取回助手正文（含用量统计与上下文轮换）。
*
* 三个 request* 原本各自复制了一遍 followup / whenIdle / deriveMessages / 取正文，
* 现在收敛成这一处：before 快照 → followup → 等 idle → 取新增消息里最后一条助手正文
* → 记用量 → 超预算则轮换会话。
* 失败信息带上诊断（新增消息条数/角色/status/before），因为"模型没答"和"回答为空"
* 以前长得一模一样，极难排查。
*/
async function askSlot(ctx, slot, kind, prompt, timeoutMs, signal) {
	await ensureSlot(ctx, slot, signal);
	const organizerAgent = slot.agent;
	if (!organizerAgent) throw new Error("organizer agent not ready");
	const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
	organizerAgent.followup({
		id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
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
	if (idlePromise) await withTimeout(Promise.resolve(idlePromise), timeoutMs, signal);
	const fresh = (organizerAgent.session?.deriveMessages?.() ?? []).slice(before);
	const text = lastAssistantText(fresh);
	if (!text) {
		const a = organizerAgent;
		const modelError = await lastSessionError(ctx, slot.sessionId);
		throw new Error(`organizer agent returned no ${kind}` + (modelError ? `: ${modelError}` : "") + ` (新增消息 ${fresh.length} 条: ${fresh.map((m) => m?.role).join(",") || "无"}; status=${a?.status ?? "?"}; before=${before})`);
	}
	noteUsage(slot, [...fresh].reverse().find((m) => m?.role === "assistant")?.usage);
	await rotateIfNeeded(slot);
	return text.replace(/\s+/g, " ").trim();
}
/**
* 对话内容的公共上下文段（brief 与 title 两次请求共用，保证口径一致）。
*
* 【为什么**不**再把项目记忆 md 塞进提示词】实测踩过：会话本身几乎没有内容时
* （比如只有一句"1"），模型会直接抓项目记忆的最后一个 `##` 小节当标题 ——
* 于是这条会话被命名成「总结修复：定位缺少模型配置」（那是**项目**最近做的事，
* 不是**这个对话**做的事）。项目记忆按项目存，天然区分不了对话，只能当噪音。
*/
function conversationContext(input) {
	return `项目：${input.projectName}

对话内容（首尾采样，中间可能省略）：
${input.transcript}`;
}
/**
* 第一步：概括**这个对话在做什么工作**（一句话简介）。
*
* 【为什么以"会话自身内容"为主料】
* 简介/标题的用途是"简短的说明这个对话在做什么工作"。项目记忆 md 是**按项目**存的，
* 同一项目下所有会话读到的都是同一个小节 —— 实测按钮曾返回
* `总结的数据源改为"最后一次记忆"（两个按` 这种"记忆小节标题被硬截断"的结果，
* 而且同一项目的每个会话都会得到同一句话。所以记忆只能当**背景**。
*/
async function requestConversationBrief(ctx, input, signal) {
	const prompt = `写简介：

${conversationContext(input)}`;
	const brief = (await askSlot(ctx, butlerSlot, "brief", prompt, 15e3, signal)).split(/\n/)[0].replace(/^["“]|["”]$/g, "").trim();
	if (!brief) throw new Error("organizer agent returned empty brief");
	return brief.slice(0, 80);
}
/**
* 第二步：**依据简介**产出标题，固定格式 `主题：进度`（例：`meta分析：已检索完文献`）。
*
* 用户要求「先总结简介，再更新标题」，所以标题是**在简介之后**单独请求的：
* 冒号前 = 稳定的工作主题（同一件事的多轮对话应保持不变），冒号后 = 当前进度。
*/
async function requestTitleFromBrief(ctx, brief, signal) {
	const prompt = `写标题：

简介：${brief}`;
	const title = (await askSlot(ctx, butlerSlot, "title", prompt, 12e3, signal)).split(/\n/)[0].replace(/^["“]|["”]$/g, "").trim();
	if (!title) throw new Error("organizer agent returned empty title");
	return title.slice(0, 40);
}
/**
* 一步到位版（批量整理用）：一次请求同时给出简介与标题，**字段顺序就是产出顺序**
* （模型先写 brief 再写 title，等于在简介之后才定标题）。
* 单会话的两个按钮走两步版（brief → title），批量为了控制耗时走这一步版。
*/
async function requestConversationMeta(ctx, input, signal) {
	const prompt = `写简介和标题：

${conversationContext(input)}`;
	const parsed = extractJson(await askSlot(ctx, butlerSlot, "meta", prompt, 15e3, signal));
	if (!parsed || typeof parsed !== "object") throw new Error("organizer agent returned invalid meta");
	const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
	const brief = typeof parsed.brief === "string" ? parsed.brief.trim() : "";
	if (!title && !brief) throw new Error("organizer agent returned empty meta");
	return {
		title,
		brief
	};
}
/**
* 插件卸载时释放两个槽位的常驻 agent。
*
* 旧的 `localOrganizerPlan`（本地确定性整理器）已按用户定案**删除**：
* 分区策略必须由模型产出，本地规则不得再冒充。`client/organizer.ts` 里的
* `buildOrganizePlan` 保留（仍被 test/organizer.test.ts 覆盖），但已不在任何生产路径上。
*/
async function disposeOrganizerAgent() {
	await Promise.all([disposeSlot(butlerSlot), disposeSlot(plannerSlot)]);
}
//#endregion
//#region src/session-summary.ts
function textFromContent(content) {
	if (!Array.isArray(content)) return "";
	return content.filter((b) => b?.type === "text").map((b) => b?.text ?? "").join(" ").trim();
}
/**
* 只作为"锚定/寒暄"存在、不含任何需求的用户发言。
*
* 典型来源是 preset 的 anchor 轮（本机 `anchor-turn` 就是 `你是谁`）。这些文本
* 出现在会话第一条，若被当成"真实用户需求"，标题就永远是"你是谁" ——
* 这正是用户报的"两个按钮给出同一段没信息量的文本"的根因之一。
* 判定前先去掉空白与标点，避免"你是谁？"漏网。
*/
const ANCHOR_ONLY = /^(你是谁|你叫什么|你是什么模型|你是什么ai|你好|您好|哈喽|在吗|hi|hello|hey|测试|测试一下|test|继续|continue|goon|ok|okay|好的|好|行|嗯|谢谢|thanks)$/i;
function isRealUserText(text) {
	const trimmed = text.trim();
	if (trimmed === "") return false;
	if (/Workspace instruction files exist|AGENTS\.md|<system-reminder>|Current runtime context|The approval policy changed/.test(trimmed)) return false;
	return !ANCHOR_ONLY.test(trimmed.replace(/[\s，。！？、~,.!?;；:：]+/g, ""));
}
/**
* 清洗一行文本供标题/简介使用：去代码块/行内代码/Markdown 链接/URL/HTML 标签，
* 压空白，再按 max 截断。
*
* 截断必须"不切在半个括号里"：实测过一次难看的输出
* `总结的数据源改为"最后一次记忆"（两个按` —— 20 字硬切把 `（两个按钮…）` 切成了半截。
* 所以截断后把尾部**未闭合**的括号/引号连同其后内容一起去掉，再补 `…`。
*/
function cleanLine(text, max) {
	let t = String(text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	if (t.length > max) {
		t = t.slice(0, max);
		t = t.replace(/[（(\[【《“"‘'][^（）()\[\]【】《》“”‘’"]*$/, "").trim();
		t = t.replace(/[，。、；：,.;:!?！？…\-—\s]+$/, "").trim();
		if (t.length > 0) t += "…";
	}
	return t;
}
/** 标题优先取"首个短句"，例如 `帮我修一下 X（顺便加个按钮）` → `帮我修一下 X`。 */
function titleLine(text, max) {
	const cleaned = cleanLine(text, Math.max(max * 3, 60));
	const head = cleaned.split(/[。！？!?；;\n]|，然后|，另外/)[0]?.trim() ?? "";
	return cleanLine(head.length >= 6 ? head : cleaned, max);
}
/** 从若干条消息里挑出"首尾采样"文本：≤14 条全取，否则 首3 + 尾9。 */
function sampleMessages(messages) {
	const substantive = messages.filter((m) => m.role === "user" ? isRealUserText(m.text) : m.text.trim() !== "");
	if (substantive.length <= 14) return substantive;
	return [
		...substantive.slice(0, 3),
		{
			role: "note",
			text: "……（中间省略）……"
		},
		...substantive.slice(-9)
	];
}
/** 组装一次摘要所需的全部原料。 */
async function collectDigest(ctx, sessionId) {
	const messages = await getSessionMessages(ctx, sessionId);
	const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
	const cwd = await getSessionCwd(ctx, sessionId);
	return {
		projectName: cwd ? path.basename(cwd) || cwd : "（未知项目）",
		transcript: sampleMessages(messages).map((m) => {
			const label = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "";
			const text = m.role === "user" ? cleanLine(m.text, 700) : cleanLine(m.text, 300);
			return label ? `${label}：${text}` : text;
		}).join("\n").slice(-6500),
		firstUser: realUser[0]?.text ?? "",
		lastUser: realUser[realUser.length - 1]?.text ?? "",
		hasUserText: realUser.length > 0
	};
}
/** 标题固定格式：`主题：进度`（中文全角冒号，只一个，两侧都非空且不过长）。 */
const TITLE_PATTERN = /^(.{2,14})：(.{2,16})$/;
/**
* 截断主题但**不制造半截话**：保留 `…`，并把尾部悬挂的助词（的/和/还/也…）一起去掉。
*
* 反例（实测）：本地兜底把 `区管家的更新和消耗显示还是不太好使` 硬切 12 字、
* 又剥掉省略号 → 标题成了 `区管家的更新和消耗显示还：进行中`，读起来就是断的。
*/
function clipTopic(raw, max) {
	const clipped = cleanLine(raw, max);
	if (!clipped.endsWith("…")) return clipped;
	const trimmed = clipped.replace(/[的了和与或是在为对把被还也再又]+…$/, "…");
	return trimmed === "…" ? clipped : trimmed;
}
/** 只保留冒号前后的合理长度，并统一成全角冒号（模型偶尔会写半角 `:`）。 */
function normalizeTitle(raw) {
	const t = String(raw ?? "").replace(/\s+/g, "").replace(/^["“「]|["”」]$/g, "").replace(/[:﹕]/g, "：").trim();
	const m = t.match(/^(.+?)：(.+)$/);
	if (!m) return clipTopic(t, 18);
	return `${clipTopic(m[1], 12)}：${cleanLine(m[2], 14)}`;
}
/**
* 不依赖模型的兜底：直接用会话自己的首末发言描述"这个对话在做什么"。
*
*  - brief = 首末不同则 `从「目标」到「当前」`（≤56 字），否则就是最后这一条；
*  - title = `主题：进度` 形状 —— 主题取最后一条实质发言的首个短句（≤12 字），
*    进度在无模型时没有可靠信息，统一写「进行中」（**不编造**）。
* 宁可粗糙，也要**每个会话各不相同**；不再退回"你是谁"或项目记忆小节标题。
*/
function localMetaFromConversation(digest) {
	const first = cleanLine(digest.firstUser, 26);
	const last = cleanLine(digest.lastUser, 26);
	let brief;
	if (first && last && first !== last) brief = `从「${first}」到「${last}」`;
	else brief = cleanLine(digest.lastUser || digest.firstUser, 56);
	return {
		title: normalizeTitle(`${clipTopic(titleLine(digest.lastUser || digest.firstUser, 12), 12) || "对话"}：进行中`),
		brief
	};
}
/** 把不带格式的标题（如本地兜底或模型跑偏）修成 `主题：进度`。 */
function coerceTitle(title, brief) {
	const normalized = normalizeTitle(title);
	if (TITLE_PATTERN.test(normalized)) return normalized;
	return normalizeTitle(`${clipTopic(normalized || titleLine(brief, 12), 12) || "对话"}：进行中`);
}
/**
* 从 live session 或持久化日志中读取会话消息。
*
* 两条路：
*  1) 宿主内存里的 live session（`ctx.sessions.get(id)`）——GUI 正在用的那份，最快；
*  2) 持久化日志——走 `ctx.sessionPersistence.open(id, "read")` → `handle.read()`。
*     ⚠️ 旧代码用的是 `persistence.inspect(id)`，**这个方法在 dsh 0.1.5 里根本不存在**
*     （SessionPersistence 的 API 是 create/open/stat/list + SessionHandle），
*     于是 `if (persistence?.inspect)` 静默跳过、永远读到空消息 ——
*     "重新总结"因此一直回落到"第一条用户消息或会话 id"这种占位值。
*
* 服务访问与读日志都包 try/catch：cordis 的 ctx 是 Proxy，未在 inject 声明的服务属性访问
* 会直接抛 `cannot get property "X" without inject`（宿主 inject 已声明，这里再兜一层，
* 保证按钮不会因为服务解析问题变成 500 报错）。
*/
async function getSessionMessages(ctx, sessionId) {
	try {
		const live = ctx?.sessions?.get?.(sessionId);
		if (live?.deriveMessages) return live.deriveMessages().map((m) => ({
			role: m.role,
			text: textFromContent(m.content)
		}));
		const persistence = ctx?.sessionPersistence;
		if (persistence?.open) {
			const handle = await persistence.open(sessionId, "read");
			try {
				const { events } = await handle.read();
				return events.filter((e) => e.type === "user/message" || e.type === "assistant/message").map((e) => ({
					role: e.data?.role ?? (e.type === "user/message" ? "user" : "assistant"),
					text: textFromContent(e.data?.content)
				}));
			} finally {
				await handle.close?.();
			}
		}
	} catch (err) {
		console.warn("[dsh-myagent] cannot read session messages", err);
	}
	return [];
}
/**
* 从 live session 或持久化日志中读取会话的工作目录（用于定位项目记忆 md）。
* 持久化路径直接用 `handle.header.cwd`（比翻 `session` 事件更直接）。
*/
async function getSessionCwd(ctx, sessionId) {
	try {
		const live = ctx?.sessions?.get?.(sessionId);
		if (live?.session?.cwd && typeof live.session.cwd === "string") return live.session.cwd;
		const persistence = ctx?.sessionPersistence;
		if (persistence?.open) {
			const handle = await persistence.open(sessionId, "read");
			try {
				if (typeof handle.header?.cwd === "string" && handle.header.cwd !== "") return handle.header.cwd;
				const { events } = await handle.read();
				const sessionEvent = events.find((e) => e.type === "session");
				if (sessionEvent?.data?.cwd && typeof sessionEvent.data.cwd === "string") return sessionEvent.data.cwd;
			} finally {
				await handle.close?.();
			}
		}
	} catch (err) {
		console.warn("[dsh-myagent] cannot read session cwd", err);
	}
	return null;
}
/**
* 概括"这个对话在做什么工作"，返回 `{title: "主题：进度", brief}`。
*
* 这是「重新总结命名」「重新总结简介」「一键更新全部对话」三个入口的**唯一**实现：
*  - 主料 = 会话自身内容（首尾采样）→ 模型概括（两种策略见 `strategy`）；
*  - 模型不可用/超时/答非所问 → `localMetaFromConversation` 兜底（标题仍是 `主题：进度`）；
*  - 会话里没有任何实质用户发言（空会话）→ 报错让调用方跳过。
*
* 无论走哪条路，标题都会被 `coerceTitle` 校正成 `主题：进度` 形状。
*/
async function summarizeSessionMeta(ctx, sessionId, options = {}) {
	const { useModel = true, signal, strategy = "one-step", want = "both" } = options;
	const digest = await collectDigest(ctx, sessionId);
	const local = digest.hasUserText ? localMetaFromConversation(digest) : null;
	if (useModel && digest.hasUserText) {
		const input = {
			projectName: digest.projectName,
			transcript: digest.transcript
		};
		try {
			let meta;
			if (strategy === "two-step") {
				const brief = await requestConversationBrief(ctx, input, signal);
				let title = "";
				if (want !== "brief") try {
					title = await requestTitleFromBrief(ctx, brief, signal);
				} catch (err) {
					console.warn("[dsh-myagent] title step failed; keeping the brief, falling back on title", err);
				}
				meta = {
					brief,
					title
				};
			} else meta = await requestConversationMeta(ctx, input, signal);
			const brief = meta.brief || local?.brief || "";
			const title = coerceTitle(meta.title || local?.title || "", brief);
			if (title || brief) return {
				title,
				brief,
				source: "agent"
			};
			console.warn("[dsh-myagent] conversation summarizer returned nothing; using local meta");
		} catch (err) {
			console.warn("[dsh-myagent] conversation summarizer failed; using local meta", err);
		}
	}
	if (local) return {
		...local,
		source: "local"
	};
	throw new Error(`session ${sessionId} has no summarizable content (没有实质用户发言 / 读不到消息)`);
}
/**
* 重新总结单个会话的标题和/或简介（「重新总结命名」/「重新总结简介」两个按钮）。
*
* 走**两步版**（用户定案）：先单独请求简介，再带着那句已落定的简介请求标题 ——
* `主题：进度` 的"进度"只能从简介里得到，先让简介定下来标题质量更稳，代价是多一次请求。
* 只点「重新总结简介」时 `want="brief"`，会省掉标题那一次请求（不白花一次调用）。
*
* ⚠️ 时间预算不变量：两步是**串行**的，两次请求各自的超时是 15s（简介）+ 12s（标题）= 27s，
* 必须留在 `/api/myagent/session/resummarize` 路由的 30s 之内。改任一处超时都要一起核对。
*/
async function resummarizeSession(ctx, sessionId, mode, signal) {
	const meta = await summarizeSessionMeta(ctx, sessionId, {
		useModel: true,
		signal,
		strategy: "two-step",
		want: mode
	});
	const result = {};
	if ((mode === "title" || mode === "both") && meta.title) result.title = meta.title;
	if ((mode === "brief" || mode === "both") && meta.brief) result.brief = meta.brief;
	return result;
}
/**
* 统计真实用户消息数；达到 4 次后生成简介（新会话自动简介）。
*
* 门槛（4 次真实交互）仍按会话流水统计——那衡量的是"这个会话聊得够不够多"；
* 简介本身与两个按钮同源（会话内容 → 模型 → 本地兜底）。
*/
async function summarizeSession(ctx, sessionId, signal) {
	const realUser = (await getSessionMessages(ctx, sessionId)).filter((m) => m.role === "user" && isRealUserText(m.text));
	if (realUser.length < 4) return {
		ready: false,
		count: realUser.length
	};
	const meta = await summarizeSessionMeta(ctx, sessionId, {
		useModel: true,
		signal
	});
	return meta.brief ? {
		ready: true,
		brief: meta.brief,
		count: realUser.length
	} : {
		ready: false,
		count: realUser.length
	};
}
//#endregion
//#region src/resummarize-all.ts
/** 单个会话至少要有这么多剩余预算才值得再发一次模型请求。 */
const MIN_MODEL_BUDGET_MS = 1500;
/**
* 会话的持久化标记：优先事件数（跨重启稳定、语义清楚），其次字节数。
* 拿不到时返回 null（调用方当作"无法判定"→ 保守地认为有变化）。
*/
async function sessionMarker(ctx, sessionId) {
	try {
		const persistence = ctx?.sessionPersistence;
		if (!persistence?.stat) return null;
		const snapshot = await persistence.stat(sessionId);
		if (!snapshot) return null;
		if (typeof snapshot.eventCount === "number") return `ev:${snapshot.eventCount}`;
		if (typeof snapshot.sizeBytes === "number") return `sz:${snapshot.sizeBytes}`;
		if (snapshot.revision !== void 0 && snapshot.revision !== null) return `rev:${String(snapshot.revision)}`;
	} catch (err) {
		console.warn("[dsh-myagent] session stat failed", sessionId, err);
	}
	return null;
}
async function resummarizeAllSessions(ctx, sessions, signal, options = {}) {
	const useModel = options.useModel ?? true;
	const onlyChanged = options.onlyChanged ?? true;
	const budgetMs = options.budgetMs ?? 45e3;
	const startedAt = Date.now();
	const updates = [];
	let updated = 0;
	let unchanged = 0;
	let skipped = 0;
	let agentCount = 0;
	let localCount = 0;
	for (const session of sessions) {
		let marker = null;
		try {
			marker = await sessionMarker(ctx, session.id);
			if (onlyChanged && marker !== null && session.marker != null && session.marker === marker) {
				unchanged += 1;
				updates.push({
					sessionId: session.id,
					unchanged: true,
					marker: marker ?? void 0
				});
				continue;
			}
			const remaining = budgetMs - (Date.now() - startedAt);
			const wantsModel = useModel && remaining > MIN_MODEL_BUDGET_MS && !signal?.aborted;
			const meta = await summarizeSessionMeta(ctx, session.id, {
				useModel: wantsModel,
				signal
			});
			if (meta.source === "agent") agentCount += 1;
			else localCount += 1;
			updated += 1;
			updates.push({
				sessionId: session.id,
				title: meta.title,
				brief: meta.brief,
				source: meta.source,
				marker: marker ?? void 0
			});
		} catch (err) {
			if (!/no summarizable content/.test(String(err?.message ?? err))) console.warn("[dsh-myagent] resummarize-all skipped a session", session.id, err);
			skipped += 1;
			updates.push({
				sessionId: session.id,
				skipped: true,
				marker: marker ?? void 0
			});
		}
	}
	return {
		updates,
		summary: {
			checked: sessions.length,
			updated,
			unchanged,
			skipped,
			agent: agentCount,
			local: localCount,
			elapsedMs: Date.now() - startedAt
		},
		agent: organizerInfo()
	};
}
//#endregion
//#region src/index.ts
const name = "myagent";
const inject = [
	"webServer",
	"fs",
	"sessions",
	"sessionPersistence",
	"agents"
];
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
	ctx.inject(["agentDefaultModel"], (scope) => {
		setDefaultModelResolver(() => scope.agentDefaultModel.currentSelection());
	});
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
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 18e4);
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
				const timer = setTimeout(() => controller.abort(), 3e4);
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
				const body = await readBody(req);
				const sessions = body?.sessions;
				if (!Array.isArray(sessions) || sessions.some((s) => !s || typeof s.id !== "string")) {
					sendError(res, Object.assign(/* @__PURE__ */ new Error("bad sessions"), { code: "BAD_REQUEST" }));
					return;
				}
				const onlyChanged = body?.onlyChanged !== false;
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 6e4);
				try {
					sendJson(res, 200, {
						ok: true,
						data: await resummarizeAllSessions(ctx, sessions, controller.signal, { onlyChanged })
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
		path: "/api/myagent/organizer/status",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				sendError(res, Object.assign(/* @__PURE__ */ new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
				return;
			}
			try {
				const body = await readBody(req);
				const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
				const agent = await prepareOrganizer(ctx);
				const usage = await readOrganizerUsage(ctx);
				const markers = [];
				for (const s of sessions) {
					if (!s || typeof s.id !== "string") continue;
					markers.push({
						id: s.id,
						marker: await sessionMarker(ctx, s.id)
					});
				}
				sendJson(res, 200, {
					ok: true,
					data: {
						agent,
						usage,
						sessions: markers
					}
				});
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
