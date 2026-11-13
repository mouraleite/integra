/* Filtros comuns das telas de acompanhamento vindas do ML Órion (Resumo do orçamento, Analítico de gastos, DFC gerencial).
 * Como no Órion: orçamento ou forecast (com a versão do forecast), ano, até o mês, departamento,
 * empresas (seleção múltipla, padrão MlEmpresaFilter) e meses soltos. Empresas e meses filtram o que já foi lido, sem nova busca.
 * Estado guardado na própria tela: base, versao, ano, ate, dept, empresas ([] = todas), meses (null = todos até "ate"). */
const OrionFiltros = {
  MESES: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],

  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },

  /** Empresa de cada centro de custo (cadastro de Centros de Custo do Integra). */
  mapaCcEmpresa() {
    const out = {};
    ((window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || []).forEach((c) => {
      out[String(c.id).replace(/\D/g, "")] = String(c.idCompany != null ? c.idCompany : c.companyId || "");
    });
    return out;
  },
  nomeEmpresa(id) {
    const c = ((window.AppState && AppState.companies) || []).find((x) => String(x.id) === String(id));
    return c ? (c.name || c.tradeName || c.companyName || "") : "";
  },

  /** Meses que valem agora (1..12). */
  mesesAtivos(app, ate) {
    const lim = ate || 12;
    const base = app.meses && app.meses.length ? app.meses : Array.from({ length: lim }, (_, i) => i + 1);
    return base.filter((m) => m >= 1 && m <= lim).sort((a, b) => a - b);
  },

  /** Filtra linhas do orçado (por empresa do centro de custo) e alocações do realizado (pela empresa do movimento). */
  filtrarEmpresas(app, linhas, alocacoes) {
    const sel = app.empresas || [];
    if (!sel.length) return { linhas, alocacoes };
    const set = new Set(sel.map(String));
    const mapa = this.mapaCcEmpresa();
    return {
      linhas: (linhas || []).filter((l) => set.has(mapa[String(l.cc)] || "")),
      alocacoes: (alocacoes || []).filter((a) => set.has(String(a.empresa)))
    };
  },

  /* ---------- Caixa de filtros padrão das telas do Órion (mesmo desenho da Análise de orçamento) ----------
   * Grade de 6 colunas (4 em telas médias, 2 em telas estreitas), campos com a mesma largura e 40px de altura,
   * separados em seções com título ("O que analisar", "Período e comparação"…) e o botão principal no fim, à direita.
   * Uso: OrionFiltros.grade([{ titulo, campos: [OrionFiltros.campo("Ano", "<select …>"), …] }], acaoHtml) */
  estilosGrade() {
    if (typeof document === "undefined" || document.getElementById("ofg-estilos")) return;
    const st = document.createElement("style");
    st.id = "ofg-estilos";
    st.textContent = `
      .ofg { display:grid; grid-template-columns:repeat(6, minmax(0, 1fr)); gap:12px 14px; align-items:end; margin-bottom:12px; padding:14px 16px; border:1px solid #e2e8f0; border-radius:10px; background:#fff; box-sizing:border-box; }
      .ofg.ofg-plano { border:none; padding:0; background:transparent; margin:10px 0 0; }
      .ofg.ofg-c4 { grid-template-columns:repeat(4, minmax(0, 1fr)); }
      .ofg .ofg-sec { grid-column:1 / -1; font-size:0.66rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:#105436; padding-bottom:4px; border-bottom:1px solid #eef2f7; }
      .ofg .ofg-sec:not(:first-child) { margin-top:4px; }
      .ofg .ofg-f { min-width:0; position:relative; }
      .ofg .ofg-f > label, .ofg .ofg-f > .ml-emp-filter-label { display:block; margin:0 0 6px; }
      .ofg .ofg-f select.idx-select, .ofg .ofg-f input.idx-select, .ofg .ofg-f > input, .ofg .ofg-f > select, .ofg .ofg-fake { width:100% !important; min-width:0 !important; max-width:none !important; height:40px !important; box-sizing:border-box; }
      .ofg .ofg-fake { display:flex; align-items:center; padding:0 10px; border:1px solid #cbd5e1; border-radius:8px; background:#f8fafc; color:#94a3b8; font-size:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ofg .ml-emp-filter { width:100%; max-width:none; min-width:0; flex:none; }
      .ofg .ml-emp-filter-btn { height:40px; min-height:40px; box-sizing:border-box; border-color:#cbd5e1; border-radius:8px; font-weight:600; }
      .ofg .ofg-check { display:flex; align-items:center; gap:8px; height:40px; padding:0 10px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#334155; font-size:0.85rem; font-weight:600; cursor:pointer; box-sizing:border-box; margin:0 !important; }
      .ofg .ml-emp-filter-panel { width:max-content; min-width:max(100%, 320px); max-width:min(640px, 90vw); }
      .ofg .ml-emp-filter-item span { white-space:nowrap; }
      .ofg .ml-sel { width:100% !important; }
      .ofg .ml-sel input { height:40px; box-sizing:border-box; }
      .ofg .ofg-seg { display:flex; width:100%; }
      .ofg .ofg-seg .btn { flex:1 1 0; min-width:0; height:40px; margin:0; padding:0 8px; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .ofg .ofg-seg .btn:not(:first-child) { border-top-left-radius:0; border-bottom-left-radius:0; }
      .ofg .ofg-seg .btn:not(:last-child) { border-top-right-radius:0; border-bottom-right-radius:0; }
      .ofg .ofg-acao { grid-column:span 2 / -1; display:flex; justify-content:flex-end; align-items:flex-end; gap:8px; flex-wrap:nowrap; min-width:0; }
      .ofg .ofg-acao.ofg-acao3 { grid-column:span 3 / -1; }
      .ofg .ofg-acao.ofg-acao-linha { grid-column:1 / -1; }
      .ofg .ofg-acao .btn { height:40px; margin:0; padding:0 18px; min-width:140px; display:inline-flex; align-items:center; justify-content:center; gap:6px; box-sizing:border-box; white-space:nowrap; }
      .ofg .ofg-acao .btn svg { width:16px; height:16px; flex-shrink:0; }
      .ofg .ofg-span2 { grid-column:span 2; }
      .ofg .ofg-span3 { grid-column:span 3; }
      .ofg .ofg-full { grid-column:1 / -1; }
      .ofg .ofg-chips { display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
      .ofg .ofg-chips .btn { height:30px; padding:0 12px; font-size:0.74rem; margin:0; }
      .ofg .ofg-nota { font-size:0.72rem; color:#64748b; }
      @media (max-width: 1280px) { .ofg { grid-template-columns:repeat(4, minmax(0, 1fr)); } .ofg .ofg-span3 { grid-column:span 2; } .ofg .ofg-acao.ofg-acao3 { grid-column:1 / -1; } }
      @media (max-width: 860px) { .ofg, .ofg.ofg-c4 { grid-template-columns:repeat(2, minmax(0, 1fr)); } .ofg .ofg-span2, .ofg .ofg-span3, .ofg .ofg-acao, .ofg .ofg-acao.ofg-acao3 { grid-column:1 / -1; } .ofg .ofg-acao { flex-wrap:wrap; } }
    `;
    document.head.appendChild(st);
  },
  /** Um campo da grade: rótulo em cima, controle embaixo. cls: "ofg-span2" | "ofg-span3" | "ofg-full" (opcional). */
  campo(rotulo, inner, cls, attrs) {
    return `<div class="ofg-f${cls ? " " + cls : ""}" ${attrs || ""}>${rotulo != null ? `<label class="ml-emp-filter-label">${rotulo}</label>` : ""}${inner}</div>`;
  },
  /** Campo ainda sem opções (aparece depois de calcular), para a grade não mudar de lugar. */
  campoVazio(rotulo, texto, cls) { return this.campo(rotulo, `<div class="ofg-fake">${this.esc(texto || "Todos · calcule para filtrar")}</div>`, cls); },
  /** Botões lado a lado ocupando o campo (Orçado | Forecast…). opcoes: [[valor, texto, onclick, title?]]. */
  seg(opcoes, atual) {
    return `<div class="ofg-seg">${opcoes.map(([v, t, js, title]) => `<button type="button" class="btn ${String(v) === String(atual) ? "btn-primary" : "btn-secondary"}" ${title ? `title="${this.esc(title)}"` : ""} onclick="${js}">${t}</button>`).join("")}</div>`;
  },
  /** secoes: [{ titulo, campos: [html] }]; acao: html dos botões (fica no fim, à direita). opts.colunas: 6 (padrão) ou 4; opts.id, opts.cls. */
  grade(secoes, acao, opts) {
    this.estilosGrade();
    const o = opts || {};
    const corpo = (secoes || []).filter(Boolean).map((sc) => `${sc.titulo ? `<div class="ofg-sec">${sc.titulo}</div>` : ""}${(sc.campos || []).filter(Boolean).join("")}`).join("");
    return `<div class="ofg${o.colunas === 4 ? " ofg-c4" : ""}${o.cls ? " " + o.cls : ""}" ${o.id ? `id="${o.id}"` : ""}>${corpo}${acao ? `<div class="ofg-acao${o.acaoCls ? " " + o.acaoCls : ""}">${acao}</div>` : ""}${o.rodape || ""}</div>`;
  },

  /** Barra de filtros. nome = nome global da tela (ex.: "OrionResumoApp"); opcoes = { versoes, depts, anos, empresas (lista de ids), extra (html) }. */
  html(app, nome, o) {
    const C = window.OrionOrcamentoCalc;
    const ate = app.ate || (window.OrionRealizado && window.OrionRealizado.ateMes(app.ano)) || 12;
    const ms = this.mesesAtivos(app, ate);
    const empresas = o.empresas || [];
    const empHtml = empresas.length && window.MlEmpresaFilter ? window.MlEmpresaFilter.html({
      id: nome + "-emp", label: "Empresas",
      items: empresas.map((id) => ({ id: String(id), label: `${id} - ${String(this.nomeEmpresa(id) || "").toUpperCase()}` })),
      selectedIds: app.empresas && app.empresas.length ? app.empresas : empresas.map(String),
      open: !!app.empAberto, query: app.empBusca || "", emptyMeansAll: true
    }) : "";
    const campos1 = [
      this.campo("Departamento", `<select class="idx-select" onchange="${nome}.setDept(this.value)"><option value="TODOS">Todos</option>${(o.depts || []).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(app.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select>`),
      empHtml ? `<div class="ofg-f" id="${nome}-emp-box">${empHtml}</div>` : this.campoVazio("Empresas", "Todas · calcule para filtrar")
    ].concat(o.campos || []);
    const campos2 = [
      this.campo("Base", this.seg([["orcamento", "Orçamento", `${nome}.setBase('orcamento')`], ["forecast", "Forecast", `${nome}.setBase('forecast')`]], app.base)),
      app.base === "forecast"
        ? this.campo("Versão do forecast", `<select class="idx-select" onchange="OrionFiltros.set(${nome}, 'versao', this.value)">${(o.versoes || []).map((v, i) => `<option value="${this.esc(v.descricao)}" ${(app.versao ? v.descricao === app.versao : i === 0) ? "selected" : ""}>${this.esc(C.rotuloVersao ? C.rotuloVersao(v.descricao, "forecast") : v.descricao)}</option>`).join("") || "<option>sem forecast</option>"}</select>`)
        : this.campoVazio("Versão do forecast", "— (só em Forecast)"),
      this.campo("Ano", `<select class="idx-select" onchange="${nome}.setAno(this.value)">${(o.anos || []).map((a) => `<option ${String(a) === String(app.ano) ? "selected" : ""}>${a}</option>`).join("")}</select>`),
      this.campo("Até o mês", `<select class="idx-select" onchange="${nome}.setAte(this.value)">${C.MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === ate ? "selected" : ""}>${m}</option>`).join("")}</select>`)
    ];
    const meses = o.comMeses ? { titulo: "Meses", campos: [`<div class="ofg-f ofg-full"><div class="ofg-chips">${Array.from({ length: ate }, (_, i) => i + 1).map((m) => `<button type="button" class="btn ${ms.indexOf(m) >= 0 ? "btn-primary" : "btn-secondary"}" onclick="OrionFiltros.alternarMes(${nome}, ${m}, ${ate})">${C.MESES[m - 1]}</button>`).join("")}
        <button type="button" class="btn btn-secondary" onclick="OrionFiltros.set(${nome}, 'meses', null)">Todos</button><span class="ofg-nota" style="margin-left:6px">filtra o que já foi calculado, sem nova busca</span></div></div>`] } : null;
    const acao = `<button type="button" class="btn btn-primary" ${app.carregando ? "disabled" : ""} onclick="${nome}.calcular()">${app.carregando ? "Calculando..." : "Calcular"}</button>`;
    // o botão Calcular fecha a seção "Período"; os meses (depois do cálculo) ficam embaixo
    return this.grade([{ titulo: "O que analisar", campos: campos1 }, { titulo: "Período e comparação", campos: campos2.concat([`<div class="ofg-acao">${acao}</div>`]) }, meses], "");
  },

  /** Liga o seletor de empresas depois do render. */
  bind(app, nome, empresas) {
    if (!window.MlEmpresaFilter || !document.getElementById(nome + "-emp")) return;
    const todos = (empresas || []).map(String);
    const atuais = () => (app.empresas && app.empresas.length ? app.empresas.slice() : todos.slice());
    const fixa = (l) => { app.empresas = l.length === todos.length ? [] : l; app.render(); };
    window.MlEmpresaFilter.bind(nome + "-emp", {
      toggleOpen: () => { app.empAberto = !app.empAberto; app.render(); },
      close: () => { app.empAberto = false; setTimeout(() => app.render(), 0); },
      setQuery: (q) => { app.empBusca = q; app.render(); },
      toggleId: (id, on) => { const l = atuais().filter((x) => x !== String(id)); if (on) l.push(String(id)); fixa(l.length ? l : todos.slice()); },
      selectAll: () => fixa(todos.slice()),
      selectNone: () => { app.empresas = ["__nenhuma__"]; app.render(); }
    });
  },

  set(app, campo, valor) {
    app[campo] = valor;
    if (campo === "versao") app.limpar();
    else app.render();
  },

  alternarMes(app, m, ate) {
    const atual = this.mesesAtivos(app, ate);
    const i = atual.indexOf(m);
    if (i >= 0) atual.splice(i, 1); else atual.push(m);
    app.meses = atual.length ? atual.sort((a, b) => a - b) : null;
    app.render();
  }
};

window.OrionFiltros = OrionFiltros;
