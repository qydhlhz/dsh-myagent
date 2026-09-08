// src/client/IconOnlySettingsTrigger.tsx — 顶替官方 settings.trigger 内容：
// 只渲染图标、wide 状态也不渲染"设置"文字。点击动作由官方 SettingsRoot 外层持有，
// 此处无需复刻。
import React from "react";
import { IconSettingsOutline16, IconSettingsOutline14 } from "@deepseek-ai/dsh-client-ui-primitives";

export function IconOnlySettingsTrigger(props: { wide?: boolean }) {
  // 图标尺寸与模式键一致（18px，32x32 按钮内），wide/narrow 统一。
  return props.wide
    ? React.createElement(IconSettingsOutline16, { size: 18 })
    : React.createElement(IconSettingsOutline14, { size: 18 });
}
