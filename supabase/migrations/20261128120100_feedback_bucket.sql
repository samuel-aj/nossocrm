-- Prints, áudios e arquivos da caixa de ajustes. Privado: só links temporários do servidor.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('feedback-anexos', 'feedback-anexos', false, 10485760)
ON CONFLICT (id) DO NOTHING;
