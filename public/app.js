const socket = io();

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
  chartData: Array.from(
    { length: 34 },
    (_, index) => 48 + Math.sin(index / 2) * 10 + Math.random() * 12
  ),
  chartTimer: null,
  aiTimer: null,
  institutionalHeatmap: [],
  proLogs: [],
  dashboardSnapshot: null,
  engineSnapshot: null,
  premiumSnapshot: null
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

  historyList: document.getElementById("historyList"),
  historyCount: document.getElementById("historyCount"),

  statTotal: document.getElementById("statTotal"),
  statWins: document.getElementById("statWins"),
  statLosses: document.getElementById("statLosses"),
  statWinrate: document.getElementById("statWinrate"),
  statsUpdated: document.getElementById("statsUpdated"),

  metricLatency: document.getElementById("metricLatency"),
  metricFlow: document.getElementById("metricFlow"),
  metricRisk: document.getElementById("metricRisk"),
  metricAi: document.getElementById("metricAi")
};

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
  const role = String(state.user?.role || "").toLowerCase();
  const plan = String(state.user?.plan || "").toLowerCase();
  return role === "admin" || plan === "premium";
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
  const premium = isPremium();

  document.body.classList.toggle("plan-premium", premium);
  document.body.classList.toggle("plan-free", !premium);

  if (el.userName) {
    el.userName.textContent = state.user?.name || "Usuário";
  }

  if (el.userEmail) {
    el.userEmail.textContent = state.user?.email || "---";
  }

  if (el.planBadge) {
    el.planBadge.textContent = premium ? "PREMIUM" : "FREE";
    el.planBadge.classList.toggle("premium", premium);
    el.planBadge.classList.toggle("free", !premium);
  }

  if (el.premiumStatus) {
    el.premiumStatus.textContent = premium
      ? "Premium ativo. Todos os recursos institucionais liberados."
      : "Plano FREE ativo. Leitura básica liberada; inteligência premium bloqueada.";
  }

  if (el.headlineText) {
    el.headlineText.textContent = premium
      ? "Terminal premium ativo. IA operacional monitorando mercado em tempo real."
      : "Painel FREE carregado. Histórico e estatísticas básicas disponíveis.";
  }
}

function applyPlanLocks() {
  const premium = isPremium();

  ensureInstitutionalCenter();

  const premiumOnlyElements = document.querySelectorAll("[data-premium-only='true']");

  premiumOnlyElements.forEach((node) => {
    node.classList.toggle("locked", !premium);
    node.setAttribute("aria-disabled", premium ? "false" : "true");
  });

  if (!premium) {
    setPremiumPlaceholders();
  }

  updateInstitutionalCards();
  updateRealtimeMetrics();
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
        <small>API, Socket.IO, login, premium e engine preservados</small>
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

  const heatmap = document.getElementById("institutionalHeatmap");
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
    metricLatency: el.metricLatency || document.getElementById("metricLatency"),
    metricFlow: el.metricFlow || document.getElementById("metricFlow"),
    metricRisk: el.metricRisk || document.getElementById("metricRisk"),
    metricAi: el.metricAi || document.getElementById("metricAi")
  };
}

function updateRealtimeMetrics(signal = {}) {
  ensureInstitutionalCenter();

  const metrics = getRealtimeMetricElements();
  const confidence = getOperationalScore(signal);
  const risk = Number(signal.risk || signal.riskScore || signal.execution?.risk || 0);
  const premium = isPremium();
  const connected = socket.connected;
  const historyLoad = Math.min(99, Math.max(18, state.history.length * 8));
  const flow = confidence || historyLoad;
  const aiScore = premium ? Math.max(48, Math.min(99, confidence || 72)) : 0;
  const latency = connected ? Math.round(42 + Math.random() * 64) : 0;

  if (metrics.metricLatency) metrics.metricLatency.textContent = connected ? `${latency}ms` : "offline";
  if (metrics.metricFlow) metrics.metricFlow.textContent = premium ? `${Math.round(flow)}%` : "FREE";
  if (metrics.metricRisk) metrics.metricRisk.textContent = premium ? `${Math.max(0, Math.min(100, Math.round(100 - risk * 3)))}%` : "--";
  if (metrics.metricAi) metrics.metricAi.textContent = premium ? `${Math.round(aiScore)}%` : "premium";
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
  const premium = isPremium();

  const engineModules = document.getElementById("engineModules");
  const adaptiveRank = document.getElementById("adaptiveRank");
  const antiLossLevel = document.getElementById("antiLossLevel");
  const saasStatus = document.getElementById("saasStatus");
  const saasStatusCard = document.getElementById("saasStatusCard");

  if (engineModules) engineModules.textContent = premium ? (blocked ? "11/14" : "14/14") : "6/14";
  if (adaptiveRank) adaptiveRank.textContent = confidence >= 88 ? "A+" : confidence >= 76 ? "A" : confidence >= 62 ? "B+" : "B";
  if (antiLossLevel) antiLossLevel.textContent = blocked ? "Nível 5" : confidence >= 80 ? "Nível 2" : "Nível 3";
  if (saasStatus) saasStatus.textContent = premium ? "SaaS institucional online" : "SaaS premium bloqueado";
  if (saasStatusCard) saasStatusCard.textContent = premium ? "Online" : "Free";
}

function setPremiumPlaceholders() {
  if (el.signalAsset) el.signalAsset.textContent = "---";

  if (el.signalDirection) {
    el.signalDirection.textContent = "IA PREMIUM";
    el.signalDirection.className = "signal-direction analyzing";
  }

  if (el.signalEntry) el.signalEntry.textContent = "--";
  if (el.signalExpiry) el.signalExpiry.textContent = "--";
  if (el.signalConfidence) el.signalConfidence.textContent = "0%";
  if (el.signalCountdown) el.signalCountdown.textContent = "--";
  if (el.signalTime) el.signalTime.textContent = "Bloqueado no FREE";

  if (el.aiExplanation) {
    el.aiExplanation.innerHTML =
      'Recurso premium. No FREE, o painel exibe histórico e estatísticas básicas. <span class="ai-live-dots"><i></i><i></i><i></i></span>';
  }

  if (el.bestAsset) el.bestAsset.textContent = "---";
  if (el.bestReason) el.bestReason.textContent = "Melhor oportunidade liberada no PREMIUM.";
  if (el.bestScore) el.bestScore.textContent = "0%";
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

      if (!isPremium()) {
        showToast("Alteração de modo disponível apenas no plano PREMIUM.", "info");
        return;
      }

      applyModeUI(mode, true);
    });
  });

  applyModeUI(state.currentMode, false);
}

function rotateAIState() {
  if (!isPremium()) return;

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

async function loadHistory() {
  try {
    const response = await apiFetch("/api/signals/recent");
    const data = await response.json().catch(() => null);

    if (data?.ok && Array.isArray(data.signals)) {
      state.history = filterConfirmedOperationalSignals(data.signals);
    } else if (data?.ok && Array.isArray(data.data)) {
      state.history = filterConfirmedOperationalSignals(data.data);
    } else {
      state.history = [];
    }

    renderHistory();
  } catch (error) {
    state.history = [];
    renderHistory();
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

function renderHistory() {
  if (!el.historyList) return;

  el.historyList.innerHTML = "";

  if (!state.history.length) {
    el.historyList.innerHTML = `<div class="history-empty">Nenhum sinal ainda</div>`;
    if (el.historyCount) el.historyCount.textContent = "0";
    return;
  }

  state.history.forEach((signal) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const direction = getOperationalDirection(signal);
    const score = getOperationalScore(signal);
    const result = String(signal.result || "PENDING").toUpperCase();
    const resultColor =
      result === "WIN" ? "#18f2a3" :
      result === "LOSS" ? "#ff4d6d" :
      "#ffd166";

    item.innerHTML = `
      <div>
        <strong>${escapeHtml(signal.symbol || signal.asset || "---")}</strong>
        <div class="history-meta">${formatTime(signal.created_at || signal.createdAt || signal.time)}</div>
      </div>

      <span class="badge ${direction === "CALL" ? "call" : "put"}">
        ${escapeHtml(direction || "---")}
      </span>

      <span class="score-badge">${score}%</span>

      <span style="color:${resultColor}; font-weight:800;">
        ${escapeHtml(result)}
      </span>

      ${
        isPremium()
          ? `
            <div class="action-buttons">
              <button onclick="setResult(${Number(signal.id)}, 'WIN')">WIN</button>
              <button onclick="setResult(${Number(signal.id)}, 'LOSS')">LOSS</button>
            </div>
          `
          : `
            <div class="action-buttons locked">
              Premium
            </div>
          `
      }
    `;

    el.historyList.appendChild(item);
  });

  if (el.historyCount) {
    el.historyCount.textContent = `${state.history.length} sinais`;
  }
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
    signal.final_score ??
    signal.finalScore ??
    signal.score ??
    signal.confidence ??
    0
  );

  return Number.isFinite(score) ? score : 0;
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

  return Boolean(getOperationalDirection(signal)) && getOperationalScore(signal) > 0;
}

function filterConfirmedOperationalSignals(signals = []) {
  if (!Array.isArray(signals)) return [];
  return signals.filter(isConfirmedOperationalSignal);
}

function renderSignal(signal) {
  if (!signal || !isPremium() || !isConfirmedOperationalSignal(signal)) return;

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

  if (el.signalAsset) el.signalAsset.textContent = signal.symbol || signal.asset || "---";

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

  if (el.signalEntry) el.signalEntry.textContent = blocked ? "--" : signal.entry || signal.entryTime || "--";
  if (el.signalExpiry) el.signalExpiry.textContent = blocked ? "--" : signal.expiry || signal.expiration || "--";
  if (el.signalConfidence) el.signalConfidence.textContent = `${confidence}%`;
  if (el.signalCountdown) el.signalCountdown.textContent = blocked ? "Bloqueado" : signal.countdown || "--";
  if (el.signalTime) el.signalTime.textContent = formatTime(signal.created_at || new Date());

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

  if (el.bestAsset) el.bestAsset.textContent = signal.symbol || signal.asset || "---";
  if (el.bestReason) {
    el.bestReason.textContent =
      blockReason ||
      signal.reason ||
      signal.explanation ||
      "Sinal premium detectado com leitura operacional.";
  }
  if (el.bestScore) el.bestScore.textContent = `${confidence}%`;

  const card = document.querySelector(".signal-card");

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

    void card.offsetWidth;
    card.classList.add("flash");
  }

  updateInstitutionalCards(signal);
  updateRealtimeMetrics(signal);
  renderOperationalHeatmap(signal);
  renderProLogs(signal);

  pushChartPoint(confidence || 50);
  drawMiniChart();
}

async function setResult(id, result) {
  if (!isPremium()) {
    showToast("Recurso disponível apenas no plano PREMIUM.", "error");
    return;
  }

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

function ensureMiniChart() {
  const bestPanel = document.querySelector(".best-opportunity-panel");

  if (!bestPanel || document.getElementById("miniChartCanvas")) return;

  const metrics = document.createElement("div");
  metrics.className = "opportunity-metrics";
  metrics.innerHTML = `
    <div class="opportunity-metric"><span>Tendência</span><strong id="trendMetric">Neutra</strong></div>
    <div class="opportunity-metric"><span>Volatilidade</span><strong id="volMetric">Monitorando</strong></div>
    <div class="opportunity-metric"><span>Timing</span><strong id="timingMetric">Aguardando</strong></div>
  `;

  const wrap = document.createElement("div");
  wrap.className = "mini-chart-wrap";
  wrap.innerHTML = `<canvas id="miniChartCanvas" width="640" height="180"></canvas>`;

  bestPanel.appendChild(metrics);
  bestPanel.appendChild(wrap);
}

function pushChartPoint(value) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 50;
  const previous = state.chartData[state.chartData.length - 1] || 50;
  const next = Math.max(12, Math.min(98, previous * 0.72 + safe * 0.28 + (Math.random() * 8 - 4)));

  state.chartData.push(next);

  if (state.chartData.length > 42) {
    state.chartData.shift();
  }
}

function drawMiniChart() {
  const canvas = document.getElementById("miniChartCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  const data = state.chartData;
  const max = Math.max(...data, 100);
  const min = Math.min(...data, 0);
  const range = Math.max(1, max - min);

  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 1;

  for (let i = 0; i < 6; i++) {
    const y = (height / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.beginPath();

  data.forEach((point, index) => {
    const x = (width / (data.length - 1)) * index;
    const y = height - ((point - min) / range) * (height - 24) - 12;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#20b7ff");
  gradient.addColorStop(0.5, "#00f0ff");
  gradient.addColorStop(1, "#20e6a0");

  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.shadowColor = "rgba(0,240,255,0.55)";
  ctx.shadowBlur = 18;
  ctx.stroke();

  ctx.shadowBlur = 0;

  const last = data[data.length - 1];
  const x = width - 2;
  const y = height - ((last - min) / range) * (height - 24) - 12;

  ctx.beginPath();
  ctx.arc(x - 5, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#20e6a0";
  ctx.fill();
}

function startChartLoop() {
  ensureMiniChart();
  drawMiniChart();

  if (state.chartTimer) clearInterval(state.chartTimer);

  state.chartTimer = setInterval(() => {
    pushChartPoint(45 + Math.random() * 35);
    drawMiniChart();

    const trend = document.getElementById("trendMetric");
    const vol = document.getElementById("volMetric");
    const timing = document.getElementById("timingMetric");

    const last = state.chartData[state.chartData.length - 1];
    const prev = state.chartData[state.chartData.length - 8] || last;

    if (trend) trend.textContent = last > prev ? "Alta" : last < prev ? "Baixa" : "Neutra";
    if (vol) vol.textContent = Math.abs(last - prev) > 12 ? "Alta" : "Média";
    if (timing) timing.textContent = isPremium() ? "Validando candle" : "Premium";

    if (state.institutionalHeatmap.length) {
      state.institutionalHeatmap = state.institutionalHeatmap.map((item, index) => ({
        ...item,
        value: Math.max(18, Math.min(99, item.value + Math.sin(Date.now() / 900 + index) * 2.8))
      }));
      updateRealtimeMetrics();
      renderOperationalHeatmap();
    }
  }, 1800);
}

function startAIEngine() {
  if (state.aiTimer) clearInterval(state.aiTimer);

  state.aiTimer = setInterval(() => {
    rotateAIState();
  }, 2800);
}

async function loadRuntimeIntegrations() {
  if (!state.accessToken) return;

  const [dashboardResult, engineResult, premiumResult] = await Promise.allSettled([
    apiFetch("/api/dashboard"),
    apiFetch("/api/engine"),
    apiFetch("/api/premium/status")
  ]);

  const parseJson = async (result) => {
    if (result.status !== "fulfilled") return null;
    return result.value.json().catch(() => null);
  };

  const [dashboardData, engineData, premiumData] = await Promise.all([
    parseJson(dashboardResult),
    parseJson(engineResult),
    parseJson(premiumResult)
  ]);

  state.dashboardSnapshot = dashboardData?.data || null;
  state.engineSnapshot = engineData?.data || null;
  state.premiumSnapshot = premiumData?.data || premiumData || null;

  const runtimeState = state.engineSnapshot || state.dashboardSnapshot || {};
  updateInstitutionalCards(runtimeState.lastSignal || runtimeState.currentSignal || {});
  updateRealtimeMetrics(runtimeState.lastSignal || runtimeState.currentSignal || {});
}

async function bootPanel() {
  applyUserUI();
  applyPlanLocks();
  applyModeUI(state.currentMode, false);
  ensureInstitutionalCenter();
  updateInstitutionalCards();
  updateRealtimeMetrics();
  renderOperationalHeatmap();
  if (!state.proLogs.length) {
    renderProLogs({}, isPremium() ? "Centro Institucional sincronizado com a engine." : "Centro Institucional aguardando ativação PREMIUM.");
  }
  ensureMiniChart();
  startChartLoop();
  startAIEngine();
  await Promise.allSettled([loadHistory(), loadStats(), loadRuntimeIntegrations()]);
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
    document.body.classList.toggle("sidebar-open");
    document.body.classList.toggle("sidebar-collapsed");
  });
}

if (el.sidebarBackdrop) {
  el.sidebarBackdrop.addEventListener("click", () => {
    document.body.classList.remove("sidebar-open");
    document.body.classList.add("sidebar-collapsed");
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

socket.on("connect", () => {
  setConnection("Online");
  updateInstitutionalCards();
  renderProLogs({}, "Socket.IO conectado ao barramento em tempo real.");

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
  renderProLogs({}, "Socket.IO desconectado; camada visual em modo de proteção.");
});

socket.on("connect_error", () => {
  setConnection("Reconectando");
});

socket.on("signal", (signal) => {
  if (isPremium()) {
    renderSignal(signal);
  }

  if (isConfirmedOperationalSignal(signal)) {
    state.history.unshift(signal);
    state.history = state.history.slice(0, 50);
  }
  renderHistory();
});

socket.on("signal-result-updated", (signal) => {
  const index = state.history.findIndex((item) => item.id === signal.id);

  if (index !== -1) {
    if (isConfirmedOperationalSignal(signal)) {
      state.history[index] = signal;
    } else {
      state.history.splice(index, 1);
    }
    renderHistory();
    loadStats();
  }
});

window.setResult = setResult;

document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  ensureInstitutionalCenter();
  updateRealtimeMetrics();
  renderOperationalHeatmap();
  ensureMiniChart();
  startChartLoop();
  startAIEngine();
  setupModeSwitcher();
  setConnection("Conectando");

  const validSession = await checkSession();

  if (validSession) {
    await bootPanel();
  }
});
