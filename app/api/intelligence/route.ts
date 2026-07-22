export async function GET() {
  try {
    const { intelligenceSummary } = await import("../../../db/runs.ts");
    return Response.json({ ok: true, storage_available: true, ...(await intelligenceSummary()) });
  } catch (error) {
    console.error("SelfOdds intelligence unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({
      ok: true,
      storage_available: false,
      total: 0,
      pending: 0,
      resolved: 0,
      leaderboard: { models: [], runners: [], profiles: [], specialists: [] },
      calibration_bins: [],
      failure_patterns: [],
      knowledge_graph: { nodes: [], edges: [] },
      recent_runs: [],
    });
  }
}
