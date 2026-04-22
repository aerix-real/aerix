function calculateADX(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) {
    return {
      adx: [],
      plusDI: [],
      minusDI: []
    };
  }

  const trList = [];
  const plusDMList = [];
  const minusDMList = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const high = Number(current.high);
    const low = Number(current.low);
    const prevHigh = Number(previous.high);
    const prevLow = Number(previous.low);
    const prevClose = Number(previous.close);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    const plusDM =
      upMove > downMove && upMove > 0 ? upMove : 0;

    const minusDM =
      downMove > upMove && downMove > 0 ? downMove : 0;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trList.push(tr);
    plusDMList.push(plusDM);
    minusDMList.push(minusDM);
  }

  let atr = average(trList.slice(0, period));
  let smoothPlusDM = average(plusDMList.slice(0, period));
  let smoothMinusDM = average(minusDMList.slice(0, period));

  const plusDI = [];
  const minusDI = [];
  const dxList = [];

  for (let i = period; i < trList.length; i++) {
    atr = ((atr * (period - 1)) + trList[i]) / period;
    smoothPlusDM = ((smoothPlusDM * (period - 1)) + plusDMList[i]) / period;
    smoothMinusDM = ((smoothMinusDM * (period - 1)) + minusDMList[i]) / period;

    const currentPlusDI = atr === 0 ? 0 : (smoothPlusDM / atr) * 100;
    const currentMinusDI = atr === 0 ? 0 : (smoothMinusDM / atr) * 100;

    plusDI.push(Number(currentPlusDI.toFixed(2)));
    minusDI.push(Number(currentMinusDI.toFixed(2)));

    const diSum = currentPlusDI + currentMinusDI;
    const dx =
      diSum === 0
        ? 0
        : (Math.abs(currentPlusDI - currentMinusDI) / diSum) * 100;

    dxList.push(Number(dx.toFixed(2)));
  }

  const adx = movingAverage(dxList, period).map((value) =>
    Number(value.toFixed(2))
  );

  return {
    adx,
    plusDI,
    minusDI
  };
}

function getLastADX(candles, period = 14) {
  const result = calculateADX(candles, period);

  return {
    adx: result.adx.length ? result.adx[result.adx.length - 1] : null,
    plusDI: result.plusDI.length ? result.plusDI[result.plusDI.length - 1] : null,
    minusDI: result.minusDI.length ? result.minusDI[result.minusDI.length - 1] : null
  };
}

function getADXState(adx, plusDI, minusDI) {
  if (
    !Number.isFinite(adx) ||
    !Number.isFinite(plusDI) ||
    !Number.isFinite(minusDI)
  ) {
    return "neutral";
  }

  if (adx < 20) {
    return "weak_trend";
  }

  if (adx >= 20 && adx < 30) {
    if (plusDI > minusDI) return "bullish_trend";
    if (minusDI > plusDI) return "bearish_trend";
    return "developing_trend";
  }

  if (adx >= 30) {
    if (plusDI > minusDI) return "strong_bullish_trend";
    if (minusDI > plusDI) return "strong_bearish_trend";
    return "strong_trend";
  }

  return "neutral";
}

function movingAverage(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return [];
  }

  const result = [];

  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    result.push(average(window));
  }

  return result;
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

module.exports = {
  calculateADX,
  getLastADX,
  getADXState
};