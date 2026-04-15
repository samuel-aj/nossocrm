-- Fix contacts that were created without organization_id
-- Associates orphan contacts with the organization of the deal they belong to,
-- or with the organization of the profile that created them.

-- Step 1: Fix contacts linked to deals (use the deal's organization_id)
UPDATE contacts c
SET organization_id = d.organization_id
FROM deals d
WHERE d.contact_id = c.id
  AND c.organization_id IS NULL
  AND d.organization_id IS NOT NULL;

-- Step 2: Fix remaining orphan contacts using the profile's organization_id
-- (contacts not linked to any deal, but created by a user in an org)
UPDATE contacts c
SET organization_id = p.organization_id
FROM profiles p
WHERE c.organization_id IS NULL
  AND p.organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM deals d
    WHERE d.contact_id = c.id
    AND d.created_by = p.id
  );
