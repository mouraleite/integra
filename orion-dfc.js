/* Órion (transição) › DFC gerencial — vindo do ML Órion (Orçamento › DFC gerencial), na visão DFC do Integra.
 * Linhas: grupos da visão DFC Padrão do Integra (Configurações gerais › Plano Financeiro e Visões).
 * Colunas: orçado no período e no ano (orçamentos de despesas e receitas trazidos do Órion, versão vigente),
 * realizado (regra do Integra, orion-realizado.js), diferença, semáforo (régua do Órion), realizado N-1, AH e AV.
 * Última linha: geração de caixa (soma de todos os grupos). Só leitura. */
const OrionDfcApp = {
  ano: String(new Date().getFullYear()),
  dept: "TODOS",
  ate: null,
  base: "orcamento",   // "orcamento" | "forecast"
  versao: "",
  empresas: [],
  meses: null,
  cabs: { orcamento: null, forecast: null },
  resultado: null,
  carregando: false,
  erro: "",
  passo: "",

  C() { return window.OrionOrcamentoCalc; },
  R() { return window.OrionRealizado; },
  root() { return document.getElementById("orion-dfc-root"); },
  fc() { return window.firebaseCollections; },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  COL: {
    orcamento: { cab: "orion_orcamentos", itens: "orion_orcamento_itens" },
    forecast: { cab: "orion_forecasts", itens: "orion_forecast_itens" }
  },

  init() {
    this.render();
    if (!this.cabs[this.base]) this.lerCabecalhos();
  },

  async lerCabecalhos() {
    const fc = this.fc();
    if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
    try {
      const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.COL[this.base].cab));
      const l = [];
      snap.forEach((d) => l.push(d.data()));
      this.cabs[this.base] = l;
      const anos = [...new Set(l.map((c) => c.ano))].sort((a, b) => b - a);
      if (anos.length && anos.indexOf(Number(this.ano)) < 0) this.ano = String(anos[0]);
    } catch (e) { this.erro = e.message || String(e); }
    this.render();
  },

  limpar() { this.resultado = null; this.meses = null; this.render(); },
  setAno(v) { this.ano = v; this.versao = ""; this.ate = null; this.limpar(); },
  setDept(v) { this.dept = v; this.limpar(); },
  setAte(v) { this.ate = Number(v) || null; this.limpar(); },
  setBase(v) { this.base = v; this.versao = ""; this.resultado = null; this.meses = null; this.init(); },

  /** Documentos de despesas e receitas do ano; no forecast, só a versão escolhida (ou a mais recente). */
  vigentes() {
    return this.C().documentosVigentes(this.cabs[this.base] || [], { ano: this.ano, dept: this.dept, base: this.base, versao: this.versao }).docs;
  },

  async lerLinhas(cab) {
    const fc = this.fc();
    const blocos = [];
    for (let b = 0; b < (cab.blocos || 1); b++) {
      const s = await fc.getDoc(fc.doc(window.firebaseDb, this.COL[this.base].itens, `${cab._id}_${b}`));
      if (s.exists()) blocos.push(s.data());
    }
    return this.C().juntarBlocos(blocos).itens;
  },

  async calcular() {
    const C = this.C(), R = this.R();
    this.carregando = true;
    this.erro = "";
    this.resultado = null;
    this.render();
    try {
      if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
      const ate = this.ate || R.ateMes(this.ano) || 12;
      const docs = this.vigentes();
      if (!docs.length) throw new Error(`Nenhum ${this.base === "forecast" ? "forecast" : "orçamento"} de despesas ou receitas de ${this.ano} no Integra. Faça a carga do Órion em Órion (transição) › Orçamentos e forecasts.`);
      this.passo = `Lendo ${docs.length} documento(s) do ${this.base === "forecast" ? "forecast" : "orçamento"}…`;
      this.render();
      const linhas = [], ccs = new Set();
      for (const cab of docs) {
        const sinal = String(cab.tipo).toUpperCase() === "RECEITAS" ? 1 : -1;
        (await this.lerLinhas(cab)).forEach((l) => { const cc = String(l.cc).replace(/\D/g, ""); ccs.add(cc); linhas.push(Object.assign({}, l, { cc, sinal })); });
      }
      const empresas = R.empresasDosCcs([...ccs]);
      if (!empresas.length) throw new Error("Não achei as empresas dos centros de custo do orçamento no cadastro de Centros de Custo do Integra.");
      this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`;
      this.render();
      const real = await R.buscar(Number(this.ano), ate, empresas);
      this.passo = `Lendo o realizado de ${Number(this.ano) - 1}…`;
      this.render();
      const realN1 = await R.buscar(Number(this.ano) - 1, ate, empresas);
      this.resultado = { bruto: true, linhas, real, realN1, ate, empresas, docs: docs.length, movimentos: real.movimentos, movimentosN1: realN1.movimentos };
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false;
    this.passo = "";
    this.render();
  },

  farol(s) {
    if (!s) return "";
    const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
    return `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:${cores[s.cor] || "#cbd5e1"};display:inline-block"></span>${this.esc(s.titulo)}</span>`;
  },

  agrupar: "visao",
  series: { real_mldu: true, n1: true, n1_mldu: true, ref: true, ref_mldu: true },
  ahavMensal: false,
  abertos: {},
  setAgrupar(v) { this.agrupar = v; this.abertos = {}; this.render(); },
  alternarSerie(k) { this.series[k] = !this.series[k]; this.render(); },
  alternarAhAv() { this.ahavMensal = !this.ahavMensal; this.render(); },
  alternar(id) { this.abertos[id] = !this.abertos[id]; this.render(); },
  expandir(abrir) {
    this.abertos = {};
    if (abrir && this.resultado) { const marca = (l) => l.forEach((x) => { if (x.filhos && x.filhos.length) { this.abertos[x.id] = true; marca(x.filhos); } }); marca(this.montar().empresas); }
    this.render();
  },

  fatorMldu(empresaId) {
    const fx = window.FluxoCaixaApp;
    const lista = fx && typeof fx.allCompanies === "function" ? fx.allCompanies() : [];
    const c = lista.find((x) => String(x.id) === String(empresaId));
    return c && c.consolidacao ? (Number(c.pct) || 0) / 100 : 0;
  },

  /** DFC gerencial mês a mês (formato atual do Órion), com os filtros de empresa e meses aplicados ao que já foi lido. */
  montar() {
    const C = this.C(), R = this.R(), F = window.OrionFiltros;
    const d = this.resultado;
    const ms = new Set(F.mesesAtivos(this, 12));
    const fl = (l) => l.filter((a) => ms.has(Number(a.mes)));
    const f = F.filtrarEmpresas(this, d.linhas, d.real.alocacoes), fN1 = F.filtrarEmpresas(this, [], d.realN1.alocacoes);
    const ref = f.linhas.map((l) => Object.assign({}, l, { m: (l.m || []).map((v, i) => (ms.has(i + 1) ? v : 0)) }));
    const mapa = F.mapaCcEmpresa();
    const cad = (window.OrionDepartamentosApp && window.OrionDepartamentosApp.dados && window.OrionDepartamentosApp.dados.itens) || {};
    const nomesCc = Object.assign({}, cad.nomesCc || {}), nomesPl = Object.assign({}, cad.nomesPlano || {});
    d.linhas.forEach((l) => { if (l.cc_nome) nomesCc[l.cc] = l.cc_nome; if (l.plano_nome) nomesPl[String(l.plano).replace(/\D/g, "")] = l.plano_nome; });
    return C.dfcGerencialMensal({
      real: fl(f.alocacoes), n1: fl(fN1.alocacoes), ref, grupos: R.grupos(), agrupar: this.agrupar,
      grupoDe: (p) => R.grupoDe(p),
      empresaDe: (cc, emp) => { const id = emp || mapa[cc] || "_sem"; return { id, nome: id === "_sem" ? "SEM EMPRESA NO CADASTRO" : String(F.nomeEmpresa(id) || "Empresa " + id).toUpperCase(), fator: this.fatorMldu(id) }; },
      nomeCc: (cc) => nomesCc[cc] || cc, nomePlano: (p) => nomesPl[p] || p
    });
  },

  htmlResultado() {
    const C = this.C();
    const d = this.resultado;
    const r = this.montar();
    const ano = Number(this.ano);
    const refT = this.base === "forecast" ? "FC" : "Orç";
    const SER = [["real", "Real", true], ["real_mldu", "MLDU"], ["n1", String(ano - 1)], ["n1_mldu", `${ano - 1} MLDU`], ["ref", refT], ["ref_mldu", `${refT} MLDU`]];
    const ativas = SER.filter(([k, , lock]) => lock || this.series[k]);
    const nCol = ativas.length + (this.ahavMensal ? 2 : 0);
    const v = (c) => { const x = C.reais(c); return Math.abs(x) < 0.5 ? "–" : `${x < 0 ? "-" : ""}${Math.abs(x).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`; };
    const pct = (x) => (x == null ? "–" : (x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
    const entMes = new Array(12).fill(0);
    r.empresas.forEach((e) => e.filhos.forEach((g) => g.real.forEach((y, i) => { if (y > 0) entMes[i] += y; })));
    const cel = (x) => {
      let h = "";
      for (let i = 0; i < 12; i++) {
        ativas.forEach(([k], j) => { h += `<td class="is-right${j === 0 ? " odf-ini" : ""}${x[k][i] < 0 ? " odf-neg" : ""}">${v(x[k][i])}</td>`; });
        if (this.ahavMensal) h += `<td class="is-right">${pct(x.ah_m ? x.ah_m[i] : null)}</td><td class="is-right">${pct(entMes[i] && x.real[i] ? x.real[i] / entMes[i] : null)}</td>`;
      }
      ativas.forEach(([k], j) => { h += `<td class="is-right${j === 0 ? " odf-ini" : ""}${x.total[k] < 0 ? " odf-neg" : ""}"><b>${v(x.total[k])}</b></td>`; });
      h += `<td class="is-right">${pct(x.ah)}</td><td class="is-right">${pct(x.av)}</td>`;
      return h;
    };
    const linha = (x, nivel) => {
      const tem = x.filhos && x.filhos.length;
      const ab = !!this.abertos[x.id];
      let out = `<tr class="odf-${x.tipo}" ${tem ? `onclick="OrionDfcApp.alternar('${this.esc(x.id)}')"` : ""}><td style="position:sticky;left:0;background:inherit;z-index:1;padding-left:${8 + nivel * 16}px">${tem ? (ab ? "▾ " : "▸ ") : ""}<span class="odf-cod">${this.esc(x.codigo)}</span>${this.esc(x.nome)}</td>${cel(x)}</tr>`;
      if (tem && ab) x.filhos.forEach((y) => { out += linha(y, nivel + 1); });
      return out;
    };
    const sub = ativas.map(([, t]) => `<th class="is-right">${this.esc(t)}</th>`).join("") + (this.ahavMensal ? '<th class="is-right">AH</th><th class="is-right">AV</th>' : "");
    const cab1 = C.MESES.map((m) => `<th class="odf-mes" colspan="${nCol}">${m}</th>`).join("") + `<th class="odf-mes" colspan="${ativas.length + 2}">Total ${ano}</th>`;
    const cab2 = new Array(12).fill(sub).join("") + ativas.map(([, t]) => `<th class="is-right">${this.esc(t)}</th>`).join("") + '<th class="is-right">AH %</th><th class="is-right">AV %</th>';
    const btn = (k, t, lock) => `<button type="button" class="btn ${lock || this.series[k] ? "btn-primary" : "btn-secondary"}" style="height:28px;padding:0 10px;font-size:0.7rem" ${lock ? "disabled" : `onclick="OrionDfcApp.alternarSerie('${k}')"`}>${this.esc(t)}</button>`;
    return `<style>.odf-tab td,.odf-tab th{white-space:nowrap;font-size:0.7rem;padding:4px 6px !important}.odf-tab tr.odf-empresa td{background:#e2e8f0 !important;font-weight:800;cursor:pointer}.odf-tab tr.odf-categoria td{background:#f1f5f9 !important;font-weight:700;cursor:pointer}.odf-tab tr.odf-total td{background:#105436 !important;color:#fff !important;font-weight:800}.odf-tab th.odf-mes{text-align:center;border-left:2px solid #cbd5e1}.odf-tab td.odf-ini{border-left:2px solid #e2e8f0}.odf-cod{color:#64748b;font-family:monospace;margin-right:6px}.odf-neg{color:#b91c1c}</style>
      <div style="font-size:0.72rem;color:#64748b;margin-bottom:6px">${this.base === "forecast" ? "Forecast " + this.esc(C.documentosVigentes(this.cabs.forecast || [], { ano: this.ano, base: "forecast", versao: this.versao }).versao) : "Orçado"} ${this.esc(this.ano)} · ${d.docs} documento(s) · realizado pela regra do Integra (caixa e bancos, visão DFC, empresas ${this.esc(d.empresas.join(", "))}) até ${C.MESES[d.ate - 1]} · ${d.movimentos} movimentos (${d.movimentosN1} em ${ano - 1}). MLDU = % de consolidação da empresa (cadastro de Empresas). Sinal da DFC: entradas +, saídas −.</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <span style="font-size:0.68rem;color:#64748b">AGRUPAR</span>
        <button type="button" class="btn ${this.agrupar === "visao" ? "btn-primary" : "btn-secondary"}" style="height:28px;font-size:0.7rem" onclick="OrionDfcApp.setAgrupar('visao')">Visão DFC <small>padrão</small></button>
        <button type="button" class="btn ${this.agrupar === "centro" ? "btn-primary" : "btn-secondary"}" style="height:28px;font-size:0.7rem" onclick="OrionDfcApp.setAgrupar('centro')">Centro de custo</button>
        <span style="font-size:0.68rem;color:#64748b;margin-left:10px">SÉRIES</span>${SER.map(([k, t, lock]) => btn(k, t === "Real" ? "Real cheio" : t, lock)).join("")}
        <button type="button" class="btn ${this.ahavMensal ? "btn-primary" : "btn-secondary"}" style="height:28px;font-size:0.7rem" onclick="OrionDfcApp.alternarAhAv()">AH/AV mensal</button>
        <button type="button" class="btn btn-secondary" style="height:28px;font-size:0.7rem;margin-left:auto" onclick="OrionDfcApp.expandir(true)">Expandir</button><button type="button" class="btn btn-secondary" style="height:28px;font-size:0.7rem" onclick="OrionDfcApp.expandir(false)">Recolher</button>
      </div>
      <div class="cc-scroll" style="max-height:70vh"><table class="cc-table odf-tab or-larga">
        <thead><tr><th rowspan="2" style="position:sticky;left:0;z-index:3;min-width:280px">EMPRESA / GRUPO / ${this.agrupar === "centro" ? "CENTRO DE CUSTO" : "PLANO"}</th>${cab1}</tr><tr>${cab2}</tr></thead>
        <tbody>${r.empresas.map((e) => linha(e, 0)).join("") || `<tr><td colspan="99" style="text-align:center;padding:30px">Sem movimento.</td></tr>`}
          <tr class="odf-total"><td style="position:sticky;left:0;background:#105436">Geração de caixa</td>${cel(r.total)}</tr></tbody></table></div>`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    const C = this.C();
    const l = this.cabs[this.base] || [];
    const anos = [...new Set(l.map((c) => c.ano))].sort((a, b) => b - a);
    if (!anos.length) anos.push(Number(this.ano));
    const depts = new Map();
    l.filter((c) => String(c.ano) === String(this.ano) && c.departamento).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
    const ateSug = (this.R() && this.R().ateMes(this.ano)) || 12;
    const ate = this.ate || ateSug;
    root.innerHTML = `${window.OrionFiltros.html(this, "OrionDfcApp", { anos, depts: [...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), versoes: C.versoesForecast(l, this.ano), empresas: this.resultado ? this.resultado.empresas : [], comMeses: !!this.resultado })}
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${this.resultado ? this.htmlResultado() : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha o ano, o mês final e o departamento e clique em Calcular. O realizado é lido do Sienge na hora e pode levar alguns minutos. Depois do cálculo dá para filtrar por empresa e por mês sem nova busca.</div>`)}`;
    if (this.resultado) window.OrionFiltros.bind(this, "OrionDfcApp", this.resultado.empresas);
  }
};

window.OrionDfcApp = OrionDfcApp;
