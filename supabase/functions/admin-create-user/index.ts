import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = Deno.env.get("APP_URL");
  if (!authorization || !supabaseUrl || !anonKey || !serviceKey || !appUrl) {
    return json({ error: "Configuração segura do servidor incompleta." }, 500);
  }

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Entre na conta de administrador novamente." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: memberships, error: membershipError } = await admin.from("household_members")
    .select("household_id").eq("user_id", authData.user.id).eq("role", "admin").limit(1);
  if (membershipError) return json({ error: "Não foi possível confirmar a permissão administrativa." }, 500);
  const membership = memberships?.[0];
  if (!membership) return json({ error: "Apenas o administrador do piloto pode convidar participantes." }, 403);

  let body: { email?: string };
  try { body = await request.json(); } catch { return json({ error: "Informe um e-mail válido." }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: "Informe um endereço de e-mail válido." }, 400);
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: appUrl,
    data: { beta: "despensa" },
  });
  if (inviteError || !invited.user) {
    return json({ error: inviteError?.message?.includes("already") ? "Este e-mail já tem uma conta. Use um e-mail novo para o convite." : "Não foi possível enviar o convite. Confira o serviço de e-mail do Supabase." }, 400);
  }

  const { error: addMemberError } = await admin.from("household_members").insert({
    household_id: membership.household_id,
    user_id: invited.user.id,
    email,
    role: "member",
  });
  if (addMemberError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return json({ error: addMemberError.message.includes("duplicate") ? "Este participante já está no beta." : "A conta foi criada, mas não foi possível associá-la ao piloto. Tente novamente." }, 400);
  }

  const { error: auditError } = await admin.from("audit_events").insert({
    household_id: membership.household_id,
    actor_id: authData.user.id,
    actor_email: authData.user.email || "",
    action: "participante.convidado",
    details: { email },
  });
  if (auditError) console.error("Audit event insert failed", auditError.message);
  return json({ email });
});

