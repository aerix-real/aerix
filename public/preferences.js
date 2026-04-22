(function () {
  function qs(id) {
    return document.getElementById(id);
  }

  function normalizeSymbolsInput(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
  }

  async function loadPreferences() {
    const result = await window.AERIX_AUTH.apiRequest("/users/me/preferences", {
      method: "GET"
    });

    return result.data;
  }

  async function savePreferences(payload) {
    const result = await window.AERIX_AUTH.apiRequest("/users/me/preferences", {
      method: "PUT",
      body: JSON.stringify(payload)
    });

    return result.data;
  }

  function fillPreferencesForm(preferences) {
    if (!preferences) return;

    const mode = qs("prefTradingMode");
    const symbols = qs("prefSymbols");
    const ai = qs("prefAiEnabled");
    const notifications = qs("prefNotifications");
    const layout = qs("prefLayout");
    const theme = qs("prefTheme");

    if (mode) mode.value = preferences.trading_mode || "balanced";
    if (symbols) {
      symbols.value = Array.isArray(preferences.preferred_symbols)
        ? preferences.preferred_symbols.join(", ")
        : "";
    }
    if (ai) ai.checked = preferences.ai_explanations_enabled !== false;
    if (notifications) {
      notifications.checked = preferences.notifications_enabled !== false;
    }
    if (layout) layout.value = preferences.panel_layout || "default";
    if (theme) theme.value = preferences.theme || "dark";
  }

  function buildPayloadFromForm() {
    const mode = qs("prefTradingMode")?.value || "balanced";
    const symbols = normalizeSymbolsInput(qs("prefSymbols")?.value || "");
    const aiEnabled = Boolean(qs("prefAiEnabled")?.checked);
    const notificationsEnabled = Boolean(qs("prefNotifications")?.checked);
    const layout = qs("prefLayout")?.value || "default";
    const theme = qs("prefTheme")?.value || "dark";

    return {
      trading_mode: mode,
      preferred_symbols: symbols,
      ai_explanations_enabled: aiEnabled,
      notifications_enabled: notificationsEnabled,
      panel_layout: layout,
      theme
    };
  }

  function setFeedback(message, type = "") {
    const el = qs("preferencesFeedback");
    if (!el) return;

    el.textContent = message || "";
    el.className = `preferences-feedback ${type}`.trim();
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme || "dark";
  }

  function applyLayout(layout) {
    const shell = document.querySelector(".app-shell");
    if (!shell) return;

    shell.dataset.layout = layout || "default";
  }

  async function initPreferencesPanel() {
    try {
      const preferences = await loadPreferences();

      fillPreferencesForm(preferences);
      applyTheme(preferences.theme || "dark");
      applyLayout(preferences.panel_layout || "default");

      return preferences;
    } catch (error) {
      console.error("Erro ao carregar preferências:", error);
      setFeedback("Falha ao carregar preferências.", "error");
      return null;
    }
  }

  function bindPreferencesForm(onSaved) {
    const form = qs("preferencesForm");
    const saveButton = qs("savePreferencesButton");

    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      try {
        if (saveButton) saveButton.disabled = true;
        setFeedback("Salvando preferências...");

        const payload = buildPayloadFromForm();
        const saved = await savePreferences(payload);

        fillPreferencesForm(saved);
        applyTheme(saved.theme || "dark");
        applyLayout(saved.panel_layout || "default");

        setFeedback("Preferências salvas com sucesso.", "success");

        if (typeof onSaved === "function") {
          onSaved(saved);
        }
      } catch (error) {
        console.error("Erro ao salvar preferências:", error);
        setFeedback(error.message || "Falha ao salvar preferências.", "error");
      } finally {
        if (saveButton) saveButton.disabled = false;
      }
    });

    const theme = qs("prefTheme");
    const layout = qs("prefLayout");

    if (theme) {
      theme.addEventListener("change", () => applyTheme(theme.value));
    }

    if (layout) {
      layout.addEventListener("change", () => applyLayout(layout.value));
    }
  }

  window.AERIX_PREFERENCES = {
    loadPreferences,
    savePreferences,
    fillPreferencesForm,
    buildPayloadFromForm,
    initPreferencesPanel,
    bindPreferencesForm,
    applyTheme,
    applyLayout
  };
})();