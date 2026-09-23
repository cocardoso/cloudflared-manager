# Checklist de teste manual no Proxmox

Use antes de cada release. Marque cada item com o resultado observado.

## Instalação

- [ ] Rodar o comando de instalação no host; o LXC é criado com Debian 13, 1 vCPU, 1 GB RAM, 4 GB disco, não-privilegiado.
- [ ] `http://<ip>:8080` abre a tela de boas-vindas.
- [ ] Dentro do LXC: `systemctl status tunnel-manager` ativo; `ls -l /etc/tunnel-manager/secret.key` com modo `-rw-------` e dono `tunnelmgr`.
- [ ] `sudo -u tunnelmgr sudo -n -l` lista somente os comandos do sudoers.

## Setup

- [ ] Criar admin; senha curta é rejeitada.
- [ ] Botão "Criar token na Cloudflare" abre o painel com as 3 permissões preenchidas.
- [ ] Colar o token; se houver várias contas, a escolha de conta aparece; os domínios corretos são listados.

## Túneis

- [ ] Criar túnel; `systemctl status cloudflared@<id>` ativo; o painel Zero Trust mostra o túnel "Healthy".
- [ ] Adicionar hostname em cada um de dois domínios; o acesso externo funciona; o CNAME aparece no DNS de cada domínio.
- [ ] Adicionar hostname que já tem registro A: a interface pede confirmação para substituir.
- [ ] Editar a rota no painel Zero Trust e salvar na interface sem recarregar: aparece o aviso de conflito de versão.
- [ ] Remover rota: o CNAME some. Remover desmarcando "Excluir também o registro DNS": o CNAME fica.
- [ ] Logs ao vivo aparecem na aba Logs; pausar e retomar funciona.
- [ ] Gráfico de tráfego aparece após alguns minutos de uso.

## Resiliência

- [ ] `pct reboot <ctid>`: interface e túneis voltam sozinhos.
- [ ] `systemctl kill -s KILL cloudflared@<id>`: o systemd reinicia em ~5 s.
- [ ] Desligar a internet do host por 5 min: nenhum loop de reinício; evento "Sem internet"; o túnel volta sozinho quando a rede volta.
- [ ] Com a internet desligada, `systemctl restart cloudflared@<id>` não trava (validar `Type=notify` + `TimeoutStartSec=0`).
- [ ] Parar o túnel pela interface: o watchdog não o reinicia.

## Manutenção

- [ ] Atualizar o `cloudflared` pela tela de Configurações; os túneis ativos reiniciam.
- [ ] Rodar o `update` do script dentro do LXC; os túneis não caem; `/opt/tunnel-manager.old` existe.
- [ ] Exportar e importar backup.
- [ ] Excluir túnel: some da Cloudflare, do DNS e do systemd.
- [ ] 6 logins errados seguidos: a sexta tentativa é bloqueada por 1 minuto.
- [ ] Trocar idioma e tema; a escolha persiste após recarregar.
