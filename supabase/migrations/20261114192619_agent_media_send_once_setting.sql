-- Preserve the existing once-per-conversation behavior while making it configurable per asset.
alter table public.wa_ai_agent_media
  add column if not exists send_once_per_conversation boolean not null default true;

comment on column public.wa_ai_agent_media.send_once_per_conversation is
  'Blocks agent repeats of this asset in the same conversation. When false, the 60-second media cooldown still applies.';
