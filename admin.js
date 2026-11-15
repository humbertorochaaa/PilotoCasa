(() => {
  const $ = (selector) => document.querySelector(selector);
  const setupNotice = $("#setupNotice");
  const loginCard = $("#loginCard");
  const adminContent = $("#adminContent");
  const config = window.SUPABASE_CONFIG || {};
  let client = null;
  let activeHousehold = "";
  let adminUserId = "";

  function showLogin(message = "") {
    loginCard.hidden = false;
    adminContent.hidden = true;
    $("#loginMessage").textContent = message;
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
  }

  function appendCell(row, value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value || "—";
    row.append(cell);
  }

  async function refreshMembers() {
    const { data, error } = await client.from("household_members")
      .select("user_id,username,email,role,created_at").eq("household_id", activeHousehold).order("created_at", { ascending: true });
    if (error) throw error;
    $("#memberCount").textContent = String(data.length);
    const container = $("#memberRows");
    container.replaceChildren();
    data.forEach((member) => {
      const row = document.createElement("div");
      row.className = "member-row";
      const identity = document.createElement("span");
      identity.className = "member-ident";
      identity.textContent = `${member.username} · ${member.email}`;
      const role = document.createElement("small");
      role.className = "member-role";
      role.textContent = member.role === "admin" ? "Administrador" : "Participante";
      row.append(identity, role);
      if (member.role === "member") {
        const actions = document.createElement("span");
        actions.className = "member-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "text-button";
        edit.dataset.editUser = member.user_id;
        edit.dataset.username = member.username;
        edit.dataset.email = member.email;
        edit.textContent = "Editar";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button danger-text";
        remove.dataset.deleteUser = member.user_id;
        remove.dataset.email = member.email;
        remove.textContent = "Excluir";
        actions.append(edit, remove);
        row.append(actions);
      }
      container.append(row);
    });
  }

  async function refreshAudit() {
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
      const actionLabels = {
        "participante.criado": "Login criado",
        "participante.atualizado": "Login atualizado",
        "participante.excluido": "Login excluído",
        "compras.atualizadas": "Lançamentos atualizados"
      };
      data.forEach((entry) => {
        const row = document.createElement("tr");
        appendCell(row, new Date(entry.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
        appendCell(row, entry.actor_email || "Conta do piloto");
        appendCell(row, actionLabels[entry.action] || entry.action, "audit-action");
        const details = entry.details && typeof entry.details === "object"
          ? Object.entries(entry.details).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" · ")
          : "";
        appendCell(row, details);
        body.append(row);
      });
    }
    $("#auditMessage").textContent = "Exibindo até 100 ações recentes.";
  }

  async function refreshReceipts() {
    $("#receiptsMessage").textContent = "Carregando lançamentos…";
    const { data, error } = await client.from("household_state")
      .select("state").eq("household_id", activeHousehold).single();
    if (error) throw error;
    const receipts = Array.isArray(data?.state?.receipts) ? [...data.state.receipts] : [];
    receipts.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const body = $("#adminReceiptRows");
    body.replaceChildren();
    if (!receipts.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "audit-empty";
      cell.colSpan = 5;
      cell.textContent = "Ainda não há notas registradas.";
      row.append(cell);
      body.append(row);
    } else {
      receipts.forEach((receipt) => {
        const row = document.createElement("tr");
        appendCell(row, formatDate(receipt.date));
        appendCell(row, receipt.store);
        const items = (receipt.items || []).map((item) => item.name).filter(Boolean).join(", ");
        appendCell(row, items || "Sem itens detalhados");
        const total = (receipt.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        appendCell(row, new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total));
        const actionCell = document.createElement("td");
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button danger-text";
        remove.dataset.deleteReceipt = receipt.id;
        remove.dataset.store = receipt.store || "mercado";
        remove.textContent = "Excluir";
        actionCell.append(remove);
        row.append(actionCell);
        body.append(row);
      });
    }
    $("#receiptsMessage").textContent = `${receipts.length} ${receipts.length === 1 ? "lançamento" : "lançamentos"} no histórico.`;
  }

  async function loadAdmin(user) {
    if (!user) return showLogin();
    if (user.user_metadata?.must_change_password === true) {
      showLogin("Antes de administrar, entre na página principal e troque a senha temporária.");
      $("#adminSignOutLogin").hidden = false;
      return;
    }
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
      adminUserId = user.id;
      loginCard.hidden = true;
      adminContent.hidden = false;
      $("#adminAccount").textContent = user.email || "Administrador conectado";
      await Promise.all([refreshMembers(), refreshAudit(), refreshReceipts()]);
    } catch (error) {
      showLogin(error.message || "Não foi possível abrir os controles administrativos.");
    }
  }

  async function invokeAdminAction(body) {
    const { data, error } = await client.functions.invoke("admin-create-user", { body });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Não foi possível concluir a ação.");
    return data;
  }

  async function removeReceipt(id, store) {
    if (!confirm(`Excluir a nota de ${store}? Essa ação remove o lançamento do histórico compartilhado.`)) return;
    $("#receiptsMessage").textContent = "Excluindo lançamento…";
    const { data, error } = await client.from("household_state").select("state")
      .eq("household_id", activeHousehold).single();
    if (error) throw error;
    const state = data.state || {};
    const receipts = Array.isArray(state.receipts) ? state.receipts : [];
    if (!receipts.some((receipt) => receipt.id === id)) {
      await refreshReceipts();
      return;
    }
    const { error: updateError } = await client.from("household_state")
      .update({ state: { ...state, receipts: receipts.filter((receipt) => receipt.id !== id) }, updated_by: adminUserId })
      .eq("household_id", activeHousehold);
    if (updateError) throw updateError;
    await Promise.all([refreshReceipts(), refreshAudit()]);
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    activeHousehold = "";
    adminUserId = "";
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
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: $("#adminEmail").value.trim(), password: $("#adminPassword").value });
      if (error) throw error;
      await loadAdmin(data.user);
    } catch {
      $("#loginMessage").textContent = "E-mail ou senha inválidos. Confira seus dados e tente novamente.";
    } finally { button.disabled = false; }
  });

  $("#accountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#createAccountButton");
    button.disabled = true;
    $("#accountMessage").textContent = "Criando login…";
    try {
      const data = await invokeAdminAction({
        action: "create",
        username: $("#newUsername").value.trim().toLowerCase(),
        email: $("#newEmail").value.trim().toLowerCase(),
        password: $("#newTempPassword").value
      });
      $("#accountForm").reset();
      $("#accountMessage").textContent = `Login criado para ${data.username} (${data.email}). Passe a senha temporária diretamente à pessoa.`;
      await Promise.all([refreshMembers(), refreshAudit()]);
    } catch (error) {
      $("#accountMessage").textContent = error.message || "Não foi possível criar esse login.";
    } finally { button.disabled = false; }
  });

  $("#memberRows").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-edit-user]");
    if (edit) {
      $("#editUserId").value = edit.dataset.editUser;
      $("#editUsername").value = edit.dataset.username;
      $("#editEmail").value = edit.dataset.email;
      $("#editTempPassword").value = "";
      $("#editAccountMessage").textContent = "";
      $("#editAccountDialog").showModal();
      return;
    }
    const remove = event.target.closest("[data-delete-user]");
    if (!remove || !confirm(`Excluir o login ${remove.dataset.email}? A pessoa perderá o acesso ao piloto.`)) return;
    try {
      await invokeAdminAction({ action: "delete", userId: remove.dataset.deleteUser });
      $("#accountMessage").textContent = `Login de ${remove.dataset.email} excluído.`;
      await Promise.all([refreshMembers(), refreshAudit()]);
    } catch (error) {
      $("#accountMessage").textContent = error.message || "Não foi possível excluir esse login.";
    }
  });

  $("#editAccountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#saveEditAccount");
    button.disabled = true;
    $("#editAccountMessage").textContent = "Salvando…";
    try {
      const body = {
        action: "update",
        userId: $("#editUserId").value,
        username: $("#editUsername").value.trim().toLowerCase(),
        email: $("#editEmail").value.trim().toLowerCase()
      };
      if ($("#editTempPassword").value) body.password = $("#editTempPassword").value;
      await invokeAdminAction(body);
      $("#editAccountDialog").close();
      $("#accountMessage").textContent = "Login atualizado. Se definiu uma senha temporária, a pessoa deverá trocá-la ao entrar.";
      await Promise.all([refreshMembers(), refreshAudit()]);
    } catch (error) {
      $("#editAccountMessage").textContent = error.message || "Não foi possível atualizar esse login.";
    } finally { button.disabled = false; }
  });

  $("#adminReceiptRows").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-receipt]");
    if (!button) return;
    try { await removeReceipt(button.dataset.deleteReceipt, button.dataset.store); }
    catch (error) { $("#receiptsMessage").textContent = error.message || "Não foi possível excluir o lançamento."; }
  });

  $("#closeEditAccount").addEventListener("click", () => $("#editAccountDialog").close());
  $("#cancelEditAccount").addEventListener("click", () => $("#editAccountDialog").close());
  $("#adminSignOut").addEventListener("click", signOut);
  $("#adminSignOutLogin").addEventListener("click", signOut);
  $("#refreshAudit").addEventListener("click", () => refreshAudit().catch((error) => { $("#auditMessage").textContent = error.message; }));
  $("#refreshReceipts").addEventListener("click", () => refreshReceipts().catch((error) => { $("#receiptsMessage").textContent = error.message; }));
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user) setTimeout(() => loadAdmin(session.user), 0);
    if (event === "SIGNED_OUT") {
      activeHousehold = "";
      adminUserId = "";
      adminContent.hidden = true;
      loginCard.hidden = false;
    }
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) return showLogin("Não foi possível verificar o login. Recarregue a página e tente novamente.");
    if (data.session?.user) loadAdmin(data.session.user);
    else showLogin();
  });
})();

