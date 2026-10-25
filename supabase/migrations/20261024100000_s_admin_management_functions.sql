# Migration for admin membership management and role assignments
# Author: Hassan
# Date: 2026-10-19
#
# This migration provides database functions for:
# 1. Managing platform membership approvals (admin function)
# 2. Managing role assignments for users (admin function)
# 3. Adding member role assignment and revocation capabilities
#
# These functions enable the new admin console interface for:
# - Viewing pending memberships
# - Approving/rejecting membership requests
# - Managing user roles (TA, teacher, student)
#
# Migration scope: admin management functions only (no table changes)
# Dependencies: existing university_memberships, role_assignments tables
# Dependencies: existing platform_admins table (RLS enforced)
#
-- ============================================================================
-- Section 1: Admin membership management functions
-- ============================================================================

DO $$
BEGIN
    -- Function to get pending membership requests for admin review
    CREATE OR REPLACE FUNCTION private.get_pending_memberships(p_university_id uuid)
    RETURNS TABLE (
        profile_id uuid,
        email text,
        created_at timestamptz,
        university_id uuid
    ) AS $$
    BEGIN
        RETURN QUERY
        SELECT
            p.id AS profile_id,
            p.email,
            p.created_at,
            p.university_id
        FROM public.profiles p
        JOIN public.university_memberships um ON um.profile_id = p.id
            AND um.university_id = p.university_id
        WHERE um.university_id = p_university_id
            AND um.status = 'pending'
            AND NOT EXISTS (
                SELECT 1 FROM public.platform_admins
                WHERE profile_id = p.id AND revoked_at IS NULL
            )
        ORDER BY p.created_at;
    END;
    $$ LANGUAGE plpgsql STABLE;

    -- Function to approve a membership request
    CREATE OR REPLACE FUNCTION private.approve_membership(p_profile_id uuid, p_university_id uuid)
    RETURNS void AS $$
    BEGIN
        UPDATE public.university_memberships
        SET status = 'active',
            updated_at = now()
        WHERE profile_id = p_profile_id
            AND university_id = p_university_id
            AND status = 'pending';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Membership not found or already approved';
        END IF;

        -- If user has a TA role assigned, also grant offering staff access
        INSERT INTO public.offering_staff (university_id, offering_id, profile_id, staff_role, created_by)
        SELECT ra.university_id, ra.offering_id, ra.profile_id, 'ta', ra.profile_id
        FROM public.role_assignments ra
        WHERE ra.profile_id = p_profile_id
            AND ra.university_id = p_university_id
            AND ra.revoked_at IS NULL
            AND EXISTS (
                SELECT 1 FROM public.roles r
                WHERE r.id = ra.role_id
                    AND r.university_id = ra.university_id
                    AND r.name = 'ta'
            )
        ON CONFLICT (university_id, offering_id, profile_id) DO NOTHING;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to reject a membership request
    CREATE OR REPLACE FUNCTION private.reject_membership(p_profile_id uuid, p_university_id uuid)
    RETURNS void AS $$
    BEGIN
        -- Delete the membership request
        DELETE FROM public.university_memberships
        WHERE profile_id = p_profile_id
            AND university_id = p_university_id
            AND status = 'pending';
    END;
    $$ LANGUAGE plpgsql;

    -- Function to get all members with their roles
    CREATE OR REPLACE FUNCTION private.get_memberships_with_roles(p_university_id uuid)
    RETURNS TABLE (
        profile_id uuid,
        email text,
        university_id uuid,
        membership_status text,
        role_name text,
        role_display_name text,
        created_at timestamptz,
        revoked_at timestamptz
    ) AS $$
    BEGIN
        RETURN QUERY
        SELECT
            p.id AS profile_id,
            p.email,
            p.university_id,
            um.status AS membership_status,
            r.name AS role_name,
            r.display_name AS role_display_name,
            ra.created_at,
            ra.revoked_at
        FROM public.profiles p
        LEFT JOIN public.university_memberships um ON um.profile_id = p.id
            AND um.university_id = p.university_id
        LEFT JOIN public.role_assignments ra ON ra.profile_id = p.id
            AND ra.university_id = p.university_id
            AND ra.revoked_at IS NULL
        LEFT JOIN public.roles r ON r.id = ra.role_id
            AND r.university_id = ra.university_id
        WHERE p.university_id = p_university_id
        ORDER BY p.email;
    END;
    $$ LANGUAGE plpgsql STABLE;

END$$;

-- ============================================================================
-- Section 2: Admin role assignment management functions
-- ============================================================================

DO $$
BEGIN
    -- Function to assign a role to a user
    CREATE OR REPLACE FUNCTION private.assign_role(p_profile_id uuid, p_university_id uuid, p_role_name text, p_assigned_by uuid)
    RETURNS void AS $$
    BEGIN
        -- Validate role exists
        INSERT INTO public.role_assignments (
            university_id,
            profile_id,
            role_id,
            assigned_by,
            created_at
        )
        SELECT
            p.university_id,
            p.id AS profile_id,
            r.id AS role_id,
            p.id AS assigned_by,
            now()
        FROM public.profiles p
        CROSS JOIN public.roles r
        WHERE p.id = p_profile_id
            AND p.university_id = p_university_id
            AND r.university_id = p.university_id
            AND r.name = p_role_name;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to revoke a role from a user
    CREATE OR REPLACE FUNCTION private.revoke_role(p_profile_id uuid, p_university_id uuid, p_role_name text)
    RETURNS void AS $$
    BEGIN
        UPDATE public.role_assignments
        SET revoked_at = now(),
            updated_at = now()
        WHERE profile_id = p_profile_id
            AND university_id = p_university_id
            AND EXISTS (
                SELECT 1 FROM public.roles r
                WHERE r.id = role_id
                    AND r.university_id = university_id
                    AND r.name = p_role_name
            )
            AND revoked_at IS NULL;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to get roles with role holder information
    CREATE OR REPLACE FUNCTION private.get_roles_with_holders(p_university_id uuid, p_role_name text)
    RETURNS TABLE (
        profile_id uuid,
        email text,
        role_name text,
        role_display_name text,
        assigned_at timestamptz,
        revoked_at timestamptz
    ) AS $$
    BEGIN
        RETURN QUERY
        SELECT
            p.id AS profile_id,
            p.email,
            r.name AS role_name,
            r.display_name AS role_display_name,
            ra.created_at AS assigned_at,
            ra.revoked_at
        FROM public.profiles p
        JOIN public.role_assignments ra ON ra.profile_id = p.id
            AND ra.university_id = p.university_id
            AND ra.revoked_at IS NULL
        JOIN public.roles r ON r.id = ra.role_id
            AND r.university_id = ra.university_id
        WHERE p.university_id = p_university_id
            AND r.name = p_role_name
        ORDER BY p.email;
    END;
    $$ LANGUAGE plpgsql STABLE;

END$$;

-- ============================================================================
-- Section 3: Admin profile management functions
-- ============================================================================

DO $$
BEGIN
    -- Function to get user profile details
    CREATE OR REPLACE FUNCTION private.get_profile_details(p_profile_id uuid, p_university_id uuid)
    RETURNS TABLE (
        profile_id uuid,
        email text,
        display_name text,
        created_at timestamptz,
        roles text[],
        membership_status text,
        university_name text
    ) AS $$
    BEGIN
        RETURN QUERY
        SELECT
            p.id AS profile_id,
            p.email,
            p.display_name,
            p.created_at,
            COALESCE(
                ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL),
                ARRAY[]::text[]
            ) AS roles,
            COALESCE(um.status, 'none') AS membership_status,
            'FAST-NUCES Lahore' AS university_name
        FROM public.profiles p
        LEFT JOIN public.role_assignments ra ON ra.profile_id = p.id
            AND ra.university_id = p.university_id
            AND ra.revoked_at IS NULL
        LEFT JOIN public.roles r ON r.id = ra.role_id
            AND r.university_id = ra.university_id
        LEFT JOIN public.university_memberships um ON um.profile_id = p.id
            AND um.university_id = p.university_id
        WHERE p.id = p_profile_id
            AND p.university_id = p_university_id
        GROUP BY p.id, p.email, p.display_name, p.created_at, um.status;
    END;
    $$ LANGUAGE plpgsql STABLE;

END$$;

COMMENT ON FUNCTION private.get_pending_memberships(uuid) IS
    'Admin function: Get all pending membership requests for a university';
COMMENT ON FUNCTION private.approve_membership(uuid, uuid) IS
    'Admin function: Approve a pending membership request';
COMMENT ON FUNCTION private.reject_membership(uuid, uuid) IS
    'Admin function: Reject a pending membership request';
COMMENT ON FUNCTION private.get_memberships_with_roles(uuid) IS
    'Admin function: Get all members with their roles';
COMMENT ON FUNCTION private.assign_role(uuid, uuid, text, uuid) IS
    'Admin function: Assign a role to a user';
COMMENT ON FUNCTION private.revoke_role(uuid, uuid, text) IS
    'Admin function: Revoke a role from a user';
COMMENT ON FUNCTION private.get_roles_with_holders(uuid, text) IS
    'Admin function: Get users with a specific role';
COMMENT ON FUNCTION private.get_profile_details(uuid, uuid) IS
    'Admin function: Get detailed profile information';
