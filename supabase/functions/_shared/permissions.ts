import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type PermissionAction = 'read' | 'write' | 'delete'
export type PermissionTab = 'repository' | 'assistant'

interface PermissionCheckResult {
  hasPermission: boolean
  userId: string | null
  error: string | null
}

/**
 * Check if a user has permission to perform an action on a tab
 * Returns { hasPermission, userId, error }
 */
export async function checkPermission(
  authHeader: string | null,
  tab: PermissionTab,
  action: PermissionAction,
  supabaseUrl: string,
  supabaseAnonKey: string,
  supabaseServiceKey: string
): Promise<PermissionCheckResult> {
  // Validate auth header
  if (!authHeader?.startsWith('Bearer ')) {
    return { hasPermission: false, userId: null, error: 'Missing or invalid authorization header' }
  }

  // Verify user token
  const token = authHeader.replace('Bearer ', '')
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: { user }, error: authError } = await authClient.auth.getUser(token)

  if (authError || !user) {
    return { hasPermission: false, userId: null, error: 'Unauthorized: Invalid token' }
  }

  // Check permission using service role
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  const { data, error } = await supabase.rpc('has_permission', {
    p_tab: tab,
    p_action: action,
    p_user_id: user.id
  })

  if (error) {
    console.error('Permission check error:', error)
    // Default to denying access on error
    return { hasPermission: false, userId: user.id, error: 'Permission check failed' }
  }

  return { hasPermission: data === true, userId: user.id, error: null }
}

/**
 * Create a standard 403 Forbidden response
 */
export function forbiddenResponse(corsHeaders: Record<string, string>, message = 'Forbidden: Insufficient permissions') {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

/**
 * Create a standard 401 Unauthorized response
 */
export function unauthorizedResponse(corsHeaders: Record<string, string>, message = 'Unauthorized') {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}
