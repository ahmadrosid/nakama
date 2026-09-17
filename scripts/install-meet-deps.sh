#!/bin/sh -p
# Installed root-owned outside /app. No caller-selected packages, paths or options.
set -eu
[ "$#" -eq 0 ] || exit 64
[ "$(/usr/bin/id -u)" -eq 0 ] || exit 77
cd /
# Clean environment, root-owned apt config and fixed arguments. The lock and
# timeout outlive an HTTP client disconnect; npm and Chromium never run as root.
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/root DEBIAN_FRONTEND=noninteractive \
  /usr/bin/flock -w 30 /run/nakama-meet-install.lock \
  /usr/bin/timeout 600 /bin/sh -c '
    set -eu
    /usr/bin/dpkg --configure -a
    /usr/bin/apt-get update
    /usr/bin/apt-get install -y --no-install-recommends \
      ffmpeg pulseaudio pulseaudio-utils xvfb fonts-liberation \
      libnss3 libatk-bridge2.0-0t64 libxkbcommon0 libgbm1 libasound2t64 \
      libgtk-3-0t64 libxdamage1 libxrandr2 libxcomposite1 libcups2t64
    /bin/rm -rf /var/lib/apt/lists/*
  '
