/* Órion (transição) › Orçamento de Despesas / Receitas / Vendas (e Forecast de Despesas / Receitas / Vendas) — as telas do
 * menu Orçamento e Forecast do ML Órion (orcamento/despesas, receitas, vendas e forecast/…), com a identidade do Integra.
 * Usa os mesmos documentos, a mesma grade de edição e a mesma gravação de orion-orcamentos.js / orion-orcamento-grade.js;
 * aqui ficam só a tela de cada tipo: título, Diretoria / Departamento / Ano (e Versão no forecast), Criar Orçamento, Excel,
 * Salvar, cabeçalho da versão (status, vN, data, ações), Filtro de meses, painel Filtros (busca, ID do centro de custo,
 * produto, plano ou forma de venda, ID da empresa, empresa), aviso de ano travado e a matriz por produto que abre os planos,
 * com ordenação das colunas, Total, Observação e TOTAIS GERAIS. Não grava nada além do que a grade já grava. */
(function () {
  const A = window.OrionOrcamentosApp;
  if (!A) return;
  const TIPOS = {
    DESPESAS: { o: ["Orçamento de Despesas", "Matriz de alocação de despesas por centro de custo."], f: ["Forecast de Despesas", "Acompanhamento e ajuste financeiro de despesas (Forecast)."] },
    RECEITAS: { o: ["Orçamento de Receitas", "Matriz de alocação de receitas por centro de custo."], f: ["Forecast de Receitas", "Receita de vendas entra ao salvar o Forecast de Vendas. As demais receitas podem ser lançadas aqui."] },
    VENDAS: { o: ["Orçamento de Vendas", "Matriz de previsão de VGV por produto e plano de pagamento."], f: ["Forecast de Vendas", "Matriz de previsão atualizada de VGV por produto e plano de pagamento."] }
  };
  const TRAVADOS = ["Em aprovação", "Em Aprovação", "Aprovado", "Fechado", "Solicitação Reabertura", "Substituído"];
  const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  Object.assign(A, {
    modoTipo: null, docSel: null, diretoria: "TODAS", expandidos: {}, ordem: { k: "produto", dir: "asc" }, mesesOcultos: {},
    fo: { busca: "", ids: [], prods: [], planos: [], empIds: [], emps: [], aberto: false, open: null, q: {} },

    /** Entrada pelo menu: tipo = DESPESAS, RECEITAS, VENDAS ou null (lista de documentos). */
    irModo(tipo, base) {
      this.modoTipo = tipo || null;
      if (base && base !== this.tipo) { this.tipo = base; this.aberto = null; this.edicao = null; this.novo = null; }
      this.docSel = null; this.expandidos = {}; this.aberto = null; this.edicao = null; this.aviso = "";
      const T = tipo ? (TIPOS[tipo][this.tipo === "forecasts" ? "f" : "o"][0] + " (Órion)") : "Orçamentos e forecasts (Órion)";
      const vis = document.getElementById("tab-orion-orcamentos") && document.getElementById("tab-orion-orcamentos").style.display !== "none";
      if (!vis && typeof window.switchTab === "function") window.switchTab("orion-orcamentos", T);
      else this.init();
    },
    estilosOrion() {
      if (document.getElementById("ooo-estilos")) return;
      const st = document.createElement("style");
      st.id = "ooo-estilos";
      st.textContent = `
        #orion-orcamentos-root .ooo-pills { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
        #orion-orcamentos-root .ooo-pill { border:none; background:var(--color-bg-light); padding:8px 16px; border-radius:20px; font-family:var(--font-family); font-size:0.8rem; font-weight:700; color:var(--color-text-muted); cursor:pointer; }
        #orion-orcamentos-root .ooo-pill:hover { background:rgba(16,84,54,.05); color:var(--color-primary); } #orion-orcamentos-root .ooo-pill.on { background:var(--color-primary); color:#fff; }
        #orion-orcamentos-root .ooo-cab { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
        #orion-orcamentos-root .ooo-tit { font-size:1.4rem; font-weight:800; color:var(--color-primary); margin:0; } #orion-orcamentos-root .ooo-sub { font-size:0.8rem; color:#6b8474; margin:2px 0 0; }
        #orion-orcamentos-root .ooo-card { background:#fff; border:1px solid rgba(16,84,54,.08); border-radius:var(--border-radius-md); box-shadow:var(--shadow-sm); padding:14px 18px; margin-bottom:12px; }
        #orion-orcamentos-root .ooo-st { display:inline-block; padding:2px 10px; border-radius:999px; font-size:0.72rem; font-weight:700; border:1px solid; }
        #orion-orcamentos-root .ooo-mes { border:1px solid #cfe0d6; background:#fff; color:#4a6355; height:30px; padding:0 12px; border-radius:999px; font-size:0.76rem; font-weight:700; cursor:pointer; font-family:var(--font-family); }
        #orion-orcamentos-root .ooo-mes.on { border-color:var(--color-primary); color:var(--color-primary); background:#e7f6ee; }
        #orion-orcamentos-root .ooo-mat thead th { cursor:pointer; user-select:none; }
        #orion-orcamentos-root .ooo-mat tr.ooo-prod td { background:#f7faf8; font-weight:700; color:#1c2e24; cursor:pointer; }
        #orion-orcamentos-root .ooo-mat tr.ooo-prod:hover td { background:#e7f6ee; }
        #orion-orcamentos-root .ooo-mat tfoot td { position:sticky; bottom:0; background:#105436; color:#fff; font-weight:800; }
        #orion-orcamentos-root .ooo-filtros { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; padding:12px 0 2px; }
        #orion-orcamentos-root .ooo-filtros > div { min-width:0; }
        #orion-orcamentos-root .ooo-filtros .ml-emp-filter { width:100%; min-width:0 !important; }
        #orion-orcamentos-root .ooo-filtros .ml-emp-filter-btn { max-width:100%; min-width:0 !important; width:100%; box-sizing:border-box; }
        @media (max-width:1280px) { #orion-orcamentos-root .ooo-filtros { grid-template-columns:repeat(3,minmax(0,1fr)); } }
      `;
      document.head.appendChild(st);
    },
    /** O ano escolhido precisa existir nos documentos do tipo (senão o seletor mostra um ano e a tela busca outro). */
    ajustarAno() {
      const anos = [...new Set((this.cab[this.tipo] || []).filter((c) => String(c.tipo || "").toUpperCase() === this.modoTipo).map((c) => Number(c.ano)).filter(Boolean))].sort((a, b) => a - b);
      if (!anos.length || anos.indexOf(Number(this.ano)) >= 0) return;
      const atual = new Date().getFullYear();
      this.ano = String(anos.indexOf(atual) >= 0 ? atual : anos[anos.length - 1]);
      this.docSel = null; this.aberto = null; this.edicao = null;
    },
    tituloModo() { const t = TIPOS[this.modoTipo]; return t ? t[this.tipo === "forecasts" ? "f" : "o"] : ["", ""]; },
    empresaDe(cc) {
      const l = (window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || [];
      const c = l.find((x) => String(x.id).replace(/\D/g, "") === String(cc).replace(/\D/g, ""));
      const id = c ? String(c.idCompany != null ? c.idCompany : c.companyId || "") : "";
      const emp = id ? ((window.AppState && AppState.companies) || []).find((x) => String(x.id) === id) : null;
      return { id, nome: emp ? String(emp.name || emp.nome || "") : "" };
    },
    /** Documentos do tipo da tela, no ano, departamento e diretoria escolhidos (sem os substituídos). */
    docsModo() {
      const dirs = ((this.cadDep || {}).departamentos || []);
      return this.filtrados().filter((c) => String(c.tipo || "").toUpperCase() === this.modoTipo).filter((c) => {
        if (this.diretoria === "TODAS") return true;
        const d = dirs.find((x) => c.departamento && String(x.id) === String(c.departamento.id));
        return d && String(d.diretoria || "") === this.diretoria;
      });
    },
    /** Documentos do seletor, com o nome que o Órion mostra: no orçamento, o vigente de cada departamento (e os que ainda podem
     * ser editados); no forecast, uma opção por versão (Forecast - N+M), a mais recente primeiro. */
    docsSeletor() {
      const C = this.C(), docs = this.docsModo(), fc = this.tipo === "forecasts";
      const dep = (c) => (c.departamento ? String(c.departamento.id) : "");
      let lista;
      if (fc) {
        const m = new Map();
        docs.forEach((c) => { const k = String(c.descricao || "") + "|" + dep(c), x = m.get(k); if (!x || (Number(c.versao) || 0) > (Number(x.versao) || 0)) m.set(k, c); });
        const rol = (c) => { const r = String(c.descricao || "").match(/(\d+)\s*\+/); return r ? Number(r[1]) : 0; };
        lista = [...m.values()].sort((a, b) => rol(b) - rol(a) || (Number(b.mes_corte) || 0) - (Number(a.mes_corte) || 0));
      } else {
        const vig = C.documentosVigentes(docs, { ano: this.ano, dept: "TODOS", base: "orcamento", tipos: [this.modoTipo] }).docs;
        lista = vig.concat(docs.filter((c) => vig.indexOf(c) < 0 && TRAVADOS.indexOf(c.status) < 0));
        // versões do Orçamento do Integra (V1, V2): todas escolhíveis, como na tela do Integra
        (this.cab[this.tipo] || []).filter((c) => c.integra && String(c.ano) === String(this.ano) && String(c.tipo || "").toUpperCase() === this.modoTipo && lista.indexOf(c) < 0 && (this.dept === "TODOS" || String(this.dept) === "integra"))
          .sort((a, b) => b.versao - a.versao).forEach((c) => lista.push(c));
      }
      const nDep = new Set(lista.map(dep)).size;
      const rot = (c) => C.rotuloVersao(c.descricao, fc ? "forecast" : "orcamento") + (nDep > 1 && c.departamento ? " · " + c.departamento.nome : "");
      const vezes = {};
      lista.forEach((c) => { vezes[rot(c)] = (vezes[rot(c)] || 0) + 1; });
      return lista.map((c) => ({ c, rot: rot(c) + (vezes[rot(c)] > 1 ? " · " + c.status : "") }));
    },
    setDiretoria(v) { this.diretoria = v; this.docSel = null; this.aberto = null; this.edicao = null; this.render(); },
    setDocSel(id) { if (this.edicao && !window.confirm("Trocar de documento sem salvar as alterações?")) return this.render(); this.docSel = id; this.aberto = null; this.edicao = null; this.render(); },
    garantirDoc() {
      const docs = this.docsSeletor().map((x) => x.c);
      if (!docs.length || this._abrindo) return;
      if (this.aberto && this.aberto.cab && docs.some((c) => c._id === this.aberto.cab._id)) this.docSel = this.aberto.cab._id;
      const alvo = docs.find((c) => c._id === this.docSel) || docs.find((c) => TRAVADOS.indexOf(c.status) < 0) || docs[0];
      this.docSel = alvo._id;
      if (this.aberto && this.aberto.cab && this.aberto.cab._id === alvo._id) return;
      this._abrindo = true;
      this.abrir(alvo._id).then(() => {
        this._abrindo = false;
        if (!(this.modoTipo && this.aberto && this.podeEditarCab(this.aberto.cab) && TRAVADOS.indexOf(this.aberto.cab.status) < 0)) { this.render(); return; }
        // como no Órion, a matriz já abre para editar quando o documento pode mudar
        if (this.modoTipo && this.aberto && this.podeEditarCab(this.aberto.cab) && TRAVADOS.indexOf(this.aberto.cab.status) < 0) this.editar();
      });
    },

    /* ---------- filtros (painel "Filtros" do Órion) ---------- */
    passaFiltro(l) {
      if (!this.modoTipo) return true;
      const f = this.fo, cc = String(l.cc || ""), plano = String(l.plano_venda != null ? l.plano_venda : l.plano || "");
      if (f.busca && norm(`${cc} ${l.cc_nome || ""}`).indexOf(norm(f.busca)) < 0) return false;
      if (f.ids.length && f.ids.indexOf(cc) < 0) return false;
      if (f.prods.length && f.prods.indexOf(String(l.cc_nome || "")) < 0) return false;
      if (f.planos.length && f.planos.indexOf(l.plano_venda != null ? plano || "(sem plano)" : `${plano} ${l.plano_nome || ""}`.trim()) < 0) return false;
      if (f.empIds.length || f.emps.length) { const e = this.empresaDe(cc); if (f.empIds.length && f.empIds.indexOf(e.id) < 0) return false; if (f.emps.length && f.emps.indexOf(e.nome) < 0) return false; }
      return true;
    },
    linhasDoDoc() {
      if (this.edicao) return this.edicao.modo === "vendas" ? this.edicao.grade || [] : this.edicao.linhas || [];
      if (!this.aberto) return [];
      return this.modoTipo === "VENDAS" ? this.C().vendasParaGrade(this.aberto.vendas || []) : this.aberto.itens || [];
    },
    opcoesFiltro() {
      const ls = this.linhasDoDoc(), u = (fn) => [...new Set(ls.map(fn).filter((x) => x !== "" && x != null))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true }));
      return { ids: u((l) => String(l.cc || "")), prods: u((l) => String(l.cc_nome || "")), planos: u((l) => (l.plano_venda != null ? l.plano_venda || "(sem plano)" : `${l.plano || ""} ${l.plano_nome || ""}`.trim())),
        empIds: u((l) => this.empresaDe(l.cc).id), emps: u((l) => this.empresaDe(l.cc).nome) };
    },
    htmlFiltros() {
      const f = this.fo, o = this.opcoesFiltro(), vendas = this.modoTipo === "VENDAS";
      const ativos = ["ids", "prods", "planos", "empIds", "emps"].reduce((s, k) => s + (f[k].length ? 1 : 0), f.busca ? 1 : 0);
      const multi = (k, rot) => window.MlEmpresaFilter ? `<div class="ofg-f">${MlEmpresaFilter.html({ id: "ooo-f-" + k, label: rot, items: o[k].map((x) => ({ id: x, label: x })), selectedIds: f[k], open: f.open === k, query: f.q[k] || "", emptyMeansAll: true })}</div>` : "";
      return `<div class="ooo-card" style="padding:10px 18px"><div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="OrionOrcamentosApp.fo.aberto=!OrionOrcamentosApp.fo.aberto;OrionOrcamentosApp.render()"><span style="font-weight:700;color:#105436;font-size:0.85rem">⏷ Filtros${ativos ? ` <span style="background:#105436;color:#fff;border-radius:999px;padding:0 8px;font-size:0.7rem">${ativos}</span>` : ""}</span><span style="color:#6b8474">${f.aberto ? "▴" : "▾"}</span></div>
        ${f.aberto ? window.OrionFiltros.grade([{ campos: [window.OrionFiltros.campo("Busca", `<input id="ooo-f-busca" class="idx-select" placeholder="Nome do centro de custo..." value="${this.esc(f.busca)}" oninput="OrionOrcamentosApp.setBuscaOrion(this.value)">`, "ofg-span2"),
          multi("ids", "ID Centro de Custo"), multi("prods", "Produto"), multi("planos", vendas ? "Forma de Venda" : "Plano Financeiro"), multi("empIds", "ID Empresa"), multi("emps", "Empresa")] }],
          ativos ? `<button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.limparFiltrosOrion()">Limpar filtros</button>` : "", { cls: "ofg-plano" }) : ""}</div>`;
    },
    setBuscaOrion(v) { this.fo.busca = v; this.render(); const i = document.getElementById("ooo-f-busca"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } },
    limparFiltrosOrion() { Object.assign(this.fo, { busca: "", ids: [], prods: [], planos: [], empIds: [], emps: [], q: {}, open: null }); this.render(); },
    ligarFiltros() {
      if (!this.fo.aberto || !window.MlEmpresaFilter) return;
      const o = this.opcoesFiltro(), f = this.fo;
      ["ids", "prods", "planos", "empIds", "emps"].forEach((k) => {
        if (!document.getElementById("ooo-f-" + k)) return;
        MlEmpresaFilter.bind("ooo-f-" + k, {
          toggleOpen: () => { f.open = f.open === k ? null : k; this.render(); },
          close: () => { if (f.open === k) { f.open = null; setTimeout(() => this.render(), 0); } },
          setQuery: (q) => { f.q[k] = q; this.render(); },
          toggleId: (x, on) => { const s = new Set(f[k]); if (on) s.add(x); else s.delete(x); f[k] = [...s]; this.render(); },
          selectAll: () => { f[k] = o[k].slice(); this.render(); },
          selectNone: () => { f[k] = []; this.render(); }
        });
      });
    },

    /* ---------- filtro de meses (vale para a matriz e para a grade de edição) ---------- */
    alternarMesOrion(i) {
      if (i === "todos") this.mesesOcultos = {};
      else { this.mesesOcultos[i] = !this.mesesOcultos[i]; if (Object.keys(this.mesesOcultos).filter((k) => this.mesesOcultos[k]).length >= 12) this.mesesOcultos[i] = false; }
      if (this.edicao) this.edicao.ocultos = Object.assign({}, this.mesesOcultos);
      this.render();
    },
    htmlMeses() {
      const C = this.C(), oc = this.mesesOcultos, todos = !Object.keys(oc).some((k) => oc[k]);
      return `<div class="ooo-card" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 18px"><span style="font-size:0.8rem;font-weight:700;color:#4a6355">📅 Filtro de Meses</span>
        <button type="button" class="ooo-mes ${todos ? "on" : ""}" onclick="OrionOrcamentosApp.alternarMesOrion('todos')">Todos</button><span style="width:1px;height:22px;background:#dfe9e3"></span>
        ${C.MESES.map((m, i) => `<button type="button" class="ooo-mes ${oc[i] ? "" : "on"}" onclick="OrionOrcamentosApp.alternarMesOrion(${i})">${oc[i] ? "" : "✓ "}${m.charAt(0).toUpperCase() + m.slice(1)}</button>`).join("")}</div>`;
    },

    /* ---------- cabeçalho da versão (Órion: VersionHeader) ---------- */
    htmlVersao() {
      const a = this.aberto, cab = a.cab, C = this.C();
      const cores = { "Rascunho": "#f1f5f9;color:#334155;border-color:#e2e8f0", "Em aprovação": "#fef3c7;color:#a16207;border-color:#fde68a", "Aprovado": "#e7f6ee;color:#105436;border-color:#bbf7d0", "Fechado": "#f1f5f9;color:#334155;border-color:#e2e8f0", "Reaberto": "#ffedd5;color:#c2410c;border-color:#fed7aa", "Solicitação Reabertura": "#ffedd5;color:#c2410c;border-color:#fed7aa" };
      const t = this.tituloModo()[0].replace("Orçamento de ", "").replace("Forecast de ", "");
      const quando = cab.criado_em || cab.importado_em || cab.atualizado_em;
      return `<div class="ooo-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #cfe0d6">
        <div style="display:flex;align-items:center;gap:14px"><div style="width:40px;height:40px;border-radius:999px;background:#e7f6ee;color:#105436;display:flex;align-items:center;justify-content:center;font-weight:800">⟜</div>
          <div><div style="font-size:1.1rem;font-weight:800;color:#1c2e24">${this.tipo === "forecasts" ? "Forecast" : "Orçamento"} de ${t} ${this.esc(cab.ano)} <span class="ooo-st" style="background:${cores[cab.status] || cores.Rascunho}">${this.esc(cab.status)}</span></div>
            <div style="font-size:0.75rem;color:#6b8474;display:flex;gap:14px;flex-wrap:wrap;margin-top:2px"><span>🗎 v${this.esc(cab.versao || 1)}</span><span>🕒 ${quando ? new Date(quando).toLocaleDateString("pt-BR") : "N/A"}</span><span>${this.esc(C.rotuloVersao(cab.descricao, this.tipo === "forecasts" ? "forecast" : "orcamento"))}${cab.departamento ? " · " + this.esc(cab.departamento.nome) : ""}${cab.mes_corte ? " · corte em " + C.MESES[cab.mes_corte - 1] : ""}</span>${cab.versao_base ? `<span style="background:#eef4f0;border-radius:4px;padding:0 6px">Baseada na v${Math.max(1, (Number(cab.versao) || 1) - 1)}</span>` : ""}</div></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${this.htmlAcoes()}</div></div>
        ${cab.motivo_reabertura ? `<div style="font-size:0.75rem;color:#92400e;margin:-6px 0 10px">Motivo da reabertura: ${this.esc(cab.motivo_reabertura)}</div>` : ""}`;
    },

    /* ---------- matriz só leitura (documento travado), no formato do Órion ---------- */
    ordenarGrupos(grupos, valorMes, valorTot) {
      const o = this.ordem;
      const k = o.k, d = o.dir === "asc" ? 1 : -1;
      return grupos.sort((a, b) => (k === "produto" ? String(a.rotulo).localeCompare(String(b.rotulo), "pt-BR", { numeric: true }) * d : k === "total" ? (valorTot(a) - valorTot(b)) * d : (valorMes(a, Number(k)) - valorMes(b, Number(k))) * d));
    },
    setOrdem(k) { const o = this.ordem; if (o.k === k) o.dir = o.dir === "asc" ? "desc" : "asc"; else { o.k = k; o.dir = k === "produto" ? "asc" : "desc"; } this.render(); },
    setas(k) { const o = this.ordem; return o.k === k ? (o.dir === "asc" ? " ↑" : " ↓") : ` <span style="opacity:.4">⇅</span>`; },
    alternarProd(cc) { this.expandidos[cc] = !this.expandidos[cc]; this.render(); },
    htmlMatrizLeitura() {
      const C = this.C(), f = (v) => C.fmtReais(v || 0, true), ms = C.MESES.map((m, i) => i).filter((i) => !this.mesesOcultos[i]);
      const linhas = (this.aberto.itens || []).filter((l) => this.passaFiltro(l));
      const g = new Map();
      linhas.forEach((l) => { const k = String(l.cc); if (!g.has(k)) g.set(k, { cc: k, rotulo: `${k} - ${l.cc_nome || ""}`, ls: [], m: new Array(12).fill(0), t: 0 }); const x = g.get(k); x.ls.push(l); l.m.forEach((v, i) => { x.m[i] += Number(v) || 0; }); x.t += Number(l.total) || 0; });
      const grupos = this.ordenarGrupos([...g.values()], (x, i) => x.m[i], (x) => x.t);
      const tot = new Array(12).fill(0); let tt = 0; linhas.forEach((l) => { l.m.forEach((v, i) => { tot[i] += Number(v) || 0; }); tt += Number(l.total) || 0; });
      let corpo = "";
      grupos.forEach((x) => {
        const ab = !!this.expandidos[x.cc];
        corpo += `<tr class="ooo-prod" onclick="OrionOrcamentosApp.alternarProd('${this.esc(x.cc)}')"><td>${ab ? "▾" : "▸"} ${this.esc(x.rotulo)}</td>${ms.map((i) => `<td class="is-right">${f(x.m[i])}</td>`).join("")}<td class="is-right">${f(x.t)}</td><td></td></tr>`;
        if (ab) x.ls.slice().sort((p, q) => String(p.plano).localeCompare(String(q.plano), "pt-BR", { numeric: true })).forEach((l) => {
          corpo += `<tr><td style="padding-left:26px"><div style="font-size:0.6rem;font-weight:700;color:#6b8474;text-transform:uppercase">Plano financeiro</div>${this.esc(l.plano)} - ${this.esc(l.plano_nome || "")}</td>${ms.map((i) => `<td class="is-right">${f(l.m[i])}</td>`).join("")}<td class="is-right"><b>${f(l.total)}</b></td><td style="color:#6b8474;white-space:normal">${this.esc(l.obs || "")}</td></tr>`;
        });
      });
      return `<div class="cc-scroll" style="max-height:70vh"><table class="cc-table ooo-mat or-larga" style="min-width:${360 + ms.length * 96}px"><colgroup><col style="width:360px">${ms.map(() => '<col style="width:96px">').join("")}<col style="width:120px"><col style="width:160px"></colgroup>
        <thead><tr><th onclick="OrionOrcamentosApp.setOrdem('produto')">Produto (C.C.) / Plano Financeiro${this.setas("produto")}</th>${ms.map((i) => `<th class="is-right" onclick="OrionOrcamentosApp.setOrdem('${i}')">${C.MESES[i].toUpperCase()}${this.setas(String(i))}</th>`).join("")}<th class="is-right" onclick="OrionOrcamentosApp.setOrdem('total')">TOTAL (R$)${this.setas("total")}</th><th>Observação</th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="${ms.length + 3}" style="text-align:center;padding:30px">${(this.aberto.itens || []).length ? "Nenhuma linha neste filtro." : "Nenhuma linha adicionada."}</td></tr>`}</tbody>
        <tfoot><tr><td style="text-align:right">TOTAIS GERAIS:</td>${ms.map((i) => `<td class="is-right">${f(tot[i])}</td>`).join("")}<td class="is-right">${f(tt)}</td><td></td></tr></tfoot></table></div>`;
    },
    htmlVendasLeitura() {
      const C = this.C(), f = (v) => C.fmtReais(v || 0, true), ms = C.MESES.map((m, i) => i).filter((i) => !this.mesesOcultos[i]);
      const aba = this.abaVendasLeitura || "vendas";
      const grade = C.vendasParaGrade(this.aberto.vendas || []).filter((l) => this.passaFiltro(l));
      const g = new Map();
      grade.forEach((l) => {
        if (aba !== "liquidas" && (aba === "distratos") !== !!l.distrato) return;
        const k = String(l.cc); if (!g.has(k)) g.set(k, { cc: k, rotulo: `${k} - ${l.cc_nome || ""}`, ls: [], q: new Array(12).fill(0), v: new Array(12).fill(0), t: 0 });
        const x = g.get(k), sg = aba === "liquidas" && l.distrato ? -1 : 1; x.ls.push(l);
        l.meses.forEach((m, i) => { const n = Math.abs(Number(m.vendas) || 0), vg = n * (Number(m.ticket) || 0); x.q[i] += sg * n; x.v[i] += sg * vg; x.t += sg * vg; });
      });
      const grupos = this.ordenarGrupos([...g.values()], (x, i) => x.v[i], (x) => x.t);
      const totV = new Array(12).fill(0), totQ = new Array(12).fill(0); let tt = 0;
      grupos.forEach((x) => { x.v.forEach((v, i) => { totV[i] += v; totQ[i] += x.q[i]; }); tt += x.t; });
      const suf = aba === "distratos" ? " - Distratos" : aba === "liquidas" ? " - Vendas Líquidas" : " - Vendas";
      let corpo = "";
      grupos.forEach((x) => {
        const ab = !!this.expandidos[x.cc];
        corpo += `<tr class="ooo-prod" onclick="OrionOrcamentosApp.alternarProd('${this.esc(x.cc)}')"><td>${ab ? "▾" : "▸"} ${this.esc(x.rotulo)}${suf}</td>${ms.map((i) => `<td class="is-right"><div style="font-size:0.62rem;color:#6b8474;font-weight:600">QTD: ${x.q[i]}</div>${f(x.v[i])}</td>`).join("")}<td class="is-right">${f(x.t)}</td></tr>`;
        if (ab && aba !== "liquidas") x.ls.forEach((l) => {
          corpo += `<tr><td style="padding-left:26px" colspan="${ms.length + 2}"><span style="font-size:0.6rem;font-weight:700;color:#6b8474;text-transform:uppercase">Forma de venda</span> ${this.esc(l.plano_venda || "(sem plano)")}</td></tr>
            <tr><td style="padding-left:40px;color:#4a6355">↳ Ticket Médio (R$)</td>${ms.map((i) => `<td class="is-right">${f(l.meses[i].ticket)}</td>`).join("")}<td></td></tr>
            <tr><td style="padding-left:40px;color:#4a6355">↳ Nº de Vendas</td>${ms.map((i) => `<td class="is-right">${Math.abs(Number(l.meses[i].vendas) || 0) || ""}</td>`).join("")}<td class="is-right">${l.meses.reduce((s, m) => s + Math.abs(Number(m.vendas) || 0), 0)}</td></tr>
            <tr><td style="padding-left:40px;color:#105436;font-weight:700">↳ VGV (R$)</td>${ms.map((i) => `<td class="is-right" style="font-weight:700">${f(Math.abs(Number(l.meses[i].vendas) || 0) * (Number(l.meses[i].ticket) || 0))}</td>`).join("")}<td class="is-right"><b>${f(l.meses.reduce((s, m) => s + Math.abs(Number(m.vendas) || 0) * (Number(m.ticket) || 0), 0))}</b></td></tr>`;
        });
      });
      const tab = (k, t) => `<button type="button" class="ooo-pill ${aba === k ? "on" : ""}" onclick="OrionOrcamentosApp.abaVendasLeitura='${k}';OrionOrcamentosApp.render()">${t}</button>`;
      return `<div class="ooo-pills" style="margin-bottom:10px">${tab("vendas", "Orçamento de Vendas")}${tab("distratos", "Orçamento de Distratos")}${tab("liquidas", "Vendas Líquidas")}</div>
        <div class="cc-scroll" style="max-height:70vh"><table class="cc-table ooo-mat or-larga" style="min-width:${360 + ms.length * 104}px"><colgroup><col style="width:360px">${ms.map(() => '<col style="width:104px">').join("")}<col style="width:130px"></colgroup>
        <thead><tr><th onclick="OrionOrcamentosApp.setOrdem('produto')">${aba === "distratos" ? "Produto (C.C.)" : "Produto (C.C.) / Forma de Venda"}${this.setas("produto")}</th>${ms.map((i) => `<th class="is-right" onclick="OrionOrcamentosApp.setOrdem('${i}')">${C.MESES[i].toUpperCase()}${this.setas(String(i))}</th>`).join("")}<th class="is-right" onclick="OrionOrcamentosApp.setOrdem('total')">TOTAL VGV (R$)${this.setas("total")}</th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="${ms.length + 2}" style="text-align:center;padding:30px">Nenhuma previsão${aba === "distratos" ? " de distrato" : ""} neste filtro.</td></tr>`}</tbody>
        <tfoot><tr><td style="text-align:right">TOTAIS GERAIS:</td>${ms.map((i) => `<td class="is-right"><div style="font-size:0.62rem;opacity:.8">QTD: ${totQ[i]}</div>${f(totV[i])}</td>`).join("")}<td class="is-right">${f(tt)}</td></tr></tfoot></table></div>`;
    },
    excelOrion() {
      if (this.edicao) return this.excelAlternar();
      if (!this.aberto || !this.excelBaixar) return;
      const C = this.C();
      if (this.modoTipo === "VENDAS") this.excelBaixar(C.planilhaVendas(C.vendasParaGrade(this.aberto.vendas || [])), this.excelNome("orcamento"));
      else this.excelBaixar(C.planilhaMensal(this.aberto.itens || []), this.excelNome("orcamento"));
    },

    /* ---------- tela do tipo ---------- */
    htmlModo() {
      const [tit, sub] = this.tituloModo();
      const lista = this.cab[this.tipo] || [];
      const anos = [...new Set(lista.filter((c) => String(c.tipo || "").toUpperCase() === this.modoTipo).map((c) => c.ano))].sort((a, b) => a - b);
      if (!anos.length) anos.push(Number(this.ano) || new Date().getFullYear());
      const dirs = [...new Set(((this.cadDep || {}).departamentos || []).map((d) => d.diretoria).filter(Boolean))].sort();
      const depts = new Map();
      lista.filter((c) => String(c.ano) === String(this.ano) && String(c.tipo || "").toUpperCase() === this.modoTipo && c.departamento).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
      const docs = this.docsModo(), sel = this.docsSeletor();
      const ed = !!this.edicao;
      const pode = this.podeCriar && this.podeCriar();
      const barra = `<div class="ooo-cab"><div><h2 class="ooo-tit">${tit}</h2><p class="ooo-sub">${sub}</p></div>
        </div>${window.OrionFiltros.grade([{ campos: [
          window.OrionFiltros.campo("Diretoria", `<select class="idx-select" onchange="OrionOrcamentosApp.setDiretoria(this.value)" ${dirs.length ? "" : "disabled"}><option value="TODAS">Todas</option>${dirs.map((d) => `<option ${d === this.diretoria ? "selected" : ""}>${this.esc(d)}</option>`).join("")}</select>`),
          window.OrionFiltros.campo("Departamento", `<select class="idx-select" onchange="OrionOrcamentosApp.docSel=null;OrionOrcamentosApp.edicao=null;OrionOrcamentosApp.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select>`),
          window.OrionFiltros.campo("Ano", `<select class="idx-select" onchange="OrionOrcamentosApp.docSel=null;OrionOrcamentosApp.edicao=null;OrionOrcamentosApp.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select>`),
          window.OrionFiltros.campo(this.tipo === "forecasts" ? "Versão" : "Documento", sel.length ? `<select class="idx-select" onchange="OrionOrcamentosApp.setDocSel(this.value)" ${sel.length > 1 ? "" : "disabled"}>${sel.map((x) => `<option value="${this.esc(x.c._id)}" ${x.c._id === this.docSel ? "selected" : ""}>${this.esc(x.rot)}</option>`).join("")}</select>` : `<div class="ofg-fake">nenhum no ano</div>`)] }],
          `${pode ? `<button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.abrirNovo()">＋ Criar ${this.tipo === "forecasts" ? "Forecast" : "Orçamento"}</button>` : ""}
          ${this.aberto ? `<button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.excelOrion()">Excel</button>` : ""}
          ${ed ? `<button type="button" class="btn btn-primary" ${this.edicao.salvando ? "disabled" : ""} onclick="OrionOrcamentosApp.salvarEdicao()">💾 ${this.edicao.salvando ? "Salvando..." : "Salvar " + (this.tipo === "forecasts" ? "Forecast" : "Orçamento")}</button>` : ""}`)}`;
      let corpo;
      if (!this.cab[this.tipo]) corpo = `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>`;
      else if (!docs.length) corpo = `<div class="ooo-card" style="text-align:center;padding:40px"><div style="font-size:1.1rem;font-weight:800;color:#105436">Nenhum ${this.tipo === "forecasts" ? "forecast" : "orçamento"} encontrado</div><p style="color:#6b8474;max-width:560px;margin:8px auto">Não existem ${this.tipo === "forecasts" ? "forecasts" : "orçamentos"} de ${tit.split(" de ")[1].toLowerCase()} para este departamento em ${this.esc(this.ano)}. Importações SharePoint ficam em <b>Corporativo</b>: selecione esse departamento no filtro.</p>${pode ? `<button type="button" class="btn btn-primary" style="height:40px" onclick="OrionOrcamentosApp.abrirNovo()">＋ Criar Primeiro ${this.tipo === "forecasts" ? "Forecast" : "Orçamento"}</button>` : ""}</div>`;
      else if (!this.aberto || this._abrindo) corpo = `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Abrindo o documento…</p></div>`;
      else {
        const cab = this.aberto.cab;
        const travado = TRAVADOS.indexOf(cab.status) >= 0;
        const grade = ed ? this.htmlEdicao() : this.modoTipo === "VENDAS" ? this.htmlVendasLeitura() : this.htmlMatrizLeitura();
        corpo = this.htmlVersao() + this.htmlMeses() + this.htmlFiltros()
          + (travado ? `<div style="padding:8px 14px;border:1px solid #fed7aa;background:#fff7ed;color:#c2410c;border-radius:8px;margin-bottom:12px;font-size:0.8rem"><b>${this.tipo === "forecasts" ? "Versão Travada:" : `Ano de ${this.esc(cab.ano)} Travado:`}</b> ${this.tipo === "forecasts" ? "Este forecast já está aprovado e é imutável pela interface." : "O orçamento base já está aprovado e é imutável pela interface."}</div>` : "")
          + (this.aberto.realizado && !ed ? this.htmlRealizado() : "") + grade;
      }
      return barra + corpo;
    }
  });

  /* tela: barra com as telas do Órion (lista de documentos e um tipo por vez) em volta do render de orion-orcamentos.js */
  const renderLista = A.render;
  A.render = function () {
    const root = this.root();
    if (!root) return;
    this.estilosOrion();
    const ehF = this.tipo === "forecasts";
    const pills = `<div class="ooo-pills">${[[null, "Documentos"], ["DESPESAS", (ehF ? "Forecast" : "Orçamento") + " de Despesas"], ["RECEITAS", (ehF ? "Forecast" : "Orçamento") + " de Receitas"], ["VENDAS", (ehF ? "Forecast" : "Orçamento") + " de Vendas"]].map(([k, t]) => `<button type="button" class="ooo-pill ${this.modoTipo === k ? "on" : ""}" onclick="OrionOrcamentosApp.irModo(${k ? `'${k}'` : "null"})">${t}</button>`).join("")}
      <span style="margin-left:auto;display:flex;gap:6px"><button type="button" class="ooo-pill ${ehF ? "" : "on"}" onclick="OrionOrcamentosApp.irModo(OrionOrcamentosApp.modoTipo, 'orcamentos')">Orçamento</button><button type="button" class="ooo-pill ${ehF ? "on" : ""}" onclick="OrionOrcamentosApp.irModo(OrionOrcamentosApp.modoTipo, 'forecasts')">Forecast</button></span></div>`;
    if (!this.modoTipo) {
      renderLista.call(this);
      root.insertAdjacentHTML("afterbegin", pills);
      return;
    }
    if (this.cab[this.tipo]) { this.ajustarAno(); this.garantirDoc(); }
    if (this.edicao) this.edicao.ocultos = Object.assign({}, this.mesesOcultos);
    root.innerHTML = pills
      + (this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : "")
      + (this.htmlNovo ? this.htmlNovo() : "")
      + (this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : "")
      + this.htmlModo();
    this.ligarFiltros();
    if (window.lucide) window.lucide.createIcons();
  };
  /* como no Órion, depois de salvar a matriz continua aberta para editar */
  const salvarAntigo = A.salvarEdicao;
  A.salvarEdicao = async function () {
    await salvarAntigo.apply(this, arguments);
    if (this.modoTipo && !this.edicao && this.aberto && this.podeEditarCab(this.aberto.cab) && TRAVADOS.indexOf(this.aberto.cab.status) < 0) { const av = this.aviso; this.editar(); this.aviso = av; this.render(); }
  };
  /* os botões de mês da grade de edição usam o mesmo filtro de meses da tela */
  const mesGrade = A.alternarMesGrade;
  A.alternarMesGrade = function (i) { if (this.modoTipo) return this.alternarMesOrion(i); return mesGrade.call(this, i); };
  /* depois de criar pelo "Criar Orçamento", a tela do tipo abre o documento novo */
  const fecharAntigo = A.fechar;
  A.fechar = function () { if (this.modoTipo) { this.edicao = null; this.aviso = ""; this.render(); return; } fecharAntigo.call(this); };
})();
