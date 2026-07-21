"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Language = "zh" | "en";
type AssessmentMode = "project" | "task" | "agent";
type Outcome = "success" | "failed" | "pending";
type Source = "agent" | "local" | "sample";

type Run = {
  id: string;
  task: string;
  repo: string;
  probability: number;
  cost: number;
  minutes: number;
  route: "AUTORUN" | "REVIEW" | "ESCALATE";
  risk: "LOW" | "MEDIUM" | "HIGH";
  outcome: Outcome;
  createdAt: string;
  risks: string[];
  checks: string[];
  policy: string;
  assumptions: string[];
  source: Source;
  model: string;
  provider?: string;
  latencyMs?: number;
  goalSummary?: string;
  confidenceQuality?: "LOW" | "MEDIUM" | "HIGH";
  missingContext?: string[];
  preconditions?: string[];
  abortConditions?: string[];
  guardrails?: string[];
  riskSignals?: string[];
  stages?: string[];
  assessmentKind?: "PROJECT_OPPORTUNITY" | "TASK_FEASIBILITY" | "AGENT_AUDIT";
  opportunityScore?: number | null;
  rubricScores?: Record<"demand" | "momentum" | "differentiation" | "buildability" | "distribution" | "evidence", number> | null;
  recommendedExperiment?: string | null;
  reasoningGaps?: string[];
  adversarialTests?: string[];
  agentImprovement?: string | null;
  repositoryEvidence?: {
    status: "verified" | "unavailable" | "not_github";
    full_name?: string;
    stars?: number;
    forks?: number;
    language?: string;
    license?: string;
    pushed_at?: string;
  };
};

type AgentResponse = {
  ok: boolean;
  source?: "agent";
  provider?: "deepseek" | "openai";
  model?: string;
  latency_ms?: number;
  agent_version?: string;
  assessment?: {
    goal_summary: string;
    assessment_kind: "PROJECT_OPPORTUNITY" | "TASK_FEASIBILITY" | "AGENT_AUDIT";
    opportunity_score: number | null;
    rubric_scores: Run["rubricScores"];
    recommended_experiment: string | null;
    reasoning_gaps: string[];
    adversarial_tests: string[];
    agent_improvement: string | null;
    success_probability: number;
    confidence_quality: "LOW" | "MEDIUM" | "HIGH";
    estimated_cost_usd: number;
    estimated_minutes: number;
    route: Run["route"];
    risk: Run["risk"];
    missing_context: string[];
    preconditions: string[];
    failure_modes: string[];
    verification_steps: string[];
    abort_conditions: string[];
    policy: string;
    assumptions: string[];
    guardrails_applied: string[];
  };
  trace?: {
    stages: string[];
    outside_view_prior: number;
    risk_signals: string[];
    attempted_providers: string[];
    assessment_mode: AssessmentMode;
    repository_evidence: NonNullable<Run["repositoryEvidence"]>;
  };
  code?: string;
  message?: string;
};

const STORAGE_KEY = "selfodds-runs-v2";
const LANGUAGE_KEY = "selfodds-language-v1";

const copy = {
  zh: {
    navStatus: "PREFLIGHT AGENT · 实验运行中",
    openLedger: "查看账本 ↓",
    eyebrow: "AGENT 可靠性层",
    heroA: "行动之前",
    heroB: "先有",
    heroAccent: "把握。",
    intro: "在 AI Agent 花钱、改代码或接触生产系统之前，先预测它能不能真正完成任务。",
    calibration: "校准分",
    proof: "每次预测都会在执行前封存，并接受真实结果检验。",
    newAssessment: "新建评估",
    assessmentMode: "评估类型",
    projectMode: "项目机会",
    taskMode: "任务执行",
    agentMode: "Agent 审计",
    projectModeHint: "判断项目是否值得借鉴，并生成最小实验",
    taskModeHint: "预测 Coding Agent 完成具体任务的概率",
    agentModeHint: "检查你写的 Agent 提示词、计划或输出",
    taskBrief: "任务说明",
    taskPlaceholder: "描述 Agent 需要完成的任务……",
    repoContext: "仓库或上下文",
    repoPlaceholder: "github.com/组织/仓库",
    modelRoute: "模型路由：DeepSeek → OpenAI → 本地",
    verifier: "验证器：测试 + DIFF",
    assessing: "AGENT 评估中",
    run: "运行 PREFLIGHT",
    decisionToken: "决策令牌",
    sealed: "已封存",
    successProbability: "成功概率",
    opportunityScore: "项目机会分",
    executionProbability: "实验执行成功率",
    rubric: "机会评分依据",
    recommendedExperiment: "推荐最小实验",
    repositoryEvidence: "自动读取的仓库证据",
    evidenceVerified: "GitHub 证据已验证",
    evidenceUnavailable: "未能读取 GitHub 证据",
    demand: "需求",
    momentum: "趋势",
    differentiation: "差异化",
    buildability: "可构建性",
    distribution: "传播性",
    evidence: "证据",
    reasoningGaps: "推理缺口",
    adversarialTests: "对抗验证",
    agentImprovement: "改进后的 Agent 指令",
    route: "路由",
    risk: "风险",
    time: "预计时间",
    cost: "预计成本",
    minutes: "分钟",
    failureModes: "可能失败模式",
    requiredVerification: "必须验证",
    policy: "策略",
    assumptions: "关键假设",
    agentLoop: "AGENT 决策闭环",
    goalSummary: "目标复述",
    evidenceQuality: "证据质量",
    missingContextTitle: "缺失上下文",
    preconditions: "执行前置条件",
    abortConditions: "中止条件",
    guardrails: "守门器调整",
    noMissingContext: "未发现关键上下文缺口",
    realityLedger: "真实结果账本",
    ledgerTitle: "让自信接受结果检验。",
    runs: "运行记录",
    benchmark: "排行榜",
    resolvedRuns: "已结算任务",
    actualSuccess: "实际成功率",
    calibrationMetric: "校准度",
    brier: "BRIER 分数 ↓",
    task: "任务",
    prediction: "预测",
    outcome: "结果",
    lowRisk: "低风险",
    mediumRisk: "中风险",
    highRisk: "高风险",
    pass: "成功",
    fail: "失败",
    passed: "已成功",
    failed: "已失败",
    sampleData: "示例排行榜数据 · 接入真实运行后替换",
    capability: "能力不等于可靠性。",
    confidence: "未经校准的自信，只是更响亮的猜测。",
    footer: "AGENT 应该知道自己什么时候不知道。",
    prototype: "开源原型 · 2026",
    agentSource: "AI AGENT",
    localSource: "本地降级",
    sampleSource: "示例数据",
    fallback: "AI Agent 暂不可用，本次已使用可解释的本地风险规则，并明确标记为降级结果。",
    agentReady: "本次结果由 Preflight Agent 生成。",
    contextMissing: "未提供上下文",
  },
  en: {
    navStatus: "PREFLIGHT AGENT · EXPERIMENT LIVE",
    openLedger: "OPEN LEDGER ↓",
    eyebrow: "AGENT RELIABILITY LAYER",
    heroA: "Know before",
    heroB: "they",
    heroAccent: "go.",
    intro: "Predict whether an AI agent will succeed before it spends money, edits code, or touches production.",
    calibration: "CALIBRATION SCORE",
    proof: "Every forecast is sealed before execution and scored against the real outcome.",
    newAssessment: "NEW ASSESSMENT",
    assessmentMode: "ASSESSMENT TYPE",
    projectMode: "PROJECT OPPORTUNITY",
    taskMode: "TASK EXECUTION",
    agentMode: "AGENT AUDIT",
    projectModeHint: "Judge whether a project is worth learning from and propose a minimum experiment",
    taskModeHint: "Predict whether a coding agent can complete a specific task",
    agentModeHint: "Audit your agent prompt, plan, or visible output",
    taskBrief: "TASK BRIEF",
    taskPlaceholder: "Describe what the agent should accomplish...",
    repoContext: "REPOSITORY OR CONTEXT",
    repoPlaceholder: "github.com/org/repo",
    modelRoute: "MODEL ROUTE: DEEPSEEK → OPENAI → LOCAL",
    verifier: "VERIFIER: TEST + DIFF",
    assessing: "ASSESSING TASK",
    run: "RUN PREFLIGHT",
    decisionToken: "DECISION TOKEN",
    sealed: "SEALED",
    successProbability: "SUCCESS PROBABILITY",
    opportunityScore: "OPPORTUNITY SCORE",
    executionProbability: "EXPERIMENT SUCCESS PROBABILITY",
    rubric: "OPPORTUNITY RUBRIC",
    recommendedExperiment: "RECOMMENDED MINIMUM EXPERIMENT",
    repositoryEvidence: "AUTOMATIC REPOSITORY EVIDENCE",
    evidenceVerified: "GitHub evidence verified",
    evidenceUnavailable: "GitHub evidence unavailable",
    demand: "DEMAND",
    momentum: "MOMENTUM",
    differentiation: "DIFFERENTIATION",
    buildability: "BUILDABILITY",
    distribution: "DISTRIBUTION",
    evidence: "EVIDENCE",
    reasoningGaps: "REASONING GAPS",
    adversarialTests: "ADVERSARIAL TESTS",
    agentImprovement: "IMPROVED AGENT INSTRUCTION",
    route: "ROUTE",
    risk: "RISK",
    time: "EST. TIME",
    cost: "EST. COST",
    minutes: "MIN",
    failureModes: "LIKELY FAILURE MODES",
    requiredVerification: "REQUIRED VERIFICATION",
    policy: "POLICY",
    assumptions: "KEY ASSUMPTIONS",
    agentLoop: "AGENT DECISION LOOP",
    goalSummary: "GOAL RESTATEMENT",
    evidenceQuality: "EVIDENCE QUALITY",
    missingContextTitle: "MISSING CONTEXT",
    preconditions: "PRECONDITIONS",
    abortConditions: "ABORT CONDITIONS",
    guardrails: "GUARD ADJUSTMENTS",
    noMissingContext: "No material context gaps detected",
    realityLedger: "REALITY LEDGER",
    ledgerTitle: "Confidence meets consequence.",
    runs: "RUNS",
    benchmark: "BENCHMARK",
    resolvedRuns: "RESOLVED RUNS",
    actualSuccess: "ACTUAL SUCCESS",
    calibrationMetric: "CALIBRATION",
    brier: "BRIER SCORE ↓",
    task: "TASK",
    prediction: "PREDICTION",
    outcome: "OUTCOME",
    lowRisk: "LOW RISK",
    mediumRisk: "MEDIUM RISK",
    highRisk: "HIGH RISK",
    pass: "PASS",
    fail: "FAIL",
    passed: "PASSED",
    failed: "FAILED",
    sampleData: "SAMPLE BENCHMARK DATA · REPLACE WITH LIVE RUNS",
    capability: "CAPABILITY IS NOT RELIABILITY.",
    confidence: "CONFIDENCE WITHOUT CALIBRATION IS JUST VOLUME.",
    footer: "THE AGENT SHOULD KNOW WHEN IT DOESN'T KNOW.",
    prototype: "OPEN PROTOTYPE · 2026",
    agentSource: "AI AGENT",
    localSource: "LOCAL FALLBACK",
    sampleSource: "SAMPLE DATA",
    fallback: "The AI agent was unavailable. This run used explainable local risk rules and is clearly marked as a fallback.",
    agentReady: "This result was generated by the Preflight Agent.",
    contextMissing: "Context not supplied",
  },
} as const;

const sampleRuns: Run[] = [
  {
    id: "sample-1",
    task: "修复支付回调重复处理，并补充幂等性测试",
    repo: "payments/api",
    probability: 61,
    cost: 2.18,
    minutes: 34,
    route: "REVIEW",
    risk: "HIGH",
    outcome: "failed",
    createdAt: "2026-07-20",
    risks: ["状态变更不可逆", "并发边界条件"],
    checks: ["运行支付模块测试", "验证并发环境下的幂等性"],
    policy: "在隔离环境执行，合并前必须人工审查。",
    assumptions: ["仓库包含可运行的支付测试"],
    source: "sample",
    model: "sample",
  },
  {
    id: "sample-2",
    task: "修正价格对比表在手机端的间距",
    repo: "web/marketing",
    probability: 91,
    cost: 0.54,
    minutes: 8,
    route: "AUTORUN",
    risk: "LOW",
    outcome: "success",
    createdAt: "2026-07-20",
    risks: ["视觉回归"],
    checks: ["构建应用", "检查响应式布局"],
    policy: "允许自动执行，但保留构建与视觉检查。",
    assumptions: ["变更仅涉及样式"],
    source: "sample",
    model: "sample",
  },
  {
    id: "sample-3",
    task: "升级认证中间件，同时保证现有会话不失效",
    repo: "platform/core",
    probability: 48,
    cost: 3.42,
    minutes: 52,
    route: "ESCALATE",
    risk: "HIGH",
    outcome: "failed",
    createdAt: "2026-07-19",
    risks: ["认证边界", "缺少运行时上下文"],
    checks: ["运行认证集成测试", "验证存量会话"],
    policy: "暂停执行，补充会话与部署上下文后再评估。",
    assumptions: ["存在可复现的会话测试环境"],
    source: "sample",
    model: "sample",
  },
  {
    id: "sample-4",
    task: "为已结算任务表格增加 CSV 导出",
    repo: "ops/console",
    probability: 83,
    cost: 0.91,
    minutes: 16,
    route: "REVIEW",
    risk: "MEDIUM",
    outcome: "success",
    createdAt: "2026-07-18",
    risks: ["数据转义格式"],
    checks: ["测试特殊字符转义", "构建应用"],
    policy: "在沙箱执行，导出内容通过测试后允许合并。",
    assumptions: ["导出数据量适合浏览器处理"],
    source: "sample",
    model: "sample",
  },
];

const benchmarkRows = [
  { name: "Codex runner", tasks: 128, success: 76, calibration: 88, brier: ".142" },
  { name: "Claude runner", tasks: 128, success: 79, calibration: 81, brier: ".168" },
  { name: "Gemini runner", tasks: 128, success: 71, calibration: 73, brier: ".194" },
];

function hashText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createLocalAssessment(task: string, repo: string, language: Language, mode: AssessmentMode = "task"): Run {
  const normalized = task.toLowerCase();
  const dangerous = [
    "production", "payment", "database", "delete", "migration", "auth", "security", "deploy", "infra", "permission",
    "生产", "支付", "数据库", "删除", "迁移", "认证", "安全", "部署", "权限",
  ].filter((term) => normalized.includes(term));
  const simple = ["copy", "css", "typo", "readme", "docs", "spacing", "文案", "样式", "错别字", "间距"].filter(
    (term) => normalized.includes(term),
  );
  const ambiguity = task.trim().length < 24 ? 12 : 0;
  const contextPenalty = repo.trim() ? 0 : 9;
  const riskScore = Math.max(8, Math.min(100, 31 + dangerous.length * 9 + ambiguity + contextPenalty - simple.length * 9));
  const jitter = (hashText(`${task}:${repo}`) % 11) - 5;
  const probability = Math.max(22, Math.min(94, Math.round(101 - riskScore * 0.68 + jitter)));
  const risk: Run["risk"] = probability >= 82 ? "LOW" : probability >= 58 ? "MEDIUM" : "HIGH";
  const route: Run["route"] = probability >= 85 ? "AUTORUN" : probability >= 58 ? "REVIEW" : "ESCALATE";
  const minutes = Math.round(7 + riskScore * 0.52 + (hashText(task) % 9));
  const cost = Number((0.28 + riskScore * 0.031 + (hashText(repo) % 25) / 100).toFixed(2));
  const zh = language === "zh";

  const risks: string[] = [];
  if (dangerous.some((term) => ["payment", "database", "delete", "migration", "支付", "数据库", "删除", "迁移"].includes(term))) {
    risks.push(zh ? "可能产生不可逆状态变更" : "Potentially irreversible state mutation");
  }
  if (dangerous.some((term) => ["auth", "security", "permission", "认证", "安全", "权限"].includes(term))) {
    risks.push(zh ? "涉及安全或权限边界" : "Security or permission boundary");
  }
  if (!repo.trim()) risks.push(zh ? "缺少仓库上下文" : "Repository context is missing");
  if (ambiguity) risks.push(zh ? "成功标准描述不足" : "Success criteria are underspecified");
  if (!risks.length) risks.push(zh ? "变更范围外可能出现回归" : "Regression outside the changed surface");

  const checks = zh
    ? ["运行仓库测试套件", "核对最终差异是否超出任务范围"]
    : ["Run the repository test suite", "Inspect the final diff against task scope"];
  if (normalized.includes("数据库") || normalized.includes("migration") || normalized.includes("database")) {
    checks.unshift(zh ? "在隔离数据库验证迁移" : "Validate migration on an isolated database");
  }
  if (simple.length) checks.push(zh ? "检查响应式与视觉表现" : "Verify responsive and visual behavior");

  const policy = route === "AUTORUN"
    ? (zh ? "允许自动执行，但必须保留确定性验证。" : "Proceed autonomously with deterministic verification enabled.")
    : route === "REVIEW"
      ? (zh ? "在沙箱执行，合并前必须人工审查。" : "Execute in a sandbox and require human review before merge.")
      : (zh ? "暂停执行，先补充上下文或切换更强模型。" : "Pause execution, request context, or route to a stronger agent.");

  return {
    id: `run-${Date.now()}`,
    task: task.trim(),
    repo: repo.trim() || copy[language].contextMissing,
    probability,
    cost,
    minutes,
    route,
    risk,
    outcome: "pending",
    createdAt: new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { dateStyle: "medium" }).format(new Date()),
    risks,
    checks,
    policy,
    assumptions: [zh ? "未读取仓库文件，仅根据任务描述评估" : "No repository files were read; assessment uses the task brief only"],
    source: "local",
    model: "local-rules-v1",
    provider: "local",
    goalSummary: task.trim(),
    confidenceQuality: "LOW",
    missingContext: [
      ...(!repo.trim() ? [zh ? "需要仓库结构、关键文件或可复现环境" : "Repository structure, relevant files, or a reproducible environment"] : []),
      ...(ambiguity ? [zh ? "需要更明确的成功标准与范围边界" : "Clearer success criteria and scope boundaries"] : []),
    ],
    preconditions: zh
      ? ["确认成功标准和允许修改的范围", "在隔离环境保留可回滚点"]
      : ["Confirm success criteria and the allowed change surface", "Create a rollback point in an isolated environment"],
    abortConditions: zh
      ? ["验证环境不可用或最终差异超出任务范围时停止"]
      : ["Stop when verification is unavailable or the final diff exceeds task scope"],
    guardrails: [],
    riskSignals: risks,
    stages: ["SENSE", "GUARD"],
    assessmentKind: mode === "project" ? "PROJECT_OPPORTUNITY" : mode === "agent" ? "AGENT_AUDIT" : "TASK_FEASIBILITY",
    opportunityScore: mode === "project" ? probability : null,
    rubricScores: null,
    recommendedExperiment: mode === "project"
      ? (zh ? "先用 7 天构建一个只验证核心需求与差异化假设的最小原型。" : "Build a seven-day prototype that tests only the core demand and differentiation assumptions.")
      : null,
    reasoningGaps: mode === "agent" ? risks : [],
    adversarialTests: mode === "agent" ? checks : [],
    agentImprovement: mode === "agent"
      ? (zh ? "先明确输入、可用工具、成功标准和停止条件；每个关键结论必须对应可观察证据。" : "Define inputs, tools, success criteria, and stop conditions; connect every material claim to observable evidence.")
      : null,
    repositoryEvidence: { status: "unavailable" },
  };
}

function mapAgentAssessment(response: AgentResponse, task: string, repo: string, language: Language): Run {
  const assessment = response.assessment!;
  return {
    id: `run-${Date.now()}`,
    task: task.trim(),
    repo: repo.trim() || copy[language].contextMissing,
    probability: assessment.success_probability,
    cost: Number(assessment.estimated_cost_usd.toFixed(2)),
    minutes: assessment.estimated_minutes,
    route: assessment.route,
    risk: assessment.risk,
    outcome: "pending",
    createdAt: new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { dateStyle: "medium" }).format(new Date()),
    risks: assessment.failure_modes,
    checks: assessment.verification_steps,
    policy: assessment.policy,
    assumptions: assessment.assumptions,
    source: "agent",
    model: response.model || "AI model",
    provider: response.provider || "agent",
    latencyMs: response.latency_ms,
    goalSummary: assessment.goal_summary,
    confidenceQuality: assessment.confidence_quality,
    missingContext: assessment.missing_context,
    preconditions: assessment.preconditions,
    abortConditions: assessment.abort_conditions,
    guardrails: assessment.guardrails_applied,
    riskSignals: response.trace?.risk_signals || [],
    stages: response.trace?.stages || ["SENSE", "CHALLENGE", "DECIDE", "GUARD"],
    assessmentKind: assessment.assessment_kind,
    opportunityScore: assessment.opportunity_score,
    rubricScores: assessment.rubric_scores,
    recommendedExperiment: assessment.recommended_experiment,
    reasoningGaps: assessment.reasoning_gaps,
    adversarialTests: assessment.adversarial_tests,
    agentImprovement: assessment.agent_improvement,
    repositoryEvidence: response.trace?.repository_evidence,
  };
}

function brierScore(runs: Run[]) {
  const resolved = runs.filter((run) => run.outcome !== "pending");
  if (!resolved.length) return 0;
  return resolved.reduce((sum, run) => {
    const outcome = run.outcome === "success" ? 1 : 0;
    return sum + (run.probability / 100 - outcome) ** 2;
  }, 0) / resolved.length;
}

export function PreflightApp() {
  const [language, setLanguage] = useState<Language>("zh");
  const [mode, setMode] = useState<AssessmentMode>("project");
  const [task, setTask] = useState("修复支付服务中的重复 Webhook 处理，并补充幂等性测试");
  const [repo, setRepo] = useState("github.com/acme/payments-api");
  const [runs, setRuns] = useState<Run[]>(sampleRuns);
  const [activeRun, setActiveRun] = useState<Run>(() => createLocalAssessment(
    "修复支付服务中的重复 Webhook 处理，并补充幂等性测试",
    "github.com/acme/payments-api",
    "zh",
  ));
  const [analyzing, setAnalyzing] = useState(false);
  const [activeView, setActiveView] = useState<"runs" | "benchmark">("runs");
  const [notice, setNotice] = useState("");
  const t = copy[language];

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const storedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
      if (storedLanguage === "zh" || storedLanguage === "en") setLanguage(storedLanguage);
      const storedRuns = window.localStorage.getItem(STORAGE_KEY);
      if (storedRuns) {
        try {
          setRuns(JSON.parse(storedRuns) as Run[]);
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  }, [runs]);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const metrics = useMemo(() => {
    const resolved = runs.filter((run) => run.outcome !== "pending");
    const successes = resolved.filter((run) => run.outcome === "success").length;
    const brier = brierScore(runs);
    return {
      resolved: resolved.length,
      successRate: resolved.length ? Math.round((successes / resolved.length) * 100) : 0,
      calibration: resolved.length ? Math.max(0, Math.round((1 - brier) * 100)) : 0,
      brier: brier.toFixed(3),
    };
  }, [runs]);

  async function runPreflight(event: FormEvent) {
    event.preventDefault();
    if (!task.trim()) return;
    setAnalyzing(true);
    setNotice("");

    let assessment: Run;
    try {
      const request = await fetch("/api/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, repository: repo, language, mode }),
      });
      const response = await request.json() as AgentResponse;
      if (!request.ok || !response.ok || !response.assessment) throw new Error(response.code || "AGENT_UNAVAILABLE");
      assessment = mapAgentAssessment(response, task, repo, language);
      setNotice(`${t.agentReady} ${response.provider ? `${response.provider.toUpperCase()} · ` : ""}${response.model || ""}`.trim());
    } catch {
      assessment = createLocalAssessment(task, repo, language, mode);
      setNotice(t.fallback);
    }

    setActiveRun(assessment);
    setRuns((current) => [assessment, ...current]);
    setAnalyzing(false);
  }

  function resolveRun(id: string, outcome: Exclude<Outcome, "pending">) {
    setRuns((current) => current.map((run) => (run.id === id ? { ...run, outcome } : run)));
    if (activeRun.id === id) setActiveRun((current) => ({ ...current, outcome }));
  }

  function riskLabel(risk: Run["risk"]) {
    if (risk === "LOW") return t.lowRisk;
    if (risk === "MEDIUM") return t.mediumRisk;
    return t.highRisk;
  }

  function sourceLabel(run: Run) {
    if (run.source === "agent") {
      const provider = run.provider ? `${run.provider.toUpperCase()} · ` : "";
      const latency = run.latencyMs ? ` · ${run.latencyMs}ms` : "";
      return `${t.agentSource} · ${provider}${run.model}${latency}`;
    }
    if (run.source === "sample") return t.sampleSource;
    return t.localSource;
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="SelfOdds home">
          <span className="brand-mark" aria-hidden="true">S/O</span><span>SELFODDS</span>
        </a>
        <div className="header-status"><span className="live-dot" aria-hidden="true" />{t.navStatus}</div>
        <div className="header-actions">
          <div className="language-switch" aria-label="Language switcher">
            <button className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>中文</button>
            <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
          </div>
          <a className="header-link" href="#ledger">{t.openLedger}</a>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span>01</span>{t.eyebrow}</div>
        <div className="hero-grid">
          <div className="hero-copy">
            <h1>{t.heroA}<br />{t.heroB} <em>{t.heroAccent}</em></h1>
            <p>{t.intro}</p>
          </div>
          <div className="hero-proof">
            <div className="proof-number">{metrics.calibration}<small>/100</small></div>
            <span>{t.calibration}</span><p>{t.proof}</p>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Agent preflight workspace">
        <form className="task-panel" onSubmit={runPreflight}>
          <div className="panel-heading"><span>{t.newAssessment}</span><span className="step-label">INPUT / 01</span></div>
          <label>{t.assessmentMode}</label>
          <div className="mode-switch" role="group" aria-label={t.assessmentMode}>
            <button type="button" className={mode === "project" ? "active" : ""} onClick={() => setMode("project")}>
              <strong>{t.projectMode}</strong><span>{t.projectModeHint}</span>
            </button>
            <button type="button" className={mode === "task" ? "active" : ""} onClick={() => setMode("task")}>
              <strong>{t.taskMode}</strong><span>{t.taskModeHint}</span>
            </button>
            <button type="button" className={mode === "agent" ? "active" : ""} onClick={() => setMode("agent")}>
              <strong>{t.agentMode}</strong><span>{t.agentModeHint}</span>
            </button>
          </div>
          <label htmlFor="task">{t.taskBrief}</label>
          <textarea id="task" value={task} onChange={(event) => setTask(event.target.value)} rows={5} placeholder={t.taskPlaceholder} required />
          <label htmlFor="repo">{t.repoContext}</label>
          <input id="repo" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder={t.repoPlaceholder} />
          <div className="input-meta"><span>{t.modelRoute}</span><span>{t.verifier}</span></div>
          <button className="primary-button" type="submit" disabled={analyzing}>
            <span>{analyzing ? t.assessing : t.run}</span><b aria-hidden="true">{analyzing ? "···" : "↗"}</b>
          </button>
          {notice && <p className={`agent-notice notice-${activeRun.source}`} role="status">{notice}</p>}
        </form>

        <article className={`result-panel risk-${activeRun.risk.toLowerCase()}`} aria-live="polite">
          <div className="panel-heading dark">
            <span>{t.decisionToken}</span><span className="sealed">{t.sealed} · {activeRun.createdAt}</span>
          </div>
          <div className="source-chip">{sourceLabel(activeRun)}</div>
          <div className="agent-loop" aria-label={t.agentLoop}>
            <strong>{t.agentLoop}</strong>
            {(activeRun.stages || ["SENSE", "GUARD"]).map((stage, index, stages) => (
              <span key={stage}>{stage}{index < stages.length - 1 ? " →" : ""}</span>
            ))}
          </div>
          {activeRun.goalSummary && (
            <div className="goal-summary"><span>{t.goalSummary}</span><p>{activeRun.goalSummary}</p></div>
          )}
          {activeRun.assessmentKind === "PROJECT_OPPORTUNITY" && activeRun.opportunityScore !== null && activeRun.opportunityScore !== undefined && (
            <section className="opportunity-card">
              <div className="opportunity-score"><strong>{activeRun.opportunityScore}</strong><span>/100<br />{t.opportunityScore}</span></div>
              {activeRun.rubricScores && (
                <div className="rubric-grid">
                  {([
                    ["demand", t.demand], ["momentum", t.momentum], ["differentiation", t.differentiation],
                    ["buildability", t.buildability], ["distribution", t.distribution], ["evidence", t.evidence],
                  ] as const).map(([key, label]) => <div key={key}><span>{label}</span><strong>{activeRun.rubricScores![key]}</strong></div>)}
                </div>
              )}
              {activeRun.recommendedExperiment && <div className="experiment-line"><span>{t.recommendedExperiment}</span><p>{activeRun.recommendedExperiment}</p></div>}
            </section>
          )}
          {activeRun.repositoryEvidence && (
            <div className={`repository-evidence evidence-${activeRun.repositoryEvidence.status}`}>
              <span>{t.repositoryEvidence}</span>
              <p>{activeRun.repositoryEvidence.status === "verified" ? t.evidenceVerified : t.evidenceUnavailable}
                {activeRun.repositoryEvidence.full_name ? ` · ${activeRun.repositoryEvidence.full_name}` : ""}
                {activeRun.repositoryEvidence.stars !== undefined ? ` · ★ ${activeRun.repositoryEvidence.stars.toLocaleString()}` : ""}
                {activeRun.repositoryEvidence.language ? ` · ${activeRun.repositoryEvidence.language}` : ""}
                {activeRun.repositoryEvidence.license ? ` · ${activeRun.repositoryEvidence.license}` : ""}
              </p>
            </div>
          )}
          {activeRun.assessmentKind === "AGENT_AUDIT" && (
            <section className="agent-audit-card">
              <div><h2>{t.reasoningGaps}</h2><ul>{(activeRun.reasoningGaps || []).map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h2>{t.adversarialTests}</h2><ol>{(activeRun.adversarialTests || []).map((item) => <li key={item}>{item}</li>)}</ol></div>
              {activeRun.agentImprovement && <div className="agent-improvement"><h2>{t.agentImprovement}</h2><p>{activeRun.agentImprovement}</p></div>}
            </section>
          )}
          <div className="decision-topline">
            <div className="probability-wrap"><div className="probability">{activeRun.probability}<sup>%</sup></div><span>{activeRun.assessmentKind === "PROJECT_OPPORTUNITY" ? t.executionProbability : t.successProbability}</span></div>
            <div className="route-badge"><span>{t.route}</span><strong>{activeRun.route}</strong></div>
          </div>
          <div className="confidence-track" aria-label={`${activeRun.probability}%`}><span style={{ width: `${activeRun.probability}%` }} /></div>
          <div className="estimate-grid">
            <div><span>{t.risk}</span><strong>{riskLabel(activeRun.risk)}</strong></div>
            <div><span>{t.evidenceQuality}</span><strong>{activeRun.confidenceQuality || "LOW"}</strong></div>
            <div><span>{t.time}</span><strong>{activeRun.minutes} {t.minutes}</strong></div>
            <div><span>{t.cost}</span><strong>${activeRun.cost.toFixed(2)}</strong></div>
          </div>
          <div className="result-lists">
            <div><h2>{t.failureModes}</h2><ul>{activeRun.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>
            <div><h2>{t.requiredVerification}</h2><ol>{activeRun.checks.map((check) => <li key={check}>{check}</li>)}</ol></div>
          </div>
          <div className="decision-details">
            <div>
              <h2>{t.missingContextTitle}</h2>
              {(activeRun.missingContext || []).length > 0
                ? <ul>{activeRun.missingContext!.map((item) => <li key={item}>{item}</li>)}</ul>
                : <p>{t.noMissingContext}</p>}
            </div>
            <div><h2>{t.preconditions}</h2><ul>{(activeRun.preconditions || []).map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div><h2>{t.abortConditions}</h2><ul>{(activeRun.abortConditions || []).map((item) => <li key={item}>{item}</li>)}</ul></div>
          </div>
          <div className="policy-line"><span>{t.policy}</span><p>{activeRun.policy}</p></div>
          {(activeRun.guardrails || []).length > 0 && (
            <div className="guardrail-line"><span>{t.guardrails}</span><ul>{activeRun.guardrails!.map((item) => <li key={item}>{item}</li>)}</ul></div>
          )}
          {activeRun.assumptions.length > 0 && (
            <details className="assumptions"><summary>{t.assumptions}</summary><ul>{activeRun.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></details>
          )}
        </article>
      </section>

      <section className="ledger" id="ledger">
        <div className="section-title-row">
          <div><div className="eyebrow"><span>02</span>{t.realityLedger}</div><h2>{t.ledgerTitle}</h2></div>
          <div className="view-tabs" role="tablist" aria-label="Ledger views">
            <button role="tab" aria-selected={activeView === "runs"} className={activeView === "runs" ? "active" : ""} onClick={() => setActiveView("runs")}>{t.runs}</button>
            <button role="tab" aria-selected={activeView === "benchmark"} className={activeView === "benchmark" ? "active" : ""} onClick={() => setActiveView("benchmark")}>{t.benchmark}</button>
          </div>
        </div>
        <div className="metric-strip">
          <div><span>{t.resolvedRuns}</span><strong>{metrics.resolved}</strong></div>
          <div><span>{t.actualSuccess}</span><strong>{metrics.successRate}%</strong></div>
          <div><span>{t.calibrationMetric}</span><strong>{metrics.calibration}</strong></div>
          <div><span>{t.brier}</span><strong>{metrics.brier}</strong></div>
        </div>

        {activeView === "runs" ? (
          <div className="run-list" role="tabpanel">
            <div className="run-row run-head"><span>{t.task}</span><span>{t.prediction}</span><span>{t.route}</span><span>{t.outcome}</span></div>
            {runs.slice(0, 8).map((run) => (
              <div className="run-row" key={run.id}>
                <div className="run-task"><strong>{run.task}</strong><span>{run.repo} · {run.createdAt} · {sourceLabel(run)}</span></div>
                <div className="run-prediction"><strong>{run.probability}%</strong><span>{riskLabel(run.risk)}</span></div>
                <div><span className={`mini-route route-${run.route.toLowerCase()}`}>{run.route}</span></div>
                <div className="outcome-cell">
                  {run.outcome === "pending" ? (
                    <div className="resolve-actions" aria-label={`Resolve ${run.task}`}>
                      <button onClick={() => resolveRun(run.id, "success")}>{t.pass}</button>
                      <button onClick={() => resolveRun(run.id, "failed")}>{t.fail}</button>
                    </div>
                  ) : <span className={`outcome outcome-${run.outcome}`}>{run.outcome === "success" ? t.passed : t.failed}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="benchmark" role="tabpanel">
            <div className="benchmark-note">{t.sampleData}</div>
            {benchmarkRows.map((row, index) => (
              <div className="benchmark-row" key={row.name}>
                <span className="rank">0{index + 1}</span><strong>{row.name}</strong><span>{row.tasks} TASKS</span><span>{row.success}% SUCCESS</span><span>{row.calibration} CALIBRATION</span><span>{row.brier} BRIER</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="manifesto"><p>{t.capability}</p><p>{t.confidence}</p></section>
      <footer>
        <div className="brand footer-brand"><span className="brand-mark">S/O</span><span>SELFODDS</span></div>
        <p>{t.footer}</p><span>{t.prototype}</span>
      </footer>
    </main>
  );
}
