// =========================
// 🔐 AUTH HELPERS
// =========================

function saveAuth(data) {
  if (!data) return;

  const token = data.accessToken || data.token;
  const user = data.user;

  if (token) {
    localStorage.setItem("aerix_token", token);
  }

  if (user) {
    localStorage.setItem("aerix_user", JSON.stringify(user));
  }
}

function getAuthHeaders() {
  const token = localStorage.getItem("aerix_token");

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
// 🔥 LOGIN CORRETO
// =========================

function setupLogin() {
  const loginForm = document.getElementById("loginForm");
  const overlay = document.getElementById("loginOverlay");

  if (!loginForm) return;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginUser").value;
    const password = document.getElementById("loginPass").value;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const json = await res.json();

      if (!json.ok) {
        alert(json.message || "Erro no login");
        return;
      }

      const data = json.data;

      saveAuth(data);

      // 🔥 AQUI ESTAVA O PROBLEMA
      overlay.classList.add("hidden");

      // 🔥 força recarregar já autenticado
      location.reload();

    } catch (err) {
      alert("Erro ao conectar com servidor.");
    }
  });
}

// =========================
// 🔥 FETCH USER
// =========================

async function fetchMe() {
  try {
    const res = await fetch("/api/auth/me", {
      headers: getAuthHeaders()
    });

    const json = await res.json();

    if (json.ok && json.data?.user) {
      localStorage.setItem("aerix_user", JSON.stringify(json.data.user));
      return json.data.user;
    }
  } catch (_) {}

  return null;
}

// =========================
// 🔥 PREMIUM CHECK
// =========================

async function checkPremiumAccess() {
  try {
    const res = await fetch("/api/billing/status", {
      headers: getAuthHeaders()
    });

    const json = await res.json();

    if (json.ok) {
      const plan = json.data?.plan || "free";

      const user = JSON.parse(localStorage.getItem("aerix_user") || "{}");
      user.plan = plan;

      localStorage.setItem("aerix_user", JSON.stringify(user));
    }
  } catch (_) {}
}

// =========================
// 💳 CHECKOUT
// =========================

async function startCheckout() {
  try {
    const res = await fetch("/api/billing/create-checkout", {
      method: "POST",
      headers: getAuthHeaders()
    });

    const data = await res.json();

    const url = data?.url || data?.checkoutUrl || data?.data?.url;

    if (url) {
      window.location.href = url;
      return;
    }

    alert("Erro ao iniciar pagamento.");
  } catch {
    alert("Erro no pagamento.");
  }
}

window.startCheckout = startCheckout;

// =========================
// 🚀 INIT
// =========================

async function init() {
  setupLogin();

  const token = localStorage.getItem("aerix_token");
  const overlay = document.getElementById("loginOverlay");

  if (!token) {
    overlay.classList.remove("hidden");
    return;
  }

  overlay.classList.add("hidden");

  await fetchMe();
  await checkPremiumAccess();
}

init();