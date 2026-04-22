const OPERATION_MODES = {
  conservador: {
    key: "conservador",
    label: "Conservador",
    minScore: "minScoreConservador",
    description:
      "Busca maior seletividade, menos entradas e foco em sinais mais filtrados."
  },
  equilibrado: {
    key: "equilibrado",
    label: "Equilibrado",
    minScore: "minScoreEquilibrado",
    description:
      "Operação balanceada entre frequência e qualidade."
  },
  agressivo: {
    key: "agressivo",
    label: "Agressivo",
    minScore: "minScoreAgressivo",
    description:
      "Mais oportunidades, resposta mais rápida e maior sensibilidade operacional."
  }
};

const SIGNAL_DIRECTIONS = {
  CALL: "CALL",
  PUT: "PUT",
  AGUARDANDO: "AGUARDANDO"
};

const SIGNAL_RESULTS = {
  WIN: "Win",
  LOSS: "Loss",
  PENDING: "Pendente"
};

const MARKET_SESSIONS = {
  LONDON: "Londres",
  NEW_YORK: "Nova York",
  ASIA: "Ásia"
};

module.exports = {
  OPERATION_MODES,
  SIGNAL_DIRECTIONS,
  SIGNAL_RESULTS,
  MARKET_SESSIONS
};