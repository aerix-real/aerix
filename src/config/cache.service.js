const store = new Map();

function set(key, value, ttlMs = 15000) {
  const expiresAt = Date.now() + ttlMs;

  store.set(key, {
    value,
    expiresAt
  });

  return value;
}

function get(key) {
  const entry = store.get(key);

  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  return entry.value;
}

function remove(key) {
  return store.delete(key);
}

function clear() {
  store.clear();
}

function getOrSet(key, factory, ttlMs = 15000) {
  const existing = get(key);

  if (existing) {
    return Promise.resolve(existing);
  }

  return Promise.resolve(factory()).then((result) => {
    set(key, result, ttlMs);
    return result;
  });
}

module.exports = {
  set,
  get,
  remove,
  clear,
  getOrSet
};