const FinanciamentoState = {
  view: "busca",
  painel: "pesquisa",
  customer: null,
  contracts: [],
  selected: null,
  process: null
};

const FIN_PROC_KEY = "crm_moura_financiamentos_proc";

const FinanciamentoApp = {
  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  fmtDate(raw) {
    if (!raw) return "—";
    const s = String(raw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.split("-");
      return `${d}/${m}/${y}`;
    }
    return s;
  },

  fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },

  formatUnidade(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (!s || s === "—" || s === "N/D") return s || "—";
    s = s.replace(/^quadra-lote:\s*/i, "").trim();
    s = s.replace(/^u[\.\s\-]+/i, "").trim();
    return s || "—";
  },

  init() {
    this.render();
    this.populateEmpreendimentos();
    this.puxarNuvem();
  },

  /* A lista de financiamentos só vinha da nuvem no login. Quem abriu o sistema antes de outra pessoa incluir
   * um financiamento não via o cliente na esteira. Agora, ao abrir a tela, junta com a nuvem (sem apagar nada)
   * e, se este navegador tiver algum que a nuvem ainda não tem, envia. */
  async puxarNuvem(forcar) {
    const agora = Date.now();
    if (!forcar && this._nuvemEm && agora - this._nuvemEm < 20000) return;
    if (this._nuvemLendo) return;
    const fc = window.firebaseCollections;
    if (!fc || !window.firebaseDb || typeof fc.getDoc !== "function" || typeof window.crmFinanciamentosMesclar !== "function") return;
    this._nuvemLendo = true;
    this._nuvemEm = agora;
    try {
      const snap = await fc.getDoc(fc.doc(window.firebaseDb, "config", "global"));
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      const nuvem = existe ? String((snap.data() || {})[FIN_PROC_KEY] || "{}") : "{}";
      let local = "{}";
      try { local = localStorage.getItem(FIN_PROC_KEY) || "{}"; } catch (e) {}
      const junto = window.crmFinanciamentosMesclar(local, nuvem);
      const mapaJunto = this.lerMapaProc(junto);
      const mapaNuvem = this.lerMapaProc(nuvem);
      const mapaLocal = this.lerMapaProc(local);
      const chegouNovo = Object.keys(mapaJunto).some((k) => !mapaLocal[k]
        || String(mapaJunto[k].updatedAt || "") !== String(mapaLocal[k].updatedAt || ""));
      const faltaNaNuvem = Object.keys(mapaJunto).some((k) => !mapaNuvem[k]
        || String(mapaJunto[k].updatedAt || "") > String(mapaNuvem[k].updatedAt || ""));
      if (junto !== local) {
        const gravar = window._originalSetItem || localStorage.setItem.bind(localStorage);
        try { gravar.call(localStorage, FIN_PROC_KEY, junto); } catch (e) {}
        try { sessionStorage.setItem(FIN_PROC_KEY, junto); } catch (e) {}
        window._finProcMem = mapaJunto;
      }
      if (faltaNaNuvem && window.forceUploadLocalConfig) window.forceUploadLocalConfig(true).catch(() => {});
      if (chegouNovo && FinanciamentoState.view !== "fluxo" && document.getElementById("financiamento-root")) this.render();
    } catch (e) {
      console.warn("[Financiamento] leitura da nuvem", e);
    } finally {
      this._nuvemLendo = false;
    }
  },

  render() {
    const root = document.getElementById("financiamento-root");
    if (!root) return;
    const noFluxo = FinanciamentoState.view === "fluxo";
    const painel = FinanciamentoState.painel === "esteira" ? "esteira" : "pesquisa";
    root.innerHTML = noFluxo ? this.fluxoHtml() : (this.abasHtml(painel) + (painel === "esteira" ? this.esteiraHtml() : this.buscaHtml()));
    if (window.lucide) lucide.createIcons();
    if (!noFluxo && painel === "pesquisa") this.restoreBuscaUi();
    if (noFluxo) {
      this.prepararTagsUnidade();
      this.ligarEtapa();
    }
  },

  setPainel(id) {
    if (FinanciamentoState.process) this.saveProcess(FinanciamentoState.process);
    FinanciamentoState.painel = id === "esteira" ? "esteira" : "pesquisa";
    FinanciamentoState.view = "busca";
    this.render();
    if (FinanciamentoState.painel === "esteira") this.puxarNuvem();
  },

  abasHtml(painel) {
    const n = this.listOpenProcesses().length;
    return `<div class="ml-tabs fin-abas" role="tablist">
      <button type="button" role="tab" aria-selected="${painel === "pesquisa"}" class="ml-tab ${painel === "pesquisa" ? "is-active" : ""}" onclick="FinanciamentoApp.setPainel('pesquisa')"><i data-lucide="search"></i> Pesquisar</button>
      <button type="button" role="tab" aria-selected="${painel === "esteira"}" class="ml-tab ${painel === "esteira" ? "is-active" : ""}" onclick="FinanciamentoApp.setPainel('esteira')"><i data-lucide="columns-3"></i> Esteira <span class="ml-tab-count">${n}</span></button>
    </div>`;
  },

  buscaHtml() {
    return `
      <style>
        #fin-filter-titulo, #fin-filter-contrato, #fin-filter-doc,
        #fin-filter-emp, #fin-filter-unidade, #fin-filter-nome,
        #fin-filter-telefone, #fin-filter-email { border-color:#94a3b8 !important; }
      </style>
      <div class="crm-card" style="margin-bottom:20px;">
        <div class="crm-card-header" style="background-color:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Pesquisar</h3>
          <div style="display:flex;gap:15px;align-items:center;">
            <button type="button" class="btn btn-outline btn-sm" onclick="window.startCustomerBackgroundSync && window.startCustomerBackgroundSync(true)" style="display:flex;align-items:center;gap:6px;padding:4px 8px;">
              <i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Atualizar Base
            </button>
          </div>
        </div>
        <div class="crm-card-content" style="padding-bottom:0;">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 160px;gap:16px;align-items:end;margin-bottom:20px;">
            <div class="form-group" style="grid-column:1 / 2;margin:0;">
              <label>Título (Contas a Receber)</label>
              <input type="text" class="form-control" id="fin-filter-titulo" placeholder="" onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="this.value=this.value.replace(/[^0-9]/g,'');FinanciamentoApp.toggleFilters()">
            </div>
            <div class="form-group" style="grid-column:2 / 3;margin:0;">
              <label>Contrato</label>
              <input type="text" class="form-control" id="fin-filter-contrato" placeholder="" onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="FinanciamentoApp.toggleFilters()">
            </div>
            <div class="form-group" style="grid-column:3 / 4;margin:0;">
              <label>CPF/CNPJ</label>
              <input type="text" class="form-control" id="fin-filter-doc" placeholder="000.000.000-00" onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="if(typeof maskCpfCnpj==='function') maskCpfCnpj(this); FinanciamentoApp.toggleFilters()">
            </div>
            <div class="form-group" style="grid-column:1 / 3;margin:0;">
              <label>Empreendimento</label>
              <select class="form-control" id="fin-filter-emp" onchange="FinanciamentoApp.loadUnidades(this.value); FinanciamentoApp.toggleFilters();">
                <option value="">Selecione...</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:3 / 4;margin:0;">
              <label>Unidade</label>
              <select class="form-control" id="fin-filter-unidade" onchange="if(this.value) FinanciamentoApp.buscar();" disabled>
                <option value="">Selecione o emp...</option>
              </select>
            </div>
            <div class="form-group" style="grid-column:4 / 5;margin:0;display:flex;align-items:flex-end;">
              <button type="button" class="btn btn-primary" style="height:38px;width:100%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;padding:0;" onclick="FinanciamentoApp.limparBusca()" title="Nova Busca / Limpar">
                <i data-lucide="eraser" style="width:14px;margin-right:6px;"></i> Limpar
              </button>
            </div>
            <div class="form-group" style="grid-column:1 / 2;margin:0;position:relative;">
              <label>Nome do Cliente</label>
              <input type="text" class="form-control" id="fin-filter-nome" placeholder="Digite para buscar..." onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="handleDynamicCustomerSearch(this.value,'nome','fin'); FinanciamentoApp.toggleFilters()" autocomplete="off">
            </div>
            <div class="form-group" style="grid-column:2 / 3;margin:0;position:relative;">
              <label>Telefone</label>
              <input type="text" class="form-control" id="fin-filter-telefone" placeholder="Digite para buscar..." onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="handleDynamicCustomerSearch(this.value,'telefone','fin'); FinanciamentoApp.toggleFilters()" autocomplete="off">
            </div>
            <div class="form-group" style="grid-column:3 / 4;margin:0;position:relative;">
              <label>E-mail</label>
              <input type="text" class="form-control" id="fin-filter-email" placeholder="Digite para buscar..." onkeydown="if((event.key==='Enter'||event.key==='Tab')&&this.value){event.preventDefault();FinanciamentoApp.buscar();}" oninput="handleDynamicCustomerSearch(this.value,'email','fin'); FinanciamentoApp.toggleFilters()" autocomplete="off">
            </div>
          </div>
        </div>
      </div>

      <div class="crm-card" id="fin-abertos-card" style="margin-bottom:24px;">
        <div class="crm-card-header" style="background-color:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;margin-bottom:0;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Financiamentos em aberto</h3>
          <span id="fin-abertos-count" style="font-size:0.75rem;color:#64748b;font-weight:700;"></span>
        </div>
        <div class="crm-card-content" style="padding:0;">
          <div style="overflow:auto;max-height:280px;border-bottom-left-radius:8px;border-bottom-right-radius:8px;">
            <table class="crm-table" style="width:100%;border-collapse:separate;border-spacing:0;">
              <thead style="position:sticky;top:0;background:#f3f4f6;z-index:10;">
                <tr>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Cliente</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Contrato</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Título</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Unidade</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Etapa</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Atualizado</th>
                </tr>
              </thead>
              <tbody id="fin-abertos-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="crm-card" id="fin-results-card" style="display:none;">
        <div class="crm-card-header" style="background-color:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;margin-bottom:20px;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Contratos do cliente</h3>
        </div>
        <div class="crm-card-content" style="padding:0;">
          <div style="overflow:auto;max-height:480px;border-bottom-left-radius:8px;border-bottom-right-radius:8px;">
            <table class="crm-table" style="width:100%;border-collapse:separate;border-spacing:0;">
              <thead style="position:sticky;top:0;background:#f3f4f6;z-index:10;">
                <tr>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Contrato</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Título</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Empreendimento</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Unidade</th>
                  <th style="text-align:left;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Data Venda</th>
                  <th style="text-align:center;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Status</th>
                  <th style="text-align:center;padding:10px;font-size:0.6rem;color:#64748b;text-transform:uppercase;">Ações</th>
                </tr>
              </thead>
              <tbody id="fin-results-tbody">
                <tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8;">Faça uma busca para encontrar clientes.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  },

  restoreBuscaUi() {
    if (FinanciamentoState.contracts && FinanciamentoState.contracts.length) {
      this.renderContractsTable(FinanciamentoState.contracts);
    }
    this.populateEmpreendimentos();
    this.renderAbertos();
  },

  limparBusca() {
    ["fin-filter-titulo", "fin-filter-contrato", "fin-filter-doc", "fin-filter-nome", "fin-filter-telefone", "fin-filter-email"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.value = ""; el.disabled = false; }
    });
    const emp = document.getElementById("fin-filter-emp");
    const uni = document.getElementById("fin-filter-unidade");
    if (emp) { emp.value = ""; emp.disabled = false; }
    if (uni) {
      uni.innerHTML = '<option value="">Selecione o emp...</option>';
      uni.disabled = true;
    }
    window.FinanciamentoSelectedCustomerId = null;
    FinanciamentoState.customer = null;
    FinanciamentoState.contracts = [];
    ["nome", "telefone", "email"].forEach((t) => {
      const dd = document.getElementById("custom-dropdown-fin-" + t);
      if (dd) dd.style.display = "none";
    });
    const rc = document.getElementById("fin-results-card");
    if (rc) rc.style.display = "none";
    this.toggleFilters();
    this.renderAbertos();
  },

  toggleFilters() {
    const nome = document.getElementById("fin-filter-nome");
    const tel = document.getElementById("fin-filter-telefone");
    const email = document.getElementById("fin-filter-email");
    const doc = document.getElementById("fin-filter-doc");
    const titulo = document.getElementById("fin-filter-titulo");
    const contrato = document.getElementById("fin-filter-contrato");
    const emp = document.getElementById("fin-filter-emp");
    const uni = document.getElementById("fin-filter-unidade");
    const hasNome = nome && nome.value.trim() !== "";
    const hasTel = tel && tel.value.trim() !== "";
    const hasEmail = email && email.value.trim() !== "";
    const hasDoc = doc && doc.value.trim() !== "";
    const hasTitulo = titulo && titulo.value.trim() !== "";
    const hasContrato = contrato && contrato.value.trim() !== "";
    const hasEmp = emp && emp.value !== "";
    if (nome) nome.disabled = hasTel || hasEmail || hasDoc || hasTitulo || hasContrato || hasEmp;
    if (tel) tel.disabled = hasNome || hasEmail || hasDoc || hasTitulo || hasContrato || hasEmp;
    if (email) email.disabled = hasNome || hasTel || hasDoc || hasTitulo || hasContrato || hasEmp;
    if (doc) doc.disabled = hasNome || hasTel || hasEmail || hasTitulo || hasContrato || hasEmp;
    if (titulo) titulo.disabled = hasNome || hasTel || hasEmail || hasDoc || hasContrato || hasEmp;
    if (contrato) contrato.disabled = hasNome || hasTel || hasEmail || hasDoc || hasTitulo || hasEmp;
    if (emp) emp.disabled = hasNome || hasTel || hasEmail || hasDoc || hasTitulo || hasContrato;
    if (uni) uni.disabled = !hasEmp || hasNome || hasTel || hasEmail || hasDoc || hasTitulo || hasContrato;
  },

  async populateEmpreendimentos() {
    const empSelect = document.getElementById("fin-filter-emp");
    if (!empSelect || !window.SiengeApiService) return;
    try {
      const keep = empSelect.value;
      let ccs = await SiengeApiService.getCostCenters();
      let customFields = {};
      try { customFields = JSON.parse(localStorage.getItem("crm_centros_custo_custom") || "{}") || {}; } catch (e) {}
      if (window.EstoqueComercialApp && typeof EstoqueComercialApp.filterEmpreendimentosLikeRelacionamento === "function") {
        ccs = EstoqueComercialApp.filterEmpreendimentosLikeRelacionamento(ccs);
      } else {
        ccs = (ccs || []).filter((c) => {
          const custom = customFields[c.id] || customFields[String(c.id)] || {};
          const tipo = custom.tipo_cc || "";
          return tipo === "Loteamento Aberto" || tipo === "Loteamento Fechado" || tipo === "Incorporação";
        });
      }
      ccs.sort((a, b) => a.id - b.id);
      empSelect.innerHTML = '<option value="">Selecione...</option>' + ccs.map((c) =>
        `<option value="${c.id}">${c.id} - ${this.esc(c.name)}</option>`
      ).join("");
      if (keep && Array.from(empSelect.options).some((o) => String(o.value) === String(keep))) empSelect.value = keep;
    } catch (e) {}
  },

  async loadUnidades(cc) {
    const selectUnidade = document.getElementById("fin-filter-unidade");
    if (!selectUnidade) return;
    selectUnidade.innerHTML = '<option value="">Carregando unidades...</option>';
    selectUnidade.disabled = true;
    if (!cc) {
      selectUnidade.innerHTML = '<option value="">Selecione o emp...</option>';
      return;
    }
    try {
      let allUnits = [];
      let offset = 0;
      const limit = 200;
      while (true) {
        const data = await window.siengeFetchWithRetry(`/units?limit=${limit}&offset=${offset}&enterpriseId=${cc}&additionalData=NONE`);
        const results = data.results || [];
        allUnits = allUnits.concat(results);
        if (!results.length) break;
        offset += results.length;
      }
      allUnits = allUnits.filter((u) => u.commercialStock !== "T");
      allUnits.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { numeric: true }));
      selectUnidade.innerHTML = '<option value="">Selecione...</option>' + allUnits.map((u) => {
        const label = this.formatUnidade(u.name || u.id);
        return `<option value="${u.id}" data-contract="${this.esc(u.contractId || "")}">${this.esc(label)}</option>`;
      }).join("");
      selectUnidade.disabled = false;
    } catch (e) {
      selectUnidade.innerHTML = '<option value="">Erro ao carregar unidades</option>';
    }
  },

  norm(str) {
    return String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  },

  sugerirCliente(val, tipo) {
    if (typeof window.handleDynamicCustomerSearch === "function") {
      window.handleDynamicCustomerSearch(val, tipo, "fin");
    }
  },

  escolherSugestao(id) {
    window.FinanciamentoSelectedCustomerId = id;
    const cache = (window.GlobalCustomerCache && window.GlobalCustomerCache.data) || [];
    const hit = cache.find((c) => String(c.id) === String(id));
    if (hit) {
      const nome = document.getElementById("fin-filter-nome");
      const doc = document.getElementById("fin-filter-doc");
      if (nome) nome.value = hit.name || "";
      if (doc) doc.value = hit.cpf || hit.cnpj || hit.cpfCnpj || String(hit.id);
    }
    const sug = document.getElementById("fin-sugestoes");
    if (sug) sug.style.display = "none";
    this.buscar();
  },

  proxyBase() {
    const port = (window.location.port === "5500" || !window.location.port) ? "3000" : window.location.port;
    const host = (window.location.hostname === "" || window.location.hostname === "127.0.0.1") ? "localhost" : window.location.hostname;
    return `http://${host}:${port}/sienge-proxy`;
  },

  authHeader() {
    return window.getBasicAuthHeader ? getBasicAuthHeader() : "";
  },

  async resolveCustomerId() {
    if (window.FinanciamentoSelectedCustomerId) return String(window.FinanciamentoSelectedCustomerId);
    const titulo = ((document.getElementById("fin-filter-titulo") || {}).value || "").trim();
    const contrato = ((document.getElementById("fin-filter-contrato") || {}).value || "").trim();
    const emp = ((document.getElementById("fin-filter-emp") || {}).value || "").trim();
    const unidadeSel = document.getElementById("fin-filter-unidade");
    const unidadeId = unidadeSel && unidadeSel.value ? unidadeSel.value : "";
    const nome = ((document.getElementById("fin-filter-nome") || {}).value || "").trim();
    const docRaw = ((document.getElementById("fin-filter-doc") || {}).value || "").trim();
    const tel = (((document.getElementById("fin-filter-telefone") || {}).value || "").replace(/\D/g, ""));
    const email = ((document.getElementById("fin-filter-email") || {}).value || "").trim();
    const docDigits = String(docRaw).replace(/\D/g, "");
    const cache = (window.GlobalCustomerCache && window.GlobalCustomerCache.data) || [];
    const base = this.proxyBase();
    const headers = { Authorization: this.authHeader() };

    if (titulo) {
      const res = await fetch(`${base}/accounts-receivable/receivable-bills/${encodeURIComponent(titulo)}`, { headers });
      if (!res.ok) throw new Error(`Título não encontrado: ${titulo}`);
      const bill = await res.json();
      if (!bill.customerId) throw new Error("Título sem cliente associado.");
      return String(bill.customerId);
    }

    if (contrato) {
      const c = await window.findSalesContractExact(contrato, async (path) => {
        const res = await fetch(`${base}${path}`, { headers });
        if (!res.ok) throw new Error(`Contrato não encontrado: ${contrato}`);
        return res.json();
      });
      if (!c) throw new Error(`Contrato não encontrado: ${contrato}`);
      let cid = c.customerId || (c.customer && c.customer.id) || (c.customers && c.customers[0] && (c.customers[0].id || c.customers[0].customerId));
      if (!cid && c.receivableBillId) {
        const bRes = await fetch(`${base}/accounts-receivable/receivable-bills/${c.receivableBillId}`, { headers });
        if (bRes.ok) {
          const bill = await bRes.json();
          cid = bill.customerId;
        }
      }
      if (!cid) throw new Error("Cliente não encontrado no contrato.");
      return String(cid);
    }

    if (emp && unidadeId) {
      const res = await fetch(`${base}/sales-contracts?enterpriseId=${encodeURIComponent(emp)}&unitId=${encodeURIComponent(unidadeId)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const list = data.results || [];
        const pick = list.find((c) => String(c.status).toUpperCase() === "ACTIVE") || list[0];
        if (pick) {
          const cid = pick.customerId || (pick.customer && pick.customer.id);
          if (cid) return String(cid);
        }
      }
      const opt = unidadeSel.options[unidadeSel.selectedIndex];
      const contractId = opt && opt.getAttribute("data-contract");
      if (contractId) {
        const scRes = await fetch(`${base}/sales-contracts/${contractId}`, { headers });
        if (scRes.ok) {
          const sc = await scRes.json();
          const cid = sc.customerId || (sc.customer && sc.customer.id);
          if (cid) return String(cid);
        }
      }
    }

    if (docDigits.length >= 11 && cache.length) {
      const byDoc = cache.find((c) => String(c.cpf || c.cnpj || c.cpfCnpj || "").replace(/\D/g, "") === docDigits);
      if (byDoc) return String(byDoc.id);
    }
    if (/^\d+$/.test(docRaw) && docRaw.length <= 8) return docRaw;
    let match = null;
    if (nome && cache.length) {
      const terms = this.norm(nome).split(/\s+/).filter(Boolean);
      match = cache.find((c) => terms.every((t) => this.norm(c.name).includes(t)));
    } else if (tel.length >= 4 && cache.length) {
      match = cache.find((c) => (c.phones || []).some((p) => {
        const full = String(p.areaCode || "") + String(p.number || p.phoneNumber || "");
        return full.replace(/\D/g, "").includes(tel);
      }));
    } else if (email && cache.length) {
      match = cache.find((c) => this.norm(c.email).includes(this.norm(email)));
    }
    return match ? String(match.id) : null;
  },

  customerCardHtml(c) {
    const doc = c.cpfCnpj || c.cpf || c.cnpj || "";
    const docLabel = String(doc).replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF";
    let age = "Não informado";
    if (c.birthDate && String(doc).replace(/\D/g, "").length <= 11) {
      const birth = new Date(String(c.birthDate).slice(0, 10) + "T12:00:00");
      if (!isNaN(birth.getTime())) {
        const today = new Date();
        let diff = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) diff--;
        age = diff + " anos";
      }
    }
    const prof = c.profession || c.occupation || "N/D";
    let addr = "Não informado";
    if (c.addresses && c.addresses[0]) {
      const a = c.addresses[0];
      addr = [a.street || a.streetName, a.number, a.complement, a.neighborhood, [a.cityName || a.city, a.stateName || a.state].filter(Boolean).join("/"), a.postalCode || a.zipCode ? "CEP: " + (a.postalCode || a.zipCode) : ""]
        .filter(Boolean).join(", ");
    }
    let phone = "Não informado";
    const phones = c.phones || [];
    if (phones[0]) {
      const p = phones[0];
      const d = (String(p.areaCode || "") + String(p.number || p.phoneNumber || "")).replace(/\D/g, "");
      phone = d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : (d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d);
    }
    const email = c.email || "Não informado";
    const fmtDoc = typeof formatCpfCnpj === "function" ? formatCpfCnpj(doc) : doc;
    return `
      <div class="cessao-customer-grid">
        <div class="cessao-customer-field cessao-customer-field--wide"><span class="cessao-lbl">Nome</span><span class="cessao-val">${this.esc(c.name || "—")}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">${docLabel}</span><span class="cessao-val">${this.esc(fmtDoc || "—")}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">Idade</span><span class="cessao-val">${this.esc(age)}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">Profissão</span><span class="cessao-val">${this.esc(prof)}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">Telefones</span><span class="cessao-val">${this.esc(phone)}</span></div>
        <div class="cessao-customer-field"><span class="cessao-lbl">E-mail</span><span class="cessao-val">${this.esc(email)}</span></div>
        <div class="cessao-customer-field cessao-customer-field--full"><span class="cessao-lbl">Endereço</span><span class="cessao-val">${this.esc(addr)}</span></div>
      </div>`;
  },

  statusPill(status) {
    const st = String(status || "").toUpperCase();
    if (st.includes("QUIT")) return '<span style="background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">Quitado</span>';
    if (st.includes("CANCEL") || st.includes("DISTRAT")) return '<span style="background:#f1f5f9;border:1px solid #cbd5e1;color:#475569;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">Distratado/Cancelado</span>';
    if (st.includes("ACTIVE") || st.includes("ATIVO") || !st) {
      return '<span style="background:#ecfdf5;border:1px solid #86efac;color:#166534;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">Adimplente</span>';
    }
    return `<span style="background:#f8fafc;border:1px solid #e2e8f0;color:#334155;padding:4px 10px;border-radius:12px;font-size:0.72rem;font-weight:700;">${this.esc(status)}</span>`;
  },

  async buscar() {
    const tbody = document.getElementById("fin-results-tbody");
    const results = document.getElementById("fin-results-card");
    const sug = document.getElementById("fin-sugestoes");
    if (sug) sug.style.display = "none";
    let customerId;
    try {
      customerId = await this.resolveCustomerId();
    } catch (e) {
      alert(e.message || "Não foi possível localizar o cliente.");
      return;
    }
    if (!customerId) {
      alert("Preencha pelo menos um campo para pesquisar.");
      return;
    }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:#64748b;">
        <div class="loading-spinner" style="width:28px;height:28px;border:3px solid rgba(16,84,54,0.15);border-top-color:var(--color-primary);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px;"></div>
        Buscando contratos do cliente…
      </td></tr>`;
    }
    if (results) results.style.display = "block";
    try {
      const svc = window.SiengeApiService;
      if (!svc) throw new Error("API Sienge indisponível");
      const customer = await svc.getCustomer(customerId);
      if (!customer) throw new Error("Cliente não encontrado");
      FinanciamentoState.customer = customer;
      let contracts = [];
      if (typeof svc.getSales === "function") contracts = await svc.getSales(customerId);
      if (!Array.isArray(contracts)) contracts = [];
      FinanciamentoState.contracts = contracts;
      this.renderContractsTable(contracts);
    } catch (e) {
      console.error("[Financiamento] busca", e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--color-danger);">${this.esc(e.message || "Falha na busca")}</td></tr>`;
    }
  },

  renderContractsTable(contracts) {
    const tbody = document.getElementById("fin-results-tbody");
    const results = document.getElementById("fin-results-card");
    if (results) results.style.display = "block";
    if (!tbody) return;
    if (!contracts.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#94a3b8;">Nenhum contrato encontrado para este cliente.</td></tr>';
      return;
    }
    const ccs = (window.AppState && AppState.cachedCostCenters) || [];
    const ccMap = {};
    ccs.forEach((cc) => { ccMap[String(cc.id)] = cc.name; });
    const customer = FinanciamentoState.customer || {};
    tbody.innerHTML = contracts.map((c) => {
      const cid = c.id || c.contractId || "";
      const num = c.contractNumber || c.number || cid;
      const titulo = c.receivableBillId || c.billReceivableId || "—";
      const empId = c.enterpriseId || c.costCenterId || "";
      const empName = ccMap[String(empId)] || c.enterpriseName || empId || "—";
      const unitLabel = this.formatUnidade(c.unitName || c.unityName || c.unitId || "—");
      const dataVenda = this.fmtDate(c.saleDate || c.contractDate || c.issueDate);
      const proc = this.getProcess(customer.id, cid);
      const btnLabel = proc ? "Continuar financiamento" : "Iniciar financiamento";
      return `<tr>
        <td style="padding:10px;font-weight:700;font-size:0.75rem;">${this.esc(num)}</td>
        <td style="padding:10px;font-weight:800;font-size:0.75rem;">${this.esc(titulo)}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(empName)}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(unitLabel)}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(dataVenda)}</td>
        <td style="padding:10px;text-align:center;">${this.statusPill(c.status)}</td>
        <td style="padding:10px;text-align:center;white-space:nowrap;">
          <button type="button" class="btn btn-primary btn-sm"
            onclick="FinanciamentoApp.iniciar('${String(customer.id).replace(/'/g, "")}','${String(cid).replace(/'/g, "")}','${String(titulo).replace(/'/g, "")}','${String(num).replace(/'/g, "")}')"
            style="padding:6px 12px;font-size:0.75rem;font-weight:700;">
            <i data-lucide="landmark" style="width:14px;height:14px;margin-right:4px;"></i> ${btnLabel}
          </button>
        </td>
      </tr>`;
    }).join("");
    if (window.lucide) lucide.createIcons();
  },

  lerMapaProc(raw) {
    try {
      const obj = JSON.parse(raw || "{}") || {};
      return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
    } catch (e) {
      return {};
    }
  },

  /* Disco, aba e memória. A nuvem às vezes devolve a lista antiga e apagava o financiamento recém-incluído. */
  loadAllProcesses() {
    let disco = "{}";
    let sessao = "{}";
    try { disco = localStorage.getItem(FIN_PROC_KEY) || "{}"; } catch (e) {}
    try { sessao = sessionStorage.getItem(FIN_PROC_KEY) || "{}"; } catch (e) {}
    let merged = disco;
    if (typeof window.mergeFinanciamentosProc === "function") {
      merged = window.mergeFinanciamentosProc(disco, sessao);
      merged = window.mergeFinanciamentosProc(merged, JSON.stringify(window._finProcMem || {}));
    }
    return this.lerMapaProc(merged);
  },

  isProcessoAberto(proc) {
    if (!proc) return false;
    const st = String(proc.status || "").toLowerCase();
    if (st === "concluido" || st === "encerrado" || st === "cancelado" || st === "closed") return false;
    if (proc.closedAt || proc.finishedAt) return false;
    return true;
  },

  listOpenProcesses() {
    const all = this.loadAllProcesses();
    const mem = FinanciamentoState.process;
    if (mem && mem.customerId && mem.contractId) {
      const key = this.procKey(mem.customerId, mem.contractId);
      const saved = all[key];
      const tm = Date.parse(mem.updatedAt || mem.startedAt || 0) || 0;
      const ts = Date.parse((saved && (saved.updatedAt || saved.startedAt)) || 0) || 0;
      if (!saved || tm >= ts) all[key] = mem;
    }
    return Object.keys(all).map((key) => {
      const proc = all[key];
      if (!proc || typeof proc !== "object") return null;
      if (!this.isProcessoAberto(proc)) return null;
      return { key, proc };
    }).filter(Boolean).sort((a, b) => String(b.proc.updatedAt || b.proc.startedAt || "").localeCompare(String(a.proc.updatedAt || a.proc.startedAt || "")));
  },

  etapaLabel(proc) {
    const catalog = typeof window.buildFinanciamentoStageCatalog === "function"
      ? window.buildFinanciamentoStageCatalog()
      : (window.EtapasFinanciamentoState || []);
    const id = proc && proc.currentStageId;
    if (!id) return "Aguardando primeira etapa";
    const hit = (catalog || []).find((s) => s && String(s.id) === String(id));
    return (hit && (hit.label || hit.nome)) || String(id);
  },

  renderAbertos() {
    const tbody = document.getElementById("fin-abertos-tbody");
    const countEl = document.getElementById("fin-abertos-count");
    if (!tbody) return;
    const rows = this.listOpenProcesses();
    const atrasos = this.atrasadosEsteira();
    const ordem = new Map();
    atrasos.forEach((item, i) => ordem.set(String(item.row.key), i));
    const nVenc = atrasos.length;
    if (countEl) {
      countEl.style.color = nVenc ? "#b91c1c" : "#64748b";
      countEl.textContent = rows.length
        ? (rows.length + " em andamento" + (nVenc ? (" · " + nVenc + (nVenc === 1 ? " vencida" : " vencidas")) : ""))
        : "";
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:22px;color:#94a3b8;">Nenhum financiamento em aberto. Pesquise um cliente e clique em Iniciar financiamento.</td></tr>';
      return;
    }
    const lista = rows.slice().sort((a, b) => {
      const ia = ordem.has(String(a.key)) ? ordem.get(String(a.key)) : 100000;
      const ib = ordem.has(String(b.key)) ? ordem.get(String(b.key)) : 100000;
      return ia - ib;
    });
    tbody.innerHTML = lista.map(({ key, proc }) => {
      const safeKey = String(key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const vencida = ordem.has(String(key));
      const fundo = vencida ? "#fef2f2" : "";
      const hover = vencida ? "#fee2e2" : "#f0fdf4";
      return `<tr tabindex="0" role="button" onclick="FinanciamentoApp.abrirAberto('${safeKey}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();FinanciamentoApp.abrirAberto('${safeKey}')}" style="cursor:pointer;background:${fundo};${vencida ? "box-shadow:inset 4px 0 0 #b91c1c;" : ""}" onmouseover="this.style.background='${hover}'" onmouseout="this.style.background='${fundo}'">
        <td style="padding:10px;font-weight:700;font-size:0.75rem;color:${vencida ? "#991b1b" : "#0f172a"};">${this.esc(proc.customerName || proc.customerId || "—")}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(proc.contractNumber || proc.contractId || "—")}</td>
        <td style="padding:10px;font-size:0.75rem;font-weight:800;">${this.esc(proc.titulo || "—")}</td>
        <td style="padding:10px;font-size:0.75rem;">${this.esc(this.formatUnidade(proc.unit || "—"))}</td>
        <td style="padding:10px;font-size:0.75rem;color:${vencida ? "#b91c1c" : "#105436"};font-weight:700;">${this.esc(this.etapaLabel(proc))}${vencida ? ' <span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#fee2e2;color:#991b1b;font-size:0.65rem;font-weight:800;letter-spacing:0.02em;">VENCIDA</span>' : ""}</td>
        <td style="padding:10px;font-size:0.75rem;color:#64748b;">${this.esc(this.fmtDate(proc.updatedAt || proc.startedAt))}</td>
      </tr>`;
    }).join("");
  },

  async abrirAberto(key) {
    const all = this.loadAllProcesses();
    const proc = all[String(key)];
    if (!proc) return;
    FinanciamentoState.process = proc;
    let customer = FinanciamentoState.customer;
    if (!customer || String(customer.id) !== String(proc.customerId)) {
      try {
        if (window.SiengeApiService && typeof SiengeApiService.getCustomer === "function") {
          customer = await SiengeApiService.getCustomer(proc.customerId);
        }
      } catch (e) {
        customer = { id: proc.customerId, name: proc.customerName };
      }
    }
    FinanciamentoState.customer = customer || { id: proc.customerId, name: proc.customerName };
    FinanciamentoState.selected = {
      customerId: proc.customerId,
      contractId: proc.contractId,
      titulo: proc.titulo,
      contractNumber: proc.contractNumber,
      contract: { unitName: proc.unit, enterpriseId: proc.empId },
      customer: FinanciamentoState.customer
    };
    FinanciamentoState.view = "fluxo";
    this.render();
  },

  procKey(customerId, contractId) {
    return String(customerId) + ":" + String(contractId);
  },

  getProcess(customerId, contractId) {
    const all = this.loadAllProcesses();
    return all[this.procKey(customerId, contractId)] || null;
  },

  saveProcess(proc) {
    if (!proc || proc.customerId == null || proc.contractId == null) return;
    const key = this.procKey(proc.customerId, proc.contractId);
    window._finProcMem = window._finProcMem || {};
    window._finProcMem[key] = proc;
    const all = this.loadAllProcesses();
    all[key] = proc;
    window._finProcMem = all;
    const raw = JSON.stringify(all);
    try { sessionStorage.setItem(FIN_PROC_KEY, raw); } catch (e) {}
    try { localStorage.setItem(FIN_PROC_KEY, raw); } catch (e) {}
    if (window.forceUploadLocalConfig) window.forceUploadLocalConfig(true).catch(() => {});
    if (FinanciamentoState.view === "busca") this.renderAbertos();
  },

  iniciar(customerId, contractId, titulo, contractNumber) {
    const customer = FinanciamentoState.customer || {};
    const contract = (FinanciamentoState.contracts || []).find((c) => String(c.id || c.contractId) === String(contractId)) || {};
    let proc = this.getProcess(customerId, contractId);
    if (!proc) {
      proc = {
        id: "fin-" + Date.now(),
        customerId: String(customerId),
        contractId: String(contractId),
        titulo: titulo || "",
        contractNumber: contractNumber || "",
        customerName: customer.name || "",
        unit: this.formatUnidade(contract.unitName || contract.unityName || contract.unitId || ""),
        empId: contract.enterpriseId || contract.costCenterId || "",
        costCenterId: String(contract.costCenterId || contract.enterpriseId || ""),
        enterpriseName: String(contract.enterpriseName || ""),
        companyId: contract.companyId || contract.idCompany || "",
        unitName: String(contract.unitName || contract.unityName || contract.unitId || ""),
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentStageId: null,
        done: {}
      };
      const obra = this.obraDoProc(proc);
      if (obra.empreendimento !== "—") proc.enterpriseName = obra.empreendimento;
      if (obra.empresa !== "—") proc.companyName = obra.empresa;
      this.saveProcess(proc);
    }
    FinanciamentoState.selected = { customerId, contractId, titulo, contractNumber, contract, customer };
    FinanciamentoState.process = proc;
    FinanciamentoState.view = "fluxo";
    this.render();
  },

  voltarBusca() {
    const proc = FinanciamentoState.process;
    if (proc && proc.currentStageId) this.persistirRascunho(proc.currentStageId);
    else if (proc) this.saveProcess(proc);
    FinanciamentoState.view = "busca";
    FinanciamentoState.process = null;
    this.render();
  },

  hojeIso() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  },

  somarDias(iso, dias) {
    const base = String(iso || "").slice(0, 10);
    if (!base) return "";
    if (typeof window.addDaysIso === "function") return window.addDaysIso(base, dias);
    const d = new Date(base + "T12:00:00");
    if (isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + (Number(dias) || 0));
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  },

  diasEntre(de, ate) {
    const a = new Date(String(de || "").slice(0, 10) + "T12:00:00");
    const b = new Date(String(ate || "").slice(0, 10) + "T12:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  },

  catalogoEtapas() {
    if (typeof window.buildFinanciamentoStageCatalog === "function") return window.buildFinanciamentoStageCatalog();
    return (window.EtapasFinanciamentoState || []).map((e, i) => ({
      id: e.id, nome: e.nome, label: (i + 1) + ". " + e.nome, dias: parseInt(e.dias, 10) || 0, selectable: true, hasChildren: false
    }));
  },

  /* O prazo corre a partir do dia em que o financiamento entrou na etapa atual. */
  prazoEtapa(proc, etapa) {
    const entrada = String((proc && proc.done && etapa && proc.done[etapa.id]) || (proc && (proc.updatedAt || proc.startedAt)) || "").slice(0, 10);
    const dias = etapa ? (parseInt(etapa.dias, 10) || 0) : 0;
    if (!etapa) return { entrada: entrada, limite: "", dias: 0, status: "sem-etapa", restantes: null };
    if (!dias) return { entrada: entrada, limite: "", dias: 0, status: "sem-prazo", restantes: null };
    if (!entrada) return { entrada: "", limite: "", dias: dias, status: "sem-prazo", restantes: null };
    const limite = this.somarDias(entrada, dias);
    const restantes = this.diasEntre(this.hojeIso(), limite);
    return { entrada: entrada, limite: limite, dias: dias, status: restantes < 0 ? "atrasado" : "no-prazo", restantes: restantes };
  },

  esteiraHtml() {
    const catalogo = this.catalogoEtapas();
    const colunasEtapa = catalogo.filter((s) => s.selectable !== false && !s.hasChildren);
    const abertos = this.listOpenProcesses();
    const porId = {};
    colunasEtapa.forEach((s) => { porId[String(s.id)] = []; });
    const aguardando = [];
    const fora = [];
    abertos.forEach((row) => {
      const id = row.proc && row.proc.currentStageId;
      if (!id) aguardando.push(row);
      else if (porId[String(id)]) porId[String(id)].push(row);
      else fora.push(row);
    });
    const ordenar = (lista, etapa) => lista.slice().sort((a, b) => {
      const pa = this.prazoEtapa(a.proc, etapa);
      const pb = this.prazoEtapa(b.proc, etapa);
      const peso = (p) => p.status === "atrasado" ? -10000 + (p.restantes || 0) : (p.status === "no-prazo" ? (p.restantes || 0) : 10000);
      return peso(pa) - peso(pb);
    });
    const colunas = [{ id: "", nome: "Aguardando", label: "Aguardando", dias: 0, itens: aguardando }]
      .concat(colunasEtapa.map((s) => ({ ...s, itens: ordenar(porId[String(s.id)] || [], s) })));
    if (fora.length) colunas.push({ id: "__fora", nome: "Etapa removida", label: "Etapa removida", dias: 0, itens: fora });
    const atrasados = abertos.filter((row) => {
      const etapa = colunasEtapa.find((s) => String(s.id) === String(row.proc.currentStageId));
      return etapa && this.prazoEtapa(row.proc, etapa).status === "atrasado";
    }).length;
    const noPrazo = abertos.filter((row) => {
      const etapa = colunasEtapa.find((s) => String(s.id) === String(row.proc.currentStageId));
      return etapa && this.prazoEtapa(row.proc, etapa).status === "no-prazo";
    }).length;
    const resumo = abertos.length
      ? `<p class="fin-esteira-resumo">${abertos.length} em andamento · ${noPrazo} no prazo · ${atrasados} atrasado${atrasados === 1 ? "" : "s"} · ${aguardando.length} aguardando a primeira etapa.</p>`
      : `<p class="fin-esteira-resumo">Nenhum financiamento em aberto. Pesquise um cliente e clique em Iniciar financiamento.</p>`;
    const vazioEtapas = colunasEtapa.length ? "" : `<p class="fin-esteira-resumo">Nenhuma etapa cadastrada. Cadastre em Financiamento → Configurações.</p>`;
    return `<style>
      #financiamento-root .fin-abas { margin: 0 0 14px; }
      #financiamento-root .fin-esteira-resumo { margin: 0 0 12px; color: #64748b; font-size: 0.84rem; }
      #financiamento-root .fin-esteira { display: flex; gap: 12px; overflow-x: auto; align-items: flex-start; padding-bottom: 8px; }
      #financiamento-root .fin-col { flex: 0 0 300px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; min-height: 180px; display: flex; flex-direction: column; max-height: calc(100vh - 220px); }
      #financiamento-root .fin-col-h { padding: 12px 12px 8px; border-bottom: 1px solid #e2e8f0; }
      #financiamento-root .fin-col-h strong { display: block; color: #0f172a; font-size: 0.84rem; line-height: 1.3; }
      #financiamento-root .fin-col-h span { color: #64748b; font-size: 0.75rem; }
      #financiamento-root .fin-col-lista { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
      #financiamento-root .fin-card { text-align: left; width: 100%; min-width: 0; border: 1px solid #e2e8f0; border-left: 4px solid #105436; background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
      #financiamento-root .fin-card.is-atrasado { background: #fef2f2; border-color: #fecaca; border-left-color: #b91c1c; }
      #financiamento-root .fin-card.is-vence { border-left-color: #f37021; }
      #financiamento-root .fin-card.is-sem { border-left-color: #94a3b8; }
      #financiamento-root .fin-card-nome { font-weight: 800; color: #0f172a; font-size: 0.84rem; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      #financiamento-root .fin-card-linha { display: flex; flex-direction: column; min-width: 0; margin-top: 6px; }
      #financiamento-root .fin-card-linha span { font-size: 0.68rem; font-weight: 700; color: #64748b; }
      #financiamento-root .fin-card-linha b { font-size: 0.78rem; font-weight: 700; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #financiamento-root .fin-card-meta { color: #64748b; font-size: 0.75rem; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #financiamento-root .fin-pill { display: inline-block; margin-top: 8px; font-size: 0.72rem; font-weight: 800; border-radius: 999px; padding: 2px 8px; }
      #financiamento-root .fin-pill.is-ok { background: #dcfce7; color: #166534; }
      #financiamento-root .fin-pill.is-atrasado { background: #fee2e2; color: #991b1b; }
      #financiamento-root .fin-pill.is-vence { background: #ffedd5; color: #9a3412; }
      #financiamento-root .fin-pill.is-sem { background: #f1f5f9; color: #475569; }
      #financiamento-root .fin-col-vazia { color: #94a3b8; font-size: 0.78rem; padding: 8px 2px; }
      #financiamento-root .fin-card-nota { color: #334155; font-size: 0.75rem; margin-top: 6px; line-height: 1.35; }
    </style>
    ${resumo}${vazioEtapas}
    <div class="fin-esteira">${colunas.map((col) => this.colunaHtml(col)).join("")}</div>`;
  },

  colunaHtml(col) {
    const etapa = col.id && col.id !== "__fora" ? col : null;
    const prazoTxt = !col.id ? "Entrada na esteira" : (col.id === "__fora" ? "Etapa que saiu do cadastro" : (etapa && etapa.dias ? (etapa.dias + (etapa.dias === 1 ? " dia" : " dias")) : "Sem prazo definido"));
    const cards = (col.itens || []).map((row) => this.cardEsteiraHtml(row, etapa)).join("");
    return `<section class="fin-col">
      <header class="fin-col-h">
        <strong>${this.esc(col.label || col.nome)}</strong>
        <span>${(col.itens || []).length} · ${this.esc(prazoTxt)}</span>
      </header>
      <div class="fin-col-lista">${cards || '<div class="fin-col-vazia">Nenhum financiamento</div>'}</div>
    </section>`;
  },

  obraDoProc(proc) {
    const ccs = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const id = String((proc && (proc.costCenterId || proc.empId)) || "");
    const cc = id ? ccs.find((c) => String(c.id) === id) : null;
    const empreendimento = String((cc && cc.name) || (proc && proc.enterpriseName) || "").trim();
    const companyId = (cc && (cc.idCompany != null ? cc.idCompany : cc.companyId)) || (proc && proc.companyId) || "";
    let empresa = String((proc && proc.companyName) || "").trim();
    if (!empresa && companyId && typeof window.getCompanyName === "function") empresa = String(window.getCompanyName(companyId, true) || "").trim();
    return { empresa: empresa || "—", empreendimento: empreendimento || "—" };
  },

  cardEsteiraHtml(row, etapa) {
    const proc = row.proc || {};
    const obra = this.obraDoProc(proc);
    const prazo = this.prazoEtapa(proc, etapa);
    let cls = "is-sem";
    let pill = "Sem prazo";
    if (prazo.status === "atrasado") {
      cls = "is-atrasado";
      const n = Math.abs(prazo.restantes || 0);
      pill = "Atrasado " + n + (n === 1 ? " dia" : " dias");
    } else if (prazo.status === "no-prazo") {
      const n = prazo.restantes || 0;
      if (n <= 2) {
        cls = "is-vence";
        pill = n === 0 ? "Vence hoje" : ("Vence em " + n + (n === 1 ? " dia" : " dias"));
      } else {
        cls = "is-ok";
        pill = "No prazo · " + n + " dias";
      }
    }
    const quando = prazo.entrada ? ("Entrou em " + this.fmtDate(prazo.entrada)) : "Sem data de entrada";
    const limite = prazo.limite ? (" · prazo " + this.fmtDate(prazo.limite)) : "";
    const safeKey = String(row.key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `<button type="button" class="fin-card ${cls}" onclick="FinanciamentoApp.abrirAberto('${safeKey}')">
      <div class="fin-card-nome" title="${this.esc(proc.customerName || "")}">${this.esc(proc.customerName || proc.customerId || "—")}</div>
      <div class="fin-card-linha" title="${this.esc(obra.empresa)}"><span>Empresa</span><b>${this.esc(obra.empresa)}</b></div>
      <div class="fin-card-linha" title="${this.esc(obra.empreendimento)}"><span>Empreendimento</span><b>${this.esc(obra.empreendimento)}</b></div>
      <div class="fin-card-meta" title="${this.esc("Contrato " + (proc.contractNumber || proc.contractId || "—") + " · Título " + (proc.titulo || "—"))}">Contrato ${this.esc(proc.contractNumber || proc.contractId || "—")} · Título ${this.esc(proc.titulo || "—")}</div>
      <div class="fin-card-meta">${this.esc(this.formatUnidade(proc.unit || "—"))}</div>
      <div class="fin-card-meta" title="${this.esc(quando + limite)}">${this.esc(quando + limite)}</div>
      ${this.notaCardHtml(proc, etapa)}
      <span class="fin-pill ${cls}">${this.esc(pill)}</span>
    </button>`;
  },

  ehFeriado(iso) {
    if (window.EscalaHomeOffice && typeof window.EscalaHomeOffice.ehFeriado === "function") {
      return window.EscalaHomeOffice.ehFeriado(iso);
    }
    const ano = Number(String(iso).slice(0, 4));
    const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
    if (fixos.some((md) => iso === ano + "-" + md)) return true;
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    const pascoa = ano + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
    return [this.somarDias(pascoa, -48), this.somarDias(pascoa, -47), this.somarDias(pascoa, -2), this.somarDias(pascoa, 60)].indexOf(iso) >= 0;
  },

  ehDiaUtil(iso) {
    const dia = new Date(String(iso).slice(0, 10) + "T12:00:00").getDay();
    if (dia === 0 || dia === 6) return false;
    return !this.ehFeriado(iso);
  },

  segundaDaSemana(iso) {
    const dia = new Date(String(iso).slice(0, 10) + "T12:00:00").getDay();
    const volta = dia === 0 ? 6 : dia - 1;
    return this.somarDias(iso, -volta);
  },

  /* Segunda, ou o próximo dia útil se a segunda não for dia útil. */
  diaAlertaEsteira(hoje) {
    let d = this.segundaDaSemana(hoje);
    let guarda = 0;
    while (!this.ehDiaUtil(d) && guarda < 12) {
      d = this.somarDias(d, 1);
      guarda += 1;
    }
    return d;
  },

  usuarioVeAlertaEsteira() {
    let u = window.AppState && window.AppState.currentUser;
    if (!u) {
      try { u = JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { u = null; }
    }
    if (!u) return false;
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    const efetivo = imp || u;
    if (!imp && typeof window.isCrmAdministrator === "function" && window.isCrmAdministrator(u)) return true;
    if (typeof window.isCrmAdminProfileName === "function" && window.isCrmAdminProfileName(efetivo.profile_name || efetivo.profile || efetivo.role || "")) return true;
    return typeof window.isCobrancaBackOfficeUser === "function" && window.isCobrancaBackOfficeUser(efetivo);
  },

  chaveAlertaEsteira(dia) {
    let u = window.AppState && window.AppState.currentUser;
    if (!u || !(u.email || u.name)) {
      try { u = JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { u = null; }
    }
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    const quem = imp || u || {};
    return "crm_fin_esteira_" + String(quem.email || quem.name || "op").toLowerCase() + "_" + dia;
  },

  atrasadosEsteira() {
    const etapas = this.catalogoEtapas().filter((s) => s && s.selectable !== false && !s.hasChildren);
    return this.listOpenProcesses().map((row) => {
      const etapa = etapas.find((s) => String(s.id) === String(row.proc && row.proc.currentStageId));
      if (!etapa) return null;
      const prazo = this.prazoEtapa(row.proc, etapa);
      if (prazo.status !== "atrasado") return null;
      return { row, etapa, prazo };
    }).filter(Boolean).sort((a, b) => (a.prazo.restantes || 0) - (b.prazo.restantes || 0));
  },

  agendarAlertaEsteira() {
    if (this._finAlertaTimer) {
      clearTimeout(this._finAlertaTimer);
      this._finAlertaTimer = null;
    }
    if (!this.usuarioVeAlertaEsteira()) return;
    const hoje = this.hojeIso();
    const oito = new Date(hoje + "T08:00:00");
    if (Date.now() < oito.getTime()) {
      this._finAlertaTimer = setTimeout(() => this.agendarAlertaEsteira(), Math.max(1000, oito.getTime() - Date.now()));
      return;
    }
    this.abrirAlertaEsteira();
    const amanha = new Date(this.somarDias(hoje, 1) + "T08:00:00");
    this._finAlertaTimer = setTimeout(() => this.agendarAlertaEsteira(), Math.max(1000, amanha.getTime() - Date.now()));
  },

  abrirAlertaEsteira() {
    if (!this.usuarioVeAlertaEsteira()) return;
    const hoje = this.hojeIso();
    if (Date.now() < new Date(hoje + "T08:00:00").getTime()) return;
    const chave = this.chaveAlertaEsteira(hoje);
    try { if (localStorage.getItem(chave) === "ciente") return; } catch (e) {}
    const lista = this.atrasadosEsteira();
    if (!lista.length || document.getElementById("fin-alerta")) return;
    const linhas = lista.map((item) => {
      const proc = item.row.proc || {};
      const n = Math.abs(item.prazo.restantes || 0);
      const safe = String(item.row.key).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `<button type="button" class="fin-alerta-item" onclick="FinanciamentoApp.abrirDoAlerta('${safe}')">
        <strong>${this.esc(proc.customerName || "—")}</strong>
        <span>Contrato ${this.esc(proc.contractNumber || proc.contractId || "—")} · ${this.esc(this.formatUnidade(proc.unit || "—"))}</span>
        <span>${this.esc(item.etapa.label || item.etapa.nome)} · venceu em ${this.esc(this.fmtDate(item.prazo.limite))} · ${n} dia${n === 1 ? "" : "s"}</span>
      </button>`;
    }).join("");
    const overlay = document.createElement("div");
    overlay.id = "fin-alerta";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-labelledby", "fin-alerta-titulo");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483004;display:flex;align-items:center;justify-content:center;background:rgba(12,41,29,0.55);padding:16px;";
    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 40px rgba(0,0,0,0.22);border:1px solid rgba(16,84,54,0.12);font-family:inherit;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 0;">
        <h2 id="fin-alerta-titulo" style="margin:0;font-size:1.05rem;color:#105436;">Etapas vencidas na esteira</h2>
        <button type="button" class="btn btn-fechar" id="fin-alerta-fechar">Fechar</button>
      </div>
      <div style="padding:12px 18px 18px;overflow:auto;">
        <p style="margin:0 0 12px;color:#1e293b;font-size:0.92rem;line-height:1.45;">${lista.length} financiamento${lista.length === 1 ? "" : "s"} na esteira com a etapa atual fora do prazo.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">${linhas}</div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const estilo = document.createElement("style");
    estilo.textContent = "#fin-alerta .fin-alerta-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;width:100%;border:1px solid #fecaca;border-left:4px solid #b91c1c;background:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;}#fin-alerta .fin-alerta-item strong{color:#0f172a;font-size:0.9rem;}#fin-alerta .fin-alerta-item span{color:#64748b;font-size:0.78rem;}";
    overlay.appendChild(estilo);
    overlay.querySelector("#fin-alerta-fechar").addEventListener("click", () => this.fecharAlertaEsteira(chave));
  },

  fecharAlertaEsteira(chave) {
    try { localStorage.setItem(chave, "ciente"); } catch (e) {}
    const pop = document.getElementById("fin-alerta");
    if (pop) pop.remove();
  },

  async abrirDoAlerta(key) {
    const hoje = this.hojeIso();
    this.fecharAlertaEsteira(this.chaveAlertaEsteira(hoje));
    if (typeof window.switchTab === "function") window.switchTab("financiamento", "Financiamento");
    await this.abrirAberto(key);
  },

  async prepararTagsUnidade() {
    const atual = FinanciamentoState.process && FinanciamentoState.process.currentStageId;
    if (atual) this.pintarTag(atual);
    if (window.AnexosApp && typeof window.AnexosApp.loadTagsAtivas === "function") {
      try { await window.AnexosApp.loadTagsAtivas(); } catch (e) {}
    }
    const todas = (window.AnexosState && window.AnexosState.tagsAtivas) || [];
    this._tagsUnidade = todas.filter((t) => {
      if (window.AnexosApp && typeof window.AnexosApp.tagDestino === "function") return window.AnexosApp.tagDestino(t) === "Unidade";
      return true;
    });
    this._tagsProntas = true;
    const proc = FinanciamentoState.process;
    if (proc && proc.currentStageId) this.pintarTag(proc.currentStageId);
  },

  tagUi(stageId) {
    this._tagUi = this._tagUi || {};
    if (!this._tagUi[stageId]) this._tagUi[stageId] = { open: false, query: "", value: "" };
    return this._tagUi[stageId];
  },

  tagEscolhida(stageId) {
    return String((this.tagUi(stageId).value) || "");
  },

  itensTag() {
    return (this._tagsUnidade || []).map((t) => ({ id: t.name, label: t.name }));
  },

  opcoesTag(stageId) {
    const ui = this.tagUi(stageId);
    const items = this.itensTag();
    return {
      id: "fin-tag-" + stageId,
      label: "Tag",
      items: items,
      selectedIds: ui.value ? [ui.value] : [],
      open: !!ui.open,
      query: ui.query || "",
      single: true,
      emptyMeansAll: false,
      emptyLabel: "Escolha a tag",
      keepOrder: true,
      extraClass: "ml-emp-filter--corte",
      nouns: {
        singular: "tag",
        plural: "tags",
        none: this._tagsProntas ? "Nenhuma tag de unidade" : "Carregando tags…",
        noMatch: "Nenhuma tag com esse nome."
      }
    };
  },

  ligarTag(stageId) {
    if (!window.MlEmpresaFilter) return;
    const ui = this.tagUi(stageId);
    window.MlEmpresaFilter.bind("fin-tag-" + stageId, {
      toggleOpen: () => { ui.open = !ui.open; this.pintarTag(stageId); },
      close: () => { ui.open = false; this.pintarTag(stageId); },
      setQuery: (q) => { ui.query = q; this.pintarTagLista(stageId); },
      toggleId: (itemId, on) => {
        ui.value = on ? String(itemId) : "";
        ui.open = true;
        this.pintarTag(stageId);
      }
    });
  },

  pintarTag(stageId) {
    const box = document.getElementById("fin-tag-box-" + stageId);
    if (!box || !window.MlEmpresaFilter) return;
    this.ligarTag(stageId);
    box.innerHTML = window.MlEmpresaFilter.html(this.opcoesTag(stageId));
    if (window.lucide) {
      const root = box.querySelector(".ml-emp-filter") || box;
      lucide.createIcons({ root: root });
    }
  },

  pintarTagLista(stageId) {
    const list = document.getElementById("fin-tag-" + stageId + "-list");
    if (!list || !window.MlEmpresaFilter) {
      this.pintarTag(stageId);
      return;
    }
    list.innerHTML = window.MlEmpresaFilter.listHtml(this.opcoesTag(stageId));
  },

  arquivosDaArea(data) {
    if (!data) return [];
    const vistos = [];
    const por = (f) => {
      if (!f) return;
      if (vistos.some((x) => x === f || (x.name === f.name && x.size === f.size && x.lastModified === f.lastModified))) return;
      vistos.push(f);
    };
    if (data.files) Array.from(data.files).forEach(por);
    if (data.items) {
      Array.from(data.items).forEach((item) => {
        if (item.kind === "file" && typeof item.getAsFile === "function") por(item.getAsFile());
      });
    }
    return vistos.map((f, i) => {
      if (f.name) return f;
      const ext = (f.type && f.type.split("/")[1]) || "png";
      return new File([f], "colado-" + Date.now() + "-" + i + "." + ext, { type: f.type || "image/png" });
    });
  },

  pendentesDe(stageId) {
    this._pendentes = this._pendentes || {};
    return this._pendentes[stageId] || [];
  },

  guardarPendentes(stageId, files) {
    this._pendentes = this._pendentes || {};
    const atual = this._pendentes[stageId] || [];
    this._pendentes[stageId] = atual.concat(files || []);
    this.pintarPendentes(stageId);
  },

  pintarPendentes(stageId) {
    const st = document.getElementById("fin-st-" + stageId);
    const nomes = this.pendentesDe(stageId).map((f) => f.name).filter(Boolean);
    if (!st || !nomes.length) return;
    st.textContent = nomes.join(", ") + " — clique em Enviar para a unidade.";
  },

  ligarEtapa() {
    const root = document.getElementById("financiamento-root");
    if (!root || root.dataset.finLigado === "1") return;
    root.dataset.finLigado = "1";
    root.addEventListener("input", (e) => {
      const id = (e.target && e.target.id) || "";
      if (id.indexOf("fin-nota-data-") === 0 || id.indexOf("fin-nota-st-") === 0) return;
      if (id.indexOf("fin-nota-") === 0) this.agendarNota(id.slice("fin-nota-".length));
    });
    root.addEventListener("change", (e) => {
      const id = (e.target && e.target.id) || "";
      if (id.indexOf("fin-nota-data-") === 0) this.persistirRascunho(id.slice("fin-nota-data-".length));
      if (id.indexOf("fin-arq-") === 0) this.aoEscolherArquivo(id.slice("fin-arq-".length));
    });
    root.addEventListener("focusout", (e) => {
      const id = (e.target && e.target.id) || "";
      if (id.indexOf("fin-nota-data-") === 0) this.persistirRascunho(id.slice("fin-nota-data-".length));
      else if (id.indexOf("fin-nota-") === 0 && id.indexOf("fin-nota-st-") !== 0) this.persistirRascunho(id.slice("fin-nota-".length));
    });
    root.addEventListener("paste", (e) => this.aoColar(e));
  },

  agendarNota(stageId) {
    if (this._notaTimer) clearTimeout(this._notaTimer);
    this._notaTimer = setTimeout(() => this.persistirRascunho(stageId), 700);
  },

  aoEscolherArquivo(stageId) {
    const arq = document.getElementById("fin-arq-" + stageId);
    const files = arq && arq.files ? Array.from(arq.files) : [];
    if (!files.length) return;
    this.guardarPendentes(stageId, files);
    if (arq) arq.value = "";
  },

  aoColar(e) {
    const files = this.arquivosDaArea(e.clipboardData);
    if (!files.length) return;
    const proc = FinanciamentoState.process;
    const stageId = proc && proc.currentStageId;
    if (!stageId) return;
    e.preventDefault();
    this.guardarPendentes(stageId, files);
  },

  async enviarAnexo(stageId, listaForcada) {
    const proc = FinanciamentoState.process;
    const btn = document.getElementById("fin-env-" + stageId);
    const st = document.getElementById("fin-st-" + stageId);
    const tag = this.tagEscolhida(stageId);
    const files = listaForcada && listaForcada.length ? listaForcada : this.pendentesDe(stageId).slice();
    if (!proc) return false;
    if (String(proc.currentStageId || "") !== String(stageId)) return false;
    if (!files.length || !tag) {
      if (st) st.textContent = files.length ? "Escolha a tag da unidade para gravar o anexo." : "Escolha o arquivo, ou cole com Ctrl+V, e a tag da unidade.";
      return false;
    }
    if (typeof window.anexosUploadUnitAttachment !== "function") {
      if (st) st.textContent = "O envio de anexos da unidade não está disponível.";
      return false;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
    if (st) st.textContent = "";
    const restam = [];
    let falha = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const resp = await window.anexosUploadUnitAttachment({
          file: file,
          tagLabel: tag,
          costCenterId: proc.costCenterId || proc.empId,
          unitName: proc.unitName || proc.unit,
          sale: {
            customerId: proc.customerId,
            id: proc.contractId,
            contractId: proc.contractId,
            contractNumber: proc.contractNumber,
            receivableBillId: proc.titulo,
            costCenterId: proc.costCenterId || proc.empId,
            unitName: proc.unitName || proc.unit
          },
          context: "financiamento"
        });
        proc.anexos = proc.anexos || {};
        const lista = Array.isArray(proc.anexos[stageId]) ? proc.anexos[stageId] : [];
        lista.push({
          id: "a-" + Date.now() + "-" + i,
          tag: tag,
          fileName: resp.fileName || file.name,
          em: new Date().toISOString(),
          unitId: resp.unitId || ""
        });
        proc.anexos[stageId] = lista;
      } catch (e) {
        restam.push(file);
        falha = (e && e.message) ? e.message : "Não consegui enviar o anexo para a unidade.";
      }
    }
    this._pendentes = this._pendentes || {};
    this._pendentes[stageId] = restam;
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    this.render();
    const st2 = document.getElementById("fin-st-" + stageId);
    const btn2 = document.getElementById("fin-env-" + stageId);
    if (falha && st2) st2.textContent = falha;
    if (btn2 && restam.length) { btn2.disabled = false; btn2.textContent = "Enviar para a unidade"; }
    return !restam.length;
  },

  folhasEtapa(etapas) {
    return (etapas || []).filter((s) => s && s.hasChildren !== true && s.selectable !== false);
  },

  JANELA_DESFAZER_MS: 24 * 60 * 60 * 1000,

  concluidaEm(proc, stageId) {
    if (!proc || stageId == null) return "";
    const mapa = proc.concluidas || {};
    const marca = mapa[stageId] || mapa[String(stageId)] || "";
    if (!marca) return "";
    const desfeitos = proc.desfeitos || {};
    const desfeito = desfeitos[stageId] || desfeitos[String(stageId)];
    if (desfeito && (Date.parse(desfeito.em || 0) || 0) >= (Date.parse(marca) || 0)) return "";
    return marca;
  },

  indiceAtivo(proc, folhas) {
    if (!folhas.length) return -1;
    if (proc && proc.currentStageId) {
      const i = folhas.findIndex((s) => String(s.id) === String(proc.currentStageId));
      if (i >= 0 && !this.concluidaEm(proc, folhas[i].id)) return i;
    }
    return folhas.findIndex((s) => !this.concluidaEm(proc, s.id));
  },

  operadorAtual() {
    let u = window.AppState && window.AppState.currentUser;
    if (!u) {
      try { u = JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { u = null; }
    }
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    const efetivo = imp || u || {};
    const id = String(efetivo.email || efetivo.id || efetivo.username || efetivo.name || "").trim().toLowerCase();
    const nome = String(efetivo.name || efetivo.email || "").trim();
    return { id: id, nome: nome };
  },

  ultimoAvanco(proc) {
    const lista = proc && Array.isArray(proc.avancos) ? proc.avancos : [];
    return lista.length ? lista[lista.length - 1] : null;
  },

  avancoDentroDoPrazo(av) {
    const em = Date.parse(av && av.em || 0) || 0;
    return !!em && (Date.now() - em) <= this.JANELA_DESFAZER_MS;
  },

  avancoEhMeu(av) {
    const eu = this.operadorAtual();
    return !!(eu.id && av && String(av.por || "") === eu.id);
  },

  alvoDesfazer(proc) {
    if (!proc) return null;
    const av = this.ultimoAvanco(proc);
    if (av) {
      if (!this.avancoDentroDoPrazo(av) || !this.avancoEhMeu(av)) return null;
      return { stageId: String(av.stageId), nome: av.nome || "etapa anterior", legado: false, av: av, em: av.em };
    }
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    const idx = this.indiceAtivo(proc, folhas);
    const anterior = idx > 0 ? folhas[idx - 1] : (idx < 0 && folhas.length ? folhas[folhas.length - 1] : null);
    if (!anterior) return null;
    const em = this.concluidaEm(proc, anterior.id);
    if (!em || (Date.now() - (Date.parse(em) || 0)) > this.JANELA_DESFAZER_MS) return null;
    if (!this.operadorAtual().id) return null;
    return { stageId: String(anterior.id), nome: anterior.nome || anterior.label || "etapa anterior", legado: true, em: em };
  },

  podeDesfazer(proc) {
    return !!this.alvoDesfazer(proc);
  },

  iniciarEtapa(stageId) {
    const proc = FinanciamentoState.process;
    if (!proc) return;
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    const idx = folhas.findIndex((s) => String(s.id) === String(stageId));
    if (idx < 0 || this.indiceAtivo(proc, folhas) !== idx) return;
    if (String(proc.currentStageId || "") === String(stageId)) return;
    proc.currentStageId = stageId;
    proc.done = proc.done || {};
    if (!proc.done[stageId]) proc.done[stageId] = new Date().toISOString();
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    this.render();
  },

  listaNotas(proc, stageId) {
    const bruto = this.notaDe(proc, stageId);
    if (!bruto) return [];
    const lista = Array.isArray(bruto) ? bruto : [bruto];
    const fechadas = proc && proc.notasFechadas;
    const corte = Date.parse((fechadas && (fechadas[stageId] || fechadas[String(stageId)])) || 0) || 0;
    return lista.filter((n) => {
      if (!n || (!n.texto && !n.data)) return false;
      if (n.rascunho && corte && (Date.parse(n.em || 0) || 0) <= corte) return false;
      return true;
    }).map((n) => Object.assign({}, n));
  },

  garantirNotas(proc, stageId) {
    proc.notas = proc.notas || {};
    const bruto = proc.notas[stageId] || proc.notas[String(stageId)] || [];
    const lista = (Array.isArray(bruto) ? bruto : [bruto]).filter((n) => n && typeof n === "object").map((n) => Object.assign({}, n));
    lista.forEach((n, i) => {
      if (!n.id) n.id = n.rascunho ? ("n-rascunho-" + stageId) : ("n-legado-" + stageId + (i ? "-" + i : ""));
    });
    proc.notas[stageId] = lista;
    const chaveStr = String(stageId);
    if (chaveStr !== stageId) delete proc.notas[chaveStr];
    return lista;
  },

  lerNotaDaTela(stageId) {
    const textoEl = document.getElementById("fin-nota-" + stageId);
    const dataEl = document.getElementById("fin-nota-data-" + stageId);
    if (!textoEl && !dataEl) return null;
    return {
      texto: textoEl ? String(textoEl.value || "").trim() : "",
      data: dataEl ? String(dataEl.value || "").slice(0, 10) : ""
    };
  },

  persistirRascunho(stageId) {
    const proc = FinanciamentoState.process;
    const lido = this.lerNotaDaTela(stageId);
    if (!proc || !lido || String(proc.currentStageId || "") !== String(stageId)) return;
    const assinatura = (bruto) => {
      const base = !bruto ? [] : (Array.isArray(bruto) ? bruto : [bruto]);
      return JSON.stringify(base.filter((n) => n && (n.texto || n.data)).map((n) => ({
        rascunho: !!n.rascunho,
        texto: String(n.texto || ""),
        data: String(n.data || "")
      })));
    };
    const antes = assinatura(proc.notas && (proc.notas[stageId] || proc.notas[String(stageId)]));
    const lista = this.garantirNotas(proc, stageId).filter((n) => !n.rascunho);
    if (!lido.texto && !lido.data) {
      proc.notas[stageId] = lista;
    } else {
      lista.push({
        id: "n-rascunho-" + stageId,
        rascunho: true,
        texto: lido.texto,
        data: lido.data,
        em: new Date().toISOString()
      });
      proc.notas[stageId] = lista;
    }
    if (assinatura(proc.notas[stageId]) === antes) return;
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    const st = document.getElementById("fin-nota-st-" + stageId);
    if (st && (lido.texto || lido.data)) st.textContent = "Salvo nesta etapa.";
    else if (st && st.textContent === "Salvo nesta etapa.") st.textContent = "";
  },

  fixarNota(stageId) {
    const proc = FinanciamentoState.process;
    const lido = this.lerNotaDaTela(stageId);
    if (!proc || String(proc.currentStageId || "") !== String(stageId)) return false;
    const texto = lido ? lido.texto : "";
    const data = lido && lido.data ? lido.data : (texto ? this.hojeIso() : "");
    const lista = this.garantirNotas(proc, stageId).filter((n) => !n.rascunho);
    if (!texto && !data) {
      proc.notas[stageId] = lista;
      return false;
    }
    const agora = new Date().toISOString();
    lista.push({
      id: "n-" + Date.now(),
      texto: texto,
      data: data,
      em: agora
    });
    proc.notas[stageId] = lista;
    proc.notasFechadas = proc.notasFechadas || {};
    proc.notasFechadas[stageId] = agora;
    proc.updatedAt = new Date().toISOString();
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    return true;
  },

  async concluirEtapa(stageId) {
    let proc = FinanciamentoState.process;
    if (!proc || String(proc.currentStageId || "") !== String(stageId)) return;
    const folhas = this.folhasEtapa(this.catalogoEtapas());
    const idx = folhas.findIndex((s) => String(s.id) === String(stageId));
    if (idx < 0 || this.indiceAtivo(proc, folhas) !== idx) return;
    const btn = document.getElementById("fin-concluir-" + stageId);
    if (btn) btn.disabled = true;
    if (this._notaTimer) clearTimeout(this._notaTimer);
    this.fixarNota(stageId);
    proc = FinanciamentoState.process;
    if (this.pendentesDe(stageId).length) {
      const st = document.getElementById("fin-st-" + stageId);
      if (st) st.textContent = "Clique em Enviar para a unidade antes de concluir a etapa.";
      if (btn) btn.disabled = false;
      return;
    }
    const proxima = folhas[idx + 1];
    const tinhaDone = !!(proxima && proc.done && (proc.done[proxima.id] || proc.done[String(proxima.id)]));
    const eu = this.operadorAtual();
    const quando = new Date().toISOString();
    proc.concluidas = proc.concluidas || {};
    proc.concluidas[stageId] = quando;
    if (proc.desfeitos) {
      delete proc.desfeitos[stageId];
      delete proc.desfeitos[String(stageId)];
    }
    proc.avancos = Array.isArray(proc.avancos) ? proc.avancos : [];
    proc.avancos.push({
      stageId: String(stageId),
      nome: (folhas[idx] && (folhas[idx].nome || folhas[idx].label)) || "etapa",
      em: quando,
      por: eu.id,
      nomeOperador: eu.nome,
      proximaId: proxima ? String(proxima.id) : "",
      criouDoneProxima: !!(proxima && !tinhaDone),
      statusAntes: proc.status || "",
      finishedAtAntes: proc.finishedAt || ""
    });
    if (proxima) {
      proc.currentStageId = proxima.id;
      proc.done = proc.done || {};
      if (!proc.done[proxima.id]) proc.done[proxima.id] = quando;
      if (String(proc.status || "") === "concluido") proc.status = "";
      proc.finishedAt = "";
    } else {
      proc.status = "concluido";
      proc.finishedAt = quando;
    }
    proc.updatedAt = quando;
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    this.render();
  },

  async desfazerAvanco() {
    const proc = FinanciamentoState.process;
    const alvo = proc && this.alvoDesfazer(proc);
    if (!alvo) return;
    const msg = `Desfazer a conclusão de "${alvo.nome}"? O financiamento volta para essa etapa. A nota e o anexo gravados permanecem.`;
    const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(msg) : confirm(msg);
    if (!ok) return;
    const agora = new Date().toISOString();
    const eu = this.operadorAtual();
    proc.desfeitos = proc.desfeitos || {};
    proc.desfeitos[alvo.stageId] = { em: agora, por: eu.id, nome: eu.nome };
    proc.concluidas = proc.concluidas || {};
    delete proc.concluidas[alvo.stageId];
    delete proc.concluidas[String(alvo.stageId)];
    if (alvo.legado) {
      const deixando = proc.currentStageId;
      if (deixando && proc.done && proc.done[deixando]) {
        const td = Date.parse(proc.done[deixando]) || 0;
        const tc = Date.parse(alvo.em) || 0;
        if (td && tc && Math.abs(td - tc) < 15000) {
          proc.doneRevogados = proc.doneRevogados || {};
          proc.doneRevogados[deixando] = agora;
          delete proc.done[deixando];
        }
      }
      if (String(proc.status || "") === "concluido") {
        proc.status = "";
        proc.finishedAt = "";
      }
    } else {
      const av = alvo.av || {};
      if (av.criouDoneProxima && av.proximaId && proc.done) {
        proc.doneRevogados = proc.doneRevogados || {};
        proc.doneRevogados[av.proximaId] = agora;
        delete proc.done[av.proximaId];
      }
      proc.status = av.statusAntes || "";
      proc.finishedAt = av.finishedAtAntes || "";
      if (Array.isArray(proc.avancos) && proc.avancos.length) proc.avancos.pop();
    }
    proc.currentStageId = alvo.stageId;
    if (!proc.done) proc.done = {};
    if (!proc.done[alvo.stageId]) proc.done[alvo.stageId] = alvo.em || agora;
    proc.updatedAt = agora;
    this.saveProcess(proc);
    FinanciamentoState.process = proc;
    this.render();
  },

  notaDe(proc, stageId) {
    const notas = proc && proc.notas;
    if (!notas || !stageId) return null;
    return notas[stageId] || notas[String(stageId)] || null;
  },

  notaCardHtml(proc, etapa) {
    const lista = this.listaNotas(proc, etapa && etapa.id);
    const nota = lista[lista.length - 1];
    if (!nota || (!nota.texto && !nota.data)) return "";
    const quando = nota.data ? this.fmtDate(nota.data) : "";
    const texto = String(nota.texto || "").replace(/\s+/g, " ").trim();
    const linha = quando && texto ? (quando + " · " + texto) : (quando || texto);
    return `<div class="fin-card-nota">${this.esc(linha)}</div>`;
  },

  linhaHistorico(data, texto) {
    const quando = data ? this.fmtDate(String(data).slice(0, 10)) : "";
    const corpo = String(texto || "").trim();
    const linha = quando && corpo ? (quando + " · " + corpo) : (quando || corpo);
    if (!linha) return "";
    return `<p class="fin-etapa-nota">${this.esc(linha)}</p>`;
  },

  historicoHtml(proc, stageId) {
    const notas = this.listaNotas(proc, stageId).filter((n) => !n.rascunho);
    const anexos = (proc && proc.anexos && (proc.anexos[stageId] || proc.anexos[String(stageId)])) || [];
    const linhas = notas.map((n) => this.linhaHistorico(n.data || n.em, n.texto)).join("");
    const arquivos = (Array.isArray(anexos) ? anexos : []).map((a) => this.linhaHistorico(a.em, a.fileName)).join("");
    return linhas + arquivos;
  },

  salvarNota(stageId) {
    if (this._notaTimer) clearTimeout(this._notaTimer);
    this.persistirRascunho(stageId);
    const st = document.getElementById("fin-nota-st-" + stageId);
    if (st && !st.textContent) st.textContent = "Salvo nesta etapa.";
  },

  novaNota(stageId) {
    if (this._notaTimer) clearTimeout(this._notaTimer);
    const gravou = this.fixarNota(stageId);
    if (!gravou) {
      const st = document.getElementById("fin-nota-st-" + stageId);
      if (st) st.textContent = "Escreva a nota para incluir outra.";
      return;
    }
    this.render();
    const st = document.getElementById("fin-nota-st-" + stageId);
    if (st) st.textContent = "Nota gravada no histórico. O campo está livre para outra.";
    const campo = document.getElementById("fin-nota-" + stageId);
    if (campo) campo.focus();
  },

  fluxoHtml() {
    const proc = FinanciamentoState.process || {};
    const customer = (FinanciamentoState.selected && FinanciamentoState.selected.customer) || FinanciamentoState.customer || {};
    const obra = this.obraDoProc(proc);
    const catalog = typeof window.buildFinanciamentoStageCatalog === "function"
      ? window.buildFinanciamentoStageCatalog()
      : [];
    const etapas = catalog.length ? catalog : (window.EtapasFinanciamentoState || []).map((e, i) => ({
      id: e.id, label: (i + 1) + ". " + e.nome, nome: e.nome, dias: e.dias, hasChildren: false
    }));
    const folhas = this.folhasEtapa(etapas);
    const ativoIdx = this.indiceAtivo(proc, folhas);
    return `
      <div style="margin-bottom:16px;">
        <button type="button" class="btn btn-outline" onclick="FinanciamentoApp.voltarBusca()">
          <i data-lucide="arrow-left" style="width:14px;height:14px;"></i> ${FinanciamentoState.painel === "esteira" ? "Voltar à esteira" : "Voltar à pesquisa"}
        </button>
      </div>
      <div class="crm-card" style="margin-bottom:16px;">
        <div class="crm-card-header" style="background:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Dados do contrato</h3>
        </div>
        <div class="crm-card-content">
          <div class="cessao-customer-grid">
            <div class="cessao-customer-field cessao-customer-field--wide" title="${this.esc(obra.empresa)}"><span class="cessao-lbl">Empresa</span><span class="cessao-val">${this.esc(obra.empresa)}</span></div>
            <div class="cessao-customer-field cessao-customer-field--wide" title="${this.esc(obra.empreendimento)}"><span class="cessao-lbl">Empreendimento</span><span class="cessao-val">${this.esc(obra.empreendimento)}</span></div>
            <div class="cessao-customer-field" title="${this.esc(proc.contractNumber || "—")}"><span class="cessao-lbl">Contrato</span><span class="cessao-val">${this.esc(proc.contractNumber || "—")}</span></div>
            <div class="cessao-customer-field" title="${this.esc(proc.titulo || "—")}"><span class="cessao-lbl">Título</span><span class="cessao-val">${this.esc(proc.titulo || "—")}</span></div>
            <div class="cessao-customer-field" title="${this.esc(this.formatUnidade(proc.unit || "—"))}"><span class="cessao-lbl">Unidade</span><span class="cessao-val">${this.esc(this.formatUnidade(proc.unit || "—"))}</span></div>
          </div>
        </div>
      </div>
      <div class="crm-card" style="margin-bottom:16px;">
        <div class="crm-card-header" style="background:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
          <h3 style="margin:0;font-size:1.1rem;color:var(--color-primary);">Dados do cliente</h3>
        </div>
        <div class="crm-card-content">${this.customerCardHtml(customer)}</div>
      </div>
      <div class="crm-card">
        <div class="crm-card-header" style="background:#f3f4f6;padding:12px 20px;border-bottom:1px solid #e5e7eb;border-radius:8px 8px 0 0;">
          <h3 style="margin:0;font-size:1.05rem;color:var(--color-primary);">Etapas do financiamento</h3>
        </div>
        <div class="crm-card-content">
          <style>
            #financiamento-root .fin-etapa { border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 6px; background: #fff; }
            #financiamento-root .fin-etapa.is-atual { border-color: #86efac; background: #f8fafc; }
            #financiamento-root .fin-etapa.is-feita { background: #f8fafc; }
            #financiamento-root .fin-etapa.is-espera { opacity: 0.72; }
            #financiamento-root .fin-etapa-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; }
            #financiamento-root .fin-etapa-nome { font-weight: 700; color: #0f172a; font-size: 0.9rem; }
            #financiamento-root .fin-etapa-meta { font-size: 0.75rem; color: #64748b; margin-top: 2px; }
            #financiamento-root .fin-etapa-nota { margin: 0; padding: 0 12px 6px; color: #334155; font-size: 0.78rem; white-space: pre-wrap; line-height: 1.4; }
            #financiamento-root .fin-etapa-corpo { padding: 0 12px 12px; }
            #financiamento-root .fin-grupo { margin: 14px 0 6px; font-size: 0.72rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #64748b; }
            #financiamento-root .fin-nota label { display: block; font-size: 0.72rem; font-weight: 700; color: #64748b; margin-bottom: 4px; }
            #financiamento-root .fin-nota textarea { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; font: inherit; background: #fff; min-height: 52px; resize: vertical; }
            #financiamento-root .fin-nota-linha { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 8px; }
            #financiamento-root .fin-anexo { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 10px; }
            #financiamento-root .fin-tag-box { flex: 1 1 260px; min-width: 240px; max-width: 420px; }
            #financiamento-root .fin-tag-box .ml-emp-filter { width: 100%; }
            #financiamento-root .fin-nota input[type="date"] { height: 36px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 8px; background: #fff; font: inherit; }
            #financiamento-root .fin-nota-st { margin: 0; color: #105436; font-size: 0.78rem; font-weight: 700; }
          </style>
          <p style="margin:0 0 12px;color:#64748b;font-size:0.82rem;">Só a etapa em andamento fica aberta. A nota e os anexos são gravados nela, sem concluir. Dá para incluir várias notas e vários documentos, cada um com a sua data. Para anexar, escolha o arquivo ou cole com Ctrl+V e clique em Enviar para a unidade. Quem concluiu pode desfazer o avanço em até 24 horas.</p>
          ${ativoIdx < 0 && this.podeDesfazer(proc) ? '<div style="margin:-4px 0 12px;"><button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.desfazerAvanco()">Desfazer avanço</button></div>' : ""}
          ${ativoIdx < 0 && folhas.length ? '<p style="margin:-4px 0 12px;color:#105436;font-size:0.82rem;font-weight:700;">Financiamento concluído.</p>' : ""}
          ${!etapas.length ? '<p style="color:#64748b;">Nenhuma etapa cadastrada. Cadastre em Financiamento → Configurações.</p>' : etapas.map((s) => {
            if (s.hasChildren) return `<div class="fin-grupo">${this.esc(s.label || s.nome)}</div>`;
            const idx = folhas.findIndex((f) => String(f.id) === String(s.id));
            const concluidaEm = this.concluidaEm(proc, s.id);
            const encerrado = ativoIdx < 0;
            const atual = !encerrado && idx === ativoIdx;
            const passada = encerrado || idx < ativoIdx || !!concluidaEm;
            const sid = String(s.id).replace(/'/g, "");
            const notasEtapa = this.listaNotas(proc, s.id);
            const rascunho = notasEtapa.filter((n) => n.rascunho).pop() || {};
            const historico = this.historicoHtml(proc, s.id);
            const classe = passada && !atual ? "is-feita" : (atual ? "is-atual" : "is-espera");
            if (!atual) {
              const quando = concluidaEm || (proc.done && proc.done[s.id]) || "";
              const meta = passada
                ? (quando ? ("Concluída em " + this.fmtDate(quando)) : "Concluída")
                : "Aguardando a etapa anterior";
              return `<div class="fin-etapa ${classe}">
                <div class="fin-etapa-linha">
                  <div>
                    <div class="fin-etapa-nome">${this.esc(s.label || s.nome)}</div>
                    <div class="fin-etapa-meta">${this.esc(meta)}</div>
                  </div>
                </div>
                ${passada ? historico : ""}
              </div>`;
            }
            const iniciada = String(proc.currentStageId || "") === String(s.id);
            const desde = iniciada && proc.done && proc.done[s.id] ? " · desde " + this.fmtDate(proc.done[s.id]) : "";
            const corpo = iniciada ? `<div class="fin-etapa-corpo">
              ${historico}
              <div class="fin-nota">
                <label for="fin-nota-${sid}">Nota interna</label>
                <textarea id="fin-nota-${sid}" rows="2" placeholder="Ex.: aguardando carta para confirmar o valor">${this.esc(rascunho.texto || "")}</textarea>
                <div class="fin-nota-linha">
                  <div>
                    <label for="fin-nota-data-${sid}">Data</label>
                    <input type="date" id="fin-nota-data-${sid}" value="${this.esc(String(rascunho.data || "").slice(0, 10))}">
                  </div>
                  <button type="button" class="btn btn-primary btn-sm" onclick="FinanciamentoApp.salvarNota('${sid}')">Salvar nota</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.novaNota('${sid}')">Nova nota</button>
                  <p id="fin-nota-st-${sid}" class="fin-nota-st"></p>
                </div>
              </div>
              <div class="fin-anexo">
                <input type="file" id="fin-arq-${sid}" multiple style="max-width:240px;font-size:0.8rem;">
                <div id="fin-tag-box-${sid}" class="fin-tag-box"></div>
                <button type="button" class="btn btn-primary btn-sm" id="fin-env-${sid}" onclick="FinanciamentoApp.enviarAnexo('${sid}')">Enviar para a unidade</button>
                <p style="margin:0;flex-basis:100%;color:#64748b;font-size:0.75rem;">Vários arquivos podem entrar nesta etapa. Cole com Ctrl+V e clique em Enviar para a unidade.</p>
                <p id="fin-st-${sid}" style="margin:0;flex-basis:100%;color:#b45309;font-size:0.78rem;"></p>
              </div>
            </div>` : "";
            const acao = iniciada
              ? `<button type="button" class="btn btn-primary btn-sm" id="fin-concluir-${sid}" onclick="FinanciamentoApp.concluirEtapa('${sid}')">Concluir etapa</button>`
              : `<button type="button" class="btn btn-primary btn-sm" onclick="FinanciamentoApp.iniciarEtapa('${sid}')">Iniciar etapa</button>`;
            const desfazer = iniciada && this.podeDesfazer(proc)
              ? `<button type="button" class="btn btn-outline btn-sm" onclick="FinanciamentoApp.desfazerAvanco()">Desfazer avanço</button>`
              : "";
            return `<div class="fin-etapa is-atual">
              <div class="fin-etapa-linha">
                <div>
                  <div class="fin-etapa-nome">${this.esc(s.label || s.nome)}</div>
                  <div class="fin-etapa-meta">${s.dias || 0} dias${this.esc(desde)}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">${desfazer}${acao}</div>
              </div>
              ${corpo}
            </div>`;
          }).join("")}
        </div>
      </div>`;
  }
};

window.FinanciamentoApp = FinanciamentoApp;

/* Junta os financiamentos deste navegador com os da nuvem. Fica o registro mais novo de cada contrato, sem apagar o outro. */
window.mergeFinanciamentosProc = function(localRaw, cloudRaw) {
  const ler = (raw) => {
    try {
      const o = JSON.parse(raw || "{}");
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch (e) {
      return {};
    }
  };
  const unirLista = (a, b) => {
    const itens = (lista) => {
      if (Array.isArray(lista)) return lista;
      if (lista && typeof lista === "object") return [lista];
      return [];
    };
    const chave = (item) => {
      if (item.id) return "id:" + String(item.id);
      if (item.fileName) return "arq:" + String(item.fileName) + "|" + String(item.em || "");
      if (item.texto) return "txt:" + String(item.texto).slice(0, 180) + "|" + String(item.data || "");
      return "em:" + String(item.em || "");
    };
    const out = [];
    const pos = {};
    [a, b].forEach((lista) => {
      itens(lista).forEach((item) => {
        if (!item || typeof item !== "object") return;
        const k = chave(item);
        if (pos[k] == null) {
          pos[k] = out.length;
          out.push(item);
          return;
        }
        const prev = out[pos[k]];
        const tp = Date.parse(prev.em || 0) || 0;
        const tn = Date.parse(item.em || 0) || 0;
        if (tn >= tp) out[pos[k]] = item;
      });
    });
    return out;
  };
  const unirMapa = (antigo, novo, porData) => {
    const out = Object.assign({}, antigo || {});
    Object.keys(novo || {}).forEach((id) => {
      const a = out[id];
      const b = novo[id];
      if (Array.isArray(a) || Array.isArray(b)) {
        out[id] = unirLista(a, b);
        return;
      }
      if (porData && a && b && typeof a === "object" && typeof b === "object") {
        const ta = Date.parse(a.em || 0) || 0;
        const tb = Date.parse(b.em || 0) || 0;
        out[id] = tb >= ta ? b : a;
        return;
      }
      if (porData && a && b && typeof a !== "object") {
        out[id] = String(a) <= String(b) ? a : b;
        return;
      }
      out[id] = b;
    });
    return out;
  };
  const local = ler(localRaw);
  const cloud = ler(cloudRaw);
  const chaves = {};
  Object.keys(local).forEach((k) => { chaves[k] = true; });
  Object.keys(cloud).forEach((k) => { chaves[k] = true; });
  const out = {};
  Object.keys(chaves).sort().forEach((k) => {
    const a = local[k];
    const b = cloud[k];
    if (!a || typeof a !== "object") { if (b) out[k] = b; return; }
    if (!b || typeof b !== "object") { out[k] = a; return; }
    const ta = Date.parse(a.updatedAt || a.startedAt || 0) || 0;
    const tb = Date.parse(b.updatedAt || b.startedAt || 0) || 0;
    const recente = tb > ta ? b : a;
    const antigo = recente === a ? b : a;
    const junto = Object.assign({}, antigo, recente);
    junto.done = unirMapa(antigo.done, recente.done, true);
    junto.concluidas = unirMapa(antigo.concluidas, recente.concluidas, true);
    junto.desfeitos = unirMapa(antigo.desfeitos, recente.desfeitos, true);
    junto.doneRevogados = unirMapa(antigo.doneRevogados, recente.doneRevogados, false);
    junto.anexos = unirMapa(antigo.anexos, recente.anexos, false);
    junto.notas = unirMapa(antigo.notas, recente.notas, true);
    const fechadas = Object.assign({}, (antigo && antigo.notasFechadas) || {});
    Object.keys((recente && recente.notasFechadas) || {}).forEach((id) => {
      const a = fechadas[id];
      const b = recente.notasFechadas[id];
      fechadas[id] = String(b || "") >= String(a || "") ? b : a;
    });
    junto.notasFechadas = fechadas;
    Object.keys(junto.notas || {}).forEach((id) => {
      const corte = Date.parse(fechadas[id] || 0) || 0;
      if (!corte) return;
      const lista = Array.isArray(junto.notas[id]) ? junto.notas[id] : [junto.notas[id]];
      junto.notas[id] = lista.filter((n) => n && (!n.rascunho || (Date.parse(n.em || 0) || 0) > corte));
    });
    const horaFin = (v) => Date.parse(v || 0) || 0;
    Object.keys(junto.desfeitos || {}).forEach((id) => {
      const d = junto.desfeitos[id];
      const maisNova = Math.max(
        horaFin(antigo.concluidas && antigo.concluidas[id]),
        horaFin(recente.concluidas && recente.concluidas[id])
      );
      if (maisNova > horaFin(d && d.em)) {
        delete junto.desfeitos[id];
        return;
      }
      if (junto.concluidas && junto.concluidas[id] && horaFin(d && d.em) >= horaFin(junto.concluidas[id])) {
        delete junto.concluidas[id];
      }
    });
    Object.keys(junto.doneRevogados || {}).forEach((id) => {
      const rev = horaFin(junto.doneRevogados[id]);
      const feitoAntigo = horaFin(antigo.done && antigo.done[id]);
      const feitoRecente = horaFin(recente.done && recente.done[id]);
      const maisNova = Math.max(feitoAntigo, feitoRecente);
      if (maisNova > rev) {
        delete junto.doneRevogados[id];
        junto.done = junto.done || {};
        junto.done[id] = maisNova === feitoRecente ? recente.done[id] : antigo.done[id];
        return;
      }
      if (junto.done && junto.done[id] && rev >= horaFin(junto.done[id])) delete junto.done[id];
    });
    if (String(recente.status || "") !== "concluido") delete junto.finishedAt;
    if (!junto.currentStageId) junto.currentStageId = antigo.currentStageId || recente.currentStageId || null;
    if (!junto.customerName) junto.customerName = antigo.customerName || recente.customerName || "";
    if (!junto.titulo) junto.titulo = antigo.titulo || recente.titulo || "";
    if (!junto.contractNumber) junto.contractNumber = antigo.contractNumber || recente.contractNumber || "";
    out[k] = junto;
  });
  return JSON.stringify(out);
};

/* O que está neste navegador agora, inclusive o financiamento aberto que o disco ainda não segurou. */
window.financiamentosProcAtual = function () {
  if (window.FinanciamentoApp && typeof window.FinanciamentoApp.loadAllProcesses === "function") {
    try { return JSON.stringify(window.FinanciamentoApp.loadAllProcesses() || {}); }
    catch (e) {}
  }
  try { return localStorage.getItem(FIN_PROC_KEY) || "{}"; }
  catch (e2) { return "{}"; }
};

window.addEventListener("beforeunload", function () {
  const proc = FinanciamentoState.process;
  const app = window.FinanciamentoApp;
  if (!proc || !app) return;
  if (proc.currentStageId && typeof app.persistirRascunho === "function") app.persistirRascunho(proc.currentStageId);
  else app.saveProcess(proc);
});

document.addEventListener("tabChanged", (e) => {
  if (e.detail === "financiamento") FinanciamentoApp.init();
});

document.addEventListener("DOMContentLoaded", function () {
  let tentativas = 0;
  const tentar = function () {
    tentativas += 1;
    const app = window.FinanciamentoApp;
    if (!app || typeof app.agendarAlertaEsteira !== "function" || !app.usuarioVeAlertaEsteira()) {
      if (tentativas < 20) setTimeout(tentar, 1000);
      return;
    }
    app.agendarAlertaEsteira();
  };
  setTimeout(tentar, 2000);
});
