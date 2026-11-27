import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {NotificationPreferences} from './NotificationPreferences';
import {DEFAULT_PREFERENCES} from '@/lib/notifications/types';

vi.mock('@/components/ui/Modal',()=>({Modal:({children,footer}:{children:React.ReactNode;footer:React.ReactNode})=><div>{children}{footer}</div>}));
vi.mock('@/components/ui/FormControls',()=>({
  FormCheckbox:({label,checked,onChange,children}:{label:string;checked:boolean;onChange:(checked:boolean)=>void;children:React.ReactNode})=><label><input type="checkbox" aria-label={label} checked={checked} onChange={event=>onChange(event.target.checked)}/>{children}</label>,
  FormSelect:({label,value,onChange,options}:{label:string;value:string;onChange:(value:string)=>void;options:Array<{value:string;label:string}>})=><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock('@/lib/notifications/delivery',()=>({unlockNotificationSound:vi.fn().mockResolvedValue(undefined),playNotificationSound:vi.fn()}));
const device = vi.hoisted(() => ({
  pushSupport: () => 'ready', readPushDevice: vi.fn(async () => ({ enabled: false, publicKey: 'test-key' })),
  enablePushDevice: vi.fn(), disablePushDevice: vi.fn(),
}));
vi.mock('@/lib/notifications/pushDevice', () => device);

it('puts device opt-in before the lead controls and applies the selected filter on save',async()=>{
  const onSave=vi.fn();
  render(<NotificationPreferences settings={{preferences:DEFAULT_PREFERENCES,boards:[]}} deviceScope={{userId:'signed-in',organizationId:'office'}} onClose={vi.fn()} onSave={onSave} onTest={vi.fn()}/>);
  const button=screen.getByRole('button',{name:'Ativar neste aparelho'});
  await waitFor(()=>expect(button).toBeEnabled());
  const boards = screen.getByRole('checkbox', {name:'Novos leads nos boards'});
  expect(button.compareDocumentPosition(boards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async()=>{fireEvent.click(button);});
  expect(screen.getByRole('checkbox',{name:'Novas mensagens de leads'})).toBeChecked();
  const scope=screen.getByRole('combobox',{name:'Receber mensagens de'});
  expect(scope).toHaveValue('own');
  fireEvent.change(scope,{target:{value:'all'}});
  expect(onSave).not.toHaveBeenCalled();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Salvar preferências'}));});
  expect(onSave).toHaveBeenCalledWith({...DEFAULT_PREFERENCES,messages:true,scope:'all'});
});

it('tests unsaved sound and volume without saving preferences',async()=>{
  const onTest=vi.fn(),onSave=vi.fn();
  render(<NotificationPreferences settings={{preferences:{...DEFAULT_PREFERENCES,sound:true},boards:[]}} onClose={vi.fn()} onSave={onSave} onTest={onTest}/>);
  fireEvent.change(screen.getByRole('combobox',{name:'Tipo de som'}),{target:{value:'chime'}});
  fireEvent.change(screen.getByRole('slider',{name:'Volume do aviso'}),{target:{value:'85'}});
  fireEvent.click(screen.getByRole('button',{name:'Testar aviso'}));
  await vi.waitFor(()=>expect(onTest).toHaveBeenCalledWith(expect.objectContaining({soundType:'chime',volume:85,sound:true})));
  expect(onSave).not.toHaveBeenCalled();
});
