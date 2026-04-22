const state = {
  history: [],
  signal: null,
  stats: {
    signalsToday: 0,
    winRate: 0,
    wins: 0,
    losses: 0
  },
  ranking: [],
  chartPoints: [42, 48, 45, 58, 54, 62, 60, 68, 64, 72],
  auth: {
    token: localStorage.getItem("aerix_token") || "",
    user: (() => {
      try {
        return JSON.parse(localStorage.getItem("aerix_user") || "null");
      } catch {
        return null;
      }
    })(),
    premiumAccess: false
  },
  preferences: {
    trading_mode: localStorage.getItem("aerix_mode") || "equilibrado"
  }
};

const el = {
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  loginUser: document.getElementById("loginUser"),
  loginPass: document.getElementById("loginPass"),

  liveClock: document.getElementById("liveClock"),
  connectionBadge: document.getElementById("connectionBadge"),
  connectionText: document.getElementById("connectionText"),
  headlineText: document.getElementById("headlineText"),

  marketStatusPill: document.getElementById("marketStatusPill"),
  marketStatusText: document.getElementById("marketStatusText"),

  priorityText: document.getElementById("priorityText"),
  priorityScore: document.getElementById("priorityScore"),

  bestAsset: document.getElementById("bestAsset"),
  bestScore: document.getElementById("bestScore"),
  bestReason: document.getElementById("bestReason"),

  signalCard: document.getElementById("signalCard"),
  signalMode: document.getElementById("signalMode"),
  signalTime: document.getElementById("signalTime"),
  signalAsset: document.getElementById("signalAsset"),
  signalDirection: document.getElementById("signalDirection"),
  signalConfidence: document.getElementById("signalConfidence"),
  signalEntry: document.getElementById("signalEntry"),
  signalExpiry: document.getElementById("signalExpiry"),
  signalCountdown: document.getElementById("signalCountdown"),
  signalScore: document.getElementById("signalScore"),
  confidenceRing: document.getElementById("confidenceRing"),

  aiExplanation: document.getElementById("aiExplanation"),
  miniChart: document.getElementById("miniChart"),

  systemStatus: document.getElementById("systemStatus"),
  marketPhase: document.getElementById("marketPhase"),
  focusAsset: document.getElementById("focusAsset"),
  lastUpdate: document.getElementById("lastUpdate"),

  sessionName: document.getElementById("sessionName"),
  volatilityText: document.getElementById("volatilityText"),

  trendLabel: document.getElementById("trendLabel"),
  trendStrength: document.getElementById("trendStrength"),
  trendBarFill: document.getElementById("trendBarFill"),
  trendBiasText: document.getElementById("trendBiasText"),

  opportunitiesCount: document.getElementById("opportunitiesCount"),
  avgQuality: document.getElementById("avgQuality"),

  signalsToday: document.getElementById("signalsToday"),
  winRate: document.getElementById("winRate"),
  winsCount: document.getElementById("winsCount"),
  lossCount: document.getElementById("lossCount"),

  rankingList: document.getElementById("rankingList"),
  historyList: document.getElementById("historyList"),

  modeSwitcher: document.getElementById("modeSwitcher"),
  modeDescription: document.getElementById("modeDescription"),

  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  userPlan: document.getElementById("userPlan"),
  logoutBtn: document.getElementById("logoutBtn"),

  premiumBanner: document.getElementById("premiumBanner"),
  premiumStatus: document.getElementById("premiumStatus"),
  premiumList: document.getElementById("premiumList")
};

let countdownInterval = null;
let audioCtx = null;
let activeSocket = null;

const MODE_CONFIG = {
  conservador: {
    label: "Conservador",
    backendValue: "conservative",
    description: "Busca maior seletividade, menos entradas e foco em sinais mais filtrados."
  },
  equilibrado: {
    label: "Equilibrado",
    backendValue: "balanced",
    description: "Operação balanceada entre frequência e qualidade."
  },
  agressivo: {
    label: "Agressivo",
    backendValue: "aggressive",
    description: "Mais oportunidades, resposta mais rápida e maior sensibilidade operacional."
  }
};

const BACKEND_TO_UI_MODE = {
  conservative: "conservador",
  balanced: "equilibrado",
  aggressive: "agressivo"
};

let currentMode = state.preferences.trading_mode || "equilibrado";

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", { hour12: false });
}

function updateClock() {
  if (el.liveClock) {
    el.liveClock.textContent = formatTime(new Date());
  }
}

setInterval(updateClock, 1000);
updateClock();

function getAuthHeaders() {
  const headers = {
    "Content-Type": "application/json"
  };

  if (state.auth.token) {
    headers.Authorization = `Bearer ${state.auth.token}`;
  }

  return headers;
}

function saveAuth(token, user) {
  state.auth.token = token || "";
  state.auth.user = user || null;

  if (token) localStorage.setItem("aerix_token", token);
  else localStorage.removeItem("aerix_token");

  if (user) localStorage.setItem("aerix_user", JSON.stringify(user));
  else localStorage.removeItem("aerix_user");

  localStorage.setItem("aerix_access", token || user ? "ok" : "off");
}

function clearAuth() {
  state.auth.premiumAccess = false;
  saveAuth("", null);
  localStorage.removeItem("aerix_access");
}

function isPremiumPlan() {
  return String(state.auth.user?.plan || "").toLowerCase() === "premium";
}

function applyPremiumUi() {
  const premium = state.auth.premiumAccess || isPremiumPlan();

  document.body.classList.toggle("plan-premium", premium);
  document.body.classList.toggle("plan-free", !premium);

  const premiumElements = document.querySelectorAll("[data-premium='true']");
  premiumElements.forEach((item) => {
    item.classList.toggle("locked", !premium);
  });

  const freeOnlyElements = document.querySelectorAll("[data-free-only='true']");
  freeOnlyElements.forEach((item) => {
    item.classList.toggle("hidden-by-plan", premium);
  });

  if (el.userPlan) {
    el.userPlan.textContent = premium ? "PREMIUM" : "FREE";
    el.userPlan.classList.toggle("premium", premium);
    el.userPlan.classList.toggle("free", !premium);
  }

  if (el.premiumStatus) {
    el.premiumStatus.textContent = premium
      ? "Premium ativo"
      : "Plano free ativo";
  }

  if (el.premiumBanner) {
    el.premiumBanner.classList.toggle("premium-active", premium);
    el.premiumBanner.classList.toggle("premium-locked", !premium);
  }

  if (el.premiumList) {
    el.premiumList.innerHTML = premium
      ? `
        <li>Sinais premium liberados</li>
        <li>Ranking avançado ativo</li>
        <li>Inteligência operacional premium</li>
        <li>Painel exclusivo habilitado</li>
      `
      : `
        <li>Sinais premium bloqueados</li>
        <li>Ranking avançado bloqueado</li>
        <li>Inteligência operacional premium bloqueada</li>
        <li>Upgrade necessário para liberar tudo</li>
      `;
  }
}

function updateUserUi() {
  if (el.userName) {
    el.userName.textContent = state.auth.user?.name || "Visitante";
  }

  if (el.userEmail) {
    el.userEmail.textContent = state.auth.user?.email || "--";
  }

  const avatar = document.querySelector(".user-avatar");
  if (avatar) {
    const first = String(state.auth.user?.name || state.auth.user?.email || "A").trim().charAt(0).toUpperCase();
    avatar.textContent = first || "A";
  }

  applyPremiumUi();
}

async function safeFetchJson(endpoint, options = {}) {
  try {
    const res = await fetch(endpoint, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {})
      }
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function tryRealLogin(email, password) {
  const endpoints = ["/api/auth/login", "/auth/login"];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) continue;

      const data = await response.json();

      const token =
        data.token ||
        data.accessToken ||
        data.jwt ||
        data?.data?.token ||
        data?.data?.accessToken ||
        "";

      const user =
        data.user ||
        data?.data?.user ||
        { email };

      if (token || user) {
        saveAuth(token, user);
        return { ok: true, data };
      }
    } catch (_) {}
  }

  return { ok: false };
}

async function fetchMe() {
  const me = await safeFetchJson("/api/auth/me");
  const user = me?.user || me?.data?.user || null;

  if (user) {
    state.auth.user = user;
    localStorage.setItem("aerix_user", JSON.stringify(user));
    updateUserUi();
    return true;
  }

  return false;
}

async function fetchPreferences() {
  const response = await safeFetchJson("/api/users/me/preferences");
  const preferences = response?.data || response || null;

  if (!preferences) return null;

  const backendMode = preferences.trading_mode || "balanced";
  const uiMode = BACKEND_TO_UI_MODE[backendMode] || "equilibrado";

  state.preferences = {
    ...state.preferences,
    ...preferences,
    trading_mode: uiMode
  };

  applyMode(uiMode, false);

  return preferences;
}

async function saveModePreference(uiMode) {
  const backendValue = MODE_CONFIG[uiMode]?.backendValue;

  if (!backendValue || !state.auth.token) return;

  try {
    await safeFetchJson("/api/users/me/preferences", {
      method: "PUT",
      body: JSON.stringify({
        trading_mode: backendValue
      })
    });
  } catch (_) {}
}

async function checkPremiumAccess() {
  const premiumData = await safeFetchJson("/api/premium/dashboard");

  if (premiumData) {
    state.auth.premiumAccess = true;
  } else {
    state.auth.premiumAccess = isPremiumPlan();
  }

  applyPremiumUi();
}

function setupLogout() {
  if (!el.logoutBtn) return;

  el.logoutBtn.addEventListener("click", () => {
    clearAuth();
    if (activeSocket) {
      try {
        activeSocket.disconnect();
      } catch (_) {}
    }
    if (el.loginOverlay) {
      el.loginOverlay.classList.remove("hidden");
    }
    updateUserUi();
    location.reload();
  });
}

function setupLogin() {
  const savedAccess = localStorage.getItem("aerix_access");
  const hasSavedAuth = Boolean(state.auth.token || state.auth.user || savedAccess === "ok");

  if (hasSavedAuth && el.loginOverlay) {
    el.loginOverlay.classList.add("hidden");
  }

  if (!el.loginForm) return;

  el.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const user = String(el.loginUser?.value || "").trim();
    const pass = String(el.loginPass?.value || "").trim();

    if (!user || !pass) {
      alert("Preencha usuário e senha.");
      return;
    }

    if (el.headlineText) {
      el.headlineText.textContent = "Validando acesso...";
    }

    const realLogin = await tryRealLogin(user, pass);

    if (!realLogin.ok) {
      alert("Login inválido. Use sua conta real do backend.");
      if (el.headlineText) {
        el.headlineText.textContent = `Fluxo operacional em tempo real • Modo ${MODE_CONFIG[currentMode].label.toLowerCase()}`;
      }
      return;
    }

    if (el.loginOverlay) {
      el.loginOverlay.classList.add("hidden");
    }

    await fetchMe();
    await fetchPreferences();
    await checkPremiumAccess();
    updateUserUi();
    await fetchInitialData();
    setupSocket();

    if (el.headlineText) {
      el.headlineText.textContent = `Fluxo operacional em tempo real • Modo ${MODE_CONFIG[currentMode].label.toLowerCase()}`;
    }
  });
}

function applyMode(mode, persist = true) {
  const safeMode = MODE_CONFIG[mode] ? mode : "equilibrado";
  currentMode = safeMode;

  localStorage.setItem("aerix_mode", safeMode);

  document.body.classList.remove("mode-conservador", "mode-equilibrado", "mode-agressivo");
  document.body.classList.add(`mode-${safeMode}`);

  const buttons = document.querySelectorAll(".mode-btn");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === safeMode);
  });

  if (el.modeDescription) {
    el.modeDescription.textContent = MODE_CONFIG[safeMode].description;
  }

  if (el.headlineText && !state.signal) {
    el.headlineText.textContent = `Fluxo operacional em tempo real • Modo ${MODE_CONFIG[safeMode].label.toLowerCase()}`;
  }

  if (persist) {
    saveModePreference(safeMode).catch(() => {});
  }
}

function setupModeSwitcher() {
  const savedMode = localStorage.getItem("aerix_mode") || "equilibrado";
  applyMode(savedMode, false);

  const buttons = document.querySelectorAll(".mode-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyMode(btn.dataset.mode, true);
    });
  });
}

function setConnectionStatus(status, extra = {}) {
  if (!el.connectionBadge || !el.connectionText || !el.systemStatus || !el.headlineText) return;

  el.connectionBadge.classList.remove("online", "offline", "connecting", "reconnecting");

  if (status === "online") {
    el.connectionBadge.classList.add("online");
    el.connectionText.textContent = "Tempo real";
    el.systemStatus.textContent = "Online";

    if (!state.signal) {
      el.headlineText.textContent = `Fluxo operacional em tempo real • Modo ${MODE_CONFIG[currentMode].label.toLowerCase()}`;
    }
    return;
  }

  if (status === "reconnecting") {
    el.connectionBadge.classList.add("reconnecting");
    const attemptText = typeof extra.attempt === "number" ? ` (${extra.attempt})` : "";
    el.connectionText.textContent = `Reconectando${attemptText}`;
    el.systemStatus.textContent = "Reconectando";
    el.headlineText.textContent = "Restabelecendo conexão com o servidor";
    return;
  }

  if (status === "offline") {
    el.connectionBadge.classList.add("offline");
    el.connectionText.textContent = "Desconectado";
    el.systemStatus.textContent = "Offline";
    el.headlineText.textContent = "Conexão interrompida";
    return;
  }

  el.connectionBadge.classList.add("connecting");
  el.connectionText.textContent = "Conectando";
  el.systemStatus.textContent = "Conectando";
  el.headlineText.textContent = "Monitoramento ativo";
}

function normalizeDirection(direction) {
  const value = String(direction || "").toLowerCase();

  if (["call", "buy", "compra", "up", "alta"].includes(value)) {
    return { label: "COMPRA", className: "buy" };
  }

  if (["put", "sell", "venda", "down", "baixa"].includes(value)) {
    return { label: "VENDA", className: "sell" };
  }

  return { label: "AGUARDANDO", className: "neutral" };
}

function setMarketStatus(status) {
  const value = String(status || "").toLowerCase();

  if (!el.marketStatusPill || !el.marketStatusText || !el.marketPhase) return;

  el.marketStatusPill.classList.remove("open", "closed");

  if (["open", "aberto", "online", "ativo", "running"].includes(value)) {
    el.marketStatusPill.classList.add("open");
    el.marketStatusText.textContent = "Mercado ativo";
    el.marketPhase.textContent = "Aberto";
  } else if (["closed", "fechado", "offline", "stopped"].includes(value)) {
    el.marketStatusPill.classList.add("closed");
    el.marketStatusText.textContent = "Mercado fechado";
    el.marketPhase.textContent = "Fechado";
  } else {
    el.marketStatusText.textContent = "Monitorando mercado";
    el.marketPhase.textContent = "Monitorando";
  }
}

function setConfidenceRing(value) {
  if (!el.confidenceRing) return;

  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  const degrees = Math.round((safeValue / 100) * 360);

  el.confidenceRing.style.background =
    `conic-gradient(var(--blue) ${degrees}deg, rgba(255,255,255,0.08) ${degrees}deg)`;
}

function setTrend(trend = {}) {
  const strength = Math.max(0, Math.min(100, Number(trend.strength ?? trend.force ?? trend.score ?? trend.strengthPercent ?? 0)));
  const direction = String(trend.direction ?? trend.bias ?? trend.label ?? "neutral").toLowerCase();

  let label = "NEUTRA";
  let biasText = "Sem viés dominante";

  if (["buy", "bullish", "alta", "compra", "up"].includes(direction)) {
    label = "ALTA";
    biasText = "Pressão compradora predominante";
  } else if (["sell", "bearish", "baixa", "venda", "down"].includes(direction)) {
    label = "BAIXA";
    biasText = "Pressão vendedora predominante";
  }

  if (el.trendLabel) el.trendLabel.textContent = label;
  if (el.trendStrength) el.trendStrength.textContent = `${Math.round(strength)}%`;
  if (el.trendBarFill) el.trendBarFill.style.width = `${strength}%`;
  if (el.trendBiasText) el.trendBiasText.textContent = biasText;
}

function setPriority(confidence = 0) {
  const value = Math.max(0, Math.min(100, Number(confidence || 0)));

  let label = "Observação";
  if (value >= 90) label = "Máxima";
  else if (value >= 82) label = "Alta";
  else if (value >= 74) label = "Moderada";

  if (el.priorityText) el.priorityText.textContent = label;
  if (el.priorityScore) el.priorityScore.textContent = `${Math.round(value)}%`;
}

function setSessionInfo(payload = {}) {
  const session = payload.sessionName ?? payload.session ?? payload.marketSession ?? "--";
  const volatilityRaw = payload.volatilityText ?? payload.volatility ?? payload.marketVolatility ?? "--";

  let volatility = volatilityRaw;

  if (typeof volatilityRaw === "number") {
    if (volatilityRaw >= 75) volatility = "Alta";
    else if (volatilityRaw >= 45) volatility = "Moderada";
    else volatility = "Baixa";
  }

  if (el.sessionName) el.sessionName.textContent = session || "--";
  if (el.volatilityText) el.volatilityText.textContent = volatility || "--";
}

function startCountdown(expiryTime) {
  if (countdownInterval) clearInterval(countdownInterval);

  function update() {
    if (!el.signalCountdown) return;

    if (!expiryTime || typeof expiryTime !== "string" || !expiryTime.includes(":")) {
      el.signalCountdown.textContent = "--";
      return;
    }

    const now = new Date();
    const target = new Date();
    const parts = expiryTime.split(":").map(Number);

    target.setHours(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 0);

    if (target < now) {
      target.setDate(target.getDate() + 1);
    }

    const diff = target - now;

    if (diff <= 0) {
      el.signalCountdown.textContent = "00:00";
      return;
    }

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    el.signalCountdown.textContent =
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

function setBestOpportunity(signal = {}) {
  const asset = signal.asset || signal.symbol || "--";
  const score = Math.round(Number(signal.confidence ?? signal.probability ?? signal.assertiveness ?? signal.quality ?? 0));

  let reason = "Aguardando";
  if (score >= 90) reason = "Convicção muito forte";
  else if (score >= 82) reason = "Alta probabilidade de acerto";
  else if (score >= 74) reason = "Boa oportunidade";
  else if (score >= 55) reason = "Oportunidade moderada";
  else reason = "Aguardando confirmação mais forte";

  if (el.bestAsset) el.bestAsset.textContent = asset;
  if (el.bestScore) el.bestScore.textContent = `${score}%`;
  if (el.bestReason) el.bestReason.textContent = reason;
}

function setRadarStats(payload = {}) {
  const opportunities = payload.opportunities ?? payload.signalsCount ?? payload.count ?? 0;
  const avg = payload.avgQuality ?? payload.averageConfidence ?? payload.avg ?? 0;

  if (el.opportunitiesCount) el.opportunitiesCount.textContent = Math.round(Number(opportunities || 0));
  if (el.avgQuality) el.avgQuality.textContent = `${Math.round(Number(avg || 0))}%`;
}

function flashSignalCard() {
  if (!el.signalCard) return;

  el.signalCard.classList.remove("flash");
  void el.signalCard.offsetWidth;
  el.signalCard.classList.add("flash");
}

function playAlertSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    const ctx = audioCtx;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.setValueAtTime(1180, now + 0.08);

    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);
  } catch (_) {}
}

function buildAIExplanation(signal = {}) {
  if (signal.explanation) {
    return signal.explanation;
  }

  const direction = normalizeDirection(signal.direction).label;
  const confidence = Math.round(Number(signal.confidence ?? signal.probability ?? signal.assertiveness ?? signal.quality ?? 0));
  const asset = signal.asset || signal.symbol || "ativo";
  const trendDirection = String(signal.trendDirection ?? signal.trend ?? signal.bias ?? signal.direction ?? "").toLowerCase();

  let trendText = "sem viés dominante";
  if (["buy", "bullish", "alta", "compra", "up"].includes(trendDirection)) {
    trendText = "tendência compradora";
  } else if (["sell", "bearish", "baixa", "venda", "down"].includes(trendDirection)) {
    trendText = "tendência vendedora";
  }

  let conviction = "convicção baixa";
  if (confidence >= 90) conviction = "convicção muito forte";
  else if (confidence >= 82) conviction = "convicção forte";
  else if (confidence >= 74) conviction = "convicção moderada";

  let timing = "entrada mais seletiva";
  if (signal.entry || signal.entryTime) {
    timing = `entrada observada em ${signal.entry || signal.entryTime}`;
  }

  return `A leitura atual sugere ${direction.toLowerCase()} em ${asset}, alinhada com ${trendText}. O sinal apresenta ${conviction}, com confiança em ${confidence}%. Isso indica um cenário de execução mais objetiva, priorizando continuidade do fluxo e menor ambiguidade no momento operacional, com ${timing}.`;
}

function renderMiniChart(points = []) {
  const canvas = el.miniChart;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || 600;
  const height = canvas.height || 110;

  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);

  const values = Array.isArray(points) && points.length ? points : [42, 48, 45, 58, 54, 62, 60, 68, 64, 72];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const padding = 14;
  const stepX = (width - padding * 2) / Math.max(1, values.length - 1);

  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const x = padding + i * stepX;
    const y = height - padding - ((values[i] - min) / range) * (height - padding * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(0,170,255,0.95)");
  gradient.addColorStop(1, "rgba(32,214,148,0.95)");

  ctx.lineWidth = 3;
  ctx.strokeStyle = gradient;
  ctx.stroke();

  ctx.lineTo(width - padding, height - padding);
  ctx.lineTo(padding, height - padding);
  ctx.closePath();

  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, "rgba(0,170,255,0.20)");
  fill.addColorStop(1, "rgba(0,170,255,0.01)");
  ctx.fillStyle = fill;
  ctx.fill();
}

function nextChartPoints(baseValue = 60) {
  const points = [];
  let current = Math.max(20, Math.min(90, Number(baseValue || 60) - 12));

  for (let i = 0; i < 12; i++) {
    const delta = Math.round((Math.random() - 0.2) * 10);
    current = Math.max(15, Math.min(95, current + delta));
    points.push(current);
  }

  return points;
}

function renderSignal(signal = null, isNewSignal = false) {
  if (!signal) {
    if (el.signalMode) el.signalMode.textContent = "STANDBY";
    if (el.signalTime) el.signalTime.textContent = "--:--:--";
    if (el.signalAsset) el.signalAsset.textContent = "EUR/USD";
    if (el.signalDirection) {
      el.signalDirection.textContent = "AGUARDANDO";
      el.signalDirection.className = "signal-direction neutral";
    }
    if (el.signalConfidence) el.signalConfidence.textContent = "0%";
    if (el.signalEntry) el.signalEntry.textContent = "--";
    if (el.signalExpiry) el.signalExpiry.textContent = "--";
    if (el.signalCountdown) el.signalCountdown.textContent = "--";
    if (el.signalScore) el.signalScore.textContent = "--";
    if (el.focusAsset) el.focusAsset.textContent = "--";
    if (el.aiExplanation) {
      el.aiExplanation.textContent = "Aguardando sinal para interpretar contexto, tendência, confiança e timing de entrada.";
    }

    setConfidenceRing(0);
    setTrend({});
    setPriority(0);
    setBestOpportunity({});
    renderMiniChart(state.chartPoints);
    return;
  }

  const direction = normalizeDirection(signal.direction);
  const confidence = Number(signal.confidence ?? signal.probability ?? signal.assertiveness ?? signal.quality ?? 0);
  const score = signal.score ?? signal.signalScore ?? Math.round(confidence);

  if (el.signalMode) el.signalMode.textContent = signal.mode || "LIVE";
  if (el.signalTime) el.signalTime.textContent = signal.time || formatTime(new Date());
  if (el.signalAsset) el.signalAsset.textContent = signal.asset || signal.symbol || "EUR/USD";
  if (el.signalDirection) {
    el.signalDirection.textContent = direction.label;
    el.signalDirection.className = `signal-direction ${direction.className}`;
  }
  if (el.signalConfidence) el.signalConfidence.textContent = `${Math.round(confidence)}%`;
  if (el.signalEntry) el.signalEntry.textContent = signal.entry || signal.entryTime || "--";
  if (el.signalExpiry) el.signalExpiry.textContent = signal.expiry || signal.expiration || "--";
  if (el.signalScore) el.signalScore.textContent = score;
  if (el.focusAsset) el.focusAsset.textContent = signal.asset || signal.symbol || "--";
  if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());

  setConfidenceRing(confidence);
  setPriority(confidence);
  setBestOpportunity(signal);
  startCountdown(signal.expiry || signal.expiration);

  setTrend({
    direction: signal.trendDirection ?? signal.trend ?? signal.bias ?? signal.direction,
    strength: signal.trendStrength ?? signal.trendScore ?? signal.market?.h1?.strengthPercent ?? confidence
  });

  setSessionInfo(signal);

  if (el.aiExplanation) {
    el.aiExplanation.textContent = buildAIExplanation(signal);
  }

  state.chartPoints = nextChartPoints(confidence);
  renderMiniChart(state.chartPoints);

  if (isNewSignal) {
    flashSignalCard();
    playAlertSound();
  }
}

function renderStats(stats = {}) {
  const signalsToday = Number(stats.signalsToday ?? stats.totalToday ?? stats.total ?? state.history.length ?? 0);
  const wins = Number(stats.wins ?? stats.winCount ?? stats.callCount ?? 0);
  const losses = Number(stats.losses ?? stats.lossCount ?? stats.putCount ?? 0);

  let winRate = Number(stats.winRate ?? 0);
  if (!winRate && wins + losses > 0) {
    winRate = (wins / (wins + losses)) * 100;
  }

  if (el.signalsToday) el.signalsToday.textContent = signalsToday;
  if (el.winRate) el.winRate.textContent = `${Math.round(winRate)}%`;
  if (el.winsCount) el.winsCount.textContent = wins;
  if (el.lossCount) el.lossCount.textContent = losses;
}

function renderRanking(ranking = []) {
  if (!el.rankingList) return;

  const premiumUnlocked = state.auth.premiumAccess || isPremiumPlan();

  if (!premiumUnlocked) {
    el.rankingList.innerHTML = `
      <div class="ranking-empty">
        Recurso premium bloqueado.
      </div>
    `;
    return;
  }

  if (!Array.isArray(ranking) || ranking.length === 0) {
    el.rankingList.innerHTML = `<div class="ranking-empty">Sem ranking disponível.</div>`;
    return;
  }

  el.rankingList.innerHTML = ranking
    .slice(0, 5)
    .map((item, index) => {
      const asset = item.asset || item.symbol || `Ativo ${index + 1}`;
      const score = Math.round(Number(item.score ?? item.confidence ?? item.quality ?? 0));
      const subtitle = item.label || item.status || item.direction || "Monitorado";

      return `
        <div class="ranking-item">
          <div class="ranking-index">${index + 1}</div>
          <div class="ranking-main">
            <strong>${asset}</strong>
            <span>${subtitle}</span>
          </div>
          <div class="ranking-score">${score}%</div>
        </div>
      `;
    })
    .join("");
}

function renderHistory(history = []) {
  if (!el.historyList) return;

  if (!Array.isArray(history) || history.length === 0) {
    el.historyList.innerHTML = `<div class="history-empty">Nenhum sinal carregado ainda.</div>`;
    return;
  }

  el.historyList.innerHTML = history
    .slice(0, 8)
    .map((item) => {
      const direction = normalizeDirection(item.direction || item.signal);
      const resultRaw = String(item.result || item.status || "pending").toLowerCase();

      let resultLabel = "Pendente";
      let resultClass = "pending";

      if (["win", "won", "assertivo", "green", "call"].includes(resultRaw)) {
        resultLabel = "Win";
        resultClass = "win";
      } else if (["loss", "lost", "falho", "red", "put"].includes(resultRaw)) {
        resultLabel = "Loss";
        resultClass = "loss";
      }

      return `
        <div class="history-item">
          <div class="history-time">${item.time || formatTime(item.timestamp ? new Date(item.timestamp) : new Date())}</div>
          <div class="history-asset">
            <strong>${item.asset || item.symbol || "--"}</strong>
            <span>${item.mode || "Execução monitorada"}</span>
          </div>
          <div class="history-direction">${direction.label}</div>
          <div class="history-score">Score: ${item.score ?? Math.round(Number(item.confidence || 0))}%</div>
          <div class="result ${resultClass}">${resultLabel}</div>
        </div>
      `;
    })
    .join("");
}

function mapBestOpportunity(best) {
  if (!best) return null;

  return {
    asset: best.symbol || best.asset || "--",
    symbol: best.symbol || best.asset || "--",
    direction: best.signal || best.direction || "WAIT",
    confidence: Number(best.confidence || 0),
    score: Math.round(Number(best.confidence || 0)),
    mode: "LIVE",
    time: formatTime(new Date(best.timestamp || Date.now())),
    entry: best.entry || best.entryTime || "--",
    expiry: best.expiry || best.expiration || "--",
    trendDirection:
      best.market?.h1?.direction ||
      best.trendDirection ||
      best.trend ||
      best.signal ||
      "neutral",
    trendStrength:
      Math.round(Number(best.market?.h1?.strengthPercent || best.confidence || 0)),
    volatility:
      Math.round(Number(best.market?.m5?.volatilityPercent || 0)),
    explanation: best.explanation || "",
    raw: best
  };
}

function mapDashboardToLegacyPayload(data) {
  if (!data || typeof data !== "object") return null;

  const best = mapBestOpportunity(data.signalCenter?.bestOpportunity || null);

  const ranking = Array.isArray(data.ranking)
    ? data.ranking.map((item) => ({
        asset: item.symbol || item.asset || "--",
        symbol: item.symbol || item.asset || "--",
        score: Math.round(Number(item.confidence || item.score || 0)),
        confidence: Number(item.confidence || item.score || 0),
        label: item.signal || item.direction || "WAIT"
      }))
    : [];

  const history = Array.isArray(data.history)
    ? data.history.map((item) => ({
        time: formatTime(item.timestamp ? new Date(item.timestamp) : new Date()),
        asset: item.symbol || item.asset || "--",
        symbol: item.symbol || item.asset || "--",
        direction: item.signal || item.direction || "WAIT",
        score: Math.round(Number(item.confidence || item.score || 0)),
        result: item.result || "pending",
        mode: item.mode?.label || item.mode || "LIVE",
        timestamp: item.timestamp
      }))
    : [];

  const historyStats = data.analytics?.historyStats || {};

  const marketSignal =
    data.signalCenter?.bestOpportunity?.market?.h1?.direction ||
    data.signalCenter?.bestOpportunity?.signal ||
    "neutral";

  return {
    marketStatus: data.connection?.engineRunning ? "open" : "monitorando",
    systemStatus: data.connection?.engineRunning ? "Online" : "Standby",
    signal: best,
    history,
    stats: {
      signalsToday: historyStats.total || history.length || 0,
      wins: historyStats.callCount || 0,
      losses: historyStats.putCount || 0,
      winRate: historyStats.avgConfidence || 0
    },
    trend: {
      direction: marketSignal,
      strength: Number(data.signalCenter?.bestOpportunity?.market?.h1?.strengthPercent || data.signalCenter?.bestOpportunity?.confidence || 0)
    },
    ranking,
    radar: {
      opportunities: ranking.length,
      avgQuality: historyStats.avgConfidence || 0
    },
    sessionName: "Tempo real",
    volatility:
      Number(data.signalCenter?.bestOpportunity?.market?.m5?.volatilityPercent || 0)
  };
}

function applyPayload(payload) {
  if (!payload || typeof payload !== "object") return;

  if (payload.marketStatus) {
    setMarketStatus(payload.marketStatus);
  }

  if (payload.signal || payload.currentSignal) {
    state.signal = payload.signal || payload.currentSignal;
    renderSignal(state.signal, false);
  }

  if (payload.history || payload.signals) {
    state.history = payload.history || payload.signals || [];
    renderHistory(state.history);
  }

  if (payload.stats || payload.summary) {
    state.stats = payload.stats || payload.summary;
    renderStats(state.stats);
  }

  if (payload.systemStatus && el.systemStatus) {
    el.systemStatus.textContent = payload.systemStatus;
  }

  if (payload.trend) {
    setTrend(payload.trend);
  }

  if (payload.ranking || payload.topAssets || payload.assetsRanking) {
    state.ranking = payload.ranking || payload.topAssets || payload.assetsRanking || [];
    renderRanking(state.ranking);
  }

  if (payload.radar || payload.metrics) {
    setRadarStats(payload.radar || payload.metrics);
  }

  setSessionInfo(payload);

  if (el.lastUpdate) {
    el.lastUpdate.textContent = formatTime(new Date());
  }
}

async function fetchInitialData() {
  const dashboardResponse = await safeFetchJson("/api/dashboard");

  if (dashboardResponse?.data) {
    const mapped = mapDashboardToLegacyPayload(dashboardResponse.data);
    applyPayload(mapped);
    return;
  }

  const endpoints = ["/api/panel", "/api/status", "/api/signals", "/status"];

  for (const endpoint of endpoints) {
    const data = await safeFetchJson(endpoint);
    if (!data) continue;

    if (Array.isArray(data)) {
      state.history = data;
      renderHistory(state.history);
    } else {
      applyPayload(data);
    }

    if (el.lastUpdate) {
      el.lastUpdate.textContent = formatTime(new Date());
    }

    return;
  }
}

function setupSocket() {
  if (typeof io === "undefined") {
    setConnectionStatus("offline");
    return null;
  }

  if (activeSocket) {
    try {
      activeSocket.disconnect();
    } catch (_) {}
  }

  const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    auth: state.auth.token
      ? { token: state.auth.token }
      : undefined
  });

  socket.on("connect", () => {
    setConnectionStatus("online");
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("disconnect", (reason) => {
    if (reason === "io client disconnect") {
      setConnectionStatus("offline");
      return;
    }
    setConnectionStatus("reconnecting");
  });

  socket.on("connect_error", () => {
    setConnectionStatus("reconnecting");
  });

  socket.io.on("reconnect_attempt", (attempt) => {
    setConnectionStatus("reconnecting", { attempt });
  });

  socket.io.on("reconnect", () => {
    setConnectionStatus("online");
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.io.on("reconnect_failed", () => {
    setConnectionStatus("offline");
  });

  socket.on("system:status", (data) => {
    if (data?.connected) {
      setConnectionStatus("online");
    }
  });

  socket.on("engine:status", (data) => {
    if (!data?.status) return;

    if (data.status === "running") {
      setConnectionStatus("online");
      setMarketStatus("open");
    } else if (data.status === "stopped") {
      setMarketStatus("closed");
    } else if (data.status === "rate_limited") {
      if (el.headlineText) {
        el.headlineText.textContent = "Limite de API atingido • aguardando próxima janela";
      }
    }

    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("engine:update", (payload) => {
    const syntheticDashboard = {
      signalCenter: {
        bestOpportunity: payload.bestOpportunity || null
      },
      ranking: payload.results || [],
      history: payload.history || [],
      analytics: {
        historyStats: payload.historyStats || {}
      },
      connection: {
        engineRunning: payload.status === "running",
        lastCycleAt: payload.lastCycleAt
      }
    };

    const mapped = mapDashboardToLegacyPayload(syntheticDashboard);
    applyPayload(mapped);

    if (payload.bestOpportunity && (payload.bestOpportunity.symbol || payload.bestOpportunity.asset)) {
      const freshSignal = mapBestOpportunity(payload.bestOpportunity);
      renderSignal(freshSignal, true);
    }
  });

  socket.on("signal", (data) => {
    state.signal = data;
    renderSignal(data, true);

    if (data && (data.asset || data.symbol)) {
      state.history.unshift({
        time: data.time || formatTime(new Date()),
        asset: data.asset || data.symbol,
        direction: data.direction,
        score: data.score ?? "--",
        result: data.result || "pending",
        mode: data.mode || "LIVE"
      });

      state.history = state.history.slice(0, 8);
      renderHistory(state.history);
    }

    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("dashboard", (data) => {
    if (data?.data) {
      applyPayload(mapDashboardToLegacyPayload(data.data));
    } else {
      applyPayload(data);
    }
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("status", (data) => {
    applyPayload(data);
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("history", (data) => {
    if (Array.isArray(data)) {
      state.history = data;
      renderHistory(state.history);
      if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
    }
  });

  socket.on("stats", (data) => {
    renderStats(data || {});
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("trend", (data) => {
    setTrend(data || {});
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  socket.on("ranking", (data) => {
    if (Array.isArray(data)) {
      state.ranking = data;
      renderRanking(state.ranking);
      if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
    }
  });

  socket.on("radar", (data) => {
    setRadarStats(data || {});
    if (el.lastUpdate) el.lastUpdate.textContent = formatTime(new Date());
  });

  activeSocket = socket;
  return socket;
}

async function bootstrapAuthState() {
  if (!state.auth.token && !state.auth.user) {
    updateUserUi();
    return;
  }

  await fetchMe();
  await fetchPreferences();
  await checkPremiumAccess();
  updateUserUi();

  if (el.loginOverlay) {
    el.loginOverlay.classList.add("hidden");
  }
}

async function boot() {
  setupLogin();
  setupLogout();
  setupModeSwitcher();
  setConnectionStatus("loading");
  setMarketStatus("monitorando");
  renderSignal(null);
  renderStats({});
  renderHistory([]);
  renderRanking([]);
  setTrend({});
  setSessionInfo({});
  setRadarStats({});
  renderMiniChart(state.chartPoints);
  updateUserUi();
  await bootstrapAuthState();
  await fetchInitialData();
  setupSocket();

  window.addEventListener("resize", () => {
    renderMiniChart(state.chartPoints);
  });
}

boot();