-- Add max_users and is_active to organizations for multi-tenant management
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 5;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug TEXT;

-- Add super_admin support to profiles
-- super_admin can manage ALL organizations (platform owner)
-- Existing roles: 'admin' (org admin), 'vendedor' (salesperson), 'user' (default)
-- New role: 'super_admin' (platform-level admin)

-- RLS policy: super_admin can see all organizations
DROP POLICY IF EXISTS "authenticated_access" ON public.organizations;
CREATE POLICY "authenticated_access" ON public.organizations
    FOR ALL TO authenticated
    USING (deleted_at IS NULL)
    WITH CHECK (true);

-- RLS policy: super_admin can manage all profiles
DROP POLICY IF EXISTS "superadmin_profiles_all" ON public.profiles;
CREATE POLICY "superadmin_profiles_all" ON public.profiles
    FOR ALL TO authenticated
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles WHERE role = 'super_admin'
        )
        OR id = auth.uid()
        OR organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );
