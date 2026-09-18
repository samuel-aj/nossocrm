import {beforeEach,expect,it,vi} from 'vitest';
import {presentOnce,deliverNotice} from './delivery';
import {DEFAULT_PREFERENCES} from './types';
beforeEach(()=>{
  localStorage.clear();
  let queue=Promise.resolve();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,callback:()=>Promise<void>)=>{queue=queue.then(callback);return queue;}}});
});
it('deduplicates racing tabs and repeated overlapping polls',async()=>{const callback=vi.fn();await Promise.all([presentOnce('org:user','1',callback),presentOnce('org:user','1',callback)]);await presentOnce('org:user','1',callback);expect(callback).toHaveBeenCalledTimes(1);});
it('keeps users and organizations independent',async()=>{const callback=vi.fn();await presentOnce('org:user','1',callback);await presentOnce('org:other','1',callback);await presentOnce('other:user','1',callback);expect(callback).toHaveBeenCalledTimes(3);});
it('does not request desktop permission while receiving an event',()=>{const requestPermission=vi.fn();vi.stubGlobal('Notification',Object.assign(vi.fn(),{permission:'default',requestPermission}));deliverNotice({id:'1',kind:'message',title:'Test',message:'Test',href:'/chats',createdAt:new Date().toISOString()},{...DEFAULT_PREFERENCES,desktop:true},vi.fn());expect(requestPermission).not.toHaveBeenCalled();vi.unstubAllGlobals();});
