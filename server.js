// Auto WhatsApp Messager — core engine.
// Runs a small local web server + drives WhatsApp Web (no official API).
// Exposed as start() so the Electron desktop shell can boot it; also runnable
// directly with `node server.js` for development.
//
// Log events are emitted as { code, data } so the UI can show them in either
// English or Arabic. See public/index.html for the message templates.

const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

function start(options = {}) {
  const PORT = options.port || process.env.PORT || 3000;
  const DATA_PATH = options.dataPath || process.env.WA_DATA_PATH || path.join(__dirname, '.wwebjs_auth');
  const HEADLESS = process.env.HEADLESS !== 'false';

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // -------------------------------------------------------------------------
  // State + WhatsApp client
  // -------------------------------------------------------------------------
  let clientState = 'starting'; // starting | qr | authenticating | ready | disconnected | auth_failure
  let qrDataUrl = null;

  const client = new Client({
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
    broadcastState();
    log('success', 'ready');
  });
  client.on('disconnected', (reason) => {
    clientState = 'disconnected';
    qrDataUrl = null;
    broadcastState();
    log('error', 'disconnected', { reason: String(reason) });
  });

  client.initialize().catch((err) => {
    clientState = 'disconnected';
    log('error', 'wa_start_failed', { msg: err.message });
    broadcastState();
  });

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

  app.post('/api/send', async (req, res) => {
    if (clientState !== 'ready') return res.status(409).json({ error: 'not_connected' });
    if (job && job.running) return res.status(409).json({ error: 'already_running' });

    const message = (req.body.message || '').toString();
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

    if (!message.trim()) return res.status(400).json({ error: 'empty_message' });
    if (contacts.length === 0) return res.status(400).json({ error: 'no_numbers' });

    job = { total: contacts.length, sent: 0, failed: 0, done: false, running: true, stop: false };
    res.json({ ok: true, total: contacts.length });

    log('info', 'job_start', { count: contacts.length, min: minDelay, max: maxDelay });
    broadcastJob();

    for (let i = 0; i < contacts.length; i++) {
      if (job.stop) { log('info', 'stopped_by_user'); break; }
      const { digits, name } = contacts[i];
      const personalized = message.replace(/\{name\}/gi, name || '');
      const label = name ? `${name} (${digits})` : digits;

      try {
        const numberId = await client.getNumberId(digits); // validates + returns correct chat id
        if (!numberId) {
          job.failed++;
          log('error', 'not_on_wa', { label });
        } else {
          await client.sendMessage(numberId._serialized, personalized);
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
    try {
      await client.logout();
      clientState = 'disconnected';
      qrDataUrl = null;
      broadcastState();
      log('info', 'logged_out');
      res.json({ ok: true });
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
