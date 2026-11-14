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
    // A number, or text that reads as one ('4' from a form field); anything else is the default.
    const n = typeof obj.lookahead === 'number' ? obj.lookahead
      : typeof obj.lookahead === 'string' && obj.lookahead.trim() !== '' ? Number(obj.lookahead) : NaN;
    if (Number.isFinite(n)) {
      out.lookahead = Math.max(0, Math.min(10, Math.floor(n)));
    } else {
      out.lookahead = DEFAULTS.lookahead;
    }
    if (typeof obj.autoSkip === 'boolean') { out.autoSkip = obj.autoSkip; } else { out.autoSkip = DEFAULTS.autoSkip; }
    if (typeof obj.autoDislike === 'boolean') { out.autoDislike = obj.autoDislike; } else { out.autoDislike = DEFAULTS.autoDislike; }
    if (typeof obj.hidePageItems === 'boolean') { out.hidePageItems = obj.hidePageItems; } else { out.hidePageItems = DEFAULTS.hidePageItems; }
    if (typeof obj.playerButtons === 'boolean') { out.playerButtons = obj.playerButtons; } else { out.playerButtons = DEFAULTS.playerButtons; }
    if (typeof obj.paused === 'boolean') { out.paused = obj.paused; } else { out.paused = DEFAULTS.paused; }
    if (typeof obj.refresh === 'string' &&
        typeof globalThis.HM.lists !== 'undefined' &&
        globalThis.HM.lists.FREQUENCIES.hasOwnProperty(obj.refresh)) {
      out.refresh = obj.refresh;
    } else {
      out.refresh = DEFAULTS.refresh;
    }
    return out;
  }

  globalThis.HM.settings = { DEFAULTS, sanitize };
})();
