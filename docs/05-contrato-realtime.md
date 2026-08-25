# 05 — Contrato de Realtime

Status: **ESTÁVEL**

Canal: **WebSocket**, um por jogador, vinculado a uma sala.
Endpoint: `wss://<host>/api/rooms/{code}/ws?token=<sessionToken>`

Princípio inegociável: **comandos vão, eventos voltam**. O cliente nunca altera seu próprio
estado por conta própria — ele envia um comando e espera o evento correspondente. Não há
predição otimista de resultado de jogada na v1; ela reintroduz a possibilidade de divergência
entre telas, que é justamente o que este design elimina.

## 1. Envelope

Todas as mensagens, nos dois sentidos:

```ts
interface Envelope<T = unknown> {
  v: 1;                    // versão do protocolo
  id: string;              // uuid do cliente; ecoado em ack/erro. Base da idempotência
  type: string;            // ver §4 e §6
  ts: number;              // epoch ms de emissão
  payload: T;
}
```

Mensagens servidor → cliente carregam adicionalmente:

```ts
interface ServerEnvelope<T> extends Envelope<T> {
  stateVersion: number;    // versão do estado da sala APÓS este evento
}
```

### 1.1 Versionamento

`v` é incrementado em mudança incompatível. O servidor **DEVE** rejeitar `v` desconhecido com
`ERR-426` e o cliente **DEVE** exibir "atualize a página". Campos novos e opcionais dentro de
um `payload` **NÃO** são mudança incompatível; clientes **DEVEM** ignorar campos desconhecidos.

## 2. Ciclo de vida da conexão

```
cliente                                   servidor
   |-- WS connect (?token) --------------->|
   |                                       |  valida token → resolve playerId
   |<-- room:snapshot ---------------------|  PlayerView completo
   |                                       |
   |-- room:command ---------------------->|
   |<-- ack | error ----------------------|
   |<-- room:event (broadcast) ------------|  a todos na sala
   |                                       |
   |-- ping (a cada 20s) ----------------->|
   |<-- pong ------------------------------|
```

- O servidor **DEVE** enviar `room:snapshot` como primeira mensagem após o handshake, sempre.
- Uma conexão sem `ping` por 45 s **DEVE** ser encerrada pelo servidor.
- Um `token` já conectado em outro socket **DEVE** derrubar o socket anterior com `ERR-409`
  (uma sessão, uma aba ativa). Isso evita duas abas divergindo.

## 3. Reconciliação e resync

Cada evento carrega `stateVersion`. O cliente guarda o último aplicado.

| Situação | Ação do cliente |
|---|---|
| `evento.stateVersion == local + 1` | aplicar normalmente |
| `evento.stateVersion == local` | aplicar: é continuação do mesmo lote (ver abaixo) |
| `evento.stateVersion < local` | descartar (estado já superado) |
| `evento.stateVersion > local + 1` | **buraco detectado** → enviar `room:resync` |

Uma mutação de sala incrementa `stateVersion` **uma vez** e pode emitir vários
eventos, todos carregando a mesma versão: `host:startMatch` sozinho produz
`room:statusChanged`, `match:started`, `round:started` e `round:phaseChanged`
numa tacada. Por isso `== local` é continuação de lote, e não duplicata —
descartá-lo deixaria a mesa sem cartas. O que se perde é a deduplicação de um
evento repetido byte a byte, que o WebSocket sobre TCP não produz e que o
servidor não emite; o que se preserva é o que a regra existe para garantir:
buraco de versão vira resync, nunca estado divergente em silêncio.

`room:resync` faz o servidor responder com um `room:snapshot` completo. O cliente descarta
integralmente seu estado local e adota o snapshot.

Este mecanismo é o que torna a reconexão trivial (RF-010): reconectar **é** um resync. Não
existe caminho de código separado para "recuperar partida".

## 4. Comandos — cliente → servidor

### 4.1 Sala e lobby

| `type` | Payload | Quem pode | Efeito |
|---|---|---|---|
| `room:resync` | `{}` | qualquer | Devolve `room:snapshot` |
| `player:setProfile` | `{ nickname, avatar }` | qualquer, só em `LOBBY` | Atualiza perfil |
| `player:leave` | `{}` | qualquer | Sai da sala |
| `host:kick` | `{ playerId }` | host, só em `LOBBY` | Remove jogador |
| `host:setOptions` | `{ options }` | host, só em `LOBBY` | Ajusta opções da partida |
| `host:startMatch` | `{}` | host, só em `LOBBY` | Inicia partida |
| `host:endMatch` | `{}` | host, só em `EM_PARTIDA` | Encerra sem vencedor |
| `host:rematch` | `{}` | host, só em `FIM_DE_PARTIDA` | Nova partida, mesmo grupo |
| `host:resolveAbsence` | `{ action: 'CONTINUAR_SEM' \| 'ENCERRAR' }` | host, só em `PAUSADA` **e** após `decisionUnlockedAt` | Resolve a ausência (RJ-153/RJ-154) |

### 4.2 Jogadas

Existem exatamente **duas** jogadas no FDP.

```ts
interface MoveBase {
  matchId: string;       // rejeita jogada de partida anterior
  roundNumber: number;   // rejeita jogada de rodada anterior
  trickNumber: number;   // rejeita jogada de vaza anterior; 0 na fase de apostas
}

// fase APOSTAS
interface BetCommand extends MoveBase {
  type: 'move:bet';
  bet: number;           // 0..cardsThisRound (RJ-051)
}

// fase VAZAS
interface PlayCardCommand extends MoveBase {
  type: 'move:playCard';
  cardId: CardId;        // DEVE estar na mão do jogador
}
```

Os campos de `MoveBase` são obrigatórios e tornam jogadas atrasadas **inofensivas**: uma jogada
que chega depois da vaza virar é rejeitada com `ERR-410` em vez de corromper o estado. Sem
isso, um jogador em rede ruim consegue jogar "no passado" — e como o vencedor da vaza define
quem puxa a próxima, uma jogada fora de tempo desalinharia a mesa inteira.

Validações do servidor, nesta ordem:

| Ordem | Verificação | Erro |
|---|---|---|
| 0 | Sala não está em `PAUSADA` | `ERR-423` |
| 1 | `matchId` / `roundNumber` / `trickNumber` correntes | `ERR-410` |
| 2 | Fase compatível com o comando | `ERR-005` |
| 3 | `activePlayerId === remetente` | `ERR-006` |
| 4 | Payload no schema (`bet` inteiro no intervalo) | `ERR-008` |
| 5 | `cardId` pertence à mão do remetente | `ERR-403` |
| 6 | `bet !== forbiddenBet` sendo o último apostador | `ERR-007` `SOMA_PROIBIDA` |

A ordem importa: a verificação de posse (5) vem **antes** da regra de jogo (6) para que uma
tentativa de trapaça nunca seja mascarada por um erro de regra.

## 5. Eventos — servidor → cliente

### 5.1 Genéricos

| ID | `type` | Payload | Destino |
|---|---|---|---|
| EV-001 | `room:snapshot` | `PlayerView` completo | só o solicitante |
| EV-002 | `room:playerJoined` | `{ player }` | todos |
| EV-003 | `room:playerLeft` | `{ playerId, reason }` | todos |
| EV-004 | `room:playerUpdated` | `{ player }` | todos |
| EV-005 | `room:connectionChanged` | `{ playerId, connection }` | todos |
| EV-006 | `room:hostChanged` | `{ hostId }` | todos |
| EV-007 | `room:optionsChanged` | `{ options }` | todos |
| EV-008 | `room:statusChanged` | `{ status }` | todos |
| EV-009 | `match:started` | `{ matchId, playerOrder, lives, options }` | todos |
| EV-014 | `match:ended` | `{ winnerIds, lives, endReason }` | todos |
| EV-015 | `system:notice` | `{ code, params }` | conforme o caso |
| EV-016 | `ack` | `{ commandId }` | só o remetente |
| EV-017 | `error` | `{ commandId?, code, params }` | só o remetente |

### 5.2 Eventos de partida

| ID | `type` | Payload | Destino |
|---|---|---|---|
| EV-010 | `round:dealt` | `{ hand: Card[] }` — mão completa em rodada de N>1 | **só o dono** |
| EV-011 | `round:started` | `{ roundNumber, cardsThisRound, isForeheadRound, firstBidderId, foreheadCards }` | **projetado** |
| EV-012 | `round:phaseChanged` | `{ phase, activePlayerId, deadline, forbiddenBet? }` | todos |
| EV-020 | `move:betPlaced` | `{ playerId, bet, betsSoFar, forbiddenBet }` | todos |
| EV-021 | `move:cardPlayed` | `{ playerId, card, trickNumber, nextPlayerId }` | todos |
| EV-022 | `trick:resolved` | `{ trickNumber, plays, winnerId, annulled, nextLeaderId, tricksWon }` | todos |
| EV-023 | `round:revealed` | `{ cards: Record<PlayerId, Card> }` — só rodada de testa | todos |
| EV-013 | `round:resolved` | `{ summary: RoundSummary, lives, eliminated }` | todos |
| EV-024 | `move:autoPlayed` | `{ playerId, kind: 'BET' \| 'CARD', value }` | todos |
| EV-030 | `match:paused` | `{ absentPlayerIds, since, decisionUnlockedAt, hardDeadline }` | todos |
| EV-031 | `match:absenceChanged` | `{ absentPlayerIds }` | todos |
| EV-032 | `match:decisionUnlocked` | `{}` | todos (só o host age) |
| EV-033 | `match:resumed` | `{ phase, activePlayerId, deadline }` | todos |
| EV-034 | `round:aborted` | `{ roundNumber, withdrawnPlayerIds }` | todos |

Regras de projeção:

- **EV-010** é direcionado: contém a mão real e sai **apenas** para o dono. Só é emitido em
  rodadas de N>1 cartas.
- **EV-011** é o evento mais delicado do protocolo. Em rodada de testa, `foreheadCards` é
  projetado **por destinatário**: contém a carta de todos os jogadores **exceto a do próprio
  destinatário** (RJ-100/RJ-101). Não existe versão "de broadcast" deste evento — ele é
  serializado uma vez por jogador.
- **EV-023** revela as cartas de testa aos donos ao fim da rodada de 1 carta; a partir daí a
  informação é pública para todos.
- **EV-012** envia `forbiddenBet` apenas quando o `activePlayerId` é o último apostador, e
  apenas para ele — os demais não precisam do valor e enviá-lo a todos entregaria de graça uma
  conta que o jogador deveria fazer sozinho.
- **EV-021** carrega a carta real: uma vez jogada, ela é pública (RJ-066).
- **EV-024** cumpre RJ-116: auto-play nunca é silencioso.
- **EV-030 a EV-033** implementam o ciclo de pausa (`03` §1.2). `EV-032` é emitido a todos —
  não só ao host — para que a mesa inteira entenda que existe uma decisão pendente e quem
  precisa tomá-la.
- **EV-034** precede a redistribuição de RJ-155. Depois dele vem um `round:started` novo com o
  **mesmo** `roundNumber`; o cliente **DEVE** descartar apostas e vazas locais daquela rodada.

Todo evento de broadcast passa obrigatoriamente pela projeção de `04` §5 antes de sair —
inclusive os que "parecem públicos".

## 6. Erros

```ts
interface ErrorPayload { code: string; params?: Record<string, unknown>; }
```

| ID | Código | Quando | Cliente deve |
|---|---|---|---|
| ERR-001 | `ROOM_NOT_FOUND` | Sala inexistente ou encerrada | Voltar à home com aviso |
| ERR-002 | `ROOM_FULL` | Sala com 8 jogadores | Avisar e voltar |
| ERR-003 | `INVALID_TOKEN` | Token ausente, inválido ou de outra sala | Limpar sessão e reentrar |
| ERR-004 | `NOT_HOST` | Comando de host vindo de não-host | Ignorar; é bug ou tentativa |
| ERR-005 | `WRONG_STATUS` | Comando incompatível com o status da sala | Resync |
| ERR-006 | `NOT_YOUR_TURN` | Jogada fora do turno | Resync |
| ERR-007 | `ILLEGAL_MOVE` | Jogada viola as regras de `02` | Exibir motivo; manter estado |
| ERR-008 | `VALIDATION_FAILED` | Payload não passou no schema | Exibir erro genérico |
| ERR-009 | `RATE_LIMITED` | Excedeu §7 | Aguardar `params.retryAfterMs` |
| ERR-403 | `FORBIDDEN_CARD` | Carta não pertence ao jogador | Resync; **logar como suspeita** |
| ERR-409 | `SESSION_TAKEN` | Sessão assumida por outra aba | Exibir "aberto em outra aba" |
| ERR-410 | `STALE_MOVE` | Jogada de rodada/partida já encerrada | Descartar silenciosamente |
| ERR-426 | `PROTOCOL_VERSION` | `v` incompatível | Pedir recarregar a página |
| ERR-423 | `MATCH_PAUSED` | Jogada enviada com a partida em `PAUSADA` | Descartar; aguardar `EV-033` |
| ERR-425 | `DECISION_LOCKED` | `resolveAbsence` antes de `decisionUnlockedAt` | Manter botão desabilitado |

`ERR-007` **DEVE** trazer em `params.motivo` a razão específica da recusa, para que a UI
explique o que houve — erro genérico em jogo de cartas é a maior fonte de frustração.

| `motivo` | Quando | Texto sugerido |
|---|---|---|
| `SOMA_PROIBIDA` | Último apostador tentou o valor de `forbiddenBet` (RJ-054) | "Você não pode apostar {n} — a soma da mesa fecharia em {cartas}" |
| `APOSTA_FORA_DO_INTERVALO` | `bet` fora de `[0, cardsThisRound]` | "Aposte entre 0 e {cartas}" |
| `FASE_ERRADA` | Comando correto, fase errada | "Ainda não é hora de jogar carta" |

`SOMA_PROIBIDA` **DEVERIA** ser inalcançável na prática: a UI recebe `forbiddenBet` por EV-012
e desabilita o valor. Se este erro aparecer em produção, é sinal de bug de sincronização, e
sua frequência **DEVERIA** ser monitorada.

## 7. Limites e proteção

| RNF | Limite |
|---|---|
| RNF-010 | Máx. 20 comandos por 10 s por conexão; excedente → `ERR-009` |
| RNF-011 | Máx. 32 KB por mensagem do cliente |
| RNF-012 | Máx. 8 jogadores + 4 espectadores por sala |
| RNF-013 | Comandos com o mesmo `id` dentro de 30 s são idempotentes: reenvio devolve o `ack` original sem reexecutar |

RNF-013 é o que torna seguro o cliente reenviar um comando após reconectar sem saber se ele
chegou. Sem idempotência, uma jogada pode ser aplicada duas vezes.
