(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

  function normalize(s) {
    if (s == null || typeof s !== 'string') return '';
    return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // The credited part of an artist line: what comes before the first " • " (YouTube Music
  // follows it with the album and year).
  function leadCredit(artistLine) {
    return String(artistLine == null ? '' : artistLine).split(' • ')[0].trim();
  }

  // The names in a credit: split on ", ", " & " and " feat." (any case).
  function splitNames(credit) {
    return String(credit == null ? '' : credit).split(/, | & | feat\. /i).map(p => p.trim()).filter(Boolean);
  }

  function credits(artistLine) {
    if (!artistLine || typeof artistLine !== 'string') return [];
    const before = leadCredit(artistLine);
    if (!before) return [];
    const whole = normalize(before);
    const parts = splitNames(before)
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

  globalThis.HM.text = { normalize, leadCredit, splitNames, credits, wholeWord };
})();
