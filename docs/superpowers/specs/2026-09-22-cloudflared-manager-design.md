# Cloudflared Manager para Proxmox — Design

- **Data:** 2026-09-22
- **Status:** aguardando revisão
- **Referência:** script [community-scripts cloudflared](https://community-scripts.org/scripts/cloudflared) (`ct/cloudflared.sh` + `install/cloudflared-install.sh`).

## 1. Objetivo

Um script estilo community-scripts que cria, no Proxmox, um LXC com `cloudflared` **e** uma aplicação web de gerenciamento de túneis Cloudflare. O usuário configura tudo pelo navegador, fecha a página e os túneis continuam no ar, sem nada rodando no desktop.

### Contexto e premissas do usuário

- Uso: **homelab pessoal**, acesso à GUI pela LAN, um único administrador.
- Gerenciamento **100% via web**, construído do zero.
- **Keep-alive** configurável por túnel; o túnel deve se recuperar sozinho de queda de processo, de internet ou de qualquer outra falha.
- Gerenciar, parar, excluir e alterar túneis pela interface.
- Usar **vários domínios** (zonas) da conta Cloudflare: túnel A no domínio A, túnel B no domínio B (ou um túnel com rotas em ambos).
- Autenticação com a Cloudflare com o mínimo de atrito possível.
- Interface em **inglês e português (pt-BR)**.
- Visual idêntico ao painel da Cloudflare.

### Decisões tomadas

| Tema | Decisão | Motivo |
|---|---|---|
| Modelo de túnel | Túneis **gerenciados remotamente** via API Cloudflare (`config_src: cloudflare`) | Permite CRUD completo de túneis, rotas e DNS; modelo recomendado pela Cloudflare; o painel Zero Trust continua coerente. |
| Autenticação Cloudflare | **API Token** criado por um link com permissões pré-preenchidas, colado uma única vez e guardado cifrado | A Cloudflare não oferece OAuth para aplicações de terceiros; `cloudflared tunnel login` é limitado a uma zona e não permite editar configuração remota; Global API Key dá acesso total. |
| Stack | Node.js/TypeScript: **Fastify + React (Vite) + SQLite** | TS de ponta a ponta com tipos compartilhados; SDK oficial `cloudflare` para Node. |
| Design system | **Kumo** (`@cloudflare/kumo`), o design system oficial do painel Cloudflare | Visual igual ao do painel sem imitação manual. |
| Acesso à GUI | **Senha local de admin** (argon2 + cookie de sessão) | Protege o token contra outros dispositivos da LAN. |
| i18n | `react-i18next` com `en` e `pt-BR` | Pedido do usuário. |
| Instalação | Reuso do motor `build.func` do community-scripts, apontando para os nossos `ct/` e `install/` | Mesma experiência (menus, defaults, update) sem manter um motor próprio. |

## 2. Arquitetura

```
┌──────────────── LXC Debian 13 (não-privilegiado) ─────────────────┐
│                                                                   │
│  tunnel-manager.service (Node, usuário "tunnelmgr", porta 8080)   │
│   ├─ API HTTP (Fastify) + frontend React servido estático          │
│   ├─ cloudflare/  ────────────────────────► api.cloudflare.com    │
│   ├─ services/    ── sudo restrito ───────► systemctl/journalctl  │
│   ├─ watchdog/    ── a cada 30s ──────────► 127.0.0.1:<porta>/ready│
│   └─ store/       ── SQLite /var/lib/tunnel-manager/data.db       │
│                                                                   │
│  cloudflared@<tunnel-id>.service   (1 unit por túnel)             │
│   └─ cloudflared tunnel --metrics 127.0.0.1:<porta> run           │
│        TUNNEL_TOKEN via /etc/tunnel-manager/tunnels/<id>.env      │
└───────────────────────────────────────────────────────────────────┘
```

### 2.1 Unidades

- **`cloudflare/`**: wrapper fino sobre o SDK oficial `cloudflare`. Responsabilidades:
  - verificar o token (`/user/tokens/verify`), listar contas e zonas;
  - CRUD de túneis `cfd_tunnel` com `config_src: cloudflare`;
  - ler e escrever a configuração remota (`GET/PUT /accounts/{account}/cfd_tunnel/{id}/configurations`);
  - buscar o token do túnel (`GET .../cfd_tunnel/{id}/token`);
  - CRUD de registros CNAME `<host> → <tunnel-id>.cfargotunnel.com` (proxied);
  - ler conexões ativas do túnel (datacenters, versão do conector).
  - Traduz erros da API para códigos de domínio (seção 4).
- **`services/`**: único módulo que toca o sistema operacional. Fica atrás de uma interface `ServiceBackend` com duas implementações: `systemd` (produção) e `fake` (dev/testes, ativada com `SERVICE_BACKEND=fake`).
  - escreve `/etc/tunnel-manager/tunnels/<id>.env` (modo 0600, dono `tunnelmgr`) com `TUNNEL_TOKEN`, `TUNNEL_METRICS`, `TUNNEL_LOGLEVEL` e `TUNNEL_TRANSPORT_PROTOCOL`;
  - `enable/start/stop/restart/disable` de `cloudflared@<id>` via `sudo systemctl`;
  - estado da unit (`systemctl show`) e logs (`journalctl -u cloudflared@<id> -o json`, com follow para streaming).
- **`watchdog/`**: loop a cada 30 s para cada túnel com keep-alive ligado (ver 4.2).
- **`store/`**: SQLite (`better-sqlite3`) com migrações versionadas. Tabelas:
  - `admin` (usuário, hash argon2id);
  - `settings` (id da conta, token Cloudflare cifrado, sufixo do token, idioma padrão);
  - `tunnels` (id Cloudflare, porta de métricas, keep-alive, tolerância em minutos, loglevel, protocolo, estado do watchdog, contadores de falha);
  - `managed_dns` (id do registro DNS, zona, hostname, túnel), usado para saber quais registros a aplicação criou e pode remover;
  - `events` (túnel, tipo, mensagem, timestamp), com retenção de 30 dias.
  - O token Cloudflare é cifrado com AES-256-GCM usando a chave em `/etc/tunnel-manager/secret.key` (gerada na instalação, modo 0600).
- **`web/`**: SPA React + Kumo + TanStack Query + react-router + react-i18next. Conversa apenas com a API HTTP.
- **`packages/shared/`**: schemas zod e tipos do contrato da API, usados pelo server (validação) e pela web (tipagem).

### 2.2 Fonte da verdade

- **Cloudflare** é a fonte da verdade para túneis, rotas (ingress) e DNS. A GUI sempre lê da API; edições feitas no painel Zero Trust aparecem na GUI.
- **SQLite** guarda apenas o que é local: admin, token, parâmetros de execução dos túneis que rodam neste LXC, DNS gerenciados e eventos.
- Um túnel da conta que ainda não roda neste LXC aparece como **"não executado aqui"** e pode ser **adotado** (a aplicação busca o token do túnel e cria a unit). Túneis locally-managed (`config_src: local`) são listados como somente leitura, com aviso.
- Alterar rotas **não reinicia** o `cloudflared`: a configuração remota chega ao conector em poucos segundos.

## 3. Telas e fluxos

### 3.1 Setup inicial (wizard, só no primeiro acesso)

1. Criar usuário e senha do admin (senha com mínimo de 12 caracteres).
2. Conectar à Cloudflare: o botão **"Criar token na Cloudflare"** abre `https://dash.cloudflare.com/profile/api-tokens` com nome e permissões pré-preenchidos:
   - Account → Cloudflare Tunnel → Edit
   - Zone → DNS → Edit
   - Zone → Zone → Read
   - Recursos: todas as zonas da conta.
   O usuário cola o token; a aplicação valida, detecta a(s) conta(s) (seletor se houver mais de uma) e lista as zonas encontradas. Se faltar permissão, mostra qual está faltando.
3. Redireciona para o Dashboard.

> O formato exato do link pré-preenchido (parâmetros de query aceitos pelo painel) será confirmado na implementação. Se o painel não aceitar pré-preenchimento, a tela mostra as permissões com instruções passo a passo e botão de copiar.

### 3.2 Dashboard

- Cards de resumo: túneis saudáveis / degradados / parados / falhando, total de rotas, últimos eventos do watchdog.
- Lista de túneis mostrando:
  - status **local** (unit: ativa, parada, falhando);
  - status **edge** (número de conexões e datacenters, ex.: GRU, EZE);
  - uptime e keep-alive on/off.
- Ação primária: **Criar túnel**.

### 3.3 Criar túnel

Nome → a aplicação cria o túnel remoto, busca o token, aloca a porta de métricas, escreve o `.env`, habilita e inicia a unit. O passo seguinte, opcional, é adicionar a primeira rota.

### 3.4 Detalhe do túnel (abas)

- **Rotas**: tabela hostname → serviço. Formulário com:
  - seletor de **domínio** (zonas da conta) + subdomínio + path opcional;
  - serviço: `http://`, `https://`, `tcp://`, `ssh://`, `rdp://`, `unix:`, `http_status:`;
  - avançado (`originRequest`): `noTLSVerify`, `httpHostHeader`, `originServerName`, `connectTimeout`, `keepAliveTimeout`;
  - botão **Testar origem** (conexão TCP/HTTP feita a partir do LXC).
  - Reordenação das regras (a ordem importa no ingress); o catch-all `http_status:404` é sempre mantido por último e não é editável.
- **Status**: conexões ativas por datacenter, versão do `cloudflared`, gráfico (ECharts via Kumo) de requisições e erros extraído do `/metrics` (amostragem guardada em memória, janela de 1 h).
- **Logs**: stream ao vivo do `journalctl` via SSE, com filtro por nível e pausa.
- **Eventos**: histórico de restarts, quedas, recuperações e alterações de configuração.
- **Configurações**: renomear; keep-alive on/off; tolerância antes do restart (padrão 2 min); loglevel; protocolo (`auto`/`quic`/`http2`).
- **Zona de perigo**: **Parar**, **Reiniciar**, **Excluir**. Excluir remove as rotas, os DNS em `managed_dns`, o túnel na Cloudflare, a unit e o `.env`; exige digitar o nome do túnel.

### 3.5 Configurações gerais

- Trocar senha do admin.
- Trocar ou revalidar o token Cloudflare (exibido apenas como `••••abcd`).
- Idioma (en / pt-BR; o padrão vem do navegador) e tema (claro / escuro / sistema).
- Versão do `cloudflared` instalada vs. última disponível, com botão **Atualizar** (`apt-get install --only-upgrade cloudflared` via sudoers, seguido de restart dos túneis).
- Exportar e importar backup (JSON com parâmetros locais dos túneis e `managed_dns`; o token não é exportado).

### 3.6 Fora do escopo (por enquanto)

Multiusuário, Cloudflare Access, WARP/private networks, notificações externas (Telegram, e-mail), outros idiomas além de en/pt-BR. A arquitetura não impede adicioná-los depois.

## 4. Fluxo de dados, erros e resiliência

### 4.1 Adicionar ou editar uma rota

1. UI: `POST /api/tunnels/:id/routes` (ou `PUT .../routes/:index`).
2. Server lê a configuração atual do túnel na Cloudflare, aplica a alteração mantendo o catch-all por último e faz o `PUT` da configuração.
3. Cria ou atualiza o CNAME `host → <id>.cfargotunnel.com` (proxied) e registra o registro em `managed_dns`.
   - Se já existir um registro para o host apontando para **outro destino**, a operação é abortada antes do passo 2 com `DNS_CONFLICT`; a UI pergunta se deve sobrescrever e reenvia com `overwrite: true`.
4. Se o passo 3 falhar, o server faz **rollback** do ingress para a versão lida no passo 2 e devolve o erro. O estado nunca fica parcialmente aplicado.

Remover uma rota: remove do ingress e, se o registro estiver em `managed_dns`, remove o CNAME (com confirmação na UI).

### 4.2 Watchdog e keep-alive

Três camadas de recuperação:

1. **cloudflared**: mantém 4 conexões com a edge e reconecta sozinho quando a rede cai.
2. **systemd**: `Restart=always`, `RestartSec=5`, units `enabled`, então sobem no boot.
3. **watchdog** (apenas túneis com keep-alive ligado), máquina de estados por túnel:
   - `healthy`: unit ativa e `/ready` responde 200.
   - `degraded`: falhou a verificação; registra um evento; espera a tolerância configurada.
   - `restarting`: tolerância estourada → `systemctl restart`, com backoff exponencial de 30 s até 10 min entre tentativas.
   - `failing`: 5 restarts seguidos sem voltar a `healthy`; o watchdog para de reiniciar e a UI mostra alerta com ação "tentar de novo".
   - Voltar a `healthy` zera os contadores.
   - Sem internet, `/ready` falha em todos os túneis; se o host `api.cloudflare.com` também estiver inacessível, o watchdog registra "sem conectividade" e **não** conta restarts (reiniciar não ajuda).

Com keep-alive desligado, o túnel ainda tem as camadas 1 e 2; apenas o watchdog não age.

### 4.3 Erros

- Formato único: `{ code, message, details? }` com HTTP status coerente.
- Códigos de domínio, por exemplo: `CF_UNREACHABLE`, `CF_TOKEN_INVALID`, `CF_PERMISSION_MISSING` (com a permissão faltante em `details`), `CF_RATE_LIMITED`, `DNS_CONFLICT`, `TUNNEL_NOT_FOUND`, `SERVICE_COMMAND_FAILED`, `VALIDATION_ERROR`.
- A UI traduz o `code` (en/pt-BR) e sugere a ação correspondente.

### 4.4 Situações degradadas

- **Sem internet**: status local, logs e eventos continuam funcionando; ações que dependem da API mostram "Cloudflare inacessível".
- **Token revogado ou expirado**: os túneis continuam rodando (cada um usa seu próprio token de túnel); a GUI entra em modo "reconectar" e bloqueia só as ações de API.
- **Reboot do LXC**: units e GUI sobem sozinhas; os túneis não dependem da GUI.

### 4.5 Segurança

- Sessão em cookie `httpOnly`, `SameSite=Strict`, expiração de 7 dias; rate limit no login (5 tentativas/min por IP).
- Token Cloudflare cifrado em repouso; nunca devolvido à UI (só os 4 últimos caracteres).
- `tunnelmgr` é um usuário sem shell; sudoers permite apenas:
  - `systemctl start|stop|restart|enable|disable|show cloudflared@*`
  - `journalctl -u cloudflared@*`
  - `apt-get install --only-upgrade -y cloudflared`
- Validação zod em todas as entradas da API; o id do túnel é validado como UUID antes de virar nome de unit ou de arquivo.

## 5. Instalação no Proxmox

Na shell do host Proxmox:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/<usuario>/cloudflared-proxmox/main/ct/cloudflared-manager.sh)"
```

### 5.1 `ct/cloudflared-manager.sh` (roda no host)

- Define `_CS_DEFAULT_URL` apontando para o raw do nosso repositório e faz `source` do `build.func` de `community-scripts/core` **fixado em um commit** (via `COMMUNITY_SCRIPTS_CORE_URL`).
- Padrões: Debian 13, 1 vCPU, 1024 MB RAM, 4 GB disco, não-privilegiado, `var_arm64=yes`, tags `network;cloudflare`. Todos ajustáveis pelos menus do `build.func`.
- `update_script()`: `apt` upgrade (inclui `cloudflared`) + download do último release do manager, troca atômica do diretório da aplicação, migrações e restart de `tunnel-manager.service`. Os túneis não são reiniciados pelo update do manager.

### 5.2 `install/cloudflared-manager-install.sh` (roda no LXC)

1. Repositório apt da Cloudflare + `cloudflared` (igual ao script da comunidade).
2. Node.js 22 LTS.
3. Usuário `tunnelmgr`; diretórios `/opt/tunnel-manager`, `/var/lib/tunnel-manager`, `/etc/tunnel-manager/tunnels`.
4. `secret.key` aleatória (0600).
5. `/etc/sudoers.d/tunnel-manager`, `cloudflared@.service` e `tunnel-manager.service` (copiados de `deploy/`).
6. Download do tarball do último GitHub Release **da arquitetura do container** (`linux-x64` ou `linux-arm64`) para `/opt/tunnel-manager`. O tarball já traz `node_modules` de produção com os módulos nativos (`better-sqlite3`, `argon2`) compilados no CI, então nada é compilado no container.
7. `systemctl enable --now tunnel-manager`; mensagem final com `http://<ip>:8080`.

### 5.3 Template da unit do túnel

```ini
# /etc/systemd/system/cloudflared@.service
[Unit]
Description=Cloudflare Tunnel %i
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=/etc/tunnel-manager/tunnels/%i.env
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run
Restart=always
RestartSec=5
DynamicUser=yes

[Install]
WantedBy=multi-user.target
```

(O `cloudflared` lê `TUNNEL_TOKEN`, `TUNNEL_METRICS`, `TUNNEL_LOGLEVEL` e `TUNNEL_TRANSPORT_PROTOCOL` das variáveis de ambiente.)

## 6. Estrutura do repositório

```
ct/cloudflared-manager.sh
install/cloudflared-manager-install.sh
packages/shared/          # schemas zod + tipos do contrato da API
apps/server/              # Fastify: cloudflare/, services/, watchdog/, store/, routes/
apps/web/                 # React + Kumo + i18n (en, pt-BR)
deploy/                   # cloudflared@.service, tunnel-manager.service, sudoers
.github/workflows/        # CI (lint, testes, shellcheck) + release (tarballs linux-x64 e linux-arm64 no GitHub Release)
docs/
```

Monorepo pnpm.

## 7. Testes

- **Server** (Vitest):
  - `cloudflare/` contra mock HTTP (`msw`): tradução de erros, paginação, permissões faltantes.
  - Fluxo de rotas: inserção antes do catch-all, conflito de DNS, rollback do ingress quando o DNS falha.
  - Watchdog: máquina de estados com relógio falso (backoff, limite de 5, sem-conectividade não conta restart).
  - `services/` testado pela implementação `fake`; a implementação `systemd` tem testes de construção de comandos (sem executar).
  - Cifragem do token (round-trip, chave errada falha).
- **Web** (Vitest + Testing Library): formulário de rota, wizard de setup, troca de idioma.
- **E2E** (Playwright): setup → criar túnel → adicionar rota → excluir túnel, com server em `SERVICE_BACKEND=fake` e Cloudflare mockada.
- **Scripts**: `shellcheck` no CI; teste real manual no Proxmox seguindo um checklist em `docs/`.
- **Dev local no macOS**: `SERVICE_BACKEND=fake` permite rodar a aplicação completa sem Linux/systemd.

## 8. Riscos e pontos a confirmar na implementação

- Parâmetros de pré-preenchimento do link de criação de token no painel Cloudflare (fallback descrito em 3.1).
- Endpoint e formato exatos das conexões ativas do túnel na API (`/cfd_tunnel/{id}/connections`).
- Compatibilidade do `DynamicUser=yes` com `EnvironmentFile` dono de `tunnelmgr` em LXC não-privilegiado (o `EnvironmentFile` é lido pelo systemd como root, então deve funcionar; validar no teste manual).
- Avisos do `cloudflared` em LXC não-privilegiado (buffers UDP do QUIC, `ping_group_range` para proxy ICMP): documentar, não bloqueiam o funcionamento.
- Estabilidade da API do Kumo (biblioteca nova); fixar a versão.
