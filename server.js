// Auto WhatsApp Messager — core engine.
// Runs a small local web server + drives WhatsApp Web (no official API).
// Exposed as start() so the Electron desktop shell can boot it; also runnable
// directly with `node server.js` for development.
//
// Log events are emitted as { code, data } so the UI can show them in either
// English or Arabic. See public/index.html for the message templates.

const path = require('path');
const fs = require('fs');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

function start(options = {}) {
  const PORT = options.port || process.env.PORT || 3000;
  const DATA_PATH = options.dataPath || process.env.WA_DATA_PATH || path.join(__dirname, '.wwebjs_auth');
  const HEADLESS = process.env.HEADLESS !== 'false';

  const app = express();
  app.use(express.json({ limit: '32mb' })); // room for a base64 image/file attachment
  app.use(express.static(path.join(__dirname, 'public')));

  // -------------------------------------------------------------------------
  // State + WhatsApp client
  //
  // The client is rebuildable: logging out or losing the connection tears it
  // down and starts a fresh one, so the UI recovers to a QR (or reconnects)
  // instead of getting stuck in a stale state.
  // -------------------------------------------------------------------------
  let clientState = 'starting'; // starting | qr | authenticating | ready | disconnected | auth_failure
  let qrDataUrl = null;
  let client = null;
  let manualLogout = false;
  let reconnectTimer = null;
  let lastReady = false; // true only after a successful connection, so we never auto-reconnect mid-login

  function buildClient() {
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
      puppeteer: {
        headless: HEADLESS,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    client.on('qr', async (qr) => {
      clientState = 'qr';
      qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
      broadcastState();
      log('info', 'qr_ready');
    });
    client.on('authenticated', () => {
      clientState = 'authenticating';
      qrDataUrl = null;
      broadcastState();
      log('info', 'authenticated');
    });
    client.on('auth_failure', (msg) => {
      clientState = 'auth_failure';
      broadcastState();
      log('error', 'auth_failed', { msg: String(msg) });
    });
    client.on('ready', () => {
      clientState = 'ready';
      qrDataUrl = null;
      lastReady = true;
      broadcastState();
      log('success', 'ready');
    });
    client.on('disconnected', (reason) => {
      qrDataUrl = null;
      clientState = 'disconnected';
      broadcastState();
      if (manualLogout) return; // logout/refresh flows rebuild on their own
      log('error', 'disconnected', { reason: String(reason) });
      // Only auto-reconnect a connection that was actually live. A disconnect
      // during the QR/scan phase must NOT trigger a rebuild, or it aborts login.
      const wasReady = lastReady;
      lastReady = false;
      if (wasReady && !reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; reconnect(); }, 3000);
      }
    });

    client.initialize().catch((err) => {
      clientState = 'disconnected';
      log('error', 'wa_start_failed', { msg: err.message });
      broadcastState();
    });
  }

  async function reconnect() {
    log('info', 'reconnecting');
    clientState = 'starting';
    qrDataUrl = null;
    lastReady = false;
    broadcastState();
    try { if (client) await client.destroy(); } catch (e) {}
    buildClient();
  }

  // Delete the saved session so the next QR links cleanly. Retries a few times
  // because Windows can briefly hold file locks after the browser closes.
  async function clearSession() {
    for (let i = 0; i < 6; i++) {
      try { fs.rmSync(DATA_PATH, { recursive: true, force: true }); return true; }
      catch (e) { await new Promise((r) => setTimeout(r, 600)); }
    }
    return false;
  }

  // Full reset: tear down the client, wipe any stale/half-linked session, and
  // start fresh so a working QR appears. Backs the "Refresh QR" button.
  async function refresh({ clear }) {
    manualLogout = true; // suppress the auto-reconnect path during teardown
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    clientState = 'starting';
    qrDataUrl = null;
    lastReady = false;
    broadcastState();
    try { if (client) await client.destroy(); } catch (e) {}
    if (clear) await clearSession();
    manualLogout = false;
    buildClient();
  }

  buildClient();

  // -------------------------------------------------------------------------
  // Live updates (Server-Sent Events)
  // -------------------------------------------------------------------------
  const sseClients = new Set();

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);
    send(res, { type: 'state', state: clientState, qr: qrDataUrl });
    send(res, { type: 'job', job: jobSnapshot() });
    req.on('close', () => sseClients.delete(res));
  });

  function send(res, payload) {
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
  }
  function broadcast(payload) {
    for (const res of sseClients) send(res, payload);
  }
  function broadcastState() {
    broadcast({ type: 'state', state: clientState, qr: qrDataUrl });
  }
  function log(level, code, data = {}) {
    broadcast({ type: 'log', level, code, data, time: Date.now() });
    console.log(`[${level}] ${code}`, data);
  }

  // -------------------------------------------------------------------------
  // Sending job
  // -------------------------------------------------------------------------
  let job = null; // { total, sent, failed, done, running, stop }

  function jobSnapshot() {
    if (!job) return { running: false, sent: 0, failed: 0, total: 0, done: true };
    return { running: job.running, sent: job.sent, failed: job.failed, total: job.total, done: job.done };
  }
  function broadcastJob() {
    broadcast({ type: 'job', job: jobSnapshot() });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // "+90 555 123 45 67"  or  "905551234567, Ahmet"  or  "905551234567 | Ahmet"
  function parseLine(line) {
    const parts = line.split(/[,|]/);
    const digits = (parts[0] || '').replace(/\D/g, ''); // digits only; country code required
    const name = (parts[1] || '').trim();
    return { digits, name };
  }

  // Fill {name}. With no name, drop the placeholder AND tidy the leftover
  // space/punctuation so "Hi {name}!" becomes "Hi!" (not "Hi  !").
  function personalize(message, name) {
    if (name) return message.replace(/\{name\}/gi, name);
    return message
      .replace(/\s*\{name\}\s*/gi, ' ')
      .replace(/[ \t]+([,.!?;:،؛])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  app.post('/api/send', async (req, res) => {
    if (clientState !== 'ready') return res.status(409).json({ error: 'not_connected' });
    if (job && job.running) return res.status(409).json({ error: 'already_running' });

    const message = (req.body.message || '').toString();
    const att = req.body.attachment; // { data: base64 (no prefix), mimetype, filename } | undefined
    let minDelay = Number(req.body.minDelaySec);
    let maxDelay = Number(req.body.maxDelaySec);
    if (!Number.isFinite(minDelay) || minDelay < 1) minDelay = 4;
    if (!Number.isFinite(maxDelay) || maxDelay < minDelay) maxDelay = minDelay + 4;

    const contacts = (req.body.numbers || '')
      .toString()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parseLine)
      .filter((c) => c.digits.length >= 7);

    if (!message.trim() && !(att && att.data)) return res.status(400).json({ error: 'empty_message' });
    if (contacts.length === 0) return res.status(400).json({ error: 'no_numbers' });

    // Build the attachment once and reuse it for every contact.
    let media = null;
    let asDocument = false;
    if (att && att.data && att.mimetype) {
      media = new MessageMedia(att.mimetype, att.data, att.filename || 'file');
      asDocument = !/^image\//.test(att.mimetype) && !/^video\//.test(att.mimetype);
    }

    job = { total: contacts.length, sent: 0, failed: 0, done: false, running: true, stop: false };
    res.json({ ok: true, total: contacts.length });

    log('info', 'job_start', { count: contacts.length, min: minDelay, max: maxDelay });
    broadcastJob();

    for (let i = 0; i < contacts.length; i++) {
      if (job.stop) { log('info', 'stopped_by_user'); break; }
      const { digits, name } = contacts[i];
      const personalized = personalize(message, name);
      const label = name ? `${name} (${digits})` : digits;

      try {
        const numberId = await client.getNumberId(digits); // validates + returns correct chat id
        if (!numberId) {
          job.failed++;
          log('error', 'not_on_wa', { label });
        } else {
          if (media) {
            await client.sendMessage(numberId._serialized, media, { caption: personalized, sendMediaAsDocument: asDocument });
          } else {
            await client.sendMessage(numberId._serialized, personalized);
          }
          job.sent++;
          log('success', 'sent_ok', { label });
        }
      } catch (err) {
        job.failed++;
        log('error', 'send_error', { label, err: err.message });
      }
      broadcastJob();

      if (i < contacts.length - 1 && !job.stop) {
        const wait = Math.round((minDelay + Math.random() * (maxDelay - minDelay)) * 1000);
        log('info', 'waiting', { sec: (wait / 1000).toFixed(1) });
        await sleep(wait);
      }
    }

    job.running = false;
    job.done = true;
    broadcastJob();
    log('success', 'finished', { sent: job.sent, failed: job.failed, total: job.total });
  });

  app.post('/api/stop', (req, res) => {
    if (job && job.running) {
      job.stop = true;
      log('info', 'stopping');
      return res.json({ ok: true });
    }
    res.json({ ok: false, error: 'nothing_running' });
  });

  app.post('/api/logout', async (req, res) => {
    log('info', 'logged_out');
    try { if (client) await client.logout(); } catch (e) {} // unlink on WhatsApp's side
    await refresh({ clear: true }); // wipe local session, rebuild -> fresh QR
    res.json({ ok: true });
  });

  // Refresh QR: full clean reset so a working QR appears (also clears a stale
  // or half-linked session that blocks logging in).
  app.post('/api/refresh', async (req, res) => {
    log('info', 'refreshing');
    await refresh({ clear: clientState !== 'ready' });
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Browse chats + pull numbers from groups
  //
  // We read WhatsApp Web's internal store directly instead of the library's
  // getChats()/getChatById(), because those serialize the whole chat (channels,
  // communities, last messages) and throw on some accounts. We also convert the
  // new @lid member ids into real phone numbers with toPn().
  // -------------------------------------------------------------------------

  // List groups and contacts (lightweight: id, name, member count only).
  app.get('/api/chats', async (req, res) => {
    if (clientState !== 'ready') return res.status(409).json({ error: 'not_connected' });
    try {
      const list = await client.pupPage.evaluate(() => {
        const out = [];
        const Chat = window.require('WAWebCollections').Chat;
        for (const c of Chat.getModelsArray()) {
          try {
            if (!c.id || !c.id._serialized) continue;
            const server = c.id.server;
            if (server === 'newsletter' || c.id._serialized === 'status@broadcast') continue; // skip channels/status
            const isGroup = server === 'g.us';
            let count = 1;
            if (isGroup) {
              const p = c.groupMetadata && c.groupMetadata.participants;
              count = p ? (p.getModelsArray ? p.getModelsArray().length : (p.length || 0)) : 0;
            }
            out.push({
              id: c.id._serialized,
              name: c.formattedTitle || c.name || (c.contact && (c.contact.formattedName || c.contact.pushname)) || c.id.user,
              isGroup,
              count,
            });
          } catch (e) { /* skip a bad chat, keep the rest */ }
        }
        return out;
      });
      list.sort((a, b) => (b.isGroup - a.isGroup) || String(a.name).localeCompare(String(b.name)));
      res.json({ chats: list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Return the phone numbers inside one chat/group, converting @lid -> real number.
  app.get('/api/participants', async (req, res) => {
    if (clientState !== 'ready') return res.status(409).json({ error: 'not_connected' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const data = await client.pupPage.evaluate(async (chatId) => {
        const Collections = window.require('WAWebCollections');
        const Chat = Collections.Chat;
        const Contact = Collections.Contact;
        const { toPn } = window.require('WAWebLidMigrationUtils');

        let chat = null;
        try { chat = Chat.get(chatId); } catch (e) {}
        if (!chat) chat = Chat.getModelsArray().find((c) => c.id && c.id._serialized === chatId);
        if (!chat) return { error: 'not_found' };

        const title = chat.formattedTitle || chat.name || (chat.id && chat.id.user) || '';
        const toPhone = (wid) => {
          if (!wid) return null;
          if (wid.server === 'c.us') return wid;
          if (wid.server === 'lid') { try { return toPn(wid) || null; } catch (e) { return null; } }
          return null;
        };
        const nameFor = (pnWid, origWid) => {
          try {
            const c = (pnWid && Contact.get(pnWid._serialized)) || (origWid && Contact.get(origWid._serialized));
            if (c) return c.formattedName || c.pushname || c.name || c.verifiedName || '';
          } catch (e) {}
          return '';
        };

        // Individual chat -> single number.
        if (chat.id.server !== 'g.us') {
          const pn = toPhone(chat.id);
          if (!pn || !pn.user) return { group: title, members: [], hidden: 1 };
          return { group: title, members: [{ number: pn.user, id: pn._serialized, name: nameFor(pn, chat.id) || title }], hidden: 0 };
        }

        // Group -> make sure participants are loaded, then map each to a number.
        try {
          const wid = window.require('WAWebWidFactory').createWid(chat.id._serialized);
          const GM = Collections.GroupMetadata || Collections.WAWebGroupMetadataCollection;
          await GM.update(wid);
        } catch (e) {}

        const pc = chat.groupMetadata && chat.groupMetadata.participants;
        const parts = pc ? (pc.getModelsArray ? pc.getModelsArray() : pc) : [];
        const members = [];
        const seen = new Set();
        let hidden = 0;
        for (const part of parts) {
          const pn = toPhone(part.id);
          if (!pn || !pn.user) { hidden++; continue; }
          if (seen.has(pn.user)) continue;
          seen.add(pn.user);
          members.push({ number: pn.user, id: pn._serialized, name: nameFor(pn, part.id) });
        }
        return { group: title, members, hidden };
      }, id);

      if (data && data.error) return res.status(404).json({ error: data.error });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/status', (req, res) => res.json({ state: clientState, qr: qrDataUrl, job: jobSnapshot() }));

  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`\n  Auto WhatsApp Messager running:  http://localhost:${PORT}\n`);
      resolve({ server, port: PORT, url: `http://localhost:${PORT}`, client });
    });
  });
}

module.exports = { start };

// Allow `node server.js` for development.
if (require.main === module) start();
