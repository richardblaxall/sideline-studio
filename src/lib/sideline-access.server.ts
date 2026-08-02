// Server-only helpers for client (buyer) access decisions.
// Access is invite-only: the signed-in user's email must be confirmed and
// present on the invited_clients list with approval enabled.

/** Returns true when the given auth user is an approved, invited client. */
export async function isApprovedClient(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("is_approved_client", { _user_id: userId });
  if (error) return false;
  return data === true;
}
