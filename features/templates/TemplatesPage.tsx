'use client';

import React from 'react';
import { MessageTemplatesManager } from '@/features/settings/components/MessageTemplatesManager';

/** Página Modelos (grupo WhatsApp do menu): modelos de mensagem prontos. */
export const TemplatesPage: React.FC = () => (
  <div className="max-w-5xl mx-auto pb-10">
    <MessageTemplatesManager />
  </div>
);

export default TemplatesPage;
