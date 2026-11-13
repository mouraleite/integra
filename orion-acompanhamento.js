/* Órion (transição) › Acompanhamento de empreendimentos (inclui a DFC de empreendimentos) — vindo do ML Órion (Rentabilidade de Produtos).
 * Para cada viabilidade aprovada com centro de custo da obra: o previsto da viabilidade (motor do Órion) contra o realizado do caixa
 * da obra (regra do Integra, orion-realizado.js) e as vendas da Posição de estoque do Comercial (estoque_comercial).
 * DFC do empreendimento por ano e por mês: previsto, realizado, diferença e a projeção "realizado até o último mês fechado
 * + previsto daqui para frente", com TIR, VPL e exposição. O mês 1 da viabilidade vem da data de lançamento (aba Datas) e pode ser ajustado aqui.
 * Diferença para o Órion: o realizado é o do caixa por centro de custo (regra do Integra), sem a DRE contábil. Só grava o "mês 1". */
const OrionAcompanhamentoApp = {
  lista: null,
  taxas: null,
  aberto: null,     // { doc, cc, inicio, dados, carregando, erro, verMeses }
  carregando: false,
  erro: "",

  V() { return window.OrionViabilidadeCalc; },
  R() { return window.OrionRealizado; },
  fc() { return window.firebaseCollections; },
  root() { return document.getElementById("orion-acompanhamento-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  R0(v) { if (v == null || isNaN(v)) return "—"; if (Math.abs(v) < 0.5) v = 0; return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); },
  P(v) { return v == null || isNaN(v) ? "n/d" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; },
  MESES: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
  podeEditar() { return (typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin()) || (typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_orion_geral_viabilidades_editar")); },

  init() { this.render(); if (!this.lista) this.carregar(); },

  async carregar() {
    const fc = this.fc();
    if (!window.firebaseDb || !fc || !window.OrionStore) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
    this.carregando = true; this.erro = ""; this.render();
    try {
      const padrao = window.OrionPremissasApp ? JSON.parse(JSON.stringify(window.OrionPremissasApp.FUNDING_PADRAO)) : {};
      this.taxas = (await window.OrionStore.ler("taxas_funding", padrao)).itens || {};
      const snap = await fc.getDocs(fc.collection(window.firebaseDb, "orion_viabilidades"));
      const l = [];
      snap.forEach((d) => { const x = d.data(); x._id = d.id; if (x.status === "Aprovado" && !x.versao_de) l.push(x); });
      this.lista = l.sort((a, b) => String(a.project_name).localeCompare(String(b.project_name), "pt-BR"));
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false;
    this.render();
  },

  fases(doc) { if (Array.isArray(doc.fases)) return doc.fases; try { return JSON.parse(doc.fases_json || "[]"); } catch (e) { return []; } },

  /** Previsto: todas as fases somadas mês a mês (mesmo mês 1). */
  previsto(doc) {
    const V = this.V();
    const fases = this.fases(doc);
    const d = Object.assign({}, doc, { fases });
    const rs = fases.map((f, i) => V.calcular(V.faseDoDoc(d, i), null, this.taxas));
    return { rs, fluxo: V.somarFluxos(rs), ind: rs.length === 1 ? rs[0].indicators : V.consolidar(rs, (doc.taxa_desconto_vpl || 12) / 100) };
  },

  /** Mês 1 da viabilidade: o informado aqui; senão a data de lançamento, de início de obras ou de registro da 1ª fase. */
  inicioDe(doc) {
    if (doc.mes1_acompanhamento) return doc.mes1_acompanhamento;
    const dt = (this.fases(doc)[0] || {}).dates || {};
    const d = dt.data_lancamento || dt.data_inicio_obras || dt.data_registro || dt.data_inicio_comercial || "";
    return /^\d{4}-\d{2}/.test(String(d)) ? String(d).slice(0, 7) : "";
  },

  ultimoMesCompleto() {
    const h = new Date();
    const d = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  },

  async abrir(id) {
    const doc = (this.lista || []).find((x) => x._id === id);
    if (!doc) return;
    this.aberto = { doc, cc: String(doc.obra_cc || "").replace(/\D/g, ""), inicio: this.inicioDe(doc), dados: null, carregando: false, erro: "", verMeses: false };
    this.render();
    if (this.aberto.cc && this.aberto.inicio) this.calcular();
  },
  fechar() { this.aberto = null; this.render(); },
  setInicio(v) { if (this.aberto) { this.aberto.inicio = v; this.aberto.dados = null; this.render(); } },
  setCc(v) { if (this.aberto) { this.aberto.cc = String(v || "").replace(/\D/g, ""); this.aberto.dados = null; this.render(); } },
  alternarMeses() { if (this.aberto) { this.aberto.verMeses = !this.aberto.verMeses; this.render(); } },

  async lerVendas(cc) {
    const fc = this.fc();
    const unidades = [];
    for (let n = 0; n < 50; n++) {
      const s = await fc.getDoc(fc.doc(window.firebaseDb, "estoque_comercial", `cc_${cc}_${n}`));
      if (!s.exists()) break;
      unidades.push(...((s.data() || {}).units || []));
    }
    const por = {};
    let vgvVendido = 0;
    unidades.forEach((u) => {
      const k = String(u.commercialStock || "").toUpperCase() || "?";
      por[k] = (por[k] || 0) + 1;
      if (k === "V") vgvVendido += Number(u.contractValue) || 0;
    });
    return { total: unidades.length, por, vgvVendido };
  },

  async calcular() {
    const a = this.aberto, R = this.R();
    if (!a || !a.cc || !a.inicio) return;
    a.carregando = true; a.erro = ""; this.render();
    try {
      if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
      const prev = this.previsto(a.doc);
      const empresas = R.empresasDosCcs([a.cc]);
      if (!empresas.length) throw new Error(`O centro de custo ${a.cc} não está no cadastro de Centros de Custo do Integra (sem empresa).`);
      const ate = this.ultimoMesCompleto();
      const [ai] = a.inicio.split("-").map(Number), [aa, ma] = ate.split("-").map(Number);
      const realizado = [];
      let movimentos = 0;
      for (let ano = Math.min(ai, aa); ano <= aa; ano++) {
        a.passo = `Lendo o realizado de ${ano}…`; this.render();
        const r = await R.buscar(ano, ano < aa ? 12 : ma, empresas);
        movimentos += r.movimentos;
        r.alocacoes.forEach((x) => { if (x.cc === a.cc) realizado.push({ ano, mes: x.mes, valor: x.valor }); });
      }
      a.passo = "Lendo as vendas (Posição de estoque)…"; this.render();
      let vendas = null;
      try { vendas = await this.lerVendas(a.cc); } catch (e) { vendas = null; }
      const acomp = this.V().acompanhamento({ fluxo: prev.fluxo, inicio: a.inicio, ate, realizado, tmaAnual: (a.doc.taxa_desconto_vpl || 12) / 100 });
      a.dados = { prev, acomp, vendas, empresas, ate, movimentos, alocacoes: realizado.length };
    } catch (e) { a.erro = e.message || String(e); }
    a.carregando = false; a.passo = "";
    this.render();
  },

  async gravarInicio() {
    const a = this.aberto;
    if (!a || !this.podeEditar() || !/^\d{4}-\d{2}$/.test(a.inicio)) return;
    const fc = this.fc();
    const ref = fc.doc(window.firebaseDb, "orion_viabilidades", a.doc._id);
    try {
      await fc.runTransaction(window.firebaseDb, async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error("Viabilidade não encontrada.");
        const atual = s.data();
        tx.set(ref, Object.assign({}, atual, { mes1_acompanhamento: a.inicio, obra_cc: a.cc || atual.obra_cc || "", versao: (Number(atual.versao) || 0) + 1, atualizado_por: window.OrionStore.usuario(), atualizado_em: new Date().toISOString() }));
      });
      a.doc.mes1_acompanhamento = a.inicio; a.doc.obra_cc = a.cc;
      a.aviso = "Mês 1 e centro de custo gravados nesta viabilidade.";
    } catch (e) { a.erro = e.message || String(e); }
    this.render();
  },

  htmlLista() {
    const linhas = (this.lista || []).map((d) => {
      let ind = null;
      try { ind = this.previsto(d).ind; } catch (e) { ind = null; }
      const ini = this.inicioDe(d);
      return `<tr style="cursor:pointer" onclick="OrionAcompanhamentoApp.abrir('${this.esc(d._id)}')">
        <td>${this.esc(d.project_name)}</td><td>${this.esc(d.city)}</td>
        <td>${d.obra_cc ? this.esc(d.obra_cc + " " + (d.obra_cc_nome || "")) : '<span class="ov-neg">sem centro de custo</span>'}</td>
        <td class="is-center">${ini ? this.esc(ini.split("-").reverse().join("/")) : '<span class="ov-neg">sem data</span>'}</td>
        <td class="is-right">${ind ? this.R0(ind.vgv_total) : "—"}</td><td class="is-right">${ind ? this.R0(ind.lucro_liquido) : "—"}</td><td class="is-right">${ind ? this.P(ind.tir_aa) : "—"}</td></tr>`;
    }).join("");
    return `<div class="cc-scroll"><table class="cc-table">
      <colgroup><col><col style="width:140px"><col style="width:260px"><col style="width:90px"><col style="width:140px"><col style="width:140px"><col style="width:90px"></colgroup>
      <thead><tr><th>Empreendimento (viabilidade aprovada)</th><th>Cidade</th><th>Centro de custo da obra</th><th class="is-center">Mês 1</th><th class="is-right">VGV previsto</th><th class="is-right">Lucro previsto</th><th class="is-right">TIR prevista</th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="7" style="text-align:center;padding:30px">Nenhuma viabilidade aprovada (versão oficial). Aprove em Órion (transição) › Viabilidades.</td></tr>`}</tbody></table></div>
      <div style="margin-top:8px;font-size:0.72rem;color:#64748b">Clique num empreendimento para ver o previsto × realizado. O realizado é lido do Sienge na hora (caixa da obra) e pode levar alguns minutos.</div>`;
  },

  htmlDetalhe() {
    const a = this.aberto, d = a.dados;
    const f = (v) => this.R0(v);
    const cls = (v) => (v < -0.5 ? "ov-neg" : "");
    const F = window.OrionFiltros;
    const topo = `<div style="font-size:1rem;font-weight:700;margin-bottom:8px">${this.esc(a.doc.project_name)}</div>
      ${F.grade([{ campos: [
        F.campo("Centro de custo da obra", `<input class="idx-select" value="${this.esc(a.cc)}" onchange="OrionAcompanhamentoApp.setCc(this.value)">`),
        F.campo("Mês 1 da viabilidade", `<input type="month" class="idx-select" value="${this.esc(a.inicio)}" onchange="OrionAcompanhamentoApp.setInicio(this.value)">`)] }],
        `${this.podeEditar() ? `<button type="button" class="btn btn-secondary" title="Grava o mês 1 e o centro de custo nesta viabilidade" onclick="OrionAcompanhamentoApp.gravarInicio()">Gravar</button>` : ""}
        <button type="button" class="btn btn-primary" ${a.carregando ? "disabled" : ""} onclick="OrionAcompanhamentoApp.calcular()">${a.carregando ? "Calculando..." : "Calcular"}</button>
        <button type="button" class="btn btn-secondary" onclick="OrionAcompanhamentoApp.fechar()">Voltar à lista</button>`, { acaoCls: "ofg-acao3" })}
      ${a.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:10px">${this.esc(a.erro)}</div>` : ""}
      ${a.aviso ? `<div style="padding:8px 12px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;margin-bottom:10px">${this.esc(a.aviso)}</div>` : ""}
      ${!a.cc || !a.inicio ? `<div style="font-size:0.8rem;color:#92400e">Informe o centro de custo da obra e o mês 1 da viabilidade (mês da data de lançamento) e clique em Calcular.</div>` : ""}
      ${a.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(a.passo || "Calculando…")}</p></div>` : ""}`;
    if (!d) return topo;
    const ac = d.acomp, ind = d.prev.ind;
    const v = d.vendas;
    const card = (t, val, sub) => `<div class="ov-card"><div class="r">${t}</div><div class="v">${val}</div>${sub ? `<div style="font-size:0.68rem;color:#64748b">${sub}</div>` : ""}</div>`;
    const vendidas = v ? (v.por.V || 0) : 0;
    const cards = `<div class="ov-cards">
      ${card("VGV previsto", "R$ " + f(ind.vgv_total))}
      ${v && v.total ? card("Vendido (contratos)", "R$ " + f(v.vgvVendido), `${vendidas} de ${v.total} unidades · ${this.P(v.total ? vendidas / v.total * 100 : 0)}`) : card("Vendido", "—", "sem Posição de estoque para este centro de custo")}
      ${v && v.total ? card("Estoque disponível", String(v.por.D || 0) + " un.", `reservadas ${v.por.C || 0} · propostas ${v.por.P || 0} · permuta ${v.por.E || 0}`) : ""}
      ${card("Caixa previsto até " + d.ate.split("-").reverse().join("/"), "R$ " + f(ac.ate.prev.fluxo))}
      ${card("Caixa realizado até " + d.ate.split("-").reverse().join("/"), "R$ " + f(ac.ate.real.fluxo), `entradas ${f(ac.ate.real.ent)} · saídas ${f(ac.ate.real.sai)}`)}
      ${card("Resultado previsto", "R$ " + f(ac.previsto.resultado), "fluxo total da viabilidade")}
      ${card("Resultado projetado", "R$ " + f(ac.projecao.resultado), "realizado até hoje + previsto daqui para frente")}
      ${card("TIR prevista × projetada", `${this.P(ind.tir_aa)} × ${this.P(ac.projecao.tir_aa)}`)}
      ${card("Exposição projetada", "R$ " + f(ac.projecao.exposicao))}
    </div>`;
    const anos = ac.anos.map((y) => `<tr><td>${y.ano}${y.temReal && y.mesesReais < 12 ? ` <small>(${y.mesesReais} mês(es) realizados)</small>` : ""}</td>
      <td class="is-right">${f(y.prev.ent)}</td><td class="is-right">${f(-y.prev.sai)}</td><td class="is-right ${cls(y.prev.fluxo)}"><b>${f(y.prev.fluxo)}</b></td>
      <td class="is-right">${y.temReal ? f(y.real.ent) : ""}</td><td class="is-right">${y.temReal ? f(-y.real.sai) : ""}</td><td class="is-right ${cls(y.real.fluxo)}"><b>${y.temReal ? f(y.real.fluxo) : ""}</b></td>
      <td class="is-right ${cls(y.proj)}">${f(y.proj)}</td></tr>`).join("");
    const meses = a.verMeses ? `<div class="ov-sec">Mês a mês</div><div class="cc-scroll" style="max-height:520px"><table class="cc-table">
        <colgroup><col style="width:90px"><col span="9" style="width:120px"></colgroup>
        <thead><tr><th>Mês</th><th class="is-right">Prev. entradas</th><th class="is-right">Prev. saídas</th><th class="is-right">Prev. fluxo</th><th class="is-right">Real. entradas</th><th class="is-right">Real. saídas</th><th class="is-right">Real. fluxo</th><th class="is-right">Projeção</th><th class="is-right">Acum. previsto</th><th class="is-right">Acum. projeção</th></tr></thead>
        <tbody>${ac.meses.map((m) => `<tr style="${m.passado ? "" : "color:#64748b"}"><td>${this.MESES[m.mes - 1]}/${m.ano}</td><td class="is-right">${f(m.prev.ent)}</td><td class="is-right">${f(-m.prev.sai)}</td><td class="is-right">${f(m.prev.fluxo)}</td>
          <td class="is-right">${m.real ? f(m.real.ent) : ""}</td><td class="is-right">${m.real ? f(-m.real.sai) : ""}</td><td class="is-right">${m.real ? f(m.real.fluxo) : ""}</td><td class="is-right">${f(m.proj)}</td><td class="is-right ${cls(m.acPrev)}">${f(m.acPrev)}</td><td class="is-right ${cls(m.acProj)}">${f(m.acProj)}</td></tr>`).join("")}</tbody></table></div>` : "";
    return topo + `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">Previsto: viabilidade aprovada (${this.fases(a.doc).length} fase(s), mês 1 = ${this.esc(a.inicio.split("-").reverse().join("/"))}). Realizado: caixa e bancos do Sienge pela regra do Integra, centro de custo ${this.esc(a.cc)}, empresas ${this.esc(d.empresas.join(", "))}, até ${this.esc(d.ate.split("-").reverse().join("/"))} (${d.alocacoes} lançamentos). Vendas: Posição de estoque do Comercial.${ac.foraDoPrazo ? ` ${ac.foraDoPrazo} mês(es) com realizado fora do prazo da viabilidade.` : ""}</div>
      ${cards}
      <div class="ov-sec">DFC do empreendimento por ano</div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col style="width:170px"><col span="7" style="width:130px"></colgroup>
        <thead><tr><th>Ano</th><th class="is-right">Previsto entradas</th><th class="is-right">Previsto saídas</th><th class="is-right">Previsto fluxo</th><th class="is-right">Realizado entradas</th><th class="is-right">Realizado saídas</th><th class="is-right">Realizado fluxo</th><th class="is-right">Projeção</th></tr></thead>
        <tbody>${anos}<tr class="ov-total"><td>Total</td><td colspan="2"></td><td class="is-right">${f(ac.previsto.resultado)}</td><td class="is-right">${f(ac.ate.real.ent)}</td><td class="is-right">${f(-ac.ate.real.sai)}</td><td class="is-right">${f(ac.ate.real.fluxo)}</td><td class="is-right">${f(ac.projecao.resultado)}</td></tr></tbody></table></div>
      <button type="button" class="btn btn-secondary" style="height:32px;margin-top:8px" onclick="OrionAcompanhamentoApp.alternarMeses()">${a.verMeses ? "Esconder mês a mês" : "Ver mês a mês"}</button>${meses}`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.V()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    if (window.OrionViabilidadesApp && window.OrionViabilidadesApp.estilos) window.OrionViabilidadesApp.estilos();
    root.innerHTML = `${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${!this.aberto ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button type="button" class="btn btn-primary cc-atualizar" style="height:40px" ${this.carregando ? "disabled" : ""} onclick="OrionAcompanhamentoApp.carregar()">Atualizar</button></div>` : ""}
      ${this.carregando && !this.lista ? `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>` : (this.aberto ? this.htmlDetalhe() : this.htmlLista())}`;
  }
};

window.OrionAcompanhamentoApp = OrionAcompanhamentoApp;
