/* Órion (transição) › Viabilidades — edição das premissas, aba por aba, como no Órion:
 * Geral, Receitas, Obras, Despesas, Impostos, Permuta e parceiros, Funding, Dados físicos e Datas.
 * Enquanto edita, os indicadores no topo são recalculados na hora com o motor do Órion (orion-viabilidade-calc.js).
 * Também: nova viabilidade, clonar (cria uma versão "dd/mm/aaaa - nome", como no Órion), nova fase e excluir fase.
 * Cadastros do Integra: planos de pagamento, curvas padrão, regimes tributários e taxas de funding vêm das Premissas da viabilidade.
 * Grava em orion_viabilidades com conferência de versão (se outra pessoa salvou antes, avisa e não sobrescreve). */
(function () {
  const A = window.OrionViabilidadesApp;
  if (!A) return;
  const detalheOriginal = A.htmlDetalhe.bind(A);

  const ABAS = [["resultado", "Resultado"], ["geral", "Geral"], ["receitas", "Receitas"], ["obras", "Obras"], ["despesas", "Despesas"], ["impostos", "Impostos"], ["permuta", "Permuta e parceiros"], ["funding", "Funding"], ["fisico", "Dados físicos"], ["datas", "Datas"], ["documentos", "Documentos"]];
  const NUM = (v) => { if (typeof v === "number") return v; const t = String(v == null ? "" : v).trim().replace(/\s/g, "").replace("%", "").replace("R$", ""); if (!t) return 0; const n = Number(t.indexOf(",") >= 0 ? t.replace(/\./g, "").replace(",", ".") : ((t.match(/\./g) || []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(t) ? t.replace(/\./g, "") : t)); return Number.isFinite(n) ? n : 0; };
  const FASE_VAZIA = () => ({
    nome: "Fase Única",
    revenue: { vgv_total: 0, sistema_amortizacao: "Sem Juros", taxa_juros_vendas: 0, taxa_correcao_projetada: 0, tipo_correcao_projetada: "% a.a.", condicoes_pagamento_json: [], velocidade_vendas_json: { meses: [], mes_inicio: 1 } },
    construction: { custo_obras: 0, custo_obras_tipo: "R$", custo_projetos: 0, custo_projetos_tipo: "R$", aquisicao_area: 0, aquisicao_area_tipo: "R$", adm_obras: 0, adm_obras_tipo: "R$", curva_obras_json: { meses: [], mes_inicio: 1 }, curva_projetos_json: { meses: [] }, curva_aquisicao_json: { meses: [] }, curva_adm_obras_json: { meses: [] }, extra_constructions_json: [] },
    expenses: { marketing_valor: 0, marketing_tipo: "%", comercial_valor: 0, comercial_tipo: "%", adm_valor: 0, adm_tipo: "%", comissao_corretagem_valor: 0, curva_marketing_json: { meses: [] }, curva_comercial_json: { meses: [] }, curva_adm_json: { meses: [] }, extra_expenses_json: [] },
    taxes: { regime_tributario: "RET", incidencia_sobre: "Recebimento", aliquota_total: 4, aliquota_pis: 0.65, aliquota_cofins: 3, aliquota_irpj: 1.2, aliquota_csll: 1.08, aliquota_outros: 0 },
    exchanges: { modalidade: "Dinheiro", valor_terreno_fixo: 0, perc_permuta_financeira: 0, perc_parceria_terrenista: 0, perc_parceria_investidor: 0, perc_parceria_empreendedor: 100, permuta_fisica_unidades: 0, permuta_fisica_valor_unidade: 0, abertura_terrenistas_json: [], rateios_config_json: {} },
    funding: { tipo_funding: "Nenhum", modo_volume: "percentual", volume_fixo: 0, percentual_obra_financiado: 0, icvm: "ICVM 476", securitizadora: "", taxa_estruturacao: 0, gross_up: 0, prazo_meses: 36, diluir_custos: false, taxa_juros: 0, taxa_juros_periodicidade: "a.a.", sistema_amortizacao_banco: "SAC" },
    physical_data: {}, dates: {}
  });
  const json = (v, padrao) => { if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return padrao; } } return v == null ? padrao : v; };

  Object.assign(A, {
    ed: null,   // { doc (cópia), fases (cópia), seq, salvando, erros }

    async lerPremissas() {
      if (this.prem) return this.prem;
      const ler = async (k) => { try { return (await window.OrionStore.ler(k, [])).itens || []; } catch (e) { return []; } };
      this.prem = { planos: await ler("planos_pagamento"), curvas: await ler("curvas"), regimes: await ler("regimes") };
      return this.prem;
    },

    setAba(aba) { if (this.aberto) { this.aberto.aba = aba; this.render(); } },

    iniciarEdicao() {
      if (!this.podeEditar() || !this.aberto) return;
      const d = this.aberto.doc;
      this.ed = { doc: JSON.parse(JSON.stringify(Object.assign({}, d, { fases_json: undefined }))), fases: JSON.parse(JSON.stringify(this.fasesDe(d))), seq: 0, salvando: false, erros: [] };
      this.ed.fases.forEach((f) => { ["revenue", "construction", "expenses", "taxes", "exchanges", "funding"].forEach((k) => { if (!f[k]) f[k] = FASE_VAZIA()[k]; }); f.physical_data = f.physical_data || {}; f.dates = f.dates || {}; });
      if (this.aberto.aba === "resultado") this.aberto.aba = "receitas";
      this.lerPremissas().then(() => this.render());
      this.render();
    },
    cancelarEdicao() { if (this.ed && this.ed.seq && !window.confirm("Descartar as alterações desta viabilidade?")) return; this.ed = null; this.render(); },

    /** Documento usado na tela: a cópia em edição (com os números recalculados) ou o gravado. */
    docAtual() {
      if (!this.ed) return this.aberto.doc;
      return Object.assign({}, this.ed.doc, { _id: this.aberto.doc._id, fases: this.ed.fases, versao: "ed" + this.ed.seq });
    },
    faseEd() { return this.ed ? this.ed.fases[this.aberto.fase] : null; },

    /** caminho: "capa.campo" ou "<aba>.campo" (aba = revenue, construction, ...) ou "fase.nome". */
    setCampo(caminho, valor, tipo) {
      if (!this.ed) return;
      const [grupo, ...resto] = String(caminho).split(".");
      const campo = resto.join(".");
      const alvo = grupo === "capa" ? this.ed.doc : grupo === "fase" ? this.faseEd() : this.faseEd()[grupo];
      if (!alvo) return;
      alvo[campo] = tipo === "num" ? NUM(valor) : tipo === "bool" ? !!valor : String(valor == null ? "" : valor);
      this.mudou();
    },
    mudou() { this.ed.seq++; this.cache = {}; this.renderMantendoFoco(); },

    renderMantendoFoco() {
      setTimeout(() => {
        const el = document.activeElement;
        const k = el && el.getAttribute && el.getAttribute("data-k");
        this.render();
        if (k) { const n = document.querySelector(`#orion-viabilidades-root [data-k="${k}"]`); if (n) { n.focus(); if (n.select) n.select(); } }
      }, 0);
    },

    /* ----- campos ----- */
    vNum(v, casas) { return Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas == null ? 2 : casas }); },
    cNum(caminho, rotulo, valor, o) {
      const op = o || {};
      return `<div style="${op.largura ? "width:" + op.largura : "width:150px"}"><label class="ml-emp-filter-label">${rotulo}</label><input class="idx-select" data-k="${caminho}" style="height:40px;width:100%;box-sizing:border-box;text-align:right" value="${this.esc(this.vNum(valor, op.casas))}" onfocus="this.select()" onchange="OrionViabilidadesApp.setCampo('${caminho}', this.value, 'num')"></div>`;
    },
    cTxt(caminho, rotulo, valor, largura) {
      return `<div style="width:${largura || "260px"}"><label class="ml-emp-filter-label">${rotulo}</label><input class="idx-select" data-k="${caminho}" style="height:40px;width:100%;box-sizing:border-box" value="${this.esc(valor || "")}" onchange="OrionViabilidadesApp.setCampo('${caminho}', this.value)"></div>`;
    },
    cSel(caminho, rotulo, valor, opcoes, largura) {
      return `<div style="width:${largura || "180px"}"><label class="ml-emp-filter-label">${rotulo}</label><select class="idx-select" data-k="${caminho}" style="height:40px;width:100%" onchange="OrionViabilidadesApp.setCampo('${caminho}', this.value)">${opcoes.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${this.esc(v)}" ${String(v) === String(valor == null ? "" : valor) ? "selected" : ""}>${this.esc(t)}</option>`; }).join("")}</select></div>`;
    },
    cChk(caminho, rotulo, valor) {
      return `<label style="display:flex;gap:6px;align-items:center;height:40px;font-size:0.8rem"><input type="checkbox" data-k="${caminho}" ${valor ? "checked" : ""} onchange="OrionViabilidadesApp.setCampo('${caminho}', this.checked, 'bool')"> ${rotulo}</label>`;
    },
    /** Valor com tipo R$ ou % do VGV (como no Órion). */
    cValTipo(grupo, campo, campoTipo, rotulo, f) {
      return `<div style="display:flex;gap:4px;align-items:flex-end">${this.cNum(grupo + "." + campo, rotulo, f[grupo][campo])}${this.cSel(grupo + "." + campoTipo, "&nbsp;", f[grupo][campoTipo] || "R$", [["R$", "R$"], ["%", "% do VGV"]], "110px")}</div>`;
    },
    linha(...partes) { return `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">${partes.join("")}</div>`; },
    sec(t) { return `<div class="ov-sec">${t}</div>`; },

    /* ----- curvas {meses, mes_inicio} ----- */
    setCurva(grupo, campo, acao, j, valor) {
      const f = this.faseEd();
      const c = Object.assign({ meses: [], mes_inicio: 1 }, json(f[grupo][campo], {}) || {});
      c.meses = (c.meses || []).slice();
      if (acao === "mes") c.meses[j] = NUM(valor);
      else if (acao === "mais") c.meses.push(0);
      else if (acao === "menos") c.meses.splice(j, 1);
      else if (acao === "inicio") c.mes_inicio = Math.max(1, Math.trunc(NUM(valor)) || 1);
      else if (acao === "ajustar" && window.OrionPremissasCalc) c.meses = window.OrionPremissasCalc.ajustarPara100(c.meses);
      else if (acao === "padrao") { const p = (this.prem.curvas || []).find((x) => x.nome === valor); if (!p) return; c.meses = (p.meses || []).slice(); }
      else if (acao === "limpar") c.meses = [];
      f[grupo][campo] = c;
      this.mudou();
    },
    cCurva(grupo, campo, rotulo, tiposSugeridos) {
      const f = this.faseEd();
      const c = Object.assign({ meses: [], mes_inicio: 1 }, json(f[grupo][campo], {}) || {});
      const s = (c.meses || []).reduce((a, b) => a + (Number(b) || 0), 0);
      const k = `${grupo}.${campo}`;
      const padroes = (this.prem && this.prem.curvas || []).filter((x) => !tiposSugeridos || tiposSugeridos.indexOf(String(x.tipo || "").toLowerCase()) >= 0 || true);
      return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:10px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:0.78rem"><b style="color:#105436">${rotulo}</b>
          <span>começa no mês <input class="idx-select" data-k="${k}.inicio" style="height:30px;width:60px;text-align:center" value="${c.mes_inicio || 1}" onchange="OrionViabilidadesApp.setCurva('${grupo}', '${campo}', 'inicio', 0, this.value)"></span>
          <span class="${Math.abs(s - 100) <= 0.01 || !c.meses.length ? "" : "ov-neg"}">soma ${this.vNum(s)}% · ${c.meses.length} meses${c.meses.length ? "" : " (vazio: segue a curva de vendas ou de obras, como no Órion)"}</span>
          <select style="height:30px" onchange="if(this.value)OrionViabilidadesApp.setCurva('${grupo}', '${campo}', 'padrao', 0, this.value)"><option value="">Usar curva padrão…</option>${padroes.map((p) => `<option value="${this.esc(p.nome)}">${this.esc(p.nome)} (${this.esc(p.tipo || "")})</option>`).join("")}</select>
          <button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.setCurva('${grupo}', '${campo}', 'mais')">+ mês</button>
          <button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.setCurva('${grupo}', '${campo}', 'ajustar')">Ajustar para 100%</button>
          ${c.meses.length ? `<button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionViabilidadesApp.setCurva('${grupo}', '${campo}', 'limpar')">Limpar</button>` : ""}</div>
        ${c.meses.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${c.meses.map((v, j) => `<div style="width:58px"><div style="font-size:0.6rem;color:#64748b;text-align:center">${(c.mes_inicio || 1) + j}</div><input data-k="${k}.${j}" class="idx-select" style="height:28px;width:100%;box-sizing:border-box;text-align:center;font-size:0.7rem" value="${this.esc(this.vNum(v))}" onfocus="this.select()" onchange="OrionViabilidadesApp.setCurva('${grupo}', '${campo}', 'mes', ${j}, this.value)"></div>`).join("")}</div>` : ""}
      </div>`;
    },

    /* ----- listas (condições de pagamento, extras, parceiros) ----- */
    listaFase(grupo, campo) { const f = this.faseEd(); const v = json(f[grupo][campo], []); return Array.isArray(v) ? v : []; },
    setLista(grupo, campo, acao, j, k, valor, tipo) {
      const f = this.faseEd();
      let l = JSON.parse(JSON.stringify(this.listaFase(grupo, campo)));
      if (acao === "mais") l.push(valor || {});
      else if (acao === "menos") l.splice(j, 1);
      else if (acao === "set" && l[j]) l[j][k] = tipo === "num" ? NUM(valor) : tipo === "bool" ? !!valor : String(valor);
      f[grupo][campo] = l;
      this.mudou();
    },

    /** Condições de pagamento: no Órion ficam como [{nome do plano, condicoes:[…]}]; aqui editamos a lista "achatada". */
    condicoes() {
      const cj = this.listaFase("revenue", "condicoes_pagamento_json");
      const flat = [];
      cj.forEach((it) => { if (it && Array.isArray(it.condicoes)) flat.push(...it.condicoes); else if (it) flat.push(it); });
      return flat;
    },
    setCondicoes(lista) {
      const f = this.faseEd();
      f.revenue.condicoes_pagamento_json = [{ nome: f.revenue.plano_ativo || "Plano da viabilidade", condicoes: lista }];
      this.mudou();
    },
    condAcao(acao, j, k, valor, tipo) {
      const l = JSON.parse(JSON.stringify(this.condicoes()));
      if (acao === "mais") l.push({ nome: "", perc: 0, aplica_juros: true, aplica_correcao: true, perc_entrada: 0, parcelas_entrada: 1 });
      else if (acao === "menos") l.splice(j, 1);
      else if (acao === "set" && l[j]) l[j][k] = tipo === "num" ? NUM(valor) : tipo === "bool" ? !!valor : String(valor);
      else if (acao === "plano") {
        const p = (this.prem.planos || []).find((x) => x.nome === valor);
        if (!p) return;
        if (l.length && !window.confirm(`Trocar as condições pelas do plano "${p.nome}"?`)) return;
        this.faseEd().revenue.plano_ativo = p.nome;
        return this.setCondicoes(JSON.parse(JSON.stringify(p.condicoes || [])));
      }
      this.setCondicoes(l);
    },

    /* ----- abas ----- */
    htmlAbaGeral() {
      const d = this.ed.doc, f = this.faseEd();
      return this.sec("Projeto") + this.linha(this.cTxt("capa.project_name", "Nome da viabilidade", d.project_name, "360px"), this.cTxt("capa.city", "Cidade", d.city, "220px"), this.cTxt("fase.nome", "Nome da fase", f.nome, "200px")) +
        this.sec("Taxas") + this.linha(this.cNum("capa.taxa_desconto_vpl", "TMA / desconto do VPL (% a.a.)", d.taxa_desconto_vpl, { largura: "220px" }),
          this.cChk("capa.aplicar_incc_obras", "Corrigir obras pelo INCC", d.aplicar_incc_obras), this.cNum("capa.incc_projetado_valor", "INCC projetado", d.incc_projetado_valor), this.cSel("capa.incc_projetado_tipo", "Unidade", d.incc_projetado_tipo || "% a.a.", ["% a.a.", "% a.m."], "110px")) +
        this.sec("Parecer executivo") + `<textarea data-k="capa.parecer_executivo" style="width:100%;min-height:140px;box-sizing:border-box;border:1px solid #d6e2db;border-radius:8px;padding:8px;font-size:0.8rem" onchange="OrionViabilidadesApp.setCampo('capa.parecer_executivo', this.value)">${this.esc(d.parecer_executivo || "")}</textarea>`;
    },
    htmlAbaReceitas() {
      const f = this.faseEd(), r = f.revenue;
      const cs = this.condicoes();
      const soma = cs.reduce((a, c) => a + (Number(c.perc) || 0), 0);
      const planos = (this.prem && this.prem.planos) || [];
      return this.sec("Receita") + this.linha(this.cNum("revenue.vgv_total", "VGV total (R$)", r.vgv_total, { largura: "200px" }), this.cSel("revenue.sistema_amortizacao", "Sistema", r.sistema_amortizacao || "Sem Juros", ["Sem Juros", "Price", "SAC"]), this.cNum("revenue.taxa_juros_vendas", "Juros das vendas (% a.a.)", r.taxa_juros_vendas, { largura: "180px" }), this.cNum("revenue.taxa_correcao_projetada", "Correção projetada", r.taxa_correcao_projetada), this.cSel("revenue.tipo_correcao_projetada", "Unidade", r.tipo_correcao_projetada || "% a.a.", ["% a.a.", "% a.m."], "110px")) +
        this.sec(`Condições de pagamento <span style="font-weight:400" class="${Math.abs(soma - 100) <= 0.01 ? "" : "ov-neg"}">(soma ${this.vNum(soma)}%)</span>`) +
        `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center"><select class="idx-select" style="height:36px;min-width:300px" onchange="if(this.value)OrionViabilidadesApp.condAcao('plano', 0, '', this.value)"><option value="">Trazer de um plano de pagamento (Premissas)…</option>${planos.map((p) => `<option value="${this.esc(p.nome)}">${this.esc(p.nome)}</option>`).join("")}</select>${r.plano_ativo ? `<span style="font-size:0.75rem;color:#64748b">plano atual: ${this.esc(r.plano_ativo)}</span>` : ""}<button type="button" class="btn btn-secondary" style="height:36px;margin-left:auto" onclick="OrionViabilidadesApp.condAcao('mais')">+ condição</button></div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:90px"><col style="width:110px"><col style="width:110px"><col style="width:100px"><col style="width:120px"><col style="width:34px"></colgroup>
        <thead><tr><th>Condição (A VISTA, 24, 36…)</th><th class="is-right">%</th><th class="is-center">Aplica juros</th><th class="is-center">Aplica correção</th><th class="is-right">Entrada %</th><th class="is-right">Parcelas da entrada</th><th></th></tr></thead>
        <tbody>${cs.map((c, j) => `<tr><td><input data-k="cond.${j}.nome" class="idx-select" style="height:30px;width:100%" value="${this.esc(c.nome)}" onchange="OrionViabilidadesApp.condAcao('set', ${j}, 'nome', this.value)"></td>
          <td><input data-k="cond.${j}.perc" class="idx-select" style="height:30px;width:100%;text-align:right" value="${this.esc(this.vNum(c.perc))}" onfocus="this.select()" onchange="OrionViabilidadesApp.condAcao('set', ${j}, 'perc', this.value, 'num')"></td>
          <td class="is-center"><input type="checkbox" data-k="cond.${j}.j" ${c.aplica_juros !== false ? "checked" : ""} onchange="OrionViabilidadesApp.condAcao('set', ${j}, 'aplica_juros', this.checked, 'bool')"></td>
          <td class="is-center"><input type="checkbox" data-k="cond.${j}.c" ${c.aplica_correcao !== false ? "checked" : ""} onchange="OrionViabilidadesApp.condAcao('set', ${j}, 'aplica_correcao', this.checked, 'bool')"></td>
          <td><input data-k="cond.${j}.pe" class="idx-select" style="height:30px;width:100%;text-align:right" value="${this.esc(this.vNum(c.perc_entrada || 0))}" onfocus="this.select()" onchange="OrionViabilidadesApp.condAcao('set', ${j}, 'perc_entrada', this.value, 'num')"></td>
          <td><input data-k="cond.${j}.pa" class="idx-select" style="height:30px;width:100%;text-align:right" value="${this.esc(c.parcelas_entrada || 1)}" onfocus="this.select()" onchange="OrionViabilidadesApp.condAcao('set', ${j}, 'parcelas_entrada', this.value, 'num')"></td>
          <td class="is-center"><button type="button" style="border:none;background:none;color:#b91c1c;cursor:pointer" title="Remover" onclick="OrionViabilidadesApp.condAcao('menos', ${j})">✕</button></td></tr>`).join("") || `<tr><td colspan="7" style="text-align:center;padding:16px">Sem condições: o cálculo considera 100% à vista.</td></tr>`}</tbody></table></div>` +
        this.sec("Velocidade de vendas") + this.cCurva("revenue", "velocidade_vendas_json", "Curva de vendas (% do VGV vendido por mês)");
    },
    htmlAbaObras() {
      const f = this.faseEd();
      return this.sec("Custos") + this.linha(this.cValTipo("construction", "custo_obras", "custo_obras_tipo", "Obras de infraestrutura", f), this.cValTipo("construction", "custo_projetos", "custo_projetos_tipo", "Projetos", f), this.cValTipo("construction", "aquisicao_area", "aquisicao_area_tipo", "Aquisição de área", f), this.cValTipo("construction", "adm_obras", "adm_obras_tipo", "Administração da obra", f)) +
        this.sec("Curvas de desembolso") + this.cCurva("construction", "curva_obras_json", "Obras") + this.cCurva("construction", "curva_projetos_json", "Projetos") + this.cCurva("construction", "curva_aquisicao_json", "Aquisição de área") + this.cCurva("construction", "curva_adm_obras_json", "Administração da obra") +
        this.sec("Custos extras de obras") + this.htmlExtras("construction", "extra_constructions_json");
    },
    htmlAbaDespesas() {
      const f = this.faseEd();
      return this.sec("Despesas") + this.linha(this.cValTipo("expenses", "marketing_valor", "marketing_tipo", "Marketing", f), this.cValTipo("expenses", "comercial_valor", "comercial_tipo", "Comercial", f), this.cValTipo("expenses", "adm_valor", "adm_tipo", "Administrativas", f), this.cNum("expenses.comissao_corretagem_valor", "Comissão de corretagem (% do VGV)", f.expenses.comissao_corretagem_valor, { largura: "230px" })) +
        this.sec("Curvas") + this.cCurva("expenses", "curva_marketing_json", "Marketing") + this.cCurva("expenses", "curva_comercial_json", "Comercial") + this.cCurva("expenses", "curva_adm_json", "Administrativas") +
        this.sec("Despesas extras") + this.htmlExtras("expenses", "extra_expenses_json");
    },
    htmlExtras(grupo, campo) {
      const l = this.listaFase(grupo, campo);
      return `<div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:150px"><col style="width:120px"><col style="width:34px"></colgroup>
        <thead><tr><th>Descrição</th><th class="is-right">Valor</th><th>Tipo</th><th></th></tr></thead><tbody>
        ${l.map((x, j) => `<tr><td><input data-k="${campo}.${j}.d" class="idx-select" style="height:30px;width:100%" value="${this.esc(x.descricao || x.nome || "")}" onchange="OrionViabilidadesApp.setLista('${grupo}', '${campo}', 'set', ${j}, 'descricao', this.value)"></td>
          <td><input data-k="${campo}.${j}.v" class="idx-select" style="height:30px;width:100%;text-align:right" value="${this.esc(this.vNum(x.valor))}" onfocus="this.select()" onchange="OrionViabilidadesApp.setLista('${grupo}', '${campo}', 'set', ${j}, 'valor', this.value, 'num')"></td>
          <td><select data-k="${campo}.${j}.t" class="idx-select" style="height:30px;width:100%" onchange="OrionViabilidadesApp.setLista('${grupo}', '${campo}', 'set', ${j}, 'tipo', this.value)"><option value="R$" ${x.tipo !== "%" ? "selected" : ""}>R$</option><option value="%" ${x.tipo === "%" ? "selected" : ""}>% do VGV</option></select></td>
          <td class="is-center"><button type="button" style="border:none;background:none;color:#b91c1c;cursor:pointer" onclick="OrionViabilidadesApp.setLista('${grupo}', '${campo}', 'menos', ${j})">✕</button></td></tr>`).join("") || `<tr><td colspan="4" style="text-align:center;padding:12px">Nenhum.</td></tr>`}
        </tbody></table></div><button type="button" class="btn btn-secondary" style="height:32px;margin-top:6px" onclick="OrionViabilidadesApp.setLista('${grupo}', '${campo}', 'mais', 0, '', {descricao:'', valor:0, tipo:'R$'})">+ incluir</button>
        <div style="font-size:0.7rem;color:#64748b;margin-top:4px">Sem curva própria, o extra segue a curva de ${grupo === "construction" ? "obras" : "vendas"} (regra do Órion).</div>`;
    },
    htmlAbaImpostos() {
      const t = this.faseEd().taxes;
      const regimes = (this.prem && this.prem.regimes) || [];
      const lp = t.regime_tributario === "Lucro Presumido";
      return this.sec("Regime") + this.linha(this.cSel("taxes.regime_tributario", "Regime tributário", t.regime_tributario || "RET", ["RET", "Lucro Presumido"], "200px"), this.cSel("taxes.incidencia_sobre", "Incide sobre", t.incidencia_sobre || "Recebimento", [["Recebimento", "Recebimento (caixa)"], ["Venda", "Venda (competência)"]], "200px"),
          regimes.length ? `<div><label class="ml-emp-filter-label">Trazer alíquotas de</label><select class="idx-select" style="height:40px;min-width:220px" onchange="if(this.value)OrionViabilidadesApp.aplicarRegime(this.value)"><option value="">Regime das Premissas…</option>${regimes.filter((r) => r.ativo !== false).map((r) => `<option value="${this.esc(r.nome)}">${this.esc(r.nome)}</option>`).join("")}</select></div>` : "") +
        (lp ? this.linha(this.cNum("taxes.aliquota_pis", "PIS %", t.aliquota_pis), this.cNum("taxes.aliquota_cofins", "COFINS %", t.aliquota_cofins), this.cNum("taxes.aliquota_irpj", "IRPJ %", t.aliquota_irpj), this.cNum("taxes.aliquota_csll", "CSLL %", t.aliquota_csll), this.cNum("taxes.aliquota_outros", "Outros %", t.aliquota_outros))
          : this.linha(this.cNum("taxes.aliquota_total", "Alíquota total do RET (%)", t.aliquota_total == null ? 4 : t.aliquota_total, { largura: "200px" }))) +
        `<div style="font-size:0.72rem;color:#64748b">No RET, a alíquota padrão é 4% (PIS 0,37 + COFINS 1,71 + IRPJ/CSLL 1,92); acima disso vira "outros", como no Órion.</div>`;
    },
    aplicarRegime(nome) {
      const r = ((this.prem && this.prem.regimes) || []).find((x) => x.nome === nome);
      if (!r) return;
      const t = this.faseEd().taxes;
      const tot = ["pis", "cofins", "irpj", "csll", "outros"].reduce((s, k) => s + (Number(r[k]) || 0), 0);
      if (/RET/i.test(nome)) { t.regime_tributario = "RET"; t.aliquota_total = tot; }
      else { t.regime_tributario = "Lucro Presumido"; t.aliquota_pis = r.pis; t.aliquota_cofins = r.cofins; t.aliquota_irpj = r.irpj; t.aliquota_csll = r.csll; t.aliquota_outros = r.outros; t.aliquota_total = tot; }
      this.mudou();
    },
    htmlAbaPermuta() {
      const f = this.faseEd(), x = f.exchanges;
      const mod = String(x.modalidade || "");
      const tem = (m) => mod.indexOf(m) >= 0;
      const ab = this.listaFase("exchanges", "abertura_terrenistas_json");
      const somaAb = ab.reduce((s, p) => s + (Number(p.percentual) || 0), 0);
      const rat = json(x.rateios_config_json, {}) || {};
      const chkRat = (k, t) => `<label style="display:flex;gap:6px;align-items:center;font-size:0.78rem;margin-right:14px"><input type="checkbox" data-k="rat.${k}" ${rat[k] ? "checked" : ""} onchange="OrionViabilidadesApp.setRateio('${k}', this.checked)"> ${t}</label>`;
      return this.sec("Modalidade do terreno") + `<div style="display:flex;gap:14px;margin-bottom:8px">${["Dinheiro", "Permuta Financeira", "Permuta Física"].map((m) => `<label style="display:flex;gap:6px;align-items:center;font-size:0.8rem"><input type="checkbox" data-k="mod.${m}" ${tem(m) ? "checked" : ""} onchange="OrionViabilidadesApp.setModalidade('${m}', this.checked)"> ${m}</label>`).join("")}</div>` +
        this.linha(tem("Dinheiro") ? this.cNum("exchanges.valor_terreno_fixo", "Valor do terreno em dinheiro (R$)", x.valor_terreno_fixo, { largura: "240px" }) : "",
          tem("Permuta Financeira") ? this.cNum("exchanges.perc_permuta_financeira", "Permuta financeira (% do VGV)", x.perc_permuta_financeira, { largura: "220px" }) + this.cChk("rat.vincular", "Usar o % do terrenista na parceria", rat.vincular_permuta_parceria !== false) : "",
          tem("Permuta Física") ? this.cNum("exchanges.permuta_fisica_unidades", "Unidades permutadas", x.permuta_fisica_unidades, { casas: 0 }) + this.cNum("exchanges.permuta_fisica_valor_unidade", "Valor por unidade (R$)", x.permuta_fisica_valor_unidade, { largura: "180px" }) : "") +
        this.sec("Parceria") + this.linha(this.cNum("exchanges.perc_parceria_empreendedor", "Empreendedor %", x.perc_parceria_empreendedor), this.cNum("exchanges.perc_parceria_terrenista", "Terrenista %", x.perc_parceria_terrenista), this.cNum("exchanges.perc_parceria_investidor", "Investidor %", x.perc_parceria_investidor)) +
        this.sec(`Abertura dos parceiros <span style="font-weight:400" class="${ab.length && Math.abs(somaAb - 100) > 0.01 ? "ov-neg" : ""}">(soma ${this.vNum(somaAb)}%)</span>`) +
        `<div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:180px"><col style="width:110px"><col style="width:34px"></colgroup><thead><tr><th>Parceiro</th><th>Tipo</th><th class="is-right">% do projeto</th><th></th></tr></thead><tbody>
          ${ab.map((p, j) => `<tr><td><input data-k="ab.${j}.n" class="idx-select" style="height:30px;width:100%" value="${this.esc(p.nome || "")}" onchange="OrionViabilidadesApp.setLista('exchanges', 'abertura_terrenistas_json', 'set', ${j}, 'nome', this.value)"></td>
            <td><select data-k="ab.${j}.t" class="idx-select" style="height:30px;width:100%" onchange="OrionViabilidadesApp.setLista('exchanges', 'abertura_terrenistas_json', 'set', ${j}, 'tipo', this.value)">${["Proprietário", "Empreendedor", "Investidor"].map((t) => `<option ${(p.tipo || "Proprietário") === t ? "selected" : ""}>${t}</option>`).join("")}</select></td>
            <td><input data-k="ab.${j}.p" class="idx-select" style="height:30px;width:100%;text-align:right" value="${this.esc(this.vNum(p.percentual))}" onfocus="this.select()" onchange="OrionViabilidadesApp.setLista('exchanges', 'abertura_terrenistas_json', 'set', ${j}, 'percentual', this.value, 'num')"></td>
            <td class="is-center"><button type="button" style="border:none;background:none;color:#b91c1c;cursor:pointer" onclick="OrionViabilidadesApp.setLista('exchanges', 'abertura_terrenistas_json', 'menos', ${j})">✕</button></td></tr>`).join("") || `<tr><td colspan="4" style="text-align:center;padding:12px">Sem abertura: a visão do empreendedor usa os % da parceria acima.</td></tr>`}
        </tbody></table></div><button type="button" class="btn btn-secondary" style="height:32px;margin-top:6px" onclick="OrionViabilidadesApp.setLista('exchanges', 'abertura_terrenistas_json', 'mais', 0, '', {nome:'', tipo:'Proprietário', percentual:0})">+ parceiro</button>` +
        this.sec("Custos rateados entre os parceiros") + `<div style="display:flex;flex-wrap:wrap;gap:4px">${chkRat("custo_obras", "Obras")}${chkRat("custo_projetos", "Projetos")}${chkRat("aquisicao_area", "Aquisição de área / terreno")}${chkRat("adm_obras", "Adm. da obra")}${chkRat("marketing", "Marketing")}${chkRat("comercial", "Comercial")}${chkRat("adm", "Administrativas")}</div>
        <div style="font-size:0.72rem;color:#64748b;margin-top:4px">O que não for marcado fica só com o empreendedor (regra do Órion de 09/11/2026). Regras de repasse e prestação de contas seguem a Parametrização de Parceiro do Integra.</div>`;
    },
    setModalidade(m, on) {
      const x = this.faseEd().exchanges;
      const l = ["Dinheiro", "Permuta Financeira", "Permuta Física"].filter((k) => (k === m ? on : String(x.modalidade || "").indexOf(k) >= 0));
      x.modalidade = l.join(" + ");
      this.mudou();
    },
    setRateio(k, on) {
      const x = this.faseEd().exchanges;
      const r = Object.assign({}, json(x.rateios_config_json, {}) || {});
      r[k] = !!on;
      x.rateios_config_json = r;
      this.mudou();
    },
    htmlAbaFunding() {
      const x = this.faseEd().funding;
      const tipo = x.tipo_funding || "Nenhum";
      const sec = ((window.OrionPremissasApp && window.OrionPremissasApp.estado && window.OrionPremissasApp.estado.taxas_funding && window.OrionPremissasApp.estado.taxas_funding.itens) || this.taxas || {}).Securitizadoras || {};
      const banco = tipo === "Plano Empresarial (Banco)";
      return this.sec("Funding") + this.linha(this.cSel("funding.tipo_funding", "Tipo", tipo, ["Nenhum", "CRI", "CRA", "Plano Empresarial (Banco)"], "230px")) +
        (tipo === "Nenhum" ? `<div style="font-size:0.8rem;color:#64748b">Sem funding.</div>` :
          this.linha(this.cSel("funding.modo_volume", "Volume", x.modo_volume || "percentual", [["percentual", "% do custo de obras"], ["fixo", "Valor fixo"]], "200px"),
            x.modo_volume === "fixo" ? this.cNum("funding.volume_fixo", "Volume (R$)", x.volume_fixo, { largura: "180px" }) : this.cNum("funding.percentual_obra_financiado", "% da obra financiado", x.percentual_obra_financiado),
            this.cNum("funding.prazo_meses", "Prazo (meses)", x.prazo_meses, { casas: 0 }), this.cNum("funding.taxa_juros", "Juros", x.taxa_juros), this.cSel("funding.taxa_juros_periodicidade", "Unidade", x.taxa_juros_periodicidade || "a.a.", [["a.a.", "% a.a."], ["a.m.", "% a.m."]], "110px"),
            this.cSel("funding.sistema_amortizacao_banco", "Amortização", x.sistema_amortizacao_banco || "SAC", ["SAC", "Price", "Bullet"], "130px")) +
          (banco ? "" : this.linha(this.cSel("funding.icvm", "Oferta", x.icvm || "ICVM 476", ["ICVM 476", "ICVM 400"], "140px"), this.cSel("funding.securitizadora", "Securitizadora", x.securitizadora || "", [""].concat(Object.keys(sec)), "200px"),
            this.cNum("funding.taxa_estruturacao", "Estruturação (%)", x.taxa_estruturacao), this.cNum("funding.gross_up", "Gross-up (%)", x.gross_up), this.cChk("funding.diluir_custos", "Diluir custos na curva de obras", x.diluir_custos))) +
          `<div style="font-size:0.72rem;color:#64748b">Custos CVM, ANBIMA, B3 e da securitizadora vêm de Configurações gerais › Premissas da viabilidade › Taxas de funding.</div>`);
    },
    htmlAbaFisico() {
      const p = this.faseEd().physical_data;
      const c = (k, t, casas) => this.cNum("physical_data." + k, t, p[k], { casas, largura: "170px" });
      return this.sec("Áreas (m²) e lotes") + this.linha(c("area_total", "Área total"), c("qtde_lotes_residenciais", "Lotes residenciais", 0), c("area_lotes_residenciais", "Área residencial"), c("valor_venda_residencial_m2", "R$/m² residencial")) +
        this.linha(c("qtde_lotes_comerciais", "Lotes comerciais", 0), c("area_lotes_comerciais", "Área comercial"), c("valor_venda_comercial_m2", "R$/m² comercial"), c("qtde_lotes_mistos", "Lotes mistos", 0), c("area_lotes_mistos", "Área mista"), c("valor_venda_misto_m2", "R$/m² misto")) +
        this.linha(c("area_sistema_viario", "Sistema viário"), c("area_institucional", "Área institucional"), c("area_verde", "Área verde / APP"), c("sistema_lazer", "Sistema de lazer"), c("area_associacao", "Associação / não vendável"));
    },
    htmlAbaDatas() {
      const d = this.faseEd().dates;
      const c = (k, t) => `<div style="width:180px"><label class="ml-emp-filter-label">${t}</label><input type="date" class="idx-select" data-k="dates.${k}" style="height:40px;width:100%;box-sizing:border-box" value="${this.esc(String(d[k] || "").slice(0, 10))}" onchange="OrionViabilidadesApp.setCampo('dates.${k}', this.value)"></div>`;
      return this.sec("Marcos") + this.linha(c("data_registro", "Registro (RI)"), c("data_lancamento", "Lançamento"), c("data_inicio_obras", "Início de obras"), c("data_inicio_projetos", "Início de projetos"), c("data_inicio_comercial", "Início comercial"), c("data_inicio_mkt", "Início de marketing"), c("data_inicio_aquisicao", "Início da aquisição"));
    },

    /* ----- gravar, nova, clonar, fases ----- */
    async salvarEdicao() {
      const e = this.ed;
      if (!e || e.salvando || !this.podeEditar()) return;
      e.salvando = true;
      e.erros = [];
      this.render();
      const fc = this.fc();
      const id = this.aberto.doc._id;
      const lida = Number(this.aberto.doc.versao) || 0;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      try {
        await fc.runTransaction(window.firebaseDb, async (tx) => {
          const ref = fc.doc(window.firebaseDb, this.COL, id);
          const s = await tx.get(ref);
          if (!s.exists()) throw new Error("Esta viabilidade não existe mais. Clique em Atualizar.");
          const atual = s.data();
          if ((Number(atual.versao) || 0) !== lida) throw new Error(`Esta viabilidade foi alterada por ${atual.atualizado_por || "outra pessoa"} depois que você abriu. Copie o que mudou, clique em Cancelar e abra de novo.`);
          const capa = Object.assign({}, e.doc);
          delete capa._id; delete capa.fases; delete capa.fases_json;
          tx.set(ref, Object.assign({}, atual, capa, { fases_json: JSON.stringify(e.fases), qtd_fases: e.fases.length, versao: lida + 1, atualizado_por: quem, atualizado_em: new Date().toISOString() }));
        });
        this.ed = null;
        this.aviso = "Viabilidade salva.";
        await this.carregar();
      } catch (err) {
        e.salvando = false;
        e.erros = [err.message || String(err)];
        this.render();
      }
    },

    async criarDoc(capa, fases) {
      const fc = this.fc();
      const id = `int_${Date.now().toString(36)}`;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      await fc.setDoc(fc.doc(window.firebaseDb, this.COL, id), Object.assign({}, capa, { fases_json: JSON.stringify(fases), qtd_fases: fases.length, versao: 1, criado_por: quem, criado_em: new Date().toISOString(), origem: "integra" }));
      await this.carregar();
      this.abrir(id);
      return id;
    },

    async novaViabilidade() {
      if (!this.podeEditar()) return;
      const nome = (window.prompt("Nome da nova viabilidade:") || "").trim();
      if (!nome) return;
      await this.criarDoc({ project_name: nome, city: "", status: "Em Andamento", taxa_desconto_vpl: 12, aplicar_incc_obras: false, incc_projetado_valor: 0, incc_projetado_tipo: "% a.a.", versao_de: null }, [FASE_VAZIA()]);
      this.iniciarEdicao();
    },

    async clonar() {
      if (!this.podeEditar() || !this.aberto) return;
      const d = this.aberto.doc;
      const base = (window.prompt("Nome da nova versão (fica com a data de hoje na frente, como no Órion):", d.project_name.replace(/^\d{2}\/\d{2}\/\d{4} - /, "")) || "").trim();
      if (!base) return;
      const hoje = new Date().toLocaleDateString("pt-BR");
      const capa = JSON.parse(JSON.stringify(d));
      ["_id", "fases", "fases_json", "versao", "historico_status", "atualizado_por", "atualizado_em", "importado_em", "importado_por", "orion_id"].forEach((k) => delete capa[k]);
      Object.assign(capa, { project_name: `${hoje} - ${base}`, status: "Em Andamento", versao_de: d._id });
      await this.criarDoc(capa, JSON.parse(JSON.stringify(this.fasesDe(d))));
      this.aviso = "Versão criada. Os números são os mesmos da original até você editar.";
      this.render();
    },

    novaFase() {
      if (!this.ed) return;
      const copiar = this.ed.fases.length && window.confirm("Copiar as premissas da fase atual para a nova fase? (Cancelar = fase em branco)");
      const nova = copiar ? JSON.parse(JSON.stringify(this.faseEd())) : FASE_VAZIA();
      nova.nome = `Fase ${this.ed.fases.length + 1}`;
      delete nova.orion_id;
      this.ed.fases.push(nova);
      this.aberto.fase = this.ed.fases.length - 1;
      this.mudou();
    },
    excluirFase() {
      if (!this.ed || this.ed.fases.length <= 1) return;
      if (!window.confirm(`Excluir a fase "${this.faseEd().nome}"? Só vale depois de Salvar.`)) return;
      this.ed.fases.splice(this.aberto.fase, 1);
      this.aberto.fase = 0;
      this.mudou();
    },

    /* ----- tela ----- */
    htmlDetalhe() {
      const a = this.aberto;
      if (!a.aba) a.aba = "resultado";
      const ed = !!this.ed;
      const original = this.aberto.doc;
      if (ed) this.aberto.doc = this.docAtual(); // o resultado mostra os números da cópia em edição
      let html;
      try {
        const abas = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:6px 0 12px;border-bottom:1px solid #e2e8f0;padding-bottom:6px">${ABAS.map(([k, t]) => `<button type="button" class="btn ${a.aba === k ? "btn-primary" : "btn-secondary"}" style="height:32px" onclick="OrionViabilidadesApp.setAba('${k}')">${t}</button>`).join("")}</div>`;
        const barraEd = this.podeEditar() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            ${ed ? `<span style="font-size:0.78rem;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:4px 8px">Editando${this.ed.seq ? " · alterações não salvas" : ""} — os números se atualizam na hora</span>
              <button type="button" class="btn btn-secondary" style="height:32px" onclick="OrionViabilidadesApp.novaFase()">+ fase</button>
              ${this.ed.fases.length > 1 ? `<button type="button" class="btn btn-secondary" style="height:32px;color:#b91c1c" onclick="OrionViabilidadesApp.excluirFase()">Excluir fase</button>` : ""}
              <button type="button" class="btn btn-secondary" style="height:32px;margin-left:auto" onclick="OrionViabilidadesApp.cancelarEdicao()">Cancelar</button>
              <button type="button" class="btn btn-primary" style="height:32px" ${this.ed.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarEdicao()">${this.ed.salvando ? "Salvando..." : "Salvar"}</button>`
              : `<button type="button" class="btn btn-primary" style="height:32px" onclick="OrionViabilidadesApp.iniciarEdicao()">Editar premissas</button>
              <button type="button" class="btn btn-secondary" style="height:32px" onclick="OrionViabilidadesApp.clonar()">Clonar (nova versão)</button>`}
          </div>${ed && this.ed.erros.length ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:8px">${this.ed.erros.map((x) => this.esc(x)).join("<br>")}</div>` : ""}` : "";
        if (a.aba === "resultado") html = barraEd + abas + detalheOriginal();
        else if (a.aba === "documentos") html = barraEd + abas + (typeof this.htmlDocumentos === "function" ? this.htmlDocumentos() : "");
        else if (!ed) html = barraEd + abas + `<div style="font-size:0.85rem;color:#64748b;padding:14px">Clique em <b>Editar premissas</b> para alterar esta aba.</div>` + this.htmlAbaSoLeitura();
        else {
          const r = this.resultados(this.aberto.doc);
          const fr = r.fases && r.fases[a.fase] ? r.fases[a.fase].r.indicators : null;
          const k = (t, v) => `<div class="ov-card"><div class="r">${t}</div><div class="v">${v}</div></div>`;
          const topo = fr ? `<div class="ov-cards">${k("VGV líquido", "R$ " + this.R0(fr.vgv_total))}${k("Lucro líquido", "R$ " + this.R0(fr.lucro_liquido))}${k("Margem", this.P(fr.margem_perc))}${k("TIR a.a.", this.P(fr.tir_aa))}${k("VPL", "R$ " + this.R0(fr.vpl))}${k("Exposição máx.", "R$ " + this.R0(fr.exposicao_maxima))}${k("Payback", fr.payback ? "mês " + fr.payback : "—")}</div>` : (r.erro ? `<div class="ov-neg">Erro no cálculo: ${this.esc(r.erro)}</div>` : "");
          const fases = this.ed.fases.length > 1 ? `<div style="margin-bottom:8px"><label class="ml-emp-filter-label">Fase</label><select class="idx-select" style="height:36px" onchange="OrionViabilidadesApp.setFase(this.value)">${this.ed.fases.map((x, i) => `<option value="${i}" ${i === a.fase ? "selected" : ""}>${this.esc(x.nome)}</option>`).join("")}</select></div>` : "";
          const corpo = { geral: () => this.htmlAbaGeral(), receitas: () => this.htmlAbaReceitas(), obras: () => this.htmlAbaObras(), despesas: () => this.htmlAbaDespesas(), impostos: () => this.htmlAbaImpostos(), permuta: () => this.htmlAbaPermuta(), funding: () => this.htmlAbaFunding(), fisico: () => this.htmlAbaFisico(), datas: () => this.htmlAbaDatas() }[a.aba]();
          html = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><div style="font-size:1rem;font-weight:700">${this.esc(this.ed.doc.project_name)}</div><span style="font-size:0.75rem;color:#64748b">${this.esc(this.ed.doc.status)}</span></div>` + barraEd + abas + topo + fases + corpo;
        }
      } finally {
        this.aberto.doc = original;
      }
      return html;
    },

    /** Sem edição, as abas mostram os valores (só leitura) para consulta rápida. */
    htmlAbaSoLeitura() {
      const f = this.fasesDe(this.aberto.doc)[this.aberto.fase] || {};
      const mapa = { geral: this.aberto.doc, receitas: f.revenue, obras: f.construction, despesas: f.expenses, impostos: f.taxes, permuta: f.exchanges, funding: f.funding, fisico: f.physical_data, datas: f.dates };
      const o = mapa[this.aberto.aba] || {};
      const linhas = Object.keys(o || {}).filter((k) => !/^(fases_json|fases|_id|parecer_original_ia|historico_status)$/.test(k)).map((k) => {
        let v = o[k];
        if (v && typeof v === "object") v = Array.isArray(v) ? `${v.length} item(ns)` : (v.meses ? `curva com ${v.meses.length} meses` : JSON.stringify(v).slice(0, 120));
        return `<tr><td>${this.esc(k)}</td><td>${this.esc(v)}</td></tr>`;
      }).join("");
      return `<div class="cc-scroll"><table class="cc-table"><colgroup><col style="width:260px"><col></colgroup><thead><tr><th>Campo</th><th>Valor</th></tr></thead><tbody>${linhas || '<tr><td colspan="2">Sem dados.</td></tr>'}</tbody></table></div>`;
    }
  });

  /* Botão "Nova viabilidade" na lista: entra no render da lista. */
  const listaOriginal = A.htmlLista.bind(A);
  A.htmlLista = function () {
    const botao = this.podeEditar() ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button type="button" class="btn btn-primary" style="height:40px" onclick="OrionViabilidadesApp.novaViabilidade()">Nova viabilidade</button></div>` : "";
    return botao + listaOriginal();
  };
  const fecharOriginal = A.fechar.bind(A);
  A.fechar = function () {
    if (this.ed && this.ed.seq && !window.confirm("Sair sem salvar as alterações desta viabilidade?")) return;
    this.ed = null;
    fecharOriginal();
  };
})();
