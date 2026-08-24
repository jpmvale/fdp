# 04 — Modelo de Dados

Status: **ESTÁVEL**

Os tipos abaixo são a especificação canônica. A implementação em TypeScript **DEVE**
corresponder a eles, e **DEVERIA** ser validada em runtime na fronteira (entrada de comandos)
com um schema validator.

## 1. Sala

```ts
type RoomStatus =
  | 'LOBBY' | 'INICIANDO' | 'EM_PARTIDA' | 'PAUSADA' | 'FIM_DE_PARTIDA' | 'ENCERRADA';

interface Room {
  code: string;              // 5 chars, alfabeto sem ambiguidade — ver 06 §2
  status: RoomStatus;
  hostId: PlayerId;
  players: Player[];         // inclui espectadores; ordem = ordem de entrada
  options: MatchOptions;
  match: Match | null;       // presente sse status ∈ {EM_PARTIDA, PAUSADA, FIM_DE_PARTIDA}
  pause: PauseState | null;  // presente sse status === 'PAUSADA' (INV-14)
  stateVersion: number;      // monotônico, incrementa a cada mudança
  createdAt: number;         // epoch ms
  lastActivityAt: number;    // base do TTL de inatividade
}
```

## 2. Jogador

```ts
type PlayerId = string;      // uuid v4, gerado pelo servidor, estável dentro da sala
type ConnectionStatus = 'CONECTADO' | 'DESCONECTADO' | 'REMOVIDO' | 'SAIU';

interface Player {
  id: PlayerId;
  nickname: string;          // 2–16 chars, ver §6
  avatar: Avatar;
  connection: ConnectionStatus;
  isSpectator: boolean;      // true se entrou com partida em andamento
  joinedAt: number;
  lastSeenAt: number;
}

interface Avatar {
  emoji: string;             // de uma lista fechada de 24 opções
  color: string;             // de uma paleta fechada de 8 cores acessíveis
}
```

O par `(emoji, color)` **DEVE** ser único dentro da sala. Se houver colisão na entrada, o
servidor atribui a próxima combinação livre.

O **`sessionToken`** que autentica o jogador **NÃO DEVE** fazer parte de `Player`, nem trafegar
em nenhum evento. Ele vive apenas no par cliente ↔ servidor. Ver `06` §4.

## 3. Carta

Baralho francês de 52 cartas. Naipe é puramente ilustrativo (RJ-012).

```ts
type Rank = '2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K'|'A';
type Suit = 'copas' | 'ouros' | 'espadas' | 'paus';
type CardId = string;        // opaco, único dentro da rodada

interface Card {
  id: CardId;
  rank: Rank;
  suit: Suit;
  value: number;             // 2..14; A = 14. Único campo usado na comparação (RJ-021)
  deckIndex: number;         // 0..baralhos-1; de qual baralho do sabot veio
}
```

- `value` é derivado de `rank` e existe para que a comparação de vazas nunca dependa de
  ordenação de string.
- `id` **DEVE** ser opaco e **NÃO DEVE** revelar posição no baralho embaralhado. Um `id`
  sequencial de embaralhamento vaza a ordem de compra a quem inspeciona a rede.
- `id` é único mesmo entre cartas de mesmo `rank` e `suit` — condição para verificar INV-04, e
  **obrigatório** a partir de 2 baralhos, quando cartas idênticas coexistem (RJ-026).
- `deckIndex` **NÃO DEVE** influenciar comparação alguma. Existe só para depuração e para
  tornar INV-03 verificável; duas cartas de mesmo `value` empatam independentemente dele.
- O sabot é regerado e reembaralhado a cada rodada (RJ-027); `CardId` é estável apenas
  dentro da rodada.
- **Não** existe arquivo `data/deck.json`: o sabot é gerado por código — `baralhos` cópias de
  13 ranks × 4 naipes (RJ-024). Um dado versionado só faria sentido para baralhos
  customizados, fora do escopo da v1 (`00` §4.3).

## 4. Partida

```ts
interface Match {
  id: string;
  seed: string;                    // semente do RNG; nunca enviada ao cliente durante a partida
  startedAt: number;
  options: MatchOptions;           // congeladas no início (02 §3.10)
  playerOrder: PlayerId[];         // ordem da mesa, sorteada e FIXA até o fim (RJ-030)
  lives: Record<PlayerId, number>; // vidas correntes (RJ-001)
  eliminated: EliminationRecord[]; // zerou as vidas jogando (RJ-003)
  withdrawn: WithdrawalRecord[];   // retirado por ausência (RJ-154) — NÃO é eliminação
  roundNumber: number;             // começa em 1
  cardsThisRound: number;          // RJ-036
  deckCount: number;               // RJ-024
  firstBidderId: PlayerId;         // rotaciona a cada rodada (RJ-038)
  round: RoundState;               // ver §4.2
  history: RoundSummary[];         // alimenta o log de rodada (RF-016)
  winnerIds: PlayerId[] | null;    // array por causa do empate de RJ-010
  endReason:
    | 'VITORIA'                    // sobrou 1 jogador (RJ-004) ou desempate por morte (RJ-005)
    | 'VITORIA_POR_ABANDONO'       // sobrou 1 após retirada (RJ-156)
    | 'JOGADORES_INSUFICIENTES'
    | 'ENCERRADA_PELO_HOST'
    | 'ENCERRADA_POR_AUSENCIA'     // RJ-153 ou RJ-157
    | null;
}

interface EliminationRecord {
  playerId: PlayerId;
  roundNumber: number;
  mortoEmVaza: number;             // RJ-008; base do desempate de RJ-010 e do ranking RJ-012
}

interface WithdrawalRecord {
  playerId: PlayerId;
  roundNumber: number;
  livesAtWithdrawal: number;       // registro histórico; descartadas do jogo (RJ-154)
}

interface RoundSummary {
  roundNumber: number;
  cardsThisRound: number;
  deckCount: number;
  aborted: boolean;                // true se abortada por retirada (RJ-155)
  bets: Record<PlayerId, number>;
  tricksWon: Record<PlayerId, number>;
  livesLost: Record<PlayerId, number>;   // |bet − tricksWon| (RJ-090); zerado se aborted
  mortoEmVaza: Record<PlayerId, number | null>;
  eliminatedThisRound: PlayerId[];
  annulledTricks: number;                // vazas sem vencedor (RJ-080)
}
```

`eliminated`, `withdrawn` e `lives` permanecem no `Match` até o fim: INV-06 exige que todo
jogador tenha entrada no placar. `eliminated` e `withdrawn` são **disjuntos** (INV-17) e
alimentam a classificação final: eliminados ordenados por rodada e `mortoEmVaza` decrescente
(RJ-012), retirados abaixo de todos (RJ-129).

### 4.1 Estado oculto

```ts
interface HiddenState {
  stock: CardId[];                 // resto do sabot não distribuído na rodada (RJ-042)
  hands: Record<PlayerId, CardId[]>;
  cards: Record<CardId, Card>;     // catálogo da rodada — 52 × deckCount cartas
}
```

Na rodada de 1 carta, `hands[p]` tem exatamente uma carta: a **carta na testa**. Ela é oculta
para `p` e pública para todos os demais — a única inversão de visibilidade do jogo, tratada na
projeção de §5.

`HiddenState` **NÃO DEVE** ser serializado para o cliente em nenhuma hipótese. Ele vive apenas
no servidor e é a fonte da projeção descrita em §5. Manter esse estado num objeto separado do
estado público não é estilo — é a defesa estrutural contra vazamento acidental por
`JSON.stringify` de um objeto grande.

### 4.2 Estado da rodada

```ts
type RoundPhase = 'DISTRIBUICAO' | 'APOSTAS' | 'VAZAS' | 'REVELACAO' | 'RESOLUCAO';

interface RoundState {
  phase: RoundPhase;
  phaseDeadline: number | null;      // epoch ms; null nas fases automáticas
  activePlayerId: PlayerId | null;   // não-nulo em APOSTAS e VAZAS (INV-08)
  isForeheadRound: boolean;          // cardsThisRound === 1 (RJ-070)

  bets: Record<PlayerId, number>;    // preenchido incrementalmente; público (RJ-052)
  bidOrder: PlayerId[];              // ativos, a partir de firstBidderId (RJ-050)
  forbiddenBet: number | null;       // valor proibido do último apostador (RJ-054)

  tricksWon: Record<PlayerId, number>;
  mortoEmVaza: Record<PlayerId, number | null>;  // RJ-008; público (RJ-013)
  trickNumber: number;               // 1..cardsThisRound
  currentTrick: Trick;
  resolvedTricks: Trick[];
}

interface Trick {
  leaderId: PlayerId;
  playOrder: PlayerId[];                             // ativos, a partir de leaderId
  plays: { playerId: PlayerId; cardId: CardId }[];   // público assim que jogado (RJ-066)
  winnerId: PlayerId | null;                         // null = vaza anulada (RJ-080)
  annulledValue: number | null;                      // valor empatado mais alto, se anulada
  nextLeaderId: PlayerId | null;                     // RJ-085 / RJ-086
}

interface PauseState {
  since: number;                     // epoch ms do início da pausa contínua
  absentPlayerIds: PlayerId[];       // jogadores da partida em DESCONECTADO
  decisionUnlockedAt: number;        // since + RECONNECT_GRACE (RJ-150)
  hardDeadline: number;              // since + PAUSE_MAX (RJ-157)
  suspendedPhaseRemainingMs: number | null;  // sobra do timer de fase, descartada ao retomar
}
```

`PauseState.since` marca **pausa contínua**: uma reconexão que retome a partida limpa o objeto
inteiro; uma reconexão que não esvazie `absentPlayerIds` mantém `since` intacto. É essa
distinção que impede duas pessoas alternando quedas de segurar a sala indefinidamente
(`03` §2.1).

`suspendedPhaseRemainingMs` é registrado apenas para diagnóstico. Ao retomar, o timer
**reinicia do zero** (RJ-119) — ninguém volta de uma queda já com o prazo estourado.

Notas de projeto:

- **Não existe `sealedMoves`.** Todas as fases são sequenciais e toda jogada é pública ao ser
  feita; não há jogada secreta revelada depois. Isso elimina uma classe inteira de
  complexidade de concorrência e de vazamento.
- `forbiddenBet` é calculado pelo servidor e **DEVE** ser enviado ao último apostador para que
  a UI desabilite o valor em vez de deixá-lo tentar e falhar (`07` §2.4).
- `bets` é público, então vive no estado público — não em `HiddenState`.
- `currentTrick.plays` cresce durante a vaza e é público; só o conteúdo das **mãos** é oculto.

## 5. Projeção — `PlayerView`

O servidor nunca envia `Room` ou `Match` crus. Envia a projeção para um jogador específico:

```ts
function project(room: Room, hidden: HiddenState, viewerId: PlayerId): PlayerView
```

Matriz de visibilidade, implementando `02` §3.7:

| Campo | Dono | Outros jogadores | Espectador |
|---|---|---|---|
| `players`, `lives`, `roundNumber`, `phase`, `bets`, `tricksWon` | visível | visível | visível |
| Própria mão, rodada de **N>1** cartas | **visível** | contagem apenas | contagem apenas |
| Própria carta, rodada de **1 carta** (testa) | **OCULTA** | **visível** | **visível** |
| `currentTrick.plays` e `resolvedTricks` | visível | visível | visível |
| `stock` (monte não distribuído) | contagem | contagem | contagem |
| `mortoEmVaza`, `deckCount` | visível | visível | visível |
| `seed` | **oculto** | **oculto** | **oculto** |
| `history`, `options` | visível | visível | visível |

A rodada de 1 carta é o caso perigoso: a projeção **inverte** — o servidor envia a carta de
todos os outros e precisa suprimir a do próprio observador. Duas invariantes cobrem isso:

- **INV-07** — nenhum `PlayerView` contém mão alheia (rodadas de N>1).
- **INV-13** — nenhum `PlayerView` contém a própria carta na rodada de testa (RJ-100).

Ambas **DEVEM** ter teste automatizado que percorre a projeção **serializada** em toda
profundidade e falha se o `CardId` proibido aparecer em qualquer chave ou valor. Percorrer o
objeto serializado, e não os campos conhecidos, é o que faz o teste continuar válido quando
alguém adicionar um campo novo depois. São CA-120 (mão alheia) e CA-281 (carta de testa própria).

## 6. Validações de entrada

| Campo | Regra |
|---|---|
| `nickname` | 2–16 caracteres após `trim`; sem quebra de linha; sem caracteres de controle; unicode permitido; único na sala (colisão recebe sufixo numérico) |
| `roomCode` | exatamente 5 caracteres do alfabeto de `06` §2; comparação case-insensitive, normalizado para maiúsculas |
| `avatar.emoji` | pertencer à lista fechada |
| `avatar.color` | pertencer à paleta fechada |
| Qualquer `CardId` vindo do cliente | **DEVE** pertencer à mão do próprio jogador; caso contrário `ERR-403` |
| `bet` | inteiro em `[0, cardsThisRound]`; fora disso `ERR-008`. Igual a `forbiddenBet` sendo o último apostador → `ERR-007` motivo `SOMA_PROIBIDA` |
| `vidasIniciais` | inteiro em `[1, 10]` |
| `maxCartasPorRodada` | inteiro em `[1, 10]` |
| `regraEmpate` | um dos dois valores do enum de `02` §3.10 |
| `resolveAbsence.action` | `CONTINUAR_SEM` ou `ENCERRAR`; só host, só em `PAUSADA`, só após `decisionUnlockedAt` |

Toda entrada de texto **DEVE** ser tratada como hostil: validada por schema, normalizada, e
renderizada como texto puro (nunca `innerHTML`).

## 7. Persistência

- O estado da sala é **efêmero** e vive num store chave-valor com TTL. Chave: `room:{code}`.
- Estado vivo na memória do processo, persistido em Redis local por write-behind — ver
  [11-arquitetura-e-stack.md](./11-arquitetura-e-stack.md) §4.
- TTL: renovado a cada mudança de estado; expira conforme `ROOM_MAX_LIFE` e `LOBBY_IDLE` (`03` §2.1).
- Nenhum dado pessoal é persistido além de apelido e avatar, ambos descartados com a sala.
- Mutações no estado da sala são atômicas pelo laço de eventos do Node, desde que não haja
  `await` no meio do bloco de mutação. Ver `11` §5 — a regra é vinculante.
