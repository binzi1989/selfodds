export const SCORE_STANDARD_VERSION = "selfodds-opportunity-v1";
export const FORECAST_HORIZON_DAYS = 7;

export const OPPORTUNITY_WEIGHTS = {
  demand: 25,
  momentum: 15,
  differentiation: 20,
  buildability: 20,
  distribution: 10,
  evidence: 10,
} as const;

export const SCORE_ANCHORS = {
  0: "Evidence contradicts the claim or no meaningful signal exists",
  25: "Only a self-reported claim or weak proxy exists",
  50: "The claim is clear but remains materially unvalidated",
  75: "Multiple independent observed signals support the claim",
  100: "Repeated real-world outcomes strongly establish the claim",
} as const;

export const DIMENSION_DEFINITIONS = {
  demand: "A concrete, recurring user problem supported by behavior beyond stars or README claims",
  momentum: "Recent and sustained activity or adoption, discounted for one-off novelty spikes",
  differentiation: "A specific underserved angle that is not merely a feature-for-feature clone",
  buildability: "A useful and falsifiable seven-day experiment can be delivered with available resources",
  distribution: "The target users are reachable through identifiable channels and sharing loops",
  evidence: "Material claims are traceable to observed metadata, repository content, or outcomes",
} as const;

export type OpportunityRubric = Record<keyof typeof OPPORTUNITY_WEIGHTS, number>;

export function calculateOpportunityScore(scores: OpportunityRubric) {
  return Math.round(Object.entries(OPPORTUNITY_WEIGHTS).reduce(
    (total, [key, weight]) => total + scores[key as keyof OpportunityRubric] * weight / 100,
    0,
  ));
}

export function opportunityGrade(score: number) {
  if (score >= 80) return "A" as const;
  if (score >= 65) return "B" as const;
  if (score >= 50) return "C" as const;
  return "D" as const;
}

export function scoreBand(score: number) {
  if (score >= 80) return "STRONG_EXPERIMENT" as const;
  if (score >= 65) return "WORTH_TESTING" as const;
  if (score >= 50) return "WEAK_EVIDENCE" as const;
  return "PASS" as const;
}

export function trendStarThreshold(stars: number) {
  return Math.max(10, Math.round(Math.sqrt(Math.max(0, stars)) * 2));
}

export function predictionInterval(probability: number, evidenceQuality: "LOW" | "MEDIUM" | "HIGH") {
  const margin = evidenceQuality === "HIGH" ? 8 : evidenceQuality === "MEDIUM" ? 15 : 24;
  return {
    lower: Math.max(5, probability - margin),
    upper: Math.min(95, probability + margin),
  };
}

export function sevenDayForecastContract(stars: number) {
  const threshold = trendStarThreshold(stars);
  return {
    horizon_days: FORECAST_HORIZON_DAYS,
    star_growth_threshold: threshold,
    description: `Within 7 days the repository gains at least ${threshold} stars, remains unarchived, and shows repository activity no older than the baseline snapshot.`,
  };
}
