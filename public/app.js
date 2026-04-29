// =========================
// 🔐 AUTH
// =========================

function getToken() {
  return localStorage.getItem("aerix_token");
}

function getHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`
  };
}

function logout() {
  localStorage.clear();
  location.reload();
}

// =========================
// 🔥 LOGIN
// =========================

function setupLogin() {
  const form = document.getElementById("loginForm");
  const overlay = document.getElementById("loginOverlay");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginUser").value;
    const password = document.getElementById("loginPass").value;

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const json = await res.json();

    if (!json.ok) {
      alert(json.message);
      return;
    }

    localStorage.setItem("aerix_token", json.data.accessToken);
    localStorage.setItem("aerix_user", JSON.stringify(json.data.user));

    overlay.classList.add("hidden");

    location.reload();
  });
}

// =========================
// 🧠 UI HELPERS
// =========================

function setConnection(status) {
  const badge = document.getElementById("connectionBadge");
  const text = document.getElementById("connectionText");

  badge.className = "connection-badge " + status;

  const map = {
    online: "Conectado",
    offline: "Offline",
    connecting: "Conectando"
  };

  text.innerText = map[status] || "Conectando";
}

function setPlanUI(plan) {
  const body = document.body;
  const badge = document.getElementById("userPlan");

  if (plan === "premium") {
    body.classList.add("plan-premium");
    badge.innerText = "PREMIUM";
    badge.className = "plan-badge premium";
  } else {
    body.classList.remove("plan-premium");
    badge.innerText = "FREE";
    badge.className = "plan-badge free";
  }
}

// =========================
// 🔌 SOCKET.IO
// =========================

function connectSocket() {
  const socket = io();

  setConnection("connecting");

  socket.on("connect", () => {
    setConnection("online");
  });

  socket.on("disconnect", () => {
    setConnection("offline");
  });

  socket.on("signal", updateSignal);
  socket.on("history", updateHistory);
  socket.on("engine:update", updateEngine);

  return socket;
}

// =========================
// 📊 UPDATE SIGNAL
// =========================

function updateSignal(data) {
  if (!data) return;

  document.getElementById("signalAsset").innerText = data.symbol || "--";

  const dir = document.getElementById("signalDirection");

  if (data.signal === "CALL") {
    dir.innerText = "COMPRA";
    dir.className = "signal-direction buy";
  } else if (data.signal === "PUT") {
    dir.innerText = "VENDA";
    dir.className = "signal-direction sell";
  } else {
    dir.innerText = "AGUARDANDO";
    dir.className = "signal-direction neutral";
  }

  document.getElementById("signalConfidence").innerText =
    (data.finalScore || data.confidence || 0) + "%";

  document.getElementById("signalScore").innerText =
    data.finalScore || "--";

  document.getElementById("signalEntry").innerText =
    data.timing || "--";

  document.getElementById("aiExplanation").innerText =
    data.explanation || "IA analisando...";
}

// =========================
// 📜 HISTORY
// =========================

function updateHistory(list) {
  const el = document.getElementById("historyList");
  if (!el) return;

  el.innerHTML = "";

  list.slice(0, 10).forEach((s) => {
    const div = document.createElement("div");
    div.className = "history-item";

    div.innerHTML = `
      <div>${s.symbol}</div>
      <div>${s.signal}</div>
      <div>${s.finalScore || 0}%</div>
      <div>${s.result || "pending"}</div>
    `;

    el.appendChild(div);
  });
}

// =========================
// 🧠 ENGINE UPDATE
// =========================

function updateEngine(data) {
  if (!data?.data) return;

  const state = data.data;

  document.getElementById("systemStatus").innerText =
    state.connection?.engineRunning ? "ATIVO" : "PARADO";

  document.getElementById("lastUpdate").innerText =
    new Date().toLocaleTimeString();
}

// =========================
// 👤 LOAD USER
// =========================

async function loadUser() {
  const user = JSON.parse(localStorage.getItem("aerix_user") || "{}");

  document.getElementById("userName").innerText =
    user.name || "Usuário";

  document.getElementById("userEmail").innerText =
    user.email || "--";

  setPlanUI(user.plan || "free");
}

// =========================
// 🚀 INIT
// =========================

async function init() {
  setupLogin();

  const token = getToken();
  const overlay = document.getElementById("loginOverlay");

  if (!token) {
    overlay.classList.remove("hidden");
    return;
  }

  overlay.classList.add("hidden");

  await loadUser();

  connectSocket();
}

init();