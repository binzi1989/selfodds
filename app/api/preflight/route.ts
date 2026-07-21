import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { compactRepositoryEvidence, fetchRepositoryEvidence, type RepositoryEvidence } from "../../../lib/github-evidence.ts";

const RequestSchema = z.object({
  task: z.string().trim().min(8).max(6000),
  repository: z.string().trim().max(1000).optional().default(""),
  language: z.enum(["zh", "en"]).optional().default("zh"),
  mode: z.enum(["auto", "project", "task", "agent"]).optional().default("auto"),
});

const AssessmentSchema = z.object({
  goal_summary: z.string().min(8).max(240),
  assessment_kind: z.enum(["PROJECT_OPPORTUNITY", "TASK_FEASIBILITY", "AGENT_AUDIT"]),
  opportunity_score: z.number().int().min(5).max(95).nullable(),
  rubric_scores: z.object({
    demand: z.number().int().min(0).max(100),
    momentum: z.number().int().min(0).max(100),
    differentiation: z.number().int().min(0).max(100),
    buildability: z.number().int().min(0).max(100),
    distribution: z.number().int().min(0).max(100),
    evidence: z.number().int().min(0).max(100),
  }).nullable(),
  recommended_experiment: z.string().min(8).max(320).nullable(),
  reasoning_gaps: z.array(z.string().min(3).max(220)).max(6),
  adversarial_tests: z.array(z.string().min(3).max(220)).max(6),
  agent_improvement: z.string().min(8).max(900).nullable(),
  success_probability: z.number().int().min(5).max(95),
  confidence_quality: z.enum(["LOW", "MEDIUM", "HIGH"]),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  route: z.enum(["AUTORUN", "REVIEW", "ESCALATE"]),
  estimated_minutes: z.number().int().min(1).max(1440),
  estimated_cost_usd: z.number().min(0.01).max(1000),
  missing_context: z.array(z.string().min(3).max(180)).max(5),
  preconditions: z.array(z.string().min(3).max(180)).min(1).max(6),
  failure_modes: z.array(z.string().min(3).max(180)).min(1).max(5),
  verification_steps: z.array(z.string().min(3).max(180)).min(2).max(6),
  abort_conditions: z.array(z.string().min(3).max(180)).min(1).max(5),
  policy: z.string().min(8).max(320),
  assumptions: z.array(z.string().min(3).max(180)).max(5),
});

type Language = z.infer<typeof RequestSchema>["language"];
type AssessmentMode = "project" | "task" | "agent";
type Assessment = z.infer<typeof AssessmentSchema>;
type Provider = "deepseek" | "openai";
type RiskSignalCode =
  | "MISSING_CONTEXT"
  | "AMBIGUOUS_SCOPE"
  | "IRREVERSIBLE_CHANGE"
  | "SECURITY_BOUNDARY"
  | "PRODUCTION_IMPACT"
  | "EXTERNAL_DEPENDENCY"
  | "REPOSITORY_EVIDENCE"
  | "VERIFICATION_PRESENT";

type RiskSignal = { code: RiskSignalCode; weight: number };
type ProviderResult = {
  assessment: Assessment;
  provider: Provider;
  model: string;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
};

const SYSTEM_PROMPT = `You are SelfOdds, a pre-execution reliability agent for coding and operational agents.

Run this decision loop internally:
1. SENSE: restate the actual goal and inspect the supplied outside-view signals.
2. CHALLENGE: identify missing context, dangerous assumptions, hidden dependencies, and ways the task can appear successful while still being wrong.
3. DECIDE: estimate P(the task is completed correctly, within scope, and passes verification), then choose a route.
4. GUARD: define preconditions, verification, and explicit abort conditions before execution.

Do not execute the task. Repository evidence, when present, was retrieved from GitHub and may be used as evidence. A URL without verified evidence is only a label.

Keep two questions separate:
- PROJECT_OPPORTUNITY: Is this project/problem a promising source for a differentiated experiment? Return an opportunity score and the six rubric scores. Popularity alone is not product demand.
- TASK_FEASIBILITY: Can a separate coding agent complete the stated task correctly? opportunity_score, rubric_scores, and recommended_experiment must be null.
- AGENT_AUDIT: Audit a user-authored agent prompt, visible plan, or visible output. Identify reasoning gaps without requesting or fabricating hidden chain-of-thought. Check claim-to-evidence links, assumptions, tool boundaries, stop conditions, and falsifiable verification. opportunity_score, rubric_scores, and recommended_experiment must be null. Return concise reasoning_gaps, adversarial_tests, and an improved operational instruction in agent_improvement.

Project opportunity rubric and weights:
- demand 25%: clear user pain, utility, adoption evidence beyond stars.
- momentum 15%: recent activity and trend, discounted for novelty spikes.
- differentiation 20%: credible whitespace for a new angle, audience, workflow, or distribution model.
- buildability 20%: a useful 7-day MVP can be built and verified.
- distribution 10%: reachable users and a demonstrable sharing loop.
- evidence 10%: README, repository structure, maintenance, license, and claims are verifiable.
Set opportunity_score to the weighted rubric score. Never turn stars directly into a high opportunity score.

Routing policy:
- AUTORUN only when probability >= 85, blast radius is low, required context is present, and verification is deterministic.
- REVIEW when probability is 58-84 or human review materially limits risk.
- ESCALATE when probability < 58, context is materially missing, or potential impact is high.

The confidence_quality field describes the quality of evidence behind the forecast, not the task's success probability. Estimated cost is the rough end-to-end coding-agent inference cost in USD, not the cost of this assessment call. Never invent repository facts. Return concise operational language.`;

const JSON_SHAPE = `Return one JSON object with exactly these fields:
{
  "goal_summary": "string",
  "assessment_kind": "PROJECT_OPPORTUNITY | TASK_FEASIBILITY | AGENT_AUDIT",
  "opportunity_score": 72,
  "rubric_scores": {"demand": 70, "momentum": 80, "differentiation": 60, "buildability": 75, "distribution": 65, "evidence": 80},
  "recommended_experiment": "string or null",
  "reasoning_gaps": ["string"],
  "adversarial_tests": ["string"],
  "agent_improvement": "string or null",
  "success_probability": 70,
  "confidence_quality": "LOW | MEDIUM | HIGH",
  "risk": "LOW | MEDIUM | HIGH",
  "route": "AUTORUN | REVIEW | ESCALATE",
  "estimated_minutes": 30,
  "estimated_cost_usd": 1.25,
  "missing_context": ["string"],
  "preconditions": ["string"],
  "failure_modes": ["string"],
  "verification_steps": ["string", "string"],
  "abort_conditions": ["string"],
  "policy": "string",
  "assumptions": ["string"]
}`;

const signalCopy: Record<Language, Record<RiskSignalCode, string>> = {
  zh: {
    MISSING_CONTEXT: "未提供可验证的仓库或运行上下文",
    AMBIGUOUS_SCOPE: "任务范围或成功标准不够具体",
    IRREVERSIBLE_CHANGE: "可能涉及不可逆的数据或状态变更",
    SECURITY_BOUNDARY: "涉及认证、安全或权限边界",
    PRODUCTION_IMPACT: "可能影响生产、部署或基础设施",
    EXTERNAL_DEPENDENCY: "依赖外部 API、凭据或第三方状态",
    REPOSITORY_EVIDENCE: "已自动读取并验证 GitHub 仓库证据",
    VERIFICATION_PRESENT: "任务说明包含明确验证要求",
  },
  en: {
    MISSING_CONTEXT: "No verifiable repository or runtime context was supplied",
    AMBIGUOUS_SCOPE: "Task scope or success criteria are underspecified",
    IRREVERSIBLE_CHANGE: "Potentially irreversible data or state mutation",
    SECURITY_BOUNDARY: "Authentication, security, or permission boundary",
    PRODUCTION_IMPACT: "Potential production, deployment, or infrastructure impact",
    EXTERNAL_DEPENDENCY: "Depends on external APIs, credentials, or third-party state",
    REPOSITORY_EVIDENCE: "GitHub repository evidence was fetched and verified automatically",
    VERIFICATION_PRESENT: "The brief includes an explicit verification requirement",
  },
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function computeRiskSignals(task: string, repository: string, evidenceStatus: RepositoryEvidence["status"] = "unavailable"): RiskSignal[] {
  const text = task.toLowerCase();
  const signals: RiskSignal[] = [];
  if (!repository.trim() || evidenceStatus !== "verified") signals.push({ code: "MISSING_CONTEXT", weight: 14 });
  if (evidenceStatus === "verified") signals.push({ code: "REPOSITORY_EVIDENCE", weight: -14 });
  if (task.trim().length < 32) signals.push({ code: "AMBIGUOUS_SCOPE", weight: 12 });
  if (includesAny(text, ["delete", "migration", "database", "payment", "wipe", "删除", "迁移", "数据库", "支付", "清空"])) {
    signals.push({ code: "IRREVERSIBLE_CHANGE", weight: 20 });
  }
  if (includesAny(text, ["auth", "security", "permission", "secret", "credential", "认证", "安全", "权限", "密钥", "凭据"])) {
    signals.push({ code: "SECURITY_BOUNDARY", weight: 18 });
  }
  if (includesAny(text, ["production", "deploy", "infrastructure", "release", "生产", "部署", "基础设施", "发布"])) {
    signals.push({ code: "PRODUCTION_IMPACT", weight: 18 });
  }
  if (includesAny(text, ["api", "oauth", "webhook", "third-party", "external", "第三方", "外部", "回调"])) {
    signals.push({ code: "EXTERNAL_DEPENDENCY", weight: 10 });
  }
  if (includesAny(text, ["test", "verify", "acceptance", "测试", "验证", "验收"])) {
    signals.push({ code: "VERIFICATION_PRESENT", weight: -10 });
  }
  return signals;
}

function outsideViewPrior(signals: RiskSignal[]) {
  const riskScore = Math.max(8, Math.min(92, 24 + signals.reduce((sum, signal) => sum + signal.weight, 0)));
  return Math.max(18, Math.min(92, Math.round(101 - riskScore * 0.72)));
}

function routeRank(route: Assessment["route"]) {
  return { AUTORUN: 0, REVIEW: 1, ESCALATE: 2 }[route];
}

function riskRank(risk: Assessment["risk"]) {
  return { LOW: 0, MEDIUM: 1, HIGH: 2 }[risk];
}

export function applyDecisionGuard(
  candidate: Assessment,
  signals: RiskSignal[],
  language: Language,
): Assessment & { guardrails_applied: string[] } {
  const zh = language === "zh";
  let minimumRoute: Assessment["route"] = candidate.success_probability < 58 ? "ESCALATE"
    : candidate.success_probability < 85 ? "REVIEW" : "AUTORUN";
  let minimumRisk: Assessment["risk"] = candidate.success_probability < 58 ? "HIGH"
    : candidate.success_probability < 82 ? "MEDIUM" : "LOW";
  const guardrails: string[] = [];
  const highImpact = signals.some((signal) => ["IRREVERSIBLE_CHANGE", "SECURITY_BOUNDARY", "PRODUCTION_IMPACT"].includes(signal.code));
  const missingContext = signals.some((signal) => signal.code === "MISSING_CONTEXT");

  if (highImpact && minimumRoute === "AUTORUN") {
    minimumRoute = "REVIEW";
    guardrails.push(zh ? "高影响任务禁止直接自动执行" : "High-impact tasks cannot be routed directly to autorun");
  }
  if (highImpact && riskRank(minimumRisk) < riskRank("MEDIUM")) minimumRisk = "MEDIUM";
  if (missingContext && candidate.missing_context.length >= 2 && routeRank(minimumRoute) < routeRank("REVIEW")) {
    minimumRoute = "REVIEW";
    guardrails.push(zh ? "上下文不足时必须经过人工审查" : "Missing context requires human review");
  }
  if (routeRank(candidate.route) < routeRank(minimumRoute)) {
    guardrails.push(zh ? `路由由 ${candidate.route} 收紧为 ${minimumRoute}` : `Route tightened from ${candidate.route} to ${minimumRoute}`);
  }

  const route = routeRank(candidate.route) >= routeRank(minimumRoute) ? candidate.route : minimumRoute;
  const risk = riskRank(candidate.risk) >= riskRank(minimumRisk) ? candidate.risk : minimumRisk;
  return { ...candidate, route, risk, guardrails_applied: [...new Set(guardrails)] };
}

function languageInstruction(language: Language) {
  return language === "zh"
    ? "Return every human-readable string in Simplified Chinese."
    : "Return every human-readable string in English.";
}

export function resolveAssessmentMode(task: string, requested: z.infer<typeof RequestSchema>["mode"]): AssessmentMode {
  if (requested === "project" || requested === "task" || requested === "agent") return requested;
  const text = task.toLowerCase();
  return includesAny(text, [
    "项目", "产品", "机会", "需求", "值得", "仿照", "借鉴", "二次开发", "市场", "商业",
    "project", "product", "opportunity", "market", "clone", "inspired", "idea",
  ]) ? "project" : "task";
}

function normalizeOpportunityScore(assessment: Assessment, mode: AssessmentMode): Assessment {
  if (mode === "task" || mode === "agent") {
    return {
      ...assessment,
      assessment_kind: mode === "agent" ? "AGENT_AUDIT" : "TASK_FEASIBILITY",
      opportunity_score: null,
      rubric_scores: null,
      recommended_experiment: null,
      reasoning_gaps: mode === "agent" ? assessment.reasoning_gaps : [],
      adversarial_tests: mode === "agent" ? assessment.adversarial_tests : [],
      agent_improvement: mode === "agent" ? assessment.agent_improvement : null,
    };
  }
  if (!assessment.rubric_scores) return assessment;
  const score = Math.round(
    assessment.rubric_scores.demand * 0.25
    + assessment.rubric_scores.momentum * 0.15
    + assessment.rubric_scores.differentiation * 0.20
    + assessment.rubric_scores.buildability * 0.20
    + assessment.rubric_scores.distribution * 0.10
    + assessment.rubric_scores.evidence * 0.10,
  );
  return {
    ...assessment,
    assessment_kind: "PROJECT_OPPORTUNITY",
    opportunity_score: Math.max(5, Math.min(95, score)),
  };
}

function buildMessages(
  task: string,
  repository: string,
  language: Language,
  signals: RiskSignal[],
  mode: AssessmentMode,
  evidence: RepositoryEvidence,
) {
  const signalPayload = signals.map((signal) => ({
    code: signal.code,
    weight: signal.weight,
    description: signalCopy[language][signal.code],
  }));
  return {
    system: `${SYSTEM_PROMPT}\n\n${languageInstruction(language)}\n\n${JSON_SHAPE}`,
    user: `ASSESSMENT MODE:\n${mode === "project" ? "PROJECT_OPPORTUNITY" : mode === "agent" ? "AGENT_AUDIT" : "TASK_FEASIBILITY"}\n\nTASK, RESEARCH QUESTION, OR USER AGENT MATERIAL:\n${task}\n\nREPOSITORY INPUT:\n${repository || "Not supplied"}\n\nVERIFIED REPOSITORY EVIDENCE:\n${compactRepositoryEvidence(evidence)}\n\nOUTSIDE-VIEW PRIOR FOR EXECUTION SUCCESS:\n${outsideViewPrior(signals)}%\n\nDETERMINISTIC SIGNALS:\n${JSON.stringify(signalPayload)}`,
  };
}

function parseJsonAssessment(content: string | null) {
  if (!content) throw new Error("EMPTY_MODEL_RESULT");
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  const kind = value.assessment_kind;
  const estimatedMinutes = Number(value.estimated_minutes);
  const estimatedCost = Number(value.estimated_cost_usd);
  return AssessmentSchema.parse({
    opportunity_score: null,
    rubric_scores: null,
    recommended_experiment: null,
    reasoning_gaps: [],
    adversarial_tests: [],
    agent_improvement: null,
    ...value,
    assessment_kind: kind === "PROJECT_OPPORTUNITY" || kind === "AGENT_AUDIT" ? kind : "TASK_FEASIBILITY",
    estimated_minutes: Number.isFinite(estimatedMinutes) ? Math.max(1, Math.min(1440, Math.round(estimatedMinutes))) : 30,
    estimated_cost_usd: Number.isFinite(estimatedCost) ? Math.max(0.01, Math.min(1000, estimatedCost)) : 1,
  });
}

async function assessWithDeepSeek(
  task: string,
  repository: string,
  language: Language,
  signals: RiskSignal[],
  mode: AssessmentMode,
  evidence: RepositoryEvidence,
): Promise<ProviderResult> {
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    timeout: 45_000,
    maxRetries: 1,
  });
  const messages = buildMessages(task, repository, language, signals, mode, evidence);
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    response_format: { type: "json_object" },
    max_tokens: 3200,
  });
  const usage = response.usage;
  return {
    assessment: parseJsonAssessment(response.choices[0]?.message?.content ?? null),
    provider: "deepseek",
    model,
    usage: usage ? {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    } : null,
  };
}

async function assessWithOpenAI(
  task: string,
  repository: string,
  language: Language,
  signals: RiskSignal[],
  mode: AssessmentMode,
  evidence: RepositoryEvidence,
): Promise<ProviderResult> {
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45_000, maxRetries: 1 });
  const messages = buildMessages(task, repository, language, signals, mode, evidence);
  const response = await client.responses.parse({
    model,
    store: false,
    safety_identifier: "selfodds-private-prototype",
    reasoning: { effort: "medium" },
    input: [
      { role: "system", content: messages.system },
      { role: "user", content: messages.user },
    ],
    text: {
      verbosity: "low",
      format: zodTextFormat(AssessmentSchema, "preflight_assessment"),
    },
  });
  if (!response.output_parsed) throw new Error("EMPTY_MODEL_RESULT");
  return {
    assessment: response.output_parsed,
    provider: "openai",
    model,
    usage: response.usage ? {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.total_tokens,
    } : null,
  };
}

function configuredProviders(): Provider[] {
  const preferred = process.env.AI_PROVIDER?.toLowerCase();
  const available: Provider[] = [];
  if (process.env.DEEPSEEK_API_KEY) available.push("deepseek");
  if (process.env.OPENAI_API_KEY) available.push("openai");
  if (preferred === "openai") return available.sort((provider) => provider === "openai" ? -1 : 1);
  return available.sort((provider) => provider === "deepseek" ? -1 : 1);
}

function errorResponse(message: string, status: number, code: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, code, message, ...extra }, { status });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求内容不是有效的 JSON。", 400, "INVALID_JSON");
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) return errorResponse("请提供完整的任务说明。", 400, "INVALID_REQUEST");

  const providers = configuredProviders();
  if (!providers.length) {
    return errorResponse(
      "Preflight Agent 尚未配置 DeepSeek 或 OpenAI API 密钥，已允许前端使用本地降级评估。",
      503,
      "AGENT_NOT_CONFIGURED",
      { configured_providers: [] },
    );
  }

  const startedAt = Date.now();
  const mode = resolveAssessmentMode(parsed.data.task, parsed.data.mode);
  const repositoryEvidence = await fetchRepositoryEvidence(parsed.data.repository);
  const signals = computeRiskSignals(parsed.data.task, parsed.data.repository, repositoryEvidence.status);
  const attempted: Provider[] = [];

  for (const provider of providers) {
    attempted.push(provider);
    try {
      const result = provider === "deepseek"
        ? await assessWithDeepSeek(parsed.data.task, parsed.data.repository, parsed.data.language, signals, mode, repositoryEvidence)
        : await assessWithOpenAI(parsed.data.task, parsed.data.repository, parsed.data.language, signals, mode, repositoryEvidence);
      const normalized = normalizeOpportunityScore(result.assessment, mode);
      const guarded = applyDecisionGuard(normalized, signals, parsed.data.language);
      return Response.json({
        ok: true,
        source: "agent",
        provider: result.provider,
        model: result.model,
        agent_version: "research-preflight-v3",
        latency_ms: Date.now() - startedAt,
        assessment: guarded,
        trace: {
          stages: ["SENSE", "CHALLENGE", "DECIDE", "GUARD"],
          outside_view_prior: outsideViewPrior(signals),
          risk_signals: signals.map((signal) => signalCopy[parsed.data.language][signal.code]),
          attempted_providers: attempted,
          assessment_mode: mode,
          repository_evidence: {
            status: repositoryEvidence.status,
            full_name: repositoryEvidence.full_name,
            stars: repositoryEvidence.stars,
            forks: repositoryEvidence.forks,
            language: repositoryEvidence.language,
            license: repositoryEvidence.license,
            pushed_at: repositoryEvidence.pushed_at,
            root_files: repositoryEvidence.root_files,
            warning: repositoryEvidence.warning,
          },
        },
        usage: result.usage,
      });
    } catch (error) {
      console.error("SelfOdds provider failed", provider, error instanceof Error ? error.message : "unknown error");
      // Provider failures are intentionally opaque to clients; the next configured provider gets one attempt.
    }
  }

  return errorResponse(
    "Preflight Agent 暂时不可用，前端将使用本地降级评估。",
    502,
    "AGENT_UNAVAILABLE",
    { attempted_providers: attempted },
  );
}
