import { describe, expect, it } from 'vitest';
import {
  PASSWORD_LEAKED_MESSAGE,
  PASSWORD_RULES_MESSAGE,
  isPasswordValid,
  passwordRules,
  validatePassword,
  weakPasswordMessage,
  zPassword,
} from './passwordPolicy';

describe('regra de senha do CRM', () => {
  it('exige 8 caracteres, maiúscula, minúscula e número', () => {
    expect(validatePassword('Abcdef12')).toBeNull();
    expect(isPasswordValid('Abcdef12')).toBe(true);
    expect(validatePassword('Abc12')).toBe(PASSWORD_RULES_MESSAGE);
    expect(validatePassword('abcdefg1')).toBe(PASSWORD_RULES_MESSAGE);
    expect(validatePassword('ABCDEFG1')).toBe(PASSWORD_RULES_MESSAGE);
    expect(validatePassword('Abcdefgh')).toBe(PASSWORD_RULES_MESSAGE);
    expect(validatePassword('')).toBe(PASSWORD_RULES_MESSAGE);
  });

  it('informa cada requisito separado para a lista da tela', () => {
    expect(passwordRules('abc')).toEqual({ minLength: false, hasLowercase: true, hasUppercase: false, hasDigit: false });
    expect(passwordRules('Abcdef12')).toEqual({ minLength: true, hasLowercase: true, hasUppercase: true, hasDigit: true });
  });

  it('recusa senha acima do teto do Supabase', () => {
    expect(validatePassword(`Aa1${'x'.repeat(70)}`)).toMatch(/no máximo 72/);
  });

  it('o schema das rotas devolve a mensagem em português', () => {
    expect(zPassword.safeParse('Abcdef12').success).toBe(true);
    const bad = zPassword.safeParse('123456');
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe(PASSWORD_RULES_MESSAGE);
  });
});

describe('tradução da recusa do Supabase', () => {
  it('senha vazada', () => {
    const err = {
      name: 'AuthWeakPasswordError',
      code: 'weak_password',
      reasons: ['pwned'],
      message: 'Password is known to be weak and easy to guess, please choose a different one.',
    };
    expect(weakPasswordMessage(err)).toBe(PASSWORD_LEAKED_MESSAGE);
    // também quando só a mensagem chega (erro repassado como texto)
    expect(weakPasswordMessage(err.message)).toBe(PASSWORD_LEAKED_MESSAGE);
  });

  it('tamanho e caracteres', () => {
    expect(weakPasswordMessage({ code: 'weak_password', reasons: ['length'], message: 'Password should be at least 8 characters.' })).toBe(
      PASSWORD_RULES_MESSAGE,
    );
    expect(
      weakPasswordMessage({
        code: 'weak_password',
        reasons: ['characters'],
        message:
          'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.',
      }),
    ).toBe(PASSWORD_RULES_MESSAGE);
  });

  it('acompanha o painel quando ele está mais exigente que o CRM', () => {
    const msg = weakPasswordMessage({
      code: 'weak_password',
      reasons: ['length', 'characters'],
      message:
        'Password should be at least 12 characters. Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~.',
    });
    expect(msg).toMatch(/pelo menos 12 caracteres/);
    expect(msg).toMatch(/símbolo/);
  });

  it('curta e vazada ao mesmo tempo: fala das duas coisas', () => {
    const msg = weakPasswordMessage({ code: 'weak_password', reasons: ['length', 'pwned'], message: 'x' });
    expect(msg).toMatch(/pelo menos 8 caracteres/);
    expect(msg).toMatch(/vazamentos/);
  });

  it('não mexe em erro que não é de senha', () => {
    expect(weakPasswordMessage({ message: 'User already registered' })).toBeNull();
    expect(weakPasswordMessage({ code: '23505', message: 'duplicate key' })).toBeNull();
    expect(weakPasswordMessage(null)).toBeNull();
    expect(weakPasswordMessage('Invalid login credentials')).toBeNull();
  });
});
