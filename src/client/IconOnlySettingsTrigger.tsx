// src/client/IconOnlySettingsTrigger.tsx — 顶替官方 settings.trigger 内容：
// 只渲染图标、wide 状态也不渲染"设置"文字。点击动作由官方 SettingsRoot 外层持有，
// 此处无需复刻。
//
// dsh 0.2：primitives 的图标不再按「尺寸」分号（旧 IconSettingsOutline16 / …14），
// 改为按「笔画权重」分号（…Regular = 1px / …Medium = 1.3px），尺寸统一由 size prop 决定。
// 旧代码两个分支本就都传 size: 18（注释即「wide/narrow 统一」），故这里合并为一个
// Medium artwork，渲染结果与旧版一致。
import React from "react";
import { IconSettingsOutlineMedium } from "@deepseek-ai/dsh-client-ui-primitives";

export function IconOnlySettingsTrigger(props: { wide?: boolean }) {
  // 图标尺寸与模式键一致（18px，32x32 按钮内），wide/narrow 统一。
  void props.wide;
  return React.createElement(IconSettingsOutlineMedium, { size: 18 });
}
