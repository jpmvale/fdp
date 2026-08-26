/**
 * A implementação de Postgres contra **a mesma** suíte de contrato (`11` §4).
 *
 * Roda quando há `DATABASE_URL`; sem ele é pulada com aviso, em vez de dar
 * falso verde. No CI o serviço fica de pé, e é lá que a promessa "o que a
 * memória passa, o Postgres passa" é de fato cobrada.
 *
 *   docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=fdp postgres:17-alpine
 *   DATABASE_URL=postgres://postgres:fdp@127.0.0.1:5432/postgres npm test
 *
 * Cada arnês cria um ESQUEMA próprio e o derruba no fim: sem isso um teste
 * enxerga a conta que o anterior deixou, e a suíte passa a depender da ordem.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, it } from 'vitest';
import { criarDadosEmPostgres } from '../src/postgres.js';
import { descreverContratoDeDados } from './contrato.js';

const url = process.env.DATABASE_URL;

if (!url) {
  describe.skip('Dados (Postgres)', () => {
    it('precisa de DATABASE_URL para rodar', () => {});
  });
} else {
  const esquemas: string[] = [];

  descreverContratoDeDados({
    nome: 'Postgres',
    async criar() {
      const esquema = `teste_${randomUUID().replace(/-/g, '')}`;
      esquemas.push(esquema);

      const admin = new pg.Pool({ connectionString: url });
      await admin.query(`CREATE SCHEMA "${esquema}"`);
      await admin.end();

      const separado = new URL(url);
      separado.searchParams.set('options', `-c search_path=${esquema},public`);
      return criarDadosEmPostgres({ url: separado.toString() });
    },
  });

  afterAll(async () => {
    const admin = new pg.Pool({ connectionString: url });
    for (const e of esquemas) await admin.query(`DROP SCHEMA IF EXISTS "${e}" CASCADE`);
    await admin.end();
  });
}
