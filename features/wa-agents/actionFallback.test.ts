import { describe, expect, it } from 'vitest';
import type { EndAction } from '@/lib/wa-agents/types';
import { ACTION_ICONS, ACTION_LABELS, actionIcon, actionLabel, describeAction } from './OutcomesEditor';

/**
 * Uma ação gravada por uma versão mais nova do CRM (aba antiga aberta, agente
 * configurado pela API) não pode derrubar o editor: antes, `ACTION_ICONS[tipo]`
 * vinha undefined e a tela inteira quebrava no painel de erro.
 */
const desconhecida = { type: 'acao_do_futuro', algo: 1 } as unknown as EndAction;

describe('ação de tipo desconhecido', () => {
  it('tem ícone', () => {
    expect(actionIcon('acao_do_futuro')).toBeTypeOf('object');
    expect(actionIcon('move_stage')).toBe(ACTION_ICONS.move_stage);
  });

  it('tem rótulo que explica de onde veio', () => {
    expect(actionLabel('acao_do_futuro')).toContain('acao_do_futuro');
    expect(actionLabel('add_tag')).toBe(ACTION_LABELS.add_tag);
  });

  it('é descrita em texto, sem devolver undefined', () => {
    const texto = describeAction(desconhecida, [], undefined);
    expect(typeof texto).toBe('string');
    expect(texto.length).toBeGreaterThan(0);
    // o chamador faz text.charAt(0).toUpperCase(): não pode explodir
    expect(() => texto.charAt(0).toUpperCase()).not.toThrow();
  });

  it('continua descrevendo as ações conhecidas', () => {
    expect(describeAction({ type: 'stop' }, [], undefined)).toBe('encerrar e entregar ao atendente');
    expect(describeAction({ type: 'add_tag', tag: 'Quente' }, [], undefined)).toBe('adicionar rótulo "Quente"');
  });
});
