# Cloudflared Manager para Proxmox

Script no estilo [community-scripts](https://community-scripts.org/scripts/cloudflared) que cria um LXC no Proxmox com o `cloudflared` **e** uma interface web para gerenciar túneis da Cloudflare. Você configura pelo navegador, fecha a página, e os túneis continuam conectados, sem nada rodando no seu desktop.

- Cria, para, reinicia, edita e exclui túneis (gerenciados remotamente pela API da Cloudflare).
- Publica serviços da sua rede em **qualquer domínio da sua conta** (`app.dominio-a.com`, `git.dominio-b.dev`…), com criação e remoção automática do CNAME.
- **Keep-alive** por túnel: o túnel se recupera sozinho de queda de processo, de internet ou de reboot.
- Logs ao vivo, histórico de eventos, conexões com a borda e gráfico de tráfego.
- Interface em **português e inglês**, no mesmo design system do painel da Cloudflare ([Kumo](https://www.npmjs.com/package/@cloudflare/kumo)).

## Instalação

Na shell do **host** Proxmox:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/cocardoso/cloudflared-proxmox/main/ct/cloudflared-manager.sh)"
```

Padrões do container (ajustáveis nos menus do instalador): Debian 13, 1 vCPU, 1 GB de RAM, 4 GB de disco, não-privilegiado, x86-64 e ARM64.

No fim, o instalador mostra o endereço da interface: `http://<ip-do-lxc>:8080`.

## Primeiro acesso

1. **Crie o administrador** (senha com pelo menos 12 caracteres).
2. **Conecte a Cloudflare**: clique em **Criar token na Cloudflare**. O painel abre com as permissões já preenchidas; é só confirmar, copiar o token e colar. Isso é feito uma única vez. Permissões usadas:
   - Conta → Cloudflare Tunnel → Editar
   - Zona → DNS → Editar
   - Zona → Zona → Ler
   - Recursos de zona: todas as zonas

   Se o token tiver acesso a várias contas, a interface pede para você escolher uma.

O token fica cifrado (AES-256-GCM) dentro do LXC e nunca volta para o navegador.

## Como o keep-alive funciona

São três camadas:

1. O `cloudflared` mantém 4 conexões com a borda da Cloudflare e reconecta sozinho quando a rede cai.
2. Cada túnel é uma unit systemd (`cloudflared@<id>.service`) com `Restart=always`, habilitada no boot.
3. Um **watchdog** consulta o `/ready` de cada túnel a cada 30 s. Se o túnel ficar indisponível além da tolerância configurada (padrão 2 min), ele reinicia a unit com backoff exponencial (30 s → 10 min). Depois de 5 tentativas sem sucesso, desiste e mostra um alerta. Sem conexão com a internet, ele **não** reinicia nada: só espera a rede voltar.

## Atualização

Rode o mesmo comando de instalação **dentro do LXC** (ou `update`, se o community-scripts tiver instalado o atalho). Ele atualiza o sistema, o `cloudflared` e a interface. Os túneis continuam no ar durante a atualização da interface. O `cloudflared` também pode ser atualizado pela tela de Configurações.

## Desenvolvimento

Requisitos: Node 22.13+ (produção usa Node 24) e pnpm 9.

```bash
pnpm install
pnpm dev:fake-cf   # API falsa da Cloudflare em http://127.0.0.1:18787 (token: fake-token-0123456789abcdefghij)
CF_API_BASE=http://127.0.0.1:18787 pnpm dev   # server (backend systemd simulado) + web em http://localhost:5173
```

Para usar a API real, omita `CF_API_BASE`. O backend `SERVICE_BACKEND=fake` (padrão do `pnpm dev`) simula o systemd, então roda no macOS.

| Comando | O que faz |
|---|---|
| `pnpm test` | Testes unitários (server, web, shared) |
| `pnpm typecheck` | TypeScript em todos os pacotes |
| `pnpm e2e` | Fluxo completo no navegador (Playwright) contra a Cloudflare falsa |
| `bash scripts/package-release.sh v0.1.0` | Gera o tarball do release em `release/` |
| `bash scripts/set-repo.sh usuario/repo` | Aponta os scripts do Proxmox para o seu repositório GitHub |

### Publicando

1. `bash scripts/set-repo.sh <usuario>/<repo>` e commit.
2. `git tag v0.1.0 && git push --tags`: o workflow `release` gera o tarball e cria o GitHub Release que o instalador baixa.

## Estrutura

```
ct/                 script que roda no host Proxmox (cria o LXC)
install/            script que roda dentro do LXC
deploy/             units systemd e sudoers
packages/shared/    schemas zod e tipos da API
apps/server/        Fastify: API Cloudflare, systemd, watchdog, SQLite
apps/web/           React + Kumo + i18n (en, pt-BR)
e2e/                testes Playwright
docs/               spec, plano e checklist de teste manual
```

## Limitações conhecidas

- Em LXC não-privilegiado, o `cloudflared` pode registrar avisos sobre buffers UDP do QUIC e sobre `ping_group_range` (proxy ICMP). Eles não impedem o funcionamento; se quiser, force o protocolo `http2` nas configurações do túnel.
- Túneis com configuração local (`config.yml`) aparecem apenas para leitura.
- Um único usuário administrador.
