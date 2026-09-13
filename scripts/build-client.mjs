// scripts/build-client.mjs
// 用 esbuild 把客户端入口打成 CJS，并用 banner/footer 包上
// window.__ModuleLoader__.load({ id, factory }) 工厂包装，输出 lib/client.js。
// react / react-dom 保持 external，由宿主的 makeRequire seed words 解析（require("react")、
// require("react-dom")）——dsh-client-web 的静态模块表里两个都有（lib/types/platform.d.ts 的
// PLATFORM_MODULES）。@deepseek-ai/dsh-client-ui-primitives 同样在 PLATFORM_MODULES 里
// （宿主编译时带真实 CSS 类名与 token 样式；npm 包本体是 CSS stub，打进 bundle 会得到
// 无样式组件），故一并 external——与官方 dsh-client-ui-workspace 的集成方式一致。
// 也正因 primitives 走宿主模块表，插件的 devDependency 存根只影响类型（0.1.5 新增的
// FileTypeIcon/classifyFileType 在存根里没有），运行时由宿主提供，见 src/client/file-icon.tsx。
// 注意：npm run watch（tsdown --watch）只盯 node 半区；client 半区由
// npm run build:client 手动触发。
import { mkdirSync } from "node:fs";
import { build } from "esbuild";

// 保证输出目录存在（等价 mkdir -p lib）
mkdirSync("lib", { recursive: true });

await build({
  entryPoints: ["src/client/client.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  outfile: "lib/client.js",
  external: ["react", "react-dom", "@deepseek-ai/dsh-client-ui-primitives"],
  // 包装结构（banner 开 3 层：load( + 对象 { + 箭头体 {；footer 依次闭合：
  // return 后 } 闭箭头体、} 闭对象、) 闭 load(）：
  // window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports; }});
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-myagent", factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n',
  },
  footer: {
    js: '\nreturn module.exports;\n}});',
  },
  logLevel: "info",
});
