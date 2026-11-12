# yaxb-box

yaxb-box is the YAXB kiosk's storage on your local network: a Raspberry Pi that keeps notebooks, conversations and the agent's long-term memory in one SQLite database. Litestream copies every change to a USB drive or network share within a second or so. It follows the same pattern as clinux-box.

The kiosk can keep its data in four places (Settings → Storage):

| Storage | Where it lives | Survives |
|---|---|---|
| This browser (IndexedDB) | the device's browser | a reload |
| This session only | memory | until the page closes (public kiosks) |
| **Local box** | **yaxb-box on this network** | **a new device, a new browser; backed up by Litestream** |
| Server (Cloudflare D1) | the Worker | 30 days; the agent's memory via Deep Agents' StoreBackend |

With **Local box**, the kiosk's browser talks to the box directly. That works whether the kiosk page comes from `localhost` or from Cloudflare, because the box is on the same network as the device, not the Worker. Each question still sends the notebook to the assistant as context, the same as with browser storage.

The CLI and a local server can use the box as well: set `YAXB_BOX_URL` and `YAXB_BOX_TOKEN`. Conversations then live on the box, and the agent's `/memories/` lives in the box's store through Deep Agents' `CompositeBackend` and `StoreBackend`.

## Install on the Pi (Pi 5, Raspberry Pi OS 64-bit)

From this repository on your computer:

```bash
node yaxb.mjs box-deploy --host <user>@192.168.1.14 --origins "http://localhost:3000 https://yaxb-web.<account>.workers.dev"
```

This packs `apps/box` and copies it to the Pi. On the Pi it runs `deploy/install.sh`, which:
- installs Node 24 and Litestream 0.5;
- creates the `yaxbbox` service user, `/etc/yaxb-box/yaxb-box.env` with a generated token, and a self-signed certificate;
- installs the systemd units.

You'll be asked for the Pi's SSH and sudo passwords. At the end it prints the **box URL** and the **token**. Re-running it upgrades in place; it never overwrites the env file, the certificate or the database.

`--origins` lists the kiosk addresses allowed to use the box from a browser. To change them later, edit `YAXB_BOX_ORIGINS` in `/etc/yaxb-box/yaxb-box.env`, then run `sudo systemctl restart yaxb-box`.

### Backup drive (Litestream)

The replica must be on a different disk from the SD card or SSD: a copy on the same card is lost with the card.

**USB drive** (ext4, labelled `YAXBBACKUP`):

```bash
sudo mkdir -p /mnt/yaxb-backup
echo 'LABEL=YAXBBACKUP /mnt/yaxb-backup ext4 defaults,nofail,x-systemd.device-timeout=10 0 2' | sudo tee -a /etc/fstab
sudo mount -a && sudo systemctl start litestream yaxb-box
```

**NFS share** on a NAS:

```bash
sudo apt-get install -y nfs-common && sudo mkdir -p /mnt/yaxb-backup
echo 'nas.local:/volume1/yaxb-backup /mnt/yaxb-backup nfs defaults,_netdev,nofail,hard 0 0' | sudo tee -a /etc/fstab
sudo mount -a && sudo systemctl start litestream yaxb-box
```

If the box starts with **no database and no mounted backup**, `restore-if-empty.sh` refuses to start rather than begin with an empty database. That situation is usually a replaced card whose backup drive isn't plugged in. To try the box before you have a drive: `sudo -u yaxbbox touch /var/lib/yaxb-box/yaxb-box.sqlite3 && sudo systemctl start yaxb-box`.

**Restore drill** (do this monthly):

```bash
sudo litestream restore -config /etc/litestream.yml -o /tmp/drill.sqlite3 /var/lib/yaxb-box/yaxb-box.sqlite3
sudo sqlite3 /tmp/drill.sqlite3 'SELECT collection, COUNT(*) FROM records GROUP BY collection;' && sudo rm /tmp/drill.sqlite3
```

## Trust the box on each device (once)

A kiosk page on https (Cloudflare) can only call an https box, and the box's certificate is self-signed. On each device, open `http://192.168.1.14:47871/`, download the certificate, then install and trust it:
- **Windows:** double-click it, then choose *Install Certificate → Local Machine → Trusted Root Certification Authorities*.
- **Android:** *Settings → Security → Encryption & credentials → Install a certificate → CA certificate*.
- **iPhone or iPad:** install the profile, then turn on *Settings → General → About → Certificate Trust Settings*.

Then, in the kiosk, go to **Settings → Storage → Local box**, enter `https://192.168.1.14:47870` and the token, and click **Test and connect**.

Give the Pi a DHCP reservation in your router so its address doesn't change; the certificate names that address.

## Run it on this computer (testing)

```bash
node yaxb.mjs box      # http://localhost:47870, prints the token; `node yaxb.mjs stop` stops it
```

## API

All JSON, with `Authorization: Bearer <token>`. `GET /health` needs no token.

| Route | |
|---|---|
| `GET /v1/notebooks` · `GET/PUT/DELETE /v1/notebooks/:id` | notebooks; deleting one deletes its conversations |
| `GET /v1/notebooks/:id/threads` · `GET/PUT/DELETE /v1/threads/:id` | conversations (`notebookId` required) |
| `GET/PUT/DELETE /v1/kv/:namespace/:key` · `GET /v1/kv?prefix=` · `GET /v1/kv-namespaces` | the LangGraph store behind Deep Agents' StoreBackend |

Security:
- Tokens are compared in constant time.
- CORS is limited to `YAXB_BOX_ORIGINS`, and Chrome's Private Network Access preflight is answered only for those origins.
- Bodies are capped at 8 MB, ids are validated, and the URL's id wins over the body's.
- The service runs as an unprivileged user with a read-only system (`ProtectSystem=strict`).
- The token is never sent to the kiosk's server.

Tests: `node --test test/box.test.js` (or `node yaxb.mjs test`).
