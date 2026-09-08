# DSH-MYAGENT (`dsh-myagent`)

DeepSeek Harness（dsh）Web GUI 的双半区 bundle 插件：**VS Code 风格沙盒文件树/沙盒文件查看器 + 工作沙盒/会话侧栏**，把类 VS Code 的文件管理体验集成进 Agent。

- **宿主半区**（`lib/index.js`）：`/api/myagent/*` 文件服务
- **浏览器半区**（`lib/client.js`，CodeMirror 6 已内联）：侧栏 UI，由 dsh 客户端模块加载器自动服务

## 功能

- 沙盒文件树浏览（目录展开/折叠、文件/文件夹角标、拖拽排序会话）
- 文件查看与编辑：CodeMirror 6 代码编辑器（打开代码文件自动启用语法高亮/行号/暗色主题）、文本编辑保存（带版本 CAS，过期冲突 → 409 提示重载）、大文件仅下载
- 代码运行：右侧代码区上下二分割（上半脚本、下半运行输出，分割线可拖动）；Python / R / JavaScript(Node) / Shell 文件提供“运行”按钮，自动保存后在后端执行并展示 stdout/stderr/退出码；调试按钮为后续版本占位
- 二进制预览：PDF / 音频 / 视频只读预览（浏览器原生渲染）
- 已知限制：PDF/音视频内联预览暂不支持 HTTP Range/流式播放
- Office 文档（docx/xlsx/pptx/odt/ods/odp/rtf）：不提供预览，作为二进制文件列出（可下载）
- 下载：`raw=1` 原始字节直写（真实文件下载）
- 文件操作：新建目录、重命名/移动、删除（确认弹窗）
- 工作沙盒/会话侧栏：会话切换、会话状态点（运行中脉冲 / 等待批准 / 等待计划确认 / 等待问答 / 已完成 / 空闲）
- 工作沙盒内聊天框分组：命名分组、默认分组、新建/重命名/删除/排序，支持拖拽或菜单移动聊天框
- 原始模式 ↔ MyAgent 模式一键切换键（MA logo）
- 安全：路径穿越防护（`safeJoin`）、根目录白名单（workspaceRegistry 动态解析 ∪ `allowedRoots` ∪ dsh 启动目录）、HTTP 方法白名单、读取大小上限（512 KB 文本预览）、请求体上限（1 MB）、符号链接逃逸防护

## 环境要求

- dsh `0.1.0-rc.6`（peer 依赖按 `@deepseek-ai/*` 对应版本解析）
- 构建与测试：Node.js ≥ 22.13（测试直接运行 TypeScript）+ npm
- 安装仓库版无需构建：`lib/` 构建产物已提交
- 冒烟脚本 `npm run smoke` 需要能找到本机 dsh 的 `@deepseek-ai/dsh-app-boot`；找不到时用环境变量指定：
  `DSH_APP_BOOT=/path/to/@deepseek-ai/dsh-app-boot/lib/index.js npm run smoke`

## 安装

```sh
# 在线安装（GitHub 源，推荐锁定版本标签）
dsh plugin --profile web add github:qydhlhz/dsh-myagent#v0.1.0

# 或本地 tarball（npm pack 产物）
dsh plugin --profile web add ./dsh-myagent-0.1.0.tgz

# 或本地源码目录（开发态）
dsh plugin --profile web add ./dsh-myagent
```

安装成功后 `dsh.profile.bundles` 会自动追加 `dsh-myagent`。**重启 `dsh web`** 使 bundle 层生效（bundle 不热重载）。

验证：

```sh
dsh --profile web --dump-config   # 应出现 # == dsh-myagent 与插件行
```

重启后在 GUI 设置 → 插件列表可见 `dsh-myagent`，侧栏出现沙盒文件树/工作沙盒面板。

## 配置

插件行配置可在 profile 的 `cordis.patch.yml` 覆盖（整体替换）：

```yaml
- id: myagent
  name: 'dsh-myagent'
  config:
    # 人工补充白名单；默认空 = 只放行"已注册工作沙盒根" + dsh 启动目录
    allowedRoots: []
    # 运行代码时使用的解释器路径（缺省自动探测）
    pythonPath: 'python'          # 或 'C:\Python312\python.exe'
    rscriptPath: 'C:\Program Files\R\R-4.6.0\bin\Rscript.exe'
    nodePath: 'node'
    timeoutMs: 15000              # 单次运行超时（毫秒）
```

## 从源码构建与测试

```sh
npm install
npm run check     # tsc --noEmit + node --test（全部单元用例）
npm run build     # tsdown（宿主半区 lib/index.js）+ esbuild（浏览器半区 lib/client.js）
npm run smoke     # bundle 契约 + patch 合成冒烟
```

仓库已提交构建产物 `lib/`，安装无需构建步骤。宿主半区零外部运行时依赖；浏览器半区仅依赖宿主 Web 应用提供的 `react` / `react-dom` / `@deepseek-ai/dsh-client-ui-primitives`（CodeMirror 6 已内联进 `lib/client.js`），安装时不会引入任何第三方依赖。

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
