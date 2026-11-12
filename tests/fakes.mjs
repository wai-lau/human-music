export function fakeClock() {
  let now = 0;
  let timers = [];
  let idCounter = 0;

  function nowMs() {
    return now;
  }

  function setTimeout(fn, delay) {
    const id = ++idCounter;
    timers.push({ id, type: 'timeout', fn, at: now + delay });
    return id;
  }

  function clearTimeout(id) {
    timers = timers.filter(t => t.id !== id);
  }

  function setInterval(fn, delay) {
    const id = ++idCounter;
    timers.push({ id, type: 'interval', fn, at: now + delay, delay });
    return id;
  }

  function clearInterval(id) {
    timers = timers.filter(t => t.id !== id);
  }

  function tick(ms) {
    now += ms;
    let changed = true;
    while (changed) {
      changed = false;
      const toRun = [];
      for (const t of timers) {
        if (t.at <= now) {
          toRun.push(t);
        }
      }
      toRun.sort((a, b) => a.at - b.at);
      for (const t of toRun) {
        changed = true;
        const firedAt = t.at;
        t.fn();
        if (t.type === 'interval') {
          t.at = firedAt + t.delay;
        } else {
          t.done = true;
        }
      }
      timers = timers.filter(t => !t.done);
    }
  }

  function pending() {
    return timers.length;
  }

  return { setTimeout, clearTimeout, setInterval, clearInterval, tick, pending, now: nowMs };
}

export function fakeStorage(initial = {}) {
  const data = { ...initial };
  let listeners = [];

  function get(keys) {
    return new Promise(resolve => {
      if (keys === null || keys === undefined) {
        resolve({ ...data });
      } else if (typeof keys === 'string') {
        resolve({ [keys]: data[keys] });
      } else {
        const result = {};
        for (const k of keys) {
          result[k] = data[k];
        }
        resolve(result);
      }
    });
  }

  function set(obj) {
    return new Promise(resolve => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        const oldValue = data[k];
        data[k] = v;
        changes[k] = { oldValue, newValue: v };
      }
      for (const listener of listeners) {
        listener(changes, 'local');
      }
      resolve();
    });
  }

  function addListener(fn) {
    listeners.push(fn);
  }

  return { get, set, addListener, data };
}