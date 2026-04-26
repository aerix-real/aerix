// ==========================
// AERIX FINAL PROFESSIONAL APP
// Login profissional integrado + DOM seguro
// ==========================

(function () {
  let socket = null;

  const state = {
    mode: localStorage.getItem("aerix_mode") || "equilibrado",
    lastSignalKey: null,
    dashboard: null,
    user: null,
    refreshTimer: null
  };

  const $ = (id) => document.getElementById(id);

  const set = (el, value) => {
    if (el) el.textContent = value ?? "--";
  };

  const percent = (v) => `${Math.round(Number(v || 0))}%`;

  const time = (v) => {
    if (!v) return "--";
    const date = new Date(v);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleTimeString("pt-BR");
  };

  const signalLabel = (s) =>
    s === "CALL" ? "CALL" :
    s === "PUT" ? "PUT" : "AGUARDANDO";

  function getToken() {
    return window.AERIX_AUTH?.getToken?.() || localStorage.getItem("aerix_access_token");
  }

  function showLogin() {
    const overlay = $("loginOverlay");
    if (overlay) overlay.classList.remove("hidden");
  }

  function hideLogin() {
    const overlay = $("loginOverlay");
    if (overlay) overlay.classList.add("hidden");
  }

  function setAuthFeedback(message, type = "") {
    const box = $("authFeedback");
    if (!box) return;

    box.textContent = message || "";
    box.className = `auth-feedback ${type}`.trim();

    if (!message) box.classList.add("hidden");
    else box.classList.remove("hidden");
  }

  async function directLoginFallback(email, password) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Login inválido.");
    }

    const data = result.data || result;
    const accessToken = data.accessToken || data.token;
    const user = data.user || null;

    if (!accessToken) {
      throw new Error("Token de acesso não retornado pelo backend.");
    }

    localStorage.setItem("aerix_access_token", accessToken);

    if (user) {
      localStorage.setItem("aerix_user", JSON.stringify(user));
    }

    return { user, accessToken };
  }

  async function loginUser(email, password) {
    if (window.AERIX_AUTH?.login) {
      return window.AERIX_AUTH.login(email, password);
    }

    return directLoginFallback(email, password);
  }

  async function fetchMeFallback() {
    const token = getToken();

    const response = await fetch("/api/auth/me", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Sessão inválida.");
    }

    return result.data?.user || result.user || null;
  }

  async function fetchMe() {
    if (window.AERIX_AUTH?.fetchMe) {
      return window.AERIX_AUTH.fetchMe();
    }

    return fetchMeFallback();
  }

  function clearSession() {
    if (window.AERIX_AUTH?.clearSession) {
      window.AERIX_AUTH.clearSession();
    }

    localStorage.removeItem("aerix_access_token");
    localStorage.removeItem("aerix_user");
  }

  async function checkAuth() {
    const token = getToken();

    if (!token) {
      showLogin();
      return false;
    }

    try {
      const user = await fetchMe();

      state.user = user;

      set($("userName"), user?.name || "Usuário");
      set($("userEmail"), user?.email || "--");
      set($("userPlan"), String(user?.plan || "FREE").toUpperCase());

      hideLogin();
      return true;
    } catch (error) {
      console.warn("Sessão inválida:", error);
      clearSession();
      showLogin();
      return false;
    }
  }

  function bindLogin() {
    const form = $("loginForm");

    if (!form) {
      console.error("Formulário loginForm não encontrado.");
      return;
    }

    console.log("Login conectado ao formulário.");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const email = $("loginUser")?.value?.trim();
      const password = $("loginPass")?.value?.trim();

      if (!email || !password) {
        setAuthFeedback("Preencha e-mail e senha.", "error");
        return;
      }

      const submitButton = $("loginSubmitBtn");
      if (submitButton) submitButton.disabled = true;

      try {
        setAuthFeedback("Validando acesso...", "");

        const data = await loginUser(email, password);
        const user = data.user || data?.data?.user || null;

        state.user = user;

        set($("userName"), user?.name || "Usuário");
        set($("userEmail"), user?.email || email);
        set($("userPlan"), String(user?.plan || "FREE").toUpperCase());

        hideLogin();
        setAuthFeedback("", "");

        await load();

        if (!state.refreshTimer) {
          state.refreshTimer = setInterval(load, 15000);
        }
      } catch (error) {
        console.error("Erro no login:", error);
        setAuthFeedback(error.message || "Login inválido.", "error");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  function bindLogout() {
    const btn = $("logoutBtn");

    if (!btn) return;

    btn.addEventListener("click", () => {
      clearSession();
      showLogin();
      window.location.reload();
    });
  }

  function updateClock() {
    set($("liveClock"), new Date().toLocaleTimeString("pt-BR"));
  }

  function modeLabel(mode) {
    if (mode === "conservador") return "Conservador";
    if (mode === "agressivo") return "Agressivo";
    return "Equilibrado";
  }

  function setMode(mode) {
    const safeMode = ["conservador", "equilibrado", "agressivo"].includes(mode)
      ? mode
      : "equilibrado";

    state.mode = safeMode;
    localStorage.setItem("aerix_mode", safeMode);

    document.body.classList.remove("mode-conservador", "mode-equilibrado", "mode-agressivo");
    document.body.classList.add(`mode-${safeMode}`);

    set($("topModeText"), modeLabel(safeMode));

    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === safeMode);
    });

    const descriptions = {
      conservador: "Modo conservador: prioriza sinais mais filtrados e reduz entradas fracas.",
      equilibrado: "Modo equilibrado: operação balanceada entre frequência, qualidade e leitura de oportunidade.",
      agressivo: "Modo agressivo: aumenta sensibilidade e busca mais oportunidades, com maior atenção ao risco."
    };

    set($("modeDescription"), descriptions[safeMode]);
  }

  function bindModeSwitcher() {
    document.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.onclick = () => setMode(btn.dataset.mode);
    });

    setMode(state.mode);
  }

  function setupSocket() {
    if (typeof io !== "function") {
      console.warn("Socket.IO não encontrado.");
      return;
    }

    socket = io();

    socket.on("connect", () => {
      if ($("connectionBadge")) $("connectionBadge").className = "connection-badge online";
      set($("connectionText"), "Online");
      console.log("Conectado ao servidor");
    });

    socket.on("disconnect", () => {
      if ($("connectionBadge")) $("connectionBadge").className = "connection-badge offline";
      set($("connectionText"), "Offline");
    });

    socket.on("engine:update", (payload) => {
      apply(payload.data || payload);
    });

    socket.on("commercialSignal", (payload) => {
      const current = state.dashboard || {};

      apply({
        ...current,
        bestOpportunity: payload,
        signalCenter: {
          bestOpportunity: payload
        },
        connection: current.connection || {
          engineRunning: true,
          lastCycleAt: new Date().toISOString()
        }
      });
    });

    socket.on("autoExecution", () => {
      console.warn("autoExecution ignorado: projeto atual é manual.");
    });
  }

  async function load() {
    const token = getToken();

    if (!token) {
      showLogin();
      return;
    }

    try {
      const res = await fetch("/api/dashboard", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
      });

      if (res.status === 401 || res.status === 403) {
        clearSession();
        showLogin();
        return;
      }

      const json = await res.json();
      apply(json.data || json);
    } catch (e) {
      console.error("Erro ao carregar dashboard:", e);
    }
  }

  function apply(data = {}) {
    state.dashboard = data;

    const best = data.signalCenter?.bestOpportunity || data.bestOpportunity || {};
    const conn = data.connection || {};

    updateSignal(best, conn);
    updateMarket(data);
    updateTimeframes(best, data);
    updateRanking(data.ranking || []);
    updateHistory(data.history || []);
    updateStats(data);
    updateAiState(data.aiState, best);
  }

  function updateSignal(s = {}, conn = {}) {
    const dir = s.signal || "WAIT";
    const conf = Number(s.adjustedScore || s.finalScore || s.confidence || 0);

    set($("signalAsset"), s.symbol || "--");
    set($("signalDirection"), signalLabel(dir));
    set($("signalConfidence"), percent(conf));
    set($("signalScore"), percent(conf));
    set($("signalEntry"), s.entry || s.timing || "--");
    set($("signalExpiry"), s.expiry || s.expiryTime || "--");
    set($("signalTime"), time(conn.lastCycleAt));

    const directionEl = $("signalDirection");

    if (directionEl) {
      directionEl.className = "signal-direction";
      directionEl.classList.add(
        dir === "CALL" ? "buy" :
        dir === "PUT" ? "sell" :
        "neutral"
      );
    }

    const card = $("signalCard");

    if (card) {
      card.dataset.signal = dir === "CALL" || dir === "PUT" ? dir : "WAIT";

      const key = `${s.symbol}-${dir}-${Math.round(conf)}`;

      if (state.lastSignalKey !== key) {
        card.classList.remove("flash", "commercial-signal");
        void card.offsetWidth;
        card.classList.add("flash", "commercial-signal");
        state.lastSignalKey = key;
      }
    }

    const ring = $("confidenceRing");

    if (ring) {
      const deg = Math.max(0, Math.min(100, conf)) * 3.6;
      const color =
        dir === "CALL" ? "#22d39a" :
        dir === "PUT" ? "#ff6b81" :
        "#4da3ff";

      ring.style.background = `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.08) ${deg}deg)`;
    }

    updateSniper(dir, conf, s);
    updateAI(s, conf, dir, conn);
  }

  function updateSniper(dir, conf, signal = {}) {
    const sec = Number(signal.entryInSeconds ?? (60 - new Date().getSeconds()));

    set($("signalCountdown"), `${sec}s`);

    const card = $("signalCountdown")?.parentElement;
    if (!card) return;

    card.classList.remove("sniper-hot", "sniper-danger");

    if (conf >= 82 && sec <= 10 && dir !== "WAIT") {
      card.classList.add("sniper-hot");
    } else if (sec <= 15) {
      card.classList.add("sniper-danger");
    }
  }

  function updateAI(s = {}, conf = 0, dir = "WAIT", conn = {}) {
    const approved = Boolean(conn.engineRunning) && dir !== "WAIT" && conf >= 82 && !s.blocked;

    const risk =
      s.aiRisk ||
      (conf >= 88 ? "BAIXO" : conf >= 75 ? "MÉDIO" : "ALTO");

    const aiStatus = $("aiStatus");

    if (aiStatus) {
      aiStatus.dataset.status = approved ? "approved" : s.blocked ? "blocked" : "waiting";
    }

    set(
      aiStatus,
      approved
        ? "ENTRADA MANUAL APROVADA"
        : s.blocked
          ? "ENTRADA BLOQUEADA PELA IA"
          : "AGUARDANDO CONFLUÊNCIA"
    );

    set($("aiConfidence"), `Confiança: ${percent(conf)}`);

    const riskEl = $("aiRisk");
    set(riskEl, "Risco: " + risk);

    if (riskEl) {
      riskEl.dataset.risk = String(risk).toLowerCase();
    }

    set(
      $("aiExplanation"),
      s.explanation ||
      (approved
        ? "Entrada manual validada. Confirme o ativo, direção e timing antes de operar."
        : "IA analisando mercado e aguardando melhor confluência.")
    );

    set($("aiTopStatus"), approved ? "Aprovando entrada" : "Monitorando");

    const badge = $("executionBadge");

    if (badge) {
      badge.textContent = approved ? "MANUAL READY" : "AGUARDAR";
      badge.className = `execution-badge ${approved ? "execute" : "wait"}`;
    }

    const signalCard = $("signalCard");

    if (signalCard) {
      signalCard.classList.remove("execution-ready", "execution-wait");
      signalCard.classList.add(approved ? "execution-ready" : "execution-wait");
    }
  }

  function updateAiState(aiState, best) {
    if (!aiState) return;

    if (!best || !best.symbol) {
      set($("aiTopStatus"), aiState.status || "Monitorando");
      set($("aiExplanation"), aiState.message || "IA ativa. Monitorando mercado.");
    }
  }

  function updateMarket(data = {}) {
    const conn = data.connection || {};
    const market = data.market || {};

    set($("systemStatus"), conn.engineRunning ? "Online" : "Off");
    set($("marketPhase"), conn.engineRunning ? "Ativo" : "Parado");
    set($("marketStatusText"), conn.engineRunning ? "Mercado ativo" : "Parado");

    const pill = $("marketStatusPill");

    if (pill) {
      pill.className = "market-pill " + (conn.engineRunning ? "open" : "closed");
    }

    set(
      $("apiUsageText"),
      `${conn.rateLimit?.usedInCurrentWindow || 0}/${conn.rateLimit?.maxPerMinute || 0}`
    );

    set($("marketRegime"), market.regime || "MONITORANDO");
    set($("volatilityText"), market.volatility || "--");
    set($("sessionName"), market.session || "--");
    set($("lastUpdate"), time(conn.lastCycleAt || data.timestamp || Date.now()));
  }

  function normalizeTfDirection(value) {
    const v = String(value || "").toUpperCase();

    if (["CALL", "BUY", "ALTA", "UP"].includes(v)) return "ALTA";
    if (["PUT", "SELL", "BAIXA", "DOWN"].includes(v)) return "BAIXA";

    return "NEUTRA";
  }

  function updateTimeframes(s = {}, data = {}) {
    const dir = s.signal || "WAIT";
    const conf = Number(s.adjustedScore || s.finalScore || s.confidence || 0);
    const timeframes = data.timeframes || s.timeframes || {};
    const mtf = s.mtf || {};

    const h1 = timeframes.h1 || mtf.h1 || {};
    const m15 = timeframes.m15 || mtf.m15 || {};
    const m5 = timeframes.m5 || mtf.m5 || {};

    set($("h1Trend"), normalizeTfDirection(h1.direction || h1.signal || dir));

    set(
      $("h1Description"),
      h1.aligned
        ? "H1 alinhado com a leitura principal."
        : "Direção macro aguardando confirmação."
    );

    set(
      $("m15Confirm"),
      m15.aligned || conf > 75 ? "CONFIRMANDO" : "AGUARDANDO"
    );

    set(
      $("m15Description"),
      m15.aligned
        ? "M15 confirma o movimento."
        : "Validação intermediária em monitoramento."
    );

    set(
      $("m5Timing"),
      m5.aligned || conf > 82 ? "JANELA ATIVA" : "STANDBY"
    );

    set(
      $("m5Description"),
      m5.aligned
        ? "M5 indica timing operacional."
        : "Entrada somente com janela favorável."
    );

    set($("trendLabel"), dir === "CALL" ? "ALTA" : dir === "PUT" ? "BAIXA" : "NEUTRA");
    set($("trendStrength"), percent(conf));

    const bar = $("trendBarFill");

    if (bar) {
      bar.style.width = `${Math.max(0, Math.min(100, conf))}%`;
    }

    set(
      $("trendBiasText"),
      dir === "WAIT"
        ? "Sem viés dominante."
        : `Viés operacional ${signalLabel(dir)} com ${percent(conf)} de força.`
    );
  }

  function updateRanking(list = []) {
    const box = $("rankingList");
    if (!box) return;

    if (!list.length) {
      box.innerHTML = `<div class="ranking-empty">Aguardando análise da engine.</div>`;
      return;
    }

    box.innerHTML = list.slice(0, 8).map((a, i) => {
      const score = Number(a.adjustedScore || a.finalScore || a.confidence || 0);

      return `
        <div class="ranking-item">
          <div class="ranking-index">#${i + 1}</div>
          <div class="ranking-main">
            <strong>${a.symbol || "--"}</strong>
            <span>${signalLabel(a.signal)}</span>
          </div>
          <div class="ranking-score">${percent(score)}</div>
        </div>
      `;
    }).join("");
  }

  function updateHistory(list = []) {
    const box = $("historyList");
    if (!box) return;

    if (!list.length) {
      box.innerHTML = `<div class="history-empty">Nenhum sinal carregado ainda.</div>`;
      return;
    }

    box.innerHTML = list.slice(0, 8).map((h) => {
      const score = Number(h.adjustedScore || h.finalScore || h.confidence || 0);
      const result = String(h.result || "pending").toLowerCase();

      return `
        <div class="history-item">
          <div class="history-time">${time(h.timestamp || h.created_at)}</div>
          <div class="history-asset">
            <strong>${h.symbol || "--"}</strong>
            <span>${signalLabel(h.signal)}</span>
          </div>
          <div class="history-score">${percent(score)}</div>
          <div class="history-direction">${signalLabel(h.signal)}</div>
          <div class="result ${result}">${result.toUpperCase()}</div>
        </div>
      `;
    }).join("");
  }

  function updateStats(data = {}) {
    const stats = data.analytics?.historyStats || data.historyStats || {};

    set($("signalsToday"), stats.total || 0);
    set($("winRate"), percent(stats.winRate || stats.winrate || 0));
    set($("winsCount"), stats.wins || stats.winCount || 0);
    set($("lossCount"), stats.losses || stats.lossCount || 0);

    set($("opportunitiesCount"), (data.ranking || []).length || stats.total || 0);
    set($("avgQuality"), percent(stats.avgConfidence || 0));

    const best = data.signalCenter?.bestOpportunity || data.bestOpportunity || {};

    set($("focusAsset"), best.symbol || "--");
    set($("operationStatus"), "Manual");
  }

  async function init() {
    console.log("AERIX app inicializado.");

    bindLogin();
    bindLogout();
    bindModeSwitcher();
    setupSocket();
    updateClock();

    setInterval(updateClock, 1000);

    const authenticated = await checkAuth();

    if (authenticated) {
      await load();

      if (!state.refreshTimer) {
        state.refreshTimer = setInterval(load, 15000);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();