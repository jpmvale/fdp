# Instalação na VPS

**Esta VPS não é uma máquina vazia.** `srv1876937` (187.77.242.128) hospeda
coda, kindred e expense-analyzer, com um **Caddy em container** segurando 80/443
e roteando por subdomínio pela rede `edge`. Deploy dos outros três é por
GitHub Actions → chave com forced command → `~/bin/deploy.sh <app> <tag>`,
puxando imagem do GHCR.

A versão anterior deste roteiro instalava Caddy por apt, criava unidade systemd
e mexia no `ufw`. Aplicada aqui, ela disputaria 80/443 com o proxy que serve os
outros três apps. Foi descartada em 25/08/2026, e o FDP passou a seguir a
convenção da máquina.

## Como está montado

| Peça | Onde |
|---|---|
| Fonte na VPS | `~/apps/fdp` (rsync a partir do repositório) |
| Stack | `docker-compose.prod.yml` na raiz do repositório |
| Containers | `fdp-api` e `fdp-redis`, nenhum publicando porta no host |
| Redes | `internal` (Redis) e `edge` (só a API, para o Caddy alcançar) |
| Segredo | `~/apps/fdp/.env.prod`, modo 600 |
| Roteamento | bloco `fdp.imp-software.cloud` em `~/caddy/Caddyfile` (cópia em [`Caddyfile`](Caddyfile)) |
| Sonda | `~/bin/metrica-fdp.sh` no cron de minuto (cópia em [`metrica-fdp.sh`](metrica-fdp.sh)) |

O Redis é **próprio** do FDP, e não o `coda-redis-1` que já roda na máquina:
compartilhar significaria que um `FLUSHALL` de um projeto derruba as partidas do
outro. Roda sem persistência em disco de propósito (RNF-063) — salas têm TTL de
4 h, e perder tudo encerra as partidas em curso e nada mais.

## Primeira instalação

Feita em 25/08/2026. Para refazer do zero:

```bash
ssh vps 'mkdir -p ~/apps/fdp'
rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude '.env*' \
  ./ vps:~/apps/fdp/

# Segredo estável entre reinícios: trocá-lo invalida toda sessão viva e derruba
# as partidas em curso (RNF-075).
ssh vps 'cd ~/apps/fdp && umask 077 && \
  printf "FDP_SESSION_SECRET=%s\nIMAGE_TAG=%s\n" "$(openssl rand -hex 32)" "$(git rev-parse --short HEAD)" > .env.prod'

ssh vps 'cd ~/apps/fdp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build'
```

Depois, o bloco de [`Caddyfile`](Caddyfile) vai para o **fim** de
`~/caddy/Caddyfile` (nunca substituindo o arquivo — ele serve os outros três
sites), e então:

```bash
ssh vps 'docker exec caddy caddy validate --config /etc/caddy/Caddyfile && \
         docker exec caddy caddy reload --config /etc/caddy/Caddyfile'
```

O TLS é emitido no primeiro acesso, e depende do DNS já estar apontando.

## Subir versão nova

Enquanto não houver imagem no GHCR nem workflow de deploy, é rsync e rebuild:

```bash
rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude '.env*' \
  ./ vps:~/apps/fdp/
ssh vps 'cd ~/apps/fdp && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build'
```

O container tem `stop_grace_period: 20s` e recebe `SIGTERM`: `main.ts` avisa os
clientes, persiste as salas sujas e sai. É o caminho que **CA-046** exercita — a
partida atravessa o deploy.

## Verificar

```bash
curl -s https://fdp.imp-software.cloud/api/health
```

E o teste que realmente importa — **CA-046**:

1. Abra o site em três abas anônimas, crie a sala, entre nas outras duas e inicie.
2. `ssh vps 'docker restart fdp-api'`
3. As três abas reconectam sozinhas e a partida continua na mesma rodada.

Se a janela passar de 10 s (`TRANSPORT_GRACE`), a mesa pausa nomeando quem caiu
e retoma sozinha quando todos voltam — também correto, só mais visível.

## Observabilidade

O Alloy da máquina (`coda-alloy-1`) **não precisou de nenhuma alteração**, e isso
é mérito de como ele foi escrito:

- **Containers**: o cAdvisor descobre sozinho. `fdp-api` e `fdp-redis` já
  aparecem com CPU, memória e rede, sem configurar nada.
- **Aplicação**: a sonda escreve `vps_fdp_*` em `~/metricas/fdp.prom`, lido pelo
  textfile collector do node exporter. A lista de permissão do
  `vps-metricas.alloy` já aceita `vps_.*` — foi escrita como lista de permissão
  justamente para que métrica nova flua sem edição.

O que a sonda mede e o cAdvisor não responde: se o **caminho inteiro** funciona
— DNS, TLS, Caddy e aplicação, na ordem que o jogador percorre. Um container
"Up" com o Caddy roteando errado é a falha que a métrica de container não
enxerga.

| Métrica | O que é |
|---|---|
| `vps_fdp_disponivel` | 1 se `/api/health` respondeu 2xx pelo domínio público |
| `vps_fdp_sonda_latencia_ms` | tempo da sonda, do DNS à resposta |
| `vps_fdp_ultima_sonda_segundos` | timestamp da última execução — pega "o cron parou" |
| `vps_fdp_salas` | salas vivas, de `/api/health` |
| `vps_fdp_versao{versao}` | versão no ar |

Numa queda, `vps_fdp_salas` **preserva a última contagem conhecida** em vez de
publicar 0: zero salas e "não sei" são estados diferentes, e um gráfico que
despenca a zero durante um incidente conta a história errada depois.

Falta escrever as regras de alerta no Grafana. As duas que valem: `vps_fdp_disponivel == 0`
por alguns minutos, e `time() - vps_fdp_ultima_sonda_segundos > 300` (a sonda
parou, e o silêncio não pode significar "tudo bem").

## Operação

| Tarefa | Comando |
|---|---|
| Ver logs | `ssh vps 'docker logs -f fdp-api'` |
| Reiniciar | `ssh vps 'docker restart fdp-api'` |
| Salas vivas | `ssh vps 'docker exec fdp-redis redis-cli --scan --pattern "room:*"'` |
| Versão no ar | `curl -s https://fdp.imp-software.cloud/api/health` |
| Rodar a sonda à mão | `ssh vps '~/bin/metrica-fdp.sh && cat ~/metricas/fdp.prom'` |

**Backup não é necessário.** O Redis guarda salas com TTL de 4 h; perder tudo
encerra as partidas em curso e nada mais (RNF-063). O que precisa de backup é o
repositório, que já vive no git, e `~/apps/fdp/.env.prod` — que você regenera, ao
custo de derrubar as sessões vivas.

## O que ainda falta

- **Registro em `~/bin/deploy.sh`** e workflow de deploy no GitHub Actions, como
  os outros três apps. Hoje a imagem é construída na própria VPS; o registro só
  faz sentido quando houver imagem no GHCR, senão cria um caminho quebrado.
- **Regras de alerta** no Grafana sobre as métricas acima.
