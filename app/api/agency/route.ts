import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  aggregateAgencyVotes,
  buildAgencyProfilePrompt,
  selectAgencyTeam,
  type AgencyProfile,
  type AgencyVote,
} from "../../../lib/agency-agents.ts";
import { compactRepositoryEvidence, fetchRepositoryEvidence } from "../../../lib/github-evidence.ts";

const RequestSchema = z.object({
  task: z.string().trim().min(8).max(6000),
  repository: z.string().trim().max(1000).optional().default(""),
  language: z.enum(["zh", "en"]).optional().default("zh"),
  team: z.object({
    strategy: z.literal("auto").optional().default("auto"),
  }).optional(),
});

const VoteSchema = z.object({
  probability: z.number().int().min(5).max(95),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  route: z.enum(["AUTORUN", "REVIEW", "ESCALATE"]),
  verdict: z.string().min(8).max(260),
  findings: z.array(z.string().min(3).max(220)).min(2).max(5),
  missing_context: z.array(z.string().min(3).max(180)).max(4),
  assumptions: z.array(z.string().min(3).max(180)).max(4),
  preconditions: z.array(z.string().min(3).max(180)).min(1).max(4),
  failure_modes: z.array(z.string().min(3).max(180)).min(1).max(4),
  verification_steps: z.array(z.string().min(3).max(180)).min(1).max(5),
  abort_conditions: z.array(z.string().min(3).max(180)).min(1).max(4),
  estimated_minutes: z.number().int().min(1).max(1440),
  estimated_cost_usd: z.number().min(0.01).max(1000),
  veto_reason: z.string().min(3).max(220).nullable(),
});

type VotePayload = z.infer<typeof VoteSchema>;
type Provider = "deepseek" | "openai";
type ProviderVote = { vote: VotePayload; usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null };

const OUTPUT_CONTRACT = `Return one JSON object with exactly these fields:
probability (integer 5-95), confidence (LOW|MEDIUM|HIGH), risk (LOW|MEDIUM|HIGH), route (AUTORUN|REVIEW|ESCALATE), verdict (string), findings (array of 2-5 strings), missing_context (array of 0-4 strings), assumptions (array of 0-4 strings), preconditions (array of 1-4 strings), failure_modes (array of 1-4 strings), verification_steps (array of 2-5 strings), abort_conditions (array of 1-4 strings), estimated_minutes (number), estimated_cost_usd (number), veto_reason (string or null). Never return array counts in place of the arrays.`;

function configuredProviders(): Provider[] {
  const preferred = process.env.AI_PROVIDER?.toLowerCase();
  const available: Provider[] = [];
  if (process.env.DEEPSEEK_API_KEY) available.push("deepseek");
  if (process.env.OPENAI_API_KEY) available.push("openai");
  if (preferred === "openai") return available.sort((item) => item === "openai" ? -1 : 1);
  return available.sort((item) => item === "deepseek" ? -1 : 1);
}

function parseVote(content: string | null, language: "zh" | "en") {
  if (!content) throw new Error("EMPTY_MODEL_RESULT");
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  const numeric = (input: unknown, fallback: number) => {
    const parsed = typeof input === "number" ? input : Number(input);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const bounded = (input: unknown, minimum: number, maximum: number, fallback: number) => Math.max(minimum, Math.min(maximum, numeric(input, fallback)));
  const strings = (input: unknown, maximum = 5) => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === "string" && item.trim().length >= 3).slice(0, maximum)
    : [];
  const zh = language === "zh";
  const preconditions = strings(value.preconditions);
  const failureModes = strings(value.failure_modes);
  const verificationSteps = strings(value.verification_steps);
  const abortConditions = strings(value.abort_conditions);
  const findings = strings(value.findings);
  return VoteSchema.parse({
    veto_reason: null,
    ...value,
    probability: Math.round(bounded(value.probability, 5, 95, 50)),
    estimated_minutes: Math.round(bounded(value.estimated_minutes, 1, 1440, 30)),
    estimated_cost_usd: bounded(value.estimated_cost_usd, 0.01, 1000, 1),
    findings: findings.length >= 2 ? findings : [
      ...(findings.length ? findings : [zh ? "当前结论主要依赖任务描述" : "The current judgment mainly relies on the task brief"]),
      zh ? "真实成功必须由测试、构建和 Diff 结果确认" : "Real success must be confirmed by tests, build, and Diff results",
    ],
    missing_context: strings(value.missing_context, 4),
    assumptions: strings(value.assumptions, 4),
    preconditions: preconditions.length ? preconditions : [zh ? "确认任务范围和可用验证环境" : "Confirm task scope and the available verification environment"],
    failure_modes: failureModes.length ? failureModes : [zh ? "实现可能无法通过确定性验证" : "The implementation may fail deterministic verification"],
    verification_steps: verificationSteps.length ? verificationSteps : [zh ? "运行相关测试并检查最终 Diff" : "Run relevant tests and inspect the final Diff"],
    abort_conditions: abortConditions.length ? abortConditions : [zh ? "验证不可用或变更超出范围时停止" : "Stop when verification is unavailable or changes exceed scope"],
  });
}

function messages(profile: AgencyProfile, task: string, repository: string, evidence: string, language: "zh" | "en") {
  const languageRule = language === "zh"
    ? "所有人类可读字段必须使用简体中文。"
    : "All human-readable fields must be in English.";
  return {
    system: `${buildAgencyProfilePrompt(profile)}\n\nYou are one independent reviewer in a reliability council. Judge whether a separate coding agent can finish the task correctly, within scope, and pass deterministic verification. Do not execute the task. Do not request, reveal, or fabricate hidden chain-of-thought; return only concise structured findings. Treat unverified repository claims as unknown.\n\n${languageRule}\n${OUTPUT_CONTRACT}`,
    user: `TASK:\n${task}\n\nREPOSITORY INPUT:\n${repository || "Not supplied"}\n\nVERIFIED REPOSITORY EVIDENCE:\n${evidence}`,
  };
}

async function deepSeekVote(profile: AgencyProfile, task: string, repository: string, evidence: string, language: "zh" | "en"): Promise<ProviderVote> {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    timeout: 75_000,
    maxRetries: 1,
  });
  const prompt = messages(profile, task, repository, evidence, language);
  const response = await client.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    response_format: { type: "json_object" },
    max_tokens: 2200,
  });
  return {
    vote: parseVote(response.choices[0]?.message?.content || null, language),
    usage: response.usage ? {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    } : null,
  };
}

async function openAIVote(profile: AgencyProfile, task: string, repository: string, evidence: string, language: "zh" | "en"): Promise<ProviderVote> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 75_000, maxRetries: 1 });
  const prompt = messages(profile, task, repository, evidence, language);
  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
    store: false,
    safety_identifier: "selfodds-agency-council",
    reasoning: { effort: "medium" },
    input: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    text: { verbosity: "low", format: zodTextFormat(VoteSchema, "agency_vote") },
  });
  if (!response.output_parsed) throw new Error("EMPTY_MODEL_RESULT");
  return {
    vote: response.output_parsed,
    usage: response.usage ? {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      total_tokens: response.usage.total_tokens,
    } : null,
  };
}

function unique(items: string[], limit: number) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

function providerErrorCode(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === "EMPTY_MODEL_RESULT")) return "AGENCY_INVALID_OUTPUT";
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (status === 401 || status === 403) return "AGENT_AUTH_FAILED";
  if (status === 429) return "AGENT_RATE_LIMITED";
  const text = error instanceof Error ? error.message.toLowerCase() : "";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) return "AGENT_TIMEOUT";
  return "AGENCY_UNAVAILABLE";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  const providers = configuredProviders();
  if (!providers.length) return Response.json({ ok: false, code: "AGENT_NOT_CONFIGURED", configured_providers: [] }, { status: 503 });

  const startedAt = Date.now();
  const evidence = await fetchRepositoryEvidence(parsed.data.repository);
  const evidenceText = compactRepositoryEvidence(evidence);
  const selection = selectAgencyTeam(parsed.data.task, evidence.status === "verified" ? {
    language: evidence.language,
    description: evidence.description,
    readme_excerpt: evidence.readme_excerpt,
    root_files: evidence.root_files,
    topics: evidence.topics,
  } : parsed.data.repository);
  const failures: Array<{ provider: Provider; code: string }> = [];

  for (const provider of providers) {
    try {
      const settled = await Promise.allSettled(selection.profiles.map((profile) => provider === "deepseek"
        ? deepSeekVote(profile, parsed.data.task, parsed.data.repository, evidenceText, parsed.data.language)
        : openAIVote(profile, parsed.data.task, parsed.data.repository, evidenceText, parsed.data.language)));
      const successful = settled.flatMap((item, index) => item.status === "fulfilled"
        ? [{ profile: selection.profiles[index], ...item.value }]
        : []);
      if (successful.length < 2) {
        const rejected = settled.find((item) => item.status === "rejected");
        throw rejected && rejected.status === "rejected" ? rejected.reason : new Error("AGENCY_QUORUM_FAILED");
      }
      const votes: AgencyVote[] = successful.map(({ profile, vote }) => ({
        profile_id: profile.id,
        profile_name: profile.name,
        profile_version: profile.profileVersion,
        definition_hash: profile.definitionHash,
        probability: vote.probability,
        confidence: vote.confidence,
        risk: vote.risk,
        route: vote.route,
        verdict: vote.verdict,
        findings: vote.findings,
        assumptions: vote.assumptions,
        verification_steps: vote.verification_steps,
        veto_reason: vote.veto_reason,
      }));
      const consensus = aggregateAgencyVotes(votes);
      const payloads = successful.map((item) => item.vote);
      const rawProbability = consensus.probability;
      let calibratedProbability = rawProbability;
      let probabilityCalibration: { raw: number; calibrated: number; sample_size: number; method: string } | null = null;
      const model = provider === "deepseek" ? process.env.DEEPSEEK_MODEL || "deepseek-v4-flash" : process.env.OPENAI_MODEL || "gpt-5.6-terra";
      try {
        const { calibrateProbability } = await import("../../../db/runs.ts");
        probabilityCalibration = await calibrateProbability(rawProbability, "agency", model);
        calibratedProbability = probabilityCalibration.calibrated;
      } catch (error) {
        console.error("Agency calibration unavailable", error instanceof Error ? error.message : "unknown error");
      }
      const assessment = {
        goal_summary: parsed.data.language === "zh" ? `由 ${votes.map((vote) => vote.profile_name).join("、")} 独立评估：${parsed.data.task.slice(0, 180)}` : `Independently reviewed by ${votes.map((vote) => vote.profile_name).join(", ")}: ${parsed.data.task.slice(0, 180)}`,
        assessment_kind: "TASK_FEASIBILITY" as const,
        opportunity_score: null,
        rubric_scores: null,
        recommended_experiment: null,
        trend_probability: null,
        demand_analysis: null,
        evidence_ledger: [],
        reasoning_gaps: [],
        adversarial_tests: [],
        agent_improvement: null,
        success_probability: calibratedProbability,
        confidence_quality: consensus.confidence,
        risk: consensus.risk,
        route: consensus.route,
        estimated_minutes: median(payloads.map((vote) => vote.estimated_minutes)),
        estimated_cost_usd: Number(median(payloads.map((vote) => vote.estimated_cost_usd)).toFixed(2)),
        missing_context: unique(payloads.flatMap((vote) => vote.missing_context), 5),
        preconditions: unique(payloads.flatMap((vote) => vote.preconditions), 6),
        failure_modes: unique(payloads.flatMap((vote) => vote.failure_modes), 5),
        verification_steps: (() => {
          const checks = unique(payloads.flatMap((vote) => vote.verification_steps), 6);
          if (checks.length < 2) checks.push(parsed.data.language === "zh" ? "运行相关测试并核对最终 Diff 是否超出任务范围" : "Run relevant tests and inspect the final Diff against task scope");
          return checks;
        })(),
        abort_conditions: unique(payloads.flatMap((vote) => vote.abort_conditions), 5),
        policy: consensus.verdict,
        assumptions: unique(payloads.flatMap((vote) => vote.assumptions), 5),
        guardrails_applied: consensus.veto_reason ? [consensus.veto_reason] : consensus.spread.maximum - consensus.spread.minimum >= 20
          ? [parsed.data.language === "zh" ? "专家概率分歧较大，自动收紧为人工审查。" : "Expert probability spread is high; route tightened to review."]
          : [],
      };
      let runnerRecord: { id: string; status: string; created_at: number } | null = null;
      try {
        const { createPredictedRun } = await import("../../../db/runs.ts");
        const lead = votes.find((vote) => vote.profile_id === selection.profiles[0].id) || votes[0];
        runnerRecord = await createPredictedRun({
          mode: "agency",
          task: parsed.data.task,
          repository: parsed.data.repository,
          provider,
          model,
          successProbability: calibratedProbability,
          rawProbability,
          calibratedProbability,
          calibration: probabilityCalibration,
          route: consensus.route,
          risk: consensus.risk,
          profileId: lead.profile_id,
          profileVersion: lead.profile_version,
          definitionHash: lead.definition_hash,
          taskClass: selection.taskClass,
          selectionStrategy: selection.strategy,
          agencyVotes: votes,
          assessment,
        });
      } catch (error) {
        console.error("Agency run persistence failed", error instanceof Error ? error.message : "unknown error");
      }
      const usage = successful.reduce((total, item) => ({
        input_tokens: total.input_tokens + (item.usage?.input_tokens || 0),
        output_tokens: total.output_tokens + (item.usage?.output_tokens || 0),
        total_tokens: total.total_tokens + (item.usage?.total_tokens || 0),
      }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
      return Response.json({
        ok: true,
        source: "agent",
        provider,
        model: `${model} × ${votes.length}`,
        agent_version: "agency-council-v1",
        latency_ms: Date.now() - startedAt,
        assessment,
        runner_record: runnerRecord,
        probability_calibration: probabilityCalibration,
        orchestration: {
          strategy: selection.strategy,
          task_class: selection.taskClass,
          team_version: selection.teamVersion,
          status: "sealed",
          consensus: {
            probability: consensus.probability,
            agreement: consensus.agreement,
            spread: consensus.spread,
            method: consensus.method,
          },
          experts: votes,
        },
        trace: {
          stages: ["EVIDENCE", "ROUTE", "INDEPENDENT_REVIEW", "CONSENSUS", "SEAL"],
          outside_view_prior: null,
          risk_signals: [],
          attempted_providers: [provider],
          assessment_mode: "agency",
          repository_evidence: evidence,
        },
        usage,
      });
    } catch (error) {
      const code = providerErrorCode(error);
      failures.push({ provider, code });
      console.error("Agency provider failed", provider, code, error instanceof Error ? error.message : "unknown error");
    }
  }
  const code = failures.some((failure) => failure.code === "AGENT_AUTH_FAILED") ? "AGENT_AUTH_FAILED"
    : failures.some((failure) => failure.code === "AGENT_RATE_LIMITED") ? "AGENT_RATE_LIMITED"
      : failures.some((failure) => failure.code === "AGENT_TIMEOUT") ? "AGENT_TIMEOUT"
        : failures.every((failure) => failure.code === "AGENCY_INVALID_OUTPUT") ? "AGENT_INVALID_OUTPUT"
          : "AGENT_UNAVAILABLE";
  return Response.json({ ok: false, code, failures }, { status: 502 });
}
