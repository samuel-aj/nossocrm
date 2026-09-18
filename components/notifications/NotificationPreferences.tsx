'use client';
import {useState} from 'react';
import {Modal} from '@/components/ui/Modal';
import {FormCheckbox,FormSelect} from '@/components/ui/FormControls';
import {unlockNotificationSound,playNotificationSound} from '@/lib/notifications/delivery';
import type {NotificationSettings,Preferences} from '@/lib/notifications/types';
export function NotificationPreferences({settings,onClose,onSave,onTest}:{settings:NotificationSettings;onClose:()=>void;onSave:(p:Preferences)=>Promise<void>;onTest:(p:Preferences)=>void}) {
  const [draft,setDraft]=useState(settings.preferences),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [permission,setPermission]=useState(typeof Notification==='undefined' ? 'unsupported' : Notification.permission);
  const set=(patch:Partial<Preferences>)=>setDraft(p=>({...p,...patch}));
  const button='rounded-lg px-4 py-2 text-sm font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-white/5';
  async function desktop(enabled:boolean) {
    if(!enabled){set({desktop:false});return;}
    if(!('Notification' in window)){setPermission('unsupported');return;}
    try {const result=await Notification.requestPermission();setPermission(result);if(result==='granted')set({desktop:true});}
    catch {setError('Este navegador não permitiu ativar os avisos no computador.');}
  }
  return <Modal isOpen onClose={onClose} title="Preferências de notificações" size="md">
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      <p className="text-sm text-slate-500">Suas preferências nesta organização. Os avisos funcionam enquanto o CRM estiver aberto, mesmo em outra aba.</p>
      <section className="space-y-3">
        <FormCheckbox label="Novas mensagens de leads" checked={draft.messages} onChange={messages=>set({messages})}>Novas mensagens de leads</FormCheckbox>
        {draft.messages && <FormSelect label="Receber mensagens de" value={draft.scope} onChange={scope=>set({scope:scope as Preferences['scope']})} options={[{value:'own',label:'Meus leads'},{value:'all',label:'Todos que posso visualizar'}]}/>}
      </section>
      <section className="space-y-3">
        <FormCheckbox label="Novos leads nos boards" checked={draft.leads} onChange={leads=>set({leads})}>Novos leads nos boards</FormCheckbox>
        {draft.leads && <><p className="text-xs text-slate-500">Avise quando um lead for criado ou transferido para os boards selecionados.</p>
          <div className="max-h-44 overflow-y-auto space-y-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            {settings.boards.length===0 ? <p className="text-sm">Nenhum board disponível.</p> : settings.boards.map(b=><FormCheckbox key={b.id} label={b.name} checked={draft.boardIds.includes(b.id)} onChange={checked=>set({boardIds:checked ? [...draft.boardIds,b.id] : draft.boardIds.filter(id=>id!==b.id)})}>{b.name}</FormCheckbox>)}
          </div>{draft.boardIds.length===0 && <p className="text-xs text-amber-600">Selecione ao menos um board para receber esses avisos.</p>}</>}
      </section>
      <section className="space-y-3 border-t border-slate-200 dark:border-slate-700 pt-4">
        <p className="text-sm font-medium">Onde avisar</p>
        <p className="text-xs text-slate-500">No CRM, os avisos aparecem na tela e ficam no sino durante esta sessão.</p>
        <FormCheckbox label="Também no computador" checked={draft.desktop} onChange={enabled=>void desktop(enabled)}>Também no computador</FormCheckbox>
        {permission==='denied' && <p className="text-xs text-amber-600">Notificações bloqueadas neste navegador. Libere nas configurações do site para usar os avisos no computador.</p>}
        {permission==='unsupported' && <p className="text-xs text-amber-600">Este navegador não oferece avisos no computador. Os avisos no CRM continuam disponíveis.</p>}
        {draft.desktop && permission==='default' && <button className={button} onClick={()=>void desktop(true)}>Permitir neste navegador</button>}
        <FormCheckbox label="Reproduzir som" checked={draft.sound} onChange={sound=>{set({sound});if(sound)void unlockNotificationSound().then(()=>playNotificationSound()).catch(()=>setError('Clique em Testar aviso para liberar o som.'));}}>Reproduzir som</FormCheckbox>
        <p className="text-xs text-slate-500">Após abrir o CRM, clique na página para liberar o som. Suspensão do computador ou da aba pode atrasar avisos.</p>
        <button className={button} onClick={()=>{if(draft.sound)void unlockNotificationSound().then(()=>onTest(draft)).catch(()=>setError('Não foi possível liberar o som neste navegador.'));else onTest(draft);}}>Testar aviso</button>
      </section>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-3"><button className={button} onClick={onClose} disabled={busy}>Cancelar</button><button className="rounded-lg bg-primary-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50" disabled={busy || (draft.leads && !draft.boardIds.length)} onClick={async()=>{setBusy(true);setError('');try{await onSave(draft);onClose();}catch(e){setError(e instanceof Error ? e.message : 'Erro ao salvar.');}finally{setBusy(false);}}}>{busy?'Salvando…':'Salvar preferências'}</button></div>
    </div>
  </Modal>;
}
