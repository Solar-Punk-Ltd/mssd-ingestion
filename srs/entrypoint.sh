#!/bin/bash
set -e

CONF=/usr/local/srs/conf/srs.conf
cp /usr/local/srs/conf/srs.conf.template "$CONF"

# Substitute passphrase or remove SRT encryption lines if empty
if [ -n "$SRT_PASSPHRASE" ]; then
  sed -i "s/PASSPHRASE_PLACEHOLDER/$SRT_PASSPHRASE/" "$CONF"
else
  sed -i '/PASSPHRASE_PLACEHOLDER/d' "$CONF"
  sed -i '/pbkeylen/d' "$CONF"
fi

# Substitute webhook port
sed -i "s/WEBHOOK_PORT_PLACEHOLDER/${WEBHOOK_PORT:-3000}/g" "$CONF"

# Ensure HLS output directories exist
mkdir -p ./objs/nginx/html/video
mkdir -p ./objs/nginx/html/audio

echo "srs.conf generated from template"

exec ./objs/srs -c conf/srs.conf
