# Auto WhatsApp Messager

Send **one message to a list of contacts automatically**, with human-like delays
between each — through **WhatsApp Web**, with **no API and no cost**. Ships as a
**single portable `.exe`** you can copy to any Windows laptop.

You link it to your phone once (scan a QR code, exactly like WhatsApp Web in a
browser). After that, paste your numbers, type your message, and hit send.

The interface is available in **English and Arabic** (with full right-to-left
layout). Switch languages from the button in the top corner.

---

## For the person just using it (any Windows laptop)

1. Copy **`AutoWhatsAppMessager-1.0.0.exe`** to the laptop (from the `dist/` folder).
2. Double-click it. A window opens — no install needed.
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**, and
   scan the QR code shown in the app.
4. Once it says **Connected**, fill in the form and click **Send messages**.

Your login stays saved on that laptop, so you only scan the first time.

### Number format
- One number **per line**, including the **country code**, no `+` needed:
  ```
  905551234567
  15551234567, Sara
  447700900123, Tom
  ```
- Optionally add a **name after a comma** to personalize. Put `{name}` in your
  message and it gets replaced:
  ```
  Hey {name}! Study group moved to 3pm tomorrow 📚
  ```
- The **delay** (min/max seconds) is a random pause between each message so it
  looks natural. Keep it at a few seconds or more.

---

## For running / building it yourself

```bash
npm install          # installs deps + a bundled Chromium (large, one time)

npm run dev          # run the desktop app (Electron) in development
npm start            # OR run just the web engine at http://localhost:3000
npm run dist         # build the portable .exe → dist/AutoWhatsAppMessager-1.0.0.exe
```

- `server.js` — the engine: a small local server that drives WhatsApp Web via
  `whatsapp-web.js` (Puppeteer) and exposes the send API + live progress.
- `main.js` — the Electron shell: boots the engine and shows the dashboard.
- `public/index.html` — the dashboard UI.

### Building for Mac
`npm run dist` builds Windows. A Mac `.app`/`.dmg` must be built **on a Mac**
(`npx electron-builder --mac`).

---

## ⚠️ Please use responsibly

WhatsApp's terms **discourage automated / bulk messaging**. For a handful of
friends who expect your message, with real delays, the risk is low — but sending
to large lists or to people who didn't opt in can get your number **temporarily
limited or banned**. This project randomizes delays to stay human-like; keep
lists small and messages relevant. You are responsible for how you use it.

No message content or numbers are sent anywhere except to WhatsApp itself — there
is no server or account behind this app.
