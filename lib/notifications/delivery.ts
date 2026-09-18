import type { Notice, Preferences } from './types';
let audio: AudioContext | undefined;
export async function unlockNotificationSound() {
  audio ??= new AudioContext();
  await audio.resume();
}
export function playNotificationSound() {
  if (!audio || audio.state !== 'running') return false;
  const oscillator=audio.createOscillator(),gain=audio.createGain();
  oscillator.connect(gain); gain.connect(audio.destination);
  oscillator.frequency.value=740;
  gain.gain.setValueAtTime(0.08,audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+0.22);
  oscillator.start(); oscillator.stop(audio.currentTime+0.23);
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
  if(p.sound) playNotificationSound();
  if(p.desktop && 'Notification' in window && Notification.permission==='granted') {
    try {
      const notification=new Notification(notice.title,{body:notice.message,tag:`crm-${notice.id}`,silent:true});
      notification.onclick=()=>{window.focus();open(notice.href);notification.close();};
      setTimeout(()=>notification.close(),10_000);
    } catch { /* Mobile browsers may not support the desktop constructor. */ }
  }
}
