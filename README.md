<h1 align="center">Auto WhatsApp Messager</h1>

<p align="center">Send one message to many contacts, with a natural pause between each. Through WhatsApp Web. No API, no cost.</p>

<p align="center">
  <a href="https://github.com/Mohammed3382/auto-whatsapp-messager/releases/download/v1.3.0/AutoWhatsAppMessager-Setup-1.3.0.exe">
    <img src="https://img.shields.io/badge/Download-Windows%20installer%20(.exe)-22c55e?style=for-the-badge&logo=windows&logoColor=white" alt="Download the Windows installer" height="46">
  </a>
</p>

<p align="center"><sub>Windows · one-click installer · desktop shortcut · English and Arabic</sub></p>

---

## How to use

1. Download and run the installer above. It installs the app, adds a **desktop shortcut**, and on future updates replaces the old version automatically. No admin rights needed.
2. Open the app. On your phone: WhatsApp → Settings → Linked Devices → Link a Device, then scan the QR code.
3. When it says Connected, load a group (or type numbers), write your message, and click Send.

You only scan once. Your login stays saved on the laptop, and updates keep it. If the code ever gets stuck, use the **Refresh QR** button to get a clean one.

You can also **attach an image or file** (up to 16 MB); it goes to each contact with your text as the caption.

### Pull numbers from your groups

The **Groups and contacts** section loads your WhatsApp groups once you are connected. Pick a group, select the members you want (or "Take first N"), and click Add to drop their numbers, already formatted with country code, into the recipients list. Some members are kept private by WhatsApp and cannot be added; the app tells you how many.

You can also add a name after a comma to personalize, like `905551234567, Ahmet`, and put `{name}` in your message.

---

## Is this safe? (and the Windows warning)

Yes. The app runs entirely on your computer. It talks only to WhatsApp Web, exactly like signing in at web.whatsapp.com. There is no server, no account, and nothing is sent anywhere else. The full source is in this repository.

When you run it, Windows may show **"Windows protected your PC."** This appears for every app that is not signed with a paid certificate. It is a caution about an *unknown publisher*, not a virus warning. To continue:

> Click **More info**, then **Run anyway**.

You only do this once. If you prefer, right-click the downloaded file → **Properties** → tick **Unblock** → OK, then run it.

**Verify your download (optional).** Check the file is genuine by comparing its SHA-256:

```powershell
Get-FileHash .\AutoWhatsAppMessager-Setup-1.3.0.exe -Algorithm SHA256
```

Expected:

```
1700CA620AF3A37E6E4DBC6442112452A60C877AFBCE65CD4D4D67A716CFC0A5
```

To remove the warning entirely you would need a code-signing certificate (an EV certificate gives zero warnings but costs money). For a personal tool, "Run anyway" is the normal path.

---

Please keep your list small and the delays human. WhatsApp limits automated bulk sending, and overusing it can get a number restricted.
