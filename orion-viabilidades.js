/* Órion (transição) › Viabilidades — vindo do ML Órion (Viabilidades), com o mesmo motor de cálculo (orion-viabilidade-calc.js).
 * Lista as viabilidades com os indicadores calculados na hora (cenário base ou um cenário das Premissas da viabilidade),
 * e o detalhe de cada uma: indicadores, DRE, fluxo de caixa mês a mês, visão do empreendedor e de cada parceiro,
 * dados físicos e datas. Troca de status (Em Andamento → Em Aprovação → Aprovado) para quem tem permissão de editar.
 * Cadastros vêm do Integra: cenários e taxas de funding de Configurações gerais › Premissas da viabilidade.
 * Banco: orion_viabilidades (um documento por viabilidade, com as fases e abas dentro; nada mês a mês é gravado). */
const OrionViabilidadesApp = {
  COL: "orion_viabilidades",
  lista: null,
  cenarios: [],
  taxas: null,
  cenario: "",        // "" = base; senão o índice do cenário nas Premissas
  status: "TODOS",
  busca: "",
  aberto: null,       // { doc, fase, visao }
  carga: null,
  carregando: false,
  erro: "",
  aviso: "",
  cache: {},

  V() { return window.OrionViabilidadeCalc; },
  fc() { return window.firebaseCollections; },
  root() { return document.getElementById("orion-viabilidades-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  ehAdmin() { return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin(); },
  podeEditar() { return this.ehAdmin() || (typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_orion_geral_viabilidades_editar")); },

  estilos() {
    if (document.getElementById("ov-estilos")) return;
    const st = document.createElement("style");
    st.id = "ov-estilos";
    st.textContent = `
      .cc-table tr.ov-total td { background:#105436 !important; color:#fff !important; font-weight:700; }
      .cc-table tr.ov-grupo td { background:#e7f6ee !important; color:#105436 !important; font-weight:700; }
      .ov-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:10px; margin-bottom:14px; }
      .ov-card { border:1px solid #d6e2db; border-radius:8px; padding:10px 12px; background:#fff; }
      .ov-card .r { font-size:0.68rem; color:#64748b; text-transform:uppercase; letter-spacing:.03em; }
      .ov-card .v { font-size:1.05rem; font-weight:700; color:#0f172a; margin-top:2px; font-variant-numeric:tabular-nums; }
      .ov-neg { color:#b91c1c; }
      .ov-sec { font-size:0.85rem; font-weight:700; color:#105436; margin:16px 0 6px; }
    `;
    document.head.appendChild(st);
  },

  init() {
    this.estilos();
    this.render();
    if (!this.lista) this.carregar();
  },

  async carregar() {
    const fc = this.fc();
    if (!window.firebaseDb || !fc || !window.OrionStore) { this.erro = "Banco do Integra ainda não carregou. Aguarde alguns segundos e clique em Atualizar."; return this.render(); }
    this.carregando = true;
    this.erro = "";
    this.render();
    try {
      const padraoFunding = window.OrionPremissasApp ? JSON.parse(JSON.stringify(window.OrionPremissasApp.FUNDING_PADRAO)) : {};
      const [cen, tax, snap] = await Promise.all([
        window.OrionStore.ler("cenarios", []),
        window.OrionStore.ler("taxas_funding", padraoFunding),
        fc.getDocs(fc.collection(window.firebaseDb, this.COL))
      ]);
      this.cenarios = cen.itens || [];
      this.taxas = tax.itens || {};
      const l = [];
      snap.forEach((d) => { const x = d.data(); x._id = d.id; l.push(x); });
      this.lista = l;
      this.cache = {};
      if (this.aberto) {
        const novo = l.find((x) => x._id === this.aberto.doc._id);
        this.aberto = novo ? Object.assign({}, this.aberto, { doc: novo }) : null;
      }
    } catch (e) { this.erro = e.message || String(e); }
    this.carregando = false;
    this.render();
  },

  fasesDe(doc) {
    if (Array.isArray(doc.fases)) return doc.fases;
    try { return JSON.parse(doc.fases_json || "[]"); } catch (e) { return []; }
  },

  cenarioAtual() {
    if (this.cenario === "") return null;
    return this.cenarios[Number(this.cenario)] || null;
  },

  /** Resultado de todas as fases da viabilidade no cenário escolhido (guardado enquanto a tela está aberta). */
  resultados(doc) {
    const k = doc._id + "|" + this.cenario + "|" + (doc.versao || 0);
    if (this.cache[k]) return this.cache[k];
    const V = this.V();
    const d = Object.assign({}, doc, { fases: this.fasesDe(doc) });
    let r;
    try {
      const fases = d.fases.map((f, i) => ({ nome: f.nome, r: V.calcular(V.faseDoDoc(d, i), this.cenarioAtual(), this.taxas) }));
      const tma = d.taxa_desconto_vpl ? d.taxa_desconto_vpl / 100 : 0.12;
      r = { fases, total: fases.length ? (fases.length === 1 ? Object.assign({}, fases[0].r.indicators) : V.consolidar(fases.map((f) => f.r), tma)) : null };
    } catch (e) { r = { erro: e.message || String(e), fases: [], total: null }; }
    this.cache[k] = r;
    return r;
  },

  /* ---------- formatação ---------- */
  R(v) { if (v == null || isNaN(v)) return "—"; if (Math.abs(v) < 0.005) v = 0; return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  R0(v) { if (v == null || isNaN(v)) return "—"; if (Math.abs(v) < 0.5) v = 0; return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); },
  P(v) { if (v == null || isNaN(v)) return "n/d"; return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%"; },
  N(v) { return v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); },
  D(v) { if (!v) return "—"; const d = new Date(v); return isNaN(d) ? this.esc(v) : d.toLocaleDateString("pt-BR", { timeZone: "UTC" }); },
  neg(v) { return v <= -0.005 ? ' class="is-right ov-neg"' : ' class="is-right"'; },

  /* ---------- ações ---------- */
  setCenario(v) { this.cenario = v; this.render(); },
  setStatus(v) { this.status = v; this.render(); },
  setBusca(v) { this.busca = v; this.render(); const i = document.getElementById("ov-busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
  abrir(id) { const doc = (this.lista || []).find((x) => x._id === id); if (doc) { this.aberto = { doc, fase: 0, visao: "Global" }; this.aviso = ""; this.render(); window.scrollTo(0, 0); } },
  fechar() { this.aberto = null; this.aviso = ""; this.render(); },
  setFase(i) { this.aberto.fase = Number(i); this.aberto.visao = "Global"; this.render(); },
  setVisao(v) { this.aberto.visao = v; this.render(); },

  async mudarStatus(novo) {
    if (!this.podeEditar() || !this.aberto) return;
    const V = this.V();
    if (V.STATUS.indexOf(novo) < 0) return;
    const fc = this.fc();
    const ref = fc.doc(window.firebaseDb, this.COL, this.aberto.doc._id);
    const lida = Number(this.aberto.doc.versao) || 0;
    const quem = window.OrionStore ? window.OrionStore.usuario() : "";
    this.carregando = true;
    this.render();
    try {
      await fc.runTransaction(window.firebaseDb, async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error("Viabilidade não encontrada. Clique em Atualizar.");
        const atual = s.data();
        if ((Number(atual.versao) || 0) !== lida) throw new Error(`Esta viabilidade foi alterada por ${atual.atualizado_por || "outra pessoa"} depois que você abriu. Clique em Atualizar e tente de novo.`);
        const hist = (atual.historico_status || []).concat([{ de: atual.status, para: novo, por: quem, em: new Date().toISOString() }]);
        tx.set(ref, Object.assign({}, atual, { status: novo, historico_status: hist, versao: lida + 1, atualizado_por: quem, atualizado_em: new Date().toISOString() }));
      });
      this.aviso = `Status alterado para ${novo}.`;
      await this.carregar();
    } catch (e) { this.erro = e.message || String(e); this.carregando = false; this.render(); }
  },

  /* ---------- carga inicial (administrador) ---------- */
  escolher() { const i = document.getElementById("ov-arquivos"); if (i) i.click(); },

  async lerArquivos(files) {
    const V = this.V();
    const arquivos = [];
    this.erro = "";
    for (const f of Array.from(files || [])) {
      try { arquivos.push(JSON.parse(await f.text())); } catch (e) { this.erro = `Arquivo ${f.name} não é JSON válido.`; }
    }
    const r = V.prepararViabilidades(arquivos);
    if (!r) {
      this.erro = "Escolha os arquivos da pasta .carga_orion: viabilities.json, phases.json, viability_revenues.json, viability_constructions.json, viability_expenses.json, phase_taxes.json, phase_exchanges.json, phase_fundings.json, phase_physical_data.json e phase_dates.json.";
      return this.render();
    }
    const existentes = new Set((this.lista || []).map((x) => x._id));
    r.docs.forEach((d) => {
      d.jaExiste = existentes.has(d._id);
      try {
        const x = V.calcular(V.faseDoDoc(d, 0), null, this.taxas);
        d.previa = d.fases.length ? x.indicators : null;
      } catch (e) { d.previa = null; d.erroCalc = e.message || String(e); }
    });
    this.carga = Object.assign(r, { substituir: false, resultado: "" });
    this.render();
  },

  async confirmarCarga() {
    if (!this.ehAdmin() || !this.carga) return;
    const fc = this.fc();
    const quem = window.OrionStore ? window.OrionStore.usuario() : "";
    this.carregando = true;
    let n = 0, mantidas = 0;
    try {
      for (const d of this.carga.docs) {
        if (d.jaExiste && !this.carga.substituir) { mantidas++; continue; }
        const { _id, fases, jaExiste, previa, erroCalc, ...capa } = d;
        const dados = Object.assign(capa, { fases_json: JSON.stringify(fases), qtd_fases: fases.length, versao: 1,
          importado_em: new Date().toISOString(), importado_por: quem });
        Object.keys(dados).forEach((k) => { if (dados[k] === undefined) delete dados[k]; });
        await fc.setDoc(fc.doc(window.firebaseDb, this.COL, _id), dados);
        n++;
        this.carga.resultado = `gravando… ${n}`;
        this.render();
      }
      this.carga.resultado = `importado: ${n} viabilidade(s)${mantidas ? `; ${mantidas} mantida(s) porque já estavam no Integra` : ""}.`;
      this.carga.feito = true;
    } catch (e) {
      this.carga.resultado = "parou com erro: " + (e.message || String(e)) + ". Pode clicar de novo: o que já foi gravado é regravado igual.";
    }
    this.carregando = false;
    await this.carregar();
  },

  marcarSubst(v) { if (this.carga) this.carga.substituir = !!v; },
  fecharCarga() { this.carga = null; this.render(); },

  htmlCarga() {
    const c = this.carga;
    if (!c) return "";
    const linhas = c.docs.map((d) => `<tr>
      <td>${this.esc(d.project_name)}</td><td>${this.esc(d.city)}</td><td>${this.esc(d.status)}</td>
      <td class="is-right">${d.fases.length}</td>
      <td class="is-right">${d.previa ? this.R(d.previa.vgv_total) : "—"}</td>
      <td class="is-right">${d.previa ? this.R(d.previa.lucro_liquido) : "—"}</td>
      <td class="is-right">${d.previa ? this.P(d.previa.tir_aa) : "—"}</td>
      <td style="white-space:normal">${d.erroCalc ? `<span class="ov-neg">${this.esc(d.erroCalc)}</span>` : d.jaExiste ? "já está no Integra" : "nova"}</td></tr>`).join("");
    const temExist = c.docs.some((d) => d.jaExiste);
    return `<div style="padding:12px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;margin-bottom:12px;font-size:0.8rem">
      <b>Importar viabilidades do Órion</b> — confira antes de gravar. Os números abaixo são calculados aqui, com o motor do Integra (igual ao do Órion), na primeira fase e no cenário base; compare com a tela de resumo do Órion.
      ${c.faltam.length ? `<div class="ov-neg" style="margin-top:4px">Faltam os arquivos ${c.faltam.map((t) => t + ".json").join(", ")}: essas abas ficam vazias.</div>` : ""}
      ${c.semFase.length ? `<div class="ov-neg" style="margin-top:4px">Sem fase: ${this.esc(c.semFase.join(", "))}.</div>` : ""}
      <div class="cc-scroll" style="margin-top:8px"><table class="cc-table">
        <colgroup><col><col style="width:140px"><col style="width:120px"><col style="width:60px"><col style="width:140px"><col style="width:140px"><col style="width:90px"><col style="width:180px"></colgroup>
        <thead><tr><th>Viabilidade</th><th>Cidade</th><th>Status</th><th class="is-right">Fases</th><th class="is-right">VGV líquido (R$)</th><th class="is-right">Lucro líquido (R$)</th><th class="is-right">TIR a.a.</th><th>No Integra</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
      ${temExist && !c.feito ? `<label style="display:block;margin-top:8px"><input type="checkbox" onchange="OrionViabilidadesApp.marcarSubst(this.checked)"> Substituir as que já estão no Integra (apaga o que foi mudado aqui nelas)</label>` : ""}
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        ${c.feito ? "" : `<button type="button" class="btn btn-primary" ${this.carregando ? "disabled" : ""} onclick="OrionViabilidadesApp.confirmarCarga()">Confirmar importação</button>`}
        <button type="button" class="btn btn-secondary" onclick="OrionViabilidadesApp.fecharCarga()">${c.feito ? "Fechar" : "Cancelar"}</button>
        <span>${this.esc(c.resultado)}</span>
      </div></div>`;
  },

  /* ---------- lista ---------- */
  filtrados() {
    const b = this.busca.trim().toLowerCase();
    return (this.lista || []).filter((d) => (this.status === "TODOS" || d.status === this.status) &&
      (!b || String(d.project_name || "").toLowerCase().indexOf(b) >= 0 || String(d.city || "").toLowerCase().indexOf(b) >= 0))
      .sort((a, b2) => String(a.project_name || "").localeCompare(String(b2.project_name || ""), "pt-BR"));
  },

  htmlLista() {
    const l = this.filtrados();
    const linhas = l.map((d) => {
      const r = this.resultados(d), t = r.total;
      return `<tr style="cursor:pointer" onclick="OrionViabilidadesApp.abrir('${this.esc(d._id)}')">
        <td title="${this.esc(d.project_name)}">${this.esc(d.project_name)}${d.versao_de ? ' <span style="font-size:0.68rem;color:#64748b">(versão)</span>' : ""}</td>
        <td>${this.esc(d.city)}</td><td>${this.esc(d.status)}</td>
        <td class="is-right">${d.qtd_fases != null ? d.qtd_fases : this.fasesDe(d).length}</td>
        ${r.erro ? `<td colspan="6" class="ov-neg">Erro no cálculo: ${this.esc(r.erro)}</td>` : t ? `
        <td class="is-right">${this.R(t.vgv_total)}</td><td${this.neg(t.lucro_liquido)}>${this.R(t.lucro_liquido)}</td>
        <td class="is-right">${this.P(t.margem_perc)}</td><td class="is-right">${this.P(t.tir_aa)}</td>
        <td${this.neg(t.vpl)}>${this.R(t.vpl)}</td><td class="is-right ov-neg">${this.R(t.exposicao_maxima)}</td>` : `<td colspan="6">Sem fase.</td>`}</tr>`;
    });
    return `<div class="cc-scroll"><table class="cc-table">
      <colgroup><col><col style="width:120px"><col style="width:110px"><col style="width:50px"><col style="width:140px"><col style="width:140px"><col style="width:80px"><col style="width:90px"><col style="width:140px"><col style="width:140px"></colgroup>
      <thead><tr><th>Viabilidade</th><th>Cidade</th><th>Status</th><th class="is-right">Fases</th><th class="is-right">VGV líquido (R$)</th><th class="is-right">Lucro líquido (R$)</th><th class="is-right">Margem</th><th class="is-right">TIR a.a.</th><th class="is-right">VPL (R$)</th><th class="is-right">Exposição máx. (R$)</th></tr></thead>
      <tbody>${linhas.length ? linhas.join("") : `<tr><td colspan="10" style="text-align:center;padding:30px">Nenhuma viabilidade para exibir.${(this.lista || []).length ? "" : " A carga do Órion ainda não foi feita."}</td></tr>`}</tbody>
    </table></div>
    <div style="margin-top:8px;font-size:0.72rem;color:#64748b">Indicadores calculados agora, ${this.cenarioAtual() ? "no cenário " + this.esc(this.cenarioAtual().nome) : "no cenário base"}. Com mais de uma fase, os fluxos das fases são somados mês a mês. Clique numa linha para ver o detalhe.</div>`;
  },

  /* ---------- detalhe ---------- */
  htmlDetalhe() {
    const V = this.V();
    const a = this.aberto, d = a.doc;
    const fases = this.fasesDe(d);
    const res = this.resultados(d);
    if (res.erro) return `<div class="ov-neg">Erro no cálculo: ${this.esc(res.erro)}</div>`;
    const f = res.fases[a.fase];
    const fase = fases[a.fase] || {};
    if (!f) return `<div>Esta viabilidade não tem fases.</div>`;
    const r = f.r;
    const parceiros = Object.keys(r.indicators_parceiros || {});
    const ind = a.visao === "Global" ? r.indicators : a.visao === "Empreendedor" ? r.indicators_empreendedor : r.indicators_parceiros[a.visao];
    const fluxo = a.visao === "Global" ? r.monthly_cashflow : a.visao === "Empreendedor" ? r.monthly_cashflow_empreendedor : r.monthly_cashflow_parceiros[a.visao];
    const card = (rot, v, neg) => `<div class="ov-card"><div class="r">${rot}</div><div class="v${neg ? " ov-neg" : ""}">${v}</div></div>`;
    const cards = `<div class="ov-cards">
      ${card("VGV líquido", "R$ " + this.R0(ind.vgv_total))}
      ${card("Lucro líquido", "R$ " + this.R0(ind.lucro_liquido), ind.lucro_liquido < 0)}
      ${card("Margem", this.P(ind.margem_perc))}
      ${card("TIR a.a.", this.P(ind.tir_aa))}
      ${card("TIR a.m.", this.P(ind.tir_am))}
      ${card("MTIR a.a.", this.P(ind.mtir_aa))}
      ${card(`VPL (TMA ${this.N(ind.tma_aa)}% a.a.)`, "R$ " + this.R0(ind.vpl), ind.vpl < 0)}
      ${card("Exposição máxima", "R$ " + this.R0(ind.exposicao_maxima), true)}
      ${card("Exposição / investimento", this.P(ind.expo_inv))}
      ${card("Exposição / VGV", this.P(ind.expo_vgv))}
      ${card("Mês da exposição", ind.periodo_exposicao || "—")}
      ${card("Payback", ind.payback ? "mês " + ind.payback : "não volta")}
      ${card("Vida", ind.vida + " meses (" + this.N(ind.vida / 12) + " anos)")}
      ${card("Retorno com juros", this.P(ind.retorno_com_juros))}
      ${card("Retorno sem juros", this.P(ind.retorno_sem_juros))}
    </div>`;
    const dreL = V.dre(fluxo), rl = (dreL.find((l) => l.nome === "Receita líquida") || {}).valor || 0;
    const linhasDre = dreL.map((l) => `<tr class="${l.nivel === 0 ? "ov-grupo" : ""}">
      <td style="${l.nivel === 2 ? "padding-left:22px" : l.nivel === 1 ? "font-weight:600" : ""}">${this.esc(l.nome)}</td>
      <td${this.neg(l.valor)}>${this.R(l.valor)}</td><td class="is-right">${l.perc != null ? this.P(l.perc) : rl > 0 ? this.P((l.valor / rl) * 100) : ""}</td></tr>`).join("");
    let acc = 0;
    const tot = { Receitas: 0, Impostos: 0, Obras: 0, Despesas: 0, Terreno: 0, Funding_Entrada: 0, Funding_Despesas: 0, Fluxo_de_Caixa: 0 };
    const linhasFluxo = fluxo.map((m) => {
      acc += m.Fluxo_de_Caixa;
      Object.keys(tot).forEach((k) => { tot[k] += m[k] || 0; });
      return `<tr><td class="is-center">${m.Mes}</td><td class="is-right">${this.R(m.Receitas)}</td><td class="is-right">${this.R(-m.Impostos)}</td><td class="is-right">${this.R(-m.Obras)}</td><td class="is-right">${this.R(-m.Despesas)}</td><td class="is-right">${this.R(-m.Terreno)}</td><td class="is-right">${this.R(m.Funding_Entrada - m.Funding_Despesas)}</td><td${this.neg(m.Fluxo_de_Caixa)}>${this.R(m.Fluxo_de_Caixa)}</td><td${this.neg(acc)}>${this.R(acc)}</td></tr>`;
    }).join("");
    const ph = fase.physical_data || {}, dt = fase.dates || {};
    const fisico = [["Área total (m²)", ph.area_total], ["Lotes residenciais", ph.qtde_lotes_residenciais], ["Lotes comerciais", ph.qtde_lotes_comerciais], ["Lotes mistos", ph.qtde_lotes_mistos],
      ["Área residencial (m²)", ph.area_lotes_residenciais], ["Área comercial (m²)", ph.area_lotes_comerciais], ["Área mista (m²)", ph.area_lotes_mistos], ["Sistema viário (m²)", ph.area_sistema_viario],
      ["Área institucional (m²)", ph.area_institucional], ["Área verde / APP (m²)", ph.area_verde], ["Sistema de lazer (m²)", ph.sistema_lazer], ["Associação / não vendável (m²)", ph.area_associacao]]
      .map(([n, v]) => `<tr><td>${n}</td><td class="is-right">${this.N(v)}</td></tr>`).join("");
    const lotes = (Number(ph.qtde_lotes_residenciais) || 0) + (Number(ph.qtde_lotes_comerciais) || 0) + (Number(ph.qtde_lotes_mistos) || 0);
    const datas = [["Registro (RI)", dt.data_registro], ["Lançamento", dt.data_lancamento], ["Início de obras", dt.data_inicio_obras], ["Início de projetos", dt.data_inicio_projetos], ["Início comercial", dt.data_inicio_comercial], ["Início de marketing", dt.data_inicio_mkt]]
      .map(([n, v]) => `<tr><td>${n}</td><td class="is-right">${this.D(v)}</td></tr>`).join("");
    const outros = V.STATUS.filter((s) => s !== d.status);
    const hist = (d.historico_status || []).slice().reverse().map((h) => `<div>${this.esc(h.de)} → ${this.esc(h.para)} · ${this.esc(h.por)} · ${this.D(h.em)}</div>`).join("");
    const k = res.total;
    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-size:1rem;font-weight:700;color:#0f172a">${this.esc(d.project_name)}</div>
        <span style="font-size:0.75rem;padding:2px 8px;border-radius:999px;background:#e7f6ee;color:#105436;font-weight:700">${this.esc(d.status)}</span>
        <span style="font-size:0.75rem;color:#64748b">${this.esc(d.city)}${this.cenarioAtual() ? " · cenário " + this.esc(this.cenarioAtual().nome) : " · cenário base"}</span>
        <div style="margin-left:auto;display:flex;gap:6px">
          ${this.podeEditar() ? outros.map((s) => `<button type="button" class="btn btn-secondary" style="height:32px" ${this.carregando ? "disabled" : ""} onclick="OrionViabilidadesApp.mudarStatus('${s}')">Mudar para ${s}</button>`).join("") : ""}
          <button type="button" class="btn btn-secondary" style="height:32px" onclick="OrionViabilidadesApp.fechar()">Voltar à lista</button>
        </div>
      </div>
      ${fases.length > 1 && k ? `<div style="font-size:0.78rem;margin-bottom:8px;color:#334155"><b>Todas as fases somadas:</b> VGV R$ ${this.R0(k.vgv_total)} · lucro R$ ${this.R0(k.lucro_liquido)} · TIR ${this.P(k.tir_aa)} a.a. · VPL R$ ${this.R0(k.vpl)} · exposição R$ ${this.R0(k.exposicao_maxima)} · payback ${k.payback ? "mês " + k.payback : "—"}</div>` : ""}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        ${fases.length > 1 ? `<div><label class="ml-emp-filter-label">Fase</label><select class="idx-select" style="height:40px" onchange="OrionViabilidadesApp.setFase(this.value)">${fases.map((x, i) => `<option value="${i}" ${i === a.fase ? "selected" : ""}>${this.esc(x.nome)}</option>`).join("")}</select></div>` : ""}
        <div><label class="ml-emp-filter-label">Visão</label><select class="idx-select" style="height:40px;min-width:220px" onchange="OrionViabilidadesApp.setVisao(this.value)">
          <option value="Global" ${a.visao === "Global" ? "selected" : ""}>Projeto (100%)</option>
          <option value="Empreendedor" ${a.visao === "Empreendedor" ? "selected" : ""}>Empreendedor</option>
          ${parceiros.map((p) => `<option value="${this.esc(p)}" ${a.visao === p ? "selected" : ""}>${this.esc(p)}</option>`).join("")}
        </select></div>
      </div>
      ${r.aviso_parceiros ? `<div style="padding:8px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;margin-bottom:12px;font-size:0.78rem">${this.esc(r.aviso_parceiros)}</div>` : ""}
      ${cards}
      <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px">
        <div><div class="ov-sec">DRE</div><div class="cc-scroll"><table class="cc-table">
          <colgroup><col><col style="width:150px"><col style="width:90px"></colgroup>
          <thead><tr><th>Conta</th><th class="is-right">R$</th><th class="is-right">% receita líquida</th></tr></thead>
          <tbody>${linhasDre}</tbody></table></div></div>
        <div><div class="ov-sec">Dados físicos${lotes ? ` · ${lotes} lotes · ticket médio R$ ${this.R0(ind.vgv_total / lotes)}` : ""}</div><div class="cc-scroll"><table class="cc-table">
          <colgroup><col><col style="width:130px"></colgroup><thead><tr><th>Item</th><th class="is-right">Valor</th></tr></thead><tbody>${fisico}</tbody></table></div>
          <div class="ov-sec">Datas</div><div class="cc-scroll"><table class="cc-table">
          <colgroup><col><col style="width:130px"></colgroup><thead><tr><th>Marco</th><th class="is-right">Data</th></tr></thead><tbody>${datas}</tbody></table></div>
          ${hist ? `<div class="ov-sec">Histórico de status</div><div style="font-size:0.75rem;color:#334155">${hist}</div>` : ""}
        </div>
      </div>
      <div class="ov-sec">Fluxo de caixa mês a mês</div>
      <div class="cc-scroll" style="max-height:520px"><table class="cc-table">
        <colgroup><col style="width:60px"><col span="8" style="width:130px"></colgroup>
        <thead><tr><th class="is-center">Mês</th><th class="is-right">Receitas</th><th class="is-right">Impostos</th><th class="is-right">Obras</th><th class="is-right">Despesas</th><th class="is-right">Terreno</th><th class="is-right">Funding</th><th class="is-right">Fluxo</th><th class="is-right">Acumulado</th></tr></thead>
        <tbody>${linhasFluxo}
          <tr class="ov-total"><td>Total</td><td class="is-right">${this.R(tot.Receitas)}</td><td class="is-right">${this.R(-tot.Impostos)}</td><td class="is-right">${this.R(-tot.Obras)}</td><td class="is-right">${this.R(-tot.Despesas)}</td><td class="is-right">${this.R(-tot.Terreno)}</td><td class="is-right">${this.R(tot.Funding_Entrada - tot.Funding_Despesas)}</td><td class="is-right">${this.R(tot.Fluxo_de_Caixa)}</td><td></td></tr>
        </tbody></table></div>
      ${d.parecer_executivo ? `<div class="ov-sec">Parecer executivo</div><div style="font-size:0.8rem;white-space:pre-wrap;color:#334155;border:1px solid #e2e8f0;border-radius:8px;padding:10px">${this.esc(d.parecer_executivo)}</div>` : ""}`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.V()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    const V = this.V();
    const barra = `
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <div><label class="ml-emp-filter-label">Cenário</label><select class="idx-select" style="height:40px;min-width:180px" onchange="OrionViabilidadesApp.setCenario(this.value)">
          <option value="" ${this.cenario === "" ? "selected" : ""}>Base</option>
          ${this.cenarios.map((c, i) => `<option value="${i}" ${String(i) === this.cenario ? "selected" : ""}>${this.esc(c.nome)}</option>`).join("")}</select></div>
        ${this.aberto ? "" : `
        <div><label class="ml-emp-filter-label">Status</label><select class="idx-select" style="height:40px" onchange="OrionViabilidadesApp.setStatus(this.value)">
          <option value="TODOS">Todos</option>${V.STATUS.map((s) => `<option ${s === this.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Buscar</label><input id="ov-busca" class="idx-select" style="height:40px;min-width:220px;box-sizing:border-box" value="${this.esc(this.busca)}" placeholder="Nome ou cidade" oninput="OrionViabilidadesApp.setBusca(this.value)"></div>`}
        <div style="margin-left:auto;display:flex;gap:8px">
          ${this.ehAdmin() ? `<button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionViabilidadesApp.escolher()">Importar do Órion</button><input type="file" id="ov-arquivos" accept=".json" multiple style="display:none" onchange="OrionViabilidadesApp.lerArquivos(this.files)">` : ""}
          <button type="button" class="btn btn-primary cc-atualizar" style="height:40px" ${this.carregando ? "disabled" : ""} onclick="OrionViabilidadesApp.carregar()">Atualizar</button>
        </div>
      </div>`;
    let corpo;
    if (this.carregando && !this.lista) corpo = `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>`;
    else corpo = this.aberto ? this.htmlDetalhe() : this.htmlLista();
    root.innerHTML = `${barra}
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.htmlCarga()}
      <div style="padding:8px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;margin-bottom:12px;font-size:0.75rem">Tela de transição: viabilidades trazidas do Órion, calculadas com o mesmo motor do Órion. Para alterar receitas, obras, despesas, impostos, permuta, funding, dados físicos ou datas, use Editar premissas: o resultado é recalculado na hora.</div>
      ${this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : ""}
      ${corpo}`;
    if (window.lucide) window.lucide.createIcons();
  }
};

window.OrionViabilidadesApp = OrionViabilidadesApp;
