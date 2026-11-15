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
  const today = localDateString(new Date());
  const isMobileDevice = Boolean(navigator.userAgentData?.mobile)
    || /iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  document.documentElement.classList.toggle("mobile-device", isMobileDevice);
  let state = loadState();
  let toastTimer;
  let scanStream = null;
  let scanActive = false;
  let scanFrame = 0;
  let barcodeDetector = null;
  let lastScanAt = 0;
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
    const month = today.slice(0, 7);
    const monthReceipts = state.receipts.filter((receipt) => receipt.date?.startsWith(month));
    const monthTotal = monthReceipts.reduce((sum, receipt) => sum + receiptTotal(receipt), 0);
    const monthStores = new Set(monthReceipts.map((receipt) => normalizeName(receipt.store)).filter(Boolean));
    const products = allProductRecords();
    const recurring = products.filter((product) => product.purchaseCount > 1);
    $("#monthTag").textContent = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    $("#statSpend").textContent = money(monthTotal);
    $("#statSpendNote").textContent = `${monthReceipts.length} ${monthReceipts.length === 1 ? "nota no mês" : "notas no mês"}`;
    $("#statReceipts").textContent = String(monthReceipts.length);
    $("#statRecurring").textContent = String(recurring.length);
    $("#statStores").textContent = String(monthStores.size);
    $("#navReceiptCount").textContent = String(state.receipts.length);
    renderWeeklyChart();
    renderCategoryChart(monthReceipts);
    renderRecurring(recurring);
    renderStoreComparison(products);
    renderRecentReceipts();
  }
  function renderWeeklyChart() {
    const start = dateFromString(state.pilotStart);
    const weeks = Array.from({ length: 5 }, (_, index) => ({ index, total: 0, count: 0, start: new Date(start.getTime() + index * 7 * 86400000) }));
    state.receipts.forEach((receipt) => {
      const offset = dateDiff(state.pilotStart, receipt.date);
      const weekIndex = Math.floor(offset / 7);
      if (weekIndex >= 0 && weekIndex < weeks.length && offset < PILOT_DAYS) {
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
  function resetForm() {
    $("#receiptForm").reset();
    $("#receiptId").value = "";
    $("#itemRows").innerHTML = "";
    $("#dateInput").value = today;
    $("#qrInput").value = "";
    $("#receiptDialogTitle").textContent = "Adicionar compra";
    $("#openConsultation").hidden = true;
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
    $("#scannerMessage").textContent = "A câmera é usada somente para ler o código nesta tela.";
    $("#scannerPlaceholder").classList.remove("hidden");
    $("#scannerDialog").showModal();
  }
  async function startCamera() {
    const message = $("#scannerMessage");
    if (!("jsQR" in window) && !("BarcodeDetector" in window)) {
      message.textContent = "A leitura pela câmera não está disponível neste navegador. Cole o link ou a chave no formulário.";
      showToast("Não foi possível carregar o leitor QR. Tente recarregar a página.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      message.textContent = "A câmera exige uma conexão segura. Use localhost ou cole o link da nota no formulário.";
      return;
    }
    try {
      barcodeDetector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      const video = $("#scannerVideo");
      video.srcObject = scanStream;
      await video.play();
      $("#scannerPlaceholder").classList.add("hidden");
      message.textContent = "Aponte a câmera para o QR code da nota.";
      scanActive = true;
      lastScanAt = 0;
      scanFrame = requestAnimationFrame(scanLoop);
    } catch (error) {
      message.textContent = error.name === "NotAllowedError" ? "A câmera não foi autorizada. Cole o link ou a chave no formulário." : "Não foi possível abrir a câmera. Tente ler uma imagem ou cole a chave.";
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
          onQrRead(result);
          return;
        }
      } catch (error) { /* Keep scanning while the camera is active. */ }
    }
    scanFrame = requestAnimationFrame(scanLoop);
  }
  async function decodeImageSource(source) {
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
      if (result?.data) return result.data;
    }
    if (barcodeDetector) {
      const results = await barcodeDetector.detect(scanCanvas);
      if (results.length) return results[0].rawValue;
    }
    return null;
  }
  function onQrRead(value) {
    applyQrValue(value);
    stopScanner();
    $("#scannerDialog").close();
    showToast(/\d{44}/.test(value) ? "Chave da nota lida. Confira e adicione os itens." : "QR code lido. Confira o link e adicione os itens.");
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
  async function decodeQrFile(file) {
    if (!("jsQR" in window) && !("BarcodeDetector" in window)) {
      throw new Error("O leitor QR não carregou. Confira sua conexão e tente novamente.");
    }
    if (!barcodeDetector && "BarcodeDetector" in window) {
      try { barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (error) { barcodeDetector = null; }
    }
    let source = null;
    let objectUrl = "";
    try {
      if (window.createImageBitmap) source = await createImageBitmap(file);
      else {
        objectUrl = URL.createObjectURL(file);
        source = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = objectUrl;
        });
      }
      return await decodeImageSource(source);
    } finally {
      source?.close?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  async function readQrImage(file) {
    const message = $("#scannerMessage");
    try {
      const result = await decodeQrFile(file);
      if (result) onQrRead(result);
      else message.textContent = "Não encontramos um QR code nessa imagem. Tente uma foto mais nítida.";
    } catch (error) {
      message.textContent = error.message || "Não foi possível ler essa imagem. Tente a câmera ou cole a chave.";
    }
  }
  async function handleReceiptUpload(file) {
    if (!file) return;
    if (isMobileDevice) {
      showToast("No celular, use Escanear nota para abrir a câmera.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      showToast("Envie uma foto ou imagem da nota (JPG, PNG ou WEBP).");
      return;
    }
    openReceipt("", false);
    showToast("Imagem selecionada. Procurando o QR code…");
    try {
      const result = await decodeQrFile(file);
      if (result) {
        applyQrValue(result);
        showToast("QR code encontrado. Confira e inclua os itens da nota.");
      } else {
        showToast("Imagem aberta. QR não encontrado; preencha os dados manualmente.");
      }
    } catch (error) {
      showToast(error.message || "Não foi possível ler a imagem. Você pode preencher os dados manualmente.");
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
    $("#uploadReceiptButton").addEventListener("click", () => $("#receiptUploadInput").click());
    $("#receiptUploadInput").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) handleReceiptUpload(file);
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
    $("#qrImageInput").addEventListener("change", (event) => { if (event.target.files?.[0]) readQrImage(event.target.files[0]); });
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $("#receiptDialog").close()));
    $$("[data-close-scanner]").forEach((button) => button.addEventListener("click", () => { stopScanner(); $("#scannerDialog").close(); }));
    $("#scannerDialog").addEventListener("close", stopScanner);
    $("#receiptDialog").addEventListener("click", (event) => { if (event.target === $("#receiptDialog")) $("#receiptDialog").close(); });
    $("#scannerDialog").addEventListener("click", (event) => { if (event.target === $("#scannerDialog")) { stopScanner(); $("#scannerDialog").close(); } });
    $("#receiptSearch").addEventListener("input", renderAllReceipts);
    $("#exportButton").addEventListener("click", exportData);
    document.addEventListener("click", handleActions);
    window.addEventListener("hashchange", () => setPage(location.hash.slice(1)));
  }

  $("#todayLabel").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  bindEvents();
  renderDashboard();
  const initialView = location.hash.slice(1);
  if (["overview", "receipts", "products"].includes(initialView)) setPage(initialView);
})();

