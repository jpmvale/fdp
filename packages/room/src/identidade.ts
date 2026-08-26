/**
 * Quem é quem na mesa: apelido e avatar únicos.
 *
 * `04` §2 exigia só que o **par** `(emoji, cor)` fosse único. Não basta: a cor
 * é o canal principal de identificação na mesa (`07` §4), e dois jogadores de
 * cor igual com emojis diferentes já são duas pessoas parecidas demais a
 * 360 px. Aqui **emoji e cor são únicos cada um**, e o par fica único de graça.
 *
 * A conta fecha: 8 cores para 8 assentos, 24 emojis para no máximo 12 pessoas
 * na sala. Com mais gente que cor — jogadores mais espectadores — a cor pode
 * repetir, e aí o emoji único é o que ainda garante o par de `04` §2.
 *
 * Este módulo existe porque a checagem morava em dois lugares e só num deles:
 * a entrada pelo HTTP deduplicava, e `player:setProfile` não. Bastava alguém
 * editar o perfil no lobby para a mesa ter dois "Ana" de mesma cor. Uma
 * implementação, usada pelos dois caminhos.
 */

import { AVATAR_COLORS, AVATAR_EMOJIS, type Avatar } from '@fdp/protocol';
import type { PlayerId } from '@fdp/rules';
import { isPresent, type Room, type RoomPlayer } from './types.js';

/** Quem disputa identidade: todo mundo presente, menos o próprio interessado. */
const outros = (room: Room, exceto?: PlayerId): RoomPlayer[] =>
  room.players.filter((p) => isPresent(p) && p.id !== exceto);

const mesmoApelido = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

export interface Conflito {
  apelido: boolean;
  emoji: boolean;
  cor: boolean;
}

/** O que, na identidade pedida, já é de outra pessoa. */
export function conflitosDe(
  room: Room,
  playerId: PlayerId,
  nickname: string,
  avatar: Avatar,
): Conflito {
  const demais = outros(room, playerId);
  return {
    apelido: demais.some((p) => mesmoApelido(p.nickname, nickname)),
    emoji: demais.some((p) => p.avatar.emoji === avatar.emoji),
    cor: demais.some((p) => p.avatar.color === avatar.color),
  };
}

export const temConflito = (c: Conflito): boolean => c.apelido || c.emoji || c.cor;

/**
 * Apelido livre a partir do desejado.
 *
 * Sufixa em vez de recusar (CA-006): na ENTRADA, quem chegou depois não tem
 * culpa de outra pessoa se chamar igual, e barrar a segunda "Ana" na porta é
 * atrito puro numa sala de amigos. Na edição de perfil o caminho é outro — lá
 * a escolha é deliberada e a tela mostra o que está tomado, então recusar é a
 * resposta honesta.
 */
export function apelidoLivre(room: Room, desejado: string, exceto?: PlayerId): string {
  const demais = outros(room, exceto);
  const tomado = (nome: string) => demais.some((p) => mesmoApelido(p.nickname, nome));
  if (!tomado(desejado)) return desejado;

  for (let sufixo = 2; sufixo <= demais.length + 2; sufixo++) {
    const candidato = `${desejado} ${sufixo}`;
    if (!tomado(candidato)) return candidato;
  }
  // Inalcançável: o laço acima cobre mais candidatos do que há gente na sala.
  return `${desejado} ${demais.length + 2}`;
}

/**
 * Avatar livre, preferindo o pedido.
 *
 * Emoji e cor são escolhidos separadamente, cada um respeitando o que já foi
 * pedido: manter o que a pessoa quis quando dá, e trocar só a metade que
 * colide. Trocar o avatar inteiro por causa da cor apagaria uma escolha que
 * ninguém disputou.
 */
export function avatarLivre(room: Room, desejado: Avatar | undefined, exceto?: PlayerId): Avatar {
  const demais = outros(room, exceto);
  const emojisTomados = new Set(demais.map((p) => p.avatar.emoji));
  const coresTomadas = new Set(demais.map((p) => p.avatar.color));

  const emoji =
    desejado && !emojisTomados.has(desejado.emoji)
      ? desejado.emoji
      : AVATAR_EMOJIS.find((e) => !emojisTomados.has(e)) ?? AVATAR_EMOJIS[0]!;

  // Sem cor livre — mais gente que cores — a cor repete, e o emoji único é o
  // que ainda mantém o par de `04` §2.
  const cor =
    desejado && !coresTomadas.has(desejado.color)
      ? desejado.color
      : AVATAR_COLORS.find((c) => !coresTomadas.has(c)) ?? desejado?.color ?? AVATAR_COLORS[0]!;

  return { emoji, color: cor };
}
