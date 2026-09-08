// src/client/CsvTable.tsx — CSV/TSV 只读表格预览。
// 简单状态机解析器：支持引号包裹字段、双引号转义，能覆盖多数 CSV/TSV 文件。
// 表格样式走 --dsw-* token，与文件查看器其余部分一致。
import React, { useMemo } from "react";

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        // 复制空字段后跳过 LF；统一按一行结束处理。
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const CSV_CSS = `
.fm-csv-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.fm-csv-table th,
.fm-csv-table td {
  border: 1px solid var(--dsw-alias-border-l2);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}
.fm-csv-table th {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 1;
}
.fm-csv-table tbody tr:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
`;

export function CsvTable({ content, delimiter = "," }: { content: string; delimiter?: string }) {
  const rows = useMemo(() => parseDelimited(content, delimiter), [content, delimiter]);
  const maxRows = 5000;
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return (
    <div className="fm-scroll" style={{ height: "100%", overflow: "auto", padding: 12, background: "var(--dsw-alias-bg-base)" }}>
      <style>{CSV_CSS}</style>
      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--dsw-alias-label-secondary)" }}>空文件</div>
      ) : (
        <table className="fm-csv-table">
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i}>{cell || "\u00a0"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.slice(0, maxRows).map((row, ri) => (
              <tr key={ri}>
                {header.map((_, ci) => (
                  <td key={ci}>{row[ci] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {body.length > maxRows ? (
        <div style={{ padding: "8px 4px", color: "var(--dsw-alias-label-secondary)", fontSize: 12 }}>
          数据较多，仅显示前 {maxRows} 行。
        </div>
      ) : null}
    </div>
  );
}
