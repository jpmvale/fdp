/**
 * Compilado dentro de `src/` é o defeito mais caro que este projeto já teve.
 *
 * Os imports são `'./memoria.js'` — convenção ESM do TypeScript —, então um
 * `.js` obsoleto ao lado do `.ts` GANHA a resolução, e a suíte passa a rodar
 * contra código velho **sem aviso nenhum**. Aconteceu em 25/08/2026 e custou
 * uma hora; aconteceu de novo em 26/08/2026, na F3, e custou outra rodada de
 * caça a um "método não é função" que existia no fonte.
 *
 * O CI já tem um guarda para isso — e ele NÃO basta, porque esses arquivos são
 * ignorados pelo git: o CI nunca os vê, passa verde, e quem quebra é só a
 * máquina de quem está desenvolvendo. Este teste roda onde o problema mora.
 */

import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = fileURLToPath(new URL('../../', import.meta.url));

function compiladosEm(dir: string, achados: string[] = []): string[] {
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return achados;
  }
  for (const nome of entradas) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) compiladosEm(caminho, achados);
    else if (nome.endsWith('.js') || nome.endsWith('.d.ts')) achados.push(caminho);
  }
  return achados;
}

describe('higiene do repositório', () => {
  it('não há .js nem .d.ts compilado dentro de src/', () => {
    const dirs = [
      'packages/rules/src', 'packages/bot/src', 'packages/protocol/src',
      'packages/store/src', 'packages/room/src', 'packages/contas/src',
      'server/src',
    ].map((d) => join(raiz, d));

    const achados = dirs.flatMap((d) => compiladosEm(d));
    expect(achados.map((a) => a.replace(raiz, ''))).toEqual([]);
  });
});
