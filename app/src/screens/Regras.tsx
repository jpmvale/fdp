/**
 * As regras, acessíveis a qualquer momento sem sair da partida (RF-015).
 *
 * Sobreposição e não tela nova: quem abre as regras está no meio de uma mão e
 * quer voltar para ela. Sair da partida para consultar como se aposta seria o
 * pior momento possível para perder a mesa de vista.
 *
 * O texto sai de `docs/02`, encurtado para o que se consulta no meio do jogo —
 * não é a especificação, é a cola. Cada afirmação aqui tem uma `RJ-###` por
 * trás; onde o resumo e o motor divergirem, o motor está certo.
 */
export function Regras({ aoFechar }: { aoFechar: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Regras do FDP"
      style={{
        position: 'fixed', inset: 0, zIndex: 15,
        background: 'var(--fundo)',
        overflowY: 'auto',
        padding: '12px 12px calc(24px + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto' }} className="pilha">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          position: 'sticky', top: -12, background: 'var(--fundo)',
          padding: '12px 0', margin: '-12px 0 0',
        }}>
          <h1 style={{ flex: 1, fontSize: 22, fontWeight: 500 }}>Como se joga</h1>
          <button className="fantasma" onClick={aoFechar} aria-label="Fechar as regras" style={{ minWidth: 44, width: 44, padding: 0 }}>
            ✕
          </button>
        </div>

        <Bloco titulo="O objetivo">
          Você começa com <b>5 vidas</b>. A cada rodada declara <b>quantas vazas
          vai ganhar</b>. Errou a aposta, perde uma vida por vaza de diferença —
          para mais ou para menos. Zerou, está fora. Último de pé vence.
        </Bloco>

        <Bloco titulo="A aposta que ninguém quer">
          A soma das apostas da mesa <b>nunca pode fechar</b> com o número de
          vazas da rodada. Quem aposta por último fica proibido do valor que
          fecharia a conta — e é obrigado a estragar a vida de alguém, inclusive
          a própria. <b>Não existe rodada em que todo mundo acerta.</b>
        </Bloco>

        <Bloco titulo="Jogando as vazas">
          Ganha a vaza a <b>carta mais alta</b>, na ordem 2 3 4 5 6 7 8 9 10 J Q
          K A. E é só isso:
          <ul style={{ margin: '8px 0 0 18px', display: 'grid', gap: 4 }}>
            <li><b>Naipe não vale nada</b> — é ilustração da carta.</li>
            <li><b>Não existe trunfo</b> nem manilha.</li>
            <li><b>Não precisa seguir naipe</b>: toda carta da sua mão é sempre jogável.</li>
            <li>Empate na maior carta? <b>Ninguém leva a vaza.</b></li>
          </ul>
        </Bloco>

        <Bloco titulo="A rodada de uma carta só">
          Na rodada de 1 carta, você <b>não vê a sua própria carta</b>. Ela fica
          virada para fora, à vista de todos os outros. Você aposta olhando a
          cara e as cartas deles — e eles, a sua.
        </Bloco>

        <Bloco titulo="Já era">
          Quando alguém não tem mais como acertar a aposta e vai perder mais
          vidas do que tem, a mesa mostra <b>☠ já era</b>. É conta pública:
          qualquer um faria, e esconder só penalizaria quem não faz de cabeça.
        </Bloco>

        <Bloco titulo="Se alguém cair">
          A partida <b>pausa</b> e espera. Passado um tempo, o host decide entre
          seguir sem a pessoa ou encerrar. Quem volta antes disso senta de novo
          no mesmo lugar, com as mesmas cartas.
        </Bloco>

        <button onClick={aoFechar}>Voltar para a mesa</button>
      </div>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="cartao pilha" style={{ gap: 6 }}>
      <h2 className="rotulo">{titulo}</h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--texto-medio)', textWrap: 'pretty' }}>
        {children}
      </p>
    </section>
  );
}
