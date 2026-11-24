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

  // Names that are safe to match on their own inside a credit line. "Earth, Wind & Fire" is one
  // band, so a one-word piece of it ("Fire") must never stand for a person. A piece counts when
  // it sits beside an explicit "feat."/"ft."/"featuring"/" x " marker, or has at least two words
  // ("Tyler, The Creator" gives "the creator", never "tyler"). A one-word piece between commas
  // or "&" is dropped: the whole credit is matched instead, and links (when the page has them)
  // name each artist exactly.
  function safeParts(credit) {
    const segments = String(credit == null ? '' : credit).split(/ feat\. | ft\. | featuring | x /i).map(p => p.trim()).filter(Boolean);
    const marked = segments.length > 1;
    const out = [];
    for (const seg of segments) {
      if (marked) out.push(seg);
      const subs = seg.split(/, | & /).map(p => p.trim()).filter(Boolean);
      if (subs.length > 1) for (const sub of subs) if (/\s/.test(sub)) out.push(sub);
    }
    return out;
  }

  // Every name in a credit, however short: for a mix card, where all of them must be listed.
  function allNames(credit) {
    return String(credit == null ? '' : credit).split(/, | & | feat\. | ft\. | featuring | x /i).map(p => p.trim()).filter(Boolean);
  }

  // `names`: the artists' own names when the page shows each as a link; then nothing is split.
  function credits(artistLine, names) {
    if (!artistLine || typeof artistLine !== 'string') return [];
    const before = leadCredit(artistLine);
    if (!before) return [];
    const whole = normalize(before);
    const linked = Array.isArray(names) ? names.map(normalize).filter(Boolean) : [];
    const parts = (linked.length ? linked : safeParts(before).map(normalize))
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

  globalThis.HM.text = { normalize, leadCredit, splitNames, safeParts, allNames, credits, wholeWord };
})();
