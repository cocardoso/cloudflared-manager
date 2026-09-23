# Multiple Cloudflare accounts — Design

- **Date:** 2026-09-23
- **Status:** approved
- **Builds on:** `2026-09-22-cloudflared-manager-design.md`

## 1. Goal

One API token often reaches several Cloudflare accounts (e.g. a personal account with one domain and a company account with many). Today the setup forces the user to pick **one** account and the app stays bound to it. Instead, the app uses **every account the token reaches**: the tunnel list and the domain list span all of them, and the account is chosen when a tunnel is created.

## 2. Cloudflare constraints (researched)

| Topic | Finding | Consequence |
|---|---|---|
| Token scope | A user token with "All accounts" / "All zones" works on every account the user belongs to, limited by the user's role there. The token link the app generates already uses `accountId=*`. | No change to the token template. |
| Account discovery | `GET /accounts` may be empty for some tokens; every zone from `GET /zones` carries `account {id, name}`. | Discover accounts as the union of both (already done for the single-account setup). |
| Cross-account routing | A tunnel only serves DNS records of zones in **the same account** (cross-account CNAMEs fail with error 1014). The configuration API does not appear to validate this. | The app validates it: a hostname must belong to a zone of the tunnel's account. |
| Rate limit | 1,200 requests / 5 min **per user**, shared by every token and account. | Query accounts in parallel, cache account/zone discovery for 60 s. |
| Running a tunnel | `cloudflared tunnel run --token` needs only the tunnel token. | Service backends and watchdog are unchanged. |

## 3. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Account model | The token's reach defines the accounts; no account is stored as "the" account. | Matches how tokens work and removes the setup choice that confused users. |
| Choosing an account | At tunnel creation, only when more than one account exists; the last used account is preselected. | The account only matters for new tunnels and their domains. |
| Account allow-list | Not now. A dashboard filter covers the need. | YAGNI; can be added later without changing the model. |
| Tunnel ids in the API | Unchanged (`/tunnels/:id`); ids are globally unique UUIDs. | No breaking URL changes; the server resolves the account. |
| Partial failures | An account that fails (e.g. no Tunnel permission) is reported apart; the others still load. | One restricted account must not hide the rest. |

## 4. Server

### 4.1 `AccountDirectory` (`apps/server/src/cloudflare/account-directory.ts`)

- `list(): Promise<AccountInfo[]>` where `AccountInfo = { id, name, zones: CfZone[] }`, sorted by name.
- Discovery: `GET /accounts` ∪ accounts found on `GET /zones` (all zones, one paginated call). Zones are grouped by `zone.account.id`. An account from `/accounts` with no zone is kept with `zones: []`.
- Cached for 60 s per token; `invalidate()` clears it. A token change (different token string) never reuses the cache.
- `get(accountId)` returns the account or throws `ACCOUNT_NOT_FOUND` (404, new error code).

### 4.2 Context

- `ctx.api(accountId): CfApi` — one cached `CfApi` per account for the stored token. Throws `CF_NOT_CONNECTED` without a token.
- `ctx.accounts: AccountDirectory` bound to the stored token.

### 4.3 Settings

- `setCloudflare({ token })` stores the encrypted token and its suffix and invalidates the directory. `getCloudflare()` returns `{ token } | null`. **Connected means a token is stored.**
- `lastAccountId` (`settings.last_account_id`) is updated on each tunnel creation.
- The old keys `cf_account_id` / `cf_account_name` are only read by the migration (§5).

### 4.4 `TunnelService`

- Deps: `api(accountId)`, `accounts` (directory), plus the existing repos/backends.
- `list(): { tunnels: TunnelSummary[]; unavailableAccounts: UnavailableAccount[] }`
  - For every account in parallel: `listTunnels()`; per tunnel, summary with `account: { id, name }`. Route counts come from `getConfig` only for tunnels managed here (unchanged).
  - An account whose listing fails with an `AppError` is added to `unavailableAccounts: [{ id, name, code }]`; other errors still propagate.
  - Local rows whose tunnel was not returned by their own account (and whose account did not fail) become ghosts (unchanged behaviour), carrying the row's account.
  - Records `tunnelId → accountId` in an in-memory map used by `accountOf`.
- `accountOf(id)`: the row's `account_id` if the tunnel runs here; else the in-memory map; else tries `getTunnel` on each account until one succeeds (any `AppError` means "not in this account"); else `TUNNEL_NOT_FOUND`.
- `get`, `adopt`, `update`, `delete`, `updateRoutes`, `start/stop/restart` use `api(accountOf(id))`.
- `create(name, accountId?)`: when `accountId` is omitted and exactly one account exists, it is used; when omitted with several accounts → `ACCOUNT_SELECTION_REQUIRED` (400, existing code, new meaning); unknown id → `ACCOUNT_NOT_FOUND`. Inserts the row with `account_id` and stores `lastAccountId`.
- `adopt(id)`: inserts the row with the resolved account.
- `updateRoutes`: zones = the tunnel account's zones (from the directory). A hostname that matches a zone of **another** account, or no zone at all, fails with `ZONE_NOT_FOUND` listing the hostnames (message: "does not belong to a zone in this tunnel's account").
- `delete`: DNS cleanup uses the tunnel account's zones (unchanged logic otherwise).

### 4.5 HTTP API

| Endpoint | Change |
|---|---|
| `POST /cloudflare/token` | Body `{ token }`. Verifies the token, discovers accounts (none → `CF_PERMISSION_MISSING` Tunnel), lists tunnels on every account in parallel (none succeeds → `CF_PERMISSION_MISSING` Tunnel with the first failing account's name), requires at least one zone overall (else `CF_PERMISSION_MISSING` Zone). Stores the token, returns status. |
| `GET /cloudflare/status` | `{ connected, tokenSuffix, lastAccountId, accounts: [{ id, name, zones: [{ id, name }] }] }`. Directory errors → `accounts: []`. |
| `GET /zones` | Removed (unused by the web app). |
| `GET /tunnels` | `{ tunnels, unavailableAccounts }`. |
| `POST /tunnels` | `{ name, accountId? }`. |
| Other tunnel routes | Unchanged. |

`GET /setup/status` keeps `cloudflareConnected` (= token stored).

## 5. Data and migration

- Migration 2: `alter table tunnels add column account_id text;` then `update tunnels set account_id = (select value from settings where key = 'cf_account_id')`.
- Rows with a `null` `account_id` (not expected after migration) are resolved through `accountOf`'s lookup and then written back.
- Installations upgraded from one account keep working without any action: their tunnels stay bound to the previous account and the other accounts appear automatically.
- Backup: each tunnel entry gains an optional `accountId`; restore only writes it when the row exists and has none. Old backups stay valid.

## 6. Shared types

- `AccountRef = { id: string; name: string }`; `TunnelSummary.account: AccountRef`.
- `CloudflareAccount = AccountRef & { zones: Zone[] }`.
- `CloudflareStatus = { connected; tokenSuffix; lastAccountId: string | null; accounts: CloudflareAccount[] }`.
- `UnavailableAccount = AccountRef & { code: ErrorCode }`; `TunnelList = { tunnels: TunnelSummary[]; unavailableAccounts: UnavailableAccount[] }`.
- `createTunnelSchema` gains `accountId` (32 hex, optional). `cloudflareTokenSchema` loses `accountId`.
- New error code `ACCOUNT_NOT_FOUND`.

## 7. Web

- **Setup / Settings connect form:** no account selection. Success shows "Connected to {count} accounts · {zones} domains" and the account names.
- **Settings:** a section per account with its domains as badges.
- **Dashboard:** when there is more than one account, an "Account" column and a filter (`All accounts` + each account) next to the search. The summary cards and the table follow the filter. One warning banner per unavailable account ("Could not load tunnels from {account}: {reason}").
- **Create tunnel dialog:** an "Account" select, preselected with `lastAccountId` (else the first account), hidden with one account.
- **Tunnel page:** an account badge in the header when there is more than one account. The hostname dialog offers only the tunnel account's domains.
- **i18n:** every new string in `en` and `pt-BR`.

## 8. Testing

- **Fake Cloudflare:** two accounts — `Home Lab` (`example.com`, `other.dev`) and `Second Org` (`second.net`). Tunnels are stored per account; account-scoped tunnel routes return 404 (code 1003, as for a missing tunnel) for a tunnel of another account. The real API's answer in that case is checked during the real test; `accountOf` treats any `AppError` from another account as "not here". A helper can make one account's tunnel listing fail with 403.
- **Server unit tests:** directory discovery/caching/union; `list` merging accounts and reporting a failing one; `create` with/without `accountId`; `ZONE_NOT_FOUND` for a zone of another account; `accountOf` fallback; migration of a one-account installation; token connect with several accounts.
- **Web unit tests:** connect form without selection; dashboard filter/column/banner; create dialog account select; routes dialog domain filtering.
- **e2e:** existing flow plus creating a tunnel in `Second Org` and checking the hostname dialog only offers `second.net`.
- **Real test:** Chrome against the real token with `tm-e2e-*` tunnels in UPCAST and INTERCASE-CLOUDHUB (`cloudhub.com.br`), public access over the internet, then removal of every test resource checked in the Cloudflare dashboard.

## 9. Out of scope

- Per-installation account allow-list.
- Moving a tunnel between accounts.
- Several tokens.
