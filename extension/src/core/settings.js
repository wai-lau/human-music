(function () {
  globalThis.HM = globalThis.HM || {};

  const DEFAULTS = {
    lookahead: 3,
    autoSkip: true,
    autoDislike: false,
    hidePageItems: true,
    playerButtons: true,
    paused: false,
    refresh: 'daily',
    mode: 'lists',
    modeChosen: false,
    investigate: false
  };

  const MODES = ['off', 'lists', 'optimal', 'aggressive'];
  const THRESHOLDS = { optimal: 95, aggressive: 60 };

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
    const booleans = ['autoSkip', 'autoDislike', 'hidePageItems', 'playerButtons'];
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
    // Mode: paused: true always means 'off' (even if a mode is stored); paused: false keeps the stored mode.
    // Old paused:true with no valid mode migrates to 'off'. Valid mode wins otherwise.
    if (typeof obj.paused === 'boolean' && obj.paused) {
      out.mode = 'off';
    } else if (typeof obj.mode === 'string' &&
      MODES.includes(obj.mode) &&
      Object.prototype.hasOwnProperty.call(obj, 'mode')) {
      out.mode = obj.mode;
    } else {
      out.mode = DEFAULTS.mode;
    }
    out.paused = out.mode === 'off';
    if (typeof obj.modeChosen === 'boolean') {
      out.modeChosen = obj.modeChosen;
    } else {
      out.modeChosen = DEFAULTS.modeChosen;
    }
    if (typeof obj.investigate === 'boolean') {
      out.investigate = obj.investigate;
    } else {
      out.investigate = DEFAULTS.investigate;
    }
    return out;
  }

  function threshold(mode) {
    if (typeof mode === 'string' && Object.prototype.hasOwnProperty.call(THRESHOLDS, mode)) {
      return THRESHOLDS[mode];
    }
    return null;
  }

  function effectiveMode(settings, calibrated) {
    if (settings.modeChosen) {
      return settings.mode;
    }
    if (calibrated) {
      return 'optimal';
    }
    return 'lists';
  }

  globalThis.HM.settings = { DEFAULTS, MODES, sanitize, threshold, effectiveMode };
})();
