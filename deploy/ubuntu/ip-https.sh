#!/usr/bin/env bash
set -euo pipefail

# Run prepare first, verify the public challenge URL, then run issue.
action=${1:-}
game_ip=${2:-}
if [[ $EUID -ne 0 || ! "$action" =~ ^(prepare|issue)$ ]]; then
  echo 'Usage: sudo bash ip-https.sh prepare|issue PUBLIC_IPV4' >&2
  exit 1
fi
python3 - "$game_ip" <<'PY'
import ipaddress
import sys
address = ipaddress.ip_address(sys.argv[1])
if address.version != 4 or not address.is_global:
    raise SystemExit('A public IPv4 address is required.')
PY

webroot=/var/www/bjtu-acme
certificate=/etc/letsencrypt/live/bjtu-game-ip
config=/etc/nginx/sites-available/bjtu-game-ip
certbot=/opt/bjtu-certbot/bin/certbot

write_config() {
  cat > "$config" <<NGINX
server {
    listen 80;
    server_name $game_ip;
    location ^~ /.well-known/acme-challenge/ {
        root $webroot;
        default_type text/plain;
        try_files \$uri =404;
    }
NGINX
  if [[ -f "$certificate/fullchain.pem" ]]; then
    cat >> "$config" <<NGINX
    location / { return 308 https://$game_ip\$request_uri; }
}

map \$http_upgrade \$bjtu_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name $game_ip;
    ssl_certificate $certificate/fullchain.pem;
    ssl_certificate_key $certificate/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:5080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$bjtu_connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX
  else
    cat >> "$config" <<'NGINX'
    location / { return 404; }
}
NGINX
  fi
  ln -sfn "$config" /etc/nginx/sites-enabled/bjtu-game-ip
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
}

if [[ "$action" == prepare ]]; then
  command -v nginx >/dev/null
  install -d -m 755 "$webroot/.well-known/acme-challenge"
  printf '%s\n' 'bjtu-acme-ready' > "$webroot/.well-known/acme-challenge/bjtu-connectivity-check"
  write_config
  if [[ ! -x "$certbot" ]]; then
    python3 -m venv /opt/bjtu-certbot
    /opt/bjtu-certbot/bin/pip install --disable-pip-version-check 'certbot>=5.4'
  fi
  "$certbot" --help all | grep -- '--ip-address' >/dev/null
  "$certbot" --version
  echo "Check from outside: http://$game_ip/.well-known/acme-challenge/bjtu-connectivity-check"
  exit 0
fi

if [[ ! -x "$certbot" ]]; then
  echo 'Run prepare first.' >&2
  exit 1
fi

# IP certificates require the shortlived ACME profile. Keep staging separate.
common=(certonly --non-interactive --agree-tos --register-unsafely-without-email
  --preferred-profile shortlived --webroot --webroot-path "$webroot"
  --ip-address "$game_ip" --cert-name bjtu-game-ip --keep-until-expiring)
"$certbot" "${common[@]}" --staging \
  --config-dir /var/lib/bjtu-certbot-staging/config \
  --work-dir /var/lib/bjtu-certbot-staging/work \
  --logs-dir /var/log/bjtu-certbot-staging
"$certbot" "${common[@]}"

install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/bjtu-nginx <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
HOOK
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/bjtu-nginx

cat > /etc/systemd/system/bjtu-certbot-renew.service <<'UNIT'
[Unit]
Description=Renew BJTU game HTTPS certificate
Wants=network-online.target
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/opt/bjtu-certbot/bin/certbot renew --quiet
UNIT
cat > /etc/systemd/system/bjtu-certbot-renew.timer <<'UNIT'
[Unit]
Description=Check BJTU HTTPS certificate renewal every six hours

[Timer]
OnCalendar=*-*-* 00,06,12,18:00:00
RandomizedDelaySec=15m
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now bjtu-certbot-renew.timer
write_config
echo "Public game URL: https://$game_ip"
echo 'Renewal timer: bjtu-certbot-renew.timer'
