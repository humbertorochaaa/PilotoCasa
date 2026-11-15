(() => {
  const $ = (selector) => document.querySelector(selector);
  const setupNotice = $("#setupNotice");
  const loginCard = $("#loginCard");
  const adminContent = $("#adminContent");
  const config = window.SUPABASE_CONFIG || {};
  let client = null;
  let activeHousehold = "";

  function showLogin(message = "") {
    loginCard.hidden = false;
    adminContent.hidden = true;
    $("#loginMessage").textContent = message;
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function appendCell(row, value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value || "—";
    row.append(cell);
  }

  async function loadMembers() {
    const { data, error } = await client.from("household_members")
      .select("email,role,created_at").eq("household_id", activeHousehold).order("created_at", { ascending: true });
    if (error) throw error;
    $("#memberCount").textContent = String(data.length);
    const container = $("#memberRows");
    container.replaceChildren();
    data.forEach((member) => {
      const row = document.createElement("div");
      row.className = "member-row";
      const email = document.createElement("span");
      email.textContent = member.email;
      const role = document.createElement("small");
      role.textContent = member.role === "admin" ? "Administrador" : "Participante";
      row.append(email, role);
      container.append(row);
    });
  }

  async function loadAudit() {
    $("#auditMessage").textContent = "Carregando registros…";
    const { data, error } = await client.from("audit_events")
      .select("created_at,actor_email,action,details").eq("household_id", activeHousehold)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const body = $("#auditRows");
    body.replaceChildren();
    if (!data.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "audit-empty";
      cell.colSpan = 4;
      cell.textContent = "Ainda não há ações registradas.";
      row.append(cell);
      body.append(row);
    } else {
      data.forEach((entry) => {
        const row = document.createElement("tr");
        appendCell(row, formatDate(entry.created_at));
        appendCell(row, entry.actor_email || "Conta do piloto");
        const actionLabels = {
          "participante.convidado": "Participante convidado",
          "compras.atualizadas": "Compras atualizadas"
        };
        appendCell(row, actionLabels[entry.action] || entry.action, "audit-action");
        const details = entry.details && typeof entry.details === "object"
          ? Object.entries(entry.details).map(([key, value]) => `${key}: ${value}`).join(" · ")
          : "";
        appendCell(row, details);
        body.append(row);
      });
    }
    $("#auditMessage").textContent = "Exibindo até 100 eventos recentes.";
  }

  async function openAdmin(user) {
    if (!user) return showLogin();
    try {
      const { data: membership, error } = await client.from("household_members")
        .select("household_id,role").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!membership || membership.role !== "admin") {
        showLogin("Esta conta não tem acesso administrativo. Peça ao administrador para revisar o acesso.");
        $("#adminSignOutLogin").hidden = false;
        return;
      }
      activeHousehold = membership.household_id;
      loginCard.hidden = true;
      adminContent.hidden = false;
      $("#adminAccount").textContent = user.email || "Administrador conectado";
      await Promise.all([loadMembers(), loadAudit()]);
    } catch (error) {
      showLogin(error.message || "Não foi possível abrir os controles administrativos.");
    }
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    activeHousehold = "";
    $("#adminSignOutLogin").hidden = true;
    showLogin("Você saiu da conta.");
  }

  if (!config.url || !config.anonKey) {
    setupNotice.hidden = false;
    return;
  }
  if (!window.supabase?.createClient) {
    setupNotice.hidden = false;
    setupNotice.querySelector("p").textContent = "O serviço de login não carregou. Confira a conexão e recarregue a página.";
    return;
  }

  setupNotice.hidden = true;
  client = window.supabase.createClient(config.url, config.anonKey);
  loginCard.hidden = false;
  $("#adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#loginButton");
    button.disabled = true;
    $("#loginMessage").textContent = "Entrando…";
    const { data, error } = await client.auth.signInWithPassword({
      email: $("#adminEmail").value.trim(),
      password: $("#adminPassword").value
    });
    button.disabled = false;
    if (error) $("#loginMessage").textContent = "E-mail ou senha inválidos. Confira seus dados e tente novamente.";
    else await openAdmin(data.user);
  });
  $("#adminSignOut").addEventListener("click", signOut);
  $("#adminSignOutLogin").addEventListener("click", signOut);
  $("#refreshAudit").addEventListener("click", async () => {
    try { await loadAudit(); } catch (error) { $("#auditMessage").textContent = error.message || "Não foi possível atualizar a auditoria."; }
  });
  $("#inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#inviteButton");
    const email = $("#inviteEmail").value.trim().toLowerCase();
    button.disabled = true;
    $("#inviteMessage").textContent = "Enviando convite…";
    try {
      const { data, error } = await client.functions.invoke("admin-create-user", { body: { email } });
      if (error || data?.error) {
        $("#inviteMessage").textContent = data?.error || error?.message || "Não foi possível enviar o convite.";
        return;
      }
      $("#inviteForm").reset();
      $("#inviteMessage").textContent = `Convite enviado para ${data.email}.`;
      try { await Promise.all([loadMembers(), loadAudit()]); } catch (refreshError) { $("#auditMessage").textContent = refreshError.message; }
    } catch (error) {
      $("#inviteMessage").textContent = error.message || "Não foi possível enviar o convite.";
    } finally { button.disabled = false; }
  });
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user) setTimeout(() => openAdmin(session.user), 0);
    if (event === "SIGNED_OUT") {
      activeHousehold = "";
      adminContent.hidden = true;
      loginCard.hidden = false;
    }
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) return showLogin("Não foi possível verificar o login. Recarregue a página e tente novamente.");
    if (data.session?.user) openAdmin(data.session.user);
    else showLogin();
  });
})();

