/* Órion (transição) › Resumo do orçamento — vindo do ML Órion (Orçamento › Resumo geral / Dashboard de Orçamento).
 * Orçado (ou forecast) × realizado de despesas, receitas e resultado: cartões, mês a mês, 10 maiores desvios e detalhe
 * por centro de custo › plano, com o semáforo do Órion. Orçado: documentos trazidos do Órion (versão vigente).
 * Realizado: regra do Integra (orion-realizado.js), só dos centros de custo e planos que estão no orçamento. Só leitura. */
const OrionResumoApp = {
  ano: String(new Date().getFullYear()),
  dept: "TODOS",
  ate: null,
  base: "orcamento",
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

  setAno(v) { this.ano = v; this.resultado = null; this.ate = null; this.render(); },
  setDept(v) { this.dept = v; this.resultado = null; this.render(); },
  setAte(v) { this.ate = Number(v) || null; this.resultado = null; this.render(); },
  setBase(v) { this.base = v; this.resultado = null; this.init(); },
  alternar(k) { this.abertos[k] = !this.abertos[k]; this.render(); },

  /** Mesma escolha da DFC gerencial: documentos do ano sem versões substituídas; no forecast, a maior versão de cada um. */
  vigentes() {
    const l = (this.cabs[this.base] || []).filter((c) => String(c.ano) === String(this.ano) && c.status !== "Substituído" &&
      ["DESPESAS", "RECEITAS"].indexOf(String(c.tipo).toUpperCase()) >= 0 &&
      (this.dept === "TODOS" || String(c.departamento ? c.departamento.id : "") === String(this.dept)));
    const m = new Map();
    l.forEach((c) => {
      const k = [String(c.tipo).toUpperCase(), c.descricao, c.departamento ? c.departamento.id : "", c.produto ? c.produto.id : ""].join("|");
      const atual = m.get(k);
      if (!atual || (Number(c.versao) || 0) > (Number(atual.versao) || 0)) m.set(k, c);
    });
    return [...m.values()];
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
      const empresas = R.empresasDosCcs([...ccs]);
      if (!empresas.length) throw new Error("Não achei as empresas dos centros de custo do orçamento no cadastro de Centros de Custo do Integra.");
      this.passo = `Lendo o realizado de ${this.ano} (${empresas.length} empresa(s))…`;
      this.render();
      const real = await R.buscar(Number(this.ano), ate, empresas);
      const meses = [];
      for (let i = 1; i <= ate; i++) meses.push(i);
      const r = C.resumoGeral(desp, rec, real.alocacoes, meses);
      this.resultado = Object.assign(r, { ate, empresas, docs: docs.length, movimentos: real.movimentos });
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
    const C = this.C();
    const r = this.resultado;
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
    return `<div style="font-size:0.72rem;color:#64748b;margin-bottom:8px">Jan a ${C.MESES[r.ate - 1]}/${this.esc(this.ano)} · ${r.docs} documento(s) · realizado pela regra do Integra (caixa e bancos, visão DFC; empresas ${this.esc(r.empresas.join(", "))}) só dos centros de custo e planos que estão no orçamento · ${r.movimentos} movimentos. Despesas aparecem positivas; resultado = receitas − despesas.</div>
      <div class="or-cards">${card("Receitas", k.receitas)}${card("Despesas", k.despesas)}${card("Resultado", k.resultado)}</div>
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
    root.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div style="display:flex;gap:6px">
          <button type="button" class="btn ${this.base === "orcamento" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionResumoApp.setBase('orcamento')">Orçamento</button>
          <button type="button" class="btn ${this.base === "forecast" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionResumoApp.setBase('forecast')">Forecast</button>
        </div>
        <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px" onchange="OrionResumoApp.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Até o mês</label><select class="idx-select" style="height:40px" onchange="OrionResumoApp.setAte(this.value)">${C.MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === ate ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:220px" onchange="OrionResumoApp.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
        <button type="button" class="btn btn-primary" style="height:40px;margin-left:auto" ${this.carregando ? "disabled" : ""} onclick="OrionResumoApp.calcular()">${this.carregando ? "Calculando..." : "Calcular"}</button>
      </div>
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
      ${this.resultado ? this.htmlResultado() : (this.carregando ? "" : `<div style="font-size:0.8rem;color:#64748b">Escolha o ano, o mês final e o departamento e clique em Calcular. O realizado é lido do Sienge na hora e pode levar alguns minutos.</div>`)}`;
  }
};

window.OrionResumoApp = OrionResumoApp;
