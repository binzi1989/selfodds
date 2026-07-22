import { env } from "cloudflare:workers";
import { empiricalBayesCalibration } from "../lib/run-calibration.ts";

export type AgencyVoteInput = {
  profileId?: string;
  profile_id?: string;
  profileName?: string;
  profile_name?: string;
  profileVersion?: string | null;
  profile_version?: string | null;
  definitionHash?: string | null;
  definition_hash?: string | null;
  probability: number;
  rawProbability?: number | null;
  raw_probability?: number | null;
  calibratedProbability?: number | null;
  calibrated_probability?: number | null;
  confidence?: string | number | null;
  risk?: string | null;
  route?: string | null;
  verdict?: string | null;
  findings?: unknown;
  vetoReason?: string | null;
  veto_reason?: string | null;
  calibration?: unknown;
  metadata?: unknown;
};

type CreatePredictedRunInput = {
  mode: "task" | "agent" | "agency";
  task: string;
  repository: string;
  provider: string;
  model: string;
  successProbability: number;
  route: string;
  risk: string;
  assessment: unknown;
  profileId?: string | null;
  profile_id?: string | null;
  profileVersion?: string | null;
  profile_version?: string | null;
  definitionHash?: string | null;
  definition_hash?: string | null;
  taskClass?: string | null;
  task_class?: string | null;
  selectionStrategy?: string | null;
  selection_strategy?: string | null;
  rawProbability?: number | null;
  raw_probability?: number | null;
  calibratedProbability?: number | null;
  calibrated_probability?: number | null;
  calibration?: { method?: string | null; sample_size?: number | null; sampleSize?: number | null; [key: string]: unknown } | null;
  calibrationMetadata?: unknown;
  calibration_metadata?: unknown;
  agencyVotes?: AgencyVoteInput[];
  agency_votes?: AgencyVoteInput[];
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
  profile_id: string | null;
  profile_version: string | null;
  definition_hash: string | null;
  task_class: string | null;
  selection_strategy: string | null;
  success_probability: number;
  raw_probability: number | null;
  calibrated_probability: number | null;
  calibration_method: string | null;
  calibration_sample_size: number | null;
  calibration_metadata_json: string | null;
  route: string;
  risk: string;
  outcome: number | null;
  brier: number | null;
  raw_brier: number | null;
  calibrated_brier: number | null;
  failure_code: string | null;
  failure_summary: string | null;
  test_passed: number | null;
  build_passed: number | null;
  diff_within_scope: number | null;
  diff_files: number | null;
  diff_additions: number | null;
  diff_deletions: number | null;
};

type AgencyVoteRow = {
  profile_id: string;
  profile_name: string;
  outcome: number | null;
  brier: number | null;
  raw_brier: number | null;
  calibrated_brier: number | null;
};

function database() {
  const db = (env as { DB?: D1Database }).DB;
  if (!db) throw new Error("D1_UNAVAILABLE");
  return db;
}

async function ensureRunSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_runs (
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
      profile_id TEXT,
      profile_version TEXT,
      definition_hash TEXT,
      task_class TEXT,
      selection_strategy TEXT,
      success_probability INTEGER NOT NULL,
      raw_probability INTEGER,
      calibrated_probability INTEGER,
      calibration_method TEXT,
      calibration_sample_size INTEGER,
      calibration_metadata_json TEXT,
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
      raw_brier REAL,
      calibrated_brier REAL,
      failure_code TEXT,
      failure_summary TEXT,
      assessment_json TEXT NOT NULL,
      verification_json TEXT
    )`).run();

  // CREATE TABLE IF NOT EXISTS does not evolve an existing D1 table. Additive
  // upgrades keep deployments created by earlier versions readable and writable.
  const columns = await db.prepare("PRAGMA table_info(agent_runs)").all<{ name: string }>();
  const known = new Set(columns.results.map((column: { name: string }) => column.name));
  const additions: Array<[string, string]> = [
    ["profile_id", "TEXT"],
    ["profile_version", "TEXT"],
    ["definition_hash", "TEXT"],
    ["task_class", "TEXT"],
    ["selection_strategy", "TEXT"],
    ["raw_probability", "INTEGER"],
    ["calibrated_probability", "INTEGER"],
    ["calibration_method", "TEXT"],
    ["calibration_sample_size", "INTEGER"],
    ["calibration_metadata_json", "TEXT"],
    ["raw_brier", "REAL"],
    ["calibrated_brier", "REAL"],
  ];
  for (const [name, type] of additions) {
    if (!known.has(name)) await db.prepare(`ALTER TABLE agent_runs ADD COLUMN ${name} ${type}`).run();
  }

  await db.prepare(`CREATE TABLE IF NOT EXISTS agency_votes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    profile_id TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    profile_version TEXT,
    definition_hash TEXT,
    probability INTEGER NOT NULL,
    raw_probability INTEGER,
    calibrated_probability INTEGER,
    confidence TEXT,
    risk TEXT,
    route TEXT,
    verdict TEXT,
    findings_json TEXT,
    veto_reason TEXT,
    calibration_metadata_json TEXT,
    metadata_json TEXT,
    outcome INTEGER,
    brier REAL,
    raw_brier REAL,
    calibrated_brier REAL
  )`).run();
  await db.batch([
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_status_created_idx ON agent_runs(status, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_model_resolved_idx ON agent_runs(model, resolved_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_runner_resolved_idx ON agent_runs(runner_name, resolved_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_profile_resolved_idx ON agent_runs(profile_id, resolved_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agent_runs_task_class_resolved_idx ON agent_runs(task_class, resolved_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agency_votes_run_idx ON agency_votes(run_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS agency_votes_profile_resolved_idx ON agency_votes(profile_id, resolved_at)"),
  ]);
}

function probability(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 50)));
}

function json(value: unknown) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export async function createPredictedRun(input: CreatePredictedRunInput) {
  const db = database();
  await ensureRunSchema(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  const calibration = input.calibration || null;
  const calibrationRaw = typeof calibration?.raw === "number" ? calibration.raw : undefined;
  const calibrationCalibrated = typeof calibration?.calibrated === "number" ? calibration.calibrated : undefined;
  const rawProbability = probability(input.rawProbability ?? input.raw_probability ?? calibrationRaw ?? input.successProbability);
  const calibratedProbability = probability(input.calibratedProbability ?? input.calibrated_probability ?? calibrationCalibrated ?? input.successProbability);
  const calibrationMetadata = input.calibrationMetadata ?? input.calibration_metadata ?? calibration;
  const runInsert = db.prepare(`INSERT INTO agent_runs (
    id, created_at, updated_at, status, mode, task, repository, provider, model,
    profile_id, profile_version, definition_hash, task_class, selection_strategy,
    success_probability, raw_probability, calibrated_probability, calibration_method,
    calibration_sample_size, calibration_metadata_json, route, risk, assessment_json
  ) VALUES (?, ?, ?, 'predicted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id,
    now,
    now,
    input.mode,
    input.task,
    input.repository,
    input.provider,
    input.model,
    input.profileId ?? input.profile_id ?? null,
    input.profileVersion ?? input.profile_version ?? null,
    input.definitionHash ?? input.definition_hash ?? null,
    input.taskClass ?? input.task_class ?? null,
    input.selectionStrategy ?? input.selection_strategy ?? null,
    calibratedProbability,
    rawProbability,
    calibratedProbability,
    calibration?.method || null,
    calibration?.sample_size ?? calibration?.sampleSize ?? null,
    json(calibrationMetadata),
    input.route,
    input.risk,
    JSON.stringify(input.assessment),
  );

  const votes = input.agencyVotes ?? input.agency_votes ?? [];
  const voteInserts = votes.map((vote) => {
    const profileId = vote.profileId ?? vote.profile_id;
    if (!profileId) throw new Error("AGENCY_VOTE_PROFILE_REQUIRED");
    const raw = probability(vote.rawProbability ?? vote.raw_probability ?? vote.probability);
    const calibrated = probability(vote.calibratedProbability ?? vote.calibrated_probability ?? vote.probability);
    return db.prepare(`INSERT INTO agency_votes (
      id, run_id, created_at, profile_id, profile_name, profile_version, definition_hash,
      probability, raw_probability, calibrated_probability, confidence, risk, route, verdict,
      findings_json, veto_reason, calibration_metadata_json, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(), id, now, profileId, vote.profileName ?? vote.profile_name ?? profileId,
      vote.profileVersion ?? vote.profile_version ?? null,
      vote.definitionHash ?? vote.definition_hash ?? null,
      calibrated, raw, calibrated,
      vote.confidence === undefined || vote.confidence === null ? null : String(vote.confidence),
      vote.risk ?? null, vote.route ?? null, vote.verdict ?? null, json(vote.findings),
      vote.vetoReason ?? vote.veto_reason ?? null, json(vote.calibration), json(vote.metadata),
    );
  });
  await db.batch([runInsert, ...voteInserts]);
  return { id, status: "predicted", created_at: now };
}

export async function getRun(id: string): Promise<RunRow | null> {
  const db = database();
  await ensureRunSchema(db);
  return db.prepare(`SELECT id, created_at, updated_at, status, mode, task, repository,
    provider, model, runner_name, profile_id, profile_version, definition_hash, task_class,
    selection_strategy, success_probability, raw_probability, calibrated_probability,
    calibration_method, calibration_sample_size, calibration_metadata_json, route, risk, outcome, brier, raw_brier, calibrated_brier,
    failure_code, failure_summary, test_passed, build_passed, diff_within_scope,
    diff_files, diff_additions, diff_deletions
    FROM agent_runs WHERE id = ?`).bind(id).first<RunRow>();
}

export async function listRuns(limit = 30): Promise<RunRow[]> {
  const db = database();
  await ensureRunSchema(db);
  const result = await db.prepare(`SELECT id, created_at, updated_at, status, mode, task, repository,
    provider, model, runner_name, profile_id, profile_version, definition_hash, task_class,
    selection_strategy, success_probability, raw_probability, calibrated_probability,
    calibration_method, calibration_sample_size, calibration_metadata_json, route, risk, outcome, brier, raw_brier, calibrated_brier,
    failure_code, failure_summary, test_passed, build_passed, diff_within_scope,
    diff_files, diff_additions, diff_deletions
    FROM agent_runs ORDER BY created_at DESC LIMIT ?`).bind(Math.max(1, Math.min(100, limit))).all<RunRow>();
  return result.results;
}

export async function getRunVotes(id: string) {
  const db = database();
  await ensureRunSchema(db);
  const result = await db.prepare(`SELECT id, run_id, created_at, resolved_at, profile_id,
    profile_name, profile_version, definition_hash, probability, raw_probability,
    calibrated_probability, confidence, risk, route, verdict, findings_json, veto_reason,
    calibration_metadata_json, metadata_json,
    outcome, brier, raw_brier, calibrated_brier
    FROM agency_votes WHERE run_id = ? ORDER BY created_at ASC`).bind(id).all();
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
  const rawProbability = (current.raw_probability ?? current.success_probability) / 100;
  const calibratedProbability = (current.calibrated_probability ?? current.success_probability) / 100;
  const rawBrier = (rawProbability - outcome) ** 2;
  const calibratedBrier = (calibratedProbability - outcome) ** 2;
  const code = failureCode(input) || (verificationAttempted ? null : "NO_VERIFICATION");
  const now = Date.now();
  await db.batch([db.prepare(`UPDATE agent_runs SET
    status = ?, runner_name = ?, resolved_at = ?, updated_at = ?, test_command = ?, build_command = ?,
    test_passed = ?, build_passed = ?, diff_within_scope = ?, diff_files = ?, diff_additions = ?,
    diff_deletions = ?, baseline_commit = COALESCE(baseline_commit, ?), final_commit = ?, outcome = ?,
    brier = ?, raw_brier = ?, calibrated_brier = ?, failure_code = ?, failure_summary = ?, verification_json = ?
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
    calibratedBrier,
    rawBrier,
    calibratedBrier,
    code,
    input.failureSummary?.slice(0, 1000) || null,
    JSON.stringify(input.verification || {}),
    id,
  ), db.prepare(`UPDATE agency_votes SET
    resolved_at = ?, outcome = ?,
    raw_brier = ((COALESCE(raw_probability, probability) / 100.0) - ?) * ((COALESCE(raw_probability, probability) / 100.0) - ?),
    calibrated_brier = ((COALESCE(calibrated_probability, probability) / 100.0) - ?) * ((COALESCE(calibrated_probability, probability) / 100.0) - ?),
    brier = ((COALESCE(calibrated_probability, probability) / 100.0) - ?) * ((COALESCE(calibrated_probability, probability) / 100.0) - ?)
    WHERE run_id = ? AND outcome IS NULL`).bind(
    now, outcome, outcome, outcome, outcome, outcome, outcome, outcome, id,
  )]);
  return getRun(id);
}

export async function intelligenceSummary() {
  const rows = await listRuns(100);
  const resolved = rows.filter((row) => row.outcome === 0 || row.outcome === 1);
  const db = database();
  const voteResult = await db.prepare(`SELECT profile_id, profile_name, outcome, brier, raw_brier, calibrated_brier
    FROM agency_votes WHERE outcome IS NOT NULL ORDER BY resolved_at DESC LIMIT 1000`).all<AgencyVoteRow>();
  const resolvedVotes = voteResult.results;
  const group = <T extends string>(key: (row: RunRow) => T, source: RunRow[] = resolved) => {
    const groups = new Map<T, RunRow[]>();
    for (const row of source) groups.set(key(row), [...(groups.get(key(row)) || []), row]);
    return [...groups.entries()].map(([name, items]) => {
      const calibratedBrier = items.reduce((sum, item) => sum + Number(item.calibrated_brier ?? item.brier ?? 0), 0) / items.length;
      const rawBrier = items.reduce((sum, item) => sum + Number(item.raw_brier ?? item.brier ?? 0), 0) / items.length;
      const success = items.reduce((sum, item) => sum + Number(item.outcome || 0), 0) / items.length;
      return {
        name,
        resolved: items.length,
        success_rate: Math.round(success * 100),
        brier: Number(calibratedBrier.toFixed(4)),
        raw_brier: Number(rawBrier.toFixed(4)),
        calibrated_brier: Number(calibratedBrier.toFixed(4)),
        calibration_lift: Number((rawBrier - calibratedBrier).toFixed(4)),
        calibration_score: Math.max(0, Math.round((1 - calibratedBrier) * 100)),
      };
    }).sort((a, b) => b.calibration_score - a.calibration_score || b.resolved - a.resolved);
  };
  const specialistGroups = new Map<string, AgencyVoteRow[]>();
  for (const vote of resolvedVotes) specialistGroups.set(vote.profile_id, [...(specialistGroups.get(vote.profile_id) || []), vote]);
  const specialists = [...specialistGroups.entries()].map(([profileId, items]) => {
    const calibratedBrier = items.reduce((sum, item) => sum + Number(item.calibrated_brier ?? item.brier ?? 0), 0) / items.length;
    const rawBrier = items.reduce((sum, item) => sum + Number(item.raw_brier ?? item.brier ?? 0), 0) / items.length;
    const success = items.reduce((sum, item) => sum + Number(item.outcome || 0), 0) / items.length;
    return {
      name: items[0]?.profile_name || profileId,
      profile_id: profileId,
      resolved: items.length,
      success_rate: Math.round(success * 100),
      brier: Number(calibratedBrier.toFixed(4)),
      raw_brier: Number(rawBrier.toFixed(4)),
      calibrated_brier: Number(calibratedBrier.toFixed(4)),
      calibration_lift: Number((rawBrier - calibratedBrier).toFixed(4)),
      calibration_score: Math.max(0, Math.round((1 - calibratedBrier) * 100)),
    };
  }).sort((a, b) => b.calibration_score - a.calibration_score || b.resolved - a.resolved);
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
      profiles: group((row) => row.profile_id!, resolved.filter((row) => Boolean(row.profile_id))),
      specialists,
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
  const result = await db.prepare(`SELECT COALESCE(raw_probability, success_probability) AS success_probability, outcome FROM agent_runs
    WHERE outcome IS NOT NULL AND mode = ? AND model = ?
    ORDER BY resolved_at DESC LIMIT 200`).bind(mode, model).all<{ success_probability: number; outcome: number }>();
  return empiricalBayesCalibration(rawProbability, result.results);
}
