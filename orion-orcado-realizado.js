/* Órion (transição) › Orçado × Realizado — a tela do ML Órion (Orçamento › Orçado x Realizado) com a identidade do Integra.
 * Topo como no Órion: Diretoria, Departamento, Ano, Meses (liga/desliga + meses) e o painel Filtros (busca, ID do centro de custo,
 * produto, plano financeiro ou forma de venda, ID da empresa, empresa). Abas:
 *  - Consolidado: comparar com Orçado ou Forecast (com a versão), visão Executiva (variação, leitura executiva, composição do desvio,
 *    referência × realizado por mês, pontos de atenção, top drivers, cartões Resultado / Receitas / Despesas / VGV líq.) e
 *    Analítica (Receitas, Despesas, Resultado e Vendas mês a mês: referência, realizado e desvio %);
 *  - Despesas e Receitas: por produto × plano, linhas Orç./Fcst., Real. e Desvio % mês a mês;
 *  - Vendas: por produto, VGV líquido e os blocos Vendas brutas / Distratos / VGV líquido (unidades, VGV e desvios);
 *  - Comparativo de Versões: Consolidado / Despesas / Receitas / Vendas, versão base × versão comparada (Orçamento e cada forecast),
 *    visão Executiva e Analítica (todas as linhas, destaques, alterações, inclusões, exclusões, por mês, Excel completo);
 *  - Visualização: uma versão por vez, agrupada por produto com os planos (vendas: blocos Vendas, Distratos e VGV líquido).
 * Dados do Integra: orçamentos e forecasts trazidos do Órion (orion_orcamentos / orion_forecasts, mesma regra de leitura das outras telas),
 * realizado de despesas e receitas pela regra do Integra (orion-realizado.js, caixa e bancos), realizado de vendas pelos contratos de
 * venda do Sienge (mesma leitura do Acompanhamento de empreendimentos; distrato valorizado pelo ticket orçado, como no Órion).
 * Só leitura: não grava nada. */
(function () {
  const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const TODOS_MESES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const N = "OrionOxRApp";
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const zeros = () => new Array(12).fill(0);
  const soma = (a, ms) => ms.reduce((s, i) => s + (Number(a && a[i]) || 0), 0);
  const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
  /** calculo_variacao_perc do Órion */
  const varPerc = (atual, comp) => (comp === 0 ? (atual > 0 ? 1 : atual === 0 ? 0 : -1) : (atual - comp) / comp);

  /** parseCentroNome do Órion: "CIDADE - PRODUTO" → produto. */
  function produtoDoNome(nome) {
    if (!nome) return "";
    const up = String(nome).toUpperCase();
    if (up.indexOf("AUTOMÓVEL") >= 0 || up.indexOf("AUTOMOVEL") >= 0) return "FROTA";
    const p = String(nome).split(" -").map((x) => x.trim());
    if (p.length < 2) return String(nome);
    const suf = ["INATIVO", "ATIVO", "ENCERRADO", "SUSPENSO"].indexOf(p[p.length - 1].toUpperCase()) >= 0;
    if (p.length === 2) return p[1];
    return (suf ? p.slice(1, -1) : p.slice(1)).join(" -");
  }
  /** Rótulos de versão do Órion (format_visualizacao_versao_label). */
  const rotuloOrc = (d) => window.OrionOrcamentoCalc.rotuloVersao(d, "orcamento");
  const rotuloFc = (d) => window.OrionOrcamentoCalc.rotuloVersao(d, "forecast");
  const rolling = (d) => { const m = String(d || "").match(/(\d+)\s*\+\s*\d+/); return m ? Number(m[1]) : 99; };

  const favor = (v, inverted) => (v === 0 ? true : inverted ? v < 0 : v > 0);
  const positivoBom = (tipo) => tipo === "VENDAS" || tipo === "RECEITAS" || tipo === "CONSOLIDADO";
  const favTipo = (v, tipo) => (v === 0 ? true : (v > 0 && positivoBom(tipo)) || (v < 0 && !positivoBom(tipo)));
  const ehDistrato = (l) => String(l.obs || "").indexOf("Distrato") >= 0 || Number(l.vendas) < 0;

  const App = {
    ano: String(new Date().getFullYear()), diretoria: "TODAS", dept: "TODOS", aba: "consolidado",
    mesesOn: false, mesesSel: TODOS_MESES.slice(),
    fo: { busca: "", ids: [], prods: [], planos: [], empIds: [], emps: [], aberto: false, open: null, q: {} },
    cabs: { orcamento: null, forecast: null }, cadDep: null, docCache: {}, fcLinhas: {}, vendasReal: {}, memo: {},
    calc: null, carregando: false, passo: "", erro: "", carregandoBase: false,
    tabs: {
      consolidado: { modo: "orcado", versao: "", visao: "executiva", bloco: "resultado", vCat: "liquido", vMet: "vgv", busca: "", abertos: { receitas: false, despesas: false, vendas: false }, vProd: {} },
      despesas: { modo: "orcado", versao: "", sort: null },
      receitas: { modo: "orcado", versao: "", sort: null },
      vendas: { modo: "orcado", versao: "", sort: null, abertos: {} }
    },
    cmp: { tipo: "DESPESAS", a: "", b: "", res: null, carregando: false, view: "destaques", desvio: "todos", visao: "executiva", busca: "", mat: "todos", vMet: "vgv", vCat: "todos", modo: "total" },
    vis: { tipo: "DESPESAS", versao: "", vMet: "vgv", exp: {}, dados: null, chave: "", carregando: false },

    C() { return window.OrionOrcamentoCalc; },
    R() { return window.OrionRealizado; },
    fc() { return window.firebaseCollections; },
    root() { return document.getElementById("orion-oxr-root"); },
    esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    rs(c) { const v = Number(c) || 0; return (v < 0 ? "-" : "") + "R$ " + this.C().fmtReais(Math.abs(v), true); },
    un(v) { return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); },
    pc(v, casas) { return ((Number(v) || 0) * 100).toFixed(casas == null ? 1 : casas).replace(".", ",") + "%"; },
    sinal(v) { return v > 0 ? "+" : ""; },
    /** valor curto do gráfico por mês (Órion: 7.1M / 963k) */
    curto(c, fmt) {
      const v = (Number(c) || 0) / 100, a = Math.abs(v);
      if (fmt === "un") return this.un(c);
      if (a >= 1e6) return (v < 0 ? "−" : "") + (a / 1e6).toFixed(1).replace(".", ",") + "M";
      if (a >= 1e3) return (v < 0 ? "−" : "") + Math.round(a / 1e3) + "k";
      return this.rs(c);
    },
    /** meses visíveis (0..11): todos com o filtro desligado */
    ms() { return this.mesesOn ? this.mesesSel.slice().sort((a, b) => a - b) : TODOS_MESES.slice(); },

    init() {
      this.estilos();
      if (!this.cabs.orcamento && !this.carregandoBase) this.carregarBase();
      this.render();
    },

    estilos() {
      if (document.getElementById("oxr-estilos")) return;
      const st = document.createElement("style");
      st.id = "oxr-estilos";
      st.textContent = `
        #orion-oxr-root .oxr-tit { font-size:1.4rem; font-weight:800; color:var(--color-primary); margin:0 0 12px; }
        #orion-oxr-root .oxr-card { background:#fff; border:1px solid rgba(16,84,54,.08); border-radius:var(--border-radius-md); box-shadow:var(--shadow-sm); padding:12px 16px; margin-bottom:12px; }
        #orion-oxr-root .oxr-barra { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
        #orion-oxr-root .oxr-barra .btn { height:40px; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
        #orion-oxr-root .oxr-lbl { font-size:0.68rem; font-weight:700; color:#6b8474; text-transform:uppercase; letter-spacing:.04em; }
        #orion-oxr-root .oxr-sw { position:relative; width:36px; height:20px; border-radius:999px; border:none; background:#cbd5e1; cursor:pointer; padding:0; }
        #orion-oxr-root .oxr-sw.on { background:var(--color-primary); }
        #orion-oxr-root .oxr-sw::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 2px rgba(0,0,0,.2); }
        #orion-oxr-root .oxr-sw.on::after { left:18px; }
        #orion-oxr-root .oxr-mes { border:1px solid #cfe0d6; background:#fff; color:#4a6355; height:28px; padding:0 10px; border-radius:999px; font-size:0.74rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
        #orion-oxr-root .oxr-mes.on { border-color:var(--color-primary); color:var(--color-primary); background:#e7f6ee; }
        #orion-oxr-root .oxr-mes:disabled { opacity:.45; cursor:not-allowed; }
        #orion-oxr-root .oxr-abas { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
        #orion-oxr-root .oxr-aba { border:none; background:var(--color-bg-light); padding:8px 16px; border-radius:20px; font-family:var(--font-family); font-size:0.82rem; font-weight:700; color:var(--color-text-muted); cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
        #orion-oxr-root .oxr-aba svg { width:15px; height:15px; }
        #orion-oxr-root .oxr-aba:hover { background:rgba(16,84,54,.05); color:var(--color-primary); }
        #orion-oxr-root .oxr-aba.on { background:var(--color-primary); color:#fff; }
        #orion-oxr-root .oxr-seg { display:inline-flex; border:1px solid #cfe0d6; border-radius:8px; overflow:hidden; }
        #orion-oxr-root .oxr-seg button { border:none; background:#fff; color:#4a6355; padding:0 12px; height:30px; font-size:0.76rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
        #orion-oxr-root .oxr-seg button.on { background:var(--color-primary); color:#fff; }
        #orion-oxr-root .oxr-chip { border:1px solid transparent; background:transparent; color:#6b8474; padding:3px 9px; border-radius:7px; font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; cursor:pointer; font-family:var(--font-family); }
        #orion-oxr-root .oxr-chip.on { background:#fff; color:#1c2e24; border-color:#d6e2db; box-shadow:var(--shadow-sm); }
        #orion-oxr-root .oxr-kpi { display:grid; grid-template-columns:1fr auto 1fr; border:1px solid #dfe9e3; border-radius:10px; overflow:hidden; background:#fff; }
        #orion-oxr-root .oxr-kpi > div { padding:10px 14px; }
        #orion-oxr-root .oxr-kpi .v { font-size:1.25rem; font-weight:800; color:#0f2a1c; font-variant-numeric:tabular-nums; }
        #orion-oxr-root .oxr-kpi .s { font-size:0.72rem; color:#6b8474; }
        #orion-oxr-root .oxr-kpi-pe { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; padding:6px 12px; border-top:1px solid #eef3f0; background:#f7faf8; grid-column:1 / -1; }
        #orion-oxr-root .oxr-box { border:1px solid #dfe9e3; border-radius:10px; background:#fff; padding:10px 12px; }
        #orion-oxr-root .oxr-box h5 { margin:0 0 6px; font-size:0.66rem; font-weight:800; color:#6b8474; text-transform:uppercase; letter-spacing:.05em; display:flex; align-items:center; justify-content:space-between; gap:6px; }
        #orion-oxr-root .oxr-g2 { display:grid; grid-template-columns:1.3fr .9fr; gap:8px; margin:8px 0; }
        #orion-oxr-root .oxr-g3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:8px 0; }
        #orion-oxr-root .oxr-g4 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin:8px 0; }
        #orion-oxr-root .oxr-g2 > *, #orion-oxr-root .oxr-g3 > *, #orion-oxr-root .oxr-g4 > *, #orion-oxr-root .oxr-box > * { min-width:0; }
        #orion-oxr-root .oxr-drv > div > span:first-child { min-width:0; }
        @media (max-width:1200px) { #orion-oxr-root .oxr-g2, #orion-oxr-root .oxr-g3 { grid-template-columns:1fr; } #orion-oxr-root .oxr-g4 { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        #orion-oxr-root .oxr-bar { height:5px; background:#eef3f0; border-radius:999px; overflow:hidden; }
        #orion-oxr-root .oxr-bar > div { height:100%; border-radius:999px; }
        #orion-oxr-root .oxr-drv { display:block; width:100%; text-align:left; border:1px solid #eef3f0; background:#fbfdfc; border-radius:7px; padding:5px 8px; margin-bottom:4px; cursor:pointer; font-family:var(--font-family); }
        #orion-oxr-root .oxr-drv:hover { border-color:#9fcdb4; background:#f0f8f3; }
        #orion-oxr-root .oxr-alerta { border:1px solid; border-radius:7px; padding:5px 8px; margin-bottom:4px; font-size:0.74rem; }
        #orion-oxr-root .oxr-tags { display:flex; flex-wrap:wrap; gap:5px; margin:8px 0; }
        #orion-oxr-root .oxr-tag { display:inline-flex; gap:6px; align-items:center; border:1px solid #dfe9e3; background:#f7faf8; border-radius:7px; padding:3px 9px; font-size:0.74rem; }
        #orion-oxr-root .oxr-tag b { font-variant-numeric:tabular-nums; }
        #orion-oxr-root .oxr-tag span { font-size:0.66rem; font-weight:800; color:#6b8474; text-transform:uppercase; }
        #orion-oxr-root .oxr-badge { display:inline-flex; align-items:center; gap:3px; padding:1px 7px; border-radius:6px; font-size:0.72rem; font-weight:700; }
        #orion-oxr-root .oxr-strip { display:flex; gap:4px; overflow-x:auto; }
        #orion-oxr-root .oxr-strip .m { min-width:62px; flex:1; display:flex; flex-direction:column; align-items:center; border-radius:7px; padding:4px 2px; cursor:pointer; border:none; background:none; font-family:var(--font-family); }
        #orion-oxr-root .oxr-strip .m:hover { background:#f0f8f3; }
        #orion-oxr-root .oxr-filtros { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; padding:12px 0 2px; }
        #orion-oxr-root .oxr-filtros > div { min-width:0; }
        #orion-oxr-root .oxr-filtros .ml-emp-filter { width:100%; min-width:0 !important; }
        #orion-oxr-root .oxr-filtros .ml-emp-filter-btn { max-width:100%; min-width:0 !important; width:100%; box-sizing:border-box; }
        @media (max-width:1280px) { #orion-oxr-root .oxr-filtros { grid-template-columns:repeat(3,minmax(0,1fr)); } }
        #orion-oxr-root .cc-table.oxr-mat td, #orion-oxr-root .cc-table.oxr-mat th { font-variant-numeric:tabular-nums; }
        #orion-oxr-root .cc-table tr.oxr-g td { background:#e7f6ee !important; color:#105436 !important; font-weight:700; cursor:pointer; }
        #orion-oxr-root .cc-table tr.oxr-tot td { background:#105436 !important; color:#fff !important; font-weight:800; }
        #orion-oxr-root .cc-table tr.oxr-sec-r td { background:#ecfdf5 !important; color:#065f46 !important; font-weight:700; }
        #orion-oxr-root .cc-table tr.oxr-sec-d td { background:#fef2f2 !important; color:#991b1b !important; font-weight:700; }
        #orion-oxr-root .cc-table tr.oxr-sec-v td { background:#fffbeb !important; color:#92400e !important; font-weight:700; }
        #orion-oxr-root .cc-table tr.oxr-sec-res td { background:#f1f5f4 !important; color:#0f2a1c !important; font-weight:800; border-top:2px solid #cbd5d0; border-bottom:2px solid #cbd5d0; }
        #orion-oxr-root .cc-table td.oxr-sticky, #orion-oxr-root .cc-table th.oxr-sticky { position:sticky; left:0; z-index:2; }
        #orion-oxr-root .cc-table th.oxr-sticky { z-index:4; }
        #orion-oxr-root .cc-table td.oxr-sticky { background:inherit; }
        #orion-oxr-root .cc-table tbody tr td.oxr-sticky { background:#fff; }
        #orion-oxr-root .cc-table tbody tr:nth-child(even) td.oxr-sticky { background:#f7faf8; }
        #orion-oxr-root .oxr-vazio { border:1px dashed #cfe0d6; border-radius:10px; background:#fbfdfc; padding:40px 16px; text-align:center; color:#6b8474; }
        #orion-oxr-root .oxr-link { background:none; border:none; color:var(--color-primary); font-weight:700; font-size:0.72rem; cursor:pointer; padding:0; font-family:var(--font-family); }
        #orion-oxr-root .oxr-link:hover { text-decoration:underline; }
      `;
      document.head.appendChild(st);
    },

    /* ================= leitura ================= */
    async carregarBase() {
      const fc = this.fc();
      if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
      this.carregandoBase = true;
      try {
        const ler = async (col) => { const snap = await fc.getDocs(fc.collection(window.firebaseDb, col)); const l = []; snap.forEach((d) => l.push(d.data())); return l; };
        const [o, f, dep] = await Promise.all([ler("orion_orcamentos"), ler("orion_forecasts"), window.OrionStore ? window.OrionStore.ler("departamentos", null).catch(() => ({})) : Promise.resolve({})]);
        this.cabs = { orcamento: o, forecast: f };
        this.cadDep = (dep && dep.itens) || null;
        const anos = this.anos();
        if (anos.length && anos.indexOf(Number(this.ano)) < 0) this.ano = String(anos[anos.length - 1]);
      } catch (e) { this.erro = e.message || String(e); }
      this.carregandoBase = false;
      this.render();
    },
    anos() {
      const l = (this.cabs.orcamento || []).concat(this.cabs.forecast || []);
      return [...new Set(l.map((c) => Number(c.ano)).filter(Boolean))].sort((a, b) => a - b);
    },
    dirDe(depId) {
      const d = ((this.cadDep || {}).departamentos || []).find((x) => String(x.id) === String(depId));
      return d ? String(d.diretoria || "") : "";
    },
    /** documentos do ano no escopo (diretoria / departamento) */
    escopo(base) {
      return (this.cabs[base] || []).filter((c) => {
        if (String(c.ano) !== String(this.ano)) return false;
        const dep = c.departamento ? String(c.departamento.id) : "";
        if (this.dept !== "TODOS") return dep === String(this.dept);
        return this.diretoria === "TODAS" || this.dirDe(dep) === this.diretoria;
      });
    },
    versoesFc(tipos) { return this.C().versoesForecast(this.escopo("forecast"), this.ano, tipos).map((v) => v.descricao); },
    async lerDoc(base, cab) {
      const k = base + ":" + cab._id;
      if (this.docCache[k]) return this.docCache[k];
      const fc = this.fc(), col = base === "orcamento" ? "orion_orcamento_itens" : "orion_forecast_itens", blocos = [];
      for (let b = 0; b < (cab.blocos || 1); b++) { const s = await fc.getDoc(fc.doc(window.firebaseDb, col, `${cab._id}_${b}`)); if (s.exists()) blocos.push(s.data()); }
      const j = this.C().juntarBlocos(blocos);
      const out = {
        itens: (j.itens || []).map((l) => Object.assign({}, l, { cc: dig(l.cc), plano: dig(l.plano) })),
        vendas: (j.vendas || []).map((v) => Object.assign({}, v, { cc: dig(v.cc) }))
      };
      this.docCache[k] = out;
      return out;
    },
    async lerConjunto(base, docs) {
      const o = { desp: [], rec: [], vendas: [] };
      for (const cab of docs) {
        const d = await this.lerDoc(base, cab), t = String(cab.tipo).toUpperCase();
        if (t === "VENDAS") o.vendas.push(...d.vendas.filter((v) => !v.ano || String(v.ano) === String(this.ano)));
        else (t === "RECEITAS" ? o.rec : o.desp).push(...d.itens);
      }
      return o;
    },
    async garantirFc(versao) {
      if (!versao || this.fcLinhas[versao]) return;
      const docs = this.C().documentosVigentes(this.escopo("forecast"), { ano: this.ano, dept: "TODOS", base: "forecast", versao, tipos: ["DESPESAS", "RECEITAS", "VENDAS"] }).docs.filter((c) => String(c.descricao || "") === versao);
      this.fcLinhas[versao] = await this.lerConjunto("forecast", docs);
      this.memo = {};
    },
    ateMes() { const h = new Date(), a = Number(this.ano); return a < h.getFullYear() ? 12 : a > h.getFullYear() ? 0 : h.getMonth() + 1; },

    async calcular() {
      const C = this.C(), R = this.R();
      if (!this.cabs.orcamento) return;
      this.carregando = true; this.erro = ""; this.passo = "Lendo orçamentos e forecasts…"; this.render();
      try {
        if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
        const orcDocs = C.documentosVigentes(this.escopo("orcamento"), { ano: this.ano, dept: "TODOS", base: "orcamento", tipos: ["DESPESAS", "RECEITAS", "VENDAS"] }).docs;
        const orc = await this.lerConjunto("orcamento", orcDocs);
        this.fcLinhas = {};
        const vDR = this.versoesFc(["DESPESAS", "RECEITAS"]), vV = this.versoesFc(["VENDAS"]);
        await this.garantirFc(vDR[0]);
        await this.garantirFc(vV[0]);
        ["consolidado", "despesas", "receitas"].forEach((k) => { if (this.tabs[k].versao && vDR.indexOf(this.tabs[k].versao) < 0) this.tabs[k].versao = ""; });
        if (this.tabs.vendas.versao && vV.indexOf(this.tabs.vendas.versao) < 0) this.tabs.vendas.versao = "";
        const fcs = Object.values(this.fcLinhas);
        if (!orcDocs.length && !fcs.length) throw new Error(`Nenhum orçamento ou forecast de ${this.ano} no Integra para este filtro. Faça a carga do Órion em Órion (transição) › Orçamentos e forecasts.`);
        const ccs = new Set();
        [orc].concat(fcs).forEach((o) => o.desp.concat(o.rec).forEach((l) => ccs.add(l.cc)));
        const empresas = R.empresasDosCcs([...ccs]);
        const ate = this.ateMes();
        let real = { alocacoes: [], movimentos: 0 };
        if (empresas.length && ate >= 1) {
          this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`; this.render();
          real = await R.buscar(Number(this.ano), ate, empresas);
        }
        this.calc = { orc, real, ate, empresas, movimentos: real.movimentos || 0, docs: orcDocs.length };
        this.memo = {};
        this.vendasReal = {};
        const ccsV = new Set();
        [orc].concat(fcs).forEach((o) => o.vendas.forEach((v) => ccsV.add(v.cc)));
        await this.lerVendasReal([...ccsV]);
      } catch (e) { this.erro = e.message || String(e); }
      this.carregando = false; this.passo = "";
      this.render();
    },

    /** Realizado de vendas: contratos de venda do Sienge por empreendimento (vendas na data do contrato, distratos na data do cancelamento). */
    async lerVendasReal(ccs) {
      const falta = (ccs || []).filter((cc) => cc && !this.vendasReal[cc]);
      if (!falta.length || typeof window.siengeFetchWithRetry !== "function") return;
      const ano = Number(this.ano);
      const paginar = async (base) => {
        if (window.OrionObrasApp && typeof OrionObrasApp.paginar === "function") return OrionObrasApp.paginar(base);
        const out = [];
        for (let off = 0; off < 40000; off += 200) {
          const r = await window.siengeFetchWithRetry(base + "&limit=200&offset=" + off).catch(() => ({ results: [] }));
          const l = (r && r.results) || []; out.push(...l);
          if (l.length < 200) break;
        }
        return out;
      };
      let feitos = 0;
      const um = async (cc) => {
        const x = { vu: zeros(), vv: zeros(), du: zeros(), draw: zeros() };
        try {
          const contratos = new Map();
          for (const s of [2, 3, 4]) (await paginar("/sales-contracts?enterpriseId=" + encodeURIComponent(cc) + "&situation=" + s)).forEach((c) => { if (c && c.id != null) contratos.set(String(c.id), c); });
          contratos.forEach((c) => {
            const d = String(c.contractDate || c.issueDate || "").slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(d)) return;
            const valor = this.C().centavos(Math.abs(Number(c.totalSellingValue != null ? c.totalSellingValue : c.value) || 0));
            if (Number(d.slice(0, 4)) === ano) { const m = Number(d.slice(5)) - 1; x.vu[m] += 1; x.vv[m] += valor; }
            const sit = String(c.situation == null ? "" : c.situation).toUpperCase();
            if (sit === "3" || sit === "CANCELED" || sit === "CANCELADO" || sit === "DISTRATADO") {
              const dc = String(c.cancellationDate || c.cancelDate || c.contractDate || c.issueDate || "").slice(0, 7);
              if (/^\d{4}-\d{2}$/.test(dc) && Number(dc.slice(0, 4)) === ano) { const m = Number(dc.slice(5)) - 1; x.du[m] += 1; x.draw[m] += valor; }
            }
          });
        } catch (e) { x.erro = true; }
        this.vendasReal[cc] = x;
        feitos++;
        this.passo = `Lendo as vendas do Sienge (${feitos} de ${falta.length} empreendimentos)…`;
        if (this.carregando) this.render();
      };
      this.passo = `Lendo as vendas do Sienge (0 de ${falta.length} empreendimentos)…`; this.render();
      const fila = falta.slice();
      await Promise.all([0, 1, 2, 3].map(async () => { while (fila.length) await um(fila.shift()); }));
      this.memo = {};
    },

    /* ================= filtros ================= */
    empresaDe(cc) {
      const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
      const c = l.find((x) => dig(x.id) === dig(cc));
      const id = c ? String(c.idCompany != null ? c.idCompany : c.companyId || "") : "";
      const emp = id ? ((window.AppState && AppState.companies) || []).find((x) => String(x.id) === id) : null;
      return { id, nome: emp ? String(emp.name || emp.nome || emp.tradeName || "") : "" };
    },
    nomeCc(cc) {
      const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
      const c = l.find((x) => dig(x.id) === dig(cc));
      return c ? String(c.name || c.nome || "") : "";
    },
    /** linha passa nos filtros do painel? plano = rótulo do plano (null = não filtra por plano) */
    passa(cc, ccNome, plano, buscaExtra) {
      const f = this.fo;
      if (f.busca) { const q = norm(f.busca); if (norm(`${cc} ${ccNome || ""}`).indexOf(q) < 0 && !(buscaExtra && norm(buscaExtra).indexOf(q) >= 0)) return false; }
      if (f.ids.length && f.ids.indexOf(String(cc)) < 0) return false;
      if (f.prods.length && f.prods.indexOf(produtoDoNome(ccNome)) < 0) return false;
      if (plano != null && f.planos.length && f.planos.indexOf(plano) < 0) return false;
      if (f.empIds.length || f.emps.length) { const e = this.empresaDe(cc); if (f.empIds.length && f.empIds.indexOf(e.id) < 0) return false; if (f.emps.length && f.emps.indexOf(e.nome) < 0) return false; }
      return true;
    },
    rotPlano(plano, nome) { return `${plano || ""} ${nome || ""}`.trim(); },
    /** opções dos filtros a partir do que a aba atual mostra */
    opcoesFiltro() {
      const linhas = []; // {cc, nome, plano}
      const aba = this.aba;
      if (aba === "comparativo") {
        const r = this.cmp.res;
        if (r) ["inclusoes", "exclusoes", "alteracoes"].forEach((k) => r[k].forEach((x) => linhas.push({ cc: x.cc, nome: x.cc_nome, plano: x.plano_rot })));
      } else if (aba === "visualizacao") {
        const d = this.vis.dados;
        if (d) d.linhas.forEach((x) => linhas.push({ cc: x.cc, nome: x.cc_nome, plano: x.plano_rot }));
      } else if (this.calc) {
        if (aba === "vendas" || aba === "consolidado") {
          const v = this.versaoAba(aba);
          [this.calc.orc.vendas, (this.fcLinhas[v] || {}).vendas || []].forEach((l) => l.forEach((x) => linhas.push({ cc: x.cc, nome: x.cc_nome, plano: x.plano_venda || "(sem plano)" })));
        }
        if (aba !== "vendas") {
          const tipos = aba === "receitas" ? ["RECEITAS"] : aba === "despesas" ? ["DESPESAS"] : ["DESPESAS", "RECEITAS"];
          tipos.forEach((tp) => this.itensDR(tp, this.versaoAba(aba)).forEach((x) => linhas.push({ cc: x.cc, nome: x.cc_nome, plano: this.rotPlano(x.plano, x.plano_nome) })));
        }
      }
      const u = (fn) => [...new Set(linhas.map(fn).filter((x) => x !== "" && x != null))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
      return { ids: u((l) => String(l.cc || "")), prods: u((l) => produtoDoNome(l.nome)), planos: u((l) => l.plano), empIds: u((l) => this.empresaDe(l.cc).id), emps: u((l) => this.empresaDe(l.cc).nome) };
    },
    htmlFiltros() {
      const f = this.fo, o = this.opcoesFiltro();
      const ativos = ["ids", "prods", "planos", "empIds", "emps"].reduce((s, k) => s + (f[k].length ? 1 : 0), f.busca ? 1 : 0);
      const ehV = this.aba === "vendas" || (this.aba === "comparativo" && this.cmp.tipo === "VENDAS") || (this.aba === "visualizacao" && this.vis.tipo === "VENDAS");
      const multi = (k, rot) => window.MlEmpresaFilter ? `<div>${MlEmpresaFilter.html({ id: "oxr-f-" + k, label: rot, items: o[k].map((x) => ({ id: x, label: x })), selectedIds: f[k], open: f.open === k, query: f.q[k] || "", emptyMeansAll: true })}</div>` : "";
      return `<div class="oxr-card" style="padding:10px 16px"><div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="${N}.fo.aberto=!${N}.fo.aberto;${N}.render()"><span style="font-weight:700;color:#105436;font-size:0.85rem">⏷ Filtros${ativos ? ` <span style="background:#105436;color:#fff;border-radius:999px;padding:0 8px;font-size:0.7rem">${ativos}</span>` : ""}</span><span style="color:#6b8474">${f.aberto ? "▴" : "▾"}</span></div>
        ${f.aberto ? `<div class="oxr-filtros"><div><label class="ml-emp-filter-label">Buscar</label><input id="oxr-f-busca" class="idx-select" style="width:100%;height:40px;box-sizing:border-box;min-width:0" placeholder="Nome do centro de custo..." value="${this.esc(f.busca)}" oninput="${N}.setBusca(this.value)"></div>
          ${multi("ids", "ID Centro de Custo")}${multi("prods", "Produto")}${multi("planos", ehV ? "Forma de Venda" : "Plano Financeiro")}${multi("empIds", "ID Empresa")}${multi("emps", "Empresa")}</div>
          ${ativos ? `<div style="text-align:right;padding-top:6px"><button type="button" class="btn btn-secondary" style="height:32px" onclick="${N}.limparFiltros()">Limpar filtros</button></div>` : ""}` : ""}</div>`;
    },
    setBusca(v) { this.fo.busca = v; this.render(); const i = document.getElementById("oxr-f-busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
    limparFiltros() { Object.assign(this.fo, { busca: "", ids: [], prods: [], planos: [], empIds: [], emps: [], q: {}, open: null }); this.render(); },
    ligarFiltros() {
      if (!this.fo.aberto || !window.MlEmpresaFilter) return;
      const o = this.opcoesFiltro(), f = this.fo;
      ["ids", "prods", "planos", "empIds", "emps"].forEach((k) => {
        if (!document.getElementById("oxr-f-" + k)) return;
        MlEmpresaFilter.bind("oxr-f-" + k, {
          toggleOpen: () => { f.open = f.open === k ? null : k; this.render(); },
          close: () => { if (f.open === k) { f.open = null; setTimeout(() => this.render(), 0); } },
          setQuery: (q) => { f.q[k] = q; this.render(); },
          toggleId: (x, on) => { const s = new Set(f[k]); if (on) s.add(x); else s.delete(x); f[k] = [...s]; this.render(); },
          selectAll: () => { f[k] = o[k].slice(); this.render(); },
          selectNone: () => { f[k] = []; this.render(); }
        });
      });
    },

    /* ================= escopo, meses e abas ================= */
    limparEscopo() { this.calc = null; this.fcLinhas = {}; this.memo = {}; this.vendasReal = {}; this.cmp.res = null; this.cmp.a = ""; this.cmp.b = ""; this.vis.dados = null; this.vis.versao = ""; this.render(); },
    setAno(v) { this.ano = String(v); this.limparEscopo(); },
    setDiretoria(v) { this.diretoria = v; this.dept = "TODOS"; this.limparEscopo(); },
    setDept(v) { this.dept = v; this.limparEscopo(); },
    alternarMeses() { this.mesesOn = !this.mesesOn; this.render(); },
    alternarMes(i) { if (!this.mesesOn) return; const k = this.mesesSel.indexOf(i); if (k >= 0) this.mesesSel.splice(k, 1); else this.mesesSel.push(i); this.render(); },
    setAba(a) { this.aba = a; this.render(); },
    setT(aba, campo, v) {
      const t = this.tabs[aba];
      t[campo] = v;
      if (campo === "versao" || (campo === "modo" && v === "forecast")) {
        const ver = this.versaoAba(aba);
        if (ver && !this.fcLinhas[ver] && this.calc) {
          this.passo = "Lendo o forecast " + ver + "…"; this.carregando = true; this.render();
          this.garantirFc(ver).then(() => { const ccsV = ((this.fcLinhas[ver] || {}).vendas || []).map((x) => x.cc); return this.lerVendasReal(ccsV); }).catch((e) => { this.erro = e.message || String(e); }).then(() => { this.carregando = false; this.passo = ""; this.render(); });
          return;
        }
      }
      this.render();
    },
    versaoAba(aba) {
      const t = this.tabs[aba];
      const vs = this.versoesFc(aba === "vendas" ? ["VENDAS"] : ["DESPESAS", "RECEITAS"]);
      return t.versao && vs.indexOf(t.versao) >= 0 ? t.versao : vs[0] || "";
    },

    /* ================= dados das abas ================= */
    /** Despesas / receitas por produto × plano: orcado, forecast e realizado (centavos, despesas positivas) mês a mês. */
    itensDR(tipo, versao) {
      if (!this.calc) return [];
      const k = "dr|" + tipo + "|" + versao;
      if (this.memo[k]) return this.memo[k];
      const C = this.C(), sinal = tipo === "RECEITAS" ? 1 : -1;
      const lado = (o) => (o ? (tipo === "RECEITAS" ? o.rec : o.desp) : []);
      const mapa = new Map(), ccs = new Set(), planos = new Set(), nomeCc = {}, nomePl = {};
      const pega = (cc, plano) => {
        const key = cc + "|" + plano;
        if (!mapa.has(key)) mapa.set(key, { cc, cc_nome: "", plano, plano_nome: "", orcado: zeros(), forecast: zeros(), realizado: zeros() });
        return mapa.get(key);
      };
      const add = (l, campo) => {
        ccs.add(l.cc); planos.add(l.plano);
        if (l.cc_nome) nomeCc[l.cc] = l.cc_nome;
        if (l.plano_nome) nomePl[l.plano] = l.plano_nome;
        const x = pega(l.cc, l.plano);
        (l.m || []).forEach((v, i) => { x[campo][i] += Number(v) || 0; });
      };
      lado(this.calc.orc).forEach((l) => add(l, "orcado"));
      lado(this.fcLinhas[versao]).forEach((l) => add(l, "forecast"));
      (this.calc.real.alocacoes || []).forEach((a) => {
        const cc = String(a.cc || ""), pl = String(a.plano || ""), mes = Number(a.mes);
        if (!ccs.has(cc) || !planos.has(pl) || !(mes >= 1 && mes <= 12)) return;
        pega(cc, pl).realizado[mes - 1] += C.centavos(Number(a.valor) * sinal);
      });
      const out = [...mapa.values()].filter((x) => x.orcado.some(Boolean) || x.forecast.some(Boolean) || x.realizado.some(Boolean));
      out.forEach((x) => { x.cc_nome = nomeCc[x.cc] || this.nomeCc(x.cc); x.plano_nome = nomePl[x.plano] || ""; });
      out.sort((a, b) => String(a.cc_nome).localeCompare(String(b.cc_nome), "pt-BR") || String(a.plano).localeCompare(String(b.plano), "pt-BR", { numeric: true }));
      this.memo[k] = out;
      return out;
    },
    drFiltrados(tipo, versao) { return this.itensDR(tipo, versao).filter((x) => this.passa(x.cc, x.cc_nome, this.rotPlano(x.plano, x.plano_nome))); },

    /** Vendas por produto (Órion: acompanhamento de vendas): vendas e distratos, orcado / forecast / realizado, unidades e VGV mês a mês. */
    itensVendas(versao) {
      if (!this.calc) return [];
      const f = this.fo;
      const passaPlano = (l) => !f.planos.length || f.planos.indexOf(l.plano_venda || "(sem plano)") >= 0;
      const mapa = new Map();
      const bloco = () => ({ un: zeros(), vgv: zeros() });
      const pega = (cc, nome) => {
        if (!mapa.has(cc)) mapa.set(cc, { cc, cc_nome: nome || "", vendas: { orcado: bloco(), forecast: bloco(), realizado: bloco() }, distratos: { orcado: bloco(), forecast: bloco(), realizado: bloco() } });
        const x = mapa.get(cc);
        if (!x.cc_nome && nome) x.cc_nome = nome;
        return x;
      };
      const add = (l, campo) => {
        const m = Number(l.mes) - 1;
        if (!(m >= 0 && m < 12) || !passaPlano(l)) return;
        const x = pega(l.cc, l.cc_nome).vendas[campo];
        x.un[m] += Number(l.vendas) || 0;
        x.vgv[m] += Number(l.vgv) || 0;
      };
      this.calc.orc.vendas.forEach((l) => add(l, "orcado"));
      ((this.fcLinhas[versao] || {}).vendas || []).forEach((l) => add(l, "forecast"));
      const tk = (b, m) => { const u = m == null ? b.un.reduce((s, v) => s + v, 0) : b.un[m], g = m == null ? b.vgv.reduce((s, v) => s + v, 0) : b.vgv[m]; return u > 0 ? g / u : 0; };
      mapa.forEach((x, cc) => {
        const r = this.vendasReal[cc];
        if (!r) return;
        x.vendas.realizado.un = r.vu.slice(); x.vendas.realizado.vgv = r.vv.slice();
        x.distratos.realizado.un = r.du.slice();
        for (let m = 0; m < 12; m++) {
          let t = tk(x.distratos.orcado, m) || tk(x.distratos.forecast, m) || tk(x.distratos.orcado) || tk(x.distratos.forecast) || tk(x.vendas.orcado, m) || tk(x.vendas.orcado) || tk(x.vendas.forecast) || tk(x.vendas.realizado);
          x.distratos.realizado.vgv[m] = t > 0 ? Math.round(r.du[m] * t) : r.draw[m];
        }
      });
      const out = [...mapa.values()].map((x) => { if (!x.cc_nome) x.cc_nome = this.nomeCc(x.cc); return x; }).filter((x) => this.passa(x.cc, x.cc_nome, null));
      return out.sort((a, b) => String(a.cc_nome).localeCompare(String(b.cc_nome), "pt-BR"));
    },
    vSub(item, sub, tipo, ms, met) { const c = item[sub][tipo]; const t = soma(met === "unidades" ? c.un : c.vgv, ms); return sub === "distratos" && met === "unidades" ? Math.abs(t) : t; },
    vCat(item, cat, tipo, ms, met) { if (cat === "vendas" || cat === "distratos") return this.vSub(item, cat, tipo, ms, met); return this.vSub(item, "vendas", tipo, ms, met) - this.vSub(item, "distratos", tipo, ms, met); },

    /* ================= pedaços visuais (Órion) ================= */
    badge(v, inverted) {
      if (!v) return `<span style="color:#94a3b8;font-weight:600">-</span>`;
      const bom = inverted ? v <= 0 : v > 0;
      return `<span class="oxr-badge" style="color:${bom ? "#047857" : "#b91c1c"};background:${bom ? "#ecfdf5" : "#fef2f2"}">${bom ? "▲" : "▼"} ${this.pc(Math.abs(v))}</span>`;
    },
    tom(fav, v, perc) {
      if (v === 0) return { panel: "#f7faf8", value: "#0f2a1c", muted: "#4a6355", badge: "background:#eef3f0;color:#4a6355" };
      if (fav) return { panel: "#ecfdf5", value: "#065f46", muted: "#047857", badge: "background:#d1fae5;color:#065f46" };
      if (Math.abs(perc) >= 0.05) return { panel: "#fff7ed", value: "#7c2d12", muted: "#9a3412", badge: "background:#ffedd5;color:#7c2d12" };
      return { panel: "#fef2f2", value: "#991b1b", muted: "#b91c1c", badge: "background:#fee2e2;color:#991b1b" };
    },
    farolDot(n, ref, tipo) {
      const s = this.C().semaforo(n, ref, tipo);
      const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
      return `<span title="${this.esc(s.titulo)}" style="width:9px;height:9px;border-radius:50%;background:${cores[s.cor] || "#cbd5e1"};display:inline-block"></span>`;
    },
    seg(opcoes, atual, js) { return `<div class="oxr-seg">${opcoes.map(([k, t]) => `<button type="button" class="${k === atual ? "on" : ""}" onclick="${js.replace("$", k)}">${t}</button>`).join("")}</div>`; },
    chips(opcoes, atual, js) { return opcoes.map(([k, t]) => `<button type="button" class="oxr-chip ${k === atual ? "on" : ""}" onclick="${js.replace("$", k)}">${t}</button>`).join(""); },
    driver(label, v, share, fav, fmt, js) {
      return `<button type="button" class="oxr-drv" ${js ? `onclick="${js}"` : ""}><div style="display:flex;justify-content:space-between;gap:8px;font-size:0.72rem"><span style="color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${this.esc(label)}">${this.esc(label)}</span><b style="color:${fav ? "#047857" : "#b91c1c"};white-space:nowrap;font-variant-numeric:tabular-nums">${this.sinal(v)}${fmt(v)}</b></div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:3px"><div class="oxr-bar" style="flex:1;height:4px"><div style="width:${Math.min(100, share * 100)}%;background:${fav ? "#10b981" : "#ef4444"}"></div></div><span style="font-size:0.64rem;font-weight:700;color:#6b8474;width:30px;text-align:right">${Math.round(share * 100)}%</span></div></button>`;
    },
    alertas(l) {
      return l.length ? l.slice(0, 3).map((a) => `<div class="oxr-alerta" style="${a.tone === "red" ? "border-color:#fecaca;background:#fef2f2;color:#7f1d1d" : "border-color:#fde68a;background:#fffbeb;color:#78350f"}"><div style="font-size:0.66rem;font-weight:800;text-transform:uppercase">${this.esc(a.title)}</div><div style="opacity:.9">${this.esc(a.detail)}</div></div>`).join("") : `<div style="font-size:0.78rem;color:#6b8474">Nenhum alerta crítico.</div>`;
    },
    strip(meses, fmt, refLabel, realLabel, js, compacto) {
      if (!meses.length) return "";
      const maxAbs = Math.max(1, ...meses.flatMap((m) => [Math.abs(m.ref), Math.abs(m.real), Math.abs(m.varRs)]));
      const barras = meses.map((m) => {
        const hr = Math.max(m.ref === 0 ? 3 : 10, (Math.abs(m.ref) / maxAbs) * 100), hb = Math.max(m.real === 0 ? 3 : 10, (Math.abs(m.real) / maxAbs) * 100);
        return `<button type="button" class="m" ${js ? `onclick="${js}"` : ""} title="${MES[m.i]}"><div style="height:48px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:2px"><div title="${this.esc(refLabel)}: ${this.esc(fmt(m.ref))}" style="width:10px;height:${hr}%;border-radius:3px 3px 0 0;background:${m.ref < 0 ? "#cbd5e1" : "#94a3b8"}"></div><div title="${this.esc(realLabel)}: ${this.esc(fmt(m.real))}" style="width:10px;height:${hb}%;border-radius:3px 3px 0 0;background:${m.real < 0 ? "#f87171" : "#1b8253"}"></div></div>
          <span style="font-size:0.66rem;font-weight:700;color:#4a6355;margin-top:3px">${MES[m.i]}</span><span style="font-size:0.56rem;color:#94a3b8">${this.curto(m.ref, compacto)}</span><span style="font-size:0.56rem;color:#4a6355;font-weight:600">${this.curto(m.real, compacto)}</span><span style="font-size:0.6rem;font-weight:700;color:${m.favoravel ? "#047857" : "#b91c1c"}">Δ ${this.sinal(m.varRs)}${this.curto(m.varRs, compacto)}</span></button>`;
      }).join("");
      return `<div class="oxr-box"><h5><span>📈 Referência × Realizado por mês</span><span style="font-weight:700;text-transform:none;letter-spacing:0;display:flex;gap:10px"><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#94a3b8"></span> ${this.esc(refLabel)}</span><span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#1b8253"></span> ${this.esc(realLabel)}</span></span></h5><div class="oxr-strip">${barras}</div></div>`;
    },
    xlsx(headers, rows, nome) {
      if (!window.XLSX) { this.erro = "A biblioteca de Excel não carregou. Recarregue a página."; return this.render(); }
      const ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Dados");
      XLSX.writeFile(wb, nome);
    },
    reais(c) { return Math.round(Number(c) || 0) / 100; },
    irAnalitico(k) { if (window.OrionDashOrcamento) OrionDashOrcamento.ir(k || "analitico1"); },
    linksDespesas() {
      if (!window.OrionDashOrcamento) return "";
      return `<span style="display:inline-flex;gap:10px;flex-wrap:wrap">${[["analitico1", "Analítico de Gastos I"], ["realizado", "Realizado CP (detalhe)"], ["analitico2", "Analítico dos Gastos II"]].map(([k, t]) => `<button type="button" class="oxr-link" onclick="${N}.irAnalitico('${k}')">${t} →</button>`).join("")}</span>`;
    },
    precisaCalcular() {
      if (this.carregando) return `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>`;
      return `<div class="oxr-vazio"><div style="font-size:1rem;font-weight:800;color:#105436;margin-bottom:6px">Clique em Calcular</div><div style="font-size:0.82rem;max-width:620px;margin:0 auto">O realizado é lido do Sienge na hora (caixa e bancos e contratos de venda) e pode levar alguns minutos. O Comparativo de Versões e a Visualização não precisam do cálculo.</div></div>`;
    },
    /** barra "Comparar com" + versão + botões (abas Consolidado, Despesas, Receitas e Vendas) */
    barraModo(aba, extra) {
      const t = this.tabs[aba];
      const vs = this.versoesFc(aba === "vendas" ? ["VENDAS"] : ["DESPESAS", "RECEITAS"]), ver = this.versaoAba(aba);
      return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><span class="oxr-lbl">Comparar com</span>${this.seg([["orcado", "Orçado"], ["forecast", "Forecast"]], t.modo, `${N}.setT('${aba}','modo','$')`)}
        ${t.modo === "forecast" && vs.length ? `<span class="oxr-lbl">Versão</span><select class="idx-select" style="height:32px;font-size:0.8rem" onchange="${N}.setT('${aba}','versao',this.value)">${vs.map((v) => `<option value="${this.esc(v)}" ${v === ver ? "selected" : ""}>${this.esc(rotuloFc(v))}</option>`).join("")}</select>` : ""}
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center">${extra || ""}<button type="button" class="btn btn-secondary" style="height:32px;padding:0 10px" title="Ler de novo" onclick="${N}.calcular()">⟳</button></span></div>`;
    },

    /* ================= aba Consolidado ================= */
    bundleConsolidado() {
      const t = this.tabs.consolidado, ms = this.ms(), ref = t.modo === "orcado" ? "orcado" : "forecast", ver = this.versaoAba("consolidado");
      const rec = this.drFiltrados("RECEITAS", ver), desp = this.drFiltrados("DESPESAS", ver), vendas = this.itensVendas(ver);
      const f = (c) => this.rs(c);
      const linhaIns = (itens, inverted) => itens.map((it, i) => {
        const valRef = soma(it[ref], ms), valReal = soma(it.realizado, ms), v = valReal - valRef;
        return { key: i + "-" + it.cc, label: `${it.cc} ${it.cc_nome}`, sublabel: this.rotPlano(it.plano, it.plano_nome), valRef, valReal, varRs: v, varPerc: valRef !== 0 ? v / Math.abs(valRef) : valReal !== 0 ? 1 : 0, absVarRs: Math.abs(v), favoravel: favor(v, inverted), it };
      }).filter((l) => l.absVarRs > 1).sort((a, b) => b.absVarRs - a.absVarRs);
      const vendLinhas = vendas.map((it, i) => {
        const valRef = this.vCat(it, t.vCat, ref, ms, t.vMet), valReal = this.vCat(it, t.vCat, "realizado", ms, t.vMet), v = valReal - valRef;
        return { key: "v" + i, label: `${it.cc} ${it.cc_nome}`, valRef, valReal, varRs: v, varPerc: valRef !== 0 ? v / Math.abs(valRef) : valReal !== 0 ? 1 : 0, absVarRs: Math.abs(v), favoravel: favTipo(v, "VENDAS"), it };
      }).filter((l) => l.absVarRs > (t.vMet === "unidades" ? 0 : 1)).sort((a, b) => b.absVarRs - a.absVarRs);
      const totM = (itens, campo) => { const o = zeros(); itens.forEach((x) => x[campo].forEach((v, i) => { o[i] += v; })); return o; };
      const recRef = totM(rec, ref), recReal = totM(rec, "realizado"), despRef = totM(desp, ref), despReal = totM(desp, "realizado");
      const recL = linhaIns(rec, false), despL = linhaIns(desp, true);
      const fin = (o) => {
        const v = o.realTotal - o.refTotal, perc = o.refTotal !== 0 ? v / Math.abs(o.refTotal) : 0, fav = favor(v, o.inverted);
        const totalAbs = o.lines.reduce((s, l) => s + l.absVarRs, 0) || 1;
        const allItems = o.lines.map((l) => Object.assign({}, l, { shareAbs: l.absVarRs / totalAbs }));
        const desvioPorMes = ms.map((i) => { const x = o.mensal(i); return { i, ref: x.ref, real: x.real, varRs: x.real - x.ref, favoravel: favor(x.real - x.ref, o.inverted) }; });
        const alertas = [];
        if (!fav && Math.abs(perc) >= 0.05) alertas.push({ tone: "red", title: "Desvio material", detail: `${o.label}: referência ${f(o.refTotal)} · realizado ${f(o.realTotal)} (${(perc * 100).toFixed(1).replace(".", ",")}%).` });
        if (allItems[0] && allItems[0].shareAbs >= 0.25) alertas.push({ tone: "amber", title: "Concentração de desvio", detail: `${allItems[0].label} concentra ${Math.round(allItems[0].shareAbs * 100)}% do desvio absoluto.` });
        const sentido = v >= 0 ? "acima" : "abaixo";
        const narrative = fav ? `${o.label} ${sentido} da referência em ${f(Math.abs(v))} (${(Math.abs(perc) * 100).toFixed(1).replace(".", ",")}%). ${allItems.length} linha(s) com desvio relevante.`
          : `${o.label} ${sentido} da referência em ${f(Math.abs(v))} (${(Math.abs(perc) * 100).toFixed(1).replace(".", ",")}%). Revise os ${Math.min(5, allItems.length)} principais drivers.`;
        return { globalRef: o.refTotal, globalReal: o.realTotal, globalVarRs: v, globalVarPerc: perc, favoravel: fav, veredito: fav ? "favoravel" : v === 0 ? "neutro" : "desfavoravel", allItems, desvioPorMes, alertas, narrative,
          counts: { comDesvio: allItems.length, favoravel: allItems.filter((l) => l.favoravel && l.varRs !== 0).length, desfavoravel: allItems.filter((l) => !l.favoravel && l.varRs !== 0).length } };
      };
      const sm = (a) => soma(a, ms);
      const resultado = fin({ label: "Resultado", refTotal: sm(recRef) - sm(despRef), realTotal: sm(recReal) - sm(despReal), inverted: false, mensal: (i) => ({ ref: recRef[i] - despRef[i], real: recReal[i] - despReal[i] }),
        lines: recL.map((l) => Object.assign({}, l, { key: "r" + l.key })).concat(despL.map((l) => Object.assign({}, l, { key: "d" + l.key, varRs: -l.varRs, favoravel: l.varRs <= 0 }))).sort((a, b) => b.absVarRs - a.absVarRs) });
      const receitas = fin({ label: "Receitas", refTotal: sm(recRef), realTotal: sm(recReal), inverted: false, mensal: (i) => ({ ref: recRef[i], real: recReal[i] }), lines: recL });
      const despesas = fin({ label: "Despesas", refTotal: sm(despRef), realTotal: sm(despReal), inverted: true, mensal: (i) => ({ ref: despRef[i], real: despReal[i] }), lines: despL });
      const vendasB = fin({ label: t.vCat === "liquido" ? "VGV líquido" : t.vCat === "distratos" ? "Distratos" : "Vendas", refTotal: vendas.reduce((s, i) => s + this.vCat(i, t.vCat, ref, ms, t.vMet), 0), realTotal: vendas.reduce((s, i) => s + this.vCat(i, t.vCat, "realizado", ms, t.vMet), 0), inverted: false,
        mensal: (m) => ({ ref: vendas.reduce((s, i) => s + this.vCat(i, t.vCat, ref, [m], t.vMet), 0), real: vendas.reduce((s, i) => s + this.vCat(i, t.vCat, "realizado", [m], t.vMet), 0) }), lines: vendLinhas });
      const impactRec = sm(recReal) - sm(recRef), impactDesp = sm(despReal) - sm(despRef), absSum = Math.abs(impactRec) + Math.abs(impactDesp) || 1;
      return { ms, ref, rec, desp, vendas, recRef, recReal, despRef, despReal, resultado, receitas, despesas, vendasB, comp: { impactRec, impactDesp, pctRec: Math.abs(impactRec) / absSum, pctDesp: Math.abs(impactDesp) / absSum } };
    },
    htmlConsolidado() {
      if (!this.calc) return this.precisaCalcular();
      const t = this.tabs.consolidado, B = this.bundleConsolidado(), refLabel = t.modo === "orcado" ? "Orçado" : "Forecast";
      const rotBloco = { resultado: "Resultado", receitas: "Receitas", despesas: "Despesas", vendas: "Vendas" };
      const at = t.bloco === "resultado" ? B.resultado : t.bloco === "receitas" ? B.receitas : t.bloco === "despesas" ? B.despesas : B.vendasB;
      const inv = t.bloco === "despesas";
      const fmtI = (v) => (t.bloco === "vendas" ? (t.vMet === "unidades" ? this.un(t.vCat === "distratos" ? Math.abs(v) : v) : this.rs(t.vCat === "distratos" ? Math.abs(v) : v)) : this.rs(v));
      const corVar = (v) => (v === 0 ? "#4a6355" : favor(v, inv) ? "#047857" : "#b91c1c");
      const tom = this.tom(at.favoravel, at.globalVarRs, at.globalVarPerc);
      const barra = this.barraModo("consolidado", this.seg([["executiva", "▦ Executiva"], ["analitica", "☰ Analítica"]], t.visao, `${N}.setT('consolidado','visao','$')`));
      if (t.visao === "analitica") return barra + this.htmlConsolidadoAnalitica(B, refLabel);
      const tipoSem = t.bloco === "despesas" ? "DESPESAS" : t.bloco === "receitas" ? "RECEITAS" : t.bloco === "vendas" ? "VENDAS" : "RESULTADO";
      const kpi = `<div class="oxr-kpi"><div><div class="oxr-lbl">${refLabel}</div><div class="v">${fmtI(at.globalRef)}</div><div class="s">${rotBloco[t.bloco]}</div></div>
          <div style="background:${tom.panel};text-align:center;min-width:170px"><div class="oxr-lbl">Variação</div><div class="v" style="color:${tom.value}">${this.sinal(at.globalVarRs)}${fmtI(at.globalVarRs)}</div><div class="s" style="color:${tom.muted};font-weight:700">${this.pc(at.globalVarPerc)}</div></div>
          <div style="text-align:right"><div class="oxr-lbl">Realizado</div><div class="v">${fmtI(at.globalReal)}</div>${this.mesesOn ? `<div class="s">Período: ${B.ms.map((i) => MES[i]).join(", ")}</div>` : ""}</div>
          <div class="oxr-kpi-pe"><div>${this.chips([["resultado", "Resultado"], ["receitas", "Receitas"], ["despesas", "Despesas"], ["vendas", "Vendas"]], t.bloco, `${N}.setT('consolidado','bloco','$')`)}</div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${t.bloco === "vendas" ? `<span style="border-right:1px solid #dfe9e3;padding-right:6px">${this.chips([["liquido", "Líquido"], ["vendas", "Vendas"], ["distratos", "Distratos"]], t.vCat, `${N}.setT('consolidado','vCat','$')`)}</span>${this.chips([["vgv", "VGV"], ["unidades", "Nº lotes"]], t.vMet, `${N}.setT('consolidado','vMet','$')`)}` : ""}
              <span class="oxr-badge" style="${tom.badge};text-transform:uppercase;font-size:0.66rem;border-radius:999px;padding:2px 9px">${this.farolDot(at.globalReal, at.globalRef, tipoSem)} ${at.veredito === "favoravel" ? "Favorável" : at.veredito === "desfavoravel" ? "Requer atenção" : "Neutro"}</span></div></div></div>`;
      const comp = t.bloco === "resultado"
        ? [["Receitas", B.comp.impactRec, B.comp.pctRec, "#10b981"], ["Despesas", -B.comp.impactDesp, B.comp.pctDesp, "#ef4444"]].map(([l, v, p, c]) => `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:0.74rem"><span style="color:#4a6355">${l} · ${Math.round(p * 100)}%</span><b style="color:${v === 0 ? "#4a6355" : v > 0 ? "#047857" : "#b91c1c"}">${this.sinal(v)}${this.rs(v)}</b></div><div class="oxr-bar"><div style="width:${Math.min(100, p * 100)}%;background:${c}"></div></div></div>`).join("")
        : `<div style="font-size:0.78rem;color:#4a6355;line-height:1.6">${refLabel}: <b>${fmtI(at.globalRef)}</b><br>Realizado: <b>${fmtI(at.globalReal)}</b><br>${at.counts.comDesvio} linha(s) com desvio · ${at.counts.favoravel} favoráveis · ${at.counts.desfavoravel} desfavoráveis</div>`;
      const drivers = at.allItems.slice(0, 5).map((it) => this.driver(it.sublabel ? `${it.label} · ${it.sublabel}` : it.label, it.varRs, it.shareAbs, it.favoravel, fmtI, t.bloco === "despesas" ? `${N}.irAnalitico('analitico1')` : `${N}.tabs.consolidado.visao='analitica';${N}.tabs.consolidado.busca='${this.esc(String(it.label).replace(/['\\]/g, "").slice(0, 24))}';${N}.render()`)).join("") || `<div style="font-size:0.78rem;color:#6b8474">Nenhum desvio neste filtro.</div>`;
      const cards = [["Resultado", B.resultado, "resultado"], ["Receitas", B.receitas, "receitas"], ["Despesas", B.despesas, "despesas"], ["VGV líq.", B.vendasB, "vendas"]].map(([l, b, k]) => `<button type="button" class="oxr-box" style="text-align:left;cursor:pointer;font-family:var(--font-family);${t.bloco === k ? "border-color:var(--color-primary);background:#f0f8f3" : ""}" onclick="${N}.setT('consolidado','bloco','${k}')"><div class="oxr-lbl">${l}</div><div style="font-size:0.95rem;font-weight:800;color:${b.favoravel ? "#047857" : "#b91c1c"};font-variant-numeric:tabular-nums">${this.sinal(b.globalVarRs)}${k === "vendas" && t.vMet === "unidades" ? this.un(b.globalVarRs) : this.rs(b.globalVarRs)}</div><div style="font-size:0.66rem;color:#94a3b8">${this.pc(b.globalVarPerc)} vs ${refLabel.toLowerCase()}</div></button>`).join("");
      return barra + kpi + `<div class="oxr-g2"><div class="oxr-box"><h5>Leitura executiva</h5><div style="font-size:0.8rem;color:#334155;line-height:1.5">${this.esc(at.narrative)}</div></div><div class="oxr-box"><h5>${t.bloco === "resultado" ? "Composição do desvio (resultado)" : "Referência × realizado"}</h5>${comp}</div></div>`
        + this.strip(at.desvioPorMes, fmtI, refLabel, "Realizado", `${N}.setT('consolidado','visao','analitica')`, t.bloco === "vendas" && t.vMet === "unidades" ? "un" : "")
        + `<div class="oxr-g3"><div class="oxr-box"><h5>🎯 Pontos de atenção</h5>${this.alertas(at.alertas)}</div><div class="oxr-box" style="grid-column:span 2"><h5><span>📈 Top drivers</span><button type="button" class="oxr-link" onclick="${t.bloco === "despesas" ? `${N}.irAnalitico('analitico1')` : `${N}.setT('consolidado','visao','analitica')`}">Ver analítica →</button></h5>${drivers}${t.bloco === "despesas" ? `<div style="border-top:1px solid #eef3f0;margin-top:6px;padding-top:6px">${this.linksDespesas()}</div>` : ""}</div></div>`
        + `<div class="oxr-g4">${cards}</div>`
        + `<div style="font-size:0.7rem;color:#94a3b8;margin-top:6px">${this.notaCalculo()}</div>`;
    },
    notaCalculo() {
      const c = this.calc;
      if (!c) return "";
      const semVendas = Object.values(this.vendasReal).filter((x) => x.erro).length;
      return `Realizado de despesas e receitas pela regra do Integra (caixa e bancos, até ${MES[Math.max(0, c.ate - 1)]}/${this.esc(this.ano)}; empresas ${this.esc(c.empresas.join(", "))}; ${c.movimentos} movimentos), só dos centros de custo e planos que estão no orçamento ou no forecast. Realizado de vendas pelos contratos de venda do Sienge${semVendas ? ` (${semVendas} empreendimento(s) sem resposta do Sienge)` : ""}.`;
    },
    htmlConsolidadoAnalitica(B, refLabel) {
      const t = this.tabs.consolidado, ms = B.ms, ref = B.ref, cols = ms.concat(["T"]);
      const q = norm(t.busca);
      const vis = (l) => l.filter((x) => !q || norm(`${x.cc} ${x.cc_nome}`).indexOf(q) >= 0);
      const recV = vis(B.rec), despV = vis(B.desp), vendV = vis(B.vendas);
      const aberto = (k) => !!t.abertos[k];
      const val = (arr, c) => (c === "T" ? soma(arr, ms) : arr[c] || 0);
      const celulas = (refArr, realArr, inverted, peso) => cols.map((c) => { const r = val(refArr, c), x = val(realArr, c); return `<td class="is-right" style="color:#64748b;${c === "T" ? "background:#f7faf8;" : ""}">${this.rs(r)}</td><td class="is-right" style="${peso || ""}${c === "T" ? "background:#f1f5f4;" : ""}">${this.rs(x)}</td><td class="is-right" style="border-right:1px solid #e2e8f0;${c === "T" ? "background:#f7faf8;" : ""}">${this.badge((x - r) / (Math.abs(r) || 1), inverted)}</td>`; }).join("");
      const cel3 = (fnRef, fnReal, inverted, peso) => cols.map((c) => { const mm = c === "T" ? ms : [c]; const r = fnRef(mm), x = fnReal(mm); return `<td class="is-right" style="color:#64748b">${this.rs(r)}</td><td class="is-right" style="${peso || ""}">${this.rs(x)}</td><td class="is-right" style="border-right:1px solid #e2e8f0">${this.badge((x - r) / (Math.abs(r) || 1), inverted)}</td>`; }).join("");
      const tot = (itens, campo) => { const o = zeros(); itens.forEach((x) => x[campo].forEach((v, i) => { o[i] += v; })); return o; };
      const secao = (k, rotulo, cls, n, cells) => `<tr id="oxr-sec-${k}" class="${cls}" ${k !== "resultado" ? `onclick="${N}.alternarSecao('${k}')" style="cursor:pointer"` : ""}><td class="oxr-sticky">${k !== "resultado" ? (aberto(k) ? "▾ " : "▸ ") : ""}${rotulo}${n != null ? ` <span style="font-size:0.64rem;font-weight:700;opacity:.8">(${n} prod.)</span>` : ""}</td>${cells}</tr>`;
      const linha = (rotulo, sub, cells, cor) => `<tr><td class="oxr-sticky" style="padding-left:26px" title="${this.esc(rotulo + (sub ? " · " + sub : ""))}"><span style="color:${cor}">●</span> ${this.esc(rotulo)}${sub ? ` <span style="color:#94a3b8;font-size:0.66rem">· ${this.esc(sub)}</span>` : ""}</td>${cells}</tr>`;
      const recRef = tot(recV, ref), recReal = tot(recV, "realizado"), despRef = tot(despV, ref), despReal = tot(despV, "realizado");
      let corpo = secao("receitas", "↗ Receitas", "oxr-sec-r", recV.length, celulas(recRef, recReal, false, "font-weight:700;"));
      if (aberto("receitas")) corpo += recV.map((x) => linha(`${x.cc} ${x.cc_nome}`, this.rotPlano(x.plano, x.plano_nome), celulas(x[ref], x.realizado, false), "#34d399")).join("") || `<tr><td colspan="${1 + cols.length * 3}" style="color:#94a3b8;font-style:italic;padding-left:40px">Nenhum produto encontrado para receitas.</td></tr>`;
      corpo += secao("despesas", "↘ Despesas", "oxr-sec-d", despV.length, celulas(despRef, despReal, true, "font-weight:700;"));
      if (aberto("despesas")) corpo += despV.map((x) => linha(`${x.cc} ${x.cc_nome}`, this.rotPlano(x.plano, x.plano_nome), celulas(x[ref], x.realizado, true), "#f87171")).join("") || `<tr><td colspan="${1 + cols.length * 3}" style="color:#94a3b8;font-style:italic;padding-left:40px">Nenhum produto encontrado para despesas.</td></tr>`;
      const resRef = recRef.map((v, i) => v - despRef[i]), resReal = recReal.map((v, i) => v - despReal[i]);
      corpo += `<tr id="oxr-sec-resultado" class="oxr-sec-res"><td class="oxr-sticky">$ Resultado <span style="font-size:0.66rem;font-weight:400">(Receitas − Despesas)</span></td>${cols.map((c) => { const r = val(resRef, c), x = val(resReal, c); return `<td class="is-right" style="color:#64748b">${this.rs(r)}</td><td class="is-right" style="color:${x >= 0 ? "#047857" : "#b91c1c"}">${this.rs(x)}</td><td class="is-right" style="border-right:1px solid #e2e8f0">${this.badge((x - r) / (Math.abs(r) || 1), false)}</td>`; }).join("")}</tr>`;
      const sumCat = (itens, cat, tipo, mm) => itens.reduce((s, i) => s + this.vSub(i, cat, tipo, mm, "vgv"), 0);
      corpo += secao("vendas", "〽 Vendas <span style='font-size:0.66rem;font-weight:400'>(VGV líq.)</span>", "oxr-sec-v", vendV.length, cel3((mm) => sumCat(vendV, "vendas", ref, mm) - sumCat(vendV, "distratos", ref, mm), (mm) => sumCat(vendV, "vendas", "realizado", mm) - sumCat(vendV, "distratos", "realizado", mm), false, "font-weight:700;"));
      if (aberto("vendas")) {
        corpo += vendV.map((x) => {
          const temD = ms.some((m) => this.vSub(x, "distratos", ref, [m], "vgv") !== 0 || this.vSub(x, "distratos", "realizado", [m], "vgv") !== 0);
          const ab = !!t.vProd[x.cc];
          let h = `<tr><td class="oxr-sticky" style="padding-left:18px">${temD ? `<button type="button" class="oxr-link" style="width:16px" onclick="${N}.tabs.consolidado.vProd['${x.cc}']=!${N}.tabs.consolidado.vProd['${x.cc}'];${N}.render()">${ab ? "▾" : "▸"}</button>` : `<span style="display:inline-block;width:16px"></span>`}<span style="color:#fbbf24">●</span> ${this.esc(x.cc + " " + x.cc_nome)}</td>${cel3((mm) => this.vCat(x, "liquido", ref, mm, "vgv"), (mm) => this.vCat(x, "liquido", "realizado", mm, "vgv"), false)}</tr>`;
          if (ab) ["vendas", "distratos"].forEach((sc) => { h += `<tr><td class="oxr-sticky" style="padding-left:52px;font-size:0.68rem;color:#4a6355"><span style="color:${sc === "vendas" ? "#34d399" : "#f87171"}">•</span> ${sc === "vendas" ? "Vendas" : "Distratos"}</td>${cel3((mm) => this.vSub(x, sc, ref, mm, "vgv"), (mm) => this.vSub(x, sc, "realizado", mm, "vgv"), sc === "distratos")}</tr>`; });
          return h;
        }).join("") || `<tr><td colspan="${1 + cols.length * 3}" style="color:#94a3b8;font-style:italic;padding-left:40px">Nenhum produto encontrado para vendas.</td></tr>`;
      }
      const sub = ref === "orcado" ? "Orç." : "Fcst.";
      const largura = 300 + cols.length * 302;
      const barra = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><input id="oxr-cons-busca" class="idx-select" style="height:32px;width:220px" placeholder="Buscar produto…" value="${this.esc(t.busca)}" oninput="${N}.setBuscaCons(this.value)">
        ${[["receitas", "Receitas", "#047857"], ["despesas", "Despesas", "#b91c1c"], ["resultado", "Resultado", "#334155"], ["vendas", "Vendas", "#92400e"]].map(([k, l, c]) => `<button type="button" class="oxr-chip on" style="color:${c}" onclick="${N}.irSecao('${k}')">${l}</button>`).join("")}
        <span style="border-left:1px solid #dfe9e3;padding-left:8px;display:flex;gap:6px"><button type="button" class="btn btn-secondary" style="height:30px;font-size:0.74rem" onclick="${N}.expandirSecoes(true)">Expandir tudo</button><button type="button" class="btn btn-secondary" style="height:30px;font-size:0.74rem" onclick="${N}.expandirSecoes(false)">Recolher</button></span>
        <button type="button" class="btn btn-excel" style="height:32px;margin-left:auto" onclick="${N}.excelConsolidado()">⬇ Excel</button></div>`;
      return barra + `<div class="cc-scroll" style="max-height:68vh"><table class="cc-table oxr-mat" style="min-width:${largura}px"><colgroup><col style="width:300px">${cols.map(() => `<col style="width:105px"><col style="width:105px"><col style="width:92px">`).join("")}</colgroup>
        <thead><tr><th class="oxr-sticky" rowspan="2" style="vertical-align:bottom">Categoria / Produto</th>${cols.map((c) => `<th colspan="3" class="is-center" style="${c === "T" ? "background:#105436" : ""}">${c === "T" ? "Total" : MES[c]}</th>`).join("")}</tr>
        <tr>${cols.map(() => `<th class="is-right">${sub}</th><th class="is-right">Real</th><th class="is-right">%</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>`;
    },
    setBuscaCons(v) { this.tabs.consolidado.busca = v; this.render(); const i = document.getElementById("oxr-cons-busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
    alternarSecao(k) { const a = this.tabs.consolidado.abertos; a[k] = !a[k]; this.render(); },
    expandirSecoes(on) { const t = this.tabs.consolidado; t.abertos = { receitas: on, despesas: on, vendas: on }; t.vProd = {}; if (on) this.itensVendas(this.versaoAba("consolidado")).forEach((x) => { t.vProd[x.cc] = true; }); this.render(); },
    irSecao(k) { if (k !== "resultado") this.tabs.consolidado.abertos[k] = true; this.render(); const el = document.getElementById("oxr-sec-" + k); if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); },
    excelConsolidado() {
      const B = this.bundleConsolidado(), refLabel = this.tabs.consolidado.modo === "orcado" ? "Orçado" : "Forecast";
      const rows = [];
      [["Receitas", B.receitas.allItems], ["Despesas", B.despesas.allItems], ["Vendas", B.vendasB.allItems]].forEach(([l, itens]) => itens.forEach((it) => rows.push([l, it.label, it.sublabel || "", this.reais(it.valRef), this.reais(it.valReal), this.reais(it.varRs), it.varPerc])));
      this.xlsx(["Bloco", "Produto", "Plano", refLabel, "Realizado", "Variação", "Var. %"], rows, `consolidado_${this.ano}_${this.tabs.consolidado.modo}.xlsx`);
    },

    /* ================= abas Despesas e Receitas ================= */
    htmlDR(aba) {
      if (!this.calc) return this.precisaCalcular();
      const t = this.tabs[aba], tipo = aba === "despesas" ? "DESPESAS" : "RECEITAS", ref = t.modo === "orcado" ? "orcado" : "forecast", ms = this.ms();
      let itens = this.drFiltrados(tipo, this.versaoAba(aba)).slice();
      const pr = (x) => `${x.cc} ${x.cc_nome}`, pl = (x) => this.rotPlano(x.plano, x.plano_nome);
      if (t.sort) { const g = t.sort.k === "produto" ? pr : pl, d = t.sort.dir === "asc" ? 1 : -1; itens.sort((a, b) => d * g(a).localeCompare(g(b), "pt-BR", { numeric: true })); }
      else itens.sort((a, b) => pr(a).localeCompare(pr(b), "pt-BR") || pl(a).localeCompare(pl(b), "pt-BR", { numeric: true }));
      const cols = ms.concat(["T"]);
      const v = (arr, c) => (c === "T" ? soma(arr, ms) : arr[c] || 0);
      const seta = (k) => (t.sort && t.sort.k === k ? (t.sort.dir === "asc" ? " ↑" : " ↓") : ` <span style="opacity:.5">⇅</span>`);
      const barra = this.barraModo(aba, `<button type="button" class="btn btn-excel" style="height:32px" onclick="${N}.excelDR('${aba}')">⬇ Excel</button>`);
      if (!itens.length) return barra + `<div class="oxr-vazio">Nenhum dado de ${aba} para ${this.esc(this.ano)}.</div>`;
      const rot = ref === "orcado" ? "ORC." : "FCST.";
      const corpo = itens.map((x) => {
        const cellsRef = cols.map((c) => `<td class="is-right" style="${c === "T" ? "font-weight:700;border-left:1px solid #e2e8f0" : ""}">${this.rs(v(x[ref], c))}</td>`).join("");
        const cellsReal = cols.map((c) => `<td class="is-right" style="${c === "T" ? "font-weight:700;border-left:1px solid #e2e8f0" : ""}">${this.rs(v(x.realizado, c))}</td>`).join("");
        const cellsDes = cols.map((c) => `<td class="is-right" style="${c === "T" ? "border-left:1px solid #e2e8f0" : ""}">${this.badge(varPerc(v(x.realizado, c), v(x[ref], c)), tipo === "DESPESAS")}</td>`).join("");
        const nomes = `<td rowspan="3" class="oxr-sticky" style="vertical-align:top;white-space:normal;font-weight:700;background:#fff">${this.esc(pr(x))}${tipo === "DESPESAS" && window.OrionDashOrcamento ? `<div style="margin-top:2px"><button type="button" class="oxr-link" style="font-size:0.64rem" onclick="${N}.irAnalitico('analitico1')">Analítico →</button></div>` : ""}</td><td rowspan="3" style="vertical-align:top;white-space:normal;color:#4a6355;background:#fff">${this.esc(pl(x))}</td>`;
        return `<tr>${nomes}<td style="color:#64748b">${rot}</td>${cellsRef}</tr><tr><td style="color:#64748b">Real.</td>${cellsReal}</tr><tr><td style="color:#334155;font-weight:600;background:#eef3f0">Desvio %</td>${cellsDes}</tr>`;
      }).join("");
      return barra + `<div class="cc-scroll" style="max-height:68vh"><table class="cc-table oxr-mat" style="min-width:${430 + cols.length * 110}px"><colgroup><col style="width:230px"><col style="width:200px"><col style="width:90px">${cols.map(() => `<col style="width:110px">`).join("")}</colgroup>
        <thead><tr><th class="oxr-sticky" style="cursor:pointer" onclick="${N}.ordenarDR('${aba}','produto')">Produto${seta("produto")}</th><th style="cursor:pointer" onclick="${N}.ordenarDR('${aba}','plano')">Plano Financeiro${seta("plano")}</th><th>Métrica</th>${cols.map((c) => `<th class="is-right">${c === "T" ? "Total" : MES[c]}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>`;
    },
    ordenarDR(aba, k) { const t = this.tabs[aba]; if (t.sort && t.sort.k === k) t.sort = t.sort.dir === "asc" ? { k, dir: "desc" } : null; else t.sort = { k, dir: "asc" }; this.render(); },
    excelDR(aba) {
      const t = this.tabs[aba], tipo = aba === "despesas" ? "DESPESAS" : "RECEITAS", ref = t.modo === "orcado" ? "orcado" : "forecast", ms = this.ms();
      const rows = this.drFiltrados(tipo, this.versaoAba(aba)).map((x) => [`${x.cc} ${x.cc_nome}`, this.rotPlano(x.plano, x.plano_nome)].concat(ms.map((i) => this.reais(x[ref][i])), [this.reais(soma(x[ref], ms))]));
      this.xlsx(["Produto", "Plano Financeiro"].concat(ms.map((i) => MES[i]), ["Total"]), rows, `${aba}_${this.ano}.xlsx`);
    },

    /* ================= aba Vendas ================= */
    htmlVendas() {
      if (!this.calc) return this.precisaCalcular();
      const t = this.tabs.vendas, ref = t.modo === "orcado" ? "orcado" : "forecast", ms = this.ms(), cols = ms.concat(["T"]);
      let itens = this.itensVendas(this.versaoAba("vendas"));
      if (t.sort) { const d = t.sort.dir === "asc" ? 1 : -1; itens = itens.slice().sort((a, b) => d * `${a.cc} ${a.cc_nome}`.localeCompare(`${b.cc} ${b.cc_nome}`, "pt-BR")); }
      const barra = this.barraModo("vendas", `<button type="button" class="btn btn-excel" style="height:32px" onclick="${N}.excelVendas()">⬇ Excel</button>`);
      if (!itens.length) return barra + `<div class="oxr-vazio">Nenhum dado de vendas para ${this.esc(this.ano)}.</div>`;
      const BL = { vendas: ["Vendas brutas", "#10b981"], distratos: ["Distratos", "#f87171"], liquido: ["VGV líquido", "#f59e0b"] };
      const val = (arr, c) => (c === "T" ? soma(arr, ms) : arr[c] || 0);
      const liq = (x, tipo, c) => val(x.vendas[tipo].vgv, c) - val(x.distratos[tipo].vgv, c);
      const pRef = ref === "orcado" ? "Orç." : "Fcst.";
      const linhaM = (rotulo, fn, extra) => `<tr><td class="oxr-sticky"></td><td style="padding-left:22px;color:#64748b;${extra || ""}">${rotulo}</td>${cols.map((c) => `<td class="is-right" style="${c === "T" ? "font-weight:700;border-left:1px solid #e2e8f0" : ""}">${fn(c)}</td>`).join("")}</tr>`;
      const corpo = itens.map((x, idx) => {
        let h = `<tr class="oxr-g" style="cursor:default"><td class="oxr-sticky" style="white-space:normal">${this.esc(x.cc + " " + x.cc_nome)}</td><td style="font-size:0.64rem;text-transform:uppercase;letter-spacing:.04em">VGV líquido</td>${cols.map((c) => { const v = liq(x, "realizado", c); return `<td class="is-right" style="${v < 0 ? "color:#b91c1c !important;" : ""}${c === "T" ? "border-left:1px solid #9fcdb4" : ""}">${this.rs(v)}</td>`; }).join("")}</tr>`;
        ["vendas", "distratos", "liquido"].forEach((sec) => {
          const k = idx + "-" + sec, ab = !!t.abertos[k];
          const head = sec === "liquido" ? (c) => liq(x, "realizado", c) : (c) => val(x[sec].realizado.vgv, c);
          h += `<tr style="cursor:pointer" onclick="${N}.tabs.vendas.abertos['${k}']=!${N}.tabs.vendas.abertos['${k}'];${N}.render()"><td class="oxr-sticky" style="border-left:3px solid ${BL[sec][1]};font-weight:700">${ab ? "▾" : "▸"} <span style="color:${BL[sec][1]}">●</span> ${BL[sec][0]}</td><td style="color:#64748b">${sec === "liquido" ? "Real. VGV líq." : "Real. VGV"}</td>${cols.map((c) => { const v = head(c); return `<td class="is-right" style="font-weight:700;${v < 0 ? "color:#b91c1c;" : ""}${c === "T" ? "border-left:1px solid #e2e8f0" : ""}">${this.rs(v)}</td>`; }).join("")}</tr>`;
          if (!ab) return;
          const des = (a, b, inv) => (c) => this.badge(varPerc(a(c), b(c)), inv);
          if (sec === "liquido") {
            h += linhaM(`${pRef} VGV líq.`, (c) => this.rs(liq(x, ref, c)));
            h += linhaM("Real. VGV líq.", (c) => this.rs(liq(x, "realizado", c)));
            h += linhaM("Desvio % líq.", (c) => { const r = liq(x, ref, c), q = liq(x, "realizado", c); return this.badge(r !== 0 ? (q - r) / Math.abs(r) : 0, false); });
          } else {
            const inv = sec === "distratos", s = x[sec];
            h += linhaM(`${pRef} unidades`, (c) => this.un(val(s[ref].un, c)), "background:#f7faf8");
            h += linhaM("Real. unidades", (c) => this.un(val(s.realizado.un, c)), "background:#f7faf8");
            h += linhaM("Desvio % unid.", des((c) => val(s.realizado.un, c), (c) => val(s[ref].un, c), inv));
            h += linhaM(`${pRef} VGV`, (c) => this.rs(val(s[ref].vgv, c)));
            h += linhaM("Real. VGV", (c) => this.rs(val(s.realizado.vgv, c)));
            h += linhaM("Desvio % VGV", des((c) => val(s.realizado.vgv, c), (c) => val(s[ref].vgv, c), inv));
          }
        });
        return h + `<tr><td colspan="${2 + cols.length}" style="height:6px;padding:0;background:#eef3f0"></td></tr>`;
      }).join("");
      const seta = t.sort ? (t.sort.dir === "asc" ? " ↑" : " ↓") : ` <span style="opacity:.5">⇅</span>`;
      return barra + `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.74rem;color:#6b8474;margin-bottom:8px"><b style="text-transform:uppercase;color:#4a6355">Blocos</b>${Object.values(BL).map(([l, c]) => `<span><span style="color:${c}">●</span> ${l}</span>`).join("")}<span style="color:#94a3b8">· Expanda um bloco para unidades e desvios</span></div>
        <div class="cc-scroll" style="max-height:68vh"><table class="cc-table oxr-mat" style="min-width:${380 + cols.length * 110}px"><colgroup><col style="width:240px"><col style="width:140px">${cols.map(() => `<col style="width:110px">`).join("")}</colgroup>
        <thead><tr><th class="oxr-sticky" style="cursor:pointer" onclick="${N}.ordenarVendas()">Produto${seta}</th><th>Métrica</th>${cols.map((c) => `<th class="is-right">${c === "T" ? "Total" : MES[c]}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>
        <div style="font-size:0.7rem;color:#94a3b8;margin-top:6px">Realizado: contratos de venda do Sienge (venda na data do contrato; distrato na data do cancelamento, valorizado pelo ticket médio orçado, como no Órion).</div>`;
    },
    ordenarVendas() { const t = this.tabs.vendas; t.sort = !t.sort ? { dir: "asc" } : t.sort.dir === "asc" ? { dir: "desc" } : null; this.render(); },
    excelVendas() {
      const t = this.tabs.vendas, ref = t.modo === "orcado" ? "orcado" : "forecast", ms = this.ms();
      const rows = this.itensVendas(this.versaoAba("vendas")).map((x) => [`${x.cc} ${x.cc_nome}`].concat(ms.map((i) => this.reais(x.vendas[ref].vgv[i])), [this.reais(soma(x.vendas[ref].vgv, ms))]));
      this.xlsx(["Produto"].concat(ms.map((i) => MES[i]), ["Total"]), rows, `Realizado_${this.ano}.xlsx`);
    },

    /* ================= Comparativo de versões ================= */
    /** Versões que podem ser comparadas (Órion: Orçamento + cada forecast), na ordem do Órion. */
    versoesCmp(tipo) {
      const tipos = tipo === "CONSOLIDADO" ? ["DESPESAS", "RECEITAS"] : [tipo];
      const doTipo = (l) => l.filter((c) => tipos.indexOf(String(c.tipo).toUpperCase()) >= 0 && c.status !== "Substituído");
      const out = [], vistos = new Set();
      const rotOrc = [...new Set(doTipo(this.escopo("orcamento")).map((c) => rotuloOrc(c.descricao)))].sort((a, b) => (a === "Orçamento" ? -1 : b === "Orçamento" ? 1 : a.localeCompare(b, "pt-BR")));
      rotOrc.forEach((r) => { out.push({ id: "OC_" + r, descricao: r, base: "orcamento", chave: r }); vistos.add(r); });
      const fcs = [...new Set(doTipo(this.escopo("forecast")).map((c) => String(c.descricao || "")))].filter(Boolean);
      fcs.map((d) => ({ id: "FC_" + d, descricao: rotuloFc(d), base: "forecast", chave: d })).sort((a, b) => rolling(a.chave) - rolling(b.chave) || a.descricao.localeCompare(b.descricao, "pt-BR"))
        .forEach((v) => { if (vistos.has(v.descricao)) return; vistos.add(v.descricao); out.push(v); });
      return out;
    },
    /** linhas de uma versão, agrupadas como no Órion (produto × plano; vendas: produto × forma de venda × distrato) */
    docsVersao(v, tipos) {
      const C = this.C();
      if (v.base === "orcamento") return C.documentosVigentes(this.escopo("orcamento").filter((c) => rotuloOrc(c.descricao) === v.chave), { ano: this.ano, dept: "TODOS", base: "orcamento", tipos }).docs;
      return C.documentosVigentes(this.escopo("forecast"), { ano: this.ano, dept: "TODOS", base: "forecast", versao: v.chave, tipos }).docs.filter((c) => String(c.descricao || "") === v.chave);
    },
    async linhasVersao(v, tipo) {
      const tipos = tipo === "CONSOLIDADO" ? ["DESPESAS", "RECEITAS"] : [tipo];
      const o = await this.lerConjunto(v.base, this.docsVersao(v, tipos));
      const mapa = new Map();
      if (tipo === "VENDAS") {
        o.vendas.forEach((l) => {
          const m = Number(l.mes) - 1; if (!(m >= 0 && m < 12)) return;
          const dis = ehDistrato(l), plano = l.plano_venda || "(sem plano)", k = l.cc + "|" + plano + "|" + (dis ? 1 : 0);
          if (!mapa.has(k)) mapa.set(k, { cc: l.cc, cc_nome: l.cc_nome || "", plano, plano_nome: "", plano_rot: plano, is_distrato: dis, m: zeros(), n: zeros() });
          const x = mapa.get(k); x.m[m] += Number(l.vgv) || 0; x.n[m] += Number(l.vendas) || 0;
        });
      } else {
        (tipo === "RECEITAS" ? o.rec : tipo === "DESPESAS" ? o.desp : o.desp.concat(o.rec)).forEach((l) => {
          const k = l.cc + "|" + l.plano;
          if (!mapa.has(k)) mapa.set(k, { cc: l.cc, cc_nome: l.cc_nome || "", plano: l.plano, plano_nome: l.plano_nome || "", plano_rot: this.rotPlano(l.plano, l.plano_nome), redutora: !!l.redutora, m: zeros(), n: zeros() });
          const x = mapa.get(k); (l.m || []).forEach((val, i) => { x.m[i] += Number(val) || 0; });
        });
      }
      return mapa;
    },
    setCmp(campo, v) {
      const c = this.cmp;
      c[campo] = v;
      if (campo === "tipo") { c.a = ""; c.b = ""; c.res = null; c.vMet = "vgv"; c.vCat = "todos"; }
      this.render();
    },
    async comparar() {
      const c = this.cmp, vs = this.versoesCmp(c.tipo);
      const a = vs.find((x) => x.id === c.a), b = vs.find((x) => x.id === c.b);
      if (!a || !b) return;
      c.carregando = true; this.render();
      try {
        const ma = await this.linhasVersao(a, c.tipo), mb = await this.linhasVersao(b, c.tipo);
        const vazio = (x) => Object.assign({}, x, { m: zeros(), n: zeros() });
        const res = { inclusoes: [], exclusoes: [], alteracoes: [], nomeA: a.descricao, nomeB: b.descricao };
        new Set([...ma.keys(), ...mb.keys()]).forEach((k) => {
          const x = ma.get(k), y = mb.get(k), base = x || y;
          const it = { cc: base.cc, cc_nome: (x && x.cc_nome) || (y && y.cc_nome) || this.nomeCc(base.cc), plano: base.plano, plano_nome: (x && x.plano_nome) || (y && y.plano_nome) || "", plano_rot: base.plano_rot, redutora: base.redutora, is_distrato: base.is_distrato, a: x || vazio(base), b: y || vazio(base) };
          if (x && !y) res.exclusoes.push(it); else if (y && !x) res.inclusoes.push(it); else res.alteracoes.push(it);
        });
        Object.assign(c, { res, view: "destaques", desvio: "todos", visao: "executiva", busca: "", mat: "todos", vMet: "vgv", vCat: "todos", modo: "total" });
      } catch (e) { this.erro = e.message || String(e); }
      c.carregando = false;
      this.render();
    },
    /** resultado filtrado (categoria de vendas, painel Filtros) */
    cmpFiltrado() {
      const c = this.cmp, r = c.res;
      if (!r) return null;
      let p = r;
      if (c.tipo === "VENDAS" && c.vCat !== "todos") {
        if (c.vCat === "liquido") {
          const mapa = new Map();
          ["inclusoes", "alteracoes", "exclusoes"].forEach((k) => r[k].forEach((it) => {
            const key = it.cc + "|" + it.plano;
            if (!mapa.has(key)) mapa.set(key, Object.assign({}, it, { is_distrato: false, a: { m: zeros(), n: zeros() }, b: { m: zeros(), n: zeros() } }));
            const e = mapa.get(key), s = it.is_distrato ? -1 : 1;
            for (let i = 0; i < 12; i++) { e.a.m[i] += it.a.m[i] * s; e.a.n[i] += it.a.n[i] * s; e.b.m[i] += it.b.m[i] * s; e.b.n[i] += it.b.n[i] * s; }
          }));
          const tem = (x) => x.m.some(Boolean) || x.n.some(Boolean);
          p = { inclusoes: [], exclusoes: [], alteracoes: [], nomeA: r.nomeA, nomeB: r.nomeB };
          mapa.forEach((it) => { const ha = tem(it.a), hb = tem(it.b); if (ha && !hb) p.exclusoes.push(it); else if (hb && !ha) p.inclusoes.push(it); else p.alteracoes.push(it); });
        } else {
          const ok = (it) => (c.vCat === "distratos" ? !!it.is_distrato : !it.is_distrato);
          p = Object.assign({}, r, { inclusoes: r.inclusoes.filter(ok), exclusoes: r.exclusoes.filter(ok), alteracoes: r.alteracoes.filter(ok) });
        }
      }
      const fil = (l) => l.filter((it) => this.passa(it.cc, it.cc_nome, it.plano_rot, it.plano_rot));
      return Object.assign({}, p, { inclusoes: fil(p.inclusoes), exclusoes: fil(p.exclusoes), alteracoes: fil(p.alteracoes) });
    },
    /** buildComparativoInsights do Órion */
    cmpInsights(fr) {
      const c = this.cmp, tipo = c.tipo, met = c.vMet, ms = this.ms();
      const un = tipo === "VENDAS" && met === "unidades";
      const fmt = (v) => (un ? this.un(v) : this.rs(v));
      const minVar = un ? 0 : 1;
      const mult = (it) => (tipo === "CONSOLIDADO" && it.redutora ? -1 : 1);
      const lado = (x) => (un ? x.n : x.m);
      const proc = (it) => { const k = mult(it), valA = soma(lado(it.a), ms) * k, valB = soma(lado(it.b), ms) * k, v = valB - valA; return Object.assign({}, it, { valA, valB, varRs: v, varPerc: valA !== 0 ? v / Math.abs(valA) : valB !== 0 ? 1 : 0, absVarRs: Math.abs(v), multiplier: k, favoravel: favTipo(v, tipo) }); };
      const rawInc = fr.inclusoes.map(proc), rawExc = fr.exclusoes.map(proc), rawAlt = fr.alteracoes.map(proc);
      let A = 0, Bt = 0;
      rawInc.concat(rawExc, rawAlt).forEach((i) => { A += i.valA; Bt += i.valB; });
      const inc = rawInc.filter((i) => i.absVarRs > minVar), exc = rawExc.filter((i) => i.absVarRs > minVar), alt = rawAlt.filter((i) => i.absVarRs > minVar), semMud = rawAlt.filter((i) => i.absVarRs <= minVar);
      const all = inc.concat(exc, alt).sort((a, b) => b.absVarRs - a.absVarRs);
      const todas = rawInc.map((i) => Object.assign(i, { cat: "Inclusão" })).concat(rawExc.map((i) => Object.assign(i, { cat: "Exclusão" })), rawAlt.map((i) => Object.assign(i, { cat: i.absVarRs > minVar ? "Alteração" : "Sem variação" }))).sort((a, b) => b.absVarRs - a.absVarRs);
      const gv = Bt - A, gp = A !== 0 ? gv / Math.abs(A) : 0;
      const favs = all.filter((i) => i.favoravel && i.varRs !== 0), desf = all.filter((i) => !i.favoravel && i.varRs !== 0);
      const sv = (l) => l.reduce((s, i) => s + i.varRs, 0), sa = (l) => l.reduce((s, i) => s + i.absVarRs, 0);
      const impInc = sv(inc), impExc = sv(exc), impAlt = sv(alt), totAbs = sa(all) || 1;
      const top5 = all.length ? sa(all.slice(0, 5)) / totAbs : 0, top10 = all.length ? sa(all.slice(0, 10)) / totAbs : 0;
      const absImp = Math.abs(impAlt) + Math.abs(impInc) + Math.abs(impExc) || 1;
      const agrega = (getK, getL) => { const m = new Map(); all.forEach((i) => { const k = getK(i); const e = m.get(k) || { key: k, label: getL(i), varRs: 0, absVarRs: 0, count: 0 }; e.varRs += i.varRs; e.absVarRs += i.absVarRs; e.count++; m.set(k, e); }); return [...m.values()].sort((a, b) => b.absVarRs - a.absVarRs).slice(0, 5).map((p) => Object.assign(p, { shareAbs: p.absVarRs / totAbs })); };
      const tipoLabel = tipo === "DESPESAS" ? "despesas" : tipo === "RECEITAS" ? "receitas" : tipo === "VENDAS" ? "vendas" : "resultado consolidado";
      const alertas = [];
      if (!favTipo(gv, tipo) && all.length) alertas.push({ tone: "red", title: "Variação total desfavorável", detail: `${fmt(gv)} (${this.pc(gp)}) em ${tipoLabel}. Priorize revisão dos itens em vermelho.` });
      if (top5 >= 0.6) alertas.push({ tone: "amber", title: "Alta concentração do desvio", detail: `Os 5 maiores itens explicam ${Math.round(top5 * 100)}% do desvio absoluto.` });
      if (inc.length && Math.abs(impInc) > totAbs * 0.15) alertas.push({ tone: "amber", title: "Inclusões relevantes", detail: `${inc.length} linha(s) nova(s) somam ${fmt(impInc)} na versão comparada.` });
      desf.slice(0, 3).forEach((i, k) => alertas.push({ tone: "red", title: `Atenção #${k + 1}`, detail: `${i.cc} ${i.cc_nome} · ${i.plano_rot}: ${fmt(i.varRs)} (${Math.round((i.absVarRs / totAbs) * 100)}% do desvio).` }));
      let narrative;
      if (!all.length) narrative = "As duas versões são equivalentes no total — não há desvios materiais por produto/plano.";
      else if (favTipo(gv, tipo)) narrative = `A versão comparada é ${gv >= 0 ? "superior" : "inferior"} em ${fmt(Math.abs(gv))} (${this.pc(gp)}), movimento favorável para ${tipoLabel}. ${favs.length} linha(s) contribuem positivamente; ${top5 >= 0.5 ? `mais de metade do desvio vem dos 5 maiores itens (${Math.round(top5 * 100)}%).` : "O desvio está distribuído entre vários itens."}`;
      else narrative = `Atenção: variação de ${fmt(gv)} (${this.pc(gp)}) em desfavor de ${tipoLabel}. ${desf.length} linha(s) puxam o resultado; revise os destaques abaixo.`;
      const comShare = (l) => l.map((i) => Object.assign(i, { shareAbs: totAbs > 0 ? i.absVarRs / totAbs : 0 }));
      comShare(todas);
      return { fmt, ms, un, A, B: Bt, gv, gp, inc, exc, alt, semMud, all, todas, favs, desf, impInc, impExc, impAlt, totAbs, top5, top10,
        pAlt: Math.abs(impAlt) / absImp, pInc: Math.abs(impInc) / absImp, pExc: Math.abs(impExc) / absImp, saldoFav: sv(favs), saldoDesf: sv(desf),
        topProdutos: agrega((i) => i.cc, (i) => `${i.cc} ${i.cc_nome}`), topPlanos: agrega((i) => i.plano_rot, (i) => i.plano_rot), alertas,
        veredito: !all.length ? "neutro" : favTipo(gv, tipo) ? "favoravel" : "desfavoravel", narrative,
        mensal: ms.map((i) => { let a = 0, b = 0; fr.inclusoes.concat(fr.alteracoes, fr.exclusoes).forEach((it) => { const k = mult(it); a += lado(it.a)[i] * k; b += lado(it.b)[i] * k; }); return { i, ref: a, real: b, varRs: b - a, favoravel: favTipo(b - a, tipo) }; }),
        counts: { comDesvio: all.length, favoravel: favs.length, desfavoravel: desf.length, inclusoes: inc.length, exclusoes: exc.length, alteracoes: alt.length, semMudanca: semMud.length, totalLinhas: rawInc.length + rawExc.length + rawAlt.length } };
    },
    htmlComparativo() {
      if (this.cmp.dfc) return this.htmlDfcCmp();
      const c = this.cmp, vs = this.versoesCmp(c.tipo), r = c.res;
      const tipos = [["CONSOLIDADO", "Consolidado"], ["DESPESAS", "Despesas"], ["RECEITAS", "Receitas"], ["VENDAS", "Vendas"]];
      const tipoLabel = tipos.find((x) => x[0] === c.tipo)[1];
      const op = (sel) => `<option value="">Selecione…</option>` + vs.map((v) => `<option value="${this.esc(v.id)}" ${v.id === sel ? "selected" : ""}>${this.esc(v.descricao)}</option>`).join("");
      const nome = (id) => (vs.find((v) => v.id === id) || {}).descricao || id;
      const config = `<div class="oxr-card" style="background:linear-gradient(135deg,#f7faf8,#fff);margin-bottom:10px"><div style="display:flex;gap:14px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap">
          <div style="min-width:0">${r ? `<div style="font-size:0.78rem;font-weight:700;color:#1c2e24;margin-bottom:6px">${tipoLabel} · ${this.esc(nome(c.a))} vs ${this.esc(nome(c.b))}</div>` : `<div class="oxr-lbl">Comparativo de versões</div><div style="font-size:0.84rem;color:#4a6355;margin:2px 0 8px">Compare orçamento e forecast · ${tipoLabel} · ${this.esc(this.ano)}</div>`}
            <div style="display:flex;gap:6px;flex-wrap:wrap">${tipos.map(([k, l]) => `<button type="button" class="btn ${c.tipo === k ? "btn-primary" : "btn-secondary"}" style="height:32px;font-size:0.78rem" onclick="${N}.setCmp('tipo','${k}')">${l}</button>`).join("")}</div></div>
          <div class="oxr-barra"><div><label class="ml-emp-filter-label">Versão base</label><select class="idx-select" style="height:40px;min-width:200px" onchange="${N}.setCmp('a',this.value)">${op(c.a)}</select></div>
            <span style="color:#9fcdb4;font-size:1.2rem;padding-bottom:8px">⇄</span>
            <div><label class="ml-emp-filter-label">Versão comparada</label><select class="idx-select" style="height:40px;min-width:200px" onchange="${N}.setCmp('b',this.value)">${op(c.b)}</select></div>
            <button type="button" class="btn btn-primary" ${!c.a || !c.b || c.carregando ? "disabled" : ""} onclick="${N}.comparar()">${c.carregando ? "⟳ Comparando…" : "⇆ Comparar"}</button>
            ${c.tipo !== "VENDAS" ? `<button type="button" class="btn btn-secondary" title="Abre as mesmas duas versões na árvore da Visão DFC (entradas e saídas)" ${!c.a || !c.b ? "disabled" : ""} onclick="${N}.abrirDfc()">≣ Visão DFC</button>` : ""}</div></div></div>`;
      if (!this.cabs.orcamento) return config + `<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner" style="margin:0 auto 15px;"></div>Carregando versões…</div>`;
      if (!r && !c.carregando) return config + `<div class="oxr-vazio"><div style="font-size:1.6rem">⇆</div><div style="font-weight:800;color:#1c2e24;margin:4px 0">Selecione duas versões para comparar</div><div style="font-size:0.78rem;max-width:460px;margin:0 auto">Escolha o tipo, a versão base (orçamento) e a versão comparada (forecast ou outra versão) para ver variações consolidadas e por produto.</div></div>`;
      if (!r) return config + `<div class="oxr-vazio">⟳ Gerando comparativo…</div>`;
      const fr = this.cmpFiltrado(), I = this.cmpInsights(fr), fmt = I.fmt;
      const fmtE = (v) => (c.tipo === "VENDAS" && c.vCat === "distratos" ? fmt(Math.abs(v)) : fmt(v));
      const corV = (v) => (v === 0 ? "#4a6355" : favTipo(v, c.tipo) ? "#047857" : "#b91c1c");
      const fav = favTipo(I.gv, c.tipo), tom = this.tom(fav, I.gv, I.gp);
      const catLbl = { todos: "Todos", vendas: "Vendas", distratos: "Distratos", liquido: "VGV líquido" };
      const kpi = `<div class="oxr-kpi" style="margin-bottom:8px"><div><div class="oxr-lbl">Versão base</div><div class="v">${fmtE(I.A)}</div><div class="s">${this.esc(r.nomeA)}</div></div>
          <div style="background:${tom.panel};text-align:center;min-width:170px"><div class="oxr-lbl">Variação total</div><div class="v" style="color:${tom.value}">${this.sinal(I.gv)}${fmtE(I.gv)}</div><div class="s" style="color:${tom.muted};font-weight:700">${this.sinal(I.gp)}${this.pc(I.gp, 2)}</div></div>
          <div style="text-align:right"><div class="oxr-lbl">Versão comparada</div><div class="v">${fmtE(I.B)}</div><div class="s">${this.esc(r.nomeB)}</div></div>
          <div class="oxr-kpi-pe"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.76rem;color:#4a6355">${I.counts.comDesvio} desvios · ${I.counts.inclusoes} inclusões · ${I.counts.exclusoes} exclusões${this.mesesOn ? `<span style="color:#94a3b8"> · Período: ${I.ms.map((i) => MES[i]).join(", ")}</span>` : ""}${c.tipo === "VENDAS" && c.vCat !== "todos" ? `<span style="color:#94a3b8"> · ${catLbl[c.vCat]}</span>` : ""}${c.tipo === "VENDAS" ? `<span style="color:#94a3b8"> · ${c.vMet === "vgv" ? "VGV" : "Nº vendas"}</span>` : ""}
              <span class="oxr-badge" style="${tom.badge};text-transform:uppercase;font-size:0.66rem;border-radius:999px;padding:2px 9px">${this.farolDot(I.B, I.A, c.tipo === "CONSOLIDADO" ? "RESULTADO" : c.tipo)} ${I.veredito === "favoravel" ? "✓ Favorável" : I.veredito === "desfavoravel" ? "! Requer atenção" : "Neutro"}</span></div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${c.tipo === "VENDAS" ? `<span style="border-right:1px solid #dfe9e3;padding-right:6px">${this.chips([["todos", "Todos"], ["vendas", "Vendas"], ["distratos", "Distratos"], ["liquido", "VGV líquido"]], c.vCat, `${N}.setCmp('vCat','$')`)}</span><span style="border-right:1px solid #dfe9e3;padding-right:6px">${this.chips([["vgv", "VGV"], ["unidades", "Nº vendas"]], c.vMet, `${N}.setCmp('vMet','$')`)}</span>` : ""}${this.chips([["executiva", "▦ Executiva"], ["analitica", "☰ Analítica"]], c.visao, `${N}.setCmp('visao','$')`)}</div></div></div>`;
      if (c.visao === "analitica") return config + kpi + this.htmlCmpAnalitica(I, r, fmtE, corV);
      const abrir = (view, busca, modo) => `${N}.abrirCmpAnalitica('${view || ""}','${this.esc(String(busca || "").replace(/['\\]/g, "").slice(0, 24))}','${modo || ""}')`;
      const comp = [["Alterações", I.impAlt, I.pAlt, "#64748b"], ["Inclusões", I.impInc, I.pInc, "#0ea5e9"], ["Exclusões", I.impExc, I.pExc, "#f59e0b"]].map(([l, v, p, cor]) => `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:0.74rem"><span style="color:#4a6355">${l} · ${Math.round(p * 100)}%</span><b style="color:${corV(v)}">${this.sinal(v)}${fmtE(v)}</b></div><div class="oxr-bar"><div style="width:${Math.min(100, p * 100)}%;background:${cor}"></div></div></div>`).join("");
      const tags = [["Linhas", I.counts.totalLinhas, `${I.counts.comDesvio} c/ desvio`], ["Favoráveis", I.counts.favoravel, fmtE(I.saldoFav), "#bbf7d0", "#f0fdf4"], ["Desfavoráveis", I.counts.desfavoravel, fmtE(I.saldoDesf), "#fecaca", "#fef2f2"], ["Inclusões", I.counts.inclusoes, fmtE(I.impInc)], ["Exclusões", I.counts.exclusoes, fmtE(I.impExc)], ["Alterações", I.counts.alteracoes, fmtE(I.impAlt)], ["Top 5", Math.round(I.top5 * 100) + "%", "desvio abs."], ["Top 10", Math.round(I.top10 * 100) + "%", "desvio abs."]]
        .map(([l, v, h, b, bg]) => `<span class="oxr-tag" title="${this.esc(h)}" style="${b ? `border-color:${b};background:${bg}` : ""}"><span>${l}</span><b>${v}</b></span>`).join("");
      const desp = c.tipo === "DESPESAS";
      const drivers = I.all.slice(0, 5).map((i) => this.driver(`${i.cc} ${i.cc_nome} · ${i.plano_rot}`, i.varRs, i.shareAbs || 0, i.favoravel, fmtE, desp ? `${N}.irAnalitico('analitico1')` : abrir("destaques", i.cc_nome))).join("") || `<div style="font-size:0.78rem;color:#6b8474">Nenhum desvio.</div>`;
      const porProd = I.topProdutos.slice(0, 3).map((p) => this.driver(p.label, p.varRs, p.shareAbs, favTipo(p.varRs, c.tipo), fmtE, desp ? `${N}.irAnalitico('analitico1')` : abrir("", p.label))).join("");
      const porPlano = I.topPlanos.slice(0, 3).map((p) => this.driver(p.label, p.varRs, p.shareAbs, favTipo(p.varRs, c.tipo), fmtE, desp ? `${N}.irAnalitico('analitico2')` : abrir("", p.label))).join("");
      return config + kpi + `<div class="oxr-g2" style="margin-top:0"><div class="oxr-box"><h5><span>${fav ? "✓" : "!"} Leitura executiva</span></h5><div style="font-size:0.8rem;color:#334155;line-height:1.5">${this.esc(I.narrative)}</div></div><div class="oxr-box"><h5>Composição do desvio</h5>${comp}</div></div>
        <div class="oxr-tags">${tags}</div>
        ${this.strip(I.mensal, fmtE, "Referência", "Realizado", abrir("destaques", "", "mes"), I.un ? "un" : "")}
        <div class="oxr-g3"><div class="oxr-box"><h5>🎯 Pontos de atenção</h5>${this.alertas(I.alertas)}</div>
          <div class="oxr-box"><h5><span>📈 Top drivers (linha)</span><button type="button" class="oxr-link" onclick="${desp ? `${N}.irAnalitico('analitico1')` : abrir("destaques")}">Ver todos →</button></h5>${drivers}</div>
          <div class="oxr-box" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px"><div><h5>▤ Por produto</h5>${porProd}</div><div><h5>Por plano</h5>${porPlano}</div></div></div>
        <div style="border:1px dashed #cfe0d6;border-radius:10px;background:#fbfdfc;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.76rem;color:#4a6355">${desp ? "Detalhe transacional de Contas a Pagar nos analíticos e ledger CP." : "Precisa do detalhe linha a linha? Use a visão analítica com busca, filtros e exportação."}${desp ? this.linksDespesas() : `<button type="button" class="oxr-link" onclick="${abrir("destaques")}">Abrir analítica ›</button>`}</div>`;
    },
    /* ----- Visão DFC do comparativo (Órion: DFC › Comparar versões) ----- */
    abrirDfc() { const c = this.cmp; c.dfc = true; c.dfcA = c.a; c.dfcB = c.b; c.dfcRes = null; c.dfcPorMes = false; this.carregarDfc(); },
    fecharDfc() { this.cmp.dfc = false; this.render(); },
    setDfc(campo, v) { this.cmp[campo] = v; if (campo === "dfcA" || campo === "dfcB") return this.carregarDfc(); this.render(); },
    async carregarDfc() {
      const c = this.cmp, vs = this.versoesCmp("CONSOLIDADO");
      const a = vs.find((x) => x.id === c.dfcA), b = vs.find((x) => x.id === c.dfcB);
      if (!a || !b) { c.dfcRes = null; return this.render(); }
      c.dfcCarregando = true; c.dfcErro = ""; this.render();
      try {
        const ler = async (v) => this.lerConjunto(v.base, this.docsVersao(v, ["DESPESAS", "RECEITAS"]));
        c.dfcRes = { A: await ler(a), B: await ler(b), nomeA: a.descricao, nomeB: b.descricao };
        c.dfcAbertos = null;
      } catch (e) { c.dfcErro = "A consulta falhou: " + (e.message || e); c.dfcRes = null; }
      c.dfcCarregando = false;
      this.render();
    },
    /** Árvore da Visão DFC do Integra com as duas versões: entradas (receitas) +, saídas (despesas) −; grupos-pai somam os filhos. */
    montarDfcCmp() {
      const c = this.cmp, d = c.dfcRes, R = this.R(), ms = this.ms();
      const grupos = ((R && R.grupos()) || []).filter((g) => g && g.id && g.type !== "formula");
      if (!grupos.length) return null;
      const porId = {}; grupos.forEach((g) => { porId[g.id] = g; });
      const planos = new Map();
      const lado = (o, campo) => {
        const add = (l, sinal) => {
          if (!this.passa(l.cc, l.cc_nome, null)) return;
          const gid = R.grupoDe(l.plano);
          if (!gid || !porId[gid]) return;
          const k = gid + "|" + l.plano;
          if (!planos.has(k)) planos.set(k, { gid, codigo: l.plano, nome: l.plano_nome || "", a: zeros(), b: zeros() });
          const x = planos.get(k);
          if (!x.nome && l.plano_nome) x.nome = l.plano_nome;
          (l.m || []).forEach((v, i) => { x[campo][i] += (Number(v) || 0) * sinal; });
        };
        o.rec.forEach((l) => add(l, 1));
        o.desp.forEach((l) => add(l, -1));
      };
      lado(d.A, "a"); lado(d.B, "b");
      const fin = (x) => { x.ta = soma(x.a, ms); x.tb = soma(x.b, ms); x.vr = x.tb - x.ta; x.vp = Math.abs(x.ta) < 1 ? null : x.vr / Math.abs(x.ta); x.mv = x.b.map((v, i) => v - x.a[i]); return x; };
      const filhos = {};
      grupos.forEach((g) => { if (g.parentId && porId[g.parentId]) (filhos[g.parentId] = filhos[g.parentId] || []).push(g.id); });
      const no = {};
      const montar = (gid) => {
        if (no[gid]) return no[gid];
        const g = porId[gid];
        const ps = [...planos.values()].filter((p) => p.gid === gid).map(fin).sort((x, y) => String(x.nome).localeCompare(String(y.nome), "pt-BR") || String(x.codigo).localeCompare(String(y.codigo)));
        const fs = (filhos[gid] || []).map(montar);
        const x = { id: gid, codigo: g.code || g.codigo || "", nome: g.name || g.nome || gid, planos: ps, filhos: fs, a: zeros(), b: zeros() };
        ps.concat(fs).forEach((y) => { for (let i = 0; i < 12; i++) { x.a[i] += y.a[i]; x.b[i] += y.b[i]; } });
        no[gid] = fin(x);
        return no[gid];
      };
      const topo = grupos.filter((g) => !g.parentId || !porId[g.parentId]).map((g) => montar(g.id));
      const linhas = [];
      const plana = (x, nivel) => { linhas.push(Object.assign(x, { nivel })); x.filhos.forEach((y) => plana(y, nivel + 1)); };
      topo.forEach((x) => plana(x, 0));
      const la = topo.reduce((s2, x) => s2 + x.ta, 0), lb = topo.reduce((s2, x) => s2 + x.tb, 0);
      return { linhas, la, lb, vr: lb - la, vp: Math.abs(la) < 1 ? null : (lb - la) / Math.abs(la), ms };
    },
    htmlDfcCmp() {
      const c = this.cmp, vs = this.versoesCmp("CONSOLIDADO");
      const op = (sel) => `<option value="">Selecione…</option>` + vs.map((v) => `<option value="${this.esc(v.id)}" ${v.id === sel ? "selected" : ""}>${this.esc(v.descricao)}</option>`).join("");
      const num = (v) => `<span style="color:${v < 0 ? "#dc2626" : v > 0 ? "#1c2e24" : "#94a3b8"}">${v ? this.rs(v) : "R$ 0"}</span>`;
      const per = (v) => (v == null ? `<span style="color:#cbd5e1">—</span>` : `<span style="color:${v < 0 ? "#dc2626" : "#334155"}">${this.pc(v)}</span>`);
      const topo = `<div style="margin-bottom:10px"><button type="button" class="oxr-link" style="font-size:0.8rem" onclick="${N}.fecharDfc()">← Voltar ao comparativo de versões</button></div>
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px"><div style="font-size:1.15rem;font-weight:800;color:var(--color-primary)">DFC</div><div style="font-size:0.8rem;color:#6b8474">Comparativo de versões pela Visão DFC — mesma estrutura do demonstrativo.</div></div>
        <div class="oxr-card"><div class="oxr-barra"><div><label class="ml-emp-filter-label">Versão base</label><select class="idx-select" style="height:40px;min-width:220px" onchange="${N}.setDfc('dfcA',this.value)">${op(c.dfcA)}</select></div>
          <div><label class="ml-emp-filter-label">Versão comparada</label><select class="idx-select" style="height:40px;min-width:220px" onchange="${N}.setDfc('dfcB',this.value)">${op(c.dfcB)}</select></div>
          <button type="button" class="btn btn-primary" ${!c.dfcA || !c.dfcB || c.dfcCarregando ? "disabled" : ""} onclick="${N}.carregarDfc()">⇆ Comparar no DFC</button></div>
          <div style="font-size:0.72rem;color:#6b8474;margin-top:8px">Mesma árvore da Visão DFC — colunas Base · Comparada · variação. Saídas negativas.</div></div>`;
      if (!c.dfcA || !c.dfcB) return topo + `<div class="oxr-vazio">Selecione as duas versões para montar o DFC comparativo.</div>`;
      if (c.dfcCarregando) return topo + `<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner" style="margin:0 auto 15px;"></div>Montando o DFC comparativo…</div>`;
      if (c.dfcErro) return topo + `<div class="oxr-vazio" style="color:#92400e">${this.esc(c.dfcErro)}</div>`;
      if (!c.dfcRes) return topo + `<div class="oxr-vazio">Clique em Comparar no DFC.</div>`;
      const M = this.montarDfcCmp();
      if (!M) return topo + `<div class="oxr-vazio">A Visão DFC do Integra ainda não carregou (Configurações gerais › Plano Financeiro e Visões). Recarregue a página e tente de novo.</div>`;
      if (!c.dfcAbertos) { c.dfcAbertos = {}; M.linhas.forEach((x) => { c.dfcAbertos[x.id] = true; }); }
      const A = c.dfcRes.nomeA, B = c.dfcRes.nomeB, porMes = !!c.dfcPorMes;
      const hero = `<div class="oxr-g4" style="margin-top:0">
          <div class="oxr-box"><div class="oxr-lbl">Líquido · ${this.esc(A)}</div><div style="font-size:1.15rem;font-weight:800;margin-top:4px">${num(M.la)}</div></div>
          <div class="oxr-box"><div class="oxr-lbl">Líquido · ${this.esc(B)}</div><div style="font-size:1.15rem;font-weight:800;margin-top:4px">${num(M.lb)}</div></div>
          <div class="oxr-box"><div style="display:flex;justify-content:space-between"><span class="oxr-lbl">Variação R$</span>${this.farolDot(M.lb, M.la, "RESULTADO")}</div><div style="font-size:1.15rem;font-weight:800;margin-top:4px">${num(M.vr)}</div></div>
          <div class="oxr-box"><div class="oxr-lbl">Variação %</div><div style="font-size:1.15rem;font-weight:800;margin-top:4px">${per(M.vp)}</div></div></div>`;
      const cels = (x) => (porMes ? TODOS_MESES.map((i) => `<td class="is-right" style="border-left:1px solid #e2e8f0">${num(x.a[i])}</td><td class="is-right">${num(x.b[i])}</td><td class="is-right" style="font-weight:700">${num(x.mv[i])}</td>`).join("")
        : `<td class="is-right" style="border-left:1px solid #e2e8f0">${num(x.ta)}</td><td class="is-right">${num(x.tb)}</td><td class="is-right" style="font-weight:700">${num(x.vr)}</td><td class="is-right">${per(x.vp)}</td>`);
      let corpo = "";
      M.linhas.forEach((x) => {
        const ab = !!c.dfcAbertos[x.id], tem = x.planos.length > 0;
        corpo += `<tr style="background:#fff"><td class="oxr-sticky" style="padding-left:${8 + x.nivel * 16}px;white-space:normal;${tem ? "cursor:pointer" : ""}" ${tem ? `onclick="${N}.cmp.dfcAbertos['${this.esc(x.id)}']=${ab ? "false" : "true"};${N}.render()"` : ""}><span style="display:inline-block;width:14px;color:#94a3b8">${tem ? (ab ? "▾" : "▸") : ""}</span><span style="font-family:monospace;color:#94a3b8;margin-right:6px">${this.esc(x.codigo)}</span><b>${this.esc(x.nome)}</b></td>${cels(x)}</tr>`;
        if (ab) x.planos.forEach((p) => { corpo += `<tr style="background:#f8faf9"><td class="oxr-sticky" style="padding-left:${24 + (x.nivel + 1) * 16}px;white-space:normal;color:#4a6355"><span style="font-family:monospace;color:#94a3b8;margin-right:6px">${this.esc(p.codigo)}</span>${this.esc(p.nome)}</td>${cels(p)}</tr>`; });
      });
      const head = porMes ? `<tr><th class="oxr-sticky" rowspan="2">Categoria</th>${MES.map((m) => `<th colspan="3" class="is-center">${m}</th>`).join("")}</tr><tr>${MES.map(() => `<th class="is-right" title="${this.esc(A)}">${this.esc(A)}</th><th class="is-right" title="${this.esc(B)}">${this.esc(B)}</th><th class="is-right">Var. R$</th>`).join("")}</tr>`
        : `<tr><th class="oxr-sticky">Categoria</th><th class="is-right" title="${this.esc(A)}">${this.esc(A)}</th><th class="is-right" title="${this.esc(B)}">${this.esc(B)}</th><th class="is-right">Var. R$</th><th class="is-right">Var. %</th></tr>`;
      const cols = porMes ? `<col style="width:340px">${MES.map(() => `<col style="width:115px"><col style="width:115px"><col style="width:100px">`).join("")}` : `<col><col style="width:160px"><col style="width:160px"><col style="width:150px"><col style="width:100px">`;
      const barra = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 8px"><div style="font-weight:800;color:#1c2e24">Visão DFC <span style="font-size:0.66rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-left:6px">comparativo</span></div>
        <div style="display:flex;gap:8px;align-items:center">${this.seg([["0", "Total"], ["1", "Por mês"]], porMes ? "1" : "0", `${N}.setDfc('dfcPorMes','$'==='1')`)}<button type="button" class="oxr-link" onclick="${N}.expandirDfc(true)">Expandir</button><button type="button" class="oxr-link" style="color:#6b8474" onclick="${N}.expandirDfc(false)">Recolher</button><button type="button" class="btn btn-excel" style="height:32px" onclick="${N}.excelDfc()">⬇ Excel completo</button></div></div>`;
      return topo + hero + barra + (M.linhas.length ? `<div class="cc-scroll" style="max-height:62vh"><table class="cc-table oxr-mat" style="${porMes ? `min-width:${340 + 12 * 330}px` : ""}"><colgroup>${cols}</colgroup><thead>${head}</thead><tbody>${corpo}</tbody></table></div>` : `<div class="oxr-vazio">Sem linhas na Visão DFC para estas versões.</div>`)
        + `<div style="font-size:0.7rem;color:#94a3b8;margin-top:6px">Grupos da Visão DFC padrão do Integra; planos fora da visão não entram. Entradas (receitas) positivas e saídas (despesas) negativas.${this.mesesOn ? " Totais só dos meses escolhidos." : ""}</div>`;
    },
    expandirDfc(on) { const c = this.cmp, M = c.dfcRes && this.montarDfcCmp(); c.dfcAbertos = {}; if (on && M) M.linhas.forEach((x) => { c.dfcAbertos[x.id] = true; }); this.render(); },
    excelDfc() {
      const c = this.cmp, M = this.montarDfcCmp();
      if (!M) return;
      const A = c.dfcRes.nomeA, B = c.dfcRes.nomeB, porMes = !!c.dfcPorMes, r = (v) => this.reais(v);
      const cab = ["Código", "Descrição", "Tipo", A, B, "Var. R$", "Var. %"];
      if (porMes) MES.forEach((m) => cab.push(`${m} ${A}`, `${m} ${B}`, `${m} Var`));
      const rows = [];
      const push = (x, tipo) => { const l = [x.codigo, x.nome, tipo, r(x.ta), r(x.tb), r(x.vr), x.vp == null ? "" : x.vp * 100]; if (porMes) TODOS_MESES.forEach((i) => l.push(r(x.a[i]), r(x.b[i]), r(x.mv[i]))); rows.push(l); };
      M.linhas.forEach((x) => { push(x, "Categoria"); x.planos.forEach((p) => push(p, "Plano")); });
      this.xlsx(cab, rows, `DFC_comparativo_${this.ano}.xlsx`);
    },
    abrirCmpAnalitica(view, busca, modo) { const c = this.cmp; c.visao = "analitica"; if (view) c.view = view; if (busca) c.busca = busca; if (modo) c.modo = modo; this.render(); },
    setBuscaCmp(v) { this.cmp.busca = v; this.render(); const i = document.getElementById("oxr-cmp-busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
    htmlCmpAnalitica(I, r, fmtE, corV) {
      const c = this.cmp, ms = I.ms, porMes = c.modo === "mes" && ms.length > 0, un = I.un;
      const minShare = c.mat === "alto" ? 0.05 : c.mat === "relevante" ? 0.01 : 0;
      const q = norm(c.busca.trim());
      const casa = (i) => (!minShare || (i.shareAbs || 0) >= minShare) && (!q || norm(`${i.cc} ${i.cc_nome}`).indexOf(q) >= 0 || norm(i.plano_rot).indexOf(q) >= 0);
      const desv = (l) => (c.desvio === "favoravel" ? l.filter((i) => i.favoravel && i.varRs !== 0) : c.desvio === "desfavoravel" ? l.filter((i) => !i.favoravel && i.varRs !== 0) : l);
      const allSh = I.all.map((i) => Object.assign(i, { shareAbs: i.absVarRs / I.totAbs }));
      const abas = [["todas", "Todas as linhas", I.counts.totalLinhas], ["destaques", "Destaques", Math.min(I.all.length, 10)], ["alteracoes", "Alterações", I.alt.length], ["inclusoes", "Inclusões", I.inc.length], ["exclusoes", "Exclusões", I.exc.length]].filter(([k, , n]) => k === "todas" || k === "destaques" || n > 0);
      const varCol = c.tipo === "VENDAS" && c.vMet === "unidades" ? "Variação (un.)" : "Variação R$";
      const mult = (it) => (c.tipo === "CONSOLIDADO" && it.redutora ? -1 : 1);
      const lado = (x) => (un ? x.n : x.m);
      const head = (o) => `<thead><tr>${o.rank ? `<th style="width:36px">#</th>` : ""}${o.tipo ? `<th>Tipo</th>` : ""}<th>Produto</th><th>Plano</th>${porMes ? ms.map((i) => `<th class="is-right">Δ ${MES[i]}</th>`).join("") : `<th class="is-right">${this.esc(r.nomeA)}</th><th class="is-right">${this.esc(r.nomeB)}</th>`}<th class="is-right">${porMes ? "Δ Total" : varCol}</th><th class="is-right">Var. %</th>${o.share ? `<th class="is-right">Peso</th>` : ""}</tr></thead>`;
      const cols = (o) => `<colgroup>${o.rank ? `<col style="width:36px">` : ""}${o.tipo ? `<col style="width:96px">` : ""}<col style="width:250px"><col style="width:220px">${porMes ? ms.map(() => `<col style="width:92px">`).join("") : `<col style="width:130px"><col style="width:130px">`}<col style="width:120px"><col style="width:90px">${o.share ? `<col style="width:110px">` : ""}</colgroup>`;
      const linha = (i, o, k) => `<tr>${o.rank ? `<td style="color:#94a3b8;font-weight:700">${k + 1}</td>` : ""}${o.tipo ? `<td><span style="font-size:0.62rem;font-weight:700;text-transform:uppercase;background:#eef3f0;color:#4a6355;padding:1px 6px;border-radius:4px">${i.cat || "—"}</span></td>` : ""}
        <td title="${this.esc(i.cc + " " + i.cc_nome)}" style="font-weight:600">${this.esc(i.cc + " " + i.cc_nome)}</td><td title="${this.esc(i.plano_rot)}" style="color:#4a6355">${this.esc(i.plano_rot)}${c.tipo === "VENDAS" && i.is_distrato && c.vCat === "todos" ? ` <span style="font-size:0.6rem;background:#fef2f2;color:#b91c1c;padding:0 5px;border-radius:4px;font-weight:700">DISTRATO</span>` : ""}${i.multiplier === -1 ? ` <span style="font-size:0.6rem;background:#eef3f0;color:#4a6355;padding:0 5px;border-radius:4px;font-weight:700">SAÍDA</span>` : ""}</td>
        ${porMes ? ms.map((m) => { const v = (lado(i.b)[m] - lado(i.a)[m]) * mult(i); return `<td class="is-right" style="color:${corV(v)}">${this.sinal(v)}${fmtE(v)}</td>`; }).join("") : `<td class="is-right" style="color:#4a6355">${fmtE(i.valA)}</td><td class="is-right" style="font-weight:600">${fmtE(i.valB)}</td>`}
        <td class="is-right" style="font-weight:700;color:${corV(i.varRs)}">${this.sinal(i.varRs)}${fmtE(i.varRs)}</td><td class="is-right">${this.badge(i.varPerc, !positivoBom(c.tipo))}</td>
        ${o.share ? `<td><div style="display:flex;align-items:center;gap:6px;justify-content:flex-end"><div class="oxr-bar" style="width:60px;height:5px"><div style="width:${Math.min(100, (i.shareAbs || 0) * 100)}%;background:${i.favoravel ? "#10b981" : "#ef4444"}"></div></div><span style="font-size:0.66rem;font-weight:700;color:#6b8474">${Math.round((i.shareAbs || 0) * 100)}%</span></div></td>` : ""}</tr>`;
      const tabela = (l, o, vazio) => (l.length ? `<div class="cc-scroll" style="max-height:60vh"><table class="cc-table oxr-mat" style="min-width:${(o.rank ? 36 : 0) + (o.tipo ? 96 : 0) + 470 + (porMes ? ms.length * 92 : 260) + 210 + (o.share ? 110 : 0)}px">${cols(o)}${head(o)}<tbody>${l.map((i, k) => linha(i, o, k)).join("")}</tbody></table></div>` : `<div class="oxr-vazio" style="padding:24px">${vazio}</div>`);
      const secao = (titulo, l, lado2, nomeV) => (l.length ? `<div style="font-size:0.8rem;font-weight:700;color:#1c2e24;margin:2px 0">${titulo}</div><div style="font-size:0.7rem;color:#6b8474;margin-bottom:6px">${l.length} ${l.length === 1 ? "linha" : "linhas"} · ${this.esc(nomeV)}</div><div class="cc-scroll" style="max-height:58vh"><table class="cc-table"><colgroup><col><col><col style="width:150px"></colgroup><thead><tr><th>Produto</th><th>Plano</th><th class="is-right">Valor</th></tr></thead><tbody>${l.map((i) => `<tr><td title="${this.esc(i.cc + " " + i.cc_nome)}">${this.esc(i.cc + " " + i.cc_nome)}</td><td title="${this.esc(i.plano_rot)}">${this.esc(i.plano_rot)}</td><td class="is-right" style="font-weight:700">${fmtE(soma(lado(i[lado2]), ms))}</td></tr>`).join("")}</tbody></table></div>` : "");
      let corpo = "";
      if (c.view === "todas") corpo = tabela(desv(I.todas).filter(casa), { tipo: true }, "Nenhuma linha neste filtro.");
      else if (c.view === "destaques") corpo = tabela(desv(allSh).filter(casa).slice(0, 10), { rank: true, share: true }, "Nenhum desvio neste filtro.");
      else if (c.view === "alteracoes") corpo = tabela(desv(I.alt).filter(casa), {}, I.counts.semMudanca > 0 ? `${I.counts.semMudanca} linha(s) idênticas entre as versões (sem variação).` : "Nenhuma alteração com desvio.");
      else if (c.view === "inclusoes") corpo = secao("Itens incluídos na versão comparada", I.inc.filter(casa), "b", r.nomeB);
      else if (c.view === "exclusoes") corpo = secao("Itens presentes só na versão base", I.exc.filter(casa), "a", r.nomeA);
      const barra = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid #dfe9e3;border-radius:10px 10px 0 0;background:#f7faf8;border-bottom:none">
          <div style="display:flex;gap:4px;flex-wrap:wrap">${abas.map(([k, l, n]) => `<button type="button" class="oxr-chip ${c.view === k ? "on" : ""}" style="text-transform:none;font-size:0.76rem" onclick="${N}.setCmp('view','${k}')">${l}${n > 0 ? ` <span style="color:#94a3b8">(${n})</span>` : ""}</button>`).join("")}</div>
          <span style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><input id="oxr-cmp-busca" class="idx-select" style="height:30px;width:210px;font-size:0.76rem" placeholder="Buscar produto ou plano…" value="${this.esc(c.busca)}" oninput="${N}.setBuscaCmp(this.value)">
            <select class="idx-select" style="height:30px;font-size:0.76rem" onchange="${N}.setCmp('mat',this.value)">${[["todos", "Toda materialidade"], ["relevante", "Peso ≥ 1%"], ["alto", "Peso ≥ 5%"]].map(([k, l]) => `<option value="${k}" ${c.mat === k ? "selected" : ""}>${l}</option>`).join("")}</select>
            ${this.seg([["total", "Total"], ["mes", "Por mês"]], c.modo, `${N}.setCmp('modo','$')`)}
            ${(c.view === "todas" || c.view === "destaques" || c.view === "alteracoes") && I.counts.comDesvio > 0 ? this.chips([["todos", "Todos"], ["favoravel", "Favorável"], ["desfavoravel", "Desfavorável"]], c.desvio, `${N}.setCmp('desvio','$')`) : ""}
            <span style="display:flex;flex-direction:column;align-items:flex-end"><button type="button" class="btn btn-excel" style="height:30px;font-size:0.76rem" title="Exporta as ${I.counts.totalLinhas} linhas do comparativo (completo), não só a aba atual" onclick="${N}.excelCmp()">⬇ Excel completo</button><span style="font-size:0.62rem;color:#6b8474">Exporta todas as ${I.counts.totalLinhas} linhas — não só o que está na aba</span></span></span></div>`;
      return barra + `<div style="border:1px solid #dfe9e3;border-top:none;border-radius:0 0 10px 10px;padding:8px;background:#fff">${corpo}</div>`;
    },
    excelCmp() {
      const c = this.cmp, fr = this.cmpFiltrado();
      if (!fr) return;
      const I = this.cmpInsights(fr), ms = I.ms, un = I.un, varCol = c.tipo === "VENDAS" && c.vMet === "unidades" ? "Variação (un.)" : "Variação R$";
      const conv = (v) => (un ? v : this.reais(v));
      const mult = (it) => (c.tipo === "CONSOLIDADO" && it.redutora ? -1 : 1), lado = (x) => (un ? x.n : x.m);
      if (c.modo === "mes") {
        const rows = I.todas.map((i) => [i.cat || "", `${i.cc} ${i.cc_nome}`, i.plano_rot].concat(ms.map((m) => conv((lado(i.b)[m] - lado(i.a)[m]) * mult(i))), [conv(i.varRs), i.varPerc, i.shareAbs, i.favoravel ? "Sim" : "Não"]));
        return this.xlsx(["Tipo", "Produto", "Plano"].concat(ms.map((m) => "Var " + MES[m]), [varCol, "Var. %", "Peso %", "Favorável"]), rows, `comparativo_${c.tipo}_${this.ano}_completo_por_mes.xlsx`);
      }
      const rows = I.todas.map((i) => [i.cat || "", `${i.cc} ${i.cc_nome}`, i.plano_rot, conv(i.valA), conv(i.valB), conv(i.varRs), i.varPerc, i.shareAbs, i.favoravel ? "Sim" : "Não"]);
      this.xlsx(["Tipo", "Produto", "Plano", c.res.nomeA, c.res.nomeB, varCol, "Var. %", "Peso %", "Favorável"], rows, `comparativo_${c.tipo}_${this.ano}_completo.xlsx`);
    },

    /* ================= Visualização ================= */
    async carregarVis() {
      const v = this.vis, vs = this.versoesCmp(v.tipo);
      if (!vs.length) { v.dados = { linhas: [], vazia: true }; v.chave = ""; return this.render(); }
      if (!vs.some((x) => x.id === v.versao)) v.versao = vs[0].id;
      const chave = `${this.ano}|${this.diretoria}|${this.dept}|${v.tipo}|${v.versao}`;
      if (v.chave === chave && v.dados) return;
      v.carregando = true; v.chave = chave; this.render();
      try {
        const mapa = await this.linhasVersao(vs.find((x) => x.id === v.versao), v.tipo);
        if (v.chave === chave) v.dados = { linhas: [...mapa.values()] };
      } catch (e) { this.erro = e.message || String(e); v.dados = { linhas: [] }; }
      v.carregando = false;
      this.render();
    },
    setVis(campo, val) { const v = this.vis; v[campo] = val; if (campo === "tipo") { v.versao = ""; v.dados = null; v.chave = ""; } if (campo === "versao") { v.dados = null; v.chave = ""; } this.render(); },
    htmlVisualizacao() {
      const v = this.vis;
      if (!this.cabs.orcamento) return `<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner" style="margin:0 auto 15px;"></div>Carregando…</div>`;
      const vs = this.versoesCmp(v.tipo);
      if (!v.dados && !v.carregando) { setTimeout(() => this.carregarVis(), 0); }
      const ms = this.ms(), ehV = v.tipo === "VENDAS", unid = ehV && v.vMet === "unidades";
      const fmt = (x) => (unid ? this.un(x) : this.rs(x));
      const linhas = ((v.dados && v.dados.linhas) || []).filter((l) => this.passa(l.cc, l.cc_nome, l.plano_rot));
      const valor = (l, cat) => { const base = unid ? l.n : l.m; return base.map((x) => (cat === "distratos" ? Math.abs(x) : x)); };
      const grupos = (itens, cat) => {
        const g = new Map();
        itens.forEach((l) => { if (!g.has(l.cc)) g.set(l.cc, { cc: l.cc, nome: `${l.cc} ${l.cc_nome || this.nomeCc(l.cc)}`, itens: [] }); g.get(l.cc).itens.push({ rot: l.plano_rot, m: cat === "liquido" ? l.m : valor(l, cat) }); });
        return [...g.values()].map((x) => Object.assign(x, { itens: x.itens.sort((a, b) => String(a.rot).localeCompare(String(b.rot), "pt-BR", { numeric: true })) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      };
      const tom = (val, forte, tone) => (tone === "distrato" ? "color:#b91c1c;" : tone === "liquido" && val < 0 ? "color:#b91c1c;" : forte ? "color:#1c2e24;" : "color:#4a6355;");
      const corpoGrupos = (gs, prefixo, tone, corGrupo) => {
        if (!gs.length) return `<tr><td colspan="${3 + ms.length}" style="text-align:center;padding:24px;color:#94a3b8">Nenhum registro neste bloco.</td></tr>`;
        let h = "";
        const totM = zeros();
        gs.forEach((g) => {
          const k = prefixo + g.cc, ab = v.exp[k] !== false;
          const sm = zeros(); g.itens.forEach((it) => it.m.forEach((x, i) => { sm[i] += x; }));
          sm.forEach((x, i) => { totM[i] += x; });
          const st = soma(sm, ms);
          h += `<tr class="oxr-g" style="${corGrupo ? `--g:${corGrupo}` : ""}" onclick="${N}.vis.exp['${k}']=${ab ? "false" : "true"};${N}.render()"><td class="oxr-sticky" style="white-space:normal">${ab ? "▾" : "▸"} ${this.esc(g.nome)}</td><td style="font-size:0.64rem;text-transform:uppercase">Subtotal · ${g.itens.length} ${g.itens.length === 1 ? "plano" : "planos"}</td>${ms.map((i) => `<td class="is-right" style="${tom(sm[i], true, tone)}">${fmt(sm[i])}</td>`).join("")}<td class="is-right" style="border-left:1px solid #9fcdb4;${tom(st, true, tone)}">${fmt(st)}</td></tr>`;
          if (ab) g.itens.forEach((it) => { const t = soma(it.m, ms); h += `<tr><td class="oxr-sticky"></td><td style="padding-left:16px;border-left:2px solid #dfe9e3" title="${this.esc(it.rot)}">${this.esc(it.rot)}</td>${ms.map((i) => `<td class="is-right" style="${tom(it.m[i], false, tone)}">${fmt(it.m[i])}</td>`).join("")}<td class="is-right" style="font-weight:700;border-left:1px solid #e2e8f0;${tom(t, true, tone)}">${fmt(t)}</td></tr>`; });
        });
        if (gs.length > 1) h += `<tr class="oxr-tot"><td class="oxr-sticky">Total do bloco</td><td style="font-weight:500">${gs.length} produtos</td>${ms.map((i) => `<td class="is-right">${fmt(totM[i])}</td>`).join("")}<td class="is-right">${fmt(soma(totM, ms))}</td></tr>`;
        return h;
      };
      const tabela = (corpo) => `<div class="cc-scroll" style="max-height:${ehV ? "48vh" : "66vh"}"><table class="cc-table oxr-mat" style="min-width:${470 + (ms.length + 1) * 100}px"><colgroup><col style="width:260px"><col style="width:210px">${ms.map(() => `<col style="width:100px">`).join("")}<col style="width:110px"></colgroup><thead><tr><th class="oxr-sticky">Produto</th><th>Plano</th>${ms.map((i) => `<th class="is-right">${MES[i]}</th>`).join("")}<th class="is-right">Total</th></tr></thead><tbody>${corpo}</tbody></table></div>`;
      let conteudo, nProd = 0, nLin = 0, tem = false;
      if (v.carregando || !v.dados) conteudo = `<div style="text-align:center;padding:30px;color:#64748b"><div class="spinner" style="margin:0 auto 15px;"></div>Carregando…</div>`;
      else if (ehV) {
        const vend = linhas.filter((l) => !l.is_distrato), dist = linhas.filter((l) => l.is_distrato);
        const liqMap = new Map();
        const somaLiq = (l, s) => { const k = l.cc + "|" + l.plano_rot; if (!liqMap.has(k)) liqMap.set(k, { cc: l.cc, cc_nome: l.cc_nome, plano_rot: l.plano_rot, m: zeros(), n: zeros() }); const e = liqMap.get(k), base = unid ? l.n : l.m; base.forEach((x, i) => { e.m[i] += s * (l.is_distrato ? Math.abs(x) : x); }); };
        vend.forEach((l) => somaLiq(l, 1)); dist.forEach((l) => somaLiq(l, -1));
        const gV = grupos(vend, "vendas"), gD = grupos(dist, "distratos"), gL = grupos([...liqMap.values()], "liquido");
        tem = gV.length > 0 || gD.length > 0;
        nProd = new Set(gV.concat(gD, gL).map((g) => g.cc)).size; nLin = vend.length + dist.length + liqMap.size;
        const BL = [["Vendas", gV, "vendas", "#10b981", "#ecfdf5", ""], ["Distratos", gD, "distratos", "#f87171", "#fef2f2", "distrato"], ["VGV líquido", gL, "liquido", "#f59e0b", "#fffbeb", "liquido"]];
        conteudo = !tem ? `<div class="oxr-vazio">Nenhum dado encontrado para os filtros selecionados.</div>` : BL.map(([l, gs, k, cor, bg, tone]) => `<div style="border:1px solid #dfe9e3;border-radius:10px;overflow:hidden;margin-bottom:14px"><div style="padding:8px 14px;background:${bg};border-bottom:1px solid #dfe9e3;font-size:0.84rem;font-weight:700;color:#1c2e24"><span style="color:${cor}">●</span> ${l} <span style="font-size:0.74rem;font-weight:500;color:#6b8474">${unid ? "Nº de lotes" : "VGV"}${k === "liquido" ? " (vendas − distratos)" : ""}</span></div>${tabela(corpoGrupos(gs, k + "-", tone))}</div>`).join("");
      } else {
        const gs = grupos(linhas, "valor");
        tem = gs.length > 0; nProd = gs.length; nLin = linhas.length;
        conteudo = !tem ? `<div class="oxr-vazio">Nenhum dado encontrado para os filtros selecionados.</div>` : tabela(corpoGrupos(gs, "", ""));
      }
      const barra = `<div class="oxr-barra" style="margin-bottom:10px;align-items:center"><select class="idx-select" style="height:40px" onchange="${N}.setVis('tipo',this.value)">${[["DESPESAS", "Despesas"], ["RECEITAS", "Receitas"], ["VENDAS", "Vendas"]].map(([k, l]) => `<option value="${k}" ${v.tipo === k ? "selected" : ""}>${l}</option>`).join("")}</select>
          ${vs.length ? `<select class="idx-select" style="height:40px;min-width:200px" onchange="${N}.setVis('versao',this.value)">${vs.map((x) => `<option value="${this.esc(x.id)}" ${x.id === v.versao ? "selected" : ""}>${this.esc(x.descricao)}</option>`).join("")}</select>` : ""}
          ${ehV ? this.seg([["vgv", "VGV"], ["unidades", "Nº lotes"]], v.vMet, `${N}.setVis('vMet','$')`) : ""}
          ${tem ? `<span style="font-size:0.78rem;color:#6b8474">${nProd} produto${nProd !== 1 ? "s" : ""} · ${nLin} linha${nLin !== 1 ? "s" : ""}${ehV ? " · Vendas, distratos e líquido" : ""}</span>` : ""}
          <button type="button" class="btn btn-excel" style="margin-left:auto" onclick="${N}.excelVis()">⬇ Excel</button></div>`;
      return barra + conteudo;
    },
    excelVis() {
      const v = this.vis, ms = this.ms(), unid = v.tipo === "VENDAS" && v.vMet === "unidades";
      const linhas = ((v.dados && v.dados.linhas) || []).filter((l) => this.passa(l.cc, l.cc_nome, l.plano_rot));
      const conv = (x) => (unid ? x : this.reais(x));
      const linha = (l, arr) => [`${l.cc} ${l.cc_nome}`, l.plano_rot].concat(ms.map((i) => conv(arr[i])), [conv(soma(arr, ms))]);
      const cab = ["Produto", "Plano"].concat(ms.map((i) => MES[i]), ["Total"]);
      if (v.tipo !== "VENDAS") return this.xlsx(cab, linhas.map((l) => linha(l, l.m)), `visualizacao_${v.tipo}_${this.ano}.xlsx`);
      const rows = [], base = (l) => (unid ? l.n : l.m);
      const bloco = (rot, ls, fn) => { if (!ls.length) return; rows.push([rot, ""].concat(ms.map(() => ""), [""])); ls.forEach((l) => rows.push(linha(l, fn(l)))); };
      const vend = linhas.filter((l) => !l.is_distrato), dist = linhas.filter((l) => l.is_distrato);
      bloco("VENDAS", vend, base); bloco("DISTRATOS", dist, (l) => base(l).map(Math.abs));
      const liq = new Map();
      vend.concat(dist).forEach((l) => { const k = l.cc + "|" + l.plano_rot; if (!liq.has(k)) liq.set(k, Object.assign({}, l, { m: zeros(), n: zeros() })); const e = liq.get(k), s = l.is_distrato ? -1 : 1; base(l).forEach((x, i) => { (unid ? e.n : e.m)[i] += s * (l.is_distrato ? Math.abs(x) : x); }); });
      bloco("VGV LIQUIDO", [...liq.values()], base);
      this.xlsx(cab, rows, `visualizacao_VENDAS_${unid ? "N_lotes" : "VGV"}_${this.ano}.xlsx`);
    },

    /* ================= tela ================= */
    render() {
      const root = this.root();
      if (!root) return;
      if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
      this.estilos();
      const anos = this.anos();
      if (!anos.length) anos.push(Number(this.ano));
      const deps = ((this.cadDep || {}).departamentos || []);
      const dirs = [...new Set(deps.map((d) => d.diretoria).filter(Boolean))].sort();
      const depts = new Map();
      (this.cabs.orcamento || []).concat(this.cabs.forecast || []).filter((c) => String(c.ano) === String(this.ano) && c.departamento && (this.diretoria === "TODAS" || this.dirDe(c.departamento.id) === this.diretoria)).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
      const topo = `<h2 class="oxr-tit">Orçado × Realizado</h2>
        <div class="oxr-card"><div class="oxr-barra">
          ${dirs.length ? `<div><label class="ml-emp-filter-label">Diretoria</label><select class="idx-select" style="height:40px;min-width:160px" onchange="${N}.setDiretoria(this.value)"><option value="TODAS">Todas</option>${dirs.map((d) => `<option ${d === this.diretoria ? "selected" : ""}>${this.esc(d)}</option>`).join("")}</select></div>` : ""}
          <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:220px" onchange="${N}.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
          <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px;min-width:100px" onchange="${N}.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
          <button type="button" class="btn btn-primary" style="margin-left:auto" ${this.carregando || !this.cabs.orcamento ? "disabled" : ""} onclick="${N}.calcular()">${this.carregando ? "Calculando..." : "Calcular"}</button></div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid #eef3f0"><span class="oxr-lbl">📅 Meses</span>${this.aba === "comparativo" ? `<span style="font-size:0.66rem;color:#94a3b8">· recalcula KPIs</span>` : ""}<button type="button" class="oxr-sw ${this.mesesOn ? "on" : ""}" title="Ativar filtro de meses" onclick="${N}.alternarMeses()"></button>
            ${MES.map((m, i) => `<button type="button" class="oxr-mes ${this.mesesOn && this.mesesSel.indexOf(i) >= 0 ? "on" : ""}" ${this.mesesOn ? "" : "disabled"} onclick="${N}.alternarMes(${i})">${m}</button>`).join("")}</div>
        </div>${this.htmlFiltros()}`;
      const abas = [["consolidado", "Consolidado", "bar-chart-2"], ["despesas", "Despesas", "trending-down"], ["receitas", "Receitas", "trending-up"], ["vendas", "Vendas", "dollar-sign"], ["comparativo", "Comparativo de Versões", "git-compare"], ["visualizacao", "Visualização", "eye"]];
      let corpo = "";
      try {
        corpo = { consolidado: () => this.htmlConsolidado(), despesas: () => this.htmlDR("despesas"), receitas: () => this.htmlDR("receitas"), vendas: () => this.htmlVendas(), comparativo: () => this.htmlComparativo(), visualizacao: () => this.htmlVisualizacao() }[this.aba]();
      } catch (e) { corpo = `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px">Erro ao montar a aba: ${this.esc(e.message || e)}</div>`; console.error(e); }
      const carregandoTopo = this.carregando && this.calc ? `<div style="padding:8px 12px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;margin-bottom:10px;font-size:0.8rem">⟳ ${this.esc(this.passo || "Atualizando…")}</div>` : "";
      root.innerHTML = topo
        + (this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : "")
        + `<div class="oxr-card"><div class="oxr-abas">${abas.map(([k, t, ic]) => `<button type="button" class="oxr-aba ${this.aba === k ? "on" : ""}" onclick="${N}.setAba('${k}')"><i data-lucide="${ic}"></i>${t}</button>`).join("")}</div>${carregandoTopo}${corpo}</div>`;
      this.ligarFiltros();
      if (window.lucide) window.lucide.createIcons();
    }
  };
  window.OrionOxRApp = App;
})();
