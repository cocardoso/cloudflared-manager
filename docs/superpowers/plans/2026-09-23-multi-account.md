# Multiple Cloudflare Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use every Cloudflare account the stored token reaches; choose the account when creating a tunnel.

**Architecture:** An `AccountDirectory` discovers accounts and their zones (cached 60 s). `TunnelService` gets a per-account `CfApi` factory, aggregates tunnels over all accounts, and resolves a tunnel's account from the local row (`tunnels.account_id`), an in-memory map, or a scan. The web app shows accounts where they matter (setup, settings, dashboard filter/column, create dialog, tunnel badge, hostname domains).

**Tech Stack:** TypeScript, Fastify, node:sqlite, zod, React + Kumo, TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-multi-account-design.md`

## Global Constraints

- Everything in the repo is in English; only `apps/web/src/i18n/pt-BR.json` holds Portuguese. Every new UI string exists in `en.json` and `pt-BR.json`.
- Tunnel URLs stay `/tunnels/:id`; `POST /tunnels` accepts `{ name, accountId? }`.
- Accounts are cached for 60 s; account listings run in parallel.
- A hostname must belong to a zone of the tunnel's account (`ZONE_NOT_FOUND` otherwise).
- Installations configured with one account keep working after upgrade without any user action.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- Upgrade from v0.2.0 data (settings with `cf_account_id`, tunnels without `account_id`) → tunnels keep working and show their account. Test in Task 2.
- One account without Tunnel permission among several → others still listed, banner for the failing one. Test in Task 4 (service) and Task 7 (web banner).
- Hostname in a domain of another account → rejected before any write, no DNS created. Test in Task 4.
- Token replaced with one that reaches different accounts → caches do not serve the previous token's accounts. Test in Task 3.
- Unmanaged tunnel opened by URL before the list was ever loaded (server restart) → resolved by scanning accounts. Test in Task 4.

---

### Task 1: Shared contract

**Files:**
- Modify: `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/errors.ts`
- Test: `packages/shared/src/*.test.ts` (existing schema test file)

**Produces:**
```ts
export interface AccountRef { id: string; name: string }
export interface CloudflareAccount extends AccountRef { zones: Zone[] }
export interface CloudflareStatus { connected: boolean; tokenSuffix: string | null; lastAccountId: string | null; accounts: CloudflareAccount[] }
export interface UnavailableAccount extends AccountRef { code: ErrorCode }
export interface TunnelList { tunnels: TunnelSummary[]; unavailableAccounts: UnavailableAccount[] }
// TunnelSummary gains: account: AccountRef
export const accountIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const createTunnelSchema = z.object({ name: ..., accountId: accountIdSchema.optional() });
export const cloudflareTokenSchema = z.object({ token: z.string().trim().min(20) });
// backupSchema tunnels[] gains accountId: accountIdSchema.optional()
// ERROR_CODES gains 'ACCOUNT_NOT_FOUND'
```
`updateTunnelSchema.name` keeps using the name rule (extract `tunnelNameSchema`).

- [ ] Step 1: add schema tests: `createTunnelSchema` accepts `{name:'a', accountId:'a'.repeat(32)}`, rejects `accountId:'x'`; `backupSchema` accepts a v1 backup with and without `accountId`.
- [ ] Step 2: run `pnpm --filter @tm/shared test` → FAIL.
- [ ] Step 3: implement the types above.
- [ ] Step 4: run → PASS. `pnpm -r typecheck` will fail in server/web until later tasks; that is expected inside this branch.
- [ ] Step 5: commit `feat(shared): contract for multiple Cloudflare accounts`.

### Task 2: Storage — migration, tunnel account, settings

**Files:**
- Modify: `apps/server/src/db/database.ts` (append migration 2), `apps/server/src/tunnels/tunnel-repo.ts`, `apps/server/src/settings/settings-repo.ts`
- Test: `apps/server/src/db/database.test.ts`, `apps/server/src/settings/settings-repo.test.ts`

**Produces:**
- `TunnelRow.accountId: string | null`; `TunnelRepo.insert(id, metricsPort, accountId)`; `TunnelRepo.update(id, { accountId })` supported.
- `SettingsRepo.setCloudflare({ token })`, `getCloudflare(): { token: string } | null`, `lastAccountId(): string | null`, `setLastAccountId(id)`.

Migration 2:
```sql
alter table tunnels add column account_id text;
update tunnels set account_id = (select value from settings where key = 'cf_account_id');
```

- [ ] Step 1: tests —
  - database: open a DB, apply only migration 1 (simulate by creating the file with v0.2.0 schema: run `openDatabase`, then `delete from schema_version where version = 2`, `alter table tunnels drop column account_id` is not needed — instead create a fresh DatabaseSync, exec MIGRATIONS[0] manually via exported `MIGRATIONS`, insert a settings row `cf_account_id='a'*32` and a tunnel row, set schema_version 1, close, then `openDatabase(path)`) → tunnel row `account_id` equals `'a'*32`.
  - settings: `getCloudflare()` is non-null when only `cf_token` exists (v0.2.0 data had `cf_account_id` too; connected must not depend on it); `setLastAccountId`/`lastAccountId` round-trip.
- [ ] Step 2: run `pnpm --filter @tm/server exec vitest run src/db src/settings` → FAIL.
- [ ] Step 3: implement (export `MIGRATIONS`; map `account_id` in `toRow`/`COLS`).
- [ ] Step 4: run → PASS.
- [ ] Step 5: commit `feat(server): store the Cloudflare account of each local tunnel`.

### Task 3: AccountDirectory

**Files:**
- Create: `apps/server/src/cloudflare/account-directory.ts`
- Modify: `apps/server/src/cloudflare/api.ts` (remove `listAccounts`, `listZones` keeps working per account), `apps/server/test/fake-cloudflare.ts`
- Test: `apps/server/src/cloudflare/account-directory.test.ts`

**Produces:**
```ts
export interface AccountInfo { id: string; name: string; zones: CfZone[] }
export class AccountDirectory {
  constructor(client: () => CfClient, opts?: { ttlMs?: number; now?: () => number })
  list(): Promise<AccountInfo[]>          // sorted by name, cached per token
  get(accountId: string): Promise<AccountInfo> // ACCOUNT_NOT_FOUND 404
  invalidate(): void
}
```
`client()` returns the client for the current token (throws `CF_NOT_CONNECTED`). The cache key is the client's token (`CfClient` exposes `readonly token`).

Fake Cloudflare changes (`fake-cloudflare.ts`):
- `TunnelEntry` gains `accountId`. `POST /accounts/:a/cfd_tunnel` stores `:a`; `GET /accounts/:a/cfd_tunnel` filters by `:a`; every `/accounts/:a/cfd_tunnel/:id...` route returns 404 code 1003 when the entry's account differs.
- `export const SECOND_ACCOUNT = { id: 'b'.repeat(32), name: 'Second Org' }` and `state.addSecondAccount()` pushing the account and zone `{ id: 'y'.repeat(31)+'3', name: 'second.net' }` (with its DNS list).
- `fake-cf-server.ts` calls `addSecondAccount()` (e2e gets two accounts).

- [ ] Step 1: tests —
  - union: `/accounts` returns Home Lab only, zones include a zone of `Second Org` → both accounts, zones grouped.
  - `/accounts` empty → accounts from zones.
  - account with no zones kept with `zones: []`.
  - cache: second `list()` within TTL makes no request (count requests via a wrapping client or `cf.state` request log); after `invalidate()` or TTL it refetches; a different token never reuses the cache.
  - `get('c'.repeat(32))` → `ACCOUNT_NOT_FOUND`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS; existing `api.test.ts` updated for the removed `listAccounts`.
- [ ] Step 5: commit `feat(server): discover every account the token reaches`.

### Task 4: TunnelService across accounts

**Files:**
- Modify: `apps/server/src/tunnels/tunnel-service.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/src/tunnels/tunnel-service.test.ts`

**Consumes:** `AccountDirectory`, `TunnelRepo.insert(id, port, accountId)`, `SettingsRepo.setLastAccountId`.

**Produces:**
```ts
interface Deps { api: (accountId: string) => CfApi; accounts: AccountDirectory; backend; tunnels; dns; events; onAccountUsed?: (id: string) => void }
list(): Promise<TunnelList>
create(name: string, accountId?: string): Promise<TunnelSummary>
// get/adopt/update/delete/start/stop/restart/updateRoutes keep their signatures
```
`makeTunnelEnv()` builds the directory from the fake and exposes `api` (Home Lab) and `api2` (Second Org, after `addSecondAccount()` when `makeTunnelEnv({ second: true })`).

Rules:
- `list()`: `Promise.allSettled` over accounts; `AppError` → `unavailableAccounts`; ghosts only for rows whose account succeeded (rows with unknown/failed account are skipped rather than shown as deleted).
- `accountOf(id)`: row → map → scan (`getTunnel` on each account, any `AppError` = not here); a row with `accountId === null` found by scan is written back.
- `create`: one account → default; several and none given → `ACCOUNT_SELECTION_REQUIRED` 400; unknown → `ACCOUNT_NOT_FOUND`; calls `onAccountUsed(accountId)`.
- `updateRoutes`: zones from `accounts.get(accountOf(id)).zones`; unmatched → `ZONE_NOT_FOUND` with message `Hostname does not belong to a zone in this tunnel's account`.

- [ ] Step 1: tests (existing ones adapted to `list().tunnels`, plus) —
  - two accounts: create `a` in Home Lab and `b` in Second Org → `list().tunnels` has both with the right `account`; fake stores each under its account.
  - create without account with two accounts → `ACCOUNT_SELECTION_REQUIRED`; with one account → uses it.
  - Second Org listing fails with 403 once → `unavailableAccounts = [{ id: SECOND, name: 'Second Org', code: 'CF_PERMISSION_MISSING' }]` and Home Lab tunnels still listed, a managed Second Org tunnel is **not** shown as a ghost.
  - `updateRoutes` on a Second Org tunnel with `ha.example.com` → `ZONE_NOT_FOUND`, no config write (version unchanged), no DNS record in example.com; with `ha.second.net` → CNAME created in `second.net`.
  - unmanaged tunnel in Second Org, fresh service (no list yet): `get(id)` resolves it by scanning.
  - `delete` of a Second Org tunnel removes its DNS in `second.net`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run `pnpm --filter @tm/server exec vitest run src/tunnels` → PASS.
- [ ] Step 5: commit `feat(server): manage tunnels across every account`.

### Task 5: Context, HTTP routes, backup

**Files:**
- Modify: `apps/server/src/http/context.ts`, `apps/server/src/http/routes/cloudflare.ts`, `apps/server/src/http/routes/tunnels.ts`, `apps/server/src/http/routes/backup.ts`, `apps/server/src/http/routes/setup.ts` (unchanged logic, uses new `getCloudflare`)
- Test: `apps/server/src/http/http.test.ts`

**Produces:** `ctx.api(accountId)`, `ctx.accounts`, endpoints per spec §4.5; `GET /zones` removed.

Token connect: verify → build a temporary `AccountDirectory` for the new token → accounts (none → `CF_PERMISSION_MISSING` Tunnel) → `listTunnels` on all in parallel (none OK → rethrow the first failure wrapped with `withPermission(TUNNEL_PERMISSION, name)`) → at least one zone overall (else Zone permission error) → `setCloudflare({ token })`, `ctx.accounts.invalidate()` → status.

- [ ] Step 1: tests —
  - connect with two accounts → 200, status lists both accounts with zones, no `accountId` needed.
  - replace the account-selection test with the above; keep "discovers from zones", "invalid token", "names the missing permission" (single account, 403 → error names Home Lab).
  - two accounts, Second Org tunnels 403 → connect still succeeds.
  - lifecycle test uses `json().tunnels`; `POST /tunnels` with `accountId` of Second Org; bad `accountId` → `VALIDATION_ERROR`; unknown valid id → `ACCOUNT_NOT_FOUND`.
  - status `lastAccountId` equals the account of the last created tunnel.
  - backup export includes `accountId`; import of an old backup (no `accountId`) still 204.
  - upgrade: seed a DB with v0.2.0 settings (`cf_token` encrypted via `SettingsRepo.set`, `cf_account_id`) → `setup/status.cloudflareConnected === true`, tunnels listed.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: `pnpm --filter @tm/server test` and `pnpm --filter @tm/server typecheck` → PASS.
- [ ] Step 5: commit `feat(server): API for multiple Cloudflare accounts`.

### Task 6: Web — connection and settings

**Files:**
- Modify: `apps/web/src/api/hooks.ts` (`useTunnels` returns `TunnelList`; `useConnectCloudflare(b: {token})`; `useCreateTunnel(b: {name, accountId?})`), `apps/web/src/components/connect-cloudflare-form.tsx`, `apps/web/src/pages/settings.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/pt-BR.json`
- Test: `apps/web/src/pages/setup.test.tsx`, `apps/web/src/pages/settings.test.tsx`

Strings (en / pt-BR):
- `setup.connectedAccounts`: "Connected to {{count}} account(s)" plural forms (`_one`/`_other`) / "Conectado a {{count}} conta(s)".
- `setup.accountsSummary`: "{{accounts}} · {{zones}} domains" / "{{accounts}} · {{zones}} domínios".
- `settings.accounts`: "Cloudflare accounts" / "Contas Cloudflare".
- remove `setup.chooseAccount`; `errors.ACCOUNT_SELECTION_REQUIRED` becomes "Choose the account for this tunnel." / "Escolha a conta deste túnel."; add `errors.ACCOUNT_NOT_FOUND` "This Cloudflare account is not reachable with the current token." / "Esta conta Cloudflare não está acessível com o token atual."; `errors.ZONE_NOT_FOUND` mentions "this tunnel's account" / "na conta deste túnel".

- [ ] Step 1: tests — connect form posts only `{token}` and shows "Connected to 2 accounts" and both account names; settings shows each account name with its domain badges and the token suffix.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: run → PASS (`i18n.test.ts` checks both locales have the same keys).
- [ ] Step 5: commit `feat(web): connect a token that reaches several accounts`.

### Task 7: Web — dashboard and create dialog

**Files:**
- Modify: `apps/web/src/pages/dashboard.tsx`, `apps/web/src/components/tunnel-table.tsx`, `apps/web/src/components/create-tunnel-dialog.tsx`, i18n files
- Test: `apps/web/src/pages/dashboard.test.tsx`, `apps/web/src/components/tunnel-table.test.tsx`

Behaviour:
- `accounts = useCloudflareStatus().data?.accounts ?? []`; `multi = accounts.length > 1`.
- Filter `Select` (`dashboard.accountFilter` "Account" / "Conta", item `all` = `dashboard.allAccounts` "All accounts" / "Todas as contas") beside the search, only when `multi`. Cards and table use the filtered list (search and account).
- `TunnelTable` gets `showAccount` → an "Account" column (`dashboard.account`) with the account name.
- One `Banner variant="alert"` per `unavailableAccounts` entry: `dashboard.accountUnavailable` "Could not load tunnels from {{account}}: {{reason}}" / "Não foi possível carregar os túneis de {{account}}: {{reason}}" (reason = translated error code).
- Create dialog: `Select` "Account" when `multi`, default `lastAccountId` if present in the list else first; sends `accountId` when `multi`.

- [ ] Step 1: tests — dashboard with two accounts shows the column and filter; choosing "Second Org" hides Home Lab rows and updates the cards; unavailable account banner text; create dialog posts `{name, accountId}` with the preselected `lastAccountId` and no select with one account.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS.
- [ ] Step 5: commit `feat(web): show and filter tunnels by account, pick it on creation`.

### Task 8: Web — tunnel page

**Files:**
- Modify: `apps/web/src/pages/tunnel.tsx`, `apps/web/src/components/routes/routes-tab.tsx`
- Test: `apps/web/src/pages/tunnel.test.tsx`, routes tab test if present

Behaviour: account `Badge` in the header badges when there is more than one account; `RoutesTab` zones = `accounts.find(a => a.id === tunnel.account.id)?.zones ?? []`.

- [ ] Step 1: test — tunnel of Second Org: badge "Second Org" visible; opening "Add public hostname" lists only `second.net` in the domain select.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS.
- [ ] Step 5: commit `feat(web): scope a tunnel's domains to its account`.

### Task 9: e2e, docs, full verification

**Files:**
- Modify: `e2e/flow.spec.ts`, `README.md` (token/accounts wording), `docs/manual-test-checklist.md`

- [ ] Step 1: e2e — setup shows "Connected to 2 accounts"; create `home` in the default account, the existing flow runs unchanged; create `work` choosing "Second Org", open "Add public hostname", the domain select offers only `second.net`; delete `work`.
- [ ] Step 2: `pnpm test && pnpm typecheck && pnpm e2e` → all PASS.
- [ ] Step 3: README/checklist mention that every account the token reaches is used, and that hostnames must be in the tunnel's account.
- [ ] Step 4: commit `test(e2e): cover tunnels in a second account` and `docs: explain multiple accounts`.

### Task 10: Real test (manual, with the user)

- User creates the admin and pastes the token in a fresh local instance (Docker image built from the branch or LXC 101 later); I never type secrets.
- Create `tm-e2e-upcast` in UPCAST and `tm-e2e-cloudhub` in INTERCASE-CLOUDHUB; publish one hostname each on a domain of that account, pointing to a local nginx origin; confirm both over the internet (curl); confirm the hostname dialog only offers the tunnel account's domains; confirm a cross-account hostname is refused.
- Note what the real API returns for a tunnel id queried in another account; adjust the fake if it differs.
- Delete both tunnels through the app; check in the Cloudflare dashboard (both accounts) that tunnels and CNAMEs are gone; remove containers/volumes/images; user deletes the token.

---

## Addendum (spec §10)

### Task 11: Active accounts — server
- Settings: `enabledAccounts(): string[] | null`, `setEnabledAccounts(ids)`, `accountNames(): Record<string,string>`, `rememberAccountNames(list)`.
- `AccountDirectory(client, { isEnabled?, onDiscovered?, failureTtlMs? })`: `list()` = active, `listAll()` = all, failures cached `failureTtlMs` (10 s), forbidden `/accounts` tolerated.
- `PUT /cloudflare/accounts`, status `enabled`, token connect keeps the intersected selection, `ACCOUNT_IN_USE`.
- TunnelService: `ZONE_NOT_FOUND` → `accounts.invalidate()` + one retry; unreachable rows named via `accountName(id)`; delete event for DNS left in unreachable zones.
- Tests (http + directory + service) written first for every item.

### Task 12: Active accounts — web
- Connect form checkbox step; Settings account checkboxes; `activeAccounts(status)` helper used by dashboard, create dialog, tunnel page; filter fallback; status polling while connected with no accounts; i18n en/pt-BR; e2e unchecks Second Org.
