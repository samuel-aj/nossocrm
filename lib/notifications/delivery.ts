import type { Notice, Preferences } from './types';
let audio: AudioContext | undefined;
export async function unlockNotificationSound() {
  audio ??= new AudioContext();
  await audio.resume();
}
export function playNotificationSound(options:Pick<Preferences,'soundType'|'volume'>={soundType:'current',volume:40}):boolean {
  if (!audio || audio.state !== 'running' || options.volume<=0) return false;
  // The old beep is unchanged at the default 40%; even at 100% the peak is 0.2.
  const peak=Math.min(100,options.volume)/40*0.08;
  const tones=options.soundType==='chime'
    ? [{frequency:880,delay:0,duration:0.16},{frequency:1175,delay:0.18,duration:0.32}]
    : options.soundType==='alert'
      ? [{frequency:660,delay:0,duration:0.13},{frequency:540,delay:0.16,duration:0.13},{frequency:660,delay:0.32,duration:0.22}]
      : [{frequency:740,delay:0,duration:0.22}];
  for(const tone of tones) {
    const oscillator=audio.createOscillator(),gain=audio.createGain();
    const start=audio.currentTime+tone.delay;
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.frequency.value=tone.frequency;
    gain.gain.setValueAtTime(peak,start);
    gain.gain.exponentialRampToValueAtTime(0.001,start+tone.duration);
    oscillator.start(start); oscillator.stop(start+tone.duration+0.01);
  }
  return true;
}
// Keep markers longer than the two-minute presentation window. Older incidents
// stay in history silently, so no unbounded incident registry is needed here.
export async function presentOnce(scope:string, id:string, callback:()=>boolean|void):Promise<'presented'|'duplicate'|'unavailable'|'skipped'> {
  if (!navigator.locks) return 'unavailable'; // Never risk duplicated sounds on unsupported browsers.
  if(document.visibilityState !== 'visible') await new Promise(resolve=>setTimeout(resolve,350));
  return navigator.locks.request(`crm-notices:${scope}`,async()=>{
    const key=`crm-notices:v1:${scope}`;
    let recent: Record<string, number>;
    try {
      const saved=JSON.parse(localStorage.getItem(key) || '{}') as Record<string,number>;
      if(saved[id]) return 'duplicate';
      recent=Object.fromEntries(Object.entries(saved).filter(([,t])=>t>Date.now()-180_000));
      recent[id]=Date.now(); localStorage.setItem(key,JSON.stringify(recent));
    } catch { return 'unavailable'; /* Browser storage disabled: keep only local UI. */ }
    if (callback() === false) {
      // A cancelled or silent background tab must leave the notice available to a visible tab.
      delete recent[id];
      localStorage.setItem(key, JSON.stringify(recent));
      return 'skipped';
    }
    return 'presented';
  });
}
export function deliverNotice(notice:Notice,p:Preferences,open:(href:string)=>void): boolean {
  const played = p.sound && playNotificationSound(p);
  if(p.desktop && 'Notification' in window && Notification.permission==='granted') {
    try {
      const notification=new Notification(notice.title,{body:notice.message,tag:`crm-${notice.id}`,silent:true});
      notification.onclick=()=>{window.focus();open(notice.href);notification.close();};
      setTimeout(()=>notification.close(),10_000);
      return true;
    } catch { /* Mobile browsers may not support the desktop constructor. */ }
  }
  return played;
}
