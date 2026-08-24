# 00 — Visão e Escopo

Status: **ESTÁVEL**

## 1. Visão

FDP é um jogo de cartas de vazas, aposta e blefe para 2 a 8 pessoas, jogado inteiramente no
navegador, sem instalação, sem cadastro e sem app. Uma pessoa cria uma sala, compartilha um
código curto, e em menos de 30 segundos o grupo está jogando — em casa na mesma sala ou
espalhado por chamada de vídeo.

Cada jogador declara quantas vazas vai ganhar e perde vidas ao errar. Uma regra estrutural
impede que a soma das apostas feche com o número de vazas: **alguém sempre se dá mal**. E na
rodada de 1 carta você aposta sem ver a própria carta — que está na sua testa, à vista de
todos os outros. Regras completas em [02-regras-do-jogo.md](./02-regras-do-jogo.md).

O produto vive ou morre por três atributos, nesta ordem de prioridade:

1. **Entrar é trivial.** Nenhuma fricção entre receber o link e estar sentado à mesa.
2. **A partida nunca fica sem saída.** Queda de conexão, aba fechada ou celular bloqueado
   podem **pausar** o jogo — mas toda pausa tem prazo, decisão explícita do host e encerramento
   automático. Parar é aceitável; ficar preso não é.
3. **O estado é sempre confiável.** O que você vê na sua tela é o que o servidor considera
   verdade. Nunca há dúvida sobre de quem é a vez ou qual é o placar.

## 2. Público-alvo

- Grupos de amigos de 2 a 8 pessoas, jogando de forma casual.
- Uso predominante em **celular** (assumir mobile-first), com desktop como cenário secundário.
- Sem experiência prévia com o jogo: as regras precisam ser aprendíveis dentro do produto.

## 3. Princípios de produto

- **Servidor é a autoridade.** O cliente é uma tela; ele nunca decide resultado de jogada.
- **Zero cadastro na v1.** Identidade é um apelido + sessão anônima persistida no dispositivo.
- **Sem estado morto.** Toda sala tem TTL. O sistema não acumula lixo.
- **Falha explicada.** Todo erro visível ao jogador tem causa em linguagem humana e uma ação
  de saída (tentar de novo, voltar ao lobby, sair da sala).
- **Uma partida cabe num intervalo de almoço.** Duração-alvo de 10 a 20 minutos.

## 4. Escopo da v1

### 4.1 Dentro do escopo

| ID | Requisito |
|---|---|
| RF-001 | Criar sala e receber um código de convite curto e compartilhável |
| RF-002 | Entrar em sala por código ou por link direto |
| RF-003 | Definir apelido e avatar (cor/emoji) antes de entrar |
| RF-004 | Lobby com lista de jogadores em tempo real e indicação de quem é o host |
| RF-005 | Host inicia a partida quando o mínimo de jogadores é atingido |
| RF-006 | Partida completa segundo [02-regras-do-jogo.md](./02-regras-do-jogo.md) |
| RF-007 | Vidas, apostas e vazas de todos visíveis e atualizadas em tempo real |
| RF-008 | Tela de fim de partida com classificação final |
| RF-009 | Revanche com o mesmo grupo, sem recriar a sala |
| RF-010 | Reconexão automática com recuperação integral do estado |
| RF-011 | Pausa por ausência, com decisão do host e teto de tempo (`02` §3.8) |
| RF-012 | Host pode expulsar um jogador do lobby |
| RF-013 | Transferência automática de host se o host sair |
| RF-014 | Espectadores: quem entra com a partida em andamento assiste e joga na próxima |
| RF-015 | Tela de regras acessível a qualquer momento, sem sair da partida |
| RF-016 | Log de rodada: histórico do que aconteceu na partida atual |

### 4.2 Fora do escopo da v1

Registrado explicitamente para não haver ambiguidade — **não implementar**:

- Contas, login, senha, OAuth ou perfil persistente entre sessões.
- Matchmaking público, salas abertas ou lista de partidas.
- Chat de texto ou voz. (O grupo já está em chamada ou na mesma sala.)
- Ranking global, conquistas, progressão, moeda ou cosméticos.
- Bots / jogadores controlados por IA.
- Modo local pass-and-play no mesmo dispositivo.
- Aplicativo nativo, PWA instalável ou modo offline.
- Baralhos customizados criados pelo usuário.
- Monetização de qualquer forma.
- Replays de partidas encerradas.

### 4.3 Fora do escopo, mas com porta aberta

Estas capacidades **não** entram na v1, mas o design de dados e do contrato de realtime
**NÃO DEVE** impossibilitá-las: baralhos customizados, espectador permanente, bots para
completar mesa, e persistência de histórico de partidas.

## 5. Premissas e decisões

| # | Premissa | Consequência |
|---|---|---|
| P1 | Mínimo de 2 e máximo de 8 jogadores por partida | Validado no início da partida e no join |
| P2 | Identidade é anônima, presa ao dispositivo por token de sessão | Trocar de navegador = novo jogador |
| P3 | Uma sala vive no máximo 4 horas e morre 15 min após ficar vazia | TTL no store de estado |
| P4 | Não há garantia de entrega ordenada perfeita na rede | Todo estado é reconciliável por versão |
| P5 | Jogador **conectado** que não age no prazo tem a jogada resolvida automaticamente | Auto-play: `02` §3.8.1 |
| P7 | Jogador **desconectado** pausa a partida; host decide após 60 s; pausa morre em 10 min | `02` §3.8.2 e §3.8.3 |
| P8 | O baralho escala em número de baralhos, não em teto de cartas | `02` RJ-024 |
| P6 | Português do Brasil é o único idioma da v1 | Textos centralizados mesmo assim, ver `08` |

## 6. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Regras erradas ou ambíguas na implementação | Partida injusta, grupo perde a confiança | `02` é normativo e cada `RJ-###` tem critério de aceite (RNF-102) |
| Jogador que some no meio da rodada | Partida pausa e o grupo espera | Decisão do host após 60 s + `PAUSE_MAX` de 10 min (RJ-150, RJ-157) |
| Conexão instável pausando o jogo repetidamente | Mesa fica insuportável | Métrica de pausas por partida (`09` §5); decisão revisável registrada em `02` §3.8.3 |
| Conexão instável em celular | Jogador perde estado e frustra | Resync completo por versão de estado (`05`) |
| Escopo inflar com chat/ranking | Não entrega a v1 | §4.2 é vinculante; mudanças exigem editar este doc |
| Trapaça inspecionando a rede | Quebra a confiança do grupo | Servidor nunca envia estado oculto ao cliente (`09`) |
| Vazar a própria carta na rodada de testa | Destrói a mecânica central do jogo | Projeção invertida por destinatário + INV-13, CA-281 e CA-285 |

## 7. Métricas de sucesso da v1

- **Tempo até jogar**: mediana abaixo de 45s entre abrir o link e a primeira jogada.
- **Taxa de conclusão**: ≥ 80% das partidas iniciadas chegam à tela de fim de partida.
- **Taxa de revanche**: ≥ 30% das partidas concluídas iniciam uma segunda partida.
- **Partidas travadas**: 0. Qualquer partida que fique irrecuperável é um defeito de severidade 1.
- **Pausas por partida**: mediana ≤ 1. Acima disso, a política de pausa de `02` §3.8.3 precisa
  ser revista — é a métrica que decide se a decisão foi acertada.
