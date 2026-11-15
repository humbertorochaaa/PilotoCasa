import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function defaultKey(variable: string, mapVariable: string): string {
  const legacyKey = Deno.env.get(variable);
  if (legacyKey) return legacyKey;
  try {
    const keys = JSON.parse(Deno.env.get(mapVariable) || "{}");
    return keys.default || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}

Deno.serve(async (request) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = defaultKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = defaultKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
  if (!authorization || !supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "Configuração segura do servidor incompleta." }, 500);
  }

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ error: "Entre na conta de administrador novamente." }, 401);

  let body: { action?: string; userId?: string; username?: string; email?: string; password?: string };
  try { body = await request.json(); } catch { return json({ error: "Dados inválidos." }, 400); }
  const action = String(body.action || "");
  if (!["create", "update", "delete"].includes(action)) return json({ error: "Ação inválida." }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: memberships, error: membershipError } = await admin.from("household_members")
    .select("household_id").eq("user_id", authData.user.id).eq("role", "admin").limit(1);
  if (membershipError) return json({ error: "Não foi possível confirmar a permissão administrativa." }, 500);
  const householdId = memberships?.[0]?.household_id;
  if (!householdId) return json({ error: "Apenas o administrador do piloto pode gerenciar contas." }, 403);

  const audit = async (event: string, details: Record<string, unknown>) => {
    const { error } = await admin.from("audit_events").insert({
      household_id: householdId,
      actor_id: authData.user.id,
      actor_email: authData.user.email || "",
      action: event,
      details,
    });
    if (error) console.error("Audit event insert failed", error.message);
  };
  const cleanUsername = String(body.username || "").trim().toLowerCase();
  const cleanEmail = String(body.email || "").trim().toLowerCase();
  if (action !== "delete" && !/^[a-z0-9_]{3,32}$/.test(cleanUsername)) {
    return json({ error: "O nome de usuário deve ter de 3 a 32 caracteres: letras, números ou _." }, 400);
  }
  if (action !== "delete" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254)) {
    return json({ error: "Informe um e-mail válido." }, 400);
  }

  if (action === "create") {
    const password = String(body.password || "");
    if (password.length < 8 || password.length > 128) return json({ error: "A senha temporária deve ter entre 8 e 128 caracteres." }, 400);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { username: cleanUsername, must_change_password: true, beta: "despensa" },
    });
    if (createError || !created.user) {
      const duplicate = /already|registered|exists/i.test(createError?.message || "");
      return json({ error: duplicate ? "Este e-mail já tem uma conta." : "Não foi possível criar a conta. Confira os dados e tente novamente." }, 400);
    }
    const { error: memberError } = await admin.from("household_members").insert({
      household_id: householdId,
      user_id: created.user.id,
      username: cleanUsername,
      email: cleanEmail,
      role: "member",
    });
    if (memberError) {
      await admin.auth.admin.deleteUser(created.user.id);
      const duplicate = /duplicate|unique/i.test(memberError.message);
      return json({ error: duplicate ? "Esse nome de usuário ou e-mail já está em uso no piloto." : "Não foi possível associar a conta ao piloto." }, 400);
    }
    await audit("participante.criado", { username: cleanUsername, email: cleanEmail, user_id: created.user.id });
    return json({ action, username: cleanUsername, email: cleanEmail });
  }

  const targetId = String(body.userId || "");
  if (!targetId || targetId === authData.user.id) return json({ error: "Não é permitido alterar ou excluir sua própria conta por aqui." }, 400);
  const { data: target, error: targetError } = await admin.from("household_members")
    .select("user_id,username,email,role").eq("household_id", householdId).eq("user_id", targetId).maybeSingle();
  if (targetError) return json({ error: "Não foi possível localizar essa conta." }, 500);
  if (!target || target.role !== "member") return json({ error: "Só é possível editar ou excluir participantes do beta." }, 403);

  if (action === "delete") {
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteError) return json({ error: "Não foi possível excluir essa conta." }, 400);
    await audit("participante.excluido", { username: target.username, email: target.email, user_id: targetId });
    return json({ action, username: target.username, email: target.email });
  }

  const password = body.password === undefined ? "" : String(body.password);
  if (password && (password.length < 8 || password.length > 128)) {
    return json({ error: "A senha temporária deve ter entre 8 e 128 caracteres." }, 400);
  }
  const { data: otherMembers, error: duplicateError } = await admin.from("household_members")
    .select("user_id,username,email").eq("household_id", householdId).neq("user_id", targetId);
  if (duplicateError) return json({ error: "Não foi possível validar o nome de usuário e o e-mail." }, 500);
  if (otherMembers?.some((member) => member.username === cleanUsername || member.email === cleanEmail)) {
    return json({ error: "Esse nome de usuário ou e-mail já está em uso no piloto." }, 400);
  }

  const { data: authTarget, error: authTargetError } = await admin.auth.admin.getUserById(targetId);
  if (authTargetError || !authTarget.user) return json({ error: "Não foi possível localizar a conta de acesso." }, 404);
  const metadata = { ...(authTarget.user.user_metadata || {}), username: cleanUsername };
  if (password) metadata.must_change_password = true;
  const authUpdate: { email?: string; email_confirm?: boolean; password?: string; user_metadata: Record<string, unknown> } = {
    user_metadata: metadata,
  };
  if (cleanEmail !== target.email) {
    authUpdate.email = cleanEmail;
    authUpdate.email_confirm = true;
  }
  if (password) authUpdate.password = password;
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, authUpdate);
  if (authUpdateError) {
    const duplicate = /already|registered|exists/i.test(authUpdateError.message);
    return json({ error: duplicate ? "Esse e-mail já está associado a outra conta." : "Não foi possível atualizar a conta." }, 400);
  }
  const { error: memberUpdateError } = await admin.from("household_members")
    .update({ username: cleanUsername, email: cleanEmail }).eq("household_id", householdId).eq("user_id", targetId);
  if (memberUpdateError) return json({ error: "A conta de acesso foi atualizada, mas o cadastro do piloto não. Tente salvar novamente." }, 500);
  await audit("participante.atualizado", {
    username: cleanUsername,
    email: cleanEmail,
    user_id: targetId,
    email_changed: cleanEmail !== target.email,
    temporary_password_set: Boolean(password),
  });
  return json({ action, username: cleanUsername, email: cleanEmail });
});

