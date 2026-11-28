/* Órion (transição) › Dashboard de orçamento — o mesmo menu do Órion (Orçamento › Dashboard de Orçamento), com as 9 telas:
 * Resumo Geral, Analítico de Gastos I, Realizado CP (detalhe), Analítico dos Gastos II, Geração de Caixa, Indicadores e Metas,
 * Investimentos, Recebimento por Grupo e Receita de Lotes.
 * No Integra elas são recortes de duas telas que já existem: Resumo do orçamento (orion-resumo.js) e Analítico de gastos
 * (orion-analitico.js). Aqui fica só a navegação: a barra com as 9 opções no topo das duas telas e o recorte de cada opção.
 * Não grava nada. */
const OrionDashOrcamento = {
  ITENS: [
    { k: "resumo", t: "Resumo Geral", tela: "resumo", modo: "resumo" },
    { k: "analitico1", t: "Analítico de Gastos I", tela: "analitico", conteudo: "despesas", visao: "cc" },
    { k: "realizado", t: "Realizado CP (detalhe)", tela: "analitico", conteudo: "despesas", visao: "pagamentos" },
    { k: "analitico2", t: "Analítico dos Gastos II", tela: "analitico", conteudo: "despesas", visao: "plano" },
    { k: "geracao", t: "Geração de Caixa", tela: "resumo", modo: "geracao" },
    { k: "indicadores", t: "Indicadores e Metas", tela: "resumo", modo: "indicadores" },
    { k: "investimentos", t: "Investimentos", tela: "analitico", conteudo: "investimentos", visao: "cc" },
    { k: "recebimento", t: "Recebimento por Grupo", tela: "analitico", conteudo: "receitas", visao: "grupo" },
    { k: "lotes", t: "Receita de Lotes", tela: "analitico", conteudo: "lotes", visao: "cc" }
  ],
  TELAS: {
    resumo: { tab: "orion-resumo", titulo: "Dashboard de orçamento (Órion)", perm: "sub_orion_geral_resumo_orcamento_acessar", app: () => window.OrionResumoApp },
    analitico: { tab: "orion-analitico", titulo: "Dashboard de orçamento (Órion)", perm: "sub_orion_geral_analitico_gastos_acessar", app: () => window.OrionAnaliticoApp }
  },

  pode(tela) {
    if (typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin()) return true;
    return typeof window.hasCrmPerm !== "function" || window.hasCrmPerm(this.TELAS[tela].perm);
  },
  /** Qual das 9 opções a tela está mostrando agora (pelo recorte em uso). */
  atual(tela) {
    if (tela === "resumo") { const m = (window.OrionResumoApp && OrionResumoApp.modoDash) || "resumo"; return m === "geracao" ? "geracao" : m === "indicadores" ? "indicadores" : "resumo"; }
    const A = window.OrionAnaliticoApp || {};
    const it = this.ITENS.find((x) => x.tela === "analitico" && x.conteudo === A.conteudo && x.visao === A.visao);
    return it ? it.k : null;
  },
  ir(k) {
    const it = this.ITENS.find((x) => x.k === k);
    if (!it) return;
    const T = this.TELAS[it.tela], app = T.app();
    if (!app) return;
    if (it.tela === "resumo") app.modoDash = it.modo;
    else {
      const C = window.OrionOrcamentoCalc;
      const tipo = (c) => { const r = C && C.RECORTES && C.RECORTES[c]; return r ? r.tipo : c === "receitas" ? "RECEITAS" : "DESPESAS"; };
      // mesmo tipo (despesas × despesas, receitas × receitas): troca o recorte sem precisar calcular de novo
      if (app.conteudo !== it.conteudo) { if (tipo(app.conteudo) === tipo(it.conteudo)) { app.conteudo = it.conteudo; app.abertos = {}; } else { app.conteudo = it.conteudo; app.versao = ""; app.abertos = {}; app.dados = null; app.meses = null; } }
      app.visao = it.visao;
    }
    const visivel = document.getElementById("tab-" + T.tab) && document.getElementById("tab-" + T.tab).style.display !== "none";
    if (!visivel && typeof window.switchTab === "function") window.switchTab(T.tab, T.titulo);
    else if (typeof app.render === "function") app.render();
    window.scrollTo(0, 0);
  },
  barra(tela) {
    const at = this.atual(tela);
    const itens = this.ITENS.filter((x) => this.pode(x.tela));
    return `<div class="odo-barra"><div class="odo-tit">Dashboard de orçamento</div><div class="odo-pills">${itens.map((x) => `<button type="button" class="odo-pill ${x.k === at ? "on" : ""}" onclick="OrionDashOrcamento.ir('${x.k}')">${x.t}</button>`).join("")}</div></div>`;
  },
  estilos() {
    if (document.getElementById("odo-estilos")) return;
    const st = document.createElement("style");
    st.id = "odo-estilos";
    st.textContent = `.odo-barra { margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid #e7f0ea; }
      .odo-tit { font-size:1.3rem; font-weight:800; color:var(--color-primary); margin-bottom:10px; }
      .odo-pills { display:flex; flex-wrap:wrap; gap:8px; }
      .odo-pill { border:none; background:var(--color-bg-light); padding:8px 16px; border-radius:20px; font-family:var(--font-family); font-size:0.8rem; font-weight:700; color:var(--color-text-muted); cursor:pointer; transition:var(--transition-smooth); white-space:nowrap; }
      .odo-pill:hover { background:rgba(16,84,54,.05); color:var(--color-primary); }
      .odo-pill.on { background:var(--color-primary); color:#fff; }`;
    document.head.appendChild(st);
  },
  /** Coloca a barra no topo das duas telas, depois que elas desenham. */
  ligar() {
    Object.keys(this.TELAS).forEach((tela) => {
      const app = this.TELAS[tela].app();
      if (!app || app._dashLigado) return;
      const orig = app.render;
      app.render = function () {
        orig.apply(this, arguments);
        if (this !== app) return; // Orçado × Realizado herda do Resumo: sem a barra
        const root = typeof this.root === "function" ? this.root() : null;
        if (!root) return;
        OrionDashOrcamento.estilos();
        root.insertAdjacentHTML("afterbegin", OrionDashOrcamento.barra(tela));
      };
      app._dashLigado = true;
    });
  }
};
window.OrionDashOrcamento = OrionDashOrcamento;
OrionDashOrcamento.ligar();
