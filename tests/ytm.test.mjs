import { load } from './load.mjs';
import { fakeYtm } from './fakes.mjs';
import { fakeClock } from './fakes.mjs';
import { KeyboardEvent } from './dom.mjs';

const ctx = load(['src/core/text.js', 'src/page/ytm.js'], { setTimeout, clearTimeout, KeyboardEvent });
const ytm = ctx.HM.ytm;

const cases = [
  ['readSong new layout', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Test Song', artistLine: 'Test Artist • Album • 2025' } });
    const song = ytm.readSong(fake.doc);
    return song.title === 'Test Song' && song.artistLine === 'Test Artist • Album • 2025' && Array.isArray(song.channelIds);
  }],

  ['readSong old layout', () => {
    const fake = fakeYtm({ layout: 'old', song: { title: 'Old Song', artistLine: 'Old Artist • Album' } });
    const song = ytm.readSong(fake.doc);
    return song.title === 'Old Song' && song.artistLine === 'Old Artist • Album' && Array.isArray(song.channelIds);
  }],

  ['readSong null when no song', () => {
    const fake = fakeYtm({ layout: 'new', song: null });
    const song = ytm.readSong(fake.doc);
    return song === null;
  }],

  ['readSong trims text', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: '  Song Title  ', artistLine: '  Artist Name  ' } });
    const song = ytm.readSong(fake.doc);
    return song.title === 'Song Title' && song.artistLine === 'Artist Name';
  }],

  ['readQueue new layout', () => {
    const fake = fakeYtm({
      layout: 'new',
      queue: [
        { title: 'Song A', artistLine: 'Artist A • Album', selected: false },
        { title: 'Song B', artistLine: 'Artist B • Album', selected: true },
        { title: 'Song C', artistLine: 'Artist C • Album', selected: false },
      ]
    });
    const rows = ytm.readQueue(fake.doc);
    return rows.length === 3 && rows[0].title === 'Song A' && !rows[0].selected &&
      rows[1].title === 'Song B' && rows[1].selected && rows[2].title === 'Song C' && !rows[2].selected;
  }],

  ['readQueue old layout', () => {
    const fake = fakeYtm({
      layout: 'old',
      queue: [
        { title: 'Song X', artistLine: 'Artist X • Album', selected: true },
        { title: 'Song Y', artistLine: 'Artist Y • Album', selected: false },
      ]
    });
    const rows = ytm.readQueue(fake.doc);
    return rows.length === 2 && rows[0].title === 'Song X' && rows[0].selected &&
      rows[1].title === 'Song Y' && !rows[1].selected;
  }],

  ['readQueue trims text', () => {
    const fake = fakeYtm({
      layout: 'new',
      queue: [{ title: '  Song   ', artistLine: '  Artist  ', selected: false }]
    });
    const rows = ytm.readQueue(fake.doc);
    return rows.length === 1 && rows[0].title === 'Song' && rows[0].artistLine === 'Artist';
  }],

  ['readQueue empty', () => {
    const fake = fakeYtm({ layout: 'new', queue: [] });
    return ytm.readQueue(fake.doc).length === 0;
  }],

  ['clickNext new layout', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Song', artistLine: 'Artist' } });
    const btn = fake.doc.querySelector('button[aria-label="Next"]');
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    const result = ytm.clickNext(fake.doc);
    return result === true && clicked;
  }],

  ['clickNext old layout', () => {
    const fake = fakeYtm({ layout: 'old', song: { title: 'Song', artistLine: 'Artist' } });
    const btn = fake.doc.querySelector('.next-button');
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    const result = ytm.clickNext(fake.doc);
    return result === true && clicked;
  }],

  ['pressNextKey', () => {
    const fake = fakeYtm({ layout: 'new' });
    let received = null;
    fake.doc.body.addEventListener('keydown', (ev) => {
      received = { key: ev.key, code: ev.code, bubbles: ev.bubbles };
    });
    ytm.pressNextKey(fake.doc);
    return received && received.key === 'j' && received.code === 'KeyJ' && received.bubbles === true;
  }],

  ['clickDislike new layout not pressed', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Song', artistLine: 'Artist' }, dislikePressed: false });
    const btn = fake.doc.querySelector('dislike-button-view-model button');
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    const result = ytm.clickDislike(fake.doc);
    return result === true && clicked;
  }],

  ['clickDislike new layout already pressed', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Song', artistLine: 'Artist' }, dislikePressed: true });
    const btn = fake.doc.querySelector('dislike-button-view-model button');
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    const result = ytm.clickDislike(fake.doc);
    return result === true && !clicked;
  }],

  ['clickDislike old layout', () => {
    const fake = fakeYtm({ layout: 'old', song: { title: 'Song', artistLine: 'Artist' }, dislikePressed: false });
    const btn = fake.doc.querySelector('.dislike');
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    const result = ytm.clickDislike(fake.doc);
    return result === true && clicked;
  }],

  ['videoDuration no video', () => {
    const fake = fakeYtm({ layout: 'new' });
    const dur = ytm.videoDuration(fake.doc);
    return Number.isNaN(dur);
  }],

  ['videoDuration with video', () => {
    const fake = fakeYtm({ layout: 'new', duration: 180 });
    const dur = ytm.videoDuration(fake.doc);
    return dur === 180;
  }],

  ['seekTo', () => {
    const fake = fakeYtm({ layout: 'new', duration: 200 });
    ytm.seekTo(fake.doc, 45);
    return fake.getCurrentTime() === 45;
  }],

  ['mountPlayerButtons new layout', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Song', artistLine: 'Artist' } });
    let blockedArtist = false, blockedSong = false;
    const result = ytm.mountPlayerButtons(fake.doc, {
      onBlockArtist: () => { blockedArtist = true; },
      onBlockSong: () => { blockedSong = true; }
    });
    const container = fake.doc.querySelector('#hm-player-buttons');
    const buttons = container.querySelectorAll('button');
    return result === true && buttons.length === 2 &&
      buttons[0].textContent === 'Block artist' &&
      buttons[1].textContent === 'Block song';
  }],

  ['mountPlayerButtons old layout', () => {
    const fake = fakeYtm({ layout: 'old', song: { title: 'Song', artistLine: 'Artist' } });
    let blockedArtist = false, blockedSong = false;
    const result = ytm.mountPlayerButtons(fake.doc, {
      onBlockArtist: () => { blockedArtist = true; },
      onBlockSong: () => { blockedSong = true; }
    });
    const container = fake.doc.querySelector('#hm-player-buttons');
    const buttons = container.querySelectorAll('button');
    return result === true && buttons.length === 2;
  }],

  ['mountPlayerButtons twice no duplicate', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Song', artistLine: 'Artist' } });
    ytm.mountPlayerButtons(fake.doc, { onBlockArtist: () => {}, onBlockSong: () => {} });
    ytm.mountPlayerButtons(fake.doc, { onBlockArtist: () => {}, onBlockSong: () => {} });
    const containers = fake.doc.querySelectorAll('#hm-player-buttons');
    return containers.length === 1;
  }],

  ['pageAdapter returns bound functions', () => {
    const fake = fakeYtm({ layout: 'new', song: { title: 'Song', artistLine: 'Artist' }, duration: 200 });
    const adapter = ytm.pageAdapter(fake.doc);
    return typeof adapter.readSong === 'function' &&
      typeof adapter.clickNext === 'function' &&
      typeof adapter.pressNextKey === 'function' &&
      typeof adapter.clickDislike === 'function' &&
      typeof adapter.videoDuration === 'function' &&
      typeof adapter.seekTo === 'function' &&
      adapter.readSong().title === 'Song' &&
      adapter.videoDuration() === 200;
  }],

  ['pageAdapter seekTo takes only seconds', () => {
    const fake = fakeYtm({ layout: 'new', duration: 200 });
    const adapter = ytm.pageAdapter(fake.doc);
    adapter.seekTo(30);
    return fake.getCurrentTime() === 30;
  }],
];

import { run } from './load.mjs';
run(cases);
