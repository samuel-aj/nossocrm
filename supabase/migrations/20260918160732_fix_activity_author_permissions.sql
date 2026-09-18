-- The trigger runs as the caller, who intentionally has no USAGE on crm_internal.
-- Resolve the actor here without calling a function through that private schema.
-- Keep SECURITY INVOKER and all existing activity RLS policies unchanged.
CREATE OR REPLACE FUNCTION crm_internal.stamp_activity_author()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE
  claims jsonb;
  headers jsonb;
  actor_kind text := 'system';
  actor_id uuid;
  header_id text;
BEGIN
  BEGIN
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN claims := NULL;
  END;
  IF claims ->> 'role' = 'authenticated' AND claims ->> 'sub' IS NOT NULL THEN
    actor_kind := 'user';
    actor_id := (claims ->> 'sub')::uuid;
  ELSIF claims ->> 'role' = 'service_role' THEN
    BEGIN
      headers := nullif(current_setting('request.headers', true), '')::jsonb;
    EXCEPTION WHEN OTHERS THEN headers := NULL;
    END;
    IF headers ->> 'x-crm-actor-kind' IN ('user', 'bot', 'agent', 'integration', 'system') THEN
      actor_kind := headers ->> 'x-crm-actor-kind';
      header_id := headers ->> 'x-crm-actor-id';
      actor_id := CASE WHEN header_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN header_id::uuid END;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- An authenticated caller cannot impersonate another author.
    NEW.created_actor_kind := CASE WHEN actor_kind = 'user' THEN actor_kind ELSE coalesce(NEW.created_actor_kind, actor_kind) END;
    NEW.created_by := CASE WHEN actor_kind = 'user' THEN actor_id ELSE coalesce(NEW.created_by, actor_id) END;
    NEW.edited_at := NULL;
    NEW.edited_by := NULL;
  ELSE
    NEW.created_actor_kind := OLD.created_actor_kind;
    NEW.created_by := OLD.created_by;
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
      NEW.edited_at := now();
      NEW.edited_by := actor_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
