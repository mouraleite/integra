/* Órion (transição) › Orçamentos e forecasts — criar orçamento novo e nova versão de forecast (regra do Órion).
 * Como no Órion, cada departamento tem um documento por ano e tipo ("Orçamento", ou a versão rolling do forecast,
 * "Forecast - N+M", com N = meses fechados em sequência na tela Fechamento de meses). "Novo" inclui um empreendimento
 * nesse documento (cria o documento se ainda não existe), em branco ou copiando as linhas de uma base:
 *   - forecast: o orçamento aprovado do ano (padrão) ou a versão anterior do forecast;
 *   - "todos do orçamento aprovado": inclui de uma vez os empreendimentos do orçamento aprovado que ainda faltam (gerar em lote do Órion).
 * Não deixa incluir um empreendimento que já está no documento, nem mexer em documento em aprovação, aprovado ou fechado.
 * Grava nas mesmas coleções da tela (orion_orcamentos / orion_forecasts e itens), com conferência de versão (rev). */
Object.assign(window.OrionOrcamentosApp, {
  novo: null,   // { tipo, ano, dept, cc, base, salvando, erros }

  podeCriar() {
    if (this.ehAdmin()) return true;
    return typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_orion_geral_orcamentos_editar");
  },

  /** Departamentos em que a pessoa pode criar (administrador: todos). */
  deptsDoUsuario() {
    const l = ((this.cadDep && this.cadDep.departamentos) || []).filter((d) => d.ativo !== false);
    if (this.ehAdmin()) return l;
    const eu = this.usuarioEmail();
    return l.filter((d) => (d.usuarios || []).indexOf(eu) >= 0);
  },

  /** Empreendimentos que o departamento pode usar: os do cadastro do departamento; sem lista no cadastro, todos os centros de custo. */
  ccsDoDept(dep) {
    if (dep && (dep.ccs || []).length) return dep.ccs;
    const nomes = (this.cadDep && this.cadDep.nomesCc) || {};
    return Object.keys(nomes).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  },

  abrirNovo() {
    const ds = this.deptsDoUsuario();
    this.novo = { tipo: "DESPESAS", ano: this.ano || String(new Date().getFullYear()), dept: ds[0] ? String(ds[0].id) : "", cc: "", base: this.tipo === "forecasts" ? "orcamento" : "branco", erros: [], salvando: false };
    this.aviso = "";
    this.render();
  },
  fecharNovo() { this.novo = null; this.render(); },
  setNovo(campo, v) { if (this.novo) { this.novo[campo] = v; if (campo === "dept") this.novo.cc = ""; this.render(); } },

  descricaoNova() {
    const C = this.C();
    if (this.tipo !== "forecasts") return C.DESCRICAO_ORCAMENTO;
    return C.descricaoForecast(C.corteForecast(this.fechamento, this.novo.ano));
  },

  async lerDocDe(colKey, cab) {
    const fc = this.fc();
    const blocos = [];
    for (let b = 0; b < (cab.blocos || 1); b++) {
      const s = await fc.getDoc(fc.doc(window.firebaseDb, this.COL[colKey].itens, `${cab._id}_${b}`));
      if (s.exists()) blocos.push(s.data());
    }
    return this.C().juntarBlocos(blocos);
  },

  async cabsDe(colKey) {
    if (this.cab[colKey]) return this.cab[colKey];
    const fc = this.fc();
    const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.COL[colKey].cab));
    const l = [];
    snap.forEach((d) => l.push(d.data()));
    this.cab[colKey] = l;
    return l;
  },

  /** Documentos base para copiar: orçamento aprovado do ano, ou a versão anterior do forecast. */
  async basesDe(n, descricao) {
    const C = this.C();
    const mesmo = (c) => String(c.ano) === String(n.ano) && String(c.tipo).toUpperCase() === n.tipo && String(c.departamento ? c.departamento.id : "") === String(n.dept) && c.status !== "Substituído";
    if (n.base === "orcamento" || n.base === "lote") {
      const cabs = (await this.cabsDe("orcamentos")).filter((c) => mesmo(c) && ["Aprovado", "Fechado"].indexOf(c.status) >= 0);
      return { col: "orcamentos", cabs };
    }
    if (n.base === "forecast") {
      const todos = (await this.cabsDe("forecasts")).filter((c) => mesmo(c) && String(c.descricao) !== descricao);
      const vs = C.versoesForecast(todos, n.ano, [n.tipo]);
      return { col: "forecasts", cabs: vs.length ? todos.filter((c) => String(c.descricao) === vs[0].descricao) : [], versao: vs[0] ? vs[0].descricao : "" };
    }
    return { col: null, cabs: [] };
  },

  async criarNovo() {
    const C = this.C();
    const n = this.novo;
    if (!n || n.salvando || !this.podeCriar()) return;
    n.erros = [];
    const dep = this.deptsDoUsuario().find((d) => String(d.id) === String(n.dept));
    if (!dep) { n.erros = ["Escolha um departamento em que você está cadastrado (Configurações gerais › Departamentos do orçamento)."]; return this.render(); }
    if (n.base !== "lote" && !n.cc) { n.erros = ["Escolha o empreendimento (centro de custo)."]; return this.render(); }
    const descricao = this.descricaoNova();
    const plano = C.planejarInclusao(this.cab[this.tipo] || [], { ano: n.ano, tipo: n.tipo, descricao, departamentoId: dep.id });
    if (plano.erro) { n.erros = [plano.erro]; return this.render(); }
    n.salvando = true;
    this.render();
    try {
      const atual = plano.destino ? await this.lerDocDe(this.tipo, plano.destino) : { itens: [], vendas: [] };
      const jaTem = C.empreendimentosDoDoc(atual);
      ((plano.destino && plano.destino.empreendimentos) || []).forEach((cc) => jaTem.add(String(cc)));
      const bases = await this.basesDe(n, descricao);
      const baseDocs = [];
      for (const c of bases.cabs) baseDocs.push(await this.lerDocDe(bases.col, c));
      const base = { itens: [].concat(...baseDocs.map((d) => d.itens)), vendas: [].concat(...baseDocs.map((d) => d.vendas)) };
      let ccs;
      if (n.base === "lote") {
        if (!bases.cabs.length) throw new Error(`Nenhum orçamento aprovado de ${n.tipo.toLowerCase()} ${n.ano} neste departamento.`);
        ccs = [...C.empreendimentosDoDoc(base)].filter((cc) => !jaTem.has(cc)).sort();
        if (!ccs.length) throw new Error("Todos os empreendimentos do orçamento aprovado já estão neste forecast.");
      } else {
        const k = String(n.cc).replace(/\D/g, "");
        if (jaTem.has(k)) throw new Error(`Já existe ${this.tipo === "forecasts" ? "forecast" : "orçamento"} criado para o empreendimento ${k} em ${n.ano}. Não é possível criar outro.`);
        if ((n.base === "orcamento" || n.base === "forecast") && !bases.cabs.length) throw new Error(n.base === "orcamento" ? `Nenhum orçamento aprovado de ${n.tipo.toLowerCase()} ${n.ano} neste departamento para copiar. Escolha "em branco" ou "versão anterior".` : "Não há versão anterior do forecast neste departamento. Escolha outra base.");
        ccs = [k];
      }
      const novosItens = [], novasVendas = [];
      ccs.forEach((cc) => { const c = C.copiarEmpreendimento(n.base === "branco" ? null : base, cc, n.ano); novosItens.push(...c.itens); novasVendas.push(...c.vendas); });
      const itens = atual.itens.concat(novosItens), vendas = atual.vendas.concat(novasVendas);
      await this.gravarDoc(plano.destino, { descricao, n, dep, itens, vendas, bases, ccs });
      this.aviso = `${ccs.length === 1 ? "Empreendimento " + ccs[0] + " incluído" : ccs.length + " empreendimentos incluídos"} em "${descricao}" ${n.ano} (${dep.nome})${n.base === "branco" ? ", em branco" : novosItens.length || novasVendas.length ? `, com ${novosItens.length + novasVendas.length} linha(s) copiada(s)` : ", sem linhas na base"}. Abra o documento e clique em Editar para lançar os valores.`;
      this.novo = null;
      await this.carregar();
    } catch (e) {
      n.salvando = false;
      n.erros = [e.message || String(e)];
      this.render();
    }
  },

  async gravarDoc(destino, o) {
    const C = this.C(), fc = this.fc();
    const col = this.COL[this.tipo];
    const quem = this.usuarioEmail();
    const agora = new Date().toISOString();
    const id = destino ? destino._id : `int_${Date.now().toString(36)}`;
    const blocos = C.emBlocos(id, col.ref, o.itens, o.vendas);
    const empreend = [...new Set([...C.empreendimentosDoDoc({ itens: o.itens, vendas: o.vendas }), ...((destino && destino.empreendimentos) || []), ...(o.ccs || [])])].sort();
    const resumo = {
      empreendimentos: empreend,
      totais: C.somarLinhas(o.itens), linhas: o.itens.length, blocos: blocos.length,
      linhas_venda: o.vendas.length, vgv: o.vendas.reduce((s, v) => s + (Number(v.vgv) || 0), 0)
    };
    await fc.runTransaction(window.firebaseDb, async (tx) => {
      const ref = fc.doc(window.firebaseDb, col.cab, id);
      const s = await tx.get(ref);
      let cab;
      if (destino) {
        if (!s.exists()) throw new Error("O documento não existe mais. Clique em Atualizar.");
        const atual = s.data();
        if ((Number(atual.rev) || 0) !== (Number(destino.rev) || 0)) throw new Error(`O documento foi alterado por ${atual.alterado_por || "outra pessoa"} agora há pouco. Clique em Atualizar e tente de novo.`);
        if (!C.editavel(atual.status)) throw new Error(`O documento está "${atual.status}" e não pode receber empreendimentos.`);
        for (let b = blocos.length; b < (Number(atual.blocos) || 1); b++) tx.delete(fc.doc(window.firebaseDb, col.itens, `${id}_${b}`));
        cab = Object.assign({}, atual, resumo, { rev: (Number(atual.rev) || 0) + 1, alterado_por: quem, alterado_em: agora });
      } else {
        if (s.exists()) throw new Error("Tente de novo.");
        const corte = this.tipo === "forecasts" ? C.corteForecast(this.fechamento, o.n.ano) : null;
        cab = Object.assign({
          _id: id, origem: "integra", descricao: o.descricao, ano: Number(o.n.ano), tipo: o.n.tipo, status: "Rascunho", versao: 1,
          versao_base: o.bases.col === "forecasts" && o.bases.cabs[0] ? String(o.bases.cabs[0]._id) : "",
          orcamento_base: o.bases.col === "orcamentos" && o.bases.cabs[0] ? String(o.bases.cabs[0]._id) : "",
          mes_corte: corte == null ? null : Math.min(12, corte + 1),
          departamento: { id: o.dep.id, nome: o.dep.nome }, produto: null,
          criado_por: quem, criado_em: agora, motivo_reabertura: "",
          historico: [{ de: "", para: "Rascunho", por: quem, em: agora, motivo: "Criado no Integra" }],
          total_orion: 0, rev: 1, alterado_por: quem, alterado_em: agora
        }, resumo);
      }
      for (const b of blocos) { const { _id, ...dados } = b; tx.set(fc.doc(window.firebaseDb, col.itens, _id), dados); }
      tx.set(ref, cab);
    });
  },

  htmlNovo() {
    const n = this.novo;
    if (!n) return "";
    const ds = this.deptsDoUsuario();
    const dep = ds.find((d) => String(d.id) === String(n.dept));
    const nomes = (this.cadDep && this.cadDep.nomesCc) || {};
    const fc = this.tipo === "forecasts";
    const opt = (v, t, sel) => `<option value="${this.esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${this.esc(t)}</option>`;
    const bases = fc ? [["orcamento", "Copiar do orçamento aprovado do ano"], ["forecast", "Copiar da versão anterior do forecast"], ["branco", "Em branco"], ["lote", "Todos os empreendimentos do orçamento aprovado que faltam"]] : [["branco", "Em branco"]];
    return `<div style="padding:12px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;margin-bottom:12px;font-size:0.8rem">
      <b>${fc ? "Nova versão de forecast / incluir empreendimento" : "Novo orçamento / incluir empreendimento"}</b> — vai para o documento <b>"${this.esc(this.descricaoNova())}"</b> ${this.esc(n.ano)} do departamento${fc ? " (nome pela tela Fechamento de meses: meses fechados + meses projetados)" : ""}. Se o documento ainda não existe, é criado como Rascunho.
      ${!ds.length ? `<div style="color:#b91c1c;margin-top:6px">Você não está cadastrado em nenhum departamento (Configurações gerais › Departamentos do orçamento).</div>` : ""}
      ${n.erros.length ? `<div style="color:#b91c1c;margin-top:6px">${n.erros.map((x) => this.esc(x)).join("<br>")}</div>` : ""}
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:8px">
        <div><label class="ml-emp-filter-label">Tipo</label><select class="idx-select" style="height:40px" onchange="OrionOrcamentosApp.setNovo('tipo', this.value)">${[["DESPESAS", "Despesas"], ["RECEITAS", "Receitas"], ["VENDAS", "Vendas"]].map(([v, t]) => opt(v, t, n.tipo)).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Ano</label><input class="idx-select" style="height:40px;width:90px;box-sizing:border-box" value="${this.esc(n.ano)}" onchange="OrionOrcamentosApp.setNovo('ano', this.value)"></div>
        <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:220px" onchange="OrionOrcamentosApp.setNovo('dept', this.value)">${ds.map((d) => opt(d.id, d.nome, n.dept)).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Base</label><select class="idx-select" style="height:40px;min-width:260px" onchange="OrionOrcamentosApp.setNovo('base', this.value)">${bases.map(([v, t]) => opt(v, t, n.base)).join("")}</select></div>
        ${n.base === "lote" ? "" : `<div><label class="ml-emp-filter-label">Empreendimento (centro de custo)</label><select class="idx-select" style="height:40px;min-width:280px" onchange="OrionOrcamentosApp.setNovo('cc', this.value)"><option value="">Escolha…</option>${this.ccsDoDept(dep).map((cc) => opt(cc, `${cc} - ${nomes[cc] || ""}`, n.cc)).join("")}</select></div>`}
        <button type="button" class="btn btn-primary" style="height:40px" ${n.salvando || !ds.length ? "disabled" : ""} onclick="OrionOrcamentosApp.criarNovo()">${n.salvando ? "Criando..." : "Criar"}</button>
        <button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionOrcamentosApp.fecharNovo()">Cancelar</button>
      </div></div>`;
  }
});
