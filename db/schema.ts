import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const forecasts = sqliteTable("forecasts", {
  id: text("id").primaryKey(),
  repository: text("repository").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  createdAt: integer("created_at").notNull(),
  dueAt: integer("due_at").notNull(),
  baselineStars: integer("baseline_stars").notNull(),
  baselinePushedAt: text("baseline_pushed_at"),
  starThreshold: integer("star_threshold").notNull(),
  trendProbability: integer("trend_probability").notNull(),
  opportunityScore: integer("opportunity_score"),
  evidenceQuality: text("evidence_quality").notNull(),
  status: text("status").notNull().default("pending"),
  outcome: integer("outcome"),
  resolvedAt: integer("resolved_at"),
  observedStars: integer("observed_stars"),
  observedPushedAt: text("observed_pushed_at"),
  brier: real("brier"),
  assessmentJson: text("assessment_json").notNull(),
}, (table) => [index("forecasts_status_due_idx").on(table.status, table.dueAt)]);
