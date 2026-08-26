/**
 * Contrato de `DepositoDeAvatares` — uma suíte, todas as implementações.
 *
 * Mesmo desenho de `RoomStore` e de `Dados`, e pela mesma razão: o que o disco
 * passa, o R2 precisa passar. Diferença de comportamento entre os dois vira
 * teste vermelho aqui, e não uma foto que some só em produção.
 *
 * O que esta suíte cobra é curto de propósito, porque a interface é curta. O
 * que ela cobra COM INSISTÊNCIA são as três promessas de que o resto do sistema
 * depende: gravar duas vezes é inofensivo, ausência não é erro, e nome inválido
 * nunca vira acesso.
 */

import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DepositoDeAvatares } from '../src/index.js';

export interface DepositoHarness {
  nome: string;
  /** Um depósito vazio e isolado dos outros testes. */
  criar(): Promise<DepositoDeAvatares>;
}

/** Um nome legítimo, derivado do conteúdo como o de verdade seria. */
export const nomeDe = (bytes: Buffer, pequeno = false): string =>
  `${createHash('sha256').update(bytes).digest('hex')}${pequeno ? '-64' : ''}.webp`;

const bytesQuaisquer = (n = 128): Buffer => randomBytes(n);

export function descreverContratoDeDeposito(h: DepositoHarness): void {
  describe(`DepositoDeAvatares (${h.nome})`, () => {
    it('CA-392: o que foi guardado volta byte a byte', async () => {
      const d = await h.criar();
      const bytes = bytesQuaisquer(4096);
      const nome = nomeDe(bytes);

      await d.guardar(nome, bytes);
      const lido = await d.ler(nome);

      expect(lido).toBeDefined();
      // `toEqual` em Buffer compara conteúdo. Um WebP com um byte trocado
      // continua "um Buffer de 4096 bytes", e é essa a diferença que importa.
      expect(Buffer.compare(lido!, bytes)).toBe(0);
    });

    it('CA-392: ler o que não existe devolve `undefined`, sem lançar', async () => {
      const d = await h.criar();
      // Ausência é o caso NORMAL: avatar apagado, ou nome digitado na barra de
      // endereços. Precisa virar 404 tranquilo, não erro de servidor.
      await expect(d.ler(nomeDe(bytesQuaisquer()))).resolves.toBeUndefined();
    });

    it('CA-395: guardar duas vezes o mesmo nome é inofensivo', async () => {
      const d = await h.criar();
      const bytes = bytesQuaisquer();
      const nome = nomeDe(bytes);

      // Duas pessoas mandando a mesma foto chegam exatamente aqui, e é por
      // isso que o nome é o hash: a segunda gravação não tem o que estragar.
      await d.guardar(nome, bytes);
      await d.guardar(nome, bytes);

      expect(Buffer.compare((await d.ler(nome))!, bytes)).toBe(0);
    });

    it('CA-392: gravações simultâneas do mesmo nome não expõem arquivo pela metade', async () => {
      const d = await h.criar();
      // 256 KB: grande o bastante para a escrita não ser instantânea, que é
      // quando a janela de leitura truncada apareceria.
      const bytes = bytesQuaisquer(256 * 1024);
      const nome = nomeDe(bytes);

      const gravacoes = Array.from({ length: 5 }, () => d.guardar(nome, bytes));
      // Lê no meio da confusão. Ou não existe ainda, ou existe INTEIRO —
      // nunca um WebP cortado no meio.
      const leituras = Array.from({ length: 5 }, () => d.ler(nome));

      await Promise.all(gravacoes);
      for (const lido of await Promise.all(leituras)) {
        if (lido !== undefined) expect(Buffer.compare(lido, bytes)).toBe(0);
      }
      expect(Buffer.compare((await d.ler(nome))!, bytes)).toBe(0);
    });

    it('CA-392: apagar tira, e apagar de novo não reclama', async () => {
      const d = await h.criar();
      const bytes = bytesQuaisquer();
      const nome = nomeDe(bytes);

      await d.guardar(nome, bytes);
      await d.apagar(nome);
      expect(await d.ler(nome)).toBeUndefined();

      // Idempotente pela mesma razão de `guardar`: quem apaga não deveria
      // precisar perguntar antes se ainda está lá.
      await expect(d.apagar(nome)).resolves.toBeUndefined();
    });

    it('CA-395: as variantes grande e pequena são objetos independentes', async () => {
      const d = await h.criar();
      const grande = bytesQuaisquer(2048);
      const pequena = bytesQuaisquer(256);
      const base = createHash('sha256').update(grande).digest('hex');

      await d.guardar(`${base}.webp`, grande);
      await d.guardar(`${base}-64.webp`, pequena);

      // O `-64` é sufixo do MESMO hash: se alguma implementação normalizar o
      // nome, as duas viram uma e o assento na mesa passa a mostrar a errada.
      expect(Buffer.compare((await d.ler(`${base}.webp`))!, grande)).toBe(0);
      expect(Buffer.compare((await d.ler(`${base}-64.webp`))!, pequena)).toBe(0);

      await d.apagar(`${base}-64.webp`);
      expect(await d.ler(`${base}.webp`)).toBeDefined();
    });

    it('CA-392: nome inválido é recusado nas TRÊS operações', async () => {
      const d = await h.criar();
      const hex = 'a'.repeat(64);

      // No disco isto escolheria qualquer arquivo da máquina; no bucket,
      // qualquer objeto. A checagem é do depósito, e não de quem o chama —
      // senão ela só existe enquanto ninguém abrir um segundo caminho até aqui.
      const proibidos = [
        '../../etc/passwd',
        `../${hex}.webp`,
        `${hex}.webp/../outro.webp`,
        `${hex}.png`,
        `${hex.toUpperCase()}.webp`,
        `${hex}.webp%00.txt`,
        '',
        `${hex}-32.webp`,
      ];

      for (const ruim of proibidos) {
        await expect(d.guardar(ruim, Buffer.from('x')), `guardar ${ruim}`).rejects.toThrow();
        await expect(d.ler(ruim), `ler ${ruim}`).rejects.toThrow();
        await expect(d.apagar(ruim), `apagar ${ruim}`).rejects.toThrow();
      }
    });
  });
}
