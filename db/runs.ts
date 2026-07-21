import { env } from "cloudflare:workers";
import { empiricalBayesCalibration } from "../lib/run-calibration.ts";

type CreatePredictedRunInput = {
  mode: "task" | "agent";
  task: string;
  repository: string;
  provider: string;
  model: string;
  successProbability: number;
  route: string;
  risk: string;
  assessment: unknown;
};

export type RunnerSettlement = {
  runnerName: string;
  testCommand?: string | null;
  buildCommand?: string | null;
  testPassed?: boolean | null;
  buildPassed?: boolean | null;
  diffWithinScope: boolean;
  diffFiles: number;
  diffAdditions: number;
  diffDeletions: number;
  baselineCommit?: string | null;
  finalCommit?: string | null;
  failureSummary?: string | null;
  verification?: unknown;
};

type RunRow = {
  id: string;
  created_at: number;
  updated_at: number;
  status: string;
  mode: string;
  task: string;
  repository: string;
  provider: string;
  model: string;
  runner_name: string | null;
  success_probability: number;
  route: string;
  risk: string;
  outcome: number | null;
  brier: number | null;
  failure_code: string | null;
  failure_summary: string | null;
  test_passed: number | null;
  build_passed: number | null;
  diff_within_scope: number | null;
  diff_files: number | null;
  diff_additions: number | null;
  diff_deletions: number | null;
};

function database() {
  const db = (env as { DB?: D1Database }).DB;
  if (!db) throw new Error("D1_UNAVAILABLE");
  return db;
}

async function ensureRunSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'predicted',
      mode TEXT NOT NULL,
      task TEXT NOT NULL,
      repository TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      runner_name TEXT,
      success_probability INTEGER NOT NULL,
      route TEXT NOT NULL,
      risk TEXT NOT NULL,
      started_at INTEGER,
      resolved_at INTEGER,
      test_command TEXT,
      build_command TEXT,
      test_passed INTEGER,
      build_passed INTEGER,
      diff_within_scope INTEGER,
      diff_files INTEGER,
      diff_additions INTEGER,
      diff_deletions INTEGER,
      baseline_commit TEXT,
      final_commit TEXT,
      outcome INTEGER,
      brier REAL,
      failure_code TEXT,
      failure_summary TEXT,
      assessment_json TEXT NOT NULL,
      verification_json TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_status_created_idx ON agent_runs(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_model_resolved_idx ON agent_runs(model, resolved_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_runner_resolved_idx ON agent_runs(runner_name, resolved_at)"),
  ]);
}

export async function createPredictedRun(input: CreatePredictedRunInput) {
  const db = database();
  await ensureRunSchema(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.prepare(`INSERT INTO agent_runs (
    id, created_at, updated_at, status, mode, task, repository, provider, model,
    success_probability, route, risk, assessment_json
  ) VALUES (?, ?, ?, 'predicted', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id,
    now,
    now,
    input.mode,
    input.task,
    input.repository,
    input.provider,
    input.model,
    input.successProbability,
    input.route,
    input.risk,
    JSON.stringify(input.assessment),
  ).run();
  return { id, status: "predicted", created_at: now };
}

export async function getRun(id: string) {
  const db = database();
  await ensureRunSchema(db);
  return db.prepare(`SELECT id, created_at, updated_at, status, mode, task, repository,
    provider, model, runner_name, success_probability, route, risk, outcome, brier,
    failure_code, failure_summary, test_passed, build_passed, diff_within_scope,
    diff_files, diff_additions, diff_deletions
    FROM agent_runs WHERE id = ?`).bind(id).first<RunRow>();
}

export async function listRuns(limit = 30) {
  const db = database();
  await ensureRunSchema(db);
  const result = await db.prepare(`SELECT id, created_at, updated_at, status, mode, task, repository,
    provider, model, runner_name, success_probability, route, risk, outcome, brier,
    failure_code, failure_summary, test_passed, build_passed, diff_within_scope,
    diff_files, diff_additions, diff_deletions
    FROM agent_runs ORDER BY created_at DESC LIMIT ?`).bind(Math.max(1, Math.min(100, limit))).all<RunRow>();
  return result.results;
}

export async function startRun(id: string, runnerName: string, baselineCommit?: string | null) {
  const db = database();
  await ensureRunSchema(db);
  const now = Date.now();
  const result = await db.prepare(`UPDATE agent_runs SET status = 'running', runner_name = ?,
    baseline_commit = ?, started_at = ?, updated_at = ?
    WHERE id = ? AND status = 'predicted'`).bind(runnerName, baselineCommit || null, now, now, id).run();
  if (!result.meta.changes) throw new Error("RUN_NOT_STARTABLE");
  return getRun(id);
}

function failureCode(input: RunnerSettlement) {
  if (input.testPassed === false) return "TEST_FAILURE";
  if (input.buildPassed === false) return "BUILD_FAILURE";
  if (!input.diffWithinScope) return "DIFF_SCOPE_VIOLATION";
  return null;
}

export async function settleRun(id: string, input: RunnerSettlement) {
  const db = database();
  await ensureRunSchema(db);
  const current = await getRun(id);
  if (!current) throw new Error("RUN_NOT_FOUND");
  if (current.status === "resolved" || current.status === "failed") throw new Error("RUN_ALREADY_SETTLED");
  const verificationAttempted = input.testPassed !== null && input.testPassed !== undefined
    || input.buildPassed !== null && input.buildPassed !== undefined;
  const passed = verificationAttempted
    && input.testPassed !== false
    && input.buildPassed !== false
    && input.diffWithinScope;
  const outcome = passed ? 1 : 0;
  const probability = current.success_probability / 100;
  const brier = (probability - outcome) ** 2;
  const code = failureCode(input) || (verificationAttempted ? null : "NO_VERIFICATION");
  const now = Date.now();
  await db.prepare(`UPDATE agent_runs SET
    status = ?, runner_name = ?, resolved_at = ?, updated_at = ?, test_command = ?, build_command = ?,
    test_passed = ?, build_passed = ?, diff_within_scope = ?, diff_files = ?, diff_additions = ?,
    diff_deletions = ?, baseline_commit = COALESCE(baseline_commit, ?), final_commit = ?, outcome = ?,
    brier = ?, failure_code = ?, failure_summary = ?, verification_json = ?
    WHERE id = ?`).bind(
    passed ? "resolved" : "failed",
    input.runnerName,
    now,
    now,
    input.testCommand || null,
    input.buildCommand || null,
    input.testPassed === null || input.testPassed === undefined ? null : Number(input.testPassed),
    input.buildPassed === null || input.buildPassed === undefined ? null : Number(input.buildPassed),
    Number(input.diffWithinScope),
    Math.max(0, Math.round(input.diffFiles)),
    Math.max(0, Math.round(input.diffAdditions)),
    Math.max(0, Math.round(input.diffDeletions)),
    input.baselineCommit || null,
    input.finalCommit || null,
    outcome,
    brier,
    code,
    input.failureSummary?.slice(0, 1000) || null,
    JSON.stringify(input.verification || {}),
    id,
  ).run();
  return getRun(id);
}

export async function intelligenceSummary() {
  const rows = await listRuns(100);
  const resolved = rows.filter((row) => row.outcome === 0 || row.outcome === 1);
  const group = <T extends string>(key: (row: RunRow) => T) => {
    const groups = new Map<T, RunRow[]>();
    for (const row of resolved) groups.set(key(row), [...(groups.get(key(row)) || []), row]);
    return [...groups.entries()].map(([name, items]) => {
      const brier = items.reduce((sum, item) => sum + Number(item.brier || 0), 0) / items.length;
      const success = items.reduce((sum, item) => sum + Number(item.outcome || 0), 0) / items.length;
      return { name, resolved: items.length, success_rate: Math.round(success * 100), brier: Number(brier.toFixed(4)), calibration_score: Math.max(0, Math.round((1 - brier) * 100)) };
    }).sort((a, b) => b.calibration_score - a.calibration_score || b.resolved - a.resolved);
  };
  const bins = new Map<number, RunRow[]>();
  for (const row of resolved) {
    const bucket = Math.min(90, Math.floor(row.success_probability / 10) * 10);
    bins.set(bucket, [...(bins.get(bucket) || []), row]);
  }
  const failures = new Map<string, number>();
  const edges = new Map<string, number>();
  for (const row of resolved.filter((item) => item.outcome === 0)) {
    const failure = row.failure_code || "UNKNOWN_FAILURE";
    failures.set(failure, (failures.get(failure) || 0) + 1);
    const modeEdge = `${failure}|mode:${row.mode}`;
    const modelEdge = `${failure}|model:${row.model}`;
    edges.set(modeEdge, (edges.get(modeEdge) || 0) + 1);
    edges.set(modelEdge, (edges.get(modelEdge) || 0) + 1);
  }
  return {
    total: rows.length,
    pending: rows.filter((row) => row.status === "predicted" || row.status === "running").length,
    resolved: resolved.length,
    leaderboard: {
      models: group((row) => row.model),
      runners: group((row) => row.runner_name || "unassigned"),
    },
    calibration_bins: [...bins.entries()].sort(([a], [b]) => a - b).map(([bucket, items]) => ({
      bucket: `${bucket}-${bucket + 9}`,
      mean_forecast: Math.round(items.reduce((sum, item) => sum + item.success_probability, 0) / items.length),
      actual_rate: Math.round(items.reduce((sum, item) => sum + Number(item.outcome || 0), 0) / items.length * 100),
      count: items.length,
    })),
    failure_patterns: [...failures.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    knowledge_graph: {
      nodes: [
        ...[...failures.entries()].map(([id, count]) => ({ id: `failure:${id}`, type: "FAILURE", label: id, count })),
        ...[...new Set(resolved.map((row) => `mode:${row.mode}`))].map((id) => ({ id, type: "MODE", label: id.slice(5) })),
        ...[...new Set(resolved.map((row) => `model:${row.model}`))].map((id) => ({ id, type: "MODEL", label: id.slice(6) })),
      ],
      edges: [...edges.entries()].map(([key, count]) => {
        const [failure, target] = key.split("|");
        return { source: `failure:${failure}`, target, relation: "OBSERVED_IN", count };
      }),
    },
    recent_runs: rows.slice(0, 20),
  };
}

export async function calibrateProbability(rawProbability: number, mode: string, model: string) {
  const db = database();
  await ensureRunSchema(db);
  const result = await db.prepare(`SELECT success_probability, outcome FROM agent_runs
    WHERE outcome IS NOT NULL AND mode = ? AND model = ?
    ORDER BY resolved_at DESC LIMIT 200`).bind(mode, model).all<{ success_probability: number; outcome: number }>();
  return empiricalBayesCalibration(rawProbability, result.results);
}
