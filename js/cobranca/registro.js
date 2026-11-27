const RegistroApp = {
  CHAVE: "crm_registro_cadastro_v1",
  /**
   * Volume na data da baixa: o recebido na data da quitação é pelo menos esta fração do total recebido no título.
   * Na carteira, a quitação ou fica acima de 60% (pagamento de uma vez) ou abaixo de 10% (última parcela normal).
   */
  VOLUME_MIN: 0.10,

  state: {
    linhas: [],
    arquivo: "",
    quando: "",
    por: "",
    empresas: [],
    empOpen: false,
    empQuery: "",
    sort: "obra",
    dir: 1,
    abertos: {},
    pronto: false
  },

  init() {
    if (!this.state.pronto) {
      this.lerLocal();
      this.state.pronto = true;
    }
    this.render();
    this.carregarPosicao();
    this.lerRemoto();
  },

  /* O último arquivo fica no banco do Integra (coleção registro_cadastro), para toda a equipe e qualquer computador.
     Fica dividido em partes de até 600 mil caracteres por causa do limite de cada documento. */
  COLECAO: "registro_cadastro",

  async esperarBanco() {
    for (let i = 0; i < 40 && !(window.firebaseDb && window.firebaseCollections && window.firebaseCollections.getDoc); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const fc = window.firebaseCollections;
    return window.firebaseDb && fc && fc.getDoc ? fc : null;
  },

  /** Linhas de uma versão gravada: partes "<base>_0..n" (base "atual" nos envios antigos, "arq_<data>" nos novos). */
  async lerPartes(fc, base, partes) {
    let texto = "";
    for (let i = 0; i < (Number(partes) || 0); i++) {
      const parte = await fc.getDoc(fc.doc(window.firebaseDb, this.COLECAO, base + "_" + i));
      texto += String(((parte && parte.data && parte.data()) || {}).dados || "");
    }
    const linhas = JSON.parse(texto || "[]");
    return Array.isArray(linhas) ? linhas : [];
  },

  async lerRemoto() {
    // Enquanto lê o banco, a tela avisa que está carregando (antes mostrava "Nenhum arquivo enviado").
    this.state.lendoRemoto = true;
    if (!this.state.linhas.length) this.render();
    try {
      const fc = await this.esperarBanco();
      if (!fc) return;
      this.lerHistorico(fc);
      const meta = await fc.getDoc(fc.doc(window.firebaseDb, this.COLECAO, "atual"));
      const existe = meta && (typeof meta.exists === "function" ? meta.exists() : meta.exists);
      if (!existe) return;
      const m = meta.data() || {};
      if (!m.quando || (this.state.quando && String(m.quando) <= String(this.state.quando) && this.state.linhas.length)) return;
      const linhas = await this.lerPartes(fc, m.base || "atual", m.partes);
      if (!linhas.length) return;
      this.state.linhas = linhas;
      this.state.arquivo = m.arquivo || "";
      this.state.quando = m.quando || "";
      this.state.por = m.por || "";
      this.state.arquivoUrl = m.arquivoUrl || "";
      this.gravarLocal();
    } catch (e) {
      console.warn("[Registro] leitura do banco", e);
    } finally {
      this.state.lendoRemoto = false;
      this.render();
    }
  },

  /* ---------- Histórico de arquivos ----------
     Cada envio fica guardado (registro_cadastro/historico) com as linhas lidas e, quando possível, o Excel original.
     Subir outro arquivo troca o atual; os anteriores continuam para consulta (Ver) e download (Baixar). */
  async lerHistorico(fc) {
    try {
      const snap = await fc.getDoc(fc.doc(window.firebaseDb, this.COLECAO, "historico"));
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      const itens = existe ? ((snap.data() || {}).itens || []) : [];
      this.state.historico = Array.isArray(itens) ? itens : [];
      this.render();
    } catch (e) {
      console.warn("[Registro] histórico", e);
    }
  },

  async guardarOriginal(file, stamp) {
    const fc = window.firebaseCollections;
    if (!file || !window.firebaseStorage || !fc || typeof fc.ref !== "function" || typeof fc.uploadBytes !== "function" || typeof fc.getDownloadURL !== "function") return "";
    try {
      const nome = String(file.name || "unidades.xlsx").replace(/[^\w.\-()+ ]+/g, "_");
      const ref = fc.ref(window.firebaseStorage, "registro_cadastro/" + stamp + "_" + nome);
      await fc.uploadBytes(ref, file, { contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      return await fc.getDownloadURL(ref);
    } catch (e) {
      console.warn("[Registro] Excel original", e);
      return "";
    }
  },

  async gravarRemoto(file) {
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.setDoc) return false;
    try {
      const stamp = Date.now();
      // Cada envio grava em partes próprias (arq_<data>_n): o arquivo anterior continua inteiro para o histórico.
      const base = "arq_" + stamp;
      const texto = JSON.stringify(this.state.linhas);
      const TAM = 600000;
      const partes = Math.max(1, Math.ceil(texto.length / TAM));
      for (let i = 0; i < partes; i++) {
        await fc.setDoc(fc.doc(window.firebaseDb, this.COLECAO, base + "_" + i), { dados: texto.slice(i * TAM, (i + 1) * TAM) });
      }
      const arquivoUrl = await this.guardarOriginal(file, stamp);
      this.state.arquivoUrl = arquivoUrl;
      const item = { base, arquivo: this.state.arquivo, quando: this.state.quando, por: this.state.por, partes, unidades: this.state.linhas.length, arquivoUrl };
      // Histórico: o envio anterior que ainda não estava nele (os de antes desta versão, em "atual_n") entra primeiro.
      let hist = [];
      try {
        const h = await fc.getDoc(fc.doc(window.firebaseDb, this.COLECAO, "historico"));
        const existe = h && (typeof h.exists === "function" ? h.exists() : h.exists);
        hist = existe ? ((h.data() || {}).itens || []) : [];
      } catch (e) { hist = []; }
      try {
        const ant = await fc.getDoc(fc.doc(window.firebaseDb, this.COLECAO, "atual"));
        const existe = ant && (typeof ant.exists === "function" ? ant.exists() : ant.exists);
        const a = existe ? (ant.data() || {}) : null;
        const baseAnt = a ? (a.base || "atual") : "";
        if (a && a.quando && !hist.some((x) => x.base === baseAnt)) {
          hist.push({ base: baseAnt, arquivo: a.arquivo || "", quando: a.quando, por: a.por || "", partes: Number(a.partes) || 0, unidades: Number(a.unidades) || 0, arquivoUrl: a.arquivoUrl || "" });
        }
      } catch (e) {}
      hist.push(item);
      hist.sort((x, y) => String(y.quando).localeCompare(String(x.quando)));
      await fc.setDoc(fc.doc(window.firebaseDb, this.COLECAO, "historico"), { itens: hist });
      this.state.historico = hist;
      // A ficha principal só é trocada no fim: se o envio parar no meio, continua valendo o arquivo anterior inteiro.
      await fc.setDoc(fc.doc(window.firebaseDb, this.COLECAO, "atual"), item);
      return true;
    } catch (e) {
      console.warn("[Registro] gravação no banco", e);
      return false;
    }
  },

  /** Abre um arquivo do histórico só para consulta (não troca o atual). */
  async verVersao(base) {
    const item = (this.state.historico || []).find((x) => x.base === base);
    if (!item) return;
    const fc = await this.esperarBanco();
    if (!fc) return;
    this.state.lendoRemoto = true;
    this.render();
    try {
      const linhas = await this.lerPartes(fc, item.base, item.partes);
      if (!linhas.length) throw new Error("Este arquivo do histórico não tem linhas gravadas.");
      if (!this.state.versao) this.state.salvoAtual = { linhas: this.state.linhas, arquivo: this.state.arquivo, quando: this.state.quando, por: this.state.por, arquivoUrl: this.state.arquivoUrl };
      this.state.linhas = linhas;
      this.state.arquivo = item.arquivo;
      this.state.quando = item.quando;
      this.state.por = item.por;
      this.state.arquivoUrl = item.arquivoUrl || "";
      this.state.versao = item.base;
      this.state.abertos = {};
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      this.state.lendoRemoto = false;
      this.render();
    }
  },

  voltarAtual() {
    const s = this.state.salvoAtual;
    if (s) Object.assign(this.state, { linhas: s.linhas, arquivo: s.arquivo, quando: s.quando, por: s.por, arquivoUrl: s.arquivoUrl });
    this.state.versao = "";
    this.state.salvoAtual = null;
    this.state.abertos = {};
    this.render();
  },

  historicoHtml() {
    const h = this.state.historico || [];
    if (!h.length) return "";
    const atual = (this.state.salvoAtual && this.state.salvoAtual.quando) || this.state.quando;
    const linhas = h.map((x) => {
      const d = new Date(x.quando);
      const quando = isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const eAtual = x.quando === atual;
      const vendo = this.state.versao === x.base;
      return `<tr${vendo ? ' class="reg-hist-vendo"' : ""}>
        <td>${this.esc(quando)}${eAtual ? ' <span class="reg-hist-tag">atual</span>' : ""}</td>
        <td title="${this.esc(x.arquivo)}">${this.esc(x.arquivo || "—")}</td>
        <td>${this.esc(x.por || "—")}</td>
        <td class="is-right">${this.n(x.unidades || 0)}</td>
        <td class="is-center">${eAtual && !this.state.versao ? "" : `<button type="button" class="reg-hist-btn" onclick="RegistroApp.verVersao('${this.esc(x.base)}')">${vendo ? "Vendo" : "Ver"}</button>`}
          ${x.arquivoUrl ? `<a class="reg-hist-btn" href="${this.esc(x.arquivoUrl)}" target="_blank" rel="noopener">Baixar</a>` : ""}</td>
      </tr>`;
    }).join("");
    return `<details class="reg-hist"${this.state.versao ? " open" : ""}>
      <summary>Histórico de arquivos enviados (${h.length})</summary>
      <div class="cc-scroll" style="max-height:260px;margin-top:8px;">
        <table class="cc-table">
          <colgroup><col style="width:190px"><col><col style="width:220px"><col style="width:90px"><col style="width:140px"></colgroup>
          <thead><tr><th>Enviado em</th><th>Arquivo</th><th>Por</th><th class="is-right">Unidades</th><th class="is-center">Consultar</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
    </details>`;
  },

  /** A posição gravada no Firebase entra nesta aba. Não depende de a tela de estoque ter sido aberta aqui. */
  async carregarPosicao() {
    const app = window.EstoqueComercialApp;
    if (!app) return;
    if (app.state && Array.isArray(app.state.units) && app.state.units.length) return;
    this.state.carregandoPos = true;
    this.render();
    try {
      if (typeof app.loadCache === "function") {
        const local = app.loadCache();
        if (local && Array.isArray(local.units) && local.units.length) {
          if (typeof app.applyCache === "function") app.applyCache(local);
          return;
        }
      }
      if (typeof app.waitFirebase === "function") await app.waitFirebase(8000);
      if (typeof app.loadFirebase === "function") {
        const fb = await app.loadFirebase();
        if (fb && Array.isArray(fb.units) && fb.units.length && typeof app.applyCache === "function") {
          app.applyCache(fb);
          if (typeof app.saveCache === "function") app.saveCache();
        }
      }
    } catch (e) {
      this.state.avisoGravacao = "Não consegui ler a Posição de estoque gravada.";
    } finally {
      this.state.carregandoPos = false;
      this.render();
    }
  },

  lerLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.CHAVE) || "null");
      if (!raw || !Array.isArray(raw.linhas)) return;
      this.state.linhas = raw.linhas;
      this.state.arquivo = raw.arquivo || "";
      this.state.quando = raw.quando || "";
      this.state.por = raw.por || "";
    } catch (e) {}
  },

  async gravar(file) {
    this.gravarLocal();
    const ok = await this.gravarRemoto(file);
    if (!ok) this.state.avisoGravacao = "O arquivo ficou só neste navegador: não consegui gravar no banco do Integra.";
  },

  gravarLocal() {
    const payload = {
      arquivo: this.state.arquivo,
      quando: this.state.quando,
      por: this.state.por,
      linhas: this.state.linhas
    };
    try {
      localStorage.setItem(this.CHAVE, JSON.stringify(payload));
    } catch (e) {}
  },

  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  headerish(s) {
    return String(s || "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
  },

  primeiroTexto(cells, desde) {
    for (let i = desde; i < (cells || []).length; i++) {
      const t = String(cells[i] == null ? "" : cells[i]).trim();
      if (t) return t;
    }
    return "";
  },

  partirRotulo(txt) {
    const s = String(txt || "").trim();
    const m = s.match(/^(\d+)\s*[-–]\s*(.+)$/);
    if (m) return { id: m[1], nome: m[2].trim() };
    const n = s.match(/^(\d+)/);
    return { id: n ? n[1] : "", nome: s };
  },

  /** F financiado, M registrado. C, outra letra ou vazio não informam o registro. */
  letraDe(reg) {
    const s = String(reg || "").trim().toUpperCase();
    if (!s) return "";
    const ch = s.charAt(0);
    if (ch === "F" || ch === "M") return ch;
    return "";
  },

  parseMatrix(matrix) {
    let empresa = "";
    let obra = "";
    let colR = -1;
    const linhas = [];
    (matrix || []).forEach((row) => {
      const cells = row || [];
      const a = this.headerish(cells[0]);
      if (a === "empresa") {
        empresa = this.primeiroTexto(cells, 1);
        return;
      }
      if (a === "empreendimento") {
        obra = this.primeiroTexto(cells, 1);
        return;
      }
      if (a === "unidade") {
        colR = cells.findIndex((c) => this.headerish(c) === "numero do registro");
        return;
      }
      if (!obra || colR < 0) return;
      const unidade = String(cells[0] == null ? "" : cells[0]).trim();
      if (!unidade || this.headerish(unidade) === "unidade") return;
      const emp = this.partirRotulo(empresa);
      const ob = this.partirRotulo(obra);
      if (!ob.id) return;
      linhas.push({
        empresaId: emp.id,
        empresa: emp.nome || empresa,
        obraId: ob.id,
        obra: ob.nome || obra,
        unidade: unidade,
        letra: this.letraDe(cells[colR])
      });
    });
    return linhas;
  },

  chaveUnidade(obraId, nome) {
    let clean = String(nome || "").trim();
    const id = String(obraId || "").replace(/\D/g, "");
    if (id && clean.startsWith(id + " - ")) clean = clean.slice(id.length + 3);
    else if (id && clean.startsWith(id + "-")) clean = clean.slice(id.length + 1);
    else if (id && clean.startsWith(id + " ")) clean = clean.slice(id.length + 1);
    return id + "|" + clean.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  },

  centros() {
    const listas = [];
    if (window.CentrosCustoState && Array.isArray(CentrosCustoState.costCenters) && CentrosCustoState.costCenters.length) {
      listas.push(CentrosCustoState.costCenters);
    }
    try {
      const raw = JSON.parse(localStorage.getItem("crm_cost_centers_data") || "[]");
      if (Array.isArray(raw) && raw.length) listas.push(raw);
    } catch (e) {}
    return listas;
  },

  empresaDoCentro(obraId) {
    const id = String(obraId || "").replace(/\D/g, "");
    if (!id) return "";
    const listas = this.centros();
    for (let i = 0; i < listas.length; i++) {
      const hit = listas[i].find((c) => c && String(c.id).replace(/\D/g, "") === id);
      if (hit) return String(hit.idCompany || hit.companyId || "").replace(/\D/g, "");
    }
    return "";
  },

  nomeEmpresa(id, fallback) {
    const n = String(id || "").replace(/\D/g, "");
    if (fallback) return fallback;
    if (!n) return "Sem empresa";
    if (typeof window.getCompanyName === "function") {
      const curto = window.getCompanyName(n, true);
      if (curto && !/^EMPRESA #/i.test(curto)) return curto;
    }
    return "Empresa " + n;
  },

  rotulo(id, nome) {
    const n = String(nome || "").trim();
    const num = String(id || "").replace(/\D/g, "");
    if (num && n && !n.startsWith(num + " - ") && !n.startsWith(num + " — ")) return num + " - " + n;
    return n || num || "—";
  },

  posicao() {
    const app = window.EstoqueComercialApp;
    if (!app) return { units: [], meta: null };
    if (app.state && Array.isArray(app.state.units) && app.state.units.length) {
      return {
        units: app.state.units,
        meta: {
          date: app.state.fetchedAt || app.state.batimentoDate || "",
          complete: app.state.complete,
          batimentoDone: app.state.batimentoDone
        }
      };
    }
    if (typeof app.loadCache === "function") {
      const data = app.loadCache();
      if (data && Array.isArray(data.units)) return { units: data.units, meta: data };
    }
    return { units: [], meta: null };
  },

  /**
   * Cruza todos os lotes quitados da posição de estoque com a letra do cadastro (sem separar por ano).
   */
  cruzar(linhas, units) {
    const mapa = new Map();
    (linhas || []).forEach((l) => {
      mapa.set(this.chaveUnidade(l.obraId, l.unidade), l);
    });
    const grupos = new Map();
    (units || []).forEach((u) => {
      if (!u) return;
      if (u.relFin === "distratado") return;
      if (!(u.quitado || u.relFin === "quitado")) return;
      const iso = String(u.quitacaoDate || "").slice(0, 10);
      const obraId = String(u.enterpriseId || "").replace(/\D/g, "");
      const hit = mapa.get(this.chaveUnidade(obraId, u.name));
      const letra = hit ? hit.letra : "";
      const empresaId = (hit && hit.empresaId) || this.empresaDoCentro(obraId);
      const empresa = this.nomeEmpresa(empresaId, hit && hit.empresa);
      const obra = (hit && hit.obra) || u.enterpriseName || obraId || "Sem empreendimento";
      const key = String(empresaId || "0") + "|" + (obraId || obra);
      let g = grupos.get(key);
      if (!g) {
        g = {
          key: key,
          empresaId: empresaId,
          empresa: empresa,
          obraId: obraId,
          obra: obra,
          quitados: 0,
          f: 0,
          m: 0,
          vazio: 0,
          fora: 0,
          fin: 0,
          prop: 0,
          conf: 0,
          itens: []
        };
        grupos.set(key, g);
      }
      g.quitados += 1;
      if (letra === "F") g.f += 1;
      else if (letra === "M") g.m += 1;
      else g.vazio += 1;
      if (!hit) g.fora += 1;
      const rec = this.recebidoNaQuitacao(u);
      const origem = letra === "F" ? (rec.volume ? "fin" : "conf") : "prop";
      g[origem] += 1;
      g.itens.push({
        unidade: u.name || (hit && hit.unidade) || "—",
        quando: iso,
        letra: letra,
        fora: !hit,
        valor: rec.valor,
        pct: rec.pct,
        origem: origem
      });
    });
    return { grupos: [...grupos.values()] };
  },

  /**
   * Origem da quitação por título (para as Antecipações): mesma regra do cruzamento acima.
   * Devolve { mapa: Map(título -> { origem: fin|prop|conf, data, unidade, letra }), temRegistro, temPosicao }.
   */
  origemPorTitulo() {
    const linhas = this.state.linhas || [];
    const units = this.posicao().units || [];
    const cad = new Map();
    linhas.forEach((l) => cad.set(this.chaveUnidade(l.obraId, l.unidade), l));
    const out = new Map();
    units.forEach((u) => {
      if (!u || u.relFin === "distratado" || !(u.quitado || u.relFin === "quitado")) return;
      const obraId = String(u.enterpriseId || "").replace(/\D/g, "");
      const hit = cad.get(this.chaveUnidade(obraId, u.name));
      const letra = hit ? hit.letra : "";
      const rec = this.recebidoNaQuitacao(u);
      const info = { origem: letra === "F" ? (rec.volume ? "fin" : "conf") : "prop", data: String(u.quitacaoDate || "").slice(0, 10), unidade: u.name || "", letra };
      [u.receivableBillId, u.contractNumber].forEach((id) => {
        const k = String(id == null ? "" : id).replace(/\D/g, "");
        if (k) out.set(k, info);
      });
    });
    return { mapa: out, temRegistro: linhas.length > 0, temPosicao: units.length > 0 };
  },

  /** Garante o cadastro (último arquivo) e a Posição de estoque em memória, sem abrir a tela do Registro. */
  async garantirDados() {
    if (!this.state.linhas.length) {
      this.lerLocal();
      if (!this.state.linhas.length) await this.lerRemoto();
    }
    if (!(this.posicao().units || []).length) await this.carregarPosicao();
  },

  /** Valor recebido na data da quitação (gravado pelo batimento do estoque) e a fração do total recebido. */
  recebidoNaQuitacao(u) {
    if (!u || u.quitacaoValor == null) return { valor: null, pct: null, volume: false };
    const valor = Number(u.quitacaoValor) || 0;
    const total = Number(u.quitacaoRecebido) || 0;
    const pct = total > 0.009 ? valor / total : null;
    return { valor, pct, volume: pct != null && pct >= this.VOLUME_MIN };
  },

  origemTexto(item) {
    if (item.origem === "fin") return "Financiamento";
    if (item.origem === "prop") return "Recursos próprios";
    return item.valor == null ? "Conferir · sem valor da baixa" : "Conferir · F sem volume na baixa";
  },

  moeda(v) {
    if (v == null) return "—";
    return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },

  ordenar(lista) {
    const campo = this.state.sort || "obra";
    const dir = this.state.dir === -1 ? -1 : 1;
    const num = (v) => Number(String(v || "").replace(/\D/g, "")) || 0;
    return lista.slice().sort((a, b) => {
      let c = 0;
      if (campo === "empresa") c = num(a.empresaId) - num(b.empresaId) || String(a.empresa).localeCompare(String(b.empresa), "pt");
      else if (campo === "obra") c = num(a.obraId) - num(b.obraId) || String(a.obra).localeCompare(String(b.obra), "pt");
      else c = (Number(a[campo]) || 0) - (Number(b[campo]) || 0);
      if (!c) c = num(a.obraId) - num(b.obraId);
      return c * dir;
    });
  },

  toggleSort(campo) {
    if (this.state.sort === campo) this.state.dir = this.state.dir === 1 ? -1 : 1;
    else {
      this.state.sort = campo;
      this.state.dir = campo === "empresa" || campo === "obra" ? 1 : -1;
    }
    this.render();
  },

  toggleGrupo(key) {
    const k = decodeURIComponent(String(key || ""));
    this.state.abertos[k] = !this.state.abertos[k];
    this.render();
  },

  async aoArquivo(input) {
    const file = input && input.files && input.files[0];
    if (input) input.value = "";
    if (!file) return;
    const root = document.getElementById("registro-root");
    if (root) {
      root.innerHTML = `<div class="ml-load"><div class="loading-spinner" aria-hidden="true"></div><div class="loading-status-text">Lendo o cadastro das unidades…</div><div class="ml-load-track"><div class="loading-progress-bar" style="width:40%"></div></div></div>`;
    }
    try {
      if (typeof XLSX === "undefined") throw new Error("A leitura de Excel não está disponível. Atualize a página.");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      const linhas = this.parseMatrix(matrix);
      if (!linhas.length) {
        throw new Error("Este arquivo não é o relatório Unidades por Empreendimento (Dados Cadastrais). A coluna Número do registro não foi encontrada.");
      }
      this.state.linhas = linhas;
      this.state.arquivo = file.name;
      this.state.quando = new Date().toISOString();
      const quem = (window.AppState && window.AppState.currentUser) || {};
      this.state.por = String(quem.name || "").trim();
      this.state.abertos = {};
      this.state.avisoGravacao = "";
      this.state.versao = "";
      this.state.salvoAtual = null;
      await this.gravar(file);
    } catch (e) {
      alert(e.message || String(e));
    }
    this.render();
  },

  th(campo, rotulo) {
    return `<th onclick="RegistroApp.toggleSort('${campo}')" style="cursor:pointer;user-select:none;">${rotulo} <i data-lucide="chevrons-up-down" style="width:11px;vertical-align:middle;"></i></th>`;
  },

  situacao(item) {
    if (item.fora) return "Sem informação · não está no arquivo";
    if (item.letra === "F") return "Financiado";
    if (item.letra === "M") return "Registrado";
    return "Sem informação";
  },

  dataBr(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    if (p.length !== 3) return "—";
    return p[2] + "/" + p[1] + "/" + p[0];
  },

  n(v) {
    return Number(v || 0).toLocaleString("pt-BR");
  },

  itensEmpresa(grupos) {
    const map = new Map();
    (grupos || []).forEach((g) => {
      const id = String(g.empresaId || "");
      if (!id || map.has(id)) return;
      const nome = String(g.empresa || "").trim().toUpperCase();
      map.set(id, { id: id, name: nome, label: id + " - " + nome });
    });
    return [...map.values()].sort((a, b) => Number(a.id) - Number(b.id));
  },

  bindFiltro(itens) {
    if (!window.MlEmpresaFilter) return;
    const app = this;
    MlEmpresaFilter.bind("reg-emp", {
      toggleOpen() {
        app.state.empOpen = !app.state.empOpen;
        app.render();
      },
      setQuery(q) {
        app.state.empQuery = q || "";
        const box = document.getElementById("reg-emp-list");
        if (!box) return;
        box.innerHTML = MlEmpresaFilter.listHtml({
          id: "reg-emp",
          items: itens,
          selectedIds: app.state.empresas,
          query: app.state.empQuery
        });
      },
      toggleId(id, on) {
        const sid = String(id);
        let sel = (app.state.empresas || []).map(String);
        if (on) { if (!sel.includes(sid)) sel.push(sid); }
        else sel = sel.filter((x) => x !== sid);
        if (sel.length && sel.length === itens.length) sel = [];
        app.state.empresas = sel;
        app.render();
      },
      selectAll() {
        app.state.empresas = itens.map((x) => x.id);
        app.render();
      },
      selectNone() {
        app.state.empresas = [];
        app.render();
      }
    });
  },

  exportExcel(grupos) {
    if (!grupos.length) {
      alert("Não há lotes quitados neste filtro para exportar.");
      return;
    }
    if (typeof XLSX === "undefined") {
      alert("A exportação para Excel não está disponível.");
      return;
    }
    const aoa = [["Empresa", "Empreendimento", "Quitados", "Financiado", "Registrado", "Sem informação", "Fora do arquivo", "Financiamento", "Recursos próprios", "Conferir"]];
    const unid = [["Empresa", "Empreendimento", "Unidade", "Quitação", "Situação", "Recebido na quitação", "% do recebido", "Origem"]];
    grupos.forEach((g) => {
      aoa.push([
        this.rotulo(g.empresaId, g.empresa),
        this.rotulo(g.obraId, g.obra),
        g.quitados,
        g.f,
        g.m,
        g.vazio,
        g.fora,
        g.fin,
        g.prop,
        g.conf
      ]);
      (g.itens || []).forEach((it) => {
        unid.push([
          this.rotulo(g.empresaId, g.empresa),
          this.rotulo(g.obraId, g.obra),
          it.unidade,
          this.dataBr(it.quando),
          this.situacao(it),
          it.valor == null ? "" : it.valor,
          it.pct == null ? "" : Math.round(it.pct * 100) / 100,
          this.origemTexto(it)
        ]);
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registro");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(unid), "Unidades");
    XLSX.writeFile(wb, "registro-quitados.xlsx");
  },

  render() {
    const root = document.getElementById("registro-root");
    if (!root) return;
    const linhas = this.state.linhas || [];
    const pos = linhas.length ? this.posicao() : { units: [], meta: null };
    const cruz = linhas.length ? this.cruzar(linhas, pos.units) : { grupos: [] };
    let grupos = cruz.grupos;
    const itens = this.itensEmpresa(grupos);
    const sel = (this.state.empresas || []).map(String);
    if (sel.length) grupos = grupos.filter((g) => sel.includes(String(g.empresaId || "")));
    grupos = this.ordenar(grupos);
    const tot = grupos.reduce((a, g) => {
      a.quitados += g.quitados;
      a.f += g.f;
      a.m += g.m;
      a.vazio += g.vazio;
      a.fora += g.fora;
      a.fin += g.fin;
      a.prop += g.prop;
      a.conf += g.conf;
      return a;
    }, { quitados: 0, f: 0, m: 0, vazio: 0, fora: 0, fin: 0, prop: 0, conf: 0 });
    const pctMin = Math.round(this.VOLUME_MIN * 100);
    const obrasArq = new Set(linhas.map((l) => l.obraId)).size;
    let quando = "";
    if (this.state.quando) {
      const d = new Date(this.state.quando);
      quando = isNaN(d.getTime()) ? this.dataBr(this.state.quando.slice(0, 10))
        : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    const meta = pos.meta || {};
    const posData = this.dataBr(String(meta.batimentoDate || meta.date || "").slice(0, 10));
    const filtro = window.MlEmpresaFilter && itens.length
      ? MlEmpresaFilter.html({
        id: "reg-emp",
        label: "Empresas",
        items: itens,
        selectedIds: this.state.empresas,
        open: this.state.empOpen,
        query: this.state.empQuery,
        emptyMeansAll: true
      })
      : "";
    const avisoPos = !linhas.length ? ""
      : (this.state.carregandoPos
        ? `<p style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#f8fafc;color:#334155;font-size:0.85rem;">Lendo a Posição de estoque gravada…</p>`
        : (!pos.units.length
        ? `<p style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#fff7ed;color:#9a3412;font-size:0.85rem;">O cadastro foi lido, mas a Posição de estoque ainda não está neste navegador. Abra Posição de estoque e conclua o batimento para contar os quitados.</p>`
        : ""));
    const corpo = !linhas.length
      ? (this.state.lendoRemoto
        ? `<div class="ml-load"><div class="loading-spinner" aria-hidden="true"></div><div class="loading-status-text">Carregando o último arquivo enviado…</div></div>`
        : `<p style="color:#64748b;padding:8px 0 0;">Nenhum arquivo enviado.</p>`)
      : (!pos.units.length ? "" : `
        <div class="est-stock-finance" style="margin-bottom:12px;">
          <div class="est-fin-card is-ok"><label>Quitados</label><strong>${this.n(tot.quitados)}</strong><small>Posição de estoque${posData !== "—" ? " · " + posData : ""}</small></div>
          <div class="est-fin-card"><label>Financiado</label><strong>${this.n(tot.f)}</strong><small>Letra F no número do registro</small></div>
          <div class="est-fin-card"><label>Registrado</label><strong>${this.n(tot.m)}</strong><small>Letra M no número do registro</small></div>
          <div class="est-fin-card is-warn"><label>Sem informação</label><strong>${this.n(tot.vazio)}</strong><small>${tot.fora ? this.n(tot.fora) + " não estão no arquivo" : "C, vazio ou ausente no arquivo"}</small></div>
        </div>
        <div class="est-stock-finance" style="margin-bottom:12px;">
          <div class="est-fin-card is-ok"><label>Quitado com financiamento</label><strong>${this.n(tot.fin)}</strong><small>Letra F e ao menos ${pctMin}% do recebido na data da quitação</small></div>
          <div class="est-fin-card"><label>Quitado com recursos próprios</label><strong>${this.n(tot.prop)}</strong><small>Quitação sem a letra F</small></div>
          <div class="est-fin-card is-warn"><label>Conferir</label><strong>${this.n(tot.conf)}</strong><small>Letra F sem volume na data da quitação</small></div>
        </div>
        <div class="cc-scroll">
          <table class="cc-table">
            <thead><tr>
              ${this.th("empresa", "Empresa")}
              ${this.th("obra", "Empreendimento")}
              ${this.th("quitados", "Quitados")}
              ${this.th("f", "Financiado")}
              ${this.th("m", "Registrado")}
              ${this.th("vazio", "Sem informação")}
              ${this.th("fin", "Financiamento")}
              ${this.th("prop", "Recursos próprios")}
              ${this.th("conf", "Conferir")}
            </tr></thead>
            <tbody>
              ${grupos.length ? grupos.map((g) => this.linhaHtml(g)).join("") : `<tr><td colspan="9" style="text-align:center;padding:24px;color:#64748b;">Nenhum lote quitado neste filtro.</td></tr>`}
            </tbody>
          </table>
        </div>`);
    root.innerHTML = `
      <div class="cc-page">
        <p style="margin:0 0 12px;color:#64748b;font-size:0.85rem;line-height:1.45;">Suba o relatório <strong>Unidades por Empreendimento (Dados Cadastrais)</strong> do Sienge. A letra no início de Número do registro classifica a unidade: <strong>F</strong> financiado, <strong>M</strong> registrado, <strong>C</strong> ou vazio sem informação. A contagem usa os lotes quitados da Posição de estoque. A origem dos recursos olha o valor recebido na data da quitação: com <strong>F</strong> e volume na baixa é financiamento; quitação sem <strong>F</strong> é recursos próprios.</p>
        <div class="cc-toolbar">
          <div class="cc-filters">${filtro}</div>
          <div class="cc-toolbar-actions">
            <label class="btn btn-primary" style="height:36px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0;">
              <i data-lucide="upload" style="width:14px;height:14px;"></i> Subir arquivo
              <input type="file" accept=".xlsx,.xls" hidden onchange="RegistroApp.aoArquivo(this)">
            </label>
            <button type="button" class="btn btn-excel" onclick="RegistroApp.exportarAtual()" title="Exportar tabela atual para Excel">
              <i data-lucide="download" style="width:14px;height:14px;"></i> Exportar em Excel
            </button>
          </div>
        </div>
        ${this.state.versao ? `<div class="reg-versao"><span><i data-lucide="history" style="width:14px;height:14px;"></i> Você está vendo um arquivo do histórico (${quando || "—"}). O arquivo atual não mudou.</span><button type="button" class="btn btn-primary" onclick="RegistroApp.voltarAtual()">Voltar ao arquivo atual</button></div>` : ""}
        ${linhas.length ? `<p style="margin:-4px 0 8px;font-size:0.8rem;color:#334155;"><strong>${this.state.versao ? "Arquivo do histórico" : "Última atualização"}:</strong> ${quando || "—"}${this.state.por ? " por " + this.esc(this.state.por) : ""} · ${this.esc(this.state.arquivo)} · ${this.n(linhas.length)} unidades · ${this.n(obrasArq)} empreendimentos${this.state.arquivoUrl ? ` · <a href="${this.esc(this.state.arquivoUrl)}" target="_blank" rel="noopener">baixar o Excel enviado</a>` : ""}</p>` : ""}
        ${this.historicoHtml()}
        ${this.state.avisoGravacao ? `<p style="margin:0 0 12px;font-size:0.8rem;color:#9a3412;">${this.esc(this.state.avisoGravacao)}</p>` : ""}
        ${avisoPos}
        ${corpo}
      </div>`;
    this._grupos = grupos;
    this.bindFiltro(itens);
    if (window.lucide) window.lucide.createIcons();
  },

  linhaHtml(g) {
    const aberto = !!this.state.abertos[g.key];
    const fora = g.fora ? ` title="${this.n(g.fora)} não estão no arquivo"` : "";
    const itens = (g.itens || []).slice().sort((a, b) => String(a.unidade).localeCompare(String(b.unidade), "pt", { numeric: true }));
    const det = aberto ? `<tr><td colspan="9" style="background:#f8fafc;">
      <table class="cc-table" style="margin:4px 0;">
        <thead><tr><th>Unidade</th><th>Quitação</th><th>Situação</th><th>Recebido na quitação</th><th>Origem</th></tr></thead>
        <tbody>${itens.map((it) => `<tr>
          <td>${this.esc(it.unidade)}</td>
          <td>${this.esc(this.dataBr(it.quando))}</td>
          <td>${this.esc(this.situacao(it))}</td>
          <td>${this.esc(this.moeda(it.valor))}${it.pct != null ? ` <small style="color:#64748b;">(${Math.round(it.pct * 100)}% do recebido)</small>` : ""}</td>
          <td>${this.esc(this.origemTexto(it))}</td>
        </tr>`).join("")}</tbody>
      </table>
    </td></tr>` : "";
    return `<tr style="cursor:pointer;" onclick="RegistroApp.toggleGrupo('${encodeURIComponent(g.key)}')">
      <td>${this.esc(this.rotulo(g.empresaId, g.empresa))}</td>
      <td>${this.esc(this.rotulo(g.obraId, g.obra))}</td>
      <td class="is-center">${this.n(g.quitados)}</td>
      <td class="is-center">${this.n(g.f)}</td>
      <td class="is-center">${this.n(g.m)}</td>
      <td class="is-center"${fora}>${this.n(g.vazio)}</td>
      <td class="is-center">${this.n(g.fin)}</td>
      <td class="is-center">${this.n(g.prop)}</td>
      <td class="is-center">${this.n(g.conf)}</td>
    </tr>${det}`;
  },

  exportarAtual() {
    this.exportExcel(this._grupos || []);
  }
};

window.RegistroApp = RegistroApp;

if (typeof document !== "undefined") {
  document.addEventListener("tabChanged", (e) => {
    if (e.detail === "relacionamento_registro") RegistroApp.init();
  });
}
