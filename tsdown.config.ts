import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  deps: {
    // react is a peerDependency; keep it external.
    neverBundle: ["react"],
  },
  // Package contract (main/types/exports) points at lib/ with .js/.d.ts names, so
  // outDir stays "lib" and fixedExtension: false lets extensions follow the package
  // "type": "module" (index.js/index.d.ts) instead of the tsdown 0.22 node-platform
  // default of .mjs/.d.mts. (client 入口由 scripts/build-client.mjs 的 esbuild 构建)
  outDir: "lib",
  fixedExtension: false,
  dts: true,
  // lib/ 是"双房东"目录：tsdown 产出 index.js/index.d.ts，esbuild 产出 client.js。
  // 默认 clean 会清空整个 lib/，esbuild 一旦失败 client.js 就被删掉。只关闭清理，
  // 让两个构建器各自覆盖自己的产物，互不误删。
  clean: false,
});
