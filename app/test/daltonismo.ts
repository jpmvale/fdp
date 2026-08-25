/**
 * Simulação de dicromacia e distância perceptual.
 *
 * Existe para que `07` §4 — "a paleta de 8 cores DEVE ser validada para
 * distinção sob deuteranopia e protanopia" — seja **cobrada**, e não afirmada.
 * `08` §5 tratava isso como checagem manual antes da entrega; a checagem manual
 * foi feita, com um erro na simulação de deuteranopia, e o erro passou.
 *
 * Simulação: Viénot, Brettel & Mollon (1999), "Digital video colourmaps for
 * checking the legibility of displays by dichromats". As matrizes são aplicadas
 * sobre RGB **linear**, não sobre os valores com gama — aplicar sobre gama dá
 * resultados plausíveis o bastante para não levantar suspeita e errados o
 * bastante para inverter uma decisão de paleta.
 *
 * Distância: CIEDE2000. ΔE76 exagera diferenças em azuis e amarelos saturados
 * exatamente onde uma paleta de avatares vive, e foi o que fez a paleta original
 * parecer folgada — 21,8 por ΔE76 contra 2,0 por CIEDE2000 no mesmo par.
 */

export type Visao = 'normal' | 'deuteranopia' | 'protanopia';

export type RGB = readonly [number, number, number];

export function hexParaRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function rgbParaHex([r, g, b]: RGB): string {
  const oito = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `#${[r, g, b].map((v) => oito(v).toString(16).padStart(2, '0')).join('')}`;
}

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gama = (c: number): number => {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};

const RGB_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
] as const;

const LMS_RGB = [
  [0.080944, -0.130504, 0.116721],
  [-0.0102485, 0.0540194, -0.113615],
  [-0.000365294, -0.00412163, 0.693513],
] as const;

const aplicar = (m: readonly (readonly number[])[], v: RGB): RGB =>
  [0, 1, 2].map((i) => m[i]![0]! * v[0] + m[i]![1]! * v[1] + m[i]![2]! * v[2]) as unknown as RGB;

/** Como um dicromata vê esta cor. `normal` devolve a própria cor. */
export function simular(hex: string, visao: Visao): RGB {
  const rgb = hexParaRgb(hex);
  if (visao === 'normal') return rgb;

  const [L, M, S] = aplicar(RGB_LMS, rgb.map(linear) as unknown as RGB);

  // O cone que falta é reconstruído a partir dos outros dois: é o que colapsa
  // duas cores distintas numa só, e por isso é o passo que decide tudo aqui.
  const projetado: RGB =
    visao === 'protanopia'
      ? [2.02344 * M! - 2.52581 * S!, M!, S!]
      : [L!, 0.494207 * L! + 1.24827 * S!, S!];

  return aplicar(LMS_RGB, projetado).map(gama) as unknown as RGB;
}

function lab([r, g, b]: RGB): readonly [number, number, number] {
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const rad = (g: number) => (g * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000. Abaixo de ~2 duas cores são a mesma coisa a olho nu. */
export function deltaE(c1: RGB, c2: RGB): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = Cm > 0 ? 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7))) : 0;
  const a1l = (1 + G) * a1;
  const a2l = (1 + G) * a2;
  const C1l = Math.hypot(a1l, b1);
  const C2l = Math.hypot(a2l, b2);
  const h1 = a1l === 0 && b1 === 0 ? 0 : (deg(Math.atan2(b1, a1l)) + 360) % 360;
  const h2 = a2l === 0 && b2 === 0 ? 0 : (deg(Math.atan2(b2, a2l)) + 360) % 360;

  const dL = L2 - L1;
  const dC = C2l - C1l;
  let dh = 0;
  if (C1l * C2l !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1l * C2l) * Math.sin(rad(dh) / 2);

  const Lm = (L1 + L2) / 2;
  const Cml = (C1l + C2l) / 2;
  let hm = h1 + h2;
  if (C1l * C2l !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2;
    else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hm - 30)) +
    0.24 * Math.cos(rad(2 * hm)) +
    0.32 * Math.cos(rad(3 * hm + 6)) -
    0.2 * Math.cos(rad(4 * hm - 63));

  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cml;
  const Sh = 1 + 0.015 * Cml * T;
  const Rt =
    -Math.sin(rad(2 * (30 * Math.exp(-(((hm - 275) / 25) ** 2))))) *
    (Cml > 0 ? 2 * Math.sqrt(Cml ** 7 / (Cml ** 7 + 25 ** 7)) : 0);

  return Math.sqrt(
    (dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh),
  );
}

const luminancia = ([r, g, b]: RGB): number =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/** Razão de contraste da WCAG. RNF-030: 3:1 para elemento gráfico. */
export function contraste(a: RGB, b: RGB): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro! + 0.05) / (escuro! + 0.05);
}
