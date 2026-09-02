# Plano 03 — Filas de partida e ranqueada

Status: **ENTREGUE** · Aberto em 02/09/2026 · F1 a F4 concluídas em 02/09/2026 · D-4 corrigida
na implementação (ver §8)

O que este plano propôs está no código. Ele fica aqui como registro do porquê de cada decisão; o
que virou norma vive em `00` §5 (P12), `05`, `07` e `10`.

Cria duas filas públicas — normal e ranqueada — e um elo por colocação, no espírito do TFT.

---

## 1. O que este plano reverte

`00` §4.2 lista, em "fora do escopo da v1", duas linhas que este plano contraria:

> Matchmaking público, salas abertas ou lista de partidas.

> Ranking global, conquistas, progressão, moeda ou cosméticos.

A reversão segue o caminho já trilhado pelo chat (P9), pelos bots (P10) e pelas contas (P11): a
linha sai de §4.2 com data e referência, entra a decisão **P12** em `00` §5, e os requisitos novos
passam a viver em `07` como qualquer outro.

A segunda linha é revertida **em parte**, e a parte importa. Entra: elo por colocação nas partidas
ranqueadas, com faixa visível no perfil. **Continua fora**: conquistas, progressão de nível, moeda,
cosméticos, e — de propósito — **tabela de classificação global**. Elo aqui é a resposta a "quanto
eu jogo bem", não a "quem é o melhor do Brasil"; um top-100 é um produto diferente, com problemas
diferentes (nomes ofensivos em vitrine, farm de conta, incentivo a smurf) e não é este.

`00` §4.3 não previa esta porta. É uma ampliação real de escopo, não a abertura de uma porta que já
estava desenhada, e o plano assume isso.

---

## 2. Quatro coisas que não podem quebrar

| # | Invariante | Por quê |
|---|---|---|
| I-1 | **Jogar por link, sem conta, continua inteiro.** A fila é *mais um* caminho, nunca *o* caminho. | Herdado do plano 01. Está escrito na tela do lobby: *"Quem receber o link entra direto — sem conta, sem instalar nada."* Uma fila na home não pode empurrar a sala privada para segundo plano na navegação. |
| I-2 | **`@fdp/rules` não aprende o que é fila nem o que é elo.** | O motor é determinístico, tem as regras `RJ-###` e um teste de propriedade de mil partidas. Elo é função do `ranking()` que já existe — entra **depois** da partida, lendo o resultado, nunca dentro dela. Uma partida ranqueada e uma partida entre amigos são a **mesma** partida. |
| I-3 | **Ninguém fica na fila sem estar na fila.** | Estado de fila é presença, e presença mentida é o defeito clássico de matchmaking: mesas que se formam com gente que fechou a aba há vinte minutos. A fila **é** o socket aberto (§5.1). |
| I-4 | **RNF-055**: 180 KB comprimidos no cliente. | Nada de biblioteca nova no cliente. A fila é uma tela, um socket e um contador. |

---

## 3. Decisões já tomadas

| # | Decisão | Consequência |
|---|---|---|
| D-1 | **Só a ranqueada exige conta.** A fila normal entra com apelido, como quem entra por link | Preserva I-1 no caminho casual. Custa: a fila normal não tem como banir reincidente nem gravar histórico de quem não tem conta — e é o preço aceito por manter a porta leve. |
| D-2 | **Abandonar a ranqueada custa o último lugar mais uma punição fixa** | A punição é uma segunda regra de elo, e regra que não aparece na tela não existe: a tela de fila **precisa** dizer o custo **antes** de a pessoa entrar (§7.3). |
| D-3 | **Elo e faixa aparecem no perfil público** | Coerente com D-4 do plano 01 (perfil público por link). O perfil ganha uma seção; nenhuma listagem, nenhuma busca, nenhum top-N. |

Decisões que tomei por conta e ficam registradas para serem contestadas:

| # | Decisão | Por quê |
|---|---|---|
| ~~D-4~~ | ~~**A fila vive no Redis, não no Postgres**~~ | **Corrigida implementando** — os bilhetes vivem no processo. Ver §8, F3. |
| ~~D-5~~ | ~~**Um pareador por vez, garantido por lock no Redis**~~ | **Caiu junto com D-4**: o lock protegeria uma corrida que não é a corrida real. Ver §8, F3. |
| D-6 | **Mesa de 4 a 8.** Mínimo 4 (pedido), teto 8 (P1) | Aos 4, abre a janela de 60 s; se chegar a 8, forma na hora e não espera o resto da janela. |
| D-7 | **Nenhum bot em partida de fila** | Bot completa mesa é recurso do lobby privado (RF-018), onde o host escolhe. Numa fila, bot seria a casa fingindo que há gente — e, na ranqueada, elo ganho de bot. A única exceção é o bot que **assume** um assento abandonado (D-9), que não é um bot a mais na mesa: é um assento que já era de gente. |
| D-8 | **Sala de fila não tem host com poderes** | Nas salas de amigos o host é uma pessoa com autoridade social real. Entre estranhos ela não existe, e dar a um deles o botão de expulsar os outros quatro é entregar a partida a quem clicar primeiro. Numa sala de fila não há expulsar, não há mexer nas opções, não há sentar bot, não há encerrar a partida. |
| D-9 | **Ausência em sala de fila resolve-se sozinha**, virando bot | Consequência direta de D-8: a decisão de pausa (RF-011) precisa de um host, e não há. Passada a carência, o assento vira bot herdando mão, aposta e vidas — o mecanismo **já existe**, é o RF-096 que entrou em 02/09/2026 para a expulsão. A rodada não anula, e a mesa não fica refém de quem sumiu. |
| D-10 | **Sem tela de "aceitar partida"** | O aceite existe para provar presença, e o socket da fila já prova (I-3). Uma tela a mais entre a fila e a mesa é uma tela a mais para perder gente. Em compensação, **aba em segundo plano sai da fila** — ver §5.2, que é onde isso fica interessante. |
| D-11 | **Elo puro por colocação, sem força do adversário** | É o que o TFT faz, é explicável em uma frase, e a compatibilidade de elo no pareamento (§6.4) já faz metade do trabalho que um fator de adversário faria. A `partida_jogadores` grava `elo_antes` de todo mundo, então acrescentar o fator depois é recálculo, não migração. |
| D-12 | **Sem temporada e sem decay na primeira entrega** | Temporada é uma data que precisa ser decidida, comunicada e operada; decay pune quem viajou. Nenhum dos dois é necessário para a primeira fila funcionar, e os dois são fáceis de acrescentar sobre uma tabela que guarda `atualizado_em`. |

---

## 4. O elo

### 4.1 A conta

Numa mesa de `N` jogadores, a colocação `p` vai de 1 a `N`. O ponto neutro é o meio da mesa:

```
neutro(N)   = (N + 1) / 2
relativa(p) = (neutro − p) / (neutro − 1)      // +1 no primeiro, −1 no último, 0 no meio
delta       = arredonda(K × relativa(p))
```

Com `N = 8`: 1º `+1`, 2º `+0,71`, 3º `+0,43`, 4º `+0,14`, 5º `−0,14`, 6º `−0,43`, 7º `−0,71`, 8º `−1`.
Com `N = 4`: 1º `+1`, 2º `+0,33`, 3º `−0,33`, 4º `−1`.

É isto que o pedido descreve: o 2º ganha mais que o 3º, e ficar no meio da mesa não move nada. E é
**soma zero por mesa** — o que sobe de um lado desce do outro, então a média da população fica
onde começou, sem inflação.

`K` cai conforme a conta joga:

| Partidas ranqueadas | K | Por quê |
|---|---|---|
| 1 a 10 | 80 | Colocação. O sistema não sabe nada sobre você e precisa te levar rápido para perto do seu lugar. |
| 11 a 30 | 50 | Calibrando. |
| 31 em diante | 30 | Estável. Uma partida ruim não desfaz um mês. |

Elo inicial: **1000**.

### 4.2 O piso, e por que ele quebra a soma zero de propósito

Elo nunca desce abaixo de **0**. Isso quebra a soma zero exata, e é deliberado: a alternativa é um
buraco sem fundo, em que quem passou por uma sequência ruim carrega um número que só serve para
lembrar disso. O erro acumulado é minúsculo (só ocorre em quem está no fundo) e o benefício é que
ninguém é empurrado para fora do jogo por um placar.

### 4.3 Abandono (D-2)

Quem abandona uma ranqueada — sai pelo `player:leave`, ou some e não volta até o assento virar bot
(D-9) — recebe:

```
delta = −K − PUNICAO_ABANDONO        // PUNICAO_ABANDONO = 25
```

Ou seja: o pior resultado possível da mesa, **mais** um extra. A colocação que o bot acabar tirando
naquele assento não conta para a pessoa — ela não jogou aquilo.

**A punição é destruída, não redistribuída** — e por isso uma mesa com abandono **deixa de ser soma
zero**. Ninguém lucra com a saída alheia: cada sobrevivente leva exatamente o que a colocação dele
daria de qualquer jeito. Se os pontos do abandono caíssem no colo de quem ficou, a mesa passaria a
ter motivo para torcer para alguém sair — que é o incentivo exato que a punição existe para não
criar. O gate da F4 verifica isso sobre uma partida de verdade.

**O assento lembra de quem era.** `trocarPorBot` apaga a conta do assento para o bot não creditar a
colocação dele a uma pessoa (RF-096) — e isso, sozinho, fazia a participação de quem abandonou ser
gravada **sem `contaId`**, então esta punição não achava ninguém para punir. A regra existia e não
acontecia. O assento passa a guardar `quemSaiu` (apelido, avatar e conta), usado só para a linha do
histórico; a conta continua fora do assento, então nada do que o bot fizer depois é creditado a
ninguém. Lembrar não é herdar: o que a memória permite é o contrário — cobrar de quem saiu o preço
de ter saído.

Duas coisas que precisam ficar explícitas, porque a punição é a parte do plano com mais chance de
machucar alguém que não merecia:

1. **Queda de internet não é abandono enquanto for queda.** O FDP já distingue as duas coisas
   (RJ-117, e RJ-117b para a aba em segundo plano). O relógio do abandono é o mesmo da ausência: só
   depois de o assento virar bot é que a pessoa abandonou. Voltar antes disso não custa nada.
2. **O custo aparece antes.** A tela da fila ranqueada diz, antes do botão, quanto custa sair no
   meio. Descobrir a punição depois de tê-la levado é o desenho que faz alguém abandonar o jogo, e
   não a partida.

### 4.4 Faixas (D-3)

| Faixa | Pontos |
|---|---|
| Bronze | abaixo de 900 |
| Prata | 900 a 1199 |
| Ouro | 1200 a 1499 |
| Platina | 1500 a 1799 |
| Diamante | 1800 ou mais |

Começando em 1000 e com soma zero, Prata é onde a maior parte das pessoas fica — que é o
comportamento honesto de uma faixa do meio, e não um acidente.

O perfil mostra faixa **e** número. Mostrar só a faixa esconderia o progresso dentro dela, que é
justamente o que se olha entre uma partida e outra.

---

## 5. A fila

### 5.1 A fila é o socket (I-3)

Entrar na fila abre um WebSocket em `/api/fila/ws`. Sair da fila, fechar a aba, perder a conexão,
navegar para outro lugar — tudo isso fecha o socket, e fechar o socket **é** sair da fila. Não há
ticket para expirar, não há varredura de fantasmas, não há heartbeat próprio: o transporte que o
projeto já opera é a prova de presença.

O Redis guarda, por modo, um conjunto ordenado por instante de entrada, e um hash por bilhete com
`{ contaId?, apelido, avatar, elo?, entrouEm }`. TTL curto, renovado pelo servidor enquanto o
socket viver — o TTL é rede de segurança para queda do processo, não o mecanismo principal.

### 5.2 Segundo plano sai da fila

Aqui vale a pena parar. Em partida, a regra é a **oposta**: RJ-117b diz que trocar de aplicativo no
celular **não** pausa nada, porque a pessoa está no meio de um compromisso com outras quatro e o
relógio dela tem de continuar correndo. Isso entrou em 01/09/2026 e é o comportamento certo lá.

Na fila, o mesmo gesto significa outra coisa. Quem foi para o Instagram não está esperando partida
— e cair numa mesa com quatro estranhos que vão esperar 45 segundos por uma aposta que não vem é
pior para todo mundo do que perder o lugar na fila. Então `player:background` (o evento já existe)
**tira da fila**, com uma linha na tela dizendo por quê e um botão para voltar.

As duas regras são opostas e as duas estão certas: a diferença é que uma protege um compromisso já
assumido e a outra evita assumir um compromisso que a pessoa não vai cumprir.

### 5.3 Como a mesa se forma (D-6)

```
enquanto (houver bilhetes compatíveis):
  se o grupo tem 8            → forma agora
  se o grupo tem 4 e não há janela aberta → abre janela de 60 s
  se a janela venceu          → forma com quem estiver no grupo (4 a 8)
```

O pareador roda a cada 2 s, sob lock no Redis (D-5). Formar uma mesa é:

1. criar a sala pelo caminho normal (`createRoom`), marcada com `origem`;
2. sentar todo mundo;
3. **começar a partida na hora** — sem lobby e sem pronto. RF-094 (o pronto) existe porque no lobby
   a pessoa larga o telefone e volta cinco minutos depois; na fila, a presença acabou de ser
   provada pelo socket. Pedir pronto de novo seria pedir duas vezes a mesma coisa e perder gente no
   meio;
4. emitir `fila:pareado` com o código da sala e o token de sessão de cada um.

A partida é a mesma partida de sempre. As opções são as padrão — na fila ninguém negocia regra.

### 5.4 Compatibilidade de elo (só na ranqueada)

Janela de `±150` pontos, alargando `+50` a cada 30 s de espera, sem teto depois de 5 minutos. Sem
teto de propósito: uma fila que prefere não formar mesa a formar uma mesa desigual acaba não
formando mesa nenhuma, e às três da manhã a mesa desigual é a única que existe.

---

## 6. Onde isto encosta no que já existe

| Peça | O que muda |
|---|---|
| `@fdp/rules` | **Nada.** I-2. |
| `@fdp/room` | `Room` ganha `origem: 'PRIVADA' \| 'FILA' \| 'RANQUEADA'`. Comandos de host recusados quando não é `PRIVADA` (D-8). A resolução de ausência vira automática (D-9), reusando o caminho do RF-096. |
| `@fdp/contas` | Tabela `elo`, colunas novas em `partidas` e `partida_jogadores`, e as leituras do perfil. |
| `server/` | `fila.ts` (bilhetes, pareador, lock), `elo.ts` (a conta de §4, pura e testável), rota e socket da fila. |
| `app/` | Tela de fila, seção de elo no perfil, e o aviso de custo de abandono. |

O `elo.ts` é puro pelo mesmo motivo que `packages/bot` é puro: uma função de `(colocações, elos
antes, quem abandonou)` para `deltas` é testável exaustivamente, e é onde moram os erros que
ninguém percebe até virarem reclamação.

### 6.1 Migração 002

```
elo
  conta_id             uuid pk references contas(id) on delete cascade
  pontos               integer not null default 1000
  partidas             integer not null default 0    -- só ranqueadas; define o K
  melhor_pontos        integer not null default 1000
  atualizado_em        timestamptz not null

partidas          + origem text not null default 'PRIVADA'

partida_jogadores + elo_antes integer      -- NULL quando a partida não é ranqueada
                  + elo_delta integer
                  + abandonou boolean not null default false
```

Gravar `elo_antes` e `elo_delta` na participação, e não só o total na conta, é o que torna o perfil
explicável ("−12 nesta aqui, por quê?") e o que permite recalcular a série inteira se a fórmula
mudar (D-11). É barato: dois inteiros por linha que já existe.

---

## 7. Requisitos e critérios

| ID | Requisito |
|---|---|
| RF-097 | Fila **normal**: entra com apelido, sem conta (D-1), e a mesa forma-se de 4 a 8 |
| RF-098 | Fila **ranqueada**: exige conta, pareia por faixa de elo e alarga a faixa com a espera |
| RF-099 | Aos 4 na fila abre-se uma janela de 60 s para a mesa crescer; aos 8 forma-se na hora |
| RF-100 | Sair da fila **DEVE** bastar fechar a aba, perder a conexão ou mandar a aba para segundo plano |
| RF-101 | Sala de fila **NÃO TEM** host com poderes: nem expulsar, nem opções, nem bot, nem encerrar |
| RF-102 | Em sala de fila, ausência resolve-se sozinha: o assento vira bot e a rodada continua |
| RF-103 | Elo por colocação, soma zero na mesa, `K` decrescente, piso em zero |
| RF-104 | Abandonar ranqueada custa o último lugar mais punição fixa, e o custo **DEVE** estar na tela **antes** de entrar na fila |
| RF-105 | O perfil público mostra faixa e pontos; não há listagem nem classificação global |
| RF-106 | Qualquer pessoa **PODE** esconder as mensagens de outra **para si**, sem passar pelo servidor e sem que a outra saiba (ver §9.1) |

| ID | Tipo | Requisito | Critério |
|---|---|---|---|
| CA-419 | U | RF-103 | Numa mesa de 4 e numa de 8, o delta do 1º é `+K`, o do último é `−K`, o do meio é 0, a soma dos deltas da mesa é 0, e o 2º recebe estritamente mais que o 3º |
| CA-420 | U | RF-103 | `K` é 80 até a 10ª partida, 50 até a 30ª e 30 depois; o piso segura em 0 e a diferença é registrada |
| CA-421 | U | RF-104 | Quem abandona recebe `−K − 25`, independente da colocação que o assento tirou; quem voltou antes de o assento virar bot não recebe punição nenhuma |
| CA-422 | U | RF-099 | 4 na fila abre janela; o 8º forma na hora sem esperar; a janela vencida forma com quem estiver |
| CA-423 | I | RF-100 | Fechar o socket tira da fila; `player:background` tira da fila; a mesa que se forma não contém bilhete de socket fechado |
| CA-424 | I | RF-101 | `host:kick`, `host:setOptions`, `host:addBot` e `host:endMatch` são recusados em sala de fila |
| CA-425 | I | RF-102 | Ausência em sala de fila vira bot sem decisão de ninguém, e a rodada não é anulada |
| CA-426 | I | RF-098 | Entrar na ranqueada sem conta é recusado; a faixa de pareamento alarga com a espera |
| CA-427 | I | RF-103 | Uma ranqueada inteira grava `elo_antes` e `elo_delta` em cada participação e atualiza `elo.pontos` uma única vez |
| CA-428 | E | RF-104 | A tela da fila ranqueada mostra o custo do abandono antes do botão de entrar |
| CA-429 | E | RF-105 | O perfil público de uma conta ranqueada mostra faixa e pontos; o de uma conta sem ranqueada não mostra a seção |
| CA-430 | U | RF-106 | A lista local de escondidos é por sala, sobrevive a recarregar, lê lixo como lista vazia, e um armazenamento que lança — ou que não existe — não quebra nada |
| CA-431 | I | RF-098, RF-102, RF-103, RF-104 | O gate da F4: quatro contas entram na fila ranqueada, jogam a partida inteira com um abandono no meio, e o elo aparece nos quatro perfis — com a punição em quem saiu, sem ninguém lucrar com ela, e nada disso numa fila normal |

---

## 8. Fases

Todas concluídas em 02/09/2026.

**F1 — O elo, sozinho.** ✅ `server/src/elo.ts` puro, migração 002, `Elos` nas duas implementações,
gravação na conta e na participação, seção no perfil.
*Gate:* CA-419, CA-420, CA-421, CA-427, CA-429.

*Cumprido:* 16 testes do elo puro — varrendo todas as colocações de todas as mesas de 2 a 8 — e 6
de contrato, obrigatórios nas duas implementações. A soma zero é testada como propriedade do
conjunto, que é o único jeito de vê-la.

Primeiro o elo e não a fila, de propósito: o elo é a parte com matemática, é testável sem rede
nenhuma, e é a que fica errada em silêncio. A fila sem elo é uma inconveniência; o elo errado numa
fila que já rodou é um estrago que precisa de recálculo e de explicação pública.

*O que apareceu implementando:* o piso corta o **delta**, não só o resultado. Gravar `−30` numa
conta que tinha 10 pontos faria a tela do perfil mentir na conta mais simples que ela faz: 10 − 30
não é 0. O delta gravado é sempre `eloDepois − eloAntes`.

**F2 — Sala de fila.** ✅ `origem` na sala, poderes de host recusados num lugar só, ausência
automática, e `player:leave` virando abandono em vez de retirada.
*Gate:* CA-424, CA-425.

*O que o plano não tinha previsto:* `player:leave` numa mesa de fila. A retirada do RJ-154 anula a
rodada de todo mundo, e entre amigos isso é aceitável — quem saiu avisou. Entre estranhos, bastaria
uma pessoa clicando "sair" para apagar a rodada dos outros sete, de graça, quantas vezes quisesse.
Vira abandono, pelo mesmo caminho do RF-096.

**F3 — A fila normal.** ✅ Bilhetes, pareador, socket, formação, tela.
*Gate:* CA-422, CA-423.

*Correção a D-4 e D-5.* Os bilhetes **não** foram para o Redis. A razão apareceu implementando: um
bilhete É um socket aberto (I-3), e socket é do processo que o segura. Guardar o bilhete no Redis
daria a uma segunda instância a informação de que alguém espera, sem lhe dar meio nenhum de avisar
essa pessoa — estado compartilhado que ninguém do outro lado consegue usar. E o lock de D-5
protegeria uma corrida que não é a corrida real: a corrida real é entre processos que **não
conseguem** notificar os bilhetes um do outro.

O caminho para várias instâncias continua aberto e é o mesmo de sempre: `FilaViva` já é uma
interface, a segunda implementação guarda bilhete no Redis e avisa por pub/sub, e cada processo
notifica os sockets que são seus. O que não dava era fingir que metade disso já existia.

**F4 — A ranqueada.** ✅ Exigência de conta, faixa de pareamento, punição de abandono, avisos na
tela.
*Gate:* CA-426, CA-428, e o gate de verdade — *"uma partida ranqueada completa, com um abandono, do
socket da fila até o número mudando nos dois perfis"*. **Executado** (CA-431), depois de ter sido
declarado cumprido sem ter sido.

*Cumprido:* 12 testes de socket de verdade, incluindo o que garante que as duas filas não se
misturam — três na normal e um na ranqueada somam quatro, e é exatamente o que não pode formar
mesa.

*O que o gate encontrou, e não teria sido encontrado de outro jeito.* As duas metades estavam
testadas e a **emenda** não: a fila formava mesa num teste, o elo era aplicado sobre uma `Partida`
fabricada em outro, e o caminho entre os dois nunca tinha rodado inteiro. Ele achou duas coisas:

1. **A punição de abandono nunca era aplicada.** Duas decisões corretas se atropelaram — RF-096
   apaga a conta do assento, RF-104 precisa da conta para cobrar — e o resultado era uma regra
   escrita, documentada, testada em unidade e **inerte em produção**. Ver §4.3.
2. **A mesa com abandono não é soma zero**, e o plano não dizia. A punição é destruída em vez de
   redistribuída, o que é a decisão certa e precisava estar escrita: sem ela, o próximo a mexer no
   elo "consertaria" a soma devolvendo os pontos à mesa, e criaria o incentivo a torcer pelo
   abandono alheio.

A emenda saiu do `main.ts` e virou `registrarFimDePartida`, porque emenda que só existe na fiação de
produção é emenda que nenhum teste alcança.

---

## 9. O que este plano deixa em aberto

1. ~~**Chat entre estranhos.**~~ **Resolvido em 02/09/2026** — RF-106, o "silenciar para mim".
   D-8 tirou o host da mesa de fila logo depois de RF-095 lhe ter dado o poder de calar, e sobrava
   uma sala onde ninguém cala ninguém. A resposta é local e não passa pelo servidor: a mensagem
   continua chegando e continua sendo entregue a todo mundo, e só a minha tela deixa de mostrá-la.
   Não exige autoridade nenhuma porque não decide nada sobre ninguém. Mandá-la ao servidor traria o
   pior de dois mundos: uma lista de quem-não-gosta-de-quem guardada em algum lugar, e a chance de
   a outra pessoa descobrir. Denúncia continua fora.
2. **Smurf e farm de conta.** D-1 deixa a fila normal sem conta, e criar conta é de graça. Nada
   neste plano impede alguém de fazer contas novas para jogar contra gente pior. Mitigação barata:
   o `K` alto das dez primeiras partidas faz a conta nova subir rápido para onde ela pertence.
   Mitigação cara: exigir e-mail confirmado na ranqueada — que reabre a decisão D-5 do plano 01.
3. **Fila vazia.** Quatro pessoas é um mínimo alto para um jogo que ainda não tem público. Uma fila
   que nunca forma mesa é pior que fila nenhuma, porque ensina que não funciona. Antes da F3 é
   preciso decidir o que a tela diz quando não há ninguém — e a resposta honesta talvez seja
   oferecer a sala privada ali mesmo.
4. **Duas filas dividem o público pela metade.** Normal e ranqueada competem pelas mesmas pessoas.
   Vale considerar abrir só a normal primeiro e ligar a ranqueada quando houver gente para as duas.
5. **Temporada e decay** (D-12), e **fator de adversário no elo** (D-11). Os dois foram desenhados
   para caber depois sem migração.
