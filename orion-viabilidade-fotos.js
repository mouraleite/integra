/* Órion (transição) › Viabilidades — fotos, comparativo e relatório (como no resumo do Órion).
 * Foto: guarda os indicadores e a DRE da fase no momento (nome, data, quem); uma pode ser a oficial (baseline).
 * Comparativo: coluna "atual", as outras versões da mesma família (clones) calculadas na hora e as fotos guardadas.
 * Relatório: abre uma página pronta para imprimir ou salvar em PDF (indicadores, DRE, fluxo por ano, premissas e parecer).
 * Grava as fotos na própria viabilidade (orion_viabilidades, campo fotos), com conferência de versão. */
(function () {
  const A = window.OrionViabilidadesApp;
  if (!A) return;
  const detalheAnterior = A.htmlDetalhe.bind(A);

  const LINHAS = [
    ["VGV líquido", (i) => i.vgv_total, "R$"], ["Impostos", (i) => -i.impostos, "R$"], ["Terreno / permuta", (i) => -i.valor_terreno, "R$"],
    ["Obras (total)", (i) => -i.custo_obras, "R$"], ["Despesas (marketing, comercial, adm.)", (i) => -((i.dre_despesas_marketing || 0) + (i.dre_despesas_comercial || 0) + (i.dre_despesas_adm || 0) + (i.dre_despesas_extras || 0)), "R$"],
    ["Custo financeiro do funding", (i) => -i.custo_financeiro_funding, "R$"], ["Lucro líquido", (i) => i.lucro_liquido, "R$"], ["Margem", (i) => i.margem_perc, "%"],
    ["TIR a.a.", (i) => i.tir_aa, "%"], ["MTIR a.a.", (i) => i.mtir_aa, "%"], ["VPL", (i) => i.vpl, "R$"], ["Exposição máxima", (i) => i.exposicao_maxima, "R$"],
    ["Exposição / VGV", (i) => i.expo_vgv, "%"], ["Payback (mês)", (i) => i.payback, "n"], ["Vida (meses)", (i) => i.vida, "n"]
  ];
  const resumo = (ind) => { const o = {}; LINHAS.forEach(([n, f]) => { const v = f(ind || {}); o[n] = v == null || isNaN(v) ? null : v; }); return o; };

  Object.assign(A, {
    fmtLinha(v, t) { if (v == null) return "—"; if (t === "%") return this.P(v); if (t === "n") return String(Math.round(v)); return this.R0(v); },

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
        await this.gravarFotos((l) => l.concat([{ id: Date.now().toString(36), nome, em: new Date().toISOString(), por: quem, fase: f.nome, cenario: cen ? cen.nome : "Base", oficial: !l.length, valores: resumo(f.r.indicators) }]));
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
      const d = this.aberto.doc;
      const r = this.resultados(d);
      const f = r.fases[this.aberto.fase];
      if (!f) return "";
      const cols = [{ titulo: "Atual", sub: this.cenarioAtual() ? this.cenarioAtual().nome : "cenário base", v: resumo(f.r.indicators), atual: true }];
      this.familia(d).forEach((x) => {
        const rx = this.resultados(x);
        const fx = rx.fases[Math.min(this.aberto.fase, rx.fases.length - 1)];
        if (fx) cols.push({ titulo: x.project_name, sub: `versão · ${x.status}`, v: resumo(fx.r.indicators), abrir: x._id });
      });
      (d.fotos || []).forEach((x) => cols.push({ titulo: x.nome + (x.oficial ? " ★" : ""), sub: `${new Date(x.em).toLocaleDateString("pt-BR")} · ${x.por || ""} · ${x.cenario || ""}`, v: x.valores || {}, foto: x }));
      const ed = this.podeEditar() && !this.ed;
      const base = cols.find((c) => c.foto && c.foto.oficial);
      const cab = cols.map((c) => `<th class="is-right" style="min-width:150px;${c.atual ? "background:#e7f6ee" : ""}">${this.esc(c.titulo)}<div style="font-weight:400;font-size:0.65rem">${this.esc(c.sub)}</div>
        ${c.abrir ? `<button type="button" class="btn btn-secondary" style="height:22px;padding:0 6px;font-size:0.65rem" onclick="OrionViabilidadesApp.abrir('${this.esc(c.abrir)}')">abrir</button>` : ""}
        ${c.foto && ed ? `${c.foto.oficial ? "" : `<button type="button" class="btn btn-secondary" style="height:22px;padding:0 6px;font-size:0.65rem" onclick="OrionViabilidadesApp.marcarOficial('${c.foto.id}')">oficial</button>`}<button type="button" class="btn btn-secondary" style="height:22px;padding:0 6px;font-size:0.65rem;color:#b91c1c" onclick="OrionViabilidadesApp.excluirFoto('${c.foto.id}')">✕</button>` : ""}</th>`).join("");
      const corpo = LINHAS.map(([n, , t]) => `<tr><td>${n}</td>${cols.map((c) => {
        const v = c.v[n];
        const dif = base && c.atual && t !== "n" && v != null && base.v[n] != null ? v - base.v[n] : null;
        return `<td class="is-right" style="${c.atual ? "background:#f0fdf4;font-weight:600" : ""}">${this.fmtLinha(v, t)}${dif != null && Math.abs(dif) > 0.005 ? `<div style="font-size:0.62rem;color:${dif < 0 ? "#b91c1c" : "#105436"}">${dif > 0 ? "+" : ""}${this.fmtLinha(dif, t)} vs oficial</div>` : ""}</td>`;
      }).join("")}</tr>`).join("");
      return `<div class="ov-sec" style="display:flex;align-items:center;gap:8px">Comparativo (atual, versões e fotos)
          ${ed ? `<button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.tirarFoto()">Tirar foto</button>` : ""}
          <button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.relatorio()">Relatório (imprimir / PDF)</button></div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col style="width:240px"></colgroup><thead><tr><th>Indicador</th>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>
        <div style="font-size:0.7rem;color:#64748b;margin-top:4px">Foto = os números do momento, que ficam guardados mesmo que a viabilidade mude depois. ★ = oficial (baseline): a coluna atual mostra a diferença contra ela. As versões (clones) são recalculadas na hora.</div>`;
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
