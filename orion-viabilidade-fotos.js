/* Órion (transição) › Viabilidades — fotos, comparativo e relatório (como no resumo do Órion).
 * Foto: guarda os indicadores e a DRE da fase no momento (nome, data, quem); uma pode ser a oficial (baseline).
 * Comparativo: coluna "atual", as outras versões da mesma família (clones) calculadas na hora e as fotos guardadas.
 * Relatório: abre uma página pronta para imprimir ou salvar em PDF (indicadores, DRE, fluxo por ano, premissas e parecer).
 * Grava as fotos na própria viabilidade (orion_viabilidades, campo fotos), com conferência de versão. */
(function () {
  const A = window.OrionViabilidadesApp;
  if (!A) return;
  const detalheAnterior = A.htmlDetalhe.bind(A);

  /* Linhas do Resumo do Órion (SummaryTab): identificação, dados físicos, datas, DRE completa e indicadores.
   * ctx = { ind (indicadores da visão), dre (nome → { valor, perc }), ph (dados físicos), dt (datas), doc } */
  const D = (ctx, n) => (ctx.dre && ctx.dre[n] ? ctx.dre[n].valor : null);
  const Dp = (ctx, n) => (ctx.dre && ctx.dre[n] ? ctx.dre[n].perc : null);
  const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const lotes = (ph) => (Number(ph.qtde_lotes_residenciais) || 0) + (Number(ph.qtde_lotes_comerciais) || 0) + (Number(ph.qtde_lotes_mistos) || 0);
  const LINHAS = [
    ["Projeto", null, "sec"],
    ["Empreendimento", (c) => c.doc.project_name || "", "txt"], ["Cidade", (c) => c.doc.city || "", "txt"],
    ["Número de lotes", (c) => lotes(c.ph), "n"], ["Área total (m²)", (c) => num(c.ph.area_total), "m2"],
    ["· Lotes residenciais (m²)", (c) => num(c.ph.area_lotes_residenciais), "m2"], ["· Lotes comerciais (m²)", (c) => num(c.ph.area_lotes_comerciais), "m2"], ["· Lotes mistos (m²)", (c) => num(c.ph.area_lotes_mistos), "m2"],
    ["· Sistema viário (m²)", (c) => num(c.ph.area_sistema_viario), "m2"], ["· Área institucional (m²)", (c) => num(c.ph.area_institucional), "m2"], ["· Área verde / APP (m²)", (c) => num(c.ph.area_verde), "m2"],
    ["· Sistema de lazer (m²)", (c) => num(c.ph.sistema_lazer), "m2"], ["· Associação / não vendável (m²)", (c) => num(c.ph.area_associacao), "m2"],
    ["VGV líquido projetado", (c) => c.ind.vgv_total, "R$"], ["Ticket médio projetado", (c) => (lotes(c.ph) ? c.ind.vgv_total / lotes(c.ph) : null), "R$"],
    ["Registro (RI)", (c) => c.dt.data_registro || "", "data"], ["Lançamento", (c) => c.dt.data_lancamento || "", "data"], ["Início de obras", (c) => c.dt.data_inicio_obras || "", "data"],
    ["DRE", null, "sec"],
    ["Receita bruta", (c) => D(c, "Receita bruta"), "R$", 1], ["· Receita de vendas", (c) => D(c, "Receita de vendas"), "R$"], ["· Receita de juros e CM", (c) => D(c, "Receita de juros e correção"), "R$"],
    ["Redutor da receita", (c) => D(c, "Redutor da receita"), "R$", 1], ["· PIS", (c) => D(c, "PIS"), "R$"], ["· COFINS", (c) => D(c, "COFINS"), "R$"], ["· Outros impostos (redutor)", (c) => D(c, "Outros impostos"), "R$"],
    ["Receita líquida", (c) => D(c, "Receita líquida"), "R$", 2],
    ["Custo", (c) => D(c, "Custo"), "R$", 1], ["· Terreno / permuta financeira", (c) => D(c, "Terreno / permuta financeira"), "R$"], ["· Aquisição de área (CAPEX)", (c) => D(c, "Aquisição de área"), "R$"],
    ["· Projetos", (c) => D(c, "Projetos"), "R$"], ["· Obras de infraestrutura", (c) => D(c, "Obras de infraestrutura"), "R$"], ["· Administração da obra", (c) => D(c, "Administração da obra"), "R$"], ["· Custos extras de obras", (c) => D(c, "Custos extras de obras"), "R$"],
    ["Margem bruta", (c) => D(c, "Margem bruta"), "R$", 2], ["Margem bruta (%)", (c) => Dp(c, "Margem bruta"), "%"],
    ["Despesas", (c) => (D(c, "Despesas operacionais") == null ? null : D(c, "Despesas operacionais") + (D(c, "Funding (juros e estruturação)") || 0)), "R$", 1],
    ["· Marketing", (c) => D(c, "Marketing"), "R$"], ["· Comercial", (c) => D(c, "Comercial"), "R$"], ["· Administrativas", (c) => D(c, "Administrativas"), "R$"], ["· Despesas extras", (c) => D(c, "Despesas extras"), "R$"],
    ["· Funding (juros / estruturação)", (c) => D(c, "Funding (juros e estruturação)"), "R$"],
    ["Lucro operacional", (c) => D(c, "Lucro operacional"), "R$", 2], ["Lucro operacional (%)", (c) => Dp(c, "Lucro operacional"), "%"],
    ["IRPJ / CSLL", (c) => D(c, "IRPJ / CSLL"), "R$", 1],
    ["Lucro líquido", (c) => (c.ind.lucro_liquido != null ? c.ind.lucro_liquido : D(c, "Lucro líquido")), "R$", 2], ["Lucro líquido (%)", (c) => (c.ind.margem_perc != null ? c.ind.margem_perc : Dp(c, "Lucro líquido")), "%"],
    ["Indicadores", null, "sec"],
    ["MTIR mensal", (c) => c.ind.mtir_am, "%"], ["MTIR anual", (c) => c.ind.mtir_aa, "%"], ["TIR mensal", (c) => c.ind.tir_am, "%"], ["TIR anual", (c) => c.ind.tir_aa, "%"],
    ["VPL", (c) => c.ind.vpl, "R$"], ["Exposição máxima de caixa", (c) => c.ind.exposicao_maxima, "R$"], ["· Exposição / investimento", (c) => c.ind.expo_inv, "%"], ["· Exposição / VGV", (c) => c.ind.expo_vgv, "%"],
    ["Mês da exposição máxima", (c) => c.ind.periodo_exposicao, "n"], ["Payback (mês)", (c) => c.ind.payback, "n"], ["Vida (meses)", (c) => c.ind.vida, "n"], ["· Vida (anos)", (c) => (c.ind.vida ? c.ind.vida / 12 : null), "anos"]
  ];
  // nomes usados nas fotos antigas (antes desta tela): continuam aparecendo nas linhas equivalentes
  const ANTIGOS = { "VGV líquido projetado": "VGV líquido", "Lucro líquido": "Lucro líquido", "Lucro líquido (%)": "Margem", "TIR anual": "TIR a.a.", "MTIR anual": "MTIR a.a.", "VPL": "VPL", "Exposição máxima de caixa": "Exposição máxima", "· Exposição / VGV": "Exposição / VGV", "Payback (mês)": "Payback (mês)", "Vida (meses)": "Vida (meses)" };
  const resumo = (ctx) => {
    const o = {};
    LINHAS.forEach(([n, f, t]) => { if (t === "sec") return; let v; try { v = f(ctx); } catch (e) { v = null; } o[n] = v == null || (typeof v === "number" && isNaN(v)) ? null : v; });
    return o;
  };

  A.LINHAS_RESUMO = LINHAS;
  A.ANTIGOS_RESUMO = ANTIGOS;
  A.resumoDe = resumo;

  Object.assign(A, {
    fmtLinha(v, t) {
      if (v == null || v === "") return "—";
      if (t === "txt") return this.esc(v);
      if (t === "data") return this.D ? this.D(v) : this.esc(v);
      if (t === "%") return this.P(v);
      if (t === "n") return String(Math.round(v));
      if (t === "m2") return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      if (t === "anos") return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      return this.R0(v);
    },
    /** Contexto de uma fase calculada, na visão escolhida (projeto, empreendedor ou parceiro), para as linhas do Resumo. */
    ctxFase(doc, fx) {
      const V = window.OrionViabilidadeCalc, visao = (this.aberto && this.aberto.visao) || "Global", r = fx.r;
      const ind = visao === "Empreendedor" && r.indicators_empreendedor ? r.indicators_empreendedor : r.indicators_parceiros && r.indicators_parceiros[visao] ? r.indicators_parceiros[visao] : r.indicators;
      const fl = visao === "Empreendedor" && r.monthly_cashflow_empreendedor ? r.monthly_cashflow_empreendedor : r.monthly_cashflow_parceiros && r.monthly_cashflow_parceiros[visao] ? r.monthly_cashflow_parceiros[visao] : r.monthly_cashflow;
      const dre = {};
      (V && V.dre ? V.dre(fl || []) : []).forEach((l) => { dre[l.nome] = l; });
      const fase = (this.fasesDe(doc) || [])[Math.min(this.aberto.fase || 0, (this.fasesDe(doc) || []).length - 1)] || {};
      return { ind: ind || {}, dre, ph: fase.physical_data || {}, dt: fase.dates || {}, doc };
    },
    alternarComparar() { this.aberto.comparar = !this.aberto.comparar; this.render(); },
    alternarColuna(id) { const a = this.aberto; a.ocultas = a.ocultas || {}; a.ocultas[id] = !a.ocultas[id]; this.render(); },

    async gravarFotos(fn) {
      const fc = this.fc();
      const id = this.aberto.doc._id;
      const lida = Number(this.aberto.doc.versao) || 0;
      await fc.runTransaction(window.firebaseDb, async (tx) => {
        const ref = fc.doc(window.firebaseDb, this.COL, id);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error("Viabilidade não encontrada.");
        const atual = s.data();
        if ((Number(atual.versao) || 0) !== lida) throw new Error("A viabilidade foi alterada por outra pessoa. Clique em Atualizar e tente de novo.");
        tx.set(ref, Object.assign({}, atual, { fotos: fn((atual.fotos || []).slice()), versao: lida + 1 }));
      });
      await this.carregar();
    },

    async tirarFoto() {
      if (!this.podeEditar() || !this.aberto || this.ed) return;
      const r = this.resultados(this.aberto.doc);
      const f = r.fases[this.aberto.fase];
      if (!f) return;
      const nome = (window.prompt("Nome da foto (ex.: Aprovação do comitê, Revisão 2):", `Foto ${((this.aberto.doc.fotos || []).length || 0) + 1}`) || "").trim();
      if (!nome) return;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      const cen = this.cenarioAtual();
      try {
        await this.gravarFotos((l) => l.concat([{ id: Date.now().toString(36), nome, em: new Date().toISOString(), por: quem, fase: f.nome, cenario: cen ? cen.nome : "Base", oficial: !l.length, valores: resumo(this.ctxFase(this.aberto.doc, f)), visao: (this.aberto && this.aberto.visao) || "Global" }]));
        this.aviso = `Foto "${nome}" guardada.`;
      } catch (e) { this.erro = e.message || String(e); }
      this.render();
    },
    async marcarOficial(fid) {
      try { await this.gravarFotos((l) => l.map((x) => Object.assign({}, x, { oficial: x.id === fid }))); } catch (e) { this.erro = e.message || String(e); }
      this.render();
    },
    async excluirFoto(fid) {
      if (!window.confirm("Excluir esta foto?")) return;
      try { await this.gravarFotos((l) => l.filter((x) => x.id !== fid)); } catch (e) { this.erro = e.message || String(e); }
      this.render();
    },

    /** Família: a viabilidade raiz e as versões (clones) dela. */
    familia(doc) {
      const raiz = doc.versao_de || doc._id;
      return (this.lista || []).filter((x) => x._id !== doc._id && (x._id === raiz || x.versao_de === raiz));
    },

    htmlComparativo() {
      const d = this.aberto.doc, a = this.aberto;
      const r = this.resultados(d);
      const f = r.fases[a.fase];
      if (!f) return "";
      const todas = [{ id: "atual", titulo: "Cenário atual", sub: this.cenarioAtual() ? this.cenarioAtual().nome : "cenário base", v: resumo(this.ctxFase(d, f)), atual: true }];
      this.familia(d).forEach((x) => {
        const rx = this.resultados(x);
        const fx = rx.fases[Math.min(a.fase, rx.fases.length - 1)];
        if (fx) todas.push({ id: "f_" + x._id, titulo: x.project_name, sub: `versão · ${x.status}`, v: resumo(this.ctxFase(x, fx)), abrir: x._id, familia: true });
      });
      (d.fotos || []).forEach((x, k) => todas.push({ id: "s_" + x.id, titulo: `Foto ${k + 1}${x.oficial ? " (oficial)" : ""}`, sub: `${x.nome} · ${new Date(x.em).toLocaleDateString("pt-BR")} · ${x.por || ""} · ${x.cenario || ""}${x.visao && x.visao !== "Global" ? " · " + x.visao : ""}`, v: x.valores || {}, foto: x }));
      const comparar = a.comparar !== false;
      const cols = comparar ? todas.filter((c) => c.atual || !(a.ocultas || {})[c.id]) : [todas[0]];
      const ed = this.podeEditar() && !this.ed;
      const base = cols.find((c) => c.foto && c.foto.oficial);
      const val = (c, n) => (c.v[n] !== undefined ? c.v[n] : ANTIGOS[n] !== undefined && c.v[ANTIGOS[n]] !== undefined ? c.v[ANTIGOS[n]] : null);
      const cab = cols.map((c) => `<th class="is-right" style="min-width:160px;white-space:normal;${c.atual || c.familia ? "background:#14532d" : ""}">${this.esc(c.titulo)}<div style="font-weight:400;font-size:0.65rem">${this.esc(c.sub)}</div>
        ${c.abrir ? `<button type="button" class="btn btn-secondary" style="height:22px;padding:0 6px;font-size:0.65rem" onclick="OrionViabilidadesApp.abrir('${this.esc(c.abrir)}')">abrir</button>` : ""}
        ${c.foto && ed ? `${c.foto.oficial ? "" : `<button type="button" class="btn btn-secondary" style="height:22px;padding:0 6px;font-size:0.65rem" onclick="OrionViabilidadesApp.marcarOficial('${c.foto.id}')">oficial</button>`}<button type="button" class="btn btn-secondary" style="height:22px;padding:0 6px;font-size:0.65rem;color:#b91c1c" onclick="OrionViabilidadesApp.excluirFoto('${c.foto.id}')">excluir</button>` : ""}</th>`).join("");
      const corpo = LINHAS.map(([n, , t, peso]) => {
        if (t === "sec") return `<tr><td colspan="${cols.length + 1}" style="background:#e7f6ee;color:#105436;font-weight:800;text-transform:uppercase;font-size:0.7rem">${n}</td></tr>`;
        const sub = n.indexOf("· ") === 0;
        return `<tr><td style="${sub ? "padding-left:22px;color:#475569" : peso === 2 ? "font-weight:800" : peso === 1 ? "font-weight:700" : ""}">${this.esc(sub ? n.slice(2) : n)}</td>${cols.map((c) => {
          const v = val(c, n);
          const dif = base && c.atual && ["R$", "%"].indexOf(t) >= 0 && typeof v === "number" && typeof val(base, n) === "number" ? v - val(base, n) : null;
          return `<td class="is-right" style="${c.atual ? "background:#f0fdf4;" : ""}${peso === 2 ? "font-weight:800;" : ""}${typeof v === "number" && v < 0 && t === "R$" ? "color:#b91c1c;" : ""}">${this.fmtLinha(v, t)}${dif != null && Math.abs(dif) > 0.005 ? `<div style="font-size:0.62rem;color:${dif < 0 ? "#b91c1c" : "#105436"}">${dif > 0 ? "+" : ""}${this.fmtLinha(dif, t)} vs oficial</div>` : ""}</td>`;
        }).join("")}</tr>`;
      }).join("");
      const seletor = comparar && todas.length > 1 ? `<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:0.72rem;margin:6px 0">Colunas: ${todas.slice(1).map((c) => `<label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" ${(a.ocultas || {})[c.id] ? "" : "checked"} onchange="OrionViabilidadesApp.alternarColuna('${this.esc(c.id)}')">${this.esc(c.titulo)}</label>`).join("")}</div>` : "";
      return `<div class="ov-sec" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Resumo: comparativo de cenários, DRE e indicadores
          <button type="button" class="btn ${comparar ? "btn-primary" : "btn-secondary"}" style="height:30px" onclick="OrionViabilidadesApp.alternarComparar()">${comparar ? "Ocultar comparações" : "Comparar cenários"}</button>
          ${ed ? `<button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.tirarFoto()">Fixar no comparativo (foto)</button>` : ""}
          <button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.relatorio()">Gerar relatório (imprimir / PDF)</button></div>
        ${seletor}
        <div class="cc-scroll" style="max-height:75vh"><table class="cc-table or-larga"><thead><tr><th style="min-width:260px">${this.esc(a.visao && a.visao !== "Global" ? "Visão: " + a.visao : "Visão: projeto (100%)")}</th>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>
        <div style="font-size:0.7rem;color:#64748b;margin-top:4px">Foto = os números do momento, que ficam guardados mesmo que a viabilidade mude depois (fotos antigas mostram só os indicadores que guardavam). Oficial (baseline): a coluna atual mostra a diferença contra ela. As versões (clones) são recalculadas na hora, na mesma visão.</div>`;
    },

    relatorio() {
      const d = this.aberto.doc;
      const V = this.V();
      const r = this.resultados(d);
      const f = r.fases[this.aberto.fase];
      if (!f) return;
      const ind = f.r.indicators;
      const fase = this.fasesDe(d)[this.aberto.fase] || {};
      const dre = V.dre(f.r.monthly_cashflow);
      const anos = {};
      const [ai, mi] = String((fase.dates || {}).data_lancamento || "").split("-").map(Number);
      f.r.monthly_cashflow.forEach((m, i) => { const k = ai && mi ? ai + Math.floor((mi - 1 + i) / 12) : "Ano " + (Math.floor(i / 12) + 1); anos[k] = (anos[k] || 0) + m.Fluxo_de_Caixa; });
      const e = (s) => this.esc(s);
      const rev = fase.revenue || {}, con = fase.construction || {}, tax = fase.taxes || {}, ex = fase.exchanges || {}, fu = fase.funding || {};
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Viabilidade - ${e(d.project_name)}</title>
        <style>body{font-family:Arial,sans-serif;color:#0f172a;margin:24px;font-size:12px}h1{font-size:20px;margin:0}h2{font-size:14px;color:#105436;border-bottom:2px solid #105436;padding-bottom:3px;margin-top:20px}
        table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:left}td.n,th.n{text-align:right}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.c{border:1px solid #cbd5e1;border-radius:6px;padding:6px}.c b{display:block;font-size:14px}
        .t td{font-weight:700;background:#e7f6ee}@media print{button{display:none}}</style></head><body>
        <button onclick="window.print()" style="float:right;padding:6px 12px">Imprimir / salvar em PDF</button>
        <h1>${e(d.project_name)}</h1><div>${e(d.city || "")} · ${e(fase.nome || "")} · status ${e(d.status)} · ${this.cenarioAtual() ? "cenário " + e(this.cenarioAtual().nome) : "cenário base"} · emitido em ${new Date().toLocaleString("pt-BR")}</div>
        <h2>Indicadores</h2><div class="g">${[["VGV líquido", "R$ " + this.R0(ind.vgv_total)], ["Lucro líquido", "R$ " + this.R0(ind.lucro_liquido)], ["Margem", this.P(ind.margem_perc)], ["TIR a.a.", this.P(ind.tir_aa)], ["MTIR a.a.", this.P(ind.mtir_aa)], ["VPL (TMA " + this.N(ind.tma_aa) + "%)", "R$ " + this.R0(ind.vpl)], ["Exposição máxima", "R$ " + this.R0(ind.exposicao_maxima)], ["Payback", ind.payback ? "mês " + ind.payback : "—"]].map(([t, v]) => `<div class="c">${t}<b>${v}</b></div>`).join("")}</div>
        <h2>DRE</h2><table>${dre.map((l) => `<tr class="${l.nivel === 0 ? "t" : ""}"><td style="padding-left:${l.nivel === 2 ? 20 : 6}px">${e(l.nome)}</td><td class="n">${this.R(l.valor)}</td><td class="n">${l.perc != null ? this.P(l.perc) : ""}</td></tr>`).join("")}</table>
        <h2>Fluxo de caixa por ano</h2><table><tr><th>Ano</th><th class="n">Fluxo</th></tr>${Object.entries(anos).map(([k, v]) => `<tr><td>${e(k)}</td><td class="n">${this.R(v)}</td></tr>`).join("")}</table>
        <h2>Premissas</h2><table>
          <tr><td>VGV total</td><td class="n">${this.R(rev.vgv_total)}</td><td>Sistema / juros</td><td>${e(rev.sistema_amortizacao || "")} ${e(rev.taxa_juros_vendas || 0)}% a.a.</td></tr>
          <tr><td>Plano de pagamento</td><td colspan="3">${e(rev.plano_ativo || "")}</td></tr>
          <tr><td>Obras</td><td class="n">${this.R(con.custo_obras)} ${e(con.custo_obras_tipo || "")}</td><td>Aquisição de área</td><td>${this.R(con.aquisicao_area)} ${e(con.aquisicao_area_tipo || "")}</td></tr>
          <tr><td>Regime tributário</td><td>${e(tax.regime_tributario || "")}</td><td>Incide sobre</td><td>${e(tax.incidencia_sobre || "")}</td></tr>
          <tr><td>Terreno</td><td colspan="3">${e(ex.modalidade || "")} · parceria: empreendedor ${e(ex.perc_parceria_empreendedor || 0)}%, terrenista ${e(ex.perc_parceria_terrenista || 0)}%, investidor ${e(ex.perc_parceria_investidor || 0)}%</td></tr>
          <tr><td>Funding</td><td colspan="3">${e(fu.tipo_funding || "Nenhum")}</td></tr></table>
        ${d.parecer_executivo ? `<h2>Parecer executivo</h2><div style="white-space:pre-wrap">${e(d.parecer_executivo)}</div>` : ""}
        ${(d.fotos || []).length ? `<h2>Fotos guardadas</h2><table><tr><th>Foto</th><th>Data</th><th class="n">Lucro</th><th class="n">TIR</th><th class="n">VPL</th></tr>${d.fotos.map((x) => `<tr><td>${e(x.nome)}${x.oficial ? " ★" : ""}</td><td>${new Date(x.em).toLocaleDateString("pt-BR")}</td><td class="n">${this.R0((x.valores || {})["Lucro líquido"])}</td><td class="n">${this.P((x.valores || {})["TIR a.a."])}</td><td class="n">${this.R0((x.valores || {})["VPL"])}</td></tr>`).join("")}</table>` : ""}
        </body></html>`;
      const w = window.open("", "_blank");
      if (!w) { this.erro = "O navegador bloqueou a janela do relatório. Libere pop-ups para o Integra e tente de novo."; return this.render(); }
      w.document.open(); w.document.write(html); w.document.close();
    },

    htmlDetalhe() {
      const h = detalheAnterior();
      if (!this.aberto || (this.aberto.aba && this.aberto.aba !== "resultado")) return h;
      let extra = "";
      try { extra = this.htmlComparativo(); } catch (e) { extra = `<div class="ov-neg">Comparativo: ${this.esc(e.message || String(e))}</div>`; }
      return h + extra;
    }
  });
})();
