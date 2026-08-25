# 10 — Critérios de Aceite

Status: **ESTÁVEL**

Este é o documento que define **"entregue"**. Cada `CA-###` é um teste executável. A v1 só é
considerada pronta quando todos os `CA` marcados `v1` passam de forma automatizada, exceto os
marcados `manual`.

Formato: Dado / Quando / Então. Nível indica onde o teste roda:
`U` = unitário, `I` = integração (servidor + store), `E` = ponta a ponta (navegador).

## 1. Sala e entrada

| ID | Nível | Critério |
|---|---|---|
| CA-001 | I | **Dado** que não existe sala, **quando** crio uma sala com apelido válido, **então** recebo um código de 5 caracteres do alfabeto de `06` §2 e um `sessionToken` válido |
| CA-002 | I | **Dado** um código inexistente, **quando** consulto a sala, **então** recebo `404` com `ERR-001` |
| CA-003 | I | **Dado** um código em minúsculas e com espaços, **quando** entro, **então** ele é normalizado e a entrada funciona |
| CA-004 | I | **Dado** uma sala com 8 jogadores, **quando** um nono tenta entrar como jogador, **então** recebo `ERR-002` |
| CA-005 | E | **Dado** o link `/j/{code}`, **quando** o abro, **então** caio na tela de apelido com o código já preenchido e bloqueado |
| CA-006 | I | **Dado** dois jogadores pedindo o apelido "Ana", **quando** ambos entram, **então** ambos existem com apelidos distintos |
| CA-007 | I | **Dado** um `sessionToken` válido, **quando** chamo `/session`, **então** retomo o mesmo `playerId` sem criar jogador novo |
| CA-008 | I | **Dado** um `sessionToken` de outra sala, **quando** conecto o WebSocket, **então** recebo `ERR-003` e o socket é fechado |
| CA-009 | U | **Dado** 10.000 códigos gerados, **quando** verifico, **então** nenhum contém `I`, `O`, `0` ou `1`, e nenhum está na lista de palavras bloqueadas |

## 2. Lobby

| ID | Nível | Critério |
|---|---|---|
| CA-020 | E | **Dado** dois navegadores no mesmo lobby, **quando** um terceiro entra, **então** ambos veem o novo jogador em até 1 s sem recarregar |
| CA-021 | I | **Dado** que sou o host, **quando** expulso um jogador, **então** ele recebe `room:playerLeft` com motivo `KICKED` e seu socket é fechado |
| CA-022 | I | **Dado** que não sou o host, **quando** envio `host:startMatch`, **então** recebo `ERR-004` e nada muda |
| CA-023 | I | **Dado** que o host sai, **quando** restam jogadores conectados, **então** o host passa ao conectado com menor `joinedAt` e todos recebem `room:hostChanged` |
| CA-024 | I | **Dado** menos que o mínimo de jogadores, **quando** o host inicia a partida, **então** recebo `ERR-005` |
| CA-025 | I | **Dado** dois `host:startMatch` simultâneos, **quando** processados, **então** exatamente uma partida é criada |
| CA-026 | E | **Dado** o lobby, **quando** toco em copiar link, **então** a área de transferência contém a URL de convite completa |

## 3. Conexão, reconexão e pausa

| ID | Nível | Critério |
|---|---|---|
| CA-040 | E | **Dado** uma partida em andamento, **quando** recarrego a página, **então** volto à mesa com vidas, mão e fase idênticas em até 1,5 s |
| CA-041 | E | **Dado** que perco a rede por 20 s, **quando** ela volta, **então** reconecto sozinho, sem interação, e nada do meu estado se perde |
| CA-042 | I | **Dado** uma partida em `EM_PARTIDA`, **quando** um jogador fica sem socket além de `TRANSPORT_GRACE`, **então** a sala vai a `PAUSADA`, `EV-030` é emitido e INV-14 vale |
| CA-042a | I | RJ-117a — **Dado** um socket que cai e volta em 3 s, **então** a sala **não** pausa, nenhum evento de ausência é emitido, e `RECONNECT_GRACE` nunca começa a contar |
| CA-042b | I | **Dado** uma partida de 20 min com quedas de rede curtas e repetidas (2 s a cada 30 s), **então** a partida **nunca** entra em `PAUSADA` (`11` §3.2) |
| CA-043 | I | **Dado** um cliente na versão `N`, **quando** ele recebe um evento na versão `N+2`, **então** ele emite `room:resync` e converge para o estado do servidor |
| CA-044 | I | **Dado** um socket já conectado com meu token, **quando** abro um segundo, **então** o primeiro é fechado com `ERR-409` |
| CA-045 | I | **Dado** um comando com `id` já processado há 5 s, **quando** o reenvio, **então** recebo o `ack` original e o efeito **não** é aplicado duas vezes |
| CA-046 | I | **Dado** uma sala em `EM_PARTIDA`, **quando** o servidor reinicia com desligamento gracioso, **então** a sala é recarregada do Redis, os clientes reconectam e a partida continua do mesmo `stateVersion` |
| CA-047 | I | **Dado** a sala em `PAUSADA`, **quando** envio uma jogada, **então** recebo `ERR-423` e o estado não muda |
| CA-048 | I | **Dado** a sala em `PAUSADA`, **quando** o último ausente reconecta, **então** volta a `EM_PARTIDA` via `EV-033` e os timers de turno reiniciam **do zero** (RJ-119, INV-15) |
| CA-049 | I | **Dado** uma pausa com 40 s decorridos, **quando** o host envia `resolveAbsence`, **então** recebe `ERR-425` |
| CA-050 | I | RJ-150, RJ-151 — **Dado** uma pausa que atinge 60 s, **então** `EV-032` é emitido a todos e só o host pode agir |
| CA-051 | I | RJ-153 — **Dado** `resolveAbsence: ENCERRAR`, **então** a partida vai a `FIM_DE_PARTIDA` com `ENCERRADA_POR_AUSENCIA` e `winnerIds` nulo |
| CA-052 | I | **Dado** `resolveAbsence: CONTINUAR_SEM`, **então** os ausentes viram `REMOVIDO`, entram em `withdrawn`, a rodada é abortada (`EV-034`) e redistribuída com o **mesmo** `roundNumber`, sem debitar vida de ninguém |
| CA-053 | I | **Dado** uma rodada abortada, **quando** ela é redistribuída, **então** `deckCount` é recalculado para o novo número de jogadores (INV-18) |
| CA-054 | I | **Dado** uma pausa que atinge `PAUSE_MAX`, **quando** ninguém decide nem reconecta, **então** a partida encerra sozinha como `ENCERRADA_POR_AUSENCIA` (RJ-157) |
| CA-055 | I | **Dado** `CONTINUAR_SEM` que deixa 1 jogador, **então** a partida encerra com `VITORIA_POR_ABANDONO` e ele em `winnerIds` (RJ-156) |
| CA-056 | I | **Dado** que o host é quem desconectou, **quando** a pausa começa, **então** a sucessão de host ocorre e a decisão fica com um conectado (RJ-152, INV-01) |
| CA-057 | I | **Dado** que um jogador reconecta e outro cai no mesmo intervalo, **então** a pausa permanece contínua e `RECONNECT_GRACE`/`PAUSE_MAX` **não** zeram |
| CA-058 | I | **Dado** um **espectador** que desconecta durante a partida, **então** a sala **não** pausa |
| CA-059 | E | **Dado** que reconecto numa partida pausada por outra pessoa, **então** vejo o overlay de pausa, não uma tela de erro (RF-049) |

## 4. Gameplay

Cada regra `RJ-###` de `02` §3 **DEVE** ser coberta por ao menos um critério abaixo (RNF-102).

### 4.1 Baralhos, setup e progressão

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-200 | U | RJ-034, RJ-141 | **Dado** um `seed` fixo e a mesma `playerOrder`, **quando** executo o setup duas vezes, **então** os estados resultantes são byte a byte idênticos |
| CA-201 | U | RJ-020, RJ-021, RJ-025 | **Dado** um sabot de `d` baralhos, **então** ele tem `52×d` cartas, `4×d` de cada valor, e todo `CardId` é único |
| CA-202 | U | RJ-024, INV-18 | **Dado** 8 jogadores e 7 cartas, **então** `deckCount` é 2; **dado** 8 jogadores e 6 cartas, **então** é 1; **dado** 2 jogadores e 1 carta, **então** é 1 |
| CA-203 | U | RJ-026 | **Dado** `deckCount ≥ 2`, **então** existem cartas com mesmo `rank` e `suit` e `CardId` distintos, e elas empatam entre si na resolução |
| CA-204 | U | RJ-022 | **Dado** duas cartas de mesmo `value` e `deckIndex` diferentes, **então** a resolução as trata como idênticas |
| CA-205 | U | RJ-035, RJ-036, RJ-037 | **Dado** `M = 7` e 8 jogadores, **quando** simulo 20 rodadas, **então** a sequência é `1..7,1..7,1` — o teto **não** é reduzido por número de jogadores |
| CA-206 | U | RJ-030, RJ-031, RJ-033 | **Dado** o setup, **então** `playerOrder` é permutação de todos, o primeiro apostador é sorteado nela, a rodada 1 tem 1 carta, e `playerOrder` não muda até o fim |
| CA-207 | U | RJ-038, RJ-039 | **Dado** o primeiro apostador da rodada `r`, **quando** `r+1` começa, **então** é o próximo **ativo** em sentido horário, pulando eliminados e retirados |
| CA-208 | U | RJ-001, RJ-032 | **Dado** `vidasIniciais = 5`, **então** todo jogador começa com exatamente 5 vidas |
| CA-209 | U | RJ-040, RJ-144, RNF-074 | **Dado** 100.000 embaralhamentos com seeds distintos, **então** a distribuição por posição é uniforme dentro da tolerância, e o mesmo seed sempre produz o mesmo sabot |
| CA-210 | U | RJ-041, RJ-042, RJ-043 | **Dado** 8 jogadores numa rodada de 7 cartas, **quando** distribuo, **então** cada um tem 7 cartas, o monte tem `104 − 56 = 48`, nenhuma carta se repete e a asserção de suficiência não dispara |
| CA-211 | U | RJ-027 | **Dado** duas rodadas consecutivas, **então** o sabot é regerado do zero e nenhuma carta persiste entre elas |

### 4.2 Apostas e a regra da soma

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-220 | U | RJ-054 | **Dado** 5 jogadores numa rodada de 2 cartas com apostas anteriores `0,0,1,0`, **quando** calculo `forbiddenBet`, **então** é `1`, e `0` e `2` são aceitos |
| CA-221 | U | RJ-056 | **Dado** o último apostador tentando o valor proibido, **então** o estado não muda e retorna `ERR-007` com `motivo: SOMA_PROIBIDA` |
| CA-222 | U | RJ-055 | **Dado** apostas cuja soma torna o valor proibido fora de `[0, cartas]`, **então** `forbiddenBet` é `null` e todo o intervalo é aceito |
| CA-223 | U | RJ-053, INV-09 | **Dado** qualquer fase de apostas concluída, **então** a soma **nunca** é igual a `cartasNaRodada` |
| CA-224 | U | RJ-054 | **Dado** qualquer estado de apostas, **quando** enumero as apostas legais do último, **então** há sempre ao menos uma — a fase nunca trava |
| CA-225 | U | RJ-051 | **Dado** uma aposta fora de `[0, cartasNaRodada]`, **então** recebo `ERR-008` |
| CA-226 | U | RJ-050 | **Dado** que não é minha vez de apostar, **então** recebo `ERR-006` |
| CA-227 | U | RJ-052 | **Dado** a fase em andamento, **quando** projeto para qualquer jogador, **então** as apostas já declaradas estão visíveis e nenhuma futura está |

### 4.3 Vazas e resolução de empate

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-240 | U | RJ-021, RJ-022 | **Dado** a mesa `A♣ K♥ 5♠`, **então** vence `A♣` — resultado idêntico com quaisquer naipes |
| CA-241 | U | §3.6.1 A | **Dado** `EMPATE_ANULA_VAZA` e a mesa `A A K 5 3`, **então** ninguém vence a vaza |
| CA-242 | U | §3.6.1 B | **Dado** `EMPATE_ANULA_CARTAS` e a mesa `A A K 5 3`, **então** vence quem jogou `K` |
| CA-243 | U | §3.6.1 B | **Dado** `EMPATE_ANULA_CARTAS` e a mesa `A A K K 5`, **então** vence quem jogou `5` |
| CA-244 | U | §3.6.1 B | **Dado** `EMPATE_ANULA_CARTAS` e a mesa `A A K K`, **então** ninguém vence |
| CA-245 | U | §3.6.1 | **Dado** a mesa `A A A A A` em qualquer modo, **então** ninguém vence |
| CA-246 | U | RJ-065, RJ-085 | **Dado** uma vaza com vencedor, **então** ele é o puxador da seguinte |
| CA-247 | U | RJ-086 | **Dado** ordem `P1:K, P2:A, P3:5, P4:A` sem vencedor, **então** **P4** puxa a seguinte — o último a jogar o valor empatado mais alto |
| CA-248 | U | RJ-087 | **Dado** `ANULA_CARTAS`, mesa `A A K K` e ordem `P1:A, P2:K, P3:A, P4:K`, **então** puxa **P3** — grupo de valor mais alto, último a jogá-lo |
| CA-249 | U | RJ-080, INV-11 | **Dado** uma rodada com vaza anulada, **então** `soma(vazasGanhas) < cartasNaRodada` |
| CA-250 | U | RJ-023, RJ-063 | **Dado** qualquer mão e qualquer vaza, **quando** enumero as jogadas legais, **então** **toda** carta da mão é legal |
| CA-251 | U | RJ-061, RJ-062 | **Dado** a fase de vazas iniciando com 5 ativos e puxador `P3`, **então** a primeira vaza é puxada pelo primeiro apostador e a ordem é `P3,P4,P5,P1,P2` |
| CA-252 | U | RJ-060, RJ-064 | **Dado** uma rodada de N cartas, **quando** termina, **então** foram resolvidas exatamente N vazas, todas as mãos estão vazias, e cada vencedor teve `tricksWon` incrementado em 1 |
| CA-253 | U | RJ-066 | **Dado** uma carta jogada, **quando** projeto para qualquer jogador, **então** ela é visível com `rank` e `suit` |
| CA-254 | I | RJ-081 | **Dado** uma partida em andamento, **quando** o host tenta mudar `regraEmpate`, **então** recebe `ERR-005` e o modo permanece |

### 4.4 Morte, vidas, eliminação e vitória

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-260 | U | RJ-007 | **Dado** aposta 2, 3 vazas ganhas e 2 restantes, **então** o desvio mínimo garantido é 1; **dado** aposta 3, 0 ganhas e 2 restantes, **então** é 1; **dado** aposta 2, 1 ganha e 2 restantes, **então** é 0 |
| CA-261 | U | RJ-008, RJ-095, RJ-096 | **Dado** um jogador com 1 vida que aposta 0 e ganha a vaza 1, **então** `mortoEmVaza = 1`, e o valor é reiniciado no começo da rodada seguinte |
| CA-262 | U | RJ-009 | **Dado** um jogador já morto na vaza 1 de uma rodada de 7, **então** ele joga as 6 vazas restantes normalmente e suas cartas ainda decidem vazas |
| CA-263 | U | RJ-005, RJ-010, RJ-122 | **Dado** três jogadores com 1 vida morrendo nas vazas 1, 5 e 7 da mesma rodada, **então** vence **só** quem morreu na vaza 7 |
| CA-264 | U | RJ-010, RJ-123 | **Dado** dois jogadores morrendo na **mesma** vaza como últimos, **então** ambos constam em `winnerIds` |
| CA-265 | U | RJ-011, INV-16 | **Dado** qualquer jogador eliminado, **então** `mortoEmVaza` está preenchido |
| CA-266 | U | RJ-075, RJ-097 | **Dado** uma rodada de testa em que todos zeram, **então** todos têm `mortoEmVaza = 1` e todos vencem |
| CA-267 | U | RJ-012, RJ-129 | **Dado** a classificação final, **então** eliminados da mesma rodada vêm ordenados por `mortoEmVaza` decrescente, e retirados ficam abaixo de todos os eliminados |
| CA-268 | U | RJ-013 | **Dado** qualquer `PlayerView`, **então** `mortoEmVaza` de todos está presente |
| CA-269 | U | RJ-002, RJ-090, RJ-091 | **Dado** aposta 2 e 2 vazas, **então** perde 0 vidas; **dado** aposta 2 e 0 vazas, **então** perde 2; **dado** aposta 0 e 1 vaza, **então** perde 1 |
| CA-270 | U | RJ-092, INV-10 | **Dado** um jogador com 1 vida errando por 3, **então** as vidas ficam em 0, nunca negativas |
| CA-271 | U | RJ-003, RJ-093, RJ-094, INV-12 | **Dado** um jogador zerando as vidas, **então** é eliminado após o débito da rodada e não recebe cartas na rodada seguinte |
| CA-272 | U | RJ-004, RJ-121 | **Dado** que resta 1 jogador ativo, **então** a partida encerra com `VITORIA` e ele em `winnerIds` |
| CA-273 | U | RJ-006 | **Dado** qualquer `PlayerView`, **então** as vidas de todos estão presentes |
| CA-274 | U | RJ-124 | **Dado** uma rodada em que **todas** as vazas foram anuladas, **então** quem apostou 0 perde 0 vidas e quem apostou N perde N |
| CA-275 | U | INV-17 | **Dado** qualquer estado alcançável, **então** nenhum jogador está simultaneamente em `eliminated` e `withdrawn` |

### 4.5 Rodada de 1 carta (testa)

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-280 | U | RJ-071 | **Dado** `M = 7`, **então** as rodadas 1, 8 e 15 são todas rodadas de testa |
| CA-281 | U | RJ-100, INV-13 | **Dado** uma rodada de testa, **quando** projeto para `P`, **então** o `CardId`, o `rank` e o `suit` da carta de `P` **não aparecem em nenhuma profundidade** do objeto serializado |
| CA-282 | U | RJ-101 | **Dado** a mesma projeção, **então** as cartas de **todos os outros** estão presentes e completas |
| CA-283 | U | RJ-072, RJ-073 | **Dado** uma rodada de testa, **quando** as apostas terminam, **então** não há fase de vazas e a vaza única é resolvida direto |
| CA-284 | U | RJ-074 | **Dado** uma rodada de testa com empate no topo, **então** RJ-086 usa a ordem de aposta como ordem de jogada |
| CA-285 | I | RJ-070 | **Dado** uma rodada de testa, **quando** inspeciono **todas** as mensagens recebidas por `P` no WebSocket, **então** nenhuma contém a carta de `P` antes de `EV-023` |
| CA-286 | U | RJ-102 | **Dado** uma rodada de N>1 cartas, **quando** projeto para `P`, **então** nenhuma carta de mão alheia aparece — só as contagens |

CA-285 é o teste de vazamento no nível do fio, e não da função de projeção: é o que prova que
nem um evento esquecido nem um log de debug entregam a carta.

### 4.6 Tempo, ausência e auto-play

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-290 | I | RJ-110, RJ-112, RJ-113, RJ-114, RJ-116 | **Dado** o jogador da vez **conectado** em silêncio por 45 s nas apostas, **então** o servidor aposta 0 por ele, emite `EV-024` e a fase avança |
| CA-291 | U | RJ-114 | **Dado** que 0 é o valor proibido do último apostador conectado e ausente de ação, **então** o auto-play aposta 1 |
| CA-292 | I | RJ-111, RJ-115 | **Dado** o jogador da vez **conectado** em silêncio por 30 s numa vaza, **então** é jogada a **menor** carta da mão |
| CA-293 | U | RJ-115 | **Dado** duas cartas de mesmo menor valor, **então** a escolha é determinística pelo menor `CardId` |
| CA-294 | I | RJ-117, RJ-118, INV-15 | **Dado** o jogador da vez que **desconecta**, **então** a partida pausa, **nenhum** auto-play ocorre e nenhum timer de turno segue correndo |
| CA-295 | I | RJ-126 | **Dado** uma desconexão no meio da fase de apostas, **quando** o jogador volta, **então** ele aposta normalmente e a rodada **não** é reiniciada |
| CA-296 | U | RJ-154, RJ-155, RJ-128 | **Dado** `CONTINUAR_SEM` durante a fase de vazas, **então** a rodada é abortada, ninguém perde vida por ela, e o retirado não ganha `mortoEmVaza` |
| CA-297 | U | RJ-127, RJ-156 | **Dado** retiradas que deixam menos de 2 ativos, **então** a partida encerra por RJ-156 |

### 4.7 Configuração e implementação

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-300 | E | RJ-130, RJ-132, RJ-133, RJ-134 | **Dado** o lobby com 8 jogadores e `maxCartasPorRodada = 7`, **então** todos veem as opções, o aviso de **2 baralhos** e de cartas repetidas aparece, e as opções seguem consultáveis durante a partida |
| CA-301 | I | RJ-131 | **Dado** o host alterando uma opção no lobby, **então** `EV-007` chega a todos |
| CA-302 | U | RJ-140 | **Dado** o código de `packages/rules`, **então** ele não referencia `Date.now` nem `Math.random` |
| CA-303 | U | RJ-141 | **Dado** `(seed, options, playerOrder, jogadas[])`, **quando** reexecuto a partida, **então** obtenho estado final idêntico |
| CA-304 | U | RJ-142, RJ-143 | **Dado** a suíte de `packages/rules`, **então** ela passa sem servidor, sem WebSocket e sem navegador, e o grafo de imports não alcança UI, rede nem store |
| CA-305 | U | RJ-120 | **Dado** 2 jogadores numa rodada de 1 carta, **quando** o primeiro aposta, **então** a aposta do segundo é forçada a um único valor legal — e a rodada resolve normalmente |
| CA-306 | U | RJ-125, RJ-043 | **Dado** qualquer estado alcançável, **então** a asserção de suficiência do sabot nunca dispara |

### 4.8 Bots (RF-018)

O que estes critérios protegem, antes de tudo, é a **honestidade**: um bot que
enxergasse a mão alheia deixaria de ser adversário e viraria juiz desonesto —
e o jogo inteiro depende de a mesa confiar no que está acontecendo.

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-320 | U | RJ-054 | **Dado** qualquer dificuldade e qualquer valor proibido, **quando** o bot aposta, **então** ele nunca escolhe o valor que fecharia a mesa |
| CA-321 | U | RF-018 | **Dado** o bot médio, **quando** a mão é de ases, **então** ele aposta mais do que apostaria com cartas baixas — e a mesma mão dá sempre a mesma aposta |
| CA-322 | U | RJ-100, RJ-101 | **Dado** o bot médio numa rodada de testa, **quando** o que está à vista é baixo, **então** ele aposta que ganha; com um ás à vista, que perde |
| CA-323 | U | RJ-023 | **Dado** o bot médio precisando de vaza, **então** ele usa a menor carta que ainda ganha; já tendo o que apostou, a maior que ainda perde |
| CA-324 | U | RJ-063 | **Dado** qualquer dificuldade e qualquer semente, **quando** o bot joga, **então** a carta escolhida está na mão dele |
| CA-325 | U | RJ-101, INV-13 | **Dado** o bot na rodada de testa, **então** a projeção que ele recebe não contém a própria carta — a informação não existe do lado dele |
| CA-326 | I | RF-018 | **Dado** o host no lobby, **quando** senta bots, **então** cada um tem id, nome e avatar próprios, o teto é 7, só o host mexe, e `host:removeBot` recusa jogador humano |
| CA-327 | I | RF-018 | **Dado** uma partida de humano + bots, **quando** é a vez de um bot, **então** ele joga dentro de `botThinkMs` sem `move:autoPlayed`, e a partida termina sem violar invariante |
| CA-328 | I | RF-018 | **Dado** uma sala onde só restam bots, **quando** o ócio vence, **então** ela encerra como qualquer outra |

### 4.9 Chat (RF-017)

O chat é a única coisa no produto que o servidor **não entende**: o payload é
texto opaco. Isso o torna, ao mesmo tempo, a funcionalidade mais simples de
implementar e o lugar mais fácil de vazar estado oculto sem ninguém notar —
basta um campo derivado da partida entrar no evento "por conveniência". Metade
destes critérios existe por isso.

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-330 | I | RF-017 | **Dado** um jogador presente, **quando** envia `chat:send` com texto válido, **então** todos na sala recebem `EV-040` com o mesmo `id`, `nickname`, `text` e `at` — e quem enviou recebe também |
| CA-331 | I | RF-017 | **Dado** o chat em qualquer status menos `ENCERRADA` — lobby, partida, pausa e fim —, **quando** alguém envia, **então** a mensagem é aceita; em `ENCERRADA`, recusada |
| CA-332 | U | RNF-014 | **Dado** texto vazio, só espaços, ou acima de 280 caracteres depois de aparado, **então** o comando é recusado e nada é publicado |
| CA-333 | U | RNF-015 | **Dado** uma sala com 200 mensagens, **quando** entra a 201ª, **então** o histórico continua com 200 e a mais antiga saiu |
| CA-334 | I | RF-017, CA-007 | **Dado** um jogador que recarrega a página ou reconecta, **então** o `room:snapshot` traz o histórico e ele volta a ver a conversa inteira |
| CA-335 | I | RF-017, RF-014 | **Dado** um espectador que entra com a partida em andamento, **então** ele vê o histórico anterior à entrada e pode escrever |
| CA-336 | I | RF-018 | **Dado** uma mesa com bots, **então** nenhum bot envia mensagem, e `chat:send` em nome de um bot é recusado |
| CA-337 | I | RF-017 | **Dado** um jogador que trocou de apelido ou saiu da sala, **então** as mensagens que ele já enviou continuam mostrando o apelido de quando foram enviadas |
| CA-338 | U | INV-13, RNF-005 | **Dado** o payload de `EV-040`, **então** ele contém exatamente `{id, playerId, nickname, text, at}` — nenhum campo derivado do estado da partida, e o mesmo objeto para todos os destinatários |
| CA-339 | I | RNF-010 | **Dado** um cliente que estoura o orçamento de comandos mandando mensagens, **então** recebe `ERR-009` como em qualquer outro comando — o chat não tem cota própria |
| CA-340 | E | RF-017, RNF-030 | **Dado** uma mensagem contendo `<script>` ou outra marcação, **então** ela aparece como TEXTO na tela de todos, sem ser interpretada |
| CA-341 | I | RF-017 | **Dado** uma sala que expira ou é encerrada, **então** o histórico morre com ela — não há chat recuperável depois |

CA-338 é o critério que protege a mecânica: `EV-040` é o único evento do jogo
que sai idêntico para todos, e é assim porque não há nada a projetar. Um campo a
mais ali — "quantas cartas o autor tem na mão", para enfeitar a bolha — é
exatamente como a rodada de testa vazaria.

CA-340 não é paranoia de formulário: o chat é o único lugar do produto onde um
jogador escreve texto que aparece na tela dos outros. É a superfície de injeção
inteira, num só campo.

### 4.9.1 Redutores do cliente (`11` §6)

| ID | Nível | Regras | Critério |
|---|---|---|---|
| CA-342 | I | RF-010 | **Dado** uma partida completa na máquina de sala, **quando** o cliente aplica cada evento pelo redutor, **então** o estado local é **idêntico** ao `snapshotFor` do servidor depois de cada comando, para todos os jogadores |
| CA-343 | U | RF-010 | **Dado** um evento que o redutor não sabe aplicar — desconhecido, transição estrutural, ou faltando o estado de que depende —, **então** ele devolve `null` e o cliente pede o retrato |

CA-342 é a régua que torna os redutores seguros. Um redutor errado não quebra:
ele diverge em silêncio, e a tela fica *plausível* — mostrando uma vaza que não
aconteceu, ou uma carta que já foi jogada. Nenhum teste por evento pega isso,
porque cada um passa sozinho.

Medições de 25/08/2026, numa partida de 3 jogadores até o fim:

| Momento | Reduzidos | Resyncs | Proporção |
|---|---|---|---|
| Primeira versão dos redutores | 246 | 110 | 69% |
| Depois de completar `round:phaseChanged` e `trick:resolved` | **300** | **56** | **84%** |

A diferença não veio de redutor mais esperto: veio de **completar os eventos**.
`round:phaseChanged` passou a carregar a vaza que nasce ao entrar em VAZAS,
`trick:resolved` a vaza seguinte e o mapa de condenados. Antes disso o cliente
teria de derivar quem lidera e em que ordem se joga — que é regra, e regra não
se decide no cliente.

Os 16% que sobram são as fronteiras de rodada e de partida: `round:started`,
`round:dealt`, `round:resolved`, `match:started`, `match:ended` e o ciclo de
pausa. São um punhado por rodada contra dezenas de jogadas, e reconstruí-los
exigiria carregar no evento praticamente o retrato inteiro — a essa altura,
pedir o retrato é mais honesto que fingir que não se está pedindo.

### 4.10 Propriedade e ponta a ponta

| ID | Nível | Critério |
|---|---|---|
| CA-310 | U | **Dado** 1.000 partidas simuladas com seeds aleatórios, 2 a 8 jogadores, ambos os modos de empate, `maxCartasPorRodada` de 1 a 10 e jogadas legais aleatórias, **quando** executadas, **então** todas terminam com `winnerIds` não vazio, **nenhuma** das invariantes INV-01 a INV-18 é violada, e nenhuma exceção é lançada |
| CA-311 | U | **Dado** as mesmas 1.000 partidas, **quando** injeto desconexões e resoluções de ausência aleatórias, **então** INV-14 e INV-15 valem em todo passo e nenhuma partida fica presa em `PAUSADA` |
| CA-316 | U | **Dado** cada passo das 1.000 partidas de CA-310, **então** INV-03 e INV-04 valem: mãos + monte + jogadas somam `52 × deckCount` e nenhuma carta existe em dois lugares |
| CA-317 | U | **Dado** cada passo das mesmas partidas, **então** INV-06 e INV-08 valem: todo jogador tem entrada no placar, e `activePlayerId` é sempre um ativo não eliminado |
| CA-318 | I | **Dado** qualquer sequência de comandos numa sala, **então** INV-02 e INV-05 valem: `stateVersion` cresce estritamente e existe no máximo uma partida ativa |
| CA-319 | U | **Dado** cada `PlayerView` gerado nas 1.000 partidas, **então** INV-07 vale: nenhum contém estado oculto de outro jogador |
| CA-312 | E | **Dado** 4 navegadores reais, **quando** jogam uma partida completa, **então** todas as telas mostram as mesmas vidas, as mesmas vazas e o mesmo vencedor |
| CA-313 | E | **Dado** uma rodada de testa em 4 navegadores, **então** cada jogador vê 3 cartas e um verso, e nenhum vê a própria |
| CA-314 | E | **Dado** o último apostador, **então** o botão do valor proibido aparece desabilitado com a razão visível, sem precisar tentar |
| CA-315 | E | **Dado** um jogador que fecha o navegador no meio da rodada, **então** os outros veem o overlay de pausa nomeando-o, e após 60 s o host vê as duas opções |

CA-310 e CA-311 são os testes de propriedade que substituem centenas de casos manuais e são a
evidência central de que a partida nunca trava — a métrica de severidade 1 de `00` §7. Ambos
**DEVEM** imprimir o `seed` ao falhar, para que o caso vire regressão via CA-303.

## 5. Segurança e anti-trapaça

| ID | Nível | Critério |
|---|---|---|
| CA-120 | U | **Dado** um estado com mãos distintas, **quando** projeto para o jogador A, **então** nenhum `CardId` da mão de B aparece no resultado, em nenhuma profundidade do objeto |
| CA-121 | I | **Dado** um comando com `CardId` que não está na minha mão, **quando** enviado, **então** recebo `ERR-403`, o estado não muda e a ocorrência é registrada |
| CA-122 | I | **Dado** que não é minha vez, **quando** envio uma jogada, **então** recebo `ERR-006` |
| CA-123 | I | **Dado** uma jogada com `roundNumber` ou `trickNumber` anterior ao atual, **quando** enviada, **então** recebo `ERR-410` e o estado não muda |
| CA-124 | I | **Dado** 30 comandos em 10 s, **quando** enviados, **então** os excedentes recebem `ERR-009` com `retryAfterMs` |
| CA-125 | U | **Dado** qualquer evento de broadcast, **quando** serializado, **então** ele não contém `seed` nem `sessionToken` |
| CA-126 | I | **Dado** um payload que falha no schema, **quando** enviado, **então** recebo `ERR-008` e a lógica de jogo não é sequer invocada |
| CA-127 | E | **Dado** um apelido contendo `<script>alert(1)</script>`, **quando** exibido, **então** aparece como texto literal e nenhum script executa |

## 6. Acessibilidade

| ID | Nível | Critério |
|---|---|---|
| CA-140 | E | **Dado** cada tela principal, **quando** rodo `axe-core`, **então** não há violação crítica ou séria |
| CA-141 | manual | **Dado** apenas o teclado, **quando** jogo uma partida completa, **então** consigo executar toda ação sem mouse ou toque |
| CA-142 | manual | **Dado** um leitor de tela, **quando** jogo uma rodada, **então** turno, jogadas e resultado são anunciados de forma compreensível |
| CA-143 | E | **Dado** `prefers-reduced-motion: reduce`, **quando** uma carta é jogada, **então** nenhuma animação de deslocamento ocorre |
| CA-144 | E | **Dado** zoom de 200%, **quando** navego pelas telas, **então** nenhuma ação fica inacessível e não há rolagem horizontal |

## 7. Desempenho

| ID | Nível | Critério |
|---|---|---|
| CA-160 | I | **Dado** 8 jogadores, **quando** meço comando → evento, **então** p95 ≤ 350 ms |
| CA-161 | U | **Dado** uma sala cheia, **quando** serializo o snapshot, **então** ele ocupa ≤ 32 KB |
| CA-162 | I | **Dado** 500 salas simultâneas, **quando** aplico a carga de RNF-060, **então** CA-160 continua válido |
| CA-163 | E | **Dado** 4G simulado, **quando** abro a home, **então** LCP ≤ 2,0 s |
| CA-164 | CI | **Dado** o build de produção, **quando** meço o bundle inicial, **então** ele é ≤ 180 KB comprimido |

## 8. Roteiro manual de aceitação final

Executado por **4 pessoas reais, em 4 dispositivos distintos**, sendo ao menos 2 celulares em
redes móveis diferentes. Todos os passos **DEVEM** passar:

1. O host cria a sala e compartilha o link por app de mensagem.
2. Os três demais entram pelo link, definem apelido e avatar, e aparecem no lobby.
3. O host confere as opções; com 4 jogadores e 7 cartas, o lobby indica **1 baralho**.
4. O host inicia a partida. A rodada 1 é de testa: cada um vê 3 cartas e o próprio verso.
5. No meio de uma rodada, um jogador ativa o modo avião por 30 s — os outros veem o overlay de
   pausa **nomeando** quem caiu; ao voltar, a partida retoma do ponto exato, com contagem de 3 s.
6. Um jogador bloqueia o celular por 2 min — a partida pausa, o host vê as duas opções após
   60 s, escolhe **continuar sem**, e a rodada recomeça sem ele, sem ninguém perder vida.
7. Um jogador conectado ignora o próprio turno — o auto-play acontece, é anunciado, e a mesa
   avança **sem** pausar.
8. Uma vaza empata: a mesa explica o que houve e quem puxa a seguinte.
9. A partida chega ao fim com vencedor correto e coerente nas 4 telas. Se a vitória veio do
   desempate por morte (RJ-005), a tela explica em texto por que aquele jogador venceu.
10. O host inicia revanche — nova partida com o mesmo grupo, vidas restauradas.
11. Ao fim, ninguém observou tela travada, placar divergente, pausa sem saída, ou informação de
    outro jogador.
