-- Duas mensagens recebidas da mesma conversa, gravadas ao mesmo tempo, travavam
-- uma na outra (deadlock) e uma delas não era gravada.
--
-- A checagem da chave estrangeira de wa_messages roda antes deste gatilho e já
-- segura a linha da conversa com FOR KEY SHARE. O gatilho pedia FOR UPDATE, que
-- conflita com FOR KEY SHARE: cada transação esperava a outra soltar a linha.
--
-- FOR NO KEY UPDATE convive com FOR KEY SHARE, então as gravações passam a
-- entrar em fila. Ele ainda conflita com o FOR UPDATE de quem agenda ou inicia
-- o retorno, e a ordem conversa -> execução continua a mesma.
create or replace function public.cancel_unstarted_robot_return_on_reply() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.direction='in' then
    -- Same lock order as schedule/begin: conversation, then run. An inbound
    -- committed while scheduling cannot leave a stale pending return behind.
    perform 1 from public.wa_conversations where id=new.conversation_id and organization_id=new.organization_id for no key update;
    update public.wa_bot_runs set status='cancelled',wake_at=null,updated_at=now(),error='Cliente respondeu antes do retorno'
    where organization_id=new.organization_id and conversation_id=new.conversation_id and scheduled_for is not null and scheduled_started_at is null and status='running'
      and (scheduled_anchor is null or new.created_at>scheduled_anchor);
  end if;
  return new;
end $$;
revoke all on function public.cancel_unstarted_robot_return_on_reply() from public,anon,authenticated;
