import { useSyncExternalStore } from 'react';
import type { Retrato } from './tipos';
import type { EstadoConexao } from '../net/socket';
import type { PreJogada } from '../jogada';

/**
 * Estado local do cliente. **Só reflete o retrato do servidor** (`11` §6): não
 * há regra de jogo aqui, e nenhuma tela decide nada que o servidor não tenha
 * dito. O servidor é a autoridade; esta camada é memória de curto prazo.
 *
 * A aplicação incremental de eventos (os redutores por evento) ainda não
 * existe: cada evento pede o retrato inteiro de volta. É correto e simples,
 * mas mais conversa do que o necessário — a troca está registrada no handoff.
 */

export interface Aviso {
  id: string;
  texto: string;
}

export interface Estado {
  tela: 'home' | 'perfil' | 'sala';
  eu: string | null;
  codigo: string | null;
  retrato: Retrato | null;
  conexao: EstadoConexao;
  erro: string | null;
  avisos: Aviso[];
  cartaSelecionada: string | null;
  /**
   * Escolhida ANTES da vez chegar: assim que ela chega, é jogada sozinha.
   *
   * Separada da selecionada de propósito. Na minha vez, escolher e jogar são
   * dois toques — o segundo é a confirmação, e é ela que impede a carta errada
   * de sair num toque torto. Fora da vez não há o que confirmar: o gesto
   * inteiro é "quando chegar, jogue esta", e um segundo toque depois anularia
   * a razão de existir da pré-jogada.
   *
   * Guarda a rodada e a mão junto do id: o gatilho vale para aquela mão e
   * só — o baralho é redistribuído e o mesmo id volta a existir noutra.
   */
  cartaPreJogada: PreJogada | null;
}

const inicial: Estado = {
  tela: 'home',
  eu: null,
  codigo: null,
  retrato: null,
  conexao: 'CONECTANDO',
  erro: null,
  avisos: [],
  cartaSelecionada: null,
  cartaPreJogada: null,
};

let estado = inicial;
const inscritos = new Set<() => void>();

const notificar = () => { for (const f of inscritos) f(); };

export function definir(mudanca: Partial<Estado> | ((e: Estado) => Partial<Estado>)): void {
  const parcial = typeof mudanca === 'function' ? mudanca(estado) : mudanca;
  estado = { ...estado, ...parcial };
  notificar();
}

export const ler = () => estado;

export function useEstado(): Estado {
  return useSyncExternalStore(
    (f) => { inscritos.add(f); return () => { inscritos.delete(f); }; },
    () => estado,
  );
}

/** Avisos somem sozinhos: são narração da mesa, não erro a ser fechado. */
export function avisar(texto: string): void {
  const aviso = { id: crypto.randomUUID(), texto };
  definir((e) => ({ avisos: [aviso, ...e.avisos].slice(0, 4) }));
  setTimeout(() => {
    definir((e) => ({ avisos: e.avisos.filter((a) => a.id !== aviso.id) }));
  }, 5000);
}

export function errar(texto: string): void {
  definir({ erro: texto });
  setTimeout(() => definir({ erro: null }), 4000);
}
