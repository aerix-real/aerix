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
  refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken)
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
  statsUpdated: document.getElementById("statsUpdated")
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
  } catch (_) {
    // logout local mesmo se servidor falhar
  }

  clearSession();
  renderHistory();
  setLoginVisible(true);
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
      ? "Premium ativo. Todos os recursos liberados."
      : "Plano FREE ativo. Recursos premium bloqueados.";
  }

  if (el.headlineText) {
    el.headlineText.textContent = premium
      ? "Painel premium ativo com recursos institucionais liberados."
      : "Painel FREE carregado. Histórico e estatísticas básicas liberados.";
  }
}

function applyPlanLocks() {
  const premium = isPremium();
  const premiumOnlyElements = document.querySelectorAll("[data-premium-only='true']");

  premiumOnlyElements.forEach((node) => {
    node.classList.toggle("locked", !premium);
    node.setAttribute("aria-disabled", premium ? "false" : "true");
  });

  if (!premium) {
    setPremiumPlaceholders();
  }
}

function setPremiumPlaceholders() {
  if (el.signalAsset) el.signalAsset.textContent = "---";
  if (el.signalDirection) {
    el.signalDirection.textContent = "PREMIUM";
    el.signalDirection.className = "signal-direction neutral";
  }
  if (el.signalEntry) el.signalEntry.textContent = "--";
  if (el.signalExpiry) el.signalExpiry.textContent = "--";
  if (el.signalConfidence) el.signalConfidence.textContent = "0%";
  if (el.signalCountdown) el.signalCountdown.textContent = "--";
  if (el.signalTime) el.signalTime.textContent = "Bloqueado no FREE";
  if (el.aiExplanation) {
    el.aiExplanation.textContent =
      "Recurso premium. No plano FREE, o painel carrega parcialmente com histórico e estatísticas básicas.";
  }
  if (el.bestAsset) el.bestAsset.textContent = "---";
  if (el.bestReason) el.bestReason.textContent = "Melhor oportunidade disponível no PREMIUM.";
  if (el.bestScore) el.bestScore.textContent = "0%";
}

async function loadHistory() {
  try {
    const response = await apiFetch("/api/signals/recent");
    const data = await response.json().catch(() => null);

    if (data?.ok && Array.isArray(data.signals)) {
      state.history = data.signals;
    } else if (data?.ok && Array.isArray(data.data)) {
      state.history = data.data;
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

    const result = signal.result || "PENDING";
    const resultColor =
      result === "WIN" ? "#18f2a3" :
      result === "LOSS" ? "#ff4d6d" :
      "#ffd166";

    item.innerHTML = `
      <div>
        <strong>${escapeHtml(signal.symbol || signal.asset || "---")}</strong>
        <div class="history-meta">${formatTime(signal.created_at || signal.createdAt || signal.time)}</div>
      </div>

      <span class="badge ${signal.direction === "CALL" ? "call" : "put"}">
        ${escapeHtml(signal.direction || "---")}
      </span>

      <span class="score-badge">${Number(signal.confidence || signal.score || 0)}%</span>

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

function renderSignal(signal) {
  if (!signal || !isPremium()) return;

  const direction = String(signal.direction || "").toUpperCase();
  const confidence = Number(signal.confidence || signal.score || 0);

  if (el.signalAsset) el.signalAsset.textContent = signal.symbol || signal.asset || "---";

  if (el.signalDirection) {
    el.signalDirection.textContent = direction || "AGUARDANDO";
    el.signalDirection.className = "signal-direction neutral";

    if (direction === "CALL" || direction === "BUY") {
      el.signalDirection.classList.add("buy");
    } else if (direction === "PUT" || direction === "SELL") {
      el.signalDirection.classList.add("sell");
    } else {
      el.signalDirection.classList.add("neutral");
    }
  }

  if (el.signalEntry) el.signalEntry.textContent = signal.entry || signal.entryTime || "--";
  if (el.signalExpiry) el.signalExpiry.textContent = signal.expiry || signal.expiration || "--";
  if (el.signalConfidence) el.signalConfidence.textContent = `${confidence}%`;
  if (el.signalCountdown) el.signalCountdown.textContent = signal.countdown || "--";
  if (el.signalTime) el.signalTime.textContent = formatTime(signal.created_at || new Date());
  if (el.aiExplanation) {
    el.aiExplanation.textContent =
      signal.explanation ||
      signal.aiExplanation ||
      "IA analisando confluência, tendência, timing e qualidade do candle.";
  }

  if (el.bestAsset) el.bestAsset.textContent = signal.symbol || signal.asset || "---";
  if (el.bestReason) {
    el.bestReason.textContent =
      signal.reason ||
      signal.explanation ||
      "Sinal premium detectado com leitura operacional.";
  }
  if (el.bestScore) el.bestScore.textContent = `${confidence}%`;
}

async function setResult(id, result) {
  if (!isPremium()) {
    alert("Recurso disponível apenas no plano PREMIUM.");
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
      alert(data?.message || "Não foi possível atualizar o resultado.");
    }
  } catch (error) {
    alert("Erro ao atualizar resultado.");
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

async function bootPanel() {
  applyUserUI();
  applyPlanLocks();
  await Promise.allSettled([loadHistory(), loadStats()]);
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

      alert(data?.message || "Checkout ainda não configurado.");
    } catch (error) {
      alert("Erro ao iniciar checkout.");
    }
  });
}

socket.on("connect", () => {
  setConnection("Online");

  if (state.accessToken) {
    bootPanel();
  }
});

socket.on("disconnect", () => {
  setConnection("Offline");
});

socket.on("connect_error", () => {
  setConnection("Reconectando");
});

socket.on("signal", (signal) => {
  if (isPremium()) {
    renderSignal(signal);
  }

  state.history.unshift(signal);
  state.history = state.history.slice(0, 50);
  renderHistory();
});

socket.on("signal-result-updated", (signal) => {
  const index = state.history.findIndex((item) => item.id === signal.id);

  if (index !== -1) {
    state.history[index] = signal;
    renderHistory();
    loadStats();
  }
});

window.setResult = setResult;

document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  setConnection("Conectando");

  const validSession = await checkSession();

  if (validSession) {
    await bootPanel();
  }
});