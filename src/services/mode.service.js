const env = require("../config/env");
const { OPERATION_MODES } = require("../config/constants");

function resolveMode(mode) {
  const safeMode = String(mode || env.engine.mode || "equilibrado").toLowerCase();
  return OPERATION_MODES[safeMode] || OPERATION_MODES.equilibrado;
}

function getModeThreshold(mode) {
  const selectedMode = resolveMode(mode);

  if (selectedMode.key === "conservador") {
    return env.filters.minScoreConservador;
  }

  if (selectedMode.key === "agressivo") {
    return env.filters.minScoreAgressivo;
  }

  return env.filters.minScoreEquilibrado;
}

function describeMode(mode) {
  const selectedMode = resolveMode(mode);

  return {
    key: selectedMode.key,
    label: selectedMode.label,
    description: selectedMode.description,
    minScore: getModeThreshold(selectedMode.key)
  };
}

function validateSignalForMode(score, mode) {
  const minScore = getModeThreshold(mode);

  return {
    approved: Number(score || 0) >= minScore,
    threshold: minScore
  };
}

function listModes() {
  return Object.values(OPERATION_MODES).map((mode) => ({
    key: mode.key,
    label: mode.label,
    description: mode.description,
    minScore: getModeThreshold(mode.key)
  }));
}

module.exports = {
  resolveMode,
  getModeThreshold,
  describeMode,
  validateSignalForMode,
  listModes
};