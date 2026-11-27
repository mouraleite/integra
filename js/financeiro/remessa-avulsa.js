/**
 * Contas a Receber · Remessa avulsa
 * Mesma leitura da planilha GERAÇÃO DE BOLETO AVULSO:
 * extrato CT/TC no vencimento, sem recebimento e sem boleto (sentToScripturalCharge = false),
 * situação Normal no income, condição Parcelas Mensais ou Parcela Acordo (origem CO).
 * Entrada, sinal (SI/SA) e parcela única ficam de fora.
 */
const RemessaAvulsaApp = {
  state: {
    inited: false,
    loading: false,
    geracao: 0,
    de: "",
    ate: "",
    empresas: [],
    empOpen: false,
    empQuery: "",
    busca: "",
    sort: "conta",
    dir: "asc",
    status: "",
    progresso: 0,
    erro: "",
    linhas: [],
    contas: {},
    analisou: false,
    origem: ""
  },

  COLS: [
    { id: "conta", label: "Conta" },
    { id: "empresa", label: "Empresa" },
    { id: "cc", label: "Centro de Custo" },
    { id: "empreendimento", label: "Empreendimento" },
    { id: "titulo", label: "Título" },
    { id: "parcela", label: "Parcela" },
    { id: "clienteId", label: "Id cliente" },
    { id: "cliente", label: "Cliente" },
    { id: "vencimento", label: "Vencimento" }
  ],

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  pad(n) {
    return String(n).padStart(2, "0");
  },

  iso(d) {
    return d.getFullYear() + "-" + this.pad(d.getMonth() + 1) + "-" + this.pad(d.getDate());
  },

  mesCorrente() {
    const hoje = new Date();
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 12);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 12);
    return { de: this.iso(ini), ate: this.iso(fim) };
  },

  fmtData(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  },

  empresasLista() {
    const lista = (window.AppState && AppState.companies) || [];
    return lista.map((c) => ({
      id: String(c.id),
      label: String(c.id) + " - " + String(c.name || c.tradeName || "").toUpperCase()
    }));
  },

  init() {
    const mes = this.mesCorrente();
    if (!this.state.de) this.state.de = mes.de;
    if (!this.state.ate) this.state.ate = mes.ate;
    this.state.inited = true;
    this.render();
    this.carregarEmpresas();
    this.carregarBatimento();
  },

  async carregarEmpresas() {
    if (this.empresasLista().length) return;
    if (!window.SiengeApiService || typeof SiengeApiService.getCompanies !== "function") return;
    try {
      const lista = await SiengeApiService.getCompanies();
      if (window.AppState) AppState.companies = lista || [];
      this.pintarEmpresas();
    } catch (e) {}
  },

  render() {
    const root = document.getElementById("remessa-avulsa-root");
    if (!root) return;
    const st = this.state;
    // 27/11/2026: tela no padrão do Integra. Filtros, busca e ações numa linha; regra em nota recolhível;
    // KPIs compactos com o status do batimento; tabela cc-table (cabeçalho verde fixo, zebra, valores alinhados).
    root.innerHTML = `
      <div class="remav-painel">
        <div class="remav-filtros">
          <div id="remav-emp"></div>
          <label class="remav-campo">Início<input type="date" id="remav-de" value="${this.esc(st.de)}"></label>
          <label class="remav-campo">Fim<input type="date" id="remav-ate" value="${this.esc(st.ate)}"></label>
          <label class="remav-campo remav-busca">Buscar<input type="search" id="remav-busca" placeholder="Título, cliente ou empreendimento" value="${this.esc(st.busca)}"></label>
          <div class="remav-acoes">
            <button type="button" class="btn btn-primary cc-atualizar" id="remav-analisar"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Analisar</button>
            <button type="button" class="btn btn-excel" id="remav-excel" title="Exportar a tabela atual para Excel" ${st.linhas.length ? "" : "disabled"}><i data-lucide="download" style="width:14px;height:14px;"></i> Exportar em Excel</button>
          </div>
        </div>
        <details class="remav-regra">
          <summary><i data-lucide="info" style="width:13px;height:13px;"></i> Quais parcelas entram?</summary>
          <p>Parcelas do período que ainda não têm boleto nem recebimento, com situação Normal e condição Parcelas Mensais ou Parcela Acordo. Entrada, sinal e parcela única não entram. Cliente com financiamento em aberto também fica de fora. O batimento do mês corrente roda todo dia às 7h. A conta é a cadastrada no centro de custo.</p>
        </details>
      </div>
      <div class="remav-resumo">
        <div id="remav-kpis" class="remav-kpis"></div>
        <div id="remav-status" class="remav-status"></div>
      </div>
      <div class="cc-scroll remav-scroll">
        <table class="cc-table remav-tabela" id="remav-tabela">
          <colgroup><col style="width:9%"><col style="width:16%"><col style="width:7%"><col style="width:17%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col><col style="width:9%"></colgroup>
          <thead><tr id="remav-head"></tr></thead>
          <tbody id="remav-body"></tbody>
        </table>
      </div>`;
    this.ligar();
    this.pintarEmpresas();
    this.pintarKpis();
    this.pintarStatus();
    this.pintarTabela();
    if (window.lucide) window.lucide.createIcons();
  },

  ligar() {
    const de = document.getElementById("remav-de");
    const ate = document.getElementById("remav-ate");
    const busca = document.getElementById("remav-busca");
    const analisar = document.getElementById("remav-analisar");
    const excel = document.getElementById("remav-excel");
    if (de) de.addEventListener("change", () => { this.state.de = de.value; });
    if (ate) ate.addEventListener("change", () => { this.state.ate = ate.value; });
    if (busca) busca.addEventListener("input", () => {
      this.state.busca = busca.value;
      this.pintarTabela();
      this.pintarKpis();
    });
    if (analisar) analisar.addEventListener("click", () => this.analisar());
    if (excel) excel.addEventListener("click", () => this.exportar());
    if (window.MlEmpresaFilter) {
      MlEmpresaFilter.bind("remav-empresas", {
        toggleOpen: () => {
          this.state.empOpen = !this.state.empOpen;
          this.pintarEmpresas();
        },
        setQuery: (q) => {
          this.state.empQuery = q;
          const list = document.getElementById("remav-empresas-list");
          if (list && window.MlEmpresaFilter) {
            list.innerHTML = MlEmpresaFilter.listHtml({
              id: "remav-empresas",
              items: this.empresasLista(),
              selectedIds: this.state.empresas,
              query: q
            });
          }
        },
        toggleId: (id, on) => {
          const set = new Set(this.state.empresas.map(String));
          if (on) set.add(String(id));
          else set.delete(String(id));
          this.state.empresas = Array.from(set);
          this.pintarEmpresas();
          this.pintarTabela();
          this.pintarKpis();
        },
        selectAll: () => {
          this.state.empresas = this.empresasLista().map((e) => e.id);
          this.pintarEmpresas();
          this.pintarTabela();
          this.pintarKpis();
        },
        selectNone: () => {
          this.state.empresas = [];
          this.pintarEmpresas();
          this.pintarTabela();
          this.pintarKpis();
        }
      });
    }
  },

  pintarEmpresas() {
    const host = document.getElementById("remav-emp");
    if (!host || !window.MlEmpresaFilter) return;
    host.innerHTML = MlEmpresaFilter.html({
      id: "remav-empresas",
      label: "Empresas",
      items: this.empresasLista(),
      selectedIds: this.state.empresas,
      open: this.state.empOpen,
      query: this.state.empQuery,
      emptyMeansAll: true
    });
    if (window.lucide) window.lucide.createIcons();
    if (this.state.empOpen && this.state.empQuery) {
      const input = document.getElementById("remav-empresas-search");
      if (input) {
        input.focus();
        const n = input.value.length;
        try { input.setSelectionRange(n, n); } catch (e) {}
      }
    }
  },

  visiveis() {
    const q = String(this.state.busca || "").trim().toLowerCase();
    const emp = new Set(this.state.empresas.map(String));
    let rows = this.state.linhas.filter((r) => !emp.size || emp.has(String(r.empresaId)));
    if (q) {
      rows = rows.filter((r) => {
        const blob = [r.conta, r.empresa, r.cc, r.empreendimento, r.titulo, r.parcela, r.clienteId, r.cliente].join(" ").toLowerCase();
        return blob.indexOf(q) >= 0;
      });
    }
    const col = this.state.sort;
    const dir = this.state.dir === "desc" ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const va = String(a[col] == null ? "" : a[col]);
      const vb = String(b[col] == null ? "" : b[col]);
      const na = Number(va);
      const nb = Number(vb);
      if (va !== "" && vb !== "" && Number.isFinite(na) && Number.isFinite(nb) && String(na) === va && String(nb) === vb) {
        return (na - nb) * dir;
      }
      return va.localeCompare(vb, "pt-BR", { numeric: true }) * dir;
    });
    return rows;
  },

  pintarKpis() {
    const box = document.getElementById("remav-kpis");
    if (!box) return;
    if (!this.state.analisou) {
      box.innerHTML = "";
      return;
    }
    const rows = this.visiveis();
    const titulos = new Set(rows.map((r) => r.titulo));
    const clientes = new Set(rows.map((r) => r.clienteId || r.cliente));
    const card = (rotulo, valor, ico) => `
      <div class="remav-kpi"><span class="remav-kpi-ico"><i data-lucide="${ico}"></i></span><div><label>${rotulo}</label><strong>${Number(valor || 0).toLocaleString("pt-BR")}</strong></div></div>`;
    box.innerHTML = card("Parcelas", rows.length, "list") + card("Títulos", titulos.size, "file-text") + card("Clientes", clientes.size, "users");
    if (window.lucide) window.lucide.createIcons();
  },

  pintarStatus() {
    const box = document.getElementById("remav-status");
    if (!box) return;
    // O carregamento aparece dentro da tabela (pintarTabela); aqui fica só a linha de status.
    if (this.state.loading) {
      box.innerHTML = "";
    } else if (this.state.erro) {
      box.innerHTML = `<span class="remav-tag is-erro"><i data-lucide="alert-triangle" style="width:13px;height:13px;"></i> ${this.esc(this.state.erro)}</span>`;
    } else if (this.state.origem === "7h" && this.state.batimentoEm) {
      box.innerHTML = `<span class="remav-tag"><i data-lucide="clock" style="width:13px;height:13px;"></i> Batimento das 7h · ${this.esc(this.state.batimentoEm)}. Analisar lê o Sienge de novo.</span>`;
    } else {
      box.innerHTML = "";
    }
    if (window.lucide) window.lucide.createIcons();
  },

  th(col) {
    const centro = ["cc", "titulo", "parcela", "clienteId", "vencimento"].indexOf(col.id) >= 0;
    const ativo = this.state.sort === col.id;
    const ico = ativo ? (this.state.dir === "desc" ? "chevron-down" : "chevron-up") : "chevrons-up-down";
    return `<th class="${centro ? "is-center" : ""}${ativo ? " is-sorted" : ""}" onclick="RemessaAvulsaApp.ordenar('${col.id}')" style="cursor:pointer;user-select:none;">${this.esc(col.label === "Centro de Custo" ? "C. custo" : col.label)} <i data-lucide="${ico}" style="width:11px;height:11px;vertical-align:-1px;opacity:${ativo ? 1 : 0.6};"></i></th>`;
  },

  pintarTabela() {
    const head = document.getElementById("remav-head");
    const body = document.getElementById("remav-body");
    if (!head || !body) return;
    head.innerHTML = this.COLS.map((c) => this.th(c)).join("");
    if (this.state.loading) {
      const w = Math.max(8, Math.min(100, this.state.progresso || 8));
      body.innerHTML = `<tr><td colspan="9" class="remav-vazio">
        <div class="ml-load" style="margin:8px auto;">
          <div class="loading-spinner" aria-hidden="true"></div>
          <div class="loading-status-text">${this.esc(this.state.status || "Analisando…")}</div>
          <div class="ml-load-track"><div class="loading-progress-bar" style="width:${w}%"></div></div>
        </div></td></tr>`;
    } else if (!this.state.analisou) {
      body.innerHTML = `<tr><td colspan="9" class="remav-vazio">Escolha o período e clique em Analisar.</td></tr>`;
    } else {
      const rows = this.visiveis();
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="9" class="remav-vazio">Nenhuma parcela elegível nesse período.</td></tr>`;
      } else {
        body.innerHTML = rows.map((r) => `<tr>
          <td title="${this.esc(r.conta || "")}">${this.esc(r.conta || "—")}</td>
          <td title="${this.esc(r.empresa)}">${this.esc(r.empresa)}</td>
          <td class="is-center">${this.esc(r.cc)}</td>
          <td title="${this.esc(r.empreendimento)}">${this.esc(r.empreendimento)}</td>
          <td class="is-center">${this.esc(r.titulo)}</td>
          <td class="is-center">${this.esc(r.parcela)}</td>
          <td class="is-center">${this.esc(r.clienteId)}</td>
          <td title="${this.esc(r.cliente)}">${this.esc(r.cliente)}</td>
          <td class="is-center">${this.esc(this.fmtData(r.vencimento))}</td>
        </tr>`).join("");
      }
    }
    const excel = document.getElementById("remav-excel");
    if (excel) excel.disabled = this.state.loading || !this.visiveis().length;
    const analisar = document.getElementById("remav-analisar");
    if (analisar) analisar.disabled = !!this.state.loading;
    if (window.lucide) window.lucide.createIcons();
  },

  ordenar(col) {
    if (this.state.sort === col) this.state.dir = this.state.dir === "asc" ? "desc" : "asc";
    else {
      this.state.sort = col;
      this.state.dir = "asc";
    }
    this.pintarTabela();
  },

  etapa(texto, progresso) {
    this.state.status = texto;
    this.state.progresso = progresso;
    this.pintarStatus();
    // O progresso aparece dentro da tabela: atualiza só a linha de carga, sem refazer o cabeçalho.
    const txt = document.querySelector("#remav-body .loading-status-text");
    const bar = document.querySelector("#remav-body .loading-progress-bar");
    if (txt && bar) {
      txt.textContent = texto || "Analisando…";
      bar.style.width = Math.max(8, Math.min(100, progresso || 8)) + "%";
    } else if (this.state.loading) {
      this.pintarTabela();
    }
  },

  dias(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12).getTime();
  },

  meio(de, ate) {
    const a = this.dias(de);
    const b = this.dias(ate);
    const m = new Date(a + Math.floor((b - a) / 2));
    const mid = this.iso(m);
    const next = new Date(m);
    next.setDate(next.getDate() + 1);
    return { mid: mid, next: this.iso(next) };
  },

  async bulk(path) {
    const once = window.siengeFetchWithRetry;
    if (typeof once !== "function") throw new Error("API Sienge indisponível.");
    const payload = await once(path, 4);
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  },

  async bulkPeriodo(montar, de, ate, depth) {
    try {
      return await this.bulk(montar(de, ate));
    } catch (err) {
      if (Number(err && err.status) !== 507 || de >= ate || depth > 8) throw err;
      const corte = this.meio(de, ate);
      if (!corte.mid || corte.mid < de || corte.mid >= ate || corte.next > ate) throw err;
      const esq = await this.bulkPeriodo(montar, de, corte.mid, depth + 1);
      const dir = await this.bulkPeriodo(montar, corte.next, ate, depth + 1);
      return esq.concat(dir);
    }
  },

  nomeEmpresa(id, fallback) {
    if (typeof getCompanyName === "function" && id) {
      const nome = getCompanyName(id, true);
      if (nome && nome.indexOf("Empresa #") !== 0) return nome;
    }
    return String(fallback || (id ? ("Empresa " + id) : "")).toUpperCase();
  },

  nomeCc(id, fallback) {
    if (typeof getCostCenterName === "function" && id) {
      const nome = getCostCenterName(id);
      if (nome) return String(nome).replace(/^(?:C\.C\.\s*)?(?:\d+\s*-\s*)+/i, "").trim().toUpperCase();
    }
    return String(fallback || "").toUpperCase();
  },

  async mapaContas() {
    const mapa = {};
    const app = window.CentrosCustoApp;
    if (!app || typeof app.carregarContasParceria !== "function") return mapa;
    try {
      const remoto = await app.carregarContasParceria();
      Object.keys(remoto || {}).forEach((id) => {
        const c = remoto[id] && remoto[id].conta;
        if (!c || !c.numero) return;
        const ag = String(c.agencia || "").trim();
        mapa[String(id)] = "Agencia: " + ag + " C/C: " + String(c.numero).trim();
      });
    } catch (e) {}
    return mapa;
  },

  obj(v) {
    return v && typeof v === "object" ? v : null;
  },

  titulosDoExtrato(row) {
    if (!row || typeof row !== "object") return [];
    if (row.billReceivableId || row.receivableBillId || Array.isArray(row.installments)) return [row];
    const nested = row.billsReceivable || row.bills;
    return Array.isArray(nested) ? nested : [];
  },

  semRecebimento(inst) {
    const recs = inst && inst.receipts;
    if (!recs) return true;
    const lista = Array.isArray(recs) ? recs : [recs];
    if (!lista.length) return true;
    return lista.every((r) => !r || r.type == null || String(r.type).trim() === "");
  },

  boletoNaoGerado(inst) {
    const v = inst && inst.sentToScripturalCharge;
    return v === false || v === "false" || v === 0 || v === "0";
  },

  situacaoNormal(valor) {
    return String(valor || "").trim().toLowerCase() === "normal";
  },

  condicaoElegivel(id, descricao) {
    const d = String(descricao || "");
    const i = String(id || "");
    if (d.indexOf("Entrada") >= 0) return false;
    if (i.indexOf("SI") >= 0) return false;
    if (d.indexOf("Unica") >= 0 || d.indexOf("Única") >= 0) return false;
    if (i.indexOf("SA") >= 0) return false;
    if (d === "Parcelas Mensais") return true;
    if (d.indexOf("Parcela Acordo") >= 0) return true;
    return false;
  },

  termoDaLinha(row) {
    const termo = this.obj(row && row.paymentTerm) || {};
    return {
      id: termo.id != null ? termo.id : (row && (row.paymentTermId || row.conditionType)),
      descricao: termo.descrition || termo.description || termo.name || ""
    };
  },

  soDigitos(v) {
    return String(v == null ? "" : v).replace(/\D/g, "");
  },

  async financiamentosAbertos() {
    const titulos = new Set();
    const clientes = new Set();
    const app = window.FinanciamentoApp;
    if (!app || typeof app.listOpenProcesses !== "function") return { titulos, clientes };
    try { if (app.puxarNuvem) await app.puxarNuvem(true); } catch (e) {}
    app.listOpenProcesses().forEach((row) => {
      const proc = row && row.proc;
      if (!proc) return;
      const titulo = this.soDigitos(proc.titulo);
      const cliente = this.soDigitos(proc.customerId);
      if (titulo) titulos.add(titulo);
      if (cliente) clientes.add(cliente);
    });
    return { titulos, clientes };
  },

  semFinanciamento(linhas, fin) {
    return linhas.filter((r) => !fin.titulos.has(this.soDigitos(r.titulo)) && !fin.clientes.has(this.soDigitos(r.clienteId)));
  },

  async carregarBatimento() {
    if (this.state.analisou || this.state.loading) return;
    const fc = window.firebaseCollections;
    if (!fc || !window.firebaseDb || typeof fc.getDoc !== "function") return;
    const mes = this.mesCorrente();
    try {
      const snap = await fc.getDoc(fc.doc(window.firebaseDb, "remessa_avulsa_batimento", "atual"));
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      if (!existe || this.state.analisou || this.state.loading) return;
      const data = snap.data() || {};
      if (!data.done || data.de !== mes.de || data.ate !== mes.ate || !Array.isArray(data.linhas)) return;
      const fin = await this.financiamentosAbertos();
      if (this.state.analisou || this.state.loading) return;
      const contas = await this.mapaContas();
      this.state.de = mes.de;
      this.state.ate = mes.ate;
      this.state.linhas = this.semFinanciamento(data.linhas, fin).map((r) => ({
        conta: r.conta || contas[String(r.cc)] || "",
        empresaId: r.empresaId,
        empresa: this.nomeEmpresa(r.empresaId, r.empresa),
        cc: r.cc,
        empreendimento: this.nomeCc(r.cc, r.empreendimento),
        titulo: r.titulo,
        parcela: r.parcela,
        clienteId: r.clienteId,
        cliente: r.cliente,
        vencimento: r.vencimento
      }));
      this.state.analisou = true;
      this.state.origem = "7h";
      const quando = data.at ? new Date(data.at) : null;
      this.state.batimentoEm = quando && !isNaN(quando.getTime())
        ? quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : this.fmtData(data.date);
      this.render();
    } catch (e) {}
  },

  async analisar() {
    const de = String((document.getElementById("remav-de") || {}).value || this.state.de || "");
    const ate = String((document.getElementById("remav-ate") || {}).value || this.state.ate || "");
    this.state.de = de;
    this.state.ate = ate;
    if (!de || !ate || de > ate) {
      this.state.erro = "Informe o início e o fim do vencimento.";
      this.pintarStatus();
      return;
    }
    const dias = Math.round((this.dias(ate) - this.dias(de)) / 86400000) + 1;
    if (dias > 62) {
      this.state.erro = "O período pode ter no máximo 62 dias. A consulta da planilha é a do mês do vencimento.";
      this.pintarStatus();
      return;
    }
    const geracao = ++this.state.geracao;
    this.state.loading = true;
    this.state.erro = "";
    this.state.analisou = false;
    this.etapa("Lendo o extrato do período…", 18);
    this.pintarTabela();
    try {
      const extratoPath = (ini, fim) => "/bulk-data/v1/customer-extract-history?startDueDate=" + encodeURIComponent(ini)
        + "&endDueDate=" + encodeURIComponent(fim)
        + "&documentsId=" + encodeURIComponent("CT,TC")
        + "&includeRemadeInstallments=false&includeCanceledInstallments=false&includeRevokedInstallments=false&includeRenegotiatedDischarge=false";
      const incomePath = (ini, fim) => "/bulk-data/v1/income?startDate=" + encodeURIComponent(ini)
        + "&endDate=" + encodeURIComponent(fim)
        + "&selectionType=D";
      const condicaoPath = (ini, fim) => incomePath(ini, fim) + "&originsIds=CO";
      const extrato = await this.bulkPeriodo(extratoPath, de, ate, 0);
      if (geracao !== this.state.geracao) return;
      this.etapa("Lendo a situação dos títulos…", 48);
      const income = await this.bulkPeriodo(incomePath, de, ate, 0);
      if (geracao !== this.state.geracao) return;
      this.etapa("Lendo as condições de pagamento…", 72);
      const condicoes = await this.bulkPeriodo(condicaoPath, de, ate, 0);
      if (geracao !== this.state.geracao) return;
      this.etapa("Montando a remessa…", 90);
      const contas = await this.mapaContas();
      const situacao = new Map();
      income.forEach((row) => {
        const id = String(row && (row.billId || row.receivableBillId || row.billReceivableId) || "");
        if (!id) return;
        if (!situacao.has(id)) situacao.set(id, new Set());
        situacao.get(id).add(String(row.defaulterSituation || ""));
      });
      const termos = new Map();
      condicoes.forEach((row) => {
        const titulo = String(row && (row.billId || row.receivableBillId) || "");
        const parcela = String(row && (row.installmentId != null ? row.installmentId : row.installmentNumber) || "");
        if (!titulo || !parcela) return;
        const termo = this.termoDaLinha(row);
        const chave = titulo + "|" + parcela;
        if (!termos.has(chave)) termos.set(chave, []);
        termos.get(chave).push(termo);
      });
      const vistos = new Set();
      const linhas = [];
      extrato.forEach((item) => {
        this.titulosDoExtrato(item).forEach((bill) => {
          const titulo = String(bill.billReceivableId || bill.receivableBillId || "");
          if (!titulo) return;
          const sits = situacao.get(titulo);
          if (!sits) return;
          let normal = false;
          sits.forEach((s) => { if (this.situacaoNormal(s)) normal = true; });
          if (!normal) return;
          const empresaObj = this.obj(bill.company) || this.obj(item.company);
          const ccObj = this.obj(bill.costCenter) || this.obj(item.costCenter);
          const cliObj = this.obj(bill.customer) || this.obj(item.customer);
          const empresaId = String((empresaObj && (empresaObj.id || empresaObj.companyId)) || bill.companyId || item.companyId || "");
          const ccId = String((ccObj && (ccObj.id || ccObj.costCenterId)) || bill.costCenterId || item.costCenterId || "");
          const clienteId = String((cliObj && cliObj.id) || bill.clientId || bill.customerId || "");
          const cliente = String((cliObj && (cliObj.name || cliObj.tradeName)) || bill.clientName || "");
          (bill.installments || []).forEach((inst) => {
            if (!inst || !this.boletoNaoGerado(inst) || !this.semRecebimento(inst)) return;
            const venc = String(inst.dueDate || inst.originalDueDate || "").slice(0, 10);
            if (!venc || venc < de || venc > ate) return;
            const parcela = String(inst.id != null ? inst.id : (inst.installmentId != null ? inst.installmentId : ""));
            if (!parcela) return;
            const lista = termos.get(titulo + "|" + parcela) || [];
            if (!lista.some((t) => this.condicaoElegivel(t.id, t.descricao))) return;
            const chave = titulo + "|" + parcela;
            if (vistos.has(chave)) return;
            vistos.add(chave);
            linhas.push({
              conta: contas[ccId] || "",
              empresaId: empresaId,
              empresa: this.nomeEmpresa(empresaId, empresaObj && empresaObj.name),
              cc: ccId,
              empreendimento: this.nomeCc(ccId, ccObj && ccObj.name),
              titulo: titulo,
              parcela: parcela,
              clienteId: clienteId,
              cliente: cliente.toUpperCase(),
              vencimento: venc
            });
          });
        });
      });
      linhas.sort((a, b) => String(a.conta).localeCompare(b.conta, "pt-BR")
        || String(a.empresa).localeCompare(b.empresa, "pt-BR")
        || String(a.cc).localeCompare(b.cc, "pt-BR", { numeric: true })
        || String(a.cliente).localeCompare(b.cliente, "pt-BR"));
      if (geracao !== this.state.geracao) return;
      const fin = await this.financiamentosAbertos();
      if (geracao !== this.state.geracao) return;
      this.state.linhas = this.semFinanciamento(linhas, fin);
      this.state.origem = "";
      this.state.contas = contas;
      this.state.analisou = true;
      this.state.loading = false;
      this.state.status = "";
      this.pintarStatus();
      this.pintarKpis();
      this.pintarTabela();
    } catch (e) {
      if (geracao !== this.state.geracao) return;
      this.state.loading = false;
      this.state.erro = (e && e.message) || "Não foi possível ler o Sienge.";
      this.pintarStatus();
      this.pintarTabela();
    }
  },

  async exportar() {
    const rows = this.visiveis();
    if (!rows.length) return;
    const inv = window.InvestimentoApp;
    if (!inv || typeof inv.ensureExcelJS !== "function") {
      alert("A exportação em Excel não está disponível nesta tela.");
      return;
    }
    const ExcelJS = await inv.ensureExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = "CRM Moura Leite";
    const porEmpresa = new Map();
    rows.forEach((r) => {
      const id = r.empresaId || "0";
      if (!porEmpresa.has(id)) porEmpresa.set(id, []);
      porEmpresa.get(id).push(r);
    });
    const used = new Set();
    const headers = this.COLS.map((c) => c.label);
    let logo = null;
    try { logo = await inv.logoDataUrl(); } catch (e) { logo = null; }
    for (const [id, lista] of porEmpresa) {
      const nome = inv.excelSheetName(id, used);
      const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }] });
      ws.getColumn(1).width = 34;
      ws.getColumn(2).width = 36;
      ws.getColumn(3).width = 16;
      ws.getColumn(4).width = 32;
      ws.getColumn(5).width = 14;
      ws.getColumn(6).width = 12;
      ws.getColumn(7).width = 14;
      ws.getColumn(8).width = 36;
      ws.getColumn(9).width = 16;
      ws.mergeCells("A1:A2");
      const titulo = ws.getCell("A1");
      titulo.value = "Remessa avulsa\n" + this.fmtData(this.state.de) + " a " + this.fmtData(this.state.ate);
      inv.excelPaint(titulo, {
        font: { size: 14, bold: true, color: { argb: "FF475569" } },
        align: { vertical: "middle", horizontal: "left", wrapText: true, indent: 8 }
      });
      ws.getRow(1).height = 28;
      ws.getRow(2).height = 22;
      ws.getRow(3).height = 8;
      const kpis = [["Parcelas", lista.length], ["Títulos", new Set(lista.map((r) => r.titulo)).size], ["Clientes", new Set(lista.map((r) => r.clienteId || r.cliente)).size]];
      kpis.forEach((par, i) => {
        const col = 4 + i;
        const rot = ws.getCell(1, col);
        rot.value = par[0];
        inv.excelPaint(rot, { font: { size: 8, bold: true, color: { argb: "FF94A3B8" } }, align: { horizontal: "right", vertical: "middle" } });
        const val = ws.getCell(2, col);
        val.value = par[1];
        inv.excelPaint(val, { font: { size: 12, bold: true, color: { argb: "FF105436" } }, align: { horizontal: "right", vertical: "middle" } });
      });
      const head = ws.getRow(4);
      head.height = 20;
      headers.forEach((h, i) => {
        const cell = head.getCell(i + 1);
        cell.value = h;
        inv.excelPaint(cell, {
          font: { size: 9, bold: true, color: { argb: "FFFFFFFF" } },
          fill: "FF334155",
          align: { vertical: "middle", horizontal: i >= 2 && i <= 6 || i === 8 ? "right" : "left" },
          border: true
        });
      });
      lista.forEach((r) => {
        const line = ws.addRow([
          r.conta || "",
          r.empresa,
          r.cc,
          r.empreendimento,
          r.titulo,
          r.parcela,
          r.clienteId,
          r.cliente,
          r.vencimento ? new Date(r.vencimento + "T12:00:00") : null
        ]);
        line.eachCell((cell, col) => {
          const opts = {
            font: { size: 9, color: { argb: "FF0F172A" } },
            border: true,
            align: { vertical: "middle", horizontal: col >= 3 && col <= 7 ? "right" : "left" }
          };
          if (col === 9) opts.numFmt = "dd/mm/yyyy";
          inv.excelPaint(cell, opts);
        });
      });
      const foot = ws.addRow([]);
      const rodape = ws.addRow([inv.generatedAtLabel(new Date())]);
      inv.excelPaint(rodape.getCell(1), { font: { size: 8, italic: true, color: { argb: "FF64748B" } } });
      void foot;
      if (logo && logo.dataUrl) {
        const img = wb.addImage({ base64: logo.dataUrl, extension: logo.extension || "png" });
        ws.addImage(img, { tl: { col: 0, row: 0 }, ext: { width: 58, height: 58 } });
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Remessa_avulsa_" + this.state.de + "_" + this.state.ate + ".xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
};

document.addEventListener("tabChanged", function (e) {
  if (e.detail === "remessa-avulsa" && window.RemessaAvulsaApp) RemessaAvulsaApp.init();
});

window.RemessaAvulsaApp = RemessaAvulsaApp;
