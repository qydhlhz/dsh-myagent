# DSH-MYAGENT (`dsh-myagent`)

[![CI](https://github.com/qydhlhz/dsh-myagent/actions/workflows/ci.yml/badge.svg)](https://github.com/qydhlhz/dsh-myagent/actions/workflows/ci.yml)
![dsh](https://img.shields.io/badge/dsh-0.1.5--rc-blue)
![license](https://img.shields.io/badge/license-MIT-green)

**简体中文** | [English](README.en.md)

> **MYAGENT.UI** —— 为 dsh 配置更好的工作区与文件树系统。
> **区管家** —— 无需对话的 agent：一键维护工作区三级列表。

dsh 0.1.5 起官方内置了文件树与预览。本项目**保留官方预览**、接管左侧栏：把
**工作区 → 分组 → 会话**三级列表与区文件树合成一块左侧面板，并提供**一键切换
MYAGENT 模式 / 标准模式**的按钮，随时还原官方界面。内置 **区管家** —— 一个不显示对话框的
agent：读取各对话记忆，替你维护工作区分组，标题，简介。

版本号与 dsh 一一对应（本版 **v0.1.5** ↔ dsh `0.1.5-rc`）；旧版插件会被 0.1.5 拒绝加载，**必须升级**。

双半区 bundle（宿主 `lib/index.js` + 浏览器 `lib/client.js`），消费侧零第三方运行时依赖，`lib/` 已提交、装完即用：

```sh
dsh plugin --profile web add github:qydhlhz/dsh-myagent#v0.1.5    # 装完重启 dsh web
```

## 功能

- 区文件树浏览（目录展开/折叠、按文件类型着色的图标、拖拽排序会话）
- 文件打开：点击左侧树中的文件 → 右侧栏官方预览标签页（同一文件重复点击只聚焦原标签页）
- **MyAgent 模式下隐藏官方右栏文件树**（文件浏览统一由左栏承担）；官方**文件预览完全不受影响**，
  切回标准模式即恢复官方文件树
- **图片预览**：打开即横向顶满可视宽度，**拖右栏分割线改变宽度时实时跟随**；
  滚轮以光标为锚点缩放（2%–3200%）、按住左键拖动平移、
  双击在「适应宽度 ↔ 100%」间切换、`+`/`-`/`0`/`1` 键盘等价，右下角常显缩放比例。
  只接管图片扩展名，Markdown/代码/PDF/HTML/纯文本仍全部由官方渲染
- **点「区」标签 → 区文件树跳到该区**（每次点击都跳；切换会话时回到"跟着会话走"）
- 文件操作：新建文件/目录、重命名/移动、删除（确认弹窗）、复制项目地址、下载
- 工作区/会话侧栏：会话切换、会话状态点（运行中脉冲 / 等待批准 / 等待计划确认 / 等待问答 / 已完成 / 空闲）
- 工作区内聊天框分组：命名分组、默认分组、新建/重命名/删除/排序，支持拖拽或菜单移动聊天框；
  **每个分组标题行在「重命名分组」左边都有一个「新对话（当前选中分组）」按钮，点它即在该分组下新建对话**
- **区管家**（工作区标题栏的礼帽按钮）= 一个**不显示对话框的独立对话 agent**，只跑两条固定
  提示词命令。面板本身只有三块：**这是什么**、**两条命令**、**消耗用量**。
  1. **一键更新全部对话**：逐条读会话内容 → 先写简介 → 再按简介写**固定格式 `主题：进度`**
     标题（例：`meta分析：已检索完文献`）。只处理「自上次总结之后又聊过」的会话
     （宿主用会话持久化标记 `sz:`/`ev:` 判定），没动过的不重复处理。
     客户端**分块循环**调用（每块 6 条）并显示进度，所以上百条会话也不会撞上单请求超时；
     跑完给出 `检查 / 更新 / 未变 / 跳过` + `模型 / 本地兜底` + 耗时 + 可展开明细。
  2. **一键整理分组**：按项目名归类会话，**直接应用**（不再让用户逐条勾选），给出计数摘要
     （新建 x 组 · 移动 y 条 · 重命名 z · 删除 w · 改标注 v），并留一份**可撤销快照**，
     面板上出现「撤销这次整理」。
  3. **消耗用量**：上下文已用（含 40k 预算百分比）、管家会话累计 token（输入 / 缓存命中 /
     输出）、模型、请求次数、上下文轮换次数、上次运行时间、管家会话 id、会话日志大小。
     这些数字从**管家会话日志**汇总，跨 dsh 重启依然有效（不是重启就归零的内存计数）。
- **「重新总结命名 / 重新总结简介」两个按钮**与区管家同源：都以**会话自身内容**为准
  （首条=目标、末尾=当前阶段），都走"先简介、后标题"，标题一律 `主题：进度`。
  两个按钮的差别只是入口，结果字段本来就不同。模型不可用时用会话首末发言本地兜底
  （标题退化为 `主题：进行中`，**不编造进度**）。

- 上下两区独立折叠 + 可拖拽分割线，两区状态各自持久化
- 标准模式 ↔ MyAgent 模式一键切换键（MA logo）
- **左上角 logo 块显示 MYAGENT 字样**（仅 MyAgent 模式）：官方鲸鱼标记与 DeepSeek Harness 字标都保留，
  字标让位到 16px，右侧加「竖线 + MYAGENT」；尺寸按宿主侧栏的合法宽度区间（264–420px）定，
  **在整个区间内都放得下，不会消失**；切回标准模式恢复官方原样
- 安全：路径穿越防护（`safeJoin`）、根目录白名单（workspaceRegistry 动态解析 ∪ `allowedRoots` ∪ dsh 启动目录）、HTTP 方法白名单、读取大小上限（512 KB 文本预览）、请求体上限（1 MB）、符号链接逃逸防护

## 环境要求

- dsh `0.1.5-rc`（0.1.5 起槽位系统改为"声明账本 + `slots.inject`"，本插件已按新契约重写；0.1.0-rc.6 及更早不再支持）
- 构建与测试：Node.js ≥ 22.13（测试直接运行 TypeScript）+ npm
- 安装仓库版无需构建：`lib/` 构建产物已提交
- 冒烟脚本 `npm run smoke` 需要能找到本机 dsh 的 `@deepseek-ai/dsh-app-boot`；找不到时用环境变量指定：
  `DSH_APP_BOOT=/path/to/@deepseek-ai/dsh-app-boot/lib/index.js npm run smoke`

## 安装

```sh
# 在线安装（GitHub 源，推荐锁定版本标签）
dsh plugin --profile web add github:qydhlhz/dsh-myagent#v0.1.5

# 或本地 tarball（npm pack 产物）
dsh plugin --profile web add ./dsh-myagent-0.1.5.tgz

# 或本地源码目录（开发态）
dsh plugin --profile web add ./dsh-myagent
```

安装成功后 `dsh.profile.bundles` 会自动追加 `dsh-myagent`。**重启 `dsh web`** 使 bundle 层生效（bundle 不热重载）。

验证：

```sh
dsh --profile web --dump-config   # 应出现 # == dsh-myagent 与插件行
```

重启后在 GUI 设置 → 插件列表可见 `dsh-myagent`，侧栏出现工作区 / 区文件树面板。

## 配置

插件行配置可在 profile 的 `cordis.patch.yml` 覆盖（整体替换）：

```yaml
- id: myagent
  name: 'dsh-myagent'
  config:
    # 人工补充白名单；默认空 = 只放行"已注册工作区根" + dsh 启动目录
    allowedRoots: []
    # 运行代码时使用的解释器路径（缺省自动探测）
    pythonPath: 'python'          # 或 'C:\Python312\python.exe'
    rscriptPath: 'C:\Program Files\R\R-4.6.0\bin\Rscript.exe'
    nodePath: 'node'
    timeoutMs: 15000              # 单次运行超时（毫秒）
```

## 从源码构建与测试

```sh
npm ci            # 严格按 lockfile 装依赖
npm run check     # tsc --noEmit + node --test（全部单元用例）
npm run build     # tsdown（宿主半区 lib/index.js）+ esbuild（浏览器半区 lib/client.js）
npm run smoke     # bundle 契约 + patch 合成冒烟
```

测试用 Node ≥ 24 开箱即跑（直接运行 TypeScript，靠 Node 内置的类型剥离；Node 22.x 需自行加
`--experimental-strip-types`）。CI（`.github/workflows/ci.yml`）会跑类型检查、单测、构建，并用
`git diff --exit-code -- lib` 挡住"改了源码忘了重建产物"。参与开发见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

仓库已提交构建产物 `lib/`，安装无需构建步骤。**消费侧零第三方运行时依赖**：宿主半区无外部依赖；浏览器半区仅使用宿主 Web 应用模块表里的 `react` / `react-dom` / `@deepseek-ai/dsh-client-ui-primitives`。

> ⚠️ **改了源码要重启 `dsh web`，光刷新浏览器不够。** 宿主把每个插件的客户端半区合并在
> `/plugins/??…&rev=<hash>` 一个响应里返回，而这份产物是**进程启动时读进内存**的（`rev` 只跟
> 插件清单走，不跟产物内容走）。实测（`.cache/freshness3.mjs` + `.cache/served-markers.mjs`，
> 在同一个已启动实例上往 `lib/client.js` 追加标记再 `fetch(..., {cache:"no-store"})`）：
> 追加后服务端仍返回追加前那份，**重启进程后**才带上标记。所以"改客户端半区只要刷新页面"
> 是错的 —— `npm run build` 之后必须重启 `dsh web`。

测试分两层：`test/*.ts` 覆盖宿主半区与纯函数；`test/client-bundle.test.ts` 直接加载**打好的 `lib/client.js`**，用复刻 dsh "声明账本"契约的槽位注册表桩跑 `apply()`，锁死插件加载期不再抛 `slot ... is not declared`，并服务端渲染左栏组件确认真的渲染出工作区 / 区文件树两区。

## 目录结构

```
dsh-myagent/
├── cordis.patch.yml    # bundle patch：插入一行 id=myagent / name=dsh-myagent
├── package.json        # dsh.bundle.patch + dsh.client 双半区清单
├── lib/                # 构建产物（index.js 宿主 / client.js 浏览器 / index.d.ts）
├── src/                # 源码（src/index.ts 宿主；src/client/ 浏览器半区）
├── scripts/            # build-client.mjs（esbuild 打包客户端）
├── test/               # node:test 单元测试
└── smoke.mjs           # 冒烟脚本（bundle 契约 + patch 合成）
```

## License

MIT
