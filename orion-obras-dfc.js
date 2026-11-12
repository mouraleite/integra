/* Órion (transição) › DFC de empreendimentos — tela do ML Órion (dashboard/tracking/dfc): a DFC da vida do empreendimento,
 * com o mesmo caixa do Acompanhamento de empreendimentos (realizado + contas em aberto, sem orçamento nem forecast),
 * na visão DFC do Integra, por ano ou por mês, grupos que abrem nos planos, e a conferência do lucro com a lista.
 * Usa a leitura guardada pelo Acompanhamento (orion_acompanhamento_cache); "Atualizar com o Sienge" lê de novo. Só leitura. */
const OrionObrasDfcApp = {
  id: "", periodo: "ano", anos: [], abertos: {}, erro: "",

  C() { return window.OrionAcompanhamentoCalc; },
  O() { return window.OrionObrasApp; },
  root() { return document.getElementById("orion-obras-dfc-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  R$(v) { return Math.abs(v) < 0.5 ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); },

  async init() {
    this.render();
    const O = this.O();
    if (O && !O.grupos && !O.carregando) { await O.carregarBase(); }
    if (O && O.grupos && !this.id && O.grupos.length) this.id = O.grupos.slice().sort((a, b) => (a.cidade + a.nome).localeCompare(b.cidade + b.nome, "pt-BR"))[0].id;
    this.render();
  },
  set(c, v) { this[c] = v; if (c === "id") { this.abertos = {}; this.anos = []; } this.render(); },
  alternar(k) { this.abertos[k] = !this.abertos[k]; this.render(); },
  alternarAno(a) { const s = new Set(this.anos); if (s.has(a)) s.delete(a); else s.add(a); this.anos = [...s].sort(); this.render(); },
  async atualizar() { const O = this.O(); await O.atualizar(this.id); this.erro = O.erro; this.render(); },

  montar() {
    const O = this.O(), C = this.C();
    const g = (O.grupos || []).find((x) => x.id === this.id);
    if (!g) return null;
    const cache = O.cache[g.chave];
    if (!cache) return { g, semDados: true };
    const kpis = O.actsDe(g, "consolidado", true);
    const lucroLista = kpis.reduce((s, a) => s + (a.lucro_liq_operacional || 0), 0);
    const centros = cache.centros.map((c) => ({ entrada: c.entrada, terreno: ((O.obras || []).find((o) => o.cc === c.cc) || {}).terreno || null }));
    const grupos = (window.OrionRealizado && window.OrionRealizado.grupos && window.OrionRealizado.grupos()) || [];
    return Object.assign({ g, cache }, C.dfcVida({ centros, grupos, hoje: O.hoje(), lucroLista }));
  },

  exportar() {
    const d = this.montar();
    if (!d || d.semDados || typeof XLSX === "undefined") return;
    const cols = this.colunas(d);
    const lin = [["Código", "Descrição"].concat(cols.map((c) => c.rot)).concat(["Total"])];
    d.linhas.forEach((l) => {
      lin.push([l.codigo, l.descricao].concat(cols.map((c) => Math.round((c.ano ? l.valores[c.ano] : l.valores_mes[c.mes]) || 0))).concat([Math.round(this.totalVis(l, cols))]));
      l.planos.forEach((p) => lin.push(["", "   " + p.descricao].concat(cols.map((c) => Math.round((c.ano ? p.valores[c.ano] : p.valores_mes[c.mes]) || 0))).concat([Math.round(this.totalVis(p, cols))])));
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lin), "DFC");
    XLSX.writeFile(wb, `dfc_${d.g.nome.replace(/[^\w]+/g, "_")}_${this.periodo}.xlsx`);
  },
  colunas(d) {
    const M = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    if (this.periodo === "ano") return d.anos.map((a) => ({ ano: a, rot: a }));
    const anos = this.anos.length ? d.anos.filter((a) => this.anos.indexOf(a) >= 0) : d.anos;
    return [].concat(...anos.map((a) => M.map((m, i) => ({ mes: `${a}-${String(i + 1).padStart(2, "0")}`, rot: `${m} ${a}` }))));
  },
  totalVis(l, cols) { return cols.reduce((s, c) => s + ((c.ano ? l.valores[c.ano] : l.valores_mes[c.mes]) || 0), 0); },

  render() {
    const root = this.root();
    if (!root) return;
    const O = this.O();
    if (!O || !this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    if (!O.grupos) { root.innerHTML = `<div style="text-align:center;padding:16px;color:#64748b;"><div class="spinner" style="margin:0 auto 10px;"></div>${this.esc(O.passo || "Carregando…")}</div>`; return; }
    const lista = O.grupos.slice().sort((a, b) => (a.cidade + a.nome).localeCompare(b.cidade + b.nome, "pt-BR"));
    const d = this.montar();
    let corpo = "";
    if (!d) corpo = `<div style="padding:20px;color:#64748b">${lista.length ? "Escolha o empreendimento." : "Nenhuma obra acompanhada. Faça a carga do Órion (parte 5)."}</div>`;
    else if (d.semDados) corpo = `<div style="padding:20px;text-align:center;color:#64748b">Este empreendimento ainda não foi lido do Sienge. Clique em <b>Atualizar com o Sienge</b>.</div>`;
    else {
      const cols = this.colunas(d);
      const cf = d.conferencia;
      const conf = `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px">
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px"><div style="font-size:0.64rem;color:#64748b;text-transform:uppercase;font-weight:700">Lucro da lista</div><div style="font-size:1.05rem;font-weight:800">R$ ${this.R$(cf.lucro_lista)}</div><div style="font-size:0.66rem;color:#64748b">Acompanhamento de empreendimentos</div></div>
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px"><div style="font-size:0.64rem;color:#64748b;text-transform:uppercase;font-weight:700">Lucro DFC</div><div style="font-size:1.05rem;font-weight:800">R$ ${this.R$(cf.lucro_dfc)}</div><div style="font-size:0.66rem;color:#64748b">soma da DFC sem cancelamentos de vendas</div></div>
          <div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px"><div style="font-size:0.64rem;color:#64748b;text-transform:uppercase;font-weight:700">Diferença</div><div style="font-size:1.05rem;font-weight:800">R$ ${this.R$(cf.desvio)}</div></div>
          <div style="border:1px solid ${cf.ok ? "#bbf7d0" : "#fde68a"};background:${cf.ok ? "#f0fdf4" : "#fffbeb"};border-radius:10px;padding:10px;display:flex;align-items:center;justify-content:center;font-weight:800;color:${cf.ok ? "#105436" : "#92400e"}">${cf.ok ? "Confere" : "Diverge"}</div></div>`;
      let rows = "";
      d.linhas.forEach((l) => {
        if (!l.planos.length && Math.abs(l.total) < 0.005 && l.nivel > 0) return;
        const ab = !!this.abertos[l.id], tem = l.planos.length > 0;
        const formula = ["03", "06", "08", "10", "12"].indexOf(l.codigo) >= 0;
        rows += `<tr style="${l.nivel === 0 ? "background:#e7f6ee;font-weight:800;color:#105436" : ""}${formula ? "background:#105436 !important;color:#fff;font-weight:800" : ""}${tem ? ";cursor:pointer" : ""}" ${tem ? `onclick="OrionObrasDfcApp.alternar('${this.esc(l.id)}')"` : ""}>
          <td style="padding-left:${8 + l.nivel * 16}px;${formula ? "background:#105436;color:#fff" : l.nivel === 0 ? "background:#e7f6ee" : ""}">${tem ? (ab ? "▾ " : "▸ ") : ""}<span style="color:${formula ? "#d1fae5" : "#64748b"};font-family:monospace;margin-right:6px">${this.esc(l.codigo)}</span>${this.esc(l.descricao)}</td>
          ${cols.map((c) => { const v = (c.ano ? l.valores[c.ano] : l.valores_mes[c.mes]) || 0; return `<td class="is-right" style="${formula ? "background:#105436;color:#fff;" : l.nivel === 0 ? "background:#e7f6ee;" : ""}${v < -0.5 && !formula ? "color:#b91c1c" : ""}">${this.R$(v)}</td>`; }).join("")}
          <td class="is-right" style="font-weight:800;${formula ? "background:#105436;color:#fff" : l.nivel === 0 ? "background:#e7f6ee" : ""}">${this.R$(this.totalVis(l, cols))}</td></tr>`;
        if (ab) l.planos.forEach((p) => { rows += `<tr><td style="padding-left:${28 + l.nivel * 16}px;color:#475569">${this.esc(p.descricao)}</td>${cols.map((c) => { const v = (c.ano ? p.valores[c.ano] : p.valores_mes[c.mes]) || 0; return `<td class="is-right" style="${v < -0.5 ? "color:#b91c1c" : ""}">${this.R$(v)}</td>`; }).join("")}<td class="is-right">${this.R$(this.totalVis(p, cols))}</td></tr>`; });
      });
      corpo = `${conf}<div style="font-size:0.7rem;color:#64748b;margin-bottom:6px">${this.esc(d.g.nome)} · ${this.esc(d.g.cidade)} · centros ${d.g.membros.map((m) => this.esc(m.cc)).join(", ")} · lido do Sienge em ${new Date(d.cache.em).toLocaleString("pt-BR")} · visão DFC do Integra · entradas +, saídas − (valores em R$). Clique no grupo para ver os planos.</div>
        <div class="cc-scroll" style="max-height:70vh"><table class="cc-table or-larga"><thead><tr><th style="min-width:320px">Categoria / plano</th>${cols.map((c) => `<th class="is-right">${c.rot}</th>`).join("")}<th class="is-right">Total</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    const anosDisp = d && !d.semDados ? d.anos : [];
    root.innerHTML = `${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${O.carregando ? `<div style="text-align:center;padding:12px;color:#64748b;"><div class="spinner" style="margin:0 auto 8px;"></div>${this.esc(O.passo || "Aguarde…")}</div>` : ""}
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
        <div><label class="ml-emp-filter-label">Empreendimento</label><select class="idx-select" style="height:40px;min-width:340px" onchange="OrionObrasDfcApp.set('id', this.value)">${lista.map((g) => `<option value="${this.esc(g.id)}" ${g.id === this.id ? "selected" : ""}>${this.esc(g.cidade)} - ${this.esc(g.nome)}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Período</label><div style="display:flex;gap:4px">${[["ano", "Ano"], ["mes", "Mês"]].map(([k, t]) => `<button type="button" class="btn ${this.periodo === k ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionObrasDfcApp.set('periodo', '${k}')">${t}</button>`).join("")}</div></div>
        ${this.periodo === "mes" && anosDisp.length ? `<div><label class="ml-emp-filter-label">Ano</label><div style="display:flex;gap:4px;flex-wrap:wrap">${anosDisp.map((a) => `<button type="button" class="btn ${this.anos.indexOf(a) >= 0 ? "btn-primary" : "btn-secondary"}" style="height:40px;padding:0 10px" onclick="OrionObrasDfcApp.alternarAno('${a}')">${a}</button>`).join("")}</div></div>` : ""}
        <button type="button" class="btn btn-secondary" style="height:40px;margin-left:auto" ${O.carregando ? "disabled" : ""} onclick="OrionObrasDfcApp.atualizar()">Atualizar com o Sienge</button>
        <button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionObrasDfcApp.exportar()">Exportar Excel</button></div>
      ${corpo}`;
  }
};
window.OrionObrasDfcApp = OrionObrasDfcApp;
