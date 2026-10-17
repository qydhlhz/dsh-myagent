// test/llm-api.test.ts — 区管家「独立 API 通道」的回归测试。
//
// 用户定案：管家用自己的 key 直连官方 API（不占 dsh 的模型额度）。
// 实测有两条容易踩的坑，这里都钉住：
//   1. `deepseek-flash` 是**推理模型** —— max_tokens 给小了会把额度全烧在思维链上、
//      `content` 是空字符串（实测 max_tokens=200 → 正文 0 字、reasoning 200）；
//      所以"正文为空"必须**加倍额度重试一次**，而不是把空字符串当答案。
//   2. 没配 key 时必须**返回 null 回退 agent 通道**，不能抛错（否则插件对其他人不可用）。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ORGANIZER_API_KEY_ENV,
  chatCompletion,
  resolveOrganizerApi,
  type OrganizerApiConfig,
} from "../src/llm-api.ts";

const CFG: OrganizerApiConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-test",
  model: "deepseek-flash",
  maxTokens: 2048,
  timeoutMs: 5000,
};

/** 装一个假的 fetch，按调用次序返回预设响应，并记录请求体。 */
function stubFetch(responses: Array<{ status?: number; body: any }>) {
  const calls: Array<{ url: string; init: any; body: any }> = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    const entry = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), init, body });
    const status = entry.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body);
      },
    } as any;
  }) as any;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function reply(content: string, usage?: any) {
  return {
    model: "deepseek-flash",
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 151, completion_tokens: 900, ...usage },
  };
}

test("resolveOrganizerApi：优先插件行 config，其次环境变量；没有 key 时返回 null", () => {
  const fromConfig = resolveOrganizerApi({ organizerApi: { apiKey: "sk-cfg", model: "deepseek-v4-pro" } }, {});
  assert.equal(fromConfig?.apiKey, "sk-cfg");
  assert.equal(fromConfig?.model, "deepseek-v4-pro");
  assert.equal(fromConfig?.baseUrl, "https://api.deepseek.com", "默认官方端点");
  assert.equal(fromConfig?.maxTokens, 2048, "默认额度必须 ≥1024（推理模型）");

  const fromEnv = resolveOrganizerApi({}, { [ORGANIZER_API_KEY_ENV]: "sk-env" });
  assert.equal(fromEnv?.apiKey, "sk-env");

  const both = resolveOrganizerApi({ organizerApi: { apiKey: "sk-cfg" } }, { [ORGANIZER_API_KEY_ENV]: "sk-env" });
  assert.equal(both?.apiKey, "sk-cfg", "config 优先于环境变量");

  assert.equal(resolveOrganizerApi({}, {}), null, "没 key → null（调用方回退 agent 通道）");
  assert.equal(resolveOrganizerApi({ organizerApi: { apiKey: "   " } }, {}), null, "空白 key 视为没配");
});

test("resolveOrganizerApi：baseUrl 末尾斜杠被去掉（避免拼出 //chat/completions）", () => {
  const cfg = resolveOrganizerApi({ organizerApi: { apiKey: "sk", baseUrl: "https://example.com/v1///" } }, {});
  assert.equal(cfg?.baseUrl, "https://example.com/v1");
});

test("chatCompletion：正常返回正文与用量（映射成 dsh 的 usage 形状）", async () => {
  const stub = stubFetch([
    { body: reply('{"brief":"改独立 API","title":"管家改造：已接独立API"}', { completion_tokens_details: { reasoning_tokens: 880 }, prompt_cache_hit_tokens: 20 }) },
  ]);
  try {
    const out = await chatCompletion(CFG, "提示词");
    assert.equal(out.text, '{"brief":"改独立 API","title":"管家改造：已接独立API"}');
    assert.equal(out.usage.inputTokens, 151);
    assert.equal(out.usage.outputTokens, 900);
    assert.equal(out.usage.reasoningTokens, 880);
    assert.equal(out.usage.cacheReadTokens, 20);
    assert.equal(out.retried, false);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(stub.calls[0].init.headers.Authorization, "Bearer sk-test");
    assert.equal(stub.calls[0].body.model, "deepseek-flash");
  } finally {
    stub.restore();
  }
});

test("chatCompletion：正文为空（推理吃光额度）→ 加倍 max_tokens 重试一次", async () => {
  const stub = stubFetch([
    { body: reply("", { completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 200 } }) },
    { body: reply('{"brief":"b","title":"t：p"}', { completion_tokens: 900 }) },
  ]);
  try {
    const out = await chatCompletion({ ...CFG, maxTokens: 200 }, "提示词");
    assert.equal(out.text, '{"brief":"b","title":"t：p"}');
    assert.equal(out.retried, true);
    assert.equal(stub.calls.length, 2, "必须重试一次");
    assert.equal(stub.calls[0].body.max_tokens, 200);
    assert.equal(stub.calls[1].body.max_tokens, 400, "第二次额度翻倍");
    assert.equal(out.usage.outputTokens, 200 + 900, "两次用量都要计入");
  } finally {
    stub.restore();
  }
});

test("chatCompletion：两次都空 → 抛可读错误（提示提高 maxTokens），绝不返回空串", async () => {
  const stub = stubFetch([{ body: reply("", { completion_tokens_details: { reasoning_tokens: 200 } }) }]);
  try {
    await assert.rejects(() => chatCompletion(CFG, "提示词"), /空正文|maxTokens/);
  } finally {
    stub.restore();
  }
});

test("chatCompletion：HTTP 失败要把状态码与 body 片段带出来，且**不能泄露 key**", async () => {
  const stub = stubFetch([{ status: 401, body: '{"error":{"message":"invalid api key"}}' }]);
  try {
    await assert.rejects(
      () => chatCompletion(CFG, "提示词"),
      (err: Error) => {
        assert.match(err.message, /401/);
        assert.match(err.message, /invalid api key/);
        assert.ok(!err.message.includes("sk-test"), "错误信息里不能出现 key");
        return true;
      },
    );
  } finally {
    stub.restore();
  }
});

test("chatCompletion：返回非 JSON 时报错而不是崩在解析上", async () => {
  const stub = stubFetch([{ body: "<html>502 Bad Gateway</html>" }]);
  try {
    await assert.rejects(() => chatCompletion(CFG, "提示词"), /不是 JSON/);
  } finally {
    stub.restore();
  }
});
