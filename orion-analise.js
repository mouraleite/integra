/* Órion (transição) › Análise de orçamento — igual à tela atual do ML Órion (Orçamento › Análise de Orçamento).
 * YTD = realizado do ano até o mês de corte; YTG = forecast do ano depois do corte; FY = YTD + YTG.
 * Comparado com o orçado (ou o forecast de mesma versão) do ano seguinte. Cheio e MLDU lado a lado (MLDU = % de consolidação
 * da empresa no cadastro de Empresas do Integra). Despesas ou receitas (filtro Tipo), sempre com o valor positivo.
 * Filtros: tipo, diretoria, departamento, empresas, grupo, empreendimento, ano, comparar com, versão e corte YTD.
 * Navegação na visão DFC do Integra: empresa › grupo › empreendimento › plano, mês a mês, com semáforo. Só leitura. */
const OrionAnaliseApp = {
  ano: String(new Date().getFullYear()),
  tipo: "DESPESAS", diretoria: "", dept: "TODOS", versao: "", base: "orcamento", corte: null, grupo: "", cc: "",
  empresas: [], empAberto: false, empBusca: "",
  series: { n: true, ref: true, n_mldu: false, ref_mldu: false }, colunas: "mensal",
  cabs: { orcamentos: null, forecasts: null },
  cadDep: null, fechamento: [],
  dados: null, abertos: {}, carregando: false, erro: "", passo: "",
  COL: { orcamentos: { cab: "orion_orcamentos", itens: "orion_orcamento_itens" }, forecasts: { cab: "orion_forecasts", itens: "orion_forecast_itens" } },
  MESES: ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"],

  C() { return window.OrionOrcamentoCalc; },
  R() { return window.OrionRealizado; },
  fc() { return window.firebaseCollections; },
  root() { return document.getElementById("orion-analise-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  init() { this.estilos(); this.render(); if (!this.cabs.orcamentos) this.lerCabecalhos(); },

  estilos() {
    if (document.getElementById("oan-estilos")) return;
    const st = document.createElement("style");
    st.id = "oan-estilos";
    st.textContent = `
      .oan-tab td, .oan-tab th { white-space:nowrap; font-size:0.7rem; padding:4px 6px !important; }
      .oan-tab tr.oan-empresa td { background:#e2e8f0 !important; font-weight:800; cursor:pointer; border-left:3px solid #105436; }
      .oan-tab tr.oan-grupo td { background:#f1f5f9 !important; font-weight:700; cursor:pointer; }
      .oan-tab tr.oan-centro td { background:#f8fafc !important; font-weight:600; cursor:pointer; }
      .oan-tab tr.oan-total td { background:#105436 !important; color:#fff !important; font-weight:800; }
      .oan-tab th.oan-mes { text-align:center; border-left:2px solid #cbd5e1; }
      .oan-tab td.oan-ini { border-left:2px solid #e2e8f0; }
      .oan-tab .oan-cod { color:#64748b; font-family:monospace; margin-right:6px; }
      .oan-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-bottom:12px; }
      .oan-card { border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; background:#fff; font-size:0.75rem; }
      .oan-card .l { display:flex; justify-content:space-between; padding:2px 0; }
      .oan-card .big { font-size:1.05rem; font-weight:800; }
      .oan-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px; vertical-align:middle; }
      .oan-neg { color:#b91c1c; }
      .oan-nav .btn, .oan-nav span { white-space:nowrap; }
      .oan-filtros { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:12px 14px; align-items:end; margin-bottom:12px; padding:14px 16px; border:1px solid #e2e8f0; border-radius:10px; background:#fff; }
      .oan-filtros .oan-sec { grid-column:1 / -1; font-size:0.66rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#105436; padding-bottom:4px; border-bottom:1px solid #eef2f7; }
      .oan-filtros .oan-sec + .oan-sec, .oan-filtros .oan-sec.oan-sec2 { margin-top:4px; }
      .oan-filtros .oan-f { min-width:0; }
      .oan-filtros .oan-f > label, .oan-filtros .oan-f > .ml-emp-filter-label { display:block; }
      .oan-filtros select.idx-select, .oan-filtros .oan-fake { width:100%; height:40px; box-sizing:border-box; }
      .oan-filtros .oan-fake { display:flex; align-items:center; padding:0 10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; color:#94a3b8; font-size:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .oan-filtros .ml-emp-filter { width:100%; max-width:none; min-width:0; flex:none; }
      .oan-filtros .ml-emp-filter-btn { height:40px; min-height:40px; box-sizing:border-box; }
      .oan-filtros .ml-emp-filter-panel { width:max-content; min-width:100%; max-width:min(640px, 90vw); }
      .oan-filtros .ml-emp-filter-item span { white-space:nowrap; }
      .oan-filtros .oan-seg { display:flex; width:100%; }
      .oan-filtros .oan-seg .btn { flex:1; height:40px; margin:0; padding:0 10px; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; white-space:nowrap; }
      .oan-filtros .oan-seg .btn:first-child { border-top-right-radius:0; border-bottom-right-radius:0; }
      .oan-filtros .oan-seg .btn:last-child { border-top-left-radius:0; border-bottom-left-radius:0; }
      .oan-filtros .oan-acao { display:flex; justify-content:flex-end; }
      .oan-filtros .oan-acao .btn { height:40px; width:100%; margin:0; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; }
      .oan-filtros .oan-span2 { grid-column:span 2; }
      @media (max-width: 1280px) { .oan-filtros { grid-template-columns:repeat(4, minmax(0, 1fr)); } }
      @media (max-width: 860px) { .oan-filtros { grid-template-columns:repeat(2, minmax(0, 1fr)); } .oan-filtros .oan-span2 { grid-column:1 / -1; } }
    `;
    document.head.appendChild(st);
  },

  async lerCabecalhos() {
    const fc = this.fc();
    if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
    try {
      for (const k of ["orcamentos", "forecasts"]) {
        const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.COL[k].cab));
        const l = [];
        snap.forEach((d) => l.push(d.data()));
        this.cabs[k] = l;
      }
      const anos = [...new Set(this.cabs.forecasts.concat(this.cabs.orcamentos).map((c) => c.ano))].sort((a, b) => b - a);
      if (anos.length && anos.indexOf(Number(this.ano)) < 0) this.ano = String(anos[0]);
      this.fechamento = (await window.OrionStore.ler("fechamento_meses", [])).itens || [];
      this.cadDep = (await window.OrionStore.ler("departamentos", null)).itens || null;
    } catch (e) { this.erro = e.message || String(e); }
    this.render();
  },

  limpar() { this.dados = null; this.abertos = {}; this.render(); },
  set(campo, v) { this[campo] = v; if (["ano"].indexOf(campo) >= 0) { this.versao = ""; this.corte = null; } if (campo === "diretoria") this.dept = "TODOS"; if (campo === "tipo") { this.versao = ""; this.grupo = ""; this.cc = ""; } if (["tipo", "ano", "dept", "diretoria", "versao", "base", "corte"].indexOf(campo) >= 0) this.limpar(); else this.render(); },
  alternarSerie(k) { this.series[k] = !this.series[k]; this.render(); },
  alternar(id) { this.abertos[id] = !this.abertos[id]; this.render(); },
  expandir(abrir) {
    this.abertos = {};
    if (abrir && this.dados) { const marca = (l) => l.forEach((x) => { if (x.filhos && x.filhos.length) { this.abertos[x.id] = true; marca(x.filhos); } }); marca(this.montar().empresas); }
    this.render();
  },

  corteAtual() { return this.corte != null ? Number(this.corte) : this.C().corteForecast(this.fechamento || [], this.ano); },

  /** Departamentos do filtro: um, ou os da diretoria, ou todos. */
  deptsFiltro() {
    if (this.dept && this.dept !== "TODOS") return [String(this.dept)];
    if (!this.diretoria || !this.cadDep) return null;
    return (this.cadDep.departamentos || []).filter((d) => String(d.diretoria || "") === this.diretoria).map((d) => String(d.id));
  },

  async lerLinhas(col, cab) {
    const fc = this.fc(), blocos = [];
    for (let b = 0; b < (cab.blocos || 1); b++) {
      const s = await fc.getDoc(fc.doc(window.firebaseDb, this.COL[col].itens, `${cab._id}_${b}`));
      if (s.exists()) blocos.push(s.data());
    }
    return this.C().juntarBlocos(blocos).itens;
  },

  async calcular() {
    const C = this.C(), R = this.R();
    this.carregando = true; this.erro = ""; this.dados = null; this.render();
    try {
      if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
      const ano = Number(this.ano), anoRef = ano + 1, tipo = this.tipo === "RECEITAS" ? "RECEITAS" : "DESPESAS", nomeT = tipo === "RECEITAS" ? "receitas" : "despesas";
      const depts = this.deptsFiltro();
      const doDept = (c) => !depts || depts.indexOf(String(c.departamento ? c.departamento.id : "")) >= 0;
      const fcN = C.documentosVigentes((this.cabs.forecasts || []).filter(doDept), { ano, base: "forecast", versao: this.versao, tipos: [tipo] });
      let ref, refDesc;
      if (this.base === "forecast") { ref = C.documentosVigentes((this.cabs.forecasts || []).filter(doDept), { ano: anoRef, base: "forecast", versao: fcN.versao, tipos: [tipo] }); refDesc = `forecast ${anoRef} (${ref.versao || "—"})`; }
      else { ref = C.documentosVigentes((this.cabs.orcamentos || []).filter(doDept), { ano: anoRef, base: "orcamento", tipos: [tipo] }); refDesc = `orçado ${anoRef}`; }
      const avisos = [];
      if (!fcN.docs.length) avisos.push(`Não há forecast de ${nomeT} de ${ano} — o YTG fica zerado.`);
      if (!ref.docs.length) avisos.push(this.base === "forecast" ? `Não há forecast de ${nomeT} em ${anoRef} com a descrição «${fcN.versao}».` : `Não há orçamento de ${nomeT} de ${anoRef} — a referência fica zerada.`);
      this.passo = "Lendo forecast e referência…"; this.render();
      const nfc = [], refL = [];
      for (const c of fcN.docs) nfc.push(...(await this.lerLinhas("forecasts", c)));
      for (const c of ref.docs) refL.push(...(await this.lerLinhas(this.base === "forecast" ? "forecasts" : "orcamentos", c)));
      const corte = this.corteAtual();
      const ccs = [...new Set(nfc.concat(refL).map((l) => String(l.cc).replace(/\D/g, "")))];
      const empresas = R.empresasDosCcs(ccs);
      let real = { alocacoes: [], movimentos: 0 };
      if (corte >= 1 && empresas.length) {
        this.passo = `Lendo o realizado de jan a ${this.MESES[corte - 1].toLowerCase()}/${ano} (${empresas.length} empresa(s))…`; this.render();
        real = await R.buscar(ano, corte, empresas);
      }
      this.dados = { tipo, nfc, refL, real, corte, empresas, versao: fcN.versao, refDesc, anoRef, avisos };
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false; this.passo = "";
    this.render();
  },

  fatorMldu(empresaId) {
    const fx = window.FluxoCaixaApp;
    const lista = fx && typeof fx.allCompanies === "function" ? fx.allCompanies() : [];
    const c = lista.find((x) => String(x.id) === String(empresaId));
    return c && c.consolidacao ? (Number(c.pct) || 0) / 100 : 0;
  },

  montar() {
    const C = this.C(), R = this.R(), F = window.OrionFiltros;
    const d = this.dados;
    let nfc = d.nfc, refL = d.refL, al = d.real.alocacoes;
    if (this.empresas.length) { const a = F.filtrarEmpresas(this, nfc, al); nfc = a.linhas; al = a.alocacoes; refL = F.filtrarEmpresas(this, refL, []).linhas; }
    if (this.cc) { const k = String(this.cc); nfc = nfc.filter((l) => String(l.cc).replace(/\D/g, "") === k); refL = refL.filter((l) => String(l.cc).replace(/\D/g, "") === k); }
    const grupos = {};
    (R.grupos() || []).forEach((g) => { if (g && g.id) grupos[g.id] = g; });
    const mapa = F.mapaCcEmpresa();
    return C.analiseOrcamentoAnual({
      n_fc: nfc, ref: refL, n_real: al, corte: d.corte, sinal: d.tipo === "RECEITAS" ? 1 : -1,
      grupoDe: (p) => { const gid = R.grupoDe(p); if (!gid || (this.grupo && gid !== this.grupo)) return null; const g = grupos[gid] || {}; return { id: gid, nome: g.name || g.nome || gid, codigo: g.code || g.codigo || "" }; },
      empresaDe: (cc) => { const id = mapa[cc] || "_sem"; return { id, nome: id === "_sem" ? "SEM EMPRESA NO CADASTRO" : String(F.nomeEmpresa(id) || "Empresa " + id).toUpperCase(), fator: this.fatorMldu(id) }; }
    });
  },

  farol(n, ref) {
    const s = this.C().semaforo(n, ref, (this.dados && this.dados.tipo) || this.tipo);
    const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
    return `<span class="oan-dot" style="background:${cores[s.cor]}" title="${this.esc(s.titulo)}"></span>`;
  },
  R$(c) { const C = this.C(); const v = C.reais(c); const t = Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); return `${v < -0.5 ? "-" : ""}R$ ${t}`; },

  htmlCards(a) {
    const d = this.dados;
    const card = (t, sub, p) => {
      const v = p.n - p.ref;
      return `<div class="oan-card"><div style="display:flex;justify-content:space-between"><div><b>${t}</b><div style="color:#64748b">${sub}</div></div>${this.farol(p.n, p.ref)}</div>
        <div class="l"><span>${this.esc(this.ano)}</span><span class="big">${this.R$(p.n)}</span></div>
        <div class="l"><span>${this.base === "forecast" ? "FC" : "ORÇ"} ${d.anoRef}</span><span>${this.R$(p.ref)}</span></div>
        <div class="l"><span>VAR</span><span class="${(d.tipo === "RECEITAS" ? v < 0 : v > 0) ? "oan-neg" : ""}">${this.R$(v)} ${p.ref ? ((v / Math.abs(p.ref)) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "100,0%"}</span></div></div>`;
    };
    const t = a.total.per, c = d.corte;
    return `<div class="oan-cards">${card("YTD", c ? `jan–${this.MESES[c - 1].toLowerCase()}` : "—", t.ytd)}${card("YTG", c < 12 ? `${this.MESES[c].toLowerCase()}–dez` : "—", t.ytg)}${card("FY", "YTD + YTG", t.fy)}</div>`;
  },

  htmlTabela(a) {
    const d = this.dados;
    const S = this.series;
    const refT = (this.base === "forecast" ? "FC " : "ORÇ ") + d.anoRef;
    const blocos = [];
    if (S.n || S.ref) blocos.push({ n: "n", r: "ref", tn: "REAL " + this.ano, tr: refT, tv: "VAR" });
    if (S.n_mldu || S.ref_mldu) blocos.push({ n: "n_mldu", r: "ref_mldu", tn: "MLDU REAL", tr: "MLDU " + refT, tv: "VAR MLDU" });
    const colsMes = blocos.reduce((s, b) => s + (S[b.n] ? 1 : 0) + (S[b.r] ? 1 : 0) + 1, 0);
    const c = d.corte;
    const per = this.colunas === "acumulado"
      ? [{ t: c ? `YTD (jan–${this.MESES[c - 1].toLowerCase()})` : "YTD", k: "ytd" }, { t: c < 12 ? `YTG (${this.MESES[c].toLowerCase()}–dez)` : "YTG", k: "ytg" }, { t: "FY", k: "fy" }]
      : this.MESES.map((m, i) => ({ t: m, i })).concat([{ t: "FY", k: "fy" }]);
    const cab1 = per.map((p) => `<th class="oan-mes" colspan="${colsMes}">${p.t}</th>`).join("");
    const sub = blocos.map((b) => `${S[b.n] ? `<th class="is-right">${b.tn}</th>` : ""}${S[b.r] ? `<th class="is-right">${b.tr}</th>` : ""}<th class="is-right">${b.tv}</th>`).join("");
    const cab2 = new Array(per.length).fill(sub).join("");
    const celulas = (x) => {
      let h = "";
      for (const p of per) {
        blocos.forEach((b, bi) => {
          const n = p.k ? x.per[p.k][b.n] : x[b.n][p.i], r = p.k ? x.per[p.k][b.r] : x[b.r][p.i];
          const ini = bi === 0 ? " oan-ini" : "";
          let first = true;
          const td = (v) => { const c = first ? ini : ""; first = false; return `<td class="is-right${c}${v < -0.5 ? " oan-neg" : ""}">${this.R$(v)}</td>`; };
          if (S[b.n]) h += td(n);
          if (S[b.r]) h += td(r);
          h += `<td class="is-right${first ? ini : ""}">${this.farol(n, r)}${this.R$(n - r)}</td>`;
        });
      }
      return h;
    };
    const linha = (x, nivel) => {
      const tem = x.filhos && x.filhos.length;
      const ab = !!this.abertos[x.id];
      const cls = { empresa: "oan-empresa", grupo: "oan-grupo", centro: "oan-centro" }[x.tipo] || "";
      let out = `<tr class="${cls}" ${tem ? `onclick="OrionAnaliseApp.alternar('${this.esc(x.id)}')"` : ""}><td style="position:sticky;left:0;background:inherit;z-index:1;padding-left:${8 + nivel * 16}px">${tem ? (ab ? "▾ " : "▸ ") : ""}<span class="oan-cod">${this.esc(x.codigo)}</span>${this.esc(x.nome)}</td>${celulas(x)}</tr>`;
      if (tem && ab) x.filhos.forEach((y) => { out += linha(y, nivel + 1); });
      return out;
    };
    const btnS = (k, t) => `<button type="button" class="btn ${S[k] ? "btn-primary" : "btn-secondary"}" style="height:28px;padding:0 10px;font-size:0.7rem" onclick="OrionAnaliseApp.alternarSerie('${k}')">${t}</button>`;
    return `<div class="oan-nav" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:6px 0"><b>Navegação</b><span style="font-size:0.7rem;color:#64748b">VISÃO DFC</span>
        <span style="margin-left:auto;font-size:0.7rem;color:#64748b">COLUNAS</span><button type="button" class="btn ${this.colunas === "mensal" ? "btn-primary" : "btn-secondary"}" style="height:28px;padding:0 10px;font-size:0.7rem" onclick="OrionAnaliseApp.set('colunas', 'mensal')">Mês a mês</button><button type="button" class="btn ${this.colunas === "acumulado" ? "btn-primary" : "btn-secondary"}" style="height:28px;padding:0 10px;font-size:0.7rem" onclick="OrionAnaliseApp.set('colunas', 'acumulado')">YTD · YTG · FY</button>
        <span style="margin-left:10px;font-size:0.7rem;color:#64748b">SÉRIES</span>${btnS("n", this.ano + " cheio")}${btnS("ref", refT + " cheio")}${btnS("n_mldu", this.ano + " MLDU")}${btnS("ref_mldu", refT + " MLDU")}
        <button type="button" class="btn btn-secondary" style="height:28px;font-size:0.7rem" onclick="OrionAnaliseApp.expandir(true)">Expandir</button><button type="button" class="btn btn-secondary" style="height:28px;font-size:0.7rem" onclick="OrionAnaliseApp.expandir(false)">Recolher</button></div>
      <div class="cc-scroll" style="max-height:68vh"><table class="cc-table oan-tab or-larga">
        <thead><tr><th rowspan="2" style="position:sticky;left:0;z-index:3;min-width:300px">EMPRESA / GRUPO / EMPREENDIMENTO</th>${cab1}</tr><tr>${cab2}</tr></thead>
        <tbody>${a.empresas.map((e) => linha(e, 0)).join("") || `<tr><td colspan="99" style="text-align:center;padding:30px">Sem ${d.tipo === "RECEITAS" ? "receitas" : "despesas"} para os filtros.</td></tr>`}
          <tr class="oan-total"><td style="position:sticky;left:0;background:#105436">TOTAL</td>${celulas(a.total)}</tr></tbody></table></div>`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    const C = this.C();
    const todos = (this.cabs.orcamentos || []).concat(this.cabs.forecasts || []);
    const anos = [...new Set(todos.map((c) => c.ano))].sort((a, b) => b - a);
    if (!anos.length) anos.push(Number(this.ano));
    const cad = this.cadDep || {};
    const diretorias = [...new Set((cad.departamentos || []).map((d) => d.diretoria).filter(Boolean))].sort();
    const deps = (cad.departamentos || []).filter((d) => !this.diretoria || d.diretoria === this.diretoria).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const vs = C.versoesForecast(this.cabs.forecasts || [], this.ano, [this.tipo]);
    const corte = this.corteAtual();
    const op = (v, t, sel) => `<option value="${this.esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${this.esc(t)}</option>`;
    const R = this.R();
    const grupos = this.dados && R ? (R.grupos() || []).filter((g) => g && g.id && g.type !== "formula") : [];
    const ccsDados = this.dados ? [...new Set(this.dados.nfc.concat(this.dados.refL).map((l) => String(l.cc).replace(/\D/g, "")))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })) : [];
    const nomesCc = cad.nomesCc || {};
    const empSlot = this.dados && window.MlEmpresaFilter ? window.MlEmpresaFilter.html({ id: "OrionAnaliseApp-emp", label: "Empresa", items: this.dados.empresas.map((id) => ({ id: String(id), label: `${id} - ${String(window.OrionFiltros.nomeEmpresa(id) || "").toUpperCase()}` })), selectedIds: this.empresas.length ? this.empresas : this.dados.empresas.map(String), open: !!this.empAberto, query: this.empBusca || "", emptyMeansAll: true }) : "";
    const seg = (campo, v, t, atual) => `<button type="button" class="btn ${atual === v ? "btn-primary" : "btn-secondary"}" onclick="OrionAnaliseApp.set('${campo}', '${v}')">${t}</button>`;
    const nomeT = this.tipo === "RECEITAS" ? "Receita" : "Despesa";
    const a = this.dados ? this.montar() : null;
    root.innerHTML = `
      <div style="font-size:0.8rem;color:#475569;margin-bottom:10px">YTD real ${this.esc(this.ano)}, YTG forecast, FY contra ${this.base === "forecast" ? "forecast" : "orçado"} ${Number(this.ano) + 1}. Cheio e MLDU lado a lado. ${nomeT} positiva.</div>
      <div class="oan-filtros">
        <div class="oan-sec">O que analisar</div>
        <div class="oan-f"><label class="ml-emp-filter-label">Tipo</label><select class="idx-select" onchange="OrionAnaliseApp.set('tipo', this.value)">${op("DESPESAS", "Despesas", this.tipo)}${op("RECEITAS", "Receitas", this.tipo)}</select></div>
        <div class="oan-f"><label class="ml-emp-filter-label">Diretoria</label><select class="idx-select" onchange="OrionAnaliseApp.set('diretoria', this.value)">${op("", "Todas", this.diretoria)}${diretorias.map((x) => op(x, x, this.diretoria)).join("")}</select></div>
        <div class="oan-f"><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" onchange="OrionAnaliseApp.set('dept', this.value)">${op("TODOS", "Todos", this.dept)}${deps.map((d) => op(d.id, d.nome, this.dept)).join("")}</select></div>
        <div class="oan-f" id="oan-emp">${empSlot || `<label class="ml-emp-filter-label">Empresa</label><div class="oan-fake" title="A lista de empresas aparece depois de calcular">Todas · calcule para filtrar</div>`}</div>
        <div class="oan-f"><label class="ml-emp-filter-label">Grupo</label>${this.dados ? `<select class="idx-select" onchange="OrionAnaliseApp.set('grupo', this.value)">${op("", "Todos", this.grupo)}${grupos.map((g) => op(g.id, `${g.code || g.codigo || ""} ${g.name || g.nome || g.id}`.trim(), this.grupo)).join("")}</select>` : `<div class="oan-fake">Todos · calcule para filtrar</div>`}</div>
        <div class="oan-f"><label class="ml-emp-filter-label">Empreendimento</label>${this.dados ? `<select class="idx-select" onchange="OrionAnaliseApp.set('cc', this.value)">${op("", "Todos", this.cc)}${ccsDados.map((c) => op(c, `${c} - ${nomesCc[c] || ""}`, this.cc)).join("")}</select>` : `<div class="oan-fake">Todos · calcule para filtrar</div>`}</div>
        <div class="oan-sec oan-sec2">Período e comparação</div>
        <div class="oan-f"><label class="ml-emp-filter-label">Ano</label><select class="idx-select" onchange="OrionAnaliseApp.set('ano', this.value)">${anos.map((x) => op(x, x, this.ano)).join("")}</select></div>
        <div class="oan-f"><label class="ml-emp-filter-label">Corte YTD</label><select class="idx-select" onchange="OrionAnaliseApp.set('corte', this.value)">${this.MESES.map((m, i) => op(i + 1, m.charAt(0) + m.slice(1).toLowerCase(), corte)).join("")}</select></div>
        <div class="oan-f"><label class="ml-emp-filter-label">Comparar com</label><div class="oan-seg">${seg("base", "orcamento", "Orçado", this.base)}${seg("base", "forecast", "Forecast", this.base)}</div></div>
        <div class="oan-f"><label class="ml-emp-filter-label">Versão do forecast</label><select class="idx-select" onchange="OrionAnaliseApp.set('versao', this.value)">${vs.map((v, i) => op(v.descricao, this.C().rotuloVersao(v.descricao, "forecast"), this.versao || (i === 0 ? v.descricao : ""))).join("") || "<option>sem forecast</option>"}</select></div>
        <div class="oan-f oan-acao oan-span2"><button type="button" class="btn btn-primary" style="max-width:220px" ${this.carregando ? "disabled" : ""} onclick="OrionAnaliseApp.calcular()">${this.carregando ? "Calculando..." : "Calcular"}</button></div>
      </div>
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.dados && this.dados.avisos.length ? `<div style="padding:8px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;margin-bottom:10px;font-size:0.78rem">${this.dados.avisos.map((x) => this.esc(x)).join("<br>")}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${a ? this.htmlCards(a) + `<div style="font-size:0.7rem;color:#64748b;margin:-4px 0 8px">SEMÁFORO <span class="oan-dot" style="background:#cbd5e1"></span>Imaterial (&lt; R$ 5 mil) <span class="oan-dot" style="background:#10b981"></span>Favorável ou ≤ 5% <span class="oan-dot" style="background:#fbbf24"></span>Atenção (≤ 10%) <span class="oan-dot" style="background:#ef4444"></span>Acima do limite <span class="oan-dot" style="background:#0ea5e9"></span>Novo · Referência: ${this.esc(this.dados.refDesc)} · forecast ${this.esc(this.dados.versao || "—")} · ${this.dados.real.movimentos} movimentos do caixa${a.semGrupo ? ` · ${a.semGrupo} linha(s) fora da visão DFC` : ""}</div>` + this.htmlTabela(a) : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha os filtros e clique em Calcular. O realizado é lido do Sienge na hora (até o corte).</div>`)}`;
    if (this.dados && window.OrionFiltros) window.OrionFiltros.bind(this, "OrionAnaliseApp", this.dados.empresas);
  }
};

window.OrionAnaliseApp = OrionAnaliseApp;
