import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_TYPING, type AgentTyping } from './types';
import { typingDelayMs } from './typing';

const ligado: AgentTyping = { ...DEFAULT_AGENT_TYPING, enabled: true };

describe('typingDelayMs', () => {
  it('desligado não espera nada', () => {
    expect(typingDelayMs('mensagem qualquer', DEFAULT_AGENT_TYPING)).toBe(0);
    expect(typingDelayMs('mensagem qualquer', null)).toBe(0);
  });

  it('texto vazio não espera nada', () => {
    expect(typingDelayMs('', ligado)).toBe(0);
    expect(typingDelayMs('   \n  ', ligado)).toBe(0);
  });

  it('mensagem maior demora mais', () => {
    const curta = typingDelayMs('x'.repeat(40), ligado);
    const media = typingDelayMs('x'.repeat(120), ligado);
    const longa = typingDelayMs('x'.repeat(160), ligado);
    expect(curta).toBeLessThan(media);
    expect(media).toBeLessThan(longa);
    expect(media).toBe(120 * ligado.ms_per_char);
  });

  it('respeita o piso e o teto', () => {
    expect(typingDelayMs('oi', ligado)).toBe(ligado.min_ms);
    expect(typingDelayMs('x'.repeat(5000), ligado)).toBe(ligado.max_ms);
  });

  it('configuração invertida não trava o envio', () => {
    const invertido: AgentTyping = { enabled: true, ms_per_char: 45, min_ms: 9000, max_ms: 2000 };
    expect(typingDelayMs('x'.repeat(300), invertido)).toBe(9000);
  });
});
