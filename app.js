(() => {
  const STORAGE_KEY = "despensa-piloto-v1";
  const PILOT_DAYS = 35;
  const categories = [
    { id: "proteinas", label: "Carnes, peixes e proteínas", short: "Proteínas", color: "#769b72", icon: "🥩", words: ["carne", "frango", "peixe", "ovo", "linguiça", "linguica", "presunto", "queijo", "atum", "patinho", "bovina", "suína", "suina", "moída", "moida", "contra filé", "contra-file"] },
    { id: "hortifruti", label: "Frutas, verduras e legumes", short: "Hortifruti", color: "#c1c96d", icon: "🥑", words: ["banana", "maçã", "maca", "tomate", "alface", "batata", "cebola", "fruta", "verdura", "legume", "laranja", "limão", "limao", "cenoura", "abacate", "mamão", "mamao", "uva"] },
    { id: "mercearia", label: "Mercearia e básicos", short: "Mercearia", color: "#d8b56b", icon: "🛒", words: ["arroz", "feijão", "feijao", "macarrão", "macarrao", "farinha", "óleo", "oleo", "açúcar", "acucar", "sal", "café", "cafe", "pão", "pao", "aveia", "molho", "enlatado"] },
    { id: "laticinios", label: "Laticínios e ovos", short: "Laticínios", color: "#88aeca", icon: "🥛", words: ["leite", "iogurte", "manteiga", "requeijão", "requeijao", "creme de leite", "muçarela", "mucarela", "ricota"] },
    { id: "bebidas", label: "Bebidas", short: "Bebidas", color: "#8d91c6", icon: "🥤", words: ["refrigerante", "suco", "água", "agua", "cerveja", "vinho", "chá", "cha", "bebida", "isotônico", "isotonico"] },
    { id: "doces", label: "Doces e snacks", short: "Doces e snacks", color: "#d98c79", icon: "🍫", words: ["chocolate", "biscoito", "bolacha", "doce", "sorvete", "salgadinho", "bala", "snack", "sobremesa", "bombom"] },
    { id: "limpeza", label: "Casa e limpeza", short: "Casa e limpeza", color: "#a895bd", icon: "🧽", words: ["detergente", "sabão", "sabao", "desinfetante", "papel higiênico", "papel higienico", "limpeza", "amaciante", "esponja", "saco de lixo", "shampoo", "sabonete"] },
    { id: "outros", label: "Outros", short: "Outros", color: "#a9b0aa", icon: "📦", words: [] }
  ];
  const unitOptions = ["kg", "g", "L", "ml", "un"];
  const today = (() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  })();
  const isMobileDevice = Boolean(navigator.userAgentData?.mobile)
    || /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  document.documentElement.classList.toggle("mobile-device", isMobileDevice);
  let state = loadState();
  let selectedDashboardMonth = state.receipts.map((receipt) => receipt.date?.slice(0, 7)).filter((month) => /^\d{4}-\d{2}$/.test(month || "")).sort().at(-1) || today.slice(0, 7);
  let cloudMonthInitialized = false;
  const cloud = { client: null, user: null, householdId: null, role: null, ready: false, saveChain: Promise.resolve(), channel: null };
  let inviteFlow = new URLSearchParams(location.hash.slice(1)).get("type") === "invite"
    || new URLSearchParams(location.search).get("flow") === "invite";
  let toastTimer;
  let scanStream = null;
  let scanActive = false;
  let scanFrame = 0;
  let barcodeDetector = null;
  let lastScanAt = 0;
  let pdfJsPromise = null;
  let tesseractScriptPromise = null;
  let ocrWorkerPromise = null;
  let activeOcrProgress = null;
  const scanCanvas = document.createElement("canvas");
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
  const localDateString = (date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const dateFromString = (value) => new Date(`${value}T12:00:00`);
  const formatDate = (value, options = { day: "numeric", month: "short" }) => {
    if (!value) return "—";
    return dateFromString(value).toLocaleDateString("pt-BR", options).replace(" de ", " ");
  };
  const normalizeName = (name) => String(name || "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const getCategory = (id) => categories.find((category) => category.id === id) || categories[categories.length - 1];
  const guessCategory = (name) => {
    const normalized = normalizeName(name);
    const found = categories.slice(0, -1).find((category) => category.words.some((word) => normalized.includes(normalizeName(word))));
    return found?.id || "outros";
  };
  const receiptTotal = (receipt) => (receipt.items || []).reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.receipts)) {
        return { pilotStart: parsed.pilotStart || today, pilotDays: PILOT_DAYS, receipts: parsed.receipts };
      }
    } catch (error) { /* Start with a clean local pilot if the saved data cannot be read. */ }
    return { pilotStart: today, pilotDays: PILOT_DAYS, receipts: [] };
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (cloud.ready) persistCloudState();
  }
  async function persistCloudState() {
    if (!cloud.ready || !cloud.client) return;
    const snapshot = { pilotStart: state.pilotStart, pilotDays: PILOT_DAYS, receipts: state.receipts };
    cloud.saveChain = cloud.saveChain.then(async () => {
      const { error } = await cloud.client.from("household_state")
        .update({ state: snapshot, updated_by: cloud.user.id })
        .eq("household_id", cloud.householdId);
      if (error) throw error;
    }).catch((error) => {
      showToast(`Não foi possível sincronizar: ${error.message || "erro de conexão"}`);
    });
    return cloud.saveChain;
  }
  function showAuthDialog(message = "") {
    const dialog = $("#authDialog");
    $("#authForm").hidden = false;
    $("#invitePasswordForm").hidden = true;
    $("#authTitle").textContent = "Entrar na Despensa";
    $("#authStatus").textContent = message;
    if (!dialog.open) dialog.showModal();
  }
  function promptInvitePassword(user) {
    if (!user) return showAuthDialog("Abra novamente o link de convite enviado por e-mail.");
    const dialog = $("#authDialog");
    $("#authForm").hidden = true;
    $("#invitePasswordForm").hidden = false;
    $("#invitePasswordStatus").textContent = "";
    if (!dialog.open) dialog.showModal();
  }
  async function activateCloudUser(user) {
    if (!cloud.client || !user) return;
    if (user.user_metadata?.must_change_password === true) {
      promptInvitePassword(user);
      return;
    }
    try {
      const { data: membership, error: membershipError } = await cloud.client.from("household_members")
        .select("household_id, role").eq("user_id", user.id).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) throw new Error("Este login ainda não foi associado ao piloto. Peça um convite ao administrador.");
      const { data: householdData, error: stateError } = await cloud.client.from("household_state")
        .select("state").eq("household_id", membership.household_id).single();
      if (stateError) throw stateError;
      let sharedState = householdData?.state;
      if (!sharedState || !Array.isArray(sharedState.receipts)) throw new Error("O histórico compartilhado ainda não foi preparado.");
      if (membership.role === "admin" && sharedState.receipts.length === 0 && state.receipts.length > 0) {
        const localSnapshot = { pilotStart: state.pilotStart || today, pilotDays: PILOT_DAYS, receipts: state.receipts };
        const { error: migrationError } = await cloud.client.from("household_state")
          .update({ state: localSnapshot, updated_by: user.id }).eq("household_id", membership.household_id);
        if (migrationError) throw migrationError;
        sharedState = localSnapshot;
        showToast("As compras deste navegador foram levadas para o piloto compartilhado.");
      }
      cloud.user = user;
      cloud.householdId = membership.household_id;
      cloud.role = membership.role;
      state = { pilotStart: sharedState.pilotStart || today, pilotDays: PILOT_DAYS, receipts: sharedState.receipts };
      if (!cloudMonthInitialized) {
        selectedDashboardMonth = state.receipts.map((receipt) => receipt.date?.slice(0, 7))
          .filter((month) => /^\d{4}-\d{2}$/.test(month || "")).sort().at(-1) || today.slice(0, 7);
        cloudMonthInitialized = true;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      cloud.ready = true;
      $("#storageStatus").textContent = "Compras sincronizadas entre participantes.";
      $("#adminNavLink").hidden = cloud.role !== "admin";
      $("#signOutButton").hidden = false;
      $("#authDialog").close();
      renderDashboard();
      const current = location.hash.slice(1);
      if (current === "receipts") renderAllReceipts();
      if (current === "products") renderProducts();
      if (cloud.channel) await cloud.client.removeChannel(cloud.channel);
      cloud.channel = cloud.client.channel(`household-state-${cloud.householdId}`)
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "household_state",
          filter: `household_id=eq.${cloud.householdId}`
        }, (payload) => {
          if (!Array.isArray(payload.new.state?.receipts)) return;
          state = { pilotStart: payload.new.state.pilotStart || today, pilotDays: PILOT_DAYS, receipts: payload.new.state.receipts };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          renderDashboard();
          const activeView = location.hash.slice(1);
          if (activeView === "receipts") renderAllReceipts();
          if (activeView === "products") renderProducts();
          showToast("Compras atualizadas por outro participante.");
        }).subscribe();
    } catch (error) {
      cloud.ready = false;
      showAuthDialog(error.message || "Não foi possível abrir os dados compartilhados.");
    }
  }
  async function initCloudSync() {
    const config = window.SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) return;
    if (!window.supabase?.createClient) {
      showAuthDialog("O serviço de login não carregou. Recarregue a página quando estiver conectado à internet.");
      return;
    }
    cloud.client = window.supabase.createClient(config.url, config.anonKey);
    cloud.client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) setTimeout(() => inviteFlow ? promptInvitePassword(session.user) : activateCloudUser(session.user), 0);
      if (event === "SIGNED_OUT") {
        cloud.ready = false;
        if (cloud.channel) cloud.client.removeChannel(cloud.channel);
        cloud.channel = null;
        cloud.user = null;
        cloud.householdId = null;
        cloud.role = null;
        $("#adminNavLink").hidden = true;
        $("#signOutButton").hidden = true;
        $("#storageStatus").textContent = "Entre para abrir os dados compartilhados.";
        showAuthDialog();
      }
    });
    const { data, error } = await cloud.client.auth.getSession();
    if (error) {
      showAuthDialog("Não foi possível verificar o login. Atualize a página e tente novamente.");
      return;
    }
    if (data.session?.user) {
      if (inviteFlow) promptInvitePassword(data.session.user);
      else await activateCloudUser(data.session.user);
    }
    else {
      $("#storageStatus").textContent = "Entre para abrir os dados compartilhados.";
      showAuthDialog();
    }
  }
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  function setPage(view) {
    const meta = {
      overview: ["Visão geral", "Um retrato simples das compras e da rotina da casa."],
      receipts: ["Compras e notas", "Todas as compras que vocês registraram para a casa."],
      products: ["Produtos", "Preços e intervalos observados nas compras registradas."]
    };
    const current = meta[view] ? view : "overview";
    $$(".view-section").forEach((section) => section.classList.toggle("active", section.id === `view-${current}`));
    $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === current));
    $("#pageTitle").textContent = meta[current][0];
    $("#pageSubtitle").textContent = meta[current][1];
    history.replaceState(null, "", `#${current}`);
    if (current === "receipts") renderAllReceipts();
    if (current === "products") renderProducts();
  }
  function dateDiff(start, end) {
    return Math.round((dateFromString(end) - dateFromString(start)) / 86400000);
  }
  function updatePilotProgress() {
    const elapsed = Math.max(0, dateDiff(state.pilotStart, today));
    const day = Math.min(PILOT_DAYS, elapsed + 1);
    const percent = Math.min(100, (day / PILOT_DAYS) * 100);
    const remaining = Math.max(0, PILOT_DAYS - day);
    $("#sidePilotDay").textContent = `Dia ${day} de ${PILOT_DAYS}`;
    $("#pilotDayLabel").innerHTML = `Dia ${day} <i>de ${PILOT_DAYS}</i>`;
    $("#pilotRemainingLabel").textContent = remaining === 0 ? "Piloto concluído" : `${remaining} ${remaining === 1 ? "dia restante" : "dias restantes"}`;
    $("#pilotStartLabel").textContent = state.pilotStart === today ? "Começou hoje" : `Começou em ${formatDate(state.pilotStart, { day: "numeric", month: "short" })}`;
    $("#sideProgressBar").style.width = `${percent}%`;
    $("#pilotProgressBar").style.width = `${percent}%`;
    $("#pilotMarker").style.left = `${Math.min(97, percent)}%`;
    $("#todayLabel").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  }
  function allProductRecords() {
    const products = new Map();
    state.receipts.forEach((receipt) => {
      (receipt.items || []).forEach((item) => {
        const key = normalizeName(item.name);
        if (!key) return;
        if (!products.has(key)) products.set(key, { key, name: item.name.trim(), category: item.category || guessCategory(item.name), records: [] });
        const product = products.get(key);
        product.records.push({ ...item, date: receipt.date, store: receipt.store, city: receipt.city || "" });
        if (receipt.date >= (product.latestDate || "")) {
          product.latestDate = receipt.date;
          product.name = item.name.trim();
          product.category = item.category || product.category;
        }
      });
    });
    return [...products.values()].map((product) => {
      product.records.sort((a, b) => a.date.localeCompare(b.date));
      const dates = [...new Set(product.records.map((record) => record.date))].sort();
      const intervals = dates.slice(1).map((date, index) => dateDiff(dates[index], date)).filter((days) => days > 0);
      product.interval = intervals.length ? Math.round(intervals.reduce((sum, days) => sum + days, 0) / intervals.length) : null;
      product.purchaseCount = dates.length;
      product.latestDate = dates.at(-1) || "";
      product.lastRecord = product.records.filter((record) => record.date === product.latestDate).at(-1);
      product.lastPrice = Number(product.lastRecord?.price) || 0;
      product.nextDate = product.interval ? localDateString(new Date(dateFromString(product.latestDate).getTime() + product.interval * 86400000)) : "";
      product.priceByStore = getStorePrices(product.records);
      return product;
    });
  }
  function unitPrice(record) {
    const quantity = Number(record.quantity);
    const price = Number(record.price);
    if (!(quantity > 0) || !(price >= 0)) return null;
    const unit = String(record.unit || "un").toLowerCase();
    if (unit === "g") return { value: price / (quantity / 1000), label: "/ kg" };
    if (unit === "ml") return { value: price / (quantity / 1000), label: "/ L" };
    if (unit === "kg") return { value: price / quantity, label: "/ kg" };
    if (unit === "l") return { value: price / quantity, label: "/ L" };
    return { value: price / quantity, label: "/ un" };
  }
  function getStorePrices(records) {
    const groups = new Map();
    records.forEach((record) => {
      const price = unitPrice(record);
      const store = String(record.store || "").trim();
      if (!price || !store) return;
      const key = normalizeName(store);
      if (!groups.has(key)) groups.set(key, { name: store, total: 0, count: 0, label: price.label });
      const group = groups.get(key);
      group.total += price.value;
      group.count += 1;
    });
    return [...groups.values()].map((store) => ({ ...store, average: store.total / store.count })).sort((a, b) => a.average - b.average);
  }
  function renderDashboard() {
    updatePilotProgress();
    const availableMonths = new Set([today.slice(0, 7), selectedDashboardMonth]);
    state.receipts.forEach((receipt) => {
      const month = receipt.date?.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month || "")) availableMonths.add(month);
    });
    const months = [...availableMonths].sort((a, b) => b.localeCompare(a));
    $("#monthTag").innerHTML = months.map((month) => {
      const [year, number] = month.split("-").map(Number);
      const label = new Date(year, number - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      return `<option value="${month}">${escapeHtml(label)}</option>`;
    }).join("");
    $("#monthTag").value = selectedDashboardMonth;
    const monthReceipts = state.receipts.filter((receipt) => receipt.date?.startsWith(selectedDashboardMonth));
    const monthTotal = monthReceipts.reduce((sum, receipt) => sum + receiptTotal(receipt), 0);
    const monthStores = new Set(monthReceipts.map((receipt) => normalizeName(receipt.store)).filter(Boolean));
    const products = allProductRecords();
    const recurring = products.filter((product) => product.purchaseCount > 1);
    $("#statSpend").textContent = money(monthTotal);
    $("#statSpendNote").textContent = `${monthReceipts.length} ${monthReceipts.length === 1 ? "nota no mês" : "notas no mês"}`;
    $("#statReceipts").textContent = String(monthReceipts.length);
    $("#statRecurring").textContent = String(recurring.length);
    $("#statStores").textContent = String(monthStores.size);
    $("#navReceiptCount").textContent = String(state.receipts.length);
    renderWeeklyChart(selectedDashboardMonth);
    renderCategoryChart(monthReceipts);
    renderRecurring(recurring);
    renderStoreComparison(products);
    renderRecentReceipts();
  }
  function renderWeeklyChart(month) {
    const monthStart = `${month}-01`;
    const start = dateFromString(monthStart);
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const weeks = Array.from({ length: 5 }, (_, index) => ({ index, total: 0, count: 0, start: new Date(start.getTime() + index * 7 * 86400000) }));
    state.receipts.filter((receipt) => receipt.date?.startsWith(month)).forEach((receipt) => {
      const offset = dateDiff(monthStart, receipt.date);
      const weekIndex = Math.floor(offset / 7);
      if (weekIndex >= 0 && weekIndex < weeks.length && offset < daysInMonth) {
        weeks[weekIndex].total += receiptTotal(receipt);
        weeks[weekIndex].count += 1;
      }
    });
    const max = Math.max(1, ...weeks.map((week) => week.total));
    $("#weeklyChart").innerHTML = weeks.map((week) => {
      const percent = week.total ? Math.max(5, (week.total / max) * 100) : 0;
      const label = `${formatDate(localDateString(week.start), { day: "numeric", month: "short" })}`;
      return `<div class="bar-column" title="Semana ${week.index + 1}: ${money(week.total)}"><span class="bar-value">${week.total ? moneyShort(week.total) : ""}</span><div class="bar-track"><span class="bar-fill" style="height:${percent}%"></span></div><span class="bar-label">${label}</span></div>`;
    }).join("");
    $("#chartTotal").textContent = money(weeks.reduce((sum, week) => sum + week.total, 0));
    const count = weeks.reduce((sum, week) => sum + week.count, 0);
    $("#chartReceiptCount").textContent = `${count} ${count === 1 ? "compra" : "compras"}`;
  }
  function moneyShort(value) {
    if (value >= 1000) return `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
    return `R$ ${Math.round(value)}`;
  }
  function renderCategoryChart(receipts) {
    const totals = new Map();
    receipts.forEach((receipt) => (receipt.items || []).forEach((item) => {
      const category = getCategory(item.category || guessCategory(item.name));
      totals.set(category.id, (totals.get(category.id) || 0) + (Number(item.price) || 0));
    }));
    const sorted = [...totals.entries()].map(([id, total]) => ({ category: getCategory(id), total })).sort((a, b) => b.total - a.total);
    const total = sorted.reduce((sum, item) => sum + item.total, 0);
    if (!total) {
      $("#categoryContent").innerHTML = emptyState("◉", "As categorias aparecem aqui", "Registrem uma compra para ver como os gastos se distribuem.");
      return;
    }
    let cursor = 0;
    const segments = sorted.map(({ category, total: amount }) => {
      const start = cursor;
      cursor += (amount / total) * 100;
      return `${category.color} ${start}% ${cursor}%`;
    }).join(", ");
    $("#categoryContent").innerHTML = `<div class="donut" style="background:conic-gradient(${segments})"><div class="donut-center"><strong>${moneyShort(total)}</strong><span>no mês</span></div></div><div class="category-legend">${sorted.slice(0, 5).map(({ category, total: amount }) => `<div class="category-line"><i style="background:${category.color}"></i><span>${escapeHtml(category.short)}</span><strong>${Math.round(amount / total * 100)}%</strong></div>`).join("")}</div>`;
  }
  function emptyState(icon, title, description, action = false) {
    return `<div class="empty-state"><span class="empty-state-icon">${icon}</span><strong>${title}</strong><p>${description}</p>${action ? `<button class="button button-outline button-small" data-empty-action type="button">＋ Registrar compra</button>` : ""}</div>`;
  }
  function renderRecurring(products) {
    const list = [...products].filter((product) => product.interval).sort((a, b) => a.interval - b.interval).slice(0, 3);
    if (!list.length) {
      $("#recurringList").innerHTML = emptyState("⟳", "O ritmo aparece com o tempo", "Quando um produto aparecer em notas de dias diferentes, mostramos o intervalo médio.");
      return;
    }
    $("#recurringList").innerHTML = list.map((product) => {
      const category = getCategory(product.category);
      const remaining = dateDiff(today, product.nextDate);
      const due = remaining <= 0 ? "perto da reposição" : `próx. ${formatDate(product.nextDate, { day: "numeric", month: "short" })}`;
      return `<div class="recurring-row"><span class="product-thumb">${category.icon}</span><div><div class="recurring-name">${escapeHtml(product.name)}</div><div class="recurring-sub">${product.purchaseCount} compras · ${escapeHtml(due)}</div></div><div class="recurring-days">${product.interval} dias<small>em média</small></div></div>`;
    }).join("");
  }
  function renderStoreComparison(products) {
    const comparisons = products.filter((product) => product.priceByStore.length >= 2).map((product) => ({ product, best: product.priceByStore[0], next: product.priceByStore[1] })).sort((a, b) => (a.best.average / a.next.average) - (b.best.average / b.next.average)).slice(0, 3);
    if (!comparisons.length) {
      $("#storeCompare").innerHTML = emptyState("⌖", "Compare seus mercados", "O mesmo produto precisa aparecer em compras de dois mercados diferentes.");
      return;
    }
    $("#storeCompare").innerHTML = comparisons.map(({ product, best, next }) => {
      const savings = next.average > 0 ? Math.round((1 - best.average / next.average) * 100) : 0;
      return `<div class="compare-row"><div><div class="compare-product">${escapeHtml(product.name)}</div><div class="compare-meta">${escapeHtml(best.label)} · ${escapeHtml(next.name)} ${money(next.average)}</div></div><div class="compare-best">${escapeHtml(best.name)}<small>${money(best.average)} · ${savings}% menor</small></div></div>`;
    }).join("");
  }
  function receiptMarkup(receipt, card = false) {
    const items = receipt.items || [];
    const summary = items.map((item) => item.name).filter(Boolean).slice(0, 4).join(", ") + (items.length > 4 ? ` e mais ${items.length - 4}` : "");
    const actions = `<div class="receipt-actions"><button class="mini-action" type="button" data-edit-id="${escapeHtml(receipt.id)}" aria-label="Editar compra" title="Editar">✎</button><button class="mini-action delete" type="button" data-delete-id="${escapeHtml(receipt.id)}" aria-label="Excluir compra" title="Excluir">×</button></div>`;
    const icon = "▤";
    if (card) return `<article class="receipt-card"><div class="receipt-card-head"><span class="receipt-mark">${icon}</span><div class="receipt-store-wrap"><div class="receipt-store">${escapeHtml(receipt.store)}</div><div class="receipt-meta">${items.length} ${items.length === 1 ? "item" : "itens"}${receipt.city ? ` · ${escapeHtml(receipt.city)}` : ""}</div></div><strong class="receipt-amount">${money(receiptTotal(receipt))}</strong><span class="receipt-date">${formatDate(receipt.date, { day: "numeric", month: "short", year: "numeric" })}</span>${actions}</div><div class="receipt-items-preview">${escapeHtml(summary || "Sem itens")}</div></article>`;
    return `<div class="receipt-entry"><span class="receipt-mark">${icon}</span><div class="receipt-store-wrap"><div class="receipt-store">${escapeHtml(receipt.store)}</div><div class="receipt-meta">${formatDate(receipt.date, { day: "numeric", month: "short", year: "numeric" })} · ${items.length} ${items.length === 1 ? "item" : "itens"}</div></div><strong class="receipt-amount">${money(receiptTotal(receipt))}</strong>${actions}</div>`;
  }
  function sortedReceipts() {
    return [...state.receipts].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  }
  function renderRecentReceipts() {
    const recent = sortedReceipts().slice(0, 4);
    $("#recentReceipts").innerHTML = recent.length ? recent.map((receipt) => receiptMarkup(receipt)).join("") : emptyState("▤", "A primeira compra começa o histórico", "Adicionem a próxima nota para ver os gastos e itens aparecerem aqui.", true);
  }
  function renderAllReceipts() {
    const query = normalizeName($("#receiptSearch")?.value || "");
    const receipts = sortedReceipts().filter((receipt) => !query || normalizeName(`${receipt.store} ${receipt.city || ""} ${(receipt.items || []).map((item) => item.name).join(" ")}`).includes(query));
    $("#receiptListCount").textContent = `${receipts.length} ${receipts.length === 1 ? "compra" : "compras"}`;
    $("#allReceipts").innerHTML = receipts.length ? receipts.map((receipt) => receiptMarkup(receipt, true)).join("") : emptyState("▤", query ? "Nenhuma compra encontrada" : "Nenhuma compra registrada ainda", query ? "Tente outro mercado ou produto." : "Registrem uma nota para começar o histórico.", !query);
  }
  function renderProducts() {
    const products = allProductRecords().sort((a, b) => (b.purchaseCount - a.purchaseCount) || a.name.localeCompare(b.name, "pt-BR"));
    const repeated = products.filter((product) => product.purchaseCount > 1);
    const comparable = products.filter((product) => product.priceByStore.length > 1);
    const avgInterval = repeated.filter((product) => product.interval).map((product) => product.interval);
    const overall = avgInterval.length ? Math.round(avgInterval.reduce((sum, days) => sum + days, 0) / avgInterval.length) : null;
    $("#productSummary").innerHTML = `<div class="product-summary"><span>Produtos diferentes</span><strong>${products.length}</strong></div><div class="product-summary"><span>Com compra repetida</span><strong>${repeated.length}</strong></div><div class="product-summary"><span>Intervalo médio da casa</span><strong>${overall ? `${overall} dias` : "—"}</strong></div>`;
    $("#productCountLabel").textContent = `${products.length} ${products.length === 1 ? "produto" : "produtos"}`;
    if (!products.length) {
      $("#productTableBody").innerHTML = `<tr><td colspan="5">${emptyState("⌁", "Seus produtos aparecem aqui", "Registre uma compra para começar a acompanhar preços e reposição.")}</td></tr>`;
      return;
    }
    $("#productTableBody").innerHTML = products.map((product) => {
      const category = getCategory(product.category);
      const interval = product.interval ? `${product.interval} dias` : "Aguardando outra compra";
      const best = product.priceByStore[0];
      return `<tr><td><span class="table-product">${escapeHtml(product.name)}</span><span class="table-category">${escapeHtml(category.short)}</span></td><td>${product.purchaseCount}</td><td>${interval}</td><td>${money(product.lastPrice)} <span class="table-category">${formatDate(product.latestDate, { day: "numeric", month: "short" })}</span></td><td>${best ? `<span class="best-price-badge">${escapeHtml(best.name)} · ${money(best.average)} ${escapeHtml(best.label)}</span>` : "<span class=table-category>Mais uma loja para comparar</span>"}</td></tr>`;
    }).join("");
  }

  function itemRowHtml(item = {}) {
    const categoryId = item.category || guessCategory(item.name || "");
    const options = categories.map((category) => `<option value="${category.id}" ${category.id === categoryId ? "selected" : ""}>${escapeHtml(category.short)}</option>`).join("");
    const units = unitOptions.map((unit) => `<option value="${unit}" ${(item.unit || "kg") === unit ? "selected" : ""}>${unit}</option>`).join("");
    return `<div class="item-row" data-category-edited="${item.category ? "true" : "false"}"><div class="product-field"><input class="item-name" maxlength="90" required placeholder="Ex.: carne moída" value="${escapeHtml(item.name || "")}" aria-label="Nome do produto" /><select class="item-category" aria-label="Categoria do produto">${options}</select></div><input class="item-quantity" type="number" min="0.001" step="0.001" required placeholder="1" value="${item.quantity ?? ""}" aria-label="Quantidade" /><select class="item-unit" aria-label="Unidade">${units}</select><input class="item-price" type="number" min="0" step="0.01" required placeholder="0,00" value="${item.price ?? ""}" aria-label="Preço total do item" /><button class="item-remove" type="button" aria-label="Remover item" title="Remover item">×</button></div>`;
  }
  function addItemRow(item = {}) {
    $("#itemRows").insertAdjacentHTML("beforeend", itemRowHtml(item));
    updateFormTotal();
  }
  function updateFormTotal() {
    const total = $$(".item-price", $("#itemRows")).reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    $("#receiptTotal").textContent = money(total);
  }
  function setProcessing(percent, message, title = "Lendo nota", isError = false) {
    const panel = $("#processingPanel");
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    const wasHidden = panel.hidden;
    panel.hidden = false;
    panel.dataset.error = String(isError);
    $("#processingTitle").textContent = title;
    $("#processingMessage").textContent = message;
    $("#processingPercent").textContent = `${value}%`;
    $("#processingBar").style.width = `${value}%`;
    if (wasHidden) requestAnimationFrame(() => panel.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }
  function resetProcessing() {
    const panel = $("#processingPanel");
    panel.hidden = true;
    panel.dataset.error = "false";
    $("#processingTitle").textContent = "Lendo nota";
    $("#processingMessage").textContent = "Preparando arquivo…";
    $("#processingPercent").textContent = "0%";
    $("#processingBar").style.width = "0%";
    $("#ocrTextDetails").hidden = true;
    $("#ocrTextDetails").open = false;
    $("#ocrTextOutput").textContent = "";
  }
  function resetForm() {
    $("#receiptForm").reset();
    $("#receiptId").value = "";
    $("#itemRows").innerHTML = "";
    $("#dateInput").value = today;
    $("#qrInput").value = "";
    $("#receiptDialogTitle").textContent = "Adicionar compra";
    $("#openConsultation").hidden = true;
    resetProcessing();
    addItemRow();
  }
  function openReceipt(id = "", focusStore = true) {
    resetForm();
    if (id) {
      const receipt = state.receipts.find((entry) => entry.id === id);
      if (!receipt) return;
      $("#receiptId").value = receipt.id;
      $("#storeInput").value = receipt.store;
      $("#cityInput").value = receipt.city || "";
      $("#dateInput").value = receipt.date;
      $("#qrInput").value = receipt.qrData || "";
      $("#itemRows").innerHTML = "";
      (receipt.items || []).forEach((item) => addItemRow(item));
      if (!receipt.items?.length) addItemRow();
      $("#receiptDialogTitle").textContent = "Editar compra";
      updateConsultationLink();
    }
    $("#receiptDialog").showModal();
    if (focusStore) setTimeout(() => $("#storeInput").focus(), 80);
  }
  function updateConsultationLink() {
    const raw = $("#qrInput").value.trim();
    let url = "";
    try {
      const parsed = new URL(raw);
      if (["http:", "https:"].includes(parsed.protocol)) url = parsed.href;
    } catch (error) { /* The pasted value may be only the access key. */ }
    const key = raw.match(/\d{44}/)?.[0];
    const button = $("#openConsultation");
    if (url) {
      button.hidden = false;
      button.dataset.url = url;
      button.textContent = "Abrir consulta ↗";
    } else if (key) {
      button.hidden = true;
      button.dataset.url = "";
    } else {
      button.hidden = true;
      button.dataset.url = "";
    }
  }
  function handleReceiptSubmit(event) {
    event.preventDefault();
    const rows = $$(".item-row", $("#itemRows"));
    const items = rows.map((row) => ({
      name: $(".item-name", row).value.trim(),
      quantity: Number($(".item-quantity", row).value),
      unit: $(".item-unit", row).value,
      price: Number($(".item-price", row).value),
      category: $(".item-category", row).value
    })).filter((item) => item.name && item.quantity > 0 && item.price >= 0);
    if (!items.length) {
      showToast("Adicione pelo menos um item com quantidade e preço.");
      return;
    }
    const id = $("#receiptId").value || (crypto.randomUUID ? crypto.randomUUID() : `receipt-${Date.now()}`);
    const existing = state.receipts.find((receipt) => receipt.id === id);
    const receipt = {
      id,
      date: $("#dateInput").value,
      store: $("#storeInput").value.trim(),
      city: $("#cityInput").value.trim(),
      qrData: $("#qrInput").value.trim(),
      items,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    selectedDashboardMonth = receipt.date.slice(0, 7);
    if (existing) state.receipts = state.receipts.map((entry) => entry.id === id ? receipt : entry);
    else state.receipts.push(receipt);
    saveState();
    $("#receiptDialog").close();
    renderDashboard();
    if ($("#view-receipts").classList.contains("active")) renderAllReceipts();
    if ($("#view-products").classList.contains("active")) renderProducts();
    showToast(existing ? "Compra atualizada." : "Compra adicionada ao histórico.");
  }
  function deleteReceipt(id) {
    const receipt = state.receipts.find((entry) => entry.id === id);
    if (!receipt) return;
    if (!confirm(`Excluir a compra em ${receipt.store} de ${formatDate(receipt.date, { day: "numeric", month: "long" })}?`)) return;
    state.receipts = state.receipts.filter((entry) => entry.id !== id);
    saveState();
    renderDashboard();
    renderAllReceipts();
    renderProducts();
    showToast("Compra removida.");
  }
  function exportData() {
    const header = ["data", "mercado", "cidade", "produto", "categoria", "quantidade", "unidade", "preco_total"];
    const lines = [header, ...state.receipts.flatMap((receipt) => (receipt.items || []).map((item) => [receipt.date, receipt.store, receipt.city || "", item.name, getCategory(item.category || guessCategory(item.name)).short, item.quantity, item.unit, item.price]))];
    const csv = "\uFEFF" + lines.map((line) => line.map((field) => `"${String(field ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `despensa-compras-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Arquivo das compras baixado.");
  }
  function handleActions(event) {
    const edit = event.target.closest("[data-edit-id]");
    if (edit) { openReceipt(edit.dataset.editId); return; }
    const remove = event.target.closest("[data-delete-id]");
    if (remove) { deleteReceipt(remove.dataset.deleteId); return; }
    if (event.target.closest("[data-empty-action]")) { openReceipt(); return; }
    const goto = event.target.closest("[data-goto]");
    if (goto) { setPage(goto.dataset.goto); return; }
  }

  async function openScanner() {
    $("#scannerMessage").textContent = "Aponte para o QR code. Para ler os itens, escolha depois uma foto nítida da nota inteira.";
    $("#scannerPlaceholder").classList.remove("hidden");
    $("#scannerDialog").showModal();
  }
  async function startCamera() {
    const message = $("#scannerMessage");
    if (!("jsQR" in window) && !("BarcodeDetector" in window)) {
      message.textContent = "A leitura pela câmera não está disponível. Use Usar foto para importar a nota.";
      showToast("Não foi possível carregar o leitor QR. Tente recarregar a página.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      message.textContent = "A câmera exige uma conexão segura. Use Enviar foto para importar a nota.";
      return;
    }
    try {
      barcodeDetector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      const video = $("#scannerVideo");
      video.srcObject = scanStream;
      await video.play();
      $("#scannerPlaceholder").classList.add("hidden");
      message.textContent = "Aponte para o QR code. Depois, use Usar foto para reconhecer mercado e produtos.";
      scanActive = true;
      lastScanAt = 0;
      scanFrame = requestAnimationFrame(scanLoop);
    } catch (error) {
      message.textContent = error.name === "NotAllowedError" ? "A câmera não foi autorizada. Use Usar foto para enviar a nota." : "Não foi possível abrir a câmera. Tente usar uma foto da nota.";
    }
  }
  async function scanLoop() {
    if (!scanActive) return;
    const video = $("#scannerVideo");
    if (video.readyState >= 2 && performance.now() - lastScanAt > 140) {
      lastScanAt = performance.now();
      try {
        const result = await decodeImageSource(video);
        if (result) {
          await onQrRead(result);
          return;
        }
      } catch (error) { /* Keep scanning while the camera is active. */ }
    }
    scanFrame = requestAnimationFrame(scanLoop);
  }
  async function decodeImageDetails(source) {
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    if (!width || !height || !scanContext) return null;
    const scale = Math.min(1, 800 / Math.max(width, height));
    scanCanvas.width = Math.max(1, Math.round(width * scale));
    scanCanvas.height = Math.max(1, Math.round(height * scale));
    scanContext.drawImage(source, 0, 0, scanCanvas.width, scanCanvas.height);
    if (window.jsQR) {
      const imageData = scanContext.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
      const result = window.jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (result?.data) {
        const corners = [result.location.topLeftCorner, result.location.topRightCorner, result.location.bottomLeftCorner, result.location.bottomRightCorner];
        const xs = corners.map((point) => point.x / scale);
        const ys = corners.map((point) => point.y / scale);
        return {
          value: result.data,
          rectangle: { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
        };
      }
    }
    if (barcodeDetector) {
      const results = await barcodeDetector.detect(scanCanvas);
      if (results.length) {
        const box = results[0].boundingBox;
        return {
          value: results[0].rawValue,
          rectangle: box ? { left: box.x / scale, top: box.y / scale, right: (box.x + box.width) / scale, bottom: (box.y + box.height) / scale } : null
        };
      }
    }
    return null;
  }
  async function decodeImageSource(source) {
    return (await decodeImageDetails(source))?.value || null;
  }
  function prepareReceiptCanvas(source, qrRectangle) {
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    let crop = { left: 0, top: 0, right: sourceWidth, bottom: sourceHeight };
    if (qrRectangle) {
      const qrWidth = qrRectangle.right - qrRectangle.left;
      const qrHeight = qrRectangle.bottom - qrRectangle.top;
      if (qrWidth > 12 && qrHeight > 12) {
        const qrCenter = (qrRectangle.left + qrRectangle.right) / 2;
        const qrIsLeft = qrCenter < sourceWidth * 0.5;
        const leftPadding = qrWidth * (qrIsLeft ? 0.65 : 1.9);
        const rightPadding = qrWidth * (qrIsLeft ? 1.9 : 0.65);
        const verticalPadding = qrHeight * 5.8;
        const candidate = {
          left: Math.max(0, qrRectangle.left - leftPadding),
          top: Math.max(0, qrRectangle.top - verticalPadding),
          right: Math.min(sourceWidth, qrRectangle.right + rightPadding),
          bottom: Math.min(sourceHeight, qrRectangle.bottom + verticalPadding)
        };
        if (candidate.right - candidate.left >= sourceWidth * 0.3 && candidate.bottom - candidate.top >= sourceHeight * 0.35) crop = candidate;
      }
    }
    const cropWidth = crop.right - crop.left;
    const cropHeight = crop.bottom - crop.top;
    const scale = Math.min(3, 3000 / Math.max(cropWidth, cropHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(cropWidth * scale));
    canvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, crop.left, crop.top, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const enhanced = Math.max(0, Math.min(255, (gray - 72) * 1.42 + 20));
      pixels[index] = enhanced;
      pixels[index + 1] = enhanced;
      pixels[index + 2] = enhanced;
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
  }
  function onQrRead(value) {
    stopScanner();
    $("#scannerDialog").close();
    applyQrValue(value);
    setProcessing(100, "QR lido. Para reconhecer o mercado e os produtos, toque em Usar foto e selecione uma foto nítida da nota inteira.", "QR reconhecido", false);
    showToast("QR lido. Agora use a foto da nota para preencher os itens.");
  }
  function applyQrValue(value) {
    $("#qrInput").value = value;
    updateConsultationLink();
  }
  function stopScanner() {
    scanActive = false;
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    if (scanStream) scanStream.getTracks().forEach((track) => track.stop());
    scanStream = null;
    const video = $("#scannerVideo");
    if (video) video.srcObject = null;
  }
  async function loadPdfJs() {
    if (!pdfJsPromise) {
      const version = "6.2.108";
      const baseUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/`;
      pdfJsPromise = import(`${baseUrl}pdf.min.mjs`).then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${baseUrl}pdf.worker.min.mjs`;
        return pdfjsLib;
      }).catch((error) => {
        pdfJsPromise = null;
        throw error;
      });
    }
    return pdfJsPromise;
  }
  async function findQrInPdf(file, onProgress = () => {}) {
    if (!("jsQR" in window) && !("BarcodeDetector" in window)) {
      throw new Error("O leitor QR não carregou. Confira sua conexão e tente novamente.");
    }
    if (!barcodeDetector && "BarcodeDetector" in window) {
      try { barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (error) { barcodeDetector = null; }
    }
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await loadingTask.promise;
    const pagesToScan = Math.min(pdf.numPages, 10);
    try {
      for (let pageNumber = 1; pageNumber <= pagesToScan; pageNumber += 1) {
        onProgress(pageNumber, pagesToScan);
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1400 / baseViewport.width, 1800 / baseViewport.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const qrValue = await decodeImageSource(canvas);
        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;
        if (qrValue) return { qrValue, pageNumber, scannedPages: pagesToScan, totalPages: pdf.numPages };
      }
      return { qrValue: "", pageNumber: 0, scannedPages: pagesToScan, totalPages: pdf.numPages };
    } finally {
      await pdf.destroy();
    }
  }
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractScriptPromise) {
      tesseractScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
        script.async = true;
        script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("O leitor de texto não carregou."));
        script.onerror = () => reject(new Error("Não foi possível carregar o leitor de texto."));
        document.head.appendChild(script);
      }).catch((error) => {
        tesseractScriptPromise = null;
        throw error;
      });
    }
    return tesseractScriptPromise;
  }
  async function getOcrWorker(onProgress) {
    activeOcrProgress = onProgress;
    if (!ocrWorkerPromise) {
      const tesseract = await loadTesseract();
      ocrWorkerPromise = tesseract.createWorker("por", 1, {
        logger: (message) => activeOcrProgress?.(message)
      }).catch((error) => {
        ocrWorkerPromise = null;
        throw error;
      });
    }
    return ocrWorkerPromise;
  }
  async function imageFileToCanvas(file) {
    let source = null;
    let objectUrl = "";
    try {
      if (window.createImageBitmap) {
        try { source = await createImageBitmap(file); } catch (error) { source = null; }
      }
      if (!source) {
        objectUrl = URL.createObjectURL(file);
        source = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("O navegador não conseguiu abrir esta imagem."));
          image.src = objectUrl;
        });
      }
      const width = source.width || source.naturalWidth;
      const height = source.height || source.naturalHeight;
      if (!width || !height) throw new Error("A imagem não tem um tamanho válido.");
      const scale = Math.min(1, 2400 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Não foi possível preparar a imagem.");
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      return {
        canvas,
        cleanup: () => {
          source?.close?.();
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          canvas.width = 0;
          canvas.height = 0;
        }
      };
    } catch (error) {
      source?.close?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
  function parseBrazilianNumber(value) {
    const normalized = String(value || "").replace(/[^\d,.-]/g, "");
    if (!normalized) return 0;
    const number = normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized;
    return Number(number) || 0;
  }
  function normalizeOcrUnit(value) {
    const unit = String(value || "").toLocaleLowerCase("pt-BR").replace(/\./g, "");
    if (["kg", "quilo", "quilos"].includes(unit)) return "kg";
    if (["g", "gr", "grama", "gramas"].includes(unit)) return "g";
    if (["l", "lt", "litro", "litros"].includes(unit)) return "L";
    if (["ml", "mililitro", "mililitros"].includes(unit)) return "ml";
    return "un";
  }
  function parseOcrItemLine(line) {
    const excluded = /\b(total|subtotal|pagamento|troco|desconto|tributos|impostos|federal|estadual|municipal|icms|chave|acesso|cnpj|cpf|consumidor|autorizacao|protocolo|documento|danfe|nfce|consulta|valor|juros|parcelas|credito|debito|pix|cartao|forma de pagamento|economizou)\b/i;
    if (excluded.test(line)) return null;
    // The receipt quantity can have three decimal places (0,255 kg). Without
    // the trailing boundary, OCR used to read its first two decimals as R$0,25.
    const prices = [...line.matchAll(/(?:R\s*\$\s*)?(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)/g)];
    if (!prices.length) return null;
    const finalPrice = prices.at(-1);
    const prefix = line.slice(0, finalPrice.index).trim();
    const quantityUnits = [...prefix.matchAll(/(\d+(?:[,.]\d{1,3})?)\s*(kg|g|l|lt|ml|unid|und|un|pc|pct|pç|cx|fd|dz)\b/gi)];
    let namePart = prefix;
    let quantity = 0;
    let unit = "";
    const quantityUnit = quantityUnits.at(-1);
    if (quantityUnit) {
      quantity = parseBrazilianNumber(quantityUnit[1]);
      unit = normalizeOcrUnit(quantityUnit[2]);
      namePart = prefix.slice(0, quantityUnit.index).trim();
    } else {
      const quantityTimes = prefix.match(/(\d+(?:[,.]\d{1,3})?)\s*[xX]\s*$/);
      if (quantityTimes) {
        quantity = parseBrazilianNumber(quantityTimes[1]);
        unit = "un";
        namePart = prefix.slice(0, quantityTimes.index).trim();
      }
    }
    if (!(quantity > 0) || !unit) return null;
    const tokens = namePart.split(/\s+/).filter(Boolean);
    while (tokens.length > 1 && /^\d{1,3}$/.test(tokens[0])) tokens.shift();
    while (tokens.length > 1 && /^\d{4,14}$/.test(tokens[0])) tokens.shift();
    const name = tokens.join(" ").replace(/^[|:;,.\-\s]+|[|:;,.\-\s]+$/g, "").trim();
    const price = parseBrazilianNumber(finalPrice[1]);
    if (name.length < 3 || !/[A-Za-zÀ-ÿ]/.test(name) || !(quantity > 0) || !(price > 0)) return null;
    return { name, quantity, unit, price, category: guessCategory(name) };
  }
  function parseReceiptOcr(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const normalizedLines = lines.map((line) => normalizeName(line));
    const ignoreStoreLine = /\b(danfe|documento auxiliar|nota fiscal|nfce|cupom fiscal|consumidor|cnpj|cpf|consulta|sefaz|chave de acesso|protocolo|serie|avenida|rua|rodovia|endereco|cep|fone|telefone|inscricao estadual|ie)\b/;
    const headerIndex = normalizedLines.findIndex((line) =>
      /\b(descricao|produto|mercadoria)\b/.test(line) && /\b(cod|codigo|qtd|qt|quant|un|unid|vlr|valor)\b/.test(line)
    );
    const storeCandidates = lines.slice(0, Math.min(headerIndex >= 0 ? headerIndex : 14, 14))
      .map((line) => ({ line, normalized: normalizeName(line) }))
      .filter(({ line, normalized }) => {
        const words = normalized.match(/[a-z]{3,}/g) || [];
        const letters = line.match(/[A-Za-zÀ-ÿ]/g) || [];
        const uppercase = letters.filter((character) => character === character.toLocaleUpperCase("pt-BR")).length;
        const lowercase = letters.length - uppercase;
        const mixedCaseNoise = words.length > 2
          && uppercase / Math.max(letters.length, 1) > 0.3
          && lowercase / Math.max(letters.length, 1) > 0.3;
        return line.length >= 5 && line.length <= 90 && words.length >= 2 && words.length <= 6
          && !ignoreStoreLine.test(normalized) && !/\d|[()[\]{}<>|]/.test(line)
          && !mixedCaseNoise && !/\b[a-z]{3,}\s+\d{1,2}\s*$/.test(normalized);
      })
      .map(({ line, normalized }) => ({
        line,
        score: (normalized.match(/[a-z]{3,}/g) || []).length >= 2 ? 2 : ((normalized.match(/[a-z]{3,}/g) || [])[0]?.length >= 6 ? 1 : 0)
      }))
      .filter((candidate) => candidate.score > 0);
    const normalizedReceipt = normalizeName(lines.slice(0, 16).join(" "));
    const knownStores = [
      ["forte atacadista", /\bforte\b.*\batacadista\b|\batacadista\b.*\bforte\b/],
      ["Atacadão", /\batacadao\b/],
      ["Assaí Atacadista", /\bassai\b/],
      ["Tenda Atacado", /\btenda\b.*\batacado\b|\btenda\b/]
    ];
    const knownStore = knownStores.find(([, pattern]) => pattern.test(normalizedReceipt))?.[0] || "";
    const store = knownStore || storeCandidates.sort((a, b) => b.score - a.score)[0]?.line || "";
    const storeTrusted = Boolean(knownStore || store);
    const dateMatch = String(text || "").match(/\b([0-3]?\d)[/.\-]([01]?\d)[/.\-](20\d{2})\b/);
    let date = "";
    if (dateMatch) {
      const day = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const year = Number(dateMatch[3]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const itemHeaderFound = headerIndex >= 0;
    const stopItemSection = (normalized) =>
      /\b(qtd|quantidade)\b.*\b(total|itens)\b/.test(normalized)
      || /\b(total de produtos|total produtos|valor total|total da compra|forma de pagamento|tributos|impostos|consulta pela chave|chave de acesso|protocolo de autorizacao|dados do consumidor|consumidor nao identificado)\b/.test(normalized);
    let itemLines = [];
    if (itemHeaderFound) {
      for (let index = headerIndex + 1; index < lines.length; index += 1) {
        if (stopItemSection(normalizedLines[index])) break;
        itemLines.push(lines[index]);
      }
    } else {
      itemLines = lines.filter((line, index) => !stopItemSection(normalizedLines[index]));
    }
    const expectedMatch = lines.map((line) => normalizeName(line).match(/\b(?:qtd\.?\s*total\s*(?:de\s*)?itens|quantidade\s*total\s*(?:de\s*)?itens|total\s*(?:de\s*)?itens|itens)\s*[:.-]?\s*(\d{1,3})\b/)).find(Boolean);
    const expectedItemCount = expectedMatch ? Number(expectedMatch[1]) : 0;
    const totalLine = lines.map((line) => ({
      line,
      normalized: normalizeName(line),
      amount: [...line.matchAll(/(?:R\s*\$\s*)?(?<![\d,])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)/g)].map((match) => parseBrazilianNumber(match[1]))
    })).filter(({ normalized, amount }) => amount.length && /\b(valor total|total da compra|valor a pagar|total a pagar)\b/.test(normalized)).at(-1);
    const receiptTotal = totalLine?.amount.at(-1) || 0;
    const items = [];
    for (let index = 0; index < itemLines.length; index += 1) {
      const current = parseOcrItemLine(itemLines[index]);
      const combined = current ? null : parseOcrItemLine(`${itemLines[index]} ${itemLines[index + 1] || ""}`);
      const item = current || combined;
      if (!item) continue;
      items.push(item);
      if (combined) index += 1;
      if (items.length >= 60) break;
    }
    const keyMatch = String(text || "").match(/\b\d{44}\b/);
    return { store, storeTrusted, date, items, expectedItemCount, itemHeaderFound, receiptTotal, accessKey: keyMatch?.[0] || "" };
  }
  function applyOcrReceipt(text, qrValue) {
    const parsed = parseReceiptOcr(text);
    if (parsed.storeTrusted && parsed.store) $("#storeInput").value = parsed.store;
    if (parsed.date) $("#dateInput").value = parsed.date;
    if (qrValue || parsed.accessKey) applyQrValue(qrValue || parsed.accessKey);
    const itemSum = parsed.items.reduce((sum, item) => sum + item.price, 0);
    const countMatches = !parsed.expectedItemCount || parsed.items.length === parsed.expectedItemCount;
    const totalMatches = !parsed.receiptTotal
      || Math.abs(itemSum - parsed.receiptTotal) <= Math.max(2, parsed.receiptTotal * 0.02);
    const hasValidationAnchor = parsed.expectedItemCount > 0 || parsed.receiptTotal > 0;
    const itemsAreComplete = parsed.items.length > 0
      && countMatches
      && totalMatches
      && parsed.itemHeaderFound
      && hasValidationAnchor;
    if (itemsAreComplete) {
      $("#itemRows").innerHTML = "";
      parsed.items.forEach((item) => addItemRow(item));
      updateFormTotal();
    }
    $("#ocrTextOutput").textContent = String(text || "").trim().slice(0, 12000);
    $("#ocrTextDetails").hidden = !String(text || "").trim();
    return { ...parsed, itemsApplied: itemsAreComplete };
  }
  function ocrProgressPercent(message) {
    const status = String(message.status || "").toLowerCase();
    const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    if (status.includes("loading tesseract core")) return 5 + progress * 12;
    if (status.includes("loading language")) return 17 + progress * 35;
    if (status.includes("initializ")) return 52 + progress * 10;
    if (status.includes("recogniz")) return 62 + progress * 34;
    return 12 + progress * 80;
  }
  function ocrProgressLabel(message) {
    const status = String(message.status || "").toLowerCase();
    if (status.includes("loading tesseract core")) return "Carregando leitor de texto…";
    if (status.includes("loading language")) return "Preparando o idioma português…";
    if (status.includes("initializ")) return "Preparando leitura…";
    if (status.includes("recogniz")) return "Lendo os itens da nota…";
    return "Preparando leitura da nota…";
  }
  async function handlePhotoUpload(file) {
    if (!file) return;
    const imageFile = file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name || "");
    if (!imageFile) {
      showToast("Escolha uma imagem JPG, PNG ou WEBP.");
      return;
    }
    showToast("Foto recebida. Preparando a leitura da nota…");
    let image = null;
    let receiptCanvas = null;
    let highestProgress = 20;
    try {
      const receiptDialogOpen = $("#receiptDialog").open;
      const previousQrValue = receiptDialogOpen ? $("#qrInput").value.trim() : "";
      if (!receiptDialogOpen) openReceipt("", false);
      setProcessing(2, "Abrindo a foto…");
      image = await imageFileToCanvas(file);
      setProcessing(12, "Procurando o QR code…");
      const qrDetails = await decodeImageDetails(image.canvas);
      const qrValue = qrDetails?.value || previousQrValue;
      if (qrValue) applyQrValue(qrValue);
      setProcessing(18, "Recortando e melhorando a foto…");
      receiptCanvas = prepareReceiptCanvas(image.canvas, qrDetails?.rectangle);
      if (!receiptCanvas) throw new Error("Não foi possível preparar a foto. Tente escolher outra imagem.");
      setProcessing(25, "Carregando o leitor de texto…");
      const worker = await getOcrWorker((message) => {
        highestProgress = Math.max(highestProgress, ocrProgressPercent(message));
        setProcessing(highestProgress, ocrProgressLabel(message));
      });
      await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1", user_defined_dpi: "300" });
      const result = await worker.recognize(receiptCanvas);
      setProcessing(Math.max(95, highestProgress), "Organizando os dados reconhecidos…");
      const parsed = applyOcrReceipt(result.data.text, qrValue);
      const itemMessage = parsed.itemsApplied
        ? `${parsed.expectedItemCount ? `${parsed.items.length} de ${parsed.expectedItemCount}` : parsed.items.length} itens confirmados. ${parsed.store ? `Mercado: ${parsed.store}.` : "Mercado não reconhecido."} Confira os campos antes de salvar.`
        : `${parsed.items.length ? `Encontrei ${parsed.items.length} linhas, mas a quantidade ou a soma não bate com a nota${parsed.expectedItemCount ? ` (${parsed.items.length} lidas; esperado: ${parsed.expectedItemCount})` : ""}. ` : "Não encontrei linhas de produtos confiáveis. "}Não preenchi os itens para evitar valores errados. Tente uma foto mais próxima e nítida da tabela de produtos.`;
      setProcessing(100, itemMessage, parsed.itemsApplied ? "Leitura concluída" : "Leitura não confirmada", !parsed.itemsApplied);
      showToast(parsed.itemsApplied ? "Leitura concluída. Revise os dados antes de salvar." : "Não consegui confirmar os produtos. Tente uma foto mais próxima da tabela.");
    } catch (error) {
      const detail = error?.message || "Não foi possível interpretar esta foto.";
      const panel = $("#processingPanel");
      if (!panel.hidden) setProcessing(Math.max(20, highestProgress), detail, "Leitura incompleta", true);
      showToast(detail);
    } finally {
      if (receiptCanvas) {
        receiptCanvas.width = 0;
        receiptCanvas.height = 0;
      }
      image?.cleanup?.();
      setTimeout(() => $("#storeInput").focus(), 80);
    }
  }
  async function handlePdfUpload(file) {
    if (!file) return;
    if (isMobileDevice) {
      showToast("No celular, use Escanear nota para abrir a câmera.");
      return;
    }
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      showToast("No desktop, envie um arquivo PDF da nota.");
      return;
    }
    openReceipt("", false);
    setProcessing(2, "Abrindo o PDF…");
    try {
      const result = await findQrInPdf(file, (pageNumber, pageCount) => {
        const progress = 10 + (pageNumber / pageCount) * 78;
        setProcessing(progress, `Procurando QR code na página ${pageNumber} de ${pageCount}…`);
      });
      if (result.qrValue) {
        applyQrValue(result.qrValue);
        setProcessing(100, `QR code encontrado na página ${result.pageNumber}. Confira os itens abaixo.`, "Leitura concluída");
        showToast(`QR encontrado na página ${result.pageNumber}. Confira e inclua os itens.`);
      } else {
        setProcessing(100, `QR não encontrado nas ${result.scannedPages} páginas analisadas.`, "Leitura concluída");
        showToast(`QR não encontrado nas ${result.scannedPages} páginas analisadas; preencha os dados manualmente.`);
      }
    } catch (error) {
      setProcessing(100, "Não foi possível abrir este PDF. Tente novamente ou cadastre os dados manualmente.", "Leitura incompleta", true);
      showToast("Não foi possível ler esse PDF. Confira sua conexão e tente novamente.");
    } finally {
      setTimeout(() => $("#storeInput").focus(), 80);
    }
  }

  function beginPurchaseCapture() {
    openReceipt("", false);
    openScanner();
    startCamera();
  }

  function bindEvents() {
    $$(".nav-item").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.view)));
    $("#addReceiptButton").addEventListener("click", beginPurchaseCapture);
    $("#uploadPhotoButton").addEventListener("click", () => $("#photoUploadInput").click());
    $("#uploadReceiptButton").addEventListener("click", () => $("#receiptUploadInput").click());
    $("#authForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!cloud.client) return;
      const button = $("#authSubmit");
      button.disabled = true;
      $("#authStatus").textContent = "Entrando…";
      try {
        const { error } = await cloud.client.auth.signInWithPassword({ email: $("#authEmail").value.trim(), password: $("#authPassword").value });
        if (error) $("#authStatus").textContent = "E-mail ou senha inválidos. Confira o convite e tente novamente.";
      } catch (error) {
        $("#authStatus").textContent = error.message || "Não foi possível entrar. Confira a conexão e tente novamente.";
      } finally { button.disabled = false; }
    });
    $("#invitePasswordForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = $("#invitePassword").value;
      const confirmPassword = $("#invitePasswordConfirm").value;
      if (password.length < 8 || password !== confirmPassword) {
        $("#invitePasswordStatus").textContent = password !== confirmPassword ? "As senhas não conferem." : "Use pelo menos 8 caracteres.";
        return;
      }
      const button = $("#invitePasswordSubmit");
      button.disabled = true;
      $("#invitePasswordStatus").textContent = "Salvando senha…";
      try {
        const { data: current, error: currentError } = await cloud.client.auth.getUser();
        if (currentError) throw currentError;
        const { data, error } = await cloud.client.auth.updateUser({
          password,
          data: { ...(current.user?.user_metadata || {}), must_change_password: false }
        });
        if (error) throw error;
        inviteFlow = false;
        history.replaceState(null, "", `${location.pathname}#overview`);
        $("#invitePasswordForm").reset();
        await activateCloudUser(data.user);
      } catch (error) {
        $("#invitePasswordStatus").textContent = error.message || "Não foi possível definir a senha. Tente novamente.";
      } finally { button.disabled = false; }
    });
    $("#signOutButton").addEventListener("click", async () => { await cloud.client?.auth.signOut(); });
    $("#photoUploadInput").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) handlePhotoUpload(file);
    });
    $("#uploadPhotoFromReceipt").addEventListener("click", () => $("#photoUploadInput").click());
    $("#receiptUploadInput").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) handlePdfUpload(file);
    });
    $("#receiptForm").addEventListener("submit", handleReceiptSubmit);
    $("#addItemButton").addEventListener("click", () => addItemRow());
    $("#itemRows").addEventListener("input", (event) => {
      const row = event.target.closest(".item-row");
      if (!row) return;
      if (event.target.matches(".item-name") && row.dataset.categoryEdited !== "true") $(".item-category", row).value = guessCategory(event.target.value);
      if (event.target.matches(".item-price")) updateFormTotal();
    });
    $("#itemRows").addEventListener("change", (event) => {
      const row = event.target.closest(".item-row");
      if (row && event.target.matches(".item-category")) row.dataset.categoryEdited = "true";
    });
    $("#itemRows").addEventListener("click", (event) => {
      if (event.target.closest(".item-remove")) {
        const rows = $$(".item-row", $("#itemRows"));
        if (rows.length > 1) event.target.closest(".item-row").remove();
        else {
          const row = rows[0];
          $(".item-name", row).value = "";
          $(".item-quantity", row).value = "";
          $(".item-price", row).value = "";
          $(".item-category", row).value = "outros";
        }
        updateFormTotal();
      }
    });
    $("#qrInput").addEventListener("input", updateConsultationLink);
    $("#openConsultation").addEventListener("click", () => {
      const url = $("#openConsultation").dataset.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
    $("#openQrScanner").addEventListener("click", openScanner);
    $("#startScannerButton").addEventListener("click", startCamera);
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $("#receiptDialog").close()));
    $$("[data-close-scanner]").forEach((button) => button.addEventListener("click", () => { stopScanner(); $("#scannerDialog").close(); }));
    $("#scannerDialog").addEventListener("close", stopScanner);
    $("#receiptDialog").addEventListener("click", (event) => { if (event.target === $("#receiptDialog")) $("#receiptDialog").close(); });
    $("#scannerDialog").addEventListener("click", (event) => { if (event.target === $("#scannerDialog")) { stopScanner(); $("#scannerDialog").close(); } });
    $("#receiptSearch").addEventListener("input", renderAllReceipts);
    $("#monthTag").addEventListener("change", (event) => {
      selectedDashboardMonth = event.target.value;
      renderDashboard();
    });
    $("#exportButton").addEventListener("click", exportData);
    document.addEventListener("click", handleActions);
    window.addEventListener("hashchange", () => setPage(location.hash.slice(1)));
  }

  $("#todayLabel").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  bindEvents();
  renderDashboard();
  const initialView = location.hash.slice(1);
  if (["overview", "receipts", "products"].includes(initialView)) setPage(initialView);
  initCloudSync();
})();

