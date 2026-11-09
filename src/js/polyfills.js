// Newer browser features PDF.js uses, for engines that don't have them yet: Android phones whose system WebView is
// a few versions behind (and older Macs). Each is only added when missing. Loaded before everything else, and
// inside PDF.js's worker too (pdf-worker.mjs).
(() => {
  const def = (obj, name, fn) => { if (obj && !(name in obj)) Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true }); };
  def(URL, 'parse', (url, base) => { try { return new URL(url, base); } catch { return null; } });
  def(URL, 'canParse', (url, base) => { try { new URL(url, base); return true; } catch { return false; } });
  def(Promise, 'withResolvers', function () { let resolve, reject; const promise = new this((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; });
  def(Promise, 'try', function (fn, ...args) { return new this(resolve => resolve(fn(...args))); });
  for (const M of [Map, WeakMap]) {
    def(M.prototype, 'getOrInsert', function (key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); });
    def(M.prototype, 'getOrInsertComputed', function (key, make) { if (!this.has(key)) this.set(key, make(key)); return this.get(key); });
  }
  def(Math, 'sumPrecise', items => { let sum = 0, fix = 0; for (const x of items) { const y = x - fix, t = sum + y; fix = (t - sum) - y; sum = t; } return sum; });
  def(Uint8Array.prototype, 'toHex', function () { let s = ''; for (const b of this) s += b.toString(16).padStart(2, '0'); return s; });
  def(Uint8Array.prototype, 'toBase64', function () { let s = ''; for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000)); return btoa(s); });
  def(Uint8Array, 'fromBase64', s => { const bin = atob(String(s).replace(/[\s]/g, '').replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; });
  def(Uint8Array, 'fromHex', s => { const out = new Uint8Array(s.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16); return out; });
  def(ArrayBuffer.prototype, 'transferToFixedLength', function (length = this.byteLength) { const out = new ArrayBuffer(length); new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(length, this.byteLength))); return out; });
  def(ArrayBuffer.prototype, 'transfer', function (length = this.byteLength) { return this.transferToFixedLength(length); });
  if (typeof Response !== 'undefined') def(Response.prototype, 'bytes', async function () { return new Uint8Array(await this.arrayBuffer()); });
  if (typeof Blob !== 'undefined') def(Blob.prototype, 'bytes', async function () { return new Uint8Array(await this.arrayBuffer()); });
  def(Array.prototype, 'findLast', function (fn, that) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(that, this[i], i, this)) return this[i]; });
  def(Array.prototype, 'findLastIndex', function (fn, that) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(that, this[i], i, this)) return i; return -1; });
})();
