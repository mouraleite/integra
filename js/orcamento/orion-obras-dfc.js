/* Órion (transição) › DFC de empreendimentos — tela do ML Órion (dashboard/tracking/dfc): a DFC da vida do empreendimento,
 * com o mesmo caixa e as mesmas regras do Acompanhamento de empreendimentos (realizado + contas em aberto + projeção do estoque,
 * terreno informado na obra, receitas excluídas, distratos à parte e visão de parceria), na visão DFC do Integra, por ano ou por
 * mês, grupos que abrem nos planos, a conferência do lucro com o Acompanhamento e o painel "Como lemos estes números".
 * Usa a leitura guardada pelo Acompanhamento (orion_acompanhamento_cache); "Atualizar com o Sienge" lê de novo. Só leitura. */
const OrionObrasDfcApp = {
  id: "", periodo: "ano", anos: [], abertos: {}, erro: "", visao: "consolidado", comoLemos: false,

  C() { return window.OrionAcompanhamentoCalc; },
  O() { return window.OrionObrasApp; },
  root() { return document.getElementById("orion-obras-dfc-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  R$(v) { return Math.abs(v) < 0.5 ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }); },
  P(v) { return v == null || isNaN(v) ? "N/A" : (Number(v) / 100).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }); },

  async init() {
    this.render();
    const O = this.O();
    if (O && !O.grupos && !O.carregando) { await O.carregarBase(); }
    if (O && O.grupos && !this.id && O.grupos.length) this.id = O.grupos.slice().sort((a, b) => (a.cidade + a.nome).localeCompare(b.cidade + b.nome, "pt-BR"))[0].id;
    this.render();
  },
  set(c, v) { this[c] = v; if (c === "id") { this.abertos = {}; this.anos = []; this.visao = "consolidado"; } this.render(); },
  alternar(k) { this.abertos[k] = !this.abertos[k]; this.render(); },
  alternarAno(a) { const s = new Set(this.anos); if (s.has(a)) s.delete(a); else s.add(a); this.anos = [...s].sort(); this.render(); },
  async atualizar() { const O = this.O(); await O.atualizar(this.id); this.erro = O.erro; this.render(); },

  montar() {
    const O = this.O(), C = this.C();
    const g = (O.grupos || []).find((x) => x.id === this.id);
    if (!g) return null;
    const cache = O.cache[g.chave];
    if (!cache) return { g, semDados: true };
    // o mesmo cálculo do Acompanhamento (aba Empreendimentos), na visão de parceria escolhida
    const visao = g.tipo === "obra" || g.membros ? this.visao : "consolidado";
    const acts = O.actsDe(g, visao, false);
    const lista = O.actsDe(g, visao, true);
    const tma = O.tmaDe(g.membros.map((m) => m.cc));
    const det = C.detalheGrupo(acts, tma);
    const centros = cache.centros.map((c, i) => ({ entrada: c.entrada, calc: acts[i], opts: O.optsVisao(c.cc, visao) }));
    const grupos = (window.OrionRealizado && window.OrionRealizado.grupos && window.OrionRealizado.grupos()) || [];
    return Object.assign({ g, cache, det, visao }, C.dfcVida({ centros, grupos, hoje: O.hoje(), lucroAcomp: det.lucro_liq_operacional, lucroLista: lista.reduce((s2, a) => s2 + (a.lucro_liq_operacional || 0), 0) }));
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
  htmlComoLemos(d) {
    const O = this.O();
    if (!O || typeof O.htmlComoLemosPara !== "function") return "";
    const fatos = d && d.det ? O.fatosComoLemos(d.g, d.det) : null;
    const extra = `<section><h4>DFC de empreendimentos</h4><p>Esta DFC usa o mesmo caixa e as mesmas regras do Acompanhamento: o que já foi pago ou recebido (baixas do Sienge), o que está em aberto (títulos lançados), o cronograma de obra, o terreno informado na obra e a venda do estoque projetada com os tributos presumidos. Os distratos ficam em Cancelamentos de vendas e não entram no lucro. Por isso o lucro da DFC confere com o lucro líquido operacional da aba Empreendimentos.</p>
      <p>A Visão Geral do Acompanhamento mostra o lucro sem a projeção do estoque; o card Diferença mostra os dois números lado a lado.</p></section>`;
    return O.htmlComoLemosPara(fatos, "OrionObrasDfcApp.comoLemos=false;OrionObrasDfcApp.render()", extra);
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
      const card = (t, v, sub, st) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;background:#fff;${st || ""}"><div style="font-size:0.64rem;color:#64748b;text-transform:uppercase;font-weight:700">${t}</div><div style="font-size:1.05rem;font-weight:800">${v}</div>${sub ? `<div style="font-size:0.66rem;color:#64748b">${sub}</div>` : ""}</div>`;
      const dt = d.det;
      const conf = `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:10px">
          ${card("Lucro do Acompanhamento", "R$ " + this.R$(cf.lucro_acomp), "lucro líq. operacional · aba Empreendimentos")}
          ${card("Lucro DFC", "R$ " + this.R$(cf.lucro_dfc), "soma da DFC sem cancelamentos de vendas")}
          ${card("Diferença", "R$ " + this.R$(cf.desvio), cf.projecao ? `sem a projeção do estoque: DFC R$ ${this.R$(cf.lucro_dfc_sem_proj)} · Visão Geral R$ ${this.R$(cf.lucro_lista)}` : "Visão Geral: R$ " + this.R$(cf.lucro_lista))}
          <div style="border:1px solid ${cf.ok ? "#bbf7d0" : "#fde68a"};background:${cf.ok ? "#f0fdf4" : "#fffbeb"};border-radius:10px;padding:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;color:${cf.ok ? "#105436" : "#92400e"}">${cf.ok ? "Confere" : "Diverge"}<span style="font-size:0.66rem;font-weight:600;color:#64748b">${cf.ok ? "mesmo cálculo do Acompanhamento" : "avise o time: os dois deveriam bater"}</span></div></div>
        <div style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:10px">
          ${card("TIR (a.a.)", this.P(dt.tir_anual))}${card("MTIR (a.a.)", this.P(dt.mtir_anual))}${card("Payback", (dt.payback || 0) + "º mês")}
          ${card("Exposição máxima", "R$ " + this.R$(dt.exposicao_maxima))}${card("VGV em estoque", "R$ " + this.R$(dt.vgv_estoque), (dt.estoque_unidades || 0) + " un. · entra como projeção")}${card("Vida", (dt.vida || 0) + " meses")}</div>`;
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
      corpo = `${conf}<div style="font-size:0.7rem;color:#64748b;margin-bottom:6px">${this.esc(d.g.nome)} · ${this.esc(d.g.cidade)} · centros ${d.g.membros.map((m) => this.esc(m.cc)).join(", ")} · lido do Sienge em ${new Date(d.cache.em).toLocaleString("pt-BR")} · visão ${this.esc({ consolidado: "consolidada", empreendedor: "do empreendedor", parceiro: "do parceiro" }[d.visao] || d.visao)} · visão DFC do Integra · entradas +, saídas − (valores em R$). A projeção do estoque aparece nos planos "Projeção: …". Clique no grupo para ver os planos.${d.sem_mes && d.sem_mes.n ? ` ${d.sem_mes.n} lançamento(s) sem mês (R$ ${this.R$(d.sem_mes.valor)}) entram no lucro mas não aparecem em nenhuma coluna.` : ""}</div>
        <div class="cc-scroll" style="max-height:70vh"><table class="cc-table or-larga"><thead><tr><th style="min-width:320px">Categoria / plano</th>${cols.map((c) => `<th class="is-right">${c.rot}</th>`).join("")}<th class="is-right">Total</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    const anosDisp = d && !d.semDados ? d.anos : [];
    root.innerHTML = `${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${O.carregando ? `<div style="text-align:center;padding:12px;color:#64748b;"><div class="spinner" style="margin:0 auto 8px;"></div>${this.esc(O.passo || "Aguarde…")}</div>` : ""}
      ${window.OrionFiltros.grade([{ campos: [
        window.OrionFiltros.campo("Empreendimento", `<select class="idx-select" onchange="OrionObrasDfcApp.set('id', this.value)">${lista.map((g) => `<option value="${this.esc(g.id)}" ${g.id === this.id ? "selected" : ""}>${this.esc(g.cidade)} - ${this.esc(g.nome)}</option>`).join("")}</select>`, "ofg-span2"),
        window.OrionFiltros.campo("Visão de parceria", `<select class="idx-select" onchange="OrionObrasDfcApp.set('visao', this.value)">${[["consolidado", "Consolidada"], ["empreendedor", "Empreendedor"], ["parceiro", "Parceiro"]].map(([k, t]) => `<option value="${k}" ${this.visao === k ? "selected" : ""}>${t}</option>`).join("")}</select>`),
        window.OrionFiltros.campo("Período", window.OrionFiltros.seg([["ano", "Ano", "OrionObrasDfcApp.set('periodo', 'ano')"], ["mes", "Mês", "OrionObrasDfcApp.set('periodo', 'mes')"]], this.periodo)),
        this.periodo === "mes" && anosDisp.length ? window.OrionFiltros.campo("Anos", `<div class="ofg-chips" style="min-height:40px">${anosDisp.map((a) => `<button type="button" class="btn ${this.anos.indexOf(a) >= 0 ? "btn-primary" : "btn-secondary"}" onclick="OrionObrasDfcApp.alternarAno('${a}')">${a}</button>`).join("")}</div>`, "ofg-span2") : ""] }],
        `<button type="button" class="btn oac-out" onclick="OrionObrasDfcApp.comoLemos=true;OrionObrasDfcApp.render()">Como lemos estes números</button>
        <button type="button" class="btn btn-secondary" ${O.carregando ? "disabled" : ""} onclick="OrionObrasDfcApp.atualizar()">Atualizar com o Sienge</button>
        <button type="button" class="btn btn-secondary" onclick="OrionObrasDfcApp.exportar()">Exportar Excel</button>`, { acaoCls: this.periodo === "mes" ? "ofg-acao-linha" : "ofg-acao3" })}
      ${corpo}
      ${this.comoLemos ? this.htmlComoLemos(d) : ""}`;
  }
};
window.OrionObrasDfcApp = OrionObrasDfcApp;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && OrionObrasDfcApp.comoLemos) { OrionObrasDfcApp.comoLemos = false; OrionObrasDfcApp.render(); } });
