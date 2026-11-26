/* Log dos documentos do Relacionamento que precisam de assinatura. */
const DocAssinaturaApp = {
  COL: "relacionamento_docs_assinatura",
  LS: "crm_docs_assinatura_v1",
  TIPOS: [
    { id: "distrato", label: "Distrato" },
    { id: "cessao", label: "Cessão de direitos" },
    { id: "aditamento", label: "Aditamento" },
    { id: "vencimento", label: "Alteração de vencimento" },
    { id: "terceiros", label: "Autorização de terceiros" }
  ],
  itens: [],
  vista: "todos",
  tipo: "",
  sortKey: "quando",
  sortDir: "desc",
  carregando: false,
  aviso: "",
  mostrarFinalizados: false,

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  tipoLabel(id) {
    const t = this.TIPOS.find((x) => x.id === id);
    return t ? t.label : String(id || "Documento");
  },

  eu() {
    const u = (typeof window.crmUsuarioAcesso === "function" && window.crmUsuarioAcesso()) || {};
    const nome = String(u.name || u.nome || u.email || "Usuário").replace(/ no usuário .+$/i, "").trim();
    return {
      userId: String(u.id || u.uid || u.email || nome || ""),
      userName: nome || "Usuário",
      userEmail: String(u.email || "").trim().toLowerCase()
    };
  },

  mesmoUsuario(row) {
    const eu = this.eu();
    if (eu.userEmail && row.userEmail && eu.userEmail === String(row.userEmail).toLowerCase()) return true;
    if (eu.userId && row.userId && String(eu.userId) === String(row.userId)) return true;
    return false;
  },

  /* ---------- Documento em aberto e baixa com aprovação do administrador ----------
     Distrato gerado fica "em aberto" até ser lançado no Sienge ou baixado. Enquanto houver um em aberto
     para o título, não se gera outro. A baixa pede justificativa e só vale depois que o administrador aprova. */
  souAdmin() {
    return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin();
  },

  emAberto(row) {
    return !!row && row.status !== "lancado" && row.status !== "baixado";
  },

  tituloNum(v) {
    return String(v == null ? "" : v).replace(/\D/g, "");
  },

  /** Distrato em aberto do título (o mais recente), lido da lista compartilhada. null quando não há. */
  async distratoAbertoDoTitulo(titulo) {
    const t = this.tituloNum(titulo);
    if (!t) return null;
    let lista = null;
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    if (fx && db && fx.getDocs && fx.query && fx.where && fx.collection) {
      try {
        lista = [];
        const snap = await fx.getDocs(fx.query(fx.collection(db, this.COL), fx.where("titulo", "==", t)));
        snap.forEach((d) => lista.push(Object.assign({ id: d.id }, d.data() || {})));
      } catch (e) {
        console.warn("[Assinatura] consulta de distrato em aberto", e);
        lista = null;
      }
    }
    const locais = (this.lerLocal() || []).concat(this.itens || []);
    const todos = (lista || []).concat(locais.filter((r) => r && (!lista || String(r.id || "").indexOf("local-") === 0)));
    const abertos = todos.filter((r) => r && r.tipo === "distrato" && this.tituloNum(r.titulo) === t && this.emAberto(r));
    abertos.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return abertos[0] || null;
  },

  /* ---------- Documentos parados (sprint diário e home) ----------
     Distrato e TCD (termo de cessão de direitos) ainda em aberto, gerados há mais de N dias corridos. */
  DIAS_PARADO: 7,

  /** Carrega a lista em segundo plano (uma vez) e repinta a home quando chegar. */
  prepararParados() {
    if ((this.itens && this.itens.length) || this._carregandoParados) return;
    this._carregandoParados = this.garantirItens().then(() => {
      const hd = window.HomeDashboard;
      const box = document.getElementById("home-op-insights-container");
      if (hd && box && box.style.display !== "none" && typeof hd.renderInsights === "function") {
        try { hd.renderInsights(); } catch (e) {}
      }
    }).catch(() => {}).finally(() => { this._carregandoParados = null; });
  },

  parados(user) {
    this.prepararParados();
    const limite = Date.now() - this.DIAS_PARADO * 86400000;
    const email = String((user && user.email) || "").toLowerCase();
    const nome = this.normNome(user && (user.name || user.nome));
    const doUsuario = (r) => {
      if (!user) return true;
      if (email && r.userEmail && email === String(r.userEmail).toLowerCase()) return true;
      return !!(nome && nome.length > 3 && nome === this.normNome(r.userName));
    };
    const lista = (this.itens || []).filter((r) => {
      if (!r || !this.emAberto(r) || (r.tipo !== "distrato" && r.tipo !== "cessao")) return false;
      const t = new Date(r.createdAt || "").getTime();
      return Number.isFinite(t) && t < limite && doUsuario(r);
    });
    return { distrato: lista.filter((r) => r.tipo === "distrato"), cessao: lista.filter((r) => r.tipo === "cessao") };
  },

  diasDesde(iso) {
    const t = new Date(iso || "").getTime();
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 0;
  },

  /** O documento foi gerado por um operador de cobrança (inclui o back office)? Procura quem gerou no cadastro de usuários. */
  geradoPorOperadorCobranca(r) {
    let users = [];
    try { users = JSON.parse(localStorage.getItem("crm_users") || "[]"); } catch (e) { users = []; }
    if ((!users || !users.length) && window.ConfigUsersApp && Array.isArray(ConfigUsersApp.users)) users = ConfigUsersApp.users;
    const email = String((r && r.userEmail) || "").toLowerCase();
    const nome = this.normNome(r && r.userName);
    const u = (users || []).find((x) => x && ((email && String(x.email || "").toLowerCase() === email)
      || (nome && nome.length > 3 && this.normNome(x.name) === nome)));
    if (!u) return false;
    if (typeof window.isOperadorCobrancaProfile === "function") return window.isOperadorCobrancaProfile(u.profile_name);
    return String(u.profile_name || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes("OPERADOR COBRANCA");
  },

  /** Linhas do sprint: por quem gerou, "x distratos e y TCD com mais de 7 dias". Só operadores de cobrança e back office. */
  linhasSprintParados() {
    const tudo = this.parados(null);
    const porPessoa = new Map();
    tudo.distrato.concat(tudo.cessao).filter((r) => this.geradoPorOperadorCobranca(r)).forEach((r) => {
      const k = String(r.userEmail || r.userName || "—").toLowerCase();
      if (!porPessoa.has(k)) porPessoa.set(k, { nome: r.userName || "—", distrato: 0, cessao: 0 });
      porPessoa.get(k)[r.tipo === "distrato" ? "distrato" : "cessao"] += 1;
    });
    if (!porPessoa.size) return [];
    const plural = (n, s, p) => n + " " + (n === 1 ? s : p);
    const linhas = ["📝 *Documentos para assinar parados há mais de " + this.DIAS_PARADO + " dias*"];
    [...porPessoa.values()].sort((a, b) => (b.distrato + b.cessao) - (a.distrato + a.cessao)).forEach((p) => {
      const partes = [];
      if (p.distrato) partes.push(plural(p.distrato, "distrato", "distratos"));
      if (p.cessao) partes.push(plural(p.cessao, "TCD", "TCD"));
      linhas.push("• " + String(p.nome).toUpperCase() + ": " + partes.join(" e "));
    });
    return linhas;
  },

  modalBaixa(html) {
    let m = document.getElementById("docs-baixa-modal");
    if (!m) {
      m = document.createElement("div");
      m.id = "docs-baixa-modal";
      m.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;";
      document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff;width:min(560px,96vw);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.28);padding:18px;">${html}</div>`;
    m.style.display = "flex";
    return m;
  },

  fecharModalBaixa() {
    const m = document.getElementById("docs-baixa-modal");
    if (m) m.style.display = "none";
  },

  pedirBaixa(id) {
    const chave = decodeURIComponent(String(id || ""));
    const row = (this.itens || []).find((r) => String(r.id) === chave);
    if (!row || !this.emAberto(row)) return;
    if (chave.indexOf("local-") === 0) { alert("Este documento ainda não foi salvo na lista compartilhada. Atualize a tela e tente de novo."); return; }
    this.modalBaixa(`
      <h3 style="margin:0 0 6px;color:#105436;font-size:1.05rem;">Pedir baixa do ${this.esc(this.tipoLabel(row.tipo).toLowerCase())}</h3>
      <div style="font-size:0.85rem;color:#475569;margin-bottom:10px;">${this.esc(this.nomeExibido(row))} · Título ${this.esc(row.titulo)} · gerado em ${this.esc(this.quando(row.createdAt))} por ${this.esc(row.userName || "—")}</div>
      <div style="font-size:0.82rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px 10px;margin-bottom:10px;">A baixa só vale depois que o administrador aprovar. Enquanto isso, não é possível gerar outro distrato para este título.</div>
      <label for="docs-baixa-just" style="font-size:0.72rem;font-weight:700;color:#475569;text-transform:uppercase;">Justificativa</label>
      <textarea id="docs-baixa-just" rows="4" maxlength="1000" style="width:100%;box-sizing:border-box;margin-top:4px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:0.88rem;resize:vertical;" placeholder="Por que este documento deve ser baixado? (ex.: valor errado, cliente desistiu, novo cálculo)"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
        <button type="button" class="btn btn-cancel" onclick="DocAssinaturaApp.fecharModalBaixa()">Cancelar</button>
        <button type="button" class="btn btn-primary" id="docs-baixa-enviar" onclick="DocAssinaturaApp.enviarPedidoBaixa('${encodeURIComponent(chave)}')">Pedir baixa</button>
      </div>`);
    const t = document.getElementById("docs-baixa-just");
    if (t) t.focus();
  },

  async enviarPedidoBaixa(id) {
    const chave = decodeURIComponent(String(id || ""));
    const row = (this.itens || []).find((r) => String(r.id) === chave);
    const el = document.getElementById("docs-baixa-just");
    const just = String((el && el.value) || "").trim();
    if (!row) return;
    if (just.length < 10) { alert("Escreva a justificativa da baixa (pelo menos 10 caracteres)."); if (el) el.focus(); return; }
    const eu = this.eu();
    const baixa = { status: "pendente", justificativa: just, pedidoPor: eu.userName, pedidoPorEmail: eu.userEmail, pedidoEm: new Date().toISOString() };
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    try {
      await fx.updateDoc(fx.doc(db, this.COL, chave), { baixa: baixa });
    } catch (e) {
      console.error("[Assinatura] pedido de baixa", e);
      alert("Não foi possível gravar o pedido de baixa. Tente de novo.");
      return;
    }
    row.baixa = baixa;
    this.gravarLocal(this.lerLocal().map((x) => (String(x.id) === chave ? row : x)));
    this.fecharModalBaixa();
    this.pintar();
  },

  async decidirBaixa(id, aprovar) {
    if (!this.souAdmin()) { alert("Só o administrador aprova a baixa."); return; }
    const chave = decodeURIComponent(String(id || ""));
    const row = (this.itens || []).find((r) => String(r.id) === chave);
    if (!row || !row.baixa || row.baixa.status !== "pendente") return;
    let motivo = "";
    if (!aprovar) {
      motivo = String(prompt("Motivo da recusa da baixa:") || "").trim();
      if (!motivo) return;
    } else {
      const msg = "Aprovar a baixa do " + this.tipoLabel(row.tipo).toLowerCase() + " de " + this.nomeExibido(row) + " (título " + row.titulo + ")?\n\nJustificativa: " + row.baixa.justificativa;
      const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(msg) : confirm(msg);
      if (!ok) return;
    }
    const eu = this.eu();
    const baixa = Object.assign({}, row.baixa, {
      status: aprovar ? "aprovada" : "recusada",
      decididoPor: eu.userName,
      decididoPorEmail: eu.userEmail,
      decididoEm: new Date().toISOString(),
      motivoRecusa: motivo
    });
    const patch = aprovar ? { baixa: baixa, status: "baixado", baixadoEm: baixa.decididoEm } : { baixa: baixa };
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    try {
      await fx.updateDoc(fx.doc(db, this.COL, chave), patch);
    } catch (e) {
      console.error("[Assinatura] decisão da baixa", e);
      alert("Não foi possível gravar a decisão. Tente de novo.");
      return;
    }
    Object.assign(row, patch);
    this.gravarLocal(this.lerLocal().map((x) => (String(x.id) === chave ? row : x)));
    this.pintar();
  },

  situacaoHtml(r) {
    if (r.status === "lancado") return `<span class="docs-sit is-feito">Lançado no Sienge</span>`;
    if (r.status === "baixado") {
      const b = r.baixa || {};
      return `<span class="docs-sit is-feito" title="${this.esc("Baixa aprovada por " + (b.decididoPor || "administrador") + ". Justificativa: " + (b.justificativa || ""))}">Baixado</span>`;
    }
    const b = r.baixa;
    if (b && b.status === "pendente") {
      return `<span class="docs-sit" style="background:#fef3c7;color:#92400e;" title="${this.esc("Pedida por " + (b.pedidoPor || "") + " em " + this.quando(b.pedidoEm) + ". Justificativa: " + (b.justificativa || ""))}">Baixa pedida</span>`;
    }
    if (b && b.status === "recusada") {
      return `<span class="docs-sit" title="${this.esc("Baixa recusada por " + (b.decididoPor || "") + ": " + (b.motivoRecusa || ""))}">Aguardando · baixa recusada</span>`;
    }
    return `<span class="docs-sit">Aguardando</span>`;
  },

  botoesBaixaHtml(r) {
    if (!r || r.tipo !== "distrato" || !this.emAberto(r)) return "";
    const chave = encodeURIComponent(String(r.id));
    if (r.baixa && r.baixa.status === "pendente") {
      if (!this.souAdmin()) return "";
      return `<button type="button" class="btn btn-primary btn-sm" style="padding:3px 8px;font-size:0.72rem;" onclick="DocAssinaturaApp.decidirBaixa('${chave}', true)">Aprovar baixa</button>`
        + `<button type="button" class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:0.72rem;margin-left:4px;" onclick="DocAssinaturaApp.decidirBaixa('${chave}', false)">Recusar</button>`;
    }
    return `<button type="button" class="btn btn-outline btn-sm" style="padding:3px 8px;font-size:0.72rem;" title="Pedir ao administrador a baixa deste distrato, para poder gerar outro" onclick="DocAssinaturaApp.pedirBaixa('${chave}')">Pedir baixa</button>`;
  },

  lerLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.LS) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  },

  gravarLocal(lista) {
    try { localStorage.setItem(this.LS, JSON.stringify(lista.slice(0, 400))); } catch (e) {}
  },

  unir(nuvem, local) {
    const naNuvem = new Set((nuvem || []).map((row) => String(row && row.id || "")).filter(Boolean));
    const map = new Map();
    (local || []).forEach((row) => {
      if (!row) return;
      const id = String(row.id || "");
      if (!id) return;
      if (id.indexOf("local-") !== 0 && !naNuvem.has(id)) return;
      map.set(id, row);
    });
    (nuvem || []).forEach((row) => {
      if (!row) return;
      const id = String(row.id || "");
      if (!id) return;
      map.set(id, row);
    });
    return [...map.values()];
  },

  async registrar(dados) {
    const tipo = String((dados && dados.tipo) || "");
    if (!this.TIPOS.some((t) => t.id === tipo)) return;
    const eu = this.eu();
    const row = {
      id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      tipo,
      tipoLabel: this.tipoLabel(tipo),
      cliente: String((dados && dados.cliente) || "").trim() || "—",
      titulo: String((dados && dados.titulo) || "").trim() || "—",
      unidade: String((dados && dados.unidade) || "").trim() || "—",
      arquivo: String((dados && dados.arquivo) || "").trim(),
      centroId: String((dados && dados.centroId) || "").replace(/\D/g, ""),
      centroNome: String((dados && dados.centroNome) || "").trim(),
      titularId: String((dados && dados.titularId) || "").replace(/\D/g, ""),
      titularNome: String((dados && dados.titularNome) || "").trim(),
      cedenteNome: String((dados && (dados.cedenteNome || dados.titularNome)) || "").trim(),
      cessionario: String((dados && dados.cessionario) || "").trim(),
      plano: String((dados && dados.plano) || ""),
      pdfUrl: "",
      userId: eu.userId,
      userName: eu.userName,
      userEmail: eu.userEmail,
      createdAt: new Date().toISOString(),
      status: "aguardando"
    };
    const local = this.lerLocal();
    local.unshift(row);
    this.gravarLocal(local);
    if (this.itens.length) {
      this.itens.unshift(row);
      if (document.getElementById("tab-relacionamento_assinaturas") && document.getElementById("tab-relacionamento_assinaturas").style.display !== "none") {
        this.pintar();
      }
    }
    try {
      if (!window.firebaseDb || !window.firebaseCollections || !window.firebaseCollections.addDoc) return;
      const { collection, addDoc } = window.firebaseCollections;
      const ref = await addDoc(collection(window.firebaseDb, this.COL), {
        tipo: row.tipo,
        tipoLabel: row.tipoLabel,
        cliente: row.cliente,
        titulo: row.titulo,
        unidade: row.unidade,
        arquivo: row.arquivo,
        centroId: row.centroId,
        centroNome: row.centroNome,
        titularId: row.titularId,
        titularNome: row.titularNome,
        cedenteNome: row.cedenteNome,
        cessionario: row.cessionario,
        plano: row.plano,
        pdfUrl: "",
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        createdAt: row.createdAt,
        status: row.status
      });
      row.id = ref.id;
      const atual = this.lerLocal().map((x) => (x.createdAt === row.createdAt && x.userId === row.userId && x.tipo === row.tipo ? row : x));
      this.gravarLocal(atual);
      await this.guardarPdf(row, dados && dados.bytes);
    } catch (e) {
      console.error("[Assinatura] registro", e);
    }
  },

  async guardarPdf(row, bytes) {
    if (!row || !bytes) return;
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    if (!window.firebaseStorage || !fx || !fx.ref || !fx.uploadBytes || !fx.getDownloadURL) return;
    try {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const blob = new Blob([u8], { type: "application/pdf" });
      const path = "assinaturas/" + String(row.id).replace(/[^\w\-]+/g, "_") + ".pdf";
      const storageRef = fx.ref(window.firebaseStorage, path);
      await fx.uploadBytes(storageRef, blob, { contentType: "application/pdf" });
      row.pdfUrl = await fx.getDownloadURL(storageRef);
      const atual = this.lerLocal().map((x) => (String(x.id) === String(row.id) ? row : x));
      this.gravarLocal(atual);
      const item = this.itens.find((x) => String(x.id) === String(row.id));
      if (item) item.pdfUrl = row.pdfUrl;
      if (db && fx.doc && fx.updateDoc && !String(row.id).startsWith("local-")) {
        await fx.updateDoc(fx.doc(db, this.COL, row.id), { pdfUrl: row.pdfUrl });
      }
      if (document.getElementById("docs-ass-body")) this.pintar();
    } catch (e) {
      console.error("[Assinatura] anexo", e);
    }
  },

  centroDe(row) {
    const salvo = String((row && row.centroId) || "").replace(/\D/g, "");
    if (salvo) return salvo;
    const u = String((row && row.unidade) || "");
    const direto = u.match(/^(\d{4,6})\b/);
    if (direto) return direto[1];
    const unidade = u.match(/U-(\d{4,6})/i);
    if (unidade) return unidade[1];
    return "";
  },

  nomeCentro(id) {
    const salvo = (this.itens || []).find((r) => this.centroDe(r) === String(id) && r.centroNome);
    if (salvo && salvo.centroNome) return String(salvo.centroNome);
    const lista = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const cc = lista.find((c) => String(c.id) === String(id));
    return cc && cc.name ? String(cc.name).toUpperCase() : "";
  },

  async clienteDoTitulo(row) {
    const titulo = String((row && row.titulo) || "").replace(/\D/g, "");
    const lista = window.clientList || [];
    const hit = lista.find((c) => {
      if (!c || !titulo) return false;
      const sale = String(c.saleId || "").replace(/^B-/i, "").split("-")[0].replace(/\D/g, "");
      if (sale === titulo) return true;
      const bills = Array.isArray(c.billIds) ? c.billIds : [];
      return bills.some((b) => String(b || "").replace(/\D/g, "") === titulo);
    });
    if (hit) return hit;
    if (!titulo) return null;
    const bill = await this.siengeGet("/accounts-receivable/receivable-bills/" + encodeURIComponent(titulo));
    if (!bill || typeof bill !== "object") return null;
    const pessoa = bill.customer || bill.client || {};
    const units = bill.units || bill.unit || [];
    const unit = Array.isArray(units) ? units[0] : units;
    return {
      customerId: bill.customerId || bill.clientId || pessoa.id || "",
      saleId: titulo,
      customerName: bill.clientName || bill.customerName || pessoa.name || (row && row.cliente) || "",
      costCenterId: bill.costCenterId || bill.enterpriseId || (unit && (unit.enterpriseId || unit.costCenterId)) || (row && row.centroId) || "",
      unitName: (unit && (unit.name || unit.unitName)) || this.nomeUnidade(row),
      contractId: bill.salesContractId || bill.contractId || "",
      contractNumber: bill.contractNumber || ""
    };
  },

  avalDistrato(row) {
    const titulo = String((row && row.titulo) || "").replace(/\D/g, "");
    if (!titulo || !this._avalDistrato) return null;
    return this._avalDistrato[titulo] || null;
  },

  botaoDistratoHtml(r) {
    if (!r || r.tipo !== "distrato" || !this.emAberto(r)) return "";
    const titulo = String(r.titulo || "").replace(/\D/g, "");
    const chave = encodeURIComponent(String(r.id));
    const aval = this.avalDistrato(r);
    if (aval && aval.ok) {
      return `<button type="button" class="btn btn-primary btn-sm" data-distrato-id="${chave}" data-distrato-titulo="${this.esc(titulo)}" onclick="DocAssinaturaApp.fazerDistrato('${chave}')">Fazer distrato</button>`;
    }
    return `<span class="docs-distrato is-off" data-distrato-id="${chave}" data-distrato-titulo="${this.esc(titulo)}" onmouseenter="DocAssinaturaApp.mostrarCaixaDistrato(this)" onmouseleave="DocAssinaturaApp.esconderCaixaDistrato()"><button type="button" class="btn btn-primary btn-sm" disabled>Fazer distrato</button></span>`;
  },

  caixaDistratoHtml(titulo, aval) {
    const din = typeof window.cancelamentoDinheiro === "function" ? window.cancelamentoDinheiro : (n) => String(n == null ? "—" : n);
    const pct = aval && aval.pct != null
      ? (Number(aval.pct).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%")
      : "—";
    const linha = (rotulo, valor) => `<li><span>${rotulo}</span><b>${this.esc(valor)}</b></li>`;
    const motivos = (aval && aval.motivos || []).map((m) => `<li>${this.esc(m)}</li>`).join("");
    return `<p class="docs-distrato-caixa-t">Título ${this.esc(titulo || "—")}</p>
      <ul class="docs-distrato-sit">
        ${linha("Pago do contrato", pct)}
        ${linha("Valor do contrato", aval && aval.contrato != null ? din(aval.contrato) : "—")}
        ${linha("Valor pago", aval && aval.pago != null ? din(aval.pago) : "—")}
        ${linha("Restituição", aval && aval.restituicao != null ? din(aval.restituicao) : "—")}
        ${linha("Construção", (aval && aval.construcao) || "—")}
      </ul>
      <p class="docs-distrato-porque">Por que o distrato não segue</p>
      <ul class="docs-distrato-motivos">${motivos || "<li>A situação deste título ainda está sendo consultada.</li>"}</ul>`;
  },

  mostrarCaixaDistrato(el) {
    if (!el) return;
    const titulo = el.getAttribute("data-distrato-titulo") || "";
    const aval = this._avalDistrato && this._avalDistrato[titulo];
    let box = document.getElementById("docs-distrato-caixa");
    if (!box) {
      box = document.createElement("div");
      box.id = "docs-distrato-caixa";
      box.className = "docs-distrato-caixa";
      document.body.appendChild(box);
    }
    box.innerHTML = aval
      ? this.caixaDistratoHtml(titulo, aval)
      : `<p class="docs-distrato-caixa-t">Título ${this.esc(titulo || "—")}</p><p class="docs-distrato-porque">Consultando a situação deste título…</p>`;
    box.style.display = "block";
    const r = el.getBoundingClientRect();
    const largura = box.offsetWidth || 340;
    const altura = box.offsetHeight || 180;
    let left = Math.min(window.innerWidth - largura - 8, Math.max(8, r.right - largura));
    let top = r.top - altura - 8;
    if (top < 8) top = Math.min(window.innerHeight - altura - 8, r.bottom + 8);
    box.style.left = left + "px";
    box.style.top = top + "px";
  },

  esconderCaixaDistrato() {
    const box = document.getElementById("docs-distrato-caixa");
    if (box) box.style.display = "none";
  },

  atualizarBotaoDistrato(titulo) {
    const nodes = Array.from(document.querySelectorAll('[data-distrato-titulo="' + titulo + '"]'));
    nodes.forEach((node) => {
      const id = decodeURIComponent(node.getAttribute("data-distrato-id") || "");
      const row = (this.itens || []).find((r) => String(r.id) === id);
      if (!row) return;
      node.outerHTML = this.botaoDistratoHtml(row);
    });
  },

  async avaliarUmDistrato(row) {
    const titulo = String((row && row.titulo) || "").replace(/\D/g, "");
    if (!titulo) return;
    this._avalDistrato = this._avalDistrato || {};
    if (this._avalDistrato[titulo]) return;
    let aval;
    try {
      const client = await this.clienteDoTitulo(row);
      if (!client || !client.customerId || typeof window.cancelamentoMontarExtrato !== "function" || typeof window.cancelamentoPodeSeguir !== "function") {
        aval = { ok: false, motivos: ["Não encontrei o título para calcular o distrato."], construcao: "—", pct: null, pago: null, restituicao: null, contrato: null };
      } else {
        if (!client.costCenterId) client.costCenterId = (row && row.centroId) || this.centroDe(row);
        if (!client.unitName) client.unitName = this.nomeUnidade(row);
        if (!client.saleId) client.saleId = titulo;
        const obra = typeof window.cancelamentoLerConstrucao === "function"
          ? await window.cancelamentoLerConstrucao(client)
          : { temConstrucao: false, incerta: true, texto: "A consulta de construção ainda não retornou." };
        const resumo = await window.cancelamentoMontarExtrato(client);
        const nex = typeof window.clientHasNexCumprida === "function" && window.clientHasNexCumprida(client);
        const pode = window.cancelamentoPodeSeguir({
          contrato: resumo.contrato,
          pago: resumo.pago,
          multa: resumo.multa,
          restituicao: resumo.restituicao,
          pctPago: resumo.pctPago,
          temConstrucao: !!obra.temConstrucao,
          construcaoIncerta: !!obra.incerta,
          nexCumprida: !!nex
        });
        aval = {
          ok: !!pode.ok,
          motivos: pode.motivos || [],
          pct: resumo.pctPago,
          pago: resumo.pago,
          restituicao: resumo.restituicao,
          contrato: resumo.contrato,
          construcao: (obra && obra.texto) || "—"
        };
      }
    } catch (e) {
      aval = { ok: false, motivos: ["Não foi possível consultar a situação deste título."], construcao: "—", pct: null, pago: null, restituicao: null, contrato: null };
    }
    this._avalDistrato[titulo] = aval;
    this.atualizarBotaoDistrato(titulo);
  },

  avaliarDistratosVisiveis() {
    const rows = this.visiveis().filter((r) => r && r.tipo === "distrato" && r.status !== "lancado");
    const novos = [];
    this._avalAndamento = this._avalAndamento || {};
    rows.forEach((r) => {
      const titulo = String(r.titulo || "").replace(/\D/g, "");
      if (!titulo || (this._avalDistrato && this._avalDistrato[titulo]) || this._avalAndamento[titulo]) return;
      this._avalAndamento[titulo] = true;
      novos.push(r);
    });
    if (!novos.length) return;
    this._filaAval = (this._filaAval || []).concat(novos);
    if (this._consumindoAval) return;
    this._consumindoAval = this.consumirAvaliacoes().finally(() => { this._consumindoAval = null; });
  },

  async consumirAvaliacoes() {
    try {
      if (typeof window.ensureFilaSignalsIndex === "function") await window.ensureFilaSignalsIndex();
    } catch (e) {}
    while (this._filaAval && this._filaAval.length) {
      const lote = this._filaAval.splice(0, 3);
      await Promise.all(lote.map((row) => this.avaliarUmDistrato(row)));
    }
  },

  async fazerDistrato(id) {
    const chave = decodeURIComponent(String(id || ""));
    const row = (this.itens || []).find((r) => String(r.id) === chave);
    if (!row || row.tipo !== "distrato" || row.status === "lancado") return;
    const aval = this.avalDistrato(row);
    if (!aval || !aval.ok) return;
    const client = await this.clienteDoTitulo(row);
    if (!client || !client.customerId) {
      alert("Não encontrei o título " + (row.titulo || "") + " para calcular o distrato.");
      return;
    }
    if (typeof window.abrirAvaliacaoDoContrato !== "function") {
      alert("A avaliação do distrato ainda não carregou. Atualize a página.");
      return;
    }
    window.abrirAvaliacaoDoContrato({
      customerId: client.customerId,
      titulo: String(row.titulo || client.saleId || "").replace(/\D/g, ""),
      saleId: client.saleId || String(row.titulo || "").replace(/\D/g, ""),
      nome: client.customerName || row.cliente || "",
      customerName: client.customerName || row.cliente || "",
      costCenterId: client.costCenterId || row.centroId || "",
      unitName: client.unitName || this.nomeUnidade(row),
      unidade: row.unidade || "",
      contractId: client.contractId || "",
      contrato: client.contractNumber || ""
    });
  },

  consultar(id) {
    const chave = decodeURIComponent(String(id || ""));
    const row = (this.itens || []).find((r) => String(r.id) === chave);
    if (row && row.pdfUrl) {
      window.open(row.pdfUrl, "_blank", "noopener");
      return;
    }
    alert("Este PDF não ficou salvo para consulta. Ele foi gerado só no computador de quem criou. Os próximos documentos ficam disponíveis neste botão.");
  },

  async remover(id) {
    const chave = decodeURIComponent(String(id || ""));
    const row = (this.itens || []).find((r) => String(r.id) === chave);
    if (!row) return;
    // Distrato em aberto não some pela lixeira: só com baixa aprovada pelo administrador.
    if (row.tipo === "distrato" && this.emAberto(row) && !this.souAdmin()) {
      alert("Distrato em aberto não pode ser removido. Use Pedir baixa: o administrador aprova a baixa com a justificativa.");
      return;
    }
    const msg = "Remover " + this.tipoLabel(row.tipo) + " de " + (row.cliente || "este cliente") + " da lista?";
    const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(msg) : confirm(msg);
    if (!ok) return;
    this.itens = this.itens.filter((r) => String(r.id) !== chave);
    this.gravarLocal(this.lerLocal().filter((r) => String(r.id) !== chave));
    this.pintar();
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    if (!fx || !db || chave.indexOf("local-") === 0) return;
    try {
      if (fx.deleteDoc && fx.doc) await fx.deleteDoc(fx.doc(db, this.COL, chave));
    } catch (e) {
      console.error("[Assinatura] excluir", e);
    }
    try {
      if (fx.deleteObject && fx.ref && window.firebaseStorage) {
        const path = "assinaturas/" + chave.replace(/[^\w\-]+/g, "_") + ".pdf";
        await fx.deleteObject(fx.ref(window.firebaseStorage, path));
      }
    } catch (e) {}
  },

  async carregar() {
    this.carregando = true;
    this.aviso = "";
    this.pintar();
    let nuvem = [];
    try {
      if (window.firebaseDb && window.firebaseCollections && window.firebaseCollections.getDocs) {
        const { collection, getDocs } = window.firebaseCollections;
        const snap = await getDocs(collection(window.firebaseDb, this.COL));
        snap.forEach((d) => nuvem.push(Object.assign({ id: d.id }, d.data() || {})));
      } else {
        this.aviso = "A lista compartilhada ainda não respondeu. Os documentos desta máquina continuam visíveis.";
      }
    } catch (e) {
      console.error("[Assinatura] leitura", e);
      this.aviso = "Não consegui ler a lista compartilhada. Os documentos desta máquina continuam visíveis.";
    }
    this.itens = this.unir(nuvem, this.lerLocal());
    if (nuvem.length || !this.aviso) this.gravarLocal(this.itens);
    this.carregando = false;
    this.pintar();
    this.reconciliarDistratos();
  },

  abrir() {
    const root = document.getElementById("relacionamento-assinaturas-root");
    if (!root) return;
    if (!root.dataset.pronto) {
      root.dataset.pronto = "1";
      root.innerHTML = `<div id="docs-ass-body"></div>`;
    }
    this.carregar();
  },

  setVista(id) {
    this.vista = id === "meus" ? "meus" : "todos";
    this.pintar();
  },

  setTipo(id) {
    this.tipo = String(id || "");
    this.pintar();
  },

  setFinalizados(on) {
    this.mostrarFinalizados = !!on;
    this.pintar();
  },

  toggleSort(key) {
    if (this.sortKey === key) this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    else {
      this.sortKey = key;
      this.sortDir = key === "quando" ? "desc" : "asc";
    }
    this.pintar();
  },

  visiveis() {
    return this.itens.filter((row) => {
      if (row && !this.emAberto(row) && !this.mostrarFinalizados) return false;
      if (this.tipo && row.tipo !== this.tipo) return false;
      if (this.vista === "meus" && !this.mesmoUsuario(row)) return false;
      return true;
    });
  },

  rotuloUnidade(row) {
    const u = String((row && row.unidade) || "").trim();
    if (!u || u === "—") return "—";
    return u.replace(/^U-/i, "");
  },

  nomeUnidade(row) {
    const u = String((row && row.unidade) || "").trim();
    const cc = this.centroDe(row);
    if (/^U-\d+/i.test(u)) {
      const rest = u.replace(/^U-/i, "");
      if (cc && rest.indexOf(cc + "-") === 0) return rest.slice(cc.length + 1).replace(/-/g, " ");
      const partes = rest.split("-");
      return partes.slice(1).join("-").replace(/-/g, " ") || rest;
    }
    if (u.indexOf(" - ") >= 0) return u.split(" - ").slice(1).join(" - ").trim();
    return u;
  },

  normUn(v) {
    return String(v || "").replace(/[\s-]+/g, "").toUpperCase();
  },

  async temDistratoGravado(row) {
    if (!row || row.tipo !== "distrato") return false;
    const centro = this.centroDe(row);
    const un = this.normUn(this.nomeUnidade(row));
    const titulo = String(row.titulo || "").replace(/\D/g, "");
    if (centro && typeof window.anexosLoadMapaEnvios === "function") {
      this._mapas = this._mapas || {};
      if (!this._mapas[centro]) this._mapas[centro] = await window.anexosLoadMapaEnvios(centro);
      const mapa = this._mapas[centro] || {};
      const noIntegra = Object.keys(mapa).some((k) => {
        const rec = mapa[k];
        if (!rec || String(rec.tag || k.split("_").pop() || "").toUpperCase() !== "DISTRATO") return false;
        const nome = this.normUn(rec.unitName || rec.unidade || "");
        const ids = [rec.contractId, rec.contractNumber, rec.receivableBillId, rec.titulo].map((v) => String(v || "").replace(/\D/g, ""));
        if (titulo && ids.indexOf(titulo) >= 0) return true;
        return !!(un && nome && (nome === un || nome.indexOf(un) >= 0 || un.indexOf(nome) >= 0));
      });
      if (noIntegra) return true;
    }
    if (!centro || !un || typeof window.anexosFindSiengeUnitId !== "function" || typeof window.siengeFetchWithRetry !== "function") return false;
    const cacheKey = centro + "|" + un;
    this._siengeDistrato = this._siengeDistrato || {};
    if (Object.prototype.hasOwnProperty.call(this._siengeDistrato, cacheKey)) return this._siengeDistrato[cacheKey];
    let achou = false;
    try {
      const unitId = await window.anexosFindSiengeUnitId(null, centro, this.nomeUnidade(row));
      if (!unitId) return false;
      const res = await window.siengeFetchWithRetry("/units/" + encodeURIComponent(unitId) + "/attachments?limit=200&offset=0");
      const rows = (res && (res.results || res.data)) || (Array.isArray(res) ? res : []);
      achou = (Array.isArray(rows) ? rows : []).some((a) => /DISTRATO/i.test(String((a && (a.description || a.name || a.fileName)) || "")));
      this._siengeDistrato[cacheKey] = achou;
    } catch (e) {}
    return achou;
  },

  async tituloBaixadoNoSienge(row) {
    if (!row || row.tipo !== "distrato") return false;
    const billId = String(row.titulo || "").replace(/\D/g, "");
    if (!billId || typeof window.siengeFetchWithRetry !== "function") return false;
    this._baixaDistrato = this._baixaDistrato || {};
    if (Object.prototype.hasOwnProperty.call(this._baixaDistrato, billId)) return this._baixaDistrato[billId];
    let achou = false;
    try {
      let bill = null;
      try {
        bill = await window.siengeFetchWithRetry("/accounts-receivable/receivable-bills/" + encodeURIComponent(billId), 1);
      } catch (e) {
        const status = Number(e && e.status) || 0;
        const msg = String((e && e.message) || e || "");
        if (status === 404 || /\b404\b/.test(msg)) {
          this._baixaDistrato[billId] = false;
          return false;
        }
        throw e;
      }
      if (bill && typeof bill === "object") {
        const sit = String(bill.status || bill.situation || "").toUpperCase();
        const cancel = bill.cancellationDate || bill.revokedDate || bill.revokedBillReceivableDate || bill.cancelDate;
        if ((bill.active === false && !bill.payOffDate && !bill.payoffDate) || sit === "CANCELED" || sit === "DISTRATO" || cancel) achou = true;
        if (!achou) {
          const res = await window.siengeFetchWithRetry("/accounts-receivable/receivable-bills/" + encodeURIComponent(billId) + "/installments?limit=200", 1);
          const inst = (res && res.results) || (Array.isArray(res) ? res : []);
          let aberto = 0;
          let baixa = false;
          inst.forEach((p) => {
            aberto += Number(p && (p.currentBalance != null ? p.currentBalance : p.balanceDue)) || 0;
            ((p && p.receipts) || []).forEach((rc) => {
              const off = typeof window.isWriteOffReceipt === "function"
                ? window.isWriteOffReceipt(rc)
                : /distrat|cancel/.test(String((rc && (rc.type || rc.receiptType || "")) || "").toLowerCase());
              if (off) baixa = true;
            });
          });
          if (baixa && aberto <= 0.009) achou = true;
        }
        if (!achou && bill.customerId) {
          const res = await window.siengeFetchWithRetry("/sales-contracts?customerId=" + encodeURIComponent(bill.customerId) + "&situation=3&limit=200", 1);
          const lista = (res && res.results) || [];
          achou = lista.some((c) => String(c.receivableBillId || "").replace(/\D/g, "") === billId);
        }
      }
    } catch (e) {}
    this._baixaDistrato[billId] = achou;
    return achou;
  },

  normNome(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  },

  mesmoNome(a, b) {
    const x = this.normNome(a);
    const y = this.normNome(b);
    if (!x || !y || x === "—" || y === "—") return false;
    if (x === y) return true;
    const curto = x.length <= y.length ? x : y;
    const longo = x.length <= y.length ? y : x;
    return curto.length >= 8 && longo.indexOf(curto) === 0;
  },

  /** Nome do cedente gravado na geração: o titular do título naquele instante. */
  nomeCedente(row) {
    return String((row && (row.cedenteNome || row.titularNome)) || "").trim();
  },

  /* Cessões que o Sienge já concluiu e a troca de titular não apareceu na consulta. */
  CESSOES_CONCLUIDAS: {
    "6306": "2026-10-21T12:00:00-03:00",
    "16303": "2026-10-26T12:00:00-03:00"
  },

  cessaoConcluidaEm(row) {
    const titulo = String((row && row.titulo) || "").replace(/\D/g, "");
    return this.CESSOES_CONCLUIDAS[titulo] || "";
  },

  /** A cessão foi feita quando o titular do título deixou de ser o cedente gravado. */
  cessaoMudou(row, atual) {
    if (!row || !atual) return false;
    const salvo = String(row.titularId || "").replace(/\D/g, "");
    const agora = String(atual.id || "").replace(/\D/g, "");
    if (salvo && agora) return salvo !== agora;
    const base = this.nomeCedente(row) || String(row.cliente || "").trim();
    if (!base || !atual.nome) return false;
    return !this.mesmoNome(base, atual.nome);
  },

  planoDeParcelas(lista) {
    return (lista || []).map((p) => {
      if (!p) return "";
      const id = String(p.installmentId != null ? p.installmentId : (p.installmentNumber != null ? p.installmentNumber : ""));
      const due = String(p.dueDate || p.originalDueDate || "").slice(0, 10);
      const valor = Number(p.originalValue != null ? p.originalValue : (p.originalAmount != null ? p.originalAmount : (p.amount || 0))) || 0;
      return [id, due, valor.toFixed(2)].join(":");
    }).filter(Boolean).sort().join("|");
  },

  datasRemade(lista) {
    const keys = ["remadeDate", "calculationDate", "date", "generatedDate", "negotiationDate", "generationDate", "createdAt", "registerDate"];
    const out = [];
    (lista || []).forEach((item) => {
      if (!item || typeof item !== "object") return;
      for (let i = 0; i < keys.length; i++) {
        const d = String(item[keys[i]] || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          out.push(d);
          break;
        }
      }
    });
    return out;
  },

  datasGeracaoParcelas(lista) {
    const keys = ["generationDate", "generatedDate", "remadeDate", "remadeInstallmentsDate", "createdDate"];
    const out = [];
    (lista || []).forEach((p) => {
      if (!p) return;
      keys.forEach((k) => {
        const d = String(p[k] || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.push(d);
      });
    });
    return out;
  },

  /** Reparcelamento no dia do documento ou depois, ou plano de parcelas diferente do gravado. */
  aditamentoMudou(row, datas, planoAtual) {
    const dia = String((row && row.createdAt) || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && (datas || []).some((d) => String(d).slice(0, 10) >= dia)) return true;
    const salvo = String((row && row.plano) || "");
    const atual = String(planoAtual || "");
    return !!(salvo && atual && salvo !== atual);
  },

  async siengeGet(path) {
    if (typeof window.siengeFetchWithRetry !== "function") return null;
    try {
      return await window.siengeFetchWithRetry(path, 1);
    } catch (e) {
      return null;
    }
  },

  listaSienge(res) {
    if (Array.isArray(res)) return res;
    return (res && (res.results || res.data)) || [];
  },

  async titularAtual(billId) {
    this._titularBill = this._titularBill || {};
    if (Object.prototype.hasOwnProperty.call(this._titularBill, billId)) return this._titularBill[billId];
    const bill = await this.siengeGet("/accounts-receivable/receivable-bills/" + encodeURIComponent(billId));
    if (!bill || typeof bill !== "object") {
      this._titularBill[billId] = null;
      return null;
    }
    const pessoa = bill.customer || bill.client || {};
    const id = String(bill.customerId || bill.clientId || pessoa.id || pessoa.customerId || pessoa.clientId || "").replace(/\D/g, "");
    let nome = String(bill.clientName || bill.customerName || pessoa.name || pessoa.clientName || "").trim();
    if (!nome && id) {
      const cli = await this.siengeGet("/customers/" + encodeURIComponent(id));
      nome = String((cli && (cli.name || cli.clientName)) || "").trim();
    }
    const atual = id ? { id: id, nome: nome } : null;
    this._titularBill[billId] = atual;
    return atual;
  },

  async cessaoLancadaNoSienge(row) {
    if (!row || row.tipo !== "cessao") return false;
    const billId = String(row.titulo || "").replace(/\D/g, "");
    if (!billId) return false;
    const atual = await this.titularAtual(billId);
    return this.cessaoMudou(row, atual);
  },

  async aditamentoLancadoNoSienge(row) {
    if (!row || row.tipo !== "aditamento") return false;
    const billId = String(row.titulo || "").replace(/\D/g, "");
    if (!billId) return false;
    const remade = await this.siengeGet("/remade-installments?billReceivableId=" + encodeURIComponent(billId));
    const datas = this.datasRemade(this.listaSienge(remade));
    let planoAtual = "";
    let datasParcela = [];
    if (row.plano || !datas.length) {
      const res = await this.siengeGet("/accounts-receivable/receivable-bills/" + encodeURIComponent(billId) + "/installments?limit=200");
      const inst = this.listaSienge(res);
      if (inst.length) {
        planoAtual = this.planoDeParcelas(inst);
        datasParcela = this.datasGeracaoParcelas(inst);
      }
    }
    return this.aditamentoMudou(row, datas.concat(datasParcela), planoAtual);
  },

  async marcarLancado(row, quando) {
    if (!row || row.status === "lancado") return;
    row.status = "lancado";
    row.lancadoEm = quando || new Date().toISOString();
    const id = String(row.id || "");
    const patch = { status: "lancado", lancadoEm: row.lancadoEm };
    this.gravarLocal(this.lerLocal().map((x) => (String(x.id) === id ? Object.assign({}, x, patch) : x)));
    const fx = window.firebaseCollections;
    const db = window.firebaseDb;
    if (!fx || !db || !fx.updateDoc || !fx.doc || id.indexOf("local-") === 0) return;
    try { await fx.updateDoc(fx.doc(db, this.COL, id), patch); } catch (e) {}
  },

  async reconciliarDistratos() {
    if (this._reconciliando) return this._reconciliando;
    const pendentes = (this.itens || []).filter((r) => r && r.status !== "lancado" && (r.tipo === "distrato" || r.tipo === "cessao" || r.tipo === "aditamento"));
    this._reconciliando = (async () => {
      for (let i = 0; i < pendentes.length; i++) {
        const row = pendentes[i];
        let gravado = false;
        try {
          if (row.tipo === "distrato") {
            gravado = await this.tituloBaixadoNoSienge(row);
            if (!gravado) gravado = await this.temDistratoGravado(row);
          } else if (row.tipo === "cessao") {
            const concluidaEm = this.cessaoConcluidaEm(row);
            if (concluidaEm) {
              await this.marcarLancado(row, concluidaEm);
              continue;
            }
            gravado = await this.cessaoLancadaNoSienge(row);
          } else if (row.tipo === "aditamento") {
            gravado = await this.aditamentoLancadoNoSienge(row);
          }
        } catch (e) {
          gravado = false;
        }
        if (gravado) await this.marcarLancado(row);
      }
      if (document.getElementById("docs-ass-body")) this.pintar();
    })();
    try { await this._reconciliando; } finally { this._reconciliando = null; }
  },

  nomeExibido(row) {
    if (row && row.tipo === "cessao") return this.nomeCedente(row) || String(row.cliente || "").trim() || "—";
    return String((row && row.cliente) || "").trim() || "—";
  },

  hojeIso() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  },

  somarDias(iso, n) {
    const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
    d.setDate(d.getDate() + n);
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mes + "-" + dia;
  },

  ehFeriado(iso) {
    if (window.EscalaHomeOffice && typeof window.EscalaHomeOffice.ehFeriado === "function") {
      return window.EscalaHomeOffice.ehFeriado(iso);
    }
    const ano = Number(String(iso).slice(0, 4));
    const fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
    return fixos.some((md) => iso === ano + "-" + md);
  },

  ehDiaUtil(iso) {
    const dia = new Date(String(iso).slice(0, 10) + "T12:00:00").getDay();
    if (dia === 0 || dia === 6) return false;
    return !this.ehFeriado(iso);
  },

  /* Dias úteis decorridos depois da emissão, sem contar o próprio dia. */
  diasUteisDesde(iso) {
    const inicio = String(iso || "").slice(0, 10);
    const hoje = this.hojeIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || inicio >= hoje) return 0;
    let n = 0;
    let d = this.somarDias(inicio, 1);
    let guarda = 0;
    while (d <= hoje && guarda < 400) {
      if (this.ehDiaUtil(d)) n += 1;
      d = this.somarDias(d, 1);
      guarda += 1;
    }
    return n;
  },

  dataBr(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    if (p.length < 3 || p[0].length !== 4) return "—";
    return p[2] + "/" + p[1] + "/" + p[0];
  },

  /* 5 e 6: só quem gerou. 7, 9, 11…: o perfil inteiro de quem gerou. */
  marcoAlerta(dias) {
    if (dias === 5 || dias === 6) return "responsavel";
    if (dias >= 7 && (dias - 7) % 2 === 0) return "time";
    return "";
  },

  usuarioEfetivo() {
    const u = (typeof window.crmUsuarioAcesso === "function" && window.crmUsuarioAcesso()) || (window.AppState && window.AppState.currentUser) || null;
    if (!u || !(u.email || u.name || u.nome)) return null;
    return u;
  },

  perfilDe(user) {
    if (!user) return "";
    const direto = String(user.profile_name || user.profile || "").trim();
    if (direto) return direto;
    if (typeof window.findCrmRegisteredUser === "function") {
      const rec = window.findCrmRegisteredUser(user.email || user);
      if (rec && rec.profile_name) return String(rec.profile_name).trim();
    }
    return "";
  },

  mesmoPerfil(a, b) {
    const norm = typeof window.normalizeCrmProfileName === "function"
      ? window.normalizeCrmProfileName
      : (s) => String(s || "").trim().toUpperCase();
    const x = norm(a);
    const y = norm(b);
    return !!(x && y && x === y);
  },

  responsavelDe(row) {
    const lista = typeof window.getCrmUsersList === "function" ? window.getCrmUsersList() : [];
    const email = String((row && row.userEmail) || "").toLowerCase();
    const nome = this.normNome(row && row.userName);
    return lista.find((u) => {
      const em = String((u && u.email) || "").toLowerCase();
      if (email && em && email === em) return true;
      return !!(nome && nome.length > 3 && this.normNome(u && (u.name || u.nome)) === nome);
    }) || null;
  },

  souOResponsavel(row) {
    const eu = this.usuarioEfetivo();
    if (!eu || !row) return false;
    const email = String(eu.email || "").toLowerCase();
    if (email && row.userEmail && email === String(row.userEmail).toLowerCase()) return true;
    const nome = this.normNome(eu.name || eu.nome);
    return !!(nome && nome.length > 3 && nome === this.normNome(row.userName));
  },

  veAlerta(row, marco) {
    if (!marco) return false;
    if (this.souOResponsavel(row)) return true;
    if (marco !== "time") return false;
    const eu = this.usuarioEfetivo();
    const dono = this.responsavelDe(row);
    return this.mesmoPerfil(this.perfilDe(eu), this.perfilDe(dono) || this.perfilDe({ email: row.userEmail, profile_name: "" }));
  },

  chaveAlerta(row, dias) {
    const eu = this.usuarioEfetivo() || {};
    const quem = String(eu.email || eu.name || eu.nome || "op").toLowerCase();
    return "crm_docs_pend_" + quem + "_" + String((row && row.id) || "") + "_" + dias;
  },

  alertaVisto(row, dias) {
    try { return localStorage.getItem(this.chaveAlerta(row, dias)) === "ciente"; } catch (e) { return false; }
  },

  async garantirItens() {
    if (this.itens && this.itens.length) return;
    let nuvem = [];
    try {
      if (window.firebaseDb && window.firebaseCollections && window.firebaseCollections.getDocs) {
        const { collection, getDocs } = window.firebaseCollections;
        const snap = await getDocs(collection(window.firebaseDb, this.COL));
        snap.forEach((d) => nuvem.push(Object.assign({ id: d.id }, d.data() || {})));
      }
    } catch (e) {}
    this.itens = this.unir(nuvem, this.lerLocal());
  },

  pendentesParaAlertar() {
    return (this.itens || []).filter((row) => {
      if (!row || !this.emAberto(row)) return false;
      const dias = this.diasUteisDesde(row.createdAt);
      const marco = this.marcoAlerta(dias);
      if (!marco || this.alertaVisto(row, dias)) return false;
      return this.veAlerta(row, marco);
    }).map((row) => ({ row: row, dias: this.diasUteisDesde(row.createdAt) }));
  },

  async avisarPendentes() {
    if (this._avisando) return this._avisando;
    if (!this.usuarioEfetivo() || document.getElementById("docs-pend-alerta")) return;
    this._avisando = (async () => {
      await this.garantirItens();
      try { await this.reconciliarDistratos(); } catch (e) {}
      const lista = this.pendentesParaAlertar();
      if (!lista.length || document.getElementById("docs-pend-alerta")) return;
      this.abrirAlertaPendentes(lista);
    })();
    try { await this._avisando; } finally { this._avisando = null; }
  },

  fraseAlerta(item) {
    const row = item.row;
    const quem = this.nomeExibido(row);
    const titulo = String(row.titulo || "").trim();
    const doc = this.tipoLabel(row.tipo);
    const quando = this.dataBr(row.createdAt);
    const doCliente = quem && quem !== "—" ? " de " + quem : "";
    const doTitulo = titulo && titulo !== "—" ? ", título " + titulo : "";
    return "O documento " + doc + doCliente + doTitulo + " foi emitido em " + quando + " e não foi concluído no Sienge ainda.";
  },

  abrirAlertaPendentes(lista) {
    if (!lista.length || document.getElementById("docs-pend-alerta")) return;
    const linhas = lista.map((item) => `<p class="docs-pend-item">${this.esc(this.fraseAlerta(item))}</p>`).join("");
    const overlay = document.createElement("div");
    overlay.id = "docs-pend-alerta";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-labelledby", "docs-pend-titulo");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483004;display:flex;align-items:center;justify-content:center;background:rgba(12,41,29,0.55);padding:16px;";
    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 18px 40px rgba(0,0,0,0.22);border:1px solid rgba(16,84,54,0.12);font-family:inherit;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 0;">
        <h2 id="docs-pend-titulo" style="margin:0;font-size:1.05rem;color:#105436;">Documentos sem conclusão no Sienge</h2>
        <button type="button" class="btn btn-fechar" id="docs-pend-fechar">Fechar</button>
      </div>
      <div style="padding:12px 18px 18px;overflow:auto;">
        <div style="display:flex;flex-direction:column;gap:8px;">${linhas}</div>
      </div>
    </div>`;
    const estilo = document.createElement("style");
    estilo.textContent = "#docs-pend-alerta .docs-pend-item{margin:0;padding:10px 12px;border:1px solid #fde68a;border-left:4px solid #d97706;background:#fffbeb;border-radius:10px;color:#1e293b;font-size:0.9rem;line-height:1.45;}";
    overlay.appendChild(estilo);
    document.body.appendChild(overlay);
    overlay.querySelector("#docs-pend-fechar").addEventListener("click", () => this.fecharAlertaPendentes(lista));
  },

  fecharAlertaPendentes(lista) {
    (lista || []).forEach((item) => {
      try { localStorage.setItem(this.chaveAlerta(item.row, item.dias), "ciente"); } catch (e) {}
    });
    const pop = document.getElementById("docs-pend-alerta");
    if (pop) pop.remove();
  },

  ordenar(lista) {
    const dir = this.sortDir === "asc" ? 1 : -1;
    const key = this.sortKey;
    const val = (row) => {
      if (key === "quando") return String(row.createdAt || "");
      if (key === "tipo") return this.tipoLabel(row.tipo);
      if (key === "cliente") return this.nomeExibido(row);
      if (key === "titulo") return String(row.titulo || "");
      if (key === "unidade") return String(row.unidade || "");
      if (key === "quem") return String(row.userName || "");
      return "";
    };
    return lista.slice().sort((a, b) => String(val(a)).localeCompare(String(val(b)), "pt-BR", { numeric: true }) * dir);
  },

  quando(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  },

  th(key, label) {
    return `<th onclick="DocAssinaturaApp.toggleSort('${key}')" style="cursor:pointer;user-select:none;">${label} <i data-lucide="chevrons-up-down" style="width:11px;vertical-align:middle;color:currentColor;"></i></th>`;
  },

  pintar() {
    const body = document.getElementById("docs-ass-body");
    if (!body) return;
    if (this.carregando) {
      body.innerHTML = `
        <div class="ml-load">
          <div class="loading-spinner" aria-hidden="true"></div>
          <div class="loading-status-text">Carregando os documentos…</div>
          <div class="ml-load-track"><div class="loading-progress-bar" style="width:40%"></div></div>
        </div>`;
      return;
    }
    const abas = [
      { id: "todos", label: "Todos", icon: "files" },
      { id: "meus", label: "Gerados por mim", icon: "user" }
    ];
    const tabs = `<div class="ml-tabs" role="tablist">${abas.map((t) => {
      const on = this.vista === t.id;
      return `<button type="button" role="tab" class="ml-tab${on ? " is-active" : ""}" aria-selected="${on ? "true" : "false"}" onclick="DocAssinaturaApp.setVista('${t.id}')"><i data-lucide="${t.icon}"></i> ${t.label}</button>`;
    }).join("")}</div>`;
    const opts = `<option value="">Todos os documentos</option>` + this.TIPOS.map((t) => `<option value="${t.id}"${this.tipo === t.id ? " selected" : ""}>${this.esc(t.label)}</option>`).join("");
    const rows = this.ordenar(this.visiveis());
    const pedidosBaixa = this.souAdmin() ? (this.itens || []).filter((r) => r && this.emAberto(r) && r.baixa && r.baixa.status === "pendente").length : 0;
    const aviso = (this.aviso ? `<p class="docs-aviso">${this.esc(this.aviso)}</p>` : "")
      + (pedidosBaixa ? `<p class="docs-aviso" style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;"><strong>${pedidosBaixa} ${pedidosBaixa === 1 ? "pedido" : "pedidos"} de baixa</strong> aguardando sua aprovação (situação "Baixa pedida").</p>` : "");
    const grupos = new Map();
    rows.forEach((r) => {
      const id = this.centroDe(r) || "";
      if (!grupos.has(id)) grupos.set(id, []);
      grupos.get(id).push(r);
    });
    const ordem = [...grupos.keys()].sort((a, b) => String(a || "￿").localeCompare(String(b || "￿"), "pt-BR", { numeric: true }));
    const linha = (r) => {
      const tem = !!r.pdfUrl;
      const chave = encodeURIComponent(String(r.id));
      const distrato = this.botaoDistratoHtml(r);
      return `<tr>
            <td>${this.esc(this.quando(r.createdAt))}</td>
            <td>${this.esc(this.tipoLabel(r.tipo))}</td>
            <td>${this.esc(this.nomeExibido(r))}</td>
            <td>${this.esc(r.titulo || "—")}</td>
            <td>${this.esc(this.rotuloUnidade(r))}</td>
            <td>${this.esc(r.userName || "—")}${this.mesmoUsuario(r) ? ` <span class="docs-voce">você</span>` : ""}</td>
            <td>${this.situacaoHtml(r)}</td>
            <td class="docs-acoes">${this.botoesBaixaHtml(r)}${distrato}<button type="button" class="tvig-ico" title="${tem ? "Consultar documento" : "PDF não salvo para consulta"}" style="${tem ? "" : "opacity:.35"}" onclick="DocAssinaturaApp.consultar('${chave}')"><i data-lucide="paperclip" style="width:15px;height:15px;"></i></button><button type="button" class="tvig-ico is-danger" title="Remover" onclick="DocAssinaturaApp.remover('${chave}')"><i data-lucide="trash-2" style="width:15px;height:15px;"></i></button></td>
          </tr>`;
    };
    const corpo = ordem.map((id) => {
      const lista = grupos.get(id) || [];
      const nome = id ? this.nomeCentro(id) : "";
      const rotulo = id ? (nome ? id + " - " + nome : id) : "Sem centro de custo";
      return `<tr class="docs-obra"><td colspan="8">${this.esc(rotulo)} <span>${lista.length}</span></td></tr>${lista.map(linha).join("")}`;
    }).join("");
    const tabela = rows.length
      ? `<div class="cc-scroll"><table class="cc-table docs-cc-table">
          <thead><tr>
            ${this.th("quando", "Quando")}
            ${this.th("tipo", "Documento")}
            ${this.th("cliente", "Cliente")}
            ${this.th("titulo", "Título")}
            ${this.th("unidade", "Unidade")}
            ${this.th("quem", "Gerado por")}
            <th>Situação</th>
            <th class="is-center">Ações</th>
          </tr></thead>
          <tbody>${corpo}</tbody>
        </table></div>`
      : `<p class="docs-vazio">Nenhum documento nesta visão.</p>`;
    body.innerHTML = `
      ${aviso}
      <div class="cc-toolbar">
        ${tabs}
        <div class="cc-toolbar-actions">
          <label class="moura-switch docs-finalizados">
            <input type="checkbox" ${this.mostrarFinalizados ? "checked" : ""} onchange="DocAssinaturaApp.setFinalizados(this.checked)" aria-label="Mostrar finalizados">
            <span class="moura-switch-track" aria-hidden="true"></span>
            <span class="moura-switch-text">Mostrar finalizados</span>
          </label>
          <label class="docs-filtro">Documento
            <select class="form-control" onchange="DocAssinaturaApp.setTipo(this.value)">${opts}</select>
          </label>
        </div>
      </div>
      ${tabela}`;
    if (window.lucide && lucide.createIcons) lucide.createIcons();
    if (!this._caixaLigada) {
      this._caixaLigada = true;
      document.addEventListener("scroll", () => this.esconderCaixaDistrato(), true);
    }
    this.avaliarDistratosVisiveis();
  }
};

window.DocAssinaturaApp = DocAssinaturaApp;

document.addEventListener("tabChanged", (e) => {
  if (e.detail === "relacionamento_assinaturas") DocAssinaturaApp.abrir();
});

document.addEventListener("DOMContentLoaded", function () {
  let tentativas = 0;
  const tentar = function () {
    tentativas += 1;
    const app = window.DocAssinaturaApp;
    if (!app || typeof app.avisarPendentes !== "function" || !app.usuarioEfetivo()) {
      if (tentativas < 20) setTimeout(tentar, 1000);
      return;
    }
    app.avisarPendentes();
  };
  setTimeout(tentar, 2500);
});
