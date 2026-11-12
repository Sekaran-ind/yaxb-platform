#!/usr/bin/env bash
# Self-signed TLS certificate for the box. A kiosk served over https (Cloudflare) can only call an
# https box, and a home or clinic network has no public name for a CA-issued certificate. Each
# device trusts this certificate once (README: "Trust the box").
#
# Covers <hostname>.local, the hostname, localhost and the box's current IPv4 addresses. Give the
# Pi a DHCP reservation so its address doesn't change.
#
# Usage: make-cert.sh <out-dir> [extra-name-or-ip ...]
set -euo pipefail

OUT_DIR="${1:?usage: make-cert.sh <out-dir> [extra-name ...]}"
shift || true
HOST="$(hostname -s)"

SANS="DNS:${HOST}.local,DNS:${HOST},DNS:localhost,IP:127.0.0.1"
IPS="$( (hostname -I 2>/dev/null || true) | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"
for ip in $IPS; do SANS="${SANS},IP:${ip}"; done
for extra in "$@"; do
  if [[ "$extra" =~ ^[0-9.]+$ ]]; then SANS="${SANS},IP:${extra}"; else SANS="${SANS},DNS:${extra}"; fi
done

mkdir -p "$OUT_DIR"
# 825 days: the longest validity iOS accepts for a server certificate. RSA-2048 works everywhere.
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout "$OUT_DIR/key.pem" -out "$OUT_DIR/cert.pem" \
  -subj "/CN=${HOST}.local/O=yaxb-box" \
  -addext "subjectAltName=${SANS}" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"
chmod 600 "$OUT_DIR/key.pem"
chmod 644 "$OUT_DIR/cert.pem"
echo "certificate for: ${SANS}"
