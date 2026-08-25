/**
 * Geração do código de convite (`06` §2).
 *
 * Cinco caracteres de um alfabeto sem `I`, `O`, `0` e `1` — os quatro que
 * viram erro quando alguém dita o código por voz ou lê numa tela pequena.
 * Espaço de 32⁵ ≈ 33,5 milhões.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@fdp/protocol';
/**
 * Sequências bloqueadas. A lista é curta de propósito: com 5 caracteres e sem
 * vogais suficientes, o risco real é pequeno, e uma lista longa começa a
 * bloquear códigos inocentes. Cobre o que apareceria numa tela de convite.
 */
const BLOCKED = [
    'PUTA', 'CU', 'FDP', 'MERDA', 'BOSTA', 'CARAL', 'BUCET', 'PENIS', 'PINTO',
    'VIADO', 'PUTO', 'XOTA', 'PORRA', 'CAGAR', 'RABO', 'TETA', 'ANUS', 'SEXO',
    'FUCK', 'SHIT', 'CUNT', 'DICK', 'COCK', 'RAPE', 'NAZI', 'KKK', 'SLUT',
];
export function isBlockedCode(code) {
    return BLOCKED.some((word) => code.includes(word));
}
/**
 * Gera um código com o gerador fornecido.
 *
 * Rejeita o resto da divisão para não enviesar o alfabeto: 256 não é múltiplo
 * de 32... na verdade é, mas a rejeição fica aqui de qualquer forma porque o
 * alfabeto pode mudar, e viés silencioso em gerador é o tipo de bug que
 * ninguém encontra depois.
 */
export function generateCode(randomBytes) {
    const alphabet = ROOM_CODE_ALPHABET;
    const limit = Math.floor(256 / alphabet.length) * alphabet.length;
    let code = '';
    while (code.length < ROOM_CODE_LENGTH) {
        for (const byte of randomBytes(ROOM_CODE_LENGTH)) {
            if (byte >= limit)
                continue;
            code += alphabet[byte % alphabet.length];
            if (code.length === ROOM_CODE_LENGTH)
                break;
        }
    }
    return code;
}
/**
 * Gera um código livre, evitando colisão e palavra bloqueada.
 *
 * Falha alto depois de `maxAttempts`: um código repetido colocaria duas mesas
 * na mesma sala, o que é pior do que uma criação de sala que dá erro.
 */
export function generateFreeCode(randomBytes, isTaken, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = generateCode(randomBytes);
        if (!isBlockedCode(code) && !isTaken(code))
            return code;
    }
    throw new Error(`não foi possível gerar código livre em ${maxAttempts} tentativas`);
}
export function normalizeCode(raw) {
    return raw.trim().toUpperCase().replace(/[\s-]/g, '');
}
