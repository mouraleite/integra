/* Órion (transição) › Resumo do orçamento — vindo do ML Órion (Orçamento › Resumo geral / Dashboard de Orçamento).
 * Orçado (ou forecast) × realizado de despesas, receitas e resultado: cartões, mês a mês, 10 maiores desvios e detalhe
 * por centro de custo › plano, com o semáforo do Órion. Orçado: documentos trazidos do Órion (versão vigente).
 * Realizado: regra do Integra (orion-realizado.js), só dos centros de custo e planos que estão no orçamento. Só leitura. */
const OrionResumoApp = {
  ano: String(new Date().getFullYear()),
  dept: "TODOS",
  ate: null,
  base: "orcamento",
  versao: "",
  empresas: [],
  meses: null,
  cabs: { orcamento: null, forecast: null },
  resultado: null,
  abertos: {},
  carregando: false,
  erro: "",
  passo: "",

  C() { return window.OrionOrcamentoCalc; },
  R() { return window.OrionRealizado; },
  root() { return document.getElementById("orion-resumo-root"); },
  fc() { return window.firebaseCollections; },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  COL: {
    orcamento: { cab: "orion_orcamentos", itens: "orion_orcamento_itens" },
    forecast: { cab: "orion_forecasts", itens: "orion_forecast_itens" }
  },

  init() {
    this.estilos();
    this.render();
    if (!this.cabs[this.base]) this.lerCabecalhos();
  },

  estilos() {
    if (document.getElementById("or-estilos")) return;
    const st = document.createElement("style");
    st.id = "or-estilos";
    st.textContent = `
      .cc-table tr.or-total td { background:#105436 !important; color:#fff !important; font-weight:700; }
      .cc-table tr.or-grupo td { background:#e7f6ee !important; color:#105436 !important; font-weight:700; cursor:pointer; }
      .cc-table tr.or-fora td { color:#64748b; font-style:italic; }
      .or-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:12px; margin-bottom:14px; }
      .or-card { border:1px solid #d6e2db; border-radius:10px; padding:12px 14px; background:#fff; }
      .or-card h4 { margin:0 0 6px; font-size:0.78rem; color:#105436; text-transform:uppercase; letter-spacing:.03em; }
      .or-card .l { display:flex; justify-content:space-between; font-size:0.8rem; padding:2px 0; font-variant-numeric:tabular-nums; }
      .or-sec { font-size:0.85rem; font-weight:700; color:#105436; margin:16px 0 6px; }
      .or-neg { color:#b91c1c; }
    `;
    document.head.appendChild(st);
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
  alternar(k) { this.abertos[k] = !this.abertos[k]; this.render(); },

  /** Documentos que entram: do ano, sem substituídos; no forecast, só a versão escolhida (ou a mais recente). */
  vigentes(tipos) {
    return this.C().documentosVigentes(this.cabs[this.base] || [], { ano: this.ano, dept: this.dept, base: this.base, versao: this.versao, tipos }).docs;
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
      this.passo = `Lendo ${docs.length} documento(s)…`;
      this.render();
      const desp = [], rec = [], ccs = new Set();
      const dig = (v) => String(v == null ? "" : v).replace(/\D/g, "");
      for (const cab of docs) {
        const linhas = (await this.lerLinhas(cab)).map((l) => Object.assign({}, l, { cc: dig(l.cc), plano: dig(l.plano) }));
        linhas.forEach((l) => ccs.add(l.cc));
        (String(cab.tipo).toUpperCase() === "RECEITAS" ? rec : desp).push(...linhas);
      }
      // VGV orçado (documentos de vendas da mesma base e versão), para os indicadores
      const vendas = [];
      for (const cab of this.vigentes(["VENDAS"])) {
        const fc = this.fc(), blocos = [];
        for (let b = 0; b < (cab.blocos || 1); b++) { const sn = await fc.getDoc(fc.doc(window.firebaseDb, this.COL[this.base].itens, `${cab._id}_${b}`)); if (sn.exists()) blocos.push(sn.data()); }
        vendas.push(...this.C().juntarBlocos(blocos).vendas.map((v) => Object.assign({}, v, { cc: dig(v.cc) })));
      }
      const empresas = R.empresasDosCcs([...ccs]);
      if (!empresas.length) throw new Error("Não achei as empresas dos centros de custo do orçamento no cadastro de Centros de Custo do Integra.");
      this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`;
      this.render();
      const real = await R.buscar(Number(this.ano), ate, empresas);
      this.resultado = { desp, rec, vendas, real, ate, empresas, docs: docs.length, movimentos: real.movimentos };
      this.abertos = {};
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

  htmlResultado() {
    const C = this.C(), F = window.OrionFiltros;
    const d = this.resultado;
    const ms = F.mesesAtivos(this, d.ate);
    const fd = F.filtrarEmpresas(this, d.desp, d.real.alocacoes), fr = F.filtrarEmpresas(this, d.rec, d.real.alocacoes);
    const r = Object.assign(C.resumoGeral(fd.linhas, fr.linhas, fd.alocacoes, ms), { ate: d.ate, empresas: this.empresas && this.empresas.length ? this.empresas : d.empresas, docs: d.docs, movimentos: d.movimentos });
    const f = (c) => C.fmtReais(c, true);
    const pct = (v) => (v == null ? "—" : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
    const ref = this.base === "forecast" ? "Forecast" : "Orçado";
    const card = (titulo, k) => `<div class="or-card"><h4>${titulo}</h4>
      <div class="l"><span>${ref}</span><b>${f(k.orcado)}</b></div>
      <div class="l"><span>Realizado</span><b>${f(k.realizado)}</b></div>
      <div class="l"><span>Diferença</span><b class="${k.saldo < 0 ? "or-neg" : ""}">${f(k.saldo)} (${pct(k.perc)})</b></div>
      <div class="l"><span>Semáforo</span>${this.farol(k.semaforo)}</div></div>`;
    const mensal = r.mensal.filter((m) => m.usado).map((m) => `<tr>
      <td>${C.MESES[m.mes - 1]}</td>
      <td class="is-right">${f(m.rec_orcado)}</td><td class="is-right">${f(m.rec_realizado)}</td>
      <td class="is-right">${f(m.desp_orcado)}</td><td class="is-right">${f(m.desp_realizado)}</td>
      <td class="is-right">${f(m.res_orcado)}</td><td class="is-right ${m.res_realizado < 0 ? "or-neg" : ""}">${f(m.res_realizado)}</td></tr>`).join("");
    const k = r.kpis;
    const nome = (x) => `${this.esc(x.cc)} ${this.esc(x.cc_nome)}`;
    const ranking = r.ranking.map((x) => `<tr class="${x.fora ? "or-fora" : ""}">
      <td>${x.tipo === "RECEITAS" ? "Receita" : "Despesa"}</td><td>${nome(x)}</td><td>${this.esc(x.plano)} ${this.esc(x.plano_nome)}${x.fora ? " (sem orçado)" : ""}</td>
      <td class="is-right">${f(x.orcado)}</td><td class="is-right">${f(x.realizado)}</td><td class="is-right">${f(x.dif)}</td><td>${this.farol(x.semaforo)}</td></tr>`).join("");
    const det = r.grupos.map((g) => {
      const chave = g.tipo + "|" + g.cc;
      const ab = !!this.abertos[chave];
      const filhos = ab ? g.planos.map((x) => `<tr class="${x.fora ? "or-fora" : ""}"><td style="padding-left:24px">${this.esc(x.plano)} ${this.esc(x.plano_nome)}${x.fora ? " (sem orçado)" : ""}</td>
        <td class="is-right">${f(x.orcado)}</td><td class="is-right">${f(x.realizado)}</td><td class="is-right">${f(x.dif)}</td><td>${this.farol(x.semaforo)}</td></tr>`).join("") : "";
      return `<tr class="or-grupo" onclick="OrionResumoApp.alternar('${this.esc(chave)}')"><td>${ab ? "▾" : "▸"} ${g.tipo === "RECEITAS" ? "Receitas" : "Despesas"} · ${nome(g)}</td>
        <td class="is-right">${f(g.orcado)}</td><td class="is-right">${f(g.realizado)}</td><td class="is-right">${f(g.dif)}</td><td>${this.farol(g.semaforo)}</td></tr>${filhos}`;
    }).join("");
    return `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">${ms.map((m) => C.MESES[m - 1]).join(", ")}/${this.esc(this.ano)}${this.base === "forecast" ? " · " + this.esc(this.versaoAtual()) : ""} · ${r.docs} documento(s) · realizado pela regra do Integra (caixa e bancos, visão DFC; empresas ${this.esc(r.empresas.join(", "))}) só dos centros de custo e planos que estão no orçamento · ${r.movimentos} movimentos. Despesas aparecem positivas; resultado = receitas − despesas.</div>
      <div class="or-cards">${card("Receitas", k.receitas)}${card("Despesas", k.despesas)}${card("Resultado", k.resultado)}${this.cardVendas(ms)}</div>
      <div class="or-sec">Geração de caixa (receitas − despesas por mês)</div>
      ${this.grafico(r.mensal.filter((m) => m.usado), ref)}
      <div class="or-sec">Mês a mês</div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col style="width:70px"><col span="6" style="width:140px"></colgroup>
        <thead><tr><th>Mês</th><th class="is-right">Receitas ${ref.toLowerCase()}</th><th class="is-right">Receitas realizado</th><th class="is-right">Despesas ${ref.toLowerCase()}</th><th class="is-right">Despesas realizado</th><th class="is-right">Resultado ${ref.toLowerCase()}</th><th class="is-right">Resultado realizado</th></tr></thead>
        <tbody>${mensal}<tr class="or-total"><td>Total</td><td class="is-right">${f(k.receitas.orcado)}</td><td class="is-right">${f(k.receitas.realizado)}</td><td class="is-right">${f(k.despesas.orcado)}</td><td class="is-right">${f(k.despesas.realizado)}</td><td class="is-right">${f(k.resultado.orcado)}</td><td class="is-right">${f(k.resultado.realizado)}</td></tr></tbody>
      </table></div>
      <div class="or-sec">10 maiores desvios</div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col style="width:80px"><col><col><col style="width:130px"><col style="width:130px"><col style="width:130px"><col style="width:170px"></colgroup>
        <thead><tr><th>Tipo</th><th>Centro de custo</th><th>Plano</th><th class="is-right">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Diferença</th><th>Semáforo</th></tr></thead>
        <tbody>${ranking || `<tr><td colspan="7" style="text-align:center;padding:20px">Sem desvios.</td></tr>`}</tbody></table></div>
      <div class="or-sec">Detalhe por centro de custo › plano <span style="font-weight:400;color:#64748b;font-size:0.72rem">(clique no centro de custo para abrir)</span></div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col><col style="width:140px"><col style="width:140px"><col style="width:140px"><col style="width:170px"></colgroup>
        <thead><tr><th>Centro de custo / plano</th><th class="is-right">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Diferença</th><th>Semáforo</th></tr></thead>
        <tbody>${det}</tbody></table></div>`;
  },

  /** VGV, unidades e ticket médio orçados no período (documentos de vendas). O realizado de vendas ainda não tem fonte no Integra. */
  cardVendas(ms) {
    const C = this.C(), F = window.OrionFiltros;
    const d = this.resultado;
    const set = new Set(ms);
    let vs = (d.vendas || []).filter((v) => set.has(Number(v.mes)));
    if (this.empresas && this.empresas.length) { const mapa = F.mapaCcEmpresa(), emp = new Set(this.empresas.map(String)); vs = vs.filter((v) => emp.has(mapa[v.cc] || "")); }
    if (!vs.length) return "";
    const vgv = vs.reduce((s2, v) => s2 + (Number(v.vgv) || 0), 0), un = vs.reduce((s2, v) => s2 + (Number(v.vendas) || 0), 0);
    const ref = this.base === "forecast" ? "Forecast" : "Orçado";
    return `<div class="or-card"><h4>Vendas (${ref.toLowerCase()})</h4>
      <div class="l"><span>VGV</span><b>${C.fmtReais(vgv, true)}</b></div>
      <div class="l"><span>Unidades</span><b>${un.toLocaleString("pt-BR")}</b></div>
      <div class="l"><span>Ticket médio</span><b>${un ? C.fmtReais(Math.round(vgv / un), true) : "—"}</b></div>
      <div class="l" style="color:#64748b"><span>Realizado</span><span>ainda sem fonte no Integra</span></div></div>`;
  },

  /** Gráfico simples (SVG) da geração de caixa: barras orçado × realizado por mês e linha do acumulado realizado. */
  grafico(mensal, ref) {
    const C = this.C();
    if (!mensal.length) return "";
    const W = Math.max(1100, mensal.length * 90), H = 250, pad = 60, base = H - 28;
    const curto = (c) => { const v = C.reais(c), a = Math.abs(v); return (v < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi" : a >= 1e3 ? Math.round(a / 1e3).toLocaleString("pt-BR") + " mil" : Math.round(a).toLocaleString("pt-BR")); };
    let acc = 0;
    const acum = mensal.map((m) => (acc += m.res_realizado));
    const vals = mensal.flatMap((m) => [m.res_orcado, m.res_realizado]).concat(acum, [0]);
    const max = Math.max(...vals), min = Math.min(...vals);
    const esc = (v) => (max === min ? 0 : (v - min) / (max - min));
    const y = (v) => pad / 2 + (1 - esc(v)) * (base - pad / 2);
    const passo = (W - pad) / mensal.length, bw = Math.min(22, passo / 3);
    const barras = mensal.map((m, i) => {
      const x0 = pad + i * passo + passo / 2;
      const b = (v, x, cor, tit) => `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" fill="${cor}"><title>${tit}: ${C.fmtReais(v, true)}</title></rect>`;
      return b(m.res_orcado, x0 - bw - 1, "#94a3b8", `${C.MESES[m.mes - 1]} ${ref.toLowerCase()}`) + b(m.res_realizado, x0 + 1, m.res_realizado < 0 ? "#ef4444" : "#1b8253", `${C.MESES[m.mes - 1]} realizado`) +
        `<text x="${x0 + 1 + bw / 2}" y="${m.res_realizado < 0 ? y(m.res_realizado) + 12 : y(m.res_realizado) - 4}" font-size="10" font-weight="700" text-anchor="middle" fill="${m.res_realizado < 0 ? "#b91c1c" : "#105436"}">${curto(m.res_realizado)}</text>` +
        `<text x="${x0}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#475569">${C.MESES[m.mes - 1]}</text>`;
    }).join("");
    const linha = acum.map((v, i) => `${pad + i * passo + passo / 2},${y(v)}`).join(" ");
    return `<div class="cc-scroll" style="border:1px solid #e2e8f0;border-radius:8px;background:#fff;padding:6px 6px 0"><svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:300px;display:block" role="img" aria-label="Geração de caixa por mês">
        <line x1="${pad}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#cbd5e1"/>
        <text x="4" y="${y(max) + 4}" font-size="10" fill="#64748b">${C.fmtReais(max, true)}</text><text x="4" y="${y(min) + 4}" font-size="10" fill="#64748b">${C.fmtReais(min, true)}</text>
        ${barras}<polyline points="${linha}" fill="none" stroke="#f59e0b" stroke-width="2"/>${acum.map((v, i) => `<circle cx="${pad + i * passo + passo / 2}" cy="${y(v)}" r="3" fill="#f59e0b"><title>Acumulado realizado: ${C.fmtReais(v, true)}</title></circle>`).join("")}
      </svg><div style="font-size:0.7rem;color:#64748b;padding:2px 4px 6px"><span style="color:#94a3b8">■</span> ${ref} · <span style="color:#1b8253">■</span> Realizado · <span style="color:#f59e0b">●</span> Acumulado realizado · passe o mouse para ver os valores</div></div>`;
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
    root.innerHTML = `${window.OrionFiltros.html(this, "OrionResumoApp", { anos, depts: [...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), versoes: C.versoesForecast(l, this.ano), empresas: this.resultado ? this.resultado.empresas : [], comMeses: !!this.resultado })}
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${this.resultado ? this.htmlResultado() : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha o ano, o mês final e o departamento e clique em Calcular. O realizado é lido do Sienge na hora e pode levar alguns minutos. Depois do cálculo dá para filtrar por empresa e por mês sem nova busca.</div>`)}`;
    if (this.resultado) window.OrionFiltros.bind(this, "OrionResumoApp", this.resultado.empresas);
  },

  versaoAtual() { return this.C().documentosVigentes(this.cabs[this.base] || [], { ano: this.ano, base: this.base, versao: this.versao }).versao; }
};

window.OrionResumoApp = OrionResumoApp;
