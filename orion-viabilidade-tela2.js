/* Órion (transição) › Viabilidades — continuação de orion-viabilidade-tela.js (tela igual à do ML Órion).
 * Abas Obras, Despesas, Curvas, Impostos, Funding, Documentos, Parecer Executivo, Resumo e Comparativo, e a montagem da tela. */
(function () {
  const A = window.OrionViabilidadesApp;
  if (!A || !A.TELA_ORION) return;
  const { ABAS, NUM, clone, jsonDe, BRL, vgvDe, semAcento } = A.TELA_ORION;

  Object.assign(A, {
    /* ---------- peças comuns de Obras e Despesas ---------- */
    valorDe(v, tipo, vgv) { const n = Number(v) || 0; return tipo === "%" ? vgv * (n / 100) : n; },
    equivale(v, tipo, vgv) {
      return tipo === "%" ? `Equivale a ${BRL(this.valorDe(v, "%", vgv))} do VGV`
        : `Equivale a ${vgv > 0 ? ((Number(v) || 0) / vgv * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"}% do VGV`;
    },
    numBr(v) { return v == null || isNaN(v) ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); },
    /** Índice de correção ligado ao projeto (INCC das obras ou IPCA de projetos, aquisição, administração e despesas). */
    htmlIndexador(ativo, tipoInd, campoValor, campoTipo) {
      if (!ativo) return "";
      const d = this.aberto.doc, ro = this.leitura(), e = (s) => this.esc(s), ap = this.apoio || {};
      const inds = (ap.indices || []).map((x, i) => Object.assign({ _id: this.indiceId(x, i) }, x)).filter((x) => x.index_type === tipoInd);
      const real = (ap.real || {})[tipoInd === "IPCA" ? "ipca" : "incc"];
      const rv = real ? real.mensal : null;
      const rotReal = `${tipoInd === "IPCA" ? "IPCA" : "INCC-M"} Real BCB (${rv != null ? rv.toFixed(2).replace(".", ",") + "% a.m." : "..."}) — ${real ? e(real.data) : ""}`;
      const v = d[campoValor], t = d[campoTipo];
      const selReal = rv != null && v === rv && t === "% a.m.";
      const achado = inds.find((x) => x.valor === v && x.tipo_unidade === t);
      const sel = selReal ? "__real__" : achado ? String(achado._id) : v == null ? "" : "custom";
      return `<div style="display:flex;align-items:center;gap:6px;margin-right:6px">
        <select class="ovt-in sm" style="width:auto;max-width:230px;height:28px;font-size:0.72rem" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.indexadorSel('${tipoInd}','${campoValor}','${campoTipo}',this.value)">
          <option value="" disabled ${sel === "" ? "selected" : ""}>${!inds.length && !real ? "Nenhum cenário..." : "Selecione um cenário..."}</option>
          ${rv != null ? `<option value="__real__" ${sel === "__real__" ? "selected" : ""}>🟢 ${rotReal}</option>` : ""}
          ${inds.length ? `<option disabled>── Cenários Manuais ──</option>` : ""}
          ${inds.map((x) => `<option value="${e(x._id)}" ${sel === String(x._id) ? "selected" : ""}>${e(x.nome)} (${String(x.valor).replace(".", ",")}${e(x.tipo_unidade)})</option>`).join("")}
          <option value="custom" ${sel === "custom" ? "selected" : ""}>Valor Personalizado</option></select>
        <input class="ovt-in sm" style="width:64px;height:28px;font-size:0.72rem" value="${e(this.numBr(v))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.gravarCapa({ '${campoValor}': OrionViabilidadesApp.TELA_ORION.NUM(this.value) })">
        <select class="ovt-in sm" style="width:auto;height:28px;font-size:0.72rem" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.gravarCapa({ '${campoTipo}': this.value })"><option ${(t || "% a.a.") === "% a.a." ? "selected" : ""}>% a.a.</option><option ${t === "% a.m." ? "selected" : ""}>% a.m.</option></select></div>`;
    },
    indexadorSel(tipoInd, cv, ct, val) {
      const ap = this.apoio || {};
      if (val === "__real__") { const real = (ap.real || {})[tipoInd === "IPCA" ? "ipca" : "incc"]; if (real) this.gravarCapa({ [cv]: real.mensal, [ct]: "% a.m." }); return; }
      if (val === "custom" || val === "") return;
      const inds = (ap.indices || []);
      const i = inds.findIndex((x, k) => String(this.indiceId(x, k)) === String(val));
      if (i >= 0) this.gravarCapa({ [cv]: inds[i].valor, [ct]: inds[i].tipo_unidade });
    },
    htmlSwitchCapa(campo, rot) {
      const on = !!this.aberto.doc[campo], ro = this.leitura();
      return `<label style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#4a6355;cursor:pointer"><button type="button" class="ovt-sw ${on ? "on" : ""}" style="width:36px;height:20px" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.gravarCapa({ '${campo}': ${!on} })"></button><span>${rot}</span></label>`;
    },
    htmlLinhaCusto(parte, campoV, campoT, rot, padraoT, vgv, indexador) {
      const x = this.r(parte), ro = this.leitura(), e = (s) => this.esc(s);
      const t = x[campoT] || padraoT;
      return `<div style="padding:16px 0;border-bottom:1px solid #eef4f0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap"><label style="font-size:0.85rem;font-weight:600;color:#1c2e24">${rot}</label><div style="display:flex;align-items:center">${indexador || ""}</div></div>
        <div style="display:flex;gap:8px"><select class="ovt-in" style="width:50%" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('${parte}','${campoT}',this.value)"><option ${t === "R$" ? "selected" : ""}>R$</option><option ${t === "%" ? "selected" : ""}>%</option></select>
          <input class="ovt-in" style="width:50%;font-family:ui-monospace,monospace" data-k="${parte}.${campoV}" value="${e(this.numBr(x[campoV]))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('${parte}','${campoV}',this.value,'num')"></div>
        <p style="font-size:0.75rem;color:#6b8474;margin:6px 0 0">${this.equivale(x[campoV], t, vgv)}</p></div>`;
    },
    htmlExtrasOrion(parte, campo, vgv, comCorrecao, rotNovo) {
      const x = this.r(parte), ro = this.leitura(), e = (s) => this.esc(s);
      const l = Array.isArray(x[campo]) ? x[campo] : (jsonDe(x[campo], []) || []);
      return l.map((it, i) => `<div style="position:relative;padding:16px;margin:12px 0;border:1px dashed #cbd5e1;border-radius:8px;background:#f4f7f5">
          ${ro ? "" : `<button type="button" style="position:absolute;top:6px;right:8px;border:none;background:none;color:#ef4444;font-size:1.1rem;cursor:pointer" onclick="OrionViabilidadesApp.extraAcao('${parte}','${campo}','menos',${i})">×</button>`}
          <div style="display:flex;gap:8px;margin-bottom:8px;padding-right:20px"><input class="ovt-in sm" style="flex:1" placeholder="${rotNovo}" data-k="${campo}.${i}.n" value="${e(it.nome || it.descricao || "")}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.extraAcao('${parte}','${campo}','set',${i},'nome',this.value)">
            ${comCorrecao ? `<select class="ovt-in sm" style="width:130px" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.extraAcao('${parte}','${campo}','set',${i},'correcao',this.value)">${[["Nenhum", "Sem correção"], ["INCC", "INCC"], ["IPCA", "IPCA"]].map(([v, t]) => `<option value="${v}" ${(it.correcao || "Nenhum") === v ? "selected" : ""}>${t}</option>`).join("")}</select>` : ""}</div>
          <div style="display:flex;gap:8px"><select class="ovt-in" style="width:50%" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.extraAcao('${parte}','${campo}','set',${i},'tipo',this.value)"><option ${(it.tipo || "R$") === "R$" ? "selected" : ""}>R$</option><option ${it.tipo === "%" ? "selected" : ""}>%</option></select>
            <input class="ovt-in" style="width:50%;font-family:ui-monospace,monospace" data-k="${campo}.${i}.v" value="${e(this.numBr(it.valor))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.extraAcao('${parte}','${campo}','set',${i},'valor',this.value,'num')"></div>
          ${comCorrecao || it.tipo === "%" ? `<p style="font-size:0.75rem;color:#6b8474;margin:6px 0 0">${this.equivale(it.valor, it.tipo || "R$", vgv)}</p>` : ""}</div>`).join("")
        + (ro ? "" : `<button type="button" class="ovt-btn out" style="width:100%;border-style:dashed;color:#105436;border-color:#105436;margin-top:8px" onclick="OrionViabilidadesApp.extraAcao('${parte}','${campo}','mais')">+ ${comCorrecao ? "Adicionar Custo Extra" : "Adicionar Despesa Extra"}</button>`);
    },
    extraAcao(parte, campo, acao, i, k, v, tipo) {
      const x = this.r(parte);
      const l = (Array.isArray(x[campo]) ? x[campo] : (jsonDe(x[campo], []) || [])).slice();
      if (acao === "mais") l.push({ nome: "", valor: 0, tipo: "R$", curva_json: null });
      else if (acao === "menos") l.splice(i, 1);
      else if (l[i]) l[i] = Object.assign({}, l[i], { [k]: tipo === "num" ? NUM(v) : v });
      x[campo] = l;
      this.rr();
    },
    htmlSeletorCurva(parte, campo, rot, filtro, idxExtra) {
      const x = this.r(parte), ro = this.leitura(), e = (s) => this.esc(s);
      const j = idxExtra == null ? x[campo] : ((x[campo] || [])[idxExtra] || {}).curva_json;
      const tem = j && Array.isArray(j.meses) && j.meses.length > 0;
      const curvas = ((this.apoio || {}).curvas || []).filter((c) => { if (!filtro || filtro === "all") return true; const t1 = semAcento(c.tipo), t2 = semAcento(filtro); if (!t1 || !t2) return false; return t1.indexOf(t2) >= 0 || t2.indexOf(t1) >= 0; });
      const atual = j && j.curve_id != null ? String(j.curve_id) : "";
      const conhecida = curvas.some((c) => String(this.curvaId(c)) === atual);
      return `<div style="border:1px solid #cfe0d6;border-radius:8px;padding:12px 14px;margin-bottom:12px;background:#fff">
        <p style="font-size:0.85rem;font-weight:600;color:#1c2e24;margin:0 0 8px">${e(rot)}</p>
        <select class="ovt-in" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.aplicarCurvaPadrao('${parte}','${campo}',this.value,${idxExtra == null ? "null" : idxExtra})"><option value="">${idxExtra == null ? "Aplicar curva padrão..." : "Aplicar curva..."}</option>
          ${!conhecida && atual ? `<option value="${e(atual)}" selected>${e(j.curve_name || "Curva aplicada")}</option>` : ""}
          ${curvas.map((c) => `<option value="${e(this.curvaId(c))}" ${atual === String(this.curvaId(c)) ? "selected" : ""}>${e(c.nome)}</option>`).join("")}</select>
        ${tem ? `<div style="font-size:0.75rem;color:#1b8253;font-weight:500;margin-top:6px">∿ Curva Aplicada (${j.meses.length} meses)</div>` : `<div style="font-size:0.75rem;color:#9bb0a3;margin-top:6px">Nenhuma curva</div>`}</div>`;
    },
    aplicarCurvaPadrao(parte, campo, id, idxExtra) {
      if (!id) return;
      const c = ((this.apoio || {}).curvas || []).find((y) => String(this.curvaId(y)) === String(id));
      if (!c) return;
      const j = { meses: (c.meses || []).slice(), curve_id: this.curvaId(c), curve_name: c.nome, mes_inicio: 1 };
      const x = this.r(parte);
      if (idxExtra == null) x[campo] = j;
      else { const l = (x[campo] || []).slice(); l[idxExtra] = Object.assign({}, l[idxExtra], { curva_json: j }); x[campo] = l; }
      this.render();
    },
    totalLinha(rot, v, forte) { return `<div style="display:flex;justify-content:space-between;font-size:${forte ? "1rem;font-weight:700;color:#1c2e24;border-top:1px solid #dfe9e3;padding-top:10px;margin-top:6px" : "0.85rem;color:#4a6355;margin-bottom:4px"}"><span>${this.esc(rot)}</span><span style="${forte ? "color:#105436" : ""}">${BRL(v)}</span></div>`; },
    cabAba(titulo, sub, parte, botao) {
      const ro = this.leitura();
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap"><div><h2 class="ovt-h2">${titulo}</h2><p class="ovt-sub">${sub}</p></div>
        <div style="display:flex;align-items:center;gap:12px">${this.ov.msg[parte] ? `<span class="ovt-msg">${this.ov.msg[parte]}</span>` : ""}<button type="button" class="ovt-btn prim big" ${ro || this.ov.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarSimples(['${parte}'],'${parte}','${botao[1]}')">💾 ${this.ov.salvando === parte ? "Salvando..." : botao[0]}</button></div></div>`;
    },
    vgvFase() { return vgvDe(this.faseAtual().physical_data || {}) || Number((this.faseAtual().revenue || {}).vgv_total) || 0; },

    /* ---------- aba Obras ---------- */
    htmlObras() {
      const c = this.r("construction"), d = this.aberto.doc, vgv = this.vgvFase();
      const ext = Array.isArray(c.extra_constructions_json) ? c.extra_constructions_json : [];
      const vO = this.valorDe(c.custo_obras, c.custo_obras_tipo || "R$", vgv), vP = this.valorDe(c.custo_projetos, c.custo_projetos_tipo || "%", vgv), vA = this.valorDe(c.aquisicao_area, c.aquisicao_area_tipo || "R$", vgv), vD = this.valorDe(c.adm_obras, c.adm_obras_tipo || "%", vgv);
      const vE = ext.reduce((s, x) => s + this.valorDe(x.valor, x.tipo || "R$", vgv), 0);
      const ind = (flag, tipo, cv, ct, rot) => this.htmlIndexador(!!d[flag], tipo, cv, ct) + this.htmlSwitchCapa(flag, rot);
      return `<div class="ovt-pad">${this.cabAba("Despesas e Cronograma de Obras", "Defina o custo da construção e as curvas de avanço por linha.", "construction", ["Salvar Obra", "Dados de Obra salvos com sucesso!"])}
        <div class="ovt-g ovt-g2" style="gap:32px;align-items:start">
          <div><h3 class="ovt-h3" style="border-bottom:2px solid #105436">Custos Diretos (COSTS)</h3>
            ${this.htmlLinhaCusto("construction", "custo_obras", "custo_obras_tipo", "Obras de Infraestrutura", "R$", vgv, ind("aplicar_incc_obras", "INCC", "incc_projetado_valor", "incc_projetado_tipo", "INCC"))}
            ${this.htmlLinhaCusto("construction", "custo_projetos", "custo_projetos_tipo", "Projetos", "%", vgv, ind("aplicar_ipca_projetos", "IPCA", "ipca_projetado_valor", "ipca_projetado_tipo", "IPCA"))}
            ${this.htmlLinhaCusto("construction", "aquisicao_area", "aquisicao_area_tipo", "Aquisição de Área", "R$", vgv, ind("aplicar_ipca_aquisicao", "IPCA", "ipca_projetado_valor", "ipca_projetado_tipo", "IPCA"))}
            ${this.htmlLinhaCusto("construction", "adm_obras", "adm_obras_tipo", "Administração de Obras", "%", vgv, ind("aplicar_ipca_adm", "IPCA", "ipca_projetado_valor", "ipca_projetado_tipo", "IPCA"))}
            ${this.htmlExtrasOrion("construction", "extra_constructions_json", vgv, true, "Nome do custo extra...")}
            <div style="margin-top:20px;padding-top:12px;border-top:2px solid #105436">${this.totalLinha("Obras de Infraestrutura:", vO)}${this.totalLinha("Projetos:", vP)}${this.totalLinha("Aquisição de Área:", vA)}${this.totalLinha("Administração de Obras:", vD)}${ext.map((x, i) => this.totalLinha((x.nome || `Custo Extra ${i + 1}`) + ":", this.valorDe(x.valor, x.tipo || "R$", vgv))).join("")}${this.totalLinha("Total COSTS:", vO + vP + vA + vD + vE, 1)}</div></div>
          <div><h3 class="ovt-h3" style="border-bottom:2px solid #105436">Desembolso Financeiro / Curva</h3>
            <div style="background:#f4f7f5;border:1px solid #dfe9e3;border-radius:8px;padding:16px"><p style="font-size:0.75rem;color:#4a6355;margin:0 0 12px">Selecione a curva padrão que ditará a velocidade de desembolso de cada linha. O percentual será copiado para esta viabilidade, congelando o histórico.</p>
              ${this.htmlSeletorCurva("construction", "curva_obras_json", "Obras de Infraestrutura", "obras de infraestrutura")}${this.htmlSeletorCurva("construction", "curva_projetos_json", "Projetos", "projetos")}${this.htmlSeletorCurva("construction", "curva_aquisicao_json", "Aquisição de Área", "aquisicao de area")}${this.htmlSeletorCurva("construction", "curva_adm_obras_json", "Administração de Obras", "administracao de obras")}
              ${ext.map((x, i) => this.htmlSeletorCurva("construction", "extra_constructions_json", x.nome || `Custo Extra ${i + 1}`, "all", i)).join("")}</div></div></div></div>`;
    },

    /* ---------- aba Despesas ---------- */
    htmlDespesas() {
      const x = this.r("expenses"), d = this.aberto.doc, vgv = this.vgvFase(), ro = this.leitura(), e = (s) => this.esc(s);
      const ext = Array.isArray(x.extra_expenses_json) ? x.extra_expenses_json : [];
      const vM = this.valorDe(x.marketing_valor, x.marketing_tipo || "%", vgv), vC = this.valorDe(x.comercial_valor, x.comercial_tipo || "%", vgv), vA = this.valorDe(x.adm_valor, x.adm_tipo || "%", vgv), vK = vgv * ((Number(x.comissao_corretagem_valor) || 0) / 100);
      const vE = ext.reduce((s, y) => s + this.valorDe(y.valor, y.tipo || "R$", vgv), 0);
      return `<div class="ovt-pad">${this.cabAba("Despesas Comerciais e Administrativas", "Defina as verbas de Marketing, Vendas e Administração.", "expenses", ["Salvar Despesas", "Despesas salvas com sucesso!"])}
        <div class="ovt-g ovt-g2" style="gap:32px;align-items:start">
          <div><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #105436;padding-bottom:8px;margin-bottom:6px;gap:8px;flex-wrap:wrap"><h3 class="ovt-h3" style="border:none;padding:0;margin:0">Verbas / Orçamento (EXPENSES)</h3><div style="display:flex;align-items:center">${this.htmlIndexador(!!d.aplicar_ipca_despesas, "IPCA", "ipca_projetado_valor", "ipca_projetado_tipo")}${this.htmlSwitchCapa("aplicar_ipca_despesas", "IPCA")}</div></div>
            ${this.htmlLinhaCusto("expenses", "marketing_valor", "marketing_tipo", "Marketing", "%", vgv)}${this.htmlLinhaCusto("expenses", "comercial_valor", "comercial_tipo", "Comercial", "%", vgv)}${this.htmlLinhaCusto("expenses", "adm_valor", "adm_tipo", "Despesas Administrativas", "%", vgv)}
            <div style="padding:16px 0;border-bottom:1px solid #eef4f0"><h4 style="font-size:0.8rem;font-weight:700;color:#1c2e24;text-transform:uppercase;margin:0 0 8px">Comissões</h4><label style="font-size:0.85rem;font-weight:600;color:#1c2e24;display:block;margin-bottom:6px">Comissão de Venda (Corretagem)</label>
              <div style="display:flex;gap:8px;align-items:center"><span style="width:50%;height:40px;display:flex;align-items:center;padding:0 12px;border:1px solid #cbd5e1;border-radius:6px;background:#f4f7f5;font-size:0.85rem;box-sizing:border-box">%</span><input class="ovt-in" style="width:50%;font-family:ui-monospace,monospace" data-k="ex.cc" value="${e(this.numBr(x.comissao_corretagem_valor))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('expenses','comissao_corretagem_valor',this.value,'num')"></div>
              <p style="font-size:0.75rem;color:#6b8474;margin:6px 0 0">Equivale a ${BRL(vK)} do VGV</p><p style="font-size:0.72rem;color:#2563eb;background:#eff6ff;border-radius:4px;padding:6px 8px;margin:8px 0 0">A curva de desembolso das Comissões acompanha automaticamente a Velocidade de Vendas.</p></div>
            ${this.htmlExtrasOrion("expenses", "extra_expenses_json", vgv, false, "Nome da despesa extra...")}
            <div style="margin-top:20px;padding-top:12px;border-top:2px solid #105436">${this.totalLinha("Marketing:", vM)}${this.totalLinha("Comercial:", vC)}${this.totalLinha("Comissões:", vK)}${this.totalLinha("Despesas Administrativas:", vA)}${ext.map((y, i) => this.totalLinha((y.nome || `Despesa Extra ${i + 1}`) + ":", this.valorDe(y.valor, y.tipo || "R$", vgv))).join("")}${this.totalLinha("Total EXPENSES:", vM + vC + vA + vK + vE, 1)}</div></div>
          <div><h3 class="ovt-h3" style="border-bottom:2px solid #105436">Desembolso Financeiro / Curva</h3>
            <div style="background:#f4f7f5;border:1px solid #dfe9e3;border-radius:8px;padding:16px"><p style="font-size:0.75rem;color:#4a6355;margin:0 0 12px">Selecione a curva padrão que ditará a velocidade de desembolso de cada despesa.</p>
              ${this.htmlSeletorCurva("expenses", "curva_marketing_json", "Marketing", "marketing")}${this.htmlSeletorCurva("expenses", "curva_comercial_json", "Comercial", "comercial")}${this.htmlSeletorCurva("expenses", "curva_adm_json", "Administração", "administração de despesas")}
              ${ext.map((y, i) => this.htmlSeletorCurva("expenses", "extra_expenses_json", y.nome || `Despesa Extra ${i + 1}`, "all", i)).join("")}</div></div></div></div>`;
    },

    /* ---------- aba Curvas (deslocamento pelo mês de início; grava sozinha, como no Órion) ---------- */
    CURVAS_ESPERADAS: [
      ["curva_obras_json", "Obras de Infraestrutura", "#f37021", "construction"], ["curva_projetos_json", "Projetos", "#FF5144", "construction"],
      ["curva_aquisicao_json", "Aquisição de Área", "#91A89C", "construction"], ["curva_adm_obras_json", "Administração de Obras", "#FFABA4", "construction"],
      ["velocidade_vendas_json", "Velocidade de Vendas", "#105436", "revenue"], ["curva_marketing_json", "Marketing", "#F9C094", "expenses"],
      ["curva_comercial_json", "Comercial/Vendas", "#1b8253", "expenses"], ["curva_adm_json", "Despesas Administrativas", "#94BD9B", "expenses"]
    ],
    DATA_DA_CURVA: { curva_obras_json: "data_inicio_obras", curva_projetos_json: "data_inicio_projetos", curva_aquisicao_json: "data_inicio_aquisicao", velocidade_vendas_json: "data_lancamento", curva_marketing_json: "data_inicio_mkt", curva_comercial_json: "data_inicio_comercial" },
    prepararCurvas() {
      const k = this.chaveR("curvas");
      if (this.ov.curvas && this.ov.curvas.k === k) return this.ov.curvas;
      const f = this.faseAtual(), dt = f.dates || {};
      const partes = {};
      ["construction", "expenses", "revenue"].forEach((p) => { const o = clone(f[p] || {}) || {}; Object.keys(o).forEach((c) => { if (/_json$/.test(c) && typeof o[c] === "string") o[c] = jsonDe(o[c], null); }); partes[p] = o; });
      const orig = JSON.stringify(partes);
      let base = null;
      ["data_registro", "data_lancamento", "data_inicio_obras", "data_inicio_projetos", "data_inicio_aquisicao", "data_inicio_comercial", "data_inicio_mkt"].forEach((c) => { if (dt[c]) { const x = new Date(String(dt[c]).slice(0, 10) + "T12:00:00"); if (!isNaN(x) && (!base || x < base)) base = x; } });
      const desloc = (s) => { if (!base || !s) return 1; const t = new Date(String(s).slice(0, 10) + "T12:00:00"); return Math.max(1, (t.getFullYear() - base.getFullYear()) * 12 + (t.getMonth() - base.getMonth()) + 1); };
      this.CURVAS_ESPERADAS.forEach(([campo, , , p]) => { const dc = this.DATA_DA_CURVA[campo]; if (dc && dt[dc] && partes[p][campo]) partes[p][campo].mes_inicio = desloc(dt[dc]); });
      this.ov.curvas = { k, partes, orig, base, dt };
      if (JSON.stringify(partes) !== orig && !this.leitura()) this.agendarCurvas();
      return this.ov.curvas;
    },
    mesInicio(campo, p, v) { const cv = this.prepararCurvas(); if (!cv.partes[p][campo]) return; cv.partes[p][campo].mes_inicio = Math.max(1, Math.trunc(NUM(v)) || 1); this.agendarCurvas(); this.rr(); },
    agendarCurvas() { clearTimeout(this._tCurvas); this._tCurvas = setTimeout(() => this.salvarCurvas(), 1500); },
    async salvarCurvas() {
      const cv = this.ov && this.ov.curvas;
      if (!cv || this.leitura() || JSON.stringify(cv.partes) === cv.orig) return;
      const fi = this.aberto.fase, partes = clone(cv.partes);
      this.ov.salvandoCurvas = true;
      this.render();
      try {
        await this.gravarDoc((fases) => { const f = fases[fi]; if (!f) throw new Error("Fase não encontrada."); ["construction", "expenses", "revenue"].forEach((p) => { if (f[p] || Object.keys(partes[p]).length) f[p] = Object.assign({}, f[p] || {}, partes[p]); }); return null; });
        cv.orig = JSON.stringify(cv.partes);
        ["construction", "expenses", "revenue"].forEach((p) => delete this.ov.rasc[this.chaveR(p)]);
        this.ov.salvandoCurvas = false;
        this.msg("curvas", "Deslocamentos salvos com sucesso!");
      } catch (e) { this.ov.salvandoCurvas = false; window.alert("Erro ao salvar dados das curvas. " + (e.message || "")); this.render(); }
    },
    htmlCurvas() {
      const cv = this.prepararCurvas(), ro = this.leitura(), e = (s) => this.esc(s);
      const vgv = Number((cv.partes.revenue || {}).vgv_total) || this.vgvFase(), c = cv.partes.construction || {}, x = cv.partes.expenses || {};
      const total = (campo) => ({ velocidade_vendas_json: vgv, curva_obras_json: this.valorDe(c.custo_obras, c.custo_obras_tipo === "%" ? "%" : "R$", vgv), curva_projetos_json: this.valorDe(c.custo_projetos, c.custo_projetos_tipo === "%" ? "%" : "R$", vgv), curva_aquisicao_json: this.valorDe(c.aquisicao_area, c.aquisicao_area_tipo === "%" ? "%" : "R$", vgv), curva_adm_obras_json: this.valorDe(c.adm_obras, c.adm_obras_tipo === "%" ? "%" : "R$", vgv), curva_marketing_json: this.valorDe(x.marketing_valor, x.marketing_tipo === "%" ? "%" : "R$", vgv), curva_comercial_json: this.valorDe(x.comercial_valor, x.comercial_tipo === "%" ? "%" : "R$", vgv), curva_adm_json: this.valorDe(x.adm_valor, x.adm_tipo === "%" ? "%" : "R$", vgv) }[campo] || 0);
      const rotMes = (i) => { if (!cv.base) return `M${i + 1}`; const d = new Date(cv.base.getFullYear(), cv.base.getMonth() + i, 1); const m = d.toLocaleString("pt-BR", { month: "short" }).replace(".", "").slice(0, 3); return m.charAt(0).toUpperCase() + m.slice(1) + " " + String(d.getFullYear()).slice(2); };
      const aplicadas = this.CURVAS_ESPERADAS.filter(([campo, , , p]) => cv.partes[p] && cv.partes[p][campo] && cv.partes[p][campo].curve_id != null && cv.partes[p][campo].curve_id !== "");
      const grafico = (j, tot, cor) => {
        const off = Math.max(0, (j.mes_inicio || 1) - 1), ms = j.meses || [];
        if (!ms.length) return `<div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9bb0a3;font-size:0.85rem">📈 Sem dados para exibir.</div>`;
        const pts = []; for (let i = 0; i < off; i++) pts.push({ i, p: 0, v: 0 }); ms.forEach((m, k) => { const p = Number(m) || 0; pts.push({ i: off + k, p, v: (p / 100) * tot }); });
        const W = 640, H = 200, L = 64, B = 22, T = 10, mx = Math.max(...pts.map((q) => q.v), 1), bw = (W - L) / pts.length;
        const fmtY = (v) => (v >= 1e6 ? `R$ ${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `R$ ${(v / 1e3).toFixed(0)}k` : `R$ ${Math.round(v)}`);
        const passo = Math.max(1, Math.ceil(pts.length / 10));
        return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" style="font-family:inherit">
          ${[0, 0.25, 0.5, 0.75, 1].map((t) => { const y = T + (H - B - T) * (1 - t); return `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="#dfe9e3" stroke-dasharray="3 3"/><text x="${L - 4}" y="${y + 3}" font-size="10" text-anchor="end" fill="#6b8474">${fmtY(mx * t)}</text>`; }).join("")}
          ${pts.map((q, k) => { const h = (q.v / mx) * (H - B - T); return `<rect x="${L + k * bw + 0.5}" y="${H - B - h}" width="${Math.max(1, bw - 1)}" height="${h}" fill="${cor}" rx="2"><title>M${q.i + 1} (${rotMes(q.i)}): ${BRL(q.v)} (${q.p.toFixed(2)}%)</title></rect>${k % passo === 0 ? `<text x="${L + k * bw + bw / 2}" y="${H - 6}" font-size="9" text-anchor="middle" fill="#6b8474">${rotMes(q.i)}</text>` : ""}`; }).join("")}</svg>`;
      };
      return `<div class="ovt-pad"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;gap:16px"><div><h2 class="ovt-h2">Deslocamento de Curvas</h2><p class="ovt-sub">Abaixo estão as curvas que você <b>já selecionou</b> nas abas anteriores.<br>Use o campo <b>Mês de Início</b> para deslocar a curva no cronograma da viabilidade.</p></div>
          <div>${this.ov.salvandoCurvas ? `<span style="font-size:0.85rem;color:#6b8474">Salvando...</span>` : this.ov.msg.curvas ? `<span class="ovt-msg">💾 ${this.ov.msg.curvas}</span>` : ""}</div></div>
        ${!aplicadas.length ? `<div style="text-align:center;padding:48px;border:2px dashed #dfe9e3;border-radius:12px;color:#6b8474"><p style="font-weight:600">Nenhuma curva aplicada ainda.</p><p style="font-size:0.85rem">Vá até as abas de <b>Obras</b>, <b>Despesas</b> ou <b>Receitas</b> e selecione uma curva padrão nos respectivos campos. Elas aparecerão aqui automaticamente.</p></div>`
          : `<div style="display:flex;flex-direction:column;gap:24px">${aplicadas.map(([campo, rot, cor, p]) => { const j = cv.partes[p][campo], tot = total(campo), lig = this.DATA_DA_CURVA[campo] && cv.dt[this.DATA_DA_CURVA[campo]]; return `<div style="border:1px solid #dfe9e3;border-radius:12px;overflow:hidden;background:#fff">
              <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #eef4f0"><div style="width:4px;height:24px;border-radius:4px;background:${cor}"></div><h3 style="font-weight:700;color:#1c2e24;margin:0;font-size:0.95rem">${e(rot)}</h3>${(j.mes_inicio || 1) > 1 ? `<span style="font-size:0.75rem;background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:999px">Início M${j.mes_inicio}</span>` : ""}${tot > 0 ? `<span style="font-size:0.75rem;background:#eef4f0;color:#1c2e24;padding:2px 8px;border-radius:999px;margin-left:auto">Total: ${(tot).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</span>` : ""}</div>
              <div style="display:grid;grid-template-columns:220px 1fr;gap:16px;padding:16px">
                <div style="display:flex;flex-direction:column;gap:12px"><div><label class="ovt-lbl xs" style="color:#6b8474">Curva Padrão Aplicada</label><div style="font-size:0.85rem;font-weight:600;color:#1c2e24;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e(j.curve_name || "")}">${e(j.curve_name || "Curva Desconhecida")}</div></div>
                  <div><label class="ovt-lbl xs" style="color:#6b8474">📅 Mês Início</label><input class="ovt-in" style="width:96px" data-k="cv.${campo}" value="${j.mes_inicio || 1}" ${ro || lig ? "disabled" : ""} title="${lig ? "Calculado automaticamente a partir da aba Datas." : ""}" onchange="OrionViabilidadesApp.mesInicio('${campo}','${p}',this.value)">${lig ? `<span style="display:block;font-size:0.7rem;color:#2563eb;margin-top:4px">Definido pela aba de Datas</span>` : ""}</div></div>
                <div style="height:200px">${grafico(j, tot, cor)}</div></div></div>`; }).join("")}</div>`}</div>`;
    },

    /* ---------- aba Impostos ---------- */
    htmlImpostos() {
      const t = this.r("taxes"), ro = this.leitura(), e = (s) => this.esc(s), regs = ((this.apoio || {}).regimes || []).filter((x) => x.ativo !== false);
      const tot = ["aliquota_pis", "aliquota_cofins", "aliquota_irpj", "aliquota_csll", "aliquota_outros"].reduce((s, k) => s + (Number(t[k]) || 0), 0);
      const vgvB = this.vgvFase();
      const res = this.resultados(this.aberto.doc), fr = res.fases && res.fases[this.aberto.fase] ? res.fases[this.aberto.fase].r : null;
      const vgvL = fr && fr.indicators && fr.indicators.vgv_total ? fr.indicators.vgv_total : vgvB;
      let rec = null, imp = null;
      if (fr && fr.monthly_cashflow) { rec = 0; imp = 0; fr.monthly_cashflow.forEach((m) => { rec += m.Receitas || 0; imp += m.Impostos || 0; }); }
      const cmp = (k, rot) => `<div><label class="ovt-lbl xs">${rot}</label><input class="ovt-in" data-k="tx.${k}" value="${e(t[k] === "" || t[k] == null ? "" : String(t[k]).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('taxes','${k}',this.value,'num')"></div>`;
      const lin = (r, v, cor, forte) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;${forte ? "border-top:1px solid #dfe9e3;margin-top:4px;" : ""}"><span style="font-size:0.85rem;color:${cor || "#4a6355"};${forte ? "font-weight:600" : ""}">${r}</span><span style="font-weight:${forte ? 700 : 600};color:${cor || "#1c2e24"}">${v}</span></div>`;
      return `<div class="ovt-pad">${this.cabAba("Impostos", "Defina o regime tributário e as alíquotas aplicáveis ao projeto.", "taxes", ["Salvar Impostos", "Impostos salvos com sucesso!"])}
        <div class="ovt-g ovt-g2" style="gap:32px;align-items:start">
          <div><h3 class="ovt-h3">Premissas Tributárias</h3><div style="display:flex;flex-direction:column;gap:16px">
            <div><label class="ovt-lbl">Regime Tributário (Base do Apoio)</label><select class="ovt-in" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.regimeOrion(this.value)"><option value="">Selecione...</option>${regs.map((x) => `<option ${t.regime_tributario === x.nome ? "selected" : ""}>${e(x.nome)}</option>`).join("")}<option value="Personalizado" ${t.regime_tributario === "Personalizado" ? "selected" : ""}>Personalizado</option><option value="RET" ${t.regime_tributario === "RET" && !regs.some((x) => x.nome === "RET") ? "selected" : ""}>RET (Legado)</option>${t.regime_tributario && t.regime_tributario !== "RET" && t.regime_tributario !== "Personalizado" && !regs.some((x) => x.nome === t.regime_tributario) ? `<option selected>${e(t.regime_tributario)}</option>` : ""}</select></div>
            <div><label class="ovt-lbl">Incidência do Imposto</label><select class="ovt-in" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('taxes','incidencia_sobre',this.value)"><option value="Recebimento" ${t.incidencia_sobre !== "Venda" ? "selected" : ""}>Sobre o Recebimento (Caixa)</option><option value="Venda" ${t.incidencia_sobre === "Venda" ? "selected" : ""}>Sobre a Venda (Competência)</option></select></div>
            <div class="ovt-box"><h4 style="font-size:0.8rem;font-weight:700;color:#1c2e24;margin:0 0 12px">Composição da Alíquota</h4><div class="ovt-g ovt-g2">${cmp("aliquota_pis", "PIS (%)")}${cmp("aliquota_cofins", "COFINS (%)")}${cmp("aliquota_irpj", "IRPJ (%)")}${cmp("aliquota_csll", "CSLL (%)")}${cmp("aliquota_outros", "Outros (%)")}</div></div></div></div>
          <div><h3 class="ovt-h3" style="display:flex;align-items:center;gap:6px">🧮 Totalizador</h3>
            <div style="border:1px solid #dfe9e3;border-radius:10px;padding:20px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.05)">
              <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:1px solid #dfe9e3;margin-bottom:8px"><span style="font-size:0.85rem;font-weight:600;color:#1c2e24">Carga Tributária Total</span><span style="font-size:1.8rem;font-weight:700;color:#105436">${tot.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span></div>
              ${lin("VGV Nominal (Bruto)", BRL(vgvB))}${vgvL < vgvB ? lin("(-) Comissões (Dedução)", "-" + BRL(vgvB - vgvL), "#dc2626") + lin("VGV Nominal (Líquido Base Impostos)", BRL(vgvL), null, 1) : ""}
              ${lin("Impostos (Base Nominal)", BRL((vgvL * tot) / 100), "#105436", 1)}
              ${rec !== null ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #cbd5e1">${lin("Receita Líquida (DRE)", BRL(rec))}${lin("Impostos Projetados (DRE)", BRL(imp), "#b45309")}</div>` : ""}</div></div></div></div>`;
    },
    regimeOrion(nome) {
      const t = this.r("taxes"), x = ((this.apoio || {}).regimes || []).find((r) => r.nome === nome);
      if (x) Object.assign(t, { regime_tributario: x.nome, aliquota_pis: x.pis, aliquota_cofins: x.cofins, aliquota_irpj: x.irpj, aliquota_csll: x.csll, aliquota_outros: x.outros });
      else t.regime_tributario = nome;
      this.render();
    },

    /* ---------- aba Funding ---------- */
    htmlFunding() {
      const f = this.r("funding"), ro = this.leitura(), e = (s) => this.esc(s);
      const tem = f.tipo_funding !== "Nenhum", cri = f.tipo_funding === "CRI";
      const secs = Object.keys(((this.taxas || {}).Securitizadoras) || { "Opea": {}, "Vórtx (Não Guarda-Chuva)": {}, "Vórtx (Guarda-Chuva)": {}, "Oliveira Trust (Guarda-Chuva)": {} });
      const inp = (k, tipo, suf, w) => `<div style="position:relative${w ? ";width:" + w : ""}">${suf ? `<span style="position:absolute;left:12px;top:11px;font-size:0.8rem;color:#6b8474">${suf}</span>` : ""}<input class="ovt-in" style="${suf ? "padding-left:36px" : ""}" data-k="fu.${k}" value="${e(f[k] == null ? "" : String(f[k]).replace(".", ","))}" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('funding','${k}',this.value,'${tipo}')"></div>`;
      const sel = (k, ops) => `<select class="ovt-in" ${ro ? "disabled" : ""} onchange="OrionViabilidadesApp.vs('funding','${k}',this.value)">${ops.map((o) => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${e(v)}" ${String(f[k]) === String(v) ? "selected" : ""}>${e(t)}</option>`; }).join("")}</select>`;
      const tj = Number(f.taxa_juros) || 0;
      const eq = f.taxa_juros_periodicidade === "a.m." ? `${(((1 + tj / 100) ** 12 - 1) * 100).toFixed(2)}% a.a.` : `${(((1 + tj / 100) ** (1 / 12) - 1) * 100).toFixed(2)}% a.m.`;
      const lab = (t) => `<label class="ovt-lbl">${t}</label>`;
      return `<div class="ovt-pad"><div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap"><div><h2 class="ovt-h2">Funding / Plano Empresarial</h2><p class="ovt-sub">Defina as condições de captação e estruturação para viabilizar a obra.</p></div>
          <div style="display:flex;align-items:center;gap:16px"><div style="display:flex;align-items:center;gap:10px;background:#f4f7f5;border:1px solid #dfe9e3;border-radius:8px;padding:8px 12px"><span style="font-size:0.85rem;font-weight:600;color:#1c2e24">Possui Captação/Funding?</span><button type="button" class="ovt-sw ${tem ? "on" : ""}" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.fundingLiga()"></button></div>
            ${this.ov.msg.funding ? `<span class="ovt-msg">${this.ov.msg.funding}</span>` : ""}<button type="button" class="ovt-btn prim big" ${ro || this.ov.salvando ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarSimples(['funding'],'funding','Funding salvo com sucesso!')">💾 ${this.ov.salvando === "funding" ? "Salvando..." : "Salvar Funding"}</button></div></div>
        ${tem ? `<div class="ovt-g ovt-g2" style="gap:32px;align-items:start"><div style="display:flex;flex-direction:column;gap:24px">
            <div><h3 class="ovt-h3">Tipo de Captação</h3><div style="display:flex;flex-direction:column;gap:16px">
              <div>${lab("Modalidade de Funding")}${sel("tipo_funding", ["Plano Empresarial (Banco)", "CRI"])}</div>
              <div>${lab("Modo de Cálculo do Volume")}<div style="display:flex;gap:4px;background:#eef4f0;padding:4px;border-radius:8px">${[["percentual", "% da Obra"], ["fixo", "Valor Fixo"]].map(([v, t]) => `<button type="button" style="flex:1;height:32px;border:none;border-radius:6px;font-size:0.85rem;font-weight:500;cursor:pointer;${f.modo_volume === v ? "background:#fff;color:#1c2e24;box-shadow:0 1px 2px rgba(0,0,0,.1)" : "background:transparent;color:#6b8474"}" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.vs('funding','modo_volume','${v}')">${t}</button>`).join("")}</div></div>
              ${f.modo_volume === "percentual" ? `<div>${lab("Percentual da Obra (%)")}${inp("percentual_obra_financiado", "num", "%")}</div>` : `<div>${lab("Volume (R$)")}${inp("volume_fixo", "num", "R$")}</div>`}
              <div class="ovt-g ovt-g2"><div>${lab("Taxa de Juros")}<div style="display:flex;gap:6px">${inp("taxa_juros", "num", "%", "60%")}<div style="width:40%">${sel("taxa_juros_periodicidade", [["a.a.", "% a.a."], ["a.m.", "% a.m."]])}</div></div></div><div>${lab("Indexador")}${sel("indexador", ["CDI", "TR", "IPCA", ["Nenhum", "Pré-Fixado (Nenhum)"]])}</div></div>
              <div>${lab("Sistema de Amortização")}${sel("sistema_amortizacao_banco", ["SAC", "Price", ["Bullet", "Bullet (Final)"]])}</div></div></div>
            ${cri ? `<div><h3 class="ovt-h3" style="display:flex;justify-content:space-between;align-items:center"><span>Estruturação do ${e(f.tipo_funding)}</span><span style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:500;font-size:0.8rem;color:#4a6355">Diluir custos nas Obras?<button type="button" class="ovt-sw ${f.diluir_custos ? "on" : ""}" ${ro ? "disabled" : ""} onclick="OrionViabilidadesApp.vs('funding','diluir_custos',${!f.diluir_custos},'bool')"></button></span></h3>
              <div class="ovt-g ovt-g2"><div>${lab("Securitizadora")}${sel("securitizadora", secs)}</div><div>${lab("Instrução CVM")}${sel("icvm", ["ICVM 400", "ICVM 476"])}</div><div>${lab("Prazo (Meses)")}${inp("prazo_meses", "int")}</div><div>${lab("Taxa Estruturação Extra (%) ⓘ")}${inp("taxa_estruturacao", "num", "%")}</div><div>${lab("Gross Up Prestador (%)")}${inp("gross_up", "num", "%")}</div></div></div>` : ""}</div>
          <div style="position:relative;background:#0c291d;color:#fff;border-radius:12px;padding:24px;overflow:hidden"><div style="position:absolute;top:0;right:0;width:160px;height:160px;background:rgba(16,84,54,.25);border-radius:999px;filter:blur(40px)"></div>
            <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 20px;position:relative">Simulador de ${e(f.tipo_funding)}</h3>
            ${cri ? `<div style="display:flex;flex-direction:column;gap:12px;position:relative">${[["Taxa CVM", "Auto (Tabela)"], ["Taxa ANBIMA", "Auto (Tabela)"], ["Registro B3", "Auto (Escalonada)"], ["Agente Fiduciário", `Auto (${e(f.securitizadora)})`]].map(([a, b]) => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:8px"><span style="color:#9bb0a3;font-size:0.85rem">${a}</span><span style="font-weight:600;font-size:0.85rem">${b}</span></div>`).join("")}
                <div style="display:flex;gap:8px;background:rgba(255,255,255,.05);padding:12px;border-radius:8px;margin-top:8px"><span>ⓘ</span><p style="font-size:0.75rem;color:#cbd5e1;margin:0">O motor matemático lerá automaticamente as tabelas de taxas cadastradas em <b style="color:#fff">Configurações gerais &gt; Premissas da viabilidade &gt; Taxas de funding</b>. Todos os custos fixos (upfront) e recorrentes (mensais/anuais) entrarão na DRE conforme sua periodicidade.</p></div></div>`
              : `<div style="position:relative"><p style="font-size:0.85rem;color:#cbd5e1">Operação bancária tradicional baseada em juros compostos da taxa de ${e(String(f.taxa_juros).replace(".", ","))}% ${e(f.taxa_juros_periodicidade)} + ${e(f.indexador)}.</p>
                <div style="display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.1);padding-top:12px;margin-top:12px"><span style="color:#9bb0a3;font-size:0.85rem">${f.taxa_juros_periodicidade === "a.m." ? "Taxa Equivalente Anual" : "Taxa Equivalente Mensal"}</span><span style="font-weight:700;color:#4ade80">${eq.replace(".", ",")}</span></div></div>`}</div></div>`
          : `<div style="text-align:center;padding:64px 16px;border:2px dashed #dfe9e3;border-radius:12px;background:#f4f7f5"><div style="font-size:2.5rem">🏦</div><h3 style="font-size:1.1rem;font-weight:700;color:#1c2e24">Operação 100% com Capital Próprio</h3><p style="color:#6b8474;max-width:520px;margin:0 auto">Esta viabilidade não utilizará Funding ou Plano Empresarial. Todo o custo da obra será suportado pelo fluxo de caixa do projeto e/ou capital dos sócios.</p></div>`}</div>`;
    },
    fundingLiga() {
      const f = this.r("funding");
      if (f.tipo_funding !== "Nenhum") Object.assign(f, { tipo_funding: "Nenhum", percentual_obra_financiado: 0, volume_fixo: 0 });
      else f.tipo_funding = "Plano Empresarial (Banco)";
      this.render();
    },

    /* ---------- aba Documentos (arquivos no armazenamento do Integra, por fase) ---------- */
    htmlDocumentosOrion() {
      const d = this.aberto.doc, e = (s) => this.esc(s), lista = this.docsLista(d._id), pode = this.podeEditar();
      if (!lista) { this.docsCarregar(d._id); return `<div class="ovt-pad" style="color:#6b8474">Carregando documentos…</div>`; }
      const fase = this.aberto.fase || 0;
      const daFase = lista.filter((x) => Number(x.fase || 0) === Number(fase)).sort((a, b) => String(b.em).localeCompare(String(a.em)));
      const tam = (n) => (n >= 1048576 ? (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
      return `<div class="ovt-pad"><div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dfe9e3;padding-bottom:16px;margin-bottom:24px;gap:12px">
          <div><h2 class="ovt-h2" style="display:flex;align-items:center;gap:8px"><span style="color:#f37021">📁</span> Documentos do Projeto (GED)</h2><p class="ovt-sub">Armazene e consulte os arquivos oficiais desta viabilidade no Integra.</p></div>
          ${pode ? `<label class="ovt-btn prim" style="cursor:pointer">${this.docsEnviando ? "Enviando..." : "⬆ Anexar Arquivo"}<input id="ov-docs-arq" type="file" multiple style="display:none" ${this.docsEnviando ? "disabled" : ""} onchange="OrionViabilidadesApp.docsAnexar(this)"></label>` : ""}</div>
        ${this.docsErro ? `<div style="padding:8px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:8px;font-size:0.8rem">${e(this.docsErro)}</div>` : ""}
        ${this.docsAviso ? `<div style="padding:8px 12px;border:1px solid #bbf7d0;background:#e7f6ee;color:#105436;border-radius:8px;margin-bottom:8px;font-size:0.8rem">${e(this.docsAviso)}</div>` : ""}
        <div style="border:1px solid #dfe9e3;border-radius:10px;overflow:hidden">${!daFase.length ? `<div style="padding:32px;text-align:center;color:#6b8474;background:#f4f7f5">Nenhum documento anexado ainda.</div>`
          : `<table class="ovt-tab"><thead><tr><th style="padding:16px 24px">Nome do Arquivo</th><th style="padding:16px 24px">Tamanho</th><th style="padding:16px 24px">Data de Upload</th><th style="padding:16px 24px" class="ovt-r">Ação</th></tr></thead><tbody>
            ${daFase.map((x, i) => `<tr style="background:${i % 2 ? "#f4f7f5" : "#fff"}"><td style="padding:16px 24px;font-weight:500"><span style="color:#105436">📄</span> ${e(x.nome)}</td><td style="padding:16px 24px">${tam(Number(x.tamanho) || 0)}</td><td style="padding:16px 24px">${x.em ? new Date(x.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}</td>
              <td style="padding:16px 24px" class="ovt-r"><span style="display:inline-flex;gap:8px">${pode ? `<button type="button" class="ovt-btn out" title="Renomear" onclick="OrionViabilidadesApp.docsRenomear('${e(x.id)}')">✎</button><button type="button" class="ovt-btn out" title="Excluir" style="color:#dc2626" onclick="OrionViabilidadesApp.docsExcluir('${e(x.id)}')">🗑</button>` : ""}<a class="ovt-btn out" title="Baixar" style="color:#105436;text-decoration:none" href="${e(x.url)}" target="_blank" rel="noopener">⬇</a></span></td></tr>`).join("")}</tbody></table>`}</div></div>`;
    },

    /* ---------- aba Parecer Executivo ---------- */
    markdown(t) {
      const e = (s) => this.esc(s);
      const inl = (s) => e(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>");
      const ls = String(t || "").replace(/\r/g, "").split("\n");
      let h = "", i = 0;
      while (i < ls.length) {
        const l = ls[i];
        if (/^\s*\|/.test(l) && i + 1 < ls.length && /^\s*\|?\s*:?-{2,}/.test(ls[i + 1])) {
          const cel = (x) => x.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          const cab = cel(l); i += 2; const rows = [];
          while (i < ls.length && /^\s*\|/.test(ls[i])) { rows.push(cel(ls[i])); i++; }
          h += `<div style="overflow-x:auto;margin:12px 0"><table style="border-collapse:collapse;width:100%;font-size:0.85rem"><thead><tr>${cab.map((c) => `<th style="background:#eef4f0;border:1px solid #dfe9e3;padding:6px 10px;text-align:left">${inl(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #dfe9e3;padding:6px 10px">${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
          continue;
        }
        let m;
        if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { const n = m[1].length; h += `<h${n} style="font-size:${n === 1 ? "1.4rem" : n === 2 ? "1.15rem" : "1rem"};font-weight:700;color:#1c2e24;margin:${n === 1 ? "0 0 12px" : "20px 0 8px"}">${inl(m[2])}</h${n}>`; i++; continue; }
        if (/^\s*>/.test(l)) { const q = []; while (i < ls.length && /^\s*>/.test(ls[i])) { q.push(ls[i].replace(/^\s*>\s?/, "")); i++; } h += `<blockquote style="border-left:4px solid #105436;background:#e7f6ee;margin:12px 0;padding:8px 14px;color:#1c2e24">${inl(q.join(" "))}</blockquote>`; continue; }
        if (/^\s*([-*]|\d+\.)\s+/.test(l)) { const ord = /^\s*\d+\./.test(l); const it = []; while (i < ls.length && /^\s*([-*]|\d+\.)\s+/.test(ls[i])) { it.push(ls[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++; } h += `<${ord ? "ol" : "ul"} style="margin:8px 0 8px 22px;color:#1c2e24">${it.map((x) => `<li style="margin:3px 0">${inl(x)}</li>`).join("")}</${ord ? "ol" : "ul"}>`; continue; }
        if (!l.trim()) { i++; continue; }
        const p = []; while (i < ls.length && ls[i].trim() && !/^(#{1,3}\s|\s*>|\s*([-*]|\d+\.)\s|\s*\|)/.test(ls[i])) { p.push(ls[i]); i++; }
        h += `<p style="margin:8px 0;line-height:1.6;color:#1c2e24">${inl(p.join(" "))}</p>`;
      }
      return h;
    },
    semelhancaIA(o, c) {
      if (o === c) return 100; if (!o && !c) return 100; if (!o || !c) return 0;
      const n = (t) => t.toLowerCase().replace(/[^\w\sÀ-ÿ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
      const a = n(o), b = n(c);
      if (!a.length && !b.length) return 100; if (!a.length || !b.length) return 0;
      const bg = (w) => { const r = []; for (let i = 0; i < w.length - 1; i++) r.push(w[i] + " " + w[i + 1]); return r; };
      const ba = bg(a), bb = bg(b);
      if (!ba.length && !bb.length) return a[0] === b[0] ? 100 : 0;
      const mp = new Map(); bb.forEach((x) => mp.set(x, (mp.get(x) || 0) + 1));
      let k = 0; ba.forEach((x) => { if (mp.get(x) > 0) { k++; mp.set(x, mp.get(x) - 1); } });
      return Math.round(((2 * k) / (ba.length + bb.length)) * 100);
    },
    htmlParecer() {
      const d = this.aberto.doc, e = (s) => this.esc(s), ro = this.leitura();
      const txt = this.ov.parecer != null ? this.ov.parecer : (d.parecer_executivo || "");
      const ed = this.ov.parecerEditando;
      const sim = d.parecer_original_ia ? this.semelhancaIA(d.parecer_original_ia, txt) : null;
      return `<div class="ovt-pad"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px;flex-wrap:wrap"><div style="max-width:680px"><h2 class="ovt-h2">Parecer Executivo</h2><p class="ovt-sub">Digite um resumo analítico sobre o projeto ou utilize a Inteligência Artificial (Gemini) para gerar um texto automaticamente comparando os cenários.</p></div>
          ${ro ? "" : `<button type="button" class="ovt-btn" style="height:40px;padding:0 18px;color:#fff;background:#f37021" ${this.ov.gerandoIA ? "disabled" : ""} onclick="OrionViabilidadesApp.gerarParecerIA()">${this.ov.gerandoIA ? "✨ Gerando análise..." : "✨ Gerar Análise com IA"}</button>`}</div>
        ${this.ov.erroIA ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px;font-size:0.85rem">${e(this.ov.erroIA)}</div>` : ""}
        <div style="border:1px solid #dfe9e3;border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#f4f7f5;border-bottom:1px solid #dfe9e3;gap:8px;flex-wrap:wrap">
            <div style="font-size:0.8rem;color:#6b8474">${ed ? "Você está editando manualmente o parecer. Lembre-se de salvar suas alterações." : sim !== null ? `<span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:999px;font-weight:600">✨ ${sim}% gerado por IA</span>` : ""}</div>
            <div style="display:flex;align-items:center;gap:8px">${ed && !ro ? `<button type="button" class="ovt-btn prim" ${this.ov.salvandoParecer ? "disabled" : ""} onclick="OrionViabilidadesApp.salvarParecer()">${this.ov.salvandoParecer ? "Salvando..." : "Salvar Parecer"}</button>` : ""}
              <div style="display:flex;background:#dfe9e3;border-radius:8px;padding:3px">${[["Visualizar", false], ["Editar Código", true]].map(([t, v]) => `<button type="button" style="border:none;border-radius:6px;padding:6px 14px;font-size:0.85rem;font-weight:500;cursor:pointer;${ed === v ? "background:#fff;color:#1f2937;box-shadow:0 1px 2px rgba(0,0,0,.1)" : "background:transparent;color:#6b7280"}" onclick="OrionViabilidadesApp.ov.parecerEditando=${v};OrionViabilidadesApp.render()">${t}</button>`).join("")}</div></div></div>
          ${ed ? `<textarea id="ovt-parecer" data-k="parecer" style="width:100%;min-height:520px;box-sizing:border-box;border:none;padding:16px;font-family:ui-monospace,monospace;font-size:0.85rem;line-height:1.6;resize:vertical;outline:none" placeholder="Escreva seu resumo executivo aqui..." ${ro ? "disabled" : ""} oninput="OrionViabilidadesApp.parecerDigitado(this.value)">${e(txt)}</textarea>`
            : `<div style="padding:24px 32px;min-height:300px">${txt ? this.markdown(txt) : `<div style="text-align:center;color:#9bb0a3;padding:48px">Nenhum parecer gerado ainda. Clique em "Gerar Análise com IA" ou mude para o modo "Editar Código".</div>`}</div>`}</div>
        <div style="display:flex;gap:10px;margin-top:16px;padding:12px 16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af;font-size:0.85rem"><span>ⓘ</span><div><b>Dica:</b> Se o relatório possuir conteúdo neste campo, ele será automaticamente impresso como a primeira seção do PDF do Estudo de Viabilidade (seguindo o padrão do relatório Moura Leite).</div></div></div>`;
    },
    parecerDigitado(v) {
      const NOTA = "\n\n> *Nota: Este parecer foi gerado automaticamente por Inteligência Artificial.*";
      this.ov.parecer = String(v || "").replace(NOTA, "");
    },
    async salvarParecer() {
      if (this.leitura()) return;
      this.ov.salvandoParecer = true; this.render();
      try { await this.gravarDoc(() => ({ parecer_executivo: this.ov.parecer != null ? this.ov.parecer : (this.aberto.doc.parecer_executivo || "") })); this.ov.parecer = null; this.ov.parecerEditando = false; }
      catch (e) { this.ov.erroIA = "Erro ao salvar o parecer."; }
      this.ov.salvandoParecer = false; this.render();
    },
    async gerarParecerIA() {
      if (this.leitura()) return;
      this.ov.gerandoIA = true; this.ov.erroIA = ""; this.render();
      try {
        const corpo = this.dadosParaParecer();
        // o login do Integra vai junto automaticamente (X-Integra-Token, colocado pelo app.js nas chamadas /api)
        const r = await fetch("/api/orion-parecer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.summary) throw new Error(j.detail || j.error || "Ocorreu um erro ao gerar o resumo.");
        await this.gravarDoc(() => ({ parecer_executivo: j.summary, parecer_original_ia: j.summary }));
        this.ov.parecer = null; this.ov.parecerEditando = false;
      } catch (e) { this.ov.erroIA = e.message || String(e); }
      this.ov.gerandoIA = false; this.render();
    },
    /** Números que vão para a IA: os mesmos que o Órion mandava (indicadores e premissas do cenário e das outras versões). */
    dadosParaParecer() {
      const fam = this.familiaToda(this.aberto.doc);
      const um = (d) => { const r = this.resultados(d); const f = r.fases && r.fases[0]; const fs = this.fasesDe(d)[0] || {}; return { nome: d.project_name, cidade: d.city || "", status: d.status, atual: d._id === this.aberto.doc._id, indicadores: f ? f.r.indicators : null, dre: f ? this.V().dre(f.r.monthly_cashflow).map((l) => ({ nome: l.nome, valor: Math.round(l.valor) })) : [], fisico: fs.physical_data || {}, datas: fs.dates || {}, impostos: fs.taxes || {}, permuta: { modalidade: (fs.exchanges || {}).modalidade, perc_parceria_terrenista: (fs.exchanges || {}).perc_parceria_terrenista, perc_parceria_empreendedor: (fs.exchanges || {}).perc_parceria_empreendedor }, funding: { tipo: (fs.funding || {}).tipo_funding } }; };
      return { projeto: this.aberto.doc.project_name, cenarios: fam.map(um) };
    },

    /* ---------- aba Resumo (Dashboard de Resultados) ---------- */
    UNIDADE: { "R$": "R$", "%": "%", m2: "m²", n: "Unidades", data: "Data", txt: "", anos: "Anos" },
    htmlResumoOrion() {
      const d = this.aberto.doc, a = this.aberto, e = (s) => this.esc(s);
      const res = this.resultados(d);
      if (res.erro) return `<div class="ovt-pad" style="color:#dc2626">Erro ao calcular resultados: ${e(res.erro)}</div>`;
      const f = res.fases[a.fase];
      if (!f || !f.r || !f.r.indicators) return `<div class="ovt-pad" style="color:#dc2626">Erro ao calcular resultados.</div>`;
      const L = this.LINHAS_RESUMO || [], resumo = this.resumoDe, ANT = this.ANTIGOS_RESUMO || {};
      const parc = Object.keys(f.r.indicators_parceiros || {});
      const modos = parc.length ? ["Global", "Empreendedor"].concat(parc) : ["Global", "Empreendedor", "Parceiro", "Investidor"];
      if (modos.indexOf(a.visao) < 0) a.visao = "Global";
      const todas = [{ id: "atual", titulo: "CENÁRIO ATUAL", v: resumo(this.ctxFase(d, f)), atual: true }];
      this.familiaToda(d).filter((x) => x._id !== d._id).forEach((x) => { const rx = this.resultados(x); const fx = rx.fases && rx.fases[0]; if (fx) todas.push({ id: "f_" + x._id, titulo: x.project_name, v: resumo(this.ctxFase(x, fx)), familia: true }); });
      (d.fotos || []).forEach((x, k) => todas.push({ id: "s_" + x.id, titulo: `FOTO ${k + 1} ${x.oficial ? "(Oficial)" : ""}`, v: x.valores || {}, foto: x }));
      const comparar = this.ov.comparar !== false;
      const cols = comparar ? todas.filter((c) => c.atual || !this.ov.ocultas[c.id]) : [todas[0]];
      const val = (c, n) => (c.v[n] !== undefined ? c.v[n] : ANT[n] !== undefined && c.v[ANT[n]] !== undefined ? c.v[ANT[n]] : null);
      const pode = this.podeEditar();
      const th = "padding:10px 12px;font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em";
      const corpo = L.map(([n, , t, peso]) => {
        if (t === "sec") return `<tr><th colspan="2" style="${th};background:#e7f6ee;color:#105436;font-weight:800;text-align:left;position:sticky;left:0">${e(n === "Projeto" ? "DADOS GERAIS" + (a.visao !== "Global" ? ` (Ótica: ${a.visao})` : "") : n === "DRE" ? "DRE" : "INDICADORES")}</th>${cols.map(() => `<th style="background:#e7f6ee"></th>`).join("")}</tr>`;
        const sub = n.indexOf("· ") === 0, nome = sub ? n.slice(2) : n;
        const un = this.UNIDADE[t] != null ? this.UNIDADE[t] : "";
        return `<tr style="${peso === 2 ? "background:#e7f6ee;" : ""}"><td style="padding:8px 12px;border-bottom:1px solid #eef4f0;${sub ? "padding-left:28px;color:#4a6355" : "font-weight:" + (peso ? 700 : 500) + ";color:#1c2e24"};position:sticky;left:0;background:${peso === 2 ? "#e7f6ee" : "#fff"};min-width:240px">${e(peso ? nome.toUpperCase() : nome)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef4f0;color:#9bb0a3;font-size:0.75rem">${un}</td>
          ${cols.map((c) => { const v = val(c, n); return `<td style="padding:8px 12px;border-bottom:1px solid #eef4f0;text-align:right;white-space:nowrap;${c.atual ? "background:rgba(16,84,54,.05);" : ""}${peso === 2 ? "font-weight:700;" : ""}${typeof v === "number" && v < 0 && t === "R$" ? "color:#dc2626" : "color:#1c2e24"}">${t === "R$" && typeof v === "number" ? BRL(v) : this.fmtLinha(v, t)}</td>`; }).join("")}</tr>`;
      }).join("");
      const btn = (t, on, acao, extra) => `<button type="button" class="ovt-btn ${on ? "prim" : "out"}" ${extra || ""} onclick="${acao}">${t}</button>`;
      return `<div class="ovt-pad"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px;flex-wrap:wrap"><div><h2 class="ovt-h2">Dashboard de Resultados</h2><p class="ovt-sub">Comparativo de Cenários, DRE e Indicadores de Rentabilidade.</p>${f.r.aviso_parceiros ? `<p style="font-size:0.8rem;color:#b45309;margin:6px 0 0">${e(f.r.aviso_parceiros)}</p>` : ""}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><div style="display:flex;background:#eef4f0;border-radius:8px;padding:3px">${modos.map((m) => `<button type="button" style="border:none;border-radius:6px;padding:6px 14px;font-size:0.85rem;font-weight:500;cursor:pointer;${a.visao === m ? "background:#fff;color:#105436;box-shadow:0 1px 2px rgba(0,0,0,.1)" : "background:transparent;color:#6b8474"}" onclick="OrionViabilidadesApp.aberto.visao='${e(m)}';OrionViabilidadesApp.render()">${e(m)}</button>`).join("")}</div>
            ${btn("🖨 Gerar Relatório", false, "OrionViabilidadesApp.relatorio()")}${btn(comparar ? "🙈 Ocultar Comparações" : "👁 Comparar Cenários", false, "OrionViabilidadesApp.ov.comparar=!(OrionViabilidadesApp.ov.comparar!==false);OrionViabilidadesApp.render()")}
            ${comparar && todas.length > 1 ? btn("⏷ Selecionar Cenários", false, "OrionViabilidadesApp.ov.modal='colunas';OrionViabilidadesApp.render()") : ""}
            ${this.ov.msg.foto ? `<span class="ovt-msg">${this.ov.msg.foto}</span>` : ""}${pode ? `<button type="button" class="ovt-btn prim" ${this.ov.fixando ? "disabled" : ""} onclick="OrionViabilidadesApp.fixarFoto()">💾 ${this.ov.fixando ? "Fixando..." : "Fixar no Comparativo (Foto)"}</button>` : ""}</div></div>
        <div style="overflow:auto;max-height:75vh;border:1px solid #dfe9e3;border-radius:10px"><table style="border-collapse:collapse;width:100%;font-size:0.85rem"><thead><tr><th colspan="2" style="${th};background:#1b8253;color:#fff;position:sticky;top:0;left:0;z-index:3;text-align:left">Indicador</th>
          ${cols.map((c) => `<th style="${th};background:${c.atual ? "#105436" : "#1b8253"};color:#fff;position:sticky;top:0;z-index:2;text-align:right;min-width:160px;white-space:normal">${e(c.titulo)}${c.foto && pode ? ` <button type="button" title="Excluir Coluna" style="border:none;background:none;color:#fca5a5;cursor:pointer" onclick="OrionViabilidadesApp.excluirFotoOrion('${e(c.foto.id)}')">✕</button>` : ""}</th>`).join("")}</tr></thead><tbody>${corpo}</tbody></table></div>
        ${this.ov.modal === "colunas" ? `<div class="ovt-modal-fundo" onclick="if(event.target===this){OrionViabilidadesApp.ov.modal=null;OrionViabilidadesApp.render()}"><div class="ovt-modal" style="max-width:480px"><div class="ovt-modal-cab"><b>Selecionar Cenários</b><button type="button" style="border:none;background:none;font-size:1.3rem;cursor:pointer;color:#9bb0a3" onclick="OrionViabilidadesApp.ov.modal=null;OrionViabilidadesApp.render()">×</button></div>
          <div style="padding:16px 24px;display:flex;flex-direction:column;gap:10px;overflow-y:auto">${todas.slice(1).map((c) => `<label style="display:flex;align-items:center;gap:10px;font-size:0.9rem;cursor:pointer"><input type="checkbox" style="width:16px;height:16px" ${this.ov.ocultas[c.id] ? "" : "checked"} onchange="OrionViabilidadesApp.ov.ocultas['${e(c.id)}']=!this.checked;OrionViabilidadesApp.render()">${e(c.titulo)}</label>`).join("")}</div>
          <div style="padding:12px 24px;border-top:1px solid #dfe9e3;display:flex;justify-content:flex-end"><button type="button" class="ovt-btn prim" onclick="OrionViabilidadesApp.ov.modal=null;OrionViabilidadesApp.render()">Confirmar</button></div></div></div>` : ""}</div>`;
    },
    async fixarFoto() {
      if (!this.podeEditar()) return;
      const r = this.resultados(this.aberto.doc), f = r.fases[this.aberto.fase];
      if (!f) return;
      const quem = window.OrionStore ? window.OrionStore.usuario() : "";
      const valores = this.resumoDe(this.ctxFase(this.aberto.doc, f));
      this.ov.fixando = true; this.render();
      try {
        await this.gravarDoc((fases, atual) => { const l = (atual.fotos || []).slice(); l.push({ id: Date.now().toString(36), nome: `Foto ${l.length + 1}`, em: new Date().toISOString(), por: quem, fase: f.nome, cenario: "Base", oficial: true, valores, visao: this.aberto.visao || "Global" }); return { fotos: l }; });
        this.ov.fixando = false; this.msg("foto", "Versão congelada com sucesso!");
      } catch (e) { this.ov.fixando = false; window.alert("Erro ao congelar versão."); this.render(); }
    },
    async excluirFotoOrion(id) {
      if (!window.confirm("Deseja realmente excluir esta coluna do comparativo?")) return;
      try { await this.gravarDoc((fases, atual) => ({ fotos: (atual.fotos || []).filter((x) => x.id !== id) })); } catch (e) { window.alert("Erro ao excluir coluna do comparativo."); }
      this.render();
    },

    /* ---------- aba Comparativo (Comparador Inteligente de Cenários, mesmas regras do Órion) ---------- */
    pontuacao(i) {
      const m = Number(i.margem_perc) || 0, t = Number(i.tir_aa) || 0, x = Number(i.exposicao_maxima) || 0, v = Number(i.vgv_total) || 0;
      const sm = Math.min(40, Math.max(0, (m / 25) * 40)), st = Math.min(30, Math.max(0, (t / 25) * 30));
      const ep = v > 0 ? Math.abs(x) / v : 0, se = Math.max(0, 30 - (ep / 0.2) * 30);
      return Math.trunc(sm + st + se);
    },
    explicacao(nome, i, o) {
      if (!o) return "Este é o projeto base. Ele servirá como referência para as demais comparações de cenários.";
      const l = [], g = (x, k) => Number(x[k]) || 0;
      if (g(i, "margem_perc") > g(o, "margem_perc") + 0.5) l.push(`apresenta uma margem melhor (${g(i, "margem_perc").toFixed(1)}%)`);
      else if (g(i, "margem_perc") < g(o, "margem_perc") - 0.5) l.push(`sofreu uma queda na margem (${g(i, "margem_perc").toFixed(1)}%)`);
      if (g(i, "custo_obras") < g(o, "custo_obras") * 0.95) l.push("graças à redução no custo de obras");
      else if (g(i, "custo_obras") > g(o, "custo_obras") * 1.05) l.push("devido ao aumento no custo de obras");
      if (g(i, "vgv_total") > g(o, "vgv_total") * 1.05) l.push("impulsionado por um VGV maior");
      return l.length ? `O ${nome} ${l.join(" e ")}.` : `O ${nome} possui indicadores muito similares ao original.`;
    },
    sugestoes(i) {
      const s = [], m = Number(i.margem_perc) || 0, t = Number(i.tir_aa) || 0, v = Number(i.vgv_total) || 0, x = Number(i.exposicao_maxima) || 0;
      if (m < 15) s.push("A Margem Líquida está baixa (<15%). Tente reduzir os custos de obra ou avaliar um leve aumento no VGV.");
      if (t < 15) s.push("A TIR está abaixo do esperado. Considere postergar despesas, antecipar o lançamento ou trocar a compra de terreno por permuta financeira.");
      if (Math.abs(x) / (v || 1) > 0.1) s.push("A exposição de caixa está alta (mais de 10% do VGV). Pode ser interessante configurar um Funding (ex: CRI ou Plano Empresarial) para aliviar o caixa.");
      if (!s.length) s.push("Este cenário apresenta indicadores muito saudáveis! O equilíbrio entre margem, TIR e exposição está excelente.");
      return s;
    },
    htmlComparativoOrion() {
      const e = (s) => this.esc(s), d = this.aberto.doc, raiz = d.versao_de || d._id;
      const fam = this.familiaToda(d);
      const zero = { tir_aa: 0, margem_perc: 0, exposicao_maxima: 0, vgv_total: 0, custo_obras: 0, valor_terreno: 0, lucro_liquido: 0, vpl: 0 };
      const itens = fam.map((v) => { const r = this.resultados(v); const f = r.fases && r.fases[0]; const ind = f && f.r && f.r.indicators ? f.r.indicators : zero; return { id: v._id, nome: v.project_name, raiz: v._id === raiz, ind, score: this.pontuacao(ind), sug: this.sugestoes(ind) }; });
      const orig = (itens.find((x) => x.raiz) || {}).ind;
      itens.forEach((x) => { x.exp = this.explicacao(x.nome, x.ind, x.raiz ? null : orig); });
      const venc = itens.reduce((b, x) => (!b || x.score > b.score ? x : b), null);
      if (!itens.length) return `<div class="ovt-pad" style="text-align:center;color:#6b8474">Nenhum dado encontrado para comparação.</div>`;
      const pct = (v) => (v == null || isNaN(v) ? "n/d" : (Number(v) / 100).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }));
      return `<div class="ovt-pad"><div style="position:relative;overflow:hidden;background:linear-gradient(90deg,#0c291d,#105436);color:#fff;border-radius:12px;padding:28px 32px;margin-bottom:32px"><div style="position:absolute;right:24px;top:12px;font-size:6rem;opacity:.08">🏆</div>
          <h2 style="font-size:1.5rem;font-weight:700;margin:0 0 8px;display:flex;align-items:center;gap:8px">💡 Comparador Inteligente de Cenários</h2><p style="color:#cbd5e1;max-width:680px;margin:0">Nosso motor algorítmico avaliou ${itens.length} cenário(s) para este projeto. Descubra qual apresenta o melhor equilíbrio entre Margem, TIR e Exposição de Caixa.</p></div>
        <div style="display:grid;gap:24px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${itens.map((x) => { const w = venc && venc.id === x.id; return `<div style="position:relative;display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 8px 20px rgba(15,23,42,.08);border:1px solid ${w ? "#fbbf24" : "#dfe9e3"};${w ? "box-shadow:0 0 0 2px #fbbf24,0 8px 20px rgba(15,23,42,.08);" : ""}">
            ${w ? `<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#fbbf24,#f59e0b);color:#fff;font-size:0.75rem;font-weight:700;padding:4px 14px;border-radius:999px">🏆 VENCEDOR</div>` : ""}
            <div style="padding:24px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h3 style="font-size:1.1rem;font-weight:700;color:#1c2e24;margin:0">${e(x.nome)}</h3>${x.raiz ? `<span style="display:inline-block;margin-top:6px;font-size:0.72rem;background:#eef4f0;color:#4a6355;padding:2px 8px;border-radius:999px">Projeto Original</span>` : ""}</div>
              <div style="position:relative;width:96px;height:96px;flex-shrink:0"><svg width="96" height="96" style="transform:rotate(-90deg)"><circle cx="48" cy="48" r="44" stroke="#eef4f0" stroke-width="6" fill="none"/><circle cx="48" cy="48" r="44" stroke="${x.score >= 70 ? "#1b8253" : x.score >= 40 ? "#f59e0b" : "#ef4444"}" stroke-width="6" fill="none" stroke-dasharray="276" stroke-dashoffset="${276 - (276 * x.score) / 100}" stroke-linecap="round"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:1.6rem;font-weight:800;color:#1c2e24">${x.score}</span><span style="font-size:0.65rem;color:#9bb0a3;text-transform:uppercase">Score</span></div></div></div>
            <div style="padding:0 24px 16px;font-size:0.85rem;color:#4a6355;font-style:italic">${e(x.exp)}</div>
            <div style="margin:0 24px 16px;padding:12px 16px;background:#f4f7f5;border-radius:8px;font-size:0.85rem">${[["VGV Total:", BRL(x.ind.vgv_total)], ["Margem Líquida:", pct(x.ind.margem_perc)], ["TIR (a.a.):", pct(x.ind.tir_aa)], ["Exposição:", BRL(x.ind.exposicao_maxima)], ["Lucro Líquido:", BRL(x.ind.lucro_liquido)]].map(([a, b]) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:#6b8474">${a}</span><b style="color:#1c2e24">${b}</b></div>`).join("")}</div>
            <div style="margin-top:auto;padding:16px 24px;border-top:1px solid #eef4f0;background:rgba(239,246,255,.5);border-radius:0 0 12px 12px"><h4 style="font-size:0.8rem;font-weight:700;color:#1e40af;margin:0 0 8px">💡 Insights & Sugestões</h4><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">${x.sug.map((s) => `<li style="display:flex;gap:6px;font-size:0.8rem;color:#1c2e24"><span style="color:#2563eb">✓</span><span>${e(s)}</span></li>`).join("")}</ul></div></div>`; }).join("")}</div></div>`;
    }
  });

  /* ---------- montagem da tela ---------- */
  const detalheAntigo = A.htmlDetalhe;
  A.htmlDetalhe = function () {
    this.estilosTela();
    if (!this.ov || this.ov.docId !== this.aberto.doc._id) { this.iniciarTela(); this.apoio = null; } // cadastros relidos a cada viabilidade aberta
    if (!this.apoio && !this._lendoApoio) { this._lendoApoio = true; this.carregarApoio().then(() => { this._lendoApoio = false; this.render(); }); }
    const aba = ABAS[this.ov.aba];
    let corpo = "";
    try {
      corpo = { "Dados Físicos": () => this.htmlFisico(), "Datas": () => this.htmlDatas(), "Permutas": () => this.htmlPermutas(), "Receitas": () => this.htmlReceitas(), "Obras": () => this.htmlObras(), "Despesas": () => this.htmlDespesas(), "Curvas": () => this.htmlCurvas(), "Impostos": () => this.htmlImpostos(), "Funding": () => this.htmlFunding(), "Documentos": () => this.htmlDocumentosOrion(), "Parecer Executivo": () => this.htmlParecer(), "Resumo": () => this.htmlResumoOrion(), "Comparativo": () => this.htmlComparativoOrion() }[aba]();
    } catch (e) { corpo = `<div class="ovt-pad" style="color:#dc2626">Não foi possível montar esta aba: ${this.esc(e.message || String(e))}</div>`; console.error(e); }
    return `<div>${this.htmlCabecalho()}<div class="ovt-abas">${ABAS.map((t, i) => `<button type="button" class="ovt-aba ${i === this.ov.aba ? "on" : ""}" onclick="OrionViabilidadesApp.irAba(${i})">${t}</button>`).join("")}</div><div class="ovt-corpo">${corpo}</div></div>`;
  };
  A.htmlDetalheAntigo = detalheAntigo;
  A.htmlLista = function () { this.estilosTela(); return this.htmlListaOrion(); };
  const fecharAntigo = A.fechar;
  A.fechar = function () { this.ed = null; this.ov = null; fecharAntigo.call(this); };
})();
