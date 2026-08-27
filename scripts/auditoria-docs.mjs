/**
 * A distância entre o que `docs/` promete e o que os testes cobrem.
 *
 * RNF-102 diz que requisito sem teste que cite seu ID é requisito não entregue.
 * Isso só é verdade enquanto alguém confere — e ninguém confere de memória. Este
 * script confere, e é para rodar antes de dizer "a documentação está em dia".
 *
 * Ele NÃO falha o build. A dívida aqui é conhecida e grande demais para virar um
 * portão da noite para o dia; transformá-la em erro só ensinaria a desligar o
 * portão. O que ele faz é impedir que o número seja citado de cabeça.
 *
 *   npm run auditoria
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = 'docs/10-criterios-de-aceite.md';

/** Todos os `.ts` dentro de qualquer diretório `test/`. */
function arquivosDeTeste(raiz, achados = []) {
  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome === 'dist' || nome === '.git') continue;
    const caminho = join(raiz, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) arquivosDeTeste(caminho, achados);
    else if (caminho.includes('/test/') && nome.endsWith('.ts')) achados.push(caminho);
  }
  return achados;
}

const corpo = arquivosDeTeste('.')
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

// Faixas do tipo "CA-281 a CA-286" contam como citação de tudo que está dentro:
// é como este projeto agrupa um bloco de critérios sob um `describe` só.
const faixas = [...corpo.matchAll(/CA-(\d+) a CA-(\d+)/g)]
  .map((m) => [Number(m[1]), Number(m[2])]);

const criterios = readFileSync(DOCS, 'utf8')
  .split('\n')
  .map((l) => /^\| (CA-\d+) \| *([A-Z/]+) *\|/.exec(l))
  .filter((m) => m !== null)
  .map((m) => ({ id: m[1], nivel: m[2], n: Number(m[1].slice(3)) }));

const semTeste = criterios.filter((c) => {
  if (corpo.includes(c.id)) return false;
  return !faixas.some(([a, b]) => c.n >= a && c.n <= b);
});

const porNivel = {};
for (const c of semTeste) porNivel[c.nivel] = (porNivel[c.nivel] ?? 0) + 1;

console.log(`critérios em ${DOCS}: ${String(criterios.length)}`);
console.log(`sem teste que cite o ID: ${String(semTeste.length)}`);
for (const [nivel, quantos] of Object.entries(porNivel).sort()) {
  // `E` é a dívida do E2E, que tem seção própria no HANDOFF. Os outros níveis
  // são a dívida silenciosa: dava para testar, e não se testou.
  const nota = nivel === 'E' ? ' (suíte E2E ausente — dívida conhecida)' : ' ← dava para testar';
  console.log(`  ${nivel}: ${String(quantos)}${nota}`);
}

const silenciosos = semTeste.filter((c) => c.nivel !== 'E');
if (silenciosos.length > 0) {
  console.log('\nsem teste e sem ser E2E:');
  console.log(`  ${silenciosos.map((c) => c.id).join(', ')}`);
}
