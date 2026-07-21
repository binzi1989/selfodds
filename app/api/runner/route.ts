import { z } from "zod";

const StartSchema = z.object({
  action: z.literal("start"),
  run_id: z.string().uuid(),
  runner_name: z.string().trim().min(2).max(80),
  baseline_commit: z.string().trim().max(80).nullable().optional(),
});

const SettleSchema = z.object({
  action: z.literal("settle"),
  run_id: z.string().uuid(),
  runner_name: z.string().trim().min(2).max(80),
  test_command: z.string().trim().max(500).nullable().optional(),
  build_command: z.string().trim().max(500).nullable().optional(),
  test_passed: z.boolean().nullable().optional(),
  build_passed: z.boolean().nullable().optional(),
  diff_within_scope: z.boolean(),
  diff_files: z.number().int().min(0).max(100000),
  diff_additions: z.number().int().min(0).max(10000000),
  diff_deletions: z.number().int().min(0).max(10000000),
  baseline_commit: z.string().trim().max(80).nullable().optional(),
  final_commit: z.string().trim().max(80).nullable().optional(),
  failure_summary: z.string().trim().max(1000).nullable().optional(),
  verification: z.unknown().optional(),
});

function authorized(request: Request) {
  const expected = process.env.RUNNER_SHARED_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return request.headers.get("x-selfodds-runner-token") === expected;
}

export async function GET(request: Request) {
  try {
    const { getRun, listRuns } = await import("../../../db/runs.ts");
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const run = await getRun(id);
      return run ? Response.json({ ok: true, run }) : Response.json({ ok: false, code: "RUN_NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ ok: true, runs: await listRuns(30) });
  } catch (error) {
    console.error("SelfOdds runner read failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, code: "RUNNER_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, code: "RUNNER_UNAUTHORIZED" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }
  try {
    const { settleRun, startRun } = await import("../../../db/runs.ts");
    const action = typeof body === "object" && body && "action" in body ? body.action : null;
    if (action === "start") {
      const input = StartSchema.parse(body);
      const run = await startRun(input.run_id, input.runner_name, input.baseline_commit);
      return Response.json({ ok: true, run });
    }
    if (action === "settle") {
      const input = SettleSchema.parse(body);
      const run = await settleRun(input.run_id, {
        runnerName: input.runner_name,
        testCommand: input.test_command,
        buildCommand: input.build_command,
        testPassed: input.test_passed,
        buildPassed: input.build_passed,
        diffWithinScope: input.diff_within_scope,
        diffFiles: input.diff_files,
        diffAdditions: input.diff_additions,
        diffDeletions: input.diff_deletions,
        baselineCommit: input.baseline_commit,
        finalCommit: input.final_commit,
        failureSummary: input.failure_summary,
        verification: input.verification,
      });
      return Response.json({ ok: true, run });
    }
    return Response.json({ ok: false, code: "INVALID_RUNNER_ACTION" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RUNNER_ERROR";
    const status = message === "RUN_NOT_FOUND" ? 404 : message === "RUN_ALREADY_SETTLED" || message === "RUN_NOT_STARTABLE" ? 409 : 400;
    return Response.json({ ok: false, code: message }, { status });
  }
}
