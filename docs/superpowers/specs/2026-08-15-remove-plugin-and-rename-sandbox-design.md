# 2026-08-15：移除插件管理 + 沙盒命名设计

## 背景

dsh-myagent 定位为「反向在 Agent 里集成类 VS Code 的文件管理系统」。用户确认：
- 移除插件相关的新增功能（侧栏插件区、设置页插件开关、宿主 `/api/myagent/plugins/*`、相关组件与测试）。
- 采用命名方案 A：
  - 「工作空间」→「工作沙盒」
  - 侧栏「文件」区 →「沙盒文件」
  - 相关树/根路径术语 →「沙盒文件树」「沙盒根目录」

## 范围

### 移除

- 宿主：`src/index.ts` 中插件启停注册与 `/api/myagent/plugins/list|toggle` 路由
- 服务/工具：`src/toggle.ts`、`src/toggle-store.ts`、`src/patch-editor.ts`、`src/tiers.ts`
- 客户端：`src/client/TogglePanel.tsx`、`src/client/plugin-section-store.ts`、`src/client/PluginManageButton.tsx`
- 客户端接线：`src/client/client.ts` 中 `settings.plugins.tab` 注入、`src/client/api.ts` 中 `toggleList/toggleSet` 及 `ToggleRow`
- 侧栏插件区：`src/client/SidebarComposite.tsx` 中第三个区块、rail 插件按钮、插件拖拽/折叠状态
- 图标：`src/client/FileBadge.tsx` 中 `PluginBadge`
- 测试：`test/toggle.test.ts`、`test/toggle-store.test.ts`、`test/patch-editor.test.ts`、`test/tiers.test.ts`
- 依赖：`js-yaml`、`@types/js-yaml`（仅插件 toggle 使用）

### 重命名（用户可见文案/注释，不改内部 API 标识符）

- `工作空间` → `工作沙盒`
- `工作区`（指代侧栏区域时）→ `工作沙盒区`
- 侧栏文件区标题/按钮：`文件` → `沙盒文件`、`展开文件/收起文件` → `展开沙盒文件/收起沙盒文件`
- 文件树相关：`文件树` → `沙盒文件树`、`文件查看器` → `沙盒文件查看器`、`文件区` → `沙盒文件区`
- 文件操作类文案（新建文件、文件已被修改等）保持不变

## 验证

- `node --test --test-isolation=none` 全绿（沙箱内隔离模式）
- `npx tsc --noEmit` 通过
- `npm run build` 通过
- `node smoke.mjs` 通过
- `npm pack --dry-run` 正常
