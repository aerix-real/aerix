const socket = typeof io === "function"
  ? io()
  : {
      connected: false,
      on() {},
      emit() {},
      disconnect() {}
    };

const MAX_HISTORY_ITEMS = 30;
const COMPACT_HISTORY_ITEMS = 10;
const HISTORY_PAGE_SIZE = 10;
const SHADOW_EVENT_LIMIT = 12;
const TIMELINE_EVENT_LIMIT = 7;

const STORAGE_KEYS = {
  accessToken: "aerix_access_token",
  refreshToken: "aerix_refresh_token",
  user: "aerix_user"
};

const state = {
  history: [],
  user: null,
  accessToken: localStorage.getItem(STORAGE_KEYS.accessToken),
  refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken),
  aiStateIndex: 0,
  currentMode: localStorage.getItem("aerix_mode") || "equilibrado",
  chartTimer: null,
  aiTimer: null,
  institutionalHeatmap: [],
  proLogs: [],
  dashboardSnapshot: null,
  engineSnapshot: null,
  premiumSnapshot: null,
  filterAnalytics: null,
  filterPerformance: null,
  performanceDashboard: null,
  domCache: new Map(),
  rafQueue: new Map(),
  visualFrame: null,
  pendingHistoryRender: false,
  pendingEquityDraw: false,
  historyPagination: { page: 1, limit: HISTORY_PAGE_SIZE, total: 0, hasMore: false },
  historyFilters: { symbol: "", strategy: "", result: "" },
  isDocumentVisible: document.visibilityState === "visible",
  shadowMode: {
    signals: [],
    blocked: [],
    executions: [],
    lastUpdated: null
  },
  filterAnalyticsTimer: null,
  performanceDashboardTimer: null
};

const el = {
  loginOverlay: document.getElementById("loginOverlay"),
  loginForm: document.getElementById("loginForm"),
  loginUser: document.getElementById("loginUser"),
  loginPass: document.getElementById("loginPass"),
  loginButton: document.getElementById("loginButton"),
  authFeedback: document.getElementById("authFeedback"),

  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  planBadge: document.getElementById("planBadge"),
  premiumStatus: document.getElementById("premiumStatus"),
  logoutBtn: document.getElementById("logoutBtn"),
  upgradeBtn: document.getElementById("upgradeBtn"),

  menuToggle: document.getElementById("menuToggle"),
  sidebarBackdrop: document.getElementById("sidebarBackdrop"),

  connectionBadge: document.getElementById("connectionBadge"),
  connectionText: document.getElementById("connectionText"),
  liveClock: document.getElementById("liveClock"),
  headlineText: document.getElementById("headlineText"),

  signalAsset: document.getElementById("signalAsset"),
  signalDirection: document.getElementById("signalDirection"),
  signalEntry: document.getElementById("signalEntry"),
  signalExpiry: document.getElementById("signalExpiry"),
  signalConfidence: document.getElementById("signalConfidence"),
  signalCountdown: document.getElementById("signalCountdown"),
  signalTime: document.getElementById("signalTime"),
  aiExplanation: document.getElementById("aiExplanation"),
  bestAsset: document.getElementById("bestAsset"),
  bestReason: document.getElementById("bestReason"),
  bestScore: document.getElementById("bestScore"),
  bestDirection: document.getElementById("bestDirection"),
  bestConfidence: document.getElementById("bestConfidence"),
  bestExpiry: document.getElementById("bestExpiry"),
  bestStrategy: document.getElementById("bestStrategy"),
  bestAiStatus: document.getElementById("bestAiStatus"),
  bestEntryStatus: document.getElementById("bestEntryStatus"),
  marketRegime: document.getElementById("marketRegime"),
  techStrategy: document.getElementById("techStrategy"),
  techVolatility: document.getElementById("techVolatility"),
  techDynamicThresholds: document.getElementById("techDynamicThresholds"),
  techBlockReason: document.getElementById("techBlockReason"),
  techActivationReason: document.getElementById("techActivationReason"),
  currentRisk: document.getElementById("currentRisk"),
  decisionReason: document.getElementById("decisionReason"),
  aiReleaseStatus: document.getElementById("aiReleaseStatus"),
  engineOnlineStatus: document.getElementById("engineOnlineStatus"),
  engineProcessStatus: document.getElementById("engineProcessStatus"),
  lastCycleTime: document.getElementById("lastCycleTime"),
  lastCycleCompact: document.getElementById("lastCycleCompact"),
  engineTopStatus: document.getElementById("engineTopStatus"),
  topCurrentMode: document.getElementById("topCurrentMode"),
  summaryWinrate24h: document.getElementById("summaryWinrate24h"),
  summarySignalsToday: document.getElementById("summarySignalsToday"),
  summaryEngineStatus: document.getElementById("summaryEngineStatus"),
  summarySocketStatus: document.getElementById("summarySocketStatus"),
  summaryLastAnalysis: document.getElementById("summaryLastAnalysis"),
  rateLimitStatus: document.getElementById("rateLimitStatus"),
  websocketStatus: document.getElementById("websocketStatus"),
  monitorUptime: document.getElementById("monitorUptime"),
  monitorTwelveDataRequests: document.getElementById("monitorTwelveDataRequests"),
  monitorTwelveDataBudget: document.getElementById("monitorTwelveDataBudget"),
  monitorCacheHitRate: document.getElementById("monitorCacheHitRate"),
  monitorCacheLookups: document.getElementById("monitorCacheLookups"),
  monitorAnalyzedSignals: document.getElementById("monitorAnalyzedSignals"),
  monitorApprovedSignals: document.getElementById("monitorApprovedSignals"),
  monitorLastExecution: document.getElementById("monitorLastExecution"),
  monitorLastStatus: document.getElementById("monitorLastStatus"),

  historyList: document.getElementById("historyList"),
  historyCount: document.getElementById("historyCount"),
  historyFilterSymbol: document.getElementById("historyFilterSymbol"),
  historyFilterStrategy: document.getElementById("historyFilterStrategy"),
  historyFilterResult: document.getElementById("historyFilterResult"),
  historyPrev: document.getElementById("historyPrev"),
  historyNext: document.getElementById("historyNext"),
  historyPageInfo: document.getElementById("historyPageInfo"),
  historyUpdated: document.getElementById("historyUpdated"),

  statTotal: document.getElementById("statTotal"),
  statWins: document.getElementById("statWins"),
  statLosses: document.getElementById("statLosses"),
  statWinrate: document.getElementById("statWinrate"),
  statsUpdated: document.getElementById("statsUpdated"),

  metricLatency: getCachedElement("metricLatency"),
  metricFlow: getCachedElement("metricFlow"),
  metricRisk: getCachedElement("metricRisk"),
  metricAi: getCachedElement("metricAi"),

  aiInsightsList: document.getElementById("aiInsightsList"),
  operationTimeline: document.getElementById("operationTimeline"),
  timelineCount: document.getElementById("timelineCount"),
  equityCurveCanvas: document.getElementById("equityCurveCanvas"),
  equityStatus: document.getElementById("equityStatus"),

  filterAnalyticsUpdated: document.getElementById("filterAnalyticsUpdated"),
  filterApprovalRate: document.getElementById("filterApprovalRate"),
  filterTotalSignals: document.getElementById("filterTotalSignals"),
  filterApprovedSignals: document.getElementById("filterApprovedSignals"),
  filterBlockedSignals: document.getElementById("filterBlockedSignals"),
  filterWatchlistRate: document.getElementById("filterWatchlistRate"),
  filterHighConfidenceRate: document.getElementById("filterHighConfidenceRate"),
  filterMediumConfidenceRate: document.getElementById("filterMediumConfidenceRate"),
  filterPenaltySignals: document.getElementById("filterPenaltySignals"),
  filterRankingList: document.getElementById("filterRankingList"),
  filterAssetList: document.getElementById("filterAssetList"),
  filterHourList: document.getElementById("filterHourList"),
  filterBlockList: document.getElementById("filterBlockList"),

  shadowModePanel: document.getElementById("shadowModePanel"),
  shadowModeStatus: document.getElementById("shadowModeStatus"),
  shadowModeList: document.getElementById("shadowModeList"),
  shadowModeUpdated: document.getElementById("shadowModeUpdated"),

  performanceUpdated: document.getElementById("performanceUpdated"),
  perfSignalsToday: document.getElementById("perfSignalsToday"),
  perfApprovedToday: document.getElementById("perfApprovedToday"),
  perfBlockedToday: document.getElementById("perfBlockedToday"),
  perfApprovalRate: document.getElementById("perfApprovalRate"),
  perfWinrate24h: document.getElementById("perfWinrate24h"),
  perfWinrate7d: document.getElementById("perfWinrate7d"),
  perfWinrate30d: document.getElementById("perfWinrate30d"),
  perfLastApproved: document.getElementById("perfLastApproved"),
  perfWinrateByAsset: document.getElementById("perfWinrateByAsset"),
  perfWinrateByStrategy: document.getElementById("perfWinrateByStrategy"),

  filterPerformancePanel: document.getElementById("filterPerformancePanel"),
  filterPerformanceCards: document.getElementById("filterPerformanceCards"),
  filterPerformanceUpdated: document.getElementById("filterPerformanceUpdated")
};


function getCachedElement(id) {
  if (!id) return null;

  const cached = state.domCache.get(id);

  if (cached && document.contains(cached)) {
    return cached;
  }

  const node = document.getElementById(id);
  state.domCache.set(id, node);

  return node;
}

function setTextContent(node, value) {
  if (!node) return;

  const nextValue = String(value ?? "");
  if (node.textContent !== nextValue) {
    node.textContent = nextValue;
  }
}

function scheduleVisualUpdate(key, task) {
  state.rafQueue.set(key, task);

  if (state.visualFrame) return;

  state.visualFrame = requestAnimationFrame(() => {
    const jobs = Array.from(state.rafQueue.values());
    state.rafQueue.clear();
    state.visualFrame = null;

    jobs.forEach((job) => job());
  });
}

function throttle(fn, wait = 300) {
  let lastRun = 0;
  let timeout = null;
  let lastArgs = null;

  return (...args) => {
    lastArgs = args;
    const remaining = wait - (Date.now() - lastRun);

    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      lastRun = Date.now();
      fn(...lastArgs);
      lastArgs = null;
      return;
    }

    if (!timeout) {
      timeout = setTimeout(() => {
        lastRun = Date.now();
        timeout = null;
        fn(...lastArgs);
        lastArgs = null;
      }, remaining);
    }
  };
}

function debounce(fn, wait = 250) {
  let timeout = null;

  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function scheduleHistoryRender() {
  if (state.pendingHistoryRender) return;

  state.pendingHistoryRender = true;
  scheduleVisualUpdate("history", () => {
    state.pendingHistoryRender = false;
    renderHistory();
  });
}

function scheduleEquityDraw() {
  if (state.pendingEquityDraw || !state.isDocumentVisible) return;

  state.pendingEquityDraw = true;
  scheduleVisualUpdate("equity", () => {
    state.pendingEquityDraw = false;
    drawEquityCurve();
  });
}

const AI_STATES = [
  "IA analisando alinhamento de tendência",
  "Filtrando confluências operacionais",
  "Aguardando confirmação de timing",
  "Validando força do candle atual",
  "Monitorando volatilidade do ativo",
  "Mercado sem confluência ideal no momento"
];

const MODE_DESCRIPTIONS = {
  conservador: "Modo conservador ativo. Foco em menos sinais e maior filtro operacional.",
  equilibrado: "Modo equilibrado ativo. Balanceamento entre frequência e qualidade.",
  agressivo: "Modo agressivo ativo. Mais sinais, com maior exposição operacional."
};

function isPremium() {
  return Boolean(state.user);
}

function authHeaders() {
  if (!state.accessToken) return {};
  return {
    Authorization: `Bearer ${state.accessToken}`
  };
}

function setLoginVisible(visible) {
  if (!el.loginOverlay) return;
  el.loginOverlay.style.display = visible ? "grid" : "none";
}

function showAuthFeedback(message, type = "error") {
  if (!el.authFeedback) {
    if (message) alert(message);
    return;
  }

  el.authFeedback.textContent = message || "";
  el.authFeedback.classList.remove("hidden", "error", "success");
  el.authFeedback.classList.add(type);

  if (!message) {
    el.authFeedback.classList.add("hidden");
  }
}

function showToast(message, type = "info") {
  let container = document.querySelector(".toast-container");

  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 280);
  }, 3200);
}

function setLoginLoading(loading) {
  if (!el.loginButton) return;
  el.loginButton.disabled = loading;
  el.loginButton.textContent = loading ? "Entrando..." : "Entrar";
}

function saveSession({ user, accessToken, refreshToken }) {
  state.user = user || null;
  state.accessToken = accessToken || null;
  state.refreshToken = refreshToken || null;

  if (state.accessToken) {
    localStorage.setItem(STORAGE_KEYS.accessToken, state.accessToken);
  }

  if (state.refreshToken) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, state.refreshToken);
  }

  if (state.user) {
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.user));
  }

  applyUserUI();
  applyPlanLocks();
  applyModeUI(state.currentMode, false);
}

function clearSession() {
  state.user = null;
  state.accessToken = null;
  state.refreshToken = null;
  state.history = [];

  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
  localStorage.removeItem(STORAGE_KEYS.user);

  applyUserUI();
  applyPlanLocks();
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  if (response.status === 401 && state.refreshToken) {
    const refreshed = await refreshSession();

    if (refreshed) {
      return fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
          ...(options.headers || {})
        }
      });
    }
  }

  return response;
}

async function login(email, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || "Credenciais inválidas.");
  }

  saveSession({
    user: data.data.user,
    accessToken: data.data.accessToken,
    refreshToken: data.data.refreshToken
  });

  setLoginVisible(false);
  showAuthFeedback("");
  showToast("Login realizado com sucesso.", "success");

  await bootPanel();
}

async function refreshSession() {
  try {
    if (!state.refreshToken) return false;

    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        refreshToken: state.refreshToken
      })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      clearSession();
      return false;
    }

    saveSession({
      user: data.data.user,
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken
    });

    return true;
  } catch (error) {
    clearSession();
    return false;
  }
}

async function checkSession() {
  if (!state.accessToken) {
    setLoginVisible(true);
    return false;
  }

  try {
    const response = await apiFetch("/api/auth/me");
    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.ok) {
      clearSession();
      setLoginVisible(true);
      return false;
    }

    saveSession({
      user: data.data.user,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken
    });

    setLoginVisible(false);
    return true;
  } catch (error) {
    clearSession();
    setLoginVisible(true);
    return false;
  }
}

async function logout() {
  try {
    if (state.refreshToken) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders()
        },
        body: JSON.stringify({
          refreshToken: state.refreshToken
        })
      });
    }
  } catch (_) {}

  clearSession();
  renderHistory();
  setLoginVisible(true);
  showToast("Sessão encerrada.", "info");
}

function applyUserUI() {
  const fullAccess = isPremium();

  document.body.classList.toggle("plan-premium", fullAccess);
  document.body.classList.toggle("plan-free", false);

  if (el.userName) {
    el.userName.textContent = state.user?.name || "Usuário";
  }

  if (el.userEmail) {
    el.userEmail.textContent = state.user?.email || "---";
  }

  if (el.planBadge) {
    el.planBadge.textContent = "ACESSO COMPLETO";
    el.planBadge.classList.toggle("premium", true);
    el.planBadge.classList.toggle("free", false);
  }

  if (el.premiumStatus) {
    el.premiumStatus.textContent = "Acesso completo liberado. Todos os recursos institucionais estão disponíveis.";
  }

  if (el.headlineText) {
    el.headlineText.textContent = "Terminal institucional ativo. IA operacional monitorando mercado em tempo real.";
  }
}

function applyPlanLocks() {
  ensureInstitutionalCenter();

  const premiumOnlyElements = document.querySelectorAll("[data-premium-only='true']");

  premiumOnlyElements.forEach((node) => {
    node.classList.remove("locked", "hidden-by-plan");
    node.setAttribute("aria-disabled", "false");
  });

  document.querySelectorAll("[data-free-only='true']").forEach((node) => {
    node.classList.add("hidden");
  });

  updateInstitutionalCards();
  updateRealtimeMetrics();
  updateOperationalMonitor({});
  renderOperationalHeatmap();
}

function ensureInstitutionalCenter() {
  const contentPanel = document.querySelector(".content-panel");

  if (!contentPanel || document.getElementById("institutionalCenter")) return;

  const center = document.createElement("section");
  center.className = "panel institutional-center-panel";
  center.id = "institutionalCenter";
  center.setAttribute("data-premium-only", "true");
  center.innerHTML = `
    <div class="institutional-center-header">
      <div>
        <span class="section-kicker">Mesa Institucional</span>
        <h3>Operational Command Center</h3>
      </div>
      <span class="institutional-status-pill" id="saasStatus">SaaS em sincronização</span>
    </div>

    <div class="institutional-metrics-grid">
      <article class="institutional-metric-card">
        <span>Módulos Engine</span>
        <strong id="engineModules">12/14</strong>
        <small>Confluência, risco, timing e histórico ativos</small>
      </article>
      <article class="institutional-metric-card">
        <span>Adaptive Rank</span>
        <strong id="adaptiveRank">A-</strong>
        <small>Score recalibrado por assertividade recente</small>
      </article>
      <article class="institutional-metric-card">
        <span>Anti-loss Level</span>
        <strong id="antiLossLevel">Nível 3</strong>
        <small>Filtro defensivo contra falso positivo</small>
      </article>
      <article class="institutional-metric-card">
        <span>Status SaaS</span>
        <strong id="saasStatusCard">Online</strong>
        <small>API, Socket.IO, login e engine preservados</small>
      </article>
    </div>

    <div class="realtime-metrics-grid" aria-label="Indicadores institucionais em tempo real">
      <article class="realtime-metric-card">
        <span>Latência</span>
        <strong id="metricLatency">--ms</strong>
        <small>Socket.IO + API</small>
      </article>
      <article class="realtime-metric-card">
        <span>Fluxo</span>
        <strong id="metricFlow">--</strong>
        <small>Intensidade operacional</small>
      </article>
      <article class="realtime-metric-card">
        <span>Risco</span>
        <strong id="metricRisk">--</strong>
        <small>Filtro anti-loss</small>
      </article>
      <article class="realtime-metric-card">
        <span>IA</span>
        <strong id="metricAi">--</strong>
        <small>Confiança adaptativa</small>
      </article>
    </div>

    <div class="institutional-ops-grid">
      <div class="institutional-subpanel">
        <div class="subpanel-title">
          <strong>Heatmap operacional</strong>
          <span>tempo real</span>
        </div>
        <div class="institutional-heatmap" id="institutionalHeatmap"></div>
      </div>

      <div class="institutional-subpanel">
        <div class="subpanel-title">
          <strong>Logs profissionais</strong>
          <span>auditoria de decisão</span>
        </div>
        <div class="pro-logs" id="proLogs"></div>
      </div>
    </div>
  `;

  const statsPanel = document.querySelector(".stats-panel");
  if (statsPanel) {
    contentPanel.insertBefore(center, statsPanel);
  } else {
    contentPanel.appendChild(center);
  }
}

function buildInstitutionalHeatmap(signal = {}) {
  const confidence = Number(signal.confidence || signal.score || 0);
  const direction = String(signal.direction || "WAIT").toUpperCase();
  const blocked = Boolean(signal.blocked || direction === "WAIT");
  const risk = Number(signal.risk || signal.riskScore || signal.execution?.risk || 0);
  const trendScore = Math.max(42, Math.min(97, confidence + (direction === "CALL" ? 4 : -2)));
  const volatilityScore = Math.max(36, Math.min(94, 58 + risk + Math.random() * 10));
  const liquidityScore = Math.max(48, Math.min(98, confidence - risk / 2 + 12));
  const timingScore = blocked ? Math.max(18, Math.min(58, confidence)) : Math.max(55, Math.min(99, confidence + 6));

  return [
    { label: "Trend", value: trendScore, tone: trendScore >= 70 ? "hot" : "warm" },
    { label: "Vol", value: volatilityScore, tone: volatilityScore >= 76 ? "risk" : "warm" },
    { label: "Liq", value: liquidityScore, tone: liquidityScore >= 72 ? "hot" : "warm" },
    { label: "Timing", value: timingScore, tone: blocked ? "cold" : "hot" },
    { label: "Risk", value: Math.max(20, Math.min(92, 100 - risk * 2)), tone: blocked ? "risk" : "hot" },
    { label: "IA", value: Math.max(40, Math.min(99, confidence || 61)), tone: blocked ? "cold" : "hot" }
  ];
}

function renderInstitutionalHeatmap(signal = {}) {
  ensureInstitutionalCenter();

  const heatmap = getCachedElement("institutionalHeatmap");
  if (!heatmap) return;

  if (!state.institutionalHeatmap.length || signal.symbol || signal.asset) {
    state.institutionalHeatmap = buildInstitutionalHeatmap(signal);
  }

  heatmap.innerHTML = state.institutionalHeatmap.map((item) => `
    <div class="heatmap-cell ${item.tone}" style="--heat:${Math.max(0.18, Number(item.value) / 100)}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${Math.round(item.value)}%</strong>
    </div>
  `).join("");
}

function renderOperationalHeatmap(signal = {}) {
  renderInstitutionalHeatmap(signal);
}

function getRealtimeMetricElements() {
  return {
    metricLatency: el.metricLatency || getCachedElement("metricLatency"),
    metricFlow: el.metricFlow || getCachedElement("metricFlow"),
    metricRisk: el.metricRisk || getCachedElement("metricRisk"),
    metricAi: el.metricAi || getCachedElement("metricAi")
  };
}

function updateRealtimeMetrics(signal = {}) {
  ensureInstitutionalCenter();

  const metrics = getRealtimeMetricElements();
  const confidence = getOperationalScore(signal);
  const risk = Number(signal.risk || signal.riskScore || signal.execution?.risk || 0);
  const connected = socket.connected;
  const historyLoad = Math.min(99, Math.max(18, state.history.length * 8));
  const flow = confidence || historyLoad;
  const aiScore = Math.max(48, Math.min(99, confidence || 72));
  const latency = connected ? Math.round(42 + Math.random() * 64) : 0;

  setTextContent(metrics.metricLatency, connected ? `${latency}ms` : "offline");
  setTextContent(metrics.metricFlow, `${Math.round(flow)}%`);
  setTextContent(metrics.metricRisk, `${Math.max(0, Math.min(100, Math.round(100 - risk * 3)))}%`);
  setTextContent(metrics.metricAi, `${Math.round(aiScore)}%`);
}

function getDecisionReason(signal = {}) {
  return signal.blockReason ||
    signal.block_reason ||
    signal.execution?.reason ||
    signal.reason ||
    signal.explanation ||
    signal.aiExplanation ||
    "IA aguardando confluência operacional.";
}

function getMarketRegime(signal = {}) {
  const raw = signal.marketRegime || signal.market_regime || signal.regime || signal.trend || signal.context?.regime;
  if (raw) return String(raw).toUpperCase();

  const direction = getOperationalDirection(signal);
  const score = getOperationalScore(signal);
  if (!direction) return "NEUTRO";
  if (score >= 85) return direction === "CALL" ? "TENDÊNCIA ALTA" : "TENDÊNCIA BAIXA";
  return "VALIDANDO";
}

function getRiskLabel(signal = {}) {
  const raw = Number(signal.risk || signal.riskScore || signal.execution?.risk || signal.context?.risk || 0);
  if (!Number.isFinite(raw) || raw <= 0) return signal.blocked ? "Elevado" : "Controlado";
  if (raw >= 24) return "Elevado";
  if (raw >= 12) return "Moderado";
  return "Baixo";
}

function getStrategyLabel(signal = {}) {
  return signal.strategy ||
    signal.strategyName ||
    signal.strategy_name ||
    signal.strategy?.name ||
    signal.context?.strategy ||
    signal.execution?.strategy ||
    "--";
}

function getVolatilityLabel(signal = {}) {
  const value = signal.volatility ?? signal.context?.volatility ?? signal.market?.volatility ?? signal.indicators?.volatility;
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "number") return `${Math.round(value * 100) / 100}`;
  return String(value).slice(0, 34);
}

function formatCompactObject(value) {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value !== "object") return String(value).slice(0, 44);

  return Object.entries(value)
    .slice(0, 3)
    .map(([key, item]) => `${key}:${typeof item === "number" ? Math.round(item * 100) / 100 : item}`)
    .join(" · ") || "--";
}

function getBlockReason(signal = {}) {
  return signal.blockReason || signal.block_reason || signal.execution?.reason || signal.reason || "--";
}

function getActivationReason(signal = {}) {
  return signal.activationReason || signal.activation_reason || signal.execution?.activationReason || signal.explanation || "--";
}


function updateCompactOperations(signal = {}, source = "engine") {
  const direction = getOperationalDirection(signal) || String(signal.direction || signal.signal || "WAIT").toUpperCase();
  const score = getOperationalScore(signal);
  const blocked = Boolean(signal.blocked || direction === "WAIT" || signal.executionAllowed === false || signal.execution_allowed === false);
  const entryStatus = blocked ? "Bloqueada" : direction && direction !== "WAIT" ? "Liberada" : "Aguardando";
  const cycleTime = formatTime(signal.updated_at || signal.updatedAt || signal.created_at || signal.createdAt || signal.timestamp || new Date());
  const rateLimit = signal.rateLimited || signal.rate_limited || signal.rateLimit?.limited ? "Limitado" : "OK";
  const release = entryStatus === "Liberada" ? "Sinal liberado" : entryStatus === "Bloqueada" ? "Sinal bloqueado" : "Aguardando";
  const strategyLabel = getStrategyLabel(signal);
  const marketRegime = getMarketRegime(signal);
  const blockReason = getBlockReason(signal);
  const activationReason = getActivationReason(signal);

  setTextContent(el.bestDirection, direction || "WAIT");
  if (el.bestDirection) {
    el.bestDirection.className = `signal-direction ${direction === "CALL" ? "buy" : direction === "PUT" ? "sell" : "neutral"}`;
  }
  setTextContent(el.bestConfidence, `${Math.round(score || Number(signal.confidence || 0))}%`);
  setTextContent(el.bestExpiry, signal.expiry || signal.expiration || signal.countdown || "--");
  setTextContent(el.bestStrategy, strategyLabel);
  setTextContent(el.bestAiStatus, release);
  setTextContent(el.bestEntryStatus, entryStatus);
  setTextContent(el.marketRegime, marketRegime);
  setTextContent(el.techStrategy, strategyLabel);
  setTextContent(el.techVolatility, getVolatilityLabel(signal));
  setTextContent(el.techDynamicThresholds, formatCompactObject(signal.dynamicThresholds || signal.dynamic_thresholds));
  setTextContent(el.techBlockReason, blockReason);
  setTextContent(el.techActivationReason, activationReason);
  setTextContent(el.currentRisk, getRiskLabel(signal));
  setTextContent(el.decisionReason, getDecisionReason(signal));
  setTextContent(el.aiReleaseStatus, release);
  const engineStatus = socket.connected ? "Online" : "Offline";
  setTextContent(el.engineOnlineStatus, engineStatus);
  setTextContent(el.engineTopStatus, engineStatus);
  setTextContent(el.summaryEngineStatus, engineStatus);
  setTextContent(el.summarySocketStatus, socket.connected ? "Socket online" : "Reconectando");
  setTextContent(el.summaryLastAnalysis, cycleTime);
  setTextContent(el.engineProcessStatus, source === "engine" || source === "bestOpportunity" ? "Processando" : "Aguardando");
  setTextContent(el.lastCycleTime, cycleTime);
  setTextContent(el.lastCycleCompact, cycleTime);
  setTextContent(el.rateLimitStatus, rateLimit);
  setTextContent(el.websocketStatus, socket.connected ? "Online" : "Reconectando");
}

function formatDuration(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function updateOperationalMonitor(monitor = {}) {
  const uptimeMs = Number(monitor.uptimeMs || 0);
  const requestsToday = Number(monitor.twelveDataRequestsToday || 0);
  const dailyBudget = monitor.twelveDataDailyBudget;
  const cacheHitRate = Number(monitor.cacheHitRate || 0);
  const cacheTotalLookups = Number(monitor.cacheTotalLookups || 0);
  const cacheHits = Number(monitor.cacheHits || 0);
  const analyzedSignals = Number(monitor.analyzedSignals || 0);
  const approvedSignals = Number(monitor.approvedSignals || 0);

  setTextContent(el.monitorUptime, monitor.isRunning ? formatDuration(uptimeMs) : "parada");
  setTextContent(el.monitorTwelveDataRequests, String(requestsToday));
  setTextContent(
    el.monitorTwelveDataBudget,
    dailyBudget ? `${requestsToday}/${dailyBudget} requests do dia` : "Budget diário não configurado"
  );
  setTextContent(el.monitorCacheHitRate, `${cacheHitRate.toFixed(1)}%`);
  setTextContent(el.monitorCacheLookups, `${cacheHits}/${cacheTotalLookups} hits assistidos`);
  setTextContent(el.monitorAnalyzedSignals, String(analyzedSignals));
  setTextContent(el.monitorApprovedSignals, String(approvedSignals));
  setTextContent(el.monitorLastExecution, monitor.lastExecutionAt ? formatTime(monitor.lastExecutionAt) : "--");
  setTextContent(el.monitorLastStatus, `${monitor.status || "standby"} · ${monitor.day || "hoje"}`);
}

function renderAIInsights(signal = {}) {
  const list = el.aiInsightsList || document.getElementById("aiInsightsList");
  if (!list) return;

  const direction = getOperationalDirection(signal) || "WAIT";
  const score = getOperationalScore(signal);
  const asset = signal.symbol || signal.asset || "MULTI-ASSET";
  const riskText = signal.blocked ? "Bloqueio defensivo ativo" : score >= 82 ? "Risco calibrado" : "Aguardando validação";

  const insights = [
    ["01", "Tese institucional", `${asset} em leitura ${direction}; score operacional ${Math.round(score || 0)}%.`],
    ["02", "Risco e timing", riskText],
    ["03", "Próxima ação", direction === "WAIT" ? "Manter observação até nova confluência." : "Validar candle, expiração e gestão de banca antes da execução."]
  ];

  list.innerHTML = insights.map(([index, title, text]) => `
    <article class="ai-insight-item">
      <span>${index}</span>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
    </article>
  `).join("");
}

function pushTimelineEvent(message) {
  const timeline = el.operationTimeline || document.getElementById("operationTimeline");
  if (!timeline) return;

  const existing = Array.from(timeline.querySelectorAll(".timeline-event span")).map((node) => node.textContent);
  if (existing[0] === message) return;

  const item = document.createElement("div");
  item.className = "timeline-event";
  item.innerHTML = `<time>${formatTime(new Date())}</time><span>${escapeHtml(message)}</span>`;
  timeline.prepend(item);

  Array.from(timeline.querySelectorAll(".timeline-event")).slice(TIMELINE_EVENT_LIMIT).forEach((node) => node.remove());

  const count = el.timelineCount || document.getElementById("timelineCount");
  if (count) count.textContent = `${timeline.querySelectorAll(".timeline-event").length} eventos`;
}

function drawEquityCurve() {
  const canvas = el.equityCurveCanvas || document.getElementById("equityCurveCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const base = 100;
  const points = [base];

  state.history.slice().reverse().forEach((signal) => {
    const result = String(signal.result || "PENDING").toUpperCase();
    const score = Math.max(1, getOperationalScore(signal) / 100);
    const last = points[points.length - 1];
    const delta = result === "WIN" ? 7 * score : result === "LOSS" ? -5 * score : 1.8 * score;
    points.push(Math.max(72, last + delta));
  });

  while (points.length < 18) {
    const index = points.length;
    points.push(points[index - 1] + Math.sin(index / 2) * 1.8 + 1.2);
  }

  const data = points.slice(-38);
  const max = Math.max(...data) + 6;
  const min = Math.min(...data) - 6;
  const range = Math.max(1, max - min);

  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = 22 + ((height - 44) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle = "rgba(230,198,127,0.10)";
    ctx.stroke();
  }

  const toX = (index) => (width / Math.max(1, data.length - 1)) * index;
  const toY = (value) => height - 22 - ((value - min) / range) * (height - 44);

  ctx.beginPath();
  data.forEach((point, index) => {
    const x = toX(index);
    const y = toY(point);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#8b6b2f");
  gradient.addColorStop(0.45, "#f5da95");
  gradient.addColorStop(1, "#2ee6a6");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.shadowColor = "rgba(230,198,127,0.42)";
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const lastX = toX(data.length - 1);
  const lastY = toY(data[data.length - 1]);
  ctx.beginPath();
  ctx.arc(lastX - 4, lastY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#f5da95";
  ctx.fill();

  const status = el.equityStatus || document.getElementById("equityStatus");
  if (status) status.textContent = state.history.length ? "histórico real" : "baseline visual";
}

function renderProLogs(signal = {}, message = null) {
  ensureInstitutionalCenter();

  const logs = document.getElementById("proLogs");
  if (!logs) return;

  const direction = String(signal.direction || "WAIT").toUpperCase();
  const asset = signal.symbol || signal.asset || "DESK";
  const confidence = Number(signal.confidence || signal.score || 0);
  const blocked = Boolean(signal.blocked || direction === "WAIT");
  const eventMessage = message || (blocked
    ? `Bloqueio anti-loss aplicado em ${asset}; aguardando nova confluência.`
    : `Sinal ${direction} em ${asset} validado com ${confidence}% de confiança.`);

  state.proLogs.unshift({
    time: new Date(),
    level: message ? "ok" : blocked ? "risk" : "ok",
    message: eventMessage
  });

  state.proLogs = state.proLogs.slice(0, 6);

  logs.innerHTML = state.proLogs.map((log) => `
    <div class="pro-log ${log.level}">
      <time>${formatTime(log.time)}</time>
      <span>${escapeHtml(log.message)}</span>
    </div>
  `).join("");
}

function updateInstitutionalCards(signal = {}) {
  ensureInstitutionalCenter();

  const confidence = Number(signal.confidence || signal.score || 0);
  const direction = String(signal.direction || "WAIT").toUpperCase();
  const blocked = Boolean(signal.blocked || direction === "WAIT");
  const engineModules = document.getElementById("engineModules");
  const adaptiveRank = document.getElementById("adaptiveRank");
  const antiLossLevel = document.getElementById("antiLossLevel");
  const saasStatus = document.getElementById("saasStatus");
  const saasStatusCard = document.getElementById("saasStatusCard");

  if (engineModules) engineModules.textContent = blocked ? "11/14" : "14/14";
  if (adaptiveRank) adaptiveRank.textContent = confidence >= 88 ? "A+" : confidence >= 76 ? "A" : confidence >= 62 ? "B+" : "B";
  if (antiLossLevel) antiLossLevel.textContent = blocked ? "Nível 5" : confidence >= 80 ? "Nível 2" : "Nível 3";
  if (saasStatus) saasStatus.textContent = "SaaS institucional online";
  if (saasStatusCard) saasStatusCard.textContent = "Online";
}

function setPremiumPlaceholders() {
  if (el.signalAsset) el.signalAsset.textContent = "---";

  if (el.signalDirection) {
    el.signalDirection.textContent = "IA OPERACIONAL";
    el.signalDirection.className = "signal-direction analyzing";
  }

  if (el.signalEntry) el.signalEntry.textContent = "--";
  if (el.signalExpiry) el.signalExpiry.textContent = "--";
  if (el.signalConfidence) el.signalConfidence.textContent = "0%";
  if (el.signalCountdown) el.signalCountdown.textContent = "--";
  if (el.signalTime) el.signalTime.textContent = "Aguardando dados";

  if (el.aiExplanation) {
    el.aiExplanation.innerHTML =
      'IA operacional aguardando confluência em tempo real. <span class="ai-live-dots"><i></i><i></i><i></i></span>';
  }

  if (el.bestAsset) el.bestAsset.textContent = "---";
  if (el.bestReason) el.bestReason.textContent = "Melhor oportunidade liberada para análise.";
  if (el.bestScore) el.bestScore.textContent = "0%";
  updateCompactOperations({}, "placeholder");
}

function applyModeUI(mode, notify = true) {
  const safeMode = ["conservador", "equilibrado", "agressivo"].includes(mode)
    ? mode
    : "equilibrado";

  state.currentMode = safeMode;
  localStorage.setItem("aerix_mode", safeMode);

  document.body.classList.remove("mode-conservador", "mode-equilibrado", "mode-agressivo");
  document.body.classList.add(`mode-${safeMode}`);

  const modeButtons = document.querySelectorAll(".mode-btn");
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === safeMode);
  });

  const modeDescription = document.getElementById("modeDescription");
  if (modeDescription) {
    modeDescription.textContent = MODE_DESCRIPTIONS[safeMode] || MODE_DESCRIPTIONS.equilibrado;
  }

  setTextContent(el.topCurrentMode, safeMode.charAt(0).toUpperCase() + safeMode.slice(1));

  if (notify) {
    showToast(`Modo ${safeMode} ativado.`, "success");
  }
}

function setupModeSwitcher() {
  const modeButtons = document.querySelectorAll(".mode-btn");

  if (!modeButtons.length) return;

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode || "equilibrado";

      applyModeUI(mode, true);
    });
  });

  applyModeUI(state.currentMode, false);
}

function rotateAIState() {
  const text = AI_STATES[state.aiStateIndex % AI_STATES.length];
  state.aiStateIndex += 1;

  if (el.signalDirection) {
    const currentDirection = String(el.signalDirection.textContent || "").toUpperCase();

    if (!["CALL", "PUT", "BUY", "SELL"].includes(currentDirection)) {
      el.signalDirection.textContent = text.toUpperCase();
      el.signalDirection.className = "signal-direction analyzing";
    }
  }

  if (el.aiExplanation) {
    el.aiExplanation.classList.add("is-typing");
    el.aiExplanation.innerHTML = `${text}<span class="ai-live-dots"><i></i><i></i><i></i></span>`;
  }
}

function buildHistoryQuery() {
  const params = new URLSearchParams();
  const page = Math.max(1, Number(state.historyPagination.page || 1));
  const limit = Math.max(1, Number(state.historyPagination.limit || HISTORY_PAGE_SIZE));

  params.set("page", String(page));
  params.set("limit", String(limit));

  Object.entries(state.historyFilters || {}).forEach(([key, value]) => {
    const text = String(value || "").trim();
    if (!text || key === "strategy") return;
    params.set(key === "symbol" ? "asset" : key, text);
  });

  return params.toString();
}

function syncHistoryPagination(pagination = {}, receivedCount = 0) {
  const limit = Number(pagination.limit || state.historyPagination.limit || HISTORY_PAGE_SIZE);
  const page = Number(pagination.page || state.historyPagination.page || 1);
  const total = Number(pagination.total || receivedCount || 0);

  state.historyPagination = {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : HISTORY_PAGE_SIZE,
    total: Number.isFinite(total) ? total : receivedCount,
    hasMore: Boolean(pagination.hasMore)
  };
}

async function loadHistory() {
  try {
    const query = buildHistoryQuery();
    const response = await apiFetch(`/api/signals/recent?${query}`);
    const data = await response.json().catch(() => null);

    if (data?.ok && Array.isArray(data.signals)) {
      state.history = filterConfirmedOperationalSignals(data.signals).slice(0, MAX_HISTORY_ITEMS);
      syncHistoryPagination(data.pagination, state.history.length);
    } else if (data?.ok && Array.isArray(data.data)) {
      state.history = filterConfirmedOperationalSignals(data.data).slice(0, MAX_HISTORY_ITEMS);
      syncHistoryPagination(data.pagination, state.history.length);
    } else {
      state.history = [];
      syncHistoryPagination({}, 0);
    }

    if (el.historyUpdated) el.historyUpdated.textContent = "atualizado agora";
    scheduleHistoryRender();
    scheduleEquityDraw();
  } catch (error) {
    state.history = [];
    syncHistoryPagination({}, 0);
    if (el.historyUpdated) el.historyUpdated.textContent = "falha ao sincronizar";
    scheduleHistoryRender();
    scheduleEquityDraw();
  }
}

async function loadStats() {
  try {
    const response = await apiFetch("/api/stats");
    const data = await response.json().catch(() => null);

    const stats = data?.stats || data?.data || {};

    if (data?.ok) {
      if (el.statTotal) el.statTotal.textContent = stats.total ?? 0;
      if (el.statWins) el.statWins.textContent = stats.wins ?? 0;
      if (el.statLosses) el.statLosses.textContent = stats.losses ?? 0;
      if (el.statWinrate) el.statWinrate.textContent = `${stats.winrate ?? 0}%`;
      if (el.statsUpdated) el.statsUpdated.textContent = "Atualizado agora";
      return;
    }

    resetStats();
  } catch (error) {
    resetStats();
  }
}

function resetStats() {
  if (el.statTotal) el.statTotal.textContent = "0";
  if (el.statWins) el.statWins.textContent = "0";
  if (el.statLosses) el.statLosses.textContent = "0";
  if (el.statWinrate) el.statWinrate.textContent = "0%";
  if (el.statsUpdated) el.statsUpdated.textContent = "Sem dados";
}


function normalizeDashboardData(payload = {}) {
  return payload?.data && typeof payload.data === "object" ? payload.data : payload || {};
}

function normalizeSignalCollection(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.data)) return value.data.filter(Boolean);
  if (Array.isArray(value?.signals)) return value.signals.filter(Boolean);
  if (Array.isArray(value?.history)) return value.history.filter(Boolean);
  return [];
}

function extractRuntimeSignals(runtimeData = {}) {
  const data = normalizeDashboardData(runtimeData);
  const bestOpportunity = data.signalCenter?.bestOpportunity || data.bestOpportunity || data.lastSignal || data.currentSignal || null;
  const ranking = normalizeSignalCollection(data.ranking || data.latestResults);
  const history = normalizeSignalCollection(data.history || data.recentHistory);
  const blockedAnalyses = normalizeSignalCollection(data.blockedAnalyses || data.blocked_analyses);

  return {
    bestOpportunity,
    ranking,
    history,
    blockedAnalyses,
    connection: data.connection || {},
    filters: data.filters || {},
    analytics: data.analytics || {},
    operationalMonitor: data.operationalMonitor || data.runtime?.operationalMonitor || null
  };
}

function upsertBySignature(collection, item, limit = 12) {
  if (!item || typeof item !== "object") return collection;

  const signature = item.id || [
    item.symbol || item.asset || "UNKNOWN",
    item.signal || item.direction || "WAIT",
    item.blockReason || item.block_reason || item.reason || "",
    item.created_at || item.createdAt || item.timestamp || item.time || ""
  ].join("|");

  const next = collection.filter((entry) => {
    const entrySignature = entry.id || [
      entry.symbol || entry.asset || "UNKNOWN",
      entry.signal || entry.direction || "WAIT",
      entry.blockReason || entry.block_reason || entry.reason || "",
      entry.created_at || entry.createdAt || entry.timestamp || entry.time || ""
    ].join("|");

    return entrySignature !== signature;
  });

  next.unshift(item);
  return next.slice(0, limit);
}

function ensureShadowModePanel() {
  if (el.shadowModePanel || document.getElementById("shadowModePanel")) {
    el.shadowModePanel = el.shadowModePanel || document.getElementById("shadowModePanel");
    el.shadowModeStatus = el.shadowModeStatus || document.getElementById("shadowModeStatus");
    el.shadowModeList = el.shadowModeList || document.getElementById("shadowModeList");
    el.shadowModeUpdated = el.shadowModeUpdated || document.getElementById("shadowModeUpdated");
    return;
  }

  const contentPanel = document.querySelector(".content-panel");
  if (!contentPanel) return;

  const panel = document.createElement("section");
  panel.className = "panel shadow-mode-panel premium-card secondary-details-panel";
  panel.id = "shadowModePanel";
  panel.innerHTML = `
    <div class="panel-header"><h3>Shadow Mode</h3><span id="shadowModeUpdated">standby</span></div>
    <details class="technical-details shadow-details">
      <summary>Ver análises bloqueadas, shadow mode e execuções</summary>
      <div class="filter-summary-grid shadow-mode-summary">
        <div class="stat-card"><span>Status</span><strong id="shadowModeStatus">Monitorando</strong></div>
        <div class="stat-card"><span>Análises</span><strong id="shadowSignalsCount">0</strong></div>
        <div class="stat-card"><span>Bloqueios</span><strong id="shadowBlockedCount">0</strong></div>
        <div class="stat-card"><span>Execuções</span><strong id="shadowExecutionCount">0</strong></div>
      </div>
      <div class="filter-block-list" id="shadowModeList"><div class="history-empty">Aguardando eventos da engine</div></div>
    </details>
  `;

  const filterPanel = document.querySelector(".filter-analytics-panel");
  const historyPanel = document.querySelector(".history-panel");
  contentPanel.insertBefore(panel, filterPanel || historyPanel || null);

  el.shadowModePanel = panel;
  el.shadowModeStatus = panel.querySelector("#shadowModeStatus");
  el.shadowModeList = panel.querySelector("#shadowModeList");
  el.shadowModeUpdated = panel.querySelector("#shadowModeUpdated");
}

function ensureFilterPerformancePanel() {
  if (el.filterPerformancePanel || document.getElementById("filterPerformancePanel")) {
    el.filterPerformancePanel = el.filterPerformancePanel || document.getElementById("filterPerformancePanel");
    el.filterPerformanceCards = el.filterPerformanceCards || document.getElementById("filterPerformanceCards");
    el.filterPerformanceUpdated = el.filterPerformanceUpdated || document.getElementById("filterPerformanceUpdated");
    return;
  }

  const filterPanel = document.querySelector(".filter-analytics-panel");
  const contentPanel = document.querySelector(".content-panel");
  if (!contentPanel) return;

  const panel = document.createElement("section");
  panel.className = "panel filter-performance-panel premium-card secondary-details-panel";
  panel.id = "filterPerformancePanel";
  panel.innerHTML = `
    <div class="panel-header"><h3>Filter Performance</h3><span id="filterPerformanceUpdated">sem dados</span></div>
    <details class="technical-details filter-performance-details">
      <summary>Ver métricas detalhadas dos filtros</summary>
      <div class="filter-summary-grid" id="filterPerformanceCards">
        <div class="stat-card"><span>Sinais bloqueados</span><strong>0%</strong></div>
        <div class="stat-card"><span>Filtro líder</span><strong>--</strong></div>
        <div class="stat-card"><span>Ativo crítico</span><strong>--</strong></div>
        <div class="stat-card"><span>Score médio bloqueado</span><strong>0.0</strong></div>
      </div>
    </details>
  `;

  if (filterPanel) {
    contentPanel.insertBefore(panel, filterPanel);
  } else {
    contentPanel.appendChild(panel);
  }

  el.filterPerformancePanel = panel;
  el.filterPerformanceCards = panel.querySelector("#filterPerformanceCards");
  el.filterPerformanceUpdated = panel.querySelector("#filterPerformanceUpdated");
}

function renderShadowMode(signal = null, eventType = "sync") {
  ensureShadowModePanel();

  if (signal && typeof signal === "object") {
    state.shadowMode.signals = upsertBySignature(state.shadowMode.signals, signal, SHADOW_EVENT_LIMIT);

    if (signal.blocked || signal.signal === "WAIT" || signal.direction === "WAIT" || eventType === "execution") {
      state.shadowMode.blocked = upsertBySignature(state.shadowMode.blocked, signal, SHADOW_EVENT_LIMIT);
    }

    if (eventType === "execution") {
      state.shadowMode.executions = upsertBySignature(state.shadowMode.executions, signal, SHADOW_EVENT_LIMIT);
    }

    state.shadowMode.lastUpdated = new Date().toISOString();
  }

  const allEvents = [
    ...state.shadowMode.blocked.map((item) => ({ ...item, __shadowType: "BLOQUEIO" })),
    ...state.shadowMode.signals.map((item) => ({ ...item, __shadowType: "OBSERVADO" }))
  ].slice(0, SHADOW_EVENT_LIMIT);

  const signalsCount = document.getElementById("shadowSignalsCount");
  const blockedCount = document.getElementById("shadowBlockedCount");
  const executionCount = document.getElementById("shadowExecutionCount");

  if (el.shadowModeStatus) el.shadowModeStatus.textContent = socket.connected ? "Live" : "Protegido";
  if (signalsCount) signalsCount.textContent = state.shadowMode.signals.length;
  if (blockedCount) blockedCount.textContent = state.shadowMode.blocked.length;
  if (executionCount) executionCount.textContent = state.shadowMode.executions.length;
  if (el.shadowModeUpdated) el.shadowModeUpdated.textContent = state.shadowMode.lastUpdated ? formatTime(state.shadowMode.lastUpdated) : "standby";

  if (!el.shadowModeList) return;

  el.shadowModeList.innerHTML = allEvents.length
    ? allEvents.map((item) => {
        const direction = item.signal || item.direction || "WAIT";
        const reason = item.blockReason || item.block_reason || item.reason || item.explanation || "Observação sombra preservada para auditoria.";
        return `
          <div class="filter-block-item shadow-mode-item">
            <div>
              <strong>${escapeHtml(item.symbol || item.asset || "UNKNOWN")}</strong>
              <span>${escapeHtml(item.__shadowType)} · ${escapeHtml(direction)}</span>
            </div>
            <p>${escapeHtml(reason)}</p>
            <small>${formatTime(item.timestamp || item.created_at || item.createdAt || new Date())} · score ${Number(item.finalScore || item.final_score || item.score || item.confidence || 0).toFixed(1)}</small>
          </div>
        `;
      }).join("")
    : `<div class="history-empty">Aguardando eventos da engine</div>`;
}

function renderFilterPerformance(data = {}) {
  ensureFilterPerformancePanel();

  const blocksByFilter = Array.isArray(data.blocksByFilter) ? data.blocksByFilter : [];
  const blocksByAsset = Array.isArray(data.blocksByAsset) ? data.blocksByAsset : [];
  const summary = data.summary || {};
  const totalSignals = Number(data.totalSignals || 0);
  const blockedSignals = Number(data.blockedSignals || summary.total_blocks || 0);
  const approvedSignals = Number(data.approvedSignals || 0);
  const approvalRate = Number(data.approvalRate || 0);
  const filterEfficiency = totalSignals ? Number(((blockedSignals / totalSignals) * 100).toFixed(1)) : 0;
  const topFilter = blocksByFilter[0];
  const topAsset = blocksByAsset[0];
  const avgScore = Number(summary.avg_score || topFilter?.avgFinalScore || 0);

  state.filterPerformance = {
    filterEfficiency,
    approvalRate,
    topFilter,
    topAsset,
    avgScore,
    approvedSignals,
    blockedSignals
  };

  if (el.filterPerformanceUpdated) {
    el.filterPerformanceUpdated.textContent = summary.last_block_at ? formatTime(summary.last_block_at) : "tempo real";
  }

  if (!el.filterPerformanceCards) return;

  el.filterPerformanceCards.innerHTML = `
    <div class="stat-card"><span>Sinais bloqueados</span><strong>${filterEfficiency.toFixed(1)}%</strong></div>
    <div class="stat-card"><span>Watchlist</span><strong>${Number(data.watchlistRate || 0).toFixed(1)}%</strong></div>
    <div class="stat-card"><span>Filtro líder</span><strong>${escapeHtml(topFilter?.filterLabel || topFilter?.filterName || "--")}</strong></div>
    <div class="stat-card"><span>Penalizações</span><strong>${escapeHtml(data.penalizedSignals || data.penaltySignals || summary.total_penalties || 0)}</strong></div>
  `;
}

function syncRuntimeDashboard(runtimePayload = {}) {
  const runtime = extractRuntimeSignals(runtimePayload);
  const latestSignal = runtime.bestOpportunity || runtime.ranking[0] || runtime.history[0] || null;

  if (runtime.operationalMonitor) {
    updateOperationalMonitor(runtime.operationalMonitor);
  }

  if (runtime.bestOpportunity) {
    renderSignal(runtime.bestOpportunity);
  }

  if (runtime.history.length) {
    state.history = filterConfirmedOperationalSignals(runtime.history).slice(0, MAX_HISTORY_ITEMS);
    scheduleHistoryRender();
    scheduleEquityDraw();
  }

  normalizeSignalCollection(runtime.blockedAnalyses || runtime.filters?.blockedAnalyses).forEach((analysis) => {
    renderShadowMode(analysis, "blockedAnalysis");
  });

  if (latestSignal) {
    updateInstitutionalCards(latestSignal);
    updateRealtimeMetrics(latestSignal);
    renderOperationalHeatmap(latestSignal);
    renderAIInsights(latestSignal);
    renderShadowMode(latestSignal, "engine");
    updateCompactOperations(latestSignal, "engine");
  }

  const stats = runtime.analytics?.historyStats || {};
  if (runtime.analytics?.performanceDashboard) {
    renderPerformanceDashboard(runtime.analytics.performanceDashboard);
  }

  if (Object.keys(stats).length) {
    if (el.statTotal) el.statTotal.textContent = stats.total ?? stats.totalSignals ?? el.statTotal.textContent;
    if (el.statWins) el.statWins.textContent = stats.wins ?? el.statWins.textContent;
    if (el.statLosses) el.statLosses.textContent = stats.losses ?? el.statLosses.textContent;
    if (el.statWinrate) el.statWinrate.textContent = `${stats.winRate ?? stats.winrate ?? 0}%`;
    if (el.statsUpdated) el.statsUpdated.textContent = "Engine live";
  }
}


function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${Number.isFinite(numeric) ? numeric.toFixed(1) : "0.0"}%`;
}

function getWinrateValue(bucket = {}) {
  const numeric = Number(bucket.winrate ?? bucket.winRate ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function renderWinrateBreakdown(items = [], options = {}) {
  const { labelKey = "symbol", empty = "Sem resultados" } = options;

  if (!Array.isArray(items) || !items.length) {
    return `<div class="history-empty">${escapeHtml(empty)}</div>`;
  }

  return items.slice(0, 8).map((item, index) => {
    const label = item[labelKey] || item.strategyName || item.strategy_name || "UNKNOWN";
    const winrate = getWinrateValue(item);
    const total = Number(item.total || 0);
    const wins = Number(item.wins || 0);
    const losses = Number(item.losses || 0);

    return `
      <div class="performance-row">
        <div class="rank-left">
          <span class="rank-position">#${index + 1}</span>
          <div>
            <strong>${escapeHtml(label)}</strong>
            <span>${wins} wins · ${losses} losses · ${total} resolvidos</span>
          </div>
        </div>
        <div class="performance-rate">${formatPercent(winrate)}</div>
      </div>
    `;
  }).join("");
}

function renderPerformanceDashboard(data = {}) {
  if (!data || typeof data !== "object") data = {};

  state.performanceDashboard = data;

  const winrate24h = getWinrateValue(data.winrate24h);
  const winrate7d = getWinrateValue(data.winrate7d);
  const winrate30d = getWinrateValue(data.winrate30d);
  const lastApproved = data.lastApprovedSignal;

  if (el.perfSignalsToday) el.perfSignalsToday.textContent = data.signalsToday ?? data.analyzedToday ?? 0;
  if (el.perfApprovedToday) el.perfApprovedToday.textContent = data.approvedSignalsToday ?? data.approvedToday ?? 0;
  if (el.perfBlockedToday) el.perfBlockedToday.textContent = data.blockedSignalsToday ?? data.blockedToday ?? 0;
  if (el.perfApprovalRate) el.perfApprovalRate.textContent = formatPercent(data.approvalRate);
  if (el.perfWinrate24h) el.perfWinrate24h.textContent = formatPercent(winrate24h);
  if (el.summaryWinrate24h) el.summaryWinrate24h.textContent = formatPercent(winrate24h);
  if (el.summarySignalsToday) el.summarySignalsToday.textContent = data.signalsToday ?? data.analyzedToday ?? 0;
  if (el.perfWinrate7d) el.perfWinrate7d.textContent = formatPercent(winrate7d);
  if (el.perfWinrate30d) el.perfWinrate30d.textContent = formatPercent(winrate30d);
  if (el.perfLastApproved) el.perfLastApproved.textContent = lastApproved?.symbol || "--";
  if (el.performanceUpdated) el.performanceUpdated.textContent = data.generatedAt ? `Atualizado ${formatTime(data.generatedAt)}` : "sem dados";

  if (el.perfWinrateByAsset) {
    el.perfWinrateByAsset.innerHTML = renderWinrateBreakdown(data.winrateBySymbol, {
      labelKey: "symbol",
      empty: "Sem resultados por ativo"
    });
  }

  if (el.perfWinrateByStrategy) {
    el.perfWinrateByStrategy.innerHTML = renderWinrateBreakdown(data.winrateByStrategy, {
      labelKey: "strategyName",
      empty: "Sem resultados por estratégia"
    });
  }
}

async function loadPerformanceDashboard() {
  try {
    const response = await apiFetch("/api/dashboard/performance");
    const data = await response.json().catch(() => null);
    const performance = data?.ok ? data.data : data;

    if (performance && typeof performance === "object") {
      renderPerformanceDashboard(performance);
      return;
    }

    renderPerformanceDashboard({});
  } catch (error) {
    renderPerformanceDashboard({});
  }
}

function renderFilterAnalytics(data = {}) {
  const summary = data.summary || {};
  const blocksByFilter = Array.isArray(data.blocksByFilter)
    ? data.blocksByFilter
    : Array.isArray(data.ranking)
      ? data.ranking.map((item) => ({
          filterName: item.filter_name,
          filterLabel: item.filter_label,
          total: item.total_blocks,
          affectedAssets: item.affected_assets,
          avgFinalScore: item.avg_score,
          lastBlockAt: item.last_block_at
        }))
      : [];
  const blocksByAsset = Array.isArray(data.blocksByAsset) ? data.blocksByAsset : [];
  const blocksByHour = Array.isArray(data.blocksByHour) ? data.blocksByHour : [];
  const recentBlocks = Array.isArray(data.recentBlocks) ? data.recentBlocks : [];

  if (el.filterApprovalRate) el.filterApprovalRate.textContent = `${Number(data.approvalRate || 0).toFixed(1)}%`;
  if (el.filterTotalSignals) el.filterTotalSignals.textContent = data.analyzedSignals ?? data.totalSignals ?? 0;
  if (el.filterApprovedSignals) el.filterApprovedSignals.textContent = data.confirmedSignals ?? data.approvedSignals ?? 0;
  if (el.filterBlockedSignals) el.filterBlockedSignals.textContent = data.blockedAnalyses ?? data.blockedSignals ?? summary.total_blocks ?? 0;
  if (el.filterWatchlistRate) el.filterWatchlistRate.textContent = `${Number(data.watchlistRate || 0).toFixed(1)}%`;
  if (el.filterHighConfidenceRate) el.filterHighConfidenceRate.textContent = `${Number(data.highConfidenceRate || 0).toFixed(1)}%`;
  if (el.filterMediumConfidenceRate) el.filterMediumConfidenceRate.textContent = `${Number(data.mediumConfidenceRate || 0).toFixed(1)}%`;
  if (el.filterPenaltySignals) el.filterPenaltySignals.textContent = data.penalizedSignals ?? data.penaltySignals ?? summary.total_penalties ?? 0;
  if (el.filterAnalyticsUpdated) el.filterAnalyticsUpdated.textContent = summary.last_block_at ? formatTime(summary.last_block_at) : "sem bloqueios";

  if (el.filterRankingList) {
    el.filterRankingList.innerHTML = blocksByFilter.length
      ? blocksByFilter.map((item, index) => `
        <div class="filter-rank-item">
          <div class="rank-left">
            <span class="rank-position">#${index + 1}</span>
            <div>
              <strong>${escapeHtml(item.filterLabel || item.filterName || "Filtro")}</strong>
              <span>${escapeHtml(item.affectedAssets || 0)} ativos · ${escapeHtml(item.penalties || 0)} penalizações · ${escapeHtml(item.savedLosses || 0)} losses evitados · ${escapeHtml(item.lostWins || 0)} wins perdidos</span>
            </div>
          </div>
          <div class="rank-right">${escapeHtml(item.total || 0)}</div>
        </div>
      `).join("")
      : `<div class="history-empty">Nenhum bloqueio registrado</div>`;
  }

  if (el.filterAssetList) {
    el.filterAssetList.innerHTML = blocksByAsset.length
      ? blocksByAsset.map((item, index) => `
        <div class="filter-rank-item">
          <div class="rank-left">
            <span class="rank-position">#${index + 1}</span>
            <div>
              <strong>${escapeHtml(item.symbol || "UNKNOWN")}</strong>
              <span>${escapeHtml(item.filtersTriggered || 0)} filtros · score final médio ${Number(item.avgFinalScore || 0).toFixed(1)}</span>
            </div>
          </div>
          <div class="rank-right">${escapeHtml(item.total || 0)}</div>
        </div>
      `).join("")
      : `<div class="history-empty">Nenhum ativo bloqueado</div>`;
  }

  if (el.filterHourList) {
    el.filterHourList.innerHTML = blocksByHour.length
      ? blocksByHour.map((item, index) => `
        <div class="filter-rank-item">
          <div class="rank-left">
            <span class="rank-position">#${index + 1}</span>
            <div>
              <strong>${String(item.hour).padStart(2, "0")}:00</strong>
              <span>${escapeHtml(item.affectedAssets || 0)} ativos impactados</span>
            </div>
          </div>
          <div class="rank-right">${escapeHtml(item.total || 0)}</div>
        </div>
      `).join("")
      : `<div class="history-empty">Nenhum horário mapeado</div>`;
  }

  if (el.filterBlockList) {
    el.filterBlockList.innerHTML = recentBlocks.length
      ? recentBlocks.slice(0, 8).map((item) => `
        <div class="filter-block-item">
          <div>
            <strong>${escapeHtml(item.symbol || "UNKNOWN")}</strong>
            <span>${escapeHtml(item.filterLabel || item.filterName || "Filtro institucional")}</span>
          </div>
          <p>${escapeHtml(item.reason || "Bloqueio institucional sem motivo detalhado.")}</p>
          <small>${formatTime(item.timestamp || item.createdAt)} · score ${Number(item.score || 0).toFixed(1)} · final ${Number(item.finalScore || 0).toFixed(1)}</small>
        </div>
      `).join("")
      : `<div class="history-empty">Aguardando bloqueios da engine</div>`;
  }

  renderFilterPerformance({
    ...data,
    blocksByFilter,
    blocksByAsset,
    blocksByHour,
    recentBlocks
  });
}

async function loadFilterAnalytics() {
  try {
    const response = await apiFetch("/api/filter-analytics?limit=30&rankingLimit=8");
    const data = await response.json().catch(() => null);

    const analytics = data?.ok ? data.data : data;

    if (analytics && typeof analytics === "object") {
      state.filterAnalytics = analytics;
      renderFilterAnalytics(analytics);
      return;
    }

    renderFilterAnalytics({});
  } catch (error) {
    renderFilterAnalytics({});
  }
}


function getHistoryRenderLimit() {
  return Math.min(
    state.historyPagination.limit || HISTORY_PAGE_SIZE,
    window.matchMedia("(min-width: 900px) and (max-width: 1400px)").matches
      ? COMPACT_HISTORY_ITEMS
      : MAX_HISTORY_ITEMS
  );
}

function renderHistoryPagination() {
  const { page, limit, total, hasMore } = state.historyPagination;
  const pageCount = total ? Math.max(1, Math.ceil(total / limit)) : 1;

  if (el.historyPageInfo) {
    el.historyPageInfo.textContent = total
      ? `Página ${page}/${pageCount}`
      : `Página ${page}`;
  }

  if (el.historyPrev) el.historyPrev.disabled = page <= 1;
  if (el.historyNext) el.historyNext.disabled = !hasMore && page >= pageCount;
}

function renderHistory() {
  if (!el.historyList) return;

  el.historyList.innerHTML = "";

  const visibleHistory = state.history
    .filter(signalMatchesHistoryFilters)
    .slice(0, getHistoryRenderLimit());

  if (!visibleHistory.length) {
    el.historyList.innerHTML = `<div class="history-empty">Nenhum sinal encontrado para os filtros atuais.</div>`;
    if (el.historyCount) el.historyCount.textContent = "0";
    renderHistoryPagination();
    return;
  }

  const header = document.createElement("div");
  header.className = "history-table-row history-table-header";
  header.innerHTML = `
    <span>Ativo</span>
    <span>Direção</span>
    <span>Resultado</span>
    <span>Score</span>
    <span>Estratégia</span>
    <span>Hora</span>
    <span>Ações</span>
  `;
  el.historyList.appendChild(header);

  visibleHistory.forEach((signal) => {
    const row = document.createElement("div");
    row.className = "history-table-row compact-history-item";

    const direction = getOperationalDirection(signal) || "WAIT";
    const score = Math.round(getOperationalScore(signal));
    const result = String(signal.result || "PENDING").toUpperCase();
    const normalizedResult = result === "DRAW" ? "draw" : result === "WIN" ? "win" : result === "LOSS" ? "loss" : "pending";
    const directionClass = direction === "CALL" ? "call" : direction === "PUT" ? "put" : "neutral";
    const signalId = Number(signal.id);
    const canSetResult = Number.isFinite(signalId) && signalId > 0;
    const strategy = getStrategyLabel(signal);

    row.innerHTML = `
      <strong>${escapeHtml(signal.symbol || signal.asset || "---")}</strong>
      <span class="badge direction-badge ${directionClass}">${escapeHtml(direction)}</span>
      <span class="badge result-badge ${normalizedResult}">${escapeHtml(result)}</span>
      <span class="history-score">${score}%</span>
      <span class="history-strategy">${escapeHtml(strategy)}</span>
      <time>${formatTime(signal.created_at || signal.createdAt || signal.time || signal.timestamp)}</time>
      ${canSetResult ? `<div class="action-buttons"><button onclick="setResult(${signalId}, 'WIN')">WIN</button><button onclick="setResult(${signalId}, 'LOSS')">LOSS</button></div>` : `<span class="history-muted">--</span>`}
    `;

    el.historyList.appendChild(row);
  });

  if (el.historyCount) {
    const total = state.historyPagination.total || state.history.length;
    el.historyCount.textContent = `${visibleHistory.length}/${total}`;
  }

  renderHistoryPagination();
}


function normalizeOperationalDirection(value) {
  const direction = String(value || "").trim().toUpperCase();
  return ["CALL", "PUT"].includes(direction) ? direction : "";
}

function getOperationalDirection(signal = {}) {
  return (
    normalizeOperationalDirection(signal.direction) ||
    normalizeOperationalDirection(signal.signal) ||
    normalizeOperationalDirection(signal.action) ||
    normalizeOperationalDirection(signal.side) ||
    normalizeOperationalDirection(signal.type) ||
    normalizeOperationalDirection(signal.result)
  );
}

function getOperationalScore(signal = {}) {
  const score = Number(
    signal.adjusted_score ??
    signal.adjustedScore ??
    signal.final_score ??
    signal.finalScore ??
    signal.score ??
    signal.confidence ??
    0
  );

  return Number.isFinite(score) ? score : 0;
}

function getMinimumValidatedScore(signal = {}) {
  const explicitMinimum = Number(
    signal.minimum_score ??
    signal.minimumScore ??
    signal.dynamicThresholds?.minimumScore ??
    signal.dynamic_thresholds?.minimumScore
  );

  if (Number.isFinite(explicitMinimum) && explicitMinimum > 0) return explicitMinimum;

  const mode = String(signal.mode || signal.tradingMode || signal.operationMode || "balanced").toLowerCase();

  if (["conservador", "conservative"].includes(mode)) return 88;
  if (["agressivo", "aggressive"].includes(mode)) return 70;

  return 78;
}

function isConfirmedOperationalSignal(signal = {}) {
  if (!signal || typeof signal !== "object") return false;

  const status = String(signal.status || signal.signal_status || "").trim().toLowerCase();
  const result = String(signal.result || "").trim().toLowerCase();
  const rawDirection = String(signal.direction || signal.signal || "").trim().toUpperCase();
  const blockedStatuses = ["blocked", "bloqueado", "rejected", "rejeitado", "invalid", "invalido", "cancelled", "canceled", "wait", "waiting"];

  if (
    signal.blocked === true ||
    signal.executionAllowed === false ||
    rawDirection === "WAIT" ||
    blockedStatuses.includes(status) ||
    blockedStatuses.includes(result)
  ) {
    return false;
  }

  if (signal.executionAllowed !== true && signal.execution_allowed !== true) {
    return false;
  }

  return Boolean(getOperationalDirection(signal)) && getOperationalScore(signal) >= getMinimumValidatedScore(signal);
}

function signalMatchesHistoryFilters(signal = {}) {
  const symbolFilter = String(state.historyFilters.symbol || "").trim().toUpperCase();
  const strategyFilter = String(state.historyFilters.strategy || "").trim().toLowerCase();
  const resultFilter = String(state.historyFilters.result || "").toLowerCase();
  const symbol = String(signal.symbol || signal.asset || "").toUpperCase();
  const strategy = String(getStrategyLabel(signal)).toLowerCase();
  const result = String(signal.result || "pending").toLowerCase();

  return (!symbolFilter || symbol.includes(symbolFilter))
    && (!strategyFilter || strategy.includes(strategyFilter))
    && (!resultFilter || result === resultFilter);
}


function filterConfirmedOperationalSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(isConfirmedOperationalSignal);
}

function renderSignal(signal) {
  if (!signal || !isConfirmedOperationalSignal(signal)) return;

  const direction = getOperationalDirection(signal);
  const confidence = getOperationalScore(signal);
  const blocked = Boolean(signal.blocked || direction === "WAIT");
  const blockReason =
    signal.blockReason ||
    signal.block_reason ||
    signal.execution?.reason ||
    null;
  const dataQuality = signal.dataQuality || signal.data_quality || {};
  const dataSource = dataQuality.source || signal.source || "mercado";
  const dataOperational = dataQuality.operational !== false && !dataQuality.isFallback;

  setTextContent(el.signalAsset, signal.symbol || signal.asset || "---");

  if (el.signalDirection) {
    el.signalDirection.textContent = direction || "AGUARDANDO";
    el.signalDirection.className = "signal-direction";

    if (blocked) {
      el.signalDirection.classList.add("analyzing");
      el.signalDirection.textContent = "WAIT";
    } else if (direction === "CALL" || direction === "BUY") {
      el.signalDirection.classList.add("buy");
    } else if (direction === "PUT" || direction === "SELL") {
      el.signalDirection.classList.add("sell");
    } else {
      el.signalDirection.classList.add("analyzing");
      el.signalDirection.textContent = "IA VALIDANDO";
    }
  }

  setTextContent(el.signalEntry, blocked ? "--" : signal.entry || signal.entryTime || "--");
  setTextContent(el.signalExpiry, blocked ? "--" : signal.expiry || signal.expiration || "--");
  setTextContent(el.signalConfidence, `${confidence}%`);
  setTextContent(el.signalCountdown, blocked ? "Bloqueado" : signal.countdown || "--");
  setTextContent(el.signalTime, formatTime(signal.created_at || new Date()));

  if (el.aiExplanation) {
    el.aiExplanation.classList.remove("is-typing");
    const qualityText = dataOperational
      ? `Fonte ${dataSource} validada.`
      : `Fonte ${dataSource} sem liberacao operacional.`;

    el.aiExplanation.textContent = blocked
      ? `${qualityText} ${blockReason || signal.explanation || "IA bloqueou a entrada para reduzir falso positivo."}`
      : signal.explanation ||
        signal.aiExplanation ||
        `${qualityText} IA analisando confluencia, tendencia, timing e qualidade do candle.`;
  }

  setTextContent(el.bestAsset, signal.symbol || signal.asset || "---");
  if (el.bestReason) {
    el.bestReason.textContent =
      blockReason ||
      signal.reason ||
      signal.explanation ||
      "Sinal detectado com leitura operacional.";
  }
  setTextContent(el.bestScore, `${confidence}%`);
  updateCompactOperations(signal, "signal");

  let card = state.domCache.get("signalCard");
  if (!card || !document.contains(card)) {
    card = document.querySelector(".signal-card");
    state.domCache.set("signalCard", card);
  }

  if (card) {
    card.classList.remove("signal-call", "signal-put", "signal-wait", "flash");

    if (blocked) {
      card.classList.add("signal-wait");
    } else if (direction === "CALL" || direction === "BUY") {
      card.classList.add("signal-call");
    } else if (direction === "PUT" || direction === "SELL") {
      card.classList.add("signal-put");
    } else {
      card.classList.add("signal-wait");
    }

    if (state.isDocumentVisible) {
      requestAnimationFrame(() => card.classList.add("flash"));
    }
  }

  updateInstitutionalCards(signal);
  updateRealtimeMetrics(signal);
  renderOperationalHeatmap(signal);
  renderAIInsights(signal);
  renderProLogs(signal);
  pushTimelineEvent(`${direction} ${signal.symbol || signal.asset || "ativo"} · score ${Math.round(confidence)}%`);
  scheduleEquityDraw();

  if (state.isDocumentVisible) {
    pushChartPoint(confidence || 50);
    drawMiniChart();
  }
}

async function setResult(id, result) {
  if (!id) return;

  try {
    const response = await apiFetch(`/api/signals/${id}/result`, {
      method: "POST",
      body: JSON.stringify({ result })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.ok === false) {
      showToast(data?.message || "Não foi possível atualizar o resultado.", "error");
      return;
    }

    showToast(`Resultado marcado como ${result}.`, "success");
  } catch (error) {
    showToast("Erro ao atualizar resultado.", "error");
  }
}

function setConnection(status) {
  if (!el.connectionText || !el.connectionBadge) return;

  el.connectionText.textContent = status;
  setTextContent(el.websocketStatus, status);
  setTextContent(el.summarySocketStatus, status);
  setTextContent(el.engineOnlineStatus, status === "Online" ? "Online" : status === "Offline" ? "Offline" : "Sincronizando");
  setTextContent(el.summaryEngineStatus, status === "Online" ? "Online" : status === "Offline" ? "Offline" : "Sincronizando");

  el.connectionBadge.classList.remove("online", "offline", "connecting", "reconnecting");

  if (status === "Online") {
    el.connectionBadge.classList.add("online");
  } else if (status === "Offline") {
    el.connectionBadge.classList.add("offline");
  } else {
    el.connectionBadge.classList.add("connecting");
  }
}

function startClock() {
  const tick = () => {
    if (el.liveClock) {
      el.liveClock.textContent = new Date().toLocaleTimeString("pt-BR");
    }
  };

  tick();
  setInterval(tick, 1000);
}

function startChartLoop() {
  if (state.chartTimer) {
    clearInterval(state.chartTimer);
    state.chartTimer = null;
  }
}

function startAIEngine() {
  if (state.aiTimer) clearInterval(state.aiTimer);

  state.aiTimer = setInterval(() => {
    if (!state.isDocumentVisible) return;
    rotateAIState();
  }, 2800);
}

async function loadRuntimeIntegrations() {
  if (!state.accessToken) return;

  const [dashboardResult, runtimeResult, premiumResult] = await Promise.allSettled([
    apiFetch("/api/dashboard"),
    apiFetch("/api/runtime/state"),
    apiFetch("/api/premium/status")
  ]);

  const parseJson = async (result) => {
    if (result.status !== "fulfilled") return null;
    return result.value.json().catch(() => null);
  };

  const [dashboardData, runtimeData, premiumData] = await Promise.all([
    parseJson(dashboardResult),
    parseJson(runtimeResult),
    parseJson(premiumResult)
  ]);

  state.dashboardSnapshot = dashboardData?.data || null;
  state.engineSnapshot = runtimeData?.data || null;
  state.premiumSnapshot = premiumData?.data || premiumData || null;

  syncRuntimeDashboard(dashboardData);

  const runtimeState = state.engineSnapshot || state.dashboardSnapshot || {};
  const runtimeSignal = runtimeState.lastSignal || runtimeState.currentSignal || runtimeState.bestOpportunity || null;
  updateInstitutionalCards(runtimeSignal || {});
  updateRealtimeMetrics(runtimeSignal || {});
  updateCompactOperations(runtimeSignal || {}, "runtime");

  if (runtimeSignal) {
    renderShadowMode(runtimeSignal, "runtime");
  } else {
    renderShadowMode(null, "runtime");
  }
}

async function bootPanel() {
  applyUserUI();
  applyPlanLocks();
  applyModeUI(state.currentMode, false);
  ensureInstitutionalCenter();
  ensureShadowModePanel();
  ensureFilterPerformancePanel();
  updateInstitutionalCards();
  updateRealtimeMetrics();
  updateOperationalMonitor({});
  renderOperationalHeatmap();
  renderAIInsights();
  drawEquityCurve();
  pushTimelineEvent("Centro de Operações IA sincronizado.");
  if (!state.proLogs.length) {
    renderProLogs({}, "Centro Institucional sincronizado com a engine.");
  }
  startChartLoop();
  startAIEngine();

  if (state.filterAnalyticsTimer) clearInterval(state.filterAnalyticsTimer);
  state.filterAnalyticsTimer = setInterval(() => {
    if (state.accessToken) loadFilterAnalytics();
  }, 30000);

  if (state.performanceDashboardTimer) clearInterval(state.performanceDashboardTimer);
  state.performanceDashboardTimer = setInterval(() => {
    if (state.accessToken && state.isDocumentVisible) loadPerformanceDashboard();
  }, 15000);

  await Promise.allSettled([
    loadHistory(),
    loadStats(),
    loadRuntimeIntegrations(),
    loadFilterAnalytics(),
    loadPerformanceDashboard()
  ]);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value) {
  if (!value) return "--";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleTimeString("pt-BR");
}

if (el.loginForm) {
  el.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = el.loginUser?.value?.trim();
    const password = el.loginPass?.value?.trim();

    if (!email || !password) {
      showAuthFeedback("Informe e-mail e senha.", "error");
      return;
    }

    try {
      setLoginLoading(true);
      showAuthFeedback("");
      await login(email, password);
    } catch (error) {
      showAuthFeedback(error.message || "Erro ao entrar.", "error");
    } finally {
      setLoginLoading(false);
    }
  });
}

if (el.logoutBtn) {
  el.logoutBtn.addEventListener("click", logout);
}

if (el.menuToggle) {
  el.menuToggle.addEventListener("click", () => {
    const opened = document.body.classList.toggle("sidebar-open");
    document.body.classList.toggle("sidebar-collapsed", !opened);
    el.menuToggle.setAttribute("aria-expanded", String(opened));
  });
}

if (el.sidebarBackdrop) {
  el.sidebarBackdrop.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    document.body.classList.add("sidebar-collapsed");
    if (el.menuToggle) el.menuToggle.setAttribute("aria-expanded", "false");
  });
}

if (el.upgradeBtn) {
  el.upgradeBtn.addEventListener("click", async () => {
    try {
      const response = await apiFetch("/api/billing/create-checkout", {
        method: "POST"
      });

      const data = await response.json().catch(() => null);

      const url = data?.url || data?.data?.url || data?.checkoutUrl || data?.data?.checkoutUrl;

      if (url) {
        window.location.href = url;
        return;
      }

      showToast(data?.message || "Checkout ainda não configurado.", "info");
    } catch (error) {
      showToast("Erro ao iniciar checkout.", "error");
    }
  });
}

function resetHistoryPageAndLoad() {
  state.historyPagination.page = 1;
  loadHistory();
}

function setupDashboardTabs() {
  const tabs = Array.from(document.querySelectorAll(".dashboard-tab"));
  const panels = Array.from(document.querySelectorAll(".dashboard-tab-panel"));

  if (!tabs.length || !panels.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;

      tabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-selected", String(isActive));
      });

      panels.forEach((panel) => {
        const isActive = panel.dataset.tabPanel === target;
        panel.classList.toggle("active", isActive);
        panel.hidden = !isActive;
      });

      if (target === "history") scheduleHistoryRender();
      if (target === "technical") {
        renderOperationalHeatmap();
        renderAIInsights();
      }
    });
  });
}

function setupHistoryControls() {
  const filterBindings = [
    [el.historyFilterSymbol, "symbol", "input"],
    [el.historyFilterStrategy, "strategy", "input"],
    [el.historyFilterResult, "result", "change"]
  ];

  const debouncedReload = debounce(resetHistoryPageAndLoad, 260);

  filterBindings.forEach(([node, key, eventName]) => {
    if (!node) return;
    node.value = state.historyFilters[key] || "";
    node.addEventListener(eventName, () => {
      state.historyFilters[key] = node.value;
      if (eventName === "input") debouncedReload();
      else resetHistoryPageAndLoad();
    });
  });

  if (el.historyPrev) {
    el.historyPrev.addEventListener("click", () => {
      state.historyPagination.page = Math.max(1, state.historyPagination.page - 1);
      loadHistory();
    });
  }

  if (el.historyNext) {
    el.historyNext.addEventListener("click", () => {
      state.historyPagination.page += 1;
      loadHistory();
    });
  }
}


const handleBestOpportunity = throttle((signal) => {
  if (!signal) return;
  renderShadowMode(signal, "bestOpportunity");
  updateCompactOperations(signal, "bestOpportunity");
  renderSignal(signal);
  updateInstitutionalCards(signal);
  updateRealtimeMetrics(signal);
}, 260);

const handleEngineUpdate = throttle((payload) => {
  syncRuntimeDashboard(payload);
}, 360);

const handleExecutionUpdate = throttle((payload) => {
  if (!payload) return;
  renderShadowMode({
    ...payload,
    symbol: payload.symbol || payload.asset || "ENGINE",
    signal: payload.allowed === false ? "WAIT" : payload.signal,
    direction: payload.allowed === false ? "WAIT" : payload.direction,
    blocked: payload.allowed === false,
    blockReason: payload.reason,
    finalScore: payload.adjustedScore || payload.finalScore || payload.score || 0,
    timestamp: new Date().toISOString()
  }, "execution");

  updateCompactOperations({
    ...payload,
    blocked: payload.allowed === false,
    blockReason: payload.reason,
    direction: payload.allowed === false ? "WAIT" : payload.direction,
    signal: payload.allowed === false ? "WAIT" : payload.signal
  }, "execution");

  if (payload.allowed === false) {
    loadFilterAnalytics();
  }

  loadPerformanceDashboard();
}, 420);

socket.on("connect", () => {
  setConnection("Online");
  updateInstitutionalCards();
  renderShadowMode(null, "connect");
  renderProLogs({}, "Socket.IO conectado ao barramento em tempo real.");
  pushTimelineEvent("Socket.IO conectado ao barramento em tempo real.");

  if (state.accessToken) {
    bootPanel();
  }
});

socket.on("disconnect", () => {
  setConnection("Offline");
  const saasStatus = document.getElementById("saasStatus");
  const saasStatusCard = document.getElementById("saasStatusCard");
  if (saasStatus) saasStatus.textContent = "SaaS reconectando";
  if (saasStatusCard) saasStatusCard.textContent = "Reconectando";
  renderShadowMode(null, "disconnect");
  renderProLogs({}, "Socket.IO desconectado; camada visual em modo de proteção.");
  pushTimelineEvent("Socket.IO desconectado; modo de proteção visual ativo.");
});

socket.on("connect_error", () => {
  setConnection("Reconectando");
});

socket.on("signal", (signal) => {
  renderShadowMode(signal, "signal");
  updateCompactOperations(signal, "signal");

  renderSignal(signal);

  if (isConfirmedOperationalSignal(signal) && signalMatchesHistoryFilters(signal)) {
    state.history.unshift(signal);
    state.history = state.history.slice(0, MAX_HISTORY_ITEMS);
    state.historyPagination.total += 1;
    state.historyPagination.hasMore = state.history.length >= state.historyPagination.limit;
  }
  scheduleHistoryRender();
  scheduleEquityDraw();
});

socket.on("signal-result-updated", (signal) => {
  renderShadowMode(signal, "result");

  const index = state.history.findIndex((item) => item.id === signal.id);

  if (index !== -1) {
    if (isConfirmedOperationalSignal(signal) && signalMatchesHistoryFilters(signal)) {
      state.history[index] = signal;
    } else {
      state.history.splice(index, 1);
      state.historyPagination.total = Math.max(0, state.historyPagination.total - 1);
    }
    scheduleHistoryRender();
    scheduleEquityDraw();
    loadStats();
    loadFilterAnalytics();
    loadPerformanceDashboard();
  }
});

socket.on("bestOpportunity", handleBestOpportunity);

socket.on("engine:update", handleEngineUpdate);

socket.on("history", (signals) => {
  const confirmed = filterConfirmedOperationalSignals(normalizeSignalCollection(signals));
  if (!confirmed.length) return;

  state.history = confirmed.slice(0, MAX_HISTORY_ITEMS);
  scheduleHistoryRender();
  scheduleEquityDraw();
  loadStats();
  loadPerformanceDashboard();
});

socket.on("execution", handleExecutionUpdate);

socket.on("filter-analytics:update", (payload) => {
  const analytics = payload?.data || payload;
  if (analytics && typeof analytics === "object") {
    state.filterAnalytics = analytics;
    renderFilterAnalytics(analytics);
  } else {
    loadFilterAnalytics();
  }
});

window.setResult = setResult;

document.addEventListener("visibilitychange", () => {
  state.isDocumentVisible = document.visibilityState === "visible";
  document.body.classList.toggle("realtime-paused", !state.isDocumentVisible);

  if (state.isDocumentVisible) {
    drawEquityCurve();
    renderOperationalHeatmap();
    if (state.accessToken) loadPerformanceDashboard();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  ensureInstitutionalCenter();
  ensureShadowModePanel();
  ensureFilterPerformancePanel();
  updateRealtimeMetrics();
  renderOperationalHeatmap();
  renderAIInsights();
  drawEquityCurve();
  startChartLoop();
  startAIEngine();
  setupModeSwitcher();
  setupDashboardTabs();
  setupHistoryControls();
  setConnection("Conectando");

  const validSession = await checkSession();

  if (validSession) {
    await bootPanel();
  }
});
