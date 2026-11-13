// A small DOM for tests (Node has none, and the repo takes no dependencies).
// Build trees with el(tag, attrs, ...children); wrap them in makeDocument(...).
// Supports what the extension uses: querySelector(All) with tag, #id, .class,
// [attr], [attr=v], [attr*=v], [attr^=v], [attr$=v], descendant and > combinators
// and comma lists; closest/matches; attributes, hidden, dataset, classList;
// textContent; append/remove/isConnected; events with bubbling; click();
// offsetParent/getClientRects for visibility; MutationObserver (microtask delivery).

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this._stopped = false;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
}
export class KeyboardEvent extends Event {
  constructor(type, init = {}) { super(type, init); this.key = init.key || ''; this.code = init.code || ''; }
}
export class MouseEvent extends Event {}

class EventTarget {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn); }
  dispatchEvent(ev) {
    ev.target = this;
    for (let node = this; node; node = ev.bubbles ? node._eventParent() : null) {
      ev.currentTarget = node;
      for (const fn of [...(node._listeners[ev.type] || [])]) fn.call(node, ev);
      if (ev._stopped) break;
    }
    return !ev.defaultPrevented;
  }
  _eventParent() { return null; }
}

// --- selectors ---------------------------------------------------------------

function splitTop(s, sep) {
  const out = []; let depth = 0, quote = null, cur = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

function parseCompound(src) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([*^$~]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`dom.mjs: unsupported selector part "${src.slice(i)}"`);
    if (m[1] && m[1] !== '*') c.tag = m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? m[7] ?? m[8] ?? null });
    i = re.lastIndex; // sticky regex: '^' only matches at 0, so a tag must come first
  }
  return c;
}

function parseComplex(src) {
  // tokens: compounds joined by ' ' (descendant) or '>' (child)
  const parts = []; let combinator = ' ';
  for (const tok of src.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean)) {
    if (tok === '>') { combinator = '>'; continue; }
    parts.push({ combinator, compound: parseCompound(tok) });
    combinator = ' ';
  }
  return parts;
}

const cache = new Map();
function parseSelector(sel) {
  if (!cache.has(sel)) cache.set(sel, splitTop(sel, ',').map(parseComplex));
  return cache.get(sel);
}

function matchCompound(el, c) {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (!a.op) continue;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
  }
  return true;
}

function matchComplex(el, parts, i = parts.length - 1) {
  if (!matchCompound(el, parts[i].compound)) return false;
  if (i === 0) return true;
  if (parts[i].combinator === '>') return !!el.parentElement && matchComplex(el.parentElement, parts, i - 1);
  for (let p = el.parentElement; p; p = p.parentElement) if (matchComplex(p, parts, i - 1)) return true;
  return false;
}

function matches(el, sel) { return parseSelector(sel).some(parts => matchComplex(el, parts)); }

function* descendants(node) {
  for (const c of node.children) { yield c; yield* descendants(c); }
}

// --- nodes -------------------------------------------------------------------

class Text {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  cloneNode() { return new Text(this.data); }
}

let observers = [];
function notify(target, type, extra = {}) {
  for (const o of observers) {
    for (const { node, opts } of o._targets) {
      const inside = node === target || (opts.subtree && node.contains && node.contains(target));
      if (!inside) continue;
      if (type === 'attributes' && !opts.attributes) continue;
      if (type === 'childList' && !opts.childList) continue;
      if (type === 'characterData' && !opts.characterData && !opts.childList) continue;
      o._queue({ type, target, ...extra });
      break;
    }
  }
}

export class Element extends EventTarget {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this._attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.ownerDocument = null;
    const self = this;
    this.classList = {
      contains: k => (self.getAttribute('class') || '').split(/\s+/).includes(k),
      add: (...ks) => self.setAttribute('class', [...new Set([...(self.getAttribute('class') || '').split(/\s+/).filter(Boolean), ...ks])].join(' ')),
      remove: (...ks) => self.setAttribute('class', (self.getAttribute('class') || '').split(/\s+/).filter(k => k && !ks.includes(k)).join(' ')),
      toggle: (k, force) => { const on = force ?? !self.classList.contains(k); if (on) self.classList.add(k); else self.classList.remove(k); return on; },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute('data-' + String(k).replace(/[A-Z]/g, m => '-' + m.toLowerCase())) ?? undefined,
      set: (_, k, v) => { self.setAttribute('data-' + String(k).replace(/[A-Z]/g, m => '-' + m.toLowerCase()), String(v)); return true; },
      deleteProperty: (_, k) => { self.removeAttribute('data-' + String(k).replace(/[A-Z]/g, m => '-' + m.toLowerCase())); return true; },
    });
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  getAttribute(n) { n = n.toLowerCase(); return this._attrs.has(n) ? this._attrs.get(n) : null; }
  hasAttribute(n) { return this._attrs.has(n.toLowerCase()); }
  setAttribute(n, v) { n = n.toLowerCase(); const old = this.getAttribute(n); this._attrs.set(n, String(v)); notify(this, 'attributes', { attributeName: n, oldValue: old }); }
  removeAttribute(n) { n = n.toLowerCase(); if (!this._attrs.has(n)) return; const old = this._attrs.get(n); this._attrs.delete(n); notify(this, 'attributes', { attributeName: n, oldValue: old }); }
  toggleAttribute(n, force) { const on = force ?? !this.hasAttribute(n); if (on) this.setAttribute(n, ''); else this.removeAttribute(n); return on; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get previousElementSibling() { if (!this.parentNode) return null; const k = this.parentNode.children; return k[k.indexOf(this) - 1] || null; }
  get nextElementSibling() { if (!this.parentNode) return null; const k = this.parentNode.children; return k[k.indexOf(this) + 1] || null; }
  get nextSibling() { if (!this.parentNode) return null; const k = this.parentNode.childNodes; return k[k.indexOf(this) + 1] || null; }
  // A copy without listeners, like the DOM's.
  cloneNode(deep = false) {
    const e = new Element(this.localName);
    for (const [k, v] of this._attrs) e._attrs.set(k, v);
    Object.assign(e.style, this.style);
    if (deep) for (const c of this.childNodes) { const k = c.cloneNode(true); k.parentNode = e; e.childNodes.push(k); }
    return e;
  }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = v === '' || v == null ? [] : [new Text(v)]; this.childNodes.forEach(c => { c.parentNode = this; }); notify(this, 'childList'); }
  get innerText() { return this.textContent; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9; }
  get isContentEditable() { return this.getAttribute('contenteditable') === 'true' || this.getAttribute('contenteditable') === ''; }
  _doc() { let n = this; while (n.parentNode) n = n.parentNode; return n.nodeType === 9 ? n : null; }
  focus() { const d = this._doc(); if (d) d._active = this; }
  blur() { const d = this._doc(); if (d && d._active === this) d._active = null; }
  _eventParent() { return this.parentNode; }
  append(...nodes) {
    for (let n of nodes) {
      if (typeof n === 'string' || typeof n === 'number') n = new Text(n);
      if (n.parentNode) n.parentNode.removeChild(n);
      n.parentNode = this;
      this.childNodes.push(n);
    }
    notify(this, 'childList');
  }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, n);
    notify(this, 'childList');
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) { this.childNodes.splice(i, 1); n.parentNode = null; notify(this, 'childList', { removedNodes: [n] }); } return n; }
  replaceChild(n, old) {
    const i = this.childNodes.indexOf(old);
    if (i < 0) return old;
    if (n.parentNode) n.parentNode.removeChild(n);
    this.childNodes[i] = n; n.parentNode = this; old.parentNode = null;
    notify(this, 'childList', { removedNodes: [old] });
    return old;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let p = this; p && p.nodeType === 1; p = p.parentNode) if (matches(p, sel)) return p; return null; }
  querySelectorAll(sel) { const out = []; for (const d of descendants(this)) if (matches(d, sel)) out.push(d); return out; }
  querySelector(sel) { for (const d of descendants(this)) if (matches(d, sel)) return d; return null; }
  click() { this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
  // Visible = connected, and neither it nor an ancestor is hidden or has style.display 'none'.
  get offsetParent() {
    if (!this.isConnected) return null;
    for (let p = this; p && p.nodeType === 1; p = p.parentNode) if (p.hidden || p.style.display === 'none') return null;
    return this.parentElement || this;
  }
  getClientRects() { return this.offsetParent ? [{ width: 1, height: 1 }] : []; }
}

class Document extends EventTarget {
  constructor() {
    super();
    this.nodeType = 9;
    this.documentElement = new Element('html');
    this.documentElement.parentNode = this;
    this.body = new Element('body');
    this.documentElement.append(this.body);
    this.childNodes = [this.documentElement];
    this.location = { pathname: '/' };
    this.defaultView = { Event, KeyboardEvent, MouseEvent, MutationObserver, location: this.location };
  }
  get children() { return [this.documentElement]; }
  get activeElement() { return this._active && this._active.isConnected ? this._active : this.body; }
  createElement(tag) { return new Element(tag); }
  createElementNS(ns, tag) { return new Element(tag); }
  querySelector(sel) { return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return [...(this.documentElement.matches(sel) ? [this.documentElement] : []), ...this.documentElement.querySelectorAll(sel)]; }
  getElementById(id) { return this.querySelector('#' + id); }
  contains(n) { return this.documentElement.contains(n); }
}

export class MutationObserver {
  constructor(cb) { this._cb = cb; this._targets = []; this._records = []; this._scheduled = false; }
  observe(node, opts = {}) { this._targets.push({ node, opts }); if (!observers.includes(this)) observers.push(this); }
  disconnect() { this._targets = []; observers = observers.filter(o => o !== this); this._records = []; }
  takeRecords() { const r = this._records; this._records = []; return r; }
  _queue(rec) {
    this._records.push(rec);
    if (this._scheduled) return;
    this._scheduled = true;
    queueMicrotask(() => { this._scheduled = false; const r = this.takeRecords(); if (r.length) this._cb(r, this); });
  }
}

// el('a', { href: 'channel/UC1', class: 'x' }, 'text', el(...)); attrs with value
// false/null/undefined are skipped, true sets an empty attribute; a 'props' key
// holds plain properties to assign (e.g. { props: { duration: 200 } } on a video).
export function el(tag, attrs = {}, ...children) {
  const e = new Element(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'props') { Object.assign(e, v); continue; }
    if (k === 'style') { Object.assign(e.style, v); continue; }
    if (v === false || v == null) continue;
    e._attrs.set(k.toLowerCase(), v === true ? '' : String(v));
  }
  e.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false));
  return e;
}

// A document whose body holds the given elements. Mutations made while building
// are not reported (observers attach later).
export function makeDocument(...bodyChildren) {
  const doc = new Document();
  doc.body.append(...bodyChildren.flat());
  return doc;
}

// Parse simple, well-formed HTML (like extension/popup/popup.html) into a document.
// The <body>'s children become the document body; <head>, scripts and comments are
// dropped. Inputs and selects get their value/checked properties from the markup.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parseHTML(html) {
  const doc = new Document();
  const root = new Element('root');
  const stack = [root];
  let skip = null; // inside <head>, <script> or <style>
  const token = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  for (const m of html.matchAll(token)) {
    const [, close, open, attrText, selfClose, text] = m;
    if (close) {
      const tag = close.toLowerCase();
      if (skip) { if (tag === skip) skip = null; continue; }
      if (tag === 'html' || tag === 'body') continue;
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === tag) { stack.length = i; break; }
    } else if (open) {
      const tag = open.toLowerCase();
      if (skip) continue;
      if (tag === 'head' || tag === 'script' || tag === 'style') { skip = tag; continue; }
      if (tag === 'html' || tag === 'body') continue;
      const e = new Element(tag);
      for (const a of (attrText || '').matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        e._attrs.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
      }
      stack[stack.length - 1].childNodes.push(e);
      e.parentNode = stack[stack.length - 1];
      if (!VOID.has(tag) && !selfClose) stack.push(e);
    } else if (text && !skip) {
      const parent = stack[stack.length - 1];
      const n = new Text(decode(text));
      n.parentNode = parent;
      parent.childNodes.push(n);
    }
  }
  doc.body.append(...root.childNodes.slice());
  for (const e of doc.querySelectorAll('input, select, textarea')) {
    if (e.localName === 'select') {
      const opts = e.querySelectorAll('option');
      const sel = opts.find(o => o.hasAttribute('selected')) || opts[0];
      e.value = sel ? (sel.getAttribute('value') ?? sel.textContent) : '';
    } else {
      e.value = e.getAttribute('value') ?? '';
      e.checked = e.hasAttribute('checked');
    }
  }
  return doc;
}
