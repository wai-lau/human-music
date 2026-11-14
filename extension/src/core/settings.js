(function () {
  globalThis.HM = globalThis.HM || {};

  const DEFAULTS = {
    lookahead: 3,
    autoSkip: true,
    autoDislike: false,
    hidePageItems: true,
    playerButtons: true,
    paused: false,
    refresh: 'daily'
  };

  function sanitize(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ...DEFAULTS };
    }
    const out = {};
    const n = typeof obj.lookahead === 'number' ? obj.lookahead
      : typeof obj.lookahead === 'string' && obj.lookahead.trim() !== '' ? Number(obj.lookahead) : NaN;
    if (Number.isFinite(n)) {
      out.lookahead = Math.max(0, Math.min(10, Math.floor(n)));
    } else {
      out.lookahead = DEFAULTS.lookahead;
    }
    const booleans = ['autoSkip', 'autoDislike', 'hidePageItems', 'playerButtons', 'paused'];
    for (const name of booleans) {
      if (typeof obj[name] === 'boolean') {
        out[name] = obj[name];
      } else {
        out[name] = DEFAULTS[name];
      }
    }
    if (typeof obj.refresh === 'string' &&
        typeof globalThis.HM.lists !== 'undefined' &&
        Object.prototype.hasOwnProperty.call(globalThis.HM.lists.FREQUENCIES, obj.refresh)) {
      out.refresh = obj.refresh;
    } else {
      out.refresh = DEFAULTS.refresh;
    }
    return out;
  }

  globalThis.HM.settings = { DEFAULTS, sanitize };
})();
