import assert from "node:assert/strict";
import test from "node:test";

async function fetchApp(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the bilingual SelfOdds product shell", async () => {
  const response = await fetchApp();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SelfOdds — Agent 执行前风控<\/title>/i);
  assert.match(html, /行动之前/);
  assert.match(html, /运行 PREFLIGHT/);
  assert.match(html, /真实结果账本/);
  assert.match(html, /中文/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("preflight API fails closed when the server key is not configured", async () => {
  const response = await fetchApp("/api/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "修复支付回调重复处理并补充幂等性测试", language: "zh" }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "AGENT_NOT_CONFIGURED");
});
