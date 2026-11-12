/* Órion (transição) › Orçado × Realizado — vindo do ML Órion (Orçamento › Orçado x Realizado), com as abas do Órion:
 * Consolidado (leitura executiva por bloco: resultado, receitas, despesas, vendas; pontos de atenção; maiores causas;
 * composição do desvio por empreendimento ou por plano, com filtro de peso; referência × realizado por mês),
 * Despesas, Receitas, Vendas, Comparativo de versões e Visualização.
 * Usa a mesma leitura do Resumo do orçamento (orçado/forecast do Integra + realizado pela regra do Integra) e os mesmos filtros.
 * Vendas: o realizado de vendas ainda não tem fonte no Integra (a tela mostra o orçado). Só leitura. */
(function () {
  const Base = typeof OrionResumoApp !== "undefined" ? OrionResumoApp : null;
  if (!Base) return;
  const App = Object.create(Base);
  Object.assign(App, {
    ano: String(new Date().getFullYear()), dept: "TODOS", ate: null, base: "orcamento", versao: "", empresas: [], meses: null,
    cabs: { orcamento: null, forecast: null }, resultado: null, abertos: {}, carregando: false, erro: "", passo: "",
    aba: "consolidado", bloco: "resultado", comp: "produto", peso: 0, visaoComp: "destaques", desvio: "todos", ordem: "abs",
    cmpA: "", cmpB: "", cmpTipo: "DESPESAS", cmpRes: null,

    root() { return document.getElementById("orion-oxr-root"); },
    setAba(v) { this.aba = v; this.render(); },
    setCampo(c, v) { this[c] = v; if (c === "cmpTipo") { this.cmpA = ""; this.cmpB = ""; this.cmpRes = null; } this.render(); },

    /** Linhas cc×plano com referência e realizado no período (despesa positiva), por tipo. */
    linhasTipo(tipo) {
      const C = this.C(), F = window.OrionFiltros;
      const d = this.resultado;
      const ms = F.mesesAtivos(this, d.ate);
      const src = tipo === "RECEITAS" ? d.rec : d.desp;
      const f = F.filtrarEmpresas(this, src, d.real.alocacoes);
      const r = tipo === "RECEITAS" ? C.resumoGeral([], f.linhas, f.alocacoes, ms) : C.resumoGeral(f.linhas, [], f.alocacoes, ms);
      const out = [];
      r.grupos.forEach((g) => g.planos.forEach((p) => out.push({ produto: p.cc, produto_nome: p.cc_nome || g.cc_nome, plano: p.plano, plano_nome: p.plano_nome, ref: p.orcado, real: p.realizado, o: p.o, r: p.r })));
      return { linhas: out, mensal: r.mensal.filter((m) => m.usado), kpis: r.kpis };
    },

    farolCor(fav, perc) { return fav ? "#10b981" : Math.abs(perc) <= 0.05 ? "#10b981" : Math.abs(perc) <= 0.1 ? "#fbbf24" : "#ef4444"; },

    htmlConsolidado() {
      const C = this.C();
      const f = (c) => C.fmtReais(c, true);
      const D = this.linhasTipo("DESPESAS"), Rc = this.linhasTipo("RECEITAS");
      let ins, mensal;
      if (this.bloco === "despesas") { ins = C.insightsBloco(D.linhas, "DESPESAS", "Despesas"); mensal = D.mensal.map((m) => ({ mes: m.mes, ref: m.desp_orcado, real: m.desp_realizado })); }
      else if (this.bloco === "receitas") { ins = C.insightsBloco(Rc.linhas, "RECEITAS", "Receitas"); mensal = Rc.mensal.map((m) => ({ mes: m.mes, ref: m.rec_orcado, real: m.rec_realizado })); }
      else if (this.bloco === "vendas") return this.htmlVendas(true);
      else {
        const neg = (l) => Object.assign({}, l, { ref: -l.ref, real: -l.real });
        ins = C.insightsBloco(Rc.linhas.concat(D.linhas.map(neg)), "RESULTADO", "Resultado (receitas − despesas)");
        mensal = Rc.mensal.map((m, i) => ({ mes: m.mes, ref: m.rec_orcado - D.mensal[i].desp_orcado, real: m.rec_realizado - D.mensal[i].desp_realizado }));
      }
      const ref = this.base === "forecast" ? "Forecast" : "Orçado";
      const cor = ins.veredito === "favoravel" ? "#105436" : ins.veredito === "neutro" ? "#64748b" : "#b91c1c";
      const blocos = [["resultado", "Resultado"], ["receitas", "Receitas"], ["despesas", "Despesas"], ["vendas", "Vendas"]].map(([k, t]) => `<button type="button" class="btn ${this.bloco === k ? "btn-primary" : "btn-secondary"}" style="height:32px" onclick="OrionOxRApp.setCampo('bloco', '${k}')">${t}</button>`).join("");
      const lista = (this.comp === "plano" ? ins.porPlano : ins.porProduto).filter((g) => g.peso >= this.peso);
      const comp = lista.map((g) => `<tr><td>${this.esc(g.chave)} ${this.esc(g.nome)}</td><td class="is-right">${f(g.ref)}</td><td class="is-right">${f(g.real)}</td><td class="is-right" style="color:${g.favoravel ? "#105436" : "#b91c1c"}">${f(g.var)}</td>
        <td><div style="display:flex;align-items:center;gap:6px"><div style="height:8px;width:${Math.max(2, Math.round(g.peso * 160))}px;background:${g.favoravel ? "#10b981" : "#ef4444"};border-radius:4px"></div>${(g.peso * 100).toFixed(1)}%</div></td></tr>`).join("");
      const top = ins.linhas.slice(0, 5).map((l) => `<tr><td>${this.esc(l.produto)} ${this.esc(l.produto_nome)}</td><td>${this.esc(l.plano)} ${this.esc(l.plano_nome)}</td><td class="is-right">${f(l.ref)}</td><td class="is-right">${f(l.real)}</td><td class="is-right" style="color:${l.favoravel ? "#105436" : "#b91c1c"}">${f(l.var)}</td><td class="is-right">${(l.perc * 100).toFixed(1)}%</td><td class="is-right">${(l.peso * 100).toFixed(1)}%</td></tr>`).join("");
      const max = Math.max(1, ...mensal.map((m) => Math.max(Math.abs(m.ref), Math.abs(m.real))));
      const barras = mensal.map((m) => { const v = m.real - m.ref; const favo = this.bloco === "despesas" ? v <= 0 : v >= 0; return `<div style="text-align:center;width:64px"><div style="height:90px;display:flex;align-items:flex-end;justify-content:center;gap:3px"><div title="${ref}: ${f(m.ref)}" style="width:14px;height:${Math.round(Math.abs(m.ref) / max * 88)}px;background:#94a3b8"></div><div title="Realizado: ${f(m.real)}" style="width:14px;height:${Math.round(Math.abs(m.real) / max * 88)}px;background:${favo ? "#1b8253" : "#ef4444"}"></div></div><div style="font-size:0.65rem">${C.MESES[m.mes - 1]}</div><div style="font-size:0.62rem;color:${favo ? "#105436" : "#b91c1c"}">${f(v)}</div></div>`; }).join("");
      return `<div style="display:flex;gap:6px;margin-bottom:10px">${blocos}</div>
        <div style="border:1px solid #e2e8f0;border-left:4px solid ${cor};border-radius:8px;padding:10px 14px;margin-bottom:12px">
          <div style="font-size:0.7rem;color:#64748b;text-transform:uppercase">Leitura executiva</div>
          <div style="font-size:0.9rem;margin:4px 0">${this.esc(ins.narrativa)}</div>
          <div style="display:flex;gap:18px;font-size:0.8rem;flex-wrap:wrap"><span>${ref}: <b>${f(ins.ref)}</b></span><span>Realizado: <b>${f(ins.real)}</b></span><span>Variação total: <b style="color:${cor}">${f(ins.var)} (${(ins.perc * 100).toFixed(1)}%)</b></span><span>${ins.contagem.comDesvio} linhas com desvio · ${ins.contagem.favoravel} favoráveis · ${ins.contagem.desfavoravel} desfavoráveis</span></div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><div class="or-sec">Pontos de atenção</div>${ins.alertas.length ? ins.alertas.map((a) => `<div style="border:1px solid ${a.tom === "vermelho" ? "#fecaca" : "#fde68a"};background:${a.tom === "vermelho" ? "#fef2f2" : "#fffbeb"};border-radius:8px;padding:8px 10px;margin-bottom:6px;font-size:0.78rem"><b>${this.esc(a.titulo)}</b><br>${this.esc(a.detalhe)}</div>`).join("") : `<div style="font-size:0.8rem;color:#64748b">Nenhum alerta crítico.</div>`}</div>
          <div><div class="or-sec">Referência × Realizado por mês</div><div style="display:flex;gap:2px;overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;padding:6px">${barras}</div></div>
        </div>
        <div class="or-sec">Top drivers (linha)</div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col><col><col style="width:120px"><col style="width:120px"><col style="width:120px"><col style="width:80px"><col style="width:80px"></colgroup>
          <thead><tr><th>Produto</th><th>Plano</th><th class="is-right">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Variação</th><th class="is-right">Var. %</th><th class="is-right">Peso</th></tr></thead><tbody>${top || `<tr><td colspan="7" style="text-align:center;padding:12px">Nenhum desvio neste filtro.</td></tr>`}</tbody></table></div>
        <div class="or-sec" style="display:flex;gap:6px;align-items:center">Composição do desvio
          <button type="button" class="btn ${this.comp === "produto" ? "btn-primary" : "btn-secondary"}" style="height:28px;font-size:0.72rem" onclick="OrionOxRApp.setCampo('comp', 'produto')">Por produto</button>
          <button type="button" class="btn ${this.comp === "plano" ? "btn-primary" : "btn-secondary"}" style="height:28px;font-size:0.72rem" onclick="OrionOxRApp.setCampo('comp', 'plano')">Por plano</button>
          <select class="idx-select" style="height:28px;font-size:0.72rem" onchange="OrionOxRApp.setCampo('peso', Number(this.value))">${[[0, "Toda materialidade"], [0.01, "Peso ≥ 1%"], [0.05, "Peso ≥ 5%"]].map(([v, t]) => `<option value="${v}" ${this.peso === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:130px"><col style="width:130px"><col style="width:130px"><col style="width:240px"></colgroup>
          <thead><tr><th>${this.comp === "plano" ? "Plano" : "Produto"}</th><th class="is-right">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Variação</th><th>Peso no desvio</th></tr></thead><tbody>${comp || `<tr><td colspan="5" style="text-align:center;padding:12px">Nenhuma linha neste filtro.</td></tr>`}</tbody></table></div>`;
    },

    htmlTipo(tipo) {
      const C = this.C();
      const f = (c) => C.fmtReais(c, true);
      const t = this.linhasTipo(tipo);
      const inv = tipo === "DESPESAS";
      let ls = t.linhas.map((l) => Object.assign({}, l, { var: l.real - l.ref }));
      if (this.ordem === "abs") ls.sort((a, b) => Math.abs(b.var) - Math.abs(a.var));
      else if (this.ordem === "produto") ls.sort((a, b) => String(a.produto).localeCompare(String(b.produto), "pt-BR", { numeric: true }));
      else ls.sort((a, b) => String(a.plano).localeCompare(String(b.plano), "pt-BR", { numeric: true }));
      const ref = this.base === "forecast" ? "Forecast" : "Orçado";
      const tot = ls.reduce((s2, l) => ({ ref: s2.ref + l.ref, real: s2.real + l.real }), { ref: 0, real: 0 });
      const corpo = ls.map((l) => { const fav = inv ? l.var <= 0 : l.var >= 0; const s = C.semaforo(l.real, l.ref, tipo); return `<tr><td>${this.esc(l.produto)} ${this.esc(l.produto_nome)}</td><td>${this.esc(l.plano)} ${this.esc(l.plano_nome)}</td><td class="is-right">${f(l.ref)}</td><td class="is-right">${f(l.real)}</td><td class="is-right" style="color:${fav ? "#105436" : "#b91c1c"}">${f(l.var)}</td><td class="is-right">${l.ref ? ((l.var / Math.abs(l.ref)) * 100).toFixed(1) + "%" : "—"}</td><td>${this.farol(s)}</td></tr>`; }).join("");
      return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:0.75rem">Ordenar:
          ${[["abs", "Maior desvio"], ["produto", "Produto"], ["plano", "Plano"]].map(([k, x]) => `<button type="button" class="btn ${this.ordem === k ? "btn-primary" : "btn-secondary"}" style="height:28px;font-size:0.72rem" onclick="OrionOxRApp.setCampo('ordem', '${k}')">${x}</button>`).join("")}
          <span style="margin-left:auto;color:#64748b">Mês a mês e pagamentos: Órion (transição) › Analítico de gastos</span></div>
        <div class="cc-scroll" style="max-height:66vh"><table class="cc-table"><colgroup><col><col><col style="width:130px"><col style="width:130px"><col style="width:130px"><col style="width:80px"><col style="width:150px"></colgroup>
          <thead><tr><th>Produto</th><th>Plano</th><th class="is-right">${ref}</th><th class="is-right">Realizado</th><th class="is-right">Variação</th><th class="is-right">Var. %</th><th>Semáforo</th></tr></thead>
          <tbody>${corpo || `<tr><td colspan="7" style="text-align:center;padding:20px">Nenhuma linha neste filtro.</td></tr>`}<tr class="or-total"><td colspan="2">Total</td><td class="is-right">${f(tot.ref)}</td><td class="is-right">${f(tot.real)}</td><td class="is-right">${f(tot.real - tot.ref)}</td><td></td><td></td></tr></tbody></table></div>`;
    },

    htmlVendas(resumido) {
      const C = this.C(), F = window.OrionFiltros;
      const d = this.resultado;
      const ms = new Set(F.mesesAtivos(this, d.ate));
      let vs = (d.vendas || []).filter((v) => ms.has(Number(v.mes)));
      if (this.empresas && this.empresas.length) { const mapa = F.mapaCcEmpresa(), emp = new Set(this.empresas.map(String)); vs = vs.filter((v) => emp.has(mapa[v.cc] || "")); }
      const por = new Map();
      vs.forEach((v) => { const k = v.cc; if (!por.has(k)) por.set(k, { cc: k, nome: v.cc_nome || "", un: 0, vgv: 0, dist: 0, vgvDist: 0 }); const p = por.get(k); const n = Number(v.vendas) || 0; if (n < 0 || v.distrato) { p.dist += Math.abs(n); p.vgvDist += Math.abs(Number(v.vgv) || 0); } else { p.un += n; p.vgv += Number(v.vgv) || 0; } });
      const l = [...por.values()].sort((a, b) => b.vgv - a.vgv);
      const tot = l.reduce((s2, x) => ({ un: s2.un + x.un, vgv: s2.vgv + x.vgv, dist: s2.dist + x.dist, vgvDist: s2.vgvDist + x.vgvDist }), { un: 0, vgv: 0, dist: 0, vgvDist: 0 });
      const ref = this.base === "forecast" ? "Forecast" : "Orçado";
      return `<div style="padding:8px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;margin-bottom:10px;font-size:0.78rem">Vendas: ${ref.toLowerCase()} do período. O realizado de vendas (contratos assinados por mês) ainda não tem fonte no Integra; a posição atual de vendidos e estoque está em Órion (transição) › Acompanhamento de empreendimentos.</div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:110px"><col style="width:150px"><col style="width:110px"><col style="width:150px"><col style="width:150px"><col style="width:130px"></colgroup>
          <thead><tr><th>Empreendimento</th><th class="is-right">Nº lotes</th><th class="is-right">VGV vendas</th><th class="is-right">Distratos (un.)</th><th class="is-right">VGV distratos</th><th class="is-right">VGV líquido</th><th class="is-right">Ticket médio</th></tr></thead>
          <tbody>${l.map((x) => `<tr><td>${this.esc(x.cc)} ${this.esc(x.nome)}</td><td class="is-right">${x.un}</td><td class="is-right">${C.fmtReais(x.vgv, true)}</td><td class="is-right">${x.dist}</td><td class="is-right">${C.fmtReais(x.vgvDist, true)}</td><td class="is-right">${C.fmtReais(x.vgv - x.vgvDist, true)}</td><td class="is-right">${x.un ? C.fmtReais(Math.round(x.vgv / x.un), true) : "—"}</td></tr>`).join("") || `<tr><td colspan="7" style="text-align:center;padding:20px">Sem orçamento de vendas no período.</td></tr>`}
          <tr class="or-total"><td>Total</td><td class="is-right">${tot.un}</td><td class="is-right">${C.fmtReais(tot.vgv, true)}</td><td class="is-right">${tot.dist}</td><td class="is-right">${C.fmtReais(tot.vgvDist, true)}</td><td class="is-right">${C.fmtReais(tot.vgv - tot.vgvDist, true)}</td><td class="is-right">${tot.un ? C.fmtReais(Math.round(tot.vgv / tot.un), true) : "—"}</td></tr></tbody></table></div>`;
    },

    /* ----- comparativo de versões ----- */
    versoesComparaveis() {
      const l = [];
      const add = (col, c) => l.push({ id: col + ":" + c._id, col, cab: c, rot: `${col === "orcamento" ? "Orçamento" : "Forecast"} · ${c.descricao} · V${c.versao} · ${c.departamento ? c.departamento.nome : ""} · ${c.status}` });
      (this.cabsOrc || []).filter((c) => String(c.ano) === String(this.ano) && String(c.tipo).toUpperCase() === this.cmpTipo).forEach((c) => add("orcamento", c));
      (this.cabsFc || []).filter((c) => String(c.ano) === String(this.ano) && String(c.tipo).toUpperCase() === this.cmpTipo).forEach((c) => add("forecast", c));
      return l;
    },
    async carregarCabsComparativo() {
      const fc = this.fc();
      const ler = async (col) => { const snap = await fc.getDocs(fc.collection(window.firebaseDb, col)); const l = []; snap.forEach((d) => l.push(d.data())); return l; };
      this.cabsOrc = await ler("orion_orcamentos");
      this.cabsFc = await ler("orion_forecasts");
      this.render();
    },
    async comparar() {
      const vs = this.versoesComparaveis();
      const a = vs.find((x) => x.id === this.cmpA), b = vs.find((x) => x.id === this.cmpB);
      if (!a || !b) { this.erro = "Selecione duas versões para comparar."; return this.render(); }
      this.carregando = true; this.erro = ""; this.render();
      try {
        const lerDoc = async (x) => { const fc = this.fc(), blocos = []; const col = x.col === "orcamento" ? "orion_orcamento_itens" : "orion_forecast_itens"; for (let k = 0; k < (x.cab.blocos || 1); k++) { const s = await fc.getDoc(fc.doc(window.firebaseDb, col, `${x.cab._id}_${k}`)); if (s.exists()) blocos.push(s.data()); } return this.C().juntarBlocos(blocos).itens; };
        const la = await lerDoc(a), lb = await lerDoc(b);
        const k = (l) => String(l.cc).replace(/\D/g, "") + "|" + String(l.plano).replace(/\D/g, "");
        const mb = new Map(lb.map((l) => [k(l), l])), ma = new Map(la.map((l) => [k(l), l]));
        const itens = [];
        new Set([...ma.keys(), ...mb.keys()]).forEach((key) => {
          const x = ma.get(key), y = mb.get(key);
          const base = x ? x.m : new Array(12).fill(0), comp = y ? y.m : new Array(12).fill(0);
          const tb = base.reduce((s2, v) => s2 + v, 0), tc = comp.reduce((s2, v) => s2 + v, 0);
          const l = x || y;
          itens.push({ cc: l.cc, cc_nome: l.cc_nome, plano: l.plano, plano_nome: l.plano_nome, base, comp, tb, tc, dif: tc - tb, situacao: !x ? "inclusao" : !y ? "exclusao" : tc !== tb ? "alteracao" : "igual" });
        });
        this.cmpRes = { a, b, itens: itens.sort((p, q) => Math.abs(q.dif) - Math.abs(p.dif)) };
      } catch (e) { this.erro = e.message || String(e); }
      this.carregando = false;
      this.render();
    },
    htmlComparativo() {
      const C = this.C();
      if (!this.cabsOrc) { this.carregarCabsComparativo(); return `<div style="padding:20px;color:#64748b">Carregando versões…</div>`; }
      const vs = this.versoesComparaveis();
      const op = (sel) => `<option value="">Selecione…</option>` + vs.map((x) => `<option value="${this.esc(x.id)}" ${x.id === sel ? "selected" : ""}>${this.esc(x.rot)}</option>`).join("");
      const r = this.cmpRes;
      let corpo = "";
      if (r) {
        const inv = this.cmpTipo === "DESPESAS";
        let l = r.itens.filter((x) => x.situacao !== "igual");
        if (this.visaoComp === "alteracoes") l = l.filter((x) => x.situacao === "alteracao");
        else if (this.visaoComp === "inclusoes") l = l.filter((x) => x.situacao === "inclusao");
        else if (this.visaoComp === "exclusoes") l = l.filter((x) => x.situacao === "exclusao");
        else if (this.visaoComp === "destaques") l = l.filter((x) => Math.abs(x.dif) >= C.SEMAFORO_IMATERIAL);
        if (this.visaoComp === "todas") l = r.itens;
        if (this.desvio !== "todos") l = l.filter((x) => (inv ? x.dif <= 0 : x.dif >= 0) === (this.desvio === "favoravel"));
        const tb = r.itens.reduce((s2, x) => s2 + x.tb, 0), tc = r.itens.reduce((s2, x) => s2 + x.tc, 0);
        const cont = (s2) => r.itens.filter((x) => x.situacao === s2).length;
        corpo = `<div style="font-size:0.8rem;margin:8px 0">Versão base: <b>${C.fmtReais(tb, true)}</b> · versão comparada: <b>${C.fmtReais(tc, true)}</b> · variação <b>${C.fmtReais(tc - tb, true)}</b> · ${cont("alteracao")} alterações, ${cont("inclusao")} inclusões, ${cont("exclusao")} exclusões.</div>
          <div class="cc-scroll" style="max-height:60vh"><table class="cc-table"><colgroup><col><col><col style="width:100px"><col style="width:130px"><col style="width:130px"><col style="width:130px"></colgroup>
          <thead><tr><th>Produto</th><th>Plano</th><th>Situação</th><th class="is-right">Base</th><th class="is-right">Comparada</th><th class="is-right">Variação</th></tr></thead>
          <tbody>${l.map((x) => `<tr><td>${this.esc(x.cc)} ${this.esc(x.cc_nome)}</td><td>${this.esc(x.plano)} ${this.esc(x.plano_nome)}</td><td>${{ inclusao: "Inclusão", exclusao: "Exclusão", alteracao: "Alteração", igual: "Igual" }[x.situacao]}</td><td class="is-right">${C.fmtReais(x.tb, true)}</td><td class="is-right">${C.fmtReais(x.tc, true)}</td><td class="is-right" style="color:${(inv ? x.dif <= 0 : x.dif >= 0) ? "#105436" : "#b91c1c"}">${C.fmtReais(x.dif, true)}</td></tr>`).join("") || `<tr><td colspan="6" style="text-align:center;padding:16px">Nenhum desvio neste filtro.</td></tr>`}</tbody></table></div>`;
      }
      const b = (campo, v, t) => `<button type="button" class="btn ${this[campo] === v ? "btn-primary" : "btn-secondary"}" style="height:30px;font-size:0.72rem" onclick="OrionOxRApp.setCampo('${campo}', '${v}')">${t}</button>`;
      return `<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div><label class="ml-emp-filter-label">Tipo</label><select class="idx-select" style="height:40px" onchange="OrionOxRApp.setCampo('cmpTipo', this.value)">${["DESPESAS", "RECEITAS", "VENDAS"].map((t) => `<option ${t === this.cmpTipo ? "selected" : ""}>${t}</option>`).join("")}</select></div>
          <div><label class="ml-emp-filter-label">Versão base</label><select class="idx-select" style="height:40px;max-width:420px" onchange="OrionOxRApp.setCampo('cmpA', this.value)">${op(this.cmpA)}</select></div>
          <div><label class="ml-emp-filter-label">Versão comparada</label><select class="idx-select" style="height:40px;max-width:420px" onchange="OrionOxRApp.setCampo('cmpB', this.value)">${op(this.cmpB)}</select></div>
          <button type="button" class="btn btn-primary" style="height:40px" onclick="OrionOxRApp.comparar()">Comparar</button></div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${b("visaoComp", "destaques", "Destaques")}${b("visaoComp", "alteracoes", "Alterações")}${b("visaoComp", "inclusoes", "Inclusões")}${b("visaoComp", "exclusoes", "Exclusões")}${b("visaoComp", "todas", "Todas")}
          <span style="width:16px"></span>${b("desvio", "todos", "Todos")}${b("desvio", "favoravel", "Favorável")}${b("desvio", "desfavoravel", "Desfavorável")}</div>
        ${this.cmpTipo === "VENDAS" ? `<div style="font-size:0.75rem;color:#64748b;margin-top:6px">Vendas: compare pelas linhas de VGV em Orçamentos e forecasts › Diferença para a versão anterior.</div>` : ""}
        ${corpo}`;
    },

    htmlVisualizacao() {
      const C = this.C();
      const D = this.linhasTipo("DESPESAS"), Rc = this.linhasTipo("RECEITAS");
      const mensal = Rc.mensal.map((m, i) => ({ mes: m.mes, res_orcado: m.rec_orcado - D.mensal[i].desp_orcado, res_realizado: m.rec_realizado - D.mensal[i].desp_realizado }));
      const ref = this.base === "forecast" ? "Forecast" : "Orçado";
      const porProd = new Map();
      D.linhas.forEach((l) => { if (!porProd.has(l.produto)) porProd.set(l.produto, { nome: l.produto_nome, ref: 0, real: 0 }); const p = porProd.get(l.produto); p.ref += l.ref; p.real += l.real; });
      const top = [...porProd.entries()].sort((a, b) => b[1].ref - a[1].ref).slice(0, 15);
      const max = Math.max(1, ...top.map(([, p]) => Math.max(p.ref, p.real)));
      return `<div class="or-sec">Resultado mês a mês (receitas − despesas)</div>${this.grafico(mensal, ref)}
        <div class="or-sec">Despesas por empreendimento (15 maiores)</div>
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px">${top.map(([cc, p]) => `<div style="display:flex;align-items:center;gap:8px;font-size:0.72rem;margin:3px 0"><div style="width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(cc)} ${this.esc(p.nome)}</div>
          <div style="flex:1"><div title="${ref}: ${C.fmtReais(p.ref, true)}" style="height:7px;width:${Math.round(p.ref / max * 100)}%;background:#94a3b8;border-radius:3px"></div><div title="Realizado: ${C.fmtReais(p.real, true)}" style="height:7px;margin-top:2px;width:${Math.round(p.real / max * 100)}%;background:${p.real > p.ref ? "#ef4444" : "#1b8253"};border-radius:3px"></div></div>
          <div style="width:200px;text-align:right">${C.fmtReais(p.real, true)} / ${C.fmtReais(p.ref, true)}</div></div>`).join("") || "Sem despesas."}</div>`;
    },

    render() {
      const root = this.root();
      if (!root) return;
      if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
      this.estilos();
      const C = this.C();
      const l = this.cabs[this.base] || [];
      const anos = [...new Set(l.map((c) => c.ano))].sort((a, b) => b - a);
      if (!anos.length) anos.push(Number(this.ano));
      const depts = new Map();
      l.filter((c) => String(c.ano) === String(this.ano) && c.departamento).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
      const abas = [["consolidado", "Consolidado"], ["despesas", "Despesas"], ["receitas", "Receitas"], ["vendas", "Vendas"], ["comparativo", "Comparativo de versões"], ["visualizacao", "Visualização"]];
      let corpo = "";
      if (this.aba === "comparativo") corpo = this.htmlComparativo();
      else if (this.resultado) corpo = { consolidado: () => this.htmlConsolidado(), despesas: () => this.htmlTipo("DESPESAS"), receitas: () => this.htmlTipo("RECEITAS"), vendas: () => this.htmlVendas(), visualizacao: () => this.htmlVisualizacao() }[this.aba]();
      else if (!this.carregando) corpo = `<div style="font-size:0.8rem;color:#64748b">Escolha os filtros e clique em Calcular. O realizado é lido do Sienge na hora e pode levar alguns minutos.</div>`;
      root.innerHTML = `${window.OrionFiltros.html(this, "OrionOxRApp", { anos, depts: [...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), versoes: C.versoesForecast(l, this.ano), empresas: this.resultado ? this.resultado.empresas : [], comMeses: !!this.resultado })}
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;border-bottom:1px solid #e2e8f0;padding-bottom:6px">${abas.map(([k, t]) => `<button type="button" class="btn ${this.aba === k ? "btn-primary" : "btn-secondary"}" style="height:34px" onclick="OrionOxRApp.setAba('${k}')">${t}</button>`).join("")}</div>
        ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
        ${this.carregando ? `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>${this.esc(this.passo || "Calculando…")}</p></div>` : ""}
        ${corpo}`;
      if (this.resultado) window.OrionFiltros.bind(this, "OrionOxRApp", this.resultado.empresas);
    }
  });
  window.OrionOxRApp = App;
})();
