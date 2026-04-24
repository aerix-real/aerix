// ==========================
// CONFIG BASE
// ==========================
const API_BASE = "";
const socket = io();

// ==========================
// ELEMENTOS
// ==========================
const el = {
  signalCard: document.getElementById("signalCard"),
  signalMode: document.getElementById("signalMode"),
  signalAsset: document.getElementById("signalAsset"),
  signalDirection: document.getElementById("signalDirection"),
  signalConfidence: document.getElementById("signalConfidence"),
  signalEntry: document.getElementById("signalEntry"),
  signalExpiry: document.getElementById("signalExpiry"),
  signalCountdown: document.getElementById("signalCountdown"),
  signalScore: document.getElementById("signalScore"),
  confidenceRing: document.getElementById("confidenceRing"),

  headlineText: document.getElementById("headlineText"),

  aiStatus: document.getElementById("aiStatus"),
  aiExplanation: document.getElementById("aiExplanation"),
  aiRisk: document.getElementById("aiRisk"),
  aiConfidence: document.getElementById("aiConfidence"),

  bestAsset: document.getElementById("bestAsset"),
  bestReason: document.getElementById("bestReason"),
  bestScore: document.getElementById("bestScore"),

  executionBadge: document.getElementById("executionBadge"),
};

// ==========================
// UTIL
// ==========================
function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString();
}

setInterval(() => {
  const clock = document.getElementById("liveClock");
  if (clock) clock.textContent = formatTime();
}, 1000);

// ==========================
// ATUALIZA SINAL
// ==========================
function updateSignal(signal = {}) {
  if (!signal) return;

  el.signalAsset.textContent = signal.symbol || "--";

  const dir = signal.direction || "WAIT";

  el.signalDirection.textContent =
    dir === "CALL" ? "CALL" :
    dir === "PUT" ? "PUT" : "AGUARDANDO";

  el.signalDirection.className =
    "signal-direction " +
    (dir === "CALL" ? "buy" : dir === "PUT" ? "sell" : "neutral");

  const confidence = Math.round(
    Number(signal.adjustedScore ?? signal.finalScore ?? signal.confidence ?? 0)
  );

  el.signalConfidence.textContent = `${confidence}%`;

  el.signalScore.textContent = confidence;

  el.signalEntry.textContent = signal.entryTime || "--";
  el.signalExpiry.textContent = signal.expiryTime || "--";
  el.signalCountdown.textContent = signal.entryInSeconds
    ? `${signal.entryInSeconds}s`
    : "--";

  // círculo
  if (el.confidenceRing) {
    const deg = confidence * 3.6;
    el.confidenceRing.style.background =
      `conic-gradient(#4da3ff ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)`;
  }
}

// ==========================
// 🔥 MODO COMERCIAL (HEDGE FUND)
// ==========================
function flashCommercialSignal(signal = {}) {
  if (!el.signalCard) return;

  el.signalCard.classList.remove("execution-ready", "execution-wait");
  void el.signalCard.offsetWidth;

  if (signal.executionAllowed) {
    el.signalCard.classList.add("execution-ready");
  } else {
    el.signalCard.classList.add("execution-wait");
  }

  // BADGE
  if (el.executionBadge) {
    el.executionBadge.textContent = signal.executionAllowed
      ? "EXECUTAR"
      : "AGUARDAR";

    el.executionBadge.className =
      "execution-badge " +
      (signal.executionAllowed ? "execute" : "wait");
  }

  // HEADLINE
  if (el.headlineText) {
    el.headlineText.textContent = signal.executionAllowed
      ? `🟢 EXECUÇÃO LIBERADA • ${signal.symbol} • Entrada imediata`
      : `🟡 OPORTUNIDADE DETECTADA • ${signal.symbol} • Aguardando timing`;
  }

  // IA
  if (el.aiStatus) {
    el.aiStatus.textContent = signal.executionAllowed
      ? "IA APROVOU EXECUÇÃO"
      : "IA DETECTOU OPORTUNIDADE";
  }

  if (el.aiExplanation) {
    el.aiExplanation.textContent = signal.executionAllowed
      ? `Entrada liberada: ${signal.executionReason || "confluência aprovada"}`
      : `Bloqueado: ${signal.executionReason || "aguardando timing ideal"}`;
  }

  if (el.aiRisk) {
    el.aiRisk.textContent = signal.executionAllowed
      ? "Risco: baixo"
      : "Risco: médio";
  }

  if (el.aiConfidence) {
    el.aiConfidence.textContent =
      `Score IA: ${Math.round(signal.adjustedScore || 0)}%`;
  }
}

// ==========================
// EXECUÇÃO
// ==========================
function flashExecution() {
  document.body.classList.add("execution-flash");

  setTimeout(() => {
    document.body.classList.remove("execution-flash");
  }, 1200);
}

// ==========================
// SOCKET
// ==========================
socket.on("connect", () => {
  console.log("Conectado ao servidor");
});

socket.on("engine:update", (data) => {
  if (!data) return;

  if (data.bestOpportunity) {
    updateSignal(data.bestOpportunity);
  }
});

socket.on("commercialSignal", (signal) => {
  console.log("SINAL COMERCIAL:", signal);

  updateSignal(signal);
  flashCommercialSignal(signal);
});

socket.on("autoExecution", (execution) => {
  console.log("EXECUTADO:", execution);
  flashExecution();
});

// ==========================
// INIT
// ==========================
async function init() {
  try {
    const res = await fetch("/api/dashboard");
    const data = await res.json();

    if (data?.data?.signalCenter?.bestOpportunity) {
      updateSignal(data.data.signalCenter.bestOpportunity);
    }
  } catch (err) {
    console.error("Erro init:", err);
  }
}

init();