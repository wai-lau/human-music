// A clock whose timers run only inside tick(ms). While a timer runs, now() is its fire time.
export function fakeClock() {
  let now = 0;
  let seq = 0;
  let timers = [];

  function add(type, fn, delay) {
    const d = Number(delay) || 0;
    const t = { id: ++seq, type, fn, delay: type === 'interval' ? Math.max(1, d) : Math.max(0, d) };
    t.at = now + t.delay;
    timers.push(t);
    return t.id;
  }
  function clear(id) {
    timers = timers.filter(t => t.id !== id);
  }

  function tick(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const t of timers) {
        if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t;
      }
      if (!next) break;
      now = next.at;
      if (next.type === 'interval') next.at += next.delay;
      else clear(next.id);
      next.fn();
    }
    now = end;
  }

  return {
    setTimeout: (fn, delay) => add('timeout', fn, delay),
    clearTimeout: clear,
    setInterval: (fn, delay) => add('interval', fn, delay),
    clearInterval: clear,
    tick,
    pending: () => timers.length,
    now: () => now,
  };
}

// Async storage shaped like chrome.storage.local; values are copied in and out.
export function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  const listeners = [];

  async function get(keys) {
    const wanted = keys == null ? Object.keys(data) : typeof keys === 'string' ? [keys] : keys;
    const out = {};
    for (const k of wanted) if (k in data) out[k] = structuredClone(data[k]);
    return out;
  }

  async function set(obj) {
    const changes = {};
    for (const [k, v] of Object.entries(obj)) {
      const oldValue = k in data ? structuredClone(data[k]) : undefined;
      data[k] = structuredClone(v);
      changes[k] = { oldValue, newValue: structuredClone(v) };
    }
    for (const fn of listeners) fn(changes, 'local');
  }

  return { get, set, onChanged: { addListener: fn => listeners.push(fn) }, data };
}
