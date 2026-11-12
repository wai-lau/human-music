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
    if (typeof obj.lookahead === 'number' && Number.isFinite(obj.lookahead)) {
      out.lookahead = Math.max(0, Math.min(10, Math.floor(obj.lookahead)));
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
        obj.refresh in globalThis.HM.lists.FREQUENCIES) {
      out.refresh = obj.refresh;
    } else {
      out.refresh = DEFAULTS.refresh;
    }
    return out;
  }

  globalThis.HM.settings = { DEFAULTS, sanitize };
})();