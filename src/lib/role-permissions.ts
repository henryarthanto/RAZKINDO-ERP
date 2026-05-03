// =====================================================================
// ROLE PERMISSIONS - Resolve effective roles for custom role users
//
// Custom roles store their permissions as a JSON array of built-in role
// names in the `permissions` text column. For example:
//   Custom role "Sales Manager" with permissions '["sales","keuangan"]'
//   gets both sales and finance access.
//
// This helper provides a single source of truth for resolving what
// built-in roles a user effectively has, regardless of whether their
// `role` field is a built-in role or a custom role name.
// =====================================================================

/** All built-in roles that the system recognises for permission checks. */
export const BUILT_IN_ROLES = ['super_admin', 'sales', 'kurir', 'keuangan', 'gudang'] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Parse the permissions JSON stored in custom_roles.permissions.
 * Returns an array of valid built-in role strings, or an empty array
 * if the value is null / invalid / empty.
 */
export function parsePermissionsJson(raw: string | null | undefined): BuiltInRole[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((r: string): r is BuiltInRole =>
        (BUILT_IN_ROLES as readonly string[]).includes(r),
      );
    }
  } catch {
    // malformed JSON — treat as empty
  }
  return [];
}

/**
 * Resolve the effective built-in roles for a user.
 *
 * - If `role` is a built-in role → returns `[role]`
 * - If the user has a custom role with `permissions` → returns parsed permissions
 * - Otherwise → returns `[]` (no access)
 */
export function resolveEffectiveRoles(user: {
  role: string;
  customRoleId?: string | null;
  customRole?: { permissions?: string | null } | null;
}): BuiltInRole[] {
  // 1. Built-in role — straightforward
  if ((BUILT_IN_ROLES as readonly string[]).includes(user.role)) {
    return [user.role as BuiltInRole];
  }

  // 2. Custom role — use the permissions JSON from the related custom_role row
  if (user.customRoleId && user.customRole?.permissions) {
    return parsePermissionsJson(user.customRole.permissions);
  }

  // 3. Custom role without permissions → no access
  return [];
}

/**
 * Check whether a user effectively has at least one of the given roles.
 * `super_admin` always wins (it is never explicitly listed in module `roles`
 * arrays, but super_admin users bypass the check entirely).
 */
export function hasAnyRole(
  user: { role: string; customRoleId?: string | null; customRole?: { permissions?: string | null } | null },
  roles: string[],
): boolean {
  const effective = resolveEffectiveRoles(user);
  // super_admin sees everything — but callers usually handle this before calling us
  if (effective.includes('super_admin')) return true;
  return effective.some((r) => roles.includes(r));
}

/**
 * Check whether a user effectively has a specific role.
 */
export function hasRole(
  user: { role: string; customRoleId?: string | null; customRole?: { permissions?: string | null } | null },
  role: BuiltInRole,
): boolean {
  return resolveEffectiveRoles(user).includes(role);
}

// ─── Backend helper: fetch effective roles from DB ───────────────

/**
 * Fetch the effective roles for a user directly from the database.
 * Useful in API routes where you have the raw user record but may not
 * have the customRole relation loaded.
 *
 * Returns the effective roles array.
 */
export async function fetchEffectiveRolesFromDB(
  supabaseClient: any,
  userId: string,
): Promise<BuiltInRole[]> {
  // First, get the user's role and customRoleId
  const { data: user } = await supabaseClient
    .from('users')
    .select('role, custom_role_id')
    .eq('id', userId)
    .maybeSingle();

  if (!user) return [];

  // If built-in role, return directly
  if ((BUILT_IN_ROLES as readonly string[]).includes(user.role)) {
    return [user.role as BuiltInRole];
  }

  // If custom role, fetch permissions from custom_roles table
  if (user.custom_role_id) {
    const { data: cr } = await supabaseClient
      .from('custom_roles')
      .select('permissions')
      .eq('id', user.custom_role_id)
      .maybeSingle();

    if (cr) {
      return parsePermissionsJson(cr.permissions);
    }
  }

  return [];
}
