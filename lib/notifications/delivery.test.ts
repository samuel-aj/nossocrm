import {beforeEach,expect,it,vi} from 'vitest';
import {presentOnce,deliverNotice,playNotificationSound,unlockNotificationSound} from './delivery';
import {DEFAULT_PREFERENCES} from './types';
beforeEach(()=>{
  localStorage.clear();
  let queue=Promise.resolve();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,callback:()=>Promise<void>)=>{queue=queue.then(callback);return queue;}}});
});
it('deduplicates racing tabs and repeated overlapping polls',async()=>{const callback=vi.fn();await Promise.all([presentOnce('org:user','1',callback),presentOnce('org:user','1',callback)]);await presentOnce('org:user','1',callback);expect(callback).toHaveBeenCalledTimes(1);});
it('keeps users and organizations independent',async()=>{const callback=vi.fn();await presentOnce('org:user','1',callback);await presentOnce('org:other','1',callback);await presentOnce('other:user','1',callback);expect(callback).toHaveBeenCalledTimes(3);});
it('releases a silent background claim so a later visible tab can show the incident once', async () => {
  const silent = { ...DEFAULT_PREFERENCES, sound: false, desktop: false };
  const notice = { id:'incident', kind:'alert' as const, title:'Teste', message:'', href:'/chats', createdAt:'2026-11-27T12:00:00Z' };
  expect(await presentOnce('org:user', notice.id, () => deliverNotice(notice, silent, vi.fn()))).toBe('skipped');
  const showToast = vi.fn(() => true);
  expect(await presentOnce('org:user', notice.id, showToast)).toBe('presented');
  expect(await presentOnce('org:user', notice.id, showToast)).toBe('duplicate');
  expect(showToast).toHaveBeenCalledTimes(1);
});
it('returns a duplicate result after a remount while the notice could still be fresh',async()=>{
  const callback=vi.fn();
  const clock=vi.spyOn(Date,'now').mockReturnValue(10_000);
  try {
    expect(await presentOnce('org:user','incident',callback)).toBe('presented');
    clock.mockReturnValue(130_000);
    await presentOnce('org:user','another-notice',vi.fn());
    expect(await presentOnce('org:user','incident',callback)).toBe('duplicate');
    expect(callback).toHaveBeenCalledTimes(1);
  } finally { clock.mockRestore(); }
});
it('does not deliver sound or desktop alerts without cross-tab locks',async()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
  const callback=vi.fn();
  expect(await presentOnce('org:user','incident',callback)).toBe('unavailable');
  expect(callback).not.toHaveBeenCalled();
});
it('distinguishes unavailable storage from a duplicate for the local toast fallback',async()=>{
  const callback=vi.fn();
  const write=vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('Storage disabled');});
  try {
    expect(await presentOnce('org:user','incident',callback)).toBe('unavailable');
    expect(callback).not.toHaveBeenCalled();
  } finally { write.mockRestore(); }
});
it('does not classify a delivery failure as unavailable storage or retry the delivery',async()=>{
  const callback=vi.fn(()=>{throw new Error('Audio unavailable');});
  await expect(presentOnce('org:user','incident',callback)).rejects.toThrow('Audio unavailable');
  expect(JSON.parse(localStorage.getItem('crm-notices:v1:org:user')!)).toHaveProperty('incident');
  expect(callback).toHaveBeenCalledTimes(1);
});
it('does not request desktop permission while receiving an event',()=>{const requestPermission=vi.fn();vi.stubGlobal('Notification',Object.assign(vi.fn(),{permission:'default',requestPermission}));deliverNotice({id:'1',kind:'message',title:'Test',message:'Test',href:'/chats',createdAt:new Date().toISOString()},{...DEFAULT_PREFERENCES,desktop:true},vi.fn());expect(requestPermission).not.toHaveBeenCalled();vi.unstubAllGlobals();});

it('uses distinct, bounded sound envelopes and skips oscillator creation at zero volume',async()=>{
  const oscillators:Array<{frequency:{value:number};start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>}>=[];
  const gains:Array<{gain:{setValueAtTime:ReturnType<typeof vi.fn>;exponentialRampToValueAtTime:ReturnType<typeof vi.fn>}}>=[];
  const context={state:'running',currentTime:10,destination:{},resume:vi.fn().mockResolvedValue(undefined),
    createOscillator:vi.fn(()=>{const oscillator={frequency:{value:0},connect:vi.fn(),start:vi.fn(),stop:vi.fn()};oscillators.push(oscillator);return oscillator;}),
    createGain:vi.fn(()=>{const gain={gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn()};gains.push(gain);return gain;})};
  vi.stubGlobal('AudioContext',class {constructor(){return context;}});
  await unlockNotificationSound();
  expect(playNotificationSound({soundType:'current',volume:0})).toBe(false);
  expect(context.createOscillator).not.toHaveBeenCalled();
  expect(playNotificationSound({soundType:'current',volume:40})).toBe(true);
  expect(oscillators.map(o=>o.frequency.value)).toEqual([740]);
  expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.08,10);
  playNotificationSound({soundType:'chime',volume:100});
  expect(oscillators.slice(1).map(o=>o.frequency.value)).toEqual([880,1175]);
  expect(gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0.2,10);
  playNotificationSound({soundType:'alert',volume:100});
  expect(oscillators.slice(3).map(o=>o.frequency.value)).toEqual([660,540,660]);
  expect(gains.every(g=>g.gain.setValueAtTime.mock.calls.every(([peak])=>peak<=0.2))).toBe(true);
  expect(oscillators.every(o=>o.start.mock.calls.length===1 && o.stop.mock.calls.length===1)).toBe(true);
  const played=oscillators.length;
  deliverNotice({id:'silent',kind:'message',title:'Test',message:'Test',href:'/chats',createdAt:new Date().toISOString()},{...DEFAULT_PREFERENCES,sound:false},vi.fn());
  expect(oscillators).toHaveLength(played);
  context.state='suspended';
  expect(playNotificationSound({soundType:'alert',volume:100})).toBe(false);
  expect(oscillators).toHaveLength(played);
  vi.unstubAllGlobals();
});
