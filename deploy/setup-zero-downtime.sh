#!/usr/bin/env bash
#
# One-off: point nginx at both copies of the app (ports 3000 and 3002) and serve each
# build's static files from /opt/wyndos/shared/next-static. Run once on the VPS, then
# deploy as normal. Safe to run again. Backs up the site file and puts it back if nginx
# doesn't accept the change.
#
#   sudo ./deploy/setup-zero-downtime.sh [/etc/nginx/sites-available/your-site]

set -euo pipefail
[[ "${EUID}" -ne 0 ]] && { echo "Run with sudo."; exit 1; }

SITE="${1:-$(grep -l "127.0.0.1:3000" /etc/nginx/sites-enabled/* 2>/dev/null | head -1 || true)}"
[[ -n "$SITE" && -f "$SITE" ]] || { echo "Couldn't find the nginx site that proxies to 127.0.0.1:3000. Pass its path."; exit 1; }
SITE="$(readlink -f "$SITE")"
echo "Site file: $SITE"

install -d -m 755 /opt/wyndos/shared/next-static

cat > /etc/nginx/conf.d/wyndos-upstream.conf <<'CONF'
# Two copies of Wyndos. During a deploy one restarts while the other serves.
upstream wyndos_app {
    server 127.0.0.1:3000 max_fails=1 fail_timeout=5s;
    server 127.0.0.1:3002 max_fails=1 fail_timeout=5s;
}
CONF

install -d /etc/nginx/snippets
cat > /etc/nginx/snippets/wyndos-static.conf <<'CONF'
# Every build's JS/CSS, kept for 30 days, so pages open during a deploy still load.
location /_next/static/ {
    alias /opt/wyndos/shared/next-static/;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri @wyndos_app;
}
location @wyndos_app {
    proxy_pass http://wyndos_app;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
CONF

BACKUP="$SITE.bak-$(date +%Y%m%d%H%M%S)"
cp -a "$SITE" "$BACKUP"
echo "Backup: $BACKUP"

# proxy_pass to the pair instead of one port; if one is restarting, try the other.
sed -i -E 's#proxy_pass http://127\.0\.0\.1:3000(/api/health)?;#proxy_pass http://wyndos_app\1;\n        proxy_next_upstream error timeout http_502 http_503;#' "$SITE"
# Static files snippet, once per server block that serves the app.
if ! grep -q "snippets/wyndos-static.conf" "$SITE"; then
  sed -i -E 's#^([[:space:]]*)location / \{#\1include snippets/wyndos-static.conf;\n\n\1location / {#' "$SITE"
fi

if nginx -t; then
  systemctl reload nginx
  echo "nginx updated. Now deploy as normal."
else
  echo "nginx didn't accept the change: putting the old file back."
  cp -a "$BACKUP" "$SITE"
  nginx -t && systemctl reload nginx
  exit 1
fi
