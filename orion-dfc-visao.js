/* Órion (transição) › DFC — a tela DFC do ML Órion (Orçamento › DFC, modo Demonstrativo) com a identidade do Integra.
 * Topo: Diretoria, Departamento, ID da empresa, Empresa, Meses, Ano e Calcular; "Comparar versões" abre o DFC comparativo
 * (Orçado × Realizado › Comparativo de Versões › Visão DFC).
 * Cartões: Entradas, Saídas, Líquido e Geração de caixa (ano × LY e variação, com o semáforo do Órion).
 * Tabela: árvore da Visão DFC padrão do Integra (Configurações gerais › Plano Financeiro e Visões), grupos com os planos dentro;
 * por mês as séries Realizado (sempre), LY (realizado do ano anterior), Orçado e Forecast (com a versão), AH/AV mensal opcional;
 * Total do ano, AH % (realizado × LY) e AV % (sobre as entradas realizadas). Entradas positivas e saídas negativas.
 * Dados do Integra, mesma origem do Orçado × Realizado: orçado e forecast dos documentos (orion_orcamentos / orion_forecasts,
 * inclusive o Orçamento do Integra), realizado pela regra do Integra (caixa e bancos, orion-realizado.js) só dos centros de
 * custo e planos que estão no orçamento ou no forecast. Geração de caixa: realizado até o último mês fechado (YTD) + orçado
 * dos meses seguintes (YTG); sem o saldo de abertura de 31/12. Só leitura. */
(function () {
  const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const N = "OrionDfcVisaoApp";
  const zeros = () => new Array(12).fill(0);
  const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
  const SER = [["real", "Realizado", "Real"], ["n1", "LY", "LY"], ["orc", "Orçado", "Orç"], ["fc", "Forecast", "FCST"]];

  const App = {
    ano: String(new Date().getFullYear()), diretoria: "TODAS", dept: "TODOS",
    empIds: [], fOpen: null, fQ: {}, meses: [],
    cabs: { orcamento: null, forecast: null }, cadDep: null, fechamento: [], docCache: {}, fcLinhas: {},
    calc: null, carregando: false, passo: "", erro: "",
    series: { n1: true, orc: true, fc: false }, versaoFc: "", ahavMensal: false, abertos: {},

    C() { return window.OrionOrcamentoCalc; },
    R() { return window.OrionRealizado; },
    fc() { return window.firebaseCollections; },
    root() { return document.getElementById("orion-dfcv-root"); },
    esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
    rs(c) { const v = Number(c) || 0; if (!v) return "R$ 0"; return (v < 0 ? "-" : "") + "R$ " + this.C().fmtReais(Math.abs(v), true); },
    num(c) { const v = Number(c) || 0; return `<span style="color:${v < 0 ? "#dc2626" : v > 0 ? "#1c2e24" : "#94a3b8"}">${this.rs(v)}</span>`; },
    per(x) { return x == null ? `<span style="color:#cbd5e1">—</span>` : `<span style="color:${x < 0 ? "#dc2626" : "#334155"}">${((x * 100).toFixed(1)).replace(".", ",")}%</span>`; },
    ms() { return this.meses.length ? this.meses.slice().sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; },

    init() {
      this.estilos();
      if (!this.cabs.orcamento && !this._lendo) this.carregarBase();
      this.render();
    },
    estilos() {
      if (document.getElementById("odv-estilos")) return;
      const st = document.createElement("style");
      st.id = "odv-estilos";
      st.textContent = `
        #orion-dfcv-root .odv-card { background:#fff; border:1px solid rgba(16,84,54,.08); border-radius:var(--border-radius-md); box-shadow:var(--shadow-sm); padding:12px 16px; margin-bottom:12px; }
        #orion-dfcv-root .odv-barra { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
        #orion-dfcv-root .odv-barra .btn { height:40px; }
        #orion-dfcv-root .odv-barra .ml-emp-filter { min-width:170px; }
        #orion-dfcv-root .odv-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:6px; }
        @media (max-width:1200px) { #orion-dfcv-root .odv-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        #orion-dfcv-root .odv-kpi { background:#fff; border:1px solid #dfe9e3; border-radius:10px; padding:10px 14px; }
        #orion-dfcv-root .odv-kpi .t { display:flex; justify-content:space-between; font-size:0.68rem; font-weight:800; color:#6b8474; text-transform:uppercase; letter-spacing:.05em; }
        #orion-dfcv-root .odv-kpi .l { font-size:0.64rem; color:#94a3b8; margin-bottom:6px; }
        #orion-dfcv-root .odv-kpi .r { display:flex; justify-content:space-between; align-items:baseline; font-variant-numeric:tabular-nums; padding:1px 0; }
        #orion-dfcv-root .odv-kpi .r span:first-child { font-size:0.64rem; color:#94a3b8; text-transform:uppercase; }
        #orion-dfcv-root .odv-seg { display:inline-flex; border:1px solid #cfe0d6; border-radius:8px; overflow:hidden; }
        #orion-dfcv-root .odv-seg button { border:none; background:#fff; color:#4a6355; padding:0 14px; height:32px; font-size:0.78rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
        #orion-dfcv-root .odv-seg button.on { background:var(--color-primary); color:#fff; }
        #orion-dfcv-root .odv-chip { border:1px solid #cfe0d6; background:#fff; color:#4a6355; height:28px; padding:0 10px; border-radius:7px; font-size:0.72rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
        #orion-dfcv-root .odv-chip.on { background:var(--color-primary); border-color:var(--color-primary); color:#fff; }
        #orion-dfcv-root .odv-link { background:none; border:none; color:var(--color-primary); font-weight:700; font-size:0.76rem; cursor:pointer; padding:0; font-family:var(--font-family); }
        #orion-dfcv-root .cc-table.odv-tab td, #orion-dfcv-root .cc-table.odv-tab th { white-space:nowrap; font-variant-numeric:tabular-nums; }
        #orion-dfcv-root .cc-table.odv-tab td.odv-nome, #orion-dfcv-root .cc-table.odv-tab th.odv-nome { position:sticky; left:0; z-index:2; white-space:normal; }
        #orion-dfcv-root .cc-table.odv-tab th.odv-nome { z-index:4; }
        #orion-dfcv-root .cc-table.odv-tab tbody tr.odv-cat td { background:#fff; }
        #orion-dfcv-root .cc-table.odv-tab tbody tr.odv-pl td { background:#f8faf9; color:#4a6355; }
        #orion-dfcv-root .cc-table.odv-tab td.odv-ini, #orion-dfcv-root .cc-table.odv-tab th.odv-ini { border-left:1px solid #dfe9e3; }
        #orion-dfcv-root .cc-table.odv-tab td.odv-tot { background:#f7faf8 !important; font-weight:700; }
        #orion-dfcv-root .odv-cod { font-family:monospace; color:#94a3b8; margin-right:6px; }
      `;
      document.head.appendChild(st);
    },

    /* ---------- leitura ---------- */
    async carregarBase() {
      const fc = this.fc();
      if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
      this._lendo = true;
      try {
        const ler = async (col) => { const snap = await fc.getDocs(fc.collection(window.firebaseDb, col)); const l = []; snap.forEach((d) => l.push(d.data())); return l; };
        const [o, f, dep, fech] = await Promise.all([ler("orion_orcamentos"), ler("orion_forecasts"),
          window.OrionStore ? window.OrionStore.ler("departamentos", null).catch(() => ({})) : {}, window.OrionStore ? window.OrionStore.ler("fechamento_meses", []).catch(() => ({})) : {}]);
        this.cabs = { orcamento: o, forecast: f };
        this.cadDep = (dep && dep.itens) || null;
        this.fechamento = (fech && fech.itens) || [];
      } catch (e) { this.erro = e.message || String(e); }
      this._lendo = false;
      this.render();
    },
    anos() { return [...new Set((this.cabs.orcamento || []).concat(this.cabs.forecast || []).map((c) => Number(c.ano)).filter(Boolean))].sort((a, b) => a - b); },
    dirDe(id) { const d = ((this.cadDep || {}).departamentos || []).find((x) => String(x.id) === String(id)); return d ? String(d.diretoria || "") : ""; },
    escopo(base) {
      return (this.cabs[base] || []).filter((c) => {
        if (String(c.ano) !== String(this.ano)) return false;
        const dep = c.departamento ? String(c.departamento.id) : "";
        if (this.dept !== "TODOS") return dep === String(this.dept);
        return this.diretoria === "TODAS" || this.dirDe(dep) === this.diretoria;
      });
    },
    versoesFc() { return this.C().versoesForecast(this.escopo("forecast"), this.ano, ["DESPESAS", "RECEITAS"]).map((v) => v.descricao); },
    versaoAtual() { const vs = this.versoesFc(); return this.versaoFc && vs.indexOf(this.versaoFc) >= 0 ? this.versaoFc : vs[0] || ""; },
    async lerDocs(base, docs) {
      const fc = this.fc(), col = base === "orcamento" ? "orion_orcamento_itens" : "orion_forecast_itens", out = [];
      for (const cab of docs) {
        const k = base + ":" + cab._id;
        if (!this.docCache[k]) {
          const blocos = [];
          for (let b = 0; b < (cab.blocos || 1); b++) { const s = await fc.getDoc(fc.doc(window.firebaseDb, col, `${cab._id}_${b}`)); if (s.exists()) blocos.push(s.data()); }
          this.docCache[k] = this.C().juntarBlocos(blocos).itens || [];
        }
        const sinal = String(cab.tipo).toUpperCase() === "RECEITAS" ? 1 : -1;
        this.docCache[k].forEach((l) => out.push(Object.assign({}, l, { cc: dig(l.cc), plano: dig(l.plano), sinal })));
      }
      return out;
    },
    async garantirFc(versao) {
      if (!versao || this.fcLinhas[versao]) return;
      const docs = this.C().documentosVigentes(this.escopo("forecast"), { ano: this.ano, dept: "TODOS", base: "forecast", versao, tipos: ["DESPESAS", "RECEITAS"] }).docs.filter((c) => String(c.descricao || "") === versao);
      this.fcLinhas[versao] = await this.lerDocs("forecast", docs);
    },
    ateMes(ano) { const h = new Date(), a = Number(ano); return a < h.getFullYear() ? 12 : a > h.getFullYear() ? 0 : h.getMonth() + 1; },

    async calcular() {
      const C = this.C(), R = this.R();
      if (!this.cabs.orcamento) return;
      this.carregando = true; this.erro = ""; this.passo = "Lendo orçamentos e forecasts…"; this.render();
      try {
        if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
        const docs = C.documentosVigentes(this.escopo("orcamento"), { ano: this.ano, dept: "TODOS", base: "orcamento", tipos: ["DESPESAS", "RECEITAS"] }).docs;
        const orc = await this.lerDocs("orcamento", docs);
        this.fcLinhas = {};
        await this.garantirFc(this.versaoAtual());
        const linhasTodas = orc.concat(...Object.values(this.fcLinhas));
        if (!linhasTodas.length) throw new Error(`Nenhum orçamento ou forecast de despesas e receitas de ${this.ano} no Integra para este filtro.`);
        const ccs = [...new Set(linhasTodas.map((l) => l.cc))];
        const empresas = R.empresasDosCcs(ccs);
        let real = { alocacoes: [], movimentos: 0 }, realN1 = { alocacoes: [], movimentos: 0 };
        if (empresas.length) {
          const ate = this.ateMes(this.ano);
          if (ate >= 1) { this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`; this.render(); real = await R.buscar(Number(this.ano), ate, empresas); }
          this.passo = `Lendo o realizado de ${Number(this.ano) - 1}…`; this.render();
          realN1 = await R.buscar(Number(this.ano) - 1, 12, empresas);
        }
        this.calc = { orc, real, realN1, empresas, docs: docs.length };
        this.abertos = {};
      } catch (e) { this.erro = e.message || String(e); }
      this.carregando = false; this.passo = "";
      this.render();
    },

    /* ---------- filtros ---------- */
    empresaDe(cc) {
      const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
      const c = l.find((x) => dig(x.id) === dig(cc));
      return c ? String(c.idCompany != null ? c.idCompany : c.companyId || "") : "";
    },
    nomeEmpresa(id) { const c = ((window.AppState && AppState.companies) || []).find((x) => String(x.id) === String(id)); return c ? String(c.name || c.nome || c.tradeName || "") : ""; },
    empOk(id) { return !this.empIds.length || this.empIds.indexOf(String(id)) >= 0; },

    /* ---------- árvore (regra do Órion: montar_dfc) ---------- */
    montar() {
      const R = this.R(), d = this.calc, ms = this.ms();
      const grupos = ((R && R.grupos()) || []).filter((g) => g && g.id && g.type !== "formula");
      if (!grupos.length) return null;
      const porId = {}; grupos.forEach((g) => { porId[g.id] = g; });
      const fcl = this.series.fc ? this.fcLinhas[this.versaoAtual()] || [] : [];
      const todas = d.orc.concat(this.fcLinhas[this.versaoAtual()] || []);
      const ccs = new Set(todas.map((l) => l.cc)), planosSet = new Set(todas.map((l) => l.plano));
      const planos = new Map(), nomes = {};
      todas.forEach((l) => { if (l.plano_nome) nomes[l.plano] = l.plano_nome; });
      const pega = (gid, plano) => {
        const k = gid + "|" + plano;
        if (!planos.has(k)) planos.set(k, { gid, codigo: plano, nome: nomes[plano] || "", entrada: String(plano).charAt(0) === "1", real: zeros(), n1: zeros(), orc: zeros(), fc: zeros() });
        return planos.get(k);
      };
      const linhas = (lista, serie) => lista.forEach((l) => {
        if (!this.empOk(this.empresaDe(l.cc))) return;
        const gid = R.grupoDe(l.plano);
        if (!gid || !porId[gid]) return;
        const x = pega(gid, l.plano);
        (l.m || []).forEach((v, i) => { x[serie][i] += (Number(v) || 0) * l.sinal; });
      });
      linhas(d.orc, "orc"); linhas(fcl, "fc");
      const real = (res, serie) => (res.alocacoes || []).forEach((a) => {
        const cc = String(a.cc || ""), pl = String(a.plano || ""), mes = Number(a.mes);
        if (!ccs.has(cc) || !planosSet.has(pl) || !(mes >= 1 && mes <= 12)) return;
        if (!this.empOk(a.empresa || this.empresaDe(cc))) return;
        const gid = a.gid && porId[a.gid] ? a.gid : R.grupoDe(pl);
        if (!gid || !porId[gid]) return;
        const x = pega(gid, pl);
        if (!x.nome && a.nome) x.nome = a.nome;
        x[serie][mes - 1] += this.C().centavos(Number(a.valor) || 0);
      });
      real(d.real, "real"); real(d.realN1, "n1");
      const tot = (x) => { x.t = {}; ["real", "n1", "orc", "fc"].forEach((k) => { x.t[k] = ms.reduce((s, i) => s + x[k][i], 0); }); return x; };
      const filhos = {};
      grupos.forEach((g) => { if (g.parentId && porId[g.parentId]) (filhos[g.parentId] = filhos[g.parentId] || []).push(g.id); });
      const no = {};
      const montarNo = (gid) => {
        if (no[gid]) return no[gid];
        const g = porId[gid];
        const ps = [...planos.values()].filter((p) => p.gid === gid).map(tot).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR") || String(a.codigo).localeCompare(String(b.codigo)));
        const fs = (filhos[gid] || []).map(montarNo);
        const x = { id: gid, codigo: g.code || g.codigo || "", nome: g.name || g.nome || gid, planos: ps, filhos: fs, real: zeros(), n1: zeros(), orc: zeros(), fc: zeros() };
        ps.concat(fs).forEach((y) => ["real", "n1", "orc", "fc"].forEach((k) => { for (let i = 0; i < 12; i++) x[k][i] += y[k][i]; }));
        no[gid] = tot(x);
        return no[gid];
      };
      const topo = grupos.filter((g) => !g.parentId || !porId[g.parentId]).map((g) => montarNo(g.id));
      const lista = [];
      const plana = (x, nivel) => { lista.push(Object.assign(x, { nivel })); x.filhos.forEach((y) => plana(y, nivel + 1)); };
      topo.forEach((x) => plana(x, 0));
      const ps = [...planos.values()];
      const entM = zeros(); ps.filter((p) => p.entrada).forEach((p) => p.real.forEach((v, i) => { entM[i] += v; }));
      const ent = ms.reduce((s, i) => s + entM[i], 0);
      const soma = (f, k) => ps.filter(f).reduce((s, p) => s + p.t[k], 0);
      const liq = (k) => topo.reduce((s, x) => s + x.t[k], 0);
      // geração de caixa: realizado até o último mês fechado (YTD) + orçado dos meses seguintes (YTG)
      const corte = this.C().corteForecast(this.fechamento, this.ano);
      const ytd = topo.reduce((s, x) => s + x.real.slice(0, corte).reduce((a, b) => a + b, 0), 0);
      const ytg = topo.reduce((s, x) => s + x.orc.slice(corte).reduce((a, b) => a + b, 0), 0);
      const corteN1 = this.C().corteForecast(this.fechamento, Number(this.ano) - 1);
      const ytdN1 = topo.reduce((s, x) => s + x.n1.slice(0, corteN1).reduce((a, b) => a + b, 0), 0);
      return { lista, topo, ent, entM, corte,
        entradas: { n: soma((p) => p.entrada, "real"), ref: soma((p) => p.entrada, "n1") },
        saidas: { n: soma((p) => !p.entrada, "real"), ref: soma((p) => !p.entrada, "n1") },
        liquido: { n: liq("real"), ref: liq("n1") },
        geracao: { n: ytd + ytg, ref: ytdN1, ytd, ytg } };
    },

    /* ---------- ações ---------- */
    setAno(v) { this.ano = String(v); this.calc = null; this.fcLinhas = {}; this.versaoFc = ""; this.render(); },
    setDiretoria(v) { this.diretoria = v; this.dept = "TODOS"; this.calc = null; this.render(); },
    setDept(v) { this.dept = v; this.calc = null; this.render(); },
    alternarSerie(k) {
      this.series[k] = !this.series[k];
      if (k === "fc" && this.series.fc && this.calc && !this.fcLinhas[this.versaoAtual()]) { this.garantirFc(this.versaoAtual()).then(() => this.render()); }
      this.render();
    },
    setVersao(v) { this.versaoFc = v; if (this.calc && !this.fcLinhas[v]) { this.passo = "Lendo o forecast…"; this.render(); this.garantirFc(v).then(() => { this.passo = ""; this.render(); }); return; } this.render(); },
    alternar(id) { this.abertos[id] = !this.abertos[id]; this.render(); },
    expandir(on) { this.abertos = {}; if (on && this.calc) { const M = this.montar(); if (M) M.lista.forEach((x) => { this.abertos[x.id] = true; }); } this.render(); },
    compararVersoes() {
      const X = window.OrionOxRApp;
      if (!X) return;
      X.ano = this.ano; X.diretoria = this.diretoria; X.dept = this.dept; X.aba = "comparativo";
      X.cmp.dfc = true; X.cmp.dfcRes = null; X.cmp.dfcA = X.cmp.dfcA || ""; X.cmp.dfcB = X.cmp.dfcB || "";
      if (typeof window.switchTab === "function") window.switchTab("orion-oxr", "Orçado × Realizado (Órion)");
      else X.init();
      if (X.cabs && X.cabs.orcamento) X.render();
    },
    excel() {
      const M = this.calc && this.montar();
      if (!M || !window.XLSX) return;
      const at = SER.filter(([k]) => k === "real" || this.series[k]);
      const r = (v) => Math.round(Number(v) || 0) / 100, p = (x) => (x == null ? "" : x * 100);
      const cab = ["Código", "Descrição", "Tipo"];
      MES.forEach((m) => { at.forEach(([, , c]) => cab.push(`${m} ${c}`)); if (this.ahavMensal) cab.push(`${m} AH %`, `${m} AV %`); });
      at.forEach(([, , c]) => cab.push(`Total ${this.ano} ${c}`)); cab.push("AH %", "AV %");
      const rows = [];
      const push = (x, tipo) => {
        const l = [x.codigo, x.nome, tipo];
        for (let i = 0; i < 12; i++) { at.forEach(([k]) => l.push(r(x[k][i]))); if (this.ahavMensal) l.push(p(this.ah(x.real[i], x.n1[i])), p(M.entM[i] ? x.real[i] / M.entM[i] : null)); }
        at.forEach(([k]) => l.push(r(x.t[k]))); l.push(p(this.ah(x.t.real, x.t.n1)), p(M.ent ? x.t.real / M.ent : null));
        rows.push(l);
      };
      M.lista.forEach((x) => { push(x, "Categoria"); x.planos.forEach((pl) => push(pl, "Plano")); });
      const ws = XLSX.utils.aoa_to_sheet([cab].concat(rows)), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "DFC");
      XLSX.writeFile(wb, `DFC_${this.ano}.xlsx`);
    },
    ah(n, ref) { return Math.abs(ref) < 1 ? null : (n - ref) / Math.abs(ref); },

    /* ---------- tela ---------- */
    kpi(titulo, legenda, x, nLabel) {
      const v = x.n - x.ref, s = this.C().semaforo(x.n, x.ref, "RESULTADO");
      const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
      return `<div class="odv-kpi"><div class="t"><span>${titulo}</span><span title="${this.esc(s.titulo)}" style="width:9px;height:9px;border-radius:50%;background:${cores[s.cor] || "#cbd5e1"};display:inline-block"></span></div><div class="l">${this.esc(legenda)}</div>
        <div class="r"><span>${this.esc(nLabel)}</span><b style="font-size:1.05rem;color:${x.n < 0 ? "#dc2626" : "#0f2a1c"}">${this.rs(x.n)}</b></div>
        <div class="r"><span>LY</span><span style="font-size:0.82rem;font-weight:600">${this.rs(x.ref)}</span></div>
        <div class="r"><span>Var</span><span style="font-size:0.82rem;font-weight:600">${this.num(v)} &nbsp;${this.per(this.ah(x.n, x.ref))}</span></div></div>`;
    },
    legendaMeses() {
      const ms = this.meses.slice().sort((a, b) => a - b);
      if (!ms.length) return "ano completo";
      if (ms.length === 1) return MES[ms[0]].toLowerCase();
      const seq = ms.every((v, i) => i === 0 || v === ms[i - 1] + 1);
      return seq ? `${MES[ms[0]].toLowerCase()}–${MES[ms[ms.length - 1]].toLowerCase()}` : ms.map((i) => MES[i].toLowerCase()).join(", ");
    },
    htmlTabela(M) {
      const at = SER.filter(([k]) => k === "real" || this.series[k]);
      const nCol = at.length + (this.ahavMensal ? 2 : 0);
      const cels = (x) => {
        let h = "";
        for (let i = 0; i < 12; i++) {
          at.forEach(([k], j) => { h += `<td class="is-right${j === 0 ? " odv-ini" : ""}" style="${k === "real" ? "font-weight:600" : ""}">${this.num(x[k][i])}</td>`; });
          if (this.ahavMensal) h += `<td class="is-right">${this.per(this.ah(x.real[i], x.n1[i]))}</td><td class="is-right">${this.per(M.entM[i] ? x.real[i] / M.entM[i] : null)}</td>`;
        }
        at.forEach(([k], j) => { h += `<td class="is-right odv-tot${j === 0 ? " odv-ini" : ""}">${this.num(x.t[k])}</td>`; });
        return h + `<td class="is-right odv-ini">${this.per(this.ah(x.t.real, x.t.n1))}</td><td class="is-right">${this.per(M.ent ? x.t.real / M.ent : null)}</td>`;
      };
      let corpo = "";
      M.lista.forEach((x) => {
        const ab = !!this.abertos[x.id], tem = x.planos.length > 0;
        corpo += `<tr class="odv-cat"><td class="odv-nome" style="padding-left:${8 + x.nivel * 18}px;${tem ? "cursor:pointer" : ""}" ${tem ? `onclick="${N}.alternar('${this.esc(x.id)}')"` : ""}><span style="display:inline-block;width:14px;color:#94a3b8">${tem ? (ab ? "▾" : "▸") : ""}</span><span class="odv-cod">${this.esc(x.codigo)}</span><b>${this.esc(x.nome)}</b></td>${cels(x)}</tr>`;
        if (ab) x.planos.forEach((p) => { corpo += `<tr class="odv-pl"><td class="odv-nome" style="padding-left:${26 + (x.nivel + 1) * 18}px"><span class="odv-cod">${this.esc(p.codigo)}</span>${this.esc(p.nome || p.codigo)}</td>${cels(p)}</tr>`; });
      });
      const h1 = MES.map((m) => `<th colspan="${nCol}" class="is-center odv-ini">${m}</th>`).join("") + `<th colspan="${at.length}" class="is-center odv-ini" style="background:#105436">Total ${this.esc(this.ano)}</th><th rowspan="2" class="is-right odv-ini">AH %</th><th rowspan="2" class="is-right">AV %</th>`;
      const sub = at.map(([, , c], j) => `<th class="is-right${j === 0 ? " odv-ini" : ""}">${c}</th>`).join("") + (this.ahavMensal ? `<th class="is-right">AH %</th><th class="is-right">AV %</th>` : "");
      const h2 = new Array(12).fill(sub).join("") + at.map(([, , c], j) => `<th class="is-right${j === 0 ? " odv-ini" : ""}">${c}</th>`).join("");
      const largura = 320 + (12 * nCol + at.length) * 110 + 170;
      const cols = `<col style="width:320px">${new Array(12 * nCol + at.length).fill(`<col style="width:110px">`).join("")}<col style="width:85px"><col style="width:85px">`;
      return `<div class="cc-scroll" style="max-height:66vh"><table class="cc-table odv-tab" style="min-width:${largura}px"><colgroup>${cols}</colgroup><thead><tr><th rowspan="2" class="odv-nome">Categoria</th>${h1}</tr><tr>${h2}</tr></thead><tbody>${corpo || `<tr><td colspan="99" style="text-align:center;padding:30px">Sem linhas na Visão DFC.</td></tr>`}</tbody></table></div>`;
    },
    render() {
      const root = this.root();
      if (!root) return;
      if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
      this.estilos();
      const anos = this.anos(); if (!anos.length) anos.push(Number(this.ano));
      const deps = ((this.cadDep || {}).departamentos || []);
      const dirs = [...new Set(deps.map((d) => d.diretoria).filter(Boolean))].sort();
      const depts = new Map();
      (this.cabs.orcamento || []).concat(this.cabs.forecast || []).filter((c) => String(c.ano) === String(this.ano) && c.departamento && (this.diretoria === "TODAS" || this.dirDe(c.departamento.id) === this.diretoria)).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
      const emps = this.calc ? this.calc.empresas.slice().sort((a, b) => Number(a) - Number(b)) : [];
      const multi = (id, rot, items) => window.MlEmpresaFilter ? `<div>${MlEmpresaFilter.html({ id, label: rot, items, selectedIds: id === "odv-mes" ? this.meses.map(String) : this.empIds, open: this.fOpen === id, query: this.fQ[id] || "", emptyMeansAll: true })}</div>` : "";
      const topo = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px"><div><h2 style="font-size:1.4rem;font-weight:800;color:var(--color-primary);margin:0">DFC</h2>
          <p style="font-size:0.8rem;color:#6b8474;margin:2px 0 0">Demonstrativo pela Visão DFC — realizado ${this.esc(this.ano)} vs ${Number(this.ano) - 1}, orçado e forecast. Saídas negativas.</p></div>
          <div class="odv-seg"><button type="button" class="on">Demonstrativo</button><button type="button" onclick="${N}.compararVersoes()">⇆ Comparar versões</button></div></div>
        <div class="odv-card"><div class="odv-barra">
          ${dirs.length ? `<div><label class="ml-emp-filter-label">Diretoria</label><select class="idx-select" style="height:40px;min-width:150px" onchange="${N}.setDiretoria(this.value)"><option value="TODAS">Todas</option>${dirs.map((d) => `<option ${d === this.diretoria ? "selected" : ""}>${this.esc(d)}</option>`).join("")}</select></div>` : ""}
          <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:200px" onchange="${N}.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
          ${emps.length ? multi("odv-emp", "Empresa", emps.map((id) => ({ id: String(id), label: `${id} - ${this.nomeEmpresa(id).toUpperCase()}` }))) : ""}
          ${multi("odv-mes", "Meses", MES.map((m, i) => ({ id: String(i), label: m })))}
          <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px;min-width:100px" onchange="${N}.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
          <button type="button" class="btn btn-primary" style="margin-left:auto" ${this.carregando || !this.cabs.orcamento ? "disabled" : ""} onclick="${N}.calcular()">${this.carregando ? "Calculando..." : "Calcular"}</button></div></div>`;
      let corpo;
      if (this.carregando) corpo = `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>`;
      else if (!this.calc) corpo = `<div class="odv-card" style="text-align:center;color:#6b8474;padding:30px">Escolha o ano e o departamento e clique em <b>Calcular</b>. O realizado é lido do Sienge na hora (este ano e o anterior) e pode levar alguns minutos.</div>`;
      else {
        const M = this.montar();
        if (!M) corpo = `<div class="odv-card" style="color:#92400e">A Visão DFC do Integra ainda não carregou (Configurações gerais › Plano Financeiro e Visões). Recarregue a página e tente de novo.</div>`;
        else {
          const leg = this.legendaMeses(), vs = this.versoesFc();
          const cards = `<div class="odv-kpis">${this.kpi("Entradas", leg, M.entradas, this.ano)}${this.kpi("Saídas", leg, M.saidas, this.ano)}${this.kpi("Líquido", leg, M.liquido, this.ano)}${this.kpi("Geração de caixa", `YTD até ${M.corte ? MES[M.corte - 1].toLowerCase() : "—"} + YTG orçado`, M.geracao, this.ano)}</div>
            <div style="font-size:0.7rem;color:#6b8474;margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap"><b>SEMÁFORO</b><span><span style="color:#cbd5e1">●</span> Imaterial (&lt; R$ 5 mil)</span><span><span style="color:#10b981">●</span> Favorável ou ≤ 5%</span><span><span style="color:#fbbf24">●</span> Atenção (≤ 10%)</span><span><span style="color:#ef4444">●</span> Acima do limite</span><span><span style="color:#0ea5e9">●</span> Novo</span></div>`;
          const barra = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div style="font-weight:800;color:#1c2e24">Visão DFC <span style="font-size:0.66rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-left:6px">padrão</span></div>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span style="font-size:0.64rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Séries</span>
              ${SER.map(([k, l]) => `<button type="button" class="odv-chip ${k === "real" || this.series[k] ? "on" : ""}" ${k === "real" ? "disabled" : `onclick="${N}.alternarSerie('${k}')"`}>${l}</button>`).join("")}
              ${this.series.fc && vs.length ? `<select class="idx-select" style="height:28px;font-size:0.74rem" onchange="${N}.setVersao(this.value)">${vs.map((v) => `<option value="${this.esc(v)}" ${v === this.versaoAtual() ? "selected" : ""}>${this.esc(this.C().rotuloVersao(v, "forecast"))}</option>`).join("")}</select>` : ""}
              <button type="button" class="odv-chip ${this.ahavMensal ? "on" : ""}" onclick="${N}.ahavMensal=!${N}.ahavMensal;${N}.render()">AH/AV mensal</button>
              <button type="button" class="odv-link" style="margin-left:6px" onclick="${N}.expandir(true)">Expandir planos</button><button type="button" class="odv-link" style="color:#6b8474" onclick="${N}.expandir(false)">Recolher</button>
              <button type="button" class="btn btn-excel" style="height:32px" onclick="${N}.excel()">⬇ Excel</button></div></div>`;
          corpo = cards + `<div class="odv-card">${barra}${this.passo ? `<div style="font-size:0.75rem;color:#166534;margin-bottom:6px">⟳ ${this.esc(this.passo)}</div>` : ""}${this.htmlTabela(M)}</div>
            <div style="font-size:0.7rem;color:#94a3b8">Fonte: mesmos números do Orçado × Realizado, agrupados pela Visão DFC padrão do Integra. Planos fora da visão não entram. Cada mês mostra as séries ligadas (Real ${this.esc(this.ano)}, LY = real ${Number(this.ano) - 1}, Orçado; Forecast opcional). AH e AV no total do ano; mensal é opcional (AV sobre as entradas daquele mês). Geração de caixa sem o saldo de abertura de 31/12.</div>`;
        }
      }
      root.innerHTML = topo + (this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : "") + corpo;
      this.ligar(emps);
    },
    ligar(emps) {
      if (!window.MlEmpresaFilter) return;
      const liga = (id, todos, get, set) => {
        if (!document.getElementById(id)) return;
        MlEmpresaFilter.bind(id, {
          toggleOpen: () => { this.fOpen = this.fOpen === id ? null : id; this.render(); },
          close: () => { if (this.fOpen === id) { this.fOpen = null; setTimeout(() => this.render(), 0); } },
          setQuery: (q) => { this.fQ[id] = q; this.render(); },
          toggleId: (x, on) => { const s = new Set(get()); if (on) s.add(String(x)); else s.delete(String(x)); set([...s]); this.render(); },
          selectAll: () => { set(todos.slice()); this.render(); },
          selectNone: () => { set([]); this.render(); }
        });
      };
      liga("odv-emp", emps.map(String), () => this.empIds, (l) => { this.empIds = l; });
      liga("odv-mes", MES.map((m, i) => String(i)), () => this.meses.map(String), (l) => { this.meses = l.map(Number).length === 12 ? [] : l.map(Number); });
    }
  };
  window.OrionDfcVisaoApp = App;
})();
