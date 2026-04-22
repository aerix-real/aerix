const engineRunnerService = require("../services/engine-runner.service");

async function getRuntimeState(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      data: engineRunnerService.getState()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao buscar runtime."
    });
  }
}

async function startEngine(req, res) {
  try {
    const state = engineRunnerService.start();

    return res.status(200).json({
      ok: true,
      message: "Engine iniciada com sucesso.",
      data: state
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao iniciar engine."
    });
  }
}

async function stopEngine(req, res) {
  try {
    const state = engineRunnerService.stop();

    return res.status(200).json({
      ok: true,
      message: "Engine parada com sucesso.",
      data: state
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao parar engine."
    });
  }
}

async function runCycleNow(req, res) {
  try {
    const state = await engineRunnerService.runNow();

    return res.status(200).json({
      ok: true,
      message: "Ciclo executado com sucesso.",
      data: state
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao executar ciclo."
    });
  }
}

module.exports = {
  getRuntimeState,
  startEngine,
  stopEngine,
  runCycleNow
};