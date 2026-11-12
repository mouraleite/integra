/* Configurações gerais › Premissas da viabilidade — vindas do ML Órion (Apoio).
 * Abas: Cenários, Curvas padrão, Regimes tributários, Planos de pagamento, Índices projetados e Taxas de funding.
 * Grava em orion_config/<cadastro> (coleção nova, ver orion-store.js). Nada do que já existia no Integra é alterado.
 * Editar exige a permissão sub_cfg_apoio_premissas_viabilidade_editar (administrador sempre pode). */
const OrionPremissasApp = {
  aba: "cenarios",
  estado: {},      // chave -> { itens, versao, atualizadoEm, atualizadoPor, alterado }
  carregando: false,
  salvando: false,
  erros: [],
  aviso: "",

  P() { return window.OrionPremissasCalc; },

  ABAS: [
    { id: "cenarios", rotulo: "Cenários" },
    { id: "curvas", rotulo: "Curvas padrão" },
    { id: "regimes", rotulo: "Regimes tributários" },
    { id: "planos_pagamento", rotulo: "Planos de pagamento" },
    { id: "indices_projetados", rotulo: "Índices projetados" },
    { id: "taxas_funding", rotulo: "Taxas de funding" }
  ],

  /* Valores iniciais de funding iguais aos que o Órion mostra antes de alguém salvar. */
  FUNDING_PADRAO: {
    CVM: { ICVM_400: 0.0005, ICVM_476: 0.0003, "Mínimo": 809.16 },
    ANBIMA: { Taxa_Registro: 0.000044, Min_400: 15700, Max_400: 109910, Min_476: 1568, Max_476: 3136 },
    B3: { Registro: [], Custodia: [] },
    Securitizadoras: {
      "Vórtx (Não Guarda-Chuva)": { Agente_Fiduciario_Implantacao: 16000, Agente_Fiduciario_Recorrente: 10000, Instituicao_Custodiante: 5000, Registro_Lastro: 5000, Liquidante: 500 },
      "Oliveira Trust (Guarda-Chuva)": { Agente_Fiduciario_Implantacao: 15000, Agente_Fiduciario_Recorrente: 4000, Instituicao_Custodiante: 5000, Registro_Lastro: 5000, Liquidante: 500 },
      "Vórtx (Guarda-Chuva)": { Agente_Fiduciario_Implantacao: 16000, Agente_Fiduciario_Recorrente: 10000, Instituicao_Custodiante: 0, Registro_Lastro: 0, Liquidante: 500 }
    },
    Prestador_GrossUp: { "Opea - Estruturação": 0.0965, "Opea - Administração": 0.1953, "Oliveira Trust": 0.1633, "Vórtx": 0.1633 }
  },

  esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  /** Texto seguro dentro de onclick="...('aqui')" */
  jsq(s) {
    return this.esc(String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'"));
  },

  podeEditar() {
    if (typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin()) return true;
    if (typeof window.hasCrmPerm !== "function") return false;
    return window.hasCrmPerm("sub_cfg_apoio_premissas_viabilidade_editar");
  },

  root() { return document.getElementById("orion-premissas-root"); },

  init() {
    this.estilos();
    this.render();
    if (!this.estado[this.aba]) this.carregar(this.aba);
  },

  estilos() {
    if (document.getElementById("op-estilos")) return;
    const st = document.createElement("style");
    st.id = "op-estilos";
    st.textContent = `
      .op-barra { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
      .op-abas { display:flex; gap:6px; flex-wrap:wrap; }
      .op-acoes { display:flex; gap:8px; flex-wrap:wrap; }
      .op-barra .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:40px; box-sizing:border-box; padding:0 16px; margin:0; line-height:1; white-space:nowrap; }
      .op-barra .btn svg { width:16px; height:16px; flex-shrink:0; }
      .op-aba { background:#fff; color:#1c2e24; border:1px solid #cfe0d6; border-radius:8px; font-weight:700; cursor:pointer; }
      .op-aba.is-ativa { background:#1b8253; color:#fff; border-color:#1b8253; }
      .op-table td { overflow:visible; }
      .op-table input, .op-table select { width:100%; box-sizing:border-box; height:28px; border:1px solid #d6e2db; border-radius:5px; padding:0 6px; font-size:0.72rem; background:#fff; }
      .op-table input.is-num { text-align:right; font-variant-numeric:tabular-nums; }
      .op-table input:disabled, .op-table select:disabled { background:#f7faf8; color:#1c2e24; border-color:transparent; }
      .op-table td.op-ok { color:#105436; font-weight:700; }
      .op-table td.op-ruim { color:#b91c1c; font-weight:700; }
      .op-del { border:none; background:none; color:#b91c1c; cursor:pointer; font-size:0.9rem; padding:0 4px; }
      .op-msg { padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:0.8rem; }
      .op-msg.is-erro { border:1px solid #fecaca; background:#fef2f2; color:#991b1b; }
      .op-msg.is-ok { border:1px solid #bbf7d0; background:#f0fdf4; color:#166534; }
      .op-msg ul { margin:4px 0 0 18px; padding:0; }
      .op-rodape { margin-top:8px; font-size:0.72rem; color:#64748b; }
      .op-sub { margin:16px 0 6px; font-size:0.8rem; font-weight:800; color:#105436; }
    `;
    document.head.appendChild(st);
  },

  /* ---------- dados ---------- */

  padraoDe(chave) {
    return chave === "taxas_funding" ? JSON.parse(JSON.stringify(this.FUNDING_PADRAO)) : [];
  },

  async carregar(chave, forcar) {
    if (this.estado[chave] && this.estado[chave].alterado && !forcar) return;
    this.carregando = true;
    this.erros = [];
    this.render();
    try {
      const r = await window.OrionStore.ler(chave, this.padraoDe(chave));
      this.estado[chave] = Object.assign(r, { alterado: false });
    } catch (e) {
      this.erros = [e.message || String(e)];
    }
    this.carregando = false;
    this.render();
  },

  itens() {
    const s = this.estado[this.aba];
    return s ? s.itens : null;
  },

  marcar() {
    const s = this.estado[this.aba];
    if (s) s.alterado = true;
    this.aviso = "";
  },

  setAba(id) {
    this.aba = id;
    this.erros = [];
    this.aviso = "";
    this.render();
    if (!this.estado[id]) this.carregar(id);
  },

  /** Alteração de um campo vindo da tela. caminho: "3.nome" ou, em funding, "CVM.ICVM_400". */
  set(caminho, valor) {
    const P = this.P();
    const itens = this.itens();
    if (!itens) return;
    const partes = String(caminho).split(".");
    if (this.aba === "taxas_funding") return this.setFunding(partes, valor);
    const i = Number(partes[0]);
    const campo = partes[1];
    const it = itens[i];
    if (!it) return;
    if (campo === "meses") it.meses = P.listaDeNumeros(valor);
    else if (campo === "condicoes") it.condicoes = P.listaDeCondicoes(valor);
    else if (campo === "ativo") it.ativo = !!valor;
    else if (["vgv_multiplier", "construction_cost_multiplier", "sales_speed_multiplier", "pis", "cofins", "irpj", "csll", "outros", "valor"].indexOf(campo) >= 0) it[campo] = P.num(valor);
    else it[campo] = String(valor);
    this.marcar();
    this.render();
  },

  setFunding(partes, valor) {
    const P = this.P();
    const f = this.itens();
    const [grupo, a, b] = partes;
    if (grupo === "B3") {
      const lista = f.B3[a] || (f.B3[a] = []);
      if (lista[Number(b)]) lista[Number(b)][partes[3]] = P.num(valor);
    } else if (grupo === "Securitizadoras") {
      if (f.Securitizadoras[a]) f.Securitizadoras[a][b] = P.num(valor);
    } else if (f[grupo]) {
      f[grupo][a] = P.num(valor);
    }
    this.marcar();
    this.render();
  },

  NOVO: {
    cenarios: () => ({ nome: "", vgv_multiplier: 1, construction_cost_multiplier: 1, sales_speed_multiplier: 1 }),
    curvas: () => ({ nome: "", tipo: "obras", classificacao: "Custo", meses: [100] }),
    regimes: () => ({ nome: "", pis: 0, cofins: 0, irpj: 0, csll: 0, outros: 0, ativo: true }),
    planos_pagamento: () => ({ nome: "", condicoes: [{ nome: "A VISTA", perc: 100 }] }),
    indices_projetados: () => ({ nome: "", index_type: "IPCA", valor: 0, tipo_unidade: "% a.a." })
  },

  adicionar() {
    const itens = this.itens();
    if (!itens || !this.NOVO[this.aba]) return;
    itens.push(this.NOVO[this.aba]());
    this.marcar();
    this.render();
  },

  remover(i) {
    const itens = this.itens();
    if (!itens) return;
    itens.splice(i, 1);
    this.marcar();
    this.render();
  },

  adicionarFunding(grupo, sub) {
    const f = this.itens();
    if (grupo === "B3") {
      (f.B3[sub] || (f.B3[sub] = [])).push({ max: 0, rate: 0 });
    } else {
      const nome = (window.prompt(grupo === "Securitizadoras" ? "Nome da nova securitizadora:" : "Nome do novo prestador:") || "").trim();
      if (!nome) return;
      if (f[grupo][nome]) { this.erros = [`"${nome}" já existe.`]; return this.render(); }
      f[grupo][nome] = grupo === "Securitizadoras"
        ? { Agente_Fiduciario_Implantacao: 0, Agente_Fiduciario_Recorrente: 0, Instituicao_Custodiante: 0, Registro_Lastro: 0, Liquidante: 0 }
        : 0;
    }
    this.marcar();
    this.render();
  },

  removerFunding(grupo, chave) {
    const f = this.itens();
    if (grupo === "B3") {
      const [sub, i] = String(chave).split(".");
      (f.B3[sub] || []).splice(Number(i), 1);
    } else {
      delete f[grupo][chave];
    }
    this.marcar();
    this.render();
  },

  validar() {
    const P = this.P();
    const itens = this.itens() || [];
    switch (this.aba) {
      case "cenarios": return P.validarCenarios(itens);
      case "curvas": return P.validarCurvas(itens);
      case "regimes": return P.validarRegimes(itens);
      case "planos_pagamento": return P.validarPlanos(itens);
      case "indices_projetados": return P.validarIndicesProjetados(itens);
      default: return [];
    }
  },

  async salvar() {
    if (!this.podeEditar()) return;
    const s = this.estado[this.aba];
    if (!s) return;
    this.erros = this.validar();
    this.aviso = "";
    if (this.erros.length) return this.render();
    this.salvando = true;
    this.render();
    try {
      s.versao = await window.OrionStore.gravar(this.aba, s.itens, s.versao);
      s.alterado = false;
      s.atualizadoEm = new Date();
      s.atualizadoPor = window.OrionStore.usuario();
      this.aviso = "Salvo.";
    } catch (e) {
      this.erros = [e.message || String(e)];
    }
    this.salvando = false;
    this.render();
  },

  descartar() {
    this.carregar(this.aba, true);
  },

  /* ---------- tela ---------- */

  inp(caminho, valor, opts) {
    const o = opts || {};
    const dis = this.podeEditar() ? "" : " disabled";
    const cls = o.num ? ' class="is-num"' : "";
    return `<input${cls} value="${this.esc(valor)}"${dis} onchange="OrionPremissasApp.set('${this.jsq(caminho)}', this.value)">`;
  },

  sel(caminho, valor, opcoes) {
    const dis = this.podeEditar() ? "" : " disabled";
    return `<select${dis} onchange="OrionPremissasApp.set('${this.jsq(caminho)}', this.value)">${opcoes.map((o) => `<option ${o === valor ? "selected" : ""}>${this.esc(o)}</option>`).join("")}</select>`;
  },

  del(i) {
    return this.podeEditar() ? `<button type="button" class="op-del" title="Remover" onclick="OrionPremissasApp.remover(${i})">✕</button>` : "";
  },

  tabela(cols, linhas, vazio) {
    const corpo = linhas.length ? linhas.join("") : `<tr><td colspan="${cols.length}" style="text-align:center;padding:30px;">${vazio}</td></tr>`;
    return `
      <div class="cc-scroll">
        <table class="cc-table op-table">
          <colgroup>${cols.map((c) => `<col${c.w ? ` style="width:${c.w}"` : ""}>`).join("")}</colgroup>
          <thead><tr>${cols.map((c) => `<th${c.r ? ' class="is-right"' : ""}>${c.t}</th>`).join("")}</tr></thead>
          <tbody>${corpo}</tbody>
        </table>
      </div>`;
  },

  htmlCenarios(itens) {
    const P = this.P();
    return this.tabela(
      [{ t: "Cenário" }, { t: "Multiplicador do VGV", r: 1, w: "170px" }, { t: "Multiplicador do custo de obra", r: 1, w: "210px" }, { t: "Multiplicador da velocidade de vendas", r: 1, w: "250px" }, { t: "", w: "34px" }],
      itens.map((c, i) => `<tr>
        <td>${this.inp(i + ".nome", c.nome)}</td>
        <td>${this.inp(i + ".vgv_multiplier", P.fmt(c.vgv_multiplier, 2), { num: 1 })}</td>
        <td>${this.inp(i + ".construction_cost_multiplier", P.fmt(c.construction_cost_multiplier, 2), { num: 1 })}</td>
        <td>${this.inp(i + ".sales_speed_multiplier", P.fmt(c.sales_speed_multiplier, 2), { num: 1 })}</td>
        <td class="is-center">${this.del(i)}</td></tr>`),
      "Nenhum cenário cadastrado.") + `<div class="op-rodape">1,00 = sem ajuste. Ex.: 0,90 no VGV reduz o preço de venda em 10% na viabilidade.</div>`;
  },

  htmlCurvas(itens) {
    const P = this.P();
    return this.tabela(
      [{ t: "Curva" }, { t: "Tipo", w: "120px" }, { t: "Classificação", w: "120px" }, { t: "Percentual por mês (separe com ;)" }, { t: "Meses", r: 1, w: "70px" }, { t: "Soma", r: 1, w: "90px" }, { t: "", w: "34px" }],
      itens.map((c, i) => {
        const s = P.soma(c.meses);
        const ok = Math.abs(s - 100) <= P.TOL;
        return `<tr>
          <td>${this.inp(i + ".nome", c.nome)}</td>
          <td>${this.sel(i + ".tipo", c.tipo, P.TIPOS_CURVA)}</td>
          <td>${this.sel(i + ".classificacao", c.classificacao, P.CLASSES_CURVA)}</td>
          <td>${this.inp(i + ".meses", P.textoDeNumeros(c.meses))}</td>
          <td class="is-right">${(c.meses || []).length}</td>
          <td class="is-right ${ok ? "op-ok" : "op-ruim"}">${P.fmt(s, 2)}%</td>
          <td class="is-center">${this.del(i)}</td></tr>`;
      }),
      "Nenhuma curva cadastrada.") + `<div class="op-rodape">A soma dos meses precisa ser exatamente 100%, como no Órion.</div>`;
  },

  htmlRegimes(itens) {
    const P = this.P();
    const dis = this.podeEditar() ? "" : " disabled";
    return this.tabela(
      [{ t: "Regime" }, ...P.ALIQUOTAS.map((k) => ({ t: k === "outros" ? "Outros" : k.toUpperCase(), r: 1, w: "90px" })), { t: "Total", r: 1, w: "90px" }, { t: "Ativo", w: "60px" }, { t: "", w: "34px" }],
      itens.map((r, i) => `<tr>
        <td>${this.inp(i + ".nome", r.nome)}</td>
        ${P.ALIQUOTAS.map((k) => `<td>${this.inp(i + "." + k, P.fmt(r[k], 2), { num: 1 })}</td>`).join("")}
        <td class="is-right op-ok">${P.fmt(P.totalRegime(r), 2)}%</td>
        <td class="is-center"><input type="checkbox" style="width:auto;height:auto"${r.ativo !== false ? " checked" : ""}${dis} onchange="OrionPremissasApp.set('${i}.ativo', this.checked)"></td>
        <td class="is-center">${this.del(i)}</td></tr>`),
      "Nenhum regime cadastrado.") + `<div class="op-rodape">Alíquotas em % sobre a receita.</div>`;
  },

  htmlPlanos(itens) {
    const P = this.P();
    return this.tabela(
      [{ t: "Plano", w: "260px" }, { t: "Condições (nome = %; separe com ;)" }, { t: "Soma", r: 1, w: "90px" }, { t: "", w: "34px" }],
      itens.map((p, i) => {
        const s = P.soma((p.condicoes || []).map((c) => c.perc));
        const ok = Math.abs(s - 100) <= P.TOL;
        return `<tr>
          <td>${this.inp(i + ".nome", p.nome)}</td>
          <td>${this.inp(i + ".condicoes", P.textoDeCondicoes(p.condicoes))}</td>
          <td class="is-right ${ok ? "op-ok" : "op-ruim"}">${P.fmt(s, 2)}%</td>
          <td class="is-center">${this.del(i)}</td></tr>`;
      }),
      "Nenhum plano cadastrado.") + `<div class="op-rodape">Ex.: A VISTA = 3,8; 24 = 6,6; 36 = 12,8. A soma precisa ser exatamente 100%.</div>`;
  },

  htmlIndices(itens) {
    const P = this.P();
    return this.tabela(
      [{ t: "Índice", w: "110px" }, { t: "Cenário" }, { t: "Valor", r: 1, w: "110px" }, { t: "Unidade", w: "110px" }, { t: "Equivalente", r: 1, w: "140px" }, { t: "", w: "34px" }],
      itens.map((x, i) => {
        const eq = x.tipo_unidade === "% a.a." ? P.anualParaMensal(x.valor) : P.mensalParaAnual(x.valor);
        const eqTxt = eq == null ? "" : P.fmt(eq, 4) + (x.tipo_unidade === "% a.a." ? "% a.m." : "% a.a.");
        return `<tr>
          <td>${this.sel(i + ".index_type", x.index_type, P.TIPOS_INDICE)}</td>
          <td>${this.inp(i + ".nome", x.nome)}</td>
          <td>${this.inp(i + ".valor", P.fmt(x.valor, 2), { num: 1 })}</td>
          <td>${this.sel(i + ".tipo_unidade", x.tipo_unidade, P.UNIDADES)}</td>
          <td class="is-right">${eqTxt}</td>
          <td class="is-center">${this.del(i)}</td></tr>`;
      }),
      "Nenhum índice projetado cadastrado.") + `<div class="op-rodape">Opções que aparecem na viabilidade para corrigir receitas (IPCA) e obras (INCC), ex.: Otimista, Padrão, Pessimista.</div>`;
  },

  htmlFunding(f) {
    const P = this.P();
    const ed = this.podeEditar();
    const chaveValor = (grupo, casas) => {
      const obj = f[grupo] || {};
      const linhas = Object.keys(obj).map((k) => `<tr>
        <td>${this.esc(k.replace(/_/g, " "))}</td>
        <td>${this.inp(grupo + "." + k, P.fmt(obj[k], casas), { num: 1 })}</td>
        <td class="is-center">${ed && grupo === "Prestador_GrossUp" ? `<button type="button" class="op-del" onclick="OrionPremissasApp.removerFunding('${grupo}', '${this.jsq(k)}')">✕</button>` : ""}</td></tr>`);
      return this.tabela([{ t: "Item" }, { t: "Valor", r: 1, w: "160px" }, { t: "", w: "34px" }], linhas, "Nenhum item.");
    };
    const sec = f.Securitizadoras || {};
    const campos = ["Agente_Fiduciario_Implantacao", "Agente_Fiduciario_Recorrente", "Instituicao_Custodiante", "Registro_Lastro", "Liquidante"];
    const linhasSec = Object.keys(sec).map((n) => `<tr>
      <td>${this.esc(n)}</td>
      ${campos.map((c) => `<td>${this.inp("Securitizadoras." + n + "." + c, P.fmt(sec[n][c], 2), { num: 1 })}</td>`).join("")}
      <td class="is-center">${ed ? `<button type="button" class="op-del" onclick="OrionPremissasApp.removerFunding('Securitizadoras', '${this.jsq(n)}')">✕</button>` : ""}</td></tr>`);
    const faixas = (sub) => {
      const lista = (f.B3 && f.B3[sub]) || [];
      return this.tabela([{ t: "Até (R$)", r: 1 }, { t: "Taxa", r: 1, w: "160px" }, { t: "", w: "34px" }],
        lista.map((x, i) => `<tr>
          <td>${this.inp(`B3.${sub}.${i}.max`, P.fmt(x.max, 2), { num: 1 })}</td>
          <td>${this.inp(`B3.${sub}.${i}.rate`, P.fmt(x.rate, 2), { num: 1 })}</td>
          <td class="is-center">${ed ? `<button type="button" class="op-del" onclick="OrionPremissasApp.removerFunding('B3', '${sub}.${i}')">✕</button>` : ""}</td></tr>`),
        "Nenhuma faixa.") + (ed ? `<button type="button" class="btn btn-secondary" style="margin-top:6px" onclick="OrionPremissasApp.adicionarFunding('B3', '${sub}')">+ Faixa</button>` : "");
    };
    return `
      <div class="op-sub">CVM</div>${chaveValor("CVM", 2)}
      <div class="op-sub">ANBIMA</div>${chaveValor("ANBIMA", 2)}
      <div class="op-sub">B3 — Registro</div>${faixas("Registro")}
      <div class="op-sub">B3 — Custódia</div>${faixas("Custodia")}
      <div class="op-sub">Securitizadoras (R$)</div>
      ${this.tabela([{ t: "Securitizadora" }, ...campos.map((c) => ({ t: c.replace(/_/g, " "), r: 1, w: "130px" })), { t: "", w: "34px" }], linhasSec, "Nenhuma securitizadora cadastrada.")}
      ${ed ? `<button type="button" class="btn btn-secondary" style="margin-top:6px" onclick="OrionPremissasApp.adicionarFunding('Securitizadoras')">+ Securitizadora</button>` : ""}
      <div class="op-sub">Prestador — gross-up</div>${chaveValor("Prestador_GrossUp", 2)}
      ${ed ? `<button type="button" class="btn btn-secondary" style="margin-top:6px" onclick="OrionPremissasApp.adicionarFunding('Prestador_GrossUp')">+ Prestador</button>` : ""}
      <div class="op-rodape">Taxas usadas no cálculo do custo de funding (CRI) da viabilidade, como no Órion.</div>`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.P() || !window.OrionStore) {
      root.innerHTML = `<div class="op-msg is-erro">Arquivos da tela não carregaram. Recarregue a página.</div>`;
      return;
    }
    const s = this.estado[this.aba];
    const ed = this.podeEditar();
    const abas = this.ABAS.map((a) => `<button type="button" class="btn op-aba ${a.id === this.aba ? "is-ativa" : ""}" onclick="OrionPremissasApp.setAba('${a.id}')">${a.rotulo}${this.estado[a.id] && this.estado[a.id].alterado ? " •" : ""}</button>`).join("");

    let corpo = "";
    if (!s) {
      corpo = `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>`;
    } else {
      const it = s.itens;
      corpo = {
        cenarios: () => this.htmlCenarios(it),
        curvas: () => this.htmlCurvas(it),
        regimes: () => this.htmlRegimes(it),
        planos_pagamento: () => this.htmlPlanos(it),
        indices_projetados: () => this.htmlIndices(it),
        taxas_funding: () => this.htmlFunding(it)
      }[this.aba]();
      const quando = s.atualizadoEm ? s.atualizadoEm.toLocaleString("pt-BR") : "";
      corpo += `<div class="op-rodape">${s.versao ? `Última alteração: ${this.esc(quando)}${s.atualizadoPor ? " por " + this.esc(s.atualizadoPor) : ""}.` : "Ainda não salvo no Integra."}${ed ? "" : " Você pode consultar; para alterar, peça a permissão de edição."}</div>`;
    }

    const acoes = [];
    if (ed && s && this.aba !== "taxas_funding") acoes.push(`<button type="button" class="btn btn-secondary" onclick="OrionPremissasApp.adicionar()"><i data-lucide="plus"></i> Incluir</button>`);
    if (ed && s && s.alterado) acoes.push(`<button type="button" class="btn btn-secondary" onclick="OrionPremissasApp.descartar()">Descartar</button>`);
    if (ed && s) acoes.push(`<button type="button" class="btn btn-primary" ${this.salvando || !s.alterado ? "disabled" : ""} onclick="OrionPremissasApp.salvar()"><i data-lucide="save"></i> ${this.salvando ? "Salvando..." : "Salvar"}</button>`);
    acoes.push(`<button type="button" class="btn btn-primary cc-atualizar" ${this.carregando ? "disabled" : ""} onclick="OrionPremissasApp.carregar('${this.aba}', true)"><i data-lucide="refresh-cw"></i> Atualizar</button>`);

    root.innerHTML = `
      <div class="op-barra"><div class="op-abas">${abas}</div><div class="op-acoes">${acoes.join("")}</div></div>
      ${this.erros.length ? `<div class="op-msg is-erro">Não foi possível salvar:<ul>${this.erros.map((e) => `<li>${this.esc(e)}</li>`).join("")}</ul></div>` : ""}
      ${this.aviso ? `<div class="op-msg is-ok">${this.esc(this.aviso)}</div>` : ""}
      ${corpo}`;
    if (window.lucide) window.lucide.createIcons();
  }
};

window.OrionPremissasApp = OrionPremissasApp;
