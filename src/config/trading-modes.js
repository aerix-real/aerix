const TRADING_MODES = {
  conservative: {
    key: "conservative",
    label: "Conservador",
    minimumConfidence: 84,
    confirmationWeight: 1.25,
    trendWeight: 1.2,
    volatilityTolerance: 0.75,
    reversalTolerance: 0.55,
    entryStrictness: 1.3,
    description: "Menos sinais, maior exigência de qualidade e confirmação."
  },
  balanced: {
    key: "balanced",
    label: "Equilibrado",
    minimumConfidence: 76,
    confirmationWeight: 1.0,
    trendWeight: 1.0,
    volatilityTolerance: 1.0,
    reversalTolerance: 1.0,
    entryStrictness: 1.0,
    description: "Equilíbrio entre frequência, filtragem e assertividade."
  },
  aggressive: {
    key: "aggressive",
    label: "Agressivo",
    minimumConfidence: 68,
    confirmationWeight: 0.9,
    trendWeight: 0.9,
    volatilityTolerance: 1.2,
    reversalTolerance: 1.15,
    entryStrictness: 0.85,
    description: "Mais oportunidades, aceitando maior agressividade operacional."
  }
};

function getTradingMode(mode) {
  return TRADING_MODES[mode] || TRADING_MODES.balanced;
}

function listTradingModes() {
  return Object.values(TRADING_MODES);
}

module.exports = {
  TRADING_MODES,
  getTradingMode,
  listTradingModes
};