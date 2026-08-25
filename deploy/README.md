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
| Fonte na VPS | `~/apps/fdp`, clone do repositório — `deploy.sh` dá `git checkout --detach <sha>` |
| Stack | `docker-compose.prod.yml` na raiz do repositório |
| Containers | `fdp-api` e `fdp-redis`, nenhum publicando porta no host |
| Redes | `internal` (Redis) e `edge` (só a API, para o Caddy alcançar) |
| Segredo | `~/apps/fdp/.env`, modo 600 (o compose lê sozinho) |
| Roteamento | bloco `fdp.imp-software.cloud` em `~/caddy/Caddyfile` (cópia em [`Caddyfile`](Caddyfile)) |
| Sonda | `~/bin/metrica-fdp.sh` no cron de minuto (cópia em [`metrica-fdp.sh`](metrica-fdp.sh)) |

O Redis é **próprio** do FDP, e não o `coda-redis-1` que já roda na máquina:
compartilhar significaria que um `FLUSHALL` de um projeto derruba as partidas do
outro. Roda sem persistência em disco de propósito (RNF-063) — salas têm TTL de
4 h, e perder tudo encerra as partidas em curso e nada mais.

## Primeira instalação

Feita em 25/08/2026. Para refazer do zero:

```bash
ssh vps 'git clone https://github.com/jpmvale/fdp.git ~/apps/fdp'

# Segredo estável entre reinícios: trocá-lo invalida toda sessão viva e derruba
# as partidas em curso (RNF-075). Fica em `.env` e não em `.env.prod` porque é
# esse nome que o compose carrega sozinho — e `deploy.sh` chama o compose sem
# `--env-file`.
ssh vps 'cd ~/apps/fdp && umask 077 && \
  printf "FDP_SESSION_SECRET=%s\n" "$(openssl rand -hex 32)" > .env'

ssh vps 'cd ~/apps/fdp && docker compose -f docker-compose.prod.yml up -d --build'
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

**Automático.** Um push na `main` roda o CI; passando, o workflow `Deploy`
constrói a imagem, empurra para o GHCR e chama `~/bin/deploy.sh fdp <sha>` na
VPS por SSH, com a chave presa a esse script por forced command.

O `deploy.sh` é compartilhado com coda, kindred e expense-analyzer, e faz mais
do que subir: põe o repositório no MESMO commit da imagem, confere que os
containers rodam de fato a tag pedida, verifica pela URL pública e **reverte
sozinho** se a verificação falhar. Só o serviço `api` entra na esteira — o
`redis` é imagem oficial e recriá-lo derrubaria as salas vivas à toa.

Para publicar à mão, quando a esteira não é uma opção — o `deploy.sh` só é
alcançável pela chave do Actions, que o carrega por forced command:

```bash
ssh vps 'cd ~/apps/fdp && git fetch -q origin && git checkout -q --detach <sha> && \
  docker compose -f docker-compose.prod.yml up -d --build'
```

Isso constrói na própria VPS em vez de baixar do GHCR: serve para emergência,
não para o dia a dia.

### Segredos do repositório

O workflow precisa de três, em **Settings → Secrets and variables → Actions**:

| Segredo | O que é |
|---|---|
| `VPS_HOST` | `187.77.242.128` |
| `VPS_DEPLOY_KEY` | A chave PRIVADA cujo par está em `~/.ssh/authorized_keys` da VPS, presa a `command="/home/deploy/bin/deploy.sh"`. É a mesma dos outros três apps |
| `VPS_HOST_KEY` | A linha de `known_hosts` da VPS, para o SSH não aceitar qualquer host no meio do caminho |

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

### Alertas

**Aplicadas em 25/08/2026**, na pasta `FDP` do stack pessoal, grupo `fdp`,
avaliação de 1 min. A fonte de dados é `grafanacloud-prom`.

O arquivo [`alertas-grafana.yml`](alertas-grafana.yml) fica como a versão legível
e versionada das regras — para recriar do zero, ou para revisar em diff o que
está no ar. Aplicar de novo, pela API:

```bash
ssh vps 'set -a; . ~/.config/grafana-api.env; set +a
  curl -X PUT -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -H "Content-Type: application/json" -H "X-Disable-Provenance: true" \
    --data @grupo.json "$GRAFANA_URL/api/v1/provisioning/folder/fdp/rule-groups/fdp"'
```

O `X-Disable-Provenance` é o que mantém as regras editáveis pela interface: sem
ele o Grafana marca como provisionadas e trava a edição, o que seria uma
armadilha para quem for ajustar um limiar às pressas durante um incidente.

O token de serviço vive em `~/.config/grafana-api.env` na VPS, com permissão 600
— o mesmo lugar e o mesmo cuidado das credenciais OTLP.

São duas, e só duas:

| Regra | Dispara quando | Severidade |
|---|---|---|
| FDP fora do ar | `vps_fdp_disponivel == 0` por 3 min | crítica |
| A sonda parou | `time() - vps_fdp_ultima_sonda_segundos > 300` | aviso |

A segunda é a que o silêncio não engana. Sem ela, cron desligado ou máquina fora
do ar deixam `vps_fdp_disponivel` congelado no último valor conhecido — que
provavelmente é 1. Nada falha, ninguém é avisado, e o painel segue verde
mostrando um número velho.

Ambas usam `noDataState: Alerting`: sem dado é "não sei", e para disponibilidade
não saber é motivo de alerta.

CPU, memória e disco **não** viram alerta de propósito. Numa VPS com quatro apps
eles sobem por motivo legítimo o tempo todo, e alerta que dispara sem alguém
agir treina a pessoa a ignorar a próxima notificação — inclusive a que importava.

**As séries chegam — verificado em 25/08/2026**, consultando o stack pela API:
`vps_fdp_disponivel`, `vps_fdp_ultima_sonda_segundos` e `vps_fdp_salas` retornam
uma série cada. A verificação não é formalidade: o comentário do
`vps-metricas.alloy` registra que em 04/08/2026 uma consulta voltou com ZERO
séries enquanto o Alloy reportava centenas de pontos enviados sem falha —
"enviado com sucesso" não diz para onde.

Ambas as regras foram vistas avaliando com `health: ok` e estado `inactive`, que
é o estado certo com o serviço no ar.

## Operação

| Tarefa | Comando |
|---|---|
| Ver logs | `ssh vps 'docker logs -f fdp-api'` |
| Reiniciar | `ssh vps 'docker restart fdp-api'` |
| Salas vivas | `ssh vps 'docker exec fdp-redis redis-cli --scan --pattern "room:*"'` |
| Versão no ar | `curl -s https://fdp.imp-software.cloud/api/health` |
| Rodar a sonda à mão | `ssh vps '~/bin/metrica-fdp.sh && cat ~/metricas/fdp.prom'` |
| Ver o log de deploy | `ssh vps 'tail -30 ~/backups/deploy.log'` |

**Backup não é necessário.** O Redis guarda salas com TTL de 4 h; perder tudo
encerra as partidas em curso e nada mais (RNF-063). O que precisa de backup é o
repositório, que já vive no git, e `~/apps/fdp/.env.prod` — que você regenera, ao
custo de derrubar as sessões vivas.

### Para onde vai o aviso

Receptor padrão do stack: **`email-infra`** → `jpmvale@gmail.com`. Agrupamento
por pasta e nome do alerta, espera de 30 s, repetição a cada 4 h.

**O que estava errado até 25/08/2026:** o receptor padrão era `empty` — um
receptor que existe e não tem integração nenhuma. As dez regras do stack
avaliavam certo e entregavam em lugar nenhum, inclusive as oito de
infraestrutura (backup, disco, memória, load, container em loop, site fora do
ar). O ponto `email-infra` já existia; só nada apontava para ele.

Vale como lembrete geral: **regra saudável não é a mesma coisa que aviso
entregue**, e o painel do Grafana mostra a primeira, não a segunda.

## O que ainda falta

- **Provar a entrega.** A configuração está conferida — a política aponta para
  um ponto que existe, com o endereço certo, integração `email` válida —, mas
  nenhum e-mail chegou ainda porque nada disparou. O caminho mais curto é o
  botão **Test** em Alerting → Contact points → `email-infra`. O mais completo é
  parar a sonda por seis minutos e deixar `fdp-sonda-parada` disparar de
  verdade, o que exercita regra, política e ponto de contato de ponta a ponta.
