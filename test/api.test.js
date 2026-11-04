'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

let server, base, dataDir;
const PIN = '4321';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function req(method, p, body, pin = PIN) {
  return fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(pin ? { 'X-Cafe-Pin': pin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cake-'));
  const app = createApp({ dataDir, pin: PIN });
  server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('rejects requests without the PIN', async () => {
  assert.equal((await req('GET', '/api/items', null, '')).status, 401);
  assert.equal((await req('GET', '/api/items', null, 'nope')).status, 401);
  assert.equal((await req('GET', '/api/config')).status, 200);
});

test('serves the app shell', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Cake &amp; Fruit Tracker/);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
});

test('seeds default shelf-life presets', async () => {
  const presets = await (await req('GET', '/api/presets')).json();
  assert.ok(presets.some((p) => p.name === 'Carrot cake' && p.days === 3));
});

test('logs, edits, bins and restores an item', async () => {
  const opened = new Date().toISOString();
  const expires = new Date(Date.now() + 2 * 86400000).toISOString();
  let res = await req('POST', '/api/items', { name: 'Carrot cake', category: 'cake', openedAt: opened, expiresAt: expires, loggedBy: 'Sam', photo: PNG });
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.status, 'active');
  assert.ok(item.photo);
  assert.equal((await fetch(`${base}/photos/${item.photo}`)).status, 401);
  assert.equal((await fetch(`${base}/photos/${item.photo}?pin=${PIN}`)).status, 200);

  res = await req('PATCH', `/api/items/${item.id}`, { notes: 'top shelf' });
  assert.equal((await res.json()).notes, 'top shelf');

  res = await req('PATCH', `/api/items/${item.id}`, { status: 'binned', by: 'Alex' });
  const binned = await res.json();
  assert.equal(binned.status, 'binned');
  assert.equal(binned.closedBy, 'Alex');

  const active = await (await req('GET', '/api/items')).json();
  assert.ok(!active.some((i) => i.id === item.id));

  res = await req('PATCH', `/api/items/${item.id}`, { status: 'active' });
  assert.equal((await res.json()).closedAt, null);
});

test('fruit can be logged as delivered and put out later', async () => {
  const res = await req('POST', '/api/items', { name: 'Bananas', category: 'fruit', deliveredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const item = await res.json();
  assert.equal(item.openedAt, null);
  const out = await (await req('PATCH', `/api/items/${item.id}`, { openedAt: new Date().toISOString() })).json();
  assert.ok(out.openedAt);
});

test('validates input', async () => {
  assert.equal((await req('POST', '/api/items', { name: '', expiresAt: new Date().toISOString(), openedAt: new Date().toISOString() })).status, 400);
  assert.equal((await req('POST', '/api/items', { name: 'Cake', expiresAt: new Date().toISOString() })).status, 400);
  assert.equal((await req('POST', '/api/items', { name: 'Cake', openedAt: 'garbage', expiresAt: new Date().toISOString() })).status, 400);
  assert.equal((await req('POST', '/api/presets', { name: 'X', days: 0 })).status, 400);
});

test('persists to disk', async () => {
  await req('POST', '/api/presets', { name: 'Coffee & walnut', category: 'cake', days: 3 });
  await new Promise((r) => setTimeout(r, 50));
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.ok(db.presets.some((p) => p.name === 'Coffee & walnut'));
});
