// =========================
// 🔐 AUTH + SESSION
// =========================

function getToken() {
  return localStorage.getItem("aerix_token");
}

function getRefreshToken() {
  return localStorage.getItem("aerix_refresh");
}

function getHeaders() {
  const token = getToken();

  return {
    "Content-Type": "application/json",
    Authorization: token ? `Bearer ${token}` : ""
  };
}

function clearSession() {
  localStorage.removeItem("aerix_token");
  localStorage.removeItem("aerix_refresh");
  localStorage.removeItem("aerix_user");
}

function logout() {
  clearSession();
  toast("Sessão encerrada.", "info");
  setTimeout(() => location.reload(), 500);
}

// =========================
// 🔁 REFRESH TOKEN
// =========================

async function refreshTokenIfNeeded() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });

    const json = await res.json();

    if (json?.ok && json.data?.accessToken) {
      localStorage.setItem("aerix_token", json.data.accessToken);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function authFetch(url, options = {}) {
  let res = await fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers || {}) }
  });

  if (res.status !== 401) return res;

  const refreshed = await refreshTokenIfNeeded();
  if (!refreshed) return res;

  return fetch(url, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers || {}) }
  });
}

// =========================
// 🔔 TOAST
// =========================

function toast(message, type = "info") {
  const container = document.querySelector(".toast-container") || (() => {
    const div = document.createElement("div");
    div.className = "toast-container";
    document.body.appendChild(div);
    return div;
  })();

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerText = message;

  container.appendChild(el);

  setTimeout(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// =========================
// 👤 USER / PLAN
// =========================

function setPlanUI(plan) {
  const isPremium = plan === "premium";

  document.body.classList.toggle("plan-premium", isPremium);

  const badge = document.getElementById("userPlan");
  if (badge) {
    badge.innerText = isPremium ? "PREMIUM" : "FREE";
    badge.className = isPremium ? "plan-badge premium" : "plan-badge free";
  }

  // 🔥 esconder upgrade se for premium
  document.querySelectorAll(".upgrade-btn").forEach(btn => {
    btn.style.display = isPremium ? "none" : "block";
  });

  // 🔥 ajustar lista premium
  const list = document.getElementById("premiumList");
  if (list) {
    list.innerHTML = isPremium
      ? `<li>Sinais premium liberados</li>
         <li>Ranking avançado ativo</li>
         <li>IA institucional ativa</li>`
      : `<li>Sinais premium bloqueados</li>
         <li>Ranking avançado bloqueado</li>
         <li>Upgrade necessário</li>`;
  }
}

// =========================
// 💳 BILLING
// =========================

async function startCheckout() {
  await refreshTokenIfNeeded();

  const res = await authFetch("/api/billing/create-checkout", {
    method: "POST"
  });

  const data = await res.json();

  const url = data?.data?.checkoutUrl || data?.checkoutUrl;

  if (url) {
    window.location.href = url;
  } else {
    toast("Erro ao iniciar pagamento.", "error");
  }
}

window.startCheckout = startCheckout;

// =========================
// 📊 SIGNAL UI (REFINADO)
// =========================

function updateSignal(data) {
  if (!data) return;

  const direction = (data.signal || "WAIT").toUpperCase();
  const dirEl = document.getElementById("signalDirection");

  if (dirEl) {
    if (direction === "CALL") {
      dirEl.innerText = "COMPRA";
      dirEl.className = "signal-direction buy";
    } else if (direction === "PUT") {
      dirEl.innerText = "VENDA";
      dirEl.className = "signal-direction sell";
    } else {
      dirEl.innerText = "AGUARDANDO CONFIRMAÇÃO DA IA";
      dirEl.className = "signal-direction neutral";
    }
  }

  const score = Number(data.confidence || 0);

  document.getElementById("signalConfidence").innerText =
    score ? `${Math.round(score)}%` : "--";

  // 🔥 IA mais profissional
  document.getElementById("aiExplanation").innerHTML = `
    <div class="ai-text">
      ${
        data.blockReason
          ? `Entrada bloqueada: ${data.blockReason}`
          : data.explanation || "IA analisando o mercado..."
      }
    </div>
  `;
}

// =========================
// 📊 RANKING (SEM DUPLICAÇÃO)
// =========================

function updateRanking(list) {
  const el = document.getElementById("rankingList");
  if (!el) return;

  const unique = {};
  list.forEach(item => {
    if (!unique[item.symbol]) {
      unique[item.symbol] = item;
    }
  });

  el.innerHTML = "";

  Object.values(unique).slice(0, 8).forEach((s, index) => {
    const score = Math.round(s.confidence || 0);

    const div = document.createElement("div");
    div.className = "ranking-item";

    div.innerHTML = `
      <div>${index + 1}</div>
      <div>
        <strong>${s.symbol}</strong>
        <div class="ranking-bar">
          <i style="width:${score}%"></i>
        </div>
      </div>
      <div>${score}%</div>
    `;

    el.appendChild(div);
  });
}

// =========================
// 🚀 INIT
// =========================

async function init() {
  const token = getToken();

  if (!token) {
    document.getElementById("loginOverlay")?.classList.remove("hidden");
    return;
  }

  await refreshTokenIfNeeded();

  try {
    const res = await authFetch("/api/auth/me");
    const json = await res.json();

    if (json?.ok) {
      setPlanUI(json.data.user.plan);
    }
  } catch {}

  // 🔥 bind botão premium
  document.querySelectorAll(".upgrade-btn").forEach(btn => {
    btn.addEventListener("click", startCheckout);
  });
}

document.addEventListener("DOMContentLoaded", init);