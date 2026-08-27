# Handoff

Estado do projeto para retomar depois.

**O jogo está no ar, jogável, em <https://fdp.imp-software.cloud>.**

Última sessão: 27/08/2026. O **plano 01 foi entregue inteiro** — contas por
e-mail e senha, SSO com Google e GitHub, histórico de partidas, perfil público
e avatar por imagem, tudo no ar. Antes dele, na mesma leva: identidade única na
mesa, a vaza acontecendo no centro com pausa para ver quem levou, balões saindo
do jogador e o fim de partida com nota de desempenho.

**Leia primeiro "O jogo estava fora do ar sem parecer".** O cliente mandava a
versão errada do protocolo e todo comando era recusado — o jogo esteve
inteiramente quebrado em produção por um período, parecendo um erro qualquer.
Corrigido e no ar em `e2d5607`.

Produção responde `protocolVersion: 2`, `contas: true` e `/api/sso` com os dois
provedores. As seções por assunto abaixo estão em ordem cronológica; a mais
recente é a última.

## Como rodar

```bash
npm install
npm run build:client   # OBRIGATÓRIO antes do primeiro `npm start`
npm run redis          # opcional, noutro terminal
npm run minio          # opcional: o outro lado do depósito de avatares (R2)
npm start              # http://localhost:3000
npm test               # 610 testes (3 pulados: Redis, Postgres e R2 — só rodam com as env deles)
npm run auditoria      # o que `docs/` promete e nenhum teste cobre
npm run typecheck
```

**A armadilha nova:** o servidor serve o cliente de `app/build/`, que é gerado
pelo Vite e não vive no git. Sem `npm run build:client`, `npm start` sobe e a
raiz devolve 500 sem causa aparente no log. O CI roda esse passo antes dos
testes pelo mesmo motivo — a suíte de HTTP lê o `index.html` de lá.

Para mexer na interface com recarga automática, `npm run dev:client` em paralelo
com `npm start`: o Vite serve a UI em 5173 e repassa `/api` para o processo real.

Para jogar sozinho, o caminho curto é **sentar bots pelo lobby**. Para exercitar
várias conexões de verdade, 2 ou 3 abas anônimas.

Para parar: `pkill -f "tsx server"`.

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `FDP_SESSION_SECRET` | Segredo do JWT. **Obrigatório em produção**; em dev, gera um efêmero e avisa |
| `REDIS_URL` | Sem ela, store em memória |
| `ALLOWED_ORIGIN` | CORS e checagem de `Origin` no upgrade. Ausente = só mesma origem |
| `TRUST_PROXY=1` | Ler o IP de `X-Forwarded-For`. Ligar **só** atrás do Caddy |
| `PORT`, `FDP_VERSION` | Porta e sha exposto em `/api/health` |

## O que está pronto

| Pacote | O quê |
|---|---|
| `packages/rules` | Motor de regras puro e determinístico. 113 regras `RJ-###` |
| `packages/bot` | Decisão dos bots — puro, só depende de `rules`. As quatro dificuldades |
| `packages/store` | `RoomStore` de 6 métodos, em memória **e em Redis**, mesma suíte de contrato |
| `packages/contas` | Contas, credenciais, identidades de SSO e histórico — memória **e Postgres**, mesma suíte |
| `packages/avatares` | Depósito das fotos — disco **e R2**, mesma suíte. Mais cache, migração e escrita dupla |
| `packages/protocol` | Contrato cliente ↔ servidor, tipos e validação separados |
| `packages/room` | Máquina de sala: ciclo de vida, conexão, pausa, timers, auto-play, bots, sucessão de host |
| `server/` | HTTP de `06`, WebSocket de `05`, sessão, limites, persistência, `SIGTERM` |
| `app/` | Cliente Vite + React com o design system Nocturne |

Chat (RF-017) implementado contra CA-330 a CA-341, incluindo a garantia que
protege a mecânica: `EV-040` sai idêntico para todos, com exatamente cinco
campos e nada derivado da partida (CA-338).

## O que ainda é provisório

Nada estrutural. O que segue é o único ponto onde o cliente não é completo, e é
por escolha.

Os **redutores por evento** de `11` §6 estão em
[`app/src/state/redutores.ts`](app/src/state/redutores.ts), ligados ao
reconciliador de `05` §3 que já existia. Cada redutor devolve o estado novo ou
`null` — "não sei montar isto" —, e `null` termina onde tudo terminava antes:
pedindo o retrato. **84% dos eventos reduzidos** numa partida completa (CA-342).

Os 16% que sobram são as fronteiras de rodada e de partida. Reconstruí-las
exigiria carregar no evento praticamente o retrato inteiro — a essa altura,
pedir o retrato é mais honesto que fingir que não se está pedindo.

## Verificado funcionando

**No navegador, em 360 px**

- Fluxo inteiro: home → perfil → lobby → partida → fim → sair.
- Rodada de testa: cada um vê as cartas dos outros e um verso no próprio lugar.
  Conferido no DOM vivo — sem valor em atributo, sem nó escondido, sem `data-*`.
- Aposta proibida desabilitada, marcada, com a razão escrita ao lado.
- Nada rola na horizontal, nenhum assento colide com a mesa cheia, nenhum alvo
  de toque abaixo de 44×44.
- Modal de sessão em outra aba exercitado abrindo a segunda aba de verdade; o
  "Jogar aqui" traz a mesa de volta.
- Log da partida sobrevive a recarregar a página no meio da rodada — ele é
  montado do retrato do servidor, não de eventos acumulados no cliente.

**Contra Redis de verdade**

- Partida completa entre 3 conexões pelo protocolo, com vencedor correto.
- A suíte de contrato do `RoomStore` passa igual em memória e em Redis.

**CA-046 em produção (25/08/2026)** — três conexões reais em
`fdp.imp-software.cloud`, `docker restart fdp-api` no meio da rodada 2:

| Medida | Resultado |
|---|---|
| Janela de indisponibilidade | 1.904 ms |
| Reconexão de cada cliente | 607–635 ms |
| `matchId` e rodada | iguais antes e depois |
| Status | `EM_PARTIDA` o tempo todo, nunca `PAUSADA` |

Não podia nem chegar a pausar: `TRANSPORT_GRACE` é 10 s e ninguém ficou fora
mais de 635 ms.

## A mesa, depois dos ajustes de 25/08/2026

Cinco mudanças pedidas pelo usuário. **As três primeiras eram requisitos de
`07` que nunca tinham sido implementados**, não funcionalidades novas — e a
primeira não era cosmética.

### `RECOLHIMENTO`: uma fase nova no motor

O motor fechava a vaza e abria a seguinte **no mesmo passo**. Não existia
instante nenhum em que a mesa mostrasse quem levou. `07` §2.4 sempre pediu de
1,5 a 3 s com a carta vencedora à vista.

Fazer isso no cliente seria mentira: com a vaza seguinte já aberta no servidor,
um bot joga em 900 ms e a tela mostraria uma disputa encerrada. Virou fase
automática de verdade (`03` §4.2), de 1,8 s — 1,5 s parado mais 300 ms de
viagem das cartas até o vencedor.

Detalhes que valem lembrar:

- **A vaza fechada vive só em `resolvedTricks`.** Deixá-la também em
  `currentTrick`, para o cliente ter onde ler, contaria as cartas duas vezes e
  quebraria INV-03.
- **A última vaza da rodada também passa por aqui.** Ia direto ao acerto de
  contas e era a única do jogo cujo resultado ninguém via.
- **A rodada de testa fica de fora**: lá as cartas estão nas testas, não na
  mesa, e quem mostra o resultado é `REVELACAO`.
- Cobrado por CA-346 e CA-347. Sem o prazo no relógio da sala, o próximo
  despertar da mesa cai em `ROOM_MAX_LIFE` e a partida fica parada **quatro
  horas** — o teste mede isso.

### As cartas no centro, e o limite que as tinha afastado de lá

O código prendia a carta ao assento com um comentário dizendo que o centro
cobre nomes e placar com 8 jogadores. **Medi: estava certo** — duas cartas
invadiam os assentos laterais.

A saída não foi desistir do centro. O contador da rodada subiu para o
cabeçalho, a vaza ficou confinada à faixa entre os assentos (`67% − 104px`,
~137 px em 360), e a carta encolhe para `mini` quando passa de 4 na mesa.
Remedido com 8: **zero colisões, sem rolagem horizontal**.

O destaque de quem está ganhando usa `trickStanding`, **a mesma função do
motor** — reimplementá-la no cliente seria pedir para as duas divergirem no
empate em cascata de `EMPATE_ANULA_CARTAS`, que é o caso mais difícil de
perceber.

### Vocabulário: a tela diz "mão"

O que `docs/` chama de **vaza**, a interface chama de **"mão"**. E o que era "a
mão do jogador" virou **"suas cartas"** — a palavra foi ocupada pela disputa, e
sem essa segunda troca a mesma tela usaria o mesmo nome para duas coisas.

`docs/` e o código seguem em "vaza", registrado em `01` e `07`. São 113 regras
`RJ-###` com ID estável mais `Trick`/`tricksWon`/`trickNumber` em quatro
pacotes; renomear a espinha do projeto não mudaria nada que o jogador vê.

### Balões, log de vidas e o resumo do fim

- **Balões saem do assento** de quem falou no chat ou perdeu vida, e os
  corações debitados caem do próprio contador. O débito de vida não tinha sinal
  nenhum antes — o número mudava sozinho, no momento de maior carga da partida.
- **Log de vidas perdidas** embaixo do chat, por rodada, saindo de `history`:
  sobrevive a recarregar a página.
- **Fim de partida** com aposta contra mãos feitas, quem saiu em cada rodada, e
  **nota de desempenho de 0 a 10**.

### A nota de desempenho (`app/src/desempenho.ts`)

Responde outra pergunta que não o placar: **quem jogou melhor**. Pontaria 45%,
acertos em cheio 30%, sobrevivência 25%. Vencer garante o piso da faixa
excelente.

**O piso é 8, e não 9, por medição e não por gosto.** Com 9, o cenário que
motivou a nota — o segundo colocado que acerta tudo e desaba na última rodada —
chega a 8,1 e nunca passaria do vencedor mais sofrível. O piso precisa caber
dentro do alcance de quem jogou bem e perdeu, senão "vencer não garante a maior
nota" vira letra morta. A fronteira da faixa excelente acompanha o piso.

Rodada abortada não entra na conta de ninguém, nem no numerador nem no
denominador (RJ-155). As quatro cores da nota têm teste de contraste, e cada
faixa carrega a palavra junto — cor nunca é o único canal (RNF-031).

## Identidade na mesa (26/08/2026)

Apelido, emoji e **cor** são únicos dentro da sala — `04` §2 exigia só que o *par*
`(emoji, cor)` fosse único, e não bastava: a cor é o canal principal de identificação
(`07` §4), e dois jogadores de cor igual já são parecidos demais a 360 px.

A regra morava em **três lugares com três implementações** — entrada pelo HTTP, criação de
bot, e nenhuma na edição de perfil. A que faltava era a que valia: bastava abrir o perfil no
lobby para a mesa ter dois "Ana" da mesma cor. Agora é uma só, em
[`packages/room/src/identidade.ts`](packages/room/src/identidade.ts), e a garantia é da
**sala** — não da fronteira HTTP, que é por onde ela escapava.

Os dois caminhos tratam colisão de formas diferentes, de propósito: a **entrada** desempata
sozinha e deixa entrar (CA-006 — quem chegou depois não escolheu colidir), a **edição** recusa
com motivo (a escolha é deliberada e a tela mostra o que está tomado). Cobrado por CA-374 e
CA-375.

A conta fecha: 8 cores para 8 assentos, 24 emojis para no máximo 12 pessoas. Com mais gente
que cor — jogadores mais espectadores —, a cor repete e o emoji único é o que ainda garante o
par de `04` §2.

## Deploy

**Automático.** Push na `main` → CI → imagem no GHCR → `~/bin/deploy.sh fdp <sha>`
na VPS por SSH. O `deploy.sh` é compartilhado com coda, kindred e
expense-analyzer: põe o repositório no mesmo commit da imagem, confere que os
containers rodam a tag pedida, verifica pela URL pública e **reverte sozinho** se
falhar.

A VPS **não é uma máquina vazia** — hospeda outros três apps, com Caddy em
container segurando 80/443 e Grafana Alloy coletando. Detalhes, incluindo a
observabilidade e o que ainda falta nela, em [`deploy/README.md`](deploy/README.md).

## O design

Canvas do Claude Design, tema escuro, design system **Nocturne**, com a paleta
já corrigida: <https://claude.ai/code/artifact/f5dffc3b-96b6-405d-a8aa-bca500cf6ddb>

A fonte editável vive em [`design/Main.dc.html`](design/Main.dc.html) — é dela
que sai qualquer atualização do canvas. Para republicar, semeie e publique pelo
`/design`; o arquivo gerado é saída de build e está no `.gitignore`.

**Dois links antigos continuam circulando e nenhum dos dois se atualiza daqui**,
porque são renders estáticos e não canvas editáveis:
`555d5b00-…` (original, de outra conta) e `1f515ea6-…` (cópia publicada, ainda
com a paleta velha e com o título errado, "Poker site elegante e moderno").
Use o link de cima.

**A interface implementada é fiel ao canvas**, com duas divergências
deliberadas, ambas comentadas no código:

- **Os assentos não seguem ângulo em elipse.** Com 8 jogadores os cartões se
  atropelam e vazam dos 360 px, e nenhum ajuste de raio resolve — o limite é
  largura de cartão contra largura de tela. Vale o arranjo do design: até 3 em
  cima, o resto nas laterais, você na base.
- **A carta de testa fica no assento; a carta jogada, no centro.** O canvas
  desenha as duas na mesa. A de testa está na cabeça da pessoa, e é do assento
  que ela fala; na revelação ela também vai para o centro, e o assento esvazia.

**Três erros do design, conferidos contra `docs/` e NÃO implementados:** trunfo
(não existe no FDP), "naipe da vaza" (RJ-022: naipe não tem efeito algum) e —
este sim implementado, por decisão posterior — o chat. Os dois primeiros eram
falha do meu brief, que já foi corrigido.

### O quarto erro: a paleta de avatares (corrigido em 25/08/2026)

O canvas afirmava que a menor distância entre dois avatares era **ΔE 21,8 nas
três condições**, por simulação Viénot 1999. Recalculando: a simulação de
**protanopia** batia com a minha até a terceira casa, a de **deuteranopia** não
batia de jeito nenhum. Quando duas condições usam o mesmo método e só uma
diverge, o erro está na que diverge — e as saídas dela eram fisicamente
implausíveis (`teal` virando roxo, `lime` virando cinza-terroso; sob
deuteranopia verde e vermelho convergem para amarelo).

O valor real era **ΔE2000 2,0** entre `lime` e `orange` sob deuteranopia: a
mesma cor. A paleta tinha sido otimizada contra uma simulação com bug, então a
otimização não entregou o que anunciava. O `21,8` também era ΔE76, não
CIEDE2000 — ΔE76 exagera diferença exatamente nos amarelos e azuis saturados
onde uma paleta de avatares vive.

`lime` passou de `#4ebf00` para `#6cd317`: mínimo de 2,0 → **7,5**, com desvio
visual de ΔE 5,7 (continua claramente verde). Reotimizar as oito chegaria a
10,9, mas moveria cinco cores e transformaria o `lime` num sálvia que não é mais
lime — não valia a identidade visual.

A afirmação de contraste ("todas passam de 5,4:1") também era falsa: seis das
oito ficam abaixo disso contra o feltro claro. Mas RNF-030 pede **3:1** para
elemento gráfico e todas passam — o requisito estava cumprido, era o número
auto-declarado que estava errado. O canvas agora traz os dois números certos.

**Por que isso não virou defeito visível:** `Avatar.tsx` sempre renderiza cor
**e** emoji. O segundo canal de RNF-031 segurou a mesa — e escondeu o erro.

## Decisões que valem lembrar

- **`docs/` é a fonte da verdade.** Requisito sem teste que cite seu ID é
  requisito não entregue.
- **Chat e bots entraram no escopo depois** (P9 e P10 em `docs/00` §5),
  revertendo exclusões da v1. A decisão está registrada no documento, não só no
  código.
- **O bot não pode trapacear por construção**: `packages/bot` recebe a mesma
  `PlayerView` que um humano. A informação que ele não deve ver não chega até
  lá, então não há disciplina a manter (CA-325). O que separa um nível do outro
  não é acesso a informação, é **quanto do que está à vista ele usa** —
  `leitura.ts` é a camada onde isso mora.
- **A escada de dificuldade é medida em torneio, não afirmada** (CA-348). A
  primeira versão do realista PERDIA do difícil, e foi o torneio que pegou: ele
  comparava a soma parcial das apostas contra a rodada inteira, e quem apostava
  cedo enxergava uma mesa vazia.
- **Mutação de sala não pode conter `await`** (`docs/11` §5).
- **Eventos com estado oculto saem já projetados, um por destinatário.**
- **Um `commit` incrementa `stateVersion` uma vez e pode emitir vários eventos.**
- **Os testes de propriedade acharam 3 bugs** que revisão de código não pegaria.
- **O quarto bug apareceu jogando, não testando**: a sala ficava presa em
  `EM_PARTIDA` depois de uma vitória. INV-05 estava certa no documento e mal
  traduzida no código — invariante mal traduzida é pior que ausente, porque dá
  sensação de cobertura.
- **Instrumento estrangulado parece defeito de código.** Passei um bom tempo
  concluindo que a animação de recolher não disparava, porque o navegador
  automatizado me dava 6 amostras em 26 segundos — a janela de 300 ms sumia
  entre duas leituras. O código estava certo desde o começo. Quando a medição
  discordar do raciocínio, **desconfie da medição primeiro**: a pista aqui era
  a taxa de amostragem absurda, visível o tempo todo e ignorada.
- **Cronômetro de cliente não sabe quando a fase começou.** A primeira versão
  da viagem das cartas contava a partir de quando o cliente via a mudança de
  fase — e erra por latência, pela granularidade de 250 ms do relógio da sala,
  e por qualquer resync no meio. O certo é contar **de trás para frente a
  partir de `phaseDeadline`**, que é o instante exato em que o servidor vai
  agir. Virou `esperaAteViajar`, com teste.
- **Número tranquilizador é onde a verificação para.** A checagem de daltonismo
  da paleta foi feita de verdade, e errada, e passou por dois agentes e uma
  revisão porque vinha com um `ΔE 21,8` do lado. Ninguém confere um número que
  já parece bom — e `08` §5 a tratava como checagem manual, que é a que só roda
  quando alguém lembra. Virou CA-344, com duas aferições da própria simulação:
  cinza não pode mudar sob dicromacia, e vermelho contra verde **precisa**
  colapsar sob deuteranopia. Sem elas, uma simulação quebrada aprova a paleta
  por acidente — que foi exatamente o que aconteceu.
- **Duas listas enumeradas envelheceram em silêncio nesta sessão**, ambas
  derrubando produção: o `Dockerfile` copiava `app/build` do contexto (funcionava
  na minha máquina, imagem sem cliente num checkout limpo) e enumerava os
  pacotes do workspace um a um (quebrou ao entrar o `@fdp/bot`). Lista enumerada
  de coisa que cresce envelhece sempre; a única questão é quando.
- **Saída de compilação dentro de `src/` faz a suíte rodar contra código velho,
  em silêncio.** Os imports são `'./room.js'` (convenção ESM do TypeScript), e
  com um `.js` de verdade ao lado do `.ts` o Vite resolve o COMPILADO. Havia 34
  desses arquivos, commitados sem ninguém notar, e por uma hora eu depurei um
  bug que não existia — o código estava certo e não era ele que rodava. Agora há
  trava no CI e no `.gitignore`. A pista que denuncia: uma alteração no fonte
  não muda o comportamento do teste, e um `console.log` no meio da função não
  imprime.
- **Licença MIT** foi escolha minha, não do usuário. Trocar se ele preferir.

## Segurança — incidente de 25/08/2026

A chave pessoal de acesso à VPS (`id_ed25519_vps`, com shell como `deploy` **e
como root**) foi colada num segredo do GitHub Actions de um repositório público.
Segredo de CI é lido por qualquer execução do workflow.

**Resolvido**: a chave foi rotacionada nas duas contas e não abre mais nada; no
lugar dela, `id_vps_2026` para acesso pessoal e uma chave dedicada
(`github-actions-fdp`) presa ao `deploy.sh` por forced command.

A lição operacional: `cat >> authorized_keys` é a forma frágil de acrescentar
chave. O arquivo do root não terminava em quebra de linha, e a chave nova foi
colada no fim da linha da antiga — o OpenSSH leu tudo como comentário, a antiga
continuou valendo e a nova era ignorada. Se a antiga tivesse sido removida
naquele momento, o acesso root estaria perdido. A forma robusta:

```bash
printf "\n%s\n" "$(cat chave.pub)" >> ~/.ssh/authorized_keys
```

## O jogo estava fora do ar sem parecer (26/08/2026)

**O cliente mandava `v: 1` em todo comando e o servidor exige 2 desde F2.**

`app/src/net/socket.ts` escrevia a versão à mão, desde o commit em que o cliente
nasceu. Quando as contas entraram e o protocolo virou 2, o servidor passou a
recusar **todo** comando desse cliente com `PROTOCOL_VERSION`.

O que faz este bug valer uma seção não é o campo — é como ele se escondeu:

- A sala continuava sendo criada, porque isso é HTTP.
- A tela desenhava inteira, o socket abria, o retrato chegava.
- Só os **comandos** morriam: sentar bot, começar partida, apostar, jogar
  carta, falar no chat. Tudo o que é o jogo.
- E o que aparecia era um `Não deu certo. Tente de novo.` vermelho — a frase
  genérica —, porque `PROTOCOL_VERSION` nem tinha tradução no cliente.

**CA-373 sempre cobriu isto pelo lado do servidor**: cliente em 1 contra
servidor em 2 é recusado com `ERR-426`. O teste passava. E enquanto passava, o
cliente de verdade era exatamente esse cliente em 1.

> Testar a REJEIÇÃO não testa o EMISSOR. CA-373 provava que um cliente errado
> seria recusado; ninguém perguntou se o nosso era o errado.

CA-387 (`app/test/socket.test.ts`) pergunta pelo emissor, com um WebSocket de
mentira que guarda o que foi enviado. E o `v` agora é `PROTOCOL_VERSION`
importado do mesmo módulo que o servidor valida — as duas pontas não têm mais
como discordar.

O erro também virou bloqueio de conexão (`DESATUALIZADO`, a tela que manda
recarregar) em vez de mais um aviso vermelho no rodapé. Versão de protocolo não
é erro de jogada: é o cliente inteiro velho demais, e nenhum comando depois dele
vai funcionar.

**Como foi achado:** não por teste, nem por relato — por tentar sentar um bot no
navegador enquanto verificava outra coisa. É o terceiro bug desta natureza
achado jogando (INV-05, a pausa de fim de vaza, este). A suíte E2E ausente
continua sendo a dívida que mais custa.

## Chat, balão e perfil (26/08/2026)

**RNF-016 — intervalo mínimo de 1 s entre mensagens da mesma pessoa.**
`docs/05` §7 argumentava que RNF-010 (20 comandos/10 s) bastava, porque quem
inunda o chat gasta o próprio direito de jogar. O argumento estava certo sobre o
abuso e errado sobre a tela: 2 mensagens por segundo não é ataque, é uma pessoa
animada, e mesmo assim enche o feltro de balões no meio de uma mão. Os dois
limites coexistem e medem coisas diferentes — RNF-010 protege o servidor de quem
automatiza, RNF-016 protege a mesa de quem conversa.

Dois detalhes não são cosméticos: é **por pessoa** (o silêncio de quem falou não
cala a mesa), e a tentativa **recusada não marca o relógio** — se marcasse, quem
insiste a cada 200 ms empurraria o próprio prazo e ficaria mudo para sempre.

O instante mora em `RoomPlayer.lastChatAt`, e não em memória do processo: um
contador local perderia a conta a cada reinício, e a primeira coisa que um deploy
faria seria liberar a rajada que o limite existe para conter. Sala gravada antes
do campo volta do Redis sem ele e é lida como "nunca falou".

**RF-079 — o balão compacta em 70 caracteres.** Uma mensagem no teto de RNF-014
(280) num balão de 132 px vira onze linhas saindo do assento por cima das cartas.
O balão avisa que fulano falou e dá o começo; o texto inteiro vive no painel do
chat, que é onde se lê. Corta no fim de uma palavra, e só recua até o espaço
enquanto sobrar mensagem — um link colado, que não tem espaço nenhum, não pode
virar reticências sozinhas.

**RF-078 — editar perfil na home.** O editor só existia dentro da sala, e isso
deixava a conta sem dono: apelido, cor, emoji e foto são da CONTA, e trocá-los
exigia estar numa mesa. A tela é a mesma (`Perfil`), com `rotulo` e `subtitulo`
próprios; logado, ela parte da identidade da conta — mesmo motivo de R-4 do
plano 01 §5.1, para o desempate de uma mesa não virar o nome permanente.

## Avatar: dois problemas, e o segundo não era o que parecia (26/08/2026)

Relato: *"parece que está tendo problemas ao subir imagens de avatar"*. Eram dois.

**RNF-017 — o envio gastava o orçamento de CADASTRO.** `limiteCadastro`, 10 por
hora **por IP**, compartilhado com `POST /api/contas`. Três coisas erradas de uma
vez: são 10 no total (trocar a foto algumas vezes derrubava o cadastro); o limite
é conferido **antes** da validação, então tentativa recusada também custava slot;
e é por IP, então uma república, um escritório ou um CGNAT de operadora dividem o
contador — quem descobria era o vizinho que nunca tentou nada. Reproduzido: 8º
envio deu 429, e criar conta do mesmo IP em seguida também. Agora tem orçamento
próprio, 30/h **por conta** — a rota exige sessão, então o dono é conhecido e não
há razão para cobrar de quem divide o endereço.

**CA-389 — HEIC, e a hipótese que quase virou um conserto pior.** HEIC é a foto
padrão do iPhone desde 2017, e caía em `NAO_E_IMAGEM` — a frase mais errada
possível, porque a pessoa está olhando para a imagem enquanto lê que não é uma.
A correção óbvia era aceitar a marca `ftyp`, e eu cheguei a escrevê-la.

**Não funciona.** O `sharp` empacotado traz libheif **sem decodificador de HEVC**:
AVIF (que é AV1) abre, HEIC (que é HEVC) não — HEVC é patenteado e não entra no
binário pronto. Medido com arquivo de verdade (`sips -s format heic`), não
deduzido da documentação: libvips responde `Decoder plugin generated an error`.
Aceitar os bytes teria trocado um erro claro por um confuso — *"não consegui
abrir essa imagem, ela pode estar corrompida"*.

Então HEIC é **reconhecido para ser recusado direito**: motivo próprio
(`HEIC_NAO_SUPORTADO`) e uma frase que diz o que fazer — mandar em JPEG,
Ajustes › Câmera › Formatos › "Mais compatível". Aceitar de verdade exige um
libvips com decodificador de HEVC, que é decisão de licença e de imagem de
container, não de código. **AVIF entra** (CA-388).

A lista de marcas é fechada contra vídeo: a mesma caixa `ftyp` embrulha MP4 e
MOV, e aceitar a caixa em vez das marcas abriria o decodificador para eles.

## O teto que recusava toda foto de celular (26/08/2026)

Depois dos dois consertos de avatar da seção anterior, o envio **continuava
falhando** — e desta vez para quase todo mundo.

`PIXELS_MAX` estava em 4096² = **16,7 MP**. iPhone 14 Pro em diante tira 48 MP;
Android de topo, 50, 108 ou 200 MP. A pessoa tirava a foto, escolhia o arquivo e
lia *"essa imagem tem pixels demais. Reduza antes de enviar"* — sobre a foto que
a câmera dela produz por padrão. Só 12 MP passava. O teto de bytes, 5 MB, era
apertado pelo mesmo motivo: um JPEG de 12 MP sai entre 3 e 8 MB.

O teto existia contra a bomba de descompressão, e a bomba é real. O problema é
que o número veio de uma conta ingênua — largura × altura × 4 bytes — que **não
descreve como o `libvips` funciona**. Medido:

| Entrada | Tempo | RSS |
|---|---|---|
| JPEG 108 MP (foto de 4 MB) | 95 ms | +9 MB |
| PNG chapado 64 MP (bomba) | 71 ms | +41 MB |
| PNG chapado 256 MP (bomba) | 249 ms | +45 MB |

O `libvips` processa em **tiles** e nunca segura o bitmap inteiro — 256 MP
custam 45 MB, não o gigabyte e meio da multiplicação. E o JPEG tem
**shrink-on-load**: pedindo 256 px de saída, o decodificador lê em escala
reduzida, e a foto de 108 MP sai **mais barata que a bomba de 64 MP**.

O teto quase não separava o caro do barato. Separava fotos reais de fotos reais.

> Um limite que existe para conter um ataque precisa ser medido contra o ataque
> **e** contra o uso legítimo. Este não foi medido contra nenhum dos dois.

Agora: 16 000² = 256 MP, 25 MB de bytes, e o teto de bytes mora em
`LIMITS.avatarBytesMax` — o cliente repetia "5 MB" em três lugares, e era assim
que ele ficaria para trás quando o servidor subisse.

### A bomba do teste agora é forjada, não gerada

O teste da bomba gerava uma imagem enorme de verdade. A primeira versão, 20 000²,
custava segundos de CPU e derrubou o CA-209 (§"Um teste derrubou o vizinho"). A
segunda, 8 000², era barata — e ficou **abaixo do teto novo**, então passou a
provar o contrário do que queria.

A terceira reescreve só a largura e a altura no **IHDR** de um PNG minúsculo,
refazendo o CRC do chunk. São 200 bytes declarando 400 MP, custa nada, e é mais
fiel ao ataque: quem monta uma bomba de descompressão está exatamente fabricando
um cabeçalho que promete mais do que entrega. O arquivo de testes de avatar
inteiro caiu para ~1 s.

Junto foi um teste de fronteira (16 001² recusado), para o dia em que alguém
mexer no número achando que ninguém está olhando.

## Plano 02 implementado: os avatares saem do volume (26/08/2026)

F1 a F4 do [plano 02](docs/plans/02-armazenamento-de-avatares.md) estão escritas
e testadas. **Nada foi implantado** — o que falta é operacional e só quem tem as
credenciais faz: criar o bucket, pôr as quatro variáveis no `.env` da VPS, rodar
a migração, e fechar RNF-019 restaurando o backup uma vez.

`packages/avatares` é o pacote novo, no mesmo molde de `store` e `contas`: uma
interface de três métodos, duas implementações (disco e R2), uma suíte de
contrato para as duas. Mais o cache, a migração e a escrita dupla.

### A assinatura é nossa, e a prova é um servidor de verdade

`@aws-sdk/client-s3` traria dezenas de pacotes para três verbos sem query nem
listagem, num projeto com oito dependências de produção. SigV4 são umas oitenta
linhas em `packages/avatares/src/assinatura.ts`.

Escrever assinatura à mão só se defende com prova, e a prova **não** é um vetor
colado num `expect`. Tentei: cheguei a escrever o teste com a assinatura do
`get-vanilla` e parei antes de rodar, porque o número teria vindo da minha
memória. A documentação da AWS publica o algoritmo inteiro mas substitui a
assinatura final por um marcador, e não há botocore nem AWS CLI nesta máquina.

A prova é a **suíte de contrato inteira contra MinIO**, que fala S3. Um vetor
confere um caso; um servidor confere o protocolo. Está no CI — subido por
`docker run` e não por `services:`, porque a imagem do MinIO exige o comando
`server /data` e `services:` não deixa passar comando. E é obrigatória: o passo
que já cobrava Redis e Postgres agora cobra `packages/avatares` também.

### O contrato pegou um bug meu antes de qualquer produção

O teste de gravações simultâneas do mesmo nome derrubou a primeira versão do
depósito em disco. O rascunho temporário levava o `pid` — e cinco gravações do
MESMO processo dividem o pid, então escreviam no mesmo arquivo, uma renomeava e
as outras estouravam. Duas fotos chegando juntas numa mesa de oito é o caso
comum, não corrida exótica.

Vale registrar porque é o argumento inteiro a favor da suíte de contrato: ela
não existe para provar que o R2 funciona. Existe para que a implementação
**simples** — a que todo mundo assume estar certa — seja cobrada igual.

### Bucket fora do ar não é culpa da foto

Enquanto a gravação vivia dentro do `try` do processamento, um depósito
inacessível saía como `FALHA_AO_PROCESSAR`: *"não consegui abrir essa imagem,
ela pode estar corrompida"*. A pessoa procuraria o defeito na própria foto,
trocaria de imagem, e a segunda falharia igual — mesma família do
`PROTOCOL_VERSION`, em que a mensagem mandava investigar o lugar errado.

Virou `DEPOSITO_INDISPONIVEL`, com **503 e não 4xx**: 4xx diria que o problema
está no que a pessoa mandou. Verificado ponta a ponta com o MinIO derrubado no
meio — o envio dá 503, criar sala e jogar seguem intactos, e o avatar já em
cache continua sendo servido.

### O que a migração faz de verdade

Copiar bytes seria um laço de três linhas. `server/src/migrar-avatares.ts`
existe pela **conferência**: o nome de cada objeto é o sha256 do conteúdo, então
dá para saber, arquivo por arquivo, se o guardado é o que diz ser. É a primeira
vez que os avatares em produção serão verificados, e é a segunda vez que a
escolha do hash como nome se paga.

Sem `--aplicar` ele não escreve nada e roda a conferência inteira — a informação
que interessa aparece antes de qualquer cópia. Corrupção **falha** o script de
propósito, mesmo com o resto tendo copiado: rodar de novo é inofensivo, porque a
migração é idempotente (verificado: segunda passada dá "já estavam: 6").

### A ordem do corte, que é fácil de errar

Pôr as variáveis do R2 **antes** de migrar faz o app ler de um bucket vazio, e
toda foto existente vira 404 até a cópia terminar. Migre primeiro, configure
depois. Está escrito no `docker-compose.prod.yml`, ao lado das variáveis.

O volume `avatares` **continua montado** depois do corte: é de onde a migração
lê, e é a rede de segurança até o primeiro backup do bucket ser restaurado para
valer. Só sai quando RNF-019 fechar.

## Espectador, chat lateral e cartas na mão (26/08/2026)

Quatro mudanças pedidas, e uma quinta que apareceu no caminho e valia mais que
as outras.

**RF-086 — chat na lateral em tela larga.** A casca de 460 px abre para 900 **só
na mesa**, e o corte é do CSS: a mesma árvore de componentes serve os dois
casos, nada é montado duas vezes, girar o aparelho não perde estado. O único
`matchMedia` (`app/src/telaLarga.ts`) decide se o painel começa aberto — na
lateral, fechado seria uma coluna vazia; no celular, aberto empurra a mão de
cartas para fora da tela. Abaixo de 900 px **nada muda**, que era o pedido.

**RF-085 — cartas viradas sob o coração.** `handCounts` já vinha na projeção e
era público (RJ-102), e não estava em lugar nenhum: quem quisesse saber quantas
cartas restavam ao adversário contava as mãos jogadas de cabeça. Viradas porque
o conteúdo é segredo; do tamanho do coração porque aquela linha do assento é uma
linha de contadores. Acima de cinco vira `verso ×N`, igual às vidas.

**RJ-159 — quem assiste vê a mão de todos.** É uma exceção deliberada a RJ-102,
e o recorte é "quem joga": o segredo existe para proteger DECISÃO, e espectador
não aposta nem joga. Para quem joga, `allHands` sai **vazio** do servidor — não
é a tela que esconde, que seria batota disponível no console. O risco de ele
contar no chat é aceito e nomeado (moderação, não projeção).

Não vai nos assentos: eles têm 84 px e uma carta `mini` tem 30. Um painel
próprio (`Plateia.tsx`) abaixo do feltro, com o feltro **idêntico** ao de quem
joga — se as cartas aparecessem nos assentos, jogador e espectador estariam
olhando para duas mesas diferentes.

**RF-083/084 — entrar e sair da mesa no lobby, e a marca no chat.** Só no lobby:
com partida em curso, sair é abandono (tem caminho próprio) e entrar é RF-014.
A marca `spectator` é congelada no envio como o apelido — quem falou de fora e
depois sentou não pode ter o que disse reescrito.

Isso obrigou a emendar **CA-338**, que trava o payload do chat numa lista
fechada. A pergunta que o critério faz é a única que importa: o campo revela
algo da PARTIDA que o destinatário já não soubesse? Não — quem está sentado e
quem assiste já é público em `room.players`. A lista continua fechada.

### A quinta: a mesma regra escrita em dois lugares

Testando RF-083 no navegador, o host virou espectador e a mesa foi parar nas
mãos do **Bot Ada**. Bot não aperta botão: a sala fica viva, com gente dentro, e
sem nenhum caminho para começar a partida.

Consertei `succeedHost` em `room.ts` para nunca entregar a mesa a um bot,
escrevi teste, vi passar — **e a sala continuou caindo para o bot no
navegador**. Havia uma segunda cópia: `ensureHost`, em `tick.ts`, rodando por
relógio em vez de por comando. Duas implementações da mesma regra, escritas
separadas, envelhecidas separadas.

Foi o teste da SEQUÊNCIA inteira que pegou — assistir, sentar, jogar, cair —, e
não os testes de cada passo, que passavam todos. Cada caminho isolado parecia
correto; o que estava errado era haver dois.

> Regra duplicada não é redundância: é uma regra que só vale onde alguém lembrou
> de mantê-la. É o terceiro caso neste projeto (identidade única tinha três
> cópias, a sucessão de host tinha duas), e o padrão é sempre o mesmo — o
> conserto vai para a cópia que a pessoa está lendo, e a outra continua lá.

Agora é `packages/room/src/anfitriao.ts`, uma função, e os dois chamam. A regra:
**gente, e de preferência sentada**; sem candidato humano, o host não muda.
Espectador entra como último recurso — dessa situação alguém se senta e a sala
volta a andar, o que é melhor que host nenhum (RF-013).

E junto veio **CA-400**: `maxBots = maxPlayers − 1` existia para uma mesa nunca
ser só de bots, e essa aritmética parou de bastar quando o humano pôde sair da
mesa sem sair da sala. Dois bots sentados e a única pessoa assistindo passavam
nas duas contagens, e a partida começaria sem ninguém para jogá-la.

## Avatares: por que nunca funcionaram em produção (26/08/2026)

**O volume era montado como `root` e o processo roda como `node`.** Toda
gravação de foto morria com `EACCES`, desde sempre.

O `Dockerfile` tem `USER node`, e o `docker-compose.prod.yml` monta um volume
nomeado em `/var/lib/fdp/avatares` — um caminho que **não existia na imagem**.
Quando o caminho não existe, o Docker o cria como `root:root 0755`, e o usuário
`node` não escreve nele. Reproduzido em três linhas:

```
docker run --rm -v v:/var/lib/fdp/avatares node:24-alpine \
  sh -c 'ls -ld /var/lib/fdp/avatares; su node -s /bin/sh -c "touch /var/lib/fdp/avatares/x"'
# drwxr-xr-x root root
# touch: Permission denied
```

### O que fez isso durar semanas

A gravação vivia **dentro do `try` do processamento de imagem**, e o `catch`
traduzia tudo para `FALHA_AO_PROCESSAR` — cuja frase é *"não consegui abrir
essa imagem, ela pode estar corrompida"*.

Quem enviava lia isso, olhava para a própria foto, trocava de imagem, e a
segunda falhava igual. Eu passei a sessão inteira investigando o lado errado:
achei e consertei o orçamento de cadastro sendo gasto pelo avatar, achei e
consertei o teto de pixels que recusava toda câmera moderna — os dois eram
defeitos reais, e nenhum dos dois era ESTE.

> A mensagem de erro decidiu onde três pessoas procuraram, e ela apontava para o
> lugar errado. Separar "não consegui ler o que você mandou" de "não consegui
> guardar o que produzi" não é organização de código: é a diferença entre o
> usuário investigar o arquivo dele e nós investigarmos a nossa infraestrutura.

Foi só depois de `DEPOSITO_INDISPONIVEL` existir (plano 02) que a frase certa
apareceu na tela e o problema ficou localizável em minutos.

### Os dois consertos

**No `Dockerfile`**, antes de `USER node`:

```
RUN mkdir -p /var/lib/fdp/avatares && chown -R node:node /var/lib/fdp
```

O Docker semeia a dona do diretório da imagem num volume **vazio** — então isto
conserta o volume que já está na VPS, justamente porque ele está vazio (nenhuma
gravação jamais deu certo). Medido nos três casos:

| Volume | Depois do conserto |
|---|---|
| Novo | `node:node`, grava |
| Já existe, **vazio** | `node:node`, grava |
| Já existe, **com conteúdo** | continua `root`, **não** grava |

Se um dia houver conteúdo lá dentro, o conserto da imagem não alcança e é
preciso, na VPS:

```
docker compose -f docker-compose.prod.yml down
docker run --rm -v fdp_avatares:/v alpine chown -R 1000:1000 /v
docker compose -f docker-compose.prod.yml up -d
```

**RNF-020 — a sonda de escrita.** Na subida, o servidor grava, lê, confere e
apaga um objeto de teste, e diz no log o que aconteceu. Não é fatal: jogar não
depende de foto (I-1), e derrubar o processo por um diretório tiraria do ar um
jogo que funciona.

```
avatares: o depósito aceita gravar
```
ou
```
avatares: O DEPÓSITO NÃO ACEITA GUARDAR — o envio de foto vai falhar.
  Error: EACCES: permission denied, open '/var/lib/fdp/avatares/....tmp'
  Em produção isto costuma ser o volume montado como root com o processo
  rodando como `node`.
```

O defeito esteve **a um `touch` de distância de ser descoberto** por semanas. O
que faltava era alguém dar o `touch` — e ninguém dá, se ninguém escreveu que
alguém deveria. Agora o processo dá, toda vez que sobe.

### Verificado na imagem de produção, e depois em produção

Construí a imagem, montei um volume `root` vazio igual ao da VPS, subi o
container e enviei a foto de 48 MP: gravou como `node:node`, serviu de volta, e
o hash saiu **idêntico** ao produzido no macOS — o `sharp` do Alpine/musl dá o
mesmo byte, que era a única incerteza que restava sobre o teto de pixels.

**Confirmado em produção por envio real em 27/08/2026.** O envio de avatar
funciona, e é a primeira vez que isso é verdade desde que a funcionalidade
existe.

### Antes de dizer "a documentação está em dia"

`npm run auditoria` mede a distância entre os critérios de `docs/10` e os testes
que citam cada ID. Existe porque essa frase foi dita de memória mais de uma vez
neste projeto, e de memória ela é sempre otimista.

Nesta sessão a auditoria pegou seis coisas que eu teria jurado estarem certas:
`player:setSpectator`, `host:addBot` e `host:removeBot` **não estavam na tabela
de comandos de `05`**; `ChatMessage.spectator` não estava em `04`; e RF-081 e
RNF-018 tinham sido escritos sem nenhum critério que os citasse.

O script **não** falha o build. A dívida é grande demais para virar portão da
noite para o dia, e um portão que dói demais é um portão que alguém desliga. Ele
serve para o número ser lido, não lembrado.

## O espectador que reiniciava a partida (27/08/2026)

**Um espectador saindo da sala abortava a rodada em curso e mandava todo mundo
de volta para `DISTRIBUICAO`.** Relatado como "a partida volta pro início", e
era exatamente isso.

A causa estava em `isActive` (`@fdp/rules`), que perguntava duas coisas:

```ts
!eliminated.includes(id) && !withdrawn.includes(id)
```

Quem **nunca esteve** na partida não está em nenhuma das duas listas, então
passava nas duas e voltava `true`. `leave()` pergunta exatamente isso para
aplicar a retirada de RJ-154 — a resposta vinha "sim, estava jogando" para
alguém que só assistia, e a rodada era abortada.

> `activePlayers` nunca sofreu, porque filtra `playerOrder` **antes** de
> perguntar. É o que escondeu o defeito por tanto tempo: por dentro a função
> parecia certa, e cada chamador que não filtrava antes carregava o buraco
> sozinho. O conserto foi acrescentar a membresia à própria `isActive` — o que o
> nome sempre prometeu — em vez de remendar `leave()`.

Dois outros chamadores melhoraram junto, e nenhum dos dois tinha sintoma
conhecido: `applyMove` passa a recusar a jogada de quem não está na partida
(`JOGADOR_INATIVO`) em vez de deixá-la seguir para as checagens de fase, e
`withdrawPlayers` deixa de gravar uma retirada com `livesAtWithdrawal:
undefined` para um id que não tem vidas.

O teste vive nos **dois** níveis: CA-406 na raiz, e CA-407 no sintoma — porque
foi pelo sintoma que ele apareceu, e é pelo sintoma que alguém vai reconhecê-lo
se voltar.

### Junto, três do espectador na tela

**RF-087 — a mensagem de quem assiste não vira balão.** Não é moderação, é
geometria: o balão sai de um assento, e quem assiste não tem assento. O dele ia
parar no meio do feltro, por cima das cartas, e no momento em que quem assiste
mais fala. A mensagem continua no chat, com a marca de RF-084.

**RF-088 — contador de plateia no cabeçalho**, com os nomes ao passar o mouse ou
tocar. É a outra metade de RJ-159: quem joga precisa saber que há gente vendo
todas as cartas sem ter de abrir o chat e reparar numa etiqueta. Fecha ao tocar
fora e no Esc, porque no celular não existe tirar o mouse de cima.

**RF-089 — o painel separa o que está na mão do que já foi jogado.** RJ-159
respondia metade da pergunta: `allHands` traz só o que **resta**, porque o motor
tira a carta da mão no instante em que ela é jogada. Numa rodada de 6 cartas, na
terceira mão, quem assiste está justamente tentando lembrar o que saiu.

As jogadas **já chegavam** ao espectador, em `resolvedTricks` e `currentTrick`,
que são públicos (RJ-066). Não faltava dado no servidor — faltava juntar os dois
lados. Montei no cliente (`app/src/plateia.ts`) em vez de mandar a mão original:
um campo novo na projeção é superfície nova por onde uma carta pode vazar.

A distinção não é só opacidade — há separador e o número da mão em que cada
carta saiu. Sem o número, as jogadas viram um monte indistinto assim que passam
de duas. E a dedupe por id de carta não é zelo: entre resolver a mão e recolhê-la
(fase `RECOLHIMENTO`) a mesma vaza aparece nos dois lugares, e contada em dobro
ela sugeriria uma carta que nunca existiu.

## O histórico não parava em 10, mas parecia (27/08/2026)

Relatado como "o histórico de partidas só tá limitado a 10 itens?". A resposta
curta é **não** — e a impressão era culpa nossa.

Nada é apagado. O Postgres guarda todas as partidas, `resumoDaConta` sempre
contou a vida inteira (`count(*)`), e o `10` era um argumento na rota do perfil:
`porConta(conta.id, { limite: 10 })`. O repositório nem tinha o teto — o padrão
dele era 20.

O que faltava era **a página seguinte**. Quem jogou 40 partidas via as 10
últimas e nenhum caminho para o resto, e isso se lê exatamente como "só guarda
10". A tela mostrava dez linhas sem dizer dez **de quantas**.

Agora: `porConta` aceita `pular`, a rota aceita `?pular=&limite=` com teto de 50,
a resposta traz `pagina.temMais`, e a tela diz **"10 de 40"** com um botão de
ver mais. A frase "10 de 40" é o que desfaz a impressão antes mesmo de alguém
clicar.

**O desempate pelo `id` no `ORDER BY` não é enfeite.** Duas partidas podem
terminar no mesmo milissegundo — duas mesas acabam juntas —, e uma ordenação só
por tempo deixa o banco livre para trocá-las de lugar entre uma página e a
seguinte: a paginação repete uma e engole a outra. As duas implementações
(memória e Postgres) desempatam igual, e CA-411 cobra isso com duas partidas no
mesmo instante de propósito.

### E o perfil só existia dentro da mesa

O único caminho até o próprio perfil era **pelo assento**, na partida. Assento é
de quem está jogando: quem não estava numa mesa não tinha como ver o próprio
histórico. Agora há **meu perfil** na home (RF-091).

Ao ligar isso apareceu um defeito que nem typecheck nem teste unitário pegam,
porque nada estava errado — só ausente: a sobreposição do `PerfilPublico` era
renderizada **só no ramo de dentro da sala** do `App`. O botão na home mudava o
estado e nada na árvore daquele ramo olhava para ele. Virou `FolhaDePerfil`,
usada nos dois ramos.

## O backup do Postgres não saía da máquina (27/08/2026)

Ao preparar o bucket dos avatares, olhei o `backup-postgres.sh` e ele grava em
`~/backups/fdp` na própria VPS e apaga o que passa de 14 dias. **Nada sai da
máquina.**

O backup em si é bom: roda todo dia às 06:00 UTC, o `pg_dump` acontece dentro do
container, e a restauração foi exercitada de verdade em 26/08/2026. O que faltava
era a cópia fora — e um backup no mesmo disco do banco protege contra `DROP
TABLE` e contra mais nada. Disco perdido, máquina trocada ou provedor com
problema levam os dois juntos, que é exatamente quando alguém vai procurá-lo.

> Vale registrar o erro de leitura que eu mesmo cometi: repeti várias vezes
> nesta sessão que "o Postgres tem backup e os avatares não". Estava incompleto.
> O Postgres tinha **dump diário verificado**, que não é a mesma coisa que
> **backup fora da máquina** — e a diferença só aparece no cenário em que o
> backup importa.

Agora `backup-postgres.sh` manda a cópia para o R2 quando `R2_BUCKET` está
definido (RNF-021). Opcional como o SSO: sem as variáveis, o backup local roda
igual e o script não falha.

Três decisões que valem explicação:

- **Falha no envio não derruba o backup local**, que já está gravado e conferido
  — mas o script **sai com erro**, para o `com-alerta.sh` avisar. Um backup que
  deixou de sair da máquina em silêncio é o pior dos dois mundos.
- **Só o local é descartado por idade.** A retenção do que está no bucket vive
  no R2, que é onde ela deve viver: apagar remoto a partir daqui exigiria listar
  o bucket, e um erro nessa listagem apagaria o que se quer guardar.
- **O envio confere o objeto com um `HEAD`**, e não só o `200` do `PUT`. Um
  `200` diz que o servidor aceitou, não que o objeto está lá com o tamanho
  certo — é a mesma distinção entre "o dump rodou" e "o dump abre", que este
  projeto já aprendeu no `pg_restore --list`.

O `enviar-para-r2.ts` **não** reusa `DepositoDeAvatares` de propósito: aquela
interface valida o nome como `<sha256>.webp`, e afrouxar essa validação para
caber um dump seria enfraquecer a defesa de um caminho para atender outro. O que
os dois compartilham é a **assinatura**, que é a mesma provada contra S3 real no
CI.

Ele também recusa arquivo vazio (um `pg_dump` que falhou em silêncio) e arquivo
acima de 4 GB (não faz multipart — mandar assim produziria um objeto truncado, e
backup truncado é pior que backup nenhum porque parece que existe).

## O R2 no ar (27/08/2026)

Os avatares saíram do volume. A ordem seguida foi a da §6 do plano 02, e ela
importa: **migrar antes de configurar**. Com as variáveis ativas antes da cópia,
a aplicação leria de um bucket vazio e toda foto viraria 404 até a migração
terminar.

| Passo | Resultado |
|---|---|
| Ensaio (`migrar-avatares.ts`, sem `--aplicar`) | 32 avatares, **0 corrompidos**, 0 nomes inválidos |
| `--aplicar` | 32 copiados |
| `--aplicar` de novo | 0 copiados, **32 já estavam** — e a migração compara CONTEÚDO antes de dizer isso |
| `docker compose up -d` | `recarregadas 1 sala(s)`, `avatares: R2`, `o depósito aceita gravar` |

A partida em curso atravessou o reinício. A sonda de RNF-020 gravou, leu,
conferiu e apagou um objeto no bucket — não é suposição de que funciona.

**O ensaio respondeu uma pergunta que nunca tinha sido feita:** nenhum dos 32
arquivos estava corrompido. O hash no nome tornou isso trivial de verificar, e é
a segunda vez que essa escolha do plano 01 se paga.

O volume `fdp_avatares` **continua montado**, de propósito: é a rede de
segurança até RNF-019 fechar. Só sai depois de uma restauração de verdade.

### Eu escrevi um enviador que já existia

Ao ligar a cópia do dump para fora da máquina, escrevi um `enviar-para-r2.ts`,
com assinatura própria, variável `R2_BUCKET_BACKUPS` e `docker run` montado à
mão. Só **depois** fui olhar como os outros backups da VPS faziam.

A máquina já tinha `~/bin/enviar-r2.sh`, usado por `backup-mongo.sh` e pelos
demais. E ele é melhor que o que eu fiz em tudo que importa:

- lê credencial de `~/.config/backup-r2.env`, uma convenção que já existe;
- aplica **retenção** por dias, que o meu não fazia;
- **recusa** mandar dump para o bucket público de mídia, um guarda que eu nem
  tinha pensado em precisar;
- tem `--listar`, que é como se confere o que subiu.

Joguei o meu fora. `backup-postgres.sh` chama `enviar-r2.sh` como os outros, e
o dump vai para `vps-backups/fdp/`.

> A lição é a de sempre, e eu não a segui: **olhar o que a máquina já faz antes
> de escrever o que ela vai passar a fazer.** Uma segunda convenção para o
> mesmo problema não é redundância — é a que alguém esquece de atualizar. E
> `R2_BUCKET_BACKUPS` no `.env` da aplicação era exatamente esse começo.

**Exercitado de verdade em 27/08/2026:** `~/bin/backup-postgres.sh` gerou o
dump, conferiu com `pg_restore --list`, enviou, e `enviar-r2.sh --listar fdp/`
mostrou o objeto no bucket.

**Atenção ao instalar:** `~/bin/backup-postgres.sh` é uma **cópia**, não um link
para o repositório — é a convenção da máquina (a sonda `metrica-fdp.sh` é
igual). Mexer no arquivo aqui **não** muda o que o cron roda; é preciso copiar:

```
scp deploy/backup-postgres.sh vps:~/bin/backup-postgres.sh
```

## RNF-019 fechado: o backup volta (27/08/2026)

Restaurar **do bucket**, e não da cópia local — é o ponto inteiro. Um dump que
só foi lido de onde foi escrito não prova que a cópia remota serve.

| Etapa | Resultado |
|---|---|
| Buscar do R2 | 17 571 bytes, o objeto `fdp/fdp-20260827T181615Z.dump` |
| Destino | Postgres **descartável**, em container próprio, sem porta no host |
| Guarda do script | recusaria se o destino tivesse a tabela `contas`; tinha 0 |
| `pg_restore --exit-on-error` | seis tabelas de volta |

Conferência contra produção, tabela por tabela:

| Tabela | Restaurado | Produção | |
|---|---|---|---|
| `contas` | 10 | 10 | igual |
| `credenciais_senha` | 0 | 0 | igual |
| `identidades_sso` | 10 | 10 | igual |
| `migracoes` | 1 | 1 | igual |
| `partidas` | 30 | 31 | difere |
| `partida_jogadores` | 194 | 202 | difere |

A diferença **não é perda**: o backup saiu 18:16:15, a partida mais recente
dentro dele terminou 18:13:48, e a mais recente em produção terminou 18:20:09.
Uma partida de 8 pessoas acabou depois do dump — 1 partida e 8 jogadores,
exatamente o delta. É o sistema tendo continuado a funcionar.

> Comparar contagem com produção é o que separa "o `pg_restore` não deu erro"
> de "o backup tem os dados". Um dump vazio restaura sem erro nenhum.

Tudo descartado no fim: container, arquivos temporários, diretório. Produção
não foi tocada em momento nenhum.

### A VPS não sabia BAIXAR do R2

`~/bin/enviar-r2.sh` envia, lista e apaga. Não busca — o `enviar-r2.mjs` por
trás dele importa `PutObject`, `HeadObject`, `ListObjectsV2` e `DeleteObjects`,
e nenhum `GetObject`.

Isso vale para **todos os serviços da máquina**, não só o FDP: há backups indo
para o R2 há tempo e nenhum caminho testado para trazê-los de volta. Para este
exercício usei o nosso próprio assinador num script de uso único, sem tocar na
infra compartilhada — mas a lacuna continua lá, e é a mesma classe de problema
que RNF-019 existe para não deixar passar.

**Duas armadilhas de quem for repetir isto.** Um `.ts` fora de um pacote com
`"type": "module"` é tratado como CJS pelo `tsx` e recusa `await` no topo: use
`.mts`. E `docker --env-file` **não tira as aspas** dos valores, diferente do
`source` do shell — o `backup-r2.env` guarda entre aspas, e sem tratar isso o
host vira `"conta".r2.cloudflarestorage.com` e o DNS não resolve.

## O que fazer a seguir

O [plano 01](docs/plans/01-contas-perfis-e-historico.md) **está entregue** (F1–F5, 26/08/2026).
O [plano 02](docs/plans/02-armazenamento-de-avatares.md) está **no ar desde 27/08/2026**: os 32
avatares foram conferidos contra o próprio hash (nenhum corrompido), copiados para o bucket
`fdp-avatares`, e a aplicação lê de lá. Falta só o gate de **RNF-019** — restaurar o backup do
bucket uma vez, para valer.

Fora isso, o que sobrou é o **M4 de `12`, que é a definição de "entregue"** — e é onde mora
quase todo o trabalho restante.

### Dívida de verdade

| O quê | Onde | Por que importa |
|---|---|---|
| **Nenhuma suíte E2E existe** | `11` §8 previa Playwright; não há `test/e2e/` nem a dependência | 21 critérios de nível `E` não são executados por ninguém, e o gate do M4 exige 100% dos `CA` de v1 passando. **É a dívida mais cara do projeto**: cinco bugs graves foram achados jogando ou por relato, nenhum por teste — INV-05 (sala travada), a pausa de fim de vaza, o `v: 1` que derrubou o jogo inteiro, o volume `root` que impediu todo envio de avatar desde sempre, e o espectador que reiniciava a rodada ao sair |
| **32 critérios sem teste, e nenhum deles é E2E** | `npm run auditoria` | RNF-102 diz que requisito sem teste que cite seu ID é requisito **não entregue**. São 24 `U`, 7 `I` e 1 `CI` — coisas que dava para testar e não se testou. Muitos são de desempenho (CA-160 a CA-164, que dependem do teste de carga) e de a11y manual, mas não todos |
| **Nenhum teste de carga** | RNF-060: 500 salas, 2.000 sockets | Junto vão CA-160 a CA-164 (desempenho). Nada disso foi medido contra a VPS |
| **Auditoria de segurança** | `09` §3.1 | A tabela de ameaças nunca foi percorrida em bloco |
| **Os dois testes manuais de a11y** | `08` §5 — CA-141 (teclado) e CA-142 (leitor de tela) | São manuais por natureza e obrigatórios para o M4 |
| **Roteiro de aceitação** | `10` §8 | 4 pessoas reais, 4 dispositivos |
| **LGPD** | §13.3 do plano 01 | Contas guardam e-mail; o histórico guarda apelido de convidado. Falta retenção e apagamento de conta. Não bloqueia jogar — **bloqueia divulgar o jogo fora do círculo de amigos** |
| **O SSH do deploy some de vez em quando** | `.github/workflows/deploy.yml`; ver "A esteira" | Aconteceu **duas vezes**: CI verde, deploy vermelho com `Connection timed out` nas três tentativas. Na segunda, conferido que a porta 22 respondia normalmente de fora — então é o IP do runner que está bloqueado, quase certo **fail2ban** na VPS banindo faixas do GitHub Actions. Repetir a execução resolve (IP novo), e a aplicação no ar nunca é tocada. Mas vai voltar, e um dia numa hora ruim |

### Pedido e adiado

- **Aprovação de entrada na sala** (27/08/2026): o host aprova quem tenta entrar.
  Escopo combinado: **só no lobby**. Não começou.

### Herdado do plano 01, com risco aceito

- **Moderação de avatar e apelido** (§13.2): não há caminho de denúncia. Mitigado por restringir
  envio a contas e guardar o hash, o que permite banir um arquivo. Vira urgente se a mesa deixar
  de ser um grupo de amigos.
- **Recuperação de senha** (D-10): decidida — envio de e-mail comum —, não construída. Falta
  escolher o provedor. Enquanto não existir, o cadastro por senha precisa dizer isso na tela.

### A esteira, e as duas formas de ela falhar (resolvido em 26/08/2026)

O deploy falhou de **duas maneiras diferentes no mesmo dia**, e nas duas a única saída foi
reexecutar o CI inteiro para provocar o gatilho de novo:

1. O evento `workflow_run` simplesmente **não chegou**. CI verde, nenhum deploy criado;
   produção ficou 8 minutos atrás de `main`.
2. O SSH do runner para a VPS **estourou o tempo** — `connect to host port 22: Connection timed
   out`, depois de 2min17s. A aplicação seguiu servindo o tempo todo.

As duas ganharam resposta:

- **`workflow_dispatch`** com entrada opcional de sha (vazio = topo da `main`). A garantia que o
  gatilho automático dava — publicar só o que o CI aprovou — **não foi abandonada, mudou de
  lugar**: o passo `CI verde neste commit` vai buscar o veredito pela API e recusa publicar um
  commit sem CI verde. Escotilha de emergência não pode virar atalho para pular a suíte.
- **Repetição no SSH, três tentativas, só em falha de conexão.** O `ssh` devolve 255 quando não
  conecta ou não autentica, e o código do comando remoto em qualquer outro caso — é esse o
  discriminador. Repetir um deploy que falhou de verdade atropelaria a reversão automática do
  `deploy.sh` e poderia rodar duas publicações ao mesmo tempo. `ConnectTimeout=20` para errar
  rápido em vez de esperar dois minutos em silêncio.

**Sobre a causa do timeout, o que se sabe e o que não se sabe.** A porta 22 responde da internet
(conferido de fora), o host não está numa rede local, e os deploys do mesmo dia funcionaram com
a mesma configuração. Sobram duas hipóteses e não dá para separá-las sem entrar na máquina:
instabilidade de rota entre o runner (Azure) e a VPS, ou `fail2ban` banindo o IP daquele runner.
**Se repetir, o jeito de decidir é `fail2ban-client status sshd` na VPS logo depois da falha** —
o IP do runner lá dentro é ban; ausente é rota. Vale notar que o IP do host está num bloco de
ISP brasileiro, não de datacenter, o que casa com "funciona do Brasil, falha de fora".

### Escolha, não dívida

- **Reduzir as fronteiras de rodada** (os 16% restantes), se algum dia incomodarem. Custaria
  engordar `round:started`/`round:resolved` com quase o retrato inteiro, e provavelmente não
  vale.
- **Alertas de saturação** (CPU, memória, disco) ficaram de fora de propósito: numa VPS com
  quatro apps eles sobem por motivo legítimo e treinam a pessoa a ignorar notificação.
- **A mesa inteira sob daltonismo**, que CA-344 não cobre — ele valida a paleta de avatares
  isolada, não feltro contra carta contra texto de estado. Continua manual em `08` §5.

### Reserva de IDs

Para não colidir: `CA-363` a `CA-373` e `CA-376` a `CA-379` são do plano 01; `CA-374` e
`CA-375` são da unicidade de identidade na mesa, e `CA-380` a `CA-383` das telas de conta.
Livres a partir de `CA-384`, `RF-078` e `RNF-106`.

## Postgres e o pacote `@fdp/contas` (26/08/2026)

F1 do [plano 01](docs/plans/01-contas-perfis-e-historico.md). São **dois** bancos agora, com
papéis opostos: Redis guarda sala viva (efêmera, TTL, morre com a mesa), Postgres guarda o que
sobrevive a ela (contas, credenciais, identidades de SSO, histórico). Confundir os dois é o erro
tentador, e `11` §4 explica por quê.

O acesso fica atrás da interface `Dados`, com duas implementações e **uma** suíte de contrato —
mesma ideia do `RoomStore`. Ela já provou o valor na primeira execução: o esquema dependia de
`citext`, o que passava em memória e quebrava no Postgres, e teria quebrado de novo em qualquer
Postgres gerenciado, onde `CREATE EXTENSION` pede superusuário. Virou índice único sobre
`lower(email)` — mesma garantia, do lado do banco.

O CI sobe os dois serviços e **falha se qualquer uma das suítes for pulada**. Pular é o pior
resultado possível: verde sem ter testado.

Para rodar a suíte do Postgres na mão:

```bash
docker run -d --rm --name fdp-postgres -p 5433:5432 -e POSTGRES_PASSWORD=fdp postgres:17-alpine
DATABASE_URL='postgres://postgres:fdp@127.0.0.1:5433/postgres' npm test
```

**Backup.** `deploy/backup-postgres.sh` e `deploy/restaurar-postgres.sh`. A restauração recusa
destino que já tenha a tabela `contas` — `--clean` sobre a base errada apaga o que estava lá, e
a hora de descobrir isso não é durante um incidente. O ciclo foi exercitado de verdade em
26/08/2026: banco semeado, dump, restauração num banco vazio, contagens idênticas nas cinco
tabelas, e a aplicação lendo o restaurado. Backup que nunca foi restaurado não é backup.

**Ainda não está na VPS.** O container, o cron do backup e o alerta no Grafana ficam para quando
a F2 precisar do banco de pé.

## Contas: F2 no ar (26/08/2026)

Cadastro, login, sessão em cookie e perfil público. `PROTOCOL_VERSION` foi para **2** porque
`PublicPlayer` ganhou `conta` — o slug público, nunca o id interno.

**O Postgres NÃO está na VPS ainda**, e isso é visível em produção do jeito certo: `/api/eu`
devolve `{"conta":null}`, `/api/contas` devolve `{"code":"CONTAS_INDISPONIVEIS"}`, e criar sala
funciona normalmente. Conta é acréscimo, nunca pedágio (plano 01, I-1) — e há teste com o
servidor rodando sem banco justamente porque a maneira de quebrar isso é silenciosa.

Para ligar contas em produção: subir o container do Postgres na VPS, pôr `DATABASE_URL` no
ambiente do serviço e reiniciar. O resto já está de pé.

Três armadilhas que apareceram e que vale conhecer antes de mexer:

- **Os dois tokens são HS256 com o mesmo segredo**, então a assinatura de um confere no outro.
  A claim `tipo` separa os dois, e é obrigatória só no token de conta — token de sala emitido
  antes do campo existir continua valendo, senão um deploy expulsaria quem está jogando.
- **`hub.ts` emitia `v: 1` fixo** enquanto a entrada era validada contra a constante. Se você
  subir a versão de novo, confira os dois lados.
- **RNF-001** manda toda resposta de erro ser `{ code, params? }`. As rotas novas nasceram com
  `{ error: { code } }` e o cliente lê `code` do topo — metade das mensagens chegaria vazia.

Rodar local com contas:

```bash
docker run -d --rm --name fdp-postgres -p 5433:5432 -e POSTGRES_PASSWORD=fdp postgres:17-alpine
DATABASE_URL='postgres://postgres:fdp@127.0.0.1:5433/postgres' npm run dev
```

## SSO no ar, mas sem provedor configurado (26/08/2026)

F3 do plano 01. Google e GitHub, fluxo de código de autorização inteiro no servidor — sem SDK,
sem token de provedor chegando ao navegador (RNF-055 não sobreviveria a um SDK de OAuth).

**Ainda não funciona em produção, e de propósito:** falta criar os apps no Google e no GitHub e
pôr `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET` no
ambiente da VPS. Sem eles `/api/sso` devolve lista vazia e a tela não desenha botão — um botão
que responde 503 é pior que nenhum. O `redirect_uri` a cadastrar é
`https://fdp.imp-software.cloud/api/sso/{google|github}/retorno`.

Três coisas que não são óbvias:

- **PKCE só no Google.** O GitHub não implementa PKCE em OAuth App nenhum. A ausência tem teste
  para não parecer esquecimento e "ser consertada" depois.
- **A chave da identidade é `(provedor, subject)`, nunca o e-mail.** E-mail no Google e no
  GitHub muda; o `sub` não. Casar por e-mail faria a conta trocar de dono no dia em que alguém
  trocasse de endereço.
- **No GitHub, `/user/emails` é obrigatório.** O e-mail do perfil público pode estar vazio ou
  não verificado, e é o `primary` **e** `verified` que autoriza a tomada de conta de D-3. Usar o
  do perfil transformaria a regra num sequestro.

## Compilado dentro de src/ mordeu de novo (26/08/2026)

Segunda vez. Os imports são `'./memoria.js'` — convenção ESM do TypeScript —, então um `.js`
obsoleto ao lado do `.ts` **ganha** a resolução e a suíte roda contra código velho sem aviso. O
sintoma foi um método que existia no fonte e "não era função" em tempo de execução.

O guarda do CI não pegou, e não pegaria: esses arquivos são **ignorados pelo git**, então o CI
nunca os vê e passa verde enquanto só a máquina de quem desenvolve quebra. Agora há
`server/test/higiene.test.ts`, que roda onde o problema mora. Se ele ficar vermelho:

```bash
find packages/*/src app/src server/src \( -name '*.js' -o -name '*.d.ts' \) -delete
```

## Postgres na VPS (26/08/2026)

Está de pé. Serviço no `docker-compose.prod.yml`, só na rede `internal` — nenhuma porta sai da
máquina —, volume nomeado `postgres-data`, usuário `fdp` (não superusuário), senha em
`~/apps/fdp/.env` como `FDP_DB_PASSWORD`, permissão 600.

**O `depends_on` é `service_started`, não `service_healthy`.** Com `healthy`, um banco que não
sobe impediria a API de subir, e o jogo ficaria refém da parte opcional dele. Isso foi
verificado ao vivo: o compose subiu antes do container do Postgres existir, a API não resolveu o
host, registrou o erro, **subiu assim mesmo** e recarregou as 2 salas vivas. Contas responderam
503 e o jogo funcionou.

O Postgres fica **fora de `SERVICOS`** no `deploy.sh`, como o Redis: não sai desta esteira e
recriá-lo a cada deploy derrubaria conexão à toa. Se um dia o compose mudar o serviço do banco, é
preciso rodar `docker compose -f docker-compose.prod.yml up -d postgres` à mão.

**A API só tenta conectar UMA vez, na subida.** Com o banco de volta depois de uma queda, é
preciso recriar a API para ela reconectar:

```bash
ssh vps 'cd ~/apps/fdp && IMAGE_TAG=$(cat ~/.deploy-state/fdp) docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api'
```

**Backup** todo dia às 06:00 UTC, via `com-alerta.sh` como os outros. `backup-postgres.sh` roda
o `pg_dump` **dentro do container** — a VPS não tem cliente de Postgres no host, e a senha lida
de `$POSTGRES_PASSWORD` lá dentro nunca passa pela linha de comando, onde apareceria em `ps`. A
restauração foi exercitada na própria VPS em 26/08/2026: dump, banco vazio, `pg_restore`, seis
tabelas e o índice funcional de volta.

**Alerta** `fdp-contas-fora` no Grafana, severidade `aviso` (não `crítica`) e `for: 10m` — um
deploy recria a API e há uma janela antes de ela conectar; alertar em 1 min faria de todo deploy
um falso positivo.

Para inspecionar o banco (a senha fica dentro do container):

```bash
ssh vps 'docker exec fdp-postgres sh -c "PGPASSWORD=\$POSTGRES_PASSWORD psql -U fdp -d fdp -c \"SELECT count(*) FROM contas\""'
```

## SSO ligado em produção (26/08/2026)

`/api/sso` devolve `["google","github"]`. As quatro variáveis vivem no `.env` da VPS, e são
**opcionais** no compose (sem `:?`): faltando, o app sobe e a tela simplesmente não desenha
botão. Exigi-las faria o jogo depender de dois terceiros para subir.

`redirect_uri` cadastrados nos provedores:
`https://fdp.imp-software.cloud/api/sso/{google|github}/retorno`. **Se o domínio mudar, os dois
cadastros precisam ser atualizados** — o provedor recusa qualquer URI que não bata exatamente.

Conferido contra a produção: PKCE presente no Google e ausente no GitHub (que não o implementa),
escopo `user:email` no GitHub — sem ele a tomada de conta de D-3 não teria como decidir —, e o
cookie de `state` com `HttpOnly; SameSite=Lax; Secure; Max-Age=600`. As quatro recusas testadas:
`state` ausente, `state` sem cookie, `state` cruzado entre provedores, provedor inexistente.

O `client_id` aparece na URL de redirecionamento e **é público por natureza** — está no
navegador de todo mundo que clica em "Entrar com Google". O que é segredo é o `client_secret`, e
ele nunca sai do `.env`.

## Avatar por imagem (26/08/2026) — F5, e o plano 01 fechado

`sharp` entrou como dependência. **É o segundo módulo nativo do projeto** (o primeiro foi o
`pg`), custa ~27 MB de binários em `node_modules/@img`, e a imagem de produção foi para 382 MB.
Foi construída e testada no Alpine antes de subir: o `linuxmusl-x64` está no lockfile e carrega.

**A imagem é um campo A MAIS no avatar, não uma união.** O plano 01 §10 desenhou como união e eu
mudei ao implementar, por três razões: união obrigaria migrar todo avatar já gravado (Postgres,
Redis das salas vivas, `localStorage`); o emoji vira o fallback enquanto a foto carrega; e ela
**fecha o buraco de R-6** — com as 8 cores esgotadas é o emoji único que garante o par de `04`
§2, e um avatar sem emoji perderia esse resgate.

Cada regra do processamento existe por um ataque concreto:

- **Formato pelos BYTES**, nunca pelo `Content-Type` nem pela extensão — os dois são afirmações
  do cliente.
- **SVG recusado** mesmo sendo "uma imagem": é documento executável, e servido da nossa origem
  um `<script>` lá dentro roda com a nossa sessão.
- **`limitInputPixels`**: um PNG branco de 8000² cabe em poucos KB e vira 64 milhões de pixels
  ao decodificar. O teto de 5 MB **não** pega isso.
- **EXIF some, GPS junto.** E o `.rotate()` vem ANTES do descarte: sem ele a foto de retrato do
  celular sai deitada.
- O nome do arquivo é o **sha256 do resultado**: reenviar é idempotente e o cache é imutável.

O volume `avatares` no compose não é opcional — sem ele, todo mundo perde a foto a cada deploy,
porque o container é recriado.

### Um teste derrubou o vizinho

Os testes de avatar decodificam imagens grandes em paralelo e empurraram o **CA-209** (teste
estatístico de 2,3 s, noutro pacote) para fora do timeout padrão de 5 s do vitest. Ele é
determinístico — sementes fixas —, então não era intermitente: era prazo.

Corrigido na causa (a bomba de teste foi de 20 000² para 8000², que ainda é 4× o teto) e no
sintoma (CA-209 ganhou prazo próprio de 20 s). Um teste que derruba o vizinho é pior que teste
nenhum: ensina a rodar de novo até passar.

## A pausa que o WhatsApp causava (27/08/2026)

**O defeito.** No celular, trocar de aplicativo pausava a partida de todo mundo. Só no celular —
no computador nunca aconteceu, e é por isso que sobreviveu tanto tempo.

**A cadeia.** O sistema congela a aba ao ir para segundo plano e fecha o WebSocket. O servidor
recebe o mesmo `close` de uma queda de internet, marca `RECONECTANDO`, e 10 s depois
(`TRANSPORT_GRACE`) promove a `DESCONECTADO` — que pausa. E o pior: **a aba congelada não
consegue reconectar**, porque o `setTimeout` do backoff congelou junto. Os 10 s eram
inalcançáveis por construção.

**Por que só o cliente pode resolver.** Olhando o transporte, os dois casos são idênticos. A
diferença só existe dentro do navegador, e é ele que a conta: `player:background`, mandado
ANTES de sumir, enquanto o socket ainda existe (RJ-117b). É melhor-esforço — sem o aviso, a mesa
pausa como antes, e errar para o lado de pausar é o lado seguro.

**O que destravou o conserto** foi descobrir que o auto-play NÃO é bloqueado por conexão: ele
dispara sempre que `phaseDeadline` vence. Quem cai não é auto-jogado apenas porque a sala vira
`PAUSADA` e o `phaseDeadline` some. Ou seja, bastou não pausar — a cobertura já existia.

**Consequência deliberada:** quem fica no WhatsApp perde a vez por auto-play, como perderia se
tivesse largado o telefone na mesa. É o que se quer; o contrário é a partida dos outros parar
porque alguém foi olhar uma mensagem.

Junto foi um segundo defeito: **ao voltar, o cliente esperava o backoff** (até 4 s) antes de
reconectar, sobre um servidor que nunca esteve fora do ar — quem estava indisponível era a aba.
Agora `visibilitychange → visible` reconecta na hora e zera a tentativa.

**Sem cap de tempo, por ora.** Quem fica em segundo plano indefinidamente segue sendo
auto-jogado até a partida acabar, e nunca pausa. Se um dia isso incomodar, o lugar de mexer é
`isAbsent`.
