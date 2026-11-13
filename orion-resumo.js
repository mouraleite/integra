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
  grafVisao: "resultado",

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
      // a outra base (orçado ou forecast), para os gráficos de despesas, receitas e VGV mostrarem orçado, forecast e realizado juntos, como no Órion
      const outro = await this.lerOutraBase(dig);
      const empresas = R.empresasDosCcs([...ccs]);
      if (!empresas.length) throw new Error("Não achei as empresas dos centros de custo do orçamento no cadastro de Centros de Custo do Integra.");
      this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`;
      this.render();
      const real = await R.buscar(Number(this.ano), ate, empresas);
      this.resultado = { desp, rec, vendas, real, ate, empresas, docs: docs.length, movimentos: real.movimentos, outro };
      this.abertos = {};
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false;
    this.passo = "";
    this.render();
  },

  /** Documentos vigentes da outra base (se a tela está no orçado, o forecast mais recente; se está no forecast, o orçado). */
  async lerOutraBase(dig) {
    const C = this.C(), fc = this.fc();
    const outra = this.base === "forecast" ? "orcamento" : "forecast";
    try {
      if (!this.cabs[outra]) { const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.COL[outra].cab)); const l = []; snap.forEach((d) => l.push(d.data())); this.cabs[outra] = l; }
      const v = C.documentosVigentes(this.cabs[outra], { ano: this.ano, dept: this.dept, base: outra, versao: "", tipos: ["DESPESAS", "RECEITAS", "VENDAS"] });
      const o = { base: outra, versao: v.versao, desp: [], rec: [], vendas: [] };
      for (const cab of v.docs) {
        const blocos = [];
        for (let b = 0; b < (cab.blocos || 1); b++) { const sn = await fc.getDoc(fc.doc(window.firebaseDb, this.COL[outra].itens, `${cab._id}_${b}`)); if (sn.exists()) blocos.push(sn.data()); }
        const j = C.juntarBlocos(blocos), t = String(cab.tipo).toUpperCase();
        if (t === "VENDAS") o.vendas.push(...(j.vendas || []).map((x) => Object.assign({}, x, { cc: dig(x.cc) })));
        else (t === "RECEITAS" ? o.rec : o.desp).push(...j.itens.map((l) => Object.assign({}, l, { cc: dig(l.cc), plano: dig(l.plano) })));
      }
      return o;
    } catch (e) { return null; }
  },

  setGraf(v) { this.grafVisao = v; this.render(); },

  /** Valor curto para rótulos de gráfico (R$ 1,2 mi / 350 mil). */
  curto(c) { const v = this.C().reais(c), a = Math.abs(v); return (v < 0 ? "-" : "") + (a >= 1e6 ? (a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi" : a >= 1e3 ? Math.round(a / 1e3).toLocaleString("pt-BR") + " mil" : Math.round(a).toLocaleString("pt-BR")); },

  /** Barras agrupadas por mês (SVG). series: [{ nome, cor, v[12] }]; mesesAtivos: meses do filtro (os outros ficam apagados, como no Órion). */
  barrasMes(series, mesesAtivos, rotuloSerie) {
    const C = this.C();
    const W = 1100, H = 280, padL = 70, base = H - 30, top = 18;
    const vals = series.flatMap((s2) => s2.v).concat([0]);
    const max = Math.max(...vals), min = Math.min(...vals);
    const y = (v) => top + (max === min ? 0 : (max - v) / (max - min)) * (base - top);
    const passo = (W - padL) / 12, bw = Math.min(24, (passo - 14) / series.length);
    const ativo = new Set(mesesAtivos);
    let svg = `<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#cbd5e1"/>`;
    [max, (max + min) / 2, min].forEach((t) => { svg += `<text x="${padL - 6}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="#64748b">${this.curto(t)}</text><line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="#f1f5f9"/>`; });
    for (let i = 0; i < 12; i++) {
      const x0 = padL + i * passo + (passo - bw * series.length) / 2, op = ativo.has(i + 1) ? 1 : 0.25;
      series.forEach((s2, k) => {
        const v = s2.v[i] || 0, x = x0 + k * bw;
        svg += `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${bw - 2}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" fill="${s2.cor}" fill-opacity="${op}" rx="2"><title>${C.MESES[i]} · ${s2.nome}: ${C.fmtReais(v, true)}</title></rect>`;
        if (k === rotuloSerie && v && ativo.has(i + 1)) svg += `<text x="${x + (bw - 2) / 2}" y="${v < 0 ? y(v) + 11 : y(v) - 3}" font-size="9" font-weight="700" text-anchor="middle" fill="#0f172a">${this.curto(v)}</text>`;
      });
      svg += `<text x="${padL + i * passo + passo / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#475569">${C.MESES[i]}</text>`;
    }
    const leg = series.map((s2) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><span style="width:10px;height:10px;border-radius:2px;background:${s2.cor}"></span>${this.esc(s2.nome)}</span>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:320px;display:block">${svg}</svg><div style="font-size:0.72rem;color:#475569;padding:2px 4px 6px">${leg}<span style="color:#94a3b8">passe o mouse nas barras para ver o valor</span></div>`;
  },

  /** Cascata do resultado: referência → variação das receitas → variação das despesas → realizado (regra do Órion). */
  cascata(refTot, realTot, varRec, varDesp, ref) {
    const C = this.C();
    const passos = [
      { nome: ref, ini: 0, fim: refTot, val: refTot, cor: "#64748b" },
      { nome: "Var. receitas", ini: refTot, fim: refTot + varRec, val: varRec, cor: varRec >= 0 ? "#2E864D" : "#FF5144" },
      { nome: "Var. despesas", ini: refTot + varRec, fim: refTot + varRec + varDesp, val: varDesp, cor: varDesp >= 0 ? "#2E864D" : "#FF5144" },
      { nome: "Realizado", ini: 0, fim: realTot, val: realTot, cor: "#2E864D" }
    ];
    const W = 420, H = 280, padL = 66, base = H - 30, top = 20;
    const vals = passos.flatMap((p) => [p.ini, p.fim]).concat([0]);
    const max = Math.max(...vals), min = Math.min(...vals);
    const y = (v) => top + (max === min ? 0 : (max - v) / (max - min)) * (base - top);
    const passo = (W - padL) / passos.length, bw = passo * 0.55;
    let svg = `<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#cbd5e1"/>`;
    [max, min].forEach((t) => { svg += `<text x="${padL - 6}" y="${y(t) + 4}" font-size="10" text-anchor="end" fill="#64748b">${this.curto(t)}</text>`; });
    passos.forEach((p, i) => {
      const x = padL + i * passo + (passo - bw) / 2, y1 = y(Math.max(p.ini, p.fim)), y2 = y(Math.min(p.ini, p.fim));
      svg += `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(1, y2 - y1)}" fill="${p.cor}" rx="3"><title>${p.nome}: ${C.fmtReais(p.val, true)}</title></rect>`;
      svg += `<text x="${x + bw / 2}" y="${y1 - 5}" font-size="10" font-weight="700" text-anchor="middle" fill="#0f172a">${this.curto(p.val)}</text>`;
      svg += `<text x="${x + bw / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#475569">${p.nome}</text>`;
      if (i < passos.length - 1) { const prox = padL + (i + 1) * passo + (passo - bw) / 2; svg += `<line x1="${x + bw}" x2="${prox}" y1="${y(p.fim)}" y2="${y(p.fim)}" stroke="#94a3b8" stroke-dasharray="3 3"/>`; }
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-height:320px;display:block">${svg}</svg>`;
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
    // ----- faixa do resultado e leitura (como o Dashboard de Orçamento do Órion) -----
    const kr = k.resultado, varRs = kr.realizado - kr.orcado;
    const percR = kr.orcado ? varRs / Math.abs(kr.orcado) : 0;
    const fav = varRs >= 0, material = Math.abs(percR) >= 0.05;
    const percD = k.despesas.orcado ? (k.despesas.realizado - k.despesas.orcado) / Math.abs(k.despesas.orcado) : 0;
    const vendasRef = this.vendasMes(d.vendas), vgvRef = vendasRef.vgv.filter((_, i) => ms.indexOf(i + 1) >= 0).reduce((a, b) => a + b, 0), unRef = vendasRef.un.filter((_, i) => ms.indexOf(i + 1) >= 0).reduce((a, b) => a + b, 0);
    const hero = `<div style="display:grid;grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:12px;margin-bottom:10px">
        <div style="border:1px solid #e2e8f0;border-left:4px solid ${fav ? "#1b8253" : "#ef4444"};border-radius:10px;padding:10px 14px;background:#fff">
          <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase">Resultado líquido · comparação no período filtrado</div>
          <div style="display:flex;gap:22px;align-items:baseline;flex-wrap:wrap;margin-top:4px">
            <div><div style="font-size:0.7rem;color:#64748b">Realizado</div><div style="font-size:1.35rem;font-weight:800">${f(kr.realizado)}</div></div>
            <div><div style="font-size:0.7rem;color:#64748b">${ref}</div><div style="font-size:1rem;font-weight:700;color:#475569">${f(kr.orcado)}</div></div>
            <div><div style="font-size:0.7rem;color:#64748b">Variação</div><div style="font-size:1rem;font-weight:800;color:${fav ? "#105436" : "#b91c1c"}">${f(varRs)} (${pct(percR)})</div></div>
            <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:99px;background:${fav ? "#dcfce7" : "#fee2e2"};color:${fav ? "#105436" : "#b91c1c"}">${fav ? "Favorável" : "Desfavorável"}</span>
            ${material ? `<span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:99px;background:#fef3c7;color:#92400e">Material (≥ 5%)</span>` : ""}
          </div></div>
        ${[["Despesas (realizado)", k.despesas, true, "orion-analitico", "Analítico de gastos", "Analítico →"], ["Receitas (realizado)", k.receitas, false, "orion-analitico", "Analítico de gastos", "Receitas →"]].map(([t, x, inv, tab, tit, lk]) => {
          const pv = x.orcado ? (x.realizado - x.orcado) / Math.abs(x.orcado) : 0, bom = inv ? pv <= 0 : pv >= 0;
          return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;background:#fff"><div style="font-size:0.68rem;color:#64748b;text-transform:uppercase">${t}</div>
            <div style="font-size:1.1rem;font-weight:800">${f(x.realizado)}</div><div style="font-size:0.72rem;color:#64748b">${ref}: ${f(x.orcado)} · <b style="color:${bom ? "#105436" : "#b91c1c"}">${pct(pv)}</b></div>
            <a style="font-size:0.72rem;font-weight:700;color:#105436;cursor:pointer" onclick="switchTab('${tab}', '${tit} (Órion)')">${lk}</a></div>`;
        }).join("")}
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;background:#fff"><div style="font-size:0.68rem;color:#64748b;text-transform:uppercase">VGV (${ref.toLowerCase()})</div>
          <div style="font-size:1.1rem;font-weight:800">${f(vgvRef)}</div><div style="font-size:0.72rem;color:#64748b">Realizado: ainda sem fonte no Integra</div>
          <a style="font-size:0.72rem;font-weight:700;color:#105436;cursor:pointer" onclick="switchTab('orion-oxr', 'Orçado × Realizado (Órion)')">Vendas →</a></div></div>
      <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:0.72rem;color:#64748b;margin-bottom:8px">
        <span>Unidades (${ref.toLowerCase()}): <b style="color:#0f172a">${unRef.toLocaleString("pt-BR")}</b></span>
        <span>Ticket médio (${ref.toLowerCase()}): <b style="color:#0f172a">${unRef ? f(Math.round(vgvRef / unRef)) : "—"}</b></span>
        <a style="font-weight:700;color:#105436;cursor:pointer" onclick="switchTab('orion-dfc', 'DFC gerencial (Órion)')">Geração de caixa →</a></div>
      <div style="border:1px solid ${fav ? "#bbf7d0" : "#fecaca"};background:${fav ? "#f0fdf4" : "#fef2f2"};border-radius:8px;padding:8px 12px;font-size:0.8rem;margin-bottom:6px">
        Resultado líquido ${pct(percR)} vs ${ref.toLowerCase()}. Despesas ${percD <= 0 ? "dentro ou abaixo" : "acima"} da referência (${pct(percD)}).</div>
      <div style="font-size:0.68rem;color:#64748b;margin-bottom:12px">SEMÁFORO <span style="color:#cbd5e1">●</span> Imaterial (&lt; R$ 5 mil) <span style="color:#10b981">●</span> Favorável ou ≤ 5% <span style="color:#fbbf24">●</span> Atenção (≤ 10%) <span style="color:#ef4444">●</span> Acima do limite · materialidade: desvio ≥ 5%</div>`;

    // ----- gráficos: cascata + escolha do gráfico -----
    const o = d.outro;
    let om = null;
    if (o) { const od = F.filtrarEmpresas(this, o.desp, []).linhas, orr = F.filtrarEmpresas(this, o.rec, []).linhas; om = C.resumoGeral(od, orr, [], ms).mensal; }
    const vOut = o ? this.vendasMes(o.vendas) : null;
    const serie = (campo, src) => (src || r.mensal).map((m) => m[campo]);
    const nomeO = this.base === "forecast" ? "Orçado" : "Forecast" + (o && o.versao ? " (" + o.versao + ")" : "");
    const par = (campo, corReal) => { const a = { nome: ref + (this.base === "forecast" ? " (" + this.versaoAtual() + ")" : ""), cor: this.base === "forecast" ? "#F5883A" : "#64748b", v: serie(campo + "_orcado") };
      const b = om ? { nome: nomeO, cor: this.base === "forecast" ? "#64748b" : "#F5883A", v: serie(campo + "_orcado", om) } : null;
      const l = this.base === "forecast" ? [b, a] : [a, b]; return l.filter(Boolean).concat([{ nome: "Realizado", cor: corReal, v: serie(campo + "_realizado") }]); };
    const confs = {
      resultado: { t: "Resultado líquido (receitas − despesas)", s: [{ nome: ref, cor: "#64748b", v: serie("res_orcado") }, { nome: "Realizado", cor: "#2E864D", v: serie("res_realizado") }] },
      despesas: { t: "Despesas", s: par("desp", "#FF5144") },
      receitas: { t: "Receitas", s: par("rec", "#2E864D") },
      vgv: { t: "VGV de vendas", s: (() => { const a = { nome: ref, cor: this.base === "forecast" ? "#F5883A" : "#64748b", v: vendasRef.vgv }; const b = vOut ? { nome: nomeO, cor: this.base === "forecast" ? "#64748b" : "#F5883A", v: vOut.vgv } : null; return (this.base === "forecast" ? [b, a] : [a, b]).filter(Boolean); })() }
    };
    const cf = confs[this.grafVisao] || confs.resultado;
    const botoes = [["resultado", "Resultado"], ["despesas", "Despesas"], ["receitas", "Receitas"], ["vgv", "VGV"]].map(([kk, t]) => `<button type="button" class="btn ${this.grafVisao === kk ? "btn-primary" : "btn-secondary"}" style="height:30px;padding:0 12px;font-size:0.72rem" onclick="OrionResumoApp.setGraf('${kk}')">${t}</button>`).join("");
    const graficos = `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px;margin:10px 0">
        <div style="border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:10px"><div style="font-weight:700;color:#334155;margin-bottom:6px">Cascata do resultado</div>
          ${this.cascata(kr.orcado, kr.realizado, k.receitas.realizado - k.receitas.orcado, k.despesas.orcado - k.despesas.realizado, ref)}</div>
        <div style="border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:10px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"><div style="font-weight:700;color:#334155">${cf.t}</div><div style="display:flex;gap:4px">${botoes}</div></div>
          ${this.barrasMes(cf.s, ms, cf.s.length - 1)}${this.grafVisao === "vgv" ? `<div style="font-size:0.7rem;color:#92400e">O realizado de vendas ainda não tem fonte no Integra.</div>` : ""}${!o && this.grafVisao !== "resultado" ? `<div style="font-size:0.7rem;color:#64748b">Sem ${nomeO.toLowerCase()} de ${this.esc(this.ano)} neste departamento para comparar.</div>` : ""}</div></div>`;

    // ----- drill-down produto › plano › mês -----
    const nomesCc = {};
    d.desp.concat(d.rec).forEach((l) => { if (l.cc_nome && !nomesCc[l.cc]) nomesCc[l.cc] = l.cc_nome; });
    const porCc = new Map();
    r.grupos.forEach((g) => { if (!porCc.has(g.cc)) porCc.set(g.cc, { cc: g.cc, cc_nome: g.cc_nome, planos: [] }); const p2 = porCc.get(g.cc); if (!p2.cc_nome) p2.cc_nome = g.cc_nome || nomesCc[g.cc] || ""; p2.planos.push(...g.planos); });
    const dpct = (re, rf) => (rf ? (re - rf) / Math.abs(rf) : 0);
    const cor = (v) => (v >= 0 ? "#047857" : "#b91c1c");
    const filtrado = ms.length < 12;
    const det = [...porCc.values()].sort((a, b) => String(a.cc).localeCompare(String(b.cc), "pt-BR", { numeric: true })).map((g) => {
      const kc = "cc|" + g.cc, ab = !!this.abertos[kc];
      let h = `<tr class="or-grupo" onclick="OrionResumoApp.alternar('${this.esc(kc)}')"><td colspan="5">${ab ? "▾" : "▸"} ${nome(g)} <span style="font-weight:400;font-size:0.68rem;background:#e2e8f0;color:#475569;border-radius:99px;padding:1px 8px">${g.planos.length} planos</span></td></tr>`;
      if (!ab) return h;
      g.planos.slice().sort((a, b) => (a.tipo === b.tipo ? String(a.plano).localeCompare(String(b.plano), "pt-BR", { numeric: true }) : a.tipo === "RECEITAS" ? -1 : 1)).forEach((x) => {
        const kp = "pl|" + g.cc + "|" + x.tipo + "|" + x.plano, abp = !!this.abertos[kp], dv = dpct(x.realizado, x.orcado), sg = x.tipo === "DESPESAS" ? -1 : 1;
        h += `<tr style="cursor:pointer" class="${x.fora ? "or-fora" : ""}" onclick="OrionResumoApp.alternar('${this.esc(kp)}')"><td style="padding-left:24px;border-left:4px solid ${x.tipo === "RECEITAS" ? "#4ade80" : "#f87171"}">${abp ? "▾" : "▸"} ${this.esc(x.plano)} ${this.esc(x.plano_nome)}${x.fora ? " (sem orçado)" : ""} <span style="font-size:0.62rem;font-weight:700;padding:1px 5px;border-radius:4px;background:${x.tipo === "RECEITAS" ? "#dcfce7" : "#fee2e2"};color:${x.tipo === "RECEITAS" ? "#15803d" : "#b91c1c"}">${x.tipo}</span></td>
          <td class="is-right">${f(x.orcado)}</td><td class="is-right"><b>${f(x.realizado)}</b></td><td class="is-right" style="font-weight:700;color:${cor(sg * dv)}">${pct(dv)}</td><td>${this.farol(x.semaforo)}</td></tr>`;
        if (abp) {
          ms.forEach((mm) => { const rf = x.o[mm - 1], re = x.r[mm - 1], dm = dpct(re, rf); h += `<tr><td style="padding-left:56px;color:#64748b">${C.MESES[mm - 1]}</td><td class="is-right">${f(rf)}</td><td class="is-right">${f(re)}</td><td class="is-right" style="font-weight:700;color:${cor(sg * dm)}">${pct(dm)}</td><td></td></tr>`; });
          if (filtrado) h += `<tr><td style="padding-left:56px;font-weight:700">Acumulado selecionado</td><td class="is-right"><b>${f(x.orcado)}</b></td><td class="is-right"><b>${f(x.realizado)}</b></td><td class="is-right" style="font-weight:700;color:${cor(sg * dv)}">${pct(dv)}</td><td></td></tr>`;
        }
      });
      return h;
    }).join("");
    const ranking2 = r.ranking.map((x, i) => { const bom = x.tipo === "DESPESAS" ? x.dif <= 0 : x.dif >= 0; const pv = x.orcado ? x.dif / Math.abs(x.orcado) : null; return `<tr class="${x.fora ? "or-fora" : ""}">
      <td class="is-center"><span style="display:inline-flex;width:20px;height:20px;border-radius:50%;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;background:${i < 3 ? "#fef3c7" : "#f1f5f9"};color:${i < 3 ? "#b45309" : "#475569"}">${i + 1}</span></td>
      <td>${x.tipo === "RECEITAS" ? "Receita" : "Despesa"}</td><td>${nome(x)}</td><td>${this.esc(x.plano)} ${this.esc(x.plano_nome)}${x.fora ? " (sem orçado)" : ""}</td>
      <td class="is-right">${f(x.orcado)}</td><td class="is-right">${f(x.realizado)}</td><td class="is-right" style="font-weight:700;color:${bom ? "#047857" : "#b91c1c"}">${f(x.dif)}</td>
      <td class="is-right"><span style="font-weight:700;padding:1px 6px;border-radius:4px;background:${bom ? "#ecfdf5" : "#fef2f2"};color:${bom ? "#047857" : "#b91c1c"}">${pct(pv)}</span></td><td>${this.farol(x.semaforo)}</td></tr>`; }).join("");
    const tudo = `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">${ms.map((m) => C.MESES[m - 1]).join(", ")}/${this.esc(this.ano)}${this.base === "forecast" ? " · " + this.esc(this.versaoAtual()) : ""} · ${r.docs} documento(s) · realizado pela regra do Integra (caixa e bancos, visão DFC; empresas ${this.esc(r.empresas.join(", "))}) só dos centros de custo e planos que estão no orçamento · ${r.movimentos} movimentos. Despesas aparecem positivas; resultado = receitas − despesas.</div>
      ${hero}
      ${graficos}
      <div class="or-sec">Geração de caixa (receitas − despesas por mês, com o acumulado)</div>
      ${this.grafico(r.mensal.filter((m) => m.usado), ref)}
      <div class="or-sec">Mês a mês</div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col style="width:70px"><col span="6" style="width:140px"></colgroup>
        <thead><tr><th>Mês</th><th class="is-right">Receitas ${ref.toLowerCase()}</th><th class="is-right">Receitas realizado</th><th class="is-right">Despesas ${ref.toLowerCase()}</th><th class="is-right">Despesas realizado</th><th class="is-right">Resultado ${ref.toLowerCase()}</th><th class="is-right">Resultado realizado</th></tr></thead>
        <tbody>${mensal}<tr class="or-total"><td>Total</td><td class="is-right">${f(k.receitas.orcado)}</td><td class="is-right">${f(k.receitas.realizado)}</td><td class="is-right">${f(k.despesas.orcado)}</td><td class="is-right">${f(k.despesas.realizado)}</td><td class="is-right">${f(k.resultado.orcado)}</td><td class="is-right">${f(k.resultado.realizado)}</td></tr></tbody>
      </table></div>
      <div class="or-sec">Top 10 maiores desvios</div>
      <div class="cc-scroll"><table class="cc-table">
        <colgroup><col style="width:40px"><col style="width:76px"><col><col><col style="width:130px"><col style="width:130px"><col style="width:130px"><col style="width:80px"><col style="width:150px"></colgroup>
        <thead><tr><th>#</th><th>Tipo</th><th>Produto</th><th>Plano</th><th class="is-right">Referência</th><th class="is-right">Realizado</th><th class="is-right">Variação</th><th class="is-right">%</th><th>Semáforo</th></tr></thead>
        <tbody>${ranking2 || `<tr><td colspan="9" style="text-align:center;padding:20px">Sem desvios a exibir.</td></tr>`}</tbody></table></div>
      <div class="or-sec">Detalhe: produto › plano › mês <span style="font-weight:400;color:#64748b;font-size:0.72rem">(clique no produto para abrir os planos; clique no plano para ver a abertura mensal)</span></div>
      <div class="cc-scroll" style="max-height:70vh"><table class="cc-table">
        <colgroup><col><col style="width:140px"><col style="width:140px"><col style="width:100px"><col style="width:150px"></colgroup>
        <thead><tr><th>Produto / plano / mês</th><th class="is-right">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Desvio</th><th>Semáforo</th></tr></thead>
        <tbody>${det || `<tr><td colspan="5" style="text-align:center;padding:20px">Nenhum dado para exibir.</td></tr>`}</tbody></table></div>`;
    // Dashboard de orçamento do Órion: Geração de Caixa e Indicadores e Metas são recortes desta mesma tela
    const info = tudo.slice(0, tudo.indexOf("</div>") + 6);
    const pedaco = (de, ate) => { const i = tudo.indexOf(de), j = ate ? tudo.indexOf(ate, i + 1) : tudo.length; return i < 0 ? "" : tudo.slice(i, j < 0 ? tudo.length : j); };
    const dash = this === window.OrionResumoApp ? this.modoDash : null; // a tela Orçado × Realizado herda desta e não usa os recortes
    if (dash === "geracao") {
      const heroCx = hero.replace("Resultado líquido · comparação no período filtrado", "Geração de caixa · receitas − despesas no período filtrado").replace(/Resultado líquido ([^<]*) vs/, "Geração de caixa $1 vs");
      return info + heroCx + `<div class="or-sec">Geração de caixa mensal (Receitas − Despesas)</div>` + this.grafico(r.mensal.filter((m) => m.usado), ref) + pedaco('<div class="or-sec">Mês a mês</div>', '<div class="or-sec">Top 10') +
        `<div style="font-size:0.72rem;color:#64748b;margin-top:6px">Para detalhe por plano, use <a style="font-weight:700;color:#105436;cursor:pointer" onclick="OrionDashOrcamento.ir('analitico1')">Analítico I</a>.</div>`;
    }
    if (dash === "indicadores") {
      return info + hero + `<div style="font-size:0.75rem;color:#64748b;margin-top:4px">Metas = valores de ${ref.toLowerCase()} do período. Metas customizadas por departamento podem ser cadastradas em fase posterior.</div>
        <a style="display:inline-block;margin-top:8px;font-size:0.8rem;font-weight:700;color:#105436;cursor:pointer" onclick="OrionDashOrcamento.ir('analitico1')">Abrir Analítico I →</a>`;
    }
    return tudo;
  },

  /** VGV e unidades por mês (centavos / unidades) de uma lista de vendas, com o filtro de empresa. */
  vendasMes(vendas) {
    const F = window.OrionFiltros;
    let vs = vendas || [];
    if (this.empresas && this.empresas.length) { const mapa = F.mapaCcEmpresa(), emp = new Set(this.empresas.map(String)); vs = vs.filter((v) => emp.has(mapa[v.cc] || "")); }
    const vgv = new Array(12).fill(0), un = new Array(12).fill(0);
    vs.forEach((v) => { const m = Number(v.mes); if (m >= 1 && m <= 12) { vgv[m - 1] += Number(v.vgv) || 0; un[m - 1] += Number(v.vendas) || 0; } });
    return { vgv, un };
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
