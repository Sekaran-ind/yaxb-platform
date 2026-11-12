#!/usr/bin/env bash
# Installs yaxb-box on a Raspberry Pi 5 (Raspberry Pi OS 64-bit). Run on the Pi as root from the
# copied bundle:   sudo /opt/yaxb-box/deploy/install.sh
# `node yaxb.mjs box-deploy --host <user>@<pi>` copies the bundle and runs this for you.
# Safe to re-run: it upgrades Node, Litestream and the units in place and never overwrites the env
# file, the certificate or the database.
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-24}"
LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.5.17}"
BOX_ROOT=/opt/yaxb-box
DEPLOY="$BOX_ROOT/deploy"

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
[ "$(uname -m)" = "aarch64" ] || { echo "expected a 64-bit OS (aarch64); got $(uname -m)" >&2; exit 1; }
[ -f "$BOX_ROOT/src/main.js" ] || { echo "copy the bundle to $BOX_ROOT first" >&2; exit 1; }

apt-get update -qq
apt-get install -y -qq curl xz-utils openssl avahi-daemon ca-certificates sqlite3 >/dev/null

# --- Node.js (official arm64 build: Debian's Node is too old for node:sqlite) -----------------
NODE_INDEX="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
SUMS="$(curl -fsSL "$NODE_INDEX/SHASUMS256.txt")"
NODE_TARBALL="$(echo "$SUMS" | awk '/linux-arm64\.tar\.xz$/ {print $2}')"
NODE_SHA="$(echo "$SUMS" | awk '/linux-arm64\.tar\.xz$/ {print $1}')"
CURRENT_NODE="$(/opt/node/bin/node --version 2>/dev/null || true)"
if [ -z "$CURRENT_NODE" ] || [[ "$NODE_TARBALL" != *"$CURRENT_NODE"* ]]; then
  echo "installing $NODE_TARBALL"
  curl -fsSL "$NODE_INDEX/$NODE_TARBALL" -o "/tmp/$NODE_TARBALL"
  echo "$NODE_SHA  /tmp/$NODE_TARBALL" | sha256sum -c -
  rm -rf /opt/node.new && mkdir -p /opt/node.new
  tar -xJf "/tmp/$NODE_TARBALL" -C /opt/node.new --strip-components=1
  rm -rf /opt/node && mv /opt/node.new /opt/node
  rm -f "/tmp/$NODE_TARBALL"
fi

# --- Litestream ------------------------------------------------------------------------------
if [ "$(litestream version 2>/dev/null || true)" != "v${LITESTREAM_VERSION}" ]; then
  DEB="litestream-${LITESTREAM_VERSION}-linux-arm64.deb"
  curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/${DEB}" -o "/tmp/$DEB"
  dpkg -i "/tmp/$DEB" >/dev/null
  rm -f "/tmp/$DEB"
fi

# --- Service user, directories, config, certificate --------------------------------------------
id yaxbbox >/dev/null 2>&1 || useradd --system --home /var/lib/yaxb-box --shell /usr/sbin/nologin yaxbbox
install -d -o yaxbbox -g yaxbbox -m 0750 /var/lib/yaxb-box
install -d -m 0750 -g yaxbbox /etc/yaxb-box
ENV=/etc/yaxb-box/yaxb-box.env
if [ ! -f "$ENV" ]; then
  install -m 0640 -g yaxbbox "$DEPLOY/yaxb-box.env.example" "$ENV"
  TOKEN="$(openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n')"
  sed -i "s|^YAXB_BOX_TOKEN=.*|YAXB_BOX_TOKEN=${TOKEN}|" "$ENV"
  echo "created $ENV with a new token"
fi
if [ -n "${YAXB_BOX_ORIGINS:-}" ]; then
  sed -i "s|^YAXB_BOX_ORIGINS=.*|YAXB_BOX_ORIGINS=${YAXB_BOX_ORIGINS}|" "$ENV"
fi
if [ ! -f /etc/yaxb-box/tls/cert.pem ]; then
  bash "$DEPLOY/make-cert.sh" /etc/yaxb-box/tls
  chgrp yaxbbox /etc/yaxb-box/tls /etc/yaxb-box/tls/key.pem
  chmod 0750 /etc/yaxb-box/tls
  chmod 0640 /etc/yaxb-box/tls/key.pem
fi
install -m 0644 "$DEPLOY/litestream.yml" /etc/litestream.yml
chmod +x "$DEPLOY/restore-if-empty.sh" "$DEPLOY/make-cert.sh"

BACKUP_DIR="$(. "$ENV"; echo "${YAXB_BACKUP_DIR:-/mnt/yaxb-backup}")"
install -d /etc/systemd/system/litestream.service.d
cat > /etc/systemd/system/litestream.service.d/yaxb-box.conf <<EOF
[Unit]
RequiresMountsFor=${BACKUP_DIR}

[Service]
EnvironmentFile=/etc/yaxb-box/yaxb-box.env
Restart=always
RestartSec=5
EOF

install -m 0644 "$DEPLOY/yaxb-box.service" /etc/systemd/system/yaxb-box.service
systemctl daemon-reload
systemctl enable litestream yaxb-box >/dev/null

TOKEN="$(. "$ENV"; echo "$YAXB_BOX_TOKEN")"
IP="$(hostname -I | awk '{print $1}')"
echo
if mountpoint -q "$BACKUP_DIR"; then
  systemctl restart litestream yaxb-box
  sleep 2
  systemctl --no-pager --lines=4 status yaxb-box || true
else
  echo "The backup drive isn't mounted at ${BACKUP_DIR}, so Litestream (and yaxb-box) won't start yet."
  echo "Mount a USB drive or NFS share there (README: Backup drive), then: sudo systemctl start litestream yaxb-box"
  echo "To try it without a backup first: sudo -u yaxbbox touch $(. "$ENV"; echo "$YAXB_BOX_DB") && sudo systemctl start yaxb-box"
fi
echo
echo "Box URL:   https://${IP}:$(. "$ENV"; echo "$YAXB_BOX_PORT")"
echo "Token:     ${TOKEN}"
echo "Trust the certificate on each device: http://${IP}:$(. "$ENV"; echo "$YAXB_BOX_CERT_PORT")/"
echo "Allowed origins: $(. "$ENV"; echo "$YAXB_BOX_ORIGINS")   (edit $ENV to change)"
