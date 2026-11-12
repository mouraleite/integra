/* Órion (transição) › Orçamentos e forecasts — grade de edição mês a mês, no jeito do Órion:
 * - linhas agrupadas por empreendimento (centro de custo), com total do grupo e botão para recolher/abrir;
 * - incluir linha escolhendo empreendimento e plano por nome ou código (lista com busca), direto no grupo;
 * - "replicar para a direita" em cada mês, observação (nota) por linha, excluir linha ou o empreendimento inteiro;
 * - busca nas linhas, destaque do que mudou em relação à versão anterior;
 * - digitar não redesenha a tela (o cursor não se perde): os totais se atualizam na hora;
 *   Enter desce para a linha de baixo; colar do Excel (vários valores) preenche para a direita e para baixo.
 * Só muda a tela de edição; a gravação continua em salvarEdicao() (mesmas validações e conferência de versão). */
Object.assign(window.OrionOrcamentosApp, {
  estilosGrade() {
    if (document.getElementById("og-estilos")) return;
    const st = document.createElement("style");
    st.id = "og-estilos";
    st.textContent = `
      .cc-table td.og-cel { position:relative; padding:2px 3px !important; }
      .cc-table td.og-cel .og-rep { position:absolute; right:-6px; top:50%; transform:translateY(-50%); display:none; z-index:2; border:1px solid #bbf7d0; background:#ecfdf5; color:#105436; border-radius:50%; width:18px; height:18px; font-size:10px; line-height:16px; padding:0; cursor:pointer; }
      .cc-table td.og-cel:hover .og-rep { display:block; }
      .cc-table td.og-dif input { background:#fef9c3 !important; border-color:#facc15 !important; }
      .cc-table tr.og-grupo td { background:#e7f6ee !important; color:#105436 !important; font-weight:700; }
      .cc-table tr.og-grupo td .og-acoes button { height:24px; padding:0 8px; font-size:0.68rem; margin-left:4px; }
      .cc-table input.og-obs { width:100%; box-sizing:border-box; height:24px; border:1px solid #e2e8f0; border-radius:5px; padding:0 4px; font-size:0.68rem; }
      .og-barra input, .og-barra select, .og-barra .btn { height:40px; box-sizing:border-box; }
    `;
    document.head.appendChild(st);
  },

  /** Abre a edição já com a grade nova (busca vazia, todos os grupos abertos). */
  editar() {
    const a = this.aberto;
    if (!a || !this.podeEditarCab(a.cab)) return;
    const ehVendas = String(a.cab.tipo || "").toUpperCase() === "VENDAS";
    this.edicao = {
      modo: ehVendas ? "vendas" : "mensal",
      grade: ehVendas ? this.C().vendasParaGrade(a.vendas) : null,
      linhas: a.itens.map((l) => Object.assign({}, l, { m: l.m.slice() }))
        .sort((x, y) => String(x.cc).localeCompare(String(y.cc), "pt-BR", { numeric: true }) || String(x.plano).localeCompare(String(y.plano), "pt-BR", { numeric: true })),
      erros: [], salvando: false, busca: "", recolhidos: {}, novoCc: "", novoPlano: ""
    };
    this.render();
  },

  baseMap() {
    const a = this.aberto;
    const m = new Map();
    ((a && a.base) || []).forEach((l) => m.set(String(l.cc).replace(/\D/g, "") + "|" + String(l.plano).replace(/\D/g, ""), l));
    return m;
  },

  /** Lista de planos para escolher: os do departamento no cadastro; sem lista, todos os planos conhecidos. */
  planosParaEscolher() {
    const cad = this.cadDep || {};
    const nomes = cad.nomesPlano || {};
    const cab = this.aberto && this.aberto.cab;
    const d = cab && cab.departamento ? (cad.departamentos || []).find((x) => String(x.id) === String(cab.departamento.id)) : null;
    const lista = d && (d.planos || []).length ? d.planos : Object.keys(nomes);
    return lista.slice().sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).map((p) => ({ id: p, nome: nomes[p] || "" }));
  },
  ccsParaEscolher() {
    const cad = this.cadDep || {};
    const nomes = cad.nomesCc || {};
    const cab = this.aberto && this.aberto.cab;
    const d = cab && cab.departamento ? (cad.departamentos || []).find((x) => String(x.id) === String(cab.departamento.id)) : null;
    const set = new Set(d && (d.ccs || []).length ? d.ccs : Object.keys(nomes));
    (this.edicao ? this.edicao.linhas : []).forEach((l) => set.add(String(l.cc)));
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })).map((c) => ({ id: c, nome: nomes[c] || "" }));
  },

  /** Valor digitado: atualiza a linha e os totais na tela, sem redesenhar a grade (o cursor fica onde está). */
  setValor(i, mes, valor) {
    const e = this.edicao;
    if (!e || !e.linhas[i]) return;
    const C = this.C();
    const l = e.linhas[i];
    l.m[mes] = C.centavosDigitado(valor);
    l.total = C.somaMeses(l.m);
    this.atualizarTotais(i);
    const inp = document.querySelector(`#og-grade input[data-i="${i}"][data-m="${mes}"]`);
    if (inp) inp.value = l.m[mes] ? C.fmtReais(l.m[mes]) : "";
    this.marcarDif(i, mes);
  },

  setObs(i, v) { const e = this.edicao; if (e && e.linhas[i]) e.linhas[i].obs = String(v || ""); },

  atualizarTotais(i) {
    const C = this.C(), e = this.edicao;
    const l = e.linhas[i];
    const put = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = C.fmtReais(v, true); };
    put(`og-t-${i}`, l.total);
    const doGrupo = e.linhas.filter((x) => x.cc === l.cc);
    const g = C.somarLinhas(doGrupo);
    g.m.forEach((v, m) => put(`og-g-${l.cc}-${m}`, v));
    put(`og-gt-${l.cc}`, g.total);
    const t = C.somarLinhas(e.linhas);
    t.m.forEach((v, m) => put(`og-f-${m}`, v));
    put("og-ft", t.total);
  },

  marcarDif(i, mes) {
    const l = this.edicao.linhas[i];
    const b = this.baseMap().get(String(l.cc).replace(/\D/g, "") + "|" + String(l.plano).replace(/\D/g, ""));
    const td = document.querySelector(`#og-grade td[data-c="${i}-${mes}"]`);
    if (!td || !this.aberto.base) return;
    const antes = b ? Number(b.m[mes]) || 0 : 0;
    td.classList.toggle("og-dif", antes !== (Number(l.m[mes]) || 0));
    td.title = antes !== (Number(l.m[mes]) || 0) ? `Versão anterior: ${this.C().fmtReais(antes, true)}` : "";
  },

  replicar(i, mes) {
    const e = this.edicao;
    if (!e || !e.linhas[i]) return;
    const trav = this.mesesTravados(this.aberto.cab);
    const l = e.linhas[i];
    const alvo = [];
    for (let m = mes + 1; m < 12; m++) if (trav.indexOf(m + 1) < 0) alvo.push(m);
    if (!alvo.length) return;
    if (alvo.some((m) => l.m[m]) && !window.confirm("Existem valores já preenchidos nos meses seguintes. Deseja sobrescrever?")) return;
    alvo.forEach((m) => this.setValor(i, m, this.C().fmtReais(l.m[mes])));
  },

  /** Colar do Excel: valores separados por tabulação (colunas = meses) e quebra de linha (linhas visíveis de baixo). */
  colar(ev, i, mes) {
    const txt = (ev.clipboardData || window.clipboardData).getData("text");
    if (!/[\t\n]/.test(String(txt || "").trim())) return; // um valor só: deixa o navegador colar normal
    ev.preventDefault();
    const trav = this.mesesTravados(this.aberto.cab);
    const visiveis = [...document.querySelectorAll("#og-grade tr[data-linha]")].map((tr) => Number(tr.getAttribute("data-linha")));
    const ini = visiveis.indexOf(i);
    String(txt).replace(/\r/g, "").replace(/\n$/, "").split("\n").forEach((linha, r) => {
      const li = visiveis[ini + r];
      if (li == null) return;
      linha.split("\t").forEach((v, c) => {
        const m = mes + c;
        if (m < 12 && trav.indexOf(m + 1) < 0) this.setValor(li, m, v);
      });
    });
  },

  /** Enter desce para a mesma coluna da linha de baixo; Shift+Enter sobe. */
  tecla(ev, i, mes) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    ev.target.dispatchEvent(new Event("change"));
    const visiveis = [...document.querySelectorAll("#og-grade tr[data-linha]")].map((tr) => Number(tr.getAttribute("data-linha")));
    const p = visiveis.indexOf(i) + (ev.shiftKey ? -1 : 1);
    if (p < 0 || p >= visiveis.length) return;
    const prox = document.querySelector(`#og-grade input[data-i="${visiveis[p]}"][data-m="${mes}"]`);
    if (prox && !prox.disabled) { prox.focus(); prox.select(); }
  },

  setBuscaGrade(v) {
    const e = this.edicao;
    if (!e) return;
    e.busca = v;
    const q = String(v || "").trim().toLowerCase();
    document.querySelectorAll("#og-grade tr[data-linha]").forEach((tr) => {
      const l = e.linhas[Number(tr.getAttribute("data-linha"))];
      const txt = `${l.cc} ${l.cc_nome} ${l.plano} ${l.plano_nome} ${l.obs || ""}`.toLowerCase();
      tr.style.display = !q || txt.indexOf(q) >= 0 ? (e.recolhidos[l.cc] ? "none" : "") : "none";
    });
  },

  alternarGrupo(cc) { const e = this.edicao; if (!e) return; e.recolhidos[cc] = !e.recolhidos[cc]; this.render(); },
  todosGrupos(fechar) { const e = this.edicao; if (!e) return; e.recolhidos = {}; if (fechar) e.linhas.forEach((l) => { e.recolhidos[l.cc] = true; }); this.render(); },

  prepararLinhaDoGrupo(cc) {
    const e = this.edicao;
    if (!e) return;
    e.novoCc = cc;
    this.render();
    const p = document.getElementById("oo-novo-plano");
    if (p) p.focus();
  },

  incluirLinha() {
    const e = this.edicao;
    if (!e) return;
    const dig = (id) => String(((document.getElementById(id) || {}).value || "")).split(" - ")[0].replace(/\D/g, "");
    const cc = dig("oo-novo-cc"), plano = dig("oo-novo-plano");
    e.novoCc = cc;
    if (!cc || !plano) { e.erros = ["Escolha o empreendimento e o plano (digite o código ou parte do nome e escolha na lista)."]; return this.render(); }
    if (e.linhas.some((l) => String(l.cc) === cc && String(l.plano) === plano)) { e.erros = [`Esta combinação empreendimento ${cc} + plano ${plano} já está no orçamento.`]; return this.render(); }
    const cad = this.cadDep || {};
    const nova = { cc, cc_nome: (cad.nomesCc || {})[cc] || (e.linhas.find((l) => l.cc === cc) || {}).cc_nome || "", plano, plano_nome: (cad.nomesPlano || {})[plano] || "", m: new Array(12).fill(0), total: 0, obs: "" };
    // entra logo depois das linhas do mesmo empreendimento
    let pos = -1;
    e.linhas.forEach((l, k) => { if (l.cc === cc) pos = k; });
    if (pos < 0) e.linhas.push(nova); else e.linhas.splice(pos + 1, 0, nova);
    e.recolhidos[cc] = false;
    e.erros = [];
    this.render();
    const p = document.getElementById("oo-novo-plano");
    if (p) p.focus();
  },

  removerLinha(i) {
    const e = this.edicao;
    if (!e || !e.linhas[i]) return;
    const l = e.linhas[i];
    if (l.total && !window.confirm(`Remover a linha ${l.plano} ${l.plano_nome} (total ${this.C().fmtReais(l.total, true)})?`)) return;
    e.linhas.splice(i, 1);
    this.render();
  },

  removerEmpreendimento(cc) {
    const e = this.edicao;
    if (!e) return;
    const n = e.linhas.filter((l) => l.cc === cc).length;
    if (!window.confirm(`Excluir o empreendimento ${cc} deste documento (${n} linha(s))? Só vale depois de Salvar.`)) return;
    e.linhas = e.linhas.filter((l) => l.cc !== cc);
    this.render();
  },

  /* ---------- Excel (Órion: Importação / Exportação Excel — baixar modelo, exportar, importar tudo ou nada) ---------- */
  excelAlternar() { const e = this.edicao; if (!e) return; e.excel = e.excel ? null : { erros: [], linhas: null, arquivo: "" }; this.render(); },
  excelNome(sufixo) { const a = this.aberto.cab; return `${sufixo}_${String(a.tipo || "").toLowerCase()}_${a.ano}${a.versao ? "_v" + a.versao : ""}.xlsx`; },
  excelBaixar(matriz, nome) {
    if (typeof XLSX === "undefined") { this.edicao.erros = ["O gerador de Excel não carregou. Recarregue a página."]; return this.render(); }
    const ws = XLSX.utils.aoa_to_sheet(matriz);
    ws["!cols"] = [{ wch: 40 }, { wch: 36 }].concat(new Array(12).fill({ wch: 12 })).concat([{ wch: 30 }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orcamento");
    XLSX.writeFile(wb, nome);
  },
  excelModelo() { this.excelBaixar(this.C().planilhaMensal([]), this.excelNome("modelo")); },
  excelExportar() { this.excelBaixar(this.C().planilhaMensal(this.edicao.linhas), this.excelNome("orcamento")); },
  /** Cadastro para validar a planilha: todos os empreendimentos e planos conhecidos; a autorização do departamento é a regra V04. */
  excelCadastro() {
    const cad = this.cadDep || {};
    const ccs = new Map(), planos = new Map();
    Object.entries(cad.nomesCc || {}).forEach(([k, n]) => ccs.set(String(k), { id: String(k), nome: n }));
    ((window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || []).forEach((c) => { const k = String(c.id); if (!ccs.has(k)) ccs.set(k, { id: k, nome: c.name || c.nome || "" }); });
    Object.entries(cad.nomesPlano || {}).forEach(([k, n]) => planos.set(String(k), { id: String(k), nome: n }));
    (this.edicao.linhas || []).concat(this.aberto.itens || []).forEach((l) => { if (!ccs.has(String(l.cc))) ccs.set(String(l.cc), { id: String(l.cc), nome: l.cc_nome || "" }); if (!planos.has(String(l.plano))) planos.set(String(l.plano), { id: String(l.plano), nome: l.plano_nome || "" }); });
    const cab = this.aberto.cab, C = this.C();
    const d = cab && cab.departamento ? (cad.departamentos || []).find((x) => String(x.id) === String(cab.departamento.id)) : null;
    const permitido = d && (d.planos || []).length ? (cc, pl) => C.lancamentoPermitido(cad, d.id, cc, pl) : null;
    return { ccs: [...ccs.values()], planos: [...planos.values()], permitido };
  },
  async excelImportar(input) {
    const e = this.edicao, f = input.files && input.files[0];
    input.value = "";
    if (!e || !f) return;
    if (typeof XLSX === "undefined") { e.excel.erros = [{ linha: "", campo: "", codigo: "", mensagem: "O leitor de Excel não carregou. Recarregue a página." }]; return this.render(); }
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      const r = this.C().validarPlanilhaMensal(m, this.excelCadastro());
      e.excel = { erros: r.erros, linhas: r.erros.length ? null : r.linhas, arquivo: f.name };
    } catch (err) { e.excel = { erros: [{ linha: "", campo: "", codigo: "", mensagem: "Não consegui ler o arquivo: " + (err.message || err) }], linhas: null, arquivo: f.name }; }
    this.render();
  },
  excelAplicar() {
    const e = this.edicao;
    if (!e || !e.excel || !e.excel.linhas) return;
    const trav = this.mesesTravados(this.aberto.cab);
    const atual = new Map(e.linhas.map((l) => [String(l.cc) + "|" + String(l.plano), l]));
    // meses travados (fechados) continuam com o valor de hoje, como na digitação
    const novas = e.excel.linhas.map((l) => { const x = atual.get(l.cc + "|" + l.plano); const m = l.m.map((v, i) => (trav.indexOf(i + 1) >= 0 ? (x ? x.m[i] : 0) : v)); return Object.assign({}, x || {}, l, { m, total: this.C().somaMeses(m) }); });
    e.linhas = novas.sort((x, y) => String(x.cc).localeCompare(String(y.cc), "pt-BR", { numeric: true }) || String(x.plano).localeCompare(String(y.plano), "pt-BR", { numeric: true }));
    const n = novas.length;
    e.excel = null;
    e.aviso = `Planilha aplicada na grade: ${n} linha(s). Confira e clique em Salvar para gravar (nada foi gravado ainda).`;
    this.render();
  },
  htmlExcel() {
    const e = this.edicao, x = e.excel;
    if (!x) return "";
    const C = this.C();
    const tot = x.linhas ? C.somarLinhas(x.linhas).total : 0;
    return `<div style="border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#f8fafc">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="color:#105436">Importação / exportação Excel</b><button type="button" class="btn btn-secondary" style="height:30px" onclick="OrionOrcamentosApp.excelAlternar()">Fechar</button></div>
      <div style="font-size:0.75rem;color:#475569;margin-bottom:8px">1. Baixe o modelo (ou exporte a versão atual) · 2. Preencha: produto e plano por código ou nome, valores de jan a dez em reais, observação · 3. Envie o arquivo: o sistema valida sem gravar · 4. Sem erros, aplique na grade e clique em Salvar. Tudo ou nada: com qualquer erro, nenhuma linha entra.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-secondary" style="height:36px" onclick="OrionOrcamentosApp.excelModelo()">Baixar modelo</button>
        <button type="button" class="btn btn-secondary" style="height:36px" onclick="OrionOrcamentosApp.excelExportar()">Exportar versão atual</button>
        <label class="btn btn-primary" style="height:36px;display:inline-flex;align-items:center;cursor:pointer;margin:0">Enviar planilha (.xlsx)<input type="file" accept=".xlsx,.xls" style="display:none" onchange="OrionOrcamentosApp.excelImportar(this)"></label>
        ${x.arquivo ? `<span style="font-size:0.75rem;color:#334155">${this.esc(x.arquivo)}</span>` : ""}</div>
      ${x.erros.length ? `<div style="margin-top:8px;color:#991b1b;font-size:0.78rem"><b>${x.erros.length} erro(s) — nada será importado.</b> Corrija a planilha e envie de novo.</div>
        <div class="cc-scroll" style="max-height:240px;margin-top:6px"><table class="cc-table"><colgroup><col style="width:60px"><col style="width:160px"><col style="width:60px"><col></colgroup><thead><tr><th>Linha</th><th>Campo</th><th>Código</th><th>Mensagem</th></tr></thead>
        <tbody>${x.erros.map((r) => `<tr><td>${this.esc(r.linha)}</td><td>${this.esc(r.campo)}</td><td>${this.esc(r.codigo)}</td><td style="white-space:normal">${this.esc(r.mensagem)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${x.linhas ? `<div style="margin-top:8px;font-size:0.8rem;color:#105436"><b>Planilha válida:</b> ${x.linhas.length} linha(s), total ${C.fmtReais(tot, true)}. Ao aplicar, a grade passa a ter exatamente as linhas da planilha (as que não estão nela saem).
        <button type="button" class="btn btn-primary" style="height:34px;margin-left:8px" onclick="OrionOrcamentosApp.excelAplicar()">Aplicar na grade</button></div>` : ""}</div>`;
  },

  /* ---------- meses visíveis (Órion: seletor de meses da grade) ---------- */
  alternarMesGrade(m) { const e = this.edicao; if (!e) return; e.ocultos = e.ocultos || {}; if (m === "todos") e.ocultos = {}; else e.ocultos[m] = !e.ocultos[m]; this.render(); },

  htmlEdicao() {
    if (this.edicao && this.edicao.modo === "vendas") return this.htmlEdicaoVendas();
    this.estilosGrade();
    const C = this.C();
    const a = this.aberto;
    const e = this.edicao;
    const trav = this.mesesTravados(a.cab);
    const base = a.base ? this.baseMap() : null;
    const q = String(e.busca || "").trim().toLowerCase();
    const grupos = new Map();
    e.linhas.forEach((l, i) => { if (!grupos.has(l.cc)) grupos.set(l.cc, []); grupos.get(l.cc).push(i); });
    let corpo = "";
    grupos.forEach((idx, cc) => {
      const g = C.somarLinhas(idx.map((i) => e.linhas[i]));
      const rec = !!e.recolhidos[cc];
      const nome = e.linhas[idx[0]].cc_nome || ((this.cadDep || {}).nomesCc || {})[cc] || "";
      corpo += `<tr class="og-grupo"><td style="cursor:pointer" onclick="OrionOrcamentosApp.alternarGrupo('${this.esc(cc)}')">${rec ? "▸" : "▾"} ${this.esc(cc)} ${this.esc(nome)} <span style="font-weight:400">(${idx.length})</span>
          <span class="og-acoes" onclick="event.stopPropagation()"><button type="button" class="btn btn-secondary" title="Incluir linha neste empreendimento" onclick="OrionOrcamentosApp.prepararLinhaDoGrupo('${this.esc(cc)}')">+ linha</button><button type="button" class="btn btn-secondary" style="color:#b91c1c" title="Excluir o empreendimento" onclick="OrionOrcamentosApp.removerEmpreendimento('${this.esc(cc)}')">excluir</button></span></td>
        ${g.m.map((v, m) => `<td class="is-right" id="og-g-${this.esc(cc)}-${m}">${C.fmtReais(v, true)}</td>`).join("")}<td class="is-right" id="og-gt-${this.esc(cc)}">${C.fmtReais(g.total, true)}</td><td></td><td></td></tr>`;
      idx.forEach((i) => {
        const l = e.linhas[i];
        const b = base ? base.get(String(l.cc).replace(/\D/g, "") + "|" + String(l.plano).replace(/\D/g, "")) : null;
        const txt = `${l.cc} ${l.cc_nome} ${l.plano} ${l.plano_nome} ${l.obs || ""}`.toLowerCase();
        const oculto = rec || (q && txt.indexOf(q) < 0);
        corpo += `<tr data-linha="${i}" style="${oculto ? "display:none" : ""}">
          <td style="padding-left:18px;white-space:normal">${this.esc(l.plano)} ${this.esc(l.plano_nome)}${base && !b ? ' <span style="font-size:0.65rem;color:#a16207">(nova)</span>' : ""}</td>
          ${l.m.map((v, mi) => {
            const t = trav.indexOf(mi + 1) >= 0;
            const dif = base && (b ? Number(b.m[mi]) || 0 : 0) !== (Number(v) || 0);
            return `<td class="og-cel${dif ? " og-dif" : ""}" data-c="${i}-${mi}" ${dif ? `title="Versão anterior: ${C.fmtReais(b ? b.m[mi] : 0, true)}"` : ""}><input class="oo-num" data-i="${i}" data-m="${mi}" ${t ? 'disabled title="mês travado"' : ""} value="${v ? C.fmtReais(v) : ""}" onchange="OrionOrcamentosApp.setValor(${i}, ${mi}, this.value)" onkeydown="OrionOrcamentosApp.tecla(event, ${i}, ${mi})" onpaste="OrionOrcamentosApp.colar(event, ${i}, ${mi})" onfocus="this.select()">${!t && mi < 11 ? `<button type="button" class="og-rep" tabindex="-1" title="Replicar para a direita" onclick="OrionOrcamentosApp.replicar(${i}, ${mi})">→</button>` : ""}</td>`;
          }).join("")}
          <td class="is-right"><b id="og-t-${i}">${C.fmtReais(l.total, true)}</b></td>
          <td><input class="og-obs" placeholder="Nota..." value="${this.esc(l.obs || "")}" onchange="OrionOrcamentosApp.setObs(${i}, this.value)"></td>
          <td class="is-center"><button type="button" style="border:none;background:none;color:#b91c1c;cursor:pointer" title="Remover linha" onclick="OrionOrcamentosApp.removerLinha(${i})">✕</button></td></tr>`;
      });
    });
    const tot = C.somarLinhas(e.linhas);
    const ccs = this.ccsParaEscolher(), planos = this.planosParaEscolher();
    const ccSel = ccs.find((c) => c.id === String(e.novoCc));
    const oc = e.ocultos || {};
    return `
      ${e.erros.length ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:8px">${e.erros.map((x) => this.esc(x)).join("<br>")}</div>` : ""}
      <datalist id="og-lista-cc">${ccs.map((c) => `<option value="${this.esc(c.id + " - " + c.nome)}">`).join("")}</datalist>
      <datalist id="og-lista-plano">${planos.map((p) => `<option value="${this.esc(p.id + " - " + p.nome)}">`).join("")}</datalist>
      <div class="og-barra" style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;flex-wrap:wrap">
        <div><label class="ml-emp-filter-label">Buscar nas linhas</label><input class="idx-select" style="width:200px" placeholder="empreendimento, plano, nota" value="${this.esc(e.busca || "")}" oninput="OrionOrcamentosApp.setBuscaGrade(this.value)"></div>
        <div><label class="ml-emp-filter-label">Empreendimento</label><input id="oo-novo-cc" list="og-lista-cc" class="idx-select" style="width:260px" placeholder="código ou nome" value="${ccSel ? this.esc(ccSel.id + " - " + ccSel.nome) : this.esc(e.novoCc || "")}"></div>
        <div><label class="ml-emp-filter-label">Plano financeiro</label><input id="oo-novo-plano" list="og-lista-plano" class="idx-select" style="width:280px" placeholder="Pesquise ou selecione..." onkeydown="if(event.key==='Enter'){event.preventDefault();OrionOrcamentosApp.incluirLinha();}"></div>
        <button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.incluirLinha()">Incluir linha</button>
        <button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.todosGrupos(false)">Abrir todos</button>
        <button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.todosGrupos(true)">Recolher todos</button>
        <button type="button" class="btn ${e.excel ? "btn-primary" : "btn-secondary"}" onclick="OrionOrcamentosApp.excelAlternar()">Excel</button>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button type="button" class="btn btn-secondary" onclick="OrionOrcamentosApp.cancelarEdicao()">Cancelar</button>
          <button type="button" class="btn btn-primary" ${e.salvando ? "disabled" : ""} onclick="OrionOrcamentosApp.salvarEdicao()">${e.salvando ? "Salvando..." : "Salvar"}</button>
        </div>
      </div>
      ${this.htmlExcel()}
      ${e.aviso ? `<div style="padding:8px 12px;border:1px solid #bbf7d0;background:#f0fdf4;color:#105436;border-radius:8px;margin-bottom:8px;font-size:0.8rem">${this.esc(e.aviso)}</div>` : ""}
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:6px;font-size:0.72rem;color:#64748b">Meses na tela:
        ${C.MESES.map((m, i) => `<button type="button" class="btn ${oc[i] ? "btn-secondary" : "btn-primary"}" style="height:26px;padding:0 8px;font-size:0.68rem" onclick="OrionOrcamentosApp.alternarMesGrade(${i})">${m}</button>`).join("")}
        <button type="button" class="btn btn-secondary" style="height:26px;padding:0 8px;font-size:0.68rem" onclick="OrionOrcamentosApp.alternarMesGrade('todos')">Todos</button></div>
      <style>${C.MESES.map((m, i) => (oc[i] ? `#og-grade col.og-cm${i}{visibility:collapse}` : "")).join("")}</style>
      <div style="font-size:0.72rem;color:#64748b;margin-bottom:6px">Dicas: Enter desce para a linha de baixo; colar do Excel preenche vários meses e linhas; passe o mouse num mês e clique em → para repetir o valor nos meses seguintes.${a.base ? " Em amarelo: diferente da versão anterior." : ""}${trav.length ? ` Meses travados (fechados${this.tipo === "forecasts" && a.cab.mes_corte ? " ou antes do corte" : ""}): ${trav.map((m) => C.MESES[m - 1]).join(", ")}.` : ""}</div>
      <div class="cc-scroll" style="max-height:70vh"><table class="cc-table" id="og-grade" style="min-width:1600px">
        <colgroup><col style="width:280px">${C.MESES.map((m, i) => `<col class="og-cm${i}" style="width:88px">`).join("")}<col style="width:110px"><col style="width:150px"><col style="width:34px"></colgroup>
        <thead><tr><th>Empreendimento / plano</th>${C.MESES.map((m) => `<th class="is-right">${m}</th>`).join("")}<th class="is-right">Total</th><th>Nota</th><th></th></tr></thead>
        <tbody>${corpo || `<tr><td colspan="16" style="text-align:center;padding:30px">Sem linhas. Escolha o empreendimento e o plano acima e clique em Incluir linha.</td></tr>`}
        <tr class="oo-total" style="position:sticky;bottom:0"><td>Total</td>${tot.m.map((v, m) => `<td class="is-right" id="og-f-${m}">${C.fmtReais(v, true)}</td>`).join("")}<td class="is-right" id="og-ft">${C.fmtReais(tot.total, true)}</td><td></td><td></td></tr></tbody>
      </table></div>`;
  }
});
