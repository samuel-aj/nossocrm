export const lossCategoryLabel = (category?: string) => category === 'qualified' ? 'Qualificado' : category === 'disqualified' ? 'Desqualificado' : 'Classificação não informada';
export const lossReasonLabel = (reason?: string) => reason?.trim() || 'Não informado';
export const lossDetailsDescription = (category?: string, reason?: string) => `Classificação: ${lossCategoryLabel(category)}\nMotivo da perda: ${lossReasonLabel(reason)}`;
