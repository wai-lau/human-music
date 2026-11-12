import { run } from './load.mjs';
import { el, makeDocument, KeyboardEvent, MutationObserver } from './dom.mjs';

const page = () => makeDocument(
  el('ytmusic-player-bar', { class: 'bar main' },
    el('div', { class: 'title' }, 'Song'),
    el('span', { class: 'byline' }, el('a', { href: 'channel/UC1' }, 'Band'), ' • Album'),
    el('button', { 'aria-label': 'Next', class: 'next-button' })),
  el('div', { id: 'queue' },
    el('ytmusic-player-queue-item', { selected: true }, el('div', { class: 'song-title' }, 'A')),
    el('div', { id: 'counterpart-renderer' }, el('ytmusic-player-queue-item', {}, el('div', { class: 'song-title' }, 'A video')))),
  el('video', { props: { duration: 200, currentTime: 0 } }));

run([
  ['tag, class, descendant', () => page().querySelector('ytmusic-player-bar .title').textContent === 'Song'],
  ['attribute equals and contains', () => {
    const d = page();
    return d.querySelector('button[aria-label="Next"]') !== null && d.querySelector('a[href*="channel/"]').textContent === 'Band';
  }],
  ['child combinator and id', () => page().querySelectorAll('#queue > ytmusic-player-queue-item').length === 1],
  ['descendant finds the twin row too', () => page().querySelectorAll('#queue ytmusic-player-queue-item').length === 2],
  ['closest', () => { const d = page(); return d.querySelector('#counterpart-renderer .song-title').closest('#counterpart-renderer') !== null; }],
  ['comma list in document order', () => page().querySelectorAll('.next-button, .title').map(e => e.localName).join() === 'div,button'],
  ['textContent joins text', () => page().querySelector('.byline').textContent === 'Band • Album'],
  ['bare attribute', () => page().querySelector('ytmusic-player-queue-item[selected]').textContent === 'A'],
  ['click bubbles to document', () => {
    const d = page(); let hits = 0;
    d.addEventListener('click', () => hits++);
    d.querySelector('.next-button').click();
    return hits === 1;
  }],
  ['keydown on body reaches listeners', () => {
    const d = page(); let key = '';
    d.addEventListener('keydown', e => { key = e.key; });
    d.body.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', bubbles: true }));
    return key === 'j' && KeyboardEvent === d.defaultView.KeyboardEvent;
  }],
  ['hidden, dataset and visibility', () => {
    const d = page(); const t = d.querySelector('.title');
    t.hidden = true; t.dataset.hmHidden = '1';
    return t.getAttribute('hidden') === '' && t.getAttribute('data-hm-hidden') === '1' && t.offsetParent === null
      && d.querySelector('.byline').offsetParent !== null && (t.hidden = false, t.offsetParent !== null);
  }],
  ['remove and isConnected', () => { const d = page(); const r = d.querySelector('ytmusic-player-queue-item'); r.remove(); return !r.isConnected && d.querySelectorAll('ytmusic-player-queue-item').length === 1; }],
  ['props on elements', () => page().querySelector('video').duration === 200],
  ['mutation observer delivers once per microtask', async () => {
    const d = page(); let calls = 0, recs = 0;
    new MutationObserver(r => { calls++; recs += r.length; }).observe(d.querySelector('#queue'), { childList: true, subtree: true });
    d.querySelector('#queue').append(el('ytmusic-player-queue-item'));
    d.querySelector('ytmusic-player-queue-item').remove();
    d.querySelector('.title').textContent = 'outside';
    await Promise.resolve(); await Promise.resolve();
    return (calls === 1 && recs === 2) || `calls ${calls} records ${recs}`;
  }],
  ['unsupported selector throws clearly', () => { try { page().querySelector('a:hover'); return 'no throw'; } catch (e) { return e.message.includes('unsupported') || e.message; } }],
]);
