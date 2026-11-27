const ParticipacoesApp = {
  companies: [],
  folderCompanies: [],
  files: [],
  companyId: "",
  companyIds: [],
  _empGen: 0,
  companyQ: "",
  fileName: "",
  groupBy: "matriz",
  q: "",
  loading: false,
  error: "",
  hint: "",
  parsing: false,
  uploadProgress: "",
  detail: null, // { credor, periodo } | null
  avaliar: null,
  companyPickerOpen: false,
  exportScope: "current", // current | all
  cloudSyncing: false,

  CATEGORIES: [
    { id: "relacionada", name: "Parte relacionada / sócio", test: /ellenco|ellenceo|moura leite|mutuo|mútuo|devolução de mutuo|socio|sócio/i },
    { id: "prefeitura", name: "Taxas e prefeitura", test: /prefeitura|certidao|certidão|fiscaliza|desmembr|itbi|alvara|alvará|taxa/i },
    { id: "bancario", name: "Bancário / IOF", test: /\biof\b|bancari|tarifa|resgate|ted|pix/i },
    { id: "ti", name: "TI / certificado", test: /certificado digital|mega online|dominio|domínio|software|licen[cç]a/i },
    { id: "utilidade", name: "Utilidades", test: /energia|cpfl|sabesp|agua|água|telefone|internet|copel/i },
    { id: "juridico", name: "Jurídico / cartório", test: /cartorio|cartório|advogad|honor|registro|tabeli/i },
    { id: "obra", name: "Obra / engenharia", test: /engenh|obra|topograf|terraplen|material de constru/i },
    { id: "outras", name: "Outras", test: /.*/ }
  ],

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  fmt(v) {
    return (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  apiUrl(p) {
    const host = window.location.hostname;
    const isLocal = !host || host === "localhost" || host === "127.0.0.1";
    const port = (window.location.port === "5500" || !window.location.port) ? "3000" : window.location.port;
    const origin = isLocal ? `http://localhost:${port}` : "";
    return origin + p;
  },

  crmCompanies() {
    const list = (window.AppState && AppState.companies)
      || (window.EmpresasState && EmpresasState.companies)
      || [];
    return (list || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
  },

  empresasCustomMap() {
    const fromState = (window.EmpresasState && EmpresasState.customFields) || null;
    if (fromState && Object.keys(fromState).length) return fromState;
    try {
      const data = JSON.parse(localStorage.getItem("crm_empresas_custom") || "{}") || {};
      const map = {};
      Object.keys(data).forEach((k) => {
        if (k === "_v2") return;
        const item = data[k];
        if (!item || typeof item !== "object") return;
        const id = item.company_id != null ? item.company_id : k;
        map[id] = item;
      });
      return map;
    } catch (e) {
      return {};
    }
  },

  gestaoEllencoOn(id) {
    const map = this.empresasCustomMap();
    const custom = map[id] || map[String(id)] || map[Number(id)] || null;
    const v = custom && custom.gestao_elenco;
    return v === 1 || v === true || v === "1";
  },

  elencoCompanies() {
    return this.crmCompanies().filter((c) => this.gestaoEllencoOn(c.id));
  },

  crmCompany(id) {
    return this.crmCompanies().find((c) => String(c.id) === String(id)) || null;
  },

  companyLabel(id) {
    const c = this.crmCompany(id);
    if (!c) {
      const f = this.folderCompanies.find((x) => String(x.companyId) === String(id));
      return f ? f.label : "";
    }
    return c.name || "";
  },

  filteredCompanies() {
    const q = String(this.companyQ || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return this.elencoCompanies().filter((c) => {
      if (!q) return true;
      const blob = `${c.id} ${c.name || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return blob.includes(q);
    });
  },

  categoryOf(row) {
    const blob = `${row.credor || ""} ${row.detalhe || ""}`;
    return this.CATEGORIES.find((c) => c.test.test(blob)) || this.CATEGORIES[this.CATEGORIES.length - 1];
  },

  periodFromFileName(name) {
    const s = String(name || "");
    // Prefer YYYY_MM / YYYY-MM no final do nome (padrão Ellenceo: ... 2025_11.pdf)
    let ym = s.match(/(?:^|[^\d])(\d{4})[_-](\d{2})(?:[^\d]|$)/);
    if (ym) return `${ym[1]}-${ym[2]}`;
    ym = s.match(/(\d{4})[_-](\d{2})/);
    if (ym) return `${ym[1]}-${ym[2]}`;
    return "";
  },

  /** Período impresso no cabeçalho: "DESPESAS PAGAS 01/09/2026 30/09/2026". O mês é o do intervalo, não o do nome do arquivo. */
  periodFromPdfHeader(text) {
    const raw = String(text || "");
    const idx = raw.search(/DESPESAS\s+PAGAS/i);
    const slice = (idx >= 0 ? raw.slice(idx, idx + 700) : raw.slice(0, 700)).replace(/\s+/g, " ");
    const m = slice.match(/(\d{2})\/(\d{2})\/(\d{2,4})\D{0,80}?(\d{2})\/(\d{2})\/(\d{2,4})/);
    if (!m) return "";
    const end = this.normalizeBrDate(`${m[4]}/${m[5]}/${m[6]}`);
    const parts = end.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!parts) return "";
    const month = Number(parts[2]);
    if (month < 1 || month > 12) return "";
    return `${parts[3]}-${parts[2]}`;
  },

  extractSaldoTotal(text) {
    const s = String(text || "");
    const m = s.match(/Saldo\s*Total\s*(?:R\$|RS)?\s*([\d.]+,\d{2})/i);
    if (!m) return null;
    const v = this.parseMoney(m[1]);
    return v > 0 ? v : null;
  },

  /** Ellenceo usa dd/mm/aaaa ou dd/mm/aa (ex.: 01/12/25). */
  normalizeBrDate(d) {
    const m = String(d || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
    if (!m) return String(d || "").trim();
    let y = m[3];
    if (y.length === 2) y = `${Number(y) >= 70 ? "19" : "20"}${y}`;
    return `${m[1]}/${m[2]}/${y}`;
  },

  brDateToIso(d) {
    const n = this.normalizeBrDate(d);
    const m = n.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
  },

  periodLabel(closing, fallback) {
    if (!closing) return fallback || "Sem período";
    const [y, m] = String(closing).split("-");
    if (!y || !m) return closing;
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  },

  /** Remove ruído de pontuação/data do nome do credor para agrupar variações mínimas. */
  normalizeCredorName(name) {
    let s = String(name || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*(?:R\$|RS)\s*$/i, "")
      .replace(/\s+([\d.]+,\d{2})\s*$/g, "")
      .replace(/\s*[-–—.:;,/|]+\s*$/g, "")
      .trim();
    // Tarifas bancárias: "TAR MANUT CONTA 03/26" ≈ "TAR MANUT CONTA 11/25"
    s = s.replace(/\s+\d{1,2}\/\d{2}(?:\d{2})?\b/g, "");
    s = s.replace(/\s+\d{4}[_/-]\d{2}\b/g, "");
    s = s.replace(/\s*[-–—.:;,/|]+\s*$/g, "").replace(/\s+/g, " ").trim();
    return s || "(sem credor)";
  },

  /** Chave estável para matriz (ignora hífen final, maiúsculas, datas residuais). */
  credorGroupKey(name) {
    return this.normalizeCredorName(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9./\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  /** Rótulo canônico: preferir a forma mais limpa / mais frequente. */
  pickCredorLabel(candidates) {
    const list = (candidates || []).map((s) => this.normalizeCredorName(s)).filter(Boolean);
    if (!list.length) return "(sem credor)";
    const counts = {};
    list.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    return list.slice().sort((a, b) => {
      const d = (counts[b] || 0) - (counts[a] || 0);
      if (d) return d;
      return a.length - b.length || a.localeCompare(b, "pt-BR");
    })[0];
  },

  init() {
    this.refreshCompanyList();
    this.render();
    this.loadFolderMeta();
  },

  periodKeyOfFile(f) {
    if (!f) return "";
    return String(f.closing || this.periodFromFileName(f.name) || "").trim();
  },

  removeFilesForPeriod(closing, keepName) {
    const key = String(closing || "");
    const cid = String(this.companyId || "");
    if (!key) return;
    this.files = this.files.filter((f) => {
      if (cid && String(f.companyId || "") !== cid) return true;
      const pk = this.periodKeyOfFile(f);
      if (pk !== key) return true;
      if (keepName && f.name === keepName) return true;
      if (f.objectUrl) {
        try { URL.revokeObjectURL(f.objectUrl); } catch (e) { /* ignore */ }
      }
      return false;
    });
  },

  fbReady() {
    return !!(window.firebaseDb && window.firebaseStorage && window.firebaseCollections);
  },

  cloudDocId(companyId, closing) {
    return `${String(companyId || "").trim()}_${String(closing || "").trim()}`.replace(/[^\w.-]+/g, "_");
  },

  async uploadPdfToFirebase(file, companyId, closing) {
    if (!this.fbReady()) return { url: "", path: "" };
    const { ref, uploadBytes, getDownloadURL } = window.firebaseCollections;
    const safe = String(file.name || "arquivo.pdf").replace(/[^\w.\-()+ ]+/g, "_");
    const path = `participacoes/${companyId}/${closing || "sem-periodo"}/${safe}`;
    const storageRef = ref(window.firebaseStorage, path);
    await uploadBytes(storageRef, file, { contentType: file.type || "application/pdf" });
    const url = await getDownloadURL(storageRef);
    return { url, path };
  },

  async savePeriodToFirebase(rec, companyId) {
    if (!this.fbReady() || !rec || !companyId) return false;
    const closing = this.periodKeyOfFile(rec);
    if (!closing) return false;
    const { doc, setDoc, serverTimestamp } = window.firebaseCollections;
    const userName = (window.AppState && AppState.currentUser && AppState.currentUser.name) || "";
    const payload = {
      companyId: String(companyId),
      closing,
      fileName: rec.name || "",
      saldoTotal: rec.saldoTotal != null ? Number(rec.saldoTotal) : null,
      expenses: Array.isArray(rec.expenses) ? rec.expenses : [],
      pdfUrl: rec.pdfUrl || "",
      pdfPath: rec.pdfPath || "",
      cacheVer: 9,
      updatedAt: Date.now(),
      updatedBy: userName,
      updatedAtServer: typeof serverTimestamp === "function" ? serverTimestamp() : null
    };
    await setDoc(doc(window.firebaseDb, "participacoes_periods", this.cloudDocId(companyId, closing)), payload, { merge: true });
    return true;
  },

  async loadPeriodsFromFirebase(companyId) {
    if (!this.fbReady() || !companyId) return [];
    const { collection, query, where, getDocs } = window.firebaseCollections;
    const q = query(collection(window.firebaseDb, "participacoes_periods"), where("companyId", "==", String(companyId)));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      if (!data.closing && !data.fileName) return;
      out.push({
        name: data.fileName || `${data.closing}.pdf`,
        closing: data.closing || this.periodFromFileName(data.fileName),
        year: data.closing ? Number(String(data.closing).slice(0, 4)) : null,
        month: data.closing ? Number(String(data.closing).slice(5, 7)) : null,
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
        saldoTotal: data.saldoTotal != null ? Number(data.saldoTotal) : null,
        pdfUrl: data.pdfUrl || "",
        pdfPath: data.pdfPath || "",
        cacheVer: 9,
        fromCloud: true,
        objectUrl: ""
      });
    });
    return out;
  },

  chosenCompanyIds() {
    const ids = (this.companyIds || []).map(String).filter(Boolean);
    if (ids.length) return ids;
    return this.companyId ? [String(this.companyId)] : [];
  },

  fileKey(f) {
    if (!f) return "";
    return String(f.companyId || "") + "|" + String(f.name || "");
  },

  async mergeCloudPeriods(companyId) {
    try {
      const cloud = await this.loadPeriodsFromFirebase(companyId);
      cloud.forEach((c) => {
        c.companyId = String(companyId);
        const pk = this.periodKeyOfFile(c);
        const existing = this.files.find((f) => String(f.companyId) === String(companyId) && (this.periodKeyOfFile(f) === pk || f.name === c.name));
        if (existing) {
          if ((!existing.expenses || !existing.expenses.length) && c.expenses && c.expenses.length) {
            existing.expenses = c.expenses;
            existing.saldoTotal = c.saldoTotal;
            existing.cacheVer = 9;
          }
          if (c.pdfUrl) existing.pdfUrl = c.pdfUrl;
          if (c.pdfPath) existing.pdfPath = c.pdfPath;
          existing.fromCloud = true;
        } else {
          this.files.push(c);
        }
        if (c.expenses && c.expenses.length) this.persistCache(c);
      });
      this.files.sort((a, b) => String(b.closing || "").localeCompare(String(a.closing || "")) || b.name.localeCompare(a.name));
    } catch (e) {
      console.warn("[Participacoes] Firebase períodos:", e);
    }
  },

  refreshCompanyList() {
    this.companies = this.elencoCompanies().map((c) => ({
      companyId: String(c.id),
      label: this.companyLabel(c.id) || c.name || String(c.id)
    }));
  },

  async fetchJson(path) {
    const res = await fetch(this.apiUrl(path));
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error("API indisponível para pastas locais. Você ainda pode selecionar a empresa e enviar PDFs por aqui.");
    }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  },

  async loadFolderMeta() {
    try {
      const data = await this.fetchJson("/api/participacoes/companies");
      this.folderCompanies = data.companies || [];
    } catch (e) {
      this.folderCompanies = [];
    }
    this.render();
  },

  async loadFilesFromServer(companyId) {
    const cid = String(companyId || this.companyId || "");
    if (!cid) return;
    try {
      const data = await this.fetchJson("/api/participacoes/files?companyId=" + encodeURIComponent(cid));
      const remote = data.files || [];
      remote.forEach((f) => {
        const existing = this.files.find((x) => String(x.companyId) === cid && x.name === f.name);
        if (existing) {
          existing.size = f.size;
          existing.mtime = f.mtime;
          existing.closing = f.closing || existing.closing;
          existing.year = f.year;
          existing.month = f.month;
          existing.fromServer = true;
        } else {
          this.files.push({
            name: f.name,
            companyId: cid,
            size: f.size,
            mtime: f.mtime,
            year: f.year,
            month: f.month,
            closing: f.closing || this.periodFromFileName(f.name),
            expenses: null,
            fromServer: true,
            objectUrl: ""
          });
        }
      });
      this.files.sort((a, b) => String(b.closing || "").localeCompare(String(a.closing || "")) || b.name.localeCompare(a.name));
    } catch (e) {
      /* upload local continua válido */
    }
  },

  fileLink(nameOrFile) {
    const rec = nameOrFile && typeof nameOrFile === "object"
      ? nameOrFile
      : this.files.find((f) => this.fileKey(f) === nameOrFile || f.name === nameOrFile);
    const name = rec ? rec.name : nameOrFile;
    if (rec && rec.objectUrl) return rec.objectUrl;
    if (rec && rec.pdfUrl) return rec.pdfUrl;
    const cid = String((rec && rec.companyId) || this.companyId || "");
    const byPeriod = this.files.find((f) => String(f.companyId) === cid && this.periodKeyOfFile(f) === this.periodFromFileName(name) && f.pdfUrl);
    if (byPeriod && byPeriod.pdfUrl) return byPeriod.pdfUrl;
    return this.apiUrl("/api/participacoes/file?companyId=" + encodeURIComponent(cid) + "&file=" + encodeURIComponent(name));
  },

  parseMoney(s) {
    const t = String(s || "").trim();
    if (!t) return 0;
    const n = t.replace(/\./g, "").replace(",", ".");
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
  },

  /** Extrai o valor da coluna Débitos (aceita R$ / nº doc). Evita preço unitário no texto (ex.: "X R$ 150,00)"). */
  takeMoneyFromText(text) {
    let rest = String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u2000-\u200B\uFEFF]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!rest) return { valor: 0, rest: "", doc: "" };

    // 1) Padrão Ellenceo no fim: "… 302   1.020,00" / "… TARIFA   87,35"
    let mDoc = rest.match(/((?:TARIFA)|(?:\d{1,8}))\s+([\d.]+,\d{2})\s*$/i);
    if (mDoc) {
      const valor = this.parseMoney(mDoc[2]);
      if (valor > 0) {
        const before = rest.slice(0, mDoc.index).trim();
        return { valor, rest: before, doc: String(mDoc[1]).trim() };
      }
    }

    // 2) "R$ 1.234,56" no fim (coluna Débitos)
    let m = rest.match(/(?:R\$|RS)\s*([\d.]+,\d{2})\s*$/i);
    if (!m) m = rest.match(/([\d.]+,\d{2})\s*(?:R\$|RS)?\s*$/i);
    if (!m) {
      // Último valor que NÃO seja preço unitário no detalhe ("X R$ 150,00)" / "meses … R$ 150,00)")
      const all = [...rest.matchAll(/(?:R\$|RS)?\s*([\d.]+,\d{2})/gi)];
      for (let i = all.length - 1; i >= 0; i--) {
        const hit = all[i];
        const start = hit.index || 0;
        const prev = rest.slice(Math.max(0, start - 12), start).toUpperCase();
        if (/\bX\s*$/.test(prev) || /\(\s*$/.test(prev) || /MESES?\s*$/.test(prev)) continue;
        m = hit;
        break;
      }
    }
    if (!m) return { valor: 0, rest, doc: "" };

    const valor = this.parseMoney(m[1]);
    if (!(valor > 0)) return { valor: 0, rest, doc: "" };

    const idx = typeof m.index === "number" ? m.index : rest.lastIndexOf(m[1]);
    let before = idx >= 0 ? rest.slice(0, idx).trim() : rest;
    let after = idx >= 0 ? rest.slice(idx + String(m[0]).length).trim() : "";
    after = after.replace(/^(?:R\$|RS)\s*/i, "").trim();
    // Nº documento logo antes do valor: "… 41 R$ 650,42" ou "… TARIFA R$ 20,50"
    let doc = "";
    const docTail = before.match(/^(.*?)(?:\s+|$)((?:TARIFA)|(?:[A-Z]?\d{1,8}))\s*$/i);
    if (docTail && docTail[2] && String(docTail[1] || "").trim().length >= 2) {
      doc = String(docTail[2]).trim();
      before = String(docTail[1] || "").trim();
    }
    if (!doc && after) {
      const am = after.match(/^(?:TARIFA|[A-Z]?\d{1,8})\b/i);
      if (am) doc = am[0];
      after = after.replace(/^(?:TARIFA|[A-Z]?\d{1,8})\s*/i, "").trim();
    }
    before = before.replace(/\s+(?:TARIFA|[A-Z]?\d{1,8})$/i, (hit) => {
      if (!doc) doc = hit.trim();
      return "";
    }).trim();
    rest = (before + (after ? " " + after : "")).replace(/\s+/g, " ").trim();
    return { valor, rest, doc };
  },

  /** Linha já completa no layout Ellenceo (nº doc + débito no fim). */
  isCompleteExpenseBuf(buf) {
    return /(?:TARIFA|\d{1,8})\s+[\d.]+,\d{2}\s*$/i.test(String(buf || "").trim());
  },

  /** Separa razão social do detalhe (REF., observação, nº doc residual). */
  splitCredorDetalhe(rest) {
    let text = String(rest || "").trim();
    if (!text) return { credor: "(sem credor)", detalhe: "" };
    text = text.replace(/\s+(?:TARIFA|[A-Z]?\d{1,8})$/i, "").trim();

    // Tarifas sem razão social: "TAR TED SISPAG" / "TAR PIX …"
    if (/^TAR(?:IFA)?\b/i.test(text) || /\bTAR\s+(?:TED|PIX|DOC|MANUT|SISPAG)\b/i.test(text)) {
      return { credor: "(tarifa bancária)", detalhe: text };
    }

    const gap = text.match(/^(.{3,120}?)\s{2,}(.+)$/);
    if (gap) return { credor: gap[1].trim(), detalhe: gap[2].trim() };
    const parts = text.split(/\s{2,}/);
    if (parts.length >= 2) {
      return { credor: parts[0].trim(), detalhe: parts.slice(1).join(" ").trim() };
    }
    const corp = text.match(/^(.+?\b(?:LTDA|S\.?\s?A\.?|EIRELI|ME|EPP|SS|LTDA\.)\b\.?)\s+(.+)$/i);
    if (corp) return { credor: corp[1].replace(/\s+/g, " ").trim(), detalhe: corp[2].trim() };
    const ref = text.match(/^(.+?)\s+(REF\.?\s*.+)$/i);
    if (ref && ref[1].length >= 3) return { credor: ref[1].trim(), detalhe: ref[2].trim() };
    const leadDetail = text.match(/^(.+?)\s+(PROTOCOL?O\s+.+|PROTOCOLO\s+.+|SOLICITAÇÃO\s+.+|SOLICITACAO\s+.+|PAGAMENTO\s+.+|COMPRA\s+.+|LOCAÇÃO\s+.+|PAGAMENTOS\s+.+)$/i);
    if (leadDetail && leadDetail[1].length >= 3) return { credor: leadDetail[1].trim(), detalhe: leadDetail[2].trim() };
    // Caso de linha do tipo “FERNANDA CARDOSO caixa, e também atualizaram...”
    const leadNarrative = text.match(/^(.+?)\s+(caixa\b[,;: ]?.*|e\s+tamb\[ée\]m\b.*|tamb\[ée\]m\b.*)$/i);
    if (leadNarrative && leadNarrative[1].length >= 3) return { credor: leadNarrative[1].replace(/\s+/g, " ").trim(), detalhe: leadNarrative[2].trim() };
    // Nome pessoa + detalhe sem REF: primeiras 2–5 palavras maiúsculas
    const person = text.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç' .-]{2,60}?)\s+(REF\.?\s+.+|SOLICITAÇÃO.+|SOLICITACAO.+|PROTOCOLO.+|PROTOCOL?O.+|COMPRA.+|PAGAMENTO.+|LOCAÇÃO.+)$/i);
    if (person) return { credor: person[1].replace(/\s+/g, " ").trim(), detalhe: person[2].trim() };
    return { credor: text, detalhe: "" };
  },

  isExpenseNoiseLine(line) {
    const s = String(line || "").trim();
    if (!s) return true;
    if (/^DESPESAS\s+PAGAS$/i.test(s)) return true;
    if (/^={3,}$|^-{3,}$|^\.{3,}$/.test(s)) return true;
    if (/raz[aã]o\s*social|detalhamento|n[ºo°]\s*documento|d[eé]bitos|^data\b/i.test(s) && !/REF\./i.test(s)) return true;
    if (/saldo\s*total|relat[oó]rio para simples|folha\s+\d|ag\.?\s*\/?\s*conta|hor[aá]rio\s*:/i.test(s)) return true;
    if (/empreendedora|loteadora|participa[cç][aã]o|ellenc/i.test(s) && !/REF\./i.test(s) && !/([\d.]+,\d{2})/.test(s)) return true;
    if (/^\d{1,2}:\d{2}(:\d{2})?\b/.test(s)) return true;
    if (/^(at[eé]|periodo|per[ií]odo)\b/i.test(s)) return true;
    // Cabeçalhos / linhas típicas do EXTRATO (não são DESPESAS PAGAS)
    if (/\bextrato\b|\bconcilia|\bmovimenta[cç][aã]o\s*banc/i.test(s)) return true;
    if (/^saldo\s+(anterior|atual|dispon|aplic)/i.test(s)) return true;
    if (/^(apl\.?\s*aplic|aplic\.?\s*aut|int\.?\s*aplic)/i.test(s)) return true;
    return false;
  },

  /** Credores/histórico típicos de extrato bancário — NÃO entram na matriz Ellenceo. */
  isBankStatementNoise(name, detalhe) {
    const blob = `${name || ""} ${detalhe || ""}`
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!blob) return true;
    // Tarifas do quadro DESPESAS PAGAS (TAR TED SISPAG, TAR PIX…) — não são extrato
    if (/^TAR(?:IFA)?\b/.test(blob) || /\bTAR\s+(?:TED|PIX|DOC|MANUT|SISPAG)\b/.test(blob)) return false;
    if (/\bSALDO\s+(APLIC|ANTERIOR|ATUAL|DISPON)/.test(blob)) return true;
    if (/\bAPL(\.|ICACAO|IC)?\s*(AUT|APLIC)/.test(blob)) return true;
    if (/\bINT\s*APLIC/.test(blob)) return true;
    if (/\bHIGHGRADE\b/.test(blob)) return true;
    if (/\bSISPAG\b/.test(blob) && !/\b(LTDA|EIRELI|S\.?\s?A\.?|TAR)\b/.test(blob) && !/\bREF\.?\b/.test(blob)) return true;
    if (/\bRECEBIMENTOS\s+RESERV/.test(blob)) return true;
    if (/^(TED|PIX|DOC)\b/.test(blob) && blob.length < 48 && !/\bREF\.?\b/.test(blob) && !/\bTAR\b/.test(blob)) return true;
    if (/\bEXTRATO\b|\bCONCILIACAO\b/.test(blob)) return true;
    return false;
  },

  isNoiseCredor(name) {
    const s = String(name || "").trim();
    if (!s || s === "(sem credor)") return true;
    if (this.isBankStatementNoise(s, "")) return true;
    if (/^\d{1,2}:\d{2}/.test(s)) return true;
    if (/^(at[eé]\s*\/?\s*\d{2,4}|hor[aá]rio)/i.test(s)) return true;
    if (/^folha\s+\d/i.test(s)) return true;
    if (/relat[oó]rio para simples/i.test(s)) return true;
    if (/^ag\.?\s*\/?\s*conta/i.test(s)) return true;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return true;
    if (/^[aàá]\s*\/\s*\d{4}\b/i.test(s)) return true; // lixo de quebra "A/2026 - PARA A EXECUÇÃO…"
    if (s.length < 3) return true;
    return false;
  },

  /**
   * Recorta SOMENTE o(s) quadro(s) "DESPESAS PAGAS" do PDF Ellenceo.
   * Ignora extrato da conta, aplicações, saldos e demais seções.
   */
  extractDespesasPagasText(rawText) {
    const raw = String(rawText || "").replace(/\r/g, "");
    if (!raw.trim()) return "";
    const re = /DESPESAS\s+PAGAS/gi;
    const starts = [];
    let m;
    while ((m = re.exec(raw)) !== null) starts.push(m.index);
    if (!starts.length) return "";

    const endRe = /Saldo\s*Total\b|\bEXTRATO\s*(BANC|\bDA\s*CONTA)?\b|\bMOVIMENTA[CÇ][AÃ]O\s*BANC|\bCONCILIA[CÇ][AÃ]O\b|\bRECEITAS\s+(RECEBIDAS|PAGAS)?\b|\bRECEBIMENTOS\b|\bSALDO\s+ANTERIOR\b/i;
    const parts = [];
    starts.forEach((start, idx) => {
      const hardEnd = starts[idx + 1] != null ? starts[idx + 1] : raw.length;
      let part = raw.slice(start, hardEnd);
      // Preferir corte no "Saldo Total" do próprio quadro de despesas
      const saldoIdx = part.search(/\n[ \t]*Saldo\s*Total\b/i);
      if (saldoIdx > 60) {
        part = part.slice(0, saldoIdx);
      } else {
        const endIdx = part.search(endRe);
        // "DESPESAS PAGAS" no início: não cortar no próprio título; achar após ~40 chars
        if (endIdx > 40) part = part.slice(0, endIdx);
      }
      // Remove qualquer trecho residual de extrato que tenha vazado
      part = part.split(/\n/).filter((line) => {
        const t = String(line || "").trim();
        if (!t) return false;
        if (/\bEXTRATO\b|\bCONCILIA/i.test(t)) return false;
        if (/^SALDO\s+(ANTERIOR|APLIC|ATUAL)/i.test(t) && !/REF\./i.test(t)) return false;
        return true;
      }).join("\n");
      if (part.trim().length > 40) parts.push(part);
    });
    return parts.join("\n");
  },

  /** Mês da coluna Data (dd/mm/aaaa). Não usa data solta no detalhe, tipo COFINS 08/2026. */
  paymentMonth(r) {
    const iso = String((r && r.iso) || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(0, 7);
    const d = this.normalizeBrDate((r && r.date) || "");
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}` : "";
  },

  /**
   * Mês do PDF = mês das datas do quadro DESPESAS PAGAS.
   * O nome do arquivo (ex.: 2026_10) não empurra setembro para outubro.
   */
  shownClosing(f) {
    if (!f) return "";
    const counts = {};
    (f.expenses || []).forEach((r) => {
      const k = this.paymentMonth(r);
      if (k) counts[k] = (counts[k] || 0) + 1;
    });
    let best = "";
    let n = 0;
    Object.keys(counts).forEach((k) => {
      if (counts[k] > n) { best = k; n = counts[k]; }
    });
    if (best) return best;
    if (f.closing && /^\d{4}-\d{2}$/.test(String(f.closing))) return String(f.closing);
    return this.periodFromFileName(f.name) || "";
  },

  expensePeriodKey(r) {
    const hit = (this.files || []).find((f) => f && f.name && r && r.sourceFile && f.name === r.sourceFile);
    if (hit) {
      const shown = this.shownClosing(hit);
      if (shown && /^\d{4}-\d{2}$/.test(shown)) return shown;
    }
    const pay = this.paymentMonth(r);
    if (pay) return pay;
    const stored = r && r.periodo;
    if (stored && /^\d{4}-\d{2}$/.test(String(stored))) return String(stored);
    const fromName = this.periodFromFileName(r && r.sourceFile);
    if (fromName && /^\d{4}-\d{2}$/.test(fromName)) return fromName;
    return "sem-periodo";
  },

  /** Corrige linhas antigas do cache em que o valor ficou colado no nome. */
  repairExpenseRow(row) {
    if (!row || typeof row !== "object") return row;
    let credor = String(row.credor || "");
    let detalhe = String(row.detalhe || "");
    let valor = Number(row.valor) || 0;
    let doc = String(row.doc || row.documento || "");
    const blob = `${credor} ${detalhe}`.trim();

    if (valor < 0.005) {
      const fromBlob = this.takeMoneyFromText(blob);
      if (fromBlob.valor > 0) {
        valor = fromBlob.valor;
        if (fromBlob.doc) doc = fromBlob.doc;
        const split = this.splitCredorDetalhe(fromBlob.rest);
        credor = split.credor;
        detalhe = split.detalhe || detalhe;
      }
    } else {
      const cleaned = this.takeMoneyFromText(credor);
      if (cleaned.rest) credor = cleaned.rest;
      if (cleaned.doc && !doc) doc = cleaned.doc;
      const cleanedDet = this.takeMoneyFromText(detalhe);
      if (cleanedDet.rest !== detalhe) detalhe = cleanedDet.rest;
      if (cleanedDet.doc && !doc) doc = cleanedDet.doc;
    }

    if (!detalhe && credor) {
      const split = this.splitCredorDetalhe(credor);
      credor = split.credor;
      detalhe = split.detalhe;
    }

    credor = this.normalizeCredorName(credor);
    if (this.isNoiseCredor(credor) && detalhe) {
      const split = this.splitCredorDetalhe(detalhe);
      if (!this.isNoiseCredor(split.credor)) {
        credor = this.normalizeCredorName(split.credor);
        detalhe = split.detalhe || detalhe;
      }
    }
    if (this.isBankStatementNoise(credor, detalhe)) {
      return Object.assign({}, row, { credor, detalhe, doc, valor: 0, categoria: "", categoriaId: "" });
    }
    const cat = this.categoryOf({ credor, detalhe });
    return Object.assign({}, row, {
      credor,
      detalhe,
      doc,
      valor,
      categoria: cat.name,
      categoriaId: cat.id
    });
  },

  /**
   * Layout Ellenceo DESPESAS PAGAS (não extrato):
   * Data | Razão Social (credor) | Detalhamento | Nº Documento | Débitos (valor)
   * Linhas do detalhe podem quebrar; montamos o bloco até achar o valor.
   * Aceita data dd/mm/aaaa ou dd/mm/aa (comum a partir de dez/2025).
   */
  parseExpenseLines(text, meta) {
    const chunk = this.extractDespesasPagasText(text);
    if (!chunk) {
      console.warn("[Participacoes] PDF sem quadro DESPESAS PAGAS — extrato/outras seções ignorados.", meta && meta.name);
      return [];
    }

    const lines = chunk.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
    const rows = [];
    const periodo = (meta && meta.closing) || this.periodFromFileName(meta && meta.name) || this.periodFromPdfHeader(text) || "";
    const sourceFile = (meta && meta.name) || "";

    let cur = null;
    let pendingPrefix = "";
    const flush = () => {
      if (!cur) return;
      const taken = this.takeMoneyFromText(cur.buf);
      // Só aceita lançamento com valor (evita rodapé "28/02/2026 13:26:11" virar credor)
      if (!(taken.valor > 0)) {
        cur = null;
        return;
      }
      const split = this.splitCredorDetalhe(taken.rest);
      let credor = this.normalizeCredorName(split.credor);
      let detalhe = split.detalhe;
      if (cur.extraDetalhe) {
        detalhe = (String(cur.extraDetalhe) + (detalhe ? " " + detalhe : "")).replace(/\s+/g, " ").trim();
      }
      if (this.isNoiseCredor(credor) || this.isBankStatementNoise(credor, detalhe)) {
        if (detalhe && !this.isNoiseCredor(detalhe) && !this.isBankStatementNoise(detalhe, "")) {
          credor = this.normalizeCredorName(detalhe);
          detalhe = "";
        } else {
          cur = null;
          return;
        }
      }
      if (this.isBankStatementNoise(credor, detalhe)) {
        cur = null;
        return;
      }
      const date = this.normalizeBrDate(cur.date);
      const iso = this.brDateToIso(date);
      rows.push(this.repairExpenseRow({
        date,
        iso,
        credor,
        detalhe,
        doc: taken.doc || "",
        valor: taken.valor,
        categoria: "",
        categoriaId: "",
        periodo: periodo || (iso ? iso.slice(0, 7) : ""),
        sourceFile
      }));
      cur = null;
    };

    lines.forEach((line) => {
      if (this.isExpenseNoiseLine(line)) return;
      if (/saldo\s*total/i.test(line)) {
        flush();
        pendingPrefix = "";
        return;
      }
      // Nova linha de lançamento: data no início (aaaa ou aa)
      const m = line.match(/^(\d{2}\/\d{2}\/\d{2,4})\b\s*(.*)$/);
      if (m) {
        flush();
        const rest = String(m[2] || "").trim();
        // Sobras de intervalo no detalhe: "a 31/10/2025)", "até 20/11/2025", só ")"
        if (!rest || /^[).,;:\-–—]*$/.test(rest)) {
          cur = null;
          pendingPrefix = "";
          return;
        }
        if (/^(at[eé]\b)/i.test(rest) || (/^(a|à)\s+\d{2}\/\d{2}\/\d{2,4}/i.test(rest) && !/([\d.]+,\d{2})/.test(rest))) {
          cur = null;
          pendingPrefix = "";
          return;
        }
        // Cabeçalho de período: "01/11/2025 até 30/11/2025" / segunda data sem valor
        if (/^\d{2}\/\d{2}\/\d{2,4}/.test(rest) && !/([\d.]+,\d{2})/.test(rest) && rest.length < 40) {
          cur = null;
          pendingPrefix = "";
          return;
        }
        // Linha tipicamente de extrato (aplicação / saldo) — descartar
        if (this.isBankStatementNoise(rest, "")) {
          cur = null;
          pendingPrefix = "";
          return;
        }
        const extra = pendingPrefix;
        pendingPrefix = "";
        cur = { date: this.normalizeBrDate(m[1]), buf: rest, extraDetalhe: extra };
        return;
      }
      // Continuação do detalhe / valor / nº doc
      if (cur) {
        // Buffer já tem doc+débito: pedaço "REF. …" solto é da próxima linha (PDF fora de ordem)
        if (this.isCompleteExpenseBuf(cur.buf) && /^(REF\.?|SOLICITA)/i.test(line)) {
          flush();
          pendingPrefix = line;
          return;
        }
        cur.buf = (cur.buf ? cur.buf + " " : "") + line;
        return;
      }
      if (/^(REF\.?|SOLICITA)/i.test(line)) {
        pendingPrefix = pendingPrefix ? (pendingPrefix + " " + line) : line;
      }
    });
    flush();
    return rows.filter((r) => Number(r.valor) > 0 && !this.isNoiseCredor(r.credor) && !this.isBankStatementNoise(r.credor, r.detalhe));
  },

  expenseDedupeKey(r) {
    const iso = String((r && r.iso) || this.brDateToIso(r && r.date) || "");
    const credor = this.credorGroupKey((r && r.credor) || "");
    const doc = String((r && (r.doc || r.documento)) || "").trim().toUpperCase();
    const valor = (Number(r && r.valor) || 0).toFixed(2);
    return `${iso}|${credor}|${doc}|${valor}`;
  },

  dedupeExpenseRows(rows) {
    return Array.isArray(rows) ? rows.slice() : [];
  },

  async extractPdfText(url) {
    const pdfjs = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
    if (!pdfjs) throw new Error("PDF.js não carregado. Atualize a página.");
    const pdf = await pdfjs.getDocument({ url, withCredentials: false }).promise;
    const pages = [];
    const yTol = 2.5;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = (content.items || []).map((it) => ({
        y: Number((it.transform && it.transform[5]) || 0),
        x: Number((it.transform && it.transform[4]) || 0),
        str: String(it.str || "")
      })).filter((t) => t.str);
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const bands = [];
      items.forEach((it) => {
        const last = bands[bands.length - 1];
        if (!last || Math.abs(last.y - it.y) > yTol) {
          bands.push({ y: it.y, cells: [it] });
        } else {
          last.cells.push(it);
          last.y = (last.y * (last.cells.length - 1) + it.y) / last.cells.length;
        }
      });
      pages.push(bands.map((band) => {
        const cells = band.cells.sort((a, b) => a.x - b.x);
        let line = "";
        let prevX = null;
        cells.forEach((t) => {
          const s = String(t.str || "");
          if (!s) return;
          if (prevX == null) {
            line = s;
          } else {
            const gap = t.x - prevX;
            line += gap > 18 ? "  " : (gap > 2 ? " " : "");
            line += s;
          }
          prevX = t.x + (s.length * 4);
        });
        return line.replace(/[ \t]+$/g, "").trim();
      }).filter(Boolean).join("\n"));
    }
    return pages.join("\n");
  },

  expensesMostlyBroken(expenses) {
    const list = Array.isArray(expenses) ? expenses : [];
    if (!list.length) return true;
    const repaired = list.map((r) => this.repairExpenseRow(r));
    const withVal = repaired.filter((r) => Number(r.valor) > 0).length;
    if (withVal / repaired.length < 0.45) return true;
    const noisy = repaired.filter((r) => this.isNoiseCredor(r.credor) || this.isBankStatementNoise(r.credor, r.detalhe)).length;
    if (repaired.length >= 8 && noisy / repaired.length > 0.2) return true;
    // Muitos "credores" de extrato = cache antigo lendo conta, não DESPESAS PAGAS
    const bankish = repaired.filter((r) => this.isBankStatementNoise(r.credor, r.detalhe)).length;
    if (repaired.length >= 5 && bankish / repaired.length > 0.12) return true;
    // Cache antigo sem dd/mm/aa
    const shortOrBadDate = repaired.filter((r) => {
      const d = String(r.date || "");
      return /^\d{2}\/\d{2}\/\d{2}$/.test(d) || !/^\d{2}\/\d{2}\/\d{4}$/.test(this.normalizeBrDate(d));
    }).length;
    if (repaired.length >= 3 && shortOrBadDate / repaired.length > 0.3) return true;
    return false;
  },

  expensesMismatchSaldo(fileRec) {
    const saldo = Number(fileRec && fileRec.saldoTotal) || 0;
    if (!(saldo > 0)) return false;
    const sum = (fileRec.expenses || []).reduce((s, r) => s + (Number(r.valor) || 0), 0);
    return Math.abs(sum - saldo) > Math.max(1, saldo * 0.008);
  },

  async ensureFileParsed(fileRec, force) {
    if (!fileRec) return;
    const needs = force
      || !Array.isArray(fileRec.expenses)
      || this.expensesMostlyBroken(fileRec.expenses)
      || this.expensesMismatchSaldo(fileRec)
      || fileRec.cacheVer !== 9;
    if (!needs && Array.isArray(fileRec.expenses) && fileRec.expenses.length) {
      fileRec.expenses = fileRec.expenses.map((r) => this.repairExpenseRow(r)).filter((r) => Number(r.valor) > 0 && !this.isNoiseCredor(r.credor) && !this.isBankStatementNoise(r.credor, r.detalhe));
      if (!this.expensesMostlyBroken(fileRec.expenses) && !this.expensesMismatchSaldo(fileRec)) return;
    }
    const url = this.fileLink(fileRec);
    const text = await this.extractPdfText(url);
    const headerPeriod = this.periodFromPdfHeader(text);
    const fromName = this.periodFromFileName(fileRec.name);
    fileRec.closing = headerPeriod || fromName || fileRec.closing || "";
    fileRec.saldoTotal = this.extractSaldoTotal(text);
    fileRec.expenses = this.parseExpenseLines(text, fileRec);
    fileRec.cacheVer = 9;
    this.persistCache(fileRec);
  },

  persistCache(fileRec) {
    try {
      const key = "crm_participacoes_cache_v9";
      const all = JSON.parse(localStorage.getItem(key) || "{}");
      const cid = String(fileRec.companyId || this.companyId || "");
      all[cid + "|" + fileRec.name] = {
        at: Date.now(),
        cacheVer: 9,
        closing: fileRec.closing,
        saldoTotal: fileRec.saldoTotal || null,
        expenses: fileRec.expenses
      };
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) {}
  },

  restoreCacheForCompany(companyId) {
    const cid = String(companyId || this.companyId || "");
    if (!cid) return;
    try {
      const keys = ["crm_participacoes_cache_v9", "crm_participacoes_cache_v8", "crm_participacoes_cache_v7", "crm_participacoes_cache_v6", "crm_participacoes_cache_v5", "crm_participacoes_cache_v4", "crm_participacoes_cache_v3", "crm_participacoes_cache_v2"];
      let all = {};
      keys.forEach((key) => {
        try {
          const chunk = JSON.parse(localStorage.getItem(key) || "{}") || {};
          Object.keys(chunk).forEach((k) => {
            if (!all[k]) all[k] = chunk[k];
          });
        } catch (e) {}
      });
      Object.keys(all).forEach((k) => {
        if (!k.startsWith(cid + "|")) return;
        const name = k.slice(cid.length + 1);
        const hit = all[k];
        if (!hit || !Array.isArray(hit.expenses)) return;
        // Só aceita cache v9 íntegro — versões antigas forçam reparse (dd/mm/aa + Saldo Total)
        if (hit.cacheVer !== 9 || this.expensesMostlyBroken(hit.expenses)) return;
        const repaired = hit.expenses.map((r) => this.repairExpenseRow(r)).filter((r) => Number(r.valor) > 0 && !this.isNoiseCredor(r.credor) && !this.isBankStatementNoise(r.credor, r.detalhe));
        if (this.expensesMostlyBroken(repaired)) return;
        const closing = hit.closing || this.periodFromFileName(name);
        const probe = { expenses: repaired, saldoTotal: hit.saldoTotal, closing };
        if (this.expensesMismatchSaldo(probe)) return;
        let rec = this.files.find((f) => String(f.companyId) === cid && f.name === name);
        if (!rec) {
          rec = {
            name,
            companyId: cid,
            closing,
            saldoTotal: hit.saldoTotal || null,
            expenses: repaired,
            cacheVer: 9,
            fromCache: true
          };
          this.files.push(rec);
        } else if (!rec.expenses || this.expensesMostlyBroken(rec.expenses) || rec.cacheVer !== 9) {
          rec.expenses = repaired;
          rec.saldoTotal = hit.saldoTotal || rec.saldoTotal;
          rec.cacheVer = 9;
          if (!rec.closing) rec.closing = closing;
          rec.companyId = cid;
        } else {
          rec.companyId = cid;
          rec.expenses = (rec.expenses || []).map((r) => this.repairExpenseRow(r)).filter((r) => Number(r.valor) > 0 && !this.isNoiseCredor(r.credor));
        }
      });
    } catch (e) {}
  },

  allExpenses() {
    const list = [];
    this.files.forEach((f) => {
      const filePeriod = f.closing || this.periodFromFileName(f.name);
      (f.expenses || []).forEach((r) => {
        const fixed = this.repairExpenseRow(r);
        if (!(Number(fixed.valor) > 0) || this.isNoiseCredor(fixed.credor) || this.isBankStatementNoise(fixed.credor, fixed.detalhe)) return;
        const sourceFile = fixed.sourceFile || f.name;
        const row = Object.assign({}, fixed, { sourceFile, companyId: String(f.companyId || "") });
        row.periodo = this.expensePeriodKey(row) || filePeriod || "";
        list.push(row);
      });
    });
    return list;
  },

  activeExpenses() {
    if (this.fileName) {
      const f = this.files.find((x) => this.fileKey(x) === this.fileName || x.name === this.fileName);
      const filePeriod = f && (f.closing || this.periodFromFileName(f.name));
      return (f && f.expenses) ? f.expenses.map((r) => {
        const row = Object.assign({}, this.repairExpenseRow(r), {
          sourceFile: r.sourceFile || (f && f.name) || "",
          companyId: String((f && f.companyId) || "")
        });
        row.periodo = this.expensePeriodKey(row) || filePeriod || "";
        return row;
      }).filter((r) => Number(r.valor) > 0 && !this.isNoiseCredor(r.credor) && !this.isBankStatementNoise(r.credor, r.detalhe)) : [];
    }
    return this.allExpenses();
  },

  alerts() {
    const rows = this.filtered();
    const out = [];
    rows.filter((r) => r.categoriaId === "relacionada").forEach((r) => {
      out.push({ level: "warn", text: `Parte relacionada: ${r.credor} — ${r.detalhe || "sem detalhe"} (${this.fmt(r.valor)}) em ${r.date}` });
    });
    const seen = {};
    rows.forEach((r) => {
      const k = `${r.iso}|${r.credor}|${r.detalhe}|${r.valor}`;
      seen[k] = (seen[k] || 0) + 1;
    });
    Object.keys(seen).forEach((k) => {
      if (seen[k] > 1) out.push({ level: "danger", text: `Lançamento repetido ${seen[k]}x: ${k.replace(/\|/g, " · ")}` });
    });
    const byCredor = {};
    rows.forEach((r) => {
      const k = this.credorGroupKey(r.credor) || r.credor;
      byCredor[k] = byCredor[k] || [];
      byCredor[k].push(r);
    });
    Object.keys(byCredor).forEach((key) => {
      const list = byCredor[key];
      const credorLabel = this.pickCredorLabel(list.map((r) => r.credor)) || key;
      if (list.length < 3) return;
      const vals = list.map((r) => r.valor).filter((v) => v > 0).sort((a, b) => a - b);
      if (vals.length < 3) return;
      const med = vals[Math.floor(vals.length / 2)];
      list.forEach((r) => {
        if (med > 0 && r.valor > med * 2.5) {
          out.push({ level: "danger", text: `Valor acima do padrão de ${credorLabel}: ${this.fmt(r.valor)} em ${r.date} (mediana ${this.fmt(med)})` });
        }
      });
    });
    return out;
  },

  filtered() {
    const q = String(this.q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return this.activeExpenses().filter((r) => {
      if (!q) return true;
      const blob = `${r.credor} ${r.detalhe} ${r.categoria} ${r.date} ${r.periodo || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return blob.includes(q);
    });
  },

  grouped() {
    const rows = this.filtered();
    const keyFn = {
      periodo: (r) => this.periodLabel(r.periodo, r.sourceFile || "Sem período"),
      credor: (r) => this.credorGroupKey(r.credor) || r.credor,
      categoria: (r) => r.categoria,
      data: (r) => r.date
    }[this.groupBy] || ((r) => this.credorGroupKey(r.credor) || r.credor);
    const map = {};
    rows.forEach((r) => {
      const k = keyFn(r) || "(em branco)";
      if (!map[k]) map[k] = { key: k, groupKey: k, rows: [], total: 0, _labels: [] };
      map[k].rows.push(r);
      map[k].total += Number(r.valor) || 0;
      map[k]._labels.push(r.credor);
    });
    return Object.values(map).map((g) => {
      if (this.groupBy === "credor" || !this.groupBy || this.groupBy === "matriz") {
        g.key = this.pickCredorLabel(g._labels) || g.key;
      }
      delete g._labels;
      return g;
    }).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  },

  /** Matriz: linhas = credor (agrupado), colunas = mês com DESPESAS PAGAS (só meses com valor). */
  matrixData() {
    const rows = this.filtered();
    const monthSet = new Set();
    const byKey = {};
    rows.forEach((r) => {
      const periodo = this.expensePeriodKey(r);
      if (!periodo || periodo === "sem-periodo" || !/^\d{4}-\d{2}$/.test(periodo)) return;
      const key = this.credorGroupKey(r.credor) || "(sem credor)";
      monthSet.add(periodo);
      if (!byKey[key]) byKey[key] = { key, cells: {}, total: 0, _labels: [] };
      byKey[key]._labels.push(r.credor);
      if (!byKey[key].cells[periodo]) byKey[key].cells[periodo] = { total: 0, rows: [] };
      const cell = byKey[key].cells[periodo];
      cell.total += Number(r.valor) || 0;
      cell.rows.push(r);
      byKey[key].total += Number(r.valor) || 0;
    });
    const months = Array.from(monthSet).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort((a, b) => String(a).localeCompare(String(b)));
    const creditors = Object.values(byKey).map((c) => ({
      credor: this.pickCredorLabel(c._labels) || c.key,
      groupKey: c.key,
      cells: c.cells,
      total: c.total
    })).sort((a, b) => b.total - a.total || a.credor.localeCompare(b.credor, "pt-BR"));
    const colTotals = {};
    months.forEach((m) => {
      colTotals[m] = creditors.reduce((s, c) => s + ((c.cells[m] && c.cells[m].total) || 0), 0);
    });
    // Remove colunas zeradas (arquivos sem DESPESAS PAGAS / não parseados)
    const monthsWithValue = months.filter((m) => (colTotals[m] || 0) > 0.004);
    const grand = creditors.reduce((s, c) => s + c.total, 0);
    const saldoChecks = [];
    (this.files || []).forEach((f) => {
      const p = this.shownClosing(f) || f.closing || this.periodFromFileName(f.name);
      if (!p || !monthsWithValue.includes(p)) return;
      const saldo = Number(f.saldoTotal) || 0;
      if (!(saldo > 0)) return;
      const got = colTotals[p] || 0;
      if (Math.abs(got - saldo) > Math.max(1, saldo * 0.008)) {
        saldoChecks.push({ periodo: p, saldo, got });
      }
    });
    return { months: monthsWithValue, creditors, colTotals, grand, saldoChecks };
  },

  captureScroll() {
    const parents = [];
    let el = document.getElementById("participacoes-root");
    while (el) {
      el = el.parentElement;
      if (!el) break;
      parents.push({ el: el, top: el.scrollTop || 0 });
    }
    const matrix = document.getElementById("part-matrix-scroll");
    const groupsBox = document.getElementById("part-groups-scroll");
    return {
      parents: parents,
      matrixTop: matrix ? matrix.scrollTop : 0,
      matrixLeft: matrix ? matrix.scrollLeft : 0,
      groupsTop: groupsBox ? groupsBox.scrollTop : 0,
      win: window.scrollY || document.documentElement.scrollTop || 0
    };
  },

  restoreScroll(saved) {
    if (!saved) return;
    const apply = () => {
      (saved.parents || []).forEach((item) => {
        if (item.el) item.el.scrollTop = item.top || 0;
      });
      const matrix = document.getElementById("part-matrix-scroll");
      if (matrix) {
        matrix.scrollTop = saved.matrixTop || 0;
        matrix.scrollLeft = saved.matrixLeft || 0;
      }
      const groupsBox = document.getElementById("part-groups-scroll");
      if (groupsBox) groupsBox.scrollTop = saved.groupsTop || 0;
      window.scrollTo(0, saved.win || 0);
    };
    apply();
    requestAnimationFrame(apply);
  },

  ensureAvaliar() {
    if (this.avaliar) return;
    try {
      this.avaliar = JSON.parse(localStorage.getItem("crm_ellenceo_avaliar") || "{}") || {};
    } catch (e) {
      this.avaliar = {};
    }
    if (!this.avaliar || typeof this.avaliar !== "object") this.avaliar = {};
  },

  avaliarStorageKey(groupKey) {
    return this.chosenCompanyIds().join(",") + "|" + String(groupKey || "");
  },

  avaliarEntry(groupKey) {
    this.ensureAvaliar();
    return this.avaliar[this.avaliarStorageKey(groupKey)] || null;
  },

  saveAvaliar() {
    try { localStorage.setItem("crm_ellenceo_avaliar", JSON.stringify(this.avaliar || {})); } catch (e) {}
  },

  setAvaliar(groupEnc, on) {
    let groupKey = groupEnc;
    try { groupKey = decodeURIComponent(groupEnc); } catch (e) {}
    const key = this.avaliarStorageKey(groupKey);
    this.ensureAvaliar();
    const prev = this.avaliar[key] || {};
    if (on) this.avaliar[key] = { on: true, duvida: prev.duvida || "" };
    else delete this.avaliar[key];
    this.saveAvaliar();
    this.render();
  },

  setDuvida(groupEnc, text) {
    let groupKey = groupEnc;
    try { groupKey = decodeURIComponent(groupEnc); } catch (e) {}
    const key = this.avaliarStorageKey(groupKey);
    this.ensureAvaliar();
    const prev = this.avaliar[key];
    if (!prev || !prev.on) return;
    prev.duvida = String(text || "");
    this.saveAvaliar();
  },

  openMatrixDetail(credorEnc, periodo) {
    let credor = credorEnc;
    try { credor = decodeURIComponent(credorEnc); } catch (e) {}
    this.detail = {
      credor: String(credor || ""),
      groupKey: this.credorGroupKey(credor),
      periodo: periodo ? String(periodo) : ""
    };
    this.render();
  },

  closeMatrixDetail() {
    this.detail = null;
    this.render();
  },

  detailRows() {
    if (!this.detail) return [];
    const { credor, periodo, groupKey } = this.detail;
    const key = groupKey || this.credorGroupKey(credor);
    return this.filtered().filter((r) => {
      if (this.credorGroupKey(r.credor) !== key) return false;
      if (!periodo) return true;
      return String(this.expensePeriodKey(r)) === String(periodo);
    }).sort((a, b) => String(a.iso || a.date).localeCompare(String(b.iso || b.date)));
  },

  matrixHtml() {
    const mx = this.matrixData();
    if (!mx.creditors.length) return "";
    const shortMonth = (ym) => {
      const lab = this.periodLabel(ym, ym);
      const parts = String(lab).split(" ");
      if (parts.length >= 3) return `${parts[0].slice(0, 3)}/${parts[2]}`;
      return lab;
    };
    // A conferência com o "Saldo Total" do PDF não aparece mais na tela: o saldo acumulado do PDF não bate
    // mês a mês com a soma lida e a faixa só atrapalhava a leitura da matriz.
    return `
      <div class="part-matrix-wrap">
        <div id="part-matrix-scroll" class="part-matrix-scroll">
          <table class="part-matrix-table">
            <thead>
              <tr>
                <th class="part-matrix-sticky" title="Marque a caixa para incluir o credor no PPT. Clique no nome para ver todos os lançamentos e no valor para ver só aquele mês.">
                  <span class="part-th-credor"><i data-lucide="presentation" style="width:12px;height:12px;"></i> Credor</span>
                </th>
                ${mx.months.map((m) => `<th title="${this.esc(this.periodLabel(m, m))}">${this.esc(shortMonth(m))}</th>`).join("")}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${mx.creditors.map((c) => {
                const enc = encodeURIComponent(c.credor);
                const flagEnc = encodeURIComponent(c.groupKey);
                const flagged = this.avaliarEntry(c.groupKey);
                return `<tr class="${this.detail && this.detail.groupKey === c.groupKey ? "is-on" : ""}">
                  <td class="part-matrix-sticky part-matrix-credor" title="Ver todos os lançamentos de ${this.esc(c.credor)}">
                    <div class="part-credor-line">
                      <label class="part-avaliar" title="Avaliar: incluir este credor no PPT">
                        <input type="checkbox" ${flagged ? "checked" : ""} onclick="event.stopPropagation()" onchange="ParticipacoesApp.setAvaliar('${flagEnc}', this.checked)">
                      </label>
                      <button type="button" class="part-matrix-credor-btn" title="${this.esc(c.credor)}" onclick="ParticipacoesApp.openMatrixDetail('${enc}','')">${this.esc(c.credor)}</button>
                    </div>
                    ${flagged ? `<input class="part-duvida" placeholder="Dúvida para o slide" value="${this.esc(flagged.duvida || "")}" oninput="ParticipacoesApp.setDuvida('${flagEnc}', this.value)">` : ""}
                  </td>
                  ${mx.months.map((m) => {
                    const cell = c.cells[m];
                    if (!cell || !cell.total) {
                      return `<td class="part-matrix-empty">—</td>`;
                    }
                    const n = cell.rows.length;
                    return `<td class="part-matrix-cell">
                      <button type="button" class="part-matrix-btn" onclick="ParticipacoesApp.openMatrixDetail('${enc}','${this.esc(m)}')" title="${n} lançamento(s) — clique para detalhar">
                        <span class="part-matrix-val">${this.fmt(cell.total)}</span>
                        ${n > 1 ? `<span class="part-matrix-n">${n}</span>` : ""}
                      </button>
                    </td>`;
                  }).join("")}
                  <td class="part-matrix-total">${this.fmt(c.total)}</td>
                </tr>`;
              }).join("")}
            </tbody>
            <tfoot>
              <tr>
                <td class="part-matrix-sticky">Total</td>
                ${mx.months.map((m) => `<td class="part-matrix-total">${mx.colTotals[m] ? this.fmt(mx.colTotals[m]) : "—"}</td>`).join("")}
                <td class="part-matrix-total">${this.fmt(mx.grand)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  },

  detailModalHtml() {
    if (!this.detail) return "";
    const rows = this.detailRows();
    const total = rows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const periodoLab = this.detail.periodo
      ? this.periodLabel(this.detail.periodo, this.detail.periodo)
      : "Todos os períodos";
    return `
      <div id="part-detail-modal" class="part-detail-overlay" onclick="if(event.target===this)ParticipacoesApp.closeMatrixDetail()">
        <div class="part-detail-panel" role="dialog" aria-modal="true">
          <header>
            <div>
              <h3>${this.esc(this.detail.credor)}</h3>
              <div class="part-detail-sub">${this.esc(periodoLab)} · ${rows.length} lançamento(s) · <strong>${this.fmt(total)}</strong></div>
            </div>
            <button type="button" class="btn btn-fechar" onclick="ParticipacoesApp.closeMatrixDetail()">Fechar</button>
          </header>
          <div class="part-detail-body">
            ${rows.length ? `
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Período</th>
                    <th>Detalhe</th>
                    <th>Categoria</th>
                    <th style="text-align:right;">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((r) => `<tr style="${r.categoriaId === "relacionada" ? "background:#fff7ed;" : ""}">
                    <td style="white-space:nowrap;">${this.esc(r.date)}</td>
                    <td style="white-space:nowrap;text-transform:capitalize;">${this.esc(this.periodLabel(r.periodo, "—"))}</td>
                    <td>${this.esc(r.detalhe || "—")}</td>
                    <td>${this.esc(r.categoria)}</td>
                    <td style="text-align:right;font-weight:700;">${r.valor ? this.fmt(r.valor) : "—"}</td>
                  </tr>`).join("")}
                </tbody>
              </table>
            ` : `<div style="padding:24px;text-align:center;color:#64748b;">Nenhum lançamento neste filtro.</div>`}
          </div>
        </div>
      </div>
    `;
  },

  async parseAllFiles() {
    const fails = [];
    for (const f of this.files) {
      try {
        await this.ensureFileParsed(f, f.cacheVer !== 9);
      } catch (e) {
        fails.push((f && f.name ? f.name : "PDF") + ": " + (e.message || e));
      }
    }
    if (fails.length) {
      this.error = "Falha ao ler " + fails.length + " PDF(s). Os demais períodos foram carregados.\n" + fails.slice(0, 4).join("\n");
    }
  },

  async onCompany(id) {
    this.companyPickerOpen = false;
    await this.setCompanies(id ? [id] : []);
  },

  async setCompanies(ids) {
    const allowed = new Set(this.elencoCompanies().map((c) => String(c.id)));
    const next = [];
    (ids || []).forEach((id) => {
      const s = String(id || "");
      if (s && allowed.has(s) && next.indexOf(s) < 0) next.push(s);
    });
    this.companyIds = next;
    this.companyId = next.length === 1 ? next[0] : "";
    this.fileName = "";
    this.files.forEach((f) => {
      if (f.objectUrl) {
        try { URL.revokeObjectURL(f.objectUrl); } catch (e) {}
      }
    });
    this.files = [];
    this.error = "";
    this.refreshCompanyList();
    if (!next.length) {
      this.loading = false;
      this.parsing = false;
      this.uploadProgress = "";
      this.pararCarga();
      this.render();
      return;
    }
    const gen = (this._empGen = (this._empGen || 0) + 1);
    this.loading = true;
    this.uploadProgress = next.length > 1 ? "Buscando os períodos das empresas…" : "Buscando os períodos…";
    this._cargaPct = 18;
    this.render();
    this.iniciarCarga();
    for (let i = 0; i < next.length; i++) {
      if (gen !== this._empGen) return;
      this.restoreCacheForCompany(next[i]);
      await this.mergeCloudPeriods(next[i]);
      await this.loadFilesFromServer(next[i]);
      this._cargaPct = 18 + Math.round(40 * ((i + 1) / next.length));
    }
    if (gen !== this._empGen) return;
    this.loading = false;
    this.fileName = "";
    this.parsing = true;
    this.uploadProgress = "Lendo os períodos…";
    this._cargaPct = 62;
    this.render();
    await this.parseAllFiles();
    if (gen !== this._empGen) return;
    this.parsing = false;
    this.uploadProgress = "";
    this.pararCarga();
    this.render();
  },

  async onFile(key) {
    this.fileName = key;
    const rec = this.files.find((f) => this.fileKey(f) === key || f.name === key);
    if (!rec) return;
    this.parsing = true;
    this.error = "";
    this.uploadProgress = "Lendo o período…";
    this._cargaPct = 36;
    this.render();
    this.iniciarCarga();
    try {
      await this.ensureFileParsed(rec);
    } catch (e) {
      this.error = "Não foi possível ler o PDF: " + (e.message || e);
    }
    this.parsing = false;
    this.uploadProgress = "";
    this.pararCarga();
    this.render();
  },

  onPeriodoSelect(idx) {
    const f = idx === "" ? null : this.files[Number(idx)];
    if (f) this.onFile(this.fileKey(f));
    else this.onFileAll();
  },

  async onFileAll() {
    this.fileName = "";
    this.parsing = true;
    this.error = "";
    this.uploadProgress = "Lendo os períodos…";
    this._cargaPct = 32;
    this.render();
    this.iniciarCarga();
    await this.parseAllFiles();
    this.parsing = false;
    this.uploadProgress = "";
    this.pararCarga();
    this.groupBy = "matriz";
    this.render();
  },

  async tryServerUpload(fileList) {
    const fd = new FormData();
    fd.append("companyId", this.companyId);
    fd.append("companyLabel", this.companyLabel(this.companyId) || "");
    fileList.forEach((file) => fd.append("file", file, file.name));
    const res = await fetch(this.apiUrl("/api/participacoes/upload"), { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Falha no upload no servidor");
    return data;
  },

  async onUpload(input) {
    const picked = Array.from((input && input.files) || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!this.companyId) {
      this.error = "Selecione a empresa antes de enviar os PDFs.";
      this.render();
      if (input) input.value = "";
      return;
    }
    if (!picked.length) {
      this.error = "Selecione um ou mais arquivos PDF.";
      this.render();
      if (input) input.value = "";
      return;
    }
    this.loading = true;
    this.parsing = true;
    this.error = "";
    this.uploadProgress = "Enviando os PDFs…";
    this._cargaPct = 14;
    this.render();
    this.iniciarCarga();

    let serverOk = false;
    try {
      await this.tryServerUpload(picked);
      serverOk = true;
    } catch (e) {
      serverOk = false;
    }

    try {
      for (let i = 0; i < picked.length; i++) {
        const file = picked[i];
        this.setCarga("Lendo os PDFs…", 30 + (i / picked.length) * 36);
        const objectUrl = URL.createObjectURL(file);
        const text = await this.extractPdfText(objectUrl);
        let closing = this.periodFromPdfHeader(text) || this.periodFromFileName(file.name);
        const ym = closing ? closing.split("-") : [];
        const expenses = this.parseExpenseLines(text, { name: file.name, closing });

        // Reenvio do mesmo período: sobrescreve
        if (closing) this.removeFilesForPeriod(closing, file.name);

        let rec = this.files.find((f) => String(f.companyId) === String(this.companyId) && f.name === file.name);
        if (rec && rec.objectUrl && rec.objectUrl !== objectUrl) {
          try { URL.revokeObjectURL(rec.objectUrl); } catch (e) {}
        }
        if (!rec) {
          rec = { name: file.name, companyId: String(this.companyId) };
          this.files.push(rec);
        }
        rec.companyId = String(this.companyId);
        rec.size = file.size;
        rec.closing = closing;
        rec.year = ym[0] ? Number(ym[0]) : null;
        rec.month = ym[1] ? Number(ym[1]) : null;
        rec.objectUrl = objectUrl;
        rec.expenses = expenses;
        rec.saldoTotal = this.extractSaldoTotal(text);
        rec.cacheVer = 9;
        rec.fromUpload = true;

        this.cloudSyncing = true;
        this.setCarga("Salvando no Firebase…", 70 + (i / picked.length) * 18);
        try {
          const up = await this.uploadPdfToFirebase(file, this.companyId, closing || "sem-periodo");
          rec.pdfUrl = up.url || "";
          rec.pdfPath = up.path || "";
          await this.savePeriodToFirebase(rec, this.companyId);
        } catch (cloudErr) {
          console.warn("[Participacoes] Falha ao salvar no Firebase:", cloudErr);
          this.hint = "Dados lidos neste navegador; falhou o envio ao Firebase: " + (cloudErr && cloudErr.message ? cloudErr.message : cloudErr);
        }
        this.cloudSyncing = false;
        this.persistCache(rec);
      }
      this.files.sort((a, b) => String(b.closing || "").localeCompare(String(a.closing || "")) || b.name.localeCompare(a.name));
      this.fileName = "";
      this.groupBy = "matriz";
      if (serverOk) await this.loadFilesFromServer();
    } catch (e) {
      this.error = e.message || String(e);
    }

    this.loading = false;
    this.parsing = false;
    this.uploadProgress = "";
    this.pararCarga();
    if (input) input.value = "";
    this.render();
  },

  async ensureExcelJS() {
    if (window.ExcelJS) return window.ExcelJS;
    if (window.InvestimentoApp && typeof InvestimentoApp.ensureExcelJS === "function") {
      return InvestimentoApp.ensureExcelJS();
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Falha ao carregar ExcelJS"));
      document.head.appendChild(s);
    });
    return window.ExcelJS;
  },

  excelSheetName(companyId, used) {
    const usual = String(this.companyLabel(companyId) || "").replace(/[:\\/?*\[\]]/g, " ").replace(/\s+/g, " ").trim();
    let base = `${companyId}-${usual || "EMPRESA"}`;
    if (base.length > 31) base = base.slice(0, 31);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suf = `-${n++}`;
      name = (base.slice(0, Math.max(1, 31 - suf.length)) + suf).slice(0, 31);
    }
    used.add(name.toLowerCase());
    return name;
  },

  monthShort(closing) {
    const [y, m] = String(closing || "").split("-");
    if (!y || !m) return closing || "";
    const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${names[Number(m) - 1]}/${y}`;
  },

  fillParticipacoesSheet(ws, opts) {
    const Inv = window.InvestimentoApp;
    const paint = Inv && typeof Inv.excelPaint === "function"
      ? (cell, o) => Inv.excelPaint(cell, o)
      : (cell, o) => {
          if (o.font) cell.font = Object.assign({ name: "Calibri", size: 9 }, o.font);
          if (o.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.fill } };
          if (o.align) cell.alignment = o.align;
          if (o.numFmt) cell.numFmt = o.numFmt;
          if (o.border) {
            const s = { style: "thin", color: { argb: "FFE2E8F0" } };
            cell.border = { top: s, bottom: s, left: s, right: s };
          }
        };
    const moneyFmt = "#,##0.00";
    const months = opts.months || [];
    const creditors = opts.creditors || [];
    const companyLabel = opts.companyLabel || "";
    const subtitle = opts.subtitle || "";

    ws.properties.showGridLines = false;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4, topLeftCell: "B5", activeCell: "B5", showGridLines: false }];
    ws.columns = [{ width: 42 }, ...months.map(() => ({ width: 14 })), { width: 14 }];

    ws.mergeCells(1, 1, 2, 1);
    ws.getRow(1).height = 22;
    ws.getRow(2).height = 18;
    const title = ws.getCell("A1");
    title.value = {
      richText: [
        { font: { name: "Calibri", size: 13, bold: true, color: { argb: "FF0F172A" } }, text: "Prestação de Contas — DESPESAS PAGAS\n" },
        { font: { name: "Calibri", size: 9, color: { argb: "FF64748B" } }, text: `${companyLabel}${subtitle ? " · " + subtitle : ""}` }
      ]
    };
    paint(title, { fill: "FFFFFFFF", align: { vertical: "middle", horizontal: "left", wrapText: true } });

    const head = ws.getRow(4);
    head.height = 20;
    const heads = ["Credor", ...months.map((m) => this.monthShort(m)), "Total"];
    heads.forEach((h, i) => {
      const cell = head.getCell(i + 1);
      cell.value = h;
      paint(cell, {
        fill: "FF105436",
        font: { bold: true, size: 9, color: { argb: "FFFFFFFF" } },
        align: { horizontal: i === 0 ? "left" : "right", vertical: "middle" },
        border: true
      });
    });

    let rIdx = 5;
    creditors.forEach((c) => {
      const row = ws.getRow(rIdx++);
      row.getCell(1).value = c.label || c.key;
      paint(row.getCell(1), { border: true, align: { horizontal: "left" } });
      months.forEach((m, i) => {
        const cell = row.getCell(i + 2);
        const v = (c.cells[m] && c.cells[m].total) || 0;
        cell.value = v || null;
        paint(cell, { border: true, align: { horizontal: "right" }, numFmt: moneyFmt });
      });
      const tot = row.getCell(months.length + 2);
      tot.value = c.total || 0;
      paint(tot, {
        border: true,
        align: { horizontal: "right" },
        numFmt: moneyFmt,
        font: { bold: true }
      });
    });

    const totRow = ws.getRow(rIdx);
    totRow.getCell(1).value = "Total";
    paint(totRow.getCell(1), { fill: "FFF1F5F9", font: { bold: true }, border: true });
    months.forEach((m, i) => {
      const sum = creditors.reduce((s, c) => s + ((c.cells[m] && c.cells[m].total) || 0), 0);
      const cell = totRow.getCell(i + 2);
      cell.value = sum;
      paint(cell, { fill: "FFF1F5F9", font: { bold: true }, border: true, align: { horizontal: "right" }, numFmt: moneyFmt });
    });
    const grand = creditors.reduce((s, c) => s + (c.total || 0), 0);
    const gCell = totRow.getCell(months.length + 2);
    gCell.value = grand;
    paint(gCell, { fill: "FFF1F5F9", font: { bold: true }, border: true, align: { horizontal: "right" }, numFmt: moneyFmt });

    // Aba de lançamentos no mesmo sheet abaixo? Better separate sheet - caller adds detail sheet
    return { grand };
  },

  fillLancamentosSheet(ws, rows, companyLabel) {
    const Inv = window.InvestimentoApp;
    const paint = Inv && typeof Inv.excelPaint === "function"
      ? (cell, o) => Inv.excelPaint(cell, o)
      : (cell, o) => {
          if (o.font) cell.font = Object.assign({ name: "Calibri", size: 9 }, o.font);
          if (o.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.fill } };
          if (o.align) cell.alignment = o.align;
          if (o.numFmt) cell.numFmt = o.numFmt;
          if (o.border) {
            const s = { style: "thin", color: { argb: "FFE2E8F0" } };
            cell.border = { top: s, bottom: s, left: s, right: s };
          }
        };
    ws.properties.showGridLines = false;
    ws.columns = [
      { width: 12 }, { width: 14 }, { width: 36 }, { width: 48 }, { width: 22 }, { width: 32 }, { width: 14 }, { width: 10 }
    ];
    ws.getCell("A1").value = `Lançamentos — ${companyLabel}`;
    paint(ws.getCell("A1"), { font: { bold: true, size: 12 }, fill: "FFFFFFFF" });
    ws.mergeCells("A1:H1");
    const heads = ["Data", "Período", "Credor", "Detalhe", "Categoria Ellenco", "Categoria Moura Leite", "Valor", "Doc"];
    const head = ws.getRow(3);
    heads.forEach((h, i) => {
      const cell = head.getCell(i + 1);
      cell.value = h;
      paint(cell, {
        fill: "FF105436",
        font: { bold: true, size: 9, color: { argb: "FFFFFFFF" } },
        border: true
      });
    });
    (rows || []).forEach((r, idx) => {
      const row = ws.getRow(4 + idx);
      row.getCell(1).value = r.date || "";
      row.getCell(2).value = this.periodLabel(r.periodo, r.periodo || "");
      row.getCell(3).value = r.credor || "";
      row.getCell(4).value = r.detalhe || "";
      row.getCell(5).value = r.categoria || "";
      row.getCell(6).value = this.catMlDaLinha(r);
      row.getCell(7).value = Number(r.valor) || 0;
      row.getCell(8).value = r.doc || "";
      for (let c = 1; c <= 8; c++) {
        paint(row.getCell(c), {
          border: true,
          align: { horizontal: c === 7 ? "right" : "left", wrapText: c === 4 },
          numFmt: c === 7 ? "#,##0.00" : undefined
        });
      }
    });
  },

  async ensurePptx() {
    if (window.PptxGenJS) return window.PptxGenJS;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Falha ao carregar o gerador de PPT"));
      document.head.appendChild(s);
    });
    return window.PptxGenJS;
  },

  addAvaliarSlide(pptx, ctx) {
    const slide = pptx.addSlide();
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: "105436" } });
    slide.addShape(pptx.ShapeType.rect, { x: 0.18, y: 0, w: 0.08, h: 7.5, fill: { color: "F37021" } });
    slide.addText(ctx.company, {
      x: 0.48, y: 0.18, w: 10.6, h: 0.42,
      fontFace: "Calibri", fontSize: 22, bold: true, color: "F37021", margin: 0
    });
    slide.addText([
      { text: "Fornecedor: ", options: { bold: true } },
      { text: ctx.credorName, options: { bold: true, breakLine: true } },
      { text: "Valor acumulado: ", options: { bold: true } },
      { text: this.fmt(ctx.totalCredor), options: { bold: true, breakLine: true } },
      { text: "Dúvida: ", options: { bold: true } },
      { text: ctx.duvida || "—", options: { bold: true } }
    ], {
      x: 0.48, y: 0.72, w: 12.1, h: 1.15,
      fontFace: "Calibri", fontSize: 16, color: "0F172A", margin: 0
    });
    slide.addText([
      { text: "Resposta: ", options: { bold: true, color: "105436" } },
      { text: " ", options: { color: "0F172A" } }
    ], {
      shape: pptx.ShapeType.roundRect,
      x: 0.48, y: 1.98, w: 12.4, h: 1.05,
      rectRadius: 0.06,
      fill: { color: "FFFFFF" },
      line: { color: "F37021", pt: 1.25, dashType: "dash" },
      fontFace: "Calibri", fontSize: 14, color: "0F172A",
      valign: "top", align: "left", margin: [8, 12, 8, 12]
    });

    const allRows = ctx.rows || [];
    const total = allRows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const nomeMes = (m) => {
      const lab = this.periodLabel(m, m);
      return lab.charAt(0).toUpperCase() + lab.slice(1);
    };
    const meses = ctx.months || [];
    const periodo = !meses.length ? "" : (meses.length === 1 ? nomeMes(meses[0]) : nomeMes(meses[0]) + " a " + nomeMes(meses[meses.length - 1]));

    const CARD_Y = 3.2;
    const TABLE_Y = CARD_Y + 0.72;
    const TABLE_H = 7.18 - TABLE_Y;
    const MIN_ROW_H = 0.16;
    const maxLinhas = Math.floor(TABLE_H / MIN_ROW_H) - 1;

    /* Uma página por credor: com muitos lançamentos, agrupa por mês e categoria (e depois só por mês) para caber. */
    let linhas = allRows.map((r) => ({ data: r.date, detalhe: r.detalhe || "—", categoria: r.categoria || "Outras", valor: Number(r.valor) || 0 }));
    let nota = "";
    const agrupar = (chave) => {
      const map = new Map();
      allRows.forEach((r) => {
        const k = chave(r);
        const g = map.get(k) || { data: nomeMes(r._mes), detalhe: "", categoria: r.categoria || "Outras", valor: 0, qtd: 0 };
        g.valor += Number(r.valor) || 0;
        g.qtd += 1;
        map.set(k, g);
      });
      return Array.from(map.values()).map((g) => Object.assign(g, { detalhe: g.qtd + " lançamento(s)" }));
    };
    if (linhas.length > maxLinhas) {
      linhas = agrupar((r) => r._mes + "|" + (r.categoria || "Outras"));
      nota = " · agrupado por mês e categoria";
      if (linhas.length > maxLinhas) {
        linhas = agrupar((r) => r._mes).map((g) => Object.assign(g, { categoria: "—" }));
        nota = " · agrupado por mês";
      }
    }

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.48, y: CARD_Y, w: 12.4, h: 7.3 - CARD_Y,
      fill: { color: "F0FDF4" },
      line: { color: "D1FAE5", pt: 1 },
      rectRadius: 0.06
    });
    slide.addText(ctx.credorName, {
      x: 0.68, y: CARD_Y + 0.1, w: 11.9, h: 0.3,
      fontFace: "Calibri", fontSize: 13, bold: true, color: "166534", margin: 0
    });
    slide.addText([periodo, allRows.length + " lançamento(s)", this.fmt(total)].filter(Boolean).join(" · ") + nota, {
      x: 0.68, y: CARD_Y + 0.4, w: 11.9, h: 0.26,
      fontFace: "Calibri", fontSize: 11, color: "64748B", margin: 0
    });

    const rowH = Math.min(0.3, TABLE_H / (linhas.length + 1));
    const fonte = Math.max(7, Math.min(12, Math.round(rowH * 40)));
    const head = (text, align) => ({
      text: text,
      options: { fill: { color: "F8FAFC" }, color: "64748B", bold: true, align: align || "left", fontSize: Math.min(10, fonte) }
    });
    const cell = (text, align, bold) => ({
      text: String(text || "—"),
      options: { fill: { color: "FFFFFF" }, color: "0F172A", align: align || "left", bold: !!bold, fontSize: fonte }
    });
    const tableRows = [[head(nota ? "MÊS" : "DATA"), head("DETALHE"), head("CATEGORIA"), head("VALOR", "right")]];
    linhas.forEach((r) => {
      tableRows.push([cell(r.data), cell(r.detalhe), cell(r.categoria), cell(this.fmt(r.valor), "right", true)]);
    });
    slide.addTable(tableRows, {
      x: 0.68, y: TABLE_Y, w: 12.0,
      colW: [1.7, 6.1, 2.2, 2.0],
      rowH: rowH,
      margin: rowH < 0.25 ? [1, 5, 1, 5] : [3, 6, 3, 6],
      border: [
        { pt: 0.4, color: "E2E8F0" },
        { pt: 0.4, color: "E2E8F0" },
        { pt: 0.4, color: "E2E8F0" },
        { pt: 0.4, color: "E2E8F0" }
      ],
      fontFace: "Calibri",
      valign: "middle",
      autoPage: false
    });
  },

  async exportPpt() {
    const mx = this.matrixData();
    const picked = mx.creditors.filter((c) => this.avaliarEntry(c.groupKey));
    if (!picked.length) {
      alert("Marque Avaliar em pelo menos um credor.");
      return;
    }
    let PptxGenJS;
    try {
      PptxGenJS = await this.ensurePptx();
    } catch (e) {
      alert("Não foi possível carregar o gerador de PPT. Recarregue a página.");
      return;
    }
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
    pptx.layout = "WIDE";
    pptx.author = "CRM Moura Leite";
    pptx.title = "Prestação de contas — avaliar";
    const escolhidas = this.chosenCompanyIds();
    const company = escolhidas.length === 1
      ? String((this.crmCompany(escolhidas[0]) && this.crmCompany(escolhidas[0]).name) || this.companyLabel(escolhidas[0]) || "Empresa").toUpperCase()
      : "TODAS AS EMPRESAS";
    const dataNum = (d) => {
      const p = String(d || "").split("/");
      return p.length === 3 ? p[2] + p[1].padStart(2, "0") + p[0].padStart(2, "0") : String(d || "");
    };
    const nomeEmpresa = (cid) => String((this.crmCompany(cid) && this.crmCompany(cid).name) || this.companyLabel(cid) || company).toUpperCase();
    picked.forEach((c) => {
      const entry = this.avaliarEntry(c.groupKey) || {};
      const months = mx.months.filter((m) => c.cells[m] && (c.cells[m].rows || []).length);
      const rows = [];
      months.forEach((month) => {
        (c.cells[month].rows || [])
          .slice()
          .sort((a, b) => dataNum(a.date).localeCompare(dataNum(b.date)))
          .forEach((r) => rows.push(Object.assign({}, r, { _mes: month })));
      });
      const porNota = new Map();
      rows.forEach((r) => {
        const doc = String(r.doc || "").trim();
        if (!porNota.has(doc)) porNota.set(doc, []);
        porNota.get(doc).push(r);
      });
      const notas = [...porNota.keys()].filter(Boolean);
      const grupos = notas.length > 1
        ? notas
          .slice()
          .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
          .map((doc) => ({ doc, rows: porNota.get(doc) }))
          .concat((porNota.get("") || []).length ? [{ doc: "", rows: porNota.get("") }] : [])
        : [{ doc: "", rows }];
      grupos.forEach((g) => {
        const meses = [];
        g.rows.forEach((r) => {
          if (r._mes && meses.indexOf(r._mes) < 0) meses.push(r._mes);
        });
        const totalNota = g.rows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
        const cids = [...new Set(g.rows.map((r) => String(r.companyId || "")).filter(Boolean))];
        const emp = cids.length === 1 ? nomeEmpresa(cids[0]) : company;
        const nome = notas.length > 1
          ? (c.credor + (g.doc ? " · Nota " + g.doc : " · Sem nota"))
          : c.credor;
        this.addAvaliarSlide(pptx, {
          company: emp,
          credorName: nome,
          totalCredor: notas.length > 1 ? totalNota : c.total,
          duvida: entry.duvida || "",
          months: meses.length ? meses : months,
          rows: g.rows
        });
      });
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = company.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40) || "empresa";
    await pptx.writeFile({ fileName: "avaliar_" + safe + "_" + stamp + ".pptx" });
  },

  async exportExcel() {
    const scope = this.exportScope || "current";
    let companyIds = [];
    if (scope === "all") {
      const fromCrm = this.elencoCompanies().map((c) => String(c.id));
      const withData = new Set();
      try {
        const raw = localStorage.getItem("crm_participacoes_cache_v9") || "{}";
        const all = JSON.parse(raw);
        Object.keys(all || {}).forEach((k) => {
          const cid = String(k).split("|")[0];
          if (cid) withData.add(cid);
        });
      } catch (e) { /* ignore */ }
      if (this.chosenCompanyIds().length) this.chosenCompanyIds().forEach((id) => withData.add(String(id)));
      companyIds = fromCrm.filter((id) => withData.has(id));
      if (!companyIds.length) companyIds = this.chosenCompanyIds().slice();
    } else {
      companyIds = this.chosenCompanyIds().slice();
      if (!companyIds.length) {
        alert("Selecione uma empresa para exportar.");
        return;
      }
    }

    let ExcelJS;
    try {
      ExcelJS = await this.ensureExcelJS();
    } catch (e) {
      alert("Não foi possível carregar a biblioteca de Excel. Recarregue a página.");
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "CRM Moura Leite";
    wb.created = new Date();
    const usedNames = new Set();
    const currentId = String(this.companyId || "");
    const currentFiles = this.files.slice();
    const currentFileName = this.fileName;

    for (const cid of companyIds) {
      const naTela = currentFiles.filter((f) => String(f.companyId || "") === String(cid));
      const usaTela = naTela.length && (scope !== "all" || String(cid) === currentId);
      if (usaTela && String(cid) !== currentId) {
        this.files = naTela;
        this.fileName = "";
      } else if (String(cid) !== currentId) {
        // carrega cache local da outra empresa sem trocar a UI inteira
        const snapFiles = [];
        try {
          const all = JSON.parse(localStorage.getItem("crm_participacoes_cache_v9") || "{}") || {};
          Object.keys(all).forEach((k) => {
            if (!k.startsWith(cid + "|")) return;
            const hit = all[k];
            if (!hit || !hit.expenses) return;
            snapFiles.push({
              name: k.slice(cid.length + 1),
              closing: hit.closing || this.periodFromFileName(k.slice(cid.length + 1)),
              expenses: hit.expenses,
              saldoTotal: hit.saldoTotal,
              cacheVer: 9
            });
          });
        } catch (e) { /* ignore */ }
        if (!snapFiles.length) continue;
        this.files = snapFiles;
        this.fileName = "";
      }

      const mx = this.matrixData();
      if (!mx.creditors.length && !this.filtered().length) {
        if (String(cid) !== currentId) {
          this.files = currentFiles;
          this.fileName = currentFileName;
        }
        continue;
      }
      const label = this.companyLabel(cid) || cid;
      const sheetName = this.excelSheetName(cid, usedNames);
      const ws = wb.addWorksheet(sheetName, { properties: { showGridLines: false } });
      this.fillParticipacoesSheet(ws, {
        months: mx.months,
        creditors: mx.creditors,
        companyLabel: `${cid} — ${label}`,
        subtitle: this.fileName ? this.periodLabel(this.periodKeyOfFile(this.files.find((f) => f.name === this.fileName)), this.fileName) : "Todos os períodos"
      });

      const detailName = this.excelSheetName(cid + "-lanc", usedNames);
      const ws2 = wb.addWorksheet(detailName.slice(0, 31), { properties: { showGridLines: false } });
      this.fillLancamentosSheet(ws2, this.filtered(), `${cid} — ${label}`);

      if (String(cid) !== currentId) {
        this.files = currentFiles;
        this.fileName = currentFileName;
      }
    }

    this.files = currentFiles;
    this.fileName = currentFileName;

    if (!wb.worksheets.length) {
      alert("Não há despesas para exportar nesse escopo.");
      return;
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = URL.createObjectURL(blob);
    a.download = `prestacao_contas_ellenceo_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  },

  cargaHtml() {
    const pct = Math.max(8, Math.min(92, Number(this._cargaPct) || 18));
    const texto = this.uploadProgress || "Carregando…";
    return `<div class="part-load"><div class="ml-load" role="status" aria-live="polite">
      <div class="loading-spinner" aria-hidden="true"></div>
      <div class="loading-status-text" id="part-load-text">${this.esc(texto)}</div>
      <div class="ml-load-track"><div class="loading-progress-bar" id="part-load-bar" style="width:${pct}%"></div></div>
    </div></div>`;
  },

  iniciarCarga() {
    if (this._cargaTimer) return;
    if (!this._cargaPct) this._cargaPct = 12;
    this._cargaTimer = setInterval(() => {
      if (!this.loading && !this.parsing) {
        this.pararCarga();
        return;
      }
      const p = Number(this._cargaPct) || 12;
      this._cargaPct = Math.min(90, p + (p < 45 ? 3 : 0.7));
      const bar = document.getElementById("part-load-bar");
      if (bar) bar.style.width = this._cargaPct + "%";
    }, 420);
  },

  pararCarga() {
    if (this._cargaTimer) clearInterval(this._cargaTimer);
    this._cargaTimer = null;
  },

  setCarga(texto, pct) {
    this.uploadProgress = texto || "Carregando…";
    if (pct != null) this._cargaPct = pct;
    const txt = document.getElementById("part-load-text");
    const bar = document.getElementById("part-load-bar");
    if (txt) txt.textContent = this.uploadProgress;
    if (bar) bar.style.width = Math.max(8, Math.min(92, Number(this._cargaPct) || 18)) + "%";
    if (!txt) this.render();
  },

  render() {
    const root = document.getElementById("participacoes-root");
    if (!root) return;
    this.ensureAvaliar();
    const scroll = this.captureScroll();
    this.refreshCompanyList();
    const escolhidas = this.chosenCompanyIds();
    const temEmpresa = escolhidas.length > 0;
    const crm = escolhidas.length === 1 ? this.crmCompany(escolhidas[0]) : null;
    const groups = this.grouped();
    const rows = this.filtered();
    const total = rows.reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const selectedFile = this.files.find((f) => this.fileKey(f) === this.fileName || f.name === this.fileName);
    const periodTitle = this.fileName
      ? this.periodLabel(selectedFile ? this.shownClosing(selectedFile) : "", selectedFile ? selectedFile.name : this.fileName)
      : (this.files.length ? "Todos os períodos" : "—");
    const uploadDisabled = escolhidas.length !== 1;
    const companyTitle = !temEmpresa
      ? "Selecione a empresa"
      : (escolhidas.length === 1
        ? ((crm && crm.name) || this.companyLabel(escolhidas[0]) || "Selecione a empresa")
        : (escolhidas.length === this.elencoCompanies().length ? "Todas as empresas" : escolhidas.length + " empresas"));

    const views = [
      { id: "matriz", label: "Matriz", icon: "table" },
      { id: "credor", label: "Por credor", icon: "building-2" },
      { id: "categoria", label: "Por categoria", icon: "tags" },
      { id: "socio", label: "Painel do sócio", icon: "briefcase" }
    ];
    if (["matriz", "credor", "categoria", "socio"].indexOf(this.groupBy) < 0) this.groupBy = "matriz";
    if (!this.painel) this.carregarPainel();
    if (!this.catMl) this.carregarCatMl();
    const gruposCred = this.groupBy === "credor" ? this.filtrarCredPorCat(groups) : groups;
    this._gruposVisiveis = this.groupBy === "credor" ? gruposCred : [];
    const isMatriz = this.groupBy === "matriz";
    const mxInfo = temEmpresa && isMatriz ? this.matrixData() : null;
    const credCount = mxInfo ? mxInfo.creditors.length : 0;
    const canPpt = !!(mxInfo && mxInfo.creditors.some((c) => this.avaliarEntry(c.groupKey)));
    const cap = (s) => String(s || "").replace(/^\s*\S/, (ch) => ch.toUpperCase());
    const alertBox = (cls, msg) => `<div class="part-alert ${cls}">${this.esc(msg)}</div>`;

    const ocupado = this.parsing || this.loading;
    root.innerHTML = `
      <div class="part-page">
        <div class="part-head">
          <div class="part-toolbar">
            <div class="part-emp-box" id="part-emp-box"></div>
            <label class="part-field">
              <span class="ml-emp-filter-label">Período</span>
              <select class="part-input" onchange="ParticipacoesApp.onPeriodoSelect(this.value)" ${this.files.length ? "" : "disabled"}>
                <option value="" ${!this.fileName ? "selected" : ""}>${this.files.length ? `Todos os períodos (${this.files.length})` : "Nenhum PDF enviado"}</option>
                ${this.files.map((f, i) => `<option value="${i}" ${this.fileKey(f) === this.fileName ? "selected" : ""}>${escolhidas.length > 1 ? this.esc(String(f.companyId || "")) + " · " : ""}${this.esc(cap(this.periodLabel(this.shownClosing(f), f.name)))}</option>`).join("")}
              </select>
            </label>
            <label class="part-field">
              <span class="ml-emp-filter-label">Buscar nas despesas</span>
              <input class="part-input" placeholder="Credor, detalhe, categoria, data..." value="${this.esc(this.q)}"
                oninput="ParticipacoesApp.q=this.value;ParticipacoesApp.render()">
            </label>
            <label class="part-field">
              <span class="ml-emp-filter-label">Excel</span>
              <select class="part-input" onchange="ParticipacoesApp.exportScope=this.value" title="Abrangência da exportação">
                <option value="current" ${this.exportScope === "current" ? "selected" : ""}>Empresa atual</option>
                <option value="all" ${this.exportScope === "all" ? "selected" : ""}>Todas as empresas</option>
              </select>
            </label>
            <div class="part-field part-field-actions">
              <span class="ml-emp-filter-label">Ações</span>
              <div class="part-action-row">
                <button type="button" class="btn btn-excel" onclick="ParticipacoesApp.exportExcel()" ${!temEmpresa && this.exportScope === "current" ? "disabled" : ""} title="Exportar tabela atual para Excel">
                  <i data-lucide="download" style="width:14px;height:14px;"></i> Exportar em Excel
                </button>
                <label class="btn btn-primary part-upload ${uploadDisabled ? "is-disabled" : ""}" title="${uploadDisabled ? (temEmpresa ? "Envie os PDFs com uma empresa selecionada" : "Selecione a empresa para enviar PDFs") : "Enviar PDFs da prestação de contas"}">
                  <i data-lucide="upload" style="width:14px;height:14px;"></i> Enviar PDFs
                  <input type="file" accept="application/pdf,.pdf" multiple ${uploadDisabled ? "disabled" : ""} style="display:none" onchange="ParticipacoesApp.onUpload(this)">
                </label>
              </div>
            </div>
          </div>
        </div>

        ${this.error ? alertBox("is-error", this.error) : ""}
        ${this.hint && !this.error ? alertBox("is-warn", this.hint) : ""}

        ${temEmpresa ? `
          <div class="part-summary">
            <div class="part-summary-info">
              <strong>${this.esc(companyTitle)}</strong>
              <span>${this.esc(cap(periodTitle))} · ${rows.length} despesa(s)${mxInfo ? ` · ${credCount} credor(es)` : ""}</span>
            </div>
            <div class="part-summary-actions">
              ${this.fileName ? `<a class="btn btn-outline part-btn-sm" href="${this.fileLink(this.fileName)}" target="_blank" rel="noopener"><i data-lucide="file-text" style="width:14px;height:14px;"></i> Abrir PDF</a>` : ""}
              ${isMatriz ? `<button type="button" class="btn btn-outline part-btn-sm" onclick="ParticipacoesApp.exportPpt()" ${canPpt ? "" : "disabled"} title="${canPpt ? "Um slide por credor. Se o credor tiver mais de uma nota, cada nota sai em um slide." : "Marque credores na matriz para gerar o PPT"}"><i data-lucide="presentation" style="width:14px;height:14px;"></i> Gerar PPT</button>` : ""}
              <span class="part-summary-total">${this.fmt(total)}</span>
            </div>
          </div>
          <div class="ml-tabs part-tabs" role="tablist">
            ${views.map((v) => `
              <button type="button" role="tab" aria-selected="${this.groupBy === v.id}" class="ml-tab ${this.groupBy === v.id ? "is-active" : ""}"
                onclick="ParticipacoesApp.groupBy='${v.id}';ParticipacoesApp.detail=null;ParticipacoesApp.catDetalhe=null;ParticipacoesApp.render()"><i data-lucide="${v.icon}"></i> ${v.label}</button>
            `).join("")}
          </div>
          ${!ocupado && !this.files.length ? `<div class="part-empty">Nenhum PDF ainda. Use <strong>Enviar PDFs</strong>.</div>` : ""}
        ` : `<div class="part-empty">Selecione a empresa para ver a matriz e enviar PDFs.</div>`}

        ${ocupado ? this.cargaHtml() : ""}
        ${!ocupado && temEmpresa && this.groupBy === "matriz" ? this.matrixHtml() : ""}
        ${!ocupado && temEmpresa && this.groupBy === "credor" && groups.length ? `
          ${this.catEstilosHtml()}
          <style>
            .part-credor-row{cursor:pointer;}
            .part-credor-row td:first-child{white-space:nowrap;}
            .part-credor-seta{display:inline-flex;vertical-align:middle;margin-right:4px;color:#105436;}
            .part-catml-btn{display:inline-flex;align-items:center;gap:4px;max-width:100%;height:24px;padding:0 8px;border:1px dashed #94a3b8;border-radius:6px;background:#fff;color:#475569;font-size:.7rem;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
            .part-catml-btn.is-set{border-style:solid;border-color:#1b8253;background:#f0fdf4;color:#105436;}
            .part-credor-acoes{display:flex;gap:8px;margin:0 0 8px;}
            .part-credor-acoes .btn{height:32px;display:inline-flex;align-items:center;gap:6px;}
          </style>
          <div class="part-cat-filtros">
            <div id="part-cred-f-cats-box"></div>
            ${this.credFiltroCats.length ? `<button type="button" class="btn btn-outline" onclick="ParticipacoesApp.limparFiltroCred()"><i data-lucide="x" style="width:16px;height:16px;"></i> Limpar filtro</button>` : ""}
          </div>
          <p class="part-cat-info">${gruposCred.length} de ${groups.length} credor(es) · <strong>${this.fmt(gruposCred.reduce((t, g) => t + g.total, 0))}</strong>${this.credFiltroCats.length ? "" : ` · ${groups.filter((g) => !this.catMlDe(g.groupKey)).length} sem categoria`}</p>
          <div class="cc-scroll part-groups" id="part-groups-scroll">
            <table class="cc-table part-expense-table">
              <colgroup>
                <col style="width:88px"><col style="width:120px">
                <col style="width:22%"><col><col style="width:14%"><col style="width:17%"><col style="width:120px">
              </colgroup>
              <thead>
                <tr>
                  <th>Data</th><th>Período</th><th>Credor</th><th>Detalhe</th><th>Categoria Ellenco</th><th>Categoria Moura Leite</th><th class="is-right">Valor</th>
                </tr>
              </thead>
              ${gruposCred.length ? "" : `<tbody><tr><td colspan="7" style="text-align:center;padding:30px;">Nenhum credor com essa categoria.</td></tr></tbody>`}
              ${gruposCred.map((g, gi) => {
                const aberto = !!this.credorAberto[g.groupKey];
                const cat = this.catMlDe(g.groupKey);
                const rotCat = this.rotuloCatMl(cat);
                return `
                <tbody>
                  <tr class="part-group-row part-credor-row" onclick="ParticipacoesApp.alternarCredor(${gi})" title="${aberto ? "Fechar" : "Abrir"} os lançamentos">
                    <td colspan="5"><span class="part-credor-seta"><i data-lucide="${aberto ? "chevron-down" : "chevron-right"}" style="width:14px;height:14px;"></i></span>${this.esc(cap(g.key))} <span>${g.rows.length} lançamento(s)</span></td>
                    <td><button type="button" class="part-catml-btn${cat ? " is-set" : ""}" title="${this.esc(rotCat || "Escolher a categoria Moura Leite deste credor")}" onclick="ParticipacoesApp.escolherCatMl(${gi}, event)">${cat ? this.esc(rotCat) : `<i data-lucide="plus" style="width:12px;height:12px;"></i> Escolher`}</button></td>
                    <td class="is-right">${this.fmt(g.total)}</td>
                  </tr>
                  ${aberto ? g.rows.map((r) => `<tr>
                    <td>${this.esc(r.date)}</td>
                    <td>${this.esc(cap(this.periodLabel(r.periodo, "—")))}</td>
                    <td title="${this.esc(r.credor)}">${this.esc(r.credor)}</td>
                    <td title="${this.esc(r.detalhe || "")}">${this.esc(r.detalhe || "—")}</td>
                    <td title="${this.esc(r.categoria)}">${this.esc(r.categoria)}</td>
                    <td title="${this.esc(rotCat)}">${this.esc(rotCat || "—")}</td>
                    <td class="is-right part-valor">${r.valor ? this.fmt(r.valor) : "—"}</td>
                  </tr>`).join("") : ""}
                </tbody>`;
              }).join("")}
            </table>
          </div>` : ""}
        ${!ocupado && temEmpresa && this.groupBy === "categoria" && this.files.length ? this.categoriaHtml() : ""}
        ${!ocupado && temEmpresa && this.groupBy === "socio" && this.files.length ? this.painelHtml() : ""}
        ${!ocupado && temEmpresa && this.files.length && this.groupBy !== "categoria" && this.groupBy !== "socio" && !(this.groupBy === "matriz" ? this.matrixData().creditors.length : groups.length) ? `<div class="part-empty">Nenhuma linha do quadro <strong>DESPESAS PAGAS</strong> identificada neste filtro.</div>` : ""}
        ${this.detailModalHtml()}
        ${this.groupBy === "categoria" || this.groupBy === "socio" ? this.catDetalheHtml() : ""}
      </div>
    `;
    this.paintCompany();
    if (this.groupBy === "categoria") this.pintarFiltrosCategoria();
    if (this.groupBy === "credor") this.pintarFiltroCred(groups);
    if (window.lucide) lucide.createIcons();
    this.restoreScroll(scroll);
  },

  /* ---------- Categoria Moura Leite por credor ----------
     O operador escolhe, na linha do credor, um grupo de despesa do plano financeiro:
     só contas de nível 3 que começam com 2 (ex.: 2.01.01 - TERRENOS).
     Cada credor tem o seu registro no Firebase, na coleção participacoes_credores. */
  CAT_ML_COL: "participacoes_credores",
  CAT_ML_LOCAL: "crm_part_categoria_ml_v2",
  catMl: null,
  credorAberto: {},

  /** Id do registro do credor no Firebase (a chave do credor pode ter "/", que o Firebase não aceita no id). */
  catMlDocId(credorKey) {
    return encodeURIComponent(String(credorKey || "")).slice(0, 700) || "sem-credor";
  },

  async carregarCatMl() {
    if (this.catMl || this._catMlCarregando) return;
    this._catMlCarregando = true;
    let mapa = null;
    try { mapa = JSON.parse(localStorage.getItem(this.CAT_ML_LOCAL) || "null"); } catch (e) { mapa = null; }
    this.catMl = mapa && typeof mapa === "object" ? mapa : {};
    try {
      const fc = window.firebaseCollections;
      if (window.firebaseDb && fc && fc.getDocs && fc.collection) {
        const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.CAT_ML_COL));
        const remoto = {};
        snap.forEach((d) => {
          const v = d.data() || {};
          if (v.credorKey && v.categoriaMl && v.categoriaMl.id) remoto[v.credorKey] = Object.assign({}, v.categoriaMl, { por: v.por || "", em: v.em || "" });
        });
        this.catMl = remoto;
        try { localStorage.setItem(this.CAT_ML_LOCAL, JSON.stringify(this.catMl)); } catch (e) {}
      }
    } catch (e) {
      console.warn("[Prestação Ellenco] categoria Moura Leite", e);
    }
    this._catMlCarregando = false;
    if (this.groupBy === "credor" || this.groupBy === "categoria") this.render();
  },

  /** Código do plano no formato 2.01.01. O Sienge devolve sem ponto (20101): 1 dígito e depois pares. */
  codigoPlano(raw) {
    const t = String(raw == null ? "" : raw).trim().replace(/^\.+|\.+$/g, "");
    if (!t || t.indexOf(".") >= 0 || !/^\d+$/.test(t)) return t;
    const pares = t.slice(1).match(/.{1,2}/g) || [];
    return [t[0]].concat(pares).join(".");
  },

  /** Contas do plano financeiro de nível 3 que começam com 2, com o grupo de nível 2 de cada uma. */
  async carregarGruposMl() {
    if (this.gruposMl && this.gruposMl.length) return this.gruposMl;
    if (this._gruposPromessa) return this._gruposPromessa;
    this._gruposPromessa = (async () => {
      let cats = (window.PlanoFinanceiroApp && Array.isArray(PlanoFinanceiroApp.categories) && PlanoFinanceiroApp.categories.length) ? PlanoFinanceiroApp.categories : [];
      try {
        if (!cats.length && window.SiengeApiService && typeof SiengeApiService.getPaymentCategories === "function") {
          cats = await SiengeApiService.getPaymentCategories() || [];
        }
      } catch (e) {
        console.warn("[Prestação Ellenco] plano financeiro", e);
        cats = [];
      }
      const nome = (c) => String((c && (c.name || c.description || c.financialCategoryName)) || "").trim().toUpperCase();
      const pais = {};
      (cats || []).forEach((c) => {
        const cod = this.codigoPlano(c && c.id);
        if (cod.split(".").length === 2 && cod.indexOf("2.") === 0) pais[cod] = nome(c);
      });
      const vistos = new Set();
      const lista = (cats || []).map((c) => {
        const id = this.codigoPlano(c && c.id);
        const partes = id.split(".");
        if (partes.length !== 3 || partes[0] !== "2" || vistos.has(id)) return null;
        vistos.add(id);
        const pai = partes[0] + "." + partes[1];
        return { id, siengeId: String(c.id), label: nome(c), grupo: pai, grupoNome: pais[pai] || "" };
      }).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
      this.gruposMl = lista;
      this._gruposPromessa = null;
      return lista;
    })();
    return this._gruposPromessa;
  },

  /** Categoria gravada para a chave do credor (a mesma chave que agrupa o credor na tela). */
  catMlDe(credorKey) {
    const v = this.catMl && this.catMl[String(credorKey || "")];
    return v && v.id ? v : null;
  },

  catMlDaLinha(r) {
    return this.rotuloCatMl(this.catMlDe(this.credorGroupKey((r && r.credor) || "") || (r && r.credor)));
  },

  rotuloCatMl(v) {
    return v ? v.id + " - " + v.label : "";
  },

  /** Grava (ou apaga) a categoria no registro do credor no Firebase e confere lendo de volta. Devolve true se ficou gravado. */
  async gravarCatMl(credorKey, item, credorNome) {
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.doc || !fc.setDoc || !fc.getDoc) {
      alert("O banco do Integra não está disponível agora. A categoria não foi gravada.");
      return false;
    }
    const quem = (window.AppState && AppState.currentUser) || {};
    const ref = fc.doc(window.firebaseDb, this.CAT_ML_COL, this.catMlDocId(credorKey));
    const agora = new Date().toISOString();
    try {
      if (item) {
        await fc.setDoc(ref, {
          credorKey: String(credorKey),
          credor: String(credorNome || credorKey),
          categoriaMl: { id: item.id, siengeId: item.siengeId || "", label: item.label },
          por: String(quem.name || quem.email || ""),
          em: agora
        }, { merge: true });
      } else if (fc.deleteDoc) {
        await fc.deleteDoc(ref);
      }
      const snap = await fc.getDoc(ref);
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      const v = existe ? (snap.data() || {}) : null;
      const ok = item ? !!(v && v.categoriaMl && v.categoriaMl.id === item.id) : !existe;
      if (!ok) throw new Error("a leitura de conferência não trouxe o que foi gravado");
    } catch (e) {
      console.warn("[Prestação Ellenco] gravar categoria Moura Leite", e);
      alert("Não foi possível gravar a categoria no banco do Integra (" + ((e && e.message) || e) + "). Tente de novo.");
      return false;
    }
    if (!this.catMl) this.catMl = {};
    if (item) this.catMl[credorKey] = { id: item.id, siengeId: item.siengeId || "", label: item.label, por: String(quem.name || quem.email || ""), em: agora };
    else delete this.catMl[credorKey];
    try { localStorage.setItem(this.CAT_ML_LOCAL, JSON.stringify(this.catMl)); } catch (e) {}
    return true;
  },

  /* ---------- Aba "Por credor": filtro rápido pela Categoria Moura Leite ----------
     Mesmo filtro da aba Por categoria, com "(Sem categoria)" para achar os credores que ainda falta classificar. */
  credFiltroCats: [],
  credFiltroAberto: false,
  credFiltroBusca: "",

  catIdDoGrupo(g) {
    const cat = this.catMlDe(g && g.groupKey);
    return cat ? cat.id : this.CAT_SEM;
  },

  filtrarCredPorCat(groups) {
    const sel = this.credFiltroCats || [];
    if (!sel.length) return groups;
    return (groups || []).filter((g) => sel.indexOf(this.catIdDoGrupo(g)) >= 0);
  },

  pintarFiltroCred(groups) {
    const box = document.getElementById("part-cred-f-cats-box");
    if (!box || !window.MlEmpresaFilter) return;
    const cont = {};
    (groups || []).forEach((g) => {
      const id = this.catIdDoGrupo(g);
      if (!cont[id]) cont[id] = { id, n: 0, label: id === this.CAT_SEM ? "(Sem categoria)" : this.rotuloCatMl(this.catMlDe(g.groupKey)), order: id === this.CAT_SEM ? 0 : 1 };
      cont[id].n += 1;
    });
    (this.credFiltroCats || []).forEach((id) => {
      if (!cont[id]) cont[id] = { id, n: 0, label: id === this.CAT_SEM ? "(Sem categoria)" : id, order: id === this.CAT_SEM ? 0 : 1 };
    });
    const itens = Object.values(cont)
      .sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }))
      .map((c) => ({ id: c.id, label: `${c.label} · ${c.n} credor(es)` }));
    const id = "part-cred-f-cats";
    const opts = {
      id, label: "Categoria Moura Leite", items: itens, keepOrder: true, selectedIds: this.credFiltroCats,
      open: this.credFiltroAberto, query: this.credFiltroBusca, emptyMeansAll: true,
      nouns: { singular: "categoria", plural: "categorias", none: "Nenhuma categoria", noMatch: "Nenhuma categoria com esse nome." }
    };
    box.innerHTML = MlEmpresaFilter.html(opts);
    MlEmpresaFilter.bind(id, {
      toggleOpen: () => { this.credFiltroAberto = !this.credFiltroAberto; this.render(); },
      close: () => { if (this.credFiltroAberto) { this.credFiltroAberto = false; this.render(); } },
      setQuery: (q) => {
        this.credFiltroBusca = q || "";
        const list = document.getElementById(id + "-list");
        if (list) list.innerHTML = MlEmpresaFilter.listHtml(Object.assign({}, opts, { query: this.credFiltroBusca, selectedIds: this.credFiltroCats }));
      },
      toggleId: (cid, on) => {
        const atual = new Set(this.credFiltroCats);
        if (on) atual.add(String(cid)); else atual.delete(String(cid));
        this.credFiltroCats = Array.from(atual);
        this.credFiltroAberto = true;
        this.render();
      },
      selectAll: () => { this.credFiltroCats = itens.map((i) => String(i.id)); this.credFiltroAberto = true; this.render(); },
      selectNone: () => { this.credFiltroCats = []; this.credFiltroAberto = true; this.render(); }
    });
    if (window.lucide) lucide.createIcons();
  },

  limparFiltroCred() {
    this.credFiltroCats = [];
    this.credFiltroBusca = "";
    this.credFiltroAberto = false;
    this.render();
  },

  /* ---------- Aba "Por categoria" ----------
     Filtra os lançamentos pela Categoria Moura Leite do credor (várias de uma vez), por credor e por empresa (SPE).
     Linhas: o credor e, embaixo dele, uma linha por SPE onde o gasto foi feito. Colunas: um mês cada e o total.
     Clique no credor: meses x SPEs. Clique na SPE: lançamentos só daquela SPE. Clique na célula: só aquela célula. */
  catFiltro: { cats: [], credores: [], empresas: [] },
  catFiltroAberto: "",
  catFiltroBusca: { cats: "", credores: "", empresas: "" },
  catDetalhe: null, // { tipo: "credor" | "spe" | "celula", k, emp, m }
  CAT_SEM: "__sem",

  /** Lançamentos com mês válido, já com a chave do credor e a categoria Moura Leite. */
  catLinhasBase() {
    return this.filtered().map((r) => {
      const m = this.expensePeriodKey(r);
      if (!m || !/^\d{4}-\d{2}$/.test(m)) return null;
      const k = this.credorGroupKey(r.credor) || r.credor || "(sem credor)";
      const cat = this.catMlDe(k);
      return { r, m, k, emp: String(r.companyId || ""), catId: cat ? cat.id : this.CAT_SEM, catRot: cat ? this.rotuloCatMl(cat) : "" };
    }).filter(Boolean);
  },

  catPassa(x, ignorar) {
    const f = this.catFiltro;
    if (ignorar !== "cats" && f.cats.length && f.cats.indexOf(x.catId) < 0) return false;
    if (ignorar !== "credores" && f.credores.length && f.credores.indexOf(x.k) < 0) return false;
    if (ignorar !== "empresas" && f.empresas.length && f.empresas.indexOf(x.emp) < 0) return false;
    return true;
  },

  catDados() {
    const base = this.catLinhasBase();
    return this.agregarCat(base, base.filter((x) => this.catPassa(x)));
  },

  /** Soma por credor, mês e SPE (usado em Por categoria e no Painel do sócio). */
  agregarCat(base, linhas) {
    const meses = Array.from(new Set(linhas.map((x) => x.m))).sort();
    const mapa = {};
    linhas.forEach((x) => {
      const v = Number(x.r.valor) || 0;
      if (!mapa[x.k]) mapa[x.k] = { k: x.k, nomes: [], catRot: x.catRot, cells: {}, total: 0, spes: {} };
      const c = mapa[x.k];
      c.nomes.push(x.r.credor);
      c.cells[x.m] = (c.cells[x.m] || 0) + v;
      c.total += v;
      if (!c.spes[x.emp]) c.spes[x.emp] = { emp: x.emp, cells: {}, total: 0 };
      c.spes[x.emp].cells[x.m] = (c.spes[x.emp].cells[x.m] || 0) + v;
      c.spes[x.emp].total += v;
    });
    const credores = Object.values(mapa).map((c) => Object.assign(c, {
      credor: this.pickCredorLabel(c.nomes) || c.k,
      spes: Object.values(c.spes).sort((a, b) => b.total - a.total)
    })).sort((a, b) => b.total - a.total || a.credor.localeCompare(b.credor, "pt-BR"));
    const totMes = {};
    meses.forEach((m) => { totMes[m] = credores.reduce((s, c) => s + (c.cells[m] || 0), 0); });
    return { base, linhas, meses, credores, totMes, total: credores.reduce((s, c) => s + c.total, 0) };
  },

  mesCurto(ym) {
    const p = String(this.periodLabel(ym, ym)).split(" ");
    return p.length >= 3 ? p[0].slice(0, 3) + "/" + p[2] : ym;
  },

  rotuloEmpresa(id) {
    return String(id || "—") + " - " + String(this.companyLabel(id) || "").toUpperCase();
  },

  /** Itens de cada filtro: os que existem nos lançamentos que passam nos outros dois filtros. */
  catItensFiltro(qual, base) {
    const vistos = {};
    base.filter((x) => this.catPassa(x, qual)).forEach((x) => {
      if (qual === "cats") {
        if (!vistos[x.catId]) vistos[x.catId] = { id: x.catId, label: x.catId === this.CAT_SEM ? "(Sem categoria)" : x.catRot, order: x.catId === this.CAT_SEM ? 0 : 1 };
      } else if (qual === "credores") {
        if (!vistos[x.k]) vistos[x.k] = { id: x.k, nomes: [], total: 0 };
        vistos[x.k].nomes.push(x.r.credor);
        vistos[x.k].total += Number(x.r.valor) || 0;
      } else if (!vistos[x.emp]) {
        vistos[x.emp] = { id: x.emp, label: this.rotuloEmpresa(x.emp) };
      }
    });
    let itens = Object.values(vistos);
    if (qual === "cats") itens.sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
    if (qual === "credores") itens = itens.sort((a, b) => b.total - a.total).map((c) => ({ id: c.id, label: this.pickCredorLabel(c.nomes) || c.id }));
    // Mantém marcado o que já está no filtro, mesmo que não apareça mais com os outros filtros.
    (this.catFiltro[qual] || []).forEach((id) => {
      if (!itens.some((i) => i.id === id)) itens.push({ id, label: qual === "empresas" ? this.rotuloEmpresa(id) : (id === this.CAT_SEM ? "(Sem categoria)" : id) });
    });
    return itens;
  },

  pintarFiltrosCategoria() {
    // Empresa (SPE) não tem filtro próprio aqui: vale o filtro Empresas do topo da página.
    this.catFiltro.empresas = [];
    if (!window.MlEmpresaFilter) return;
    const base = this.catLinhasBase();
    const conf = [
      { qual: "cats", id: "part-cat-f-cats", label: "Categoria Moura Leite", nouns: { singular: "categoria", plural: "categorias", none: "Nenhuma categoria", noMatch: "Nenhuma categoria com esse nome." } },
      { qual: "credores", id: "part-cat-f-credores", label: "Credor", nouns: { singular: "credor", plural: "credores", none: "Nenhum credor", noMatch: "Nenhum credor com esse nome." } }
    ];
    conf.forEach((c) => {
      const box = document.getElementById(c.id + "-box");
      if (!box) return;
      const itens = this.catItensFiltro(c.qual, base);
      const opts = {
        id: c.id, label: c.label, items: itens, keepOrder: true, selectedIds: this.catFiltro[c.qual],
        open: this.catFiltroAberto === c.qual, query: this.catFiltroBusca[c.qual], emptyMeansAll: true, nouns: c.nouns
      };
      box.innerHTML = MlEmpresaFilter.html(opts);
      MlEmpresaFilter.bind(c.id, {
        toggleOpen: () => { this.catFiltroAberto = this.catFiltroAberto === c.qual ? "" : c.qual; this.render(); },
        close: () => { if (this.catFiltroAberto === c.qual) { this.catFiltroAberto = ""; this.render(); } },
        setQuery: (q) => {
          this.catFiltroBusca[c.qual] = q || "";
          const list = document.getElementById(c.id + "-list");
          if (list) list.innerHTML = MlEmpresaFilter.listHtml(Object.assign({}, opts, { query: this.catFiltroBusca[c.qual], selectedIds: this.catFiltro[c.qual] }));
        },
        toggleId: (id, on) => {
          const atual = new Set(this.catFiltro[c.qual]);
          if (on) atual.add(String(id)); else atual.delete(String(id));
          this.catFiltro[c.qual] = Array.from(atual);
          this.catFiltroAberto = c.qual;
          this.render();
        },
        selectAll: () => { this.catFiltro[c.qual] = itens.map((i) => String(i.id)); this.catFiltroAberto = c.qual; this.render(); },
        selectNone: () => { this.catFiltro[c.qual] = []; this.catFiltroAberto = c.qual; this.render(); }
      });
    });
    if (window.lucide) lucide.createIcons();
  },

  limparFiltrosCategoria() {
    this.catFiltro = { cats: [], credores: [], empresas: [] };
    this.catFiltroBusca = { cats: "", credores: "", empresas: "" };
    this.catFiltroAberto = "";
    this.render();
  },

  /** Estilos da aba Por categoria, usados também no Painel do sócio (nomes e valores clicáveis, tabela, filtros). */
  catEstilosHtml() {
    return `      <style>
        .part-cat-filtros{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin:4px 0 10px;}
        .part-cat-filtros > div{min-width:240px;}
        .part-cat-filtros .btn{height:40px;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;}
        .part-cat-info{font-size:.75rem;color:#64748b;margin:0 0 8px;}
        .part-cat-tabela{table-layout:fixed;}
        .part-cat-tabela th, .part-cat-tabela td{white-space:nowrap;padding:4px 5px;}
        .part-cat-tabela th:not(.part-cat-fixa), .part-cat-tabela td:not(.part-cat-fixa){overflow:visible;text-overflow:clip;}
        .part-cat-tabela .part-cat-fixa{position:sticky;left:0;z-index:1;background:inherit;overflow:hidden;text-overflow:ellipsis;}
        .part-cat-tabela thead .part-cat-fixa{z-index:3;background:#1b8253;}
        .part-cat-tabela tbody tr.part-cat-credor td{background:#e7f6ee;color:#105436;font-weight:700;border-top:2px solid #c9e8d6;}
        .part-cat-tabela tbody tr.part-cat-spe td{background:#fff;}
        .part-cat-tabela tbody tr.part-cat-spe:hover td{background:#f7faf8;}
        .part-cat-tabela tfoot td{position:sticky;bottom:0;z-index:2;background:#105436;color:#fff;font-weight:700;padding:6px 5px;}
        .part-cat-tabela tfoot td.part-cat-fixa{z-index:4;background:#105436;}
        .part-cat-nome,.part-cat-nome-spe,.part-cat-val{border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;text-align:inherit;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .part-cat-nome{font-weight:800;display:block;}
        .part-cat-linha-credor{display:flex;align-items:center;gap:6px;min-width:0;}
        .part-cat-nome-box{min-width:0;flex:1 1 auto;overflow:hidden;}
        .part-cat-flag{flex:0 0 auto;width:15px;height:15px;margin:0;accent-color:#1b8253;cursor:pointer;}
        .part-cat-nome:hover,.part-cat-nome-spe:hover,.part-cat-val:hover{text-decoration:underline;color:#0f3d27;}
        .part-cat-credor small{display:block;font-size:.62rem;font-weight:600;color:#3f7a5a;overflow:hidden;text-overflow:ellipsis;}
        .part-cat-nome-spe{padding-left:18px;color:#334155;}
        .part-cat-val{font-variant-numeric:tabular-nums;}
        .part-cat-tot{font-weight:800;}
        .part-cat-vazio{color:#cbd5e1;}
        .part-cat-modal table td,.part-cat-modal table th{white-space:nowrap;}
        .part-cat-modal td.part-cat-quebra{white-space:normal;}
        #part-cat-f-cats-box .ml-emp-filter-panel,#part-cat-f-credores-box .ml-emp-filter-panel,#part-cred-f-cats-box .ml-emp-filter-panel{width:max-content;min-width:100%;max-width:min(640px,92vw);}
        #part-cat-f-cats-box .ml-emp-filter-item,#part-cat-f-credores-box .ml-emp-filter-item,#part-cred-f-cats-box .ml-emp-filter-item{white-space:nowrap;align-items:center;}
      </style>`;
  },

  categoriaHtml() {
    const d = this.catDados();
    this._catDados = d;
    const filtrado = this.catFiltro.cats.length || this.catFiltro.credores.length || this.catFiltro.empresas.length;
    const cel = (v, js) => v ? `<button type="button" class="part-cat-val" onclick="${js}">${this.fmt(v)}</button>` : `<span class="part-cat-vazio">—</span>`;
    // Colunas condensadas: cada mês fica com a largura do maior valor dele (7px por caractere + folga).
    const px = (txt) => Math.max(48, String(txt || "").length * 7 + 12);
    const largMes = {};
    d.meses.forEach((m) => {
      let maior = this.fmt(d.totMes[m] || 0);
      d.credores.forEach((c) => {
        [c.cells[m]].concat(c.spes.map((s) => s.cells[m])).forEach((v) => {
          const t = v ? this.fmt(v) : "";
          if (t.length > maior.length) maior = t;
        });
      });
      largMes[m] = px(maior);
    });
    const largTot = px(this.fmt(d.total)) + 4;
    const largNome = 250;
    const larg = largNome + d.meses.reduce((s, m) => s + largMes[m], 0) + largTot;
    const mesCab = (m) => this.mesCurto(m).replace(/\/(?:19|20)(\d\d)$/, "/$1");
    const corpo = d.credores.map((c, ci) => {
      const linhaCredor = `<tr class="part-cat-credor">
          <td class="part-cat-fixa"><div class="part-cat-linha-credor">
            <input type="checkbox" class="part-cat-flag" ${this.painelOn(c.k) ? "checked" : ""} title="Levar para o Painel do sócio" onclick="event.stopPropagation()" onchange="ParticipacoesApp.marcarPainel(${ci}, this.checked)">
            <div class="part-cat-nome-box"><button type="button" class="part-cat-nome" title="Ver mês a mês por SPE: ${this.esc(c.credor)}" onclick="ParticipacoesApp.abrirCatDetalhe('credor', ${ci})">${this.esc(c.credor)}</button>
            <small>${this.esc(c.catRot || "Sem categoria")}</small></div></div></td>
          ${d.meses.map((m) => `<td class="is-right">${cel(c.cells[m], `ParticipacoesApp.abrirCatDetalhe('celula', ${ci}, '', '${m}')`)}</td>`).join("")}
          <td class="is-right part-cat-tot">${cel(c.total, `ParticipacoesApp.abrirCatDetalhe('credor', ${ci})`)}</td>
        </tr>`;
      const linhasSpe = c.spes.map((s) => `<tr class="part-cat-spe">
          <td class="part-cat-fixa"><button type="button" class="part-cat-nome-spe" title="Ver os lançamentos de ${this.esc(c.credor)} nesta SPE" onclick="ParticipacoesApp.abrirCatDetalhe('spe', ${ci}, '${this.esc(s.emp)}')">${this.esc(this.rotuloEmpresa(s.emp))}</button></td>
          ${d.meses.map((m) => `<td class="is-right">${cel(s.cells[m], `ParticipacoesApp.abrirCatDetalhe('celula', ${ci}, '${this.esc(s.emp)}', '${m}')`)}</td>`).join("")}
          <td class="is-right part-cat-tot">${cel(s.total, `ParticipacoesApp.abrirCatDetalhe('spe', ${ci}, '${this.esc(s.emp)}')`)}</td>
        </tr>`).join("");
      return linhaCredor + linhasSpe;
    }).join("");
    return `
      ${this.catEstilosHtml()}
      <div class="part-cat-filtros">
        <div id="part-cat-f-cats-box"></div>
        <div id="part-cat-f-credores-box"></div>
        ${filtrado ? `<button type="button" class="btn btn-outline" onclick="ParticipacoesApp.limparFiltrosCategoria()"><i data-lucide="x" style="width:16px;height:16px;"></i> Limpar filtros</button>` : ""}
      </div>
      <p class="part-cat-info">${d.credores.length} credor(es) · ${d.linhas.length} lançamento(s) · <strong>${this.fmt(d.total)}</strong>. Clique no credor para ver mês a mês por SPE, na SPE para ver os lançamentos dela e no valor para ver só aquela célula. Marque a caixa do credor para levá-lo ao <strong>Painel do sócio</strong> (${this.painelQtde()} marcado(s)).</p>
      ${d.credores.length ? `
      <div class="cc-scroll" id="part-cat-scroll" style="max-height:calc(100vh - 330px);">
        <table class="cc-table part-cat-tabela" style="width:max(100%, ${larg}px);">
          <colgroup><col style="width:${largNome}px">${d.meses.map((m) => `<col style="width:${largMes[m]}px">`).join("")}<col style="width:${largTot}px"></colgroup>
          <thead><tr><th class="part-cat-fixa">Credor / SPE</th>${d.meses.map((m) => `<th class="is-right" title="${this.esc(this.periodLabel(m, m))}">${this.esc(mesCab(m))}</th>`).join("")}<th class="is-right">Total</th></tr></thead>
          <tbody>${corpo}</tbody>
          <tfoot><tr><td class="part-cat-fixa">Total</td>${d.meses.map((m) => `<td class="is-right">${d.totMes[m] ? this.fmt(d.totMes[m]) : "—"}</td>`).join("")}<td class="is-right">${this.fmt(d.total)}</td></tr></tfoot>
        </table>
      </div>` : `<div class="part-empty">Nenhum lançamento com esses filtros.${!this.catMl ? " Carregando as categorias…" : ""}</div>`}
    `;
  },

  abrirCatDetalhe(tipo, ci, emp, m) {
    const c = this._catDados && this._catDados.credores[ci];
    if (!c) return;
    this.catDetalhe = { tipo, k: c.k, credor: c.credor, emp: emp ? String(emp) : "", m: m || "" };
    this.render();
  },

  fecharCatDetalhe() {
    this.catDetalhe = null;
    this.render();
  },

  /* ---------- Painel do sócio ----------
     Credores marcados na aba Por categoria, para avaliar com o sócio administrador da SPE se o escopo
     justifica a cobrança. A marcação, o escopo e a avaliação ficam no Firebase (participacoes_painel),
     um registro por credor, e valem para todos. */
  PAINEL_COL: "participacoes_painel",
  PAINEL_LOCAL: "crm_part_painel_socio_v1",
  painel: null,
  painelEmp: "",
  painelCat: "",
  JUSTIFICA: [
    { id: "", label: "Em análise" },
    { id: "sim", label: "Justifica" },
    { id: "parcial", label: "Justifica em parte" },
    { id: "nao", label: "Não justifica" }
  ],

  async carregarPainel() {
    if (this.painel || this._painelCarregando) return;
    this._painelCarregando = true;
    let mapa = null;
    try { mapa = JSON.parse(localStorage.getItem(this.PAINEL_LOCAL) || "null"); } catch (e) { mapa = null; }
    this.painel = mapa && typeof mapa === "object" ? mapa : {};
    try {
      const fc = window.firebaseCollections;
      if (window.firebaseDb && fc && fc.getDocs && fc.collection) {
        const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.PAINEL_COL));
        const remoto = {};
        snap.forEach((d) => {
          const v = d.data() || {};
          if (v.credorKey) remoto[v.credorKey] = v;
        });
        this.painel = remoto;
        try { localStorage.setItem(this.PAINEL_LOCAL, JSON.stringify(this.painel)); } catch (e) {}
      }
    } catch (e) {
      console.warn("[Prestação Ellenco] painel do sócio", e);
    }
    this._painelCarregando = false;
    if (this.groupBy === "categoria" || this.groupBy === "socio") this.render();
  },

  painelOn(k) {
    if (!this.painel) this.carregarPainel();
    const p = this.painel && this.painel[k];
    return !!(p && p.on);
  },

  painelQtde() {
    return Object.values(this.painel || {}).filter((p) => p && p.on).length;
  },

  async gravarPainel(k, campos) {
    if (!this.painel) this.painel = {};
    const user = (window.AppState && AppState.currentUser) || {};
    const atual = Object.assign({ credorKey: k, on: false, escopo: "", justifica: "" }, this.painel[k] || {}, campos, {
      credorKey: k,
      por: user.name || user.email || "",
      em: new Date().toISOString()
    });
    this.painel[k] = atual;
    try { localStorage.setItem(this.PAINEL_LOCAL, JSON.stringify(this.painel)); } catch (e) {}
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.setDoc || !fc.doc) {
      alert("O Firebase não está disponível. A marcação vale só neste navegador.");
      return;
    }
    try {
      await fc.setDoc(fc.doc(window.firebaseDb, this.PAINEL_COL, this.catMlDocId(k)), atual, { merge: true });
    } catch (e) {
      console.error("[Prestação Ellenco] gravar painel do sócio", e);
      alert("Não consegui gravar no Firebase. Tente de novo.");
    }
  },

  /** Caixa da aba Por categoria: leva o credor para o painel (ou tira, mantendo escopo e avaliação). */
  async marcarPainel(ci, on) {
    const c = this._catDados && this._catDados.credores[ci];
    if (!c) return;
    await this.gravarPainel(c.k, { on: !!on, credor: c.credor });
    this.render();
  },

  async tirarDoPainel(ci) {
    const c = this._painelDados && this._painelDados.credores[ci];
    if (!c) return;
    await this.gravarPainel(c.k, { on: false });
    this.render();
  },

  async salvarPainelCampo(ci, campo, valor) {
    const c = this._painelDados && this._painelDados.credores[ci];
    if (!c || (campo !== "escopo" && campo !== "justifica")) return;
    await this.gravarPainel(c.k, { [campo]: String(valor || "").slice(0, 2000) });
    if (campo === "justifica") this.render();
  },

  escolherPainelEmp(emp) {
    this.painelEmp = String(emp || "");
    this.catDetalhe = null;
    this.render();
  },

  /** Filtro rápido pela conta (Categoria Moura Leite) do credor, abaixo das SPEs. */
  escolherPainelCat(cat) {
    this.painelCat = String(cat || "");
    this.catDetalhe = null;
    this.render();
  },

  /** Lançamentos dos credores marcados, no filtro de empresa e período do topo. Os chips de SPE e de conta se
      combinam: o total de cada chip de SPE respeita a conta escolhida, e o de cada conta respeita a SPE. */
  painelDados() {
    const base = this.catLinhasBase().filter((x) => this.painelOn(x.k));
    const somaPor = (linhas, campo) => {
      const t = {};
      linhas.forEach((x) => { t[x[campo]] = (t[x[campo]] || 0) + (Number(x.r.valor) || 0); });
      return t;
    };
    if (this.painelCat && !base.some((x) => x.catId === this.painelCat)) this.painelCat = "";
    if (this.painelEmp && !base.some((x) => x.emp === this.painelEmp)) this.painelEmp = "";
    const daCat = this.painelCat ? base.filter((x) => x.catId === this.painelCat) : base;
    const daEmp = this.painelEmp ? base.filter((x) => x.emp === this.painelEmp) : base;
    const linhas = this.painelEmp ? daCat.filter((x) => x.emp === this.painelEmp) : daCat;
    const d = this.agregarCat(base, linhas);
    const empsBase = somaPor(daCat, "emp");
    d.empsBase = Object.keys(empsBase).sort((a, b) => empsBase[b] - empsBase[a]).map((e) => ({ emp: e, total: empsBase[e] }));
    d.totalBase = daCat.reduce((s, x) => s + (Number(x.r.valor) || 0), 0);
    // Contas presentes nos credores marcados (com a SPE escolhida, se houver), na ordem do plano de contas.
    const catsTot = somaPor(daEmp, "catId");
    const rot = {};
    base.forEach((x) => { if (!rot[x.catId]) rot[x.catId] = x.catId === this.CAT_SEM ? "Sem categoria" : (x.catRot || x.catId); });
    d.catsBase = Object.keys(rot)
      .map((id) => ({ id, rot: rot[id], total: catsTot[id] || 0 }))
      .sort((a, b) => (a.id === this.CAT_SEM) - (b.id === this.CAT_SEM) || a.rot.localeCompare(b.rot, "pt-BR", { numeric: true }));
    d.totalCats = daEmp.reduce((s, x) => s + (Number(x.r.valor) || 0), 0);
    return d;
  },

  painelHtml() {
    const d = this.painelDados();
    this._painelDados = d;
    // O detalhe (mês a mês, SPE, célula) reaproveita o da aba Por categoria, sobre os dados do painel.
    this._catDados = d;
    const marcados = this.painelQtde();
    const aval = { sim: { n: 0, v: 0 }, parcial: { n: 0, v: 0 }, nao: { n: 0, v: 0 }, "": { n: 0, v: 0 } };
    d.credores.forEach((c) => {
      const j = (this.painel[c.k] || {}).justifica || "";
      const a = aval[j] || aval[""];
      a.n += 1;
      a.v += c.total;
    });
    const spes = this.painelEmp ? [this.painelEmp] : d.empsBase.map((e) => e.emp);
    const mes = (m) => this.mesCurto(m).replace(/\/(?:19|20)(\d\d)$/, "/$1");
    const pct = (v, t) => (t > 0 ? Math.round((v / t) * 100) : 0);
    const valor = (v, js, sub) => (v
      ? `<button type="button" class="part-cat-val" onclick="${js}">${this.fmt(v)}</button>${sub ? `<small class="part-soc-pct">${sub}</small>` : ""}`
      : `<span class="part-cat-vazio">—</span>`);
    // No chip o nome sai sem o "SPE LTDA"/"LTDA" do fim, para a linha caber no notebook; o nome inteiro fica no título.
    // Tarja de filtros (27/11/2026, menos poluída): nomes em caixa normal, sem "SPE LTDA"/"LTDA" do fim,
    // conta com o código em cinza; o nome inteiro fica no título (passar o mouse).
    const MIUDAS = ["de", "da", "do", "das", "dos", "e"];
    const caixaNormal = (t) => String(t || "").toLowerCase().split(/(\s+)/).map((p, i) => {
      if (/^\s+$/.test(p) || !p) return p;
      if (/^(i|ii|iii|iv|v|vi|vii|viii|ix|x|spe|ltda)$/i.test(p)) return p.toUpperCase();
      if (i > 0 && MIUDAS.indexOf(p) >= 0) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join("");
    const curto = (rot) => String(rot || "").replace(/\s+(SPE\s+)?LTDA\.?\s*$/i, "").replace(/\s+SPE\s*$/i, "");
    const rotSpe = (id, rot) => {
      const m = curto(rot).match(/^(\S+)\s*-\s*(.+)$/);
      return m ? `<i>${this.esc(m[1])}</i>${this.esc(caixaNormal(m[2]))}` : this.esc(caixaNormal(curto(rot)));
    };
    const rotConta = (rot) => {
      const m = String(rot || "").match(/^([\d.]+)\s*-\s*(.+)$/);
      return m ? `<i>${this.esc(m[1])}</i>${this.esc(caixaNormal(m[2]))}` : this.esc(caixaNormal(rot));
    };
    const chip = (id, rot, tot) => `<button type="button" class="part-soc-chip${this.painelEmp === id ? " is-on" : ""}" title="${this.esc(rot)}" onclick="ParticipacoesApp.escolherPainelEmp('${this.esc(id)}')"><span>${id ? rotSpe(id, rot) : this.esc(rot)}</span><b>${this.fmt(tot)}</b></button>`;
    const chipCat = (id, rot, tot) => `<button type="button" class="part-soc-chip${this.painelCat === id ? " is-on" : ""}" title="${this.esc(rot)}" onclick="ParticipacoesApp.escolherPainelCat('${this.esc(id)}')"><span>${id ? rotConta(rot) : this.esc(rot)}</span><b>${this.fmt(tot)}</b></button>`;
    const opcoes = (atual) => this.JUSTIFICA.map((o) => `<option value="${o.id}" ${String(atual || "") === o.id ? "selected" : ""}>${o.label}</option>`).join("");
    const corpo = d.credores.map((c, ci) => {
      const p = this.painel[c.k] || {};
      const meses = Object.keys(c.cells).sort();
      const n = d.linhas.filter((x) => x.k === c.k).length;
      const periodo = meses.length ? mes(meses[0]) + (meses.length > 1 ? " a " + mes(meses[meses.length - 1]) : "") : "";
      const just = p.justifica || "analise";
      const celulas = spes.map((e) => {
        const x = c.spes.find((y) => y.emp === e);
        const v = x ? x.total : 0;
        return `<td class="is-right">${valor(v, `ParticipacoesApp.abrirCatDetalhe('spe', ${ci}, '${this.esc(e)}')`, spes.length > 1 && v ? pct(v, c.total) + "%" : "")}</td>`;
      }).join("");
      return `<tr class="part-soc-row is-${this.esc(just)}">
        <td class="part-cat-fixa part-soc-credor">
          <button type="button" class="part-cat-nome" title="Ver mês a mês por SPE" onclick="ParticipacoesApp.abrirCatDetalhe('credor', ${ci})">${this.esc(c.credor)}</button>
          <span class="part-soc-meta"><span class="part-soc-cat" title="${this.esc(c.catRot || "Sem categoria")}">${this.esc(c.catRot || "Sem categoria")}</span><span>${n} lançamento(s) · ${this.esc(periodo)}</span></span>
        </td>
        ${celulas}
        <td class="is-right part-cat-tot">${valor(c.total, `ParticipacoesApp.abrirCatDetalhe('credor', ${ci})`)}</td>
        <td><textarea class="part-soc-escopo" rows="1" placeholder="Escopo que este credor atende" onchange="ParticipacoesApp.salvarPainelCampo(${ci}, 'escopo', this.value)">${this.esc(p.escopo || "")}</textarea></td>
        <td><select class="part-soc-just is-${this.esc(just)}" onchange="ParticipacoesApp.salvarPainelCampo(${ci}, 'justifica', this.value)">${opcoes(p.justifica)}</select>
          ${p.por ? `<small class="part-soc-quem">${this.esc(p.por)}${p.em ? " · " + this.esc(new Date(p.em).toLocaleDateString("pt-BR")) : ""}</small>` : ""}</td>
        <td class="is-center"><button type="button" class="part-soc-tirar" title="Tirar do painel (escopo e avaliação ficam guardados)" onclick="ParticipacoesApp.tirarDoPainel(${ci})"><i data-lucide="x" style="width:14px;height:14px;"></i></button></td>
      </tr>`;
    }).join("");
    // Larguras pensadas para notebook a 100% (sem rolagem lateral com até 4 SPEs).
    const larg = 230 + spes.length * 104 + 112 + 230 + 150 + 34;
    const card = (cls, rot, val, sub) => `<div class="part-soc-card ${cls}"><label>${rot}</label><strong>${val}</strong><small>${sub}</small></div>`;
    const totSpe = (e) => d.credores.reduce((t, c) => { const x = c.spes.find((y) => y.emp === e); return t + (x ? x.total : 0); }, 0);
    return `${this.catEstilosHtml()}
      <style>
        .part-soc-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:4px 0 12px;}
        .part-soc-card{border:1px solid #e2e8f0;border-left:4px solid #1b8253;border-radius:10px;background:#fff;padding:10px 14px;}
        .part-soc-card.is-sim{border-left-color:#16a34a;}
        .part-soc-card.is-nao{border-left-color:#dc2626;}
        .part-soc-card.is-analise{border-left-color:#94a3b8;}
        .part-soc-card label{display:block;font-size:.66rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#64748b;}
        .part-soc-card strong{display:block;margin-top:2px;font-size:1.2rem;color:#105436;font-variant-numeric:tabular-nums;white-space:nowrap;}
        .part-soc-card small{display:block;font-size:.72rem;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .part-soc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;}
        .part-soc-chip{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#334155;font-size:.74rem;font-weight:700;cursor:pointer;white-space:nowrap;}
        .part-soc-chip:hover{border-color:#1b8253;background:#f0fdf4;}
        .part-soc-chip b{font-variant-numeric:tabular-nums;color:#105436;}
        .part-soc-chip.is-on{background:#105436;border-color:#105436;color:#fff;}
        .part-soc-chip.is-on b{color:#fff;}
        .part-soc-chips.is-contas{align-items:center;margin-top:-2px;}
        .part-soc-chips-rot{font-size:.66rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin-right:2px;white-space:nowrap;}
        .part-soc-chips.is-contas .part-soc-chip{height:30px;font-size:.7rem;}
        .part-soc-tab td{vertical-align:top;padding:8px 6px;}
        .part-soc-tab thead th{white-space:normal;line-height:1.2;vertical-align:bottom;padding:6px;}
        .part-soc-tab thead th small{display:block;font-weight:600;opacity:.85;font-size:.62rem;}
        .part-soc-tab td.part-soc-credor{white-space:normal;}
        .part-soc-tab .part-cat-nome{white-space:normal;text-align:left;font-size:.78rem;line-height:1.25;color:#0f3d27;}
        .part-soc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin-top:4px;font-size:.64rem;color:#64748b;font-weight:600;}
        .part-soc-cat{display:inline-block;max-width:100%;padding:1px 8px;border-radius:999px;background:#e7f6ee;color:#105436;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .part-soc-pct{display:block;font-size:.62rem;color:#94a3b8;font-weight:600;}
        .part-soc-tab .part-cat-tot .part-cat-val{font-size:.82rem;color:#105436;}
        .part-soc-escopo{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font:inherit;font-size:.74rem;line-height:1.35;resize:vertical;min-height:44px;white-space:normal;}
        .part-soc-escopo:focus{outline:none;border-color:#1b8253;box-shadow:0 0 0 3px rgba(27,130,83,.15);}
        .part-soc-just{width:100%;height:34px;border:1px solid #cbd5e1;border-radius:8px;font-size:.74rem;font-weight:700;padding:0 8px;background:#f8fafc;color:#475569;}
        .part-soc-just.is-sim{background:#dcfce7;color:#166534;border-color:#86efac;}
        .part-soc-just.is-parcial{background:#fef9c3;color:#854d0e;border-color:#fde047;}
        .part-soc-just.is-nao{background:#fee2e2;color:#991b1b;border-color:#fca5a5;}
        .part-soc-row.is-sim td.part-soc-credor{box-shadow:inset 4px 0 0 #16a34a;}
        .part-soc-row.is-parcial td.part-soc-credor{box-shadow:inset 4px 0 0 #eab308;}
        .part-soc-row.is-nao td.part-soc-credor{box-shadow:inset 4px 0 0 #dc2626;}
        .part-soc-quem{display:block;margin-top:4px;font-size:.6rem;color:#94a3b8;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .part-soc-tirar{border:0;background:transparent;color:#94a3b8;cursor:pointer;padding:6px;display:inline-flex;border-radius:6px;}
        .part-soc-tirar:hover{background:#fee2e2;color:#b91c1c;}
        /* 27/11/2026: compacto para notebook a 100%. */
        .part-soc-cards{gap:8px;margin:2px 0 10px;}
        .part-soc-card{padding:7px 12px;border-radius:8px;}
        .part-soc-card label{font-size:.6rem;}
        .part-soc-card strong{font-size:1.02rem;margin-top:1px;}
        .part-soc-card small{font-size:.66rem;}
        .part-soc-chips{gap:5px;margin:0 0 8px;}
        .part-soc-chip{height:28px;padding:0 10px;gap:6px;font-size:.66rem;}
        .part-soc-chips.is-contas .part-soc-chip{height:26px;font-size:.64rem;}
        .part-soc-tab{font-size:.7rem;}
        .part-soc-tab td{padding:5px 6px;}
        .part-soc-tab thead th{padding:5px 6px;font-size:.66rem;}
        .part-soc-tab thead th small{font-size:.56rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;}
        .part-soc-tab .part-cat-nome{font-size:.72rem;}
        .part-soc-meta{margin-top:2px;font-size:.6rem;gap:2px 6px;}
        .part-soc-tab .part-cat-val{font-size:.7rem;}
        .part-soc-tab .part-cat-tot .part-cat-val{font-size:.74rem;}
        .part-soc-pct{font-size:.56rem;}
        .part-soc-escopo{min-height:32px;padding:5px 8px;font-size:.7rem;}
        .part-soc-just{height:30px;font-size:.68rem;padding:0 6px;}
        .part-soc-quem{font-size:.56rem;margin-top:2px;}
        .part-soc-tirar{padding:4px;}
        /* Tarja de filtros: um painel, uma linha por filtro (SPE e Conta), chips sem borda. */
        .part-soc-filtros{display:flex;flex-direction:column;gap:2px;margin:0 0 10px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;}
        .part-soc-linha{display:flex;align-items:center;gap:8px;min-width:0;}
        .part-soc-linha + .part-soc-linha{border-top:1px solid #edf2ef;}
        .part-soc-filtros .part-soc-chips-rot{flex:0 0 42px;margin:0;font-size:.6rem;color:#94a3b8;}
        .part-soc-filtros .part-soc-chips{flex:1 1 auto;min-width:0;flex-wrap:nowrap;overflow-x:auto;gap:2px;margin:0;padding:3px 0;scrollbar-width:thin;}
        .part-soc-filtros .part-soc-chip{flex:0 0 auto;height:26px;padding:0 10px;gap:6px;border:0;border-radius:7px;background:transparent;color:#334155;font-size:.68rem;font-weight:600;}
        .part-soc-filtros .part-soc-chip:hover{background:#e7f1ec;}
        .part-soc-filtros .part-soc-chip i{font-style:normal;color:#94a3b8;font-weight:700;margin-right:4px;}
        .part-soc-filtros .part-soc-chip b{font-weight:700;color:#64748b;font-size:.64rem;}
        .part-soc-filtros .part-soc-chip.is-on{background:#105436;color:#fff;}
        .part-soc-filtros .part-soc-chip.is-on i,.part-soc-filtros .part-soc-chip.is-on b{color:#d1fae5;}
      </style>
      <div class="part-soc-cards">
        ${card("", "Acumulado " + (this.painelEmp ? "na SPE" : "dos credores"), this.fmt(d.total), (this.painelEmp ? this.esc(this.rotuloEmpresa(this.painelEmp)) : d.empsBase.length + " SPE(s) · " + d.credores.length + " credor(es)") + (this.painelCat ? " · " + this.esc((d.catsBase.find((c) => c.id === this.painelCat) || {}).rot || "") : ""))}
        ${card("is-sim", "Justifica", this.fmt(aval.sim.v + aval.parcial.v), (aval.sim.n + aval.parcial.n) + " credor(es)" + (aval.parcial.n ? " · " + aval.parcial.n + " em parte" : ""))}
        ${card("is-nao", "Não justifica", this.fmt(aval.nao.v), aval.nao.n + " credor(es)")}
        ${card("is-analise", "Em análise", this.fmt(aval[""].v), aval[""].n + " credor(es) · " + marcados + " marcado(s)")}
      </div>
      ${d.empsBase.length || d.catsBase.length ? `<div class="part-soc-filtros">
        ${d.empsBase.length ? `<div class="part-soc-linha"><span class="part-soc-chips-rot">SPE</span><div class="part-soc-chips">${chip("", "Todas", d.totalBase)}${d.empsBase.map((e) => chip(e.emp, this.rotuloEmpresa(e.emp), e.total)).join("")}</div></div>` : ""}
        ${d.catsBase.length ? `<div class="part-soc-linha"><span class="part-soc-chips-rot">Conta</span><div class="part-soc-chips">${chipCat("", "Todas", d.totalCats)}${d.catsBase.filter((c) => c.total || c.id === this.painelCat).map((c) => chipCat(c.id, c.rot, c.total)).join("")}</div></div>` : ""}
      </div>` : ""}
      ${d.credores.length ? `
      <div class="cc-scroll" style="max-height:max(320px, calc(100vh - 330px));">
        <table class="cc-table part-cat-tabela part-soc-tab" style="width:max(100%, ${larg}px);">
          <colgroup><col style="width:230px">${spes.map(() => `<col style="width:104px">`).join("")}<col style="width:112px"><col style="width:230px"><col style="width:150px"><col style="width:34px"></colgroup>
          <thead><tr><th class="part-cat-fixa">Credor</th>${spes.map((e) => `<th class="is-right" title="${this.esc(this.rotuloEmpresa(e))}">SPE ${this.esc(String(e))}<small>${this.esc(String(this.companyLabel(e) || "").toUpperCase())}</small></th>`).join("")}<th class="is-right">Acumulado</th><th>Escopo</th><th>Justifica a cobrança?</th><th></th></tr></thead>
          <tbody>${corpo}</tbody>
          <tfoot><tr><td class="part-cat-fixa">Total</td>${spes.map((e) => `<td class="is-right">${this.fmt(totSpe(e))}</td>`).join("")}<td class="is-right">${this.fmt(d.total)}</td><td colspan="3"></td></tr></tfoot>
        </table>
      </div>` : `<div class="part-empty">Nenhum credor no painel${this.painel ? "" : " (carregando…)"}. Marque a caixa ao lado do credor na aba <strong>Por categoria</strong>.</div>`}`;
  },

  catDetalheHtml() {
    const det = this.catDetalhe;
    if (!det) return "";
    const d = this._catDados || this.catDados();
    const linhas = d.linhas.filter((x) => x.k === det.k && (!det.emp || x.emp === det.emp) && (!det.m || x.m === det.m))
      .sort((a, b) => String(a.r.iso || a.r.date).localeCompare(String(b.r.iso || b.r.date)));
    const total = linhas.reduce((s, x) => s + (Number(x.r.valor) || 0), 0);
    const ci = d.credores.findIndex((c) => c.k === det.k);
    const val = (v, js) => v ? `<button type="button" class="part-cat-val" onclick="${js}">${this.fmt(v)}</button>` : `<span class="part-cat-vazio">—</span>`;
    let sub = "";
    let corpo = "";
    if (det.tipo === "credor") {
      // Meses nas linhas e uma coluna por SPE; cada valor abre os lançamentos daquele mês e SPE.
      const spes = Array.from(new Set(linhas.map((x) => x.emp))).sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
      const meses = Array.from(new Set(linhas.map((x) => x.m))).sort();
      const soma = (m, e) => linhas.filter((x) => (!m || x.m === m) && (!e || x.emp === e)).reduce((s, x) => s + (Number(x.r.valor) || 0), 0);
      sub = "Mês a mês por SPE";
      corpo = `<div class="part-catm-scroll"><table class="cc-table part-catm-tab" style="width:max(100%, ${110 + spes.length * 170 + 130}px);">
        <colgroup><col style="width:110px">${spes.map(() => `<col style="width:170px">`).join("")}<col style="width:130px"></colgroup>
        <thead><tr><th class="part-catm-fixa">Mês</th>${spes.map((e) => `<th class="is-right part-catm-spe" title="${this.esc(this.rotuloEmpresa(e))}">${this.esc(this.rotuloEmpresa(e))}</th>`).join("")}<th class="is-right">Total</th></tr></thead>
        <tbody>${meses.map((m) => `<tr><td class="part-catm-fixa" title="${this.esc(this.periodLabel(m, m))}">${this.esc(this.mesCurto(m))}</td>${spes.map((e) => `<td class="is-right">${val(soma(m, e), `ParticipacoesApp.abrirCatDetalhe('celula', ${ci}, '${this.esc(e)}', '${m}')`)}</td>`).join("")}<td class="is-right"><strong>${this.fmt(soma(m, ""))}</strong></td></tr>`).join("")}</tbody>
        <tfoot><tr><td class="part-catm-fixa">Total</td>${spes.map((e) => `<td class="is-right">${val(soma("", e), `ParticipacoesApp.abrirCatDetalhe('spe', ${ci}, '${this.esc(e)}')`)}</td>`).join("")}<td class="is-right">${this.fmt(total)}</td></tr></tfoot>
      </table></div>`;
    } else {
      sub = [det.emp ? this.rotuloEmpresa(det.emp) : "Todas as SPEs", det.m ? this.mesCurto(det.m) : "Todos os meses"].join(" · ");
      corpo = `<div class="part-catm-scroll"><table class="cc-table part-catm-tab part-catm-lanc">
        <colgroup><col style="width:96px"><col style="width:86px"><col style="width:22%"><col><col style="width:17%"><col style="width:130px"></colgroup>
        <thead><tr><th>Data</th><th>Mês</th><th>Empresa (SPE)</th><th>Detalhe</th><th>Categoria Ellenco</th><th class="is-right">Valor</th></tr></thead>
        <tbody>${linhas.map((x) => `<tr>
          <td>${this.esc(x.r.date || "")}</td>
          <td>${this.esc(this.mesCurto(x.m))}</td>
          <td class="part-catm-quebra">${this.esc(this.rotuloEmpresa(x.emp))}</td>
          <td class="part-catm-quebra">${this.esc(x.r.detalhe || "—")}</td>
          <td class="part-catm-quebra">${this.esc(x.r.categoria || "—")}</td>
          <td class="is-right"><strong>${this.fmt(x.r.valor)}</strong></td>
        </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhum lançamento.</td></tr>`}</tbody>
        ${linhas.length ? `<tfoot><tr><td colspan="5">Total · ${linhas.length} lançamento(s)</td><td class="is-right">${this.fmt(total)}</td></tr></tfoot>` : ""}
      </table></div>`;
    }
    // Um único botão Fechar (no topo). O rodapé só aparece com a ação de voltar para o mês a mês por SPE.
    const voltar = det.tipo !== "credor"
      ? `<footer class="part-catm-rodape"><button type="button" class="btn btn-outline" onclick="ParticipacoesApp.abrirCatDetalhe('credor', ${ci})"><i data-lucide="arrow-left" style="width:16px;height:16px;"></i> Ver mês a mês por SPE</button></footer>` : "";
    return `
      <div class="part-detail-overlay" onclick="if(event.target===this)ParticipacoesApp.fecharCatDetalhe()">
        <div class="part-detail-panel part-catm" role="dialog" aria-modal="true">
          <header>
            <div>
              <h3>${this.esc(det.credor)}</h3>
              <div class="part-catm-sub">${this.esc(sub)} · ${linhas.length} lançamento(s) · <strong>${this.fmt(total)}</strong></div>
            </div>
            <button type="button" class="btn btn-fechar" onclick="ParticipacoesApp.fecharCatDetalhe()">Fechar</button>
          </header>
          <div class="part-detail-body">${corpo}</div>
          ${voltar}
        </div>
      </div>`;
  },

  alternarCredor(i) {
    const g = (this._gruposVisiveis || [])[i];
    if (!g) return;
    const k = g.groupKey;
    this.credorAberto[k] = !this.credorAberto[k];
    this.render();
  },

  abrirTodosCredores(abrir) {
    this.credorAberto = {};
    if (abrir) (this._gruposVisiveis || []).forEach((g) => { this.credorAberto[g.groupKey] = true; });
    this.render();
  },

  /** Janela para escolher o grupo de despesa (nível 3 do grupo 2 do plano financeiro). */
  async escolherCatMl(i, ev) {
    if (ev) ev.stopPropagation();
    const g = (this._gruposVisiveis || [])[i];
    if (!g) return;
    const antigo = document.getElementById("part-catml-modal");
    if (antigo) antigo.remove();
    const atual = this.catMlDe(g.groupKey);
    const contagem = {};
    (g.rows || []).forEach((r) => { const c = r.categoria || "Outras"; contagem[c] = (contagem[c] || 0) + 1; });
    const catEllenco = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]).slice(0, 2).join(", ") || "—";
    const pop = document.createElement("div");
    pop.id = "part-catml-modal";
    pop.innerHTML = `<style>
        #part-catml-modal{position:fixed;inset:0;z-index:9000;background:rgba(12,41,29,.55);display:flex;align-items:center;justify-content:center;padding:16px;}
        #part-catml-modal .pcm-card{width:min(620px,100%);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(15,23,42,.3);overflow:hidden;}
        #part-catml-modal .pcm-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:#105436;}
        #part-catml-modal .pcm-head h3{margin:0;font-size:1rem;color:#fff;}
        #part-catml-modal .pcm-x{border:0;background:transparent;color:#fff;cursor:pointer;padding:4px;display:inline-flex;}
        #part-catml-modal .pcm-body{padding:14px 18px;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:hidden;}
        #part-catml-modal .pcm-credor{border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:10px 12px;}
        #part-catml-modal .pcm-credor strong{display:block;color:#0f172a;font-size:.88rem;}
        #part-catml-modal .pcm-credor span{display:block;margin-top:3px;color:#64748b;font-size:.75rem;}
        #part-catml-modal .pcm-atual{font-size:.78rem;color:#105436;font-weight:700;}
        #part-catml-modal .pcm-busca{height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:0 12px;font-size:.85rem;width:100%;box-sizing:border-box;}
        #part-catml-modal .pcm-lista{border:1px solid #e2e8f0;border-radius:8px;overflow:auto;max-height:46vh;min-height:120px;}
        #part-catml-modal .pcm-grupo{position:sticky;top:0;background:#e7f6ee;color:#105436;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.03em;padding:6px 12px;}
        #part-catml-modal .pcm-item{display:flex;align-items:center;gap:10px;width:100%;border:0;border-bottom:1px solid #f1f5f9;background:#fff;padding:9px 12px;text-align:left;cursor:pointer;font-size:.82rem;color:#1c2e24;}
        #part-catml-modal .pcm-item:hover{background:#f0fdf4;}
        #part-catml-modal .pcm-item.is-sel{background:#dcfce7;font-weight:700;}
        #part-catml-modal .pcm-cod{flex:0 0 64px;font-family:ui-monospace,Consolas,monospace;color:#105436;font-size:.78rem;}
        #part-catml-modal .pcm-ok{margin-left:auto;color:#1b8253;display:none;}
        #part-catml-modal .pcm-item.is-sel .pcm-ok{display:inline-flex;}
        #part-catml-modal .pcm-msg{padding:16px 12px;color:#64748b;font-size:.8rem;}
        #part-catml-modal .pcm-msg.is-erro{color:#b91c1c;}
        #part-catml-modal .pcm-foot{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid #e2e8f0;background:#f8fafc;}
        #part-catml-modal .pcm-foot .btn{height:38px;display:inline-flex;align-items:center;gap:6px;margin:0;}
        #part-catml-modal .pcm-remover{border:0;background:transparent;color:#b91c1c;font-weight:700;font-size:.8rem;cursor:pointer;padding:0;}
        #part-catml-modal .pcm-espaco{flex:1;}
      </style>
      <div class="pcm-card" role="dialog" aria-modal="true" aria-labelledby="part-catml-tit">
        <div class="pcm-head">
          <h3 id="part-catml-tit">Categoria Moura Leite</h3>
          <button type="button" class="pcm-x" data-acao="fechar" aria-label="Fechar"><i data-lucide="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="pcm-body">
          <div class="pcm-credor">
            <strong>${this.esc(g.key)}</strong>
            <span>${(g.rows || []).length} lançamento(s) · ${this.esc(this.fmt(g.total))} · Categoria Ellenco: ${this.esc(catEllenco)}</span>
          </div>
          <div class="pcm-atual">${atual ? "Atual: " + this.esc(this.rotuloCatMl(atual)) : "Sem categoria Moura Leite."}</div>
          <input type="search" class="pcm-busca" id="pcm-busca" placeholder="Buscar pelo código ou nome (ex.: 2.02.02 ou obras)" autocomplete="off" disabled>
          <div class="pcm-lista" id="pcm-lista"><div class="pcm-msg">Carregando o plano financeiro do Sienge...</div></div>
        </div>
        <div class="pcm-foot">
          ${atual ? `<button type="button" class="pcm-remover" data-acao="remover">Remover categoria</button>` : ""}
          <span class="pcm-espaco"></span>
          <button type="button" class="btn btn-secondary" data-acao="fechar">Cancelar</button>
          <button type="button" class="btn btn-primary" id="pcm-salvar" disabled><i data-lucide="check" style="width:14px;height:14px;"></i> Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(pop);
    if (window.lucide) lucide.createIcons();
    const tecla = (e) => { if (e.key === "Escape") fechar(); };
    const fechar = () => { document.removeEventListener("keydown", tecla); pop.remove(); };
    document.addEventListener("keydown", tecla);
    pop.addEventListener("click", (e) => {
      if (e.target === pop) { fechar(); return; }
      const b = e.target.closest("[data-acao]");
      if (b && b.dataset.acao === "fechar") fechar();
    });
    const salvar = pop.querySelector("#pcm-salvar");
    const lista = pop.querySelector("#pcm-lista");
    const busca = pop.querySelector("#pcm-busca");
    const remover = pop.querySelector('[data-acao="remover"]');
    if (remover) remover.addEventListener("click", async () => {
      remover.disabled = true;
      remover.textContent = "Removendo...";
      const ok = await this.gravarCatMl(g.groupKey, null, g.key);
      if (!ok) { remover.disabled = false; remover.textContent = "Remover categoria"; return; }
      fechar();
      this.render();
    });

    const grupos = await this.carregarGruposMl();
    if (!document.body.contains(pop)) return;
    if (!grupos.length) {
      lista.innerHTML = `<div class="pcm-msg is-erro">Não foi possível carregar o plano financeiro do Sienge. Feche e tente de novo em instantes.</div>`;
      return;
    }
    let escolhido = atual ? atual.id : "";
    const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const pintar = () => {
      const q = fold(busca.value).trim();
      const qDig = q.replace(/\D/g, "");
      const vis = grupos.filter((x) => !q || fold(x.id + " " + x.label + " " + x.grupoNome).indexOf(q) >= 0 || (qDig && x.id.replace(/\D/g, "").indexOf(qDig) === 0));
      if (!vis.length) { lista.innerHTML = `<div class="pcm-msg">Nenhuma conta encontrada para essa busca.</div>`; return; }
      let ultimo = "";
      lista.innerHTML = vis.map((x) => {
        const cab = x.grupo !== ultimo ? `<div class="pcm-grupo">${this.esc(x.grupo)}${x.grupoNome ? " - " + this.esc(x.grupoNome) : ""}</div>` : "";
        ultimo = x.grupo;
        return cab + `<button type="button" class="pcm-item${x.id === escolhido ? " is-sel" : ""}" data-id="${this.esc(x.id)}">
            <span class="pcm-cod">${this.esc(x.id)}</span><span>${this.esc(x.label)}</span>
            <span class="pcm-ok"><i data-lucide="check" style="width:16px;height:16px;"></i></span></button>`;
      }).join("");
      if (window.lucide) lucide.createIcons();
    };
    lista.addEventListener("click", (e) => {
      const it = e.target.closest(".pcm-item");
      if (!it) return;
      escolhido = it.dataset.id;
      lista.querySelectorAll(".pcm-item").forEach((el) => el.classList.toggle("is-sel", el.dataset.id === escolhido));
      salvar.disabled = !escolhido || !!(atual && atual.id === escolhido);
    });
    lista.addEventListener("dblclick", (e) => { if (e.target.closest(".pcm-item") && !salvar.disabled) salvar.click(); });
    busca.disabled = false;
    busca.addEventListener("input", pintar);
    pintar();
    busca.focus();
    const sel = lista.querySelector(".pcm-item.is-sel");
    if (sel) sel.scrollIntoView({ block: "center" });
    salvar.addEventListener("click", async () => {
      const item = grupos.find((x) => x.id === escolhido);
      if (!item) return;
      salvar.disabled = true;
      salvar.textContent = "Gravando...";
      const ok = await this.gravarCatMl(g.groupKey, item, g.key);
      if (!ok) { salvar.disabled = false; salvar.textContent = "Salvar"; return; }
      fechar();
      this.render();
    });
  },

  companyItems() {
    return this.elencoCompanies().map((c) => ({
      id: String(c.id),
      label: String(c.id) + " - " + String(this.companyLabel(c.id) || c.name || "").toUpperCase()
    }));
  },

  paintCompany() {
    const box = document.getElementById("part-emp-box");
    if (!box || !window.MlEmpresaFilter) return;
    const selected = this.chosenCompanyIds();
    box.innerHTML = MlEmpresaFilter.html({
      id: "part-emp",
      label: "Empresas",
      items: this.companyItems(),
      selectedIds: selected,
      open: this.companyPickerOpen,
      query: this.companyQ,
      emptyMeansAll: false
    });
    MlEmpresaFilter.bind("part-emp", {
      toggleOpen: () => {
        this.companyPickerOpen = !this.companyPickerOpen;
        this.paintCompany();
      },
      close: () => {
        this.companyPickerOpen = false;
        this.paintCompany();
      },
      setQuery: (q) => {
        this.companyQ = q || "";
        const list = document.getElementById("part-emp-list");
        if (!list) return;
        list.innerHTML = MlEmpresaFilter.listHtml({
          id: "part-emp",
          items: this.companyItems(),
          selectedIds: this.chosenCompanyIds(),
          query: this.companyQ
        });
      },
      toggleId: (id, on) => {
        const cur = new Set(this.chosenCompanyIds());
        if (on) cur.add(String(id));
        else cur.delete(String(id));
        this.companyPickerOpen = true;
        this.setCompanies([...cur]);
      },
      selectAll: () => {
        this.companyPickerOpen = true;
        this.setCompanies(this.elencoCompanies().map((c) => String(c.id)));
      },
      selectNone: () => {
        this.companyPickerOpen = true;
        this.setCompanies([]);
      }
    });
    if (window.lucide) lucide.createIcons();
  }
};

window.ParticipacoesApp = ParticipacoesApp;
