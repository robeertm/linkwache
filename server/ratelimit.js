// Sliding-window limiter in memory: N per minute and M per day per key (the key is already a hash, never an address).
export function createLimiter({ perMinute = 10, perDay = 150, now = () => Date.now(), maxKeys = 20000 } = {}) {
  const hits = new Map();
  return {
    async limit({ key }) {
      const t = now();
      const arr = (hits.get(key) || []).filter((x) => t - x < 86400000);
      const minute = arr.filter((x) => t - x < 60000).length;
      const ok = minute < perMinute && arr.length < perDay;
      if (ok) arr.push(t);
      hits.set(key, arr);
      if (hits.size > maxKeys) for (const [k, v] of hits) if (!v.some((x) => t - x < 86400000)) hits.delete(k);
      const oldest = arr.find((x) => t - x < 60000);
      return { success: ok, retryAfter: ok ? 0 : (minute >= perMinute && oldest !== undefined ? Math.max(1, Math.ceil((oldest + 60000 - t) / 1000)) : Math.max(1, Math.ceil((arr[0] + 86400000 - t) / 1000))) };
    },
    size: () => hits.size,
  };
}
