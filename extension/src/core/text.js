(function () {
  globalThis.HM = globalThis.HM || {};

  function normalize(s) {
    if (s == null || typeof s !== 'string') return '';
    return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function credits(artistLine) {
    if (!artistLine || typeof artistLine !== 'string') return [];
    const before = artistLine.split(' • ')[0];
    if (!before || !before.trim()) return [];
    const whole = normalize(before);
    const parts = before
      .split(/,\s*|&\s*|\s+feat\.\s+/i)
      .map(normalize)
      .filter(c => c !== '');
    const result = [whole];
    const seen = new Set([whole]);
    for (const p of parts) {
      if (!seen.has(p)) {
        seen.add(p);
        result.push(p);
      }
    }
    return result;
  }

  function wholeWord(term) {
    const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'iu');
  }

  globalThis.HM.text = { normalize, credits, wholeWord };
})();