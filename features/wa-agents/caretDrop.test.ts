import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { caretIndexFromPoint } from './PromptEditor';

/**
 * Arrastar um chip até um ponto do roteiro: a posição precisa vir da textarea.
 * A camada de destaque (o espelho colorido) fica atrás e NÃO pode responder —
 * quando ela respondia, o navegador devolvia a posição dentro de um pedaço
 * colorido e o token caía no fim do texto.
 */
type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

let textarea: HTMLTextAreaElement;
let espelho: HTMLPreElement;
const doc = document as CaretDoc;
const original = { pos: doc.caretPositionFromPoint, range: doc.caretRangeFromPoint };

beforeEach(() => {
  textarea = document.createElement('textarea');
  textarea.value = 'Olá {{nome_lead}}, tudo bem por aí?';
  espelho = document.createElement('pre');
  espelho.setAttribute('data-token-mirror', 'true');
  const pedaco = document.createElement('span');
  pedaco.textContent = '{{nome_lead}}';
  espelho.appendChild(pedaco);
  document.body.append(espelho, textarea);
});

afterEach(() => {
  doc.caretPositionFromPoint = original.pos;
  doc.caretRangeFromPoint = original.range;
  document.body.innerHTML = '';
});

describe('caretIndexFromPoint', () => {
  it('aceita a posição quando o ponto cai na textarea', () => {
    doc.caretPositionFromPoint = () => ({ offsetNode: textarea, offset: 12 });
    doc.caretRangeFromPoint = undefined;
    expect(caretIndexFromPoint(textarea, 10, 10)).toBe(12);
  });

  it('limita ao tamanho do texto', () => {
    doc.caretPositionFromPoint = () => ({ offsetNode: textarea, offset: 9999 });
    doc.caretRangeFromPoint = undefined;
    expect(caretIndexFromPoint(textarea, 10, 10)).toBe(textarea.value.length);
  });

  it('recusa a posição quando o ponto cai na camada de destaque', () => {
    const noDoEspelho = espelho.firstChild!.firstChild ?? espelho.firstChild!;
    doc.caretPositionFromPoint = () => ({ offsetNode: noDoEspelho, offset: 3 });
    doc.caretRangeFromPoint = undefined;
    expect(caretIndexFromPoint(textarea, 10, 10)).toBeNull();
  });

  it('recusa também pelo caminho antigo (caretRangeFromPoint)', () => {
    const noDoEspelho = espelho.firstChild!.firstChild ?? espelho.firstChild!;
    doc.caretPositionFromPoint = undefined;
    doc.caretRangeFromPoint = () => ({ startContainer: noDoEspelho, startOffset: 3 }) as unknown as Range;
    expect(caretIndexFromPoint(textarea, 10, 10)).toBeNull();
  });

  it('sem suporte do navegador devolve null (o chamador usa o cursor atual)', () => {
    doc.caretPositionFromPoint = undefined;
    doc.caretRangeFromPoint = undefined;
    expect(caretIndexFromPoint(textarea, 10, 10)).toBeNull();
  });
});
