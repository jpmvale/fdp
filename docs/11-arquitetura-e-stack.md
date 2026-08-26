# 11 — Arquitetura e Stack

Status: **ESTÁVEL**

## 1. Visão geral

Tudo roda numa **VPS**, atrás do Caddy.

```
                    Internet
                       │  HTTPS / WSS
                       ▼
        ┌──────────────────────────────┐
        │  Caddy                       │  TLS automático (Let's Encrypt)
        │  /            → estáticos    │  Serve a SPA do disco
        │  /api/*, /ws  → :3000        │  Proxy, com upgrade de WebSocket
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Processo Node (systemd)     │  UM processo, persistente
        │  ┌────────────────────────┐  │
        │  │ Servidor Hono + ws     │  │  HTTP de `06` + WebSocket de `05`
        │  ├────────────────────────┤  │
        │  │ Camada de sala         │  │  Timers, pausa, auto-play
        │  ├────────────────────────┤  │
        │  │ Motor de regras        │  │  Função pura, sem I/O
        │  ├────────────────────────┤  │
        │  │ Projeção               │  │  Estado → PlayerView por jogador
        │  └────────────────────────┘  │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Redis em 127.0.0.1:6379     │  Persistência entre reinícios
        └──────────────────────────────┘
```

**Um processo só** é a decisão que carrega o resto da arquitetura. Ela elimina os dois maiores
riscos técnicos que o projeto tinha, e simplifica a concorrência a ponto de tornar
desnecessária metade da máquina que estava planejada. Ver §3.

O motor de regras continua sendo o núcleo e **não conhece** nada acima dele (RJ-143).

## 2. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Cliente | **Vite + React + TypeScript**, SPA | Sem SEO, SSR nem conteúdo: é uma tela realtime atrás de um código de sala |
| Servidor | **Hono** sobre `@hono/node-server` | Leve, tipado, WebSocket via `ws` sem cerimônia |
| Realtime | **WebSocket** (`ws`) | Conexões vivem enquanto o processo viver |
| Processo | **Node 24 LTS** sob **systemd** | Reinício automático, logs no journal, sem gerenciador extra |
| Borda | **Caddy** | TLS automático, proxy de WebSocket em duas linhas |
| Persistência | **Redis** em `127.0.0.1`, auto-hospedado | TTL nativo; salas sobrevivem a deploy e crash. Custo zero |
| Persistência durável | **Postgres 17** em `127.0.0.1`, auto-hospedado | Contas, perfis e histórico (P11). Transação e chave estrangeira, que o Redis não tem — e dado que **não** pode expirar |
| Validação | **zod**, só no servidor | RNF-072, sem custo no bundle do cliente |
| Estilo | CSS Modules + tokens | Zero runtime |
| Testes | Vitest + Playwright | `U`/`I` e `E` de `10` |

### 2.1 Orçamento de bundle

RNF-055 fixa 180 KB comprimidos, verificado no CI com falha. A base do cliente fica em torno de
50 KB, deixando cerca de 130 KB para a mesa, as cartas e as animações.

## 3. O que a VPS resolve

A arquitetura anterior era serverless, e pagava dois pedágios pesados. Ambos somem aqui.

### 3.1 Fan-out entre instâncias — resolvido por construção

Em serverless, cada conexão WebSocket fica presa a uma instância de função, e conexões novas
não têm garantia de cair na mesma. Sem um backplane de pub/sub, o jogador A não vê a jogada do
jogador B. Isso obrigava a um Redis com `SUBSCRIBE`, e era o **gate de saída de M1**.

Com um processo só, **todas as conexões da sala estão na mesma memória**. O broadcast é um laço
sobre um `Set` de sockets. Não há backplane, não há pub/sub, não há o risco.

### 3.2 Reciclagem de socket — resolvida por construção

Em Vercel Functions, uma conexão WebSocket morre quando a função atinge a duração máxima —
300 s no Hobby. Uma partida de 10 a 20 minutos atravessaria esse teto várias vezes, e **todo
jogador seria desconectado periodicamente sem ter saído do lugar**. Com a política de pausa de
`02` §3.8.2, a mesa pausaria dezenas de vezes por partida.

Num processo persistente não há teto: a conexão dura o que a rede permitir.

**`TRANSPORT_GRACE` (RJ-117a) continua valendo**, e continua sendo importante — mas por outro
motivo. O que ela cobre agora é o que sempre foi o caso real: 4G instável, túnel, elevador,
troca de Wi-Fi para dados móveis. A carência de 10 s distingue *o socket caiu* de *a pessoa
sumiu*, e essa distinção é do jogo, não da plataforma.

O que **não** é mais necessário: a reconexão preventiva de RNF-065, que existia só para
antecipar o corte da plataforma.

### 3.3 Concorrência — resolvida por construção

O laço de eventos do Node é single-threaded. Uma mutação de sala que não faça `await` no meio é
**atômica por construção**: nenhum outro comando roda entre a leitura e a escrita.

Some, portanto: o compare-and-set em `stateVersion`, o script Lua, o laço de retry e a
serialização por sala. Ver §5, que ficou de três linhas.

### 3.4 O que a VPS traz de risco novo

Honestidade de contrapartida — a troca não é grátis:

| Risco | Mitigação |
|---|---|
| Ponto único de falha: o processo cai, todas as partidas caem | `Restart=always` no systemd + estado no Redis (§4). Salas sobrevivem ao reinício |
| Deploy derruba todas as conexões | Reconexão + resync já cobrem (`05` §3); janela de ~2 s cabe em `TRANSPORT_GRACE` |
| Escala só vertical | 2.000 sockets em Node consomem dezenas de MB. RNF-060 cabe folgado numa VPS modesta |
| Operação é nossa: TLS, atualização, backup, firewall | Caddy renova TLS sozinho; Redis só escuta em `127.0.0.1`; §7 documenta o resto |
| Latência para quem está longe da VPS | Escolher região próxima do grupo. Sem CDN global para os estáticos na v1 |

## 4. Persistência

São **dois** bancos com dois papéis, e nenhum invade o do outro. Confundi-los é o erro
tentador: dá para guardar conta no Redis e sala no Postgres, e os dois ficam ruins. A sala é
efêmera, quer TTL e morre com a mesa; a conta é permanente, quer transação e não pode expirar.

### 4.1 Redis — a sala viva

Redis auto-hospedado, escutando **apenas** em `127.0.0.1:6379` — nunca exposto à internet.

| Uso | Como |
|---|---|
| Estado da sala | `SET room:{code} <json> EX 14400`, renovado a cada escrita |
| Sobreviver a reinício | Ao subir, o processo recarrega as salas vivas do Redis |
| Descarte automático | TTL do Redis implementa `ROOM_MAX_LIFE` sem código de limpeza |

O acesso continua atrás da interface `RoomStore` que já existe, com a implementação em memória
usada em teste e desenvolvimento local. **A suíte de contrato do `RoomStore` é a mesma para as
duas implementações** — o que a versão em memória passa, a de Redis precisa passar.

Nota de projeto: como o estado vivo mora na memória do processo, o Redis aqui é **write-behind**,
não fonte da verdade em tempo de jogo. Isso mantém a leitura de estado em nanossegundos e usa o
Redis só como durabilidade. O `RoomStore` esconde essa diferença.

### 4.2 Postgres — o que sobrevive à sala

Postgres 17 em container, escutando **apenas** em `127.0.0.1:5432`. Guarda contas, credenciais,
identidades de SSO e histórico de partidas (plano 01, decisão D-1).

Aqui é o contrário do Redis em tudo o que importa: nada expira, a escrita é transacional, e a
integridade é do banco — `UNIQUE`, chave estrangeira, índice funcional. Onde o Redis usa TTL
para descartar, o Postgres usa `ON DELETE` para preservar o que precisa sobreviver ao dono.

O acesso fica atrás da interface `Dados` de `@fdp/contas`, com implementação em memória para
teste e desenvolvimento. **A suíte de contrato é a mesma para as duas** — o que a memória
passa, o Postgres passa. Foi ela que pegou, na primeira execução, uma dependência de `citext`
que só falharia em Postgres gerenciado.

| Uso | Como |
|---|---|
| Migração | SQL versionado em `packages/contas/src/migracoes/`, aplicado na subida sob `pg_advisory_xact_lock` |
| Backup | `deploy/backup-postgres.sh`, `pg_dump --format=custom`, com descarte por idade |
| Restauração | `deploy/restaurar-postgres.sh`, que **recusa** destino que já tenha a tabela `contas` |

Backup que nunca foi restaurado não é backup, é esperança — por isso a restauração está no gate
de saída da F1, e não numa lista de intenções.

## 5. Concorrência

```
1. autenticar (sessionToken → playerId, roomCode)
2. rate limit
3. validar payload por schema
4. aplicarJogada(estado, jogada)      ← função pura, síncrona
5. persistir no Redis (write-behind, sem bloquear a resposta)
6. broadcast projetado por destinatário
```

Os passos 1–4 e 6 são **síncronos**. Nenhum `await` entre ler e escrever o estado da sala
significa que o laço de eventos garante atomicidade sem lock, sem CAS e sem retry.

**Regra vinculante:** a mutação de estado de uma sala **NÃO DEVE** conter `await`. Se um dia
precisar, o `await` vai **antes** ou **depois** do bloco de mutação, nunca no meio. É a
diferença entre atomicidade de graça e uma corrida silenciosa que só aparece sob carga.

## 6. Estrutura do repositório

```
fdp/
├── docs/                    # este spec — fonte da verdade
├── app/                     # cliente Vite + React
│   ├── src/
│   │   ├── screens/         # home, perfil, lobby, mesa, fim
│   │   ├── components/      # design system e componentes de jogo
│   │   ├── net/             # cliente WebSocket, resync, reconexão
│   │   └── state/           # store local — só reflete PlayerView
│   └── index.html
├── server/
│   └── src/
│       ├── main.ts          # bootstrap: Hono + ws + graceful shutdown
│       ├── http.ts          # endpoints de `06`
│       └── ws.ts            # handshake, envelope, roteamento de comandos
├── packages/
│   ├── rules/               # ⭐ motor de regras — puro, sem dependências
│   ├── bot/                 # decisão dos bots — puro, só depende de rules
│   ├── protocol/            # tipos e schemas de `04` e `05` (fonte única)
│   ├── store/               # RoomStore: interface + memória + Redis
│   └── room/                # máquina de sala, timers, pausa, auto-play
├── deploy/
│   ├── Caddyfile            # bloco do site, para o Caddy compartilhado da VPS
│   ├── metrica-fdp.sh       # sonda do caminho público, para o textfile collector
│   └── README.md            # instalação passo a passo na VPS
├── locales/pt-BR.json
└── test/e2e/
```

`packages/rules` **NÃO DEVE** importar nada de `app/`, `server/`, `store/` ou `room/` (RJ-143).
Verificado no CI e coberto por CA-304.

`packages/room` é testável inteiro com o `RoomStore` em memória, sem Redis e sem rede.

## 7. Deploy e operação

| Ambiente | Como |
|---|---|
| Local | `npm run dev` — Vite + servidor Node, `RoomStore` em memória, sem Redis |
| Produção | Build local ou no CI → `rsync` para a VPS → `systemctl restart fdp` |

Requisitos de operação:

- **Redis** com `bind 127.0.0.1` e `protected-mode yes`. Sem porta aberta, sem senha na rede.
- **Caddy** com TLS automático; upgrade de WebSocket é transparente no `reverse_proxy`.
- **systemd** com `Restart=always` e `RestartSec=2`.
- **Desligamento gracioso:** ao receber `SIGTERM`, o processo fecha os sockets com um código de
  "reconecte" e persiste as salas antes de sair. Sem isso, um deploy vira queda seca.
- **Firewall:** só 80, 443 e a porta de SSH. A porta 3000 do Node **NÃO DEVE** ser exposta.
- **Logs** no journal, com `roomCode` e `stateVersion` em toda linha (RNF-090).

Segredos em `/etc/fdp/env`, lido pela unit do systemd. **Nunca versionados.**

O CI bloqueia merge se: tipos falharem, testes falharem, cobertura cair abaixo de RNF-101,
bundle exceder RNF-055, `axe-core` acusar violação séria, ou auditoria de dependências acusar
vulnerabilidade alta.

## 8. Estratégia de testes

| Nível | Escopo | Velocidade | Onde |
|---|---|---|---|
| Unitário | Motor de regras, projeção, sala | ms | Todo commit |
| Propriedade | 1.000 partidas simuladas (CA-310, CA-311) | s | Todo commit |
| Integração | Comando → estado → evento, com store em memória | s | Todo commit |
| E2E | 2 a 4 navegadores reais, partida completa | min | Todo PR |
| Carga | 500 salas, 2.000 sockets contra a VPS | min | Antes da entrega |
| Manual | Roteiro de `10` §8 | — | Antes da entrega |

A pirâmide é pesada na base de propósito: regras de jogo são combinatórias, e testá-las por
navegador é lento demais para dar a cobertura que CA-310 exige.
