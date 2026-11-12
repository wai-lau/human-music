import { load } from './load.mjs';
import { run } from './load.mjs';
import { el, makeDocument } from './dom.mjs';

const ctx = load(['src/core/text.js', 'src/page/ytm.js'], { setTimeout, clearTimeout });
const ytm = ctx.HM.ytm;

await run([
  // readPageItems only on valid paths
  ['readPageItems returns [] on /browse/x', async () => {
    const doc = makeDocument(
      el('ytmusic-responsive-list-item-renderer', {},
        el('div', { class: 'title' }, 'Song'),
        el('div', { class: 'subtitle' }, 'Album • Artist • 2025')));
    const items = ytm.readPageItems(doc, '/browse/x');
    return items.length === 0;
  }],
  // Item with channel links
  ['item with channel links → credits from links', async () => {
    const item = el('ytmusic-responsive-list-item-renderer', {},
      el('div', { class: 'title' }, 'Song'),
      el('a', { href: '/channel/UCABC' }, 'Artist A'),
      el('span', {}, ' • '),
      el('a', { href: '/channel/UCDEF' }, 'Artist B'),
      el('a', { href: '/channel/UCABC' }, 'Artist A'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/search?q=x');
    return items.length === 1 &&
      items[0].title === 'Song' &&
      items[0].credits.length === 2 &&
      items[0].credits[0] === 'Artist A' &&
      items[0].credits[1] === 'Artist B' &&
      items[0].channelIds.length === 2 &&
      items[0].channelIds[0] === 'UCABC' &&
      items[0].channelIds[1] === 'UCDEF' &&
      items[0].featured === false;
  }],
  // Item without links, type word
  ['item without links, type word Album → credit from subtitle', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'Some Album'),
      el('div', { class: 'subtitle' }, 'Album • Otis Redding'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/');
    return items.length === 1 &&
      items[0].title === 'Some Album' &&
      items[0].credits.length === 1 &&
      items[0].credits[0] === 'Otis Redding' &&
      items[0].channelIds.length === 0 &&
      items[0].featured === false;
  }],
  // Mix card (comma list, no type word)
  ['mix card subtitle → featured true', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'Replay Mix'),
      el('div', { class: 'subtitle' }, 'ILLENIUM, GameChops, Shin-Ski'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/explore');
    return items.length === 1 &&
      items[0].title === 'Replay Mix' &&
      items[0].credits.length === 3 &&
      items[0].credits[0] === 'ILLENIUM' &&
      items[0].featured === true;
  }],
  // No links, no subtitle
  ['item with no subtitle → empty credits', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'Bare Item'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/');
    return items.length === 1 &&
      items[0].title === 'Bare Item' &&
      items[0].credits.length === 0;
  }],
  // Items inside ytmusic-player-page are excluded
  ['items inside ytmusic-player-page are excluded', async () => {
    const pageItem = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'On Page'));
    const playerItem = el('ytmusic-responsive-list-item-renderer', {},
      el('div', { class: 'title' }, 'In Player'));
    const playerPage = el('ytmusic-player-page', {}, playerItem);
    const doc = makeDocument(pageItem, playerPage);
    const items = ytm.readPageItems(doc, '/');
    return items.length === 1 && items[0].title === 'On Page';
  }],
  // Items inside #queue are excluded
  ['items inside #queue are excluded', async () => {
    const pageItem = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'On Page'));
    const queueItem = el('ytmusic-responsive-list-item-renderer', {},
      el('div', { class: 'title' }, 'In Queue'));
    const queue = el('div', { id: 'queue' }, queueItem);
    const doc = makeDocument(pageItem, queue);
    const items = ytm.readPageItems(doc, '/');
    return items.length === 1 && items[0].title === 'On Page';
  }],
  // hideItem / unhideAll
  ['hideItem then unhideAll restores hidden', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'Hide Me'));
    const doc = makeDocument(item);
    ytm.hideItem(item);
    const hidden = item.hidden && item.hasAttribute('data-hm-hidden');
    ytm.unhideAll(doc);
    return hidden && !item.hidden && !item.hasAttribute('data-hm-hidden');
  }],
  // unhideAll only touches hm-hidden elements
  ['unhideAll only restores hm-hidden elements', async () => {
    const hmItem = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'HM Hidden'));
    const ytItem = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'YT Hidden'));
    ytm.hideItem(hmItem);
    ytItem.hidden = true;
    const doc = makeDocument(hmItem, ytItem);
    ytm.unhideAll(doc);
    return !hmItem.hidden && ytItem.hidden;
  }],
  // Featured mix with one channel link is not a mix card
  ['item with channel link is never mix', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'Mix'),
      el('a', { href: '/channel/UCX' }, 'Solo'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/explore');
    return items.length === 1 &&
      items[0].credits.length === 1 &&
      items[0].credits[0] === 'Solo' &&
      items[0].featured === false;
  }],
  // Item with no title
  ['item with no title element → empty title', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'subtitle' }, 'Album • Someone'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/');
    return items.length === 1 && items[0].title === '';
  }],
  // Artist type word
  ['Artist type word → credits = [title]', async () => {
    const item = el('ytmusic-two-row-item-renderer', {},
      el('div', { class: 'title' }, 'An Artist'),
      el('div', { class: 'subtitle' }, 'Artist • Verified'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/explore');
    return items.length === 1 &&
      items[0].credits.length === 1 &&
      items[0].credits[0] === 'An Artist';
  }],
  // Multiple channels on links
  ['multiple channel links → multiple channelIds', async () => {
    const item = el('ytmusic-responsive-list-item-renderer', {},
      el('div', { class: 'title' }, 'Song'),
      el('a', { href: '/channel/UC1' }, 'First'),
      el('a', { href: '/channel/UC2' }, 'Second'),
      el('a', { href: '/channel/UC3' }, 'Third'));
    const doc = makeDocument(item);
    const items = ytm.readPageItems(doc, '/search?q=x');
    return items.length === 1 &&
      items[0].credits.length === 3 &&
      items[0].channelIds.length === 3 &&
      items[0].channelIds[2] === 'UC3';
  }],
  // Empty document
  ['empty document → []', async () => {
    const doc = makeDocument();
    const items = ytm.readPageItems(doc, '/');
    return items.length === 0;
  }],
]);