'use strict';
// Supabase backend: used when config.js has a Supabase URL and key.
// It answers the same routes as server.js ('/api/items', '/api/presets'), so app.js
// doesn't need to know which backend it is talking to.

const SupaBackend = (() => {
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
  const cfg = window.CAKE_CONFIG || {};
  const demoForced = new URLSearchParams(location.search).has('demo');
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseKey) && !demoForced;
  let client = null;
  const signed = new Map(); // photo path -> { url, until }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Couldn't load Supabase – check the internet connection"));
      document.head.appendChild(s);
    });
  }

  async function db() {
    if (client) return client;
    if (!window.supabase) await loadScript(LIB);
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return client;
  }

  // ---------- auth ----------
  async function session() {
    const c = await db();
    const { data } = await c.auth.getSession();
    return data.session;
  }
  async function signIn(email, password) {
    const c = await db();
    const { error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong email or password' : error.message);
    const { data: ok, error: e2 } = await c.rpc('is_staff');
    if (e2) throw new Error(e2.message);
    if (!ok) {
      await c.auth.signOut();
      throw new Error("This login isn't on the staff list (see README, step 4)");
    }
  }
  async function signOut() {
    const c = await db();
    await c.auth.signOut();
    signed.clear();
  }

  // ---------- mapping ----------
  const toItem = (r) => ({
    id: r.id, name: r.name, category: r.category,
    deliveredAt: r.delivered_at, openedAt: r.opened_at, defrostedAt: r.defrosted_at ?? null, expiresAt: r.expires_at,
    notes: r.notes, loggedBy: r.logged_by, photo: r.photo, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, closedBy: r.closed_by,
  });
  const toRow = (i, before) => {
    const row = {
      name: i.name, category: i.category,
      delivered_at: i.deliveredAt, opened_at: i.openedAt, expires_at: i.expiresAt,
      notes: i.notes, logged_by: i.loggedBy,
    };
    // Only send defrosted_at when it's used, so the app keeps working on a database
    // that hasn't had the defrost update (supabase/002_defrosted.sql) yet.
    if (i.defrostedAt || before?.defrostedAt) row.defrosted_at = i.defrostedAt || null;
    return row;
  };

  function check({ data, error }) {
    if (!error) return data;
    if (error.code === 'PGRST301' || /JWT|not authenticated/i.test(error.message)) throw new Error('LOGIN_NEEDED');
    if (/defrosted_at/.test(error.message)) throw new Error('The database needs the defrost update first – ask the manager to run supabase/002_defrosted.sql in Supabase.');
    throw new Error(error.message);
  }

  // ---------- photos ----------
  async function uploadPhoto(dataUrl) {
    if (!dataUrl) return null;
    const c = await db();
    const blob = await (await fetch(dataUrl)).blob();
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    check(await c.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg' }));
    return path;
  }
  async function removePhoto(path) {
    if (!path) return;
    const c = await db();
    await c.storage.from('photos').remove([path]); // best effort
    signed.delete(path);
  }
  // Photos are private, so each one needs a short-lived signed link.
  async function signPhotos(items) {
    const now = Date.now();
    const need = [...new Set(items.map((i) => i.photo).filter((p) => p && !(signed.get(p)?.until > now + 60000)))];
    if (!need.length) return;
    const c = await db();
    const { data, error } = await c.storage.from('photos').createSignedUrls(need, 3600);
    if (error || !data) return;
    data.forEach((d) => { if (d.signedUrl) signed.set(d.path, { url: d.signedUrl, until: now + 3600000 }); });
  }
  const photoUrl = (path) => signed.get(path)?.url || '';

  // ---------- routes ----------
  async function api(path, opts = {}) {
    const c = await db();
    const url = new URL(path, 'http://x');
    const [, kind, id] = url.pathname.split('/').filter(Boolean);
    const method = opts.method || 'GET';
    const body = opts.body || {};
    const now = new Date().toISOString();

    if (kind === 'config') return { ok: true };

    if (kind === 'items') {
      if (!id && method === 'GET') {
        const status = url.searchParams.get('status') || 'active';
        let q = c.from('items').select('*');
        // History only needs closed items, newest first.
        q = status === 'all' ? q.neq('status', 'active').order('closed_at', { ascending: false }).limit(300)
          : q.eq('status', status).order('expires_at');
        return check(await q).map(toItem);
      }
      if (!id && method === 'POST') {
        const fields = localValidate(body); // same rules as the other backends (app.js)
        const photo = await uploadPhoto(body.photo);
        const row = check(await c.from('items').insert({ ...toRow(fields), photo }).select().single());
        return toItem(row);
      }
      const current = check(await c.from('items').select('*').eq('id', id).maybeSingle());
      if (!current) throw new Error('Item not found – someone may have deleted it');
      const item = toItem(current);

      if (method === 'PATCH') {
        const update = { updated_at: now };
        if (body.status !== undefined) {
          update.status = body.status;
          update.closed_at = body.status === 'active' ? null : now;
          update.closed_by = body.status === 'active' ? '' : String(body.by || '').slice(0, 40);
        }
        const editable = ['name', 'category', 'deliveredAt', 'openedAt', 'defrostedAt', 'expiresAt', 'notes', 'loggedBy'];
        if (editable.some((k) => body[k] !== undefined)) Object.assign(update, toRow(localValidate(body, item), item));
        if (body.photo !== undefined) {
          update.photo = body.photo ? await uploadPhoto(body.photo) : null;
          await removePhoto(item.photo);
        }
        return toItem(check(await c.from('items').update(update).eq('id', id).select().single()));
      }
      if (method === 'DELETE') {
        check(await c.from('items').delete().eq('id', id));
        await removePhoto(item.photo);
        return null;
      }
    }

    if (kind === 'presets') {
      if (!id && method === 'GET') return check(await c.from('presets').select('*').order('name'));
      if (!id && method === 'POST') return check(await c.from('presets').insert(localPreset(body)).select().single());
      if (method === 'PUT') return check(await c.from('presets').update(localPreset(body)).eq('id', id).select().single());
      if (method === 'DELETE') { check(await c.from('presets').delete().eq('id', id)); return null; }
    }
    throw new Error('Not found');
  }

  // Tell us when anyone changes an item, so every phone updates straight away.
  async function onChange(cb) {
    const c = await db();
    c.channel('items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, cb)
      .subscribe();
  }

  return { enabled, demoForced, cfg, session, signIn, signOut, api, signPhotos, photoUrl, onChange };
})();
