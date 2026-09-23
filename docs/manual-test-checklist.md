# Manual test checklist

Run before each release, for both deployment targets. Record the observed result for each item.

## Proxmox installation

- [ ] Run `bash -c "$(curl -fsSL https://raw.githubusercontent.com/cocardoso/cloudflared-manager/main/proxmox/ct/cloudflared-manager.sh)"` on the host; the LXC is created with Debian 13, 1 vCPU, 1 GB RAM, 4 GB disk, unprivileged.
- [ ] `http://<ip>:8080` opens the welcome screen.
- [ ] Inside the LXC: `systemctl status tunnel-manager` is active; `ls -l /etc/tunnel-manager/secret.key` shows mode `-rw-------` and owner `tunnelmgr`.
- [ ] `ls -ln /opt/tunnel-manager` shows every file owned by root (uid 0).
- [ ] `sudo -u tunnelmgr sudo -n -l` lists only the sudoers rules.

## Setup

- [ ] Create the admin; the strength meter reacts as you type and a short password is still accepted.
- [ ] The "Create token in Cloudflare" button opens the dashboard with the 3 permissions filled in.
- [ ] Paste the token; "Connected to N accounts" lists every account; with several accounts a checkbox per account (all checked) lets you save the active ones.
- [ ] Settings lists every account with its domains; unchecking an account with tunnels running here is refused; unchecking another one hides it from the dashboard and the create dialog.

## Tunnels

- [ ] Create a tunnel; `systemctl status cloudflared@<id>` is active; the Zero Trust dashboard shows the tunnel as "Healthy".
- [ ] Add a hostname in each of two domains; external access works; the CNAME appears in each domain's DNS.
- [ ] With a token reaching several accounts: create a tunnel in each; the dashboard shows the Account column and filter; each tunnel's hostname dialog only offers its account's domains; external access works for both.
- [ ] Add a hostname that already has an A record: the UI asks for confirmation before replacing it.
- [ ] Add a hostname that only has a TXT record: the TXT record is left untouched.
- [ ] Edit the route in the Zero Trust dashboard while a dialog is open in the UI, then save: the version-conflict warning appears and nothing is overwritten.
- [ ] Remove a route: the CNAME disappears. Remove one with "Also delete the DNS record" unchecked: the CNAME stays.
- [ ] Edit a route of a tunnel whose origin options were set in the dashboard (e.g. HTTP/2 origin): saving works and the options are kept.
- [ ] Live logs appear in the Logs tab; pause and resume work.
- [ ] The traffic chart appears after a few minutes of use.

## Resilience

- [ ] `pct reboot <ctid>`: the UI and tunnels come back on their own.
- [ ] `systemctl kill -s KILL cloudflared@<id>`: systemd restarts it within ~5 s.
- [ ] Disconnect the host from the internet for 5 min: no restart loop; a "No internet" event; the tunnel reconnects by itself when the network returns.
- [ ] With the internet disconnected, Start/Restart in the UI return immediately (units start with `--no-block`).
- [ ] Validate `Type=notify` + `TimeoutStartSec=0` in an unprivileged LXC: the unit reaches `active` once connected.
- [ ] Stop a tunnel from the UI: the watchdog does not restart it.
- [ ] After the watchdog gives up ("Gave up"), fix the network: the state returns to healthy on its own.

## Maintenance

- [ ] Update `cloudflared` from the Settings page; active tunnels restart.
- [ ] Run the script's `update` inside the LXC; tunnels stay up; `/opt/tunnel-manager.old` exists.
- [ ] Export and import a backup.
- [ ] Delete a tunnel: it disappears from Cloudflare, DNS and systemd.
- [ ] 6 wrong logins in a row: the sixth attempt is blocked for 1 minute.
- [ ] Switch language and theme; the choice persists after reloading.

## Docker

- [ ] `docker compose up -d` with the published image; `docker inspect -f '{{.State.Health.Status}}' cloudflared-manager` becomes `healthy`.
- [ ] `docker exec cloudflared-manager id -u` prints `10001`; the container runs without `--privileged`.
- [ ] Create a tunnel and a public hostname pointing at another Compose service; external access returns 200.
- [ ] `docker exec cloudflared-manager ps -eo args` shows `cloudflared --no-autoupdate tunnel run` without the token.
- [ ] `docker exec cloudflared-manager pkill -9 cloudflared`: the tunnel is back within ~5 s.
- [ ] Stop a tunnel from the UI, then `docker restart cloudflared-manager`: the stopped tunnel stays stopped, the others come back.
- [ ] Settings shows the "pull the latest image" hint instead of an Update button.
- [ ] `docker compose pull && docker compose up -d` keeps the data volume, tunnels and routes.
