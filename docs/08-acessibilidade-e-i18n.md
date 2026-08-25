# 08 — Acessibilidade e Idioma

Status: **ESTÁVEL**

Meta da v1: **WCAG 2.2 nível AA** nas telas de Home, Perfil, Lobby e Fim de partida, e nível
AA no que for aplicável na Mesa. Acessibilidade aqui não é conformidade burocrática: um jogo
de cartas comunica quase tudo por cor, posição e movimento, que são exatamente os canais que
falham para parte das pessoas.

## 1. Requisitos

| ID | Requisito |
|---|---|
| RNF-030 | Contraste mínimo 4,5:1 para texto e 3:1 para elementos gráficos e bordas de foco |
| RNF-031 | Cor **NÃO DEVE** ser o único canal de informação: cada avatar tem emoji, cada estado tem ícone e texto, o jogador da vez tem marcador de forma |
| RNF-032 | Toda funcionalidade **DEVE** ser operável por teclado, em ordem de tabulação lógica |
| RNF-033 | Foco visível em todo elemento interativo, com indicador de 2 px e contraste 3:1 |
| RNF-034 | `prefers-reduced-motion` **DEVE** substituir toda animação por transição instantânea ou fade de 100 ms |
| RNF-035 | Mudanças de estado do jogo **DEVEM** ser anunciadas por `aria-live="polite"` |
| RNF-036 | Erros **DEVEM** ser anunciados por `aria-live="assertive"` e associados ao campo por `aria-describedby` |
| RNF-037 | Zoom até 200% **NÃO DEVE** quebrar layout nem esconder ação |
| RNF-038 | Toda imagem, ícone e carta **DEVE** ter texto alternativo significativo |
| RNF-039 | Modais **DEVEM** prender o foco e devolvê-lo ao gatilho ao fechar |
| RNF-040 | Nenhum limite de tempo **DEVE** ser a única barreira: o timer de turno resulta em auto-play justo, nunca em eliminação |

## 2. Teclado na mesa

| Tecla | Ação |
|---|---|
| `Tab` / `Shift+Tab` | Navega entre regiões: placar → adversários → mesa → própria mão → ações |
| `←` / `→` | Move entre cartas da própria mão |
| `Enter` / `Espaço` | Seleciona a carta em foco / confirma a ação |
| `Esc` | Cancela seleção, fecha modal ou gaveta |
| `?` | Abre as regras |
| `L` | Abre o log de rodada |

A mão é um **composite widget**: um único ponto de tabulação, navegação interna por setas.
Vinte cartas não podem virar vinte paradas de `Tab`.

## 3. Leitores de tela

- Estrutura por landmarks: `header` (placar), `main` (mesa), `region` rotulada para a mão.
- A própria mão anuncia contagem e posição: "sua mão, 5 cartas, carta 2 de 5, <descrição>".
- Adversários anunciam nome, contagem de cartas, pontos e estado — nunca conteúdo de mão.
- Início de turno anuncia via live region: "sua vez" ou "vez de Beto".
- O resultado da rodada é anunciado **antes** de a animação começar.

## 4. Idioma

- **PT-BR é o único idioma da v1.** Nenhuma tela de troca de idioma é construída.
- Ainda assim, **nenhuma string voltada ao jogador DEVE ser embutida em componente**. Todas
  vivem em `locales/pt-BR.json`, acessadas por chave. Custo próximo de zero agora; sem isso, a
  internacionalização futura vira uma varredura por todo o código.
- Erros trafegam como `code` + `params` (`05` §6) e são traduzidos **no cliente**. O servidor
  **NÃO DEVE** enviar texto voltado ao usuário.
- Datas, números e pluralização **DEVEM** usar `Intl`, nunca concatenação manual.
- `<html lang="pt-BR">`.
- O conteúdo do baralho fica em arquivo de dados versionado (`04` §3), separado das strings de
  interface — são ciclos de vida diferentes.

## 5. Verificação

| Quando | O quê |
|---|---|
| Cada PR | `axe-core` automatizado nas telas principais; zero violações críticas ou sérias |
| Cada PR | Lint de acessibilidade (`eslint-plugin-jsx-a11y` ou equivalente) |
| Antes da entrega | Partida completa navegada só por teclado |
| Antes da entrega | Partida completa com leitor de tela (NVDA ou VoiceOver) |
| Cada PR | Simulação de deuteranopia e protanopia sobre a **paleta de avatares** (CA-344) — era manual, e a versão manual errou |
| Antes da entrega | Simulação de deuteranopia e protanopia sobre **a mesa inteira**, que o teste de paleta não cobre |

Ferramenta automatizada pega cerca de um terço dos problemas reais. Os dois testes manuais da
tabela são obrigatórios para considerar a v1 entregue.
