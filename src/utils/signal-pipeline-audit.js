function normalizeSignalPayload(signal = {}) {
  return {
    signalId: signal.id || null,
    symbol: signal.symbol || signal.asset || "UNKNOWN",
    signal: signal.signal || signal.direction || "WAIT",
    result: signal.result || null,
    executionAllowed: signal.executionAllowed ?? signal.execution_allowed ?? null,
    finalScore: Number(signal.finalScore ?? signal.final_score ?? signal.score ?? signal.confidence ?? 0)
  };
}

function auditSignalPipeline(event, signal = {}, context = {}) {
  console.log(JSON.stringify({
    scope: "signal_pipeline_audit",
    event,
    timestamp: new Date().toISOString(),
    ...normalizeSignalPayload(signal),
    ...context
  }));
}

module.exports = {
  auditSignalPipeline
};
