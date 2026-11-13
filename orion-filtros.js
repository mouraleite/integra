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
    return `<div class="of-barra" style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="display:flex;gap:6px">
          <button type="button" class="btn ${app.base === "orcamento" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="${nome}.setBase('orcamento')">Orçamento</button>
          <button type="button" class="btn ${app.base === "forecast" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="${nome}.setBase('forecast')">Forecast</button>
        </div>
        ${app.base === "forecast" ? `<div><label class="ml-emp-filter-label">Versão do forecast</label><select class="idx-select" style="height:40px;min-width:170px" onchange="OrionFiltros.set(${nome}, 'versao', this.value)">${(o.versoes || []).map((v, i) => `<option value="${this.esc(v.descricao)}" ${(app.versao ? v.descricao === app.versao : i === 0) ? "selected" : ""}>${this.esc(C.rotuloVersao ? C.rotuloVersao(v.descricao, "forecast") : v.descricao)}</option>`).join("") || "<option>sem forecast</option>"}</select></div>` : ""}
        <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px" onchange="${nome}.setAno(this.value)">${(o.anos || []).map((a) => `<option ${String(a) === String(app.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Até o mês</label><select class="idx-select" style="height:40px" onchange="${nome}.setAte(this.value)">${C.MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === ate ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:220px" onchange="${nome}.setDept(this.value)"><option value="TODOS">Todos</option>${(o.depts || []).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(app.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
        ${empHtml}
        ${o.extra || ""}
        <button type="button" class="btn btn-primary" style="height:40px;margin-left:auto" ${app.carregando ? "disabled" : ""} onclick="${nome}.calcular()">${app.carregando ? "Calculando..." : "Calcular"}</button>
      </div>
      ${o.comMeses ? `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:0.75rem"><span style="color:#64748b;margin-right:4px">Meses:</span>
        ${Array.from({ length: ate }, (_, i) => i + 1).map((m) => `<button type="button" class="btn ${ms.indexOf(m) >= 0 ? "btn-primary" : "btn-secondary"}" style="height:28px;padding:0 10px;font-size:0.72rem" onclick="OrionFiltros.alternarMes(${nome}, ${m}, ${ate})">${C.MESES[m - 1]}</button>`).join("")}
        <button type="button" class="btn btn-secondary" style="height:28px;padding:0 10px;font-size:0.72rem" onclick="OrionFiltros.set(${nome}, 'meses', null)">Todos</button></div>` : ""}`;
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
