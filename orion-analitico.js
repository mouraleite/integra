/* Órion (transição) › Analítico de gastos — vindo do ML Órion (Analítico de Gastos I e II).
 * Despesas orçadas (ou forecast) × realizadas mês a mês, com saldo, desvio % e semáforo.
 * Visão I: centro de custo × plano. Visão II: por plano, com os centros de custo dentro.
 * Clicando na seta de uma linha aparecem os pagamentos do caixa que formam o realizado (data, credor, documento, valor).
 * Orçado: documentos de despesas trazidos do Órion (versão vigente). Realizado: regra do Integra (orion-realizado.js). Só leitura. */
const OrionAnaliticoApp = {
  ano: String(new Date().getFullYear()),
  dept: "TODOS",
  ate: null,
  base: "orcamento",
  versao: "",
  empresas: [],
  meses: null,
  visao: "cc",
  conteudo: "despesas",   // despesas | receitas | investimentos | lotes (recortes do Órion)
  cabs: { orcamento: null, forecast: null },
  dados: null,      // { desp, real, ate, empresas, docs }
  abertos: {},
  carregando: false,
  erro: "",
  passo: "",

  COL: {
    orcamento: { cab: "orion_orcamentos", itens: "orion_orcamento_itens" },
    forecast: { cab: "orion_forecasts", itens: "orion_forecast_itens" }
  },

  C() { return window.OrionOrcamentoCalc; },
  R() { return window.OrionRealizado; },
  root() { return document.getElementById("orion-analitico-root"); },
  fc() { return window.firebaseCollections; },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  init() {
    this.estilos();
    this.render();
    if (!this.cabs[this.base]) this.lerCabecalhos();
  },

  estilos() {
    if (document.getElementById("oa-estilos")) return;
    const st = document.createElement("style");
    st.id = "oa-estilos";
    st.textContent = `
      .cc-table tr.oa-total td { background:#105436 !important; color:#fff !important; font-weight:700; }
      .cc-table tr.oa-cab td { border-top:2px solid #cfe3d8; }
      .cc-table tr.oa-sub td { background:#f8fafc; }
      .cc-table tr.oa-det td { background:#fffdf5 !important; font-size:0.7rem; }
      .oa-seta { cursor:pointer; border:none; background:none; font-size:0.85rem; color:#105436; padding:0 4px; }
      .oa-neg { color:#b91c1c; }
    `;
    document.head.appendChild(st);
  },

  lerCabecalhos() { return window.OrionResumoApp.lerCabecalhos.call(this); },
  tipoAtual() { const r = this.C().RECORTES[this.conteudo]; return r ? r.tipo : (this.conteudo === "receitas" ? "RECEITAS" : "DESPESAS"); },
  vigentes() { return window.OrionResumoApp.vigentes.call(this, [this.tipoAtual()]); },
  setConteudo(v) { this.conteudo = v; this.versao = ""; this.abertos = {}; this.limpar(); },
  lerLinhas(cab) { return window.OrionResumoApp.lerLinhas.call(this, cab); },

  limpar() { this.dados = null; this.meses = null; this.render(); },
  setAno(v) { this.ano = v; this.versao = ""; this.ate = null; this.limpar(); },
  setDept(v) { this.dept = v; this.limpar(); },
  setAte(v) { this.ate = Number(v) || null; this.limpar(); },
  setBase(v) { this.base = v; this.versao = ""; this.dados = null; this.meses = null; this.init(); },
  setVisao(v) { this.visao = v; this.abertos = {}; this.render(); },
  alternar(k) { this.abertos[k] = !this.abertos[k]; this.render(); },

  async calcular() {
    const R = this.R();
    this.carregando = true;
    this.erro = "";
    this.dados = null;
    this.render();
    try {
      if (!R) throw new Error("Arquivo do realizado não carregou. Recarregue a página.");
      if (!window.OrionResumoApp) throw new Error("Arquivo do resumo do orçamento não carregou. Recarregue a página.");
      const ate = this.ate || R.ateMes(this.ano) || 12;
      const docs = this.vigentes();
      if (!docs.length) throw new Error(`Nenhum ${this.base === "forecast" ? "forecast" : "orçamento"} de despesas de ${this.ano} no Integra (${this.tipoAtual().toLowerCase()}). Faça a carga do Órion em Órion (transição) › Orçamentos e forecasts.`);
      this.passo = `Lendo ${docs.length} documento(s)…`;
      this.render();
      const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
      const desp = [];
      for (const cab of docs) desp.push(...(await this.lerLinhas(cab)).map((l) => Object.assign({}, l, { cc: dig(l.cc), plano: dig(l.plano) })));
      const empresas = R.empresasDosCcs([...new Set(desp.map((l) => l.cc))]);
      if (!empresas.length) throw new Error("Não achei as empresas dos centros de custo do orçamento no cadastro de Centros de Custo do Integra.");
      this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`;
      this.render();
      const real = await R.buscar(Number(this.ano), ate, empresas);
      this.dados = { desp, real, ate, empresas, docs: docs.length, tipo: this.tipoAtual() };
      this.abertos = {};
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false;
    this.passo = "";
    this.render();
  },

  farol(s) {
    if (!s) return "";
    const cores = { azul: "#0ea5e9", cinza: "#cbd5e1", verde: "#10b981", amarelo: "#fbbf24", vermelho: "#ef4444" };
    return `<span title="${this.esc(s.titulo)}" style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:50%;background:${cores[s.cor] || "#cbd5e1"};display:inline-block"></span>${this.esc(s.titulo)}</span>`;
  },

  /** Quatro linhas por item, como no Órion: orçado, realizado, saldo (orçado − realizado) e desvio %. */
  linhasItem(x, ms, rotulo, nivel, temFilhos) {
    const C = this.C();
    const f = (c) => C.fmtReais(c, true);
    const ref = this.base === "forecast" ? "Forecast" : "Orçado";
    const pct = (o, r) => (o ? ((r - o) / Math.abs(o) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—");
    const ab = !!this.abertos[x.chave];
    const seta = `<button type="button" class="oa-seta" title="${temFilhos ? "Abrir os centros de custo" : "Ver os pagamentos do realizado"}" onclick="OrionAnaliticoApp.alternar('${this.esc(x.chave)}')">${ab ? "▾" : "▸"}</button>`;
    const cls = nivel === 2 ? "oa-sub" : "";
    const cel = (vals, tot, neg) => vals.map((v) => `<td class="is-right ${neg && v < 0 ? "oa-neg" : ""}">${f(v)}</td>`).join("") + `<td class="is-right ${neg && tot < 0 ? "oa-neg" : ""}"><b>${f(tot)}</b></td>`;
    const o = ms.map((m) => x.o[m - 1]), r = ms.map((m) => x.r[m - 1]);
    const rec = this.dados && this.dados.tipo === "RECEITAS";
    const s = ms.map((m) => (rec ? x.r[m - 1] - x.o[m - 1] : x.o[m - 1] - x.r[m - 1]));
    return `<tr class="oa-cab ${cls}"><td rowspan="4" style="vertical-align:top;${nivel === 2 ? "padding-left:22px" : ""}">${seta}${rotulo}<div style="margin-top:4px">${this.farol(x.semaforo)}</div></td><td>${ref}</td>${cel(o, x.orcado)}</tr>
      <tr class="${cls}"><td>Realizado</td>${cel(r, x.realizado)}</tr>
      <tr class="${cls}"><td>Saldo</td>${cel(s, x.saldo, true)}</tr>
      <tr class="${cls}"><td>Desvio %</td>${ms.map((m) => `<td class="is-right">${pct(x.o[m - 1], x.r[m - 1])}</td>`).join("")}<td class="is-right"><b>${pct(x.orcado, x.realizado)}</b></td></tr>`;
  },

  linhasDetalhe(x, ms, colspan) {
    const C = this.C(), R = this.R();
    const set = new Set(ms);
    const emp = this.empresas && this.empresas.length ? new Set(this.empresas.map(String)) : null;
    const rows = R.detalhe(this.dados.real, (a) => a.cc === x.cc && a.plano === x.plano && set.has(a.mes) && (!emp || emp.has(String(a.empresa))), this.dados.tipo === "RECEITAS" ? 1 : -1);
    if (!rows.length) return `<tr class="oa-det"><td colspan="${colspan}" style="padding-left:30px">Nenhum pagamento no realizado deste centro de custo e plano no período.</td></tr>`;
    const fmtD = (d) => (d ? d.split("-").reverse().join("/") : "—");
    const corpo = rows.map((p) => `<tr class="oa-det"><td style="padding-left:30px">${fmtD(p.data)} · ${this.esc(p.credor || "—")}</td><td colspan="${colspan - 2}">${this.esc(p.documento)}${p.titulo ? ` · título ${this.esc(p.titulo)}` : ""}${p.parcela ? ` · parcela ${this.esc(p.parcela)}` : ""} · empresa ${this.esc(p.empresa)}</td><td class="is-right">${C.fmtReais(C.centavos(p.valor), true)}</td></tr>`).join("");
    return corpo + `<tr class="oa-det"><td colspan="${colspan - 1}" style="padding-left:30px"><b>${rows.length} pagamento(s)</b> (valores rateados pelo plano e centro de custo do movimento)</td><td class="is-right"><b>${C.fmtReais(rows.reduce((s, p) => s + C.centavos(p.valor), 0), true)}</b></td></tr>`;
  },

  htmlResultado() {
    const C = this.C();
    const d = this.dados, F = window.OrionFiltros;
    const ms = F.mesesAtivos(this, d.ate);
    const f = F.filtrarEmpresas(this, C.filtrarRecorte(d.desp, this.conteudo), d.real.alocacoes);
    const a = C.analiticoGastos(f.linhas, f.alocacoes, ms, this.visao, d.tipo);
    const ehRec = d.tipo === "RECEITAS";
    const colspan = ms.length + 3;
    const nomeCc = (x) => `${this.esc(x.cc)} ${this.esc(x.cc_nome)}`;
    const nomePl = (x) => `${this.esc(x.plano)} ${this.esc(x.plano_nome)}${x.fora ? " <i>(sem orçado)</i>" : ""}`;
    let corpo = "";
    a.linhas.forEach((x) => {
      if (this.visao === "plano") {
        corpo += this.linhasItem(x, ms, `<b>${nomePl(x)}</b>`, 1, true);
        if (this.abertos[x.chave]) x.filhos.forEach((y) => {
          corpo += this.linhasItem(y, ms, nomeCc(y), 2, false);
          if (this.abertos[y.chave]) corpo += this.linhasDetalhe(y, ms, colspan);
        });
      } else {
        corpo += this.linhasItem(x, ms, `<b>${nomeCc(x)}</b><br>${nomePl(x)}`, 1, false);
        if (this.abertos[x.chave]) corpo += this.linhasDetalhe(x, ms, colspan);
      }
    });
    const t = a.total;
    const ref = this.base === "forecast" ? "Forecast" : "Orçado";
    const tot = (arr, v) => ms.map((m) => `<td class="is-right">${C.fmtReais(arr[m - 1], true)}</td>`).join("") + `<td class="is-right">${C.fmtReais(v, true)}</td>`;
    const pctT = t.orcado ? ((t.realizado - t.orcado) / Math.abs(t.orcado) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "—";
    return `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">${ms.map((m) => C.MESES[m - 1]).join(", ")}/${this.esc(this.ano)}${this.base === "forecast" ? " · " + this.esc(C.documentosVigentes(this.cabs.forecast || [], { ano: this.ano, base: "forecast", versao: this.versao, tipos: [d.tipo] }).versao) : ""} · ${d.docs} documento(s) de ${ehRec ? "receitas" : "despesas"}${C.RECORTES[this.conteudo] ? " · só planos de " + C.RECORTES[this.conteudo].rotulo.toLowerCase() : ""} · realizado pela regra do Integra (caixa e bancos, visão DFC; empresas ${this.esc(d.empresas.join(", "))}), só dos centros de custo e planos do orçamento.
        Total ${ref.toLowerCase()} ${C.fmtReais(t.orcado, true)} · realizado ${C.fmtReais(t.realizado, true)} · desvio ${pctT} · ${a.comDesvio} linha(s) com atenção ou acima do limite. ${ehRec ? `Saldo = realizado − ${ref.toLowerCase()} (negativo = recebeu menos).` : `Saldo = ${ref.toLowerCase()} − realizado (negativo = gastou mais).`}</div>
      <div class="cc-scroll" style="max-height:70vh"><table class="cc-table" style="min-width:${360 + ms.length * 96 + 110}px">
        <colgroup><col style="width:260px"><col style="width:90px">${ms.map(() => '<col style="width:96px">').join("")}<col style="width:110px"></colgroup>
        <thead><tr><th>${this.visao === "plano" ? "Plano / centro de custo" : "Centro de custo / plano"}</th><th>Métrica</th>${ms.map((m) => `<th class="is-right">${C.MESES[m - 1]}</th>`).join("")}<th class="is-right">Total</th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="${colspan}" style="text-align:center;padding:30px">Nenhuma linha${C.RECORTES[this.conteudo] ? " com plano de " + C.RECORTES[this.conteudo].rotulo.toLowerCase() : ""}.</td></tr>`}
          <tr class="oa-total"><td>Total</td><td>${ref}</td>${tot(t.o, t.orcado)}</tr>
          <tr class="oa-total"><td></td><td>Realizado</td>${tot(t.r, t.realizado)}</tr>
          <tr class="oa-total"><td></td><td>Saldo</td>${tot(t.o.map((v, i) => (ehRec ? t.r[i] - v : v - t.r[i])), t.saldo)}</tr></tbody>
      </table></div>`;
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
    const ate = this.ate || (this.R() && this.R().ateMes(this.ano)) || 12;
    const conteudos = [["despesas", "Despesas"], ["receitas", "Receitas"], ["investimentos", "Investimentos e participações"], ["lotes", "Receita de lotes"]];
    const visoes = `<div><label class="ml-emp-filter-label">Conteúdo</label><select class="idx-select" style="height:40px" onchange="OrionAnaliticoApp.setConteudo(this.value)">${conteudos.map(([v, t]) => `<option value="${v}" ${v === this.conteudo ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div style="display:flex;gap:6px">
          <button type="button" class="btn ${this.visao === "cc" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionAnaliticoApp.setVisao('cc')">I · Centro de custo e plano</button>
          <button type="button" class="btn ${this.visao === "plano" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionAnaliticoApp.setVisao('plano')">II · Por plano</button></div>`;
    root.innerHTML = `${window.OrionFiltros.html(this, "OrionAnaliticoApp", { anos, depts: [...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), versoes: C.versoesForecast(l, this.ano, [this.tipoAtual()]), empresas: this.dados ? this.dados.empresas : [], comMeses: !!this.dados, extra: visoes })}
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${this.dados ? this.htmlResultado() : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha o ano, o mês final e o departamento e clique em Calcular. O realizado é lido do Sienge na hora e pode levar alguns minutos. Depois do cálculo dá para filtrar por empresa e por mês sem nova busca.</div>`)}`;
    if (this.dados) window.OrionFiltros.bind(this, "OrionAnaliticoApp", this.dados.empresas);
  }
};

window.OrionAnaliticoApp = OrionAnaliticoApp;
