// Mútuo — Acerto de despesa entre empresas e Mútuo entre empresas (projeto "Acerto de Mútuo" da Danielle).
// Lê no Sienge o que a Moura Leite pagou pela conta 99391-6 em nome das SPEs, apura por empresa,
// gera a Nota de Débito (Excel do modelo oficial + PDF) e, no Acerto de despesa, cria o título a pagar no Sienge.
window.MutuoApp = {
  CONTA: "99391-6",
  CREDOR_MOURA_LEITE: 7,
  DEPARTAMENTO_TESOURARIA: 31,
  // Última ND emitida na pasta "20 - NOTAS DE DÉBITO\MLDU" quando o módulo veio para o Integra (ND 43).
  ND_PISO: 43,
  MODELO_XLSX: "modelos/nota-debito.xlsx",
  MESES: ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"],

  EMPRESAS: {
    ITU: {
      nome: "Terras de Itu", razao: "TERRAS DE ITU EMPREENDIMENTOS & PARTICIPAÇÕES LTDA",
      endereco: "AV. DR. OTAVIANO PEREIRA MENDES, 747 SL 1 ANDAR 2 - CENTRO", municipio: "ITU - SP",
      cep: "13301-903", cnpj: "61.328.563/0001-06", siengeId: 4, aba: "ND - ALTAVISTA", cor: "#2563eb"
    },
    RAMOS: {
      nome: "Reserva dos Ramos", razao: "RESERVA DOS RAMOS I SPE LTDA",
      endereco: "R CAPITAO LISBOA, 715 - CENTRO", municipio: "TATUÍ - SP",
      cep: "18270-070", cnpj: "57.600.844/0001-90", siengeId: 28, aba: "RAMOS", cor: "#059669"
    },
    ITATINGA: {
      nome: "Novo Horizonte Itatinga", razao: "NOVO HORIZONTE ITATINGA EMPREENDEDORA SPE LTDA",
      endereco: "R CAMPOS SALLES, 2175 - VILA SÔNIA", municipio: "BOTUCATU - SP",
      cep: "18607-750", cnpj: "64.860.139/0001-98", siengeId: 32, aba: "ITATINGA", cor: "#d97706"
    },
    TAGUAI: {
      nome: "SPE Taguaí III", razao: "SPE TAGUAÍ EMPREENDEDORA JARDIM DOS IPÊS III LTDA",
      endereco: "R CAMPOS SALLES, 2175 - VILA SÔNIA", municipio: "BOTUCATU - SP",
      cep: "18607-750", cnpj: "68.346.834/0001-97", siengeId: 36, aba: "TAGUAÍ", cor: "#7c3aed"
    }
  },

  // Acerto de despesa: gera ND e título a pagar (credor Moura Leite) no Sienge.
  CENTROS_ACERTO: [
    { chave: "ITU - RESERVA ALTAVISTA I - MLDU", empresa: "ITU", rotulo: "Itu - Altavista I", tagArquivo: "ITU",
      tipo: "folha", planos: true, ccIds: [15302], nomeCc: "ALTAVISTA I - MLDU",
      titulo: { costCenterId: 15300, paymentCategoriesId: "2030103" } },
    { chave: "TATUÍ - RESERVA DOS RAMOS - MLDU", empresa: "RAMOS", rotulo: "Tatuí - Reserva dos Ramos", tagArquivo: "RAMOS",
      tipo: "folha", planos: true, ccIds: [14702], nomeCc: "RAMOS - MLDU",
      titulo: { costCenterId: 14704, paymentCategoriesId: "2030103" } },
    { chave: "TAGUAI - JARDIM DOS IPÊS III - OBRA", empresa: "TAGUAI", rotulo: "Taguaí - Obra", tagArquivo: "SPE TAGUAÍ - OBRA",
      tipo: "obra", planos: false, ccIds: [15600, 15610, 15611, 15612],
      titulo: { costCenterId: 17712, paymentCategoriesId: "202020201" } },
    { chave: "TAGUAI - JARDIM DOS IPÊS III - CML", empresa: "TAGUAI", rotulo: "Taguaí - Comercial/MKT", tagArquivo: "SPE TAGUAÍ - CML",
      tipo: "cml", planos: false, ccIds: [15613, 15614],
      titulo: { costCenterId: 17714, paymentCategoriesId: "202030403" } }
  ],

  // Mútuo entre empresas: 1 ND por empresa, sem título no Sienge. Todos os planos financeiros.
  CENTROS_MUTUO: [
    { chave: "MUTUO - TERRAS DE ITU", empresa: "ITU", rotulo: "Terras de Itu", tagArquivo: "ITU - MUTUO", tipo: "mutuo",
      ccIds: [15300, 15301, 15310, 15311, 15312, 15313, 15314, 15315, 70400] },
    { chave: "MUTUO - RESERVA DOS RAMOS", empresa: "RAMOS", rotulo: "Reserva dos Ramos", tagArquivo: "RAMOS - MUTUO", tipo: "mutuo",
      ccIds: [14703, 14704] },
    { chave: "MUTUO - ITATINGA", empresa: "ITATINGA", rotulo: "Novo Horizonte Itatinga", tagArquivo: "ITATINGA - MUTUO", tipo: "mutuo",
      ccIds: [16103, 16104, 16110, 16111, 16112, 16113, 16114, 16115, 73200] },
    { chave: "MUTUO - SPE TAGUAÍ III", empresa: "TAGUAI", rotulo: "SPE Taguaí III", tagArquivo: "SPE TAGUAÍ - MUTUO", tipo: "mutuo",
      ccIds: [17701, 17702, 17710, 17711, 17712, 17713, 17714, 17715, 73600] }
  ],

  operacao: "ACERTO_DESPESA",
  empresa: "TODAS",
  mesAno: "",
  aba: "despesas",
  busca: "",
  loading: false,
  progresso: "",
  erro: "",
  lancamentos: [],
  totais: {},
  ndPrevistas: {},
  consultado: false,
  executando: false,
  resultado: null,
  historico: [],
  historicoCarregado: false,
  sort: { key: "data", dir: "desc" },
  _gen: 0,
  _urls: [],

  // ---------- utilidades ----------
  esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },
  money(v) {
    return (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  brl(v) {
    return "R$ " + this.money(v);
  },
  norm(v) {
    return String(v == null ? "" : v).normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  },
  iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },
  hojeIso() {
    return this.iso(new Date());
  },
  fmtData(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    return p.length === 3 && p[0] ? p[2] + "/" + p[1] + "/" + p[0] : "—";
  },
  r2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  },
  competencia() {
    const v = this.mesAno || this.hojeIso().slice(0, 7);
    const [ano, mes] = v.split("-").map(Number);
    return { ano, mes, aaaamm: String(ano) + String(mes).padStart(2, "0"), label: String(mes).padStart(2, "0") + "/" + ano, mesAno: this.MESES[mes - 1] + "/" + ano };
  },
  ehMutuo() {
    return this.operacao === "MUTUO";
  },
  centros() {
    return this.ehMutuo() ? this.CENTROS_MUTUO : this.CENTROS_ACERTO;
  },
  centrosFiltrados() {
    return this.centros().filter((c) => this.empresa === "TODAS" || c.empresa === this.empresa);
  },
  podeExecutar() {
    return typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_fin_cb_mutuo_editar") === true;
  },

  // Dia 29 (ou o último do mês, se menor); se não for dia útil em SP, recua até o dia útil anterior.
  diaDoAcerto(ano, mes) {
    const ultimo = new Date(ano, mes, 0).getDate();
    const d = new Date(ano, mes - 1, Math.min(29, ultimo), 12);
    const util = (x) => (typeof window.isBusinessDayIso === "function"
      ? window.isBusinessDayIso(this.iso(x))
      : [0, 6].indexOf(x.getDay()) < 0);
    for (let i = 0; i < 15 && !util(d); i++) d.setDate(d.getDate() - 1);
    return this.iso(d);
  },

  // ---------- Sienge ----------
  siengeBase() {
    const base = (window.SIENGE_CONFIG && window.SIENGE_CONFIG.baseUrl) || "/api/sienge-proxy";
    return String(base).replace(/\/$/, "");
  },
  siengeAuth() {
    const c = window.SIENGE_CONFIG;
    if (!c || !c.user) return "";
    return "Basic " + btoa(c.user + ":" + c.pass);
  },
  async siengeReq(path, options) {
    const opts = Object.assign({}, options || {});
    const headers = Object.assign({ Authorization: this.siengeAuth(), Accept: "application/json" }, opts.headers || {});
    opts.headers = headers;
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    let ultimo = null;
    for (let t = 0; t < 3; t++) {
      const res = await fetch(this.siengeBase() + path, opts);
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
      if (res.ok) return { res, body, status: res.status };
      if (res.status === 404) return { res, body: null, status: 404 };
      const msg = (body && (body.clientMessage || body.message || body.developerMessage)) || (typeof body === "string" && body) || ("Sienge " + res.status);
      ultimo = new Error(msg);
      ultimo.status = res.status;
      if (res.status !== 429 && res.status < 500) break;
      await espera([2000, 5000, 10000][t]);
    }
    throw ultimo;
  },

  async bulkOutcome(inicio, fim, selectionType) {
    const ep = "/bulk-data/v1/outcome?startDate=" + inicio + "&endDate=" + fim
      + "&selectionType=" + selectionType + "&correctionIndexerId=0&correctionDate=" + fim
      + (selectionType === "P" ? "&withBankMovements=true" : "");
    const buscar = typeof window.siengeFetchWithRetry === "function" ? window.siengeFetchWithRetry : null;
    if (!buscar) throw new Error("A consulta ao Sienge não está disponível.");
    try {
      const payload = await buscar(ep, 3);
      return (payload && payload.data) || (Array.isArray(payload) ? payload : []);
    } catch (err) {
      const grande = Number(err && err.status) === 507 || /\b507\b/.test(String((err && err.message) || ""));
      if (!grande || inicio >= fim) throw err;
      const a = new Date(inicio + "T12:00:00");
      const b = new Date(fim + "T12:00:00");
      const meio = new Date(a.getTime() + Math.floor((b - a) / 2));
      const prox = new Date(meio.getTime() + 86400000);
      const esq = await this.bulkOutcome(inicio, this.iso(meio), selectionType);
      const dir = await this.bulkOutcome(this.iso(prox), fim, selectionType);
      return esq.concat(dir);
    }
  },

  planoAcerto(cat) {
    const id = String(cat.financialCategoryId || "").replace(/\./g, "").trim();
    const nome = this.norm(cat.financialCategoryName);
    if (id === "21001" || id === "210" || nome.indexOf("REEMBOLS") >= 0) return "2.10.01 - Despesas Reembolsáveis";
    if (id === "21101" || id === "211" || nome.indexOf("ADIANTAMENTO") >= 0) return "2.11.01 - Adiantamentos a Fornecedores";
    return null;
  },

  planoLivre(cat) {
    const id = String(cat.financialCategoryId || "");
    const nome = cat.financialCategoryName || "";
    return id && nome ? id + " - " + nome : (nome || id || "Geral");
  },

  // Regras da Danielle (relatorio_api.py) para achar o centro de cada rateio.
  identificar(cat) {
    const ccId = Number(cat.costCenterId);
    if (this.ehMutuo()) {
      if (!Number.isFinite(ccId)) return null;
      const c = this.CENTROS_MUTUO.find((x) => x.ccIds.indexOf(ccId) >= 0);
      return c ? { centro: c, plano: this.planoLivre(cat) } : null;
    }
    const nomeCc = this.norm(cat.costCenterName);
    for (const c of this.CENTROS_ACERTO) {
      let bate;
      if (c.empresa === "TAGUAI") {
        if (Number.isFinite(ccId) && ccId) bate = c.ccIds.indexOf(ccId) >= 0;
        else {
          const ipes3 = nomeCc.indexOf("TAGUAI") >= 0 && nomeCc.indexOf("IPES III") >= 0;
          const cml = nomeCc.indexOf("COMERCIAL") >= 0 || nomeCc.indexOf("MARKETING") >= 0;
          bate = ipes3 && (c.tipo === "cml" ? cml : !cml);
        }
      } else {
        bate = nomeCc.indexOf(this.norm(c.chave)) >= 0 || nomeCc.indexOf(this.norm(c.nomeCc)) >= 0 || c.ccIds.indexOf(ccId) >= 0;
      }
      if (!bate) continue;
      const plano = c.planos ? this.planoAcerto(cat) : this.planoLivre(cat);
      return plano ? { centro: c, plano } : null;
    }
    return null;
  },

  registro(item, cat, ident, valor, tipoBaixa, conta, data, situacao) {
    return {
      centro: ident.centro.chave,
      empresa: ident.centro.empresa,
      rotulo: ident.centro.rotulo,
      plano: ident.plano,
      situacao,
      tipoBaixa,
      conta,
      data: String(data || "").slice(0, 10),
      rateio: Number(cat.financialCategoryRate) || 100,
      valor,
      billId: item.billId,
      documento: item.documentNumber || "",
      credor: item.creditorName || "",
      centroCusto: (cat.costCenterId ? cat.costCenterId + " - " : "") + (cat.costCenterName || "")
    };
  },

  extrairPagos(itens) {
    const out = [];
    (itens || []).forEach((item) => {
      (item.payments || []).forEach((pg) => {
        const op = pg.operationTypeName || "";
        const opN = this.norm(op);
        if (opN.indexOf("PAGAMENTO") < 0 && opN.indexOf("ADIANTAMENTO") < 0) return;
        (pg.bankMovements || []).forEach((bm) => {
          const conta = String(bm.accountNumber || "").trim();
          if (conta.indexOf(this.CONTA) < 0) return;
          const valorMov = Number(bm.amount) || 0;
          const data = bm.bankMovementDate || pg.paymentDate;
          const cats = (bm.paymentCategories && bm.paymentCategories.length) ? bm.paymentCategories : (item.paymentsCategories || []);
          cats.forEach((cat) => {
            const ident = this.identificar(cat);
            if (!ident) return;
            const rate = Number(cat.financialCategoryRate) || 100;
            const valor = this.r2(valorMov * rate / 100);
            if (valor <= 0) return;
            out.push(this.registro(item, cat, ident, valor, op, conta, data, "PAGO"));
          });
        });
      });
    });
    return out;
  },

  // Títulos em aberto da Moura Leite (empresa 1) vencendo na competência — só no Acerto de despesa.
  extrairAPagar(itens) {
    const out = [];
    (itens || []).forEach((item) => {
      if (Number(item.companyId) !== 1) return;
      if (String(item.forecastDocument || "").trim().toUpperCase() !== "N") return;
      if (String(item.consistencyStatus || "").trim().toUpperCase() !== "S") return;
      const saldo = Number(item.balanceAmount) || 0;
      if (saldo <= 0) return;
      (item.paymentsCategories || []).forEach((cat) => {
        const ident = this.identificar(cat);
        if (!ident) return;
        const rate = Number(cat.financialCategoryRate) || 100;
        const valor = this.r2(saldo * rate / 100);
        if (valor <= 0) return;
        out.push(this.registro(item, cat, ident, valor, "A pagar", "A pagar", item.dueDate, "A_PAGAR"));
      });
    });
    return out;
  },

  // ---------- numeração das Notas de Débito ----------
  fb() {
    const db = window.firebaseDb;
    const fx = window.firebaseCollections;
    if (!db || !fx || !fx.doc || !fx.setDoc || !fx.getDoc || !fx.getDocs || !fx.collection) return null;
    return { db, fx };
  },

  async ultimaNdSienge() {
    const hoje = new Date();
    const ini = new Date(hoje.getTime() - 90 * 86400000);
    try {
      const r = await this.siengeReq("/bills?startDate=" + this.iso(ini) + "&endDate=" + this.iso(hoje) + "&creditorId=" + this.CREDOR_MOURA_LEITE + "&limit=100");
      const lista = (r.body && (r.body.results || r.body.data)) || (Array.isArray(r.body) ? r.body : []);
      let maior = 0;
      lista.forEach((b) => {
        if (String(b.documentIdentificationId || "").trim().toUpperCase() !== "ND") return;
        const m = String(b.documentNumber || "").match(/\d+/);
        if (m) maior = Math.max(maior, Number(m[0]));
      });
      return maior;
    } catch (e) {
      return 0;
    }
  },

  async ultimaNdIntegra() {
    const fb = this.fb();
    if (!fb) return 0;
    try {
      const snap = await fb.fx.getDoc(fb.fx.doc(fb.db, "mutuo_meta", "notas_debito"));
      const d = snap && typeof snap.exists === "function" && snap.exists() ? snap.data() : null;
      return Number(d && d.ultima) || 0;
    } catch (e) {
      return 0;
    }
  },

  async proximaNd() {
    const [sienge, integra] = await Promise.all([this.ultimaNdSienge(), this.ultimaNdIntegra()]);
    return Math.max(this.ND_PISO, sienge, integra) + 1;
  },

  async gravarUltimaNd(numero) {
    const fb = this.fb();
    if (!fb) throw new Error("O banco do Integra (Firebase) não está disponível para registrar a numeração.");
    const atual = await this.ultimaNdIntegra();
    if (numero <= atual) return;
    await fb.fx.setDoc(fb.fx.doc(fb.db, "mutuo_meta", "notas_debito"), {
      ultima: numero,
      atualizadoEm: new Date().toISOString(),
      por: this.usuarioEmail()
    }, { merge: true });
  },

  usuarioEmail() {
    try {
      const u = (typeof window.crmUsuarioAcesso === "function" && window.crmUsuarioAcesso()) || (window.AppState && AppState.currentUser) || {};
      return String(u.email || u.mail || "");
    } catch (e) {
      return "";
    }
  },

  // ---------- consulta ----------
  async consultar() {
    const gen = ++this._gen;
    const comp = this.competencia();
    this.loading = true;
    this.erro = "";
    this.resultado = null;
    this.progresso = "Lendo os pagamentos da conta " + this.CONTA + " no Sienge…";
    this.render();
    try {
      const inicio = comp.ano + "-" + String(comp.mes).padStart(2, "0") + "-01";
      const ultimoDia = this.iso(new Date(comp.ano, comp.mes, 0, 12));
      const hoje = this.hojeIso();
      const fimPagos = ultimoDia > hoje && inicio <= hoje ? hoje : ultimoDia;
      const pagos = this.extrairPagos(await this.bulkOutcome(inicio, fimPagos, "P"));
      if (gen !== this._gen) return;
      let aPagar = [];
      if (!this.ehMutuo()) {
        this.progresso = "Lendo os títulos a pagar da Moura Leite que vencem no mês…";
        this.render();
        aPagar = this.extrairAPagar(await this.bulkOutcome(inicio, ultimoDia, "D"));
        if (gen !== this._gen) return;
      }
      this.lancamentos = pagos.concat(aPagar);
      const totais = {};
      this.centros().forEach((c) => { totais[c.chave] = 0; });
      this.lancamentos.forEach((l) => { totais[l.centro] = this.r2((totais[l.centro] || 0) + l.valor); });
      this.totais = totais;
      this.progresso = "Conferindo a numeração das Notas de Débito…";
      this.render();
      const prox = await this.proximaNd();
      if (gen !== this._gen) return;
      this.ndPrevistas = {};
      let n = prox;
      this.centrosFiltrados().forEach((c) => {
        if ((this.totais[c.chave] || 0) > 0) this.ndPrevistas[c.chave] = n++;
      });
      this.consultado = true;
    } catch (e) {
      if (gen !== this._gen) return;
      this.erro = "Não foi possível consultar o Sienge: " + ((e && e.message) || e);
    }
    this.loading = false;
    this.progresso = "";
    this.render();
  },

  recalcularNdPrevistas() {
    const nums = Object.values(this.ndPrevistas);
    if (!nums.length) return;
    let n = Math.min.apply(null, nums);
    this.ndPrevistas = {};
    this.centrosFiltrados().forEach((c) => {
      if ((this.totais[c.chave] || 0) > 0) this.ndPrevistas[c.chave] = n++;
    });
  },

  // ---------- Nota de Débito ----------
  descricao(centro, comp) {
    const emp = this.EMPRESAS[centro.empresa];
    const nome = emp.nome;
    const mesAno = comp.mesAno;
    if (centro.tipo === "mutuo") {
      return "Despesas da empresa " + nome + " (documentos lançados na empresa " + nome
        + " e pagos através da conta corrente " + this.CONTA + " da empresa Moura Leite - Mútuo) referente o mês de " + mesAno;
    }
    if (centro.tipo === "obra") {
      return "Despesas de obras da empresa " + nome + " lançadas e pagas através da conta corrente " + this.CONTA
        + " da empresa Moura Leite referente o mês de " + mesAno;
    }
    if (centro.tipo === "cml") {
      return "Despesas comerciais e de marketing da empresa " + nome + " lançadas e pagas através da conta corrente " + this.CONTA
        + " da empresa Moura Leite referente o mês de " + mesAno;
    }
    return "Despesas de folha de pagamento e adiantamentos da empresa " + nome + " lançados e pagos através da conta corrente "
      + this.CONTA + " da empresa Moura Leite referente o mês de " + mesAno + " - Planos 2.10.01 e 2.11.01";
  },

  nomeArquivo(nd, ext) {
    return "ND " + nd.numero + " - " + nd.centro.tagArquivo + "." + ext;
  },

  serialExcel(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  },

  xmlEsc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  trocarCelula(xml, ref, conteudo, tipo) {
    const re = new RegExp('<c r="' + ref + '"([^>]*?)(/>|>[\\s\\S]*?</c>)');
    const m = xml.match(re);
    const estilo = m && /\ss="(\d+)"/.exec(m[1]);
    const s = estilo ? ' s="' + estilo[1] + '"' : "";
    let nova;
    if (tipo === "texto") nova = '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + this.xmlEsc(conteudo) + "</t></is></c>";
    else if (tipo === "formula") nova = '<c r="' + ref + '"' + s + "><f>" + conteudo.f + "</f><v>" + conteudo.v + "</v></c>";
    else nova = '<c r="' + ref + '"' + s + ' t="n"><v>' + conteudo + "</v></c>";
    if (!m) throw new Error("O modelo da Nota de Débito não tem a célula " + ref + ".");
    return xml.replace(re, nova);
  },

  async montarXlsx(nd) {
    if (typeof JSZip === "undefined") throw new Error("A biblioteca de planilhas (JSZip) não carregou. Atualize a página.");
    const resp = await fetch(this.MODELO_XLSX + "?v=1", { cache: "no-store" });
    if (!resp.ok) throw new Error("Não encontrei o modelo da Nota de Débito (" + this.MODELO_XLSX + ").");
    const zip = await JSZip.loadAsync(await resp.arrayBuffer());
    let wb = await zip.file("xl/workbook.xml").async("string");
    const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const abas = [];
    wb.replace(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"[^>]*?\/>/g, (all, nome, rid) => {
      abas.push({ nome: nome.replace(/&amp;/g, "&"), rid, tag: all });
      return all;
    });
    const alvo = this.EMPRESAS[nd.centro.empresa].aba;
    const idx = abas.findIndex((a) => a.nome === alvo);
    if (idx < 0) throw new Error("O modelo não tem a aba " + alvo + ".");
    abas.forEach((a, i) => {
      const novo = a.tag.replace(/\sstate="[^"]*"/, "").replace("<sheet ", '<sheet state="' + (i === idx ? "visible" : "hidden") + '" ');
      wb = wb.replace(a.tag, novo);
    });
    wb = wb.replace(/activeTab="\d+"/, 'activeTab="' + idx + '"').replace(/firstSheet="\d+"/, 'firstSheet="' + idx + '"');
    zip.file("xl/workbook.xml", wb);
    const relRe = new RegExp('<Relationship [^>]*Id="' + abas[idx].rid + '"[^>]*>');
    const relTag = (rels.match(relRe) || [""])[0];
    let alvoArq = (/Target="([^"]+)"/.exec(relTag) || [])[1] || "";
    alvoArq = alvoArq.replace(/^\//, "");
    if (alvoArq.indexOf("xl/") !== 0) alvoArq = "xl/" + alvoArq;
    let sheet = await zip.file(alvoArq).async("string");
    const emp = this.EMPRESAS[nd.centro.empresa];
    sheet = this.trocarCelula(sheet, "AI2", nd.numero, "numero");
    sheet = this.trocarCelula(sheet, "AS6", this.serialExcel(nd.emissao), "numero");
    sheet = this.trocarCelula(sheet, "AS7", this.serialExcel(nd.vencimento), "numero");
    sheet = this.trocarCelula(sheet, "L11", emp.razao, "texto");
    sheet = this.trocarCelula(sheet, "L12", emp.endereco, "texto");
    sheet = this.trocarCelula(sheet, "L13", emp.municipio, "texto");
    sheet = this.trocarCelula(sheet, "L14", emp.cep, "texto");
    sheet = this.trocarCelula(sheet, "L15", emp.cnpj, "texto");
    sheet = this.trocarCelula(sheet, "E20", nd.descricao, "texto");
    sheet = this.trocarCelula(sheet, "AM20", nd.valor.toFixed(2), "numero");
    sheet = this.trocarCelula(sheet, "AM36", { f: "SUM(AM20:BA35)", v: nd.valor.toFixed(2) }, "formula");
    sheet = this.trocarCelula(sheet, "AM38", { f: "AM36+AM37", v: nd.valor.toFixed(2) }, "formula");
    zip.file(alvoArq, sheet);
    return zip.generateAsync({ type: "uint8array", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  },

  montarPdf(nd) {
    const JsPdf = window.jspdf && window.jspdf.jsPDF;
    if (!JsPdf) throw new Error("A biblioteca de PDF não carregou. Atualize a página.");
    const emp = this.EMPRESAS[nd.centro.empresa];
    const doc = new JsPdf({ unit: "mm", format: "a4" });
    const X = 15, W = 180, R = X + W;
    const cinza = () => doc.setFillColor(217, 217, 217);
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.setTextColor(0);
    // Cabeçalho
    doc.rect(X, 18, W, 38);
    doc.line(135, 18, 135, 56);
    doc.line(135, 43, R, 43);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text("MOURA LEITE DESENVOLVIMENTO &", 32, 25);
    doc.text("URBANIZAÇÃO LTDA.", 32, 31);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Rua Campos Sales, 2.175 - Vila Sônia, Botucatu - SP CEP", 32, 37);
    doc.text("18.607-750  |  CNPJ: 01.066.134/0001-78", 32, 42);
    doc.text("Telefone: 14-99668-7598", 32, 47);
    doc.text("financeiro@mouraleite.com.br", 32, 52);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("NOTA DE DÉBITO Nº", 165, 24, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(20);
    doc.text(String(nd.numero), 165, 36, { align: "center" });
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text("Data Emissão:", 172, 49, { align: "right" });
    doc.text("Data Vencimento:", 172, 54, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text(this.fmtData(nd.emissao), 193, 49, { align: "right" });
    doc.text(this.fmtData(nd.vencimento), 193, 54, { align: "right" });
    // Tomador
    cinza();
    doc.rect(X, 58, W, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.text("TOMADOR", X + 1, 61.7);
    const linhas = [["RAZÃO SOCIAL:", emp.razao], ["ENDEREÇO:", emp.endereco], ["MUNICÍPIO/ ESTADO:", emp.municipio], ["CEP:", emp.cep], ["CNPJ:", emp.cnpj]];
    linhas.forEach((l, i) => {
      const y = 68 + i * 5;
      doc.setFont("helvetica", "bold");
      doc.text(l[0], X + 1, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(l[1] || ""), 52, y);
    });
    // Itens
    cinza();
    doc.rect(X, 95, W, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.text("ITEM", X + 1, 98.7);
    doc.text("DESCRIÇÃO", 87, 98.7, { align: "center" });
    doc.text("VALOR", 170, 98.7, { align: "center" });
    const colItem = 27, colValor = 145;
    let y = 101;
    for (let i = 1; i <= 8; i++) {
      const h = i === 1 ? 14 : 9.5;
      doc.rect(X, y, W, h);
      doc.line(colItem, y, colItem, y + h);
      doc.line(colValor, y, colValor, y + h);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(String(i), (X + colItem) / 2, y + h / 2 + 1, { align: "center" });
      if (i === 1) {
        const txt = doc.splitTextToSize(nd.descricao, colValor - colItem - 3);
        doc.text(txt.slice(0, 4), colItem + 1.5, y + 3.6);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(this.money(nd.valor), 170, y + h / 2 + 1, { align: "center" });
      }
      y += h;
    }
    // Totais
    cinza();
    doc.rect(X, y, W, 15, "FD");
    doc.line(colValor, y, colValor, y + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("VALOR TOTAL DA NOTA DE DÉBITO", colValor - 1.5, y + 4.2, { align: "right" });
    doc.text("Outras Retenções/ descontos", colValor - 1.5, y + 8.7, { align: "right" });
    doc.text("Valor a Pagar", colValor - 1.5, y + 13.2, { align: "right" });
    doc.text(this.money(nd.valor), 170, y + 4.2, { align: "center" });
    doc.text("0,00", 170, y + 8.7, { align: "center" });
    doc.text(this.money(nd.valor), 170, y + 13.2, { align: "center" });
    y += 17;
    // Observações
    cinza();
    doc.rect(X, y, W, 5, "F");
    doc.setFontSize(8.5);
    doc.text("OBSERVAÇÕES:", X + 1, y + 3.7);
    y += 5;
    doc.rect(X, y, W, 50);
    doc.setFont("helvetica", "normal");
    ["Dados para pagamento:", "MOURA LEITE DESENVOLVIMENTO E URBANIZAÇÃO LTDA.", "CNPJ: 01.066.134/0001-78", "Banco: Itaú",
      "Agência: 0223 Conta Corrente: " + this.CONTA, "Ted"].forEach((t, i) => doc.text(t, X + 1, y + 4.5 + i * 4.6));
    return new Uint8Array(doc.output("arraybuffer"));
  },

  async montarNotas(centros, primeiroNumero) {
    const comp = this.competencia();
    const hoje = this.hojeIso();
    const notas = [];
    let n = primeiroNumero;
    for (const c of centros) {
      const valor = this.r2(this.totais[c.chave] || 0);
      if (valor <= 0) continue;
      const nd = { centro: c, numero: n++, valor, emissao: hoje, vencimento: hoje, descricao: this.descricao(c, comp), comp };
      nd.pdf = this.montarPdf(nd);
      nd.xlsx = await this.montarXlsx(nd);
      nd.nomePdf = this.nomeArquivo(nd, "pdf");
      nd.nomeXlsx = this.nomeArquivo(nd, "xlsx");
      notas.push(nd);
    }
    return notas;
  },

  linkLocal(bytes, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    this._urls.push(url);
    return url;
  },

  liberarLinks() {
    this._urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    this._urls = [];
  },

  // "Gerar ND": prévia dos arquivos, sem gravar nada e sem consumir numeração.
  async gerarPrevia() {
    if (!this.consultado) return alert("Consulte as despesas primeiro.");
    const centros = this.centrosFiltrados().filter((c) => (this.totais[c.chave] || 0) > 0);
    if (!centros.length) return alert("Nenhuma empresa com valor nesta competência.");
    this.executando = true;
    this.progresso = "Montando as Notas de Débito (prévia)…";
    this.render();
    try {
      this.liberarLinks();
      const prim = Math.min.apply(null, centros.map((c) => this.ndPrevistas[c.chave] || Infinity));
      const notas = await this.montarNotas(centros, Number.isFinite(prim) ? prim : await this.proximaNd());
      this.resultado = {
        previa: true,
        itens: notas.map((nd) => ({
          rotulo: nd.centro.rotulo, numero: nd.numero, valor: nd.valor,
          pdf: { nome: nd.nomePdf, url: this.linkLocal(nd.pdf, "application/pdf") },
          xlsx: { nome: nd.nomeXlsx, url: this.linkLocal(nd.xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") },
          mensagem: "Prévia. Nada foi gravado e o número não foi reservado."
        }))
      };
    } catch (e) {
      this.erro = "Não foi possível gerar as Notas de Débito: " + ((e && e.message) || e);
    }
    this.executando = false;
    this.progresso = "";
    this.render();
  },

  // ---------- histórico (Firestore + Storage) ----------
  idHistorico(comp) {
    return (this.ehMutuo() ? "MUTUO" : "ACERTO") + "_" + comp.aaaamm;
  },

  async lerHistoricoDoc(id) {
    const fb = this.fb();
    if (!fb) return null;
    try {
      const snap = await fb.fx.getDoc(fb.fx.doc(fb.db, "mutuo_execucoes", id));
      return snap && typeof snap.exists === "function" && snap.exists() ? snap.data() : null;
    } catch (e) {
      return null;
    }
  },

  async gravarHistorico(id, comp, chave, dados) {
    const fb = this.fb();
    if (!fb) throw new Error("O banco do Integra (Firebase) não está disponível.");
    const patch = {
      operacao: this.ehMutuo() ? "MUTUO" : "ACERTO_DESPESA",
      competencia: comp.aaaamm,
      atualizadoEm: new Date().toISOString(),
      centros: { [chave]: dados }
    };
    await fb.fx.setDoc(fb.fx.doc(fb.db, "mutuo_execucoes", id), patch, { merge: true });
  },

  async subirArquivo(caminho, bytes, tipo) {
    const st = window.firebaseStorage;
    const fx = window.firebaseCollections;
    if (!st || !fx || !fx.ref || !fx.uploadBytes || !fx.getDownloadURL) throw new Error("O armazenamento de arquivos do Integra não está disponível.");
    const r = fx.ref(st, caminho);
    await fx.uploadBytes(r, new Blob([bytes], { type: tipo }), { contentType: tipo });
    return fx.getDownloadURL(r);
  },

  async carregarHistorico() {
    const fb = this.fb();
    this.historicoCarregado = true;
    if (!fb) { this.historico = []; this.render(); return; }
    try {
      const snap = await fb.fx.getDocs(fb.fx.collection(fb.db, "mutuo_execucoes"));
      const lista = [];
      snap.forEach((d) => lista.push(Object.assign({ id: d.id }, d.data())));
      lista.sort((a, b) => String(b.competencia || "").localeCompare(String(a.competencia || "")) || String(a.operacao).localeCompare(String(b.operacao)));
      this.historico = lista;
    } catch (e) {
      this.historico = [];
    }
    this.render();
  },

  // ---------- título no Sienge (Acerto de despesa) ----------
  async tituloExistente(debtorId, comp, docNumber) {
    const ini = comp.ano + "-" + String(comp.mes).padStart(2, "0") + "-01";
    const fim = this.iso(new Date(comp.ano, comp.mes, 0, 12));
    const hoje = this.hojeIso();
    const faixas = [[ini, fim]];
    if (hoje < ini || hoje > fim) faixas.push([hoje, hoje]);
    for (const f of faixas) {
      const r = await this.siengeReq("/bills?startDate=" + f[0] + "&endDate=" + f[1] + "&debtorId=" + debtorId + "&creditorId=" + this.CREDOR_MOURA_LEITE);
      const lista = (r.body && (r.body.results || r.body.data)) || (Array.isArray(r.body) ? r.body : []);
      const achado = lista.find((b) => String(b.documentNumber || "").trim().toUpperCase() === String(docNumber).toUpperCase());
      if (achado) return achado;
    }
    return null;
  },

  async formaPagamento(billId) {
    const logs = [];
    const r = await this.siengeReq("/creditors/" + this.CREDOR_MOURA_LEITE + "/bank-informations?limit=100&offset=0");
    const lista = (r.body && (r.body.results || r.body.data)) || (Array.isArray(r.body) ? r.body : []);
    if (!lista.length) return { ok: false, msg: "Credor sem dados bancários no Sienge." };
    const bank = lista.find((b) => String(b.defaultFlag || "").trim().toUpperCase() === "S") || lista[0];
    const espera = (ms) => new Promise((res) => setTimeout(res, ms));
    let parcelas = [];
    for (let t = 1; t <= 6 && !parcelas.length; t++) {
      try {
        const p = await this.siengeReq("/bills/" + encodeURIComponent(billId) + "/installments");
        parcelas = (p.body && (p.body.results || p.body.data)) || (Array.isArray(p.body) ? p.body : []);
      } catch (e) { logs.push(e.message); }
      if (!parcelas.length && t < 6) await espera(1500 * t);
    }
    const parcela = parcelas.length ? (parcelas[0].installmentNumber || parcelas[0].id || 1) : 1;
    const forma = String(bank.paymentForm || "").trim().toUpperCase();
    const headers = { "Content-Type": "application/json" };
    if (forma.indexOf("PIX") >= 0) {
      await this.siengeReq("/bills/" + encodeURIComponent(billId) + "/installments/" + encodeURIComponent(parcela) + "/payment-information/pix", {
        method: "PATCH", headers,
        body: JSON.stringify({ paymentTypeId: 17, isUsingCreditorData: "S", notes: "Pagamento via PIX (Chave padrão do Credor)" })
      });
      return { ok: true, msg: "Forma de pagamento: PIX." };
    }
    const ag = String(bank.agency || "").trim();
    const [agNum, agDig] = ag.indexOf("-") >= 0 ? ag.split("-", 2) : [ag, ""];
    const banco = String(bank.bank || "").trim();
    const conta = String(bank.accountNumber || "").trim();
    const digito = String(bank.checkDigit || "").trim();
    const tipoConta = String(bank.accountType || "C").trim().toUpperCase().slice(0, 1);
    const favorecido = "Moura Leite Desenvolvimento e Urbanização Ltda";
    const tipoPg = banco === "341" || forma.indexOf("ITAU") >= 0 ? 3 : 5;
    await this.siengeReq("/bills/" + encodeURIComponent(billId) + "/installments/" + encodeURIComponent(parcela) + "/payment-information/bank-transfer", {
      method: "PATCH", headers,
      body: JSON.stringify({
        paymentTypeId: tipoPg,
        beneficiaryAccountType: tipoConta === "P" ? "P" : "C",
        beneficiaryBankCode: banco,
        beneficiaryBankBranchNumber: agNum,
        beneficiaryBankBranchDigit: agDig || "",
        beneficiaryAccountNumber: conta,
        beneficiaryAccountDigit: digito,
        beneficiaryName: favorecido,
        notes: "Banco: " + banco + "-" + String(bank.nameOfBank || "").trim() + "\nAgência: " + ag + "\nConta: " + conta + "-" + digito + "\nFavorecido: " + favorecido
      })
    });
    return { ok: true, msg: tipoPg === 3 ? "Forma de pagamento: depósito Itaú." : "Forma de pagamento: TED." };
  },

  async anexarPdf(billId, nd) {
    const form = new FormData();
    form.append("file", new Blob([nd.pdf], { type: "application/pdf" }), nd.nomePdf);
    const res = await fetch(this.siengeBase() + "/bills/" + encodeURIComponent(billId) + "/attachments?description=" + encodeURIComponent(nd.nomePdf), {
      method: "POST",
      headers: { Authorization: this.siengeAuth() },
      body: form
    });
    if (!res.ok) {
      let t = "";
      try { t = await res.text(); } catch (e) {}
      throw new Error("PDF não anexado (" + res.status + ") " + t.slice(0, 160));
    }
  },

  async criarTitulo(nd) {
    const emp = this.EMPRESAS[nd.centro.empresa];
    const docNumber = String(nd.numero);
    const existente = await this.tituloExistente(emp.siengeId, nd.comp, docNumber);
    if (existente) return { billId: String(existente.id), duplicado: true, msgs: ["Já existia no Sienge o título " + existente.id + " com a ND " + docNumber + "; não criei outro."] };
    const payload = {
      debtorId: emp.siengeId,
      creditorId: this.CREDOR_MOURA_LEITE,
      documentIdentificationId: "ND",
      documentNumber: docNumber,
      issueDate: nd.emissao,
      installmentsNumber: 1,
      indexId: 0,
      baseDate: nd.emissao,
      dueDate: nd.vencimento,
      billDate: nd.emissao,
      totalInvoiceAmount: nd.valor,
      notes: nd.descricao,
      discount: 0,
      budgetCategories: [{ costCenterId: nd.centro.titulo.costCenterId, paymentCategoriesId: nd.centro.titulo.paymentCategoriesId, percentage: 100 }],
      departmentsCost: [{ departmentId: this.DEPARTAMENTO_TESOURARIA, percentage: 100 }],
      buildingsCost: [],
      taxes: [],
      units: []
    };
    const criado = await this.siengeReq("/bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let billId = criado.body && (criado.body.id || criado.body.billId);
    if (!billId) {
      const loc = criado.res.headers.get("Location") || criado.res.headers.get("location") || "";
      const ult = loc.split("/").filter(Boolean).pop();
      if (ult && /^\d+$/.test(ult)) billId = ult;
    }
    if (!billId) {
      const achado = await this.tituloExistente(emp.siengeId, nd.comp, docNumber);
      if (achado) billId = achado.id;
    }
    if (!billId) throw new Error("O Sienge aceitou o título, mas não devolveu o número. Confira no Sienge a ND " + docNumber + " antes de executar de novo.");
    billId = String(billId);
    const msgs = ["Título " + billId + " criado no Sienge."];
    try { await this.anexarPdf(billId, nd); msgs.push("PDF anexado."); } catch (e) { msgs.push("Atenção: " + e.message); }
    try { const fp = await this.formaPagamento(billId); msgs.push(fp.msg); } catch (e) { msgs.push("Atenção: forma de pagamento não vinculada (" + e.message + ")."); }
    return { billId, duplicado: false, msgs };
  },

  // ---------- execução oficial ----------
  async executar() {
    if (!this.podeExecutar()) return alert("Seu perfil não tem permissão para executar (Caixa e Banco → Mútuo → Editar).");
    if (!this.consultado) return alert("Consulte as despesas primeiro.");
    const comp = this.competencia();
    const idHist = this.idHistorico(comp);
    const hist = await this.lerHistoricoDoc(idHist);
    const feitos = (hist && hist.centros) || {};
    const candidatos = this.centrosFiltrados().filter((c) => (this.totais[c.chave] || 0) > 0);
    // Pronto = ND emitida (Mútuo) ou ND emitida com título criado (Acerto). Se o título falhou, refaz com o mesmo número.
    const pronto = (c) => {
      const f = feitos[c.chave];
      if (!f || !f.numero) return false;
      return this.ehMutuo() ? true : !!f.billId;
    };
    const jaFeitos = candidatos.filter(pronto);
    const alvos = candidatos.filter((c) => !pronto(c));
    if (!alvos.length) {
      return alert(candidatos.length
        ? "Todas as empresas selecionadas já foram executadas em " + comp.label + ". Veja na aba Histórico."
        : "Nenhuma empresa com valor nesta competência.");
    }
    const lista = alvos.map((c) => "• " + c.rotulo + ": " + this.brl(this.totais[c.chave])).join("\n");
    const aviso = this.ehMutuo()
      ? "Vai emitir as Notas de Débito de Mútuo de " + comp.label + " (sem título no Sienge):"
      : "Vai emitir as Notas de Débito de " + comp.label + " e CRIAR OS TÍTULOS A PAGAR NO SIENGE (credor Moura Leite):";
    const pulo = jaFeitos.length ? "\n\nJá executadas antes (serão puladas): " + jaFeitos.map((c) => c.rotulo).join(", ") : "";
    if (!confirm(aviso + "\n\n" + lista + pulo + "\n\nConfirma?")) return;

    this.executando = true;
    this.erro = "";
    this.progresso = "Reservando a numeração das Notas de Débito…";
    this.render();
    const itens = [];
    try {
      this.liberarLinks();
      let proxima = await this.proximaNd();
      for (const c of alvos) {
        const anterior = feitos[c.chave] && feitos[c.chave].numero ? Number(feitos[c.chave].numero) : 0;
        const numero = anterior || proxima;
        this.progresso = "Emitindo a ND " + numero + " — " + c.rotulo + "…";
        this.render();
        const item = { rotulo: c.rotulo, numero, valor: this.r2(this.totais[c.chave]), msgs: [] };
        if (anterior) item.msgs.push("Nova tentativa com a mesma ND " + anterior + " (o título não tinha sido criado).");
        itens.push(item);
        const [nd] = await this.montarNotas([c], numero);
        if (!anterior) {
          await this.gravarUltimaNd(nd.numero);
          proxima = nd.numero + 1;
        }
        item.pdf = { nome: nd.nomePdf, url: this.linkLocal(nd.pdf, "application/pdf") };
        item.xlsx = { nome: nd.nomeXlsx, url: this.linkLocal(nd.xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") };
        const registro = {
          numero: nd.numero, valor: nd.valor, emissao: nd.emissao, descricao: nd.descricao, rotulo: c.rotulo,
          lancamentos: this.lancamentos.filter((l) => l.centro === c.chave).length,
          emitidoPor: this.usuarioEmail(), emitidoEm: new Date().toISOString(),
          erroTitulo: null
        };
        try {
          const pasta = "mutuo/notas-debito/" + comp.aaaamm + "/";
          registro.pdfUrl = await this.subirArquivo(pasta + nd.nomePdf, nd.pdf, "application/pdf");
          registro.xlsxUrl = await this.subirArquivo(pasta + nd.nomeXlsx, nd.xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          registro.pdfNome = nd.nomePdf;
          registro.xlsxNome = nd.nomeXlsx;
        } catch (e) {
          item.msgs.push("Atenção: os arquivos não foram guardados no Integra (" + e.message + "). Baixe-os abaixo.");
        }
        if (!this.ehMutuo()) {
          this.progresso = "Criando o título da ND " + nd.numero + " no Sienge…";
          this.render();
          try {
            const t = await this.criarTitulo(nd);
            registro.billId = t.billId;
            registro.tituloDuplicado = t.duplicado;
            item.billId = t.billId;
            item.msgs = item.msgs.concat(t.msgs);
          } catch (e) {
            registro.erroTitulo = String((e && e.message) || e);
            item.erro = "Título NÃO criado no Sienge: " + registro.erroTitulo;
          }
        } else {
          item.msgs.push("Mútuo não gera título a pagar no Sienge.");
        }
        await this.gravarHistorico(idHist, comp, c.chave, registro);
      }
      this.resultado = { previa: false, itens };
    } catch (e) {
      this.erro = "A execução parou: " + ((e && e.message) || e);
      this.resultado = itens.length ? { previa: false, itens } : null;
    }
    this.executando = false;
    this.progresso = "";
    this.historicoCarregado = false;
    this.render();
  },

  // ---------- tela ----------
  injetarEstilo() {
    if (document.getElementById("mtd-style")) return;
    const st = document.createElement("style");
    st.id = "mtd-style";
    st.textContent = [
      ".mtd-page{display:flex;flex-direction:column;gap:14px;}",
      ".mtd-topo{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;}",
      ".mtd-campo{display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:700;color:#475569;text-transform:uppercase;}",
      ".mtd-campo select,.mtd-campo input{height:40px;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:.88rem;color:#0f172a;background:#fff;text-transform:none;font-weight:500;letter-spacing:0;}",
      ".mtd-acoes{display:flex;gap:8px;margin-left:auto;flex-wrap:wrap;align-items:flex-end;}",
      ".mtd-acoes .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;box-sizing:border-box;padding:0 16px;margin:0;line-height:1;white-space:nowrap;}",
      ".mtd-acoes .btn svg{width:16px;height:16px;flex-shrink:0;}",
      ".mtd-info{display:flex;flex-wrap:wrap;gap:8px;font-size:.78rem;color:#334155;}",
      ".mtd-chip{background:#eef8f2;color:#105436;border-radius:99px;padding:4px 10px;font-weight:600;}",
      ".mtd-chip.hoje{background:#105436;color:#fff;}",
      ".mtd-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;}",
      ".mtd-card{background:#fff;border:1px solid #e2e8f0;border-top:3px solid var(--c,#105436);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;}",
      ".mtd-card span{font-size:.72rem;color:#64748b;font-weight:600;}",
      ".mtd-card strong{font-size:1.15rem;color:#0f172a;font-variant-numeric:tabular-nums;}",
      ".mtd-card small{font-size:.72rem;color:#475569;display:flex;justify-content:space-between;gap:6px;}",
      ".mtd-card.total{background:#f4f9f6;--c:#105436;}",
      ".mtd-card.total strong{color:#105436;}",
      ".mtd-abas{display:flex;gap:4px;border-bottom:1px solid #e2e8f0;}",
      ".mtd-abas button{border:0;background:none;padding:8px 12px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;font-size:.85rem;}",
      ".mtd-abas button.on{color:#105436;border-bottom-color:#105436;}",
      ".mtd-busca{height:32px;border:1px solid #cbd5e1;border-radius:6px;padding:0 8px;font-size:.82rem;width:280px;max-width:100%;}",
      ".mtd-erro{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px 12px;font-size:.85rem;}",
      ".mtd-res{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}",
      ".mtd-res h3{margin:0;font-size:.95rem;color:#105436;}",
      ".mtd-res-item{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;border-top:1px solid #eef2f0;padding-top:8px;font-size:.82rem;}",
      ".mtd-res-item:first-of-type{border-top:0;padding-top:0;}",
      ".mtd-arq{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px;font-size:.75rem;font-weight:600;text-decoration:none;border:1px solid #e2e8f0;color:#334155;background:#f8fafc;}",
      ".mtd-arq.pdf{color:#991b1b;background:#fef2f2;border-color:#fecaca;}",
      ".mtd-arq.xlsx{color:#105436;background:#eef8f2;border-color:#bfe0cc;}",
      ".mtd-msg{width:100%;color:#475569;font-size:.76rem;}",
      ".mtd-msg.ruim{color:#b91c1c;font-weight:600;}",
      ".mtd-badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:.66rem;font-weight:700;}",
      ".mtd-badge.pago{background:#ecfdf5;color:#065f46;}",
      ".mtd-badge.apagar{background:#fffbeb;color:#92400e;}",
      ".mtd-hist{display:flex;flex-direction:column;gap:10px;}",
      ".mtd-hist-comp{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;}",
      ".mtd-hist-comp h4{margin:0;font-size:.88rem;color:#0f172a;}",
      ".mtd-vazio{color:#64748b;font-size:.85rem;padding:18px;text-align:center;}",
      ".mtd-cc td.mtd-quebra{white-space:normal;}"
    ].join("");
    document.head.appendChild(st);
  },

  lancamentosVisiveis() {
    const q = this.norm(this.busca);
    let lista = this.lancamentos.filter((l) => this.empresa === "TODAS" || l.empresa === this.empresa);
    if (q) lista = lista.filter((l) => this.norm([l.credor, l.documento, l.plano, l.rotulo, l.centroCusto].join(" ")).indexOf(q) >= 0);
    const st = this.sort;
    const dir = st.dir === "desc" ? -1 : 1;
    return lista.slice().sort((a, b) => {
      const va = a[st.key];
      const vb = b[st.key];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb), "pt-BR", { numeric: true }) * dir;
    });
  },

  ordenar(key) {
    if (this.sort.key === key) this.sort.dir = this.sort.dir === "asc" ? "desc" : "asc";
    else this.sort = { key, dir: key === "valor" || key === "data" ? "desc" : "asc" };
    this.render();
  },

  htmlCards() {
    const centros = this.centrosFiltrados();
    const cards = centros.map((c) => {
      const v = this.totais[c.chave] || 0;
      const n = this.lancamentos.filter((l) => l.centro === c.chave).length;
      const nd = this.ndPrevistas[c.chave];
      return `<div class="mtd-card" style="--c:${this.EMPRESAS[c.empresa].cor}">
        <span>${this.esc(c.rotulo)}</span>
        <strong>${this.brl(v)}</strong>
        <small><span>${n} lançamento(s)</span><span>${nd ? "Próx. ND: " + nd : "Sem ND"}</span></small>
      </div>`;
    }).join("");
    const total = centros.reduce((s, c) => s + (this.totais[c.chave] || 0), 0);
    const nTotal = this.lancamentos.filter((l) => this.empresa === "TODAS" || l.empresa === this.empresa).length;
    return `<div class="mtd-cards">${cards}
      <div class="mtd-card total">
        <span>${this.ehMutuo() ? "Total a reembolsar à Moura Leite (transferência)" : "Total a reembolsar à Moura Leite"}</span>
        <strong>${this.brl(total)}</strong>
        <small><span>Conta ${this.CONTA}</span><span>${nTotal} despesa(s)</span></small>
      </div>
    </div>`;
  },

  htmlTabela() {
    const lista = this.lancamentosVisiveis();
    const th = (key, label, cls) => `<th class="${cls || ""}" style="cursor:pointer;" onclick="MutuoApp.ordenar('${key}')">${this.esc(label)}${this.sort.key === key ? (this.sort.dir === "asc" ? " ▲" : " ▼") : ""}</th>`;
    const linhas = lista.length ? lista.map((l) => `<tr>
        <td title="${this.esc(l.centroCusto)}">${this.esc(l.rotulo)}</td>
        <td title="${this.esc(l.credor)}">${this.esc(l.credor || "—")}</td>
        <td>${this.esc(l.documento || "—")}</td>
        <td title="${this.esc(l.plano)}">${this.esc(l.plano)}</td>
        <td class="is-center"><span class="mtd-badge ${l.situacao === "PAGO" ? "pago" : "apagar"}">${l.situacao === "PAGO" ? "PAGO" : "A PAGAR"}</span></td>
        <td class="is-center">${this.fmtData(l.data)}</td>
        <td class="is-right">${(Number(l.rateio) || 0).toFixed(2)}%</td>
        <td class="is-right" style="font-variant-numeric:tabular-nums;">${this.money(l.valor)}</td>
      </tr>`).join("")
      : `<tr><td colspan="8" style="text-align:center;padding:30px;">${this.consultado ? "Nenhuma despesa para exibir." : "Clique em Consultar despesas para buscar no Sienge."}</td></tr>`;
    const soma = lista.reduce((s, l) => s + l.valor, 0);
    const total = lista.length ? `<tr style="background:#105436;color:#fff;font-weight:700;"><td colspan="7" style="color:#fff;">Total (${lista.length})</td><td class="is-right" style="color:#fff;font-variant-numeric:tabular-nums;">${this.money(soma)}</td></tr>` : "";
    const regra = this.ehMutuo() ? "Títulos pagos pela conta " + this.CONTA + " • todos os planos" : "Pagos pela conta " + this.CONTA + " e a pagar da Moura Leite • Itu/Ramos: planos 2.10.01 e 2.11.01";
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin:10px 0;">
        <input class="mtd-busca" id="mtd-busca" placeholder="Buscar credor, documento, plano…" value="${this.esc(this.busca)}">
        <span style="font-size:.75rem;color:#64748b;">${this.esc(regra)}</span>
      </div>
      <div class="cc-scroll">
        <table class="cc-table mtd-cc">
          <colgroup><col style="width:160px"><col><col style="width:90px"><col style="width:220px"><col style="width:80px"><col style="width:118px"><col style="width:70px"><col style="width:110px"></colgroup>
          <thead><tr>${th("rotulo", "Empresa")}${th("credor", "Credor")}${th("documento", "Documento")}${th("plano", "Plano financeiro")}${th("situacao", "Situação", "is-center")}${th("data", "Pagto / Vencto", "is-center")}${th("rateio", "Rateio", "is-right")}${th("valor", "Valor rateado", "is-right")}</tr></thead>
          <tbody>${linhas}${total}</tbody>
        </table>
      </div>`;
  },

  htmlArquivo(a, tipo) {
    if (!a || !a.url) return "";
    return `<a class="mtd-arq ${tipo}" href="${this.esc(a.url)}" download="${this.esc(a.nome)}" target="_blank" rel="noopener"><i data-lucide="${tipo === "pdf" ? "file-text" : "file-spreadsheet"}" style="width:13px;"></i>${this.esc(a.nome)}</a>`;
  },

  htmlResultado() {
    const r = this.resultado;
    if (!r || !r.itens || !r.itens.length) return "";
    const itens = r.itens.map((i) => `<div class="mtd-res-item">
        <strong>ND ${this.esc(i.numero)} — ${this.esc(i.rotulo)}</strong>
        <span>${this.brl(i.valor)}</span>
        ${i.billId ? `<span>Título Sienge: <b>${this.esc(i.billId)}</b></span>` : ""}
        ${this.htmlArquivo(i.pdf, "pdf")}${this.htmlArquivo(i.xlsx, "xlsx")}
        ${i.erro ? `<div class="mtd-msg ruim">${this.esc(i.erro)}</div>` : ""}
        ${(i.msgs || []).length ? `<div class="mtd-msg">${(i.msgs || []).map((m) => this.esc(m)).join(" • ")}</div>` : ""}
        ${i.mensagem ? `<div class="mtd-msg">${this.esc(i.mensagem)}</div>` : ""}
      </div>`).join("");
    return `<div class="mtd-res"><h3>${r.previa ? "Prévia das Notas de Débito" : "Execução concluída"}</h3>${itens}</div>`;
  },

  htmlHistorico() {
    if (!this.historicoCarregado) {
      setTimeout(() => this.carregarHistorico(), 0);
      return `<p class="mtd-vazio">Carregando o histórico…</p>`;
    }
    const op = this.ehMutuo() ? "MUTUO" : "ACERTO_DESPESA";
    const lista = this.historico.filter((h) => h.operacao === op);
    if (!lista.length) return `<p class="mtd-vazio">Nenhuma execução de ${this.ehMutuo() ? "Mútuo" : "Acerto de despesa"} registrada no Integra ainda.</p>`;
    return `<div class="mtd-hist">${lista.map((h) => {
      const comp = String(h.competencia || "");
      const centros = Object.keys(h.centros || {}).map((k) => Object.assign({ chave: k }, h.centros[k]))
        .filter((c) => this.empresa === "TODAS" || (this.centros().find((x) => x.chave === c.chave) || {}).empresa === this.empresa)
        .sort((a, b) => (a.numero || 0) - (b.numero || 0));
      if (!centros.length) return "";
      return `<div class="mtd-hist-comp">
        <h4>Competência ${this.esc(comp.slice(4) + "/" + comp.slice(0, 4))}</h4>
        ${centros.map((c) => `<div class="mtd-res-item">
          <strong>ND ${this.esc(c.numero)} — ${this.esc(c.rotulo || c.chave)}</strong>
          <span>${this.brl(c.valor)}</span>
          <span>${this.fmtData(c.emissao)}${c.emitidoPor ? " • " + this.esc(c.emitidoPor) : ""}</span>
          ${c.billId ? `<span>Título Sienge: <b>${this.esc(c.billId)}</b></span>` : ""}
          ${this.htmlArquivo(c.pdfUrl ? { url: c.pdfUrl, nome: c.pdfNome } : null, "pdf")}
          ${this.htmlArquivo(c.xlsxUrl ? { url: c.xlsxUrl, nome: c.xlsxNome } : null, "xlsx")}
          ${c.erroTitulo ? `<div class="mtd-msg ruim">Título não criado: ${this.esc(c.erroTitulo)}</div>` : ""}
        </div>`).join("")}
      </div>`;
    }).join("")}</div>`;
  },

  render() {
    const root = document.getElementById("mutuo-root");
    if (!root) return;
    this.injetarEstilo();
    const comp = this.competencia();
    const dia = this.diaDoAcerto(comp.ano, comp.mes);
    const ehHoje = dia === this.hojeIso();
    const ocupado = this.loading || this.executando;
    const carga = ocupado ? `<div class="ml-load">
        <div class="loading-spinner" aria-hidden="true"></div>
        <div class="loading-status-text">${this.esc(this.progresso || "Carregando…")}</div>
      </div>` : "";
    const itensEmp = Object.keys(this.EMPRESAS)
      .filter((k) => this.ehMutuo() || k !== "ITATINGA")
      .map((k) => ({ id: String(this.EMPRESAS[k].siengeId), label: this.EMPRESAS[k].razao, chave: k }))
      .sort((a, b) => Number(a.id) - Number(b.id));
    const empSel = this.empresa === "TODAS" ? "TODAS" : String((this.EMPRESAS[this.empresa] || {}).siengeId || "TODAS");
    this._itensEmp = itensEmp;
    const filtroEmp = window.MlSelectUnico
      ? MlSelectUnico.html({ id: "mtd-emp", label: "Empresa", items: itensEmp, selectedId: empSel, todos: { id: "TODAS", label: "Todas as empresas" }, largura: "420px" })
      : "";
    root.innerHTML = `<div class="mtd-page">
      <div class="mtd-topo">
        <label class="mtd-campo">Operação
          <select id="mtd-op">
            <option value="ACERTO_DESPESA"${!this.ehMutuo() ? " selected" : ""}>Acerto de despesa entre empresas</option>
            <option value="MUTUO"${this.ehMutuo() ? " selected" : ""}>Mútuo entre empresas</option>
          </select>
        </label>
        ${filtroEmp}
        <label class="mtd-campo">Mês/Ano<input type="month" id="mtd-mes" value="${this.esc(this.mesAno || this.hojeIso().slice(0, 7))}"></label>
        <div class="mtd-acoes">
          <button type="button" class="btn btn-primary cc-atualizar" id="mtd-consultar" ${ocupado ? "disabled" : ""}><i data-lucide="refresh-cw"></i> Consultar despesas</button>
          <button type="button" class="btn btn-secondary" id="mtd-previa" ${ocupado || !this.consultado ? "disabled" : ""} title="Monta os arquivos para conferir. Não grava nada."><i data-lucide="file-search"></i> Gerar ND (prévia)</button>
          ${this.podeExecutar() ? `<button type="button" class="btn btn-primary" id="mtd-executar" ${ocupado || !this.consultado ? "disabled" : ""} title="${this.ehMutuo() ? "Emite e guarda as Notas de Débito" : "Emite as Notas de Débito e cria os títulos no Sienge"}"><i data-lucide="check-check"></i> Executar</button>` : ""}
        </div>
      </div>
      <div class="mtd-info">
        <span class="mtd-chip">Competência ${this.esc(comp.label)}</span>
        <span class="mtd-chip${ehHoje ? " hoje" : ""}">${ehHoje ? "Hoje é o dia do acerto" : "Dia do acerto: " + this.fmtData(dia)}</span>
        <span class="mtd-chip">Conta ${this.CONTA} • Itaú ag. 0223</span>
        ${this.ehMutuo() ? `<span class="mtd-chip">Mútuo não gera título no Sienge</span>` : `<span class="mtd-chip">Executar cria título a pagar no Sienge</span>`}
      </div>
      ${this.erro ? `<div class="mtd-erro">${this.esc(this.erro)}</div>` : ""}
      ${carga}
      ${this.htmlResultado()}
      ${this.htmlCards()}
      <div>
        <div class="mtd-abas">
          <button type="button" class="${this.aba === "despesas" ? "on" : ""}" data-aba="despesas">Detalhamento das despesas</button>
          <button type="button" class="${this.aba === "historico" ? "on" : ""}" data-aba="historico">Histórico de Notas de Débito</button>
        </div>
        ${this.aba === "historico" ? `<div style="margin-top:10px;">${this.htmlHistorico()}</div>` : this.htmlTabela()}
      </div>
    </div>`;
    this.ligar(root);
    if (typeof window.crmCriarIcones === "function") window.crmCriarIcones(root);
    else if (window.lucide) lucide.createIcons();
  },

  ligar(root) {
    const $ = (id) => root.querySelector("#" + id);
    const op = $("mtd-op");
    if (op) op.onchange = () => {
      this.operacao = op.value;
      if (this.empresa === "ITATINGA" && !this.ehMutuo()) this.empresa = "TODAS";
      this.limpar();
      this.consultar();
    };
    if (window.MlSelectUnico) {
      MlSelectUnico.bind("mtd-emp", {
        onSelect: (id) => {
          const it = (this._itensEmp || []).find((i) => i.id === id);
          this.empresa = it ? it.chave : "TODAS";
          this.resultado = null;
          this.recalcularNdPrevistas();
          this.render();
        }
      });
    }
    const mes = $("mtd-mes");
    if (mes) mes.onchange = () => { this.mesAno = mes.value; this.limpar(); this.consultar(); };
    const c = $("mtd-consultar");
    if (c) c.onclick = () => this.consultar();
    const p = $("mtd-previa");
    if (p) p.onclick = () => this.gerarPrevia();
    const x = $("mtd-executar");
    if (x) x.onclick = () => this.executar();
    const busca = $("mtd-busca");
    if (busca) busca.oninput = () => {
      this.busca = busca.value;
      const pos = busca.selectionStart;
      this.render();
      const nova = root.querySelector("#mtd-busca");
      if (nova) { nova.focus(); try { nova.setSelectionRange(pos, pos); } catch (e) {} }
    };
    root.querySelectorAll(".mtd-abas button").forEach((b) => {
      b.onclick = () => { this.aba = b.getAttribute("data-aba"); this.render(); };
    });
  },

  limpar() {
    this.lancamentos = [];
    this.totais = {};
    this.ndPrevistas = {};
    this.consultado = false;
    this.resultado = null;
    this.erro = "";
  },

  init() {
    if (!this.mesAno) this.mesAno = this.hojeIso().slice(0, 7);
    if (this.consultado || this.loading) { this.render(); return; }
    this.consultar();
  }
};
