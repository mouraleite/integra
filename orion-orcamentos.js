/* Órion (transição) › Orçamentos e forecasts — consulta dos orçamentos e forecasts trazidos do ML Órion.
 * Etapa 4, parte 1: carga inicial (só administrador) e consulta com versões, status, histórico de aprovação,
 * totais por centro de custo × plano × mês e diferença para a versão anterior.
 * A edição e o fluxo de aprovação vêm na parte 2; até lá, quem edita continua sendo o Órion.
 * Banco (coleções novas): orion_orcamentos / orion_orcamento_itens e orion_forecasts / orion_forecast_itens.
 * Valores em centavos inteiros (orion-orcamento-calc.js). */
const OrionOrcamentosApp = {
  tipo: "orcamentos",          // "orcamentos" | "forecasts"
  cab: { orcamentos: null, forecasts: null },
  ano: "",
  dept: "TODOS",
  verSubstituidos: false,
  aberto: null,                // { cab, itens, vendas, base }
  visao: "cc",                 // "cc" | "plano"
  carregando: false,
  erro: "",
  carga: null,
  edicao: null,
  cadDep: null,
  fechamento: [],
  aviso: "",

  C() { return window.OrionOrcamentoCalc; },
  root() { return document.getElementById("orion-orcamentos-root"); },

  COL: {
    orcamentos: { cab: "orion_orcamentos", itens: "orion_orcamento_itens", ref: "orcamento" },
    forecasts: { cab: "orion_forecasts", itens: "orion_forecast_itens", ref: "forecast" }
  },

  esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  ehAdmin() { return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin(); },

  fc() { return window.firebaseCollections; },

  estilos() {
    if (document.getElementById("oo-estilos")) return;
    const st = document.createElement("style");
    st.id = "oo-estilos";
    st.textContent = `
      .cc-table tr.oo-total td { background:#105436 !important; color:#fff !important; font-weight:700; }
      .cc-table input.oo-num { width:100%; box-sizing:border-box; height:26px; border:1px solid #d6e2db; border-radius:5px; padding:0 4px; font-size:0.7rem; text-align:right; font-variant-numeric:tabular-nums; }
      .cc-table input.oo-num:disabled { background:#f1f5f9; color:#64748b; }
      .cc-table tr.oo-grupo td { background:#e7f6ee !important; color:#105436 !important; font-weight:700; }
    `;
    document.head.appendChild(st);
  },

  init() {
    this.estilos();
    this.render();
    if (!this.cab[this.tipo]) this.carregar();
    this.lerApoio();
  },

  async carregar() {
    const fc = this.fc();
    if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou. Tente de novo em alguns segundos."; return this.render(); }
    this.carregando = true;
    this.erro = "";
    this.render();
    try {
      const snap = await fc.getDocs(fc.collection(window.firebaseDb, this.COL[this.tipo].cab));
      const lista = [];
      snap.forEach((d) => lista.push(d.data()));
      this.cab[this.tipo] = lista;
      const anos = [...new Set(lista.map((c) => c.ano))].sort((a, b) => b - a);
      if (!this.ano || anos.indexOf(Number(this.ano)) < 0) this.ano = anos.length ? String(anos[0]) : "";
    } catch (e) {
      this.erro = e.message || String(e);
    }
    this.carregando = false;
    this.render();
  },

  setTipo(t) { this.tipo = t; this.aberto = null; this.dept = "TODOS"; this.init(); },
  setAno(a) { this.ano = a; this.aberto = null; this.render(); },
  setDept(d) { this.dept = d; this.aberto = null; this.render(); },
  setSubst(v) { this.verSubstituidos = !!v; this.render(); },
  setVisao(v) { this.visao = v; this.render(); },
  fechar() { this.aberto = null; this.edicao = null; this.aviso = ""; this.render(); },

  async lerItens(id) {
    const fc = this.fc();
    const cab = (this.cab[this.tipo] || []).find((c) => c._id === id);
    if (!cab) return null;
    const blocos = [];
    for (let b = 0; b < (cab.blocos || 1); b++) {
      const s = await fc.getDoc(fc.doc(window.firebaseDb, this.COL[this.tipo].itens, `${id}_${b}`));
      if (s.exists()) blocos.push(s.data());
    }
    return Object.assign({ cab }, this.C().juntarBlocos(blocos));
  },

  async abrir(id) {
    this.edicao = null;
    this.carregando = true;
    this.render();
    try {
      const a = await this.lerItens(id);
      if (a && a.cab.versao_base) {
        const b = await this.lerItens(a.cab.versao_base);
        a.base = b ? b.itens : null;
        a.baseCab = b ? b.cab : null;
      }
      this.aberto = a;
    } catch (e) {
      this.erro = e.message || String(e);
    }
    this.carregando = false;
    this.render();
  },

  /* ---------- carga inicial (administrador) ---------- */

  escolher() { const i = document.getElementById("oo-arquivos"); if (i) i.click(); },

  async lerArquivos(files) {
    const C = this.C();
    const arquivos = [];
    for (const f of Array.from(files || [])) {
      try { arquivos.push(JSON.parse(await f.text())); } catch (e) { this.erro = `Arquivo ${f.name} não é JSON válido.`; }
    }
    const tabs = new Set(arquivos.map((a) => a && a.tabela));
    const precisa = ["cost_centers", "planos_financeiros", "departamentos"];
    const faltam = precisa.filter((t) => !tabs.has(t));
    const carga = [];
    ["orcamentos", "forecasts"].forEach((t) => {
      if (!tabs.has(t)) return;
      const r = C.prepararDocumentos(arquivos, t);
      carga.push(Object.assign({ tipo: t }, r));
    });
    if (!carga.length) {
      this.erro = "Escolha os arquivos da pasta .carga_orion: orcamentos.json, orcamento_itens.json, orcamento_venda_itens.json, orcamento_historico.json, forecasts.json, forecast_itens.json, forecast_venda_itens.json, cost_centers.json, planos_financeiros.json, departamentos.json, payment_plans.json e users.json.";
      return this.render();
    }
    const fc = this.fc();
    for (const c of carga) {
      const s = await fc.getDocs(fc.query(fc.collection(window.firebaseDb, this.COL[c.tipo].cab), fc.limit(1)));
      c.temDados = !s.empty;
      c.substituir = false;
      c.resultado = "";
    }
    this.carga = { faltam, itens: carga };
    this.erro = "";
    this.render();
  },

  async confirmarCarga() {
    if (!this.ehAdmin() || !this.carga) return;
    const fc = this.fc();
    this.carregando = true;
    for (const c of this.carga.itens) {
      if (c.temDados && !c.substituir) { c.resultado = "mantido (já tinha dados no Integra)"; continue; }
      const col = this.COL[c.tipo];
      try {
        const quem = window.OrionStore ? window.OrionStore.usuario() : "";
        let n = 0;
        for (const b of c.blocos) {
          const { _id, ...dados } = b;
          await fc.setDoc(fc.doc(window.firebaseDb, col.itens, _id), dados);
          c.resultado = `gravando… ${++n}/${c.blocos.length + c.cabecalhos.length}`;
          this.render();
        }
        for (const h of c.cabecalhos) {
          await fc.setDoc(fc.doc(window.firebaseDb, col.cab, h._id), Object.assign({}, h, { importado_em: new Date().toISOString(), importado_por: quem }));
          c.resultado = `gravando… ${++n}/${c.blocos.length + c.cabecalhos.length}`;
          this.render();
        }
        c.resultado = `importado: ${c.cabecalhos.length} ${c.tipo}, ${c.blocos.length} blocos de linhas`;
        this.cab[c.tipo] = null;
      } catch (e) {
        c.resultado = "parou com erro: " + (e.message || String(e)) + ". Pode clicar de novo: o que já foi gravado é regravado igual.";
      }
    }
    this.carregando = false;
    this.render();
    if (!this.cab[this.tipo]) this.carregar();
  },

  marcarSubst(i, v) { if (this.carga && this.carga.itens[i]) this.carga.itens[i].substituir = !!v; },
  fecharCarga() { this.carga = null; this.render(); },

  htmlCarga() {
    if (!this.carga) return "";
    const C = this.C();
    const feito = this.carga.itens.some((c) => c.resultado && !/^gravando/.test(c.resultado));
    const bloco = this.carga.itens.map((c, i) => {
      const linhas = c.conferencia.reduce((s, x) => s + x.linhas, 0);
      const tot = c.conferencia.reduce((s, x) => s + x.total, 0);
      const totO = c.conferencia.reduce((s, x) => s + x.total_orion, 0);
      const vgv = c.conferencia.reduce((s, x) => s + x.vgv, 0);
      const bate = tot === totO;
      return `<tr>
        <td>${c.tipo === "orcamentos" ? "Orçamentos" : "Forecasts"}</td>
        <td class="is-right">${c.cabecalhos.length}</td>
        <td class="is-right">${linhas}</td>
        <td class="is-right">${C.fmtReais(tot)}</td>
        <td class="is-right" style="color:${bate ? "#105436" : "#b91c1c"};font-weight:700">${bate ? "igual ao Órion" : "Órion: " + C.fmtReais(totO)}</td>
        <td class="is-right">${C.fmtReais(vgv)}</td>
        <td style="white-space:normal">${c.semMapa.length ? `<span style="color:#b91c1c;font-weight:700">${c.semMapa.length} linha(s) sem centro de custo ou plano</span>` : "ok"}</td>
        <td style="white-space:normal">${c.temDados ? `já tem dados <label><input type="checkbox" ${feito ? "disabled" : ""} onchange="OrionOrcamentosApp.marcarSubst(${i}, this.checked)"> substituir</label>` : "vazio"}</td>
        <td style="white-space:normal">${this.esc(c.resultado)}</td></tr>`;
    }).join("");
    return `<div style="padding:12px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;margin-bottom:12px;font-size:0.8rem">
      <b>Importar do Órion</b> — confira antes de gravar. A soma das linhas (em centavos) é comparada com o total anual gravado no Órion.
      ${this.carga.faltam.length ? `<div style="color:#b91c1c;margin-top:4px">Faltam os arquivos ${this.carga.faltam.map((t) => t + ".json").join(", ")}: sem eles as linhas ficam sem código de centro de custo, plano ou departamento.</div>` : ""}
      <div class="cc-scroll" style="margin-top:8px"><table class="cc-table">
        <colgroup><col style="width:100px"><col style="width:70px"><col style="width:80px"><col style="width:140px"><col style="width:150px"><col style="width:130px"><col><col style="width:150px"><col style="width:190px"></colgroup>
        <thead><tr><th>Tipo</th><th class="is-right">Docs</th><th class="is-right">Linhas</th><th class="is-right">Soma (R$)</th><th class="is-right">Conferência</th><th class="is-right">VGV (R$)</th><th>Correspondência</th><th>No Integra</th><th>Resultado</th></tr></thead>
        <tbody>${bloco}</tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        ${feito ? "" : `<button type="button" class="btn btn-primary" ${this.carregando ? "disabled" : ""} onclick="OrionOrcamentosApp.confirmarCarga()">Confirmar importação</button>`}
        <button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.fecharCarga()">${feito ? "Fechar" : "Cancelar"}</button>
      </div></div>`;
  },

  /* ---------- tela ---------- */

  filtrados() {
    return (this.cab[this.tipo] || []).filter((c) =>
      String(c.ano) === String(this.ano) &&
      (this.dept === "TODOS" || String(c.departamento ? c.departamento.id : "") === String(this.dept)) &&
      (this.verSubstituidos || c.status !== "Substituído"))
      .sort((a, b) => String(a.departamento ? a.departamento.nome : "").localeCompare(String(b.departamento ? b.departamento.nome : ""), "pt-BR") || (b.versao - a.versao));
  },

  htmlLista() {
    const C = this.C();
    const lista = this.filtrados();
    const fc = this.tipo === "forecasts";
    const linhas = lista.map((c) => `<tr style="cursor:pointer" onclick="OrionOrcamentosApp.abrir('${this.esc(c._id)}')">
      <td>${this.esc(c.departamento ? c.departamento.nome : "—")}</td>
      <td>${this.esc(c.produto ? c.produto.id + " - " + c.produto.nome : "")}</td>
      <td>${this.esc(c.tipo)}</td>
      ${fc ? `<td class="is-center">${c.mes_corte ? C.MESES[c.mes_corte - 1] : ""}</td>` : ""}
      <td class="is-center">V${c.versao}</td>
      <td>${this.esc(c.status)}</td>
      <td class="is-right">${c.linhas}</td>
      <td class="is-right">${C.fmtReais(c.totais ? c.totais.total : 0)}</td>
      <td class="is-right">${c.vgv ? C.fmtReais(c.vgv) : ""}</td>
      <td>${this.esc(c.criado_por)}</td></tr>`);
    const tot = lista.filter((c) => c.status !== "Substituído").reduce((s, c) => s + (c.totais ? c.totais.total : 0), 0);
    return `<div class="cc-scroll"><table class="cc-table">
      <colgroup><col style="width:180px"><col><col style="width:90px">${fc ? '<col style="width:70px">' : ""}<col style="width:60px"><col style="width:110px"><col style="width:70px"><col style="width:140px"><col style="width:130px"><col style="width:180px"></colgroup>
      <thead><tr><th>Departamento</th><th>Empreendimento</th><th>Tipo</th>${fc ? '<th class="is-center">Corte</th>' : ""}<th class="is-center">Versão</th><th>Status</th><th class="is-right">Linhas</th><th class="is-right">Total (R$)</th><th class="is-right">VGV (R$)</th><th>Criado por</th></tr></thead>
      <tbody>${linhas.length ? linhas.join("") : `<tr><td colspan="${fc ? 10 : 9}" style="text-align:center;padding:30px;">Nenhum ${fc ? "forecast" : "orçamento"} para exibir.${(this.cab[this.tipo] || []).length ? "" : " A carga do Órion ainda não foi feita."}</td></tr>`}
      ${linhas.length ? `<tr class="oo-total"><td colspan="${fc ? 7 : 6}">Total (sem versões substituídas)</td><td class="is-right">${C.fmtReais(tot)}</td><td colspan="2"></td></tr>` : ""}</tbody>
    </table></div><div style="margin-top:8px;font-size:0.72rem;color:#64748b">Clique numa linha para ver o detalhe por centro de custo, plano e mês.</div>`;
  },

  /* ---------- edição e aprovação (parte 2) ---------- */

  usuarioEmail() {
    return String((window.OrionStore && window.OrionStore.usuario()) || "").toLowerCase();
  },

  ehGestor() {
    if (this.ehAdmin()) return true;
    return typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_orion_geral_aprovar_orcamentos_acessar");
  },

  /** Pode editar: permissão de edição e ser usuário do departamento (quando o cadastro de departamentos existir). */
  podeEditarCab(cab) {
    if (!cab || !this.C().editavel(cab.status)) return false;
    if (this.ehAdmin()) return true;
    if (typeof window.hasCrmPerm !== "function" || !window.hasCrmPerm("sub_orion_geral_orcamentos_editar")) return false;
    const cad = this.cadDep;
    if (!cad || !(cad.departamentos || []).length || !cab.departamento) return true;
    const d = cad.departamentos.find((x) => String(x.id) === String(cab.departamento.id));
    return !!(d && (d.usuarios || []).indexOf(this.usuarioEmail()) >= 0);
  },

  async lerApoio() {
    try {
      const [dep, fech] = await Promise.all([
        window.OrionStore.ler("departamentos", null),
        window.OrionStore.ler("fechamento_meses", [])
      ]);
      this.cadDep = dep.itens || null;
      this.fechamento = fech.itens || [];
    } catch (e) {
      this.cadDep = null;
      this.fechamento = [];
    }
  },

  /** Meses que não podem mudar: fechados no Fechamento de meses e, no forecast, os anteriores ao mês de corte. */
  mesesTravados(cab) {
    const s = new Set(this.C().mesesFechados(this.fechamento, cab.ano));
    if (this.tipo === "forecasts" && cab.mes_corte) for (let m = 1; m < Number(cab.mes_corte); m++) s.add(m);
    return [...s].sort((x, y) => x - y);
  },

  editar() {
    const a = this.aberto;
    if (!a || !this.podeEditarCab(a.cab)) return;
    this.edicao = {
      linhas: a.itens.map((l) => Object.assign({}, l, { m: l.m.slice() }))
        .sort((x, y) => String(x.cc).localeCompare(String(y.cc), "pt-BR", { numeric: true }) || String(x.plano).localeCompare(String(y.plano), "pt-BR", { numeric: true })),
      erros: [], salvando: false
    };
    this.render();
  },

  cancelarEdicao() { this.edicao = null; this.render(); },

  setValor(i, mes, valor) {
    const e = this.edicao;
    if (!e || !e.linhas[i]) return;
    const l = e.linhas[i];
    l.m[mes] = this.C().centavos(valor);
    l.total = this.C().somaMeses(l.m);
    this.render();
  },

  removerLinha(i) {
    if (!this.edicao) return;
    this.edicao.linhas.splice(i, 1);
    this.render();
  },

  incluirLinha() {
    const e = this.edicao;
    if (!e) return;
    const cc = String((document.getElementById("oo-novo-cc") || {}).value || "").replace(/\D/g, "");
    const plano = String((document.getElementById("oo-novo-plano") || {}).value || "").replace(/\D/g, "");
    if (!cc || !plano) { e.erros = ["Informe o código do centro de custo e do plano (do Sienge)."]; return this.render(); }
    if (e.linhas.some((l) => l.cc === cc && l.plano === plano)) { e.erros = [`A combinação ${cc} + ${plano} já está no orçamento.`]; return this.render(); }
    const cad = this.cadDep || {};
    e.linhas.push({ cc, cc_nome: (cad.nomesCc || {})[cc] || "", plano, plano_nome: (cad.nomesPlano || {})[plano] || "", m: new Array(12).fill(0), total: 0, obs: "" });
    e.erros = [];
    this.render();
  },

  grupo(cab) {
    return (this.cab[this.tipo] || []).filter((c) => c.ano === cab.ano && c.tipo === cab.tipo && c.descricao === cab.descricao &&
      c.status !== "Substituído" && String(c.departamento ? c.departamento.id : "") === String(cab.departamento ? cab.departamento.id : ""));
  },

  async salvarEdicao() {
    const C = this.C();
    const a = this.aberto;
    const e = this.edicao;
    if (!a || !e || !this.podeEditarCab(a.cab)) return;
    const fechados = this.mesesTravados(a.cab);
    e.erros = C.validarLinhas(e.linhas, a.itens, {
      fechados,
      cadDepartamentos: this.cadDep && (this.cadDep.departamentos || []).length ? this.cadDep : null,
      departamentoId: a.cab.departamento ? a.cab.departamento.id : null
    });
    if (e.erros.length) return this.render();
    e.salvando = true;
    this.render();
    const fc = this.fc();
    const col = this.COL[this.tipo];
    const id = a.cab._id;
    const novos = C.emBlocos(id, col.ref, e.linhas, a.vendas);
    const quem = this.usuarioEmail();
    try {
      const cabNovo = await fc.runTransaction(window.firebaseDb, async (tx) => {
        const ref = fc.doc(window.firebaseDb, col.cab, id);
        const s = await tx.get(ref);
        if (!s.exists()) throw new Error("Este orçamento não existe mais no Integra.");
        const atual = s.data();
        if ((Number(atual.rev) || 0) !== (Number(a.cab.rev) || 0)) throw new Error(`Este orçamento foi alterado por ${atual.alterado_por || "outra pessoa"} depois que você abriu. Volte à lista, abra de novo e refaça.`);
        if (!C.editavel(atual.status)) throw new Error(`O orçamento está "${atual.status}" e não pode ser editado.`);
        for (const b of novos) { const { _id, ...dados } = b; tx.set(fc.doc(window.firebaseDb, col.itens, _id), dados); }
        for (let b = novos.length; b < (Number(atual.blocos) || 1); b++) tx.delete(fc.doc(window.firebaseDb, col.itens, `${id}_${b}`));
        const n = Object.assign({}, atual, {
          totais: C.somarLinhas(e.linhas), linhas: e.linhas.length, blocos: novos.length,
          rev: (Number(atual.rev) || 0) + 1, alterado_por: quem, alterado_em: new Date().toISOString()
        });
        tx.set(ref, n);
        return n;
      });
      const i = (this.cab[this.tipo] || []).findIndex((c) => c._id === id);
      if (i >= 0) this.cab[this.tipo][i] = cabNovo;
      a.cab = cabNovo;
      a.itens = e.linhas;
      this.edicao = null;
      this.aviso = "Orçamento salvo.";
    } catch (err) {
      e.salvando = false;
      e.erros = [err.message || String(err)];
    }
    this.render();
  },

  async mudarStatus(para) {
    const C = this.C();
    const a = this.aberto;
    if (!a) return;
    let trans;
    try { trans = C.resolverTransicao(a.cab.status, para); } catch (err) { this.erro = err.message; return this.render(); }
    if (C.ACOES_GESTOR.indexOf(trans.acao) >= 0 && !this.ehGestor()) { this.erro = "Sem permissão para aprovar ou rejeitar."; return this.render(); }
    if (trans.acao !== "solicitar_reabertura" && C.ACOES_GESTOR.indexOf(trans.acao) < 0 && !this.podeEditarCab(Object.assign({}, a.cab, { status: "Rascunho" }))) {
      this.erro = "Sem permissão para enviar este orçamento."; return this.render();
    }
    let motivo = "";
    if (trans.acao === "solicitar_reabertura") {
      motivo = (window.prompt("Motivo da solicitação de reabertura:") || "").trim();
      if (!motivo) { this.erro = "Informe o motivo da solicitação de reabertura."; return this.render(); }
    } else if (!window.confirm(`Confirmar: ${a.cab.status} → ${trans.destino}?`)) return;
    const fc = this.fc();
    const col = this.COL[this.tipo];
    const quem = this.usuarioEmail();
    const agora = new Date().toISOString();
    const alvos = this.grupo(a.cab).length ? this.grupo(a.cab) : [a.cab];
    this.carregando = true;
    this.render();
    try {
      for (const alvo of alvos) {
        if (trans.acao === "aprovar_reabertura") {
          /* Igual ao Órion: guarda uma cópia fechada (Substituído) antes de reabrir. */
          const copia = await this.lerItens(alvo._id);
          const snapId = `${alvo._id}_fechado_${Date.now()}`;
          for (const b of C.emBlocos(snapId, col.ref, copia.itens, copia.vendas)) { const { _id, ...d } = b; await fc.setDoc(fc.doc(window.firebaseDb, col.itens, _id), d); }
          await fc.setDoc(fc.doc(window.firebaseDb, col.cab, snapId), Object.assign({}, copia.cab, { _id: snapId, status: "Substituído", versao_base: alvo._id, historico: [], copia_de: alvo._id, copiado_em: agora }));
        }
        await fc.runTransaction(window.firebaseDb, async (tx) => {
          const ref = fc.doc(window.firebaseDb, col.cab, alvo._id);
          const s = await tx.get(ref);
          const atual = s.data();
          C.resolverTransicao(atual.status, para); // confere de novo com o que está no banco
          const n = Object.assign({}, atual, {
            status: trans.destino,
            motivo_reabertura: trans.acao === "solicitar_reabertura" ? motivo : (trans.acao === "recusar_reabertura" ? "" : atual.motivo_reabertura || ""),
            historico: (atual.historico || []).concat([{ de: atual.status, para: trans.destino, por: quem, em: agora, motivo: motivo || (trans.acao === "aprovar_reabertura" ? atual.motivo_reabertura || "" : "") }]),
            rev: (Number(atual.rev) || 0) + 1, alterado_por: quem, alterado_em: agora
          });
          tx.set(ref, n);
        });
      }
      this.cab[this.tipo] = null;
      await this.carregar();
      await this.abrir(a.cab._id);
      this.aviso = `Status alterado para ${trans.destino}${alvos.length > 1 ? ` (${alvos.length} documentos do mesmo orçamento)` : ""}.`;
    } catch (err) {
      this.erro = err.message || String(err);
    }
    this.carregando = false;
    this.render();
  },

  htmlEdicao() {
    const C = this.C();
    const a = this.aberto;
    const e = this.edicao;
    const fechados = this.mesesTravados(a.cab);
    const linhas = e.linhas.map((l, i) => `<tr>
      <td style="white-space:normal">${this.esc(l.cc)} ${this.esc(l.cc_nome)}<br><small>${this.esc(l.plano)} ${this.esc(l.plano_nome)}</small></td>
      ${l.m.map((v, mi) => `<td><input class="oo-num" ${fechados.indexOf(mi + 1) >= 0 ? "disabled title=\"mês fechado\"" : ""} value="${v ? C.fmtReais(v) : ""}" onchange="OrionOrcamentosApp.setValor(${i}, ${mi}, this.value)"></td>`).join("")}
      <td class="is-right"><b>${C.fmtReais(l.total)}</b></td>
      <td class="is-center"><button type="button" class="op-del" style="border:none;background:none;color:#b91c1c;cursor:pointer" title="Remover linha" onclick="OrionOrcamentosApp.removerLinha(${i})">✕</button></td></tr>`).join("");
    const tot = C.somarLinhas(e.linhas);
    return `
      ${e.erros.length ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:8px">${e.erros.map((x) => this.esc(x)).join("<br>")}</div>` : ""}
      <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;flex-wrap:wrap">
        <div><label class="ml-emp-filter-label">Centro de custo (código)</label><input id="oo-novo-cc" class="idx-select" style="height:36px;width:150px"></div>
        <div><label class="ml-emp-filter-label">Plano (código)</label><input id="oo-novo-plano" class="idx-select" style="height:36px;width:150px"></div>
        <button type="button" class="btn btn-secondary" style="height:36px" onclick="OrionOrcamentosApp.incluirLinha()">Incluir linha</button>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button type="button" class="btn btn-secondary" style="height:36px" onclick="OrionOrcamentosApp.cancelarEdicao()">Cancelar</button>
          <button type="button" class="btn btn-primary" style="height:36px" ${e.salvando ? "disabled" : ""} onclick="OrionOrcamentosApp.salvarEdicao()">${e.salvando ? "Salvando..." : "Salvar orçamento"}</button>
        </div>
      </div>
      ${fechados.length ? `<div style="font-size:0.72rem;color:#64748b;margin-bottom:6px">Meses travados (fechados${this.tipo === "forecasts" && a.cab.mes_corte ? " ou antes do corte" : ""}): ${fechados.map((m) => C.MESES[m - 1]).join(", ")}.</div>` : ""}
      <div class="cc-scroll"><table class="cc-table" style="min-width:1440px">
        <colgroup><col style="width:240px">${C.MESES.map(() => '<col style="width:88px">').join("")}<col style="width:110px"><col style="width:34px"></colgroup>
        <thead><tr><th>Centro de custo / plano</th>${C.MESES.map((m) => `<th class="is-right">${m}</th>`).join("")}<th class="is-right">Total</th><th></th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="15" style="text-align:center;padding:30px">Sem linhas. Inclua acima.</td></tr>`}
        <tr class="oo-total"><td>Total</td>${tot.m.map((v) => `<td class="is-right">${C.fmtReais(v, true)}</td>`).join("")}<td class="is-right">${C.fmtReais(tot.total)}</td><td></td></tr></tbody>
      </table></div>`;
  },

  htmlAcoes() {
    const C = this.C();
    const cab = this.aberto.cab;
    const botoes = [];
    if (!this.edicao && this.podeEditarCab(cab)) botoes.push(`<button type="button" class="btn btn-primary" style="height:32px" onclick="OrionOrcamentosApp.editar()">Editar</button>`);
    if (!this.edicao) {
      C.acoesDoStatus(cab.status).forEach((x) => {
        const gestor = C.ACOES_GESTOR.indexOf(x.acao) >= 0;
        const pode = gestor ? this.ehGestor() : (x.acao === "solicitar_reabertura" ? true : this.podeEditarCab(Object.assign({}, cab, { status: "Rascunho" })));
        if (pode) botoes.push(`<button type="button" class="btn ${x.acao === "aprovar" || x.acao === "aprovar_reabertura" ? "btn-primary" : "btn-secondary"}" style="height:32px" onclick="OrionOrcamentosApp.mudarStatus('${this.esc(x.para)}')">${this.esc(x.rotulo)}</button>`);
      });
    }
    return botoes.join("");
  },

  htmlDetalhe() {
    const C = this.C();
    const a = this.aberto;
    const campo = this.visao === "cc" ? "cc" : "plano";
    const nome = this.visao === "cc" ? "cc_nome" : "plano_nome";
    const sub = this.visao === "cc" ? "plano" : "cc";
    const subNome = this.visao === "cc" ? "plano_nome" : "cc_nome";
    const grupos = C.agrupar(a.itens, campo, nome);
    const cel = (v) => `<td class="is-right">${v ? C.fmtReais(v, true) : ""}</td>`;
    const corpo = grupos.map((g) => {
      const filhos = a.itens.filter((l) => (l[campo] || "") === g.chave)
        .sort((x, y) => String(x[sub]).localeCompare(String(y[sub]), "pt-BR", { numeric: true }))
        .map((l) => `<tr><td style="padding-left:18px">${this.esc(l[sub])} ${this.esc(l[subNome])}</td>${l.m.map(cel).join("")}<td class="is-right"><b>${C.fmtReais(l.total, true)}</b></td></tr>`).join("");
      return `<tr class="oo-grupo"><td>${this.esc(g.chave)} ${this.esc(g.nome)}</td>${g.m.map(cel).join("")}<td class="is-right">${C.fmtReais(g.total, true)}</td></tr>${filhos}`;
    }).join("");
    const tot = C.somarLinhas(a.itens);
    const cab = a.cab;
    let dif = "";
    if (a.base) {
      const d = C.diferencaVersoes(a.itens, a.base).slice(0, 30);
      dif = `<div style="margin:14px 0 6px;font-weight:800;color:#105436">Diferença para a V${a.baseCab ? a.baseCab.versao : "?"} (maiores 30)</div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col><col><col style="width:140px"><col style="width:140px"><col style="width:140px"></colgroup>
        <thead><tr><th>Centro de custo</th><th>Plano</th><th class="is-right">V${a.baseCab ? a.baseCab.versao : "?"}</th><th class="is-right">V${cab.versao}</th><th class="is-right">Diferença</th></tr></thead>
        <tbody>${d.length ? d.map((x) => `<tr><td>${this.esc(x.cc)} ${this.esc(x.cc_nome)}</td><td>${this.esc(x.plano)} ${this.esc(x.plano_nome)}</td><td class="is-right">${C.fmtReais(x.base, true)}</td><td class="is-right">${C.fmtReais(x.atual, true)}</td><td class="is-right" style="color:${x.dif < 0 ? "#b91c1c" : "#105436"}">${C.fmtReais(x.dif, true)}</td></tr>`).join("") : `<tr><td colspan="5" style="text-align:center;padding:20px">Sem diferença.</td></tr>`}</tbody></table></div>`;
    } else if (cab.versao_base) {
      dif = `<div style="margin-top:8px;font-size:0.72rem;color:#64748b">A versão anterior (${this.esc(cab.versao_base)}) não está no Integra.</div>`;
    }
    const hist = (cab.historico || []).length ? `<div style="margin:14px 0 6px;font-weight:800;color:#105436">Histórico de aprovação</div>
      <div class="cc-scroll"><table class="cc-table"><colgroup><col style="width:170px"><col style="width:130px"><col style="width:130px"><col style="width:220px"><col></colgroup>
      <thead><tr><th>Quando</th><th>De</th><th>Para</th><th>Quem</th><th>Motivo</th></tr></thead>
      <tbody>${cab.historico.map((h) => `<tr><td>${this.esc(h.em ? new Date(h.em).toLocaleString("pt-BR") : "")}</td><td>${this.esc(h.de)}</td><td>${this.esc(h.para)}</td><td>${this.esc(h.por)}</td><td style="white-space:normal">${this.esc(h.motivo)}</td></tr>`).join("")}</tbody></table></div>` : "";
    return `
      <div class="ppcc-head idx-head">
        <div><div class="ppcc-titulo">${this.esc(cab.descricao)} · V${cab.versao} · ${this.esc(cab.status)}</div>
        <div class="ppcc-sub">${this.esc(cab.departamento ? cab.departamento.nome : "")}${cab.produto ? " · " + this.esc(cab.produto.id + " " + cab.produto.nome) : ""}${cab.mes_corte ? " · corte em " + C.MESES[cab.mes_corte - 1] : ""} · ${a.itens.length} linhas</div></div>
        <div class="ppcc-kpis">
          <div class="ppcc-kpi"><span class="ppcc-kpi-rot">Total do ano (R$)</span><span class="ppcc-kpi-val">${C.fmtReais(tot.total)}</span></div>
          ${cab.vgv ? `<div class="ppcc-kpi"><span class="ppcc-kpi-rot">VGV</span><span class="ppcc-kpi-val">${C.fmtReais(cab.vgv, true)}</span></div>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        ${this.htmlAcoes()}
        ${cab.motivo_reabertura ? `<span style="align-self:center;font-size:0.75rem;color:#92400e">Motivo da reabertura: ${this.esc(cab.motivo_reabertura)}</span>` : ""}
      </div>
      ${this.edicao ? this.htmlEdicao() + dif + hist : `
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button type="button" class="btn ${this.visao === "cc" ? "btn-primary" : "btn-secondary"}" style="height:32px" onclick="OrionOrcamentosApp.setVisao('cc')">Por centro de custo</button>
        <button type="button" class="btn ${this.visao === "plano" ? "btn-primary" : "btn-secondary"}" style="height:32px" onclick="OrionOrcamentosApp.setVisao('plano')">Por plano</button>
        <button type="button" class="btn btn-secondary" style="height:32px;margin-left:auto" onclick="OrionOrcamentosApp.fechar()">Voltar à lista</button>
      </div>
      <div class="cc-scroll"><table class="cc-table" style="min-width:1372px">
        <colgroup><col style="width:260px">${C.MESES.map(() => '<col style="width:84px">').join("")}<col style="width:104px"></colgroup>
        <thead><tr><th>${this.visao === "cc" ? "Centro de custo / plano" : "Plano / centro de custo"}</th>${C.MESES.map((m) => `<th class="is-right">${m}</th>`).join("")}<th class="is-right">Total</th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="14" style="text-align:center;padding:30px">Sem linhas.</td></tr>`}
        <tr class="oo-total"><td>Total</td>${tot.m.map((v) => `<td class="is-right">${C.fmtReais(v, true)}</td>`).join("")}<td class="is-right">${C.fmtReais(tot.total, true)}</td></tr></tbody>
      </table></div>${dif}${hist}`}`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    const lista = this.cab[this.tipo] || [];
    const anos = [...new Set(lista.map((c) => c.ano))].sort((a, b) => b - a);
    const depts = new Map();
    lista.filter((c) => String(c.ano) === String(this.ano) && c.departamento).forEach((c) => depts.set(String(c.departamento.id), c.departamento.nome));
    const barra = `
      <div style="display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px" class="oo-barra">
        <div style="display:flex;gap:6px">
          <button type="button" class="btn ${this.tipo === "orcamentos" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionOrcamentosApp.setTipo('orcamentos')">Orçamentos</button>
          <button type="button" class="btn ${this.tipo === "forecasts" ? "btn-primary" : "btn-secondary"}" style="height:40px" onclick="OrionOrcamentosApp.setTipo('forecasts')">Forecasts</button>
        </div>
        <div><label class="ml-emp-filter-label">Ano</label><select class="idx-select" style="height:40px" onchange="OrionOrcamentosApp.setAno(this.value)">${anos.map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
        <div><label class="ml-emp-filter-label">Departamento</label><select class="idx-select" style="height:40px;min-width:220px" onchange="OrionOrcamentosApp.setDept(this.value)"><option value="TODOS">Todos</option>${[...depts.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([id, n]) => `<option value="${this.esc(id)}" ${id === String(this.dept) ? "selected" : ""}>${this.esc(n)}</option>`).join("")}</select></div>
        <label style="display:flex;align-items:center;gap:6px;height:40px;font-size:0.8rem"><input type="checkbox" ${this.verSubstituidos ? "checked" : ""} onchange="OrionOrcamentosApp.setSubst(this.checked)"> Mostrar versões substituídas</label>
        <div style="margin-left:auto;display:flex;gap:8px">
          ${this.ehAdmin() ? `<button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionOrcamentosApp.escolher()">Importar do Órion</button><input type="file" id="oo-arquivos" accept=".json" multiple style="display:none" onchange="OrionOrcamentosApp.lerArquivos(this.files)">` : ""}
          <button type="button" class="btn btn-primary cc-atualizar" style="height:40px" ${this.carregando ? "disabled" : ""} onclick="OrionOrcamentosApp.carregar()">Atualizar</button>
        </div>
      </div>`;
    let corpo;
    if (this.carregando && !this.aberto && !this.cab[this.tipo]) corpo = `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>`;
    else corpo = this.aberto ? this.htmlDetalhe() : this.htmlLista();
    root.innerHTML = `${barra}
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.htmlCarga()}
      <div style="padding:8px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;margin-bottom:12px;font-size:0.75rem">Tela de transição: orçamentos e forecasts trazidos do Órion. Enquanto o Órion estiver em uso, combine com a equipe em qual dos dois sistemas cada orçamento será editado, para não haver duas versões.</div>
      ${this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : ""}
      ${corpo}`;
    if (window.lucide) window.lucide.createIcons();
  }
};

window.OrionOrcamentosApp = OrionOrcamentosApp;
