'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { WhatsAppConnectionSettings } from './WhatsAppConnectionSettings';

/** Página Conexão (grupo WhatsApp do menu): conectar o número do escritório. */
export const WhatsAppConnectionPage: React.FC = () => {
  const params = useSearchParams();
  return <div className="max-w-5xl mx-auto pb-10">
    <WhatsAppConnectionSettings alertsOnly={params?.get('aba') === 'alertas'} />
  </div>;
};

export default WhatsAppConnectionPage;
