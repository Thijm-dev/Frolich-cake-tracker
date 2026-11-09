// Frolich Cake Tracker – a tiny, dependency-free server.
// Stores everything in DATA_DIR/db.json and photos in DATA_DIR/photos.
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (photos are resized in the browser first)

const DEFAULT_PRESETS = [
  { name: 'Victoria sponge', category: 'cake', days: 3 },
  { name: 'Carrot cake', category: 'cake', days: 3 },
  { name: 'Chocolate cake', category: 'cake', days: 3 },
  { name: 'Lemon drizzle', category: 'cake', days: 3 },
  { name: 'Brownies', category: 'cake', days: 4 },
  { name: 'Cheesecake', category: 'cake', days: 2 },
  { name: 'Bananas', category: 'fruit', days: 5 },
  { name: 'Apples', category: 'fruit', days: 7 },
  { name: 'Oranges', category: 'fruit', days: 7 },
  { name: 'Berries', category: 'fruit', days: 2 },
  { name: 'Cut fruit / fruit pot', category: 'fruit', days: 1 },
  { name: 'Lemons & limes (cut)', category: 'fruit', days: 2 },
];

const CATEGORIES = ['cake', 'fruit', 'other'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'data');
  const pin = options.pin !== undefined ? options.pin : process.env.CAFE_PIN || '';
  const dbFile = path.join(dataDir, 'db.json');
  const photoDir = path.join(dataDir, 'photos');

  fs.mkdirSync(photoDir, { recursive: true });

  let db;
  try {
    db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  } catch {
    db = { items: [], presets: DEFAULT_PRESETS.map((p) => ({ id: newId(), ...p })) };
  }
  db.items ||= [];
  db.presets ||= [];

  // Serialised, atomic writes so concurrent requests can't corrupt the file.
  let writeChain = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify(db, null, 2);
    writeChain = writeChain.then(async () => {
      const tmp = dbFile + '.tmp';
      await fsp.writeFile(tmp, snapshot);
      await fsp.rename(tmp, dbFile);
    });
    return writeChain;
  }

  async function savePhoto(dataUrl) {
    if (!dataUrl) return null;
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw httpError(400, 'Photo must be a JPEG, PNG or WebP image');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = `${newId()}.${ext}`;
    await fsp.writeFile(path.join(photoDir, file), Buffer.from(m[2], 'base64'));
    return file;
  }

  async function deletePhoto(file) {
    if (!file) return;
    await fsp.rm(path.join(photoDir, path.basename(file)), { force: true });
  }

  function validateItem(input, existing) {
    const out = {};
    const name = str(input.name ?? existing?.name, 80);
    if (!name) throw httpError(400, 'Name is required');
    out.name = name;

    const category = input.category ?? existing?.category ?? 'other';
    if (!CATEGORIES.includes(category)) throw httpError(400, 'Unknown category');
    out.category = category;

    out.deliveredAt = isoOrNull(input.deliveredAt !== undefined ? input.deliveredAt : existing?.deliveredAt, 'Delivered time');
    out.openedAt = isoOrNull(input.openedAt !== undefined ? input.openedAt : existing?.openedAt, 'Put out / opened time');
    out.defrostedAt = isoOrNull(input.defrostedAt !== undefined ? input.defrostedAt : existing?.defrostedAt, 'Defrosted time');
    if (!out.deliveredAt && !out.openedAt && !out.defrostedAt) throw httpError(400, 'Enter when it was delivered, defrosted or put out / opened');

    out.expiresAt = isoOrNull(input.expiresAt ?? existing?.expiresAt, 'Throw-away time');
    if (!out.expiresAt) throw httpError(400, 'Throw-away date is required');

    out.notes = str(input.notes ?? existing?.notes, 500);
    out.loggedBy = str(input.loggedBy ?? existing?.loggedBy, 40);
    return out;
  }

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const method = req.method;

    if (pin) {
      const given = req.headers['x-cafe-pin'] || '';
      if (!safeEqual(String(given), pin)) return send(res, 401, { error: 'Wrong or missing cafe PIN' });
    }

    // GET /api/config — lets the client check its PIN works
    if (parts[1] === 'config' && method === 'GET') {
      return send(res, 200, { ok: true, categories: CATEGORIES });
    }

    // Items
    if (parts[1] === 'items') {
      const id = parts[2];
      if (!id && method === 'GET') {
        const status = url.searchParams.get('status') || 'active';
        let items = db.items;
        if (status !== 'all') items = items.filter((i) => i.status === status);
        return send(res, 200, items);
      }
      if (!id && method === 'POST') {
        const body = await readJson(req);
        const fields = validateItem(body);
        const item = {
          id: newId(),
          ...fields,
          photo: await savePhoto(body.photo),
          status: 'active',
          createdAt: new Date().toISOString(),
          closedAt: null,
          closedBy: '',
        };
        db.items.push(item);
        await save();
        return send(res, 201, item);
      }
      const item = db.items.find((i) => i.id === id);
      if (!item) return send(res, 404, { error: 'Item not found' });

      if (method === 'GET') return send(res, 200, item);

      if (method === 'PATCH') {
        const body = await readJson(req);
        if (body.status !== undefined) {
          if (!['active', 'binned', 'used'].includes(body.status)) throw httpError(400, 'Unknown status');
          item.status = body.status;
          item.closedAt = body.status === 'active' ? null : new Date().toISOString();
          item.closedBy = body.status === 'active' ? '' : str(body.by, 40);
        }
        const editable = ['name', 'category', 'deliveredAt', 'openedAt', 'defrostedAt', 'expiresAt', 'notes', 'loggedBy'];
        if (editable.some((k) => body[k] !== undefined)) Object.assign(item, validateItem(body, item));
        if (body.photo !== undefined) {
          await deletePhoto(item.photo);
          item.photo = body.photo ? await savePhoto(body.photo) : null;
        }
        item.updatedAt = new Date().toISOString();
        await save();
        return send(res, 200, item);
      }

      if (method === 'DELETE') {
        db.items = db.items.filter((i) => i.id !== id);
        await deletePhoto(item.photo);
        await save();
        return send(res, 204);
      }
    }

    // Presets (common cakes / fruit with their shelf life)
    if (parts[1] === 'presets') {
      const id = parts[2];
      if (!id && method === 'GET') return send(res, 200, db.presets);
      if (!id && method === 'POST') {
        const body = await readJson(req);
        const preset = validatePreset(body);
        preset.id = newId();
        db.presets.push(preset);
        await save();
        return send(res, 201, preset);
      }
      const idx = db.presets.findIndex((p) => p.id === id);
      if (idx === -1) return send(res, 404, { error: 'Preset not found' });
      if (method === 'PUT') {
        const preset = { ...validatePreset(await readJson(req)), id };
        db.presets[idx] = preset;
        await save();
        return send(res, 200, preset);
      }
      if (method === 'DELETE') {
        db.presets.splice(idx, 1);
        await save();
        return send(res, 204);
      }
    }

    return send(res, 404, { error: 'Not found' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        // Allow the app hosted elsewhere (e.g. GitHub Pages) to use this server. The PIN still protects it.
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cafe-Pin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') return send(res, 204);
        return await handleApi(req, res, url);
      }

      if (url.pathname.startsWith('/photos/')) {
        // Photos are only viewable with the PIN (sent as ?pin= because <img> can't send headers)
        if (pin && !safeEqual(url.searchParams.get('pin') || '', pin)) return send(res, 401, { error: 'PIN required' });
        return await serveFile(res, path.join(photoDir, path.basename(url.pathname)), true);
      }

      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
      return await serveFile(res, file);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      return send(res, status, { error: status === 500 ? 'Server error' : err.message });
    }
  }

  return { handle, db, flush: () => writeChain };
}

// ---------- helpers ----------

function validatePreset(body) {
  const name = str(body.name, 80);
  if (!name) throw httpError(400, 'Preset name is required');
  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 60) throw httpError(400, 'Shelf life must be 1–60 days');
  return { name, category, days };
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function str(v, max) {
  return v == null ? '' : String(v).trim().slice(0, max);
}

function isoOrNull(v, label) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpError(400, `${label} is not a valid date`);
  return d.toISOString();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Upload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(httpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveFile(res, file, immutable = false) {
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    return send(res, 404, { error: 'Not found' });
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': immutable ? 'private, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
}

module.exports = { createApp };

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  http.createServer(app.handle).listen(port, () => {
    console.log(`Frolich Cake Tracker running on http://localhost:${port}`);
    if (!process.env.CAFE_PIN) console.log('Tip: set CAFE_PIN=1234 to require a staff PIN.');
  });
}
