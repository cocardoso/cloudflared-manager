#!/usr/bin/env bash
# Copyright (c) 2026 cesar
# License: MIT
# Source: https://github.com/cocardoso/cloudflared-manager

GH_REPO="${TM_GH_REPO:-cocardoso/cloudflared-manager}"
# The community-scripts engine is pinned so upstream changes cannot break this script.
CORE_COMMIT="${TM_CORE_COMMIT:-34c3105f51f7d24505a7b4801babbf2aa7bca407}"
# The engine resolves install/<app>-install.sh relative to this URL, i.e. proxmox/install/.
export _CS_DEFAULT_URL="https://raw.githubusercontent.com/${GH_REPO}/main/proxmox"
export COMMUNITY_SCRIPTS_URL="${_CS_DEFAULT_URL}"
export COMMUNITY_SCRIPTS_CORE_URL="https://raw.githubusercontent.com/community-scripts/core/${CORE_COMMIT}"
source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL}/core/build.func")

APP="Cloudflared-Manager"
var_tags="${var_tags:-network;cloudflare}"
var_cpu="${var_cpu:-1}"
var_ram="${var_ram:-1024}"
var_disk="${var_disk:-4}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
var_unprivileged="${var_unprivileged:-1}"

# The engine looks for the ASCII banner in its own repository (404 for apps outside
# community-scripts) unless a cached copy exists, so ship ours in its cache.
_cm_header="$(declare -f community_scripts_dir >/dev/null 2>&1 && community_scripts_dir || echo /usr/local/community-scripts)/headers/ct/cloudflared-manager"
if [[ ! -s "$_cm_header" ]] && mkdir -p "$(dirname "$_cm_header")" 2>/dev/null; then
  cat >"$_cm_header" <<'BANNER' || true
   ________                ______                   __
  / ____/ /___  __  ______/ / __/___ _________  ___/ /
 / /   / / __ \/ / / / __  / /_/ __ `/ ___/ _ \/ __  /
/ /___/ / /_/ / /_/ / /_/ / __/ /_/ / /  /  __/ /_/ /
\____/_/\____/\__,_/\__,_/_/  \__,_/_/   \___/\__,_/
                                         MANAGER
BANNER
fi
unset _cm_header

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -f /etc/systemd/system/tunnel-manager.service ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  msg_info "Updating OS and cloudflared"
  $STD apt-get update
  $STD apt-get -y upgrade
  msg_ok "Updated OS and cloudflared"

  RELEASE=$(curl -fsSL "https://api.github.com/repos/${GH_REPO}/releases/latest" | jq -r '.tag_name')
  if [[ "$RELEASE" != "$(cat /opt/tunnel-manager/VERSION 2>/dev/null)" ]]; then
    msg_info "Updating ${APP} to ${RELEASE}"
    TMP=$(mktemp -d)
    curl -fsSL "https://github.com/${GH_REPO}/releases/download/${RELEASE}/cloudflared-manager-${RELEASE}.tar.gz" -o "$TMP/app.tar.gz"
    mkdir -p "$TMP/new"
    tar --no-same-owner -xzf "$TMP/app.tar.gz" -C "$TMP/new" --strip-components=1
    chown -R root:root "$TMP/new"
    if ! visudo -cf "$TMP/new/deploy/sudoers" >/dev/null; then
      msg_error "Invalid sudoers file in release ${RELEASE}; update aborted"
      rm -rf "$TMP"
      exit 1
    fi
    echo "$RELEASE" >"$TMP/new/VERSION"
    rm -rf /opt/tunnel-manager.old
    mv /opt/tunnel-manager /opt/tunnel-manager.old
    mv "$TMP/new" /opt/tunnel-manager
    install -m 0644 /opt/tunnel-manager/deploy/cloudflared@.service /etc/systemd/system/cloudflared@.service
    install -m 0644 /opt/tunnel-manager/deploy/tunnel-manager.service /etc/systemd/system/tunnel-manager.service
    install -m 0440 /opt/tunnel-manager/deploy/sudoers /etc/sudoers.d/tunnel-manager
    systemctl daemon-reload
    # Tunnels keep running: only the web UI restarts.
    systemctl restart tunnel-manager
    rm -rf "$TMP"
    msg_ok "Updated ${APP} to ${RELEASE} (previous version kept in /opt/tunnel-manager.old)"
  else
    msg_ok "${APP} is already at ${RELEASE}"
  fi
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:8080${CL}"
