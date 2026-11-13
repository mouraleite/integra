/* Órion (transição) › Acompanhamento de empreendimentos — tela do ML Órion (dashboard/tracking), com o cálculo do Órion
 * (orion-acompanhamento-calc.js). Lista: indicadores de cada empreendimento acompanhado (centros de custo marcados no Órion,
 * somando os centros da mesma obra) e das viabilidades aprovadas; detalhe: visão consolidado / empreendedor / parceiro,
 * indicadores, DRE sintética, planos contratados, velocidade de vendas e fluxo de caixa por ano.
 * Dados (lidos do Sienge pelo Integra, como o Órion sincronizava):
 *  - vendas e distratos: contratos de venda (situação emitido, cancelado e quitado) e unidades do empreendimento;
 *  - realizado: caixa e bancos pela regra do Integra (OrionRealizado, visão DFC), ano a ano;
 *  - a realizar: contas a receber e a pagar em aberto do centro de custo (inclusive vencidas), pela fatia do centro no título.
 * A leitura fica guardada em orion_acompanhamento_cache (uma por obra) para a lista abrir rápido; "Atualizar" lê de novo. */
const OrionObrasApp = {
  carregando: false, passo: "", erro: "", aviso: "",
  obras: null, grupos: null, viabs: null, cache: {}, aberto: null, visao: "consolidado",
  filtroEmp: [], filtroEmpAberto: false, filtroEmpBusca: "", filtroCat: "", filtroStatus: "", velAbertos: {},

  C() { return window.OrionAcompanhamentoCalc; },
  fc() { return window.firebaseCollections; },
  root() { return document.getElementById("orion-obras-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  R$(v) { return v == null || isNaN(v) ? "N/A" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }); },
  P(v) { return v == null || isNaN(v) ? "N/A" : (Number(v) / 100).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }); },
  N(v) { return v == null || isNaN(v) ? "N/A" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }); },
  hoje() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; },
  chaveDoc(k) { return String(k).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 140); },

  init() { this.render(); if (!this.grupos) this.carregarBase(); },

  /* ---------- base: obras acompanhadas, grupos (mesma obra), viabilidades, cache ---------- */
  async carregarBase() {
    const C = this.C(), fc = this.fc();
    if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
    this.carregando = true; this.passo = "Lendo as obras acompanhadas…"; this.render();
    try {
      const lidas = await window.OrionStore.ler("acompanhamento_obras", []);
      this.obras = lidas.itens || []; this.obrasVersao = lidas.versao || 0;
      this._curvas = (await window.OrionStore.ler("curvas", [])).itens || [];
      this._regimes = (await window.OrionStore.ler("regimes", [])).itens || [];
      const todos = this.obras;
      const vistos = new Map();
      todos.filter((o) => o.acompanhar).forEach((c) => {
        const pre = c.cc.length >= 3 ? c.cc.slice(0, 3) : c.cc;
        const prod = C.nomeProjeto(c.nome).produto, chave = `${pre}_${prod}`;
        if (vistos.has(chave)) return;
        let membros = c.cc.length >= 3 ? todos.filter((r) => r.cc.indexOf(pre) === 0 && C.mesmaObra(prod, C.nomeProjeto(r.nome).produto)) : [];
        if (!membros.some((r) => r.cc === c.cc)) membros.push(c);
        const main = membros.slice().sort((a, b) => a.nome.length - b.nome.length)[0];
        const np = C.nomeProjeto(main.nome);
        vistos.set(chave, { id: "cg-" + chave, chave, tipo: "obra", nome: np.produto, cidade: np.cidade, membros,
          categoria: ["Encerrado", "Concluído"].indexOf(main.fase) >= 0 ? "Encerrado" : "Em Andamento", status: main.fase || "Em Andamento" });
      });
      this.grupos = [...vistos.values()];
      // viabilidades aprovadas (como no Órion: fora "Em Andamento" e "Em Aprovação", sem as versões)
      this.passo = "Lendo as viabilidades…"; this.render();
      const VA = window.OrionViabilidadesApp;
      if (VA && typeof VA.carregar === "function" && !VA.lista) await VA.carregar();
      const ccsAcomp = new Set(todos.filter((o) => o.acompanhar).map((o) => o.cc));
      this.viabs = ((VA && VA.lista) || []).filter((d) => !d.versao_de && ["Em Andamento", "Em Aprovação"].indexOf(d.status) < 0 && !(d.obra_cc && ccsAcomp.has(String(d.obra_cc)))).map((d) => {
        let ind = {};
        try { const r = VA.resultados(d); ind = (r.fases && r.fases[0] && r.fases[0].r.indicators) || {}; } catch (e) { /* sem cálculo */ }
        const cat = ["Em Obras", "Lançado"].indexOf(d.status) >= 0 ? "Em Andamento" : ["Concluído", "Encerrado"].indexOf(d.status) >= 0 ? "Encerrado" : "Land Bank";
        return { id: "v-" + d._id, tipo: "viabilidade", nome: d.project_name, cidade: d.city || "Não informado", categoria: cat, status: d.status,
          kpis: { vgv_total: ind.vgv_total || 0, vendas_acumuladas: 0, perc_vendido: 0, lucro: ind.lucro_liquido || 0, tir_anual: ind.tir_aa, mtir_anual: ind.mtir_aa || 0, payback: ind.payback || 0,
            exposicao_max_caixa: ind.exposicao_maxima || 0, exposicao_caixa_vgv: ind.vgv_total ? (Math.abs(ind.exposicao_maxima || 0) / ind.vgv_total) * 100 : 0 } };
      });
      this.passo = "Lendo o último cálculo guardado…"; this.render();
      const snap = await fc.getDocs(fc.collection(window.firebaseDb, "orion_acompanhamento_cache"));
      snap.forEach((x) => { const d = x.data(); if (d && d.chave) this.cache[d.chave] = d; });
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false; this.passo = "";
    this.render();
  },

  /* ---------- leitura do Sienge de um centro de custo ---------- */
  empresaDoCc(cc) {
    const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const c = l.find((x) => String(x.id).replace(/\D/g, "") === String(cc));
    return c ? String(c.idCompany != null ? c.idCompany : c.companyId || "") : "";
  },
  async paginar(base) {
    const out = [];
    for (let off = 0; off < 40000; off += 200) {
      const r = await window.siengeFetchWithRetry(base + (base.indexOf("?") >= 0 ? "&" : "?") + "limit=200&offset=" + off).catch(() => ({ results: [] }));
      const l = (r && r.results) || [];
      out.push(...l);
      if (l.length < 200) break;
    }
    return out;
  },
  async bulk(caminho, ini, fim) {
    try {
      const p = await window.siengeFetchWithRetry(caminho(ini, fim), 2);
      return (p && p.data) || (Array.isArray(p) ? p : []);
    } catch (err) {
      if (Number(err && err.status) !== 507 || ini >= fim) throw err;
      const iso = (d) => d.toISOString().slice(0, 10);
      const s = new Date(ini + "T12:00:00"), e = new Date(fim + "T12:00:00");
      const meio = iso(new Date(s.getTime() + Math.floor((e - s) / 2)));
      const prox = new Date(meio + "T12:00:00"); prox.setDate(prox.getDate() + 1);
      return (await this.bulk(caminho, ini, meio)).concat(await this.bulk(caminho, iso(prox), fim));
    }
  },
  /** Fatia do título que é deste centro (Órion: rateio_previsto_do_cc). */
  fatia(cats, cc, padrao) {
    const m = (cats || []).filter((c) => String(c.costCenterId).replace(/\D/g, "") === String(cc));
    if (!m.length) return null;
    const ratio = m.reduce((s, c) => { const r = c.financialCategoryRate != null ? c.financialCategoryRate : c.percentage; return s + (r == null ? 1 : Number(r) / 100 || 0); }, 0);
    if (!(ratio > 0)) return null;
    return { ratio, nome: m[0].financialCategoryName || padrao, id: m[0].financialCategoryId };
  },
  grupoDfc(id, nome) {
    try {
      const R = window.OrionRealizado, gid = R.grupoDe(id) || (window.OrcamentoDfcApp && OrcamentoDfcApp.grupoDaConta ? OrcamentoDfcApp.grupoDaConta(String(id || ""), nome || "") : null);
      const g = (R.grupos() || []).find((x) => x && x.id === gid);
      return g ? { gid, nome: this.C().grupoOrion(g.name || g.nome || "") } : { gid: null, nome: "" };
    } catch (e) { return { gid: null, nome: "" }; }
  },
  somar(lista) {
    const m = new Map();
    lista.forEach((r) => { const k = [r.tipo, r.categoria, r.plano || "", r.grupo, r.gid || "", r.mes].join("|"); if (!m.has(k)) m.set(k, Object.assign({}, r, { valor: 0 })); m.get(k).valor += r.valor; });
    return [...m.values()].map((r) => Object.assign(r, { valor: Math.round(r.valor * 100) / 100 }));
  },

  async lerCentro(cc, aviso) {
    const C = this.C(), R = window.OrionRealizado;
    const hoje = this.hoje(), [ay, am] = hoje.split("-").map(Number), hojeIso = new Date().toISOString().slice(0, 10);
    // 1. vendas, distratos e unidades
    aviso(`Centro ${cc}: contratos de venda e unidades…`);
    const unidades = await this.paginar("/units?enterpriseId=" + encodeURIComponent(cc) + "&additionalData=NONE");
    const contratos = new Map();
    for (const s of [2, 3, 4]) (await this.paginar("/sales-contracts?enterpriseId=" + encodeURIComponent(cc) + "&situation=" + s)).forEach((c) => { if (c && c.id != null) contratos.set(String(c.id), c); });
    const areaUn = new Map(unidades.map((u) => [String(u.id), Number(u.privateArea) || 0]));
    const vendas = [];
    contratos.forEach((c) => {
      const data = String(c.contractDate || c.issueDate || "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(data)) return;
      const valor = Math.abs(Number(c.totalSellingValue != null ? c.totalSellingValue : c.value) || 0);
      const us = c.salesContractUnits || c.units || [];
      const area = us.length ? areaUn.get(String(us[0].id)) || 0 : 0;
      const parcelas = Math.max(0, ...(c.paymentConditions || []).map((p) => (Number.isInteger(p.installmentsNumber) ? p.installmentsNumber : 0)));
      vendas.push({ mes: data, valor, categoria: "VGV Vendido", parcelas, area });
      const sit = String(c.situation == null ? "" : c.situation).toUpperCase();
      if (sit === "3" || sit === "CANCELED" || sit === "CANCELADO" || sit === "DISTRATADO") {
        const dc = String(c.cancellationDate || c.cancelDate || c.contractDate || c.issueDate || "").slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(dc)) vendas.push({ mes: dc, valor: -valor, categoria: "Distrato", parcelas, area });
      }
    });
    const estoque = unidades.filter((u) => C.ESTOQUE.indexOf(String(u.commercialStock || "").toUpperCase()) >= 0).map((u) => ({ area: Number(u.privateArea) || 0 }));
    // 2. realizado (caixa), do primeiro ano com venda até hoje
    const empresa = this.empresaDoCc(cc);
    const anoIni = Math.min(ay - 1, ...vendas.map((v) => Number(v.mes.slice(0, 4))).filter((a) => a > 1990));
    const grupos = {}; ((R && R.grupos()) || []).forEach((g) => { if (g && g.id) grupos[g.id] = C.grupoOrion(g.name || g.nome || ""); });
    const real = [];
    if (empresa) for (let a = anoIni; a <= ay; a++) {
      aviso(`Centro ${cc}: realizado de ${a} (caixa e bancos)…`);
      const res = await R.buscar(a, a === ay ? am : 12, [empresa]);
      res.alocacoes.forEach((x) => { if (x.cc !== String(cc)) return; real.push({ tipo: x.valor > 0 ? "INCOME" : "OUTCOME", categoria: x.nome || x.plano, plano: x.plano || "", grupo: grupos[x.gid] || "", gid: x.gid || null, mes: `${a}-${String(x.mes).padStart(2, "0")}`, valor: Math.abs(x.valor) }); });
    }
    // 3. a realizar: contas a receber e a pagar em aberto (vencidas desde o primeiro ano + 15 anos à frente)
    const previsto = [];
    const caminho = (tipo) => (ini, fim) => `/bulk-data/v1/${tipo}?startDate=${ini}&endDate=${fim}&selectionType=D&correctionIndexerId=0&correctionDate=2019-01-01&costCentersId=${encodeURIComponent(cc)}${tipo === "outcome" ? "&withAuthorizations=false&withBankMovements=false" : ""}`;
    for (let a = anoIni; a <= ay + 14; a++) {
      const ini = `${a}-01-01`, fim = `${a}-12-31`;
      aviso(`Centro ${cc}: contas a receber e a pagar em aberto de ${a}…`);
      for (const tipo of ["income", "outcome"]) {
        let itens = [];
        try { itens = await this.bulk(caminho(tipo), ini, fim); } catch (e) { if (a > ay) continue; throw e; }
        itens.forEach((it) => {
          const due = String(it.dueDate || it.installmentBaseDate || "").slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return;
          const bal = it.balanceAmount, cor = it.correctedBalanceAmount;
          let v = bal != null ? Math.max(Number(bal) || 0, Number(cor) || 0) : tipo === "outcome" ? Math.max(Number(it.openValue) || 0, Number(it.correctedAmount) || 0) || Number(it.originalAmount) || 0 : Number(it.originalAmount) || 0;
          if (!(v > 0)) return;
          const f = this.fatia(tipo === "income" ? it.receiptsCategories || it.financialCategories : it.paymentsCategories || it.financialCategories, cc, tipo === "income" ? "Receita de Venda de Lotes" : "Obras");
          if (!f) return;
          const gd = this.grupoDfc(f.id, f.nome);
          previsto.push({ tipo: tipo === "income" ? "INCOME" : "OUTCOME", categoria: f.nome, plano: String(f.id || "").replace(/\D/g, ""), grupo: gd.nome, gid: gd.gid, mes: due.slice(0, 7), valor: v * f.ratio, vencido: due < hojeIso });
        });
      }
    }
    return { vendas, unidades: { total: unidades.length, estoque }, real: this.somar(real), previsto: this.somar(previsto.map(({ vencido, ...r }) => r)), lidoEm: new Date().toISOString(), empresa };
  },

  /** Lê de novo os centros de uma obra e guarda o resultado. */
  async atualizarGrupo(g) {
    const fc = this.fc();
    const centros = [];
    for (const m of g.membros) {
      const e = await this.lerCentro(m.cc, (t) => { this.passo = `${g.nome}: ${t}`; this.render(); });
      centros.push({ cc: m.cc, nome: m.nome, entrada: e });
    }
    const doc = { chave: g.chave, nome: g.nome, em: new Date().toISOString(), por: (window.OrionStore && OrionStore.usuario()) || "", centros };
    await fc.setDoc(fc.doc(window.firebaseDb, "orion_acompanhamento_cache", this.chaveDoc(g.chave)), JSON.parse(JSON.stringify(doc)));
    this.cache[g.chave] = doc;
  },
  async atualizar(id) {
    const alvo = id ? (this.grupos || []).filter((g) => g.id === id) : (this.grupos || []);
    if (!alvo.length) return;
    this.carregando = true; this.erro = ""; this.aviso = ""; this.render();
    const falhas = [];
    for (const g of alvo) { try { await this.atualizarGrupo(g); } catch (e) { falhas.push(`${g.nome}: ${e.message || e}`); } }
    this.carregando = false; this.passo = "";
    if (falhas.length) this.erro = "Não consegui ler do Sienge: " + falhas.join(" · ");
    else this.aviso = alvo.length === 1 ? `${alvo[0].nome} atualizado com o Sienge.` : `${alvo.length} empreendimentos atualizados com o Sienge.`;
    this.render();
  },

  /* ---------- cálculo (regra do Órion) ---------- */
  tmaDe(ccs) {
    const VA = window.OrionViabilidadesApp;
    const v = ((VA && VA.lista) || []).find((d) => d.obra_cc && ccs.indexOf(String(d.obra_cc)) >= 0 && Number(d.taxa_desconto_vpl) > 0);
    return v ? Number(v.taxa_desconto_vpl) / 100 : this.C().TMA_PADRAO;
  },
  aliquotas() {
    const l = this._regimes || [];
    const r = l.find((x) => String(x.nome || "").trim() === "Lucro Presumido" && x.ativo !== false);
    return r ? { pis: r.pis, cofins: r.cofins, irpj: r.irpj, csll: r.csll, outros: r.outros } : {};
  },
  /** Regra da parceria do centro pela Parametrização de Parceiro do Integra: contas "não se aplica" ficam 100% do empreendedor. */
  parceriaDoCc(cc) {
    const PP = window.ParametrizacaoParceiroApp;
    if (!PP || !Array.isArray(PP.items)) return null;
    const code = typeof PP.obraFromCc === "function" ? PP.obraFromCc(cc) : String(cc).slice(0, -2);
    for (const p of PP.items) {
      const obra = (p.obras || []).find((o) => String(o.code) === String(code));
      if (!obra) continue;
      const pct = typeof PP.pctObra === "function" ? Number(PP.pctObra(obra)) || 0 : Number(obra.defaultPartnerShare) || 0;
      // mesma regra da tela Parametrização de Parceiro (isAccountNA), com os grupos da visão DFC que ela usa
      const grupos = (typeof PP.dfcGroups === "function" ? PP.dfcGroups() : null) || (window.OrionRealizado && OrionRealizado.grupos && OrionRealizado.grupos()) || [];
      const pai = {}; grupos.forEach((x) => { if (x && x.id) pai[x.id] = x.parentId || null; });
      const ancestrais = (gid) => { const l = []; let a = gid; let n = 0; while (a && n++ < 20) { l.push(a); a = pai[a]; } return l; };
      const grupoDaConta = (acc) => { const x = grupos.find((g) => (g.accounts || []).map(String).includes(acc)); return x ? x.id : null; };
      const na = (r) => {
        const acc = String(r.plano || "");
        const gid = (acc && grupoDaConta(acc)) || r.gid || null;
        if (gid && ancestrais(gid).some((a) => obra.naNodes && obra.naNodes[a])) return !(obra.inAccounts && acc && obra.inAccounts[acc]);
        return !!(obra.naAccounts && acc && obra.naAccounts[acc]);
      };
      const vendaNo = (grupos.find((x) => /^01\.01\b/.test(String(x.name || ""))) || {}).id || null;
      return { pct, rateada: (r) => !na(r), vendasRateadas: !(vendaNo && ancestrais(vendaNo).some((a) => obra.naNodes && obra.naNodes[a])), nome: p.name || p.nome || "" };
    }
    return null;
  },
  async garantirParcerias() {
    const PP = window.ParametrizacaoParceiroApp;
    if (PP && (!Array.isArray(PP.items) || !PP.items.length) && typeof PP.loadItems === "function") { try { await PP.loadItems(); } catch (e) { /* sem parametrização */ } }
  },
  actsDe(g, visao, kpisOnly) {
    const C = this.C(), cache = this.cache[g.chave];
    if (!cache) return null;
    const tma = this.tmaDe(g.membros.map((m) => m.cc));
    return cache.centros.map((c) => {
      const obra = (this.obras || []).find((o) => o.cc === c.cc) || {};
      return C.calcularCentro(Object.assign({}, c.entrada, { aliquotas: this.aliquotas(), tmaAnual: tma, hoje: this.hoje(), terrenoManual: obra.terreno || null, kpisOnly: !!kpisOnly }, this.optsVisao(c.cc, visao)));
    });
  },
  /** Regras da visão de parceria de um centro (as mesmas no Acompanhamento e na DFC de empreendimentos). */
  optsVisao(cc, visao) {
    const obra = (this.obras || []).find((o) => o.cc === cc) || {};
    const par = visao === "consolidado" ? null : this.parceriaDoCc(cc);
    const p = par ? par.pct / 100 : (Number(obra.participacao) || 0) / 100;
    // sem parametrização no Integra, o Órion usava as regras da parceria por grupo; sem regra cadastrada, todas desligadas
    const regras = visao === "consolidado" ? null : {};
    const mult = visao === "empreendedor" ? [1 - p, 1] : visao === "parceiro" ? [p, 0] : [1, 1];
    return Object.assign({ regras, multApportioned: mult[0], multDefault: mult[1] }, par ? { rateada: par.rateada, vendasRateadas: par.vendasRateadas } : {});
  },
  linhasLista() {
    const C = this.C();
    const obras = (this.grupos || []).map((g) => {
      const acts = this.actsDe(g, "consolidado", true);
      return Object.assign({}, g, { kpis: acts ? C.kpisGrupo(acts, this.tmaDe(g.membros.map((m) => m.cc))) : null, lidoEm: this.cache[g.chave] ? this.cache[g.chave].em : null });
    });
    return (this.viabs || []).concat(obras);
  },

  /* ---------- tela ---------- */
  abrir(id) { this.aberto = id; this.visao = "consolidado"; this.velAbertos = {}; this.render(); window.scrollTo(0, 0); },
  voltar() { this.aberto = null; this.render(); },
  async setVisao(v) { this.visao = v; if (v !== "consolidado") await this.garantirParcerias(); this.render(); },
  setFiltro(c, v) { this[c] = v; this.render(); },
  alternarAno(a) { this.velAbertos[a] = !this.velAbertos[a]; this.render(); },

  htmlLista() {
    const todas = this.linhasLista();
    const f = todas.filter((r) => (!this.filtroEmp.length || this.filtroEmp.indexOf(r.nome) >= 0) && (!this.filtroCat || r.categoria === this.filtroCat) && (!this.filtroStatus || r.status === this.filtroStatus));
    const k = (r) => r.kpis || {};
    const vgv = f.reduce((s, r) => s + (k(r).vgv_total || 0), 0), vend = f.reduce((s, r) => s + (k(r).vendas_acumuladas || 0), 0), lucro = f.reduce((s, r) => s + (k(r).lucro || 0), 0);
    const tirs = f.filter((r) => k(r).tir_anual != null);
    const tirMed = tirs.length ? tirs.reduce((s, r) => s + k(r).tir_anual, 0) / tirs.length : null;
    const pb = f.reduce((s, r) => s + (k(r).payback || 0), 0) / (f.length || 1), ex = f.reduce((s, r) => s + (k(r).exposicao_max_caixa || 0), 0);
    const card = (t, v, sub) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;background:#fff;text-align:center"><div style="font-size:0.66rem;color:#64748b;text-transform:uppercase;font-weight:700">${t}</div><div style="font-size:1.15rem;font-weight:800;color:#0f172a">${v}</div>${sub ? `<div style="font-size:0.68rem;color:#64748b">${sub}</div>` : ""}</div>`;
    const opts = (lista, sel, todos) => `<option value="">${todos}</option>` + [...new Set(lista)].sort().map((x) => `<option ${x === sel ? "selected" : ""}>${this.esc(x)}</option>`).join("");
    const emps = [...new Set(todas.map((r) => r.nome).filter(Boolean))].sort();
    const filtroEmp = window.MlEmpresaFilter ? MlEmpresaFilter.html({ id: "oob-emp", label: "Empreendimentos", items: emps.map((n) => ({ id: n, label: n })), selectedIds: this.filtroEmp, open: this.filtroEmpAberto, query: this.filtroEmpBusca, emptyMeansAll: true }) : "";
    const linha = (rot, fn, cls) => `<tr><td style="font-weight:700;position:sticky;left:0;background:#fff;z-index:1">${rot}</td>${f.map((r) => `<td class="${cls || "is-right"}">${fn(r)}</td>`).join("")}</tr>`;
    const semCalc = (r) => (r.tipo === "obra" && !r.kpis ? `<span style="color:#92400e">clique em Atualizar</span>` : null);
    const tab = f.length ? `<div class="cc-scroll" style="max-height:72vh"><table class="cc-table or-larga"><thead><tr><th style="min-width:200px">Indicadores</th>${f.map((r) => `<th class="is-center" style="min-width:160px;white-space:normal;cursor:pointer" onclick="OrionObrasApp.abrir('${this.esc(r.id)}')">${this.esc(r.nome)}<div style="font-weight:400;font-size:0.62rem">${r.tipo === "obra" ? `obra · ${r.membros.length} centro(s)${r.lidoEm ? " · " + new Date(r.lidoEm).toLocaleDateString("pt-BR") : ""}` : "viabilidade"}</div></th>`).join("")}</tr></thead><tbody>
        ${linha("Categoria", (r) => this.esc(r.categoria), "is-center")}${linha("Status", (r) => this.esc(r.status), "is-center")}${linha("Cidade", (r) => this.esc(r.cidade), "is-center")}
        ${linha("VGV Total", (r) => semCalc(r) || this.R$(k(r).vgv_total))}${linha("Vendas Acumuladas", (r) => semCalc(r) || `${this.R$(k(r).vendas_acumuladas)}<div style="font-size:0.65rem;color:#64748b">${this.P(k(r).perc_vendido)} vendido</div>`)}
        ${linha("Lucro Operacional", (r) => semCalc(r) || this.R$(k(r).lucro))}${linha("TIR (a.a.)", (r) => semCalc(r) || this.P(k(r).tir_anual))}${linha("MTIR (a.a.)", (r) => semCalc(r) || this.P(k(r).mtir_anual))}
        ${linha("Payback (Meses)", (r) => semCalc(r) || this.N(k(r).payback))}${linha("Exp. Máx de Caixa", (r) => semCalc(r) || this.R$(k(r).exposicao_max_caixa))}${linha("Exposição / VGV", (r) => semCalc(r) || this.P(k(r).exposicao_caixa_vgv))}
        </tbody></table></div>` : `<div style="padding:30px;text-align:center;color:#64748b">${(this.obras || []).length ? "Nenhum empreendimento neste filtro." : "Nenhuma obra acompanhada. Faça a carga do Órion (parte 5: obras do acompanhamento)."}</div>`;
    return `<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;margin-bottom:12px">
        ${card("Empreendimentos", f.length)}${card("VGV Total", this.R$(vgv))}${card("Vendas (Acum.)", this.R$(vend), this.P(vgv > 0 ? (vend / vgv) * 100 : 0) + " vendido")}${card("Lucro (Acum.)", this.R$(lucro))}
        ${card("TIR Média Anual", this.P(tirMed))}${card("Payback Médio", this.N(pb) + " meses")}${card("Exp. Máx Caixa", this.R$(ex))}</div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
        <div style="min-width:280px">${filtroEmp}</div>
        <div><label class="ml-emp-filter-label">Categoria</label><select class="idx-select" style="height:40px;min-width:180px" onchange="OrionObrasApp.setFiltro('filtroCat', this.value)">${opts(todas.map((r) => r.categoria), this.filtroCat, "Todas categorias")}</select></div>
        <div><label class="ml-emp-filter-label">Status</label><select class="idx-select" style="height:40px;min-width:180px" onchange="OrionObrasApp.setFiltro('filtroStatus', this.value)">${opts(todas.map((r) => r.status), this.filtroStatus, "Todos status")}</select></div>
        ${this.podeEditar() ? `<button type="button" class="btn btn-secondary" style="height:40px;margin-left:auto" onclick="OrionObrasApp.abrirEditor()">Obras acompanhadas</button>` : ""}
        <button type="button" class="btn btn-primary" style="height:40px;${this.podeEditar() ? "" : "margin-left:auto"}" ${this.carregando ? "disabled" : ""} onclick="OrionObrasApp.atualizar()">Atualizar todos com o Sienge</button></div>
      <div style="font-size:0.7rem;color:#64748b;margin-bottom:8px">Mesmo cálculo do Órion: realizado (caixa e bancos, visão DFC) + a realizar (contas a receber e a pagar em aberto, inclusive vencidas) + projeção do estoque. Obras = centros de custo marcados no Órion para o painel, somando os da mesma obra (ex.: obra e parceria). Viabilidades aprovadas aparecem com os números da viabilidade. Clique no nome para abrir o detalhe.</div>
      ${tab}`;
  },

  htmlDetalhe() {
    const C = this.C();
    const item = this.linhasLista().find((r) => r.id === this.aberto);
    if (!item) return `<div style="padding:20px">Empreendimento não encontrado. <button type="button" class="btn btn-secondary" onclick="OrionObrasApp.voltar()">Voltar</button></div>`;
    const seletor = `<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
        <div><label class="ml-emp-filter-label">Selecione o empreendimento</label><select class="idx-select" style="height:40px;min-width:320px" onchange="OrionObrasApp.abrir(this.value)">${this.linhasLista().map((r) => `<option value="${this.esc(r.id)}" ${r.id === item.id ? "selected" : ""}>${this.esc(r.nome)}</option>`).join("")}</select></div>
        ${item.tipo === "obra" ? `<div><label class="ml-emp-filter-label">Visão de parceria</label><div style="display:flex;gap:4px">${[["consolidado", "Consolidado"], ["empreendedor", "Empreendedor"], ["parceiro", "Parceiro"]].map(([k, t]) => `<button type="button" class="btn ${this.visao === k ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionObrasApp.setVisao('${k}')">${t}</button>`).join("")}</div></div>
          <button type="button" class="btn btn-secondary" style="height:40px" ${this.carregando ? "disabled" : ""} onclick="OrionObrasApp.atualizar('${this.esc(item.id)}')">Atualizar com o Sienge</button>` : ""}
        <button type="button" class="btn btn-secondary" style="height:40px;margin-left:auto" onclick="OrionObrasApp.voltar()">Voltar à lista</button></div>`;
    if (item.tipo !== "obra") return seletor + `<div style="padding:14px;border:1px solid #e2e8f0;border-radius:8px;font-size:0.85rem">Viabilidade aprovada ainda sem obra acompanhada: os números são os da viabilidade (VGV ${this.R$(item.kpis.vgv_total)}, lucro ${this.R$(item.kpis.lucro)}, TIR ${this.P(item.kpis.tir_anual)}). Abra em Órion (transição) › Viabilidades para o detalhe.</div>`;
    const acts = this.actsDe(item, this.visao, false);
    if (!acts) return seletor + `<div style="padding:20px;text-align:center;color:#64748b">Este empreendimento ainda não foi lido do Sienge. Clique em <b>Atualizar com o Sienge</b> (lê vendas, realizado e contas em aberto de ${item.membros.map((m) => m.cc).join(", ")}).</div>`;
    const d = C.detalheGrupo(acts, this.tmaDe(item.membros.map((m) => m.cc)));
    const card = (t, v) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#fff;text-align:center"><div style="font-size:0.64rem;color:#64748b;text-transform:uppercase;font-weight:700">${t}</div><div style="font-size:1.05rem;font-weight:800;color:#0f172a">${v}</div></div>`;
    const cards = `<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:10px">
        ${card("VGV Total", this.R$(d.vgv_total))}${card("Vendas acumuladas", this.R$(d.vendas_acumuladas) + ` <span style="font-size:0.7rem;color:#64748b">(${this.P(d.perc_vendido)})</span>`)}${card("VGV em estoque", this.R$(d.vgv_estoque) + ` <span style="font-size:0.7rem;color:#64748b">(${d.estoque_unidades} un.)</span>`)}${card("Lucro líq. operacional", this.R$(d.lucro_liq_operacional))}${card("Distrato / venda", this.P(d.distrato_venda))}</div>
      <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px">
        ${card("TIR Mensal", this.P(d.tir_mensal))}${card("TIR Anual", this.P(d.tir_anual))}${card("MTIR Mensal", this.P(d.mtir_mensal))}${card("MTIR Anual", this.P(d.mtir_anual))}${card("Rentabilidade do Investimento", d.rent_inv == null ? "—" : this.P(d.rent_inv))}
        ${card("Exposição Máxima de Caixa", this.R$(d.exposicao_maxima))}${card("Período (Exposição)", d.periodo_exposicao + "º mês")}${card("Payback", (d.payback || 0) + "º mês")}${card("Vida", d.vida + " meses")}${card("Exposição de Caixa / VGV", this.P(d.exposicao_caixa_vgv))}</div>`;
    const dre = `<div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:170px"></colgroup><thead><tr><th>DRE</th><th class="is-right">R$</th></tr></thead><tbody>${d.dre.map((r) => `<tr><td style="${r.indent ? "padding-left:22px;color:#475569" : ""}${r.bold ? "font-weight:800" : ""}">${this.esc(r.item)}</td><td class="is-right" style="${r.bold ? "font-weight:800;" : ""}${typeof r.valor === "number" && r.valor < 0 ? "color:#b91c1c" : ""}">${r.is_percentage ? this.esc(String(r.valor).replace(".", ",")) : this.R$(r.valor)}</td></tr>`).join("")}</tbody></table></div>`;
    const pv = d.planos_vendas || { curto_longo: [], distribuicao: [] };
    const planos = `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px">
        <div style="display:flex;gap:14px;margin-bottom:8px">${pv.curto_longo.map((x, i) => `<div style="flex:1;text-align:center;border-radius:8px;padding:8px;background:${i ? "#f1f5f9" : "#e7f6ee"}"><div style="font-size:0.7rem;color:#475569">${this.esc(x.name)}</div><div style="font-size:1.2rem;font-weight:800;color:${i ? "#64748b" : "#0F5B30"}">${String(x.value).replace(".", ",")}%</div></div>`).join("")}</div>
        ${pv.distribuicao.map((x) => { const v = x.curto || x.longo; return `<div style="display:flex;align-items:center;gap:8px;font-size:0.72rem;margin:3px 0"><div style="width:80px">${this.esc(x.name)}</div><div style="flex:1;background:#f1f5f9;border-radius:3px"><div style="height:10px;width:${Math.min(100, v)}%;background:${x.curto ? "#0F5B30" : "#94a3b8"};border-radius:3px"></div></div><div style="width:50px;text-align:right">${String(v).replace(".", ",")}%</div></div>`; }).join("")}
        <div style="font-size:0.66rem;color:#64748b;margin-top:4px">Curto = até 48 parcelas. Percentual do VGV dos contratos (vendas e distratos) por número de parcelas.</div></div>`;
    let vel = "";
    d.velocidade_vendas.forEach((a) => {
      const ab = !!this.velAbertos[a.ano];
      vel += `<tr style="cursor:pointer;font-weight:700;background:#f8fafc" onclick="OrionObrasApp.alternarAno('${a.ano}')"><td>${ab ? "▾" : "▸"} ${a.ano}</td><td class="is-center">${a.vendas}</td><td class="is-center">${a.distratos}</td><td class="is-center">${a.saldo}</td><td class="is-center">${String(a.perc).replace(".", ",")}%</td><td class="is-center">${String(a.vel).replace(".", ",")}%</td></tr>`;
      if (ab) a.meses.forEach((m) => { vel += `<tr><td style="padding-left:24px">${m.mes.slice(5)}/${m.mes.slice(0, 4)}</td><td class="is-center">${m.vendas}</td><td class="is-center">${m.distratos}</td><td class="is-center">${m.saldo}</td><td class="is-center">${String(m.perc).replace(".", ",")}%</td><td class="is-center">${String(m.vel).replace(".", ",")}%</td></tr>`; });
    });
    const velT = `<div class="cc-scroll" style="max-height:420px"><table class="cc-table"><thead><tr><th>Ano / mês</th><th class="is-center">Vendas</th><th class="is-center">Distratos</th><th class="is-center">Saldo</th><th class="is-center">%</th><th class="is-center">Velocidade</th></tr></thead>
        <tbody>${vel || `<tr><td colspan="6" style="text-align:center;padding:14px">Sem vendas.</td></tr>`}<tr class="oob-total"><td>Total</td><td class="is-center">${d.total_sold}</td><td class="is-center">${d.total_returned}</td><td class="is-center">${d.total_balance}</td><td class="is-center">100%</td><td class="is-center">${d.total_units ? String(Math.round((d.total_sold / d.total_units) * 10000) / 100).replace(".", ",") : 0}%</td></tr></tbody></table></div>
        <div style="font-size:0.66rem;color:#64748b">Velocidade = vendas do período ÷ total de unidades (${d.total_units}).</div>`;
    const cols = [["Entradas", "Entradas"], ["Devolucao_Distratos", "Dev. Distrato"], ["Tributos", "Tributos"], ["Terreno", "Terreno"], ["Obras", "Obras"], ["Projetos", "Projetos"], ["Marketing", "MKT"], ["Comercial", "Comercial"], ["Administrativas", "Admin"], ["Total_Saidas", "Total Saídas (T)"], ["Saldo_Mes", "Saldo"], ["Saldo_Acumulado", "Saldo acumulado"]];
    const tot = {}; cols.forEach(([k]) => { tot[k] = d.fluxo_caixa.reduce((s, r) => s + (r[k] || 0), 0); });
    const fluxo = `<div class="cc-scroll" style="max-height:60vh"><table class="cc-table or-larga"><thead><tr><th>Ano</th>${cols.map(([, t]) => `<th class="is-right">${t}</th>`).join("")}</tr></thead>
        <tbody>${d.fluxo_caixa.map((r) => `<tr style="${r.is_forecast ? "color:#64748b;font-style:italic" : ""}"><td>${this.esc(r.Ano)}${r.is_forecast ? " (previsto)" : ""}</td>${cols.map(([k]) => `<td class="is-right">${this.R$(r[k] || 0)}</td>`).join("")}</tr>`).join("")}
        <tr class="oob-total"><td>TOTAL</td>${cols.map(([k]) => `<td class="is-right">${k === "Saldo_Acumulado" ? "" : this.R$(tot[k])}</td>`).join("")}</tr></tbody></table></div>
        <div style="font-size:0.66rem;color:#64748b">Anos com realizado somam realizado + a realizar; "(previsto)" = só a realizar (contas em aberto e projeção do estoque).</div>`;
    const cache = this.cache[item.chave];
    return seletor + `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">${this.esc(item.nome)} · ${this.esc(item.cidade)} · ${this.esc(item.status)} · centros ${item.membros.map((m) => this.esc(m.cc)).join(", ")} · lido do Sienge em ${new Date(cache.em).toLocaleString("pt-BR")}${cache.por ? " por " + this.esc(cache.por) : ""}${this.visao !== "consolidado" ? " · visão " + this.visao + ": " + this.esc(item.membros.map((m) => { const par = this.parceriaDoCc(m.cc); return par ? `${m.cc} parceiro ${String(par.pct).replace(".", ",")}% (Parametrização de Parceiro${par.nome ? " " + par.nome : ""})` : null; }).filter(Boolean).join("; ") || "sem Parametrização de Parceiro para estes centros (usa a participação do Órion)") : ""}</div>
      ${cards}
      <div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:14px">
        <div><div style="font-weight:700;color:#334155;margin-bottom:6px">DRE</div>${dre}</div>
        <div><div style="font-weight:700;color:#334155;margin-bottom:6px">Planos contratados</div>${planos}
          <div style="font-weight:700;color:#334155;margin:12px 0 6px">Velocidade de vendas</div>${velT}</div></div>
      <div style="font-weight:700;color:#334155;margin:14px 0 6px">Fluxo de caixa</div>${fluxo}`;
  },

  /* ---------- edição das obras acompanhadas (Órion: Apoio › Centro de Custo) ---------- */
  podeEditar() { return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin(); },
  abrirEditor() { this.editor = { itens: JSON.parse(JSON.stringify(this.obras || [])), busca: "", soAcomp: true, erro: "" }; this.render(); },
  fecharEditor() { this.editor = null; this.render(); },
  edSet(cc, campo, v) {
    const e = this.editor; if (!e) return;
    const it = e.itens.find((x) => x.cc === cc); if (!it) return;
    if (campo === "acompanhar") it.acompanhar = !!v;
    else if (campo === "fase") it.fase = v;
    else if (campo === "participacao") it.participacao = Number(String(v).replace(",", ".")) || 0;
    else {
      const t = it.terreno || (it.terreno = { valor: 0, curva: null, inicio: null });
      if (campo === "terreno_valor") t.valor = Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
      if (campo === "terreno_inicio") t.inicio = /^\d{4}-\d{2}$/.test(v) ? v : null;
      if (campo === "terreno_curva") { const c = (this._curvas || []).find((x) => String(x.nome) === String(v)); t.curva = c ? c.meses.map(Number) : null; t.curva_nome = c ? c.nome : ""; }
      if (!(t.valor > 0)) it.terreno = t.valor > 0 ? t : (t.curva || t.inicio ? t : null);
    }
  },
  edBusca(v) { this.editor.busca = v; this.render(); const i = document.getElementById("oob-ed-busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
  edIncluir() {
    const e = this.editor, el = document.getElementById("oob-ed-novo");
    const cc = String((el && el.value) || "").split(" - ")[0].replace(/\D/g, "");
    if (!cc) return;
    if (e.itens.some((x) => x.cc === cc)) { const x = e.itens.find((y) => y.cc === cc); x.acompanhar = true; return this.render(); }
    const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
    const c = l.find((x) => String(x.id) === cc);
    e.itens.push({ cc, nome: c ? c.name || c.nome || "" : "", acompanhar: true, fase: "Em Andamento", cidade: "", participacao: 0, participacao_rateio: 0, parceria_orion: null, terreno: null, rateio: [] });
    this.render();
  },
  async edSalvar() {
    const e = this.editor; if (!e) return;
    try {
      const nova = await window.OrionStore.gravar("acompanhamento_obras", e.itens.map((x) => Object.assign({}, x, { terreno: x.terreno && (x.terreno.valor > 0) ? x.terreno : null })), this.obrasVersao);
      this.editor = null; this.grupos = null; this.aviso = "Obras acompanhadas salvas.";
      await this.carregarBase();
      this.obrasVersao = typeof nova === "number" ? nova : this.obrasVersao;
    } catch (err) { e.erro = err.conflito ? "Outra pessoa alterou as obras agora há pouco. Feche e abra de novo." : (err.message || String(err)); this.render(); }
  },
  htmlEditor() {
    const e = this.editor;
    const q = e.busca.trim().toLowerCase();
    const lista = e.itens.filter((x) => (!e.soAcomp || x.acompanhar) && (!q || `${x.cc} ${x.nome}`.toLowerCase().indexOf(q) >= 0)).sort((a, b) => a.cc.localeCompare(b.cc, "pt-BR", { numeric: true }));
    const curvas = (this._curvas || []).map((c) => c.nome);
    const ccs = ((window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || []).map((c) => `<option value="${this.esc(c.id + " - " + (c.name || c.nome || ""))}">`).join("");
    const linhas = lista.map((x) => { const t = x.terreno || {}; const k = this.esc(x.cc); return `<tr>
        <td class="is-center"><input type="checkbox" ${x.acompanhar ? "checked" : ""} onchange="OrionObrasApp.edSet('${k}', 'acompanhar', this.checked)"></td>
        <td><b>${k}</b> ${this.esc(x.nome)}</td>
        <td><select class="idx-select" style="height:30px;width:100%" onchange="OrionObrasApp.edSet('${k}', 'fase', this.value)">${["Em Andamento", "Encerrado"].map((f) => `<option ${x.fase === f ? "selected" : ""}>${f}</option>`).join("")}</select></td>
        <td><input class="idx-select" style="height:30px;width:100%;text-align:right" value="${x.participacao ? String(x.participacao).replace(".", ",") : ""}" placeholder="0" onchange="OrionObrasApp.edSet('${k}', 'participacao', this.value)"></td>
        <td><input class="idx-select" style="height:30px;width:100%;text-align:right" value="${t.valor ? Number(t.valor).toLocaleString("pt-BR") : ""}" placeholder="0,00" onchange="OrionObrasApp.edSet('${k}', 'terreno_valor', this.value)"></td>
        <td><select class="idx-select" style="height:30px;width:100%" onchange="OrionObrasApp.edSet('${k}', 'terreno_curva', this.value)"><option value="">À vista (sem curva)</option>${curvas.map((n) => `<option ${t.curva_nome === n ? "selected" : ""}>${this.esc(n)}</option>`).join("")}${t.curva && !t.curva_nome ? `<option selected value="">curva do Órion (${t.curva.length} meses)</option>` : ""}</select></td>
        <td><input type="month" class="idx-select" style="height:30px;width:100%" value="${this.esc(t.inicio || "")}" onchange="OrionObrasApp.edSet('${k}', 'terreno_inicio', this.value)"></td></tr>`; }).join("");
    return `<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
        <div><div style="font-weight:800;color:#105436">Obras do acompanhamento</div><div style="font-size:0.72rem;color:#64748b">Como no Órion (Apoio › Centro de Custo): marque os centros de custo que entram no painel, a fase, a participação do parceiro (%) e o custo de terreno informado com a curva e o mês de início do pagamento.</div></div>
        <div style="margin-left:auto"><label class="ml-emp-filter-label">Buscar</label><input id="oob-ed-busca" class="idx-select" style="height:40px;width:220px" value="${this.esc(e.busca)}" placeholder="código ou nome" oninput="OrionObrasApp.edBusca(this.value)"></div>
        <label style="display:flex;gap:6px;align-items:center;height:40px;font-size:0.8rem"><input type="checkbox" ${e.soAcomp ? "checked" : ""} onchange="OrionObrasApp.editor.soAcomp=this.checked;OrionObrasApp.render()"> só os acompanhados</label>
        <div><label class="ml-emp-filter-label">Incluir centro de custo</label><input id="oob-ed-novo" list="oob-ed-ccs" class="idx-select" style="height:40px;width:260px" placeholder="código ou nome"><datalist id="oob-ed-ccs">${ccs}</datalist></div>
        <button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionObrasApp.edIncluir()">Incluir</button>
        <button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionObrasApp.fecharEditor()">Cancelar</button>
        <button type="button" class="btn btn-primary" style="height:40px" onclick="OrionObrasApp.edSalvar()">Salvar</button></div>
      ${e.erro ? `<div style="padding:8px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:8px">${this.esc(e.erro)}</div>` : ""}
      <div class="cc-scroll" style="max-height:66vh"><table class="cc-table"><colgroup><col style="width:70px"><col><col style="width:140px"><col style="width:100px"><col style="width:140px"><col style="width:220px"><col style="width:150px"></colgroup>
        <thead><tr><th class="is-center">No painel</th><th>Centro de custo</th><th>Fase</th><th class="is-right">Participação %</th><th class="is-right">Terreno (R$)</th><th>Curva do terreno</th><th>Início</th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="7" style="text-align:center;padding:16px">Nenhum centro de custo neste filtro.</td></tr>`}</tbody></table></div>`;
  },

  render() {
    if (window.OrionObrasDfcApp && document.getElementById("orion-obras-dfc-root") && document.getElementById("orion-obras-dfc-root").offsetParent) { try { OrionObrasDfcApp.render(); } catch (e) { /* tela da DFC */ } }
    const root = this.root();
    if (!root) return;
    if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    if (!document.getElementById("oob-estilos")) { const st = document.createElement("style"); st.id = "oob-estilos"; st.textContent = ".cc-table tr.oob-total td { background:#105436 !important; color:#fff !important; font-weight:800; }"; document.head.appendChild(st); }
    root.innerHTML = `${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#105436;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:16px;color:#64748b;"><div class="spinner" style="margin:0 auto 10px;"></div>${this.esc(this.passo || "Aguarde…")}</div>` : ""}
      ${this.editor ? this.htmlEditor() : this.grupos ? (this.aberto ? this.htmlDetalhe() : this.htmlLista()) : ""}`;
    if (!this.editor && !this.aberto && this.grupos && window.MlEmpresaFilter && document.getElementById("oob-emp")) {
      const nomes = [...new Set(this.linhasLista().map((r) => r.nome))];
      MlEmpresaFilter.bind("oob-emp", {
        toggleOpen: () => { this.filtroEmpAberto = !this.filtroEmpAberto; this.render(); },
        close: () => { if (this.filtroEmpAberto) { this.filtroEmpAberto = false; setTimeout(() => this.render(), 0); } },
        setQuery: (q) => { this.filtroEmpBusca = q; this.render(); },
        toggleId: (id, on) => { const s = new Set(this.filtroEmp); if (on) s.add(id); else s.delete(id); this.filtroEmp = [...s]; this.render(); },
        selectAll: () => { this.filtroEmp = nomes; this.render(); },
        selectNone: () => { this.filtroEmp = []; this.render(); }
      });
    }
  }
};
window.OrionObrasApp = OrionObrasApp;
