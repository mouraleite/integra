/* Órion (transição) › DFC e DFC gerencial — as telas do ML Órion (Orçamento › DFC e Orçamento › DFC gerencial) com a
 * identidade do Integra. Este arquivo tem o motor comum (OrionDfcBase) e a tela DFC (OrionDfcVisaoApp); o DFC gerencial
 * (OrionDfcApp) fica em orion-dfc.js e usa o mesmo motor.
 * Topo (como no Órion): Diretoria, Departamento, ID da empresa, Empresa, Meses, Ano e Calcular (no DFC gerencial também
 * "Comparar com" Orçado / Forecast). Cartões Entradas, Saídas, Líquido e Geração de caixa (ano × LY, variação, semáforo).
 * Árvore da Visão DFC padrão do Integra (Configurações gerais › Plano Financeiro e Visões): grupos (com os grupos-pai somando
 * os filhos) e os planos dentro. Entradas positivas e saídas negativas.
 * Dados do Integra, mesma origem do Orçado × Realizado: orçado e forecast dos documentos (orion_orcamentos / orion_forecasts,
 * inclusive o Orçamento do Integra), realizado pela regra do Integra (caixa e bancos, orion-realizado.js) do ano e do ano
 * anterior (LY), só dos centros de custo e planos que estão no orçamento ou no forecast. Geração de caixa: realizado até o
 * último mês fechado (YTD) + orçado dos meses seguintes (YTG), sem o saldo de abertura de 31/12. MLDU (DFC gerencial):
 * % de consolidação da empresa (cadastro de Empresas). Só leitura. */
(function () {
  const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const zeros = () => new Array(12).fill(0);
  const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
  const SERIES4 = ["real", "n1", "orc", "fc"];

  /** Motor comum: estado, leitura, filtros e montagem das folhas (empresa × centro de custo × plano). */
  function criar(N, rootId) {
    return {
      N, rootId,
      ano: String(new Date().getFullYear()), diretoria: "TODAS", dept: "TODOS",
      empIds: [], empNomes: [], fOpen: null, fQ: {}, meses: [],
      cabs: { orcamento: null, forecast: null }, cadDep: null, fechamento: [], docCache: {}, fcLinhas: {},
      calc: null, carregando: false, passo: "", erro: "", versaoFc: "", ahavMensal: false, abertos: {},

      C() { return window.OrionOrcamentoCalc; },
      R() { return window.OrionRealizado; },
      fc() { return window.firebaseCollections; },
      root() { return document.getElementById(this.rootId); },
      esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
      rs(c) { const v = Number(c) || 0; if (!v) return "R$ 0"; return (v < 0 ? "-" : "") + "R$ " + this.C().fmtReais(Math.abs(v), true); },
      num(c) { const v = Number(c) || 0; return `<span style="color:${v < 0 ? "#dc2626" : v > 0 ? "#1c2e24" : "#94a3b8"}">${this.rs(v)}</span>`; },
      per(x) { return x == null ? `<span style="color:#cbd5e1">—</span>` : `<span style="color:${x < 0 ? "#dc2626" : "#334155"}">${((x * 100).toFixed(1)).replace(".", ",")}%</span>`; },
      ah(n, ref) { return Math.abs(ref) < 1 ? null : (n - ref) / Math.abs(ref); },
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
        const R = ".odv";
        st.textContent = `
          ${R} .odv-card { background:#fff; border:1px solid rgba(16,84,54,.08); border-radius:var(--border-radius-md); box-shadow:var(--shadow-sm); padding:12px 16px; margin-bottom:12px; }
          ${R} .odv-barra { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
          ${R} .odv-barra .btn { height:40px; }
          ${R} .odv-barra .ml-emp-filter { min-width:0 !important; width:165px; }
          ${R} .odv-barra > div > label.ml-emp-filter-label { display:block; margin-bottom:4px; }
          ${R} .odv-barra .ml-emp-filter-btn { min-width:0 !important; width:100%; box-sizing:border-box; }
          ${R} .odv-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-bottom:6px; }
          @media (max-width:1200px) { ${R} .odv-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
          ${R} .odv-kpi { background:#fff; border:1px solid #dfe9e3; border-radius:10px; padding:10px 14px; min-width:0; }
          ${R} .odv-kpi .t { display:flex; justify-content:space-between; font-size:0.68rem; font-weight:800; color:#6b8474; text-transform:uppercase; letter-spacing:.05em; }
          ${R} .odv-kpi .l { font-size:0.64rem; color:#94a3b8; margin-bottom:6px; }
          ${R} .odv-kpi .r { display:flex; justify-content:space-between; align-items:baseline; gap:6px; font-variant-numeric:tabular-nums; padding:1px 0; }
          ${R} .odv-kpi .r span:first-child { font-size:0.62rem; color:#94a3b8; text-transform:uppercase; }
          ${R} .odv-kpi .g2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
          ${R} .odv-kpi .g2 > div { min-width:0; }
          ${R} .odv-kpi .h { display:flex; justify-content:space-between; font-size:0.6rem; font-weight:800; color:#94a3b8; text-transform:uppercase; margin-bottom:2px; }
          ${R} .odv-seg { display:inline-flex; border:1px solid #cfe0d6; border-radius:8px; overflow:hidden; }
          ${R} .odv-seg button { border:none; background:#fff; color:#4a6355; padding:0 14px; height:32px; font-size:0.78rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
          ${R} .odv-seg.alto button { height:40px; }
          ${R} .odv-seg button.on { background:var(--color-primary); color:#fff; }
          ${R} .odv-chip { border:1px solid #cfe0d6; background:#fff; color:#4a6355; height:28px; padding:0 10px; border-radius:7px; font-size:0.72rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
          ${R} .odv-chip.on { background:var(--color-primary); border-color:var(--color-primary); color:#fff; }
          ${R} .odv-chip.esc { background:#1c2e24; border-color:#1c2e24; color:#fff; }
          ${R} .odv-link { background:none; border:none; color:var(--color-primary); font-weight:700; font-size:0.76rem; cursor:pointer; padding:0; font-family:var(--font-family); }
          ${R} .odv-lbl { font-size:0.64rem; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; }
          ${R} .cc-table.odv-tab td, ${R} .cc-table.odv-tab th { white-space:nowrap; font-variant-numeric:tabular-nums; }
          ${R} .cc-table.odv-tab td.odv-nome, ${R} .cc-table.odv-tab th.odv-nome { position:sticky; left:0; z-index:2; white-space:normal; }
          ${R} .cc-table.odv-tab th.odv-nome { z-index:4; }
          ${R} .cc-table.odv-tab tbody tr.odv-emp td { background:#e7f6ee !important; color:#105436; font-weight:800; }
          ${R} .cc-table.odv-tab tbody tr.odv-cc td { background:#f1f7f3 !important; font-weight:700; }
          ${R} .cc-table.odv-tab tbody tr.odv-cat td { background:#fff !important; }
          ${R} .cc-table.odv-tab tbody tr.odv-pl td { background:#f8faf9 !important; color:#4a6355; }
          ${R} .cc-table.odv-tab tbody tr.odv-ce td { background:#fbfdfc !important; color:#6b8474; font-size:0.68rem; }
          ${R} .cc-table.odv-tab td.odv-ini, ${R} .cc-table.odv-tab th.odv-ini { border-left:1px solid #dfe9e3; }
          ${R} .cc-table.odv-tab td.odv-tot { font-weight:700; }
          ${R} .odv-cod { font-family:monospace; color:#94a3b8; margin-right:6px; }
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
          const todas = orc.concat(...Object.values(this.fcLinhas));
          if (!todas.length) throw new Error(`Nenhum orçamento ou forecast de despesas e receitas de ${this.ano} no Integra para este filtro.`);
          const empresas = R.empresasDosCcs([...new Set(todas.map((l) => l.cc))]);
          let real = { alocacoes: [], movimentos: 0 }, realN1 = { alocacoes: [], movimentos: 0 };
          if (empresas.length) {
            const ate = this.ateMes(this.ano);
            if (ate >= 1) { this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`; this.render(); real = await R.buscar(Number(this.ano), ate, empresas); }
            this.passo = `Lendo o realizado de ${Number(this.ano) - 1}…`; this.render();
            realN1 = await R.buscar(Number(this.ano) - 1, 12, empresas);
          }
          this.calc = { orc, real, realN1, empresas, docs: docs.length };
          this.abertos = this.abertosIniciais ? this.abertosIniciais() : {};
        } catch (e) { this.erro = e.message || String(e); }
        this.carregando = false; this.passo = "";
        this.render();
      },

      /* ---------- filtros ---------- */
      ccInfo(cc) {
        const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
        return l.find((x) => dig(x.id) === dig(cc)) || null;
      },
      empresaDe(cc) { const c = this.ccInfo(cc); return c ? String(c.idCompany != null ? c.idCompany : c.companyId || "") : ""; },
      empresas() { return ((window.AppState && AppState.companies) || []).map((c) => ({ id: String(c.id), nome: String(c.name || c.nome || c.tradeName || "") })).filter((c) => c.id).sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id)); },
      nomeEmpresa(id) { const c = this.empresas().find((x) => x.id === String(id)); return c ? c.nome : ""; },
      empOk(id) {
        if (this.empIds.length && this.empIds.indexOf(String(id)) < 0) return false;
        if (this.empNomes.length && this.empNomes.indexOf(this.nomeEmpresa(id)) < 0) return false;
        return true;
      },
      fatorMldu(empresaId) {
        const fx = window.FluxoCaixaApp;
        const lista = fx && typeof fx.allCompanies === "function" ? fx.allCompanies() : [];
        const c = lista.find((x) => String(x.id) === String(empresaId));
        return c && c.consolidacao ? (Number(c.pct) || 0) / 100 : 0;
      },
      legendaMeses() {
        const ms = this.meses.slice().sort((a, b) => a - b);
        if (!ms.length) return "ano completo";
        if (ms.length === 1) return MES[ms[0]].toLowerCase();
        const seq = ms.every((v, i) => i === 0 || v === ms[i - 1] + 1);
        return seq ? `${MES[ms[0]].toLowerCase()}–${MES[ms[ms.length - 1]].toLowerCase()}` : ms.map((i) => MES[i].toLowerCase()).join(", ");
      },
      grupos() {
        const R = this.R();
        const gs = ((R && R.grupos()) || []).filter((g) => g && g.id && g.type !== "formula");
        const porId = {}; gs.forEach((g) => { porId[g.id] = g; });
        return { gs, porId };
      },

      /** Folhas empresa × centro de custo × plano, com real, LY, orçado e forecast (centavos, sinal da DFC). */
      folhas(comFc) {
        const R = this.R(), d = this.calc, { porId } = this.grupos();
        const ver = this.versaoAtual();
        const fcl = comFc ? this.fcLinhas[ver] || [] : [];
        const todas = d.orc.concat(this.fcLinhas[ver] || []);
        const ccs = new Set(todas.map((l) => l.cc)), planosSet = new Set(todas.map((l) => l.plano));
        const nomesPl = {}, nomesCc = {};
        todas.forEach((l) => { if (l.plano_nome) nomesPl[l.plano] = l.plano_nome; if (l.cc_nome) nomesCc[l.cc] = l.cc_nome; });
        const mapa = new Map();
        const pega = (emp, cc, gid, plano) => {
          const k = emp + "|" + cc + "|" + plano;
          if (!mapa.has(k)) mapa.set(k, { emp, cc, gid, plano, nome: nomesPl[plano] || "", ccNome: nomesCc[cc] || "", entrada: String(plano).charAt(0) === "1", real: zeros(), n1: zeros(), orc: zeros(), fc: zeros() });
          return mapa.get(k);
        };
        const linhas = (lista, serie) => lista.forEach((l) => {
          const emp = String(l.empresa || this.empresaDe(l.cc) || "_sem");
          if (!this.empOk(emp)) return;
          const gid = R.grupoDe(l.plano);
          if (!gid || !porId[gid]) return;
          const x = pega(emp, l.cc, gid, l.plano);
          (l.m || []).forEach((v, i) => { x[serie][i] += (Number(v) || 0) * l.sinal; });
        });
        linhas(d.orc, "orc"); linhas(fcl, "fc");
        const real = (res, serie) => (res.alocacoes || []).forEach((a) => {
          const cc = String(a.cc || ""), pl = String(a.plano || ""), mes = Number(a.mes);
          if (!ccs.has(cc) || !planosSet.has(pl) || !(mes >= 1 && mes <= 12)) return;
          const emp = String(a.empresa || this.empresaDe(cc) || "_sem");
          if (!this.empOk(emp)) return;
          const gid = a.gid && porId[a.gid] ? a.gid : R.grupoDe(pl);
          if (!gid || !porId[gid]) return;
          const x = pega(emp, cc, gid, pl);
          if (!x.nome && a.nome) x.nome = a.nome;
          x[serie][mes - 1] += this.C().centavos(Number(a.valor) || 0);
        });
        real(d.real, "real"); real(d.realN1, "n1");
        return [...mapa.values()];
      },
      /** Soma séries de uma lista de nós. */
      somar(lista, fator) {
        const x = { real: zeros(), n1: zeros(), orc: zeros(), fc: zeros() };
        lista.forEach((y) => { const f = fator == null ? 1 : fator(y); SERIES4.forEach((k) => { for (let i = 0; i < 12; i++) x[k][i] += y[k][i] * f; }); });
        return x;
      },
      tot(x) { const ms = this.ms(); x.t = {}; Object.keys(x).forEach((k) => { if (Array.isArray(x[k]) && x[k].length === 12 && typeof x[k][0] === "number") x.t[k] = ms.reduce((s, i) => s + x[k][i], 0); }); return x; },
      /** Árvore da visão DFC a partir de folhas (agregadas por plano, com os centros de custo dentro quando comCentros). */
      arvoreVisao(folhas, prefixo, comCentros) {
        const { gs, porId } = this.grupos();
        const porPlano = new Map();
        folhas.forEach((f) => { const k = f.gid + "|" + f.plano; if (!porPlano.has(k)) porPlano.set(k, []); porPlano.get(k).push(f); });
        const planos = [...porPlano.entries()].map(([k, fs]) => {
          const p = Object.assign({ kind: "plano", id: prefixo + "|p|" + k, gid: fs[0].gid, codigo: fs[0].plano, nome: fs.find((f) => f.nome) ? fs.find((f) => f.nome).nome : fs[0].plano, entrada: fs[0].entrada, filhos: [] }, this.somar(fs));
          if (comCentros) {
            const porCc = new Map();
            fs.forEach((f) => { if (!porCc.has(f.cc)) porCc.set(f.cc, []); porCc.get(f.cc).push(f); });
            p.filhos = [...porCc.entries()].map(([cc, l]) => this.tot(Object.assign({ kind: "centro", id: p.id + "|c|" + cc, codigo: cc, nome: (l[0].ccNome || (this.ccInfo(cc) || {}).name || cc), filhos: [] }, this.somar(l))))
              .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
          }
          return this.tot(p);
        });
        const filhos = {};
        gs.forEach((g) => { if (g.parentId && porId[g.parentId]) (filhos[g.parentId] = filhos[g.parentId] || []).push(g.id); });
        const no = {};
        const montar = (gid, nivel) => {
          const g = porId[gid];
          const ps = planos.filter((p) => p.gid === gid).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR") || String(a.codigo).localeCompare(String(b.codigo)));
          const fs = (filhos[gid] || []).map((f) => montar(f, nivel + 1));
          const x = Object.assign({ kind: "categoria", id: prefixo + "|n|" + gid, gid, codigo: g.code || g.codigo || "", nome: g.name || g.nome || gid, nivel, planos: ps, sub: fs, filhos: ps }, this.somar(ps.concat(fs)));
          no[gid] = this.tot(x);
          return no[gid];
        };
        const topo = gs.filter((g) => !g.parentId || !porId[g.parentId]).map((g) => montar(g.id, 0));
        const lista = [];
        const plana = (x) => { lista.push(x); x.sub.forEach(plana); };
        topo.forEach(plana);
        return { topo, lista, planos };
      },
      /** Cartões: entradas, saídas, líquido e geração de caixa (YTD realizado + YTG orçado). fator(f) = 1 (cheio) ou % MLDU. */
      cartoes(folhas, fator) {
        const ms = this.ms(), f = fator || (() => 1);
        const s = (fil, k, lista) => lista.filter(fil).reduce((a, x) => a + ms.reduce((b, i) => b + x[k][i], 0) * f(x), 0);
        const corte = this.C().corteForecast(this.fechamento, this.ano), corteN1 = this.C().corteForecast(this.fechamento, Number(this.ano) - 1);
        const ytd = folhas.reduce((a, x) => a + x.real.slice(0, corte).reduce((b, v) => b + v, 0) * f(x), 0);
        const ytg = folhas.reduce((a, x) => a + x.orc.slice(corte).reduce((b, v) => b + v, 0) * f(x), 0);
        const ytdN1 = folhas.reduce((a, x) => a + x.n1.slice(0, corteN1).reduce((b, v) => b + v, 0) * f(x), 0);
        return {
          entradas: { n: s((x) => x.entrada, "real", folhas), ref: s((x) => x.entrada, "n1", folhas) },
          saidas: { n: s((x) => !x.entrada, "real", folhas), ref: s((x) => !x.entrada, "n1", folhas) },
          liquido: { n: s(() => true, "real", folhas), ref: s(() => true, "n1", folhas) },
          geracao: { n: ytd + ytg, ref: ytdN1 }, corte
        };
      },
      entradasMes(folhas) { const m = zeros(); folhas.filter((x) => x.entrada).forEach((x) => x.real.forEach((v, i) => { m[i] += v; })); return m; },

      /* ---------- pedaços de tela ---------- */
      farolHtml(n, ref) {
        const s = this.C().semaforo(n, ref, "RESULTADO");
        const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
        return `<span title="${this.esc(s.titulo)}" style="width:9px;height:9px;border-radius:50%;background:${cores[s.cor] || "#cbd5e1"};display:inline-block;flex-shrink:0"></span>`;
      },
      blocoKpi(x, compacto) {
        const v = x.n - x.ref, fs = compacto ? "0.95rem" : "1.05rem", fs2 = compacto ? "0.74rem" : "0.82rem";
        return `<div class="r"><span>${this.esc(this.ano)}</span><b style="font-size:${fs};color:${x.n < 0 ? "#dc2626" : "#0f2a1c"};white-space:nowrap">${this.rs(x.n)}</b></div>
          <div class="r"><span>LY</span><span style="font-size:${fs2};font-weight:600;white-space:nowrap">${this.rs(x.ref)}</span></div>
          <div class="r"><span>Var</span><span style="font-size:${fs2};font-weight:600;white-space:nowrap">${this.num(v)} ${this.per(this.ah(x.n, x.ref))}</span></div>`;
      },
      kpi(titulo, legenda, x, mldu) {
        if (!mldu) return `<div class="odv-kpi"><div class="t"><span>${titulo}</span>${this.farolHtml(x.n, x.ref)}</div><div class="l">${this.esc(legenda)}</div>${this.blocoKpi(x)}</div>`;
        return `<div class="odv-kpi"><div class="t"><span>${titulo}</span></div><div class="l">${this.esc(legenda)}</div>
          <div class="g2"><div><div class="h"><span>Cheio</span>${this.farolHtml(x.n, x.ref)}</div>${this.blocoKpi(x, true)}</div><div><div class="h"><span>MLDU</span>${this.farolHtml(mldu.n, mldu.ref)}</div>${this.blocoKpi(mldu, true)}</div></div></div>`;
      },
      legendaSemaforo() {
        return `<div style="font-size:0.7rem;color:#6b8474;margin-bottom:12px;display:flex;gap:12px;flex-wrap:wrap"><b>SEMÁFORO</b><span><span style="color:#cbd5e1">●</span> Imaterial (&lt; R$ 5 mil)</span><span><span style="color:#10b981">●</span> Favorável ou ≤ 5%</span><span><span style="color:#fbbf24">●</span> Atenção (≤ 10%)</span><span><span style="color:#ef4444">●</span> Acima do limite</span><span><span style="color:#0ea5e9">●</span> Novo</span></div>`;
      },
      /** Barra de filtros do Órion (sem a Consolidação MLDU, que não faz parte da migração). extra = html antes do Calcular. */
      htmlFiltros(extra) {
        const N = this.N;
        const anos = this.anos(); if (!anos.length) anos.push(Number(this.ano));
        const deps = ((this.cadDep || {}).departamentos || []);
        const dirs = [...new Set(deps.map((d) => d.diretoria).filter(Boolean))].sort();
        const depts = new Map();
        (this.cabs.orcamento || []).concat(this.cabs.forecast || []).filter((c) => String(c.ano) === String(this.ano) && c.departamento && (this.diretoria === "TODAS" || this.dirDe(c.departamento.id) === this.diretoria)).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
        const emps = this.empresas();
        const multi = (id, rot, items, sel) => window.MlEmpresaFilter ? `<div>${MlEmpresaFilter.html({ id, label: rot, items, selectedIds: sel, open: this.fOpen === id, query: this.fQ[id] || "", emptyMeansAll: true })}</div>` : "";
        return `<div class="odv-card"><div class="odv-barra">
          ${dirs.length ? `<div><label class="ml-emp-filter-label">Diretoria</label><select class="idx-select" style="height:40px;min-width:150px" onchange="${N}.setDiretoria(this.value)"><option value="TODAS">Todas</option>${dirs.map((d) => `<option ${d === this.diretoria ? "selected" : ""}>${this.esc(d)}</option>`).join("")}</select></div>` : ""}
          <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:200px" onchange="${N}.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
          ${multi(this.rootId + "-eid", "ID Empresa", emps.map((e) => ({ id: e.id, label: e.id })), this.empIds)}
          ${multi(this.rootId + "-enome", "Empresa", [...new Set(emps.map((e) => e.nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((n) => ({ id: n, label: n.toUpperCase() })), this.empNomes)}
          ${multi(this.rootId + "-mes", "Meses", MES.map((m, i) => ({ id: String(i), label: m })), this.meses.map(String))}
          <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px;min-width:100px" onchange="${N}.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
          ${extra || ""}
          <button type="button" class="btn btn-primary" style="margin-left:auto" ${this.carregando || !this.cabs.orcamento ? "disabled" : ""} onclick="${N}.calcular()">${this.carregando ? "Calculando..." : "Calcular"}</button></div></div>`;
      },
      ligarFiltros() {
        if (!window.MlEmpresaFilter) return;
        const emps = this.empresas();
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
        liga(this.rootId + "-eid", emps.map((e) => e.id), () => this.empIds, (l) => { this.empIds = l.length === emps.length ? [] : l; });
        const nomes = [...new Set(emps.map((e) => e.nome).filter(Boolean))];
        liga(this.rootId + "-enome", nomes, () => this.empNomes, (l) => { this.empNomes = l.length === nomes.length ? [] : l; });
        liga(this.rootId + "-mes", MES.map((m, i) => String(i)), () => this.meses.map(String), (l) => { this.meses = l.length === 12 ? [] : l.map(Number); });
      },
      setAno(v) { this.ano = String(v); this.calc = null; this.fcLinhas = {}; this.versaoFc = ""; this.render(); },
      setDiretoria(v) { this.diretoria = v; this.dept = "TODOS"; this.calc = null; this.render(); },
      setDept(v) { this.dept = v; this.calc = null; this.render(); },
      setVersao(v) { this.versaoFc = v; if (this.calc && !this.fcLinhas[v]) { this.passo = "Lendo o forecast…"; this.render(); this.garantirFc(v).then(() => { this.passo = ""; this.render(); }); return; } this.render(); },
      alternar(id) { this.abertos[id] = !this.abertos[id]; this.render(); },
      baixar(cab, rows, nome, aba) {
        if (!window.XLSX) return;
        const ws = XLSX.utils.aoa_to_sheet([cab].concat(rows)), wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, aba || "DFC");
        XLSX.writeFile(wb, nome);
      },
      corpoPadrao(conteudo) {
        if (this.carregando && !this.calc) return `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>`;
        if (this.carregando) return `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>`;
        if (!this.calc) return `<div class="odv-card" style="text-align:center;color:#6b8474;padding:30px">Escolha o ano e o departamento e clique em <b>Calcular</b>. O realizado é lido do Sienge na hora (este ano e o anterior) e pode levar alguns minutos.</div>`;
        if (!this.grupos().gs.length) return `<div class="odv-card" style="color:#92400e">A Visão DFC do Integra ainda não carregou (Configurações gerais › Plano Financeiro e Visões). Recarregue a página e tente de novo.</div>`;
        return conteudo();
      }
    };
  }

  /* ================= tela DFC (Demonstrativo) ================= */
  const SER = [["real", "Realizado", "Real"], ["n1", "LY", "LY"], ["orc", "Orçado", "Orç"], ["fc", "Forecast", "FCST"]];
  const App = Object.assign(criar("OrionDfcVisaoApp", "orion-dfcv-root"), {
    series: { n1: true, orc: true, fc: false },
    montar() {
      const fol = this.folhas(this.series.fc);
      const A = this.arvoreVisao(fol, "v", false);
      const entM = this.entradasMes(fol), ms = this.ms();
      return Object.assign(A, { fol, entM, ent: ms.reduce((s, i) => s + entM[i], 0), cards: this.cartoes(fol) });
    },
    alternarSerie(k) {
      this.series[k] = !this.series[k];
      if (k === "fc" && this.series.fc && this.calc && !this.fcLinhas[this.versaoAtual()]) this.garantirFc(this.versaoAtual()).then(() => this.render());
      this.render();
    },
    expandir(on) { this.abertos = {}; if (on && this.calc) this.montar().lista.forEach((x) => { this.abertos[x.id] = true; }); this.render(); },
    compararVersoes() {
      const X = window.OrionOxRApp;
      if (!X) return;
      X.ano = this.ano; X.diretoria = this.diretoria; X.dept = this.dept; X.aba = "comparativo";
      X.cmp.dfc = true; X.cmp.dfcRes = null;
      if (typeof window.switchTab === "function") window.switchTab("orion-oxr", "Orçado × Realizado (Órion)");
      else X.init();
      if (X.cabs && X.cabs.orcamento) X.render();
    },
    excel() {
      const M = this.calc && this.montar();
      if (!M) return;
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
      this.baixar(cab, rows, `DFC_${this.ano}.xlsx`, "DFC");
    },
    htmlTabela(M) {
      const N = this.N, at = SER.filter(([k]) => k === "real" || this.series[k]);
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
      root.classList.add("odv");
      const N = this.N;
      const topo = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px"><div><h2 style="font-size:1.4rem;font-weight:800;color:var(--color-primary);margin:0">DFC</h2>
          <p style="font-size:0.8rem;color:#6b8474;margin:2px 0 0">Demonstrativo pela Visão DFC — realizado ${this.esc(this.ano)} vs ${Number(this.ano) - 1}, orçado e forecast. Saídas negativas.</p></div>
          <div class="odv-seg"><button type="button" class="on">Demonstrativo</button><button type="button" onclick="${N}.compararVersoes()">⇆ Comparar versões</button></div></div>` + this.htmlFiltros();
      const corpo = this.corpoPadrao(() => {
        const M = this.montar(), leg = this.legendaMeses(), vs = this.versoesFc(), K = M.cards;
        const cards = `<div class="odv-kpis">${this.kpi("Entradas", leg, K.entradas)}${this.kpi("Saídas", leg, K.saidas)}${this.kpi("Líquido", leg, K.liquido)}${this.kpi("Geração de caixa", `YTD até ${K.corte ? MES[K.corte - 1].toLowerCase() : "—"} + YTG orçado`, K.geracao)}</div>` + this.legendaSemaforo();
        const barra = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div style="font-weight:800;color:#1c2e24">Visão DFC <span class="odv-lbl" style="margin-left:6px">padrão</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="odv-lbl">Séries</span>
            ${SER.map(([k, l]) => `<button type="button" class="odv-chip ${k === "real" || this.series[k] ? "on" : ""}" ${k === "real" ? "disabled" : `onclick="${N}.alternarSerie('${k}')"`}>${l}</button>`).join("")}
            ${this.series.fc && vs.length ? `<select class="idx-select" style="height:28px;font-size:0.74rem" onchange="${N}.setVersao(this.value)">${vs.map((v) => `<option value="${this.esc(v)}" ${v === this.versaoAtual() ? "selected" : ""}>${this.esc(this.C().rotuloVersao(v, "forecast"))}</option>`).join("")}</select>` : ""}
            <button type="button" class="odv-chip ${this.ahavMensal ? "on" : ""}" onclick="${N}.ahavMensal=!${N}.ahavMensal;${N}.render()">AH/AV mensal</button>
            <button type="button" class="odv-link" style="margin-left:6px" onclick="${N}.expandir(true)">Expandir planos</button><button type="button" class="odv-link" style="color:#6b8474" onclick="${N}.expandir(false)">Recolher</button>
            <button type="button" class="btn btn-excel" style="height:32px" onclick="${N}.excel()">⬇ Excel</button></div></div>`;
        return cards + `<div class="odv-card">${barra}${this.passo ? `<div style="font-size:0.75rem;color:#166534;margin-bottom:6px">⟳ ${this.esc(this.passo)}</div>` : ""}${this.htmlTabela(M)}</div>
          <div style="font-size:0.7rem;color:#94a3b8">Fonte: mesmos números do Orçado × Realizado, agrupados pela Visão DFC padrão do Integra. Planos fora da visão não entram. Cada mês mostra as séries ligadas (Real ${this.esc(this.ano)}, LY = real ${Number(this.ano) - 1}, Orçado; Forecast opcional). AH e AV no total do ano; mensal é opcional (AV sobre as entradas daquele mês). Geração de caixa sem o saldo de abertura de 31/12.</div>`;
      });
      root.innerHTML = topo + (this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : "") + corpo;
      this.ligarFiltros();
    }
  });
  window.OrionDfcBase = { criar, MES };
  window.OrionDfcVisaoApp = App;
})();
