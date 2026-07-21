import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fetchRepositoryEvidence, parseGitHubRepository } from "../lib/github-evidence.ts";
import { calculateOpportunityScore, opportunityGrade, predictionInterval, trendStarThreshold } from "../lib/evaluation-standard.ts";

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
  assert.match(html, /AGENT 决策闭环/);
  assert.match(html, /项目机会/);
  assert.match(html, /任务执行/);
  assert.match(html, /Agent 审计/);
  assert.match(html, /评判标准/);
  assert.match(html, /缺失上下文/);
  assert.match(html, /中止条件/);
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
  assert.deepEqual(payload.configured_providers, []);
});

test("DeepSeek provider returns a guarded four-stage decision", async (t) => {
  let capturedBody = null;
  const modelAssessment = {
    goal_summary: "安全地完成支付数据库迁移并验证回滚能力",
    assessment_kind: "TASK_FEASIBILITY",
    opportunity_score: null,
    rubric_scores: null,
    recommended_experiment: null,
    reasoning_gaps: [],
    adversarial_tests: [],
    agent_improvement: null,
    evidence_ledger: null,
    // DeepSeek sometimes returns null for this cross-mode field. The route must
    // repair it from the deterministic outside-view prior instead of discarding
    // the otherwise valid assessment.
    success_probability: null,
    confidence_quality: "HIGH",
    risk: "LOW",
    route: "AUTORUN",
    estimated_minutes: 45,
    estimated_cost_usd: 1.4,
    missing_context: [],
    preconditions: ["在隔离数据库创建快照"],
    failure_modes: ["迁移脚本可能破坏现有数据"],
    verification_steps: ["运行迁移测试", "执行回滚测试"],
    abort_conditions: ["发现不可回滚的数据变更时停止"],
    policy: "仅在隔离环境执行并保留人工审查。",
    assumptions: ["存在可复现的数据库测试环境"],
  };
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    capturedBody = JSON.parse(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "mock-deepseek",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "deepseek-v4-flash",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(modelAssessment) } }],
      usage: { prompt_tokens: 120, completion_tokens: 180, total_tokens: 300 },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const previous = {
    provider: process.env.AI_PROVIDER,
    deepseekKey: process.env.DEEPSEEK_API_KEY,
    deepseekBase: process.env.DEEPSEEK_BASE_URL,
    openaiKey: process.env.OPENAI_API_KEY,
  };
  const address = server.address();
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    for (const [key, value] of Object.entries({
      AI_PROVIDER: previous.provider,
      DEEPSEEK_API_KEY: previous.deepseekKey,
      DEEPSEEK_BASE_URL: previous.deepseekBase,
      OPENAI_API_KEY: previous.openaiKey,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const routeUrl = new URL("../app/api/preflight/route.ts", import.meta.url);
  routeUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  const { POST } = await import(routeUrl.href);
  const result = await POST(new Request("http://localhost/api/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task: "执行支付数据库 migration，并增加回滚测试",
      repository: "",
      language: "zh",
      mode: "task",
    }),
  }));
  const payload = await result.json();

  assert.equal(result.status, 200);
  assert.equal(payload.provider, "deepseek");
  assert.deepEqual(payload.trace.stages, ["SENSE", "CHALLENGE", "DECIDE", "GUARD"]);
  assert.equal(payload.assessment.route, "REVIEW");
  assert.equal(payload.assessment.risk, "MEDIUM");
  assert.equal(typeof payload.assessment.success_probability, "number");
  assert.deepEqual(payload.assessment.evidence_ledger, []);
  assert.ok(payload.assessment.guardrails_applied.length > 0);
  assert.equal(capturedBody.model, "deepseek-v4-flash");
  assert.deepEqual(capturedBody.response_format, { type: "json_object" });
});

test("non-project modes normalize nullable evidence ledgers before strict validation", async () => {
  const routeUrl = new URL("../app/api/preflight/route.ts", import.meta.url);
  routeUrl.searchParams.set("ledger-test", `${Date.now()}-${Math.random()}`);
  const { parseJsonAssessment } = await import(routeUrl.href);
  const base = {
    goal_summary: "审计用户编写的 Agent 指令并检查验证与停止条件",
    assessment_kind: "AGENT_AUDIT",
    opportunity_score: null,
    rubric_scores: null,
    recommended_experiment: null,
    trend_probability: null,
    demand_analysis: null,
    evidence_ledger: null,
    reasoning_gaps: ["没有定义失败后的恢复策略"],
    adversarial_tests: ["模拟测试命令不可用"],
    agent_improvement: "先验证输入和工具，再执行任务，并在验证失败时立即停止。",
    success_probability: 70,
    confidence_quality: "MEDIUM",
    risk: "MEDIUM",
    route: "REVIEW",
    estimated_minutes: 30,
    estimated_cost_usd: 1,
    missing_context: [],
    preconditions: ["确认仓库可访问"],
    failure_modes: ["测试环境可能不可用"],
    verification_steps: ["运行测试", "检查最终差异"],
    abort_conditions: ["测试失败时停止"],
    policy: "只在隔离环境执行并保留审查步骤。",
    assumptions: [],
  };

  const agent = parseJsonAssessment(JSON.stringify(base), 60, "agent");
  const task = parseJsonAssessment(JSON.stringify({ ...base, assessment_kind: "TASK_FEASIBILITY" }), 60, "task");
  assert.deepEqual(agent.evidence_ledger, []);
  assert.deepEqual(task.evidence_ledger, []);
  assert.equal(agent.assessment_kind, "AGENT_AUDIT");
  assert.equal(task.assessment_kind, "TASK_FEASIBILITY");
});

test("GitHub evidence is fetched and normalized before assessment", async () => {
  assert.deepEqual(parseGitHubRepository("https://github.com/OpenCut-app/OpenCut"), {
    owner: "OpenCut-app",
    repo: "OpenCut",
    fullName: "OpenCut-app/OpenCut",
  });

  const fakeFetch = async (url) => {
    if (url.endsWith("/readme")) return new Response("# OpenCut\nA focused README", { status: 200 });
    if (url.endsWith("/contents")) return Response.json([{ name: "package.json", type: "file" }, { name: "apps", type: "dir" }]);
    return Response.json({
      full_name: "OpenCut-app/OpenCut",
      html_url: "https://github.com/OpenCut-app/OpenCut",
      description: "Open source video editor",
      stargazers_count: 75348,
      forks_count: 5000,
      open_issues_count: 120,
      language: "TypeScript",
      topics: ["video-editor"],
      license: { spdx_id: "MIT" },
      created_at: "2025-06-22T00:00:00Z",
      pushed_at: "2026-07-20T00:00:00Z",
      archived: false,
      fork: false,
      default_branch: "main",
    });
  };

  const evidence = await fetchRepositoryEvidence("github.com/OpenCut-app/OpenCut", fakeFetch);
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.stars, 75348);
  assert.equal(evidence.language, "TypeScript");
  assert.deepEqual(evidence.root_files, ["file:package.json", "dir:apps"]);
  assert.match(evidence.readme_excerpt, /focused README/);
});

test("opportunity scoring and calibration thresholds are deterministic", () => {
  const score = calculateOpportunityScore({
    demand: 80,
    momentum: 70,
    differentiation: 60,
    buildability: 90,
    distribution: 50,
    evidence: 80,
  });
  assert.equal(score, 74);
  assert.equal(opportunityGrade(score), "B");
  assert.equal(trendStarThreshold(76534), 553);
  assert.deepEqual(predictionInterval(70, "MEDIUM"), { lower: 55, upper: 85 });
});

test("calibration API degrades honestly when durable storage is unavailable", async () => {
  const response = await fetchApp("/api/calibration");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.storage_available, false);
  assert.equal(payload.resolved, 0);
});
