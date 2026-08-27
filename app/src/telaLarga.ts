import { useEffect, useState } from 'react';

/**
 * A mesma largura que o CSS usa para pôr o chat na lateral (`estilos.css`).
 *
 * Duplicada aqui porque CSS e JavaScript não compartilham valor, e o jeito de
 * não deixar as duas divergirem é dizer em voz alta que são a mesma: se uma
 * mudar, a outra muda junto. A alternativa — ler a variável CSS em tempo de
 * execução — troca uma duplicação visível por um acoplamento invisível.
 */
export const LARGURA_LATERAL = 900;

/**
 * `true` quando o chat está na lateral.
 *
 * Serve para UMA coisa: decidir se o chat começa aberto. Na lateral ele tem
 * espaço próprio e fechado seria uma coluna vazia ao lado da mesa; embaixo, no
 * celular, aberto empurraria a mão de cartas para fora da tela.
 *
 * Nada de layout depende disto — o layout é do CSS. Ler a largura em
 * JavaScript para posicionar coisas é como o Feltro faria se não pudesse usar
 * media query, e traz de volta todos os problemas que a media query resolve.
 */
export function useTelaLarga(): boolean {
  const [larga, setLarga] = useState(
    // Já no primeiro render, e não num efeito: começar `false` e corrigir
    // depois faria o painel piscar fechado→aberto em toda entrada na mesa.
    () => typeof window !== 'undefined'
      && window.matchMedia(`(min-width: ${String(LARGURA_LATERAL)}px)`).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${String(LARGURA_LATERAL)}px)`);
    const aoMudar = (e: MediaQueryListEvent): void => setLarga(e.matches);
    mq.addEventListener('change', aoMudar);
    // Reconfere na montagem: entre o `useState` inicial e este efeito a janela
    // pode ter mudado, e girar o tablet é exatamente isso acontecendo.
    setLarga(mq.matches);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  return larga;
}
