import { weakPasswordMessage } from '@/lib/security/passwordPolicy';

/**
 * Função pública `getErrorMessage` do projeto.
 *
 * @param {unknown} error - Parâmetro `error`.
 * @returns {string} Retorna um valor do tipo `string`.
 */
export const getErrorMessage = (error: unknown): string => {
    if (!error) return 'Ocorreu um erro desconhecido.';

    // Senha recusada pelo Supabase (curta, sem os caracteres exigidos ou vazada).
    const weakPassword = weakPasswordMessage(error);
    if (weakPassword) return weakPassword;

    let message = 'Erro desconhecido.';
    if (typeof error === 'string') {
        message = error;
    } else if (error instanceof Error) {
        message = error.message;
    } else if (typeof error === 'object' && 'message' in error) {
        message = String((error as { message: unknown }).message);
    }

    // Mapas de tradução
    const translations: Record<string, string> = {
        'Invalid login credentials': 'Email ou senha incorretos.',
        'Email not confirmed': 'Por favor, confirme seu email antes de entrar.',
        'User not found': 'Usuário não encontrado.',
        'New password should be different from the old password.': 'A nova senha deve ser diferente da senha anterior.',
        'Token has expired or is invalid': 'O link expirou ou é inválido.',
        'Auth session missing!': 'Sessão expirada. Por favor, faça login novamente.',
        'User already registered': 'Este email já está cadastrado.',
        'Rate limit exceeded': 'Muitas tentativas. Por favor, aguarde um momento.',
    };

    // Verificação exata
    if (translations[message]) {
        return translations[message];
    }

    // Verificações parciais (para mensagens dinâmicas ou variações)
    if (message.includes('weak password')) return 'Sua senha é muito fraca.';
    if (message.includes('already registered')) return 'Este email já está em uso.';
    if (message.includes('invalid login')) return 'Credenciais inválidas.';
    if (message.includes('unexpected error')) return 'Ocorreu um erro inesperado. Tente novamente.';

    // Retorno original se não houver tradução (fallback)
    return message;
};
