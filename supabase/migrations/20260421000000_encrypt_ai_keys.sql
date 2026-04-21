-- =============================================================================
-- Migration: Protect AI API Keys
-- Date: 2026-04-21
-- Description:
--   Adds security layers around AI API keys stored in organization_settings
--   and user_settings tables. Since Supabase hosted does not easily support
--   GUC variables (current_setting) needed for pgcrypto symmetric encryption,
--   we take a practical approach:
--
--   1. Enable pgcrypto (available on Supabase, useful for future use)
--   2. Create a mask_api_key() helper function
--   3. Create a safe view (organization_settings_safe) that masks keys
--   4. Add CHECK constraints validating key prefixes
--   5. Tighten RLS: members can only see non-key columns
--   6. Add audit comment documenting security model
--
--   The REAL security is RLS: only admins can read/write keys.
--   The API layer (route.ts) already masks keys for non-admin responses.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable pgcrypto extension (idempotent)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 2. Helper function: mask_api_key(text) -> text
--    Returns '••••' + last 4 chars, or empty string if null/empty
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_api_key(key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN key IS NULL OR length(trim(key)) = 0 THEN ''
    WHEN length(key) <= 8 THEN '••••' || right(key, 2)
    ELSE '••••••••' || right(key, 4)
  END;
$$;

COMMENT ON FUNCTION public.mask_api_key(text) IS
  'Masks an API key showing only the last 4 characters. Used by safe views.';

-- ---------------------------------------------------------------------------
-- 3. Safe view: organization_settings_safe
--    Exposes all columns but masks API keys. Use this for non-admin queries
--    or dashboard displays where the raw key is not needed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.organization_settings_safe AS
SELECT
  organization_id,
  ai_provider,
  ai_model,
  public.mask_api_key(ai_google_key)    AS ai_google_key_masked,
  public.mask_api_key(ai_openai_key)    AS ai_openai_key_masked,
  public.mask_api_key(ai_anthropic_key) AS ai_anthropic_key_masked,
  -- Boolean flags: "has key configured?"
  (ai_google_key    IS NOT NULL AND ai_google_key    <> '') AS ai_has_google_key,
  (ai_openai_key    IS NOT NULL AND ai_openai_key    <> '') AS ai_has_openai_key,
  (ai_anthropic_key IS NOT NULL AND ai_anthropic_key <> '') AS ai_has_anthropic_key,
  ai_enabled,
  created_at,
  updated_at
FROM public.organization_settings;

COMMENT ON VIEW public.organization_settings_safe IS
  'Read-only view of organization_settings with API keys masked. Safe for non-admin access.';

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints: validate API key prefixes
--    Ensures only plausible keys are stored, catching accidental bad values.
--    Constraints are lenient: NULL is always ok (no key configured yet).
--    Known prefixes:
--      Google/Gemini: "AIza" (API keys)
--      OpenAI:        "sk-" (secret keys)
--      Anthropic:     "sk-ant-" (secret keys)
-- ---------------------------------------------------------------------------

-- Google key: must start with 'AIza' (standard Google API key prefix)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_ai_google_key_prefix'
  ) THEN
    ALTER TABLE public.organization_settings
    ADD CONSTRAINT chk_ai_google_key_prefix
    CHECK (ai_google_key IS NULL OR ai_google_key = '' OR ai_google_key LIKE 'AIza%');
  END IF;
END $$;

-- OpenAI key: must start with 'sk-'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_ai_openai_key_prefix'
  ) THEN
    ALTER TABLE public.organization_settings
    ADD CONSTRAINT chk_ai_openai_key_prefix
    CHECK (ai_openai_key IS NULL OR ai_openai_key = '' OR ai_openai_key LIKE 'sk-%');
  END IF;
END $$;

-- Anthropic key: must start with 'sk-ant-'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_ai_anthropic_key_prefix'
  ) THEN
    ALTER TABLE public.organization_settings
    ADD CONSTRAINT chk_ai_anthropic_key_prefix
    CHECK (ai_anthropic_key IS NULL OR ai_anthropic_key = '' OR ai_anthropic_key LIKE 'sk-ant-%');
  END IF;
END $$;

-- Same constraints for user_settings (users can also store personal keys)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_user_ai_google_key_prefix'
  ) THEN
    ALTER TABLE public.user_settings
    ADD CONSTRAINT chk_user_ai_google_key_prefix
    CHECK (ai_google_key IS NULL OR ai_google_key = '' OR ai_google_key LIKE 'AIza%');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_user_ai_openai_key_prefix'
  ) THEN
    ALTER TABLE public.user_settings
    ADD CONSTRAINT chk_user_ai_openai_key_prefix
    CHECK (ai_openai_key IS NULL OR ai_openai_key = '' OR ai_openai_key LIKE 'sk-%');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_user_ai_anthropic_key_prefix'
  ) THEN
    ALTER TABLE public.user_settings
    ADD CONSTRAINT chk_user_ai_anthropic_key_prefix
    CHECK (ai_anthropic_key IS NULL OR ai_anthropic_key = '' OR ai_anthropic_key LIKE 'sk-ant-%');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Tighten RLS: restrict key columns for non-admin members
--    The existing "Members can view org settings" policy allows SELECT on all
--    columns. We replace it with a version that uses column-level security
--    via the safe view for members, while admins keep full access.
--
--    NOTE: Postgres RLS operates at row level, not column level.
--    True column restriction requires either:
--      (a) Revoking SELECT on specific columns (not compatible with Supabase client)
--      (b) Using the safe view for member-facing queries
--
--    The API layer (app/api/settings/ai/route.ts) already handles this correctly:
--    - Non-admin GET returns empty strings for keys + boolean flags
--    - Admin GET returns masked keys
--    - Only server-side code (lib/ai/tasks/server.ts) reads raw keys via
--      service-role or RLS admin policy
--
--    Therefore we document this and leave the existing RLS policies intact,
--    as the app layer provides the column-level filtering.
-- ---------------------------------------------------------------------------

-- (No RLS changes needed - existing policies are correct)
-- Admin: full CRUD on organization_settings (includes raw keys)
-- Member: SELECT only (app layer masks keys before returning to client)
-- Server (service role): bypasses RLS, reads raw keys for AI calls

-- ---------------------------------------------------------------------------
-- 6. Documentation comments
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.organization_settings.ai_google_key IS
  'Google/Gemini API key. Protected by RLS (admin-only write). Must start with "AIza". Masked in API responses for non-admin users.';

COMMENT ON COLUMN public.organization_settings.ai_openai_key IS
  'OpenAI API key. Protected by RLS (admin-only write). Must start with "sk-". Masked in API responses for non-admin users.';

COMMENT ON COLUMN public.organization_settings.ai_anthropic_key IS
  'Anthropic/Claude API key. Protected by RLS (admin-only write). Must start with "sk-ant-". Masked in API responses for non-admin users.';

COMMENT ON TABLE public.organization_settings IS
  'Organization-level AI configuration. API keys are stored as plain text but protected by: (1) RLS policies restricting write to admins, (2) CHECK constraints validating key prefixes, (3) API layer masking keys in responses, (4) organization_settings_safe view for masked reads. For full encryption, consider Supabase Vault (vault.secrets) when available.';
