export async function GET() {
  try {
    const { calibrationSummary, settleDueForecasts } = await import("../../../db/calibration.ts");
    const newlyResolved = await settleDueForecasts();
    const summary = await calibrationSummary();
    return Response.json({ ok: true, newly_resolved: newlyResolved, ...summary });
  } catch (error) {
    console.error("SelfOdds calibration unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json({
      ok: true,
      storage_available: false,
      total: 0,
      pending: 0,
      resolved: 0,
      actual_success_rate: null,
      brier_score: null,
      calibration_score: null,
      bins: [],
    });
  }
}
