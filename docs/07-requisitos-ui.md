# 07 — Requisitos de Interface

Status: **ESTÁVEL**

Alvo primário: **celular em pé**, largura de 360 px, uma mão, tela pequena. Desktop é uma
adaptação do mesmo layout, não um design separado.

**Vocabulário de tela:** o que `docs/` chama de *vaza*, a interface chama de **"mão"**, e o que
seria "a mão do jogador" é **"suas cartas"**. A razão está em `01`; toda cópia desta seção
segue esse vocabulário, mesmo quando o requisito ao lado cita a regra pelo nome técnico.

## 1. Regras globais de UI

| ID | Requisito |
|---|---|
| RF-020 | Nenhuma tela **DEVE** exigir rolagem horizontal em 360 px |
| RF-021 | Todo alvo de toque **DEVE** ter no mínimo 44×44 px |
| RF-022 | Toda ação que altera estado **DEVE** dar feedback em até 100 ms, mesmo antes da resposta do servidor (botão em estado "enviando") |
| RF-023 | O estado da conexão **DEVE** estar sempre visível quando não for "conectado" |
| RF-024 | Nenhuma informação oculta **DEVE** ser renderizada no DOM, nem escondida por CSS |
| RF-025 | Toda tela de erro **DEVE** ter uma ação de saída explícita |
| RF-026 | O jogador da vez **DEVE** ser identificável sem depender apenas de cor |
| RF-027 | Timers **DEVEM** ser exibidos como barra de progresso, não como número em contagem regressiva (menos ansiedade, mesma informação) |

RF-024 é requisito de segurança, não de estética: enviar a mão dos adversários ao cliente e
escondê-la com `display: none` torna a trapaça trivial via DevTools. A projeção de `04` §5
garante que o dado nem chega ao navegador.

## 2. Telas

### 2.1 Home (`/`)

- Duas ações, sem hierarquia ambígua: **Criar sala** e **Entrar com código**.
- Campo de código com teclado alfanumérico, autoupper, máscara de 5 caracteres e validação
  contra `GET /api/rooms/{code}` no blur — o erro aparece antes de o jogador digitar o apelido.
- Link "Como se joga" abre o conteúdo de `02` em modal.

### 2.2 Perfil (`/j/{code}`)

- Campo de apelido (2–16 chars) + seleção de emoji e cor.
- Pré-visualização ao vivo do avatar como aparecerá na mesa.
- Se houver `sessionToken` válido no `localStorage` para este código, a tela é **pulada**: o
  jogador cai direto no lobby (RF-010).
- Botão de entrar desabilitado enquanto o apelido for inválido, com o motivo em texto.

### 2.3 Lobby (`/sala/{code}`)

- Código da sala em destaque, com botão **copiar link** (e `navigator.share` quando disponível).
- Lista de jogadores em tempo real, com avatar, apelido, coroa no host e indicador de conexão.
- Espectadores em seção separada, quando houver.
- Para o host: opções da partida — **vidas iniciais**, **máximo de cartas por rodada** e
  **regra de empate** (`02` §3.10) — botão de expulsar por jogador, e botão **Iniciar
  partida**, desabilitado abaixo do mínimo de jogadores, com o motivo visível.
- A regra de empate **DEVE** ser explicada em uma linha ao lado de cada opção, não só nomeada;
  ela muda a estratégia da partida inteira.
- O lobby **DEVE** exibir quantos baralhos a configuração exigirá no pico (RJ-133) e, quando
  for mais de 1, avisar que haverá cartas repetidas e mais empates (RJ-134).
- As opções vigentes **DEVEM** ser visíveis a todos, não só ao host (RJ-130).
- Para os demais: "aguardando o host iniciar", sem botão fantasma.
- Estado vazio (host sozinho) **DEVE** orientar a compartilhar o link, não apenas informar
  "1 jogador".

### 2.4 Mesa (`/sala/{code}/partida`)

#### Sempre visível

Rodada e número de cartas, fase, jogador da vez, vidas de todos, apostas já feitas, vazas
ganhas na rodada, estado da conexão.

**Cartão de adversário** — avatar, apelido, **vidas** (ícone repetido, não número solto),
aposta (`—` enquanto não apostou), vazas ganhas no formato `2/3` contra a aposta, e estado
(`jogando` / `esperando` / `ausente`). A relação vazas-ganhas × aposta é a informação mais
consultada do jogo e **DEVE** ser legível de relance, sem contas mentais.

#### Fase de apostas

- Seletor de aposta como fileira de botões `0 … cartasNaRodada`, não campo numérico.
- Sendo o último apostador, o botão de `forbiddenBet` aparece **desabilitado**, com a razão
  visível ao lado: "a soma da mesa não pode fechar em {n}". O jogador **NÃO DEVE** descobrir
  a restrição errando.
- Contador ao vivo: "apostas da mesa: {soma} de {cartas}".
- Cada aposta declarada anima no cartão do jogador correspondente.

#### Fase de vazas

- **Suas cartas** fixas na base, em leque horizontal rolável; carta selecionada sobe e mostra
  "jogar". Toda carta é jogável (RJ-013) — não há carta desabilitada nesta fase.
- Cartas jogadas na vaza corrente ficam no centro, ancoradas junto ao avatar de quem jogou.
- Fim de vaza: a carta vencedora é destacada por 1,5 a 3 s antes de a mesa limpar. **Vale para
  a última vaza da rodada também** — sem isso ela é a única cujo resultado ninguém vê, porque a
  tela do acerto de contas entra no mesmo instante em que a vencedora aparece.
- **Vaza anulada** **DEVE** ser explicada, não apenas mostrada: "empate em K — ninguém leva a
  mão" e, se aplicável, "{nome} puxa a próxima" (RJ-086). Empate silencioso gera a impressão
  de bug.

| ID | Requisito |
|---|---|
| RF-050 | O assento de quem **inicia a mão** aberta **DEVE** estar marcado na mesa — quem abre a aposta (RJ-038) na fase de apostas, o líder da vaza (RJ-065) na fase de vazas. Muda de assento a cada mão. |
| RF-051 | Fora da própria vez, tocar numa carta **DEVE** engatilhá-la: ela sai sozinha assim que a vez chegar, sem segundo toque. O engatilhamento **DEVE** ser visível na carta e desfeito por outro toque. |
| RF-052 | O gatilho de RF-051 vale para a **mão em que foi armado**, e só. Mudou a rodada ou a vaza, ele é descartado sem enviar nada. |
| RF-053 | Restando **uma** carta na mão, ela **DEVE** sair sozinha — não há escolha a fazer. Mas com pausa de 1,5 a 3 s antes, para a mesa acompanhar; a interface diz que a carta sai sozinha em vez de oferecer botão. |
| RF-054 | A rodada encerrada por RJ-014 **DEVE** ser anunciada ("já está decidido — as mãos que faltam não mudam nada"). Partida que acaba com cartas na mão de todo mundo, sem explicação, é lida como defeito. |

RF-051 a RF-053 são **comodidade de cliente, nunca regra**: tudo o que fazem, o auto-play do
servidor faria igual quando o prazo vencesse (`02` §3.7). Quem fechar a aba no meio não é
prejudicado — e é isso que autoriza a decisão a morar no cliente.

RF-052 nasceu de um defeito que não dá erro em lugar nenhum: guardando só o `cardId`, um
gatilho esquecido volta a casar depois, porque o baralho é redistribuído a cada rodada e o
mesmo id reaparece noutra mão. A carta sairia sozinha sem ninguém ter escolhido, o servidor
aceitaria, e o jogador só descobriria olhando a mesa.

#### Rodada de 1 carta (testa)

Esta é a tela mais distintiva do jogo e a mais fácil de errar.

| ID | Requisito |
|---|---|
| RF-030 | A própria carta **DEVE** ser exibida como verso, na posição de "testa" do próprio jogador |
| RF-031 | As cartas dos demais **DEVEM** ser exibidas com a face para cima, grandes o bastante para leitura em 360 px |
| RF-032 | A UI **DEVE** deixar explícito o que está acontecendo: "você não vê a sua carta — todos os outros veem" |
| RF-033 | O seletor de aposta reduz a dois botões rotulados **"Ganho"** e **"Perco"**, não `1` e `0` |
| RF-034 | Na revelação, as cartas vão para o **centro da mesa**, a própria inclusive, e o resultado aparece só depois |
| RF-035 | Nenhum elemento do DOM, atributo ou estado de cliente **DEVE** conter a própria carta antes de EV-023 (RF-024, RJ-100) |

RF-034 mudou de forma em 25/08/2026: as cartas não viram no lugar, elas **saem das testas e
vão para o centro**, como em qualquer outra mão — é lá que se comparam. Enquanto se aposta
cada carta fica no assento do dono, que é onde ela está de verdade; na revelação o assento
esvazia. Antes disso o dono era o único da mesa que nunca via a própria carta: a revelação
saía no mesmo passo que fechava a rodada (ver `03` §4.2 e CA-347).

RF-035 é requisito de segurança: numa rodada de testa, o único jogador que não pode saber a
carta está com o DevTools na mão. A defesa é a projeção do servidor (`04` §5) — a UI apenas
não pode reintroduzir o vazamento guardando a carta "para animar depois".

#### Transversal

- **Jogada inválida** não é bloqueada silenciosamente: a carta reage com negativa visível e o
  `params.motivo` de `ERR-007` aparece em toast por 3 s.
- **Log de rodada** (RF-016) em gaveta: apostas, vazas, quem ganhou o quê, vidas perdidas.
- **Auto-play** (EV-024) **DEVE** ser anunciado — "Beto ficou sem tempo: apostou 0" — nunca
  acontecer de forma invisível.
- **Débito de vidas** na resolução **DEVE** ser animado por jogador, mostrando `aposta ×
  vazas → −N vidas`. É o momento de maior carga emocional da partida e não pode ser um número
  que simplesmente muda.
- **Eliminação** **DEVE** ter destaque próprio antes de o jogador sair da mesa.
- **Condenação** (RJ-008): quando o desvio mínimo garantido de alguém alcança suas vidas, o
  cartão dele **DEVE** mudar de estado ("já era") na hora. É informação pública e derivável
  (RJ-013) — esconder só penaliza quem não faz a conta de cabeça.
- **Número de baralhos** **DEVE** estar visível quando for maior que 1, com a razão a um toque
  de distância ("8 jogadores × 7 cartas = 56 cartas: 2 baralhos, cartas repetidas existem").
- Transição de rodada **DEVE** ter pausa deliberada de 3 s (`03` §4) para que o resultado seja
  legível antes de a tela mudar.

| ID | Requisito |
|---|---|
| RF-055 | A barra de tempo **DEVE** nascer cheia em **qualquer** prazo e esvaziar proporcionalmente à duração daquele prazo, e não a uma duração fixa. O cliente recebe só o instante final; a duração se deduz do maior restante já visto. |
| RF-056 | A chegada da própria vez **DEVE** ter aviso sonoro, tocado na **transição** e não enquanto a vez dura. Mesa pausada não avisa. |
| RF-057 | O tempo acabando **DEVE** ter aviso próprio no último quarto do prazo, com frequência crescente — som **e** pulso visual na barra, nunca só um dos dois (RNF-031). Só para quem está na vez: os outros veriam pressão que não é deles. |
| RF-058 | O áudio **DEVE** ser armado no **primeiro gesto** do jogador (toque ou tecla) e **DEVE** ter interruptor visível no menu ☰, cujo rótulo diz o estado atual. A escolha sobrevive a recarregar a página. |
| RF-059 | Na vez do jogador, o **feltro inteiro** **DEVE** acender com borda vermelha pulsante **e** exibir sobre a mesa o aviso escrito **"É A SUA VEZ!"**. Só na própria vez, e nunca com a mesa pausada. |
| RF-060 | Criar conta com e-mail e senha, sem confirmação de e-mail. A senha exige **comprimento** (10), nunca composição |
| RF-074 | **Entrar e criar conta são telas separadas.** Entrar é a porta; cadastrar é um link abaixo do botão, nunca uma aba de igual peso — são dois momentos diferentes, e a aba fazia o aviso de RF-076 disputar espaço com o caminho de quem só quer voltar |
| RF-075 | O cadastro **DEVE** ter confirmação de senha, e todo campo de senha **DEVE** ter alternador de mostrar/esconder, com o estado no rótulo acessível. Sem recuperação de senha (D-10), conferir o que se digitou é a única defesa contra um erro de digitação que custa a conta |
| RF-076 | Concluído o cadastro, a sessão criada com ele **DEVE** ser encerrada e o jogador vai para **Entrar**, com o e-mail preenchido. Entrar uma vez prova que a senha funciona enquanto ela ainda está fresca — noutro produto seria atrito, aqui é a última hora barata de achar o erro |
| RF-077 | Os botões de SSO **DEVEM** trazer a marca do provedor, desenhada em SVG local — a CSP não admite origem externa, e a marca é o que faz o botão ser reconhecido antes de ser lido |
| RF-064 | Jogar sem conta **DEVE** continuar completo: entrar por link, jogar e ver o fim de partida sem cadastro, mesmo com o banco fora do ar |
| RF-072 | Duas contas de mesmo apelido na mesma sala desempatam na **entrada**, nunca são recusadas na porta |
| RF-073 | O editor de perfil de quem tem conta edita **a conta**, e parte do apelido dela — nunca do desempatado pela mesa |
| RF-078 | O editor de perfil **DEVE** estar acessível na **home**, com conta, fora de qualquer sala. Apelido, cor, emoji e foto são da conta, e exigir estar numa mesa para trocá-los deixava a conta sem dono |
| RF-079 | O balão que sai do assento **DEVE** compactar a mensagem que não couber nele. O balão avisa que fulano falou; o texto inteiro vive no painel do chat, que é onde se lê |
| RF-080 | Avatares vivem num **depósito** com interface própria; disco e R2 são implementações da mesma, cobradas pela mesma suíte de contrato |
| RF-081 | A foto **DEVE** ser servida pela nossa origem, nunca por URL do fornecedor: trocar de bucket não pode mudar uma linha do cliente, nem pedir origem nova na CSP |
| RF-082 | Depósito indisponível **DEVE** ter motivo próprio (`DEPOSITO_INDISPONIVEL`, 503) e a mesa continua com o emoji no assento. Dizer "sua imagem está corrompida" manda a pessoa consertar o que não está quebrado |
| RF-083 | No **lobby**, qualquer pessoa **PODE** sair da mesa para assistir e voltar a sentar-se. Sair libera o lugar; o host que vai assistir passa a mesa, e **nunca para um bot** |
| RF-084 | Quem assiste **DEVE** ser identificado no chat e no balão. Ele vê a mão de todos (RJ-159), e conselho de quem vê tudo não é o mesmo que palpite de quem joga |
| RF-085 | O assento **DEVE** mostrar quantas cartas a pessoa tem na mão, em **cartas viradas** do tamanho do coração. Acima de cinco vira número, como as vidas |
| RF-086 | Em tela **larga** (≥ 900 px) o chat e o log vão para uma **lateral direita** grudada no topo; abaixo disso continuam empilhados no fim, como no celular |
| RF-087 | A mensagem de quem assiste **NÃO DEVE** virar balão no feltro. Ela aparece só no chat, com a marca de RF-084 |
| RF-088 | Com partida em curso, o cabeçalho **DEVE** mostrar quantos assistem, e revelar os nomes ao passar o mouse ou tocar |
| RF-089 | O painel de quem assiste **DEVE** distinguir o que ainda está na mão do que já foi jogado, dizendo **em que mão** cada carta saiu |
| RF-090 | O histórico do perfil **DEVE** paginar: a tela mostra 10 por vez, diz quantas de quantas, e busca as seguintes sob demanda. Nada é apagado — o limite é de exibição |
| RF-091 | Quem tem conta **DEVE** alcançar o próprio perfil pela **home**, sem precisar estar numa mesa |
| RF-061 | Entrar com Google ou GitHub. Só provedor **configurado** vira botão: um botão que devolve 503 é pior que nenhum |
| RF-062 | SSO com e-mail **verificado pelo provedor** assume a conta de senha, apaga a senha e derruba as sessões |
| RF-063 | Entrar com senha numa conta assumida por SSO **DEVE** dizer o que houve — *"esta conta agora entra pelo Google"* —, nunca "senha inválida" |
| RF-070 | Avatar por imagem, só para quem tem conta, reduzido **no servidor** para 256×256 WebP, com EXIF removido. O emoji e a cor **CONTINUAM** por baixo: são o que aparece enquanto a foto carrega e se ela falhar |

RF-086 abre a casca de 460 px para 900 **só na mesa**, e é a única tela onde isso
acontece. Em qualquer outra, a coluna continua estreita mesmo num monitor de 27" —
um menu de duas opções esticado por 1400 px é pior de usar, não melhor. A mesa é a
exceção porque é o único lugar com duas coisas para olhar ao mesmo tempo: o feltro
e a conversa.

O corte é do **CSS**, e não de JavaScript medindo a janela: a mesma árvore de
componentes serve os dois casos, nada é montado duas vezes, e girar o aparelho não
perde estado nenhum. O único uso de `matchMedia` é decidir se o painel de chat
começa aberto — na lateral, fechado seria uma coluna vazia; no celular, aberto
empurraria a mão de cartas para fora da tela.

RF-087 existe por geometria, não por moderação. O balão sai de um **assento**, e
quem assiste não tem assento — o dele ia parar no meio da mesa, por cima das
cartas, e justamente no momento em que a mão está sendo disputada, que é quando
quem assiste mais fala. A mensagem não se perde: ela vive no painel do chat, que
é onde se lê com calma.

RF-088 é a outra metade de RJ-159. Quem joga precisa **saber que há plateia** sem
abrir o chat e reparar numa etiqueta: um palpite vindo de quem vê todas as
cartas vale outra coisa. O número fica sempre visível porque é barato; os nomes
ficam sob demanda porque uma lista aberta o tempo todo rouba espaço de algo que
quase nunca muda. Zero pessoas não vira "0 assistindo" — contador zerado
permanente é ruído, e a ausência de plateia é o caso comum.

RF-090 corrige uma impressão, não um limite. O `10` sempre foi de **tela**: o
banco guarda tudo, e `resumo.partidas` já contava a vida inteira. O que faltava
era a página seguinte — quem jogou 40 partidas via as 10 últimas e nenhum
caminho para o resto, o que se lê como "o histórico só guarda 10". A tela agora
diz **"10 de 40"**, e é essa frase que desfaz a impressão antes mesmo de alguém
clicar.

O teto de 50 por pedido não é sobre a tela: é para uma URL com `limite=100000`
não virar varredura de tabela por conta de curioso.

RF-091 fecha um buraco de caminho, não de dado. O perfil só era alcançável pelo
**assento**, na mesa — e assento é de quem está jogando. Quem não estava numa
partida não tinha caminho nenhum até o próprio histórico.

RF-089 completa RJ-159, que sozinho respondia metade da pergunta. `allHands`
traz só o que **resta** — o motor tira a carta da mão no instante em que ela é
jogada —, e numa rodada de 6 cartas, na terceira mão, quem assiste está
justamente tentando lembrar o que já saiu.

As cartas jogadas **já chegavam** ao espectador, em `resolvedTricks` e
`currentTrick`, que são públicos (RJ-066). Não faltava dado no servidor;
faltava juntar os dois lados na tela. Montar isso no cliente, em vez de mandar
a mão original do servidor, evita um campo novo na projeção — e campo novo na
projeção é superfície nova por onde uma carta pode vazar para quem não devia
vê-la.

A distinção **não** é só opacidade: há separador e o número da mão em que cada
carta saiu (`08` §2 — nunca só a cor, e "meio apagado" não diz o que a diferença
significa). Sem o número, as jogadas viram um monte indistinto assim que passam
de duas.

RF-085 mostra informação que **já era pública** (`handCounts`, RJ-102) e não estava
em lugar nenhum: quem quisesse saber quantas cartas restavam ao adversário tinha de
contar as mãos já jogadas de cabeça, no meio da rodada. Viradas porque o conteúdo é
segredo — uma carta desenhada de frente prometeria informação que não existe.

Na tela de conta, os botões de SSO vêm **antes** do formulário de senha. Sem recuperação de
senha (§8 do plano 01), quem entra pelo Google nunca fica sem acesso — e a ordem dos botões é a
única recomendação que a interface consegue fazer.

A tela de cadastro **DEVE** dizer, no ato, que ainda não há recuperação de senha (§8 do plano
01). Não é rodapé jurídico: sem confirmação de e-mail não existe "esqueci minha senha", e quem
descobrir isso depois perde a conta e o histórico junto. Custa uma linha, e é a diferença entre
uma escolha informada e uma armadilha.

A porta da conta na Home fica **abaixo** das duas ações de jogar. Pôr "Entrar" acima de "Criar
sala" faria o jogo parecer que pede cadastro, e ele não pede.

RF-055 corrige um erro que passava por decoração: a barra normalizava sempre pelo prazo da
aposta (45 s), então a vez de jogar carta (30 s) nascia em 67% e a vez de um bot (900 ms)
nascia em 2%. Ela praticamente nunca começava cheia, e a pressa que ela comunicava era falsa.

RF-059 é o aviso para quem **não** está com o telefone na mão: som resolve para quem ouve, a
borda resolve para quem olhou a tela de longe. Os dois canais somados ao texto e à cor fazem
quatro, e nenhum deles é obrigatório sozinho (RNF-031) — quem não distingue o vermelho lê "É A
SUA VEZ!", quem joga no mudo vê o pulso.

O pulso é lento de propósito: um ciclo de 1,4 s dá ~0,7 piscada por segundo, bem abaixo das
3/s que disparam convulsão fotossensível (WCAG 2.3.1). Com `prefers-reduced-motion` ele para —
mas **cheio**, e isso precisou de regra própria: a regra global de RNF-034 corta a duração para
0,01 ms, e uma animação `infinite` com essa duração não para no último quadro, ela cicla
depressa demais e congela onde calhar. Medido: congelava no quadro fraco, deixando o aviso
pálido justamente para quem pediu menos movimento.

O aviso escrito mora numa faixa apertada do feltro, e o número saiu de medição e não de
estimativa — quando a vez é minha e eu jogo por último há 7 cartas na mesa, ou seja, o único
momento em que o aviso aparece é o mesmo em que a pilha do centro está mais funda. CA-362
guarda os quatro lados.

RF-058 é o que faz RF-056 e RF-057 existirem de fato. Áudio preparado fora de um gesto nasce
`suspended` e nunca soa, **sem erro nenhum no console** — o jogo parece ter som e não tem. E
"desligável" só vale com um controle na tela: sem ele a promessa é do código, não do jogador.

O som de RF-056 e RF-057 **NÃO PODE** tocar antes de um gesto do usuário — navegador nenhum
permite — e **DEVE** ser desligável. Ele nunca é o único canal: RF-057 exige o pulso na barra
junto, e RF-050 a RF-054 são todos visíveis por conta própria.

### 2.5 Fim de partida (`/sala/{code}/fim`)

- Classificação final: vencedor no topo; eliminados em ordem inversa de queda, desempatados
  por `mortoEmVaza` decrescente (RJ-012); **retirados por ausência abaixo de todos** (RJ-129).
  A ordem **DEVE** vir da classificação do motor, não ser recalculada na tela: ordenar por
  vidas restantes empata todos os eliminados em zero e devolve a ordem de assento, com o
  primeiro a cair aparecendo em segundo lugar.
- Pódio: 1º, 2º e 3º **DEVEM** ter medalha desenhada, com o **algarismo dentro dela** — a cor
  do metal nunca é o único canal (RNF-031), e emoji de medalha muda de desenho a cada
  plataforma e some em fonte que não tenha o glifo.
- Vitória por RJ-005 **DEVE** ser explicada, não só exibida: "todos caíram na rodada 9 — Caio
  segurou a última vida até a vaza 7". Sem isso o resultado parece arbitrário.
- Empate de RJ-010 mostra os vencedores lado a lado.
- Resumo da partida: número de rodadas, e por jogador — apostas certas, vidas perdidas e a
  rodada em que caiu.
- Host: **Revanche** e **Voltar ao lobby**. Demais: "aguardando o host".
- Quem sai daqui **DEVE** conseguir voltar pelo mesmo link enquanto a sala existir.

### 2.6 Estados de conexão (overlay global)

| Estado | UI |
|---|---|
| Conectando | Barra sutil no topo, sem bloquear |
| **Partida pausada** (`EV-030`) | Ver §2.7 |
| Reconectando | Overlay não-modal com "reconectando…" e tentativa em curso |
| Sessão em outra aba (`ERR-409`) | Overlay modal com botão "jogar aqui" |
| Sala encerrada (`ERR-001`) | Tela cheia com botão "voltar ao início" |
| Versão desatualizada (`ERR-426`) | Tela cheia com botão "recarregar" |

O overlay de reconexão **NÃO DEVE** ser modal: o jogador precisa continuar vendo a mesa para
entender o que perdeu ao voltar.

### 2.7 Partida pausada

A tela mais delicada do produto do ponto de vista de frustração: o jogo parou por causa de
outra pessoa, e quem está esperando precisa entender **o quê**, **por quanto tempo** e **o que
pode ser feito**.

| ID | Requisito |
|---|---|
| RF-040 | O overlay de pausa **DEVE** nomear quem está ausente, com avatar — nunca "um jogador desconectou" |
| RF-041 | A mesa **DEVE** continuar visível atrás do overlay: o overlay é não-modal e translúcido |
| RF-042 | **DEVE** haver uma barra de progresso até `decisionUnlockedAt`, e depois até `hardDeadline` |
| RF-043 | Antes de `decisionUnlockedAt`, nenhum botão de decisão aparece — nem desabilitado (RJ-151) |
| RF-044 | Ao receber `EV-032`, **todos** veem que há decisão pendente e **quem** decide; só o host vê os botões |
| RF-045 | Os botões do host **DEVEM** dizer a consequência, não a ação: "Continuar sem Beto (ele perde as vidas)" e "Encerrar a partida" |
| RF-046 | "Continuar sem" **DEVE** exigir confirmação: descarta vidas de alguém e reinicia a rodada |
| RF-047 | Ao retomar (`EV-033`), **DEVE** haver contagem visível de 3 s antes de os timers voltarem |
| RF-048 | Rodada abortada (`EV-034`) **DEVE** ser explicada: "a rodada recomeça sem Beto — ninguém perdeu vida" |
| RF-049 | Quem reconecta e cai numa partida pausada por **outra** pessoa **DEVE** ver o mesmo overlay, não uma tela de erro |

RF-047 existe porque retomar com o timer já correndo pune quem estava esperando: a pessoa
volta a olhar a tela no instante em que o relógio dela já anda.

## 3. Feedback e movimento

- Animações **DEVEM** durar entre 150 e 300 ms, e **DEVEM** ser suprimidas sob
  `prefers-reduced-motion` (ver `08`).
- Cartas jogadas por outros **DEVEM** animar da área do jogador correspondente até a mesa, para
  que a origem da jogada seja compreendida sem leitura.
- Som é **opcional**, desligado por padrão, e nunca é a única forma de comunicar um evento.

## 4. Design system

Um único conjunto de tokens (cores, espaçamento, tipografia, raios, sombras) definido antes da
primeira tela e consumido por todos os componentes. Componentes mínimos da v1: `Botão`,
`CampoTexto`, `Avatar`, `Carta`, `CartaNaTesta`, `LequeDeMão`, `CartãoJogador`,
`ContadorDeVidas`, `SeletorDeAposta`, `Placar`, `Toast`, `Modal`, `Gaveta`, `BarraDeTempo`,
`IndicadorDeConexão`.

A paleta de 8 cores de avatar (`04` §2) **DEVE** ser validada para distinção sob deuteranopia
e protanopia — é a principal forma de identificar jogadores na mesa.
