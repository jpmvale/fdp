# 01 — Glossário

Status: **ESTÁVEL**

Vocabulário único do projeto. Código, UI, logs e documentos **DEVEM** usar estes termos.
Onde houver um termo em inglês entre parênteses, ele é o nome canônico no código; o termo em
português é o que aparece para o jogador.

## Pessoas

| Termo | Código | Definição |
|---|---|---|
| **Jogador** | `Player` | Pessoa participando de uma partida. Identificada por `playerId` estável dentro da sala. |
| **Host** | `hostId` | Jogador com poderes de administração da sala: iniciar partida, expulsar, iniciar revanche. Exatamente um por sala. |
| **Espectador** | `Spectator` | Pessoa presente na sala que não participa da partida em andamento. Vê apenas informação pública. Entra na próxima partida. |
| **Jogador ausente** | `DESCONECTADO` | Jogador cuja conexão caiu. **Pausa a partida** (RJ-117); mão, apostas e vidas ficam intactas. |
| **Jogador removido** | `REMOVIDO` | Ausente que o host decidiu retirar (RJ-154), ou que expirou no lobby. |

## Espaços

| Termo | Código | Definição |
|---|---|---|
| **Sala** | `Room` | Contêiner persistente de um grupo. Tem código de convite, host e lista de jogadores. Sobrevive ao fim de uma partida. |
| **Código da sala** | `roomCode` | Identificador curto e legível usado para convidar. Ver `06` §2 para o alfabeto. |
| **Lobby** | — | Estado da sala antes de a partida começar, e para onde ela retorna ao fim. |
| **Mesa** | `Table` | A tela de jogo em si — onde as cartas são vistas e jogadas. |

## Jogo

| Termo | Código | Definição |
|---|---|---|
| **Partida** | `Match` | Uma sessão completa de jogo, do início até haver vencedor. Composta por rodadas. |
| **Rodada** | `Round` | Unidade de progressão da partida. Sua estrutura interna é definida em `02`. |
| **Turno** | `Turn` | Janela em que um jogador específico tem o direito ou dever de agir. |
| **Mão** | `hand` | Conjunto de cartas de um jogador. **Estado oculto** — exceto na rodada de testa, em que a visibilidade se inverte (RJ-070). |
| **Baralho** | `deck` | Unidade de 52 cartas. A rodada usa `deckCount` baralhos (RJ-024). |
| **Sabot** | `shoe` | Os `deckCount` baralhos embaralhados juntos, de onde se distribui. |
| **Monte** | `stock` | Sobra do sabot não distribuída na rodada. Oculto de todos. |
| **Carta** | `Card` | Unidade de jogo. Estrutura em `04` §3. |
| **Jogada** | `Move` | Ação de um jogador que altera o estado da partida. Toda jogada é validada pelo servidor. |
| **Vaza** | `Trick` | Disputa em que cada jogador ativo joga uma carta; a maior vence. Uma rodada de N cartas tem N vazas. |
| **Puxar** | `lead` | Ser o primeiro a jogar numa vaza. Quem vence uma vaza puxa a seguinte. |
| **Aposta** | `bet` | Quantidade de vazas que o jogador declara que vai ganhar na rodada. Pública assim que declarada. |
| **Soma proibida** | — | Restrição que impede `soma(apostas) == cartasNaRodada`. Recai só sobre o último apostador. Ver `02` RJ-053. |
| **Vida** | `lives` | Recurso do jogador. Perde-se `\|aposta − vazas\|` por rodada. Zerar elimina. Informação pública. |
| **Carta na testa** | `foreheadCard` | Na rodada de 1 carta, a carta que o dono **não** vê e todos os outros veem. |
| **Eliminado** | `eliminated` | Jogador que zerou as vidas jogando. Entra na classificação por `mortoEmVaza`. |
| **Retirado** | `withdrawn` | Jogador removido por ausência (RJ-154). Cartas e vidas descartadas. **Não** é eliminação. |
| **Morte** | `mortoEmVaza` | Vaza em que a queda do jogador virou inevitável (RJ-008). Desempata a vitória de RJ-005. |
| **Condenado** | — | Jogador já morto que segue jogando as vazas restantes da rodada (RJ-009). |
| **Pausa** | `PAUSADA` | Partida congelada porque um jogador desconectou (RJ-117). |
| **Placar** | `scores` | Estado público de cada jogador: vidas, aposta da rodada e vazas ganhas. |

## Técnicos

| Termo | Código | Definição |
|---|---|---|
| **Comando** | `Command` | Mensagem cliente → servidor pedindo uma mudança de estado. Pode ser rejeitada. |
| **Evento** | `Event` | Mensagem servidor → cliente notificando uma mudança já efetivada. Nunca é rejeitada. |
| **Versão de estado** | `stateVersion` | Inteiro monotônico incrementado a cada mudança de estado da sala. Base da reconciliação. |
| **Snapshot** | `Snapshot` | Retrato completo do estado visível a um jogador específico, num dado `stateVersion`. |
| **Visão do jogador** | `PlayerView` | Projeção do estado da sala filtrada para o que aquele jogador tem direito de ver. |
| **Resync** | — | Procedimento em que o cliente descarta seu estado e recebe um `Snapshot` novo. |
| **Seed** | `seed` | Semente do gerador aleatório da partida. Permite reproduzir embaralhamentos em teste. |
| **Auto-play** | — | Jogada gerada pelo servidor no lugar de um jogador **conectado** que estourou o timer do turno (`02` §3.8.1). Jogador desconectado pausa a partida em vez de sofrer auto-play. |
| **TTL** | — | Tempo de vida de uma sala no armazenamento antes de ser descartada. |

## Termos proibidos

Para evitar ambiguidade, **NÃO DEVEM** ser usados: "game" (use partida ou o produto FDP),
"user" (use jogador), "session" para se referir a partida (sessão é o vínculo do dispositivo),
"round" e "turno" como sinônimos, "sala" e "partida" como sinônimos.
