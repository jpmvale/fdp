# Instalação na VPS

Um processo Node persistente atrás do Caddy, com Redis local (`11` §1). Tudo aqui
é feito **uma vez**; depois, subir versão nova é `./deploy/deploy.sh usuario@host`.

Requisitos: Debian 12 ou Ubuntu 22.04+, acesso `sudo`, e um domínio já apontando
para o IP da VPS — o Caddy precisa dele resolvendo antes de emitir o certificado.

## 1. Pacotes

```bash
sudo apt update && sudo apt install -y curl ca-certificates gnupg rsync ufw
```

**Node 24.** A distribuição traz uma versão velha demais:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # precisa ser v24.x
```

**Redis.**

```bash
sudo apt install -y redis-server
```

## 2. Redis só no loopback

Nunca exposto à internet (`11` §7). Confirme os dois valores em
`/etc/redis/redis.conf`:

```
bind 127.0.0.1 -::1
protected-mode yes
```

```bash
sudo systemctl enable --now redis-server
redis-cli ping     # PONG
```

Sem senha é aceitável **porque** a porta não sai da máquina. Se um dia o Redis
passar a escutar em outra interface, `requirepass` deixa de ser opcional.

## 3. Usuário e diretórios

O serviço roda como usuário próprio, sem shell: se o processo for comprometido,
o que se ganha é o mínimo.

```bash
sudo useradd --system --home /opt/fdp --shell /usr/sbin/nologin fdp
sudo mkdir -p /opt/fdp /etc/fdp
sudo chown fdp:fdp /opt/fdp
```

## 4. Segredos

`FDP_SESSION_SECRET` é **obrigatório em produção** — sem ele o processo recusa
subir (RNF-075). Ele precisa ser estável entre reinícios: trocá-lo invalida toda
sessão viva e derruba as partidas em curso.

```bash
sudo tee /etc/fdp/env > /dev/null <<EOF
FDP_SESSION_SECRET=$(openssl rand -hex 32)
REDIS_URL=redis://127.0.0.1:6379
ALLOWED_ORIGIN=https://SEU-DOMINIO.com
TRUST_PROXY=1
PORT=3000
EOF

sudo chown root:fdp /etc/fdp/env
sudo chmod 640 /etc/fdp/env
```

`TRUST_PROXY=1` só é seguro **porque** o Caddy está na frente e sobrescreve
`X-Forwarded-For`. Se a porta 3000 ficar acessível de fora, qualquer um forja o
cabeçalho e contorna o rate limit de RNF-003 — daí o firewall do passo 7 não ser
opcional.

## 5. Primeiro envio do código

Da sua máquina:

```bash
rsync -az --delete --exclude '.git' --exclude 'node_modules' \
  ./ usuario@host:/opt/fdp/

ssh usuario@host 'cd /opt/fdp && npm ci --omit=dev && sudo chown -R fdp:fdp /opt/fdp'
```

Não há passo de build: o repositório roda dos fontes TypeScript sob `tsx`, que
por isso está em `dependencies` e não em `devDependencies`. Os pacotes do
workspace exportam `.ts` e os imports usam `.js` — convenção ESM do TypeScript
que o resolvedor do Node não mapeia de volta, então `node` puro não sobe o
processo.

> Empacotar tudo num único `.js` com esbuild é a alternativa, e vale a pena
> quando o tempo de subida começar a incomodar. Hoje não incomoda, e um passo de
> build a menos é um jeito a menos de o que roda divergir do que está commitado.

## 6. systemd

```bash
sudo cp /opt/fdp/deploy/fdp.service /etc/systemd/system/fdp.service
sudo systemctl daemon-reload
sudo systemctl enable --now fdp

systemctl status fdp
curl -s localhost:3000/api/health     # {"ok":true,...}
```

Logs: `journalctl -u fdp -f`.

## 7. Firewall

A porta 3000 **não sai da máquina** (`11` §7). Só 80, 443 e SSH.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

## 8. Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Edite `deploy/Caddyfile` trocando `SEU-DOMINIO.com` e `SEU-EMAIL@exemplo.com`,
depois:

```bash
sudo cp /opt/fdp/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O TLS é emitido no primeiro acesso. Se falhar, quase sempre é DNS ainda não
propagado: `journalctl -u caddy -n 50`.

## 9. Verificar

```bash
curl -s https://SEU-DOMINIO.com/api/health
```

E o teste que realmente importa — **CA-046**, a partida sobrevivendo a um deploy:

1. Abra o site em três abas anônimas, crie a sala, entre nas outras duas e inicie.
2. `sudo systemctl restart fdp`
3. As três abas reconectam sozinhas e a partida continua na mesma rodada.

Se a janela de restart passar de 10 s (`TRANSPORT_GRACE`), a mesa pausa nomeando
quem caiu e retoma sozinha quando todos voltam — também correto, só mais visível.

## Operação

| Tarefa | Comando |
|---|---|
| Subir versão nova | `./deploy/deploy.sh usuario@host` |
| Ver logs | `ssh host journalctl -u fdp -f` |
| Reiniciar | `ssh host sudo systemctl restart fdp` |
| Salas vivas | `ssh host 'redis-cli --scan --pattern "room:*"'` |
| Versão no ar | `curl -s https://SEU-DOMINIO.com/api/health` |

**Backup não é necessário.** O Redis aqui guarda salas com TTL de 4 h; perder
tudo encerra as partidas em curso e nada mais (RNF-063). O que precisa de backup
é o repositório, que já vive no git, e `/etc/fdp/env` — que você consegue
regenerar, ao custo de derrubar as sessões vivas.
