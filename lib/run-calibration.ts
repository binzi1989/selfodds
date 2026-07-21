export type ResolvedProbability = { success_probability: number; outcome: number };

export function empiricalBayesCalibration(rawProbability: number, samples: ResolvedProbability[]) {
  if (samples.length < 5) {
    return { raw: rawProbability, calibrated: rawProbability, sample_size: samples.length, method: "identity_insufficient_data" as const };
  }
  const local = samples.filter((row) => Math.abs(row.success_probability - rawProbability) <= 15);
  const evidence = local.length >= 3 ? local : samples;
  const priorStrength = 5;
  const successes = evidence.reduce((sum, row) => sum + Number(row.outcome), 0);
  const posterior = (successes + priorStrength * rawProbability / 100) / (evidence.length + priorStrength);
  const calibrated = Math.max(5, Math.min(95, Math.round(posterior * 100)));
  return { raw: rawProbability, calibrated, sample_size: evidence.length, method: "empirical_bayes_v1" as const };
}
