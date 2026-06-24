-- =============================================================================
-- SUGGESTIONS / FEEDBACK (beta)
-- Mural de sugestoes por organizacao: qualquer usuario logado posta; cada um ve
-- as sugestoes da propria org; super_admin ve todas; votos (1 por usuario).
-- =============================================================================

-- Helpers SECURITY DEFINER (evitam recursao de RLS ao consultar profiles)
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT organization_id FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_user_is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin') $$;

-- Tabela suggestions
CREATE TABLE IF NOT EXISTS public.suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suggestions_org ON public.suggestions(organization_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_author ON public.suggestions(author_id);
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;

-- Tabela suggestion_votes (voto unico por usuario/sugestao)
CREATE TABLE IF NOT EXISTS public.suggestion_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id UUID NOT NULL REFERENCES public.suggestions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(suggestion_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_suggestion_votes_suggestion ON public.suggestion_votes(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_votes_user ON public.suggestion_votes(user_id);
ALTER TABLE public.suggestion_votes ENABLE ROW LEVEL SECURITY;

-- RLS suggestions: SELECT por org + override super_admin
DROP POLICY IF EXISTS "suggestions_select" ON public.suggestions;
CREATE POLICY "suggestions_select" ON public.suggestions
    FOR SELECT TO authenticated
    USING (
        public.current_user_is_super_admin()
        OR organization_id = public.current_user_org_id()
    );

-- RLS suggestions: INSERT apenas do proprio usuario, na propria org
DROP POLICY IF EXISTS "suggestions_insert" ON public.suggestions;
CREATE POLICY "suggestions_insert" ON public.suggestions
    FOR INSERT TO authenticated
    WITH CHECK (
        author_id = auth.uid()
        AND organization_id = public.current_user_org_id()
    );

-- RLS suggestions: DELETE do proprio autor ou super_admin
DROP POLICY IF EXISTS "suggestions_delete" ON public.suggestions;
CREATE POLICY "suggestions_delete" ON public.suggestions
    FOR DELETE TO authenticated
    USING (author_id = auth.uid() OR public.current_user_is_super_admin());

-- RLS suggestion_votes: SELECT segue a visibilidade da sugestao
DROP POLICY IF EXISTS "suggestion_votes_select" ON public.suggestion_votes;
CREATE POLICY "suggestion_votes_select" ON public.suggestion_votes
    FOR SELECT TO authenticated
    USING (
        public.current_user_is_super_admin()
        OR EXISTS (
            SELECT 1 FROM public.suggestions s
            WHERE s.id = suggestion_votes.suggestion_id
            AND s.organization_id = public.current_user_org_id()
        )
    );

-- RLS suggestion_votes: voto do proprio usuario, em sugestao visivel (UNIQUE garante 1x)
DROP POLICY IF EXISTS "suggestion_votes_insert" ON public.suggestion_votes;
CREATE POLICY "suggestion_votes_insert" ON public.suggestion_votes
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.suggestions s
            WHERE s.id = suggestion_votes.suggestion_id
            AND (public.current_user_is_super_admin() OR s.organization_id = public.current_user_org_id())
        )
    );

-- RLS suggestion_votes: desvotar (DELETE) apenas o proprio voto
DROP POLICY IF EXISTS "suggestion_votes_delete" ON public.suggestion_votes;
CREATE POLICY "suggestion_votes_delete" ON public.suggestion_votes
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());
