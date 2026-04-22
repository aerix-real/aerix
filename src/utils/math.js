function average(list = []) {
  if (!Array.isArray(list) || list.length === 0) {
    return 0;
  }

  const total = list.reduce((sum, value) => sum + Number(value || 0), 0);
  return total / list.length;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

function randomBool(probability = 0.5) {
  return Math.random() < probability;
}

module.exports = {
  average,
  randomBetween,
  randomInt,
  randomBool
};