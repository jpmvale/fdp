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

#### Rodada de 1 carta (testa)

Esta é a tela mais distintiva do jogo e a mais fácil de errar.

| ID | Requisito |
|---|---|
| RF-030 | A própria carta **DEVE** ser exibida como verso, na posição de "testa" do próprio jogador |
| RF-031 | As cartas dos demais **DEVEM** ser exibidas com a face para cima, grandes o bastante para leitura em 360 px |
| RF-032 | A UI **DEVE** deixar explícito o que está acontecendo: "você não vê a sua carta — todos os outros veem" |
| RF-033 | O seletor de aposta reduz a dois botões rotulados **"Ganho"** e **"Perco"**, não `1` e `0` |
| RF-034 | Na revelação, a própria carta vira com animação e o resultado aparece só depois |
| RF-035 | Nenhum elemento do DOM, atributo ou estado de cliente **DEVE** conter a própria carta antes de EV-023 (RF-024, RJ-100) |

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

### 2.5 Fim de partida (`/sala/{code}/fim`)

- Classificação final: vencedor no topo; eliminados em ordem inversa de queda, desempatados
  por `mortoEmVaza` decrescente (RJ-012); **retirados por ausência abaixo de todos** (RJ-129).
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
