'use client';

/**
 * Onde o cursor cai, medido NA CAMADA DE DESTAQUE.
 *
 * O navegador não dá uma resposta confiável para "que posição do texto está sob
 * este ponto?" dentro de uma <textarea> (`caretPositionFromPoint` devolve coisas
 * diferentes em cada navegador, às vezes o próprio elemento, às vezes nada). Como
 * o espelho colorido tem a MESMA fonte, o mesmo padding, a mesma largura e a
 * mesma rolagem da textarea, dá para medir nele com Range e chegar ao índice
 * exato — igual em todo navegador.
 *
 * Busca binária: a posição do cursor cresce na ordem de leitura (de cima para
 * baixo, da esquerda para a direita), então ~14 medições resolvem um roteiro de
 * 14 mil caracteres.
 */

type CaretPosition = { offsetNode: Node; offset: number };
type DocumentWithCaret = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * Reserva: pergunta a posição ao navegador (`caretPositionFromPoint`, com
 * `caretRangeFromPoint` como segunda opção). Cada navegador responde de um
 * jeito, por isso isto só é usado quando a medição no espelho não dá.
 * Um ponto que caia na camada de destaque é recusado.
 */
export function caretIndexFromPoint(el: HTMLTextAreaElement, x: number, y: number): number | null {
  const doc = el.ownerDocument as DocumentWithCaret;
  const clamp = (n: number) => Math.max(0, Math.min(n, el.value.length));
  const noEspelho = (node: Node | null | undefined): boolean => {
    const start = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    return !!start?.closest?.('[data-token-mirror]');
  };
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos && !noEspelho(pos.offsetNode) && (pos.offsetNode === el || pos.offsetNode.nodeType === Node.TEXT_NODE)) {
      return clamp(pos.offset);
    }
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (
      range &&
      !noEspelho(range.startContainer) &&
      (range.startContainer === el || range.startContainer.nodeType === Node.TEXT_NODE)
    ) {
      return clamp(range.startOffset);
    }
  }
  return null;
}

/** Nós de texto do espelho, em ordem, com o índice global onde cada um começa. */
function textNodes(mirror: HTMLElement): Array<{ node: Text; start: number }> {
  const out: Array<{ node: Text; start: number }> = [];
  const walker = mirror.ownerDocument.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
  let start = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    out.push({ node, start });
    start += node.data.length;
    node = walker.nextNode() as Text | null;
  }
  return out;
}

/** Retângulo do cursor no índice `index` (colapsado), em coordenadas da janela. */
export function caretRectAt(mirror: HTMLElement, index: number): DOMRect | null {
  const nodes = textNodes(mirror);
  if (nodes.length === 0) return null;
  const total = nodes[nodes.length - 1].start + nodes[nodes.length - 1].node.data.length;
  const alvo = Math.max(0, Math.min(index, total));
  // Nó que contém o índice (o último cujo início é <= alvo)
  let escolhido = nodes[0];
  for (const n of nodes) {
    if (n.start <= alvo) escolhido = n;
    else break;
  }
  const offset = Math.max(0, Math.min(alvo - escolhido.start, escolhido.node.data.length));
  const range = mirror.ownerDocument.createRange();
  try {
    range.setStart(escolhido.node, offset);
    range.collapse(true);
  } catch {
    return null;
  }
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
  // Cursor colapsado no fim de uma linha pode vir sem altura: usa o retângulo do nó
  if (!rect || (rect.height === 0 && rect.width === 0 && rect.top === 0 && rect.left === 0)) return null;
  return rect as DOMRect;
}

/** true quando o ponto (x, y) vem DEPOIS do cursor desenhado em `rect`. */
function depois(rect: DOMRect, x: number, y: number): boolean {
  if (y < rect.top) return false;
  if (y > rect.bottom) return true;
  return x > rect.left;
}

/**
 * Índice do texto sob o ponto (x, y), medido no espelho. null quando não dá
 * para medir (sem layout, espelho vazio) — aí o chamador usa o cursor atual.
 */
export function indexFromPoint(mirror: HTMLElement | null, x: number, y: number): number | null {
  if (!mirror) return null;
  const nodes = textNodes(mirror);
  if (nodes.length === 0) return null;
  const total = nodes[nodes.length - 1].start + nodes[nodes.length - 1].node.data.length;
  if (total === 0) return 0;

  // Sem layout (ambiente de teste) todas as medidas são zero: não force um palpite
  const primeiro = caretRectAt(mirror, 0);
  if (!primeiro) return null;

  let baixo = 0;
  let alto = total;
  while (baixo < alto) {
    const meio = Math.floor((baixo + alto) / 2);
    const rect = caretRectAt(mirror, meio);
    if (!rect) return null;
    if (depois(rect, x, y)) baixo = meio + 1;
    else alto = meio;
  }
  return baixo;
}
