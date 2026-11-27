-- Prints, áudios e arquivos da caixa de ajustes. Privado: só links temporários do servidor.
-- Tamanho e tipos iguais a FEEDBACK_LIMITS.bytes e ALLOWED_MIME (lib/feedback/constants.ts).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-anexos', 'feedback-anexos', false, 10485760, ARRAY[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm', 'audio/wav',
  'application/pdf', 'text/plain', 'text/csv', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]::text[])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
