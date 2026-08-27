import { useEffect, useState } from 'react';
import { CORES } from '../desempenho';
import { faixaDe } from '@fdp/rules';
import { Avatar } from '../components/Avatar';
import { Folha } from '../components/Folha';
import { perfilPublico, type ContaPublica } from '../net/sessao';
import type { Avatar as AvatarProto } from '@fdp/protocol';

interface PartidaNoPerfil {
  quando: number;
  rodadas: number;
  jogadores: number;
  colocacao: number | null;
  nota: number | null;
  acertos: number;
  jogadas: number;
}

/** Onde a página começa, e se ainda há o que buscar. Vem do servidor. */
interface Pagina {
  pular: number;
  limite: number;
  temMais: boolean;
}

interface Resumo {
  partidas: number;
  vitorias: number;
  notaMedia: number | null;
}

/**
 * O perfil de alguém, aberto pelo assento na mesa (D-4).
 *
 * Público para quem tem o link, sem listagem nem busca: dá para mandar o seu
 * para um amigo, e ninguém acha você por apelido.
 *
 * O que NÃO aparece aqui é tão decidido quanto o que aparece — nada de e-mail,
 * nada do id interno da conta, e nada de quem jogou junto. Um perfil público
 * não é lugar de listar com quem a pessoa joga.
 */
/** Quantas partidas por vez. O servidor tem o mesmo padrão e um teto de 50. */
const POR_PAGINA = 10;

export function PerfilPublico({ slug, aoFechar, meu = false }: {
  slug: string;
  aoFechar: () => void;
  /** É o meu próprio perfil? Só muda o título — o conteúdo é o mesmo (D-4). */
  meu?: boolean;
}) {
  const [dados, setDados] = useState<
    { conta: ContaPublica; resumo: Resumo; partidas: PartidaNoPerfil[]; pagina: Pagina } | null
  >(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscandoMais, setBuscandoMais] = useState(false);

  useEffect(() => {
    let vivo = true;
    void perfilPublico(slug)
      .then((r) => { if (vivo) setDados(r as never); })
      .catch(() => { if (vivo) setErro('Não achei esse perfil.'); });
    return () => { vivo = false; };
  }, [slug]);

  /**
   * Busca a próxima página e ACRESCENTA à lista.
   *
   * Acrescentar, e não trocar: quem clicou em "ver mais" quer ver mais, e
   * substituir a lista faria as dez primeiras sumirem — que é o oposto do
   * pedido, e o tipo de coisa que faz alguém achar que perdeu histórico.
   */
  const verMais = (): void => {
    if (!dados || buscandoMais) return;
    setBuscandoMais(true);
    void perfilPublico(slug, { pular: dados.partidas.length, limite: POR_PAGINA })
      .then((r) => {
        const novo = r as unknown as { partidas: PartidaNoPerfil[]; pagina: Pagina };
        setDados((atual) => atual && {
          ...atual,
          partidas: [...atual.partidas, ...novo.partidas],
          pagina: novo.pagina,
        });
      })
      .catch(() => setErro('Não deu para buscar mais partidas.'))
      .finally(() => setBuscandoMais(false));
  };

  return (
    <Folha rotulo={meu ? 'Meu perfil' : 'Perfil do jogador'} aoFechar={aoFechar}>
      {erro && <p className="fraco" style={{ textAlign: 'center' }}>{erro}</p>}
      {!dados && !erro && <p className="fraco" style={{ textAlign: 'center' }}>Carregando…</p>}

      {dados && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Avatar avatar={dados.conta.avatar as AvatarProto} tamanho={48} />
            <div className="pilha" style={{ gap: 2 }}>
              <span style={{ fontSize: 20, fontWeight: 500 }}>{dados.conta.apelido}</span>
              <span className="fraco" style={{ fontSize: 12 }}>/{dados.conta.slug}</span>
            </div>
          </div>

          <div className="cartao" style={{ display: 'flex', gap: 4 }}>
            <Numero rotulo="partidas" valor={String(dados.resumo.partidas)} />
            <Numero rotulo="vitórias" valor={String(dados.resumo.vitorias)} />
            {/* Média de nada não é zero: zero é uma nota ruim, ausência não é
                nota. Por isso o traço, e não um 0,0 que mentiria. */}
            <Numero
              rotulo="nota média"
              valor={dados.resumo.notaMedia === null ? '—' : dados.resumo.notaMedia.toFixed(1)}
              cor={dados.resumo.notaMedia === null ? undefined : CORES[faixaDe(dados.resumo.notaMedia)].cor}
            />
          </div>

          {dados.partidas.length === 0 ? (
            <p className="fraco" style={{ textAlign: 'center', fontSize: 13 }}>
              Nenhuma partida ainda. Só entram no histórico as que têm ao menos
              uma pessoa com conta na mesa.
            </p>
          ) : (
            <div className="cartao pilha" style={{ gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="rotulo">últimas partidas</span>
                {/* Quantas estão à vista de quantas existem. Sem isto, dez
                    linhas numa conta de quarenta partidas passam a impressão de
                    que o histórico só guarda dez. */}
                <span className="fraco" style={{ fontSize: 11 }}>
                  {dados.partidas.length} de {dados.resumo.partidas}
                </span>
              </div>
              {dados.partidas.map((p, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}
                >
                  <span style={{ width: 26, color: 'var(--texto-apagado)', fontSize: 11 }}>
                    {p.colocacao === null ? '—' : `${p.colocacao}º`}
                  </span>
                  <span style={{ flex: 1, color: 'var(--texto-medio)' }}>
                    {p.jogadores} na mesa · {p.rodadas} rodadas
                  </span>
                  <span style={{
                    fontVariantNumeric: 'tabular-nums', color: 'var(--texto-apagado)', fontSize: 12,
                  }}>
                    {p.acertos}/{p.jogadas}
                  </span>
                  <span style={{
                    width: 34, textAlign: 'right', fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: p.nota === null ? 'var(--texto-apagado)' : CORES[faixaDe(p.nota)].cor,
                  }}>
                    {p.nota === null ? '—' : p.nota.toFixed(1)}
                  </span>
                </div>
              ))}

              {dados.pagina.temMais && (
                <button
                  className="fantasma"
                  onClick={verMais}
                  disabled={buscandoMais}
                  style={{ marginTop: 4 }}
                >
                  {buscandoMais ? 'Buscando…' : 'Ver mais partidas'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </Folha>
  );
}

function Numero({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string | undefined }) {
  return (
    <div className="pilha" style={{ flex: 1, gap: 2, alignItems: 'center' }}>
      <span style={{
        fontSize: 22, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
        color: cor ?? 'var(--texto)',
      }}>
        {valor}
      </span>
      <span className="rotulo" style={{ fontSize: 10 }}>{rotulo}</span>
    </div>
  );
}
