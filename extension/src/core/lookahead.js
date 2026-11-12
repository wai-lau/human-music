(function () {
  globalThis.HM = globalThis.HM || {};

  function pickRemovals(rows, distance, matchFn) {
    if (!distance || distance < 1 || !Array.isArray(rows) || rows.length === 0) {
      return { remove: [], watched: [] };
    }

    let sel = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].selected) { sel = i; break; }
    }
    if (sel < 0) return { remove: [], watched: [] };

    const remove = [];
    const watched = [];
    const max = Math.min(rows.length - 1, sel + distance);
    for (let i = sel + 1; i <= max; i++) {
      let m;
      try { m = matchFn(rows[i]); } catch (e) { continue; }
      if (m) {
        if (m.mode === 'act') {
          remove.push(i);
        } else {
          watched.push({ index: i, match: m });
        }
      }
    }
    return { remove, watched };
  }

  globalThis.HM.lookahead = { pickRemovals };
})();
