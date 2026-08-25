/**
 * Validação de runtime na fronteira (RNF-072).
 *
 * Entrada de cliente é tratada como hostil: nada chega à lógica de jogo sem
 * passar por aqui. Este módulo é **servidor-only** — puxa o zod e nunca deve
 * ser importado pelo cliente, que usa só os tipos de `@fdp/protocol`.
 */

import { z } from 'zod';
import {
  BOT_DIFFICULTIES,
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  LIMITS,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './index.js';

/** Caracteres de controle e separadores de linha não passam (`04` §6). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export const nicknameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length >= NICKNAME_MIN && value.length <= NICKNAME_MAX, {
    message: `apelido precisa ter de ${NICKNAME_MIN} a ${NICKNAME_MAX} caracteres`,
  })
  .refine((value) => !CONTROL_CHARS.test(value), {
    message: 'apelido não pode conter caracteres de controle',
  });

export const avatarSchema = z.object({
  emoji: z.enum(AVATAR_EMOJIS),
  color: z.enum(AVATAR_COLORS),
});

/**
 * Normaliza antes de validar: minúsculas, espaços e hífens são erro de
 * digitação previsível quando alguém dita o código por voz, não motivo para
 * recusar a entrada.
 */
export const roomCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase().replace(/[\s-]/g, ''))
  .refine((value) => value.length === ROOM_CODE_LENGTH, {
    message: `código precisa ter ${ROOM_CODE_LENGTH} caracteres`,
  })
  .refine((value) => [...value].every((char) => ROOM_CODE_ALPHABET.includes(char)), {
    message: 'código contém caracteres inválidos',
  });

export const matchOptionsSchema = z.object({
  vidasIniciais: z.int().min(1).max(10),
  maxCartasPorRodada: z.int().min(1).max(10),
  regraEmpate: z.enum(['EMPATE_ANULA_VAZA', 'EMPATE_ANULA_CARTAS']),
});

const moveBase = {
  matchId: z.string().min(1),
  roundNumber: z.int().nonnegative(),
  trickNumber: z.int().nonnegative(),
};

const empty = z.object({}).strict();

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room:resync'), payload: empty }),
  z.object({
    type: z.literal('player:setProfile'),
    payload: z.object({ nickname: nicknameSchema, avatar: avatarSchema }).strict(),
  }),
  z.object({ type: z.literal('player:leave'), payload: empty }),
  z.object({
    type: z.literal('host:kick'),
    payload: z.object({ playerId: z.string().min(1) }).strict(),
  }),
  z.object({
    type: z.literal('host:addBot'),
    payload: z.object({ difficulty: z.enum(BOT_DIFFICULTIES) }).strict(),
  }),
  z.object({
    type: z.literal('host:removeBot'),
    payload: z.object({ playerId: z.string().min(1) }).strict(),
  }),
  z.object({
    type: z.literal('host:setOptions'),
    payload: z.object({ options: matchOptionsSchema }).strict(),
  }),
  z.object({ type: z.literal('host:startMatch'), payload: empty }),
  z.object({ type: z.literal('host:endMatch'), payload: empty }),
  z.object({ type: z.literal('host:rematch'), payload: empty }),
  z.object({
    type: z.literal('host:resolveAbsence'),
    payload: z.object({ action: z.enum(['CONTINUAR_SEM', 'ENCERRAR']) }).strict(),
  }),
  z.object({
    type: z.literal('move:bet'),
    // O intervalo depende de `cartasNaRodada`, que o schema não conhece; o
    // teto absoluto fica aqui e o motor recusa o resto (`02` RJ-051).
    payload: z.object({ ...moveBase, bet: z.int().min(0).max(10) }).strict(),
  }),
  z.object({
    type: z.literal('move:playCard'),
    payload: z.object({ ...moveBase, cardId: z.string().min(1) }).strict(),
  }),
]);

export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  ts: z.number().finite(),
  payload: z.unknown(),
});

export type ParsedCommand = z.infer<typeof commandSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'PROTOCOL_VERSION' | 'VALIDATION_FAILED'; issues: string[] };

/**
 * Ponto único de entrada de mensagem do cliente.
 *
 * Trata versão incompatível separadamente de payload inválido: a primeira pede
 * "recarregue a página", a segunda é bug ou tentativa. Confundir as duas
 * produz a pior mensagem de erro possível.
 */
export function parseClientMessage(raw: unknown): ParseResult<{
  envelope: z.infer<typeof envelopeSchema>;
  command: ParsedCommand;
}> {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    const wrongVersion =
      typeof raw === 'object' &&
      raw !== null &&
      'v' in raw &&
      (raw as { v: unknown }).v !== PROTOCOL_VERSION;

    return wrongVersion
      ? { ok: false, code: 'PROTOCOL_VERSION', issues: ['versão de protocolo incompatível'] }
      : { ok: false, code: 'VALIDATION_FAILED', issues: issuesOf(envelope.error) };
  }

  const command = commandSchema.safeParse({
    type: envelope.data.type,
    payload: envelope.data.payload,
  });
  if (!command.success) {
    return { ok: false, code: 'VALIDATION_FAILED', issues: issuesOf(command.error) };
  }

  return { ok: true, value: { envelope: envelope.data, command: command.data } };
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
}

/** RNF-011: mensagem maior que o teto é descartada antes de qualquer parse. */
export function isWithinSizeLimit(raw: string): boolean {
  return Buffer.byteLength(raw, 'utf8') <= LIMITS.maxMessageBytes;
}
