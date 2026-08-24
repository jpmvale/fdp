# 12 — Roadmap de Entrega

Status: **ESTÁVEL**

Cinco fases. Cada uma tem um **gate de saída** objetivo: enquanto ele não passa, a fase
seguinte não começa. As fases são ordenadas por **risco decrescente**, não por facilidade — o
que pode matar o projeto é atacado primeiro.

## M0 — Especificação

**Objetivo:** eliminar toda ambiguidade sobre o que se está construindo.

| Entregável | Estado |
|---|---|
| `00` a `12` — todos os 13 documentos | ✅ `ESTÁVEL` |
| `02` — 109 regras `RJ-###`, todas rastreadas | ✅ |
| `10` — 137 critérios `CA-###`, sem colisão de ID | ✅ |

**Gate de saída:** ✅ **cumprido.** Todos os documentos estão `ESTÁVEL`, sem `⚠ PENDENTE`
remanescente, e cada `RJ-###` tem ao menos um `CA-###` correspondente.

> M0 concluído. M1 e M2 podem começar imediatamente e em paralelo.

## M1 — Fundação de realtime

**Objetivo:** pôr o servidor de pé na VPS e provar que a partida sobrevive à rede real.

- Esqueleto do projeto e do CI.
- Implementação Redis do `RoomStore`, passando a mesma suíte de contrato da versão em memória.
- Endpoints HTTP de `06`.
- WebSocket com handshake, snapshot, ping/pong, reconexão e resync.
- Broadcast na sala (laço sobre os sockets do processo) e desligamento gracioso.
- Máquina de estados da sala e da conexão (`03` §1 e §2), sem partida.

**Gate de saída:**
- CA-001 a CA-009 e CA-040 a CA-059 passando, incluindo todo o ciclo de pausa.
- 8 conexões numa sala, com broadcast e reconexão sob RNF-050, rodando na VPS atrás do Caddy.
- Uma sala sobrevive a um deploy em produção sem que os clientes fiquem travados (RNF-062).
- **CA-042b**: uma partida de 20 min atravessa quedas de rede curtas e repetidas sem pausar uma
  vez sequer. É o gate que separa "WebSocket funciona" de "o jogo é jogável".
- **CA-046**: `systemctl restart` no meio de uma partida e ela continua de onde parou.

O risco de fan-out entre instâncias que dominava esta fase **deixou de existir** com um
processo único (`11` §3.1). O que resta aqui é operação: TLS, systemd, firewall e deploy.

## M2 — Lobby jogável

**Objetivo:** o fluxo social completo, ainda sem cartas.

- Design system e tokens (`07` §4).
- Telas de Home, Perfil e Lobby.
- Convite por link, cópia e compartilhamento.
- Sucessão de host, expulsão, espectadores.
- Indicadores de conexão e overlays de estado (`07` §2.6).
- Acessibilidade das telas desta fase.

**Gate de saída:**
- CA-020 a CA-026 e CA-140 a CA-144 (nas telas existentes) passando.
- 4 pessoas reais entram numa sala pelo celular, pelo link, sem instrução — em menos de 45 s
  (métrica de `00` §7).

## M3 — Partida

**Objetivo:** o jogo em si. Requer `02` estável.

- Motor de regras como função pura, com testes primeiro (`02` §4).
- Setup determinístico por seed e progressão de rodadas (RJ-030 a RJ-034).
- Fase de apostas com a regra da soma proibida (RJ-050 a RJ-056).
- Fase de vazas e os dois modos de resolução de empate (`02` §3.6.1), incluindo quem puxa
  após vaza anulada (RJ-086).
- Débito de vidas, eliminação e condição de vitória (RJ-090 a RJ-094, RJ-005).
- **Rodada de testa**: projeção invertida, EV-011 serializado por destinatário, EV-023.
- Projeção `PlayerView` e os testes anti-vazamento (CA-120, CA-281, CA-285).
- Timers de turno e auto-play para conectados (`02` §3.8.1).
- **Pausa por ausência**: `PAUSADA`, decisão do host, retirada, aborto de rodada e `PAUSE_MAX`
  (`02` §3.8.2 e §3.8.3, `03` §1.2).
- **Morte e desempate por `mortoEmVaza`** (`02` §3.1.1) — a parte mais fácil de esquecer,
  porque só tem sintoma quando a partida inteira zera junto.
- **Múltiplos baralhos** (RJ-024) e as consequências de empate que vêm com eles.
- Tela da Mesa, fim de partida, classificação, revanche e log de rodada.

**Ordem sugerida:** o motor de regras inteiro, com CA-200 a CA-319 verdes, **antes** de
qualquer pixel da Mesa. As regras são combinatórias e testá-las por navegador é lento demais
para dar a cobertura que CA-310 exige.

**Gate de saída:**
- Toda `RJ-###` de `02` §3 coberta por ao menos um `CA` (RNF-102).
- `10` §4 inteiro passando (CA-200 a CA-272), com destaque para:
  - **CA-310** — 1.000 partidas simuladas, 2 a 8 jogadores, ambos os modos de empate, sem
    violar invariante e sem exceção.
  - **CA-223** — a soma das apostas nunca fecha com o número de vazas.
  - **CA-281 / CA-285** — a carta de testa não vaza, nem na projeção nem no fio.
- CA-120 a CA-127 (segurança) passando.
- Uma partida completa jogada por 4 pessoas reais, sem divergência entre telas.

## M4 — Endurecimento e entrega

**Objetivo:** transformar "funciona" em "entregue".

- Teste de carga de RNF-060.
- Ajuste de desempenho até CA-160 a CA-164.
- Telemetria, logs estruturados e o alerta de partida travada (RNF-092).
- Auditoria de acessibilidade completa, incluindo os dois testes manuais de `08` §5.
- Auditoria de segurança contra a tabela de ameaças de `09` §3.1.
- Tela de regras dentro do produto (RF-015).
- Roteiro manual completo de `10` §8.

**Gate de saída — a definição de entregue:**
- 100% dos `CA` marcados `v1` passando.
- Roteiro de `10` §8 executado com sucesso por 4 pessoas em 4 dispositivos.
- Zero defeito aberto de severidade 1 ou 2.

## Paralelismo

```
M0 ✅ ─────────────────┐
                       ├──► M3 ──► M4
M1 ──► M2 ─────────────┘
```

M0 está fechado, então M1 e o **motor de regras de M3** podem ser atacados em paralelo: o
motor é uma função pura que não depende de rede, store nem UI (RJ-143), e portanto não espera
por M1. M3 só encontra M1/M2 na hora de ligar o motor aos eventos e à tela.

## Severidade de defeitos

| Nível | Definição | Prazo |
|---|---|---|
| S1 | Partida trava, estado corrompe, ou informação oculta vaza | Bloqueia entrega |
| S2 | Funcionalidade da v1 não funciona, ou jogador não consegue entrar | Bloqueia entrega |
| S3 | Comportamento errado com contorno viável | Corrige se couber |
| S4 | Estética ou polimento | Pós-v1 |

Vazamento de informação oculta é classificado como **S1**, no mesmo nível de corrupção de
estado: num jogo entre amigos, a confiança no jogo é o produto.

## Depois da v1

Fora de escopo agora, na ordem em que fazem sentido: baralhos customizados, bots para completar
mesa, histórico de partidas, som e polimento de animação, e — apenas se houver demanda real —
salas públicas. Nada disso entra antes do gate de M4.
