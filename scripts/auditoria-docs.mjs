/**
 * A distância entre o que `docs/` promete e o que os testes cobrem.
 *
 * RNF-102 diz que requisito sem teste que cite seu ID é requisito não entregue.
 * Isso só é verdade enquanto alguém confere — e ninguém confere de memória. Este
 * script confere, e é para rodar antes de dizer "a documentação está em dia".
 *
 * A dívida do RNF-102 NÃO falha o build: é conhecida e grande demais para virar
 * um portão da noite para o dia, e transformá-la em erro só ensinaria a
 * desligar o portão. O que ele faz é impedir que o número seja citado de cabeça.
 *
 * O RNF-106 **falha**. É regra nova e nasce com dívida zero — um portão só
 * consegue ficar fechado se for fechado desde o primeiro dia. Ele confere que
 * toda fase marcada como concluída num plano tem teste citando o `CA` do gate
 * dela, e existe porque a F4 do plano 03 foi declarada concluída citando um
 * gate que não tinha sido executado.
 *
 *   npm run auditoria
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const DOCS = 'docs/10-criterios-de-aceite.md';

/** Todos os `.ts` dentro de qualquer diretório `test/`. */
function arquivosDeTeste(raiz, achados = []) {
  for (const nome of readdirSync(raiz)) {
    if (nome === 'node_modules' || nome === 'dist' || nome === '.git') continue;
    const caminho = join(raiz, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) arquivosDeTeste(caminho, achados);
    // `test/` e `e2e/`: os dois contam, e o E2E precisa contar porque metade
    // dos critérios descobertos é dele.
    //
    // `/e2e/` sozinho não bastava: `join('.', 'e2e')` dá `e2e/...`, sem barra
    // na frente, e a suíte inteira ficava invisível para a auditoria — que
    // continuaria dizendo "sem teste" sobre critérios que já tinham um.
    else if ((caminho.includes(`${sep}test${sep}`) || caminho.includes(`${sep}e2e${sep}`)
      || caminho.startsWith(`test${sep}`) || caminho.startsWith(`e2e${sep}`))
      && nome.endsWith('.ts')) achados.push(caminho);
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
  const nota = nivel === 'E' ? ' (suíte E2E em construção — ver `e2e/`)' : ' ← dava para testar';
  console.log(`  ${nivel}: ${String(quantos)}${nota}`);
}

const silenciosos = semTeste.filter((c) => c.nivel !== 'E');
if (silenciosos.length > 0) {
  console.log('\nsem teste e sem ser E2E:');
  console.log(`  ${silenciosos.map((c) => c.id).join(', ')}`);
}


// ---------------------------------------------------------------------------
// RNF-106 — fase concluída precisa do teste do gate
// ---------------------------------------------------------------------------
//
// A regra nasceu de um erro concreto: a F4 do plano 03 foi marcada ✅ citando um
// gate que ninguém tinha rodado. Quando foi rodado, achou uma regra de produto
// inteira que não acontecia.
//
// Por que fase e não requisito: o gate de uma fase é quase sempre uma EMENDA —
// o ponto em que duas partes já testadas se encontram —, e emenda é onde este
// projeto erra. Os dois lados sempre estavam certos.

const planos = readdirSync('docs/plans')
  .filter((n) => n.endsWith('.md'))
  .map((n) => ({ nome: n, texto: readFileSync(join('docs/plans', n), 'utf8') }));

const gatesAbertos = [];
for (const plano of planos) {
  // Uma fase vai do seu cabeçalho até o cabeçalho da próxima (ou o fim do
  // arquivo): é dentro desse pedaço que mora o `*Gate:*` dela.
  const marcas = [...plano.texto.matchAll(/^\*\*(F\d+)[^\n]*$/gm)];
  for (const [i, marca] of marcas.entries()) {
    const inicio = marca.index;
    const fim = i + 1 < marcas.length ? marcas[i + 1].index : plano.texto.length;
    const trecho = plano.texto.slice(inicio, fim);
    if (!trecho.includes('✅')) continue;

    const gate = /\*Gate:\*([^]*?)(?:\n\n|$)/.exec(trecho);
    if (!gate) continue;

    for (const id of new Set([...gate[1].matchAll(/CA-\d+/g)].map((m) => m[0]))) {
      const n = Number(id.slice(3));
      const citado = corpo.includes(id) || faixas.some(([a, b]) => n >= a && n <= b);
      if (!citado) gatesAbertos.push(`${plano.nome} ${marca[1]}: ${id}`);
    }
  }
}

console.log(`\nRNF-106 — gates de fase concluída sem teste: ${String(gatesAbertos.length)}`);
if (gatesAbertos.length > 0) {
  for (const g of gatesAbertos) console.log(`  ${g}`);
  console.log('\nUma fase marcada ✅ promete que o gate dela foi executado.');
  console.log('Ou escreva o teste que cita esse CA, ou tire o ✅ da fase.');
  process.exitCode = 1;
}
