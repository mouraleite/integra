/**
 * Contas a Pagar · Títulos incompletos
 * Mesma leitura do Power BI: outcome por data de emissão (selectionType=I),
 * consistência N (Incompleto) ou I (Em inclusão).
 */
const TitulosIncompletosApp = {
  state: null,

  novo() {
    const hoje = this.hoje();
    return {
      startDate: this.isoShift(hoje, -30),
      endDate: hoje,
      busca: "",
      status: "todos",
      sort: "vencimento",
      dir: "asc",
      loading: false,
      erro: "",
      consultado: false,
      aberto: -1,
      rows: []
    };
  },

  hoje() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },

  isoShift(iso, days) {
    const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },

  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  },

  dataBr(iso) {
    const s = String(iso || "").slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : (s || "—");
  },

  dataHora(v) {
    const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return this.dataBr(v);
    return m[3] + "/" + m[2] + "/" + m[1] + " " + m[4] + ":" + m[5];
  },

  legenda(status) {
    if (status === "N") return "Incompleto";
    if (status === "I") return "Em inclusão";
    return status || "—";
  },

  init() {
    if (!this.state) this.state = this.novo();
    this.render();
    if (!this.state.consultado && !this.state.loading) this.consultar();
  },

  setCampo(k, v) {
    this.state[k] = v;
  },

  ordenar(col) {
    if (this.state.sort === col) this.state.dir = this.state.dir === "asc" ? "desc" : "asc";
    else {
      this.state.sort = col;
      this.state.dir = col === "empresa" || col === "credor" || col === "criado" || col === "legenda" || col === "tipo" ? "asc" : "desc";
    }
    this.pintarCorpo();
  },

  endpoint(start, end) {
    return "/bulk-data/v1/outcome?startDate=" + encodeURIComponent(start)
      + "&endDate=" + encodeURIComponent(end)
      + "&selectionType=I&correctionIndexerId=0&correctionDate=2023-01-01&withAuthorizations=false";
  },

  async buscarFaixa(start, end, depth) {
    const fetchFn = window.siengeFetchWithRetry || window.siengeFetch;
    if (typeof fetchFn !== "function") throw new Error("A consulta ao Sienge não está disponível.");
    try {
      const payload = await fetchFn(this.endpoint(start, end), 2);
      return (payload && payload.data) || (Array.isArray(payload) ? payload : []);
    } catch (err) {
      const grande = Number(err && err.status) === 507 || /\b507\b/.test(String((err && err.message) || ""));
      if (!grande || depth > 6 || start >= end) throw err;
      const s = new Date(start + "T12:00:00");
      const e = new Date(end + "T12:00:00");
      const midDate = new Date(s.getTime() + Math.floor((e - s) / 2));
      const mid = midDate.getFullYear() + "-" + String(midDate.getMonth() + 1).padStart(2, "0") + "-" + String(midDate.getDate()).padStart(2, "0");
      const next = this.isoShift(mid, 1);
      if (!(mid >= start && mid < end && next <= end)) throw err;
      const left = await this.buscarFaixa(start, mid, depth + 1);
      const right = await this.buscarFaixa(next, end, depth + 1);
      return left.concat(right);
    }
  },

  normalizar(bill) {
    const status = String(bill.consistencyStatus || "").trim().toUpperCase();
    if (status !== "N" && status !== "I") return null;
    const cats = Array.isArray(bill.paymentsCategories) ? bill.paymentsCategories : [];
    const cat = cats.find((c) => c && c.costCenterId != null) || null;
    return {
      empresa: String(bill.companyName || "").trim(),
      companyId: bill.companyId != null ? String(bill.companyId) : "",
      emissao: String(bill.issueDate || "").slice(0, 10),
      tipo: String(bill.documentIdentificationId || "").trim(),
      docNome: String(bill.documentIdentificationName || "").trim(),
      documento: String(bill.documentNumber || "").trim(),
      titulo: String(bill.billId || "").trim(),
      parcela: bill.installmentId != null ? String(bill.installmentId) : "1",
      credor: String(bill.creditorName || "").trim(),
      credorId: bill.creditorId != null ? String(bill.creditorId) : "",
      criado: String(bill.registeredUserId || "").trim(),
      cadastrado: String(bill.registeredDate || ""),
      vencimento: String(bill.dueDate || "").slice(0, 10),
      valor: Number(bill.originalAmount) || 0,
      saldo: bill.balanceAmount != null ? Number(bill.balanceAmount) : (Number(bill.originalAmount) || 0),
      ccId: cat && cat.costCenterId != null ? String(cat.costCenterId) : "",
      ccNome: (cat && cat.costCenterName) || "",
      status,
      legenda: this.legenda(status)
    };
  },

  async consultar() {
    const s = this.state;
    if (!s.startDate || !s.endDate) {
      s.erro = "Informe o período de emissão.";
      this.render();
      return;
    }
    if (s.startDate > s.endDate) {
      s.erro = "A emissão inicial não pode ser maior que a final.";
      this.render();
      return;
    }
    s.loading = true;
    s.erro = "";
    s.aberto = -1;
    s.consultado = true;
    this.render();
    try {
      const bills = await this.buscarFaixa(s.startDate, s.endDate, 0);
      const vistos = new Set();
      const rows = [];
      (bills || []).forEach((bill) => {
        const row = this.normalizar(bill);
        if (!row) return;
        const chave = [row.titulo, row.vencimento, row.documento, row.tipo, row.empresa].join("|");
        if (vistos.has(chave)) return;
        vistos.add(chave);
        row._i = rows.length;
        rows.push(row);
      });
      s.rows = rows;
      s.loading = false;
      this.render();
    } catch (err) {
      s.loading = false;
      s.erro = "Não consegui ler os títulos no Sienge. " + (err && err.message ? err.message : "");
      this.render();
    }
  },

  visiveis() {
    const s = this.state;
    const q = String(s.busca || "").trim().toLowerCase();
    let lista = s.rows.slice();
    if (q) {
      lista = lista.filter((r) => [r.empresa, r.credor, r.documento, r.titulo, r.tipo, r.criado, r.legenda].join(" ").toLowerCase().includes(q));
    }
    const dir = s.dir === "asc" ? 1 : -1;
    const campo = s.sort;
    lista = lista.slice().sort((a, b) => String(a[campo] || "").localeCompare(String(b[campo] || ""), "pt-BR", { numeric: true, sensitivity: "base" }) * dir);
    return lista;
  },

  th(col, rotulo) {
    return `<th onclick="TitulosIncompletosApp.ordenar('${col}')" style="cursor:pointer;user-select:none;">${rotulo} <i data-lucide="chevrons-up-down" style="width:11px;vertical-align:middle;"></i></th>`;
  },

  cabecalho() {
    return `<tr>${this.th("empresa", "Empresa")}${this.th("emissao", "Emissão")}${this.th("tipo", "Tipo documento")}${this.th("documento", "Documento")}${this.th("titulo", "Título")}${this.th("credor", "Credor")}${this.th("criado", "Criado por")}${this.th("cadastrado", "Cadastrado em")}${this.th("vencimento", "Vencimento")}${this.th("legenda", "Situação")}</tr>`;
  },

  linhas(lista) {
    const hoje = this.hoje();
    if (!lista.length) {
      return `<tr><td colspan="10" class="tin-vazio">${this.state.rows.length ? "Nenhum título com esse filtro." : "Nenhum título incompleto nesse período de emissão."}</td></tr>`;
    }
    return lista.map((r) => {
      const atrasado = r.vencimento && r.vencimento < hoje;
      const aberto = this.state.aberto === r._i;
      return `<tr class="tin-row${aberto ? " is-on" : ""}" onclick="TitulosIncompletosApp.abrir(${r._i})">
        <td title="${this.esc(r.empresa)}">${this.esc(r.empresa || "—")}</td>
        <td>${this.dataBr(r.emissao)}</td>
        <td>${this.esc(r.tipo || "—")}</td>
        <td><strong>${this.esc(r.documento || "—")}</strong></td>
        <td>${this.esc(r.titulo || "—")}</td>
        <td title="${this.esc(r.credor)}">${this.esc(r.credor || "—")}</td>
        <td>${this.esc(r.criado || "—")}</td>
        <td>${this.dataHora(r.cadastrado)}</td>
        <td class="${atrasado ? "tin-atraso" : ""}">${this.dataBr(r.vencimento)}</td>
        <td><span class="tin-tag tin-${r.status === "N" ? "inc" : "inc2"}">${this.esc(r.legenda)}</span></td>
      </tr>`;
    }).join("");
  },

  pintarCorpo() {
    if (this.state && this.state.loading) return;
    const body = document.getElementById("tin-body");
    if (!body) { this.render(); return; }
    body.innerHTML = this.linhas(this.visiveis());
    const head = document.getElementById("tin-head");
    if (head) head.innerHTML = this.cabecalho();
    if (window.lucide) lucide.createIcons();
  },

  abrir(i) {
    const r = (this.state.rows || [])[i];
    if (!r) return;
    this.state.aberto = r._i;
    this.pintarCorpo();
    const app = window.ComprasControleApp;
    if (!app || typeof app.abrirTituloRow !== "function") return;
    app.abrirTituloRow({
      semFiscal: true,
      titulo: r.titulo,
      parcela: r.parcela || "1",
      credor: r.credor,
      credorId: r.credorId,
      companyId: r.companyId,
      docId: r.tipo,
      docNome: r.docNome,
      documento: r.documento,
      vencimento: r.vencimento,
      valor: r.valor,
      saldo: r.saldo,
      ccId: r.ccId,
      ccNome: r.ccNome,
      situacaoTexto: r.legenda
    });
  },

  async exportar() {
    const lista = this.visiveis();
    if (!lista.length) {
      alert("Não há títulos para exportar.");
      return;
    }
    const Inv = window.InvestimentoApp;
    let ExcelJS = window.ExcelJS;
    try {
      if (!ExcelJS && Inv && typeof Inv.ensureExcelJS === "function") ExcelJS = await Inv.ensureExcelJS();
    } catch (e) {
      ExcelJS = null;
    }
    if (!ExcelJS) {
      alert("Não foi possível carregar a biblioteca de Excel. Recarregue a página.");
      return;
    }
    const paint = (cell, opts) => (Inv && Inv.excelPaint ? Inv.excelPaint(cell, opts) : null);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Incompletos");
    ws.addRow(["Títulos incompletos"]);
    ws.addRow(["Emissão de " + this.dataBr(this.state.startDate) + " até " + this.dataBr(this.state.endDate)]);
    ws.addRow([]);
    const head = ws.addRow(["Empresa", "Emissão", "Tipo documento", "Documento", "Título", "Credor", "Criado por", "Cadastrado em", "Vencimento", "Situação"]);
    head.eachCell((cell) => paint(cell, { fill: "FF105436", font: { bold: true, color: { argb: "FFFFFFFF" }, size: 10 }, align: { vertical: "middle" } }));
    lista.forEach((r) => {
      ws.addRow([r.empresa, this.dataBr(r.emissao), r.tipo, r.documento, r.titulo, r.credor, r.criado, this.dataHora(r.cadastrado), this.dataBr(r.vencimento), r.legenda]);
    });
    ws.columns.forEach((col) => { col.width = 22; });
    ws.getColumn(1).width = 42;
    ws.getColumn(6).width = 36;
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = "titulos_incompletos_" + this.hoje() + ".xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  render() {
    const root = document.getElementById("titulos-incompletos-root");
    if (!root) return;
    if (!this.state) this.state = this.novo();
    const s = this.state;
    const lista = s.loading ? [] : this.visiveis();
    root.innerHTML = `
      <style>
        #titulos-incompletos-root { padding: 16px 18px 28px; }
        #titulos-incompletos-root .tin-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 16px; margin-bottom:14px; }
        #titulos-incompletos-root .tin-bar { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
        #titulos-incompletos-root .tin-bar label { display:block; font-size:0.72rem; font-weight:700; color:#475569; text-transform:uppercase; margin-bottom:4px; }
        #titulos-incompletos-root .tin-bar input { height:36px; padding:0 10px; border:1px solid #cbd5e1; border-radius:4px; font:inherit; font-size:0.85rem; background:#fff; box-sizing:border-box; }
        #titulos-incompletos-root .tin-bar input[type="search"] { min-width:240px; }
        #titulos-incompletos-root .tin-dica { margin:10px 0 0; color:#64748b; font-size:0.78rem; }
        #titulos-incompletos-root .tin-tablewrap { max-height:68vh; overflow:auto; border:1px solid #e2e8f0; border-radius:10px; background:#fff; }
        #titulos-incompletos-root tbody tr.tin-row { cursor:pointer; }
        #titulos-incompletos-root tbody tr.tin-row.is-on td { background:#e7f6ee; }
        #titulos-incompletos-root table { width:100%; border-collapse:collapse; font-size:0.82rem; }
        #titulos-incompletos-root thead th { position:sticky; top:0; background:#f8fafc; color:#105436; padding:10px; text-align:left; font-weight:700; z-index:1; border-bottom:2px solid #105436; }
        #titulos-incompletos-root td { padding:9px 10px; border-bottom:1px solid #e2e8f0; white-space:nowrap; max-width:280px; overflow:hidden; text-overflow:ellipsis; }
        #titulos-incompletos-root tbody tr:nth-child(even) { background:#f8faf9; }
        #titulos-incompletos-root tbody tr:hover td { background:#e7f6ee; }
        #titulos-incompletos-root .tin-id { color:#94a3b8; font-weight:500; }
        #titulos-incompletos-root .tin-atraso { color:#b91c1c; font-weight:700; }
        #titulos-incompletos-root .tin-tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.72rem; font-weight:700; }
        #titulos-incompletos-root .tin-inc { background:#fee2e2; color:#b91c1c; }
        #titulos-incompletos-root .tin-inc2 { background:#ffedd5; color:#c2410c; }
        #titulos-incompletos-root .tin-vazio { text-align:center; color:#64748b; padding:28px; }
        #titulos-incompletos-root .tin-erro { margin-top:12px; color:#b91c1c; font-size:0.85rem; }
        #titulos-incompletos-root .tin-load { display:flex; flex-direction:column; align-items:center; gap:12px; padding:48px 16px; color:#105436; font-weight:600; }
        #titulos-incompletos-root .tin-track { width:min(420px, 100%); height:8px; background:#e2e8f0; border-radius:99px; overflow:hidden; }
        #titulos-incompletos-root .tin-barfill { height:100%; width:45%; background:#105436; border-radius:99px; animation:tin-run 1.1s ease-in-out infinite; }
        @keyframes tin-run { 0% { transform:translateX(-120%); } 100% { transform:translateX(280%); } }
      </style>
      <div class="tin-card">
        <div class="tin-bar">
          <div><label for="tin-de">Emissão de</label><input id="tin-de" type="date" value="${this.esc(s.startDate)}" onchange="TitulosIncompletosApp.setCampo('startDate', this.value)"></div>
          <div><label for="tin-ate">Emissão até</label><input id="tin-ate" type="date" value="${this.esc(s.endDate)}" onchange="TitulosIncompletosApp.setCampo('endDate', this.value)"></div>
          <div><label for="tin-q">Buscar</label><input id="tin-q" type="search" placeholder="Empresa, credor ou documento" value="${this.esc(s.busca)}" oninput="TitulosIncompletosApp.setCampo('busca', this.value); TitulosIncompletosApp.pintarCorpo()"></div>
          <button type="button" class="btn btn-primary" style="height:36px;" onclick="TitulosIncompletosApp.consultar()" ${s.loading ? "disabled" : ""}><i data-lucide="search" style="width:14px;height:14px;"></i> Consultar</button>
          <button type="button" class="btn btn-excel" onclick="TitulosIncompletosApp.exportar()" title="Exportar tabela atual para Excel"><i data-lucide="download" style="width:14px;height:14px;"></i> Exportar em Excel</button>
        </div>
        ${s.erro ? `<p class="tin-erro">${this.esc(s.erro)}</p>` : ""}
        <p class="tin-dica">Clique na linha para abrir o detalhe do título.</p>
      </div>
      ${s.loading ? `<div class="tin-card"><div class="tin-load"><div class="loading-spinner"></div><div>Buscando títulos incompletos no Sienge…</div><div class="tin-track"><div class="tin-barfill"></div></div></div></div>` : `
      <div class="tin-tablewrap"><table>
        <thead id="tin-head">${this.cabecalho()}</thead>
        <tbody id="tin-body">${this.linhas(lista)}</tbody>
      </table></div>`}
    `;
    if (window.lucide) lucide.createIcons();
  }
};

window.TitulosIncompletosApp = TitulosIncompletosApp;
document.addEventListener("tabChanged", function (e) {
  if (e && e.detail === "titulos-incompletos") TitulosIncompletosApp.init();
});

/* Aviso do batimento das 7h. Ciência do operador vale o dia e sobrevive ao Ctrl+F5. */
const TitulosIncompletosAviso = {
  _visto: {},
  _timer: null,

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  hoje() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return get("year") + "-" + get("month") + "-" + get("day");
  },

  partes() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return { h: Number(get("hour")), min: Number(get("minute")) };
  },

  dataBr(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    return p.length === 3 && p[0].length === 4 ? p[2] + "/" + p[1] + "/" + p[0] : "";
  },

  moeda(n) {
    return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },

  usuario() {
    const imp = typeof window.crmImpersonacaoAtual === "function" ? window.crmImpersonacaoAtual() : null;
    if (imp) return imp;
    const u = window.AppState && window.AppState.currentUser;
    if (u) return u;
    try { return JSON.parse(localStorage.getItem("crm_logged_user") || "null"); } catch (e) { return null; }
  },

  nomePerfil(user) {
    const u = user || {};
    return u.profile_name || u.profile || u.role || "";
  },

  ehPerfil(user) {
    const n = String(this.nomePerfil(user))
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!n.includes("ANALISTA") || !n.includes("PAGADORIA")) return false;
    if (/\bII\b/.test(n) || /\b2\b/.test(n)) return false;
    return /\bI\b/.test(n) || /\b1\b/.test(n);
  },

  chave(user, dia) {
    const u = user || {};
    const quem = String(u.email || u.name || "op").toLowerCase();
    return "crm_tin_batimento_" + quem + "_" + dia;
  },

  jaCiente(user, dia) {
    if (!dia) return false;
    const k = this.chave(user, dia);
    if (this._visto[k]) return true;
    try { if (localStorage.getItem(k) === "ciente") return true; } catch (e) {}
    try { if (sessionStorage.getItem(k) === "ciente") return true; } catch (e) {}
    return false;
  },

  marcar(user, dia) {
    const k = this.chave(user, dia);
    this._visto[k] = true;
    const gravar = (store) => {
      try {
        store.setItem(k, "ciente");
        return store.getItem(k) === "ciente";
      } catch (e) {
        return false;
      }
    };
    if (!gravar(localStorage)) {
      if (typeof window.ensureCrmStorageRoom === "function") {
        try { window.ensureCrmStorageRoom(); } catch (e) {}
      }
      const native = window._nativeLocalStorageSetItem;
      if (typeof native === "function") {
        try { native.call(localStorage, k, "ciente"); } catch (e) {}
      } else {
        gravar(localStorage);
      }
    }
    gravar(sessionStorage);
  },

  async ler() {
    const fc = window.firebaseCollections;
    const db = window.firebaseDb;
    if (!fc || !db || typeof fc.getDoc !== "function" || typeof fc.doc !== "function") return null;
    const snap = await fc.getDoc(fc.doc(db, "titulos_incompletos_batimento", "atual"));
    const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
    if (!existe) return null;
    return snap.data() || null;
  },

  textoDias(n) {
    const d = Number(n) || 0;
    if (d === 1) return "Ciente há 1 dia";
    if (d > 1) return "Ciente há " + d + " dias";
    return "";
  },

  abrir(rows, user, dia) {
    if (document.getElementById("tin-batimento-aviso")) return;
    const lista = (rows || []).slice().sort((a, b) => {
      const d = (Number(b.diasCiente) || 0) - (Number(a.diasCiente) || 0);
      if (d) return d;
      return String(a.vencimento || "").localeCompare(String(b.vencimento || ""));
    });
    const itens = lista.map((row) => {
      const idade = this.textoDias(row.diasCiente);
      const doc = [row.tipo, row.documento].filter(Boolean).join(" ");
      const ven = this.dataBr(row.vencimento);
      return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
          <strong style="color:#0f172a;font-size:0.88rem;">Título ${this.esc(row.titulo || "—")}${doc ? " · " + this.esc(doc) : ""}</strong>
          ${idade ? `<span style="flex:none;color:#9a3412;font-weight:800;font-size:0.75rem;">${this.esc(idade)}</span>` : ""}
        </div>
        <div style="color:#475569;font-size:0.8rem;margin-top:2px;">${this.esc(row.credor || "—")} · ${this.esc(row.empresa || "—")}</div>
        <div style="color:#64748b;font-size:0.78rem;margin-top:2px;">${ven ? "Vencimento " + this.esc(ven) + " · " : ""}${this.esc(row.legenda || "Incompleto")} · ${this.esc(this.moeda(row.valor))}</div>
      </div>`;
    }).join("");
    const overlay = document.createElement("div");
    overlay.id = "tin-batimento-aviso";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-labelledby", "tin-batimento-titulo");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483004;display:flex;align-items:center;justify-content:center;background:rgba(12,41,29,0.55);padding:16px;";
    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;width:100%;max-width:560px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-shadow:0 18px 40px rgba(0,0,0,0.22);border:1px solid rgba(16,84,54,0.12);padding:22px 22px 18px;font-family:inherit;">
      <div id="tin-batimento-titulo" style="font-size:0.95rem;font-weight:800;color:#105436;">Títulos incompletos</div>
      <p style="margin:8px 0 12px;font-size:0.86rem;color:#1e293b;line-height:1.45;">Batimento das 7h. ${lista.length === 1 ? "Este título ainda está incompleto" : "Estes " + lista.length + " títulos ainda estão incompletos"} no Sienge.</p>
      <div style="overflow:auto;min-height:0;flex:1;">${itens}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;">
        <button type="button" id="tin-batimento-ciente" style="padding:8px 16px;border-radius:8px;border:0;background:#105436;color:#fff;font-weight:800;cursor:pointer;">Ciente</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const btn = overlay.querySelector("#tin-batimento-ciente");
    if (btn) btn.addEventListener("click", () => {
      this.marcar(user, dia);
      overlay.remove();
      this.agendarDepois(true);
    });
  },

  agendarDepois(ciente) {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const p = this.partes();
    const minutos = p.h * 60 + p.min;
    let espera;
    if (ciente || minutos >= 10 * 60) {
      let delta = (7 * 60 + 5) - minutos;
      if (delta <= 0) delta += 24 * 60;
      espera = delta * 60000;
    } else if (minutos < 7 * 60) {
      espera = ((7 * 60 + 5) - minutos) * 60000;
    } else {
      espera = 45000;
    }
    this._timer = setTimeout(() => this.verificar(), Math.max(1000, espera));
  },

  async verificar() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const u = this.usuario();
    if (!this.ehPerfil(u)) return;
    const hoje = this.hoje();
    if (this.jaCiente(u, hoje) || document.getElementById("tin-batimento-aviso")) {
      this.agendarDepois(true);
      return;
    }
    let data = null;
    try { data = await this.ler(); } catch (e) { data = null; }
    const rows = data && data.date === hoje && data.done && Array.isArray(data.rows) ? data.rows : null;
    if (rows && rows.length) {
      this.abrir(rows, u, hoje);
      return;
    }
    this.agendarDepois(false);
  }
};

window.TitulosIncompletosAviso = TitulosIncompletosAviso;

document.addEventListener("DOMContentLoaded", function () {
  let tentativas = 0;
  const tentar = function () {
    tentativas += 1;
    const u = window.AppState && window.AppState.currentUser;
    if (!u) {
      if (tentativas < 40) setTimeout(tentar, 1500);
      return;
    }
    if (window.TitulosIncompletosAviso) window.TitulosIncompletosAviso.verificar();
  };
  setTimeout(tentar, 2800);
});
