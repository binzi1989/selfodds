import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const RequestSchema = z.object({
  task: z.string().trim().min(8).max(6000),
  repository: z.string().trim().max(1000).optional().default(""),
  language: z.enum(["zh", "en"]).optional().default("zh"),
});

const AssessmentSchema = z.object({
  success_probability: z.number().int().min(5).max(95),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  route: z.enum(["AUTORUN", "REVIEW", "ESCALATE"]),
  estimated_minutes: z.number().int().min(1).max(1440),
  estimated_cost_usd: z.number().min(0.01).max(1000),
  failure_modes: z.array(z.string().min(3).max(180)).min(1).max(5),
  verification_steps: z.array(z.string().min(3).max(180)).min(2).max(6),
  policy: z.string().min(8).max(320),
  assumptions: z.array(z.string().min(3).max(180)).max(5),
});

const SYSTEM_PROMPT = `You are SelfOdds, a pre-execution reliability assessor for coding agents.

Your job is to estimate whether a separate coding agent can complete the supplied task correctly. You do not execute the task and you do not claim access to a repository unless repository evidence is explicitly supplied.

Use an outside-view base rate before considering task details. Penalize ambiguity, missing repository context, irreversible state changes, authentication/security boundaries, migrations, concurrency, production access, external dependencies, and weak verification. Reward narrow scope, deterministic tests, clear success criteria, reversible changes, and isolated environments.

The probability means: P(the task is completed correctly, within scope, and passes the proposed verification). It is not a confidence rating about your prose.

Routing policy:
- AUTORUN only when probability >= 85 and blast radius is low.
- REVIEW when probability is 58-84 or human review materially limits risk.
- ESCALATE when probability < 58, context is materially missing, or potential impact is high.

Estimated cost is a rough end-to-end coding-agent inference estimate in USD, not the cost of this assessment call. Keep estimates conservative. Never invent repository facts. State material assumptions. Return concise operational language in the user's requested language.`;

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ ok: false, code, message }, { status });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("请求内容不是有效的 JSON。", 400, "INVALID_JSON");
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse("请提供完整的任务说明。", 400, "INVALID_REQUEST");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "Preflight Agent 尚未配置 API 密钥，已允许前端使用本地降级评估。",
      503,
      "AGENT_NOT_CONFIGURED",
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";
  const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
  const languageInstruction =
    parsed.data.language === "zh"
      ? "Return every human-readable string in Simplified Chinese."
      : "Return every human-readable string in English.";

  try {
    const response = await client.responses.parse({
      model,
      store: false,
      safety_identifier: "selfodds-private-prototype",
      reasoning: { effort: "medium" },
      input: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${languageInstruction}` },
        {
          role: "user",
          content: `TASK:\n${parsed.data.task}\n\nREPOSITORY OR CONTEXT:\n${parsed.data.repository || "Not supplied"}`,
        },
      ],
      text: {
        verbosity: "low",
        format: zodTextFormat(AssessmentSchema, "preflight_assessment"),
      },
    });

    if (!response.output_parsed) {
      return errorResponse("Agent 没有返回可用的结构化结果。", 502, "EMPTY_AGENT_RESULT");
    }

    return Response.json({
      ok: true,
      source: "agent",
      model,
      assessment: response.output_parsed,
      usage: response.usage
        ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : null,
    });
  } catch (error) {
    const status = error instanceof OpenAI.APIError ? error.status : 502;
    const safeStatus = status && status >= 400 && status < 600 ? status : 502;
    return errorResponse(
      "Preflight Agent 暂时不可用，前端将使用本地降级评估。",
      safeStatus,
      "AGENT_UNAVAILABLE",
    );
  }
}
