#!/usr/bin/env bash

# Copyright (c) 2026 cesar
# License: MIT
# Source: https://github.com/cocardoso/cloudflared-manager

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

GH_REPO="${TM_GH_REPO:-cocardoso/cloudflared-manager}"

msg_info "Installing Dependencies"
$STD apt-get install -y curl ca-certificates sudo jq
msg_ok "Installed Dependencies"

msg_info "Installing Cloudflared"
setup_deb822_repo \
  "cloudflared" \
  "https://pkg.cloudflare.com/cloudflare-main.gpg" \
  "https://pkg.cloudflare.com/cloudflared/" \
  "any" \
  "main"
$STD apt-get install -y cloudflared
msg_ok "Installed Cloudflared $(cloudflared --version | awk '{print $3}')"

NODE_VERSION="24" setup_nodejs

msg_info "Installing Cloudflared Manager"
useradd --system --home-dir /var/lib/tunnel-manager --shell /usr/sbin/nologin tunnelmgr 2>/dev/null || true
install -d -o tunnelmgr -g tunnelmgr -m 0750 /var/lib/tunnel-manager
install -d -o tunnelmgr -g tunnelmgr -m 0700 /etc/tunnel-manager /etc/tunnel-manager/tunnels
if [[ ! -s /etc/tunnel-manager/secret.key ]]; then
  head -c 32 /dev/urandom >/etc/tunnel-manager/secret.key
fi
chown tunnelmgr:tunnelmgr /etc/tunnel-manager/secret.key
chmod 0600 /etc/tunnel-manager/secret.key

RELEASE=$(curl -fsSL "https://api.github.com/repos/${GH_REPO}/releases/latest" | jq -r '.tag_name')
TMP=$(mktemp -d)
curl -fsSL "https://github.com/${GH_REPO}/releases/download/${RELEASE}/cloudflared-manager-${RELEASE}.tar.gz" -o "$TMP/app.tar.gz"
curl -fsSL "https://github.com/${GH_REPO}/releases/download/${RELEASE}/cloudflared-manager-${RELEASE}.tar.gz.sha256" -o "$TMP/app.tar.gz.sha256"
if ! echo "$(cut -d' ' -f1 "$TMP/app.tar.gz.sha256")  $TMP/app.tar.gz" | sha256sum -c --status; then
  msg_error "Checksum mismatch for release ${RELEASE}"
  exit 1
fi
mkdir -p /opt/tunnel-manager
tar --no-same-owner -xzf "$TMP/app.tar.gz" -C /opt/tunnel-manager --strip-components=1
chown -R root:root /opt/tunnel-manager
echo "$RELEASE" >/opt/tunnel-manager/VERSION
install -m 0644 /opt/tunnel-manager/deploy/cloudflared@.service /etc/systemd/system/cloudflared@.service
install -m 0644 /opt/tunnel-manager/deploy/tunnel-manager.service /etc/systemd/system/tunnel-manager.service
visudo -cf /opt/tunnel-manager/deploy/sudoers >/dev/null
install -m 0440 /opt/tunnel-manager/deploy/sudoers /etc/sudoers.d/tunnel-manager
rm -rf "$TMP"
systemctl daemon-reload
systemctl enable -q --now tunnel-manager
msg_ok "Installed Cloudflared Manager ${RELEASE}"

motd_ssh
customize
cleanup_lxc
