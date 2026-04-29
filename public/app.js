// =========================
// 🔥 NOVO: CHECKOUT STRIPE
// =========================

async function startCheckout() {
  try {
    const response = await fetch("/api/billing/create-checkout", {
      method: "POST",
      headers: getAuthHeaders()
    });

    const data = await response.json().catch(() => null);

    const checkoutUrl =
      data?.url ||
      data?.checkoutUrl ||
      data?.data?.url ||
      data?.data?.checkoutUrl;

    if (checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }

    alert(data?.message || "Erro ao iniciar pagamento.");
  } catch (error) {
    alert("Erro ao conectar com o sistema de pagamento.");
  }
}

window.startCheckout = startCheckout;

// =========================
// 🔥 NOVO: DETECTAR BOTÕES DE UPGRADE
// =========================

function setupBillingButtons() {
  document.querySelectorAll("[data-action='upgrade'], .upgrade-btn").forEach((btn) => {
    btn.addEventListener("click", startCheckout);
  });
}

// =========================
// 🔥 ATUALIZADO: PREMIUM ACCESS
// =========================

async function checkPremiumAccess() {
  const billingStatus =
    await safeFetchJson("/api/billing/status") ||
    await safeFetchJson("/api/premium/status");

  const data = billingStatus?.data || null;

  if (data) {
    state.auth.premiumAccess = Boolean(
      data.premium ||
      String(data.plan || "").toLowerCase() === "premium"
    );

    if (state.auth.user) {
      state.auth.user.plan = String(
        data.plan || state.auth.user.plan || "free"
      ).toLowerCase();

      localStorage.setItem("aerix_user", JSON.stringify(state.auth.user));
    }
  } else {
    state.auth.premiumAccess = isPremiumPlan();
  }

  applyPremiumUi();
}

// =========================
// 🔥 PATCH NO INIT (NÃO QUEBRA NADA)
// =========================

const originalInit = init;

init = async function () {
  setupSidebar();
  setupLogin();
  setupModeSwitcher();
  setupBillingButtons(); // 🔥 novo
  updateUserUi();
  bootDemoState();

  if (state.auth.token) {
    await fetchMe();
    await checkPremiumAccess();
    await fetchPreferences();
    setupSocket();
    fetchInitialData();
  } else {
    setConnectionStatus("offline");
  }
};