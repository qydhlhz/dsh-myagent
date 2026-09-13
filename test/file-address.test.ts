// test/file-address.test.ts — file-address 纯函数测试（地址构造与相对/绝对判定）。
// 这些函数是"左侧树点文件 → 官方右栏预览"的唯一翻译层：官方预览只认 session 作用域地址，
// 且宿主按地址里的会话解析相对路径，所以构造规则必须与宿主官方 file-address.ts 逐字一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileAddressFor,
  isAbsoluteWorkspacePath,
  sessionFileAddress,
} from "../src/client/file-address.ts";

test("sessionFileAddress 逐段编码且保留盘符冒号", () => {
  assert.equal(sessionFileAddress("s 1", "a b/c.ts"), "dsh-resource://file/session/s%201/a%20b/c.ts");
  assert.equal(sessionFileAddress("s", "C:/x/y.txt"), "dsh-resource://file/session/s/C:/x/y.txt");
  // 反斜杠归一为 /，开头的 ./ 去掉
  assert.equal(sessionFileAddress("s", ".\\src\\a.ts"), "dsh-resource://file/session/s/src/a.ts");
  // 会话根自身 → 空路径段
  assert.equal(sessionFileAddress("s", ""), "dsh-resource://file/session/s/");
});

test("isAbsoluteWorkspacePath 两种拼写都算绝对", () => {
  assert.equal(isAbsoluteWorkspacePath("/a/b"), true);
  assert.equal(isAbsoluteWorkspacePath("C:/a"), true);
  assert.equal(isAbsoluteWorkspacePath("C:\\a"), true);
  assert.equal(isAbsoluteWorkspacePath("\\\\server\\share"), true);
  assert.equal(isAbsoluteWorkspacePath("src/a.ts"), false);
  assert.equal(isAbsoluteWorkspacePath(""), false);
});

test("fileAddressFor 按会话根决定相对/绝对", () => {
  // 相对路径原样进会话地址
  assert.equal(fileAddressFor("s", "D:/ws", "src/a.ts"), "dsh-resource://file/session/s/src/a.ts");
  // 根内绝对路径 → 削成相对
  assert.equal(fileAddressFor("s", "D:/ws", "D:/ws/src/a.ts"), "dsh-resource://file/session/s/src/a.ts");
  // 根自身 → 空路径段
  assert.equal(fileAddressFor("s", "D:/ws", "D:/ws"), "dsh-resource://file/session/s/");
  // 反斜杠拼写的根内绝对路径同样削成相对
  assert.equal(fileAddressFor("s", "D:\\ws", "D:\\ws\\src\\a.ts"), "dsh-resource://file/session/s/src/a.ts");
  // 根尾部分隔符不影响削前缀
  assert.equal(fileAddressFor("s", "D:/ws/", "D:/ws/src/a.ts"), "dsh-resource://file/session/s/src/a.ts");
  // 根外绝对路径 → 仍留在会话地址里（保留会话信息，宿主按会话根解析不到就是它自己的事）
  assert.equal(fileAddressFor("s", "D:/ws", "C:/other/a.ts"), "dsh-resource://file/session/s/C:/other/a.ts");
  // 根未知 → 绝对路径原样
  assert.equal(fileAddressFor("s", undefined, "C:/other/a.ts"), "dsh-resource://file/session/s/C:/other/a.ts");
});

test("fileAddressFor 前缀相同但不是子路径时不算根内", () => {
  // "D:/wsother" 不能被根 "D:/ws" 削成 "other/a.ts"
  assert.equal(fileAddressFor("s", "D:/ws", "D:/wsother/a.ts"), "dsh-resource://file/session/s/D:/wsother/a.ts");
});
