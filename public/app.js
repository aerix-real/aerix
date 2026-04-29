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
  toast("Sessão encerrada.", "info");
  setTimeout(() => location.reload(), 500);
}

// =========================
// 🧩 HELPERS
// =========================

function $(id) {
  return document.getElementById(id);
}

function safeText(id, value) {
  const el = $(id);
  if (el) el.innerText = value;
}

function safeHTML(id, value) {
  const el = $(id);
  if (el) el.innerHTML = value;
}

function formatPercent(value) {
  const n = Number(value || 0);
  return `${Math.round(n)}%`;
}

function formatTime(value) {
  try {
    return new Date(value || Date.now()).toLocaleTimeString("pt-BR");
  } catch (_) {
    return "--";
  }
}

// =========================
// 🔔 TOAST SYSTEM
// =========================

function setupToastContainer() {
  if (document.querySelector(".toast-container")) return;

  const container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
}

function toast(message, type = "info") {
  setupToastContainer();

  const container = document.querySelector(".toast-container");
  const item = document.createElement("div");

  item.className = `toast ${type}`;
  item.innerText = message;

  container.appendChild(item);

  setTimeout(() => {
    item.classList.add("hide");
    setTimeout(() => item.remove(), 300);
  }, 3500);
}

// =========================
// 🕒 CLOCK
// =========================

function updateClock() {
  safeText("liveClock", new Date().toLocaleTimeString("pt-BR"));
}

setInterval(updateClock, 1000);

// =========================
// 🔐 AUTH FEEDBACK
// =========================

function showAuthFeedback(message, type = "error") {
  const el = $("authFeedback");

  if (!el) {
    toast(message, type);
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
      toast("Login realizado com sucesso.", "success");

      $("loginOverlay")?.classList.add("hidden");
      setTimeout(() => location.reload(), 500);
    } catch (_) {
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
      toast("Conta criada com sucesso.", "success");

      $("loginOverlay")?.classList.add("hidden");
      setTimeout(() => location.reload(), 500);
    } catch (_) {
      showAuthFeedback("Erro ao conectar com o servidor.");
    }
  });
}

// =========================
// 👤 USER / PLAN
// =========================

function setPlanUI(plan) {
  const normalized = String(plan || "free").toLowerCase();
  const isPremium = normalized === "premium";

  document.body.classList.toggle("plan-premium", isPremium);
  document.body.classList.toggle("plan-free", !isPremium);

  const badge = $("userPlan");

  if (badge) {
    badge.innerText = isPremium ? "PREMIUM" : "FREE";
    badge.className = isPremium ? "plan-badge premium" : "plan-badge free";
  }

  safeText("premiumStatus", isPremium ? "Plano premium ativo" : "Plano free ativo");

  document.querySelectorAll("[data-premium='true']").forEach((el) => {
    el.classList.toggle("locked", !isPremium);
  });

  document.querySelectorAll("[data-free-only='true']").forEach((el) => {
    el.classList.toggle("hidden-by-plan", isPremium);
  });
}

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

// =========================
// 💳 BILLING
// =========================

async function startCheckout() {
  try {
    toast("Abrindo checkout seguro...", "info");

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

    toast(data?.message || "Erro ao iniciar pagamento.", "error");
  } catch (_) {
    toast("Erro ao conectar com o pagamento.", "error");
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
    conservador: "Operação seletiva, priorizando segurança, menor frequência e maior filtro.",
    equilibrado: "Operação balanceada entre frequência e qualidade.",
    agressivo: "Operação com maior frequência e tolerância controlada ao risco."
  };

  const riskLabels = {
    conservador: "RISCO BAIXO",
    equilibrado: "RISCO MÉDIO",
    agressivo: "RISCO ALTO"
  };

  buttons.forEach((button) => {
    if (!button.querySelector(".mode-risk")) {
      const risk = document.createElement("small");
      risk.className = "mode-risk";
      risk.innerText = riskLabels[button.dataset.mode] || "";
      button.appendChild(risk);
    }

    button.addEventListener("click", () => {
      const mode = button.dataset.mode || "equilibrado";

      buttons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      document.body.classList.remove("mode-conservador", "mode-equilibrado", "mode-agressivo");
      document.body.classList.add(`mode-${mode}`);

      if (description) description.innerText = descriptions[mode] || descriptions.equilibrado;
      if (headline) headline.innerText = `Fluxo operacional em tempo real • Modo ${mode}`;

      toast(`Modo ${mode} ativado.`, "info");
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
// 🔌 CONNECTION / SOCKET
// =========================

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

function connectSocket() {
  if (typeof io !== "function") {
    setConnection("offline");
    toast("Socket.IO não carregado.", "error");
    return null;
  }

  const socket = io();

  setConnection("connecting");

  socket.on("connect", () => {
    setConnection("online");
    toast("Painel conectado em tempo real.", "success");
  });

  socket.on("disconnect", () => {
    setConnection("offline");
    toast("Conexão em tempo real perdida.", "error");
  });

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
  const signalCard = $("signalCard");

  if (signalCard) {
    signalCard.classList.remove("signal-call", "signal-put", "signal-wait");
  }

  if (dirEl) {
    if (direction === "CALL") {
      dirEl.innerText = "COMPRA";
      dirEl.className = "signal-direction buy";
      signalCard?.classList.add("signal-call");
    } else if (direction === "PUT") {
      dirEl.innerText = "VENDA";
      dirEl.className = "signal-direction sell";
      signalCard?.classList.add("signal-put");
    } else {
      dirEl.innerText = "AGUARDANDO";
      dirEl.className = "signal-direction neutral";
      signalCard?.classList.add("signal-wait");
    }
  }

  const score = Number(data.finalScore || data.final_score || data.confidence || 0);

  safeText("signalConfidence", formatPercent(score));
  safeText("signalScore", Math.round(score) || "--");
  safeText("signalEntry", data.timing || "--");
  safeText("signalExpiry", data.expiry || data.expires_at ? formatTime(data.expiry || data.expires_at) : "--");

  safeText("bestAsset", data.symbol || "--");
  safeText("bestReason", data.blockReason || data.block_reason || data.timing || "Aguardando");
  safeText("bestScore", formatPercent(score));
  safeText("priorityScore", formatPercent(score));
  safeText("priorityText", score >= 85 ? "Alta" : score >= 70 ? "Média" : "Observação");

  const ring = $("confidenceRing");
  if (ring) {
    ring.style.background = `conic-gradient(var(--blue) ${score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
  }

  safeHTML(
    "aiExplanation",
    `<div class="ai-text">${data.explanation || "IA analisando mercado em tempo real..."}</div>`
  );

  updateAiPanel(data);
  updateMiniChart(score);

  if (signalCard) {
    signalCard.classList.remove("flash");
    void signalCard.offsetWidth;
    signalCard.classList.add("flash");
  }
}

function updateAiPanel(data) {
  const finalScore = Number(data.finalScore || data.final_score || data.confidence || 0);
  const adaptive = Number(data.adaptiveAdjustment || data.adaptive_adjustment || 0);
  const adjusted = Number(data.adjustedScore || data.adjusted_score || finalScore);
  const blocked = Boolean(data.blocked || data.signal === "WAIT");

  safeText("ai-base-score", formatPercent(finalScore));
  safeText("ai-adjusted-score", formatPercent(adjusted));
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
// 📈 MINI CHART
// =========================

const chartScores = [];

function updateMiniChart(score) {
  const canvas = $("miniChart");
  if (!canvas || !canvas.getContext) return;

  chartScores.push(Number(score || 0));
  if (chartScores.length > 30) chartScores.shift();

  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.offsetWidth;
  const h = canvas.height = 110;

  ctx.clearRect(0, 0, w, h);

  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;

  for (let i = 0; i < 5; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (chartScores.length < 2) return;

  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#20b7ff";
  ctx.lineWidth = 3;
  ctx.beginPath();

  chartScores.forEach((value, index) => {
    const x = (w / (chartScores.length - 1)) * index;
    const y = h - (value / 100) * h;

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

// =========================
// 📜 HISTORY / RANKING / STATS
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
      <div class="history-time">${formatTime(s.created_at)}</div>
      <div class="history-asset">
        <strong>${s.symbol || "--"}</strong>
        <span>${s.strategy_name || s.strategyName || "AERIX IA"}</span>
      </div>
      <div class="history-direction">${s.signal || s.direction || "WAIT"}</div>
      <div class="history-score">${formatPercent(s.finalScore || s.final_score || s.confidence || 0)}</div>
      <div class="result ${result}">${result.toUpperCase()}</div>
    `;

    el.appendChild(div);
  });
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
    const score = Number(s.finalScore || s.final_score || s.confidence || 0);

    const div = document.createElement("div");
    div.className = "ranking-item";

    div.innerHTML = `
      <div class="ranking-index">${index + 1}</div>
      <div class="ranking-main">
        <strong>${s.symbol || "--"}</strong>
        <span>${s.timing || s.market_regime || "Monitorando"}</span>
        <div class="ranking-bar"><i style="width:${Math.min(100, score)}%"></i></div>
      </div>
      <div class="ranking-score">${formatPercent(score)}</div>
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
// 🧠 ENGINE UPDATE
// =========================

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

  updateStats(analytics.historyStats || {});
}

// =========================
// 🚀 INIT
// =========================

async function init() {
  updateClock();

  setupToastContainer();
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