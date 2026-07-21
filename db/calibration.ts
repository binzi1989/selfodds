import { env } from "cloudflare:workers";
import { fetchRepositoryEvidence } from "../lib/github-evidence.ts";
import { FORECAST_HORIZON_DAYS, sevenDayForecastContract } from "../lib/evaluation-standard.ts";

type ForecastInput = {
  repository: string;
  repoFullName: string;
  baselineStars: number;
  baselinePushedAt?: string;
  trendProbability: number;
  opportunityScore?: number | null;
  evidenceQuality: "LOW" | "MEDIUM" | "HIGH";
  assessment: unknown;
};

type PendingForecast = {
  id: string;
  repository: string;
  baseline_stars: number;
  baseline_pushed_at: string | null;
  star_threshold: number;
  trend_probability: number;
};

function database() {
  const db = (env as { DB?: D1Database }).DB;
  if (!db) throw new Error("D1_UNAVAILABLE");
  return db;
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS forecasts (
      id TEXT PRIMARY KEY,
      repository TEXT NOT NULL,
      repo_full_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      due_at INTEGER NOT NULL,
      baseline_stars INTEGER NOT NULL,
      baseline_pushed_at TEXT,
      star_threshold INTEGER NOT NULL,
      trend_probability INTEGER NOT NULL,
      opportunity_score INTEGER,
      evidence_quality TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      outcome INTEGER,
      resolved_at INTEGER,
      observed_stars INTEGER,
      observed_pushed_at TEXT,
      brier REAL,
      assessment_json TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS forecasts_status_due_idx ON forecasts(status, due_at)"),
  ]);
}

export async function saveForecast(input: ForecastInput) {
  const db = database();
  await ensureSchema(db);
  const createdAt = Date.now();
  const dueAt = createdAt + FORECAST_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const contract = sevenDayForecastContract(input.baselineStars);
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO forecasts (
    id, repository, repo_full_name, created_at, due_at, baseline_stars, baseline_pushed_at,
    star_threshold, trend_probability, opportunity_score, evidence_quality, status, assessment_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .bind(
      id,
      input.repository,
      input.repoFullName,
      createdAt,
      dueAt,
      input.baselineStars,
      input.baselinePushedAt || null,
      contract.star_growth_threshold,
      input.trendProbability,
      input.opportunityScore ?? null,
      input.evidenceQuality,
      JSON.stringify(input.assessment),
    ).run();
  return { id, created_at: createdAt, due_at: dueAt, contract };
}

export async function settleDueForecasts(limit = 10) {
  const db = database();
  await ensureSchema(db);
  const due = await db.prepare(
    "SELECT id, repository, baseline_stars, baseline_pushed_at, star_threshold, trend_probability FROM forecasts WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC LIMIT ?",
  ).bind(Date.now(), limit).all<PendingForecast>();

  let resolved = 0;
  for (const forecast of due.results) {
    const evidence = await fetchRepositoryEvidence(forecast.repository);
    if (evidence.status !== "verified" || evidence.stars === undefined) continue;
    const starTargetMet = evidence.stars - forecast.baseline_stars >= forecast.star_threshold;
    const activityMaintained = !evidence.archived && (!forecast.baseline_pushed_at || !evidence.pushed_at || evidence.pushed_at >= forecast.baseline_pushed_at);
    const outcome = starTargetMet && activityMaintained ? 1 : 0;
    const probability = forecast.trend_probability / 100;
    const brier = (probability - outcome) ** 2;
    await db.prepare(`UPDATE forecasts SET
      status = 'resolved', outcome = ?, resolved_at = ?, observed_stars = ?, observed_pushed_at = ?, brier = ?
      WHERE id = ?`)
      .bind(outcome, Date.now(), evidence.stars, evidence.pushed_at || null, brier, forecast.id).run();
    resolved += 1;
  }
  return resolved;
}

export async function calibrationSummary() {
  const db = database();
  await ensureSchema(db);
  const aggregate = await db.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
    AVG(CASE WHEN status = 'resolved' THEN outcome END) AS actual_success,
    AVG(CASE WHEN status = 'resolved' THEN brier END) AS brier
    FROM forecasts`).first<{ total: number; pending: number; resolved: number; actual_success: number | null; brier: number | null }>();
  const recent = await db.prepare(`SELECT trend_probability, outcome
    FROM forecasts WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT 500`)
    .all<{ trend_probability: number; outcome: number }>();
  const bins = new Map<number, { forecastSum: number; outcomeSum: number; count: number }>();
  for (const row of recent.results) {
    const bucket = Math.min(90, Math.floor(row.trend_probability / 10) * 10);
    const current = bins.get(bucket) || { forecastSum: 0, outcomeSum: 0, count: 0 };
    current.forecastSum += row.trend_probability;
    current.outcomeSum += row.outcome * 100;
    current.count += 1;
    bins.set(bucket, current);
  }
  return {
    total: Number(aggregate?.total || 0),
    pending: Number(aggregate?.pending || 0),
    resolved: Number(aggregate?.resolved || 0),
    actual_success_rate: aggregate?.actual_success === null || aggregate?.actual_success === undefined ? null : Math.round(aggregate.actual_success * 100),
    brier_score: aggregate?.brier === null || aggregate?.brier === undefined ? null : Number(aggregate.brier.toFixed(4)),
    calibration_score: aggregate?.brier === null || aggregate?.brier === undefined ? null : Math.max(0, Math.round((1 - aggregate.brier) * 100)),
    bins: [...bins.entries()].sort(([a], [b]) => a - b).map(([bucket, value]) => ({
      bucket: `${bucket}-${bucket + 9}`,
      mean_forecast: Math.round(value.forecastSum / value.count),
      actual_rate: Math.round(value.outcomeSum / value.count),
      count: value.count,
    })),
  };
}
