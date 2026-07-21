'use client';

import React from 'react';
import { WhatsAppConnectionSettings } from './WhatsAppConnectionSettings';

/** Página Conexão (grupo WhatsApp do menu): conectar o número do escritório. */
export const WhatsAppConnectionPage: React.FC = () => (
  <div className="max-w-5xl mx-auto pb-10">
    <WhatsAppConnectionSettings />
  </div>
);

export default WhatsAppConnectionPage;
