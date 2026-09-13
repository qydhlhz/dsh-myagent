# 参与开发

欢迎 issue 与 PR。这个仓库是 dsh（DeepSeek Harness）Web GUI 的插件，改动前请先读一遍
`README.md` 的「从源码构建与测试」一节。

## 环境

- Node.js ≥ 24（`npm run check` 直接跑 TypeScript，靠 Node 内置的类型剥离；Node 22.x 需要自己加
  `--experimental-strip-types`）
- 本机装有 dsh `0.1.5-rc`（跑 `npm run smoke` 用；找不到时用 `DSH_APP_BOOT` 指定路径）

## 本地流程

```sh
npm ci            # 严格按 lockfile 装依赖
npm run check     # tsc --noEmit + 全部单元用例
npm run build     # 重建 lib/（宿主半区 + 浏览器半区）
npm run smoke     # bundle 契约 + patch 合成冒烟
```

## 提交 PR 前请确认

1. `npm run check` 全绿；
2. **改过 `src/` 就必须跑 `npm run build` 并把 `lib/` 一起提交** —— 本仓库提交构建产物，
   dsh 从 Git 安装时没有构建步骤；CI 会用 `git diff --exit-code -- lib` 挡住漏重建；
3. 改了对外行为，请在 `README.md` / `README.en.md` 里同步说明；
4. 一个 PR 只做一件事，说明"为什么"而不只是"改了什么"。

## 注意

- 变更记录（`变更记录.md`）是本地文件，不随仓库提交，新增条目写在本地即可。
- 提交信息用结果式描述，不写开发过程。
