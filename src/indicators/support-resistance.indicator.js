function findSupportResistanceLevels(candles, lookback = 40, tolerance = 0.0004) {
  if (!Array.isArray(candles) || candles.length < lookback) {
    return {
      supports: [],
      resistances: []
    };
  }

  const recent = candles.slice(-lookback);
  const supports = [];
  const resistances = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const current = recent[i];

    const isSupport =
      current.low < recent[i - 1].low &&
      current.low < recent[i - 2].low &&
      current.low < recent[i + 1].low &&
      current.low < recent[i + 2].low;

    const isResistance =
      current.high > recent[i - 1].high &&
      current.high > recent[i - 2].high &&
      current.high > recent[i + 1].high &&
      current.high > recent[i + 2].high;

    if (isSupport) {
      addLevelIfUnique(supports, Number(current.low), tolerance);
    }

    if (isResistance) {
      addLevelIfUnique(resistances, Number(current.high), tolerance);
    }
  }

  return {
    supports: supports.sort((a, b) => a - b),
    resistances: resistances.sort((a, b) => a - b)
  };
}

function getNearestSupportResistance(candles, lookback = 40, tolerance = 0.0004) {
  if (!Array.isArray(candles) || !candles.length) {
    return {
      nearestSupport: null,
      nearestResistance: null
    };
  }

  const { supports, resistances } = findSupportResistanceLevels(
    candles,
    lookback,
    tolerance
  );

  const currentPrice = Number(candles[candles.length - 1].close);

  const lowerSupports = supports.filter((level) => level <= currentPrice);
  const upperResistances = resistances.filter((level) => level >= currentPrice);

  const nearestSupport = lowerSupports.length
    ? lowerSupports[lowerSupports.length - 1]
    : null;

  const nearestResistance = upperResistances.length
    ? upperResistances[0]
    : null;

  return {
    nearestSupport,
    nearestResistance
  };
}

function getPriceZone(candles, lookback = 40, tolerance = 0.0004) {
  if (!Array.isArray(candles) || !candles.length) {
    return {
      zone: "neutral",
      currentPrice: null,
      nearestSupport: null,
      nearestResistance: null
    };
  }

  const currentPrice = Number(candles[candles.length - 1].close);
  const { nearestSupport, nearestResistance } = getNearestSupportResistance(
    candles,
    lookback,
    tolerance
  );

  if (nearestResistance !== null && Math.abs(currentPrice - nearestResistance) <= tolerance) {
    return {
      zone: "near_resistance",
      currentPrice,
      nearestSupport,
      nearestResistance
    };
  }

  if (nearestSupport !== null && Math.abs(currentPrice - nearestSupport) <= tolerance) {
    return {
      zone: "near_support",
      currentPrice,
      nearestSupport,
      nearestResistance
    };
  }

  return {
    zone: "neutral",
    currentPrice,
    nearestSupport,
    nearestResistance
  };
}

function addLevelIfUnique(levels, value, tolerance) {
  const exists = levels.some((level) => Math.abs(level - value) <= tolerance);

  if (!exists) {
    levels.push(Number(value.toFixed(6)));
  }
}

module.exports = {
  findSupportResistanceLevels,
  getNearestSupportResistance,
  getPriceZone
};