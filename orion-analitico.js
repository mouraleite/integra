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
      .cc-table tr.oa-hl-favoravel td { background:#f0fdf4 !important; }
      .cc-table tr.oa-hl-material td { background:#fff7ed !important; }
      .cc-table tr.oa-hl-desfavoravel td { background:#fef2f2 !important; }
      .cc-table.oa-p2 th, .cc-table.oa-p2 td { white-space:nowrap; }
      .cc-table.oa-p2 .oa-m0 { border-left:1px solid #e2e8f0; }
      .cc-table.oa-p2 .oa-tt { background:#f1f5f9; font-weight:700; }
      .cc-table.oa-p2 .oa-tt0 { border-left:2px solid #cbd5e1; }
    `;
    document.head.appendChild(st);
  },

  lerCabecalhos() { return window.OrionResumoApp.lerCabecalhos.call(this); },
  tipoAtual() { const r = this.C().RECORTES[this.conteudo]; return r ? r.tipo : (this.conteudo === "receitas" ? "RECEITAS" : "DESPESAS"); },
  vigentes() { return window.OrionResumoApp.vigentes.call(this, [this.tipoAtual()]); },
  setConteudo(v) { this.conteudo = v; this.versao = ""; this.abertos = {}; if (this.visao === "grupo" && this.tipoAtual() !== "RECEITAS") this.visao = "cc"; this.limpar(); },
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
    const hl = C.destaqueLinha ? C.destaqueLinha(x.orcado, x.realizado, rec ? "RECEITAS" : "DESPESAS") : "";
    return `<tr class="oa-cab ${cls} ${hl ? "oa-hl-" + hl : ""}"><td rowspan="4" style="vertical-align:top;${nivel === 2 ? "padding-left:22px" : ""}">${seta}${rotulo}<div style="margin-top:4px">${this.farol(x.semaforo)}</div></td><td>${ref}</td>${cel(o, x.orcado)}</tr>
      <tr class="${cls}"><td>Realizado</td>${cel(r, x.realizado)}</tr>
      <tr class="${cls}"><td>Saldo</td>${cel(s, x.saldo, true)}</tr>
      <tr class="${cls}"><td>Desvio %</td>${ms.map((m) => `<td class="is-right">${pct(x.o[m - 1], x.r[m - 1])}</td>`).join("")}<td class="is-right"><b>${pct(x.orcado, x.realizado)}</b></td></tr>`;
  },

  /** Parcelas pagas do realizado agrupadas como no Órion (credor, documento, nº doc., autorização e o valor de cada mês). */
  tabelaParcelas(rows, ms, colspan, comCc, nomesCc) {
    const C = this.C();
    const rec = this.dados && this.dados.tipo === "RECEITAS";
    const g = new Map();
    rows.forEach((p) => {
      const k = [comCc ? p.cc : "", p.credor, p.doc_nome, p.doc_numero, p.titulo, p.autorizacao].join("|");
      if (!g.has(k)) g.set(k, { p, v: {}, t: 0 });
      const x = g.get(k), c = C.centavos(p.valor);
      x.v[p.mes] = (x.v[p.mes] || 0) + c; x.t += c;
    });
    const lin = [...g.values()].sort((a, b) => b.t - a.t);
    const f = (c) => C.fmtReais(c || 0, true);
    const MAX = 300;
    const totM = {}; let tot = 0;
    lin.forEach((x) => { ms.forEach((m) => { totM[m] = (totM[m] || 0) + (x.v[m] || 0); }); tot += x.t; });
    const th = "padding:5px 8px;font-size:0.66rem;text-transform:uppercase;font-weight:700;color:#105436;background:#e7f6ee;text-align:left;white-space:nowrap";
    const td = "padding:4px 8px;border-top:1px solid #eef4f0;font-size:0.72rem;white-space:nowrap";
    return `<tr class="oa-det"><td colspan="${colspan}" style="padding:8px 10px 10px 30px;background:#fbfdfc">
      <div style="display:inline-flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:800;color:#105436;text-transform:uppercase;margin-bottom:6px">🧾 ${rec ? "Parcelas recebidas — contas a receber" : "Parcelas pagas — contas a pagar"}</div>
      <div class="cc-scroll" style="max-height:340px;border:1px solid #dfe9e3;border-radius:8px;background:#fff"><table style="border-collapse:collapse;width:100%;min-width:max-content">
        <thead><tr>${comCc ? `<th style="${th}">Centro de custo</th>` : ""}<th style="${th}">${rec ? "Cliente" : "Credor"}</th><th style="${th}">Documento</th><th style="${th}">Nº doc.</th><th style="${th}">Autorização</th>${ms.map((m) => `<th style="${th};text-align:right">${C.MESES[m - 1]}</th>`).join("")}<th style="${th};text-align:right;border-left:1px solid #cfe0d6">Total</th></tr></thead>
        <tbody>${lin.slice(0, MAX).map(({ p, v, t }) => `<tr>${comCc ? `<td style="${td}" title="${this.esc(p.cc + " " + ((nomesCc && nomesCc.get(p.cc)) || ""))}">${this.esc(p.cc)} ${this.esc((nomesCc && nomesCc.get(p.cc)) || "")}</td>` : ""}<td style="${td};max-width:240px;overflow:hidden;text-overflow:ellipsis" title="${this.esc(p.credor || "")}">${this.esc(p.credor || "—")}</td>
          <td style="${td};max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${this.esc(p.doc_nome || p.documento || "")}">${this.esc(p.doc_nome || p.documento || "—")}</td><td style="${td}">${this.esc(p.doc_numero || p.titulo || "—")}</td>
          <td style="${td};max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${this.esc(p.autorizacao || "")}">${this.esc(p.autorizacao || "—")}</td>
          ${ms.map((m) => `<td style="${td};text-align:right">${f(v[m])}</td>`).join("")}<td style="${td};text-align:right;font-weight:700;border-left:1px solid #eef4f0">${f(t)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="${comCc ? 5 : 4}" style="${td};font-weight:800;background:#f7faf8">${lin.length} linha(s)${lin.length > MAX ? ` (mostrando ${MAX}; veja todas no Realizado CP)` : ""} · ${rows.length} pagamento(s), valores rateados pelo plano e centro de custo</td>${ms.map((m) => `<td style="${td};text-align:right;font-weight:800;background:#f7faf8">${f(totM[m])}</td>`).join("")}<td style="${td};text-align:right;font-weight:800;background:#f7faf8;border-left:1px solid #eef4f0">${f(tot)}</td></tr></tfoot></table></div></td></tr>`;
  },

  linhasDetalhe(x, ms, colspan) {
    const R = this.R();
    const set = new Set(ms);
    const emp = this.empresas && this.empresas.length ? new Set(this.empresas.map(String)) : null;
    const rows = R.detalhe(this.dados.real, (a) => a.cc === x.cc && a.plano === x.plano && set.has(a.mes) && (!emp || emp.has(String(a.empresa))), this.dados.tipo === "RECEITAS" ? 1 : -1);
    if (!rows.length) return `<tr class="oa-det"><td colspan="${colspan}" style="padding-left:30px">Nenhum pagamento no realizado deste centro de custo e plano no período.</td></tr>`;
    return this.tabelaParcelas(rows, ms, colspan, false);
  },

  /** Realizado detalhado (Órion: Realizado CP): todos os pagamentos/recebimentos do caixa que formam o realizado das linhas do orçamento. */
  htmlPagamentos() {
    const C = this.C(), R = this.R(), F = window.OrionFiltros;
    const d = this.dados;
    const ms = new Set(F.mesesAtivos(this, d.ate));
    const linhas = C.filtrarRecorte(d.desp, this.conteudo);
    const chaves = new Set(linhas.map((l) => l.cc + "|" + l.plano));
    const nomes = new Map(linhas.map((l) => [l.cc + "|" + l.plano, l]));
    const emp = this.empresas && this.empresas.length ? new Set(this.empresas.map(String)) : null;
    const q = String(this.buscaPag || "").trim().toLowerCase();
    let rows = R.detalhe(d.real, (a) => chaves.has(a.cc + "|" + a.plano) && ms.has(a.mes) && (!emp || emp.has(String(a.empresa))), d.tipo === "RECEITAS" ? 1 : -1);
    if (q) rows = rows.filter((p) => `${p.credor} ${p.documento} ${p.titulo} ${p.cc} ${p.plano} ${(nomes.get(p.cc + "|" + p.plano) || {}).cc_nome || ""} ${(nomes.get(p.cc + "|" + p.plano) || {}).plano_nome || ""}`.toLowerCase().indexOf(q) >= 0);
    const tot = rows.reduce((s2, p) => s2 + C.centavos(p.valor), 0);
    const MAX = 2000;
    const fmtD = (x) => (x ? x.split("-").reverse().join("/") : "—");
    const corpo = rows.slice(0, MAX).map((p) => { const l = nomes.get(p.cc + "|" + p.plano) || {}; return `<tr><td>${fmtD(p.data)}</td><td>${this.esc(p.empresa)}</td><td>${this.esc(p.cc)} ${this.esc(l.cc_nome || "")}</td><td>${this.esc(p.plano)} ${this.esc(l.plano_nome || "")}</td><td>${this.esc(p.credor || "—")}</td><td>${this.esc(p.doc_nome || p.documento || "—")}</td><td>${this.esc(p.doc_numero || p.titulo || "—")}${p.parcela ? "/" + this.esc(p.parcela) : ""}</td><td>${this.esc(p.autorizacao || "—")}</td><td class="is-right">${C.fmtReais(C.centavos(p.valor), true)}</td></tr>`; }).join("");
    return `<div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:8px"><div><label class="ml-emp-filter-label">Buscar</label><input id="oa-busca-pag" class="idx-select" style="height:40px;width:320px;box-sizing:border-box" placeholder="Buscar credor, documento ou nº…" value="${this.esc(this.buscaPag || "")}" oninput="OrionAnaliticoApp.setBuscaPag(this.value)"></div>
        <div style="font-size:0.75rem;color:#334155;padding-bottom:10px"><b>${rows.length}</b> lançamento(s) · total <b>${C.fmtReais(tot, true)}</b>${rows.length > MAX ? ` · mostrando os ${MAX} primeiros (use a busca)` : ""}. Valores rateados pelo centro de custo e plano do movimento, só das linhas do orçamento.</div></div>
      <div class="cc-scroll" style="max-height:70vh"><table class="cc-table">
        <colgroup><col style="width:90px"><col style="width:70px"><col style="width:220px"><col style="width:220px"><col><col style="width:150px"><col style="width:110px"><col style="width:150px"><col style="width:120px"></colgroup>
        <thead><tr><th>Data</th><th>Empresa</th><th>Centro de custo</th><th>Plano</th><th>${d.tipo === "RECEITAS" ? "Cliente" : "Credor"}</th><th>Documento</th><th>Nº doc.</th><th>Autorização</th><th class="is-right">Valor</th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="9" style="text-align:center;padding:30px">Nenhum lançamento.</td></tr>`}</tbody></table></div>`;
  },

  setBuscaPag(v) {
    this.buscaPag = v;
    this.render();
    const i = document.getElementById("oa-busca-pag");
    if (i) { i.focus(); i.setSelectionRange(v.length, v.length); }
  },

  /** Faixa de leitura executiva + legenda do semáforo (Órion: DesvioExecStrip + DesvioLegend). */
  htmlLeitura(itens, tipo) {
    const C = this.C();
    if (!itens.length || !C.leituraExecutiva) return "";
    const ref = this.base === "forecast" ? "forecast" : "orçado";
    const l = C.leituraExecutiva(itens, tipo, ref);
    const cor = l.favoravel ? "#1b8253" : "#ef4444";
    return `<div style="border:1px solid #e2e8f0;border-left:4px solid ${cor};border-radius:8px;padding:8px 12px;background:#fff;margin-bottom:6px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:0.8rem">
        <span><b>${this.esc(l.narrativa)}</b></span>
        <span>Realizado <b>${C.fmtReais(l.real, true)}</b> · ${ref} <b>${C.fmtReais(l.ref, true)}</b> · variação <b style="color:${l.favoravel ? "#105436" : "#b91c1c"}">${C.fmtReais(l.varRs, true)} (${(l.perc * 100).toFixed(1).replace(".", ",")}%)</b></span>
        <span style="color:#64748b">${l.comDesvioCount} linha(s) com desvio · ${l.materialCount} material(is) desfavorável(is)</span></div>
      <div style="font-size:0.68rem;color:#64748b;margin-bottom:8px">SEMÁFORO <span style="color:#cbd5e1">●</span> Imaterial (&lt; R$ 5 mil) <span style="color:#10b981">●</span> Favorável ou ≤ 5% <span style="color:#fbbf24">●</span> Atenção (≤ 10%) <span style="color:#ef4444">●</span> Acima do limite · fundo da linha: <span style="background:#f0fdf4;padding:0 4px">favorável</span> <span style="background:#fff7ed;padding:0 4px">desvio material</span> <span style="background:#fef2f2;padding:0 4px">desfavorável</span></div>`;
  },

  /** Analítico de Gastos II do Órion: uma linha por plano (todos os produtos somados), e por mês referência / realizado / variação. */
  htmlPlanoII(a, ms) {
    const C = this.C();
    const f = (c) => C.fmtReais(c, true);
    const ref = this.base === "forecast" ? "Forecast" : "Orçado";
    const rec = this.dados.tipo === "RECEITAS";
    const comTotal = ms.length > 1;
    const vr = (o, r) => (rec ? r - o : o - r);
    const cab1 = ms.map((m) => `<th colspan="3" class="is-center oa-m0">${C.MESES[m - 1]}</th>`).join("") + (comTotal ? `<th colspan="3" class="is-center oa-tt0">Total</th>` : "");
    const cab2 = ms.map(() => `<th class="is-right oa-m0">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Variação</th>`).join("") + (comTotal ? `<th class="is-right oa-tt0">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Variação</th>` : "");
    const ncol = 1 + ms.length * 3 + (comTotal ? 3 : 0);
    let corpo = "";
    a.linhas.forEach((x) => {
      const hl = C.destaqueLinha(x.orcado, x.realizado, rec ? "RECEITAS" : "DESPESAS");
      const ab = !!this.abertos[x.chave];
      corpo += `<tr class="${hl ? "oa-hl-" + hl : ""}"><td><button type="button" class="oa-seta" title="Ver os pagamentos do realizado deste plano" onclick="OrionAnaliticoApp.alternar('${this.esc(x.chave)}')">${ab ? "▾" : "▸"}</button>${this.esc(x.plano)} ${this.esc(x.plano_nome)}</td>
        ${ms.map((m) => { const v = vr(x.o[m - 1], x.r[m - 1]); return `<td class="is-right oa-m0">${f(x.o[m - 1])}</td><td class="is-right"><b>${f(x.r[m - 1])}</b></td><td class="is-right" style="color:${v >= 0 ? "#047857" : "#b91c1c"}">${f(v)}</td>`; }).join("")}
        ${comTotal ? (() => { const v = vr(x.orcado, x.realizado); return `<td class="is-right oa-tt oa-tt0">${f(x.orcado)}</td><td class="is-right oa-tt">${f(x.realizado)}</td><td class="is-right oa-tt" style="color:${v >= 0 ? "#047857" : "#b91c1c"}">${f(v)}</td>`; })() : ""}</tr>`;
      if (ab) corpo += this.linhasPagPlano(x, ms, ncol);
    });
    const t = a.total;
    const vt = (o, r) => vr(o, r);
    corpo += `<tr class="oa-total"><td>Total</td>${ms.map((m) => `<td class="is-right">${f(t.o[m - 1])}</td><td class="is-right">${f(t.r[m - 1])}</td><td class="is-right">${f(vt(t.o[m - 1], t.r[m - 1]))}</td>`).join("")}${comTotal ? `<td class="is-right">${f(t.orcado)}</td><td class="is-right">${f(t.realizado)}</td><td class="is-right">${f(vt(t.orcado, t.realizado))}</td>` : ""}</tr>`;
    return `<div class="cc-scroll" style="max-height:70vh"><table class="cc-table or-larga oa-p2">
      <thead><tr><th rowspan="2" style="min-width:280px">Plano financeiro</th>${cab1}</tr><tr>${cab2}</tr></thead><tbody>${corpo}</tbody></table></div>
      <div style="font-size:0.7rem;color:#64748b;margin-top:4px">Variação = ${rec ? "realizado − " + ref.toLowerCase() : ref.toLowerCase() + " − realizado"} (positivo = favorável). Clique na seta do plano para ver os pagamentos de todos os centros de custo.</div>`;
  },

  /** Pagamentos do realizado de um plano em todos os centros de custo da linha (Analítico II). */
  linhasPagPlano(x, ms, ncol) {
    const R = this.R();
    const set = new Set(ms), ccs = new Set((x.filhos || []).map((y) => y.cc));
    const nomes = new Map((x.filhos || []).map((y) => [y.cc, y.cc_nome]));
    const emp = this.empresas && this.empresas.length ? new Set(this.empresas.map(String)) : null;
    const rows = R.detalhe(this.dados.real, (a) => a.plano === x.plano && ccs.has(a.cc) && set.has(a.mes) && (!emp || emp.has(String(a.empresa))), this.dados.tipo === "RECEITAS" ? 1 : -1);
    if (!rows.length) return `<tr class="oa-det"><td colspan="${ncol}" style="padding-left:30px">Nenhum pagamento no realizado deste plano no período.</td></tr>`;
    return this.tabelaParcelas(rows, ms, ncol, true, nomes);
  },

  htmlResultado() {
    if (this.visao === "pagamentos") return this.htmlPagamentos();
    const C = this.C();
    const d = this.dados, F = window.OrionFiltros;
    const ms = F.mesesAtivos(this, d.ate);
    const f = F.filtrarEmpresas(this, C.filtrarRecorte(d.desp, this.conteudo), d.real.alocacoes);
    const a = C.analiticoGastos(f.linhas, f.alocacoes, ms, this.visao, d.tipo);
    const ehRec = d.tipo === "RECEITAS";
    const colspan = ms.length + 3;
    const folhas = this.visao === "cc" ? a.linhas : [].concat(...a.linhas.map((x) => x.filhos || []));
    const leitura = this.htmlLeitura(folhas, d.tipo);
    const nomeCc = (x) => `${this.esc(x.cc)} ${this.esc(x.cc_nome)}`;
    const nomePl = (x) => `${this.esc(x.plano)} ${this.esc(x.plano_nome)}${x.fora ? " <i>(sem orçado)</i>" : ""}`;
    let corpo = "";
    a.linhas.forEach((x) => {
      if (this.visao === "grupo") {
        corpo += this.linhasItem(x, ms, `<b>${this.esc(x.grupo)}</b>`, 1, true);
        if (this.abertos[x.chave]) x.filhos.forEach((y) => {
          corpo += this.linhasItem(y, ms, `${nomeCc(y)}<br>${nomePl(y)}`, 2, false);
          if (this.abertos[y.chave]) corpo += this.linhasDetalhe(y, ms, colspan);
        });
      } else if (this.visao === "plano") {
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
      ${leitura}
      ${this.visao === "plano" ? this.htmlPlanoII(a, ms) : `<div class="cc-scroll" style="max-height:70vh"><table class="cc-table or-larga">
        
        <thead><tr><th>${this.visao === "grupo" ? "Grupo de recebimento / centro de custo e plano" : this.visao === "plano" ? "Plano / centro de custo" : "Centro de custo / plano"}</th><th>Métrica</th>${ms.map((m) => `<th class="is-right">${C.MESES[m - 1]}</th>`).join("")}<th class="is-right">Total</th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="${colspan}" style="text-align:center;padding:30px">Nenhuma linha${C.RECORTES[this.conteudo] ? " com plano de " + C.RECORTES[this.conteudo].rotulo.toLowerCase() : ""}.</td></tr>`}
          <tr class="oa-total"><td>Total</td><td>${ref}</td>${tot(t.o, t.orcado)}</tr>
          <tr class="oa-total"><td></td><td>Realizado</td>${tot(t.r, t.realizado)}</tr>
          <tr class="oa-total"><td></td><td>Saldo</td>${tot(t.o.map((v, i) => (ehRec ? t.r[i] - v : v - t.r[i])), t.saldo)}</tr></tbody>
      </table></div>`}`;
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
    const F = window.OrionFiltros;
    const opV = [["cc", "I · Centro de custo e plano"], ["plano", "II · Por plano"], ["pagamentos", "Lançamentos (cada pagamento ou recebimento)"]].concat(this.tipoAtual() === "RECEITAS" ? [["grupo", "III · Por grupo de recebimento"]] : []);
    const visoes = [
      F.campo("Conteúdo", `<select class="idx-select" onchange="OrionAnaliticoApp.setConteudo(this.value)">${conteudos.map(([v, t]) => `<option value="${v}" ${v === this.conteudo ? "selected" : ""}>${t}</option>`).join("")}</select>`),
      F.campo("Visão", `<select class="idx-select" onchange="OrionAnaliticoApp.setVisao(this.value)">${opV.map(([v, t]) => `<option value="${v}" ${v === this.visao ? "selected" : ""}>${t}</option>`).join("")}</select>`, "ofg-span2")
    ];
    root.innerHTML = `${window.OrionFiltros.html(this, "OrionAnaliticoApp", { anos, depts: [...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), versoes: C.versoesForecast(l, this.ano, [this.tipoAtual()]), empresas: this.dados ? this.dados.empresas : [], comMeses: !!this.dados, campos: visoes })}
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${this.dados ? this.htmlResultado() : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha o ano, o mês final e o departamento e clique em Calcular. O realizado é lido do Sienge na hora e pode levar alguns minutos. Depois do cálculo dá para filtrar por empresa e por mês sem nova busca.</div>`)}`;
    if (this.dados) window.OrionFiltros.bind(this, "OrionAnaliticoApp", this.dados.empresas);
  }
};

window.OrionAnaliticoApp = OrionAnaliticoApp;
