// src/client/IconOnlySettingsTrigger.tsx — 顶替官方 settings.trigger 内容：
// 只渲染图标、wide 状态也不渲染"设置"文字。点击动作由官方 SettingsRoot 外层持有，
// 此处无需复刻。
//
// dsh 0.2：primitives 的图标不再按「尺寸」分号（旧 IconSettingsOutline16 / …14），
// 改为按「笔画权重」分号（…Regular = 1px / …Medium = 1.3px），尺寸统一由 size prop 决定。
// 旧代码两个分支本就都传 size: 18（注释即「wide/narrow 统一」），故这里合并为一个
// Medium artwork，渲染结果与旧版一致。
//
// 【data-fm-settings-trigger 标记的用途（桌面端布局修复）】
// 桌面端的官方账号插件会占用 **settings.launcher**，而 settings.launcher 一旦有占位者，
// 官方就**不再渲染 settings.trigger**（见 ui-settings-general 的 renderSlot fallback），
// 于是这个组件根本不会被挂载。席位里换成「头像 + 用户名」的整行控件。
//
// 本插件的底栏紧凑布局（设置键缩成 32×32 并与 MA 模式键同行）只在"席位里是这颗单图标"
// 时才成立；席位被账号行占用时继续套用会把整行压扁并与模式键重合（用户报的问题）。
// 因此这里渲染一个**自带稳定 data 属性**的标记，让 CSS 能用
// `:has([data-fm-settings-trigger])` 精确判断"现在是官方 trigger 还是别人的 launcher" ——
// 不依赖任何官方 CSS Modules 哈希。
import React from "react";
import { IconSettingsOutlineMedium } from "@deepseek-ai/dsh-client-ui-primitives";

export function IconOnlySettingsTrigger(props: { wide?: boolean }) {
  // 图标尺寸与模式键一致（18px，32x32 按钮内），wide/narrow 统一。
  void props.wide;
  return React.createElement(
    "span",
    { "data-fm-settings-trigger": "1", style: { display: "inline-flex", alignItems: "center" } },
    React.createElement(IconSettingsOutlineMedium, { size: 18 }),
  );
}
