// =========================
// 🔐 AUTH
// =========================

function getToken() {
  return localStorage.getItem("aerix_token");
}

function getHeaders() {
  const token = getToken();

  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : ""
  };
}

function logout() {
  localStorage.removeItem("aerix_token");
  localStorage.removeItem("aerix_user");
  location.reload();
}

// =========================
// 🧩 UI HELPERS
// =========================

function $(id) {
  return document.getElementById(id);
}

function safeText(id, value) {
  const el = $(id);
  if (el) el.innerText = value;
}

function showAuthFeedback(message, type = "error") {
  const el = $("authFeedback");
  if (!el) {
    alert(message);
    return;
  }

  el.className = `auth-feedback ${type}`;
  el.innerText = message;
}

function clearAuthFeedback() {
  const el = $("authFeedback");
  if (!el) return;

  el.className = "auth-feedback hidden";
  el.innerText = "";
}

function setConnection(status) {
  const badge = $("connectionBadge");
  const text = $("connectionText");

  if (badge) badge.className = "connection-badge " + status;

  const map = {
    online: "Conectado",
    offline: "Offline",
    connecting: "Conectando",
    reconnecting: "Reconectando"
  };

  if (text) text.innerText = map[status] || "Conectando";
}

function setPlanUI(plan) {
  const normalized = String(plan || "free").toLowerCase();
  const badge = $("userPlan");

  document.body.classList.toggle("plan-premium", normalized === "premium");
  document.body.classList.toggle("plan-free", normalized !== "premium");

  if (badge) {
    badge.innerText = normalized === "premium" ? "PREMIUM" : "FREE";
    badge.className = normalized === "premium" ? "plan-badge premium" : "plan-badge free";
  }

  const premiumStatus = $("premiumStatus");
  if (premiumStatus) {
    premiumStatus.innerText =
      normalized === "premium"
        ? "Plano premium ativo"
        : "Plano free ativo";
  }

  document.querySelectorAll("[data-premium='true']").forEach((el) => {
    el.classList.toggle("locked", normalized !== "premium");
  });

  document.querySelectorAll("[data-free-only='true']").forEach((el) => {
    el.classList.toggle("hidden-by-plan", normalized === "premium");
  });
}

function updateClock() {
  safeText("liveClock", new Date().toLocaleTimeString("pt-BR"));
}

setInterval(updateClock, 1000);

// =========================
// 🔥 AUTH TABS
// =========================

function showLogin() {
  clearAuthFeedback();

  $("loginForm")?.classList.remove("hidden");
  $("registerForm")?.classList.add("hidden");

  $("tabLogin")?.classList.add("active");
  $("tabRegister")?.classList.remove("active");
}

function showRegister() {
  clearAuthFeedback();

  $("registerForm")?.classList.remove("hidden");
  $("loginForm")?.classList.add("hidden");

  $("tabRegister")?.classList.add("active");
  $("tabLogin")?.classList.remove("active");
}

function setupAuthTabs() {
  $("tabLogin")?.addEventListener("click", showLogin);
  $("tabRegister")?.addEventListener("click", showRegister);
  $("showRegisterBtn")?.addEventListener("click", showRegister);
  $("showLoginBtn")?.addEventListener("click", showLogin);
}

// =========================
// 🔥 LOGIN / REGISTER
// =========================

function saveSession(data) {
  if (!data) return;

  const token = data.accessToken || data.token;
  const user = data.user;

  if (token) localStorage.setItem("aerix_token", token);
  if (user) localStorage.setItem("aerix_user", JSON.stringify(user));
}

function setupLogin() {
  const form = $("loginForm");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthFeedback();

    const email = $("loginUser")?.value?.trim();
    const password = $("loginPass")?.value?.trim();

    if (!email || !password) {
      showAuthFeedback("Informe e-mail e senha.");
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        showAuthFeedback(json?.message || "Erro ao entrar.");
        return;
      }

      saveSession(json.data);

      $("loginOverlay")?.classList.add("hidden");
      location.reload();
    } catch (error) {
      showAuthFeedback("Erro ao conectar com o servidor.");
    }
  });
}

function setupRegister() {
  const form = $("registerForm");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAuthFeedback();

    const name = $("registerName")?.value?.trim();
    const email = $("registerUser")?.value?.trim();
    const password = $("registerPass")?.value?.trim();

    if (!name || !email || !password) {
      showAuthFeedback("Preencha nome, e-mail e senha.");
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        showAuthFeedback(json?.message || "Erro ao criar conta.");
        return;
      }

      saveSession(json.data);

      $("loginOverlay")?.classList.add("hidden");
      location.reload();
    } catch (error) {
      showAuthFeedback("Erro ao conectar com o servidor.");
    }
  });
}

// =========================
// 👤 USER
// =========================

async function loadUser() {
  let user = JSON.parse(localStorage.getItem("aerix_user") || "{}");

  try {
    const res = await fetch("/api/auth/me", {
      headers: getHeaders()
    });

    const json = await res.json().catch(() => null);

    if (json?.ok && json.data?.user) {
      user = json.data.user;
      localStorage.setItem("aerix_user", JSON.stringify(user));
    }
  } catch (_) {}

  safeText("userName", user.name || "Usuário");
  safeText("userEmail", user.email || "--");

  setPlanUI(user.plan || "free");
}

// =========================
// 💳 BILLING
// =========================

async function checkPremiumAccess() {
  try {
    const res = await fetch("/api/billing/status", {
      headers: getHeaders()
    });

    const json = await res.json().catch(() => null);

    if (json?.ok) {
      const plan = String(json.data?.plan || "free").toLowerCase();
      const user = JSON.parse(localStorage.getItem("aerix_user") || "{}");

      user.plan = plan;
      localStorage.setItem("aerix_user", JSON.stringify(user));

      setPlanUI(plan);
    }
  } catch (_) {}
}

async function startCheckout() {
  try {
    const res = await fetch("/api/billing/create-checkout", {
      method: "POST",
      headers: getHeaders()
    });

    const data = await res.json().catch(() => null);

    const url =
      data?.url ||
      data?.checkoutUrl ||
      data?.data?.url ||
      data?.data?.checkoutUrl;

    if (url) {
      window.location.href = url;
      return;
    }

    alert(data?.message || "Erro ao iniciar pagamento.");
  } catch (_) {
    alert("Erro ao conectar com o pagamento.");
  }
}

function setupBillingButtons() {
  document.querySelectorAll("[data-action='upgrade'], .upgrade-btn").forEach((btn) => {
    btn.addEventListener("click", startCheckout);
  });
}

window.startCheckout = startCheckout;

// =========================
// ⚙️ MODE SWITCHER
// =========================

function setupModeSwitcher() {
  const buttons = document.querySelectorAll(".mode-btn");
  const description = $("modeDescription");
  const headline = $("headlineText");

  const descriptions = {
    conservador: "Operação mais seletiva, priorizando segurança, menor frequência e maior filtro.",
    equilibrado: "Operação balanceada entre frequência e qualidade.",
    agressivo: "Operação com maior frequência e tolerância a risco operacional."
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.mode || "equilibrado";

      buttons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      document.body.classList.remove("mode-conservador", "mode-equilibrado", "mode-agressivo");
      document.body.classList.add(`mode-${mode}`);

      if (description) description.innerText = descriptions[mode] || descriptions.equilibrado;
      if (headline) headline.innerText = `Fluxo operacional em tempo real • Modo ${mode}`;
    });
  });
}

// =========================
// ☰ SIDEBAR
// =========================

function setupSidebar() {
  const btn = $("menuToggle");

  if (!document.querySelector(".sidebar-backdrop")) {
    const backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", () => {
      document.body.classList.remove("sidebar-open");
      document.body.classList.add("sidebar-collapsed");
    });
  }

  btn?.addEventListener("click", () => {
    const isOpen = document.body.classList.contains("sidebar-open");

    document.body.classList.toggle("sidebar-open", !isOpen);
    document.body.classList.toggle("sidebar-collapsed", isOpen);
  });
}

// =========================
// 🔌 SOCKET
// =========================

function connectSocket() {
  if (typeof io !== "function") {
    setConnection("offline");
    return null;
  }

  const socket = io();

  setConnection("connecting");

  socket.on("connect", () => setConnection("online"));
  socket.on("disconnect", () => setConnection("offline"));
  socket.on("reconnect_attempt", () => setConnection("reconnecting"));

  socket.on("signal", updateSignal);
  socket.on("history", updateHistory);
  socket.on("engine:update", updateEngine);

  return socket;
}

// =========================
// 📊 SIGNAL UI
// =========================

function updateSignal(data) {
  if (!data) return;

  safeText("signalAsset", data.symbol || data.asset || "--");
  safeText("signalTime", new Date().toLocaleTimeString("pt-BR"));

  const direction = String(data.signal || data.direction || "WAIT").toUpperCase();
  const dirEl = $("signalDirection");

  if (dirEl) {
    if (direction === "CALL") {
      dirEl.innerText = "COMPRA";
      dirEl.className = "signal-direction buy";
    } else if (direction === "PUT") {
      dirEl.innerText = "VENDA";
      dirEl.className = "signal-direction sell";
    } else {
      dirEl.innerText = "AGUARDANDO";
      dirEl.className = "signal-direction neutral";
    }
  }

  const score = Number(data.finalScore || data.final_score || data.confidence || 0);

  safeText("signalConfidence", `${Math.round(score)}%`);
  safeText("signalScore", Math.round(score) || "--");
  safeText("signalEntry", data.timing || "--");
  safeText("signalExpiry", data.expiry || data.expires_at ? new Date(data.expiry || data.expires_at).toLocaleTimeString("pt-BR") : "--");
  safeText("bestAsset", data.symbol || "--");
  safeText("bestReason", data.blockReason || data.block_reason || data.timing || "Aguardando");
  safeText("bestScore", `${Math.round(score)}%`);
  safeText("priorityScore", `${Math.round(score)}%`);
  safeText("priorityText", score >= 85 ? "Alta" : score >= 70 ? "Média" : "Observação");

  const ring = $("confidenceRing");
  if (ring) {
    ring.style.background = `conic-gradient(var(--blue) ${score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
  }

  const ai = $("aiExplanation");
  if (ai) {
    ai.innerHTML = `<div class="ai-text">${data.explanation || "IA analisando mercado em tempo real..."}</div>`;
  }

  updateAiPanel(data);

  const card = $("signalCard");
  if (card) {
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }
}

function updateAiPanel(data) {
  const finalScore = Number(data.finalScore || data.final_score || data.confidence || 0);
  const adaptive = Number(data.adaptiveAdjustment || data.adaptive_adjustment || 0);
  const adjusted = Number(data.adjustedScore || data.adjusted_score || finalScore);
  const blocked = Boolean(data.blocked || data.signal === "WAIT");

  safeText("ai-base-score", `${Math.round(finalScore)}%`);
  safeText("ai-adjusted-score", `${Math.round(adjusted)}%`);
  safeText("ai-adaptive-adjustment", adaptive > 0 ? `+${adaptive}` : `${adaptive}`);
  safeText("ai-loss-penalty", data.blockReason?.includes("loss") ? "ATIVA" : "--");
  safeText("ai-bad-hour", data.blockReason?.includes("Horário") ? "SIM" : "NÃO");
  safeText("ai-block-type", blocked ? "BLOQUEIO" : "LIBERADO");

  const badge = $("ai-status-badge");
  if (badge) {
    badge.innerText = blocked ? "BLOQUEADO" : "APROVADO";
    badge.className = blocked ? "ai-status-badge blocked" : "ai-status-badge approved";
  }

  safeText(
    "ai-decision-reason",
    data.blockReason ||
      data.block_reason ||
      data.explanation ||
      "Aguardando leitura institucional..."
  );
}

// =========================
// 📜 HISTORY / ENGINE
// =========================

function updateHistory(list) {
  const el = $("historyList");
  if (!el) return;

  const items = Array.isArray(list) ? list : [list];

  if (!items.length) {
    el.innerHTML = `<div class="history-empty">Nenhum sinal carregado ainda.</div>`;
    return;
  }

  el.innerHTML = "";

  items.slice(0, 10).forEach((s) => {
    const div = document.createElement("div");
    div.className = "history-item";

    const result = String(s.result || "pending").toLowerCase();

    div.innerHTML = `
      <div class="history-time">${new Date(s.created_at || Date.now()).toLocaleTimeString("pt-BR")}</div>
      <div class="history-asset">
        <strong>${s.symbol || "--"}</strong>
        <span>${s.strategy_name || s.strategyName || "AERIX IA"}</span>
      </div>
      <div class="history-direction">${s.signal || s.direction || "WAIT"}</div>
      <div class="history-score">${Math.round(Number(s.finalScore || s.final_score || s.confidence || 0))}%</div>
      <div class="result ${result}">${result.toUpperCase()}</div>
    `;

    el.appendChild(div);
  });
}

function updateEngine(payload) {
  const state = payload?.data || payload;
  if (!state) return;

  const connection = state.connection || {};
  const runtime = state.runtime || {};
  const analytics = state.analytics || {};
  const ranking = state.ranking || [];

  safeText("systemStatus", connection.engineRunning ? "ATIVO" : "PARADO");
  safeText("lastUpdate", new Date().toLocaleTimeString("pt-BR"));
  safeText("opportunitiesCount", runtime.processedThisCycle || ranking.length || 0);

  if (state.signalCenter?.bestOpportunity) {
    updateSignal(state.signalCenter.bestOpportunity);
  }

  if (Array.isArray(ranking)) {
    updateRanking(ranking);
  }

  const stats = analytics.historyStats || {};
  updateStats(stats);
}

function updateRanking(list) {
  const el = $("rankingList");
  if (!el) return;

  const user = JSON.parse(localStorage.getItem("aerix_user") || "{}");

  if (String(user.plan || "free").toLowerCase() !== "premium") {
    el.innerHTML = `<div class="ranking-empty">Recurso premium bloqueado.</div>`;
    return;
  }

  el.innerHTML = "";

  list.slice(0, 8).forEach((s, index) => {
    const div = document.createElement("div");
    div.className = "ranking-item";

    div.innerHTML = `
      <div class="ranking-index">${index + 1}</div>
      <div class="ranking-main">
        <strong>${s.symbol || "--"}</strong>
        <span>${s.timing || s.market_regime || "Monitorando"}</span>
      </div>
      <div class="ranking-score">${Math.round(Number(s.finalScore || s.final_score || s.confidence || 0))}%</div>
    `;

    el.appendChild(div);
  });
}

function updateStats(stats) {
  const bySymbol = stats.bySymbol || {};
  const all = Object.values(bySymbol);

  const total = all.reduce((acc, item) => acc + Number(item.total || 0), 0);
  const wins = all.reduce((acc, item) => acc + Number(item.wins || 0), 0);
  const losses = all.reduce((acc, item) => acc + Number(item.losses || 0), 0);
  const winRate = total ? Math.round((wins / total) * 100) : 0;

  safeText("signalsToday", total);
  safeText("winsCount", wins);
  safeText("lossCount", losses);
  safeText("winRate", `${winRate}%`);
}

// =========================
// 🚀 INIT
// =========================

async function init() {
  updateClock();
  setupAuthTabs();
  setupLogin();
  setupRegister();
  setupSidebar();
  setupModeSwitcher();
  setupBillingButtons();

  $("logoutBtn")?.addEventListener("click", logout);

  const token = getToken();
  const overlay = $("loginOverlay");

  if (!token) {
    overlay?.classList.remove("hidden");
    setConnection("offline");
    return;
  }

  overlay?.classList.add("hidden");

  await loadUser();
  await checkPremiumAccess();

  connectSocket();
}

document.addEventListener("DOMContentLoaded", init);