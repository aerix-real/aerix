(function () {
  const STORAGE_KEY = "aerix_access_token";
  const USER_KEY = "aerix_user";

  function saveSession({ accessToken, user }) {
    if (accessToken) {
      localStorage.setItem(STORAGE_KEY, accessToken);
    }

    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  }

  function getToken() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  async function apiRequest(path, options = {}) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(
      `${window.AERIX_CONFIG.API_BASE_URL}${window.AERIX_CONFIG.API_PREFIX}${path}`,
      {
        ...options,
        headers
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(data.message || "Erro na requisição.");
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function login(email, password) {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });

    saveSession({
      accessToken: result.data.accessToken,
      user: result.data.user
    });

    return result.data;
  }

  async function fetchMe() {
    const result = await apiRequest("/auth/me", {
      method: "GET"
    });

    return result.data.user;
  }

  function logout() {
    clearSession();
    window.location.href = "/login.html";
  }

  window.AERIX_AUTH = {
    saveSession,
    getToken,
    getUser,
    clearSession,
    isAuthenticated,
    apiRequest,
    login,
    fetchMe,
    logout
  };
})();