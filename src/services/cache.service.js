const cache = new Map();

function set(key, value, ttlMs = 10000) {
  const expiresAt = Date.now() + ttlMs;

  cache.set(key, {
    value,
    expiresAt
  });
}

function get(key) {
  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function del(key) {
  cache.delete(key);
}

function clear() {
  cache.clear();
}

module.exports = {
  set,
  get,
  del,
  clear
};