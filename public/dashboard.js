(function () {
  function qs(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = qs(id);
    if (el) el.textContent = value ?? "--";
  }

  function setHTML(id, value) {
    const el = qs(id);
    if (el) el.innerHTML = value ?? "";
  }

  function formatSignalLabel(signal) {
    if (signal === "CALL") return "CALL";
    if (signal === "PUT") return "PUT";
    return "AGUARDANDO";
  }

  function formatConfidence(value) {
    const num = Number(value || 0);
    return `${num.toFixed(1)}%`;
  }

  function formatTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    return date.toLocaleTimeString("pt-BR");
  }

  function buildPriority(confidence = 0) {
    if (confidence >= 90) return "Máxima";
    if (confidence >= 82) return "Alta";
    if (confidence >= 74) return "Moderada";
    return "Observação";
  }

  function buildMarketStatus(bestOpportunity, engineRunning) {
    if (!engineRunning) return "Engine parada";
    if (!bestOpportunity) return "Monitorando mercado";
    if (bestOpportunity.signal === "CALL") return "Pressão compradora";
    if (bestOpportunity.signal === "PUT") return "Pressão vendedora";
    return "Aguardando confluência";
  }

  function buildHeroSubtitle(bestOpportunity, engineRunning) {
    if (!engineRunning) {
      return "A engine está parada. Inicie o motor para voltar a monitorar o mercado em tempo real.";
    }

    if (!bestOpportunity) {
      return "O sistema está monitorando os ativos configurados e aguardando uma estrutura mais clara.";
    }

    if (bestOpportunity.signal === "WAIT") {
      return "Há leitura ativa no mercado, mas a confluência ainda não atingiu o nível ideal para entrada.";
    }

    return "Leitura consolidada da engine institucional em tempo real com score operacional e validação multi-timeframe.";
  }

  function buildHeroStatusClass(signal) {
    if (signal === "CALL") return "CALL";
    if (signal === "PUT") return "PUT";
    return "WAIT";
  }

  function renderReasons(reasons = []) {
    if (!reasons.length) {
      return `<div class="mini-empty">Sem justificativas disponíveis no momento.</div>`;
    }

    return reasons
      .slice(0, 5)
      .map((reason) => `<div class="reason-item">${reason}</div>`)
      .join("");
  }

  function renderRanking(items = []) {
    if (!items.length) {
      return `<div class="mini-empty">Nenhum ativo analisado ainda.</div>`;
    }

    return items
      .slice(0, 6)
      .map((item, index) => {
        const signal = formatSignalLabel(item.signal);
        const confidence = formatConfidence(item.confidence || 0);

        return `
          <div class="rank-item rank-${(item.signal || "WAIT").toLowerCase()}">
            <div class="rank-left">
              <span class="rank-position">#${index + 1}</span>
              <div>
                <strong>${item.symbol || "--"}</strong>
                <span>${signal}</span>
              </div>
            </div>
            <div class="rank-right">${confidence}</div>
          </div>
        `;
      })
      .join("");
  }

  function renderHistory(items = []) {
    if (!items.length) {
      return `<div class="mini-empty">Histórico ainda vazio.</div>`;
    }

    return items
      .slice(0, 8)
      .map((item) => {
        return `
          <div class="history-item history-${(item.signal || "WAIT").toLowerCase()}">
            <div class="history-top">
              <strong>${item.symbol || "--"}</strong>
              <span>${formatSignalLabel(item.signal)}</span>
            </div>
            <div class="history-bottom">
              <span>${formatConfidence(item.confidence || 0)}</span>
              <span>${formatTime(item.timestamp)}</span>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function updateHeroVisual(bestOpportunity, engineRunning) {
    const signalCard = qs("signalCard");
    const heroCard = qs("heroCard");
    const heroSignal = bestOpportunity?.signal || "WAIT";
    const statusClass = buildHeroStatusClass(heroSignal);

    if (signalCard) {
      signalCard.dataset.signal = statusClass;
      signalCard.classList.toggle("hero-paused", !engineRunning);
    }

    if (heroCard) {
      heroCard.dataset.signal = statusClass;
      heroCard.classList.toggle("hero-paused", !engineRunning);
    }

    const subtitle = qs("heroSubtitle");
    if (subtitle) {
      subtitle.textContent = buildHeroSubtitle(bestOpportunity, engineRunning);
    }
  }

  function applyHedgeFundVisual(best, engineRunning) {
    const card = qs("signalCard");
    const signal = best?.signal || "WAIT";
    const confidence = Number(best?.confidence || 0);

    if (card) {
      card.dataset.signal = buildHeroStatusClass(signal);

      card.classList.remove("flash");
      void card.offsetWidth;
      card.classList.add("flash");

      card.classList.toggle("signal-blocked", !engineRunning || signal === "WAIT");
    }

    const aiStatus = qs("aiStatus");
    const aiRisk = qs("aiRisk");
    const aiConfidence = qs("aiConfidence");

    if (aiStatus) {
      if (!engineRunning) {
        aiStatus.textContent = "Engine parada";
        aiStatus.dataset.status = "blocked";
      } else if (!best) {
        aiStatus.textContent = "Monitorando mercado";
        aiStatus.dataset.status = "waiting";
      } else if (signal === "WAIT") {
        aiStatus.textContent = "Aguardando confirmação";
        aiStatus.dataset.status = "waiting";
      } else {
        aiStatus.textContent = "Entrada validada pela IA";
        aiStatus.dataset.status = "approved";
      }
    }

    if (aiRisk) {
      let risk = "ALTO";

      if (confidence >= 85) risk = "BAIXO";
      else if (confidence >= 75) risk = "MÉDIO";

      aiRisk.textContent = "Risco: " + risk;
      aiRisk.dataset.risk = risk.toLowerCase();
    }

    if (aiConfidence) {
      aiConfidence.textContent = "Confiança: " + formatConfidence(confidence);
    }
  }

  function applyDashboard(data) {
    if (!data) return;

    const best = data.signalCenter?.bestOpportunity || null;
    const connection = data.connection || {};
    const userPreferences = data.user?.preferences || {};
    const stats = data.analytics?.historyStats || {};
    const engineRunning = Boolean(connection.engineRunning);

    setText("liveStatusText", engineRunning ? "Tempo real" : "Engine parada");
    setText("marketStatusText", buildMarketStatus(best, engineRunning));

    setText("heroSignal", formatSignalLabel(best?.signal));
    setText("heroSymbol", best?.symbol || "SEM ATIVO");
    setText("heroConfidence", formatConfidence(best?.confidence || 0));
    setText("heroPriority", buildPriority(best?.confidence || 0));
    setText("heroMode", userPreferences.mode_config?.label || "Equilibrado");

    setText("signalAsset", best?.symbol || "SEM ATIVO");
    setText("signalDirection", formatSignalLabel(best?.signal));
    setText("signalConfidence", formatConfidence(best?.confidence || 0));
    setText("signalScore", formatConfidence(best?.confidence || 0));
    setText("signalTime", formatTime(connection.lastCycleAt));
    setText("signalMode", engineRunning ? "TEMPO REAL" : "STANDBY");

    setText("lastCycleAt", formatTime(connection.lastCycleAt));
    setText(
      "rateLimitInfo",
      `${connection.rateLimit?.usedInCurrentWindow || 0}/${connection.rateLimit?.maxPerMinute || 0}`
    );

    setText("historyCount", String(stats.total || 0));
    setText("callCount", String(stats.callCount || 0));
    setText("putCount", String(stats.putCount || 0));
    setText("waitCount", String(stats.waitCount || 0));
    setText("avgConfidence", formatConfidence(stats.avgConfidence || 0));

    setHTML("reasonsList", renderReasons(best?.reasons || []));
    setHTML("rankingList", renderRanking(data.ranking || []));
    setHTML("historyList", renderHistory(data.history || []));

    const explanationEl = qs("signalExplanation") || qs("aiExplanation");
    if (explanationEl) {
      explanationEl.textContent =
        best?.explanation ||
        "A engine ainda não consolidou uma explicação disponível para o ativo principal.";
    }

    const modeDescriptionEl = qs("modeDescription");
    if (modeDescriptionEl) {
      modeDescriptionEl.textContent =
        userPreferences.mode_config?.description ||
        "Modo operacional não carregado.";
    }

    updateHeroVisual(best, engineRunning);
    applyHedgeFundVisual(best, engineRunning);
  }

  async function loadDashboard() {
    const result = await window.AERIX_AUTH.apiRequest("/dashboard", {
      method: "GET"
    });

function applyExtremeMode(best, engineRunning) {
  const card = qs("signalCard");
  const countdownEl = qs("signalCountdown");
  const aiStatus = qs("aiStatus");
  const aiRisk = qs("aiRisk");
  const aiConfidence = qs("aiConfidence");
  const directionEl = qs("signalDirection");

  const signal = best?.signal || "WAIT";
  const confidence = Number(best?.confidence || 0);

  const now = new Date();
  const seconds = now.getSeconds();
  const secondsToFlip = 60 - seconds;

  const isRealSignal = signal === "CALL" || signal === "PUT";
  const isHighConfidence = confidence >= 82;
  const isSniperWindow = secondsToFlip <= 10 || secondsToFlip >= 58;
  const isApproved = engineRunning && isRealSignal && isHighConfidence;

  if (countdownEl) {
    countdownEl.textContent = `${secondsToFlip}s`;

    const metaCard = countdownEl.closest(".signal-meta-card");
    if (metaCard) {
      metaCard.classList.remove("sniper-hot", "sniper-danger");

      if (isSniperWindow && isApproved) {
        metaCard.classList.add("sniper-hot");
      } else if (secondsToFlip <= 15) {
        metaCard.classList.add("sniper-danger");
      }
    }
  }

  if (directionEl) {
    directionEl.classList.remove("buy", "sell", "neutral");

    if (signal === "CALL") directionEl.classList.add("buy");
    else if (signal === "PUT") directionEl.classList.add("sell");
    else directionEl.classList.add("neutral");
  }

  if (card) {
    card.classList.remove(
      "extreme-ready",
      "extreme-danger",
      "extreme-wait",
      "sniper-window"
    );

    if (!engineRunning || signal === "WAIT") {
      card.classList.add("extreme-wait");
    } else if (isApproved) {
      card.classList.add("extreme-ready");
    } else {
      card.classList.add("extreme-danger");
    }

    if (isSniperWindow && isApproved) {
      card.classList.add("sniper-window");
    }
  }

  if (aiStatus) {
    aiStatus.classList.remove(
      "extreme-approved",
      "extreme-blocked",
      "extreme-sniper"
    );

    if (!engineRunning) {
      aiStatus.textContent = "IA bloqueada: engine parada";
      aiStatus.classList.add("extreme-blocked");
    } else if (!isRealSignal) {
      aiStatus.textContent = "IA aguardando confluência real";
      aiStatus.classList.add("extreme-blocked");
    } else if (!isHighConfidence) {
      aiStatus.textContent = "IA bloqueou: score abaixo do ideal";
      aiStatus.classList.add("extreme-blocked");
    } else if (isSniperWindow) {
      aiStatus.textContent = "SNIPER WINDOW: entrada no timing ideal";
      aiStatus.classList.add("extreme-sniper");
    } else {
      aiStatus.textContent = "Entrada validada pela IA";
      aiStatus.classList.add("extreme-approved");
    }
  }

  if (aiRisk) {
    let risk = "ALTO";
    if (confidence >= 88) risk = "BAIXO";
    else if (confidence >= 78) risk = "MÉDIO";

    aiRisk.textContent = "Risco: " + risk;
    aiRisk.dataset.risk = risk.toLowerCase();
  }

  if (aiConfidence) {
    aiConfidence.textContent = "Confiança: " + formatConfidence(confidence);
  }
}
    applyDashboard(result.data);
    return result.data;
  }

  window.AERIX_DASHBOARD = {
    loadDashboard,
    applyDashboard
  };
})();