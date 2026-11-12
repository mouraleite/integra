/* Órion (transição) › Análise de orçamento — vindo do ML Órion (Orçamento › Análise de Orçamento, despesas por empreendimento).
 * Árvore empresa › grupo da DFC do Integra › centro de custo › plano, com a projeção N (realizado até o mês de corte + forecast
 * nos meses seguintes) comparada com o orçado e com o forecast, no ano, no acumulado até o corte (YTD) e no restante (YTG).
 * Corte: último mês fechado em sequência na tela Fechamento de meses (mesma regra do Órion). Só leitura.
 * Diferença para o Órion: os grupos são os da visão DFC do Integra (regra do Integra), e não há visão MLDU (vem com a Consolidação). */
const OrionAnaliseApp = {
  ano: String(new Date().getFullYear()),
  dept: "TODOS",
  versao: "",
  periodo: "ano",
  empresas: [],
  cabs: { orcamentos: null, forecasts: null },
  dados: null,
  abertos: {},
  carregando: false,
  erro: "",
  passo: "",
  COL: {
    orcamentos: { cab: "orion_orcamentos", itens: "orion_orcamento_itens" },
    forecasts: { cab: "orion_forecasts", itens: "orion_forecast_itens" }
  },

  C() { return window.OrionOrcamentoCalc; },
  R() { return window.OrionRealizado; },
  fc() { return window.firebaseCollections; },
  root() { return document.getElementById("orion-analise-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  init() {
    this.estilos();
    this.render();
    if (!this.cabs.orcamentos) this.lerCabecalhos();
  },

  estilos() {
    if (document.getElementById("oan-estilos")) return;
    const st = document.createElement("style");
    st.id = "oan-estilos";
    st.textContent = `
      .cc-table tr.oan-empresa td { background:#105436 !important; color:#fff !important; font-weight:700; cursor:pointer; }
      .cc-table tr.oan-grupo td { background:#e7f6ee !important; color:#105436 !important; font-weight:700; cursor:pointer; }
      .cc-table tr.oan-centro td { background:#f8fafc !important; font-weight:600; cursor:pointer; }
      .cc-table tr.oan-total td { background:#0f3d27 !important; color:#fff !important; font-weight:800; }
      .oan-neg { color:#b91c1c; } .oan-pos { color:#105436; }
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
      const anos = [...new Set(this.cabs.orcamentos.concat(this.cabs.forecasts).map((c) => c.ano))].sort((a, b) => b - a);
      if (anos.length && anos.indexOf(Number(this.ano)) < 0) this.ano = String(anos[0]);
      const f = await window.OrionStore.ler("fechamento_meses", []);
      this.fechamento = f.itens || [];
    } catch (e) { this.erro = e.message || String(e); }
    this.render();
  },

  limpar() { this.dados = null; this.abertos = {}; this.render(); },
  setAno(v) { this.ano = v; this.versao = ""; this.limpar(); },
  setDept(v) { this.dept = v; this.limpar(); },
  setVersao(v) { this.versao = v; this.limpar(); },
  setPeriodo(v) { this.periodo = v; this.render(); },
  alternar(id) { this.abertos[id] = !this.abertos[id]; this.render(); },

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
    this.carregando = true;
    this.erro = "";
    this.dados = null;
    this.render();
    try {
      if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
      const o = { ano: this.ano, dept: this.dept, tipos: ["DESPESAS"] };
      const orcDocs = C.documentosVigentes(this.cabs.orcamentos || [], Object.assign({ base: "orcamento" }, o)).docs;
      const fv = C.documentosVigentes(this.cabs.forecasts || [], Object.assign({ base: "forecast", versao: this.versao }, o));
      if (!orcDocs.length && !fv.docs.length) throw new Error(`Nenhum orçamento ou forecast de despesas de ${this.ano} no Integra. Faça a carga em Órion (transição) › Carga do Órion.`);
      this.passo = `Lendo ${orcDocs.length + fv.docs.length} documento(s)…`;
      this.render();
      const orc = [], fcl = [];
      for (const c of orcDocs) orc.push(...(await this.lerLinhas("orcamentos", c)));
      for (const c of fv.docs) fcl.push(...(await this.lerLinhas("forecasts", c)));
      const corte = C.corteForecast(this.fechamento || [], this.ano);
      const ccs = [...new Set(orc.concat(fcl).map((l) => String(l.cc).replace(/\D/g, "")))];
      const empresas = R.empresasDosCcs(ccs);
      let real = { alocacoes: [], movimentos: 0 };
      if (corte >= 1 && empresas.length) {
        this.passo = `Lendo o realizado de jan a ${C.MESES[corte - 1]}/${this.ano} (${empresas.length} empresa(s))…`;
        this.render();
        real = await R.buscar(Number(this.ano), corte, empresas);
      }
      this.dados = { orc, fcl, real, corte, empresas, versao: fv.versao, docs: orcDocs.length + fv.docs.length };
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false;
    this.passo = "";
    this.render();
  },

  montar() {
    const C = this.C(), R = this.R(), F = window.OrionFiltros;
    const d = this.dados;
    const fo = F.filtrarEmpresas(this, d.orc, d.real.alocacoes), ff = F.filtrarEmpresas(this, d.fcl, []);
    const grupos = {};
    (R.grupos() || []).forEach((g) => { if (g && g.id) grupos[g.id] = g.name || g.nome || g.id; });
    const mapa = F.mapaCcEmpresa();
    return C.analiseOrcamento({
      orc: fo.linhas, fc: ff.linhas, alocacoes: fo.alocacoes, corte: d.corte,
      grupoDe: (p) => { const gid = R.grupoDe(p); return gid ? { id: gid, nome: grupos[gid] || gid } : null; },
      empresaDe: (cc) => { const id = mapa[cc] || "_sem"; return { id, nome: id === "_sem" ? "Sem empresa no cadastro" : `${id} - ${F.nomeEmpresa(id) || ""}`.trim() }; }
    });
  },

  htmlResultado() {
    const C = this.C();
    const d = this.dados;
    const a = this.montar();
    const p = this.periodo;
    const f = (c) => C.fmtReais(c, true);
    const pct = (v, ref) => (ref ? `${(((v - ref) / Math.abs(ref)) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
    const cls = (v) => (v > 0 ? "oan-neg" : v < 0 ? "oan-pos" : "");
    const linha = (x, nivel) => {
      const v = x[p];
      const temFilhos = x.filhos && x.filhos.length;
      const ab = !!this.abertos[x.id];
      const rot = `${temFilhos ? (ab ? "▾ " : "▸ ") : ""}${this.esc(x.nome)}`;
      let out = `<tr class="oan-${x.tipo}" ${temFilhos ? `onclick="OrionAnaliseApp.alternar('${this.esc(x.id)}')"` : ""}>
        <td style="padding-left:${8 + nivel * 16}px">${rot}</td>
        <td class="is-right"><b>${f(v.n)}</b></td><td class="is-right">${f(v.orcado)}</td>
        <td class="is-right ${cls(v.n - v.orcado)}">${f(v.n - v.orcado)}</td><td class="is-right ${cls(v.n - v.orcado)}">${pct(v.n, v.orcado)}</td>
        <td class="is-right">${f(v.forecast)}</td><td class="is-right ${cls(v.n - v.forecast)}">${f(v.n - v.forecast)}</td><td class="is-right ${cls(v.n - v.forecast)}">${pct(v.n, v.forecast)}</td>
        <td class="is-right">${f(v.realizado)}</td></tr>`;
      if (temFilhos && ab) x.filhos.forEach((y) => { out += linha(y, nivel + 1); });
      return out;
    };
    const t = a.total[p];
    const perTxt = { ano: "ano inteiro", ytd: `até ${d.corte ? C.MESES[d.corte - 1] : "—"} (YTD)`, ytg: `depois de ${d.corte ? C.MESES[d.corte - 1] : "—"} (YTG)` }[p];
    return `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">Corte: ${d.corte ? C.MESES[d.corte - 1] + "/" + this.esc(this.ano) : "nenhum mês fechado"} (Fechamento de meses) · N = realizado até o corte + forecast ${this.esc(d.versao || "")} depois · ${d.docs} documento(s) · ${d.real.movimentos} movimentos do caixa · período: ${perTxt}. Diferença positiva (vermelho) = gasto acima da referência.${a.semGrupo ? ` ${a.semGrupo} linha(s) com plano fora da visão DFC do Integra não entram.` : ""}</div>
      <div class="cc-scroll" style="max-height:72vh"><table class="cc-table">
        <colgroup><col><col style="width:130px"><col style="width:130px"><col style="width:120px"><col style="width:80px"><col style="width:130px"><col style="width:120px"><col style="width:80px"><col style="width:130px"></colgroup>
        <thead><tr><th>Empresa / grupo / centro de custo / plano</th><th class="is-right">N (projeção)</th><th class="is-right">Orçado</th><th class="is-right">N − orçado</th><th class="is-right">%</th><th class="is-right">Forecast</th><th class="is-right">N − forecast</th><th class="is-right">%</th><th class="is-right">Realizado</th></tr></thead>
        <tbody>${a.empresas.map((e) => linha(e, 0)).join("") || `<tr><td colspan="9" style="text-align:center;padding:30px">Sem despesas.</td></tr>`}
          <tr class="oan-total"><td>Total</td><td class="is-right">${f(t.n)}</td><td class="is-right">${f(t.orcado)}</td><td class="is-right">${f(t.n - t.orcado)}</td><td class="is-right">${pct(t.n, t.orcado)}</td><td class="is-right">${f(t.forecast)}</td><td class="is-right">${f(t.n - t.forecast)}</td><td class="is-right">${pct(t.n, t.forecast)}</td><td class="is-right">${f(t.realizado)}</td></tr>
        </tbody></table></div>`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    const C = this.C();
    const todos = (this.cabs.orcamentos || []).concat(this.cabs.forecasts || []);
    const anos = [...new Set(todos.map((c) => c.ano))].sort((a, b) => b - a);
    if (!anos.length) anos.push(Number(this.ano));
    const depts = new Map();
    todos.filter((c) => String(c.ano) === String(this.ano) && c.departamento).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
    const vs = C.versoesForecast(this.cabs.forecasts || [], this.ano, ["DESPESAS"]);
    const btn = (v, t) => `<button type="button" class="btn ${this.periodo === v ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionAnaliseApp.setPeriodo('${v}')">${t}</button>`;
    root.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px" onchange="OrionAnaliseApp.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:220px" onchange="OrionAnaliseApp.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Versão do forecast</label><select class="idx-select" style="height:40px;min-width:170px" onchange="OrionAnaliseApp.setVersao(this.value)">${vs.map((v, i) => `<option value="${this.esc(v.descricao)}" ${(this.versao ? v.descricao === this.versao : i === 0) ? "selected" : ""}>${this.esc(v.descricao)}${i === 0 ? " (mais recente)" : ""}</option>`).join("") || "<option>sem forecast</option>"}</select></div>
        <div style="display:flex;gap:6px">${btn("ano", "Ano")}${btn("ytd", "Até o corte (YTD)")}${btn("ytg", "Depois do corte (YTG)")}</div>
        <div id="oan-emp-slot"></div>
        <button type="button" class="btn btn-primary" style="height:40px;margin-left:auto" ${this.carregando ? "disabled" : ""} onclick="OrionAnaliseApp.calcular()">${this.carregando ? "Calculando..." : "Calcular"}</button>
      </div>
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${this.dados ? this.htmlResultado() : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha o ano, o departamento e a versão do forecast e clique em Calcular. O realizado é lido do Sienge na hora (até o mês de corte).</div>`)}`;
    if (this.dados && window.MlEmpresaFilter) {
      const slot = document.getElementById("oan-emp-slot");
      if (slot) {
        const F = window.OrionFiltros;
        slot.innerHTML = window.MlEmpresaFilter.html({ id: "OrionAnaliseApp-emp", label: "Empresas", items: this.dados.empresas.map((id) => ({ id: String(id), label: `${id} - ${String(F.nomeEmpresa(id) || "").toUpperCase()}` })), selectedIds: this.empresas.length ? this.empresas : this.dados.empresas.map(String), open: !!this.empAberto, query: this.empBusca || "", emptyMeansAll: true });
        F.bind(this, "OrionAnaliseApp", this.dados.empresas);
      }
    }
  }
};

window.OrionAnaliseApp = OrionAnaliseApp;
