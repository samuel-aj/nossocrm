-- Remover usuário da equipe estava BLOQUEADO pelo banco: várias colunas
-- (deals.owner_id, activities.owner_id, contacts.owner_id, boards.owner_id,
-- api_keys.created_by etc.) referenciam profiles(id) sem regra de ON DELETE,
-- então apagar um perfil que era responsável por qualquer registro falhava.
-- Decisão do Samuel (opção 2): ao remover o usuário, os registros dele ficam
-- SEM responsável. Toda FK que aponta pra profiles com NO ACTION passa a
-- ON DELETE SET NULL; FKs que já têm CASCADE ou SET NULL ficam como estão.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname,
           con.conrelid::regclass AS tbl,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.profiles'::regclass
      AND con.confdeltype = 'a' -- NO ACTION (bloqueia o delete hoje)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I %s ON DELETE SET NULL',
      r.tbl, r.conname, r.def
    );
  END LOOP;
END $$;
