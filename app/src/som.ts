/**
 * Os avisos sonoros da mesa.
 *
 * O jogo é jogado com o celular na mão e a atenção na conversa: quem não está
 * olhando a tela não percebe que a vez chegou e o botão destravou. Som resolve
 * isso melhor que qualquer coisa visual, porque não exige estar olhando.
 *
 * ## Três regras que valem para tudo aqui
 *
 * **Som nunca é o único canal** (RNF-031). Cada aviso daqui tem par visual: a
 * vez tem borda, seta e o botão destravado; o tempo curto tem a barra mudando
 * de cor e pulsando. Quem joga no mudo — que é metade de quem joga no celular
 * — não perde nada.
 *
 * **Nada toca antes de o jogador tocar na tela.** Navegador bloqueia áudio sem
 * gesto do usuário, e mais importante: som que começa sozinho é o tipo de
 * coisa que faz a pessoa fechar a aba. O contexto de áudio só nasce no
 * primeiro toque, e por isso o primeiro aviso da partida pode não soar.
 *
 * **Sintetizado, não arquivo.** São dois bipes; um `.mp3` custaria uma
 * requisição, um formato para escolher e bytes no orçamento de RNF-055, para
 * entregar exatamente o mesmo. O `AudioContext` já está no navegador.
 */

let contexto: AudioContext | null = null;
let ligado = true;

const LIGADO = 'fdp.som';

/** O jogador pode desligar, e a escolha sobrevive a recarregar a página. */
export function somLigado(): boolean {
  return ligado;
}

export function alternarSom(): boolean {
  ligado = !ligado;
  try {
    localStorage.setItem(LIGADO, ligado ? '1' : '0');
  } catch {
    // Navegação privada, armazenamento bloqueado: a escolha vale só nesta aba.
  }
  return ligado;
}

export function carregarPreferenciaDeSom(): void {
  try {
    ligado = localStorage.getItem(LIGADO) !== '0';
  } catch {
    ligado = true;
  }
}

/**
 * Prepara o áudio. Precisa ser chamado de dentro de um gesto do usuário —
 * um clique —, senão o navegador cria o contexto suspenso e nada soa.
 */
export function prepararSom(): void {
  if (typeof AudioContext === 'undefined') return;

  // Contexto criado fora de um gesto nasce `suspended` e fica assim para
  // sempre — nada soa a sessão inteira, e sem erro nenhum no console. Por isso
  // aqui não basta "já existe, sai": um contexto suspenso precisa ser
  // retomado, e a retomada também só vale de dentro de um gesto.
  if (contexto) {
    if (contexto.state === 'suspended') void contexto.resume().catch(() => {});
    return;
  }

  try {
    contexto = new AudioContext();
    if (contexto.state === 'suspended') void contexto.resume().catch(() => {});
  } catch {
    contexto = null;
  }
}

/**
 * Liga o áudio ao primeiro gesto do jogador, uma vez só.
 *
 * Sem isto o áudio nunca tocava: `prepararSom` só era chamado de dentro de um
 * efeito do React — que não é gesto —, então o navegador criava o contexto
 * suspenso e todos os avisos saíam mudos, sem erro em lugar nenhum. Escutar
 * `pointerdown` e `keydown` cobre toque, mouse e teclado.
 */
export const GESTOS = ['pointerdown', 'keydown'] as const;

/** O mínimo de `document` que isto usa — é o que torna a função testável. */
export interface AlvoDeGesto {
  addEventListener(tipo: string, ouvinte: () => void): void;
  removeEventListener(tipo: string, ouvinte: () => void): void;
}

export function despertarSomNoPrimeiroGesto(
  alvo: AlvoDeGesto = document,
): () => void {
  const soltar = (acordar: () => void): void => {
    for (const gesto of GESTOS) alvo.removeEventListener(gesto, acordar);
  };

  const acordar = (): void => {
    prepararSom();
    // Um gesto basta. Deixar os ouvintes de pé faria este trabalho a cada
    // toque do jogo inteiro, para nada.
    soltar(acordar);
  };

  for (const gesto of GESTOS) alvo.addEventListener(gesto, acordar);

  return () => soltar(acordar);
}

/** Um bipe. `hz` é a altura; `duracao`, em segundos. */
function bipe(hz: number, duracao: number, volume: number, atraso = 0): void {
  if (!ligado || !contexto) return;
  const inicio = contexto.currentTime + atraso;

  const osc = contexto.createOscillator();
  const ganho = contexto.createGain();

  // Onda triangular: um seno soa apagado num alto-falante de celular, e a
  // quadrada soa como alarme de despertador. A triangular corta o ruído da
  // mesa sem assustar.
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz, inicio);

  // Envelope curto nos dois lados. Sem ele o corte seco vira um "clique"
  // audível, que é pior que o próprio bipe.
  ganho.gain.setValueAtTime(0, inicio);
  ganho.gain.linearRampToValueAtTime(volume, inicio + 0.012);
  ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);

  osc.connect(ganho);
  ganho.connect(contexto.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao + 0.02);
}

/**
 * Chegou a sua vez.
 *
 * Duas notas subindo — a forma que o ouvido lê como "algo abriu", e não como
 * alarme. É o mesmo gesto do "seu turno" de um Gartic ou de uma mesa de poker.
 */
export function tocarSuaVez(): void {
  prepararSom();
  bipe(660, 0.10, 0.16);
  bipe(880, 0.13, 0.16, 0.10);
}

/**
 * O tempo está acabando.
 *
 * Um tique curto e seco, chamado repetidamente pela tela com intervalo cada
 * vez menor — a aceleração é que comunica urgência, não o volume. Quem estiver
 * olhando já viu a barra ficar vermelha; isto é para quem não está.
 */
export function tocarTique(urgencia: number): void {
  // Sobe de altura conforme aperta, o que reforça a aceleração sem precisar
  // ficar mais alto — som mais alto assusta, som mais agudo avisa.
  bipe(520 + urgencia * 340, 0.05, 0.10);
}

/** Encerra o contexto: usado ao sair da mesa, para não deixar áudio de pé. */
export function pararSom(): void {
  void contexto?.close().catch(() => {});
  contexto = null;
}
