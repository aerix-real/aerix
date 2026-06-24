const AUDIT_SCOPE = "signal_pipeline_audit";

function resolveStrategy(signal = {}) {
  return signal.strategyName || signal.strategy_name || signal.strategy || null;
}

function resolveScore(signal = {}) {
  return Number(signal.score ?? signal.adjustedScore ?? signal.adjusted_score ?? signal.finalScore ?? signal.final_score ?? signal.confidence ?? 0);
}

function resolveExecutionAllowed(signal = {}) {
  if (signal.executionAllowed !== undefined) return Boolean(signal.executionAllowed);
  if (signal.execution_allowed !== undefined) return Boolean(signal.execution_allowed);
  if (signal.execution?.allowed !== undefined) return Boolean(signal.execution.allowed);
  return false;
}

function buildSignalPipelineAuditEvent(event, signal = {}, extra = {}) {
  return {
    scope: AUDIT_SCOPE,
    event,
    timestamp: new Date().toISOString(),
    symbol: signal.symbol || signal.asset || "UNKNOWN",
    signal: signal.signal || signal.direction || "WAIT",
    strategy: resolveStrategy(signal),
    score: resolveScore(signal),
    confidence: Number(signal.confidence ?? signal.score ?? 0),
    executionAllowed: resolveExecutionAllowed(signal),
    ...extra
  };
}

function auditSignalPipeline(event, signal = {}, extra = {}) {
  console.log(JSON.stringify(buildSignalPipelineAuditEvent(event, signal, extra)));
}

module.exports = {
  AUDIT_SCOPE,
  buildSignalPipelineAuditEvent,
  auditSignalPipeline
};
