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
// One short-lived marker map per account/org; no message content stored.
export async function presentOnce(scope:string, id:string, callback:()=>void) {
  if (!navigator.locks) return; // Never risk duplicated sounds on unsupported browsers.
  if(document.visibilityState !== 'visible') await new Promise(resolve=>setTimeout(resolve,350));
  await navigator.locks.request(`crm-notices:${scope}`,async()=>{
    const key=`crm-notices:v1:${scope}`;
    try {
      const saved=JSON.parse(localStorage.getItem(key) || '{}') as Record<string,number>;
      if(saved[id]) return;
      const recent=Object.fromEntries(Object.entries(saved).filter(([,t])=>t>Date.now()-180_000));
      recent[id]=Date.now(); localStorage.setItem(key,JSON.stringify(recent));
      callback();
    } catch { /* Browser storage disabled: in-app history still works. */ }
  });
}
export function deliverNotice(notice:Notice,p:Preferences,open:(href:string)=>void) {
  if(p.sound) playNotificationSound(p);
  if(p.desktop && 'Notification' in window && Notification.permission==='granted') {
    try {
      const notification=new Notification(notice.title,{body:notice.message,tag:`crm-${notice.id}`,silent:true});
      notification.onclick=()=>{window.focus();open(notice.href);notification.close();};
      setTimeout(()=>notification.close(),10_000);
    } catch { /* Mobile browsers may not support the desktop constructor. */ }
  }
}
