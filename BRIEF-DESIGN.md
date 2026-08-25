# Brief para o Claude Design

Rascunho para você editar antes de colar. As telas estão em ordem de prioridade:
se der para desenhar só três, sejam **Mesa**, **Rodada de testa** e **Pausa** —
são as que decidem o produto e as que não têm referência pronta no mercado.

Duas decisões que eu deixei em aberto de propósito, porque são suas e mudam tudo
o que vem depois — resolva antes de colar, ou o Claude Design vai chutar:

1. **Tema.** Escuro (mesa de carteado, à noite, no sofá) ou claro? Recomendo
   escuro: é jogo de mesa, à noite, e faz as cartas brancas saltarem. Onde o
   texto abaixo diz "fundo", troque pela sua escolha.
2. **Personalidade.** O jogo se chama FDP e a graça é sacanear amigo. O visual
   acompanha esse tom (folgado, brincalhão) ou contrasta com ele (sóbrio,
   elegante, deixando a sacanagem por conta dos jogadores)? Eu iria de contraste
   — o deboche fica melhor quando a interface está séria. Está escrito assim
   abaixo; se discordar, é uma frase para trocar.

---

## O produto

FDP é um jogo de cartas de vazas, aposta e blefe para 2 a 8 pessoas, jogado no
navegador — cada um no seu próprio celular, todos na mesma sala física ou na
mesma chamada de vídeo, conectados por um código de convite de 5 letras.

Como funciona uma rodada: cada jogador recebe N cartas e **declara quantas vazas
vai ganhar**. Depois joga. Quem errou a aposta perde uma vida por vaza de
diferença. Zerou as vidas, está fora. Último de pé vence.

Duas coisas tornam o jogo o que ele é, e a interface precisa dar conta das duas:

**A soma das apostas da mesa nunca pode fechar com o número de vazas.** O último
a apostar é proibido de escolher o valor que fecharia a conta — ele é obrigado a
estragar a vida de alguém. Não existe rodada em que todo mundo acerta.

**Na rodada de 1 carta, você não vê a sua própria carta.** Ela fica virada para
fora, na sua testa, à vista de todos os outros. Você aposta olhando a cara dos
adversários e as cartas deles. Essa é a tela mais distintiva do jogo e a que eu
mais quero ver bem resolvida.

Público: grupos de amigos, adultos, jogando juntos. Não é um jogo para jogar
sozinho contra estranhos, e não há salas públicas. A pessoa entra por um link que
alguém mandou no grupo, e a métrica que importa é **do link até jogando em menos
de 45 segundos**.

Idioma: **português do Brasil**, e só ele. Todos os textos das telas em PT-BR.

## Restrições inegociáveis

- **Celular em pé, 360 px de largura.** Uma mão, polegar. Desktop é adaptação do
  mesmo layout, não um design separado — não desenhe duas coisas.
- **Nada de rolagem horizontal**, em nenhuma tela.
- **Alvos de toque de 44×44 px no mínimo**, inclusive as cartas da própria mão.
- **Cor nunca é o único canal de informação.** Todo estado precisa de ícone,
  forma ou texto junto. Isso vale especialmente para "de quem é a vez" e para
  distinguir jogadores.
- **Contraste 4,5:1** em texto e **3:1** em elementos gráficos e bordas de foco.
- **Timers são barra de progresso, nunca número em contagem regressiva.** Mesma
  informação, muito menos ansiedade.
- Tudo precisa continuar utilizável com **zoom de 200%**.

## Sistema visual

Preciso de tokens definidos antes das telas: cores, espaçamento, tipografia,
raios e sombras. E destes componentes, que se repetem em tudo:

`Botão` · `CampoTexto` · `Avatar` · `Carta` · `CartaNaTesta` · `LequeDeMão` ·
`CartãoJogador` · `ContadorDeVidas` · `SeletorDeAposta` · `Placar` · `Toast` ·
`Modal` · `Gaveta` · `BarraDeTempo` · `IndicadorDeConexão`

### A paleta de avatares é infraestrutura, não enfeite

É assim que se identifica quem é quem na mesa, e são exatamente **8 cores**, uma
por jogador, já nomeadas no código:

`amber` · `teal` · `rose` · `indigo` · `lime` · `sky` · `orange` · `violet`

Elas **precisam ser distinguíveis entre si sob deuteranopia e protanopia** — as
duas formas mais comuns de daltonismo. Se duas cores colidirem para essas
pessoas, dois jogadores viram a mesma pessoa na mesa. Por favor me mostre a
paleta simulada nas duas condições, não só no olho normal.

Cada avatar combina uma dessas cores com um emoji, escolhido entre:

🦊 🐙 🐸 🦁 🐼 🦉 🐺 🦝 🐨 🐯 🦄 🐢 🦈 🐝 🦋 🐌 🦖 🐳 🦩 🦔 🐧 🦜 🐴 🦥

O emoji é o segundo canal que salva a identificação quando a cor falha.

---

## As telas

Use dados de exemplo realistas nos mockups — nomes brasileiros curtos, valores
plausíveis. Nada de "Player 1" ou lorem ipsum: metade dos problemas de layout
deste jogo só aparece com nome de 12 caracteres e 8 jogadores na tela.

### 1. Mesa — a tela que decide o produto

É onde a pessoa passa 95% do tempo. Tudo abaixo precisa caber em 360 px sem
rolagem horizontal, com 8 jogadores.

**Sempre visível:** número da rodada e quantas cartas ela tem, fase atual, de
quem é a vez, vidas de todos, apostas já feitas, vazas ganhas na rodada.

**Cartão de adversário** — é o elemento mais consultado do jogo:
- avatar (cor + emoji) e apelido
- **vidas como ícone repetido, não número solto** — ♥♥♥ se lê de relance, "3"
  não
- aposta declarada, ou `—` enquanto não apostou
- **vazas ganhas contra aposta, no formato `2/3`** — esta é *a* informação da
  tela, precisa ser legível sem conta mental
- estado: `jogando` / `esperando` / `ausente`
- **estado "condenado"**: quando alguém já não tem salvação matematicamente —
  vai errar a aposta de qualquer jeito e perder mais vidas do que tem — o cartão
  muda de estado na hora. Algo como "já era". Isso é informação pública e
  qualquer um faria a conta; escondê-la só penaliza quem não faz de cabeça. É um
  momento de deboche coletivo e merece peso visual.

**Fase de apostas:**
- Seletor de aposta como **fileira de botões `0` a `N`**, nunca campo numérico.
- Sendo você o último a apostar, o botão do valor proibido aparece
  **desabilitado, com a razão escrita ao lado**: "a soma da mesa não pode fechar
  em 3". A pessoa **não pode descobrir a restrição errando** — isso é a regra
  mais peculiar do jogo e a interface é que precisa ensiná-la.
- Contador ao vivo: "apostas da mesa: 4 de 7".

**Fase de vazas:**
- **Sua mão em leque horizontal, fixa na base**, rolável. Carta selecionada sobe
  e revela "jogar". Toda carta é sempre jogável — não existe carta desabilitada.
- Cartas jogadas na vaza ficam no centro, **ancoradas junto ao avatar de quem
  jogou**, para a origem da jogada ser óbvia sem ler nada.
- Fim de vaza: a carta vencedora fica destacada por uns 2 s antes de limpar.
- **Vaza empatada** precisa ser explicada, não só mostrada: "empate em K —
  ninguém leva a vaza". Empate silencioso parece bug.

**Momentos que precisam de peso visual próprio** (são a carga emocional do jogo):
- **Débito de vidas** no fim da rodada, animado por jogador, mostrando a conta:
  `apostou 3 · fez 1 → −2 vidas`. Não pode ser um número que simplesmente muda.
- **Eliminação** de alguém, com destaque antes de o cartão sair da mesa.
- **Auto-play** quando alguém não joga a tempo: "Beto ficou sem tempo: apostou
  0". Nunca pode acontecer de forma invisível.

### 2. Rodada de testa — a tela mais distintiva

Acontece toda vez que a rodada tem 1 carta só. **Você vê a carta de todo mundo,
menos a sua.** A sua aparece como verso, na posição de "testa" do seu próprio
avatar.

- As cartas dos outros aparecem **com a face para cima e grandes** — é o que a
  pessoa vai ficar olhando para decidir, e precisa ser lido em 360 px.
- A tela precisa dizer o que está acontecendo, em texto: **"você não vê a sua
  carta — todos os outros veem"**. É contraintuitivo, e alguém que nunca jogou
  vai achar que é bug.
- O seletor de aposta vira **dois botões: "Ganho" e "Perco"** — não `1` e `0`.
- Na revelação, a sua carta vira com animação e **o resultado só aparece
  depois**.

Se você desenhar uma tela só deste brief inteiro, que seja esta.

### 3. Partida pausada

Alguém caiu da rede e o jogo parou por causa de outra pessoa. É a tela mais
delicada do produto do ponto de vista de frustração: quem está esperando precisa
entender **o quê**, **por quanto tempo** e **o que dá para fazer**.

- **Nomeie quem está ausente, com avatar.** Nunca "um jogador desconectou".
- **A mesa continua visível atrás**: o overlay é translúcido e não-modal. Quem
  ficou precisa continuar vendo o jogo para entender onde parou.
- **Barra de progresso** até o momento em que uma decisão fica disponível, e
  depois até o encerramento automático.
- **Antes desse momento, nenhum botão de decisão aparece** — nem desabilitado.
  Botão cinza é convite a ficar clicando.
- Quando a decisão libera, **todos veem que existe uma decisão pendente e quem
  precisa tomá-la**; só o host vê os botões.
- **Os botões do host dizem a consequência, não a ação**: "Continuar sem Beto
  (ele perde as vidas)" e "Encerrar a partida". "Continuar sem" pede
  confirmação.
- Ao retomar, **contagem visível de 3 segundos** antes de os relógios voltarem a
  correr. Retomar com o timer já andando pune quem estava esperando.

### 4. Fim de partida

- Classificação final, vencedor no topo. Quem foi eliminado aparece em ordem
  inversa de queda; quem abandonou fica abaixo de todos.
- **A vitória precisa ser explicada, não só exibida.** Existe um caso em que
  todos zeram as vidas na mesma rodada e vence quem sobreviveu mais tempo dentro
  dela: "todos caíram na rodada 9 — Caio segurou a última vida até a vaza 7".
  Sem essa frase o resultado parece arbitrário.
- Resumo por jogador: apostas certas, vidas perdidas, rodada em que caiu.
- Host vê **Revanche** e **Voltar ao lobby**. Os demais veem "aguardando o host".

### 5. Lobby

Onde as pessoas esperam antes de começar.

- **Código da sala em destaque**, com botão de copiar o link de convite.
- Lista de jogadores ao vivo: avatar, apelido, coroa no host, indicador de
  conexão. Espectadores em seção separada, quando houver.
- **Host** configura: vidas iniciais, máximo de cartas por rodada, e a regra de
  empate. A regra de empate **precisa de uma linha explicando cada opção**, não
  só o nome — ela muda a estratégia da partida inteira. As configurações são
  visíveis a todos, não só a quem as escolhe.
- Botão **Iniciar partida** desabilitado abaixo de 2 jogadores, **com o motivo
  visível**. Os demais veem "aguardando o host iniciar", sem botão fantasma.
- **Estado de host sozinho**: a tela precisa empurrar para compartilhar o link,
  não apenas informar "1 jogador". É aqui que a métrica dos 45 segundos se ganha
  ou se perde.

### 6. Home

Duas ações, sem hierarquia ambígua: **Criar sala** e **Entrar com código**. Campo
de código de 5 caracteres, maiúsculas automáticas, teclado alfanumérico. Link
"Como se joga" abrindo as regras em modal.

### 7. Perfil

Apelido (2 a 16 caracteres) e escolha de emoji + cor, com **prévia ao vivo do
avatar como ele vai aparecer na mesa**. Botão de entrar desabilitado enquanto o
apelido não vale, com o motivo em texto.

### 8. Estados de conexão

Não são telas inteiras, mas preciso deles definidos:

| Estado | Como aparece |
|---|---|
| Conectando | Barra sutil no topo, sem bloquear nada |
| Reconectando | Overlay **não-modal**: a pessoa precisa continuar vendo a mesa |
| Sessão aberta em outra aba | Overlay modal, com botão "jogar aqui" |
| Sala encerrada | Tela cheia, com botão "voltar ao início" |
| Versão desatualizada | Tela cheia, com botão "recarregar" |

---

## O que não fazer

- **Não desenhe uma versão desktop separada.** Um layout, que se adapta.
- **Não use cor sozinha** para comunicar vez, estado ou identidade.
- **Não invente placar por pontos.** São vidas, e elas só diminuem.
- **Não coloque contagem regressiva numérica** em lugar nenhum.
- **Não desenhe carta desabilitada** na fase de vazas: todas são sempre jogáveis.
- **Não mostre a carta do próprio jogador** na rodada de testa, em hipótese
  alguma — nem "só para o mockup ficar mais bonito". É a regra central do jogo.
- **Nada de som como único canal** de qualquer informação.

## O que eu quero de volta

1. Os tokens e a paleta de 8 avatares, **com a simulação de deuteranopia e
   protanopia lado a lado**.
2. A **Mesa** em três momentos: apostando, no meio de uma vaza, e na resolução
   com débito de vidas.
3. A **rodada de testa**, do meu ponto de vista — carta dos outros à vista, verso
   no meu lugar.
4. A **pausa**, nos dois momentos: antes de a decisão liberar e depois.
5. O **fim de partida**.
6. Lobby, Home e Perfil.

Se algo aqui estiver ambíguo ou parecer contraditório, me pergunte antes de
desenhar — este brief saiu de uma especificação fechada, e onde ele estiver
vago é porque eu resumi demais, não porque está em aberto.
