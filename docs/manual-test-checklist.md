# Manual test checklist on Proxmox

Run before each release. Record the observed result for each item.

## Installation

- [ ] Run the installation command on the host; the LXC is created with Debian 13, 1 vCPU, 1 GB RAM, 4 GB disk, unprivileged.
- [ ] `http://<ip>:8080` opens the welcome screen.
- [ ] Inside the LXC: `systemctl status tunnel-manager` is active; `ls -l /etc/tunnel-manager/secret.key` shows mode `-rw-------` and owner `tunnelmgr`.
- [ ] `ls -ln /opt/tunnel-manager` shows every file owned by root (uid 0).
- [ ] `sudo -u tunnelmgr sudo -n -l` lists only the sudoers rules.

## Setup

- [ ] Create the admin; a short password is rejected.
- [ ] The "Create token in Cloudflare" button opens the dashboard with the 3 permissions filled in.
- [ ] Paste the token; with several accounts, the account picker appears; the correct domains are listed.

## Tunnels

- [ ] Create a tunnel; `systemctl status cloudflared@<id>` is active; the Zero Trust dashboard shows the tunnel as "Healthy".
- [ ] Add a hostname in each of two domains; external access works; the CNAME appears in each domain's DNS.
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
