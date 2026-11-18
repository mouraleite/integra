/**
 * Contas a Pagar · Cartão de crédito (Clara)
 * Auditoria das despesas do cartão corporativo Clara a partir do JSON exportado da Clara.
 * Regras (mesmas do projeto Cartão Clara da pagadoria):
 *  - estorno/devolução (transactionType REFUND ou valor negativo) é subtraído do bruto;
 *  - lançamento de R$ 0,00 é validação do cartão: conta à parte, não é compra;
 *  - compra internacional e IOF ficam destacados;
 *  - compra sem nota fiscal nem recibo fica como pendência de comprovante (MISSING_EVIDENCE).
 * Os valores são somados em centavos para não perder precisão.
 */
const CartaoClaraApp = {
  DOC: ["cartao_clara", "atual"],
  LOCAL_KEY: "crm_cartao_clara_v1",
  STATUS: { "1": "Autorizada", "2": "Pendente", "3": "Notificada", "4": "Rejeitada", "5": "Em processamento" },
  STATUS_TEXTO: {
    autorizada: "1", authorized: "1", pendente: "2", pending: "2", notificada: "3", notification: "3",
    rejeitada: "4", rejected: "4", "em processamento": "5", processing: "5"
  },

  state: {
    carregado: false,
    carregando: false,
    lendo: false,
    erro: "",
    base: null,
    aba: "auditoria",
    filtro: null
  },

  /* ---------- utilitários ---------- */
  esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  cent(v) {
    const n = typeof v === "number" ? v : Number(String(v == null ? "" : v).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  },

  brl(c) {
    const v = (Number(c) || 0) / 100;
    const s = Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? "-" : "") + "R$ " + s;
  },

  dataBr(iso) {
    const s = String(iso || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : "—";
  },

  hoje() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },

  dataIso(v) {
    const s = String(v || "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[3] + "-" + m[2] + "-" + m[1];
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  },

  /* ---------- leitura do JSON da Clara ---------- */
  /** Aceita o formato do Clara MCP (commerceName, user, documents...) e o formato simples (merchantName, holderName...). */
  normalizarTransacao(raw, idx) {
    const r = raw && typeof raw === "object" ? raw : {};
    const user = r.user && typeof r.user === "object" ? r.user : {};
    const grupos = Array.isArray(user.groupNames) ? user.groupNames : [];
    const tipo = String(r.transactionType || "PURCHASE").toUpperCase();
    const estabelecimento = String(r.commerceName || r.transactionLabel || r.reducedCommerceName || r.merchantName || r.merchant || "Estabelecimento").trim();
    let categoria = r.category || r.portugueseMerchantName || r.englishMerchantName;
    if (!categoria) categoria = tipo === "FEE" ? "Tributos & IOF" : ((r.commerceName && r.merchantName) ? r.merchantName : "Outros");
    const departamento = String(r.department || grupos[0] || user.locationName || "Geral");
    const statusBruto = String(r.status != null ? r.status : (r.operationStatus != null ? r.operationStatus : "1")).trim();
    const status = this.STATUS[statusBruto] ? statusBruto : (this.STATUS_TEXTO[statusBruto.toLowerCase()] || "1");
    const valor = this.cent(r.amount != null ? r.amount : (r.invoiceAmount != null ? r.invoiceAmount : 0));
    const origBruto = r.originalAmount != null ? r.originalAmount : r.originalOperationAmount;
    let moedaOrig = r.originalCurrency || r.originalCurrencyCode || "";
    const descFatura = String(r.invoiceTypeDescription || "").toUpperCase();
    const internacional = r.sameCurrency === false || descFatura.indexOf("INTERNACIONAL") >= 0;
    if (internacional && (!moedaOrig || String(moedaOrig).toUpperCase() === "BRL")) moedaOrig = moedaOrig || "INTL";
    let iof = this.cent(r.iofAmount || 0);
    if (tipo === "FEE" && (estabelecimento + " " + descFatura).toUpperCase().indexOf("IOF") >= 0) iof = Math.abs(valor);
    const docs = Array.isArray(r.documents) ? r.documents : [];
    const arquivo = r.documentFileName || (docs[0] && (docs[0].fileName || docs[0].name)) || "";
    let evidencia = String(r.documentEvidenceStatus || ((r.hasInvoice || r.hasReceipt) ? "ATTACHED" : "MISSING_EVIDENCE"));
    if (evidencia === "NOT_AVAILABLE") evidencia = "EXEMPT";
    return {
      uuid: String(r.transaction_uuid || r.uuid || r.documentId || r.id || ("imp-" + (idx + 1))),
      criado: String(r.createdAt || r.created_at || r.acquirerOperationDatetime || r.operationProcessedDate || r.fileDate || ""),
      estabelecimento,
      cardUuid: String(r.card_uuid || r.cardUuid || ""),
      final: String(r.cardLast4 || r.last4 || r.cardId || "0000").slice(-4),
      portador: String(r.holderName || user.name || r.holder || "Portador não informado").trim(),
      email: String(r.holderEmail || user.email || ""),
      departamento,
      centroCusto: String(r.costCenter || user.locationName || departamento),
      categoria: String(categoria),
      valor,
      moeda: String(r.currency || "BRL"),
      valorOrig: origBruto != null && origBruto !== "" ? this.cent(origBruto) : null,
      moedaOrig: moedaOrig ? String(moedaOrig) : "",
      iof,
      status,
      tipo,
      temNF: !!r.hasInvoice,
      temRecibo: !!r.hasReceipt,
      evidencia,
      arquivo: String(arquivo || "")
    };
  },

  normalizarCartao(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const tipo = String(r.cardType || r.type || "").toUpperCase();
    let corte = r.cutoffDate || r.statementDate || "";
    if (!corte && r.additionalInfo && typeof r.additionalInfo === "object") corte = String(r.additionalInfo.cardBalanceCutoffUpdatedAt || "").slice(0, 10);
    return {
      uuid: String(r.card_uuid || r.uuid || ""),
      portador: String(r.holderName || r.cardUserName || "Portador Clara").trim(),
      email: String(r.holderEmail || r.emailUser || ""),
      apelido: String(r.nickname || r.alias || "Cartão corporativo"),
      final: String(r.last4 || r.maskedPan || "0000").slice(-4),
      tipo: tipo === "PHYSICAL" || tipo === "1" ? "Físico" : "Virtual",
      departamento: String(r.department || "Corporativo"),
      centroCusto: String(r.costCenter || "Geral"),
      limite: this.cent(r.creditLimit != null ? r.creditLimit : (r.threshold || 0)),
      usado: this.cent(r.usedAmount != null ? r.usedAmount : (r.cardBalanceCutoff || 0)),
      corte: String(corte || ""),
      bloqueado: Number(r.status) === 2
    };
  },

  lerJson(texto, nomeArquivo) {
    let parsed;
    try { parsed = JSON.parse(String(texto || "").replace(/^﻿/, "")); } catch (e) { throw new Error("O arquivo não é um JSON válido."); }
    const lista = Array.isArray(parsed) ? parsed : (parsed && (parsed.transactions || parsed.items || parsed.data)) || [];
    if (!Array.isArray(lista) || !lista.length) throw new Error("O JSON precisa ter uma lista de transações (ou os campos transactions, items ou data).");
    const cartoesBrutos = parsed && !Array.isArray(parsed) && Array.isArray(parsed.cards) ? parsed.cards : [];
    const empresa = parsed && !Array.isArray(parsed) ? String(parsed.companyName || (parsed.company && parsed.company.name) || "") : "";
    const transacoes = lista.map((t, i) => this.normalizarTransacao(t, i));
    const datas = transacoes.map((t) => this.dataIso(t.criado)).filter(Boolean).sort();
    const quem = (window.AppState && window.AppState.currentUser) || {};
    return {
      arquivo: String(nomeArquivo || "clara.json"),
      importadoEm: new Date().toISOString(),
      importadoPor: String(quem.name || quem.email || ""),
      empresa,
      inicio: datas[0] || "",
      fim: datas[datas.length - 1] || "",
      transacoes,
      cartoes: cartoesBrutos.map((c) => this.normalizarCartao(c))
    };
  },

  /* ---------- auditoria ---------- */
  classificar(t) {
    const rejeitada = String(t.status) === "4";
    const validacao = t.valor === 0;
    const estorno = (t.tipo === "REFUND" || t.valor < 0) && !validacao;
    const moedaOrig = String(t.moedaOrig || "").toUpperCase();
    const internacional = !!((moedaOrig && moedaOrig !== "BRL") || (t.moeda && String(t.moeda).toUpperCase() !== "BRL") || t.iof > 0);
    let evidencia;
    if (validacao || estorno || rejeitada || t.tipo === "FEE" || t.evidencia === "EXEMPT" || t.evidencia === "NOT_AVAILABLE") evidencia = "EXEMPT";
    else if (t.evidencia === "MISSING_EVIDENCE" || (!t.temNF && !t.temRecibo)) evidencia = "MISSING_EVIDENCE";
    else evidencia = "ATTACHED";
    let tipo = "PURCHASE";
    let valorSinal = t.valor;
    if (estorno) { tipo = "REFUND"; valorSinal = -Math.abs(t.valor); }
    else if (validacao) { tipo = "VALIDATION"; valorSinal = 0; }
    else if (rejeitada) { tipo = "REJECTED"; valorSinal = 0; }
    return { t, tipo, valorSinal, rejeitada, internacional, evidencia, pendente: evidencia === "MISSING_EVIDENCE" };
  },

  filtroPadrao(base) {
    return {
      de: (base && base.inicio) || "",
      ate: (base && base.fim) || "",
      status: ["1", "2", "3", "5"],
      portador: "", departamento: "", categoria: "", comprovante: "", internacional: false, busca: ""
    };
  },

  filtrar(lista, f) {
    const status = new Set(f.status || []);
    const q = String(f.busca || "").trim().toLowerCase();
    return lista.filter((t) => {
      const d = this.dataIso(t.criado);
      if (f.de && d && d < f.de) return false;
      if (f.ate && d && d > f.ate) return false;
      if (!status.has(String(t.status))) return false;
      if (f.portador && t.portador !== f.portador) return false;
      if (f.departamento && t.departamento !== f.departamento) return false;
      if (f.categoria && t.categoria !== f.categoria) return false;
      const c = this.classificar(t);
      if (f.comprovante === "MISSING_EVIDENCE" && !c.pendente) return false;
      if (f.comprovante === "ATTACHED" && c.evidencia !== "ATTACHED") return false;
      if (f.internacional && !c.internacional) return false;
      if (q && [t.estabelecimento, t.portador, t.final, t.categoria, t.departamento, t.centroCusto].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort((a, b) => String(b.criado).localeCompare(String(a.criado)));
  },

  agrupar(classificadas, chave, liquidoTotal) {
    const mapa = new Map();
    classificadas.forEach((c) => {
      if (c.rejeitada) return;
      const k = chave(c.t) || "Não informado";
      if (!mapa.has(k)) mapa.set(k, { nome: k, compras: 0, estornos: 0, bruto: 0, devolvido: 0, liquido: 0, iof: 0, pend: 0, pendValor: 0 });
      const g = mapa.get(k);
      if (c.tipo === "PURCHASE") { g.compras += 1; g.bruto += c.t.valor; g.liquido += c.t.valor; }
      else if (c.tipo === "REFUND") { g.estornos += 1; g.devolvido += Math.abs(c.t.valor); g.liquido -= Math.abs(c.t.valor); }
      g.iof += c.t.iof;
      if (c.pendente) { g.pend += 1; g.pendValor += c.t.valor; }
    });
    return [...mapa.values()].map((g) => Object.assign(g, {
      participacao: liquidoTotal > 0 ? Math.max(0, Math.round(g.liquido / liquidoTotal * 10000) / 100) : 0
    })).sort((a, b) => b.liquido - a.liquido);
  },

  auditar(base, f) {
    const filtradas = this.filtrar((base && base.transacoes) || [], f);
    const cl = filtradas.map((t) => this.classificar(t));
    const s = { bruto: 0, estornos: 0, iof: 0, intlValor: 0, pendValor: 0, compras: 0, validacoes: 0, qtdEstornos: 0, intl: 0, pend: 0 };
    const porDia = new Map();
    const linhas = cl.map((c) => {
      const t = c.t;
      const dia = this.dataIso(t.criado);
      if (c.tipo === "PURCHASE") { s.bruto += t.valor; s.compras += 1; porDia.set(dia, (porDia.get(dia) || 0) + t.valor); }
      else if (c.tipo === "REFUND") { s.estornos += Math.abs(t.valor); s.qtdEstornos += 1; porDia.set(dia, (porDia.get(dia) || 0) - Math.abs(t.valor)); }
      else if (c.tipo === "VALIDATION") s.validacoes += 1;
      if (c.internacional) {
        s.iof += t.iof;
        if (c.tipo === "PURCHASE" && t.tipo !== "FEE") { s.intl += 1; s.intlValor += t.valor; }
      }
      if (c.pendente) { s.pend += 1; s.pendValor += t.valor; }
      const mo = String(t.moedaOrig || "").toUpperCase();
      let cambio = "";
      if (mo && mo !== "BRL" && mo !== "INTL" && t.valorOrig != null) {
        cambio = mo + " " + (t.valorOrig / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (t.iof > 0) cambio += " + IOF " + this.brl(t.iof);
      } else if (mo === "INTL") cambio = "Compra internacional";
      else if (t.iof > 0) cambio = "IOF " + this.brl(t.iof);
      return { c, t, dia, cambio };
    });
    const liquido = s.bruto - s.estornos;
    const porPortador = this.agrupar(cl, (t) => t.portador, liquido);
    const pendentes = porPortador.filter((g) => g.pend > 0).map((g) => ({ nome: g.nome, qtd: g.pend, valor: g.pendValor }))
      .sort((a, b) => (b.qtd - a.qtd) || (b.valor - a.valor));
    return {
      resumo: Object.assign(s, {
        liquido,
        registros: linhas.length,
        conformidade: s.compras > 0 ? Math.round(((s.compras - s.pend) / s.compras) * 1000) / 10 : 100
      }),
      linhas,
      porPortador,
      porDepartamento: this.agrupar(cl, (t) => (t.centroCusto !== t.departamento ? t.centroCusto + " / " + t.departamento : t.departamento), liquido),
      porCategoria: this.agrupar(cl, (t) => t.categoria, liquido),
      pendentes,
      porDia: [...porDia.entries()].filter((e) => e[0]).sort((a, b) => a[0].localeCompare(b[0]))
    };
  },

  /** Cartões do JSON; sem a lista de cartões, monta pelo portador e final das transações. */
  cartoes(base, aud) {
    if (base && base.cartoes && base.cartoes.length) return { completos: true, itens: base.cartoes };
    const mapa = new Map();
    aud.linhas.forEach(({ c, t }) => {
      const k = (t.cardUuid || "") + "|" + t.final + "|" + t.portador;
      if (!mapa.has(k)) mapa.set(k, { portador: t.portador, final: t.final, departamento: t.departamento, compras: 0, liquido: 0, pend: 0 });
      const g = mapa.get(k);
      if (c.tipo === "PURCHASE") { g.compras += 1; g.liquido += t.valor; }
      else if (c.tipo === "REFUND") g.liquido -= Math.abs(t.valor);
      if (c.pendente) g.pend += 1;
    });
    return { completos: false, itens: [...mapa.values()].sort((a, b) => b.liquido - a.liquido) };
  },

  /* ---------- gravação ---------- */
  async carregar() {
    if (this.state.carregando) return;
    this.state.carregando = true;
    let base = null;
    try {
      const fc = window.firebaseCollections;
      if (window.firebaseDb && fc && fc.getDoc) {
        const snap = await fc.getDoc(fc.doc(window.firebaseDb, this.DOC[0], this.DOC[1]));
        const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
        if (existe) base = snap.data() || null;
      }
    } catch (e) {
      console.warn("[Cartão Clara] leitura", e);
    }
    if (!base) {
      try { base = JSON.parse(localStorage.getItem(this.LOCAL_KEY) || "null"); } catch (e) { base = null; }
    }
    if (base && !Array.isArray(base.transacoes)) base = null;
    this.state.base = base;
    this.state.filtro = this.filtroPadrao(base);
    this.state.carregado = true;
    this.state.carregando = false;
  },

  async gravar(base) {
    let nuvem = false;
    try {
      const tamanho = JSON.stringify(base).length;
      const fc = window.firebaseCollections;
      if (tamanho < 900000 && window.firebaseDb && fc && fc.setDoc) {
        await fc.setDoc(fc.doc(window.firebaseDb, this.DOC[0], this.DOC[1]), base);
        nuvem = true;
      }
    } catch (e) {
      console.warn("[Cartão Clara] gravação", e);
    }
    try { localStorage.setItem(this.LOCAL_KEY, JSON.stringify(base)); } catch (e) {}
    return nuvem;
  },

  async aoArquivo(input) {
    const file = input && input.files && input.files[0];
    if (input) input.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { this.state.erro = "O arquivo passa de 20 MB."; this.render(); return; }
    this.state.lendo = true;
    this.state.erro = "";
    this.render();
    try {
      const base = this.lerJson(await file.text(), file.name);
      const nuvem = await this.gravar(base);
      this.state.base = base;
      this.state.filtro = this.filtroPadrao(base);
      this.state.aviso = nuvem ? "" : "O relatório ficou salvo só neste navegador. Para a equipe ver, importe de novo quando a conexão com o banco do Integra voltar.";
      if (typeof window.logCrmAudit === "function") {
        window.logCrmAudit({ action: "CARTAO_CLARA_IMPORTADO", module: "Cartão de crédito", status: "ok", summary: base.arquivo + " · " + base.transacoes.length + " transação(ões)" });
      }
    } catch (e) {
      this.state.erro = (e && e.message) || String(e);
    }
    this.state.lendo = false;
    this.render();
  },

  /* ---------- filtros e abas ---------- */
  setAba(aba) {
    this.state.aba = ["auditoria", "agrupamentos", "cartoes", "fechamento"].indexOf(aba) >= 0 ? aba : "auditoria";
    this.render();
  },

  setFiltro(campo, valor) {
    const f = this.state.filtro;
    if (!f) return;
    if (campo === "status") {
      const set = new Set(f.status);
      if (set.has(valor)) set.delete(valor); else set.add(valor);
      f.status = [...set];
    } else if (campo === "internacional") f.internacional = !!valor;
    else f[campo] = String(valor || "");
    if (campo === "busca") {
      clearTimeout(this._tBusca);
      this._tBusca = setTimeout(() => this.render(true), 350);
      return;
    }
    this.render();
  },

  limparFiltros() {
    this.state.filtro = this.filtroPadrao(this.state.base);
    this.render();
  },

  /* ---------- exportação ---------- */
  textoMarkdown(aud) {
    const s = aud.resumo;
    const f = this.state.filtro;
    const empresa = (this.state.base && this.state.base.empresa) || "Moura Leite";
    const L = [
      "# Fechamento e auditoria de despesas do cartão — " + empresa,
      "",
      "No período de **" + this.dataBr(f.de) + "** a **" + this.dataBr(f.ate) + "**, o total líquido gasto foi de **" + this.brl(s.liquido) + "** (bruto de **" + this.brl(s.bruto) + "** com **" + this.brl(s.estornos) + "** em estornos e devoluções), em **" + s.compras + " compras efetivas**. Houve **" + s.validacoes + " validações de cartão (R$ 0,00)** à parte, **" + s.intl + " compras internacionais** (IOF: **" + this.brl(s.iof) + "**) e **" + s.pend + " compras sem comprovante** somando **" + this.brl(s.pendValor) + "**.",
      "",
      "## Transações auditadas",
      "",
      "| Data | Estabelecimento | Portador / Cartão | Valor (R$) | Comprovante |",
      "| :--- | :--- | :--- | ---: | :--- |"
    ];
    const lim = (v) => String(v || "").replace(/\|/g, "/");
    aud.linhas.forEach(({ c, t, cambio }) => {
      let est = t.estabelecimento + (cambio ? " (" + cambio + ")" : "");
      if (c.tipo === "VALIDATION") est += " [Validação R$ 0,00]";
      else if (c.tipo === "REFUND") est += " [Estorno]";
      const ev = c.evidencia === "MISSING_EVIDENCE" ? "Pendente" : (c.evidencia === "EXEMPT" ? "Isento (validação/estorno)" : "Anexado (" + (t.arquivo || "OK") + ")");
      L.push("| " + this.dataBr(this.dataIso(t.criado)) + " | " + lim(est) + " | " + lim(t.portador) + " (•••• " + t.final + ") | " + this.brl(c.valorSinal) + " | " + lim(ev) + " |");
    });
    const tabela = (titulo, col, itens) => {
      L.push("", "## " + titulo, "", "| " + col + " | Compras | Líquido (R$) | Estornos (R$) | IOF (R$) | Sem comprovante |", "| :--- | ---: | ---: | ---: | ---: | ---: |");
      itens.forEach((g) => L.push("| " + lim(g.nome) + " | " + g.compras + " | " + this.brl(g.liquido) + " | " + this.brl(g.devolvido) + " | " + this.brl(g.iof) + " | " + g.pend + " |"));
    };
    tabela("Por portador", "Portador", aud.porPortador);
    tabela("Por centro de custo / departamento", "Centro de custo / Depto", aud.porDepartamento);
    tabela("Por categoria de despesa", "Categoria", aud.porCategoria);
    L.push("", "## Comprovantes pendentes", "");
    if (!aud.pendentes.length) L.push("- Nenhuma compra sem comprovante no período.");
    else aud.pendentes.forEach((p) => L.push("- **" + p.nome + "**: " + p.qtd + " comprovante(s) pendente(s), " + this.brl(p.valor)));
    return L.join("\n") + "\n";
  },

  baixar(nome, conteudo, tipo) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  sufixo() {
    const f = this.state.filtro || {};
    return (f.de || "") + "_a_" + (f.ate || "");
  },

  exportarMarkdown() {
    const aud = this.auditar(this.state.base, this.state.filtro);
    this.baixar("cartao-clara_" + this.sufixo() + ".md", this.textoMarkdown(aud), "text/markdown;charset=utf-8");
  },

  async copiarMarkdown() {
    const aud = this.auditar(this.state.base, this.state.filtro);
    try {
      await navigator.clipboard.writeText(this.textoMarkdown(aud));
      this.state.copiado = true;
      this.render();
      setTimeout(() => { this.state.copiado = false; this.render(); }, 1800);
    } catch (e) {
      alert("Não foi possível copiar. Use Baixar .md.");
    }
  },

  exportarCsv() {
    const aud = this.auditar(this.state.base, this.state.filtro);
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const cab = ["Data", "Estabelecimento", "Portador", "Cartão (final)", "Departamento", "Centro de custo", "Categoria", "Tipo", "Status", "Valor (R$)", "IOF (R$)", "Moeda / observação", "Comprovante"];
    const linhas = aud.linhas.map(({ c, t, cambio }) => [
      this.dataBr(this.dataIso(t.criado)), t.estabelecimento, t.portador, t.final, t.departamento, t.centroCusto, t.categoria,
      this.rotuloTipo(c.tipo), this.STATUS[t.status] || t.status, (c.valorSinal / 100).toFixed(2).replace(".", ","), (t.iof / 100).toFixed(2).replace(".", ","), cambio, this.rotuloEvidencia(c.evidencia)
    ].map(q).join(";"));
    this.baixar("cartao-clara_" + this.sufixo() + ".csv", "﻿" + [cab.map(q).join(";")].concat(linhas).join("\r\n"), "text/csv;charset=utf-8");
  },

  async exportarExcel() {
    if (!window.ExcelJS) { alert("Não foi possível gerar o Excel. Recarregue a página."); return; }
    const aud = this.auditar(this.state.base, this.state.filtro);
    const s = aud.resumo;
    const f = this.state.filtro;
    const wb = new ExcelJS.Workbook();
    const cabecalho = (ws) => {
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B8253" } };
    };
    const moeda = '"R$" #,##0.00;-"R$" #,##0.00';
    const r = wb.addWorksheet("Resumo");
    r.columns = [{ header: "Indicador", key: "a", width: 44 }, { header: "Valor", key: "b", width: 30 }];
    cabecalho(r);
    [
      ["Empresa", (this.state.base && this.state.base.empresa) || "Moura Leite"],
      ["Período", this.dataBr(f.de) + " até " + this.dataBr(f.ate)],
      ["Total líquido gasto", s.liquido / 100],
      ["Total bruto em compras", s.bruto / 100],
      ["Estornos e devoluções", s.estornos / 100],
      ["Compras efetivas", s.compras],
      ["Validações de cartão (R$ 0,00)", s.validacoes],
      ["Compras internacionais", s.intl],
      ["Total de IOF", s.iof / 100],
      ["Compras sem comprovante", s.pend],
      ["Valor sem comprovante", s.pendValor / 100],
      ["Conformidade (%)", s.conformidade]
    ].forEach((l, i) => {
      const row = r.addRow({ a: l[0], b: l[1] });
      row.getCell(1).font = { bold: true };
      if ([2, 3, 4, 8, 10].indexOf(i) >= 0) row.getCell(2).numFmt = moeda;
    });
    const t = wb.addWorksheet("Transações");
    t.columns = [
      { header: "Data", key: "d", width: 12 }, { header: "Estabelecimento", key: "e", width: 34 }, { header: "Portador", key: "p", width: 28 },
      { header: "Final", key: "f", width: 8 }, { header: "Centro de custo", key: "cc", width: 20 }, { header: "Departamento", key: "dp", width: 20 },
      { header: "Categoria", key: "ca", width: 22 }, { header: "Status", key: "s", width: 16 }, { header: "Tipo", key: "ti", width: 12 },
      { header: "Valor (R$)", key: "v", width: 14 }, { header: "IOF (R$)", key: "i", width: 12 }, { header: "Moeda / câmbio", key: "m", width: 24 },
      { header: "Comprovante", key: "co", width: 16 }
    ];
    cabecalho(t);
    aud.linhas.forEach(({ c, t: x, cambio }) => {
      const row = t.addRow({
        d: this.dataBr(this.dataIso(x.criado)), e: x.estabelecimento, p: x.portador, f: x.final, cc: x.centroCusto, dp: x.departamento,
        ca: x.categoria, s: this.STATUS[x.status] || x.status, ti: this.rotuloTipo(c.tipo), v: c.valorSinal / 100, i: x.iof / 100, m: cambio, co: this.rotuloEvidencia(c.evidencia)
      });
      row.getCell("v").numFmt = moeda;
      row.getCell("i").numFmt = moeda;
    });
    const g = wb.addWorksheet("Agrupamentos");
    g.columns = [
      { header: "Visão", key: "di", width: 22 }, { header: "Nome", key: "n", width: 36 }, { header: "Compras", key: "c", width: 10 },
      { header: "Bruto (R$)", key: "b", width: 14 }, { header: "Estornos (R$)", key: "e", width: 14 }, { header: "Líquido (R$)", key: "l", width: 14 },
      { header: "IOF (R$)", key: "i", width: 12 }, { header: "Sem comprovante", key: "p", width: 16 }
    ];
    cabecalho(g);
    [["Portador", aud.porPortador], ["Centro de custo / Depto", aud.porDepartamento], ["Categoria", aud.porCategoria]].forEach(([rot, itens]) => {
      itens.forEach((x) => {
        const row = g.addRow({ di: rot, n: x.nome, c: x.compras, b: x.bruto / 100, e: x.devolvido / 100, l: x.liquido / 100, i: x.iof / 100, p: x.pend });
        ["b", "e", "l", "i"].forEach((k) => { row.getCell(k).numFmt = moeda; });
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    this.baixar("cartao-clara_" + this.sufixo() + ".xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  },

  /* ---------- tela ---------- */
  rotuloTipo(tipo) {
    return { PURCHASE: "Compra", REFUND: "Estorno", VALIDATION: "Validação", REJECTED: "Rejeitada" }[tipo] || tipo;
  },

  rotuloEvidencia(ev) {
    return { MISSING_EVIDENCE: "Pendente", ATTACHED: "Anexado", EXEMPT: "Isento" }[ev] || ev;
  },

  seloEvidencia(c, t) {
    if (c.evidencia === "MISSING_EVIDENCE") return `<span class="ccom-sit ccom-sit-prog">Pendente</span>`;
    if (c.evidencia === "EXEMPT") return `<span class="ccla-isento">Isento</span>`;
    return `<span class="ccom-sit ccom-sit-pago" title="${this.esc(t.arquivo || "")}">Anexado</span>`;
  },

  opcoes(lista, campo) {
    return [...new Set(lista.map((t) => t[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((v) => ({ id: v, label: v }));
  },

  filtrosHtml() {
    const f = this.state.filtro;
    const lista = this.state.base.transacoes;
    const sel = (id, rotulo, campo, todos, itens, valor) => window.MlSelectUnico
      ? MlSelectUnico.html({ id, label: rotulo, items: itens, selectedId: valor || "__todos", todos: { id: "__todos", label: todos }, semId: true })
      : "";
    this._selects = [
      ["ccla-f-portador", "portador"], ["ccla-f-depto", "departamento"], ["ccla-f-cat", "categoria"], ["ccla-f-comp", "comprovante"]
    ];
    const chip = (v) => `<label class="ccla-chip"><input type="checkbox" ${f.status.indexOf(v) >= 0 ? "checked" : ""} onchange="CartaoClaraApp.setFiltro('status','${v}')"> ${this.esc(this.STATUS[v])}</label>`;
    return `<div class="ccla-filtros">
        <div class="ccla-f-data"><label>De</label><input type="date" class="ccla-campo" value="${this.esc(f.de)}" onchange="CartaoClaraApp.setFiltro('de', this.value)"></div>
        <div class="ccla-f-data"><label>Até</label><input type="date" class="ccla-campo" value="${this.esc(f.ate)}" onchange="CartaoClaraApp.setFiltro('ate', this.value)"></div>
        <div class="ccla-f-sel">${sel("ccla-f-portador", "Portador", "portador", "Todos os portadores", this.opcoes(lista, "portador"), f.portador)}</div>
        <div class="ccla-f-sel">${sel("ccla-f-depto", "Departamento", "departamento", "Todos os departamentos", this.opcoes(lista, "departamento"), f.departamento)}</div>
        <div class="ccla-f-sel">${sel("ccla-f-cat", "Categoria", "categoria", "Todas as categorias", this.opcoes(lista, "categoria"), f.categoria)}</div>
        <div class="ccla-f-sel">${sel("ccla-f-comp", "Comprovante", "comprovante", "Todos", [{ id: "MISSING_EVIDENCE", label: "Só pendentes" }, { id: "ATTACHED", label: "Só anexados" }], f.comprovante)}</div>
        <div class="ccla-f-busca"><label>Buscar</label><input type="search" id="ccla-busca" class="ccla-campo" placeholder="Estabelecimento, portador, final do cartão..." value="${this.esc(f.busca)}" oninput="CartaoClaraApp.setFiltro('busca', this.value)"></div>
      </div>
      <div class="ccla-chips">
        <span class="ccla-chips-tit">Status</span>
        ${["1", "2", "3", "5", "4"].map(chip).join("")}
        <label class="ccla-chip ccla-chip-intl"><input type="checkbox" ${f.internacional ? "checked" : ""} onchange="CartaoClaraApp.setFiltro('internacional', this.checked)"> Só internacionais / IOF</label>
        <button type="button" class="btn btn-secondary ccla-limpar" onclick="CartaoClaraApp.limparFiltros()"><i data-lucide="eraser" style="width:14px;height:14px;"></i> Limpar filtros</button>
      </div>`;
  },

  barrasHtml(itens, rotulo, valor, vazio) {
    if (!itens.length) return `<p class="ccla-vazio">${vazio}</p>`;
    const max = Math.max.apply(null, itens.map((i) => Math.abs(valor(i))).concat([1]));
    return itens.map((i) => {
      const v = valor(i);
      const pct = Math.max(2, Math.round(Math.abs(v) / max * 100));
      return `<div class="ccla-barra"><span class="ccla-barra-rot" title="${this.esc(rotulo(i))}">${this.esc(rotulo(i))}</span>
        <span class="ccla-barra-trilho"><span class="ccla-barra-fill${v < 0 ? " is-neg" : ""}" style="width:${pct}%"></span></span>
        <span class="ccla-barra-val">${this.esc(this.brl(v))}</span></div>`;
    }).join("");
  },

  auditoriaHtml(aud) {
    const linhas = aud.linhas.map(({ c, t, cambio }) => `<tr class="${c.tipo === "REFUND" ? "ccla-estorno" : (c.tipo === "VALIDATION" || c.tipo === "REJECTED" ? "ccla-neutra" : "")}">
        <td>${this.esc(this.dataBr(this.dataIso(t.criado)))}</td>
        <td title="${this.esc(t.estabelecimento + (cambio ? " · " + cambio : ""))}">${this.esc(t.estabelecimento)}${cambio ? ` <small class="ccla-fx">${this.esc(cambio)}</small>` : ""}${c.tipo !== "PURCHASE" ? ` <small class="ccla-fx">${this.esc(this.rotuloTipo(c.tipo))}</small>` : ""}</td>
        <td title="${this.esc(t.email)}">${this.esc(t.portador)} <small class="ccla-fx">•••• ${this.esc(t.final)}</small></td>
        <td title="${this.esc(t.centroCusto + " / " + t.departamento)}">${this.esc(t.categoria)} <small class="ccla-fx">${this.esc(t.departamento)}</small></td>
        <td>${this.esc(this.STATUS[t.status] || t.status)}</td>
        <td class="is-right">${this.esc(this.brl(c.valorSinal))}</td>
        <td>${this.seloEvidencia(c, t)}</td>
      </tr>`).join("");
    const pend = aud.pendentes.length
      ? aud.pendentes.map((p) => `<div class="ccla-pend"><strong>${this.esc(p.nome)}</strong><span>${p.qtd} comprovante(s) pendente(s) · ${this.esc(this.brl(p.valor))}</span></div>`).join("")
      : `<p class="ccla-vazio">Nenhuma compra sem comprovante no período.</p>`;
    return `<div class="ccla-graficos">
        <section class="ccla-painel"><h4>Por categoria <small>líquido</small></h4>${this.barrasHtml(aud.porCategoria.slice(0, 8), (g) => g.nome, (g) => g.liquido, "Sem compras no período.")}</section>
        <section class="ccla-painel"><h4>Por dia <small>líquido</small></h4>${this.barrasHtml(aud.porDia.slice(-12), (d) => this.dataBr(d[0]), (d) => d[1], "Sem compras no período.")}</section>
      </div>
      <section class="ccla-painel ccla-alerta">
        <h4>Comprovantes pendentes <small>${aud.pendentes.length} portador(es)</small></h4>
        <div class="ccla-pend-lista">${pend}</div>
      </section>
      <div class="cc-scroll">
        <table class="cc-table ccla-table">
          <colgroup><col style="width:92px"><col><col style="width:22%"><col style="width:18%"><col style="width:120px"><col style="width:120px"><col style="width:100px"></colgroup>
          <thead><tr><th>Data</th><th>Estabelecimento</th><th>Portador / cartão</th><th>Categoria / depto</th><th>Status</th><th class="is-right">Valor</th><th>Comprovante</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="7" style="text-align:center;padding:30px;">Nenhuma transação para exibir com esses filtros.</td></tr>`}</tbody>
        </table>
      </div>`;
  },

  grupoTabela(titulo, col, itens) {
    const linhas = itens.map((g) => `<tr>
        <td title="${this.esc(g.nome)}">${this.esc(g.nome)}</td>
        <td class="is-right">${g.compras}</td>
        <td class="is-right">${this.esc(this.brl(g.bruto))}</td>
        <td class="is-right">${this.esc(this.brl(g.devolvido))}</td>
        <td class="is-right"><strong>${this.esc(this.brl(g.liquido))}</strong></td>
        <td class="is-right">${this.esc(this.brl(g.iof))}</td>
        <td class="is-right">${g.participacao.toLocaleString("pt-BR")}%</td>
        <td class="is-right">${g.pend || "—"}</td>
      </tr>`).join("");
    return `<section class="ccla-grupo"><h4>${this.esc(titulo)}</h4><div class="cc-scroll">
        <table class="cc-table ccla-table">
          <colgroup><col><col style="width:80px"><col style="width:120px"><col style="width:120px"><col style="width:130px"><col style="width:100px"><col style="width:90px"><col style="width:110px"></colgroup>
          <thead><tr><th>${this.esc(col)}</th><th class="is-right">Compras</th><th class="is-right">Bruto</th><th class="is-right">Estornos</th><th class="is-right">Líquido</th><th class="is-right">IOF</th><th class="is-right">Part.</th><th class="is-right">Sem comprov.</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="8" style="text-align:center;padding:30px;">Nenhum lançamento para exibir.</td></tr>`}</tbody>
        </table></div></section>`;
  },

  cartoesHtml(aud) {
    const k = this.cartoes(this.state.base, aud);
    if (k.completos) {
      const linhas = k.itens.map((c) => {
        const disp = Math.max(0, c.limite - c.usado);
        const uso = c.limite > 0 ? Math.round(c.usado / c.limite * 1000) / 10 : 0;
        return `<tr>
          <td>${this.esc(c.portador)} <small class="ccla-fx">${this.esc(c.email)}</small></td>
          <td>${this.esc(c.apelido)}</td>
          <td>•••• ${this.esc(c.final)}</td>
          <td>${this.esc(c.tipo)}</td>
          <td class="is-right">${this.esc(this.brl(c.limite))}</td>
          <td class="is-right">${this.esc(this.brl(c.usado))}</td>
          <td class="is-right">${this.esc(this.brl(disp))}</td>
          <td class="is-right">${uso.toLocaleString("pt-BR")}%</td>
          <td>${c.bloqueado ? `<span class="ccom-sit ccom-sit-prog">Bloqueado</span>` : `<span class="ccom-sit ccom-sit-pago">Ativo</span>`}</td>
        </tr>`;
      }).join("");
      return `<p class="ccla-nota">Limite, consumo e situação como estavam no JSON importado. Bloquear ou desbloquear cartão é feito no portal da Clara.</p>
        <div class="cc-scroll"><table class="cc-table ccla-table">
          <colgroup><col><col style="width:16%"><col style="width:80px"><col style="width:80px"><col style="width:120px"><col style="width:120px"><col style="width:120px"><col style="width:70px"><col style="width:96px"></colgroup>
          <thead><tr><th>Portador</th><th>Apelido</th><th>Final</th><th>Tipo</th><th class="is-right">Limite</th><th class="is-right">Usado</th><th class="is-right">Disponível</th><th class="is-right">Uso</th><th>Situação</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="9" style="text-align:center;padding:30px;">Nenhum cartão no arquivo.</td></tr>`}</tbody>
        </table></div>`;
    }
    const linhas = k.itens.map((c) => `<tr>
        <td>${this.esc(c.portador)}</td>
        <td>•••• ${this.esc(c.final)}</td>
        <td>${this.esc(c.departamento)}</td>
        <td class="is-right">${c.compras}</td>
        <td class="is-right">${this.esc(this.brl(c.liquido))}</td>
        <td class="is-right">${c.pend || "—"}</td>
      </tr>`).join("");
    return `<p class="ccla-nota">O JSON importado não trouxe a lista de cartões (campo <code>cards</code>), então os cartões abaixo saem das transações do período, sem limite. Bloquear ou desbloquear cartão é feito no portal da Clara.</p>
      <div class="cc-scroll"><table class="cc-table ccla-table">
        <colgroup><col><col style="width:90px"><col style="width:22%"><col style="width:90px"><col style="width:140px"><col style="width:120px"></colgroup>
        <thead><tr><th>Portador</th><th>Final</th><th>Departamento</th><th class="is-right">Compras</th><th class="is-right">Líquido</th><th class="is-right">Sem comprov.</th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhum cartão com lançamento no período.</td></tr>`}</tbody>
      </table></div>`;
  },

  fechamentoHtml(aud) {
    return `<div class="ccla-acoes-rel">
        <button type="button" class="btn btn-secondary" onclick="CartaoClaraApp.copiarMarkdown()"><i data-lucide="${this.state.copiado ? "check" : "copy"}" style="width:14px;height:14px;"></i> ${this.state.copiado ? "Copiado" : "Copiar texto"}</button>
        <button type="button" class="btn btn-secondary" onclick="CartaoClaraApp.exportarMarkdown()"><i data-lucide="file-text" style="width:14px;height:14px;"></i> Baixar .md</button>
        <button type="button" class="btn btn-excel" onclick="CartaoClaraApp.exportarExcel()"><i data-lucide="download" style="width:14px;height:14px;"></i> Excel</button>
      </div>
      <pre class="ccla-md">${this.esc(this.textoMarkdown(aud))}</pre>`;
  },

  estilos() {
    return `<style>
      .ccla-topo{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}
      .ccla-topo .btn{height:36px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;margin:0;}
      .ccla-info{margin:8px 0 0;font-size:0.78rem;color:#64748b;}
      .ccla-aviso{margin:8px 0 0;font-size:0.78rem;color:#b45309;}
      .ccla-erro{margin:8px 0 0;font-size:0.8rem;color:#b91c1c;font-weight:600;}
      .ccla-resumo{margin:0 0 10px;padding:10px 12px;border:1px solid #bbf7d0;border-left:4px solid #1b8253;border-radius:8px;background:#f0fdf4;color:#14532d;font-size:0.82rem;line-height:1.45;}
      .ccla-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:0 0 10px;}
      .ccla-kpis .ccom-kpi{padding:10px 12px;border-left:4px solid #1b8253;}
      .ccla-kpis .ccom-kpi strong{font-size:1.1rem;margin-top:4px;}
      .ccla-kpis .ccom-kpi small{display:block;margin-top:2px;font-size:0.7rem;color:#64748b;}
      .ccla-kpis .ccla-kpi-alerta{border-left-color:#d97706;background:#fffbeb;}
      .ccla-kpis .ccla-kpi-alerta strong{color:#b45309;}
      .ccla-filtros{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:0 0 8px;}
      .ccla-filtros label{display:block;font-size:.72rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.02em;margin:0 0 4px;}
      .ccla-campo{height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:.85rem;background:#fff;color:#0f172a;width:100%;}
      .ccla-f-data{flex:0 0 160px;}
      .ccla-f-sel{flex:1 1 220px;min-width:200px;}
      .ccla-f-busca{flex:1 1 100%;}
      .ccla-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;}
      .ccla-chips-tit{font-size:.72rem;font-weight:700;color:#475569;text-transform:uppercase;}
      .ccla-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:.78rem;color:#1e293b;cursor:pointer;white-space:nowrap;margin:0;}
      .ccla-chip:has(input:checked){border-color:#1b8253;background:#f0fdf4;color:#105436;}
      .ccla-chip-intl:has(input:checked){border-color:#d97706;background:#fffbeb;color:#92400e;}
      .ccla-limpar{height:32px !important;margin-left:auto !important;}
      .ccla-graficos{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 10px;}
      .ccla-painel{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;}
      .ccla-painel h4{margin:0 0 8px;font-size:.82rem;color:#105436;}
      .ccla-painel h4 small{font-weight:500;color:#64748b;margin-left:6px;}
      .ccla-barra{display:grid;grid-template-columns:minmax(0,38%) 1fr 110px;gap:8px;align-items:center;font-size:.75rem;margin:0 0 5px;}
      .ccla-barra-rot{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#334155;}
      .ccla-barra-trilho{height:10px;background:#f1f5f9;border-radius:6px;overflow:hidden;}
      .ccla-barra-fill{display:block;height:100%;background:#1b8253;border-radius:6px;}
      .ccla-barra-fill.is-neg{background:#dc2626;}
      .ccla-barra-val{text-align:right;font-variant-numeric:tabular-nums;color:#0f172a;}
      .ccla-alerta{margin:0 0 10px;border-left:4px solid #d97706;}
      .ccla-pend-lista{display:flex;flex-wrap:wrap;gap:8px;}
      .ccla-pend{display:flex;flex-direction:column;padding:6px 10px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;font-size:.76rem;}
      .ccla-pend strong{color:#92400e;}
      .ccla-pend span{color:#64748b;}
      .ccla-vazio{margin:0;color:#64748b;font-size:.8rem;}
      .ccla-table td.is-right,.ccla-table th.is-right{text-align:right;font-variant-numeric:tabular-nums;}
      .ccla-fx{color:#64748b;font-size:.68rem;}
      .ccla-table tr.ccla-estorno td{color:#b91c1c;}
      .ccla-table tr.ccla-neutra td{color:#94a3b8;}
      .ccla-isento{font-size:.7rem;color:#64748b;}
      .ccla-grupo{margin:0 0 12px;}
      .ccla-grupo h4{margin:0 0 6px;font-size:.85rem;color:#105436;}
      .ccla-nota{margin:0 0 8px;font-size:.78rem;color:#64748b;}
      .ccla-acoes-rel{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px;}
      .ccla-acoes-rel .btn{height:36px;display:inline-flex;align-items:center;gap:6px;}
      .ccla-md{margin:0;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:.78rem;line-height:1.45;color:#1e293b;max-height:60vh;overflow:auto;}
      @media (max-width:1200px){.ccla-kpis{grid-template-columns:repeat(3,minmax(0,1fr));}}
      @media (max-width:900px){.ccla-graficos{grid-template-columns:1fr;}.ccla-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}}
    </style>`;
  },

  render(soCorpo) {
    const root = document.getElementById("cartao-credito-root");
    if (!root) return;
    const s = this.state;
    const base = s.base;
    if (soCorpo && document.getElementById("ccla-corpo") && base) {
      const foco = document.activeElement && document.activeElement.id;
      document.getElementById("ccla-corpo").innerHTML = this.corpoHtml();
      if (window.lucide) lucide.createIcons();
      if (foco === "ccla-busca") {
        const el = document.getElementById("ccla-busca");
        if (el) { const n = el.value.length; el.focus(); el.setSelectionRange(n, n); }
      }
      return;
    }
    const upload = `<label class="btn btn-primary" style="cursor:pointer;">
        <i data-lucide="${s.lendo ? "loader-2" : "upload"}" style="width:14px;height:14px;"></i> ${s.lendo ? "Lendo o arquivo..." : "Importar JSON da Clara"}
        <input type="file" accept=".json,application/json" hidden ${s.lendo ? "disabled" : ""} onchange="CartaoClaraApp.aoArquivo(this)">
      </label>`;
    const exportar = base ? `
        <button type="button" class="btn btn-excel" onclick="CartaoClaraApp.exportarExcel()"><i data-lucide="download" style="width:14px;height:14px;"></i> Excel</button>
        <button type="button" class="btn btn-secondary" onclick="CartaoClaraApp.exportarCsv()"><i data-lucide="file-spreadsheet" style="width:14px;height:14px;"></i> CSV</button>
        <button type="button" class="btn btn-secondary" onclick="CartaoClaraApp.exportarMarkdown()"><i data-lucide="file-text" style="width:14px;height:14px;"></i> Markdown</button>` : "";
    const info = base
      ? `<p class="ccla-info">${this.esc(base.arquivo)} · ${base.transacoes.length} transação(ões) de ${this.esc(this.dataBr(base.inicio))} a ${this.esc(this.dataBr(base.fim))} · importado em ${this.esc(this.dataBr(String(base.importadoEm).slice(0, 10)))}${base.importadoPor ? " por " + this.esc(base.importadoPor) : ""}</p>`
      : `<p class="ccla-info">Importe o JSON das transações exportado da Clara (lista de transações, ou objeto com <code>transactions</code> e, se tiver, <code>cards</code>). O arquivo fica salvo para toda a equipe até a próxima importação.</p>`;
    let corpo = "";
    if (!s.carregado || s.carregando) corpo = `<div class="tvig-empty">Carregando...</div>`;
    else if (!base) corpo = `<div class="tvig-empty">Nenhum relatório da Clara importado ainda.</div>`;
    else corpo = `<div id="ccla-corpo">${this.corpoHtml()}</div>`;
    root.innerHTML = `${this.estilos()}
      <div class="ccom-page">
        <div class="search-filter-panel tvig-params ccom-params">
          <h3 class="tvig-section-title">Cartão de crédito Clara</h3>
          <div class="ccla-topo">${upload}${exportar}</div>
          ${info}
          ${s.aviso ? `<p class="ccla-aviso">${this.esc(s.aviso)}</p>` : ""}
          ${s.erro ? `<p class="ccla-erro">${this.esc(s.erro)}</p>` : ""}
        </div>
        ${corpo}
      </div>`;
    if (window.lucide) lucide.createIcons();
  },

  corpoHtml() {
    const s = this.state;
    const aud = this.auditar(s.base, s.filtro);
    const r = aud.resumo;
    const f = s.filtro;
    const aba = (id, rot, ic) => `<button type="button" role="tab" class="ml-tab${s.aba === id ? " is-active" : ""}" aria-selected="${s.aba === id}" onclick="CartaoClaraApp.setAba('${id}')"><i data-lucide="${ic}"></i> ${rot}</button>`;
    let conteudo;
    if (s.aba === "agrupamentos") {
      conteudo = this.grupoTabela("Por portador", "Portador", aud.porPortador)
        + this.grupoTabela("Por centro de custo / departamento", "Centro de custo / depto", aud.porDepartamento)
        + this.grupoTabela("Por categoria de despesa", "Categoria", aud.porCategoria);
    } else if (s.aba === "cartoes") conteudo = this.cartoesHtml(aud);
    else if (s.aba === "fechamento") conteudo = this.fechamentoHtml(aud);
    else conteudo = this.auditoriaHtml(aud);
    const html = `
      ${this.filtrosHtml()}
      <div class="ccla-resumo">De <strong>${this.esc(this.dataBr(f.de))}</strong> a <strong>${this.esc(this.dataBr(f.ate))}</strong>: líquido de <strong>${this.esc(this.brl(r.liquido))}</strong> (bruto ${this.esc(this.brl(r.bruto))} menos ${this.esc(this.brl(r.estornos))} de estornos) em <strong>${r.compras}</strong> compra(s). ${r.validacoes} validação(ões) de R$ 0,00 à parte, ${r.intl} compra(s) internacional(is) com ${this.esc(this.brl(r.iof))} de IOF e <strong>${r.pend}</strong> compra(s) sem comprovante, somando ${this.esc(this.brl(r.pendValor))}.</div>
      <div class="ccla-kpis">
        <div class="ccom-kpi"><span>Total líquido</span><strong>${this.esc(this.brl(r.liquido))}</strong><small>Bruto ${this.esc(this.brl(r.bruto))} · estornos ${this.esc(this.brl(r.estornos))}</small></div>
        <div class="ccom-kpi"><span>Compras efetivas</span><strong>${r.compras}</strong><small>${r.validacoes} validação(ões) de R$ 0,00 à parte</small></div>
        <div class="ccom-kpi"><span>Internacionais e IOF</span><strong>${this.esc(this.brl(r.iof))}</strong><small>${r.intl} compra(s) em moeda estrangeira</small></div>
        <div class="ccom-kpi ccla-kpi-alerta"><span>Sem comprovante</span><strong>${r.pend}</strong><small>${this.esc(this.brl(r.pendValor))} sem nota ou recibo</small></div>
        <div class="ccom-kpi"><span>Conformidade</span><strong>${r.conformidade.toLocaleString("pt-BR")}%</strong><small>Compras com comprovante</small></div>
      </div>
      <div class="ml-tabs" role="tablist" style="margin:0 0 10px;">
        ${aba("auditoria", "Auditoria e despesas", "receipt")}${aba("agrupamentos", "Agrupamentos", "layers")}${aba("cartoes", "Cartões", "credit-card")}${aba("fechamento", "Fechamento e relatório", "file-text")}
      </div>
      ${conteudo}`;
    setTimeout(() => this.ligarSelects(), 0);
    return html;
  },

  ligarSelects() {
    if (!window.MlSelectUnico) return;
    (this._selects || []).forEach(([id, campo]) => {
      if (!document.getElementById(id)) return;
      MlSelectUnico.bind(id, { onSelect: (v) => this.setFiltro(campo, v === "__todos" ? "" : v) });
    });
  },

  async init() {
    this.render();
    if (!this.state.carregado) {
      await this.carregar();
      this.render();
    }
  }
};

window.CartaoClaraApp = CartaoClaraApp;

document.addEventListener("tabChanged", function (e) {
  if (e && e.detail === "cartao-credito") CartaoClaraApp.init();
});
