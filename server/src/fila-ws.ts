/**
 * O socket da fila (plano 03 §5.1).
 *
 * **A fila é o socket.** Fechar a aba, perder a conexão, navegar para outro
 * lugar — tudo isso fecha o socket, e fechar o socket é sair da fila. Não há
 * bilhete para expirar, não há varredura de fantasmas e não há batimento
 * próprio: o transporte que o projeto já opera é a prova de presença.
 *
 * Separado de `ws.ts` porque o assunto é outro. Lá é sala: token, snapshot,
 * reconexão, idempotência. Aqui não existe sala nenhuma — é isso que a fila
 * está tentando produzir.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  CLOSE_CODES,
  ELO_INICIAL,
  PROTOCOL_VERSION,
  type Avatar,
  type ErrorCode,
} from '@fdp/protocol';
import { isWithinSizeLimit, parseFilaMessage } from '@fdp/protocol/validate';
import type { Dados } from '@fdp/contas';
import { contaDoCookie } from './contas-http.js';
import type { FilaViva } from './fila-viva.js';
import { novoBilhete } from './fila.js';
import type { SessionSigner } from './session.js';

const PADRAO: Avatar = { emoji: AVATAR_EMOJIS[0]!, color: AVATAR_COLORS[0]! };

export interface OpcoesDoSocketDeFila {
  signer: SessionSigner;
  dados: Dados | null;
  now: () => number;
  lastSeen: WeakMap<WebSocket, number>;
}

export function atenderFila(
  ws: WebSocket,
  request: IncomingMessage,
  fila: FilaViva,
  { signer, dados, now, lastSeen }: OpcoesDoSocketDeFila,
): void {
  // O id do bilhete é o `playerId` que a pessoa vai ter na mesa. Nasce aqui,
  // antes de existir mesa: é ele que amarra o bilhete ao assento, e por isso
  // não pode ser sorteado de novo na hora de sentar.
  const id = randomUUID();
  lastSeen.set(ws, now());

  const enviar = (type: string, payload: unknown): void => {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({
      v: PROTOCOL_VERSION, id: randomUUID(), ts: now(), stateVersion: 0, type, payload,
    }));
  };

  const recusar = (code: ErrorCode, motivo: string): void => {
    enviar('error', { code, params: { motivo } });
  };

  ws.on('pong', () => lastSeen.set(ws, now()));

  ws.on('message', (raw) => {
    lastSeen.set(ws, now());
    const texto = raw.toString();
    if (!isWithinSizeLimit(texto)) return;

    let bruto: unknown;
    try {
      bruto = JSON.parse(texto);
    } catch {
      return recusar('VALIDATION_FAILED', 'JSON_INVALIDO');
    }

    const lida = parseFilaMessage(bruto);
    if (!lida.ok) return recusar(lida.code, lida.issues[0] ?? 'INVALIDO');

    const { command } = lida.value;
    if (command.type === 'fila:sair') {
      fila.sair(id);
      return;
    }

    void entrarNaFila(command.payload);
  });

  const entrarNaFila = async (payload: {
    modo: 'NORMAL' | 'RANQUEADA';
    nickname?: string | undefined;
    avatar?: Avatar | undefined;
  }): Promise<void> => {
    const conta = await contaDoCookie(dados, signer, request.headers.cookie, now());

    /**
     * RF-098: a ranqueada exige conta (D-1).
     *
     * Não é cerimônia: elo sem conta não tem onde morar, e uma ranqueada cujo
     * resultado não é gravado em lugar nenhum é uma partida normal com outro
     * nome — e com uma promessa que a tela não cumpre.
     */
    if (payload.modo === 'RANQUEADA' && !conta) {
      return recusar('VALIDATION_FAILED', 'RANQUEADA_EXIGE_CONTA');
    }

    // Logado, a identidade vem da CONTA. Aceitar o apelido do corpo aqui daria
    // ao cliente a chance de entrar na fila com um nome que não é o dele — a
    // mesma regra de `POST /api/rooms` (plano 01 §5).
    const apelido = conta?.apelido ?? payload.nickname;
    if (!apelido) return recusar('VALIDATION_FAILED', 'SEM_APELIDO');

    const elo = conta && dados
      ? (await dados.elos.porContas([conta.id])).get(conta.id)?.pontos ?? ELO_INICIAL
      : ELO_INICIAL;

    const entrou = fila.entrar(
      novoBilhete({
        id,
        modo: payload.modo,
        apelido,
        avatar: conta?.avatar ?? payload.avatar ?? PADRAO,
        conta: conta?.slug ?? null,
        contaId: conta?.id ?? null,
        elo,
        agora: now(),
      }),
      ws,
    );

    // Já estava na fila: mandar `fila:entrar` duas vezes não troca de modo pelo
    // meio. Trocar exigiria sair e entrar, e o lugar na fila é por ordem de
    // chegada — trocar de modo sem perder o lugar seria furar a própria fila.
    if (!entrou) recusar('VALIDATION_FAILED', 'JA_ESTA_NA_FILA');
  };

  const encerrar = (): void => fila.sair(id);
  ws.on('close', encerrar);
  ws.on('error', encerrar);
}

export { CLOSE_CODES };
