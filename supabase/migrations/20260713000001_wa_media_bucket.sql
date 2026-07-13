-- Bucket PRIVADO para mídias do WhatsApp (imagens, vídeos, áudios, documentos,
-- figurinhas). Sem policies de usuário de propósito: escrita/leitura acontecem
-- só pelo servidor (service role) — o app entrega URLs assinadas de curta
-- duração pro chat. Limite de 50MB por arquivo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-media', 'wa-media', false, 52428800)
on conflict (id) do nothing;
