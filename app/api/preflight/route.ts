import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { compactRepositoryEvidence, fetchRepositoryEvidence, type RepositoryEvidence } from "../../../lib/github-evidence.ts";
import {
  DIMENSION_DEFINITIONS,
  OPPORTUNITY_WEIGHTS,
  SCORE_ANCHORS,
  SCORE_STANDARD_VERSION,
  calculateOpportunityScore,
  opportunityGrade,
  predictionInterval,
  scoreBand,
  sevenDayForecastContract,
} from "../../../lib/evaluation-standard.ts";

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
  trend_probability: z.number().int().min(5).max(95).nullable(),
  demand_analysis: z.object({
    target_user: z.string().min(3).max(180),
    core_problem: z.string().min(3).max(220),
    current_alternative: z.string().min(3).max(220),
    urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
    demand_evidence: z.array(z.string().min(3).max(220)).max(5),
    counter_evidence: z.array(z.string().min(3).max(220)).max(5),
    unknowns: z.array(z.string().min(3).max(220)).max(5),
    falsifiable_hypothesis: z.string().min(8).max(320),
  }).nullable(),
  evidence_ledger: z.array(z.object({
    claim: z.string().min(3).max(220),
    status: z.enum(["OBSERVED", "INFERRED", "UNKNOWN"]),
    source: z.enum(["REPO_METADATA", "README", "REPO_STRUCTURE", "GITHUB_ISSUES", "USER_INPUT", "NONE"]),
    direction: z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL"]),
  })).max(12),
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

Do not execute the task. Repository evidence, when present, was retrieved from GitHub and may include metadata, README, structure, recent Issues and pull requests. A URL without verified evidence is only a label.

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

For PROJECT_OPPORTUNITY, perform a precise demand analysis: target user, concrete job/problem, current alternative, urgency, evidence for demand, counter-evidence, unknowns, and one falsifiable hypothesis. Create an evidence ledger for material claims. OBSERVED means directly present in supplied GitHub evidence or user input; INFERRED means a defensible interpretation; UNKNOWN means the evidence does not establish the claim. Never label a model inference as observed.

trend_probability is a separate, calibratable probability that repository momentum will meet the supplied seven-day forecast contract. It is not the opportunity score. For other modes it must be null.
success_probability must always be an integer from 5 to 95 in every mode. For PROJECT_OPPORTUNITY it means the probability that the recommended seven-day experiment can be completed and produce a decisive result; it must never be null.
Be compact: each list should normally contain 2-4 items, each item should be one short sentence, and the evidence ledger should contain at most 6 material claims.

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
  "trend_probability": 65,
  "demand_analysis": {"target_user":"string","core_problem":"string","current_alternative":"string","urgency":"LOW | MEDIUM | HIGH","demand_evidence":["string"],"counter_evidence":["string"],"unknowns":["string"],"falsifiable_hypothesis":"string"},
  "evidence_ledger": [{"claim":"string","status":"OBSERVED | INFERRED | UNKNOWN","source":"REPO_METADATA | README | REPO_STRUCTURE | GITHUB_ISSUES | USER_INPUT | NONE","direction":"POSITIVE | NEGATIVE | NEUTRAL"}],
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
      trend_probability: null,
      demand_analysis: null,
      evidence_ledger: assessment.evidence_ledger.filter((item) => item.source === "USER_INPUT"),
      reasoning_gaps: mode === "agent" ? assessment.reasoning_gaps : [],
      adversarial_tests: mode === "agent" ? assessment.adversarial_tests : [],
      agent_improvement: mode === "agent" ? assessment.agent_improvement : null,
    };
  }
  if (!assessment.rubric_scores) return assessment;
  const score = calculateOpportunityScore(assessment.rubric_scores);
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
  const forecastContract = evidence.status === "verified" && evidence.stars !== undefined
    ? sevenDayForecastContract(evidence.stars)
    : null;
  return {
    system: `${SYSTEM_PROMPT}\n\n${languageInstruction(language)}\n\n${JSON_SHAPE}`,
    user: `ASSESSMENT MODE:\n${mode === "project" ? "PROJECT_OPPORTUNITY" : mode === "agent" ? "AGENT_AUDIT" : "TASK_FEASIBILITY"}\n\nTASK, RESEARCH QUESTION, OR USER AGENT MATERIAL:\n${task}\n\nREPOSITORY INPUT:\n${repository || "Not supplied"}\n\nVERIFIED REPOSITORY EVIDENCE:\n${compactRepositoryEvidence(evidence)}\n\nSEVEN-DAY CALIBRATION CONTRACT:\n${JSON.stringify(forecastContract)}\n\nOUTSIDE-VIEW PRIOR FOR EXECUTION SUCCESS:\n${outsideViewPrior(signals)}%\n\nDETERMINISTIC SIGNALS:\n${JSON.stringify(signalPayload)}`,
  };
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, Math.round(numeric))) : fallback;
}

function normalizeEvidenceLedger(value: unknown, mode: AssessmentMode) {
  if (!Array.isArray(value)) return [];
  const statuses = new Set(["OBSERVED", "INFERRED", "UNKNOWN"]);
  const sources = new Set(["REPO_METADATA", "README", "REPO_STRUCTURE", "GITHUB_ISSUES", "USER_INPUT", "NONE"]);
  const directions = new Set(["POSITIVE", "NEGATIVE", "NEUTRAL"]);
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .filter((item) => typeof item.claim === "string"
      && item.claim.trim().length >= 3
      && statuses.has(String(item.status))
      && sources.has(String(item.source))
      && directions.has(String(item.direction)))
    .filter((item) => mode === "project" || item.source === "USER_INPUT")
    .slice(0, 12)
    .map((item) => ({ ...item, claim: String(item.claim).trim().slice(0, 220) }));
}

export function parseJsonAssessment(content: string | null, fallbackSuccessProbability: number, mode: AssessmentMode) {
  if (!content) throw new Error("EMPTY_MODEL_RESULT");
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  const rubric = value.rubric_scores && typeof value.rubric_scores === "object"
    ? value.rubric_scores as Record<string, unknown>
    : null;
  const derivedSuccess = rubric
    ? Math.round((boundedNumber(rubric.buildability, 0, 100, fallbackSuccessProbability)
      + boundedNumber(rubric.evidence, 0, 100, fallbackSuccessProbability)) / 2)
    : fallbackSuccessProbability;
  const estimatedCost = typeof value.estimated_cost_usd === "number"
    ? value.estimated_cost_usd
    : Number(value.estimated_cost_usd);
  return AssessmentSchema.parse({
    opportunity_score: null,
    rubric_scores: null,
    recommended_experiment: null,
    trend_probability: null,
    demand_analysis: null,
    evidence_ledger: [],
    reasoning_gaps: [],
    adversarial_tests: [],
    agent_improvement: null,
    ...value,
    assessment_kind: mode === "project" ? "PROJECT_OPPORTUNITY" : mode === "agent" ? "AGENT_AUDIT" : "TASK_FEASIBILITY",
    opportunity_score: mode === "project" ? value.opportunity_score : null,
    rubric_scores: mode === "project" ? value.rubric_scores : null,
    recommended_experiment: mode === "project" ? value.recommended_experiment : null,
    demand_analysis: mode === "project" ? value.demand_analysis : null,
    evidence_ledger: normalizeEvidenceLedger(value.evidence_ledger, mode),
    reasoning_gaps: mode === "agent" && Array.isArray(value.reasoning_gaps) ? value.reasoning_gaps : [],
    adversarial_tests: mode === "agent" && Array.isArray(value.adversarial_tests) ? value.adversarial_tests : [],
    agent_improvement: mode === "agent" && typeof value.agent_improvement === "string" ? value.agent_improvement : null,
    success_probability: boundedNumber(value.success_probability, 5, 95, derivedSuccess),
    trend_probability: mode === "project"
      ? boundedNumber(value.trend_probability, 5, 95, boundedNumber(rubric?.momentum, 5, 95, 50))
      : null,
    estimated_minutes: boundedNumber(value.estimated_minutes, 1, 1440, 30),
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
    timeout: 75_000,
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
    max_tokens: 5000,
  });
  const usage = response.usage;
  return {
    assessment: parseJsonAssessment(response.choices[0]?.message?.content ?? null, outsideViewPrior(signals), mode),
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
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 75_000, maxRetries: 1 });
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

function providerFailureCode(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "EMPTY_MODEL_RESULT")) {
    return "AGENT_INVALID_OUTPUT";
  }
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (status === 401 || status === 403) return "AGENT_AUTH_FAILED";
  if (status === 429) return "AGENT_RATE_LIMITED";
  const text = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : "";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) return "AGENT_TIMEOUT";
  return "AGENT_UPSTREAM_ERROR";
}

function providerFailureFields(error: unknown) {
  if (error instanceof z.ZodError) {
    return [...new Set(error.issues.map((issue) => issue.path.join(".") || "$root"))].slice(0, 8);
  }
  if (error instanceof SyntaxError) return ["$json"];
  if (error instanceof Error && error.message === "EMPTY_MODEL_RESULT") return ["$empty"];
  return [];
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
  const failures: Array<{ provider: Provider; code: string; fields: string[] }> = [];

  for (const provider of providers) {
    attempted.push(provider);
    try {
      const result = provider === "deepseek"
        ? await assessWithDeepSeek(parsed.data.task, parsed.data.repository, parsed.data.language, signals, mode, repositoryEvidence)
        : await assessWithOpenAI(parsed.data.task, parsed.data.repository, parsed.data.language, signals, mode, repositoryEvidence);
      let normalized = normalizeOpportunityScore(result.assessment, mode);
      let probabilityCalibration: { raw: number; calibrated: number; sample_size: number; method: string } | null = null;
      if (mode === "task") {
        try {
          const { calibrateProbability } = await import("../../../db/runs.ts");
          probabilityCalibration = await calibrateProbability(normalized.success_probability, mode, result.model);
          normalized = { ...normalized, success_probability: probabilityCalibration.calibrated };
        } catch (error) {
          console.error("SelfOdds probability calibration unavailable", error instanceof Error ? error.message : "unknown error");
        }
      }
      const guarded = applyDecisionGuard(normalized, signals, parsed.data.language);
      const opportunityStandard = mode === "project" && guarded.opportunity_score !== null
        ? {
            version: SCORE_STANDARD_VERSION,
            score: guarded.opportunity_score,
            grade: opportunityGrade(guarded.opportunity_score),
            band: scoreBand(guarded.opportunity_score),
            weights: OPPORTUNITY_WEIGHTS,
            definitions: DIMENSION_DEFINITIONS,
            anchors: SCORE_ANCHORS,
            thresholds: { strong_experiment: 80, worth_testing: 65, weak_evidence: 50, pass: 0 },
          }
        : null;
      const forecast = mode === "project"
        && guarded.trend_probability !== null
        && repositoryEvidence.status === "verified"
        && repositoryEvidence.stars !== undefined
        ? {
            probability: guarded.trend_probability,
            interval: predictionInterval(guarded.trend_probability, guarded.confidence_quality),
            contract: sevenDayForecastContract(repositoryEvidence.stars),
          }
        : null;
      let calibrationRecord: { id: string; created_at: number; due_at: number; contract: { horizon_days: number; star_growth_threshold: number; description: string } } | null = null;
      if (forecast && repositoryEvidence.full_name) {
        try {
          const { saveForecast } = await import("../../../db/calibration.ts");
          calibrationRecord = await saveForecast({
            repository: parsed.data.repository,
            repoFullName: repositoryEvidence.full_name,
            baselineStars: repositoryEvidence.stars!,
            baselinePushedAt: repositoryEvidence.pushed_at,
            trendProbability: forecast.probability,
            opportunityScore: guarded.opportunity_score,
            evidenceQuality: guarded.confidence_quality,
            assessment: guarded,
          });
        } catch (error) {
          console.error("SelfOdds forecast persistence failed", error instanceof Error ? error.message : "unknown error");
        }
      }
      let runnerRecord: { id: string; status: string; created_at: number } | null = null;
      if (mode === "task") {
        try {
          const { createPredictedRun } = await import("../../../db/runs.ts");
          runnerRecord = await createPredictedRun({
            mode,
            task: parsed.data.task,
            repository: parsed.data.repository,
            provider: result.provider,
            model: result.model,
            successProbability: guarded.success_probability,
            route: guarded.route,
            risk: guarded.risk,
            assessment: guarded,
          });
        } catch (error) {
          console.error("SelfOdds runner record persistence failed", error instanceof Error ? error.message : "unknown error");
        }
      }
      return Response.json({
        ok: true,
        source: "agent",
        provider: result.provider,
        model: result.model,
        agent_version: "runner-intelligence-v5",
        latency_ms: Date.now() - startedAt,
        assessment: guarded,
        standard: opportunityStandard,
        calibration_forecast: forecast,
        calibration_record: calibrationRecord,
        runner_record: runnerRecord,
        probability_calibration: probabilityCalibration,
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
            open_issues: repositoryEvidence.open_issues,
            language: repositoryEvidence.language,
            license: repositoryEvidence.license,
            pushed_at: repositoryEvidence.pushed_at,
            root_files: repositoryEvidence.root_files,
            issue_signals: repositoryEvidence.issue_signals,
            target_issue: repositoryEvidence.target_issue,
            warning: repositoryEvidence.warning,
          },
        },
        usage: result.usage,
      });
    } catch (error) {
      const code = providerFailureCode(error);
      failures.push({ provider, code, fields: providerFailureFields(error) });
      console.error("SelfOdds provider failed", provider, code, error instanceof Error ? error.message : "unknown error");
      // Provider failures are intentionally opaque to clients; the next configured provider gets one attempt.
    }
  }

  const terminalCode = failures.every((failure) => failure.code === "AGENT_INVALID_OUTPUT")
    ? "AGENT_INVALID_OUTPUT"
    : failures.some((failure) => failure.code === "AGENT_AUTH_FAILED")
      ? "AGENT_AUTH_FAILED"
      : failures.some((failure) => failure.code === "AGENT_RATE_LIMITED")
        ? "AGENT_RATE_LIMITED"
        : failures.some((failure) => failure.code === "AGENT_TIMEOUT")
          ? "AGENT_TIMEOUT"
          : "AGENT_UNAVAILABLE";
  return errorResponse(
    "Preflight Agent 暂时不可用，前端将使用本地降级评估。",
    502,
    terminalCode,
    { attempted_providers: attempted, failures },
  );
}
