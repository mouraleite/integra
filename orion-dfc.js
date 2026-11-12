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

  /** DFC com os filtros de empresa e meses aplicados ao que já foi lido. */
  montar() {
    const C = this.C(), R = this.R(), F = window.OrionFiltros;
    const d = this.resultado;
    const ms = new Set(F.mesesAtivos(this, d.ate));
    const f = F.filtrarEmpresas(this, d.linhas, d.real.alocacoes), fN1 = F.filtrarEmpresas(this, [], d.realN1.alocacoes);
    const orcP = {}, orcA = {};
    f.linhas.forEach((l) => {
      const g = R.grupoDe(l.plano);
      if (!g) return;
      (l.m || []).forEach((v, i) => { const c = (Number(v) || 0) * l.sinal; orcA[g] = (orcA[g] || 0) + c; if (ms.has(i + 1)) orcP[g] = (orcP[g] || 0) + c; });
    });
    const porGrupo = (alocs) => { const out = {}; alocs.forEach((x) => { if (ms.has(x.mes)) out[x.gid] = (out[x.gid] || 0) + C.centavos(x.valor); }); return out; };
    const grupos = R.grupos();
    const dfc = C.dfcGerencial(grupos, orcP, porGrupo(f.alocacoes), porGrupo(fN1.alocacoes));
    const dfcAno = C.dfcGerencial(grupos, orcA, {}, {});
    const anoPor = Object.fromEntries(dfcAno.linhas.map((l) => [l.id, l.orcado]));
    dfc.linhas.forEach((l) => { l.orcado_ano = anoPor[l.id] || 0; });
    dfc.geracao.orcado_ano = dfcAno.geracao.orcado;
    return Object.assign(dfc, { ate: d.ate, meses: [...ms].sort((a, b) => a - b), empresas: this.empresas && this.empresas.length ? this.empresas : d.empresas, docs: d.docs, movimentos: d.movimentos, movimentosN1: d.movimentosN1 });
  },

  htmlResultado() {
    const C = this.C();
    const r = this.montar();
    if (!r) return "";
    const pct = (v) => (v == null ? "—" : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
    const f = (c) => C.fmtReais(c, true);
    const linhas = r.linhas.map((l) => `<tr class="${l.nivel === 1 ? "oo-grupo" : ""}">
      <td style="${l.nivel === 2 ? "padding-left:18px" : ""}">${this.esc(l.nome)}</td>
      <td class="is-right">${f(l.orcado_ano)}</td><td class="is-right">${f(l.orcado)}</td><td class="is-right">${f(l.realizado)}</td>
      <td class="is-right" style="color:${l.dif < 0 ? "#b91c1c" : "#105436"}">${f(l.dif)}</td><td>${this.farol(l.semaforo)}</td>
      <td class="is-right">${f(l.n1)}</td><td class="is-right">${pct(l.ah)}</td><td class="is-right">${pct(l.av)}</td></tr>`).join("");
    const g = r.geracao;
    return `<div style="font-size:0.72rem;color:#64748b;margin-bottom:6px">${r.meses.map((m) => C.MESES[m - 1]).join(", ")}/${this.esc(this.ano)}${this.base === "forecast" ? " · " + this.esc(C.documentosVigentes(this.cabs.forecast || [], { ano: this.ano, base: "forecast", versao: this.versao }).versao) : ""} · ${r.docs} documento(s) · realizado pela regra do Integra (caixa e bancos, visão DFC, 100% das empresas: ${this.esc(r.empresas.join(", "))}) · ${r.movimentos} movimentos (${r.movimentosN1} em ${Number(this.ano) - 1}). Sinal da DFC: entradas positivas, saídas negativas. AH = realizado contra realizado do ano anterior; AV = sobre o total de entradas realizado.</div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col><col style="width:120px"><col style="width:120px"><col style="width:120px"><col style="width:120px"><col style="width:160px"><col style="width:120px"><col style="width:80px"><col style="width:80px"></colgroup>
        <thead><tr><th>Grupo da DFC</th><th class="is-right">Orçado no ano</th><th class="is-right">Orçado no período</th><th class="is-right">Realizado</th><th class="is-right">Diferença</th><th>Semáforo</th><th class="is-right">Realizado ${Number(this.ano) - 1}</th><th class="is-right">AH</th><th class="is-right">AV</th></tr></thead>
        <tbody>${linhas}
          <tr class="oo-total"><td>Geração de caixa</td><td class="is-right">${f(g.orcado_ano)}</td><td class="is-right">${f(g.orcado)}</td><td class="is-right">${f(g.realizado)}</td><td class="is-right">${f(g.realizado - g.orcado)}</td><td>${this.farol(g.semaforo)}</td><td class="is-right">${f(g.n1)}</td><td class="is-right">${pct(g.n1 ? (g.realizado - g.n1) / Math.abs(g.n1) : null)}</td><td></td></tr>
        </tbody></table></div>`;
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
