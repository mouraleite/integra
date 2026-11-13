/* Órion (transição) › Acompanhamento de empreendimentos — mesma tela do ML Órion (dashboard/tracking e tracking/[id]),
 * com a identidade visual do Integra. Mantém o cálculo e a leitura do Sienge de orion-obras.js; aqui ficam só as telas:
 *  - Visão Geral: 8 indicadores, filtros (empreendimentos, categorias, status), selo do caixa realizado e da última leitura,
 *    e a tabela de indicadores por empreendimento;
 *  - Empreendimentos: seletor, visão de parceria, "Como lemos estes números", Atualizar com o Sienge, Exportar,
 *    10 indicadores, DRE, Planos contratados (rosca e barras), Velocidade de vendas (ano › mês) e Fluxo de caixa;
 *  - viabilidade aprovada sem obra (Land Bank): os números vêm da própria viabilidade, como no Órion. */
(function () {
  const A = window.OrionObrasApp;
  if (!A) return;
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  Object.assign(A, {
    filtroCats: [], filtroCatAberto: false, filtroCatBusca: "", filtroSts: [], filtroStAberto: false, filtroStBusca: "", comoLemos: false,

    estilosTela() {
      if (document.getElementById("oac-estilos")) return;
      const st = document.createElement("style");
      st.id = "oac-estilos";
      st.textContent = `
        #orion-obras-root .oac-titulo { font-size:1.6rem; font-weight:800; color:var(--color-primary); letter-spacing:-0.01em; margin:0; text-transform:uppercase; }
        #orion-obras-root .oac-cab { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
        #orion-obras-root .oac-abas { display:flex; gap:8px; margin-bottom:16px; }
        #orion-obras-root .oac-aba { border:none; background:var(--color-bg-light); padding:8px 16px; border-radius:20px; font-family:var(--font-family); font-size:0.8rem; font-weight:700; color:var(--color-text-muted); cursor:pointer; }
        #orion-obras-root .oac-aba:hover { background:rgba(16,84,54,.05); color:var(--color-primary); }
        #orion-obras-root .oac-aba.on { background:var(--color-primary); color:#fff; }
        #orion-obras-root .oac-kpis { display:grid; gap:12px; margin-bottom:16px; }
        #orion-obras-root .oac-kpis8 { grid-template-columns:repeat(8,minmax(0,1fr)); }
        @media (max-width:1280px) { #orion-obras-root .oac-kpis8 { grid-template-columns:repeat(4,minmax(0,1fr)); } }
        #orion-obras-root .oac-kpi { background:#fff; border:1px solid rgba(16,84,54,.08); border-radius:var(--border-radius-md); box-shadow:var(--shadow-sm); padding:14px 12px; text-align:center; }
        #orion-obras-root .oac-kpi .r { font-size:0.68rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.04em; }
        #orion-obras-root .oac-kpi .v { font-size:1.3rem; font-weight:800; color:#1c2e24; margin-top:6px; font-variant-numeric:tabular-nums; }
        #orion-obras-root .oac-kpi .v.neg { color:var(--color-danger); } #orion-obras-root .oac-kpi .v.pos { color:var(--color-primary-light); }
        #orion-obras-root .oac-card { background:#fff; border:1px solid rgba(16,84,54,.08); border-radius:var(--border-radius-md); box-shadow:var(--shadow-sm); overflow:hidden; margin-bottom:16px; }
        #orion-obras-root .oac-card > h3 { margin:0; padding:12px 16px; font-size:0.85rem; font-weight:800; color:var(--color-primary); text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid #e7f0ea; background:#f7faf8; }
        #orion-obras-root .oac-selo { display:inline-flex; align-items:center; gap:6px; font-size:0.72rem; border-radius:8px; padding:5px 10px; }
        #orion-obras-root .oac-badge { display:inline-block; padding:3px 9px; border-radius:999px; font-size:0.62rem; font-weight:800; text-transform:uppercase; }
        #orion-obras-root .oac-seg { display:flex; background:var(--color-bg-light); border-radius:8px; padding:3px; height:40px; box-sizing:border-box; }
        #orion-obras-root .oac-seg button { border:none; background:transparent; border-radius:6px; padding:0 14px; font-family:var(--font-family); font-size:0.8rem; font-weight:700; color:var(--color-text-muted); cursor:pointer; }
        #orion-obras-root .oac-seg button.on { background:#fff; color:var(--color-primary); box-shadow:0 1px 2px rgba(0,0,0,.08); }
        #orion-obras-root .btn.oac-out { background:#fff; color:var(--color-primary); border:1px solid var(--color-primary); }
        #orion-obras-root .btn.oac-out:hover { background:rgba(16,84,54,.05); }
        #orion-obras-root .cc-table tr.oac-prev td { background:#eef6ff !important; }
        #orion-obras-root .cc-table tr.oac-ano td { background:#f7faf8; font-weight:700; cursor:pointer; }
        .oac-painel-fundo { position:fixed; inset:0; z-index:9000; background:rgba(12,41,29,.35); display:flex; justify-content:flex-end; }
        .oac-painel { width:min(480px,100%); height:100%; background:#fff; box-shadow:-8px 0 24px rgba(0,0,0,.15); display:flex; flex-direction:column; font-family:var(--font-family); }
        .oac-painel header { padding:20px 22px; border-bottom:1px solid #e7f0ea; display:flex; justify-content:space-between; gap:12px; }
        .oac-painel .corpo { padding:20px 22px; overflow-y:auto; display:flex; flex-direction:column; gap:18px; }
        .oac-painel h4 { margin:0 0 4px; font-size:0.8rem; font-weight:800; color:var(--color-primary); text-transform:uppercase; letter-spacing:.04em; }
        .oac-painel p { margin:0; font-size:0.85rem; color:#334155; line-height:1.5; }
        @media print { body * { visibility:hidden; } #orion-obras-root, #orion-obras-root * { visibility:visible; } #orion-obras-root { position:absolute; left:0; top:0; width:100%; } #orion-obras-root .oac-nao-imprime { display:none !important; } }
      `;
      document.head.appendChild(st);
    },
    Mi(v) { return v == null || isNaN(v) ? "N/A" : "R$ " + (Number(v) / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " Mi"; },
    miPainel(v) { const n = Number(v) || 0; return Math.abs(n) >= 50000 ? "R$ " + (n / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " mi" : this.R$(n); },
    kpi(r, v, cls) { return `<div class="oac-kpi"><div class="r">${r}</div><div class="v ${cls || ""}">${v}</div></div>`; },
    badge(cat) { const s = cat === "Land Bank" ? "background:#fef3c7;color:#b45309" : cat === "Em Andamento" ? "background:#dbeafe;color:#1d4ed8" : "background:#e7f6ee;color:#105436"; return `<span class="oac-badge" style="${s}">${this.esc(cat)}</span>`; },
    ultimaLeitura() { let m = null; Object.values(this.cache || {}).forEach((c) => { if (c && c.em && (!m || c.em > m)) m = c.em; }); return m; },
    irEmpreendimentos() { const l = this.filtrada(); if (l.length) this.abrir(l[0].id); },

    filtrada() {
      return this.linhasLista().filter((r) => (!this.filtroEmp.length || this.filtroEmp.indexOf(r.nome) >= 0) && (!this.filtroCats.length || this.filtroCats.indexOf(r.categoria) >= 0) && (!this.filtroSts.length || this.filtroSts.indexOf(r.status) >= 0));
    },

    /* ---------- Visão Geral ---------- */
    htmlLista() {
      const todas = this.linhasLista(), f = this.filtrada(), k = (r) => r.kpis || {};
      const vgv = f.reduce((s, r) => s + (k(r).vgv_total || 0), 0), vend = f.reduce((s, r) => s + (k(r).vendas_acumuladas || 0), 0), lucro = f.reduce((s, r) => s + (k(r).lucro || 0), 0);
      const tirs = f.filter((r) => k(r).tir_anual != null);
      const tirMed = tirs.length ? tirs.reduce((s, r) => s + k(r).tir_anual, 0) / tirs.length : null;
      const pb = f.reduce((s, r) => s + (k(r).payback || 0), 0) / (f.length || 1), ex = f.reduce((s, r) => s + (k(r).exposicao_max_caixa || 0), 0);
      const uniq = (fn) => [...new Set(todas.map(fn).filter(Boolean))].sort();
      const filtro = (id, label, lista, sel, aberto, busca) => window.MlEmpresaFilter ? MlEmpresaFilter.html({ id, label, items: lista.map((n) => ({ id: n, label: n })), selectedIds: sel, open: aberto, query: busca, emptyMeansAll: true }) : "";
      const ult = this.ultimaLeitura();
      const linha = (rot, fn, cls) => `<tr><td style="font-weight:700;position:sticky;left:0;background:inherit;z-index:1">${rot}</td>${f.map((r) => `<td class="${cls || "is-center"}">${fn(r)}</td>`).join("")}</tr>`;
      const semCalc = (r) => (r.tipo === "obra" && !r.kpis ? `<span style="color:#b45309">clique em Atualizar</span>` : null);
      const tab = f.length ? `<div class="cc-scroll" style="max-height:72vh"><table class="cc-table or-larga"><thead><tr><th style="min-width:200px">Indicadores</th>${f.map((r) => `<th class="is-center" style="min-width:170px;white-space:normal;cursor:pointer" title="Abrir ${this.esc(r.nome)}" onclick="OrionObrasApp.abrir('${this.esc(r.id)}')">${this.esc(String(r.nome).toUpperCase())}</th>`).join("")}</tr></thead><tbody>
          ${linha("Categoria", (r) => this.badge(r.categoria))}${linha("Status", (r) => this.esc(r.status))}${linha("Cidade", (r) => this.esc(r.cidade))}
          ${linha("VGV Total", (r) => semCalc(r) || `<b>${this.R$(k(r).vgv_total)}</b>`)}${linha("Vendas Acumuladas", (r) => semCalc(r) || this.R$(k(r).vendas_acumuladas))}${linha("% Vendido", (r) => semCalc(r) || `<b>${this.P(k(r).perc_vendido)}</b>`)}
          ${linha("Lucro Operacional", (r) => semCalc(r) || `<b style="${(k(r).lucro || 0) < 0 ? "color:#b91c1c" : ""}">${this.R$(k(r).lucro)}</b>`)}${linha("TIR (a.a.)", (r) => semCalc(r) || this.P(k(r).tir_anual))}${linha("MTIR (a.a.)", (r) => semCalc(r) || this.P(k(r).mtir_anual))}
          ${linha("Payback (Meses)", (r) => semCalc(r) || this.N(k(r).payback))}${linha("Exp. Máx de Caixa", (r) => semCalc(r) || `<span style="color:#b91c1c">${this.R$(k(r).exposicao_max_caixa)}</span>`)}${linha("Exposição / VGV", (r) => semCalc(r) || this.P(k(r).exposicao_caixa_vgv))}
        </tbody></table></div>` : `<div style="padding:30px;text-align:center;color:#64748b">${(this.obras || []).length ? "Nenhum projeto encontrado." : "Nenhuma obra acompanhada. Faça a carga do Órion (parte 5: obras do acompanhamento)."}</div>`;
      return `<div class="oac-kpis oac-kpis8">
          ${this.kpi("Empreendimentos", f.length)}${this.kpi("VGV Total", this.Mi(vgv))}${this.kpi("Vendas (Acum.)", this.Mi(vend))}${this.kpi("% Vendido (VGV)", this.P(vgv > 0 ? (vend / vgv) * 100 : 0), "pos")}
          ${this.kpi("Lucro (Acum.)", this.Mi(lucro), lucro < 0 ? "neg" : "")}${this.kpi("TIR Média Anual", this.P(tirMed))}${this.kpi("Payback Médio", this.N(pb))}${this.kpi("Exp. Máx Caixa", this.Mi(ex), "neg")}</div>
        <div class="oac-card"><div style="padding:14px 16px;border-bottom:1px solid #e7f0ea" class="oac-nao-imprime">${window.OrionFiltros.grade([{ titulo: "Filtros", campos: [
            `<div class="ofg-f">${filtro("oob-emp", "Empreendimentos", uniq((r) => r.nome), this.filtroEmp, this.filtroEmpAberto, this.filtroEmpBusca)}</div>`,
            `<div class="ofg-f">${filtro("oob-cat", "Categorias", uniq((r) => r.categoria), this.filtroCats, this.filtroCatAberto, this.filtroCatBusca)}</div>`,
            `<div class="ofg-f">${filtro("oob-st", "Status", uniq((r) => r.status), this.filtroSts, this.filtroStAberto, this.filtroStBusca)}</div>`] }],
            `${this.podeEditar() ? `<button type="button" class="btn oac-out" onclick="OrionObrasApp.abrirEditor()">Obras acompanhadas</button>` : ""}
            <button type="button" class="btn btn-primary" ${this.carregando ? "disabled" : ""} onclick="OrionObrasApp.atualizar()">Atualizar todos com o Sienge</button>`,
            { cls: "ofg-plano", acaoCls: "ofg-acao3", rodape: `<div class="ofg-full" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              <span class="oac-selo" style="border:1px solid #dfe9e3;color:#4a6355" title="Mesmo recorte de caixa efetivo do orçamento: caixa e bancos do Integra (visão DFC) e contas a pagar / receber em aberto do Sienge.">Caixa realizado: <b>contas a pagar / receber</b></span>
              ${ult ? `<span class="oac-selo" style="border:1px solid #bbf7d0;background:#f0fdf4;color:#105436" title="Data e horário da última leitura do Sienge">🕒 Sienge lido em: <b>${new Date(ult).toLocaleDateString("pt-BR")} às ${new Date(ult).toLocaleTimeString("pt-BR")}</b></span>` : ""}</div>` })}</div>
          ${tab}</div>`;
    },

    /* ---------- Empreendimentos (detalhe) ---------- */
    /** Viabilidade aprovada ainda sem obra (Land Bank): mesmo detalhe que o Órion monta da viabilidade. */
    detalheViab(item) {
      const VA = window.OrionViabilidadesApp, doc = ((VA && VA.lista) || []).find((d) => "v-" + d._id === item.id);
      if (!doc) return null;
      let r = null; try { r = VA.resultados(doc); } catch (e) { r = null; }
      const f = r && r.fases && r.fases[0] ? r.fases[0].r : null;
      const c = (f && f.indicators) || {};
      const fase = (VA.fasesDe(doc) || [])[0] || {}, dt = fase.dates || {};
      let base = null;
      ["data_registro", "data_lancamento", "data_inicio_obras", "data_inicio_projetos", "data_inicio_aquisicao", "data_inicio_comercial", "data_inicio_mkt"].forEach((k) => { if (dt[k]) { const x = new Date(String(dt[k]).slice(0, 10) + "T12:00:00"); if (!isNaN(x) && (!base || x < base)) base = x; } });
      const anual = {};
      ((f && f.monthly_cashflow) || []).forEach((m, i) => {
        const ano = base ? String(new Date(base.getFullYear(), base.getMonth() + i, 1).getFullYear()) : "Ano " + (Math.floor(i / 12) + 1);
        const a = anual[ano] || (anual[ano] = { Ano: ano, Entradas: 0, Devolucao_Distratos: 0, Tributos: 0, Terreno: 0, Obras: 0, Projetos: 0, Marketing: 0, Comercial: 0, Administrativas: 0, Total_Saidas: 0, Saldo_Mes: 0, is_forecast: true });
        a.Entradas += m.Receitas || 0; a.Tributos += m.Impostos || 0; a.Obras += (m.Obras || 0) - (m.Obras_Proj || 0) - (m.Obras_Adm || 0); a.Terreno += m.Terreno || 0; a.Projetos += m.Obras_Proj || 0;
        a.Marketing += m.Despesas_Mkt || 0; a.Comercial += m.Despesas_Com || 0; a.Administrativas += (m.Despesas || 0) - (m.Despesas_Mkt || 0) - (m.Despesas_Com || 0) + (m.Obras_Adm || 0);
        a.Total_Saidas += (m.Obras || 0) + (m.Despesas || 0) + (m.Impostos || 0) + (m.Terreno || 0);
      });
      let acc = 0;
      const fluxo_caixa = Object.values(anual).map((a) => { a.Saldo_Mes = a.Entradas - a.Total_Saidas; acc += a.Saldo_Mes; a.Saldo_Acumulado = acc; return a; });
      const vgv = c.vgv_total || 0, imp = c.impostos || 0, ter = c.valor_terreno || 0, obr = c.custo_obras || 0;
      const dre = [
        { item: "Receita Bruta", valor: vgv, bold: true }, { item: "(-) Deduções (Distratos)", valor: 0 }, { item: "(-) Impostos s/ Venda", valor: imp },
        { item: "Receita Líquida", valor: vgv - imp, bold: true }, { item: "(-) Custo de Terreno", valor: ter }, { item: "(-) Custos de Obra", valor: obr },
        { item: "Lucro Bruto", valor: vgv - imp - ter - obr, bold: true }, { item: "(-) Despesas Comerciais e MKT", valor: (c.comercial || 0) + (c.marketing || 0) },
        { item: "(-) Despesas Administrativas", valor: (c.adm_despesas || 0) + (c.adm_obras || 0) }, { item: "Resultado Operacional", valor: c.lucro_liquido || 0, bold: true }];
      // planos: as condições de pagamento da viabilidade (no Órion este quadro vinha fixo para as viabilidades)
      const C = this.C(), bins = {};
      const cj = (() => { const v = (fase.revenue || {}).condicoes_pagamento_json; if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return []; } } return v || []; })();
      const plano = (cj || []).find((p) => p && p.nome === (fase.revenue || {}).plano_ativo) || (cj || [])[0];
      ((plano && plano.condicoes) || []).forEach((x) => { const n = /vista/i.test(x.nome) ? 1 : parseInt(String(x.nome).replace(/\D/g, ""), 10) || 1; const kk = C.faixaParcelas(n); bins[kk] = (bins[kk] || 0) + (Number(x.perc) || 0); });
      const expo = c.exposicao_maxima || 0;
      return { viab: true, doc, tir_mensal: c.tir_am, tir_anual: c.tir_aa, mtir_mensal: c.mtir_am, mtir_anual: c.mtir_aa, rent_inv: vgv > 0 ? ((c.lucro_liquido || 0) / vgv) * 100 : 0,
        exposicao_maxima: expo, periodo_exposicao: c.periodo_exposicao || 0, payback: c.payback || 0, vida: c.vida || 0, exposicao_caixa_vgv: vgv ? (Math.abs(expo) / vgv) * 100 : 0,
        dre, fluxo_caixa, planos_vendas: C.planosDasVendas ? C.planosDasVendas(bins) : { curto_longo: [], distribuicao: [] }, velocidade_vendas: [], total_units: 0, total_sold: 0, total_returned: 0, total_balance: 0,
        vgv_estoque: 0, estoque_unidades: 0 };
    },
    graficoRosca(cl) {
      const v = cl.map((x) => Number(x.value) || 0), tot = v.reduce((s, x) => s + x, 0) || 1, cores = ["#105436", "#94a3b8"];
      let ang = -Math.PI / 2;
      const R = 70, r = 50, cx = 110, cy = 95;
      const arcos = v.map((x, i) => {
        const a0 = ang, a1 = ang + (x / tot) * Math.PI * 2 - (x > 0 && x < tot ? 0.03 : 0); ang += (x / tot) * Math.PI * 2;
        if (x <= 0) return "";
        if (x >= tot) return `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${cores[i]}" stroke-width="${R - r}"/>`;
        const p = (a, rr) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`, g = a1 - a0 > Math.PI ? 1 : 0;
        const meio = (a0 + a1) / 2, lx = cx + R * 1.32 * Math.cos(meio), ly = cy + R * 1.32 * Math.sin(meio);
        return `<path d="M${p(a0, R)} A${R},${R} 0 ${g} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${g} 0 ${p(a0, r)} Z" fill="${cores[i]}"/><text x="${lx}" y="${ly}" font-size="11" font-weight="600" fill="#64748b" text-anchor="${lx > cx ? "start" : "end"}" dominant-baseline="central">${x.toFixed(1).replace(".", ",")}%</text>`;
      }).join("");
      return `<svg viewBox="-40 0 300 190" width="100%" height="190">${arcos}</svg>`;
    },
    graficoBarras(dist) {
      const d = dist.filter((x) => (x.curto || 0) + (x.longo || 0) > 0 || true);
      const W = 420, H = 190, L = 34, B = 34, T = 16, mx = Math.max(10, ...d.map((x) => Math.max(x.curto || 0, x.longo || 0)));
      const topo = Math.ceil(mx / 10) * 10, bw = (W - L) / (d.length || 1);
      const y = (v) => T + (H - B - T) * (1 - v / topo);
      return `<svg viewBox="0 0 ${W} ${H + 18}" width="100%" height="${H + 18}">
        ${[0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${L}" x2="${W}" y1="${y(topo * t)}" y2="${y(topo * t)}" stroke="#e2e8f0" stroke-dasharray="3 3"/><text x="${L - 4}" y="${y(topo * t) + 3}" font-size="10" fill="#64748b" text-anchor="end">${Math.round(topo * t)}%</text>`).join("")}
        ${d.map((x, i) => { const v = x.curto || x.longo || 0, cor = x.curto ? "#105436" : "#94a3b8", w = Math.min(34, bw * 0.55), xx = L + i * bw + (bw - w) / 2; return `${v > 0 ? `<rect x="${xx}" y="${y(v)}" width="${w}" height="${H - B - y(v)}" rx="3" fill="${cor}"><title>${this.esc(x.name)}: ${String(v).replace(".", ",")}%</title></rect><text x="${xx + w / 2}" y="${y(v) - 4}" font-size="9" font-weight="600" fill="#64748b" text-anchor="middle">${String(v).replace(".", ",")}%</text>` : ""}<text x="${L + i * bw + bw / 2}" y="${H - B + 16}" font-size="10" fill="#64748b" text-anchor="middle">${this.esc(x.name)}</text>`; }).join("")}
        <circle cx="${W / 2 - 70}" cy="${H + 8}" r="5" fill="#105436"/><text x="${W / 2 - 60}" y="${H + 12}" font-size="10" fill="#105436">Plano Curto</text><circle cx="${W / 2 + 20}" cy="${H + 8}" r="5" fill="#94a3b8"/><text x="${W / 2 + 30}" y="${H + 12}" font-size="10" fill="#64748b">Plano Longo</text></svg>`;
    },
    htmlDetalhe() {
      const C = this.C();
      const lista = this.linhasLista();
      const item = lista.find((r) => r.id === this.aberto);
      if (!item) return `<div style="padding:20px">Empreendimento não encontrado. <button type="button" class="btn btn-secondary" onclick="OrionObrasApp.voltar()">Voltar</button></div>`;
      const ehObra = item.tipo === "obra";
      const sel = window.MlSelectUnico ? MlSelectUnico.html({ id: "oob-sel", label: "Selecione o empreendimento", items: lista.map((r) => ({ id: r.id, label: r.nome })), selectedId: item.id, largura: "340px", semId: true, placeholder: "Digite o nome ou escolha na lista..." })
        : `<div><label class="ml-emp-filter-label">Selecione o empreendimento</label><select class="idx-select" style="height:40px;min-width:320px" onchange="OrionObrasApp.abrir(this.value)">${lista.map((r) => `<option value="${this.esc(r.id)}" ${r.id === item.id ? "selected" : ""}>${this.esc(r.nome)}</option>`).join("")}</select></div>`;
      const barra = `<div class="oac-nao-imprime">${window.OrionFiltros.grade([{ campos: [
          `<div class="ofg-f ofg-span2">${sel}</div>`,
          window.OrionFiltros.campo("Visão de parceria", `<select class="idx-select" ${ehObra ? "" : "disabled title=\"Viabilidade sem obra: só a visão consolidada\""} onchange="OrionObrasApp.setVisao(this.value)">${[["consolidado", "Consolidada"], ["empreendedor", "Empreendedor"], ["parceiro", "Parceiro"]].map(([k, t]) => `<option value="${k}" ${this.visao === k ? "selected" : ""}>${t}</option>`).join("")}</select>`)] }],
          `<button type="button" class="btn oac-out" onclick="OrionObrasApp.comoLemos=true;OrionObrasApp.render()">Como lemos estes números</button>
            ${ehObra ? `<button type="button" class="btn oac-out" ${this.carregando ? "disabled" : ""} onclick="OrionObrasApp.atualizar('${this.esc(item.id)}')">⟳ Atualizar com o Sienge</button>` : ""}
            <button type="button" class="btn btn-primary" onclick="window.print()">⬇ Exportar</button>`, { acaoCls: "ofg-acao3" })}</div>`;
      let d;
      if (ehObra) {
        const acts = this.actsDe(item, this.visao, false);
        if (!acts) return barra + `<div class="oac-card" style="padding:28px;text-align:center;color:#64748b">Este empreendimento ainda não foi lido do Sienge. Clique em <b>Atualizar com o Sienge</b> (lê vendas, realizado e contas em aberto de ${item.membros.map((m) => m.cc).join(", ")}).</div>`;
        d = C.detalheGrupo(acts, this.tmaDe(item.membros.map((m) => m.cc)));
      } else d = this.detalheViab(item);
      if (!d) return barra + `<div class="oac-card" style="padding:28px;text-align:center;color:#64748b">Não encontrei a viabilidade deste item. Abra Órion (transição) › Viabilidades e clique em Atualizar.</div>`;
      this._detalheAtual = { item, d };
      const P = (v) => (v == null ? "n/d" : this.P(v));
      const kpis = `<div class="oac-kpis" style="grid-template-columns:repeat(5,minmax(0,1fr))">
          ${this.kpi("TIR Mensal", P(d.tir_mensal))}${this.kpi("TIR Anual", P(d.tir_anual))}${this.kpi("MTIR Mensal", this.P(d.mtir_mensal || 0))}${this.kpi("MTIR Anual", this.P(d.mtir_anual || 0))}${this.kpi("Rentabilidade do Investimento", d.rent_inv == null ? "—" : this.P(d.rent_inv))}
          ${this.kpi("Exposição Máxima de Caixa", this.R$(d.exposicao_maxima || 0), "neg")}${this.kpi("Período (Exposição)", this.N(d.periodo_exposicao || 0))}${this.kpi("Payback", this.N(d.payback || 0))}${this.kpi("Vida", this.N(d.vida || 0))}${this.kpi("Exposição de Caixa / VGV", this.P(d.exposicao_caixa_vgv || 0))}</div>`;
      const nomeDre = (t) => { const s = String(t || ""); return s === s.toUpperCase() && /[A-Z]/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s; };
      const dre = `<div class="oac-card"><h3>DRE</h3><table class="cc-table" style="font-size:0.8rem"><colgroup><col><col style="width:170px"></colgroup><tbody>${d.dre.map((r) => `<tr><td style="${r.indent ? "padding-left:22px;color:#4a6355" : ""}${r.bold ? "font-weight:800;color:#1c2e24" : ""}">${this.esc(nomeDre(r.item))}</td><td class="is-right" style="${r.bold ? "font-weight:800;" : ""}${typeof r.valor === "number" && r.valor < 0 ? "color:#b91c1c" : ""}">${r.is_percentage ? this.esc(String(r.valor).replace(".", ",")) : this.R$(r.valor)}</td></tr>`).join("")}</tbody></table></div>`;
      const pv = d.planos_vendas || { curto_longo: [], distribuicao: [] };
      const temPlanos = (pv.curto_longo || []).some((x) => x.value > 0);
      const planos = `<div class="oac-card"><h3>Planos contratados</h3>${temPlanos ? `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.9fr);gap:8px;padding:12px 14px;align-items:center">
          <div>${this.graficoRosca(pv.curto_longo)}<div style="font-size:0.66rem;color:#64748b;font-weight:600">**Plano Curto: Até 48x<br>e Plano Longo: de 60x até 180x</div></div><div>${this.graficoBarras(pv.distribuicao.filter((x) => x.curto || x.longo))}</div></div>
          ${d.viab ? `<div style="font-size:0.68rem;color:#64748b;padding:0 14px 10px">Viabilidade sem vendas: percentual do VGV pelas condições do plano de pagamento da viabilidade.</div>` : ""}` : `<div style="padding:24px;text-align:center;color:#64748b;font-size:0.85rem">Sem contratos de venda para montar os planos.</div>`}</div>`;
      let vel = "";
      (d.velocidade_vendas || []).forEach((a) => {
        const ab = !!this.velAbertos[a.ano];
        vel += `<tr class="oac-ano" onclick="OrionObrasApp.alternarAno('${a.ano}')"><td>${ab ? "▾" : "▸"} ${a.ano}</td><td class="is-center">${a.vendas}</td><td class="is-center">${a.distratos > 0 ? a.distratos : "-"}</td><td class="is-center">${a.saldo}</td><td class="is-center">${Number(a.perc).toFixed(2).replace(".", ",")}%</td><td class="is-center">${Number(a.vel).toFixed(2).replace(".", ",")}%</td></tr>`;
        if (ab) (a.meses || []).forEach((m) => { vel += `<tr><td style="padding-left:28px">${MESES[Number(String(m.mes).slice(5, 7)) - 1] || m.mes}</td><td class="is-center">${m.vendas}</td><td class="is-center">${m.distratos > 0 ? m.distratos : "-"}</td><td class="is-center">${m.saldo}</td><td class="is-center">${Number(m.perc).toFixed(2).replace(".", ",")}%</td><td class="is-center">${Number(m.vel).toFixed(2).replace(".", ",")}%</td></tr>`; });
      });
      const vt = (d.velocidade_vendas || []).reduce((s, a) => ({ v: s.v + a.vendas, d: s.d + a.distratos, s: s.s + a.saldo, p: s.p + a.perc, ve: s.ve + a.vel }), { v: 0, d: 0, s: 0, p: 0, ve: 0 });
      const velT = `<div class="oac-card"><h3>Velocidade de vendas</h3><div class="cc-scroll" style="max-height:420px"><table class="cc-table" style="font-size:0.78rem"><thead><tr><th>Ano / mês</th><th class="is-center">Vendas</th><th class="is-center">Distratos</th><th class="is-center">Saldo</th><th class="is-center">% sobre total vendido</th><th class="is-center">Velocidade</th></tr></thead>
          <tbody>${vel || `<tr><td colspan="6" style="text-align:center;padding:14px">Nenhum dado de velocidade de vendas disponível.</td></tr>`}${vel ? `<tr class="oob-total"><td>Total</td><td class="is-center">${vt.v}</td><td class="is-center">${vt.d}</td><td class="is-center">${vt.s}</td><td class="is-center">${vt.p.toFixed(2).replace(".", ",")}%</td><td class="is-center">${vt.ve.toFixed(2).replace(".", ",")}%</td></tr>` : ""}</tbody></table></div></div>`;
      const cols = [["Entradas", "Entradas"], ["Devolucao_Distratos", "Dev. Distrato"], ["Tributos", "Tributos"], ["Terreno", "Terreno"], ["Obras", "Obras"], ["Projetos", "Projetos"], ["Marketing", "MKT"], ["Comercial", "Comercial"], ["Administrativas", "Admin"], ["Total_Saidas", "Total Saídas (T)"], ["Saldo_Mes", "Saldo"], ["Saldo_Acumulado", "Saldo acumulado"]];
      const tot = {}; cols.forEach(([k]) => { tot[k] = (d.fluxo_caixa || []).reduce((s, r) => s + (r[k] || 0), 0); });
      const fluxo = `<div class="oac-card"><h3>Fluxo de caixa</h3><div class="cc-scroll" style="max-height:60vh"><table class="cc-table or-larga" style="font-size:0.78rem"><thead><tr><th>Ano</th>${cols.map(([, t]) => `<th class="is-right">${t}</th>`).join("")}</tr></thead>
          <tbody>${(d.fluxo_caixa || []).map((r) => `<tr class="${r.is_forecast ? "oac-prev" : ""}"><td style="font-weight:700">${this.esc(r.Ano)}${r.is_forecast ? ` <span class="oac-badge" style="background:#dbeafe;color:#1d4ed8">Previsto</span>` : ""}</td>${cols.map(([k]) => `<td class="is-right">${this.R$(r[k] || 0)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length + 1}" style="text-align:center;padding:14px">Nenhum fluxo de caixa projetado / realizado disponível.</td></tr>`}
          ${(d.fluxo_caixa || []).length ? `<tr class="oob-total"><td>Total</td>${cols.map(([k]) => `<td class="is-right">${k === "Saldo_Acumulado" ? "" : this.R$(tot[k])}</td>`).join("")}</tr>` : ""}</tbody></table></div></div>`;
      const cache = ehObra ? this.cache[item.chave] : null;
      const info = `<div style="font-size:0.72rem;color:#6b8474;margin:-6px 0 12px">${this.esc(item.nome)} · ${this.esc(item.cidade)} · ${this.esc(item.status)} · ${this.badge(item.categoria)}${ehObra ? ` · centros ${item.membros.map((m) => this.esc(m.cc)).join(", ")}${cache ? ` · lido do Sienge em ${new Date(cache.em).toLocaleString("pt-BR")}${cache.por ? " por " + this.esc(cache.por) : ""}` : ""}` : " · números da viabilidade aprovada"}${ehObra && this.visao !== "consolidado" ? " · visão " + this.visao + ": " + this.esc(item.membros.map((m) => { const par = this.parceriaDoCc(m.cc); return par ? `${m.cc} parceiro ${String(par.pct).replace(".", ",")}% (Parametrização de Parceiro${par.nome ? " " + par.nome : ""})` : null; }).filter(Boolean).join("; ") || "sem Parametrização de Parceiro para estes centros (usa a participação do Órion)") : ""}</div>`;
      return barra + info + kpis + `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start"><div>${dre}</div><div>${planos}${velT}</div></div>` + fluxo;
    },

    /* ---------- Como lemos estes números ---------- */
    htmlComoLemos() {
      const det = this.aberto && this._detalheAtual && this._detalheAtual.item.id === this.aberto ? this._detalheAtual : null;
      const l = this.filtrada();
      let fatos = null;
      if (det) fatos = this.fatosComoLemos(det.item, det.d);
      else if (l.length === 1) { const k = l[0].kpis || {}; fatos = { nome: l[0].nome, fase: l[0].status, estoqueUnidades: 0, vgvEstoque: 0, terreno: 0, obrasPagas: 0, obrasPrevistas: 0, tirAnual: Number(k.tir_anual) || 0, mtirAnual: Number(k.mtir_anual) || 0, payback: Number(k.payback) || 0, exposicao: Number(k.exposicao_max_caixa) || 0 }; }
      return this.htmlComoLemosPara(fatos, "OrionObrasApp.comoLemos=false;OrionObrasApp.render()");
    },
    /** Fatos do painel "Como lemos estes números" a partir do detalhe de um empreendimento (detalheGrupo). */
    fatosComoLemos(item, d) {
      const fc = d.fluxo_caixa || [];
      let pagas = 0, prev = 0, ter = 0;
      fc.forEach((r) => { const o = Math.abs(Number(r.Obras) || 0); ter += Math.abs(Number(r.Terreno) || 0); if (r.is_forecast) prev += o; else pagas += o; });
      const terDre = (d.dre || []).find((r) => /terreno|aquisi[cç][aã]o (de )?[aá]rea/i.test(String(r.item || "")));
      return { nome: item.nome, fase: item.status, estoqueUnidades: d.estoque_unidades || 0, vgvEstoque: d.vgv_estoque || 0, terreno: terDre ? Math.abs(Number(terDre.valor) || 0) : ter, obrasPagas: pagas, obrasPrevistas: prev, tirAnual: Number(d.tir_anual) || 0, mtirAnual: Number(d.mtir_anual) || 0, payback: Number(d.payback) || 0, exposicao: Number(d.exposicao_maxima) || 0 };
    },
    /** Painel "Como lemos estes números" (usado no Acompanhamento e na DFC de empreendimentos). extra = html a mais no fim. */
    htmlComoLemosPara(fatos, fecharJs, extra) {
      this.estilosTela();
      const f1 = (v) => (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const tir = fatos ? ((Number(fatos.tirAnual) || 0) === 0 && (Number(fatos.mtirAnual) || 0) > 0.5
        ? `TIR clássica só existe se o caixa começa com investimento. Neste produto o card pode mostrar 0% — a taxa da vida é a MTIR ${f1(fatos.mtirAnual)}%. Payback ${Math.round(fatos.payback)} meses. Exposição máxima ${this.miPainel(Math.abs(fatos.exposicao))}.`
        : `TIR clássica ${f1(fatos.tirAnual)}%. MTIR ${f1(fatos.mtirAnual)}% (TMA 12%). Payback ${Math.round(fatos.payback)} meses. Exposição máxima ${this.miPainel(Math.abs(fatos.exposicao))}.`)
        : "A TIR clássica só existe se o caixa começa com investimento. Se o primeiro mês já é entrada, o card pode mostrar 0% — a taxa da vida é a MTIR (TMA 12%). Payback e exposição leem o mesmo fluxo.";
      const camada = (cor, t, x) => `<div style="display:flex;gap:10px"><div style="width:6px;border-radius:4px;background:${cor};flex-shrink:0"></div><div><p style="font-weight:700;color:#1c2e24">${t}</p><p>${x}</p></div></div>`;
      const tile = (r, v) => `<div style="flex:1;border:1px solid #dfe9e3;border-radius:8px;padding:10px;background:#f7faf8"><div style="font-size:0.66rem;font-weight:700;color:#64748b;text-transform:uppercase">${r}</div><div style="font-size:1rem;font-weight:800;color:#105436">${v}</div></div>`;
      return `<div class="oac-painel-fundo" onclick="if(event.target===this){${fecharJs}}"><aside class="oac-painel" role="dialog" aria-modal="true">
        <header><div><div style="font-size:0.66rem;font-weight:800;color:#f37021;text-transform:uppercase;letter-spacing:.06em">Método</div><div style="font-size:1.2rem;font-weight:800;color:#105436">Como lemos estes números</div><div style="font-size:0.8rem;color:#6b8474">${fatos ? this.esc([fatos.nome, fatos.fase].filter(Boolean).join(" · ")) : "O método é o mesmo em todos os produtos. Abra um empreendimento para ver os números desta obra."}</div></div>
          <button type="button" class="btn oac-out" style="height:34px;align-self:flex-start;white-space:nowrap;padding:0 12px" onclick="${fecharJs}">✕ Fechar</button></header>
        <div class="corpo">
          ${fatos ? `<div style="display:flex;gap:8px">${tile("Pago (obra)", this.miPainel(fatos.obrasPagas))}${tile("Cronograma de obra", this.miPainel(fatos.obrasPrevistas))}${tile("Terreno", this.miPainel(fatos.terreno))}</div>` : ""}
          <div style="display:flex;flex-direction:column;gap:12px">${camada("#f59e0b", "Cronograma de desembolso de obra", "Olhamos o saldo do orçamento da obra que ainda não foi pago nem comprometido e jogamos no cronograma a partir do mês que vem.")}${camada("#0284c7", "Vendas de lotes em estoque", "Olhamos os últimos 6 meses que tiveram venda e fazemos a média do m².")}${camada("#1b8253", "Comprometido", "Olhamos os títulos em aberto no Sienge: já lançados, ainda sem baixa.")}${camada("#105436", "Pago", "Olhamos as baixas do Sienge: o que já entrou ou saiu do caixa.")}</div>
          ${fatos && fatos.estoqueUnidades > 0 ? `<p style="background:#f0f9ff;border-radius:8px;padding:8px 10px">Estoque neste produto: ${fatos.estoqueUnidades} unidades${fatos.vgvEstoque > 0 ? " · " + this.miPainel(fatos.vgvEstoque) : ""}.</p>` : ""}
          <section><h4>VGV e estoque</h4><p>O VGV vendido soma os contratos. O estoque é a área que ainda não vendeu, vezes a média do m² dos últimos 6 meses com venda.</p></section>
          <section><h4>DRE</h4><p>O lucro operacional é caixa: entrada menos saída. Não é o VGV dos contratos.</p></section>
          <section><h4>TIR e MTIR</h4><p>${this.esc(tir)}</p></section>${extra || ""}</div></aside></div>`;
    }
  });

  /* tela: título, abas Visão Geral / Empreendimentos e o painel do método, em volta do que orion-obras.js já desenha */
  A.render = function () {
    if (window.OrionObrasDfcApp && document.getElementById("orion-obras-dfc-root") && document.getElementById("orion-obras-dfc-root").offsetParent) { try { OrionObrasDfcApp.render(); } catch (e) { /* tela da DFC */ } }
    const root = this.root();
    if (!root) return;
    if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    this.estilosTela();
    if (!document.getElementById("oob-estilos")) { const st = document.createElement("style"); st.id = "oob-estilos"; st.textContent = ".cc-table tr.oob-total td { background:#105436 !important; color:#fff !important; font-weight:800; }"; document.head.appendChild(st); }
    const cab = this.editor ? "" : `<div class="oac-cab"><h2 class="oac-titulo">Acompanhamento de empreendimentos</h2>${this.aberto ? "" : `<button type="button" class="btn oac-out oac-nao-imprime" style="height:40px" onclick="OrionObrasApp.comoLemos=true;OrionObrasApp.render()">Como lemos estes números</button>`}</div>
      <div class="oac-abas oac-nao-imprime"><button type="button" class="oac-aba ${this.aberto ? "" : "on"}" onclick="OrionObrasApp.voltar()">Visão Geral</button><button type="button" class="oac-aba ${this.aberto ? "on" : ""}" onclick="OrionObrasApp.irEmpreendimentos()">Empreendimentos</button></div>`;
    root.innerHTML = `${cab}${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#105436;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : ""}
      ${this.carregando ? `<div style="text-align:center;padding:16px;color:#64748b;"><div class="spinner" style="margin:0 auto 10px;"></div>${this.esc(this.passo || "Aguarde…")}</div>` : ""}
      ${this.editor ? this.htmlEditor() : this.grupos ? (this.aberto ? this.htmlDetalhe() : this.htmlLista()) : ""}
      ${this.comoLemos && !this.editor ? this.htmlComoLemos() : ""}`;
    if (window.lucide && window.lucide.createIcons) { try { window.lucide.createIcons(); } catch (e) { /* ícones */ } }
    if (this.editor || !this.grupos) return;
    if (this.aberto) {
      if (window.MlSelectUnico && document.getElementById("oob-sel")) MlSelectUnico.bind("oob-sel", { onSelect: (id) => this.abrir(id) });
      return;
    }
    if (!window.MlEmpresaFilter) return;
    const todas = this.linhasLista();
    const liga = (id, campo, aberto, busca, valores) => {
      if (!document.getElementById(id)) return;
      MlEmpresaFilter.bind(id, {
        toggleOpen: () => { this[aberto] = !this[aberto]; this.render(); },
        close: () => { if (this[aberto]) { this[aberto] = false; setTimeout(() => this.render(), 0); } },
        setQuery: (q) => { this[busca] = q; this.render(); },
        toggleId: (x, on) => { const s = new Set(this[campo]); if (on) s.add(x); else s.delete(x); this[campo] = [...s]; this.render(); },
        selectAll: () => { this[campo] = valores; this.render(); },
        selectNone: () => { this[campo] = []; this.render(); }
      });
    };
    liga("oob-emp", "filtroEmp", "filtroEmpAberto", "filtroEmpBusca", [...new Set(todas.map((r) => r.nome))]);
    liga("oob-cat", "filtroCats", "filtroCatAberto", "filtroCatBusca", [...new Set(todas.map((r) => r.categoria))]);
    liga("oob-st", "filtroSts", "filtroStAberto", "filtroStBusca", [...new Set(todas.map((r) => r.status))]);
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && A.comoLemos) { A.comoLemos = false; A.render(); } });
})();
