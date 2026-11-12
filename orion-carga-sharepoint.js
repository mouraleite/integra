/* Órion (transição) › Carga SharePoint — vinda do ML Órion (Apoio › Carga SharePoint › Importar Forecasts).
 * O usuário escolhe a pasta do ano (ex.: "...Comparativo Orçamento Empresarial X Realizado Agrupado - Forecast\2026") sincronizada
 * do SharePoint; a tela lê as planilhas do relatório 2653 de cada pasta "Forecast - N+M" com a regra do Órion
 * (orion-sharepoint-calc.js), mostra as pendências de de-para e grava o forecast de despesas e o de receitas no departamento
 * Corporativo (residual), como o Órion. Grava só nas coleções orion_forecasts / orion_forecast_itens (e o de-para em orion_config).
 * Recarga da mesma pasta: a versão anterior fica como "Substituído" (nada é apagado). Só administrador grava. */
const OrionCargaSharepointApp = {
  ano: String(new Date().getFullYear()),
  pastas: null, fora: [], lendo: false, gravando: false, erro: "", aviso: "", passo: "",
  depara: { cc: {}, plano: {} }, deparaVersao: 0, catalogo: null, cabs: null, sync: {}, syncVersao: 0, cadDep: null,
  escolha: {}, marcadas: {}, busca: "",

  S() { return window.OrionSharepointCalc; },
  C() { return window.OrionOrcamentoCalc; },
  fc() { return window.firebaseCollections; },
  root() { return document.getElementById("orion-carga-sharepoint-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  ehAdmin() { return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin(); },
  usuario() { return String((window.OrionStore && window.OrionStore.usuario()) || "").toLowerCase(); },
  R$(c) { return this.C().fmtReais(c, true); },

  init() { this.render(); if (!this.catalogo) this.carregarBase(); },

  async carregarBase() {
    const fc = this.fc();
    if (!window.firebaseDb || !fc) { this.erro = "Banco do Integra ainda não carregou."; return this.render(); }
    try {
      this.passo = "Lendo cadastros…"; this.render();
      const d = await window.OrionStore.ler("depara_sharepoint", { cc: {}, plano: {} });
      this.depara = Object.assign({ cc: {}, plano: {} }, d.itens || {}); this.deparaVersao = d.versao || 0;
      const s = await window.OrionStore.ler("sharepoint_sync", {});
      this.sync = s.itens || {}; this.syncVersao = s.versao || 0;
      this.cadDep = (await window.OrionStore.ler("departamentos", null)).itens || null;
      // catálogo de planos: os planos que já existem nos orçamentos e forecasts do Integra (código do Sienge + nome)
      const planos = new Map();
      for (const col of ["orion_orcamento_itens", "orion_forecast_itens"]) {
        const snap = await fc.getDocs(fc.collection(window.firebaseDb, col));
        snap.forEach((x) => (x.data().itens || []).forEach((l) => { const k = String(l.plano || "").replace(/\D/g, ""); if (k && !planos.has(k)) planos.set(k, { id: k, nome: l.plano_nome || "" }); }));
      }
      ((this.cadDep && this.cadDep.nomesPlano) ? Object.entries(this.cadDep.nomesPlano) : []).forEach(([k, n]) => { const id = String(k).replace(/\D/g, ""); if (id && !planos.has(id)) planos.set(id, { id, nome: n }); });
      this.catalogo = { planos: [...planos.values()].sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true })) };
      await this.lerCabs();
    } catch (e) { this.erro = e.message || String(e); }
    this.passo = "";
    this.render();
  },

  async lerCabs() {
    const fc = this.fc();
    const snap = await fc.getDocs(fc.collection(window.firebaseDb, "orion_forecasts"));
    const l = []; snap.forEach((x) => l.push(x.data()));
    this.cabs = l;
  },

  ccs() {
    const nomes = (this.cadDep && this.cadDep.nomesCc) || {};
    return ((window.AppState && (AppState.cachedCostCenters || AppState.costCenters)) || []).map((c) => ({ id: String(c.id), nome: c.name || c.nome || nomes[c.id] || "" }));
  },

  deptCorporativo() {
    const l = (this.cadDep && this.cadDep.departamentos) || [];
    const d = l.find((x) => x.residual) || l.find((x) => /corporativo/i.test(String(x.nome || "")));
    return d ? { id: d.id, nome: d.nome } : null;
  },

  /* ---------- leitura dos arquivos ---------- */
  async escolherArquivos(input) {
    const files = [...(input.files || [])];
    input.value = "";
    if (!files.length) return;
    if (typeof XLSX === "undefined") { this.erro = "O leitor de Excel não carregou. Recarregue a página."; return this.render(); }
    const S = this.S();
    this.lendo = true; this.erro = ""; this.aviso = ""; this.pastas = null; this.render();
    try {
      const arqs = files.map((f) => ({ arquivo: f, nome: f.name, caminho: f.webkitRelativePath || f.name, mtime: f.lastModified || 0 }));
      const g = S.agruparArquivos(arqs);
      if (!g.pastas.length) throw new Error(`Nenhuma pasta "Forecast - N+M" com planilhas Excel na seleção${g.fora.length ? ` (${g.fora.length} arquivo(s) fora dessas pastas)` : ""}. Escolha a pasta do ano (ex.: 2026) dentro de "Sienge - 2653 - Comparativo Orçamento Empresarial X Realizado Agrupado - Forecast".`);
      this.fora = g.fora;
      const anoPasta = g.pastas.map((p) => p.ano_pasta).find(Boolean);
      if (anoPasta) this.ano = String(anoPasta);
      for (const p of g.pastas) {
        p.dados = []; p.erro = ""; p.mtime = Math.max(...p.arquivos.map((a) => a.mtime));
        for (const a of p.arquivos) {
          this.passo = `Lendo ${p.descricao} › ${a.nome}…`; this.render();
          try {
            const wb = XLSX.read(await a.arquivo.arrayBuffer(), { type: "array" });
            const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
            p.dados.push(...S.lerRelatorio(linhas, a.nome));
          } catch (e) { p.erro = (e.message || String(e)) + " A carga desta pasta foi cancelada (como no Órion); nenhum dado dela será gravado."; p.dados = []; break; }
        }
        this.marcadas[p.descricao] = !p.erro && this.sync[p.descricao] !== p.mtime;
      }
      this.pastas = g.pastas;
      this.remapear();
    } catch (e) { this.erro = e.message || String(e); }
    this.lendo = false; this.passo = "";
    this.render();
  },

  remapear() {
    const S = this.S();
    (this.pastas || []).forEach((p) => {
      const m = S.mapear(p.dados, this.ccs(), (this.catalogo && this.catalogo.planos) || [], this.depara);
      p.pendencias = m.pendencias;
      p.forecast = S.montarForecast(m.linhas, this.ano);
      p.semDados = !p.dados.length;
    });
  },

  pendencias() {
    const m = new Map();
    (this.pastas || []).forEach((p) => (p.pendencias || []).forEach((x) => { const k = x.tipo + "|" + x.origem; if (!m.has(k)) m.set(k, Object.assign({ pastas: [] }, x)); m.get(k).pastas.push(p.descricao); }));
    return [...m.values()];
  },

  setAno(v) { this.ano = v; this.remapear(); this.render(); },
  setBusca(v) { this.busca = v; this.render(); setTimeout(() => { const e = document.getElementById("ocs-busca"); if (e) { e.focus(); e.setSelectionRange(v.length, v.length); } }, 0); },
  marcar(desc, v) { this.marcadas[desc] = !!v; this.render(); },
  escolher(k, v) { this.escolha[k] = String(v || "").trim(); },

  async salvarDepara() {
    const novos = Object.entries(this.escolha).filter(([, v]) => v);
    if (!novos.length) { this.erro = "Escolha ao menos um vínculo."; return this.render(); }
    const dig = (v) => String(v).split(" ")[0].replace(/\D/g, "");
    const d = { cc: Object.assign({}, this.depara.cc), plano: Object.assign({}, this.depara.plano) };
    const ruins = [];
    novos.forEach(([k, v]) => { const [tipo, ...o] = k.split("|"); const origem = o.join("|"); const id = dig(v); if (!id) { ruins.push(origem); return; } (tipo === "CENTRO_CUSTO" ? d.cc : d.plano)[origem] = id; });
    if (ruins.length) { this.erro = `Vínculo sem código: ${ruins.join(", ")}. Escolha um item da lista (código - nome).`; return this.render(); }
    try {
      const r = await window.OrionStore.gravar("depara_sharepoint", d, this.deparaVersao);
      this.depara = d; this.deparaVersao = typeof r === "number" ? r : this.deparaVersao + 1; this.escolha = {};
      this.erro = ""; this.aviso = `${novos.length} vínculo(s) salvo(s).`;
      this.remapear();
    } catch (e) { this.erro = e.conflito ? "Outra pessoa alterou o de-para agora há pouco. Recarregue a tela." : (e.message || String(e)); }
    this.render();
  },

  /* ---------- gravação ---------- */
  async importar() {
    if (!this.ehAdmin()) { this.erro = "Só administrador grava a Carga SharePoint (como no Órion)."; return this.render(); }
    const C = this.C(), fc = this.fc();
    const dep = this.deptCorporativo();
    if (!dep) { this.erro = "Não achei o departamento Corporativo (residual) no cadastro de departamentos do Órion. Faça a carga do Órion ou cadastre-o em Configurações gerais."; return this.render(); }
    const fila = (this.pastas || []).filter((p) => this.marcadas[p.descricao] && !p.erro && !(p.pendencias || []).length && !p.semDados);
    if (!fila.length) { this.erro = "Nenhuma pasta pronta marcada para importar."; return this.render(); }
    this.gravando = true; this.erro = ""; this.aviso = ""; this.render();
    const feitos = [];
    try {
      await this.lerCabs();
      const quem = this.usuario(), agora = new Date().toISOString();
      for (const p of fila) {
        for (const tipo of ["DESPESAS", "RECEITAS"]) {
          const itens = p.forecast[tipo];
          this.passo = `Gravando ${p.descricao} · ${tipo.toLowerCase()} (${itens.length} linhas)…`; this.render();
          const antigos = (this.cabs || []).filter((c) => String(c.ano) === String(this.ano) && String(c.tipo).toUpperCase() === tipo && String(c.descricao) === p.descricao &&
            String(c.departamento ? c.departamento.id : "") === String(dep.id) && c.status !== "Substituído");
          if (!itens.length && !antigos.length) continue;
          const id = `sp_${this.ano}_${p.realizados}m${p.descricao.replace(/\D/g, "")}_${tipo.charAt(0)}_${Date.now().toString(36)}`;
          const blocos = C.emBlocos(id, "forecast", itens, []);
          const versao = Math.max(0, ...(this.cabs || []).filter((c) => String(c.ano) === String(this.ano) && String(c.tipo).toUpperCase() === tipo && String(c.descricao) === p.descricao && String(c.departamento ? c.departamento.id : "") === String(dep.id)).map((c) => Number(c.versao) || 0)) + 1;
          const cab = {
            _id: id, origem: "sharepoint", descricao: p.descricao, ano: Number(this.ano), tipo, status: "Importado Sienge", versao,
            mes_corte: p.mes_corte, departamento: { id: dep.id, nome: dep.nome }, produto: null,
            versao_base: antigos[0] ? String(antigos[0]._id) : "", orcamento_base: "",
            arquivos: p.arquivos.map((a) => a.caminho), pasta: p.pasta,
            empreendimentos: [...new Set(itens.map((l) => l.cc))].sort(),
            totais: C.somarLinhas(itens), linhas: itens.length, blocos: blocos.length, linhas_venda: 0, vgv: 0,
            criado_por: quem, criado_em: agora, motivo_reabertura: "",
            historico: [{ de: "", para: "Importado Sienge", por: quem, em: agora, motivo: `Carga SharePoint (${p.arquivos.length} arquivo(s))` }],
            total_orion: 0, rev: 1, alterado_por: quem, alterado_em: agora
          };
          await fc.runTransaction(window.firebaseDb, async (tx) => {
            const ref = fc.doc(window.firebaseDb, "orion_forecasts", id);
            const olds = [];
            for (const a of antigos) { const s = await tx.get(fc.doc(window.firebaseDb, "orion_forecasts", a._id)); if (s.exists()) olds.push(s.data()); }
            for (const o of olds) {
              if (o.status === "Substituído") continue;
              tx.set(fc.doc(window.firebaseDb, "orion_forecasts", o._id), Object.assign({}, o, { status: "Substituído", rev: (Number(o.rev) || 0) + 1, alterado_por: quem, alterado_em: agora,
                historico: (o.historico || []).concat([{ de: o.status, para: "Substituído", por: quem, em: agora, motivo: "Nova Carga SharePoint da mesma pasta" }]) }));
            }
            for (const b of blocos) { const { _id, ...dados } = b; tx.set(fc.doc(window.firebaseDb, "orion_forecast_itens", _id), dados); }
            tx.set(ref, cab);
          });
          feitos.push(`${p.descricao} · ${tipo.toLowerCase()}: ${itens.length} linha(s), ${this.R$(cab.totais.total != null ? cab.totais.total : itens.reduce((s, l) => s + l.total, 0))}${antigos.length ? ` (versão ${versao}; a anterior ficou como Substituído)` : ""}`);
        }
        this.sync[p.descricao] = p.mtime;
        this.marcadas[p.descricao] = false;
      }
      try { const r = await window.OrionStore.gravar("sharepoint_sync", this.sync, this.syncVersao); this.syncVersao = typeof r === "number" ? r : this.syncVersao + 1; } catch (e) { /* controle de "sem alteração" é só conveniência */ }
      this.aviso = "Importado: " + feitos.join(" · ") + ". Os forecasts já aparecem em Orçamentos e forecasts e nas telas de análise.";
      await this.lerCabs();
    } catch (e) { this.erro = (e.message || String(e)) + (feitos.length ? ` — já gravados: ${feitos.join(" · ")}` : ""); }
    this.gravando = false; this.passo = "";
    this.render();
  },

  /* ---------- tela ---------- */
  render() {
    const root = this.root();
    if (!root) return;
    if (!this.S() || !this.C()) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivo de cálculo não carregou. Recarregue a página.</div>`; return; }
    const pend = this.pastas ? this.pendencias() : [];
    const pronta = (p) => !p.erro && !(p.pendencias || []).length && !p.semDados;
    const existentes = (p) => (this.cabs || []).filter((c) => String(c.ano) === String(this.ano) && String(c.descricao) === p.descricao && c.status !== "Substituído");
    const anos = [Number(new Date().getFullYear()) - 1, Number(new Date().getFullYear()), Number(new Date().getFullYear()) + 1];
    if (anos.indexOf(Number(this.ano)) < 0) anos.push(Number(this.ano));
    const linhasPastas = (this.pastas || []).map((p) => {
      const f = p.forecast || { DESPESAS: [], RECEITAS: [], foraDoAno: 0 };
      const td = f.DESPESAS.reduce((s, l) => s + l.total, 0), tr = f.RECEITAS.reduce((s, l) => s + l.total, 0);
      const ex = existentes(p);
      const semMud = this.sync[p.descricao] === p.mtime;
      const sit = p.erro ? `<span style="color:#b91c1c">${this.esc(p.erro)}</span>`
        : p.semDados ? `<span style="color:#92400e">Nenhum valor orçado nas planilhas.</span>`
        : (p.pendencias || []).length ? `<span style="color:#92400e">${p.pendencias.length} pendência(s) de de-para</span>`
        : `<span style="color:#105436">Pronta</span>${ex.length ? ` · já existe (${ex.map((c) => `${c.tipo.toLowerCase()} V${c.versao} ${c.status}`).join(", ")}): será substituída` : " · novo forecast"}${semMud ? " · sem alteração desde a última carga" : ""}`;
      return `<tr><td class="is-center"><input type="checkbox" ${this.marcadas[p.descricao] && pronta(p) ? "checked" : ""} ${pronta(p) ? "" : "disabled"} onchange="OrionCargaSharepointApp.marcar('${this.esc(p.descricao)}', this.checked)"></td>
        <td><b>${this.esc(p.descricao)}</b><div style="font-size:0.68rem;color:#64748b">corte: mês ${p.mes_corte} · ${p.arquivos.length} arquivo(s)</div></td>
        <td class="is-right">${new Set(p.dados.map((d) => d.cc_id_sienge || d.cc_nome)).size}</td>
        <td class="is-right">${f.DESPESAS.length}</td><td class="is-right">${this.R$(td)}</td>
        <td class="is-right">${f.RECEITAS.length}</td><td class="is-right">${this.R$(tr)}</td>
        <td style="white-space:normal">${sit}${f.foraDoAno ? `<div style="font-size:0.68rem;color:#64748b">${f.foraDoAno} valor(es) de outro ano ignorado(s), como no Órion.</div>` : ""}</td></tr>`;
    }).join("");
    const t = this.busca.trim().toLowerCase();
    const pendF = t ? pend.filter((x) => (x.origem + " " + x.descricao + " " + (x.tipo === "CENTRO_CUSTO" ? "obra / cc" : "plano financeiro")).toLowerCase().indexOf(t) >= 0) : pend;
    const optsCc = this.ccs().sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true })).map((c) => `<option value="${this.esc(c.id + " - " + c.nome)}">`).join("");
    const optsPl = ((this.catalogo && this.catalogo.planos) || []).map((p) => `<option value="${this.esc(p.id + " - " + p.nome)}">`).join("");
    const linhasPend = pendF.map((x) => { const k = x.tipo + "|" + x.origem; return `<tr><td>${x.tipo === "CENTRO_CUSTO" ? "Obra / CC" : "Plano financeiro"}</td><td style="white-space:normal">${this.esc(x.descricao)}<div style="font-size:0.66rem;color:#64748b">${this.esc(x.pastas.join(", "))}</div></td>
      <td><input class="idx-select" style="height:34px;width:100%" list="${x.tipo === "CENTRO_CUSTO" ? "ocs-l-cc" : "ocs-l-pl"}" placeholder="Digite o código ou o nome…" value="${this.esc(this.escolha[k] || "")}" oninput="OrionCargaSharepointApp.escolher('${this.esc(k).replace(/'/g, "\\'")}', this.value)"></td></tr>`; }).join("");
    const nSel = Object.values(this.escolha).filter(Boolean).length;
    const nProntas = (this.pastas || []).filter((p) => this.marcadas[p.descricao] && pronta(p)).length;
    const card = (t1, v, s) => `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;background:#fff"><div style="font-size:0.68rem;color:#64748b;text-transform:uppercase">${t1}</div><div style="font-size:1.4rem;font-weight:800;color:#0f172a">${v}</div><div style="font-size:0.7rem;color:#94a3b8">${s}</div></div>`;
    root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="font-size:0.8rem;color:#475569;max-width:760px">Lê as planilhas do relatório <b>2653 - Comparativo Orçamento Empresarial X Realizado Agrupado</b> salvas nas pastas <b>Forecast - N+M</b> do SharePoint e grava o forecast de despesas e o de receitas no departamento Corporativo, como o Órion. Escolha a pasta do ano (ex.: <i>…Agrupado - Forecast\\2026</i>) sincronizada no seu computador. Se algum nome da planilha não existir no Integra, resolva no de-para abaixo.</div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div><label class="ml-emp-filter-label">Ano do forecast</label><select class="idx-select" style="height:40px;min-width:110px" onchange="OrionCargaSharepointApp.setAno(this.value)">${anos.sort().map((a) => `<option ${String(a) === String(this.ano) ? "selected" : ""}>${a}</option>`).join("")}</select></div>
          <label class="btn btn-primary" style="height:40px;display:inline-flex;align-items:center;cursor:pointer;margin:0">Escolher pasta do ano<input id="ocs-pasta" type="file" webkitdirectory directory multiple style="display:none" onchange="OrionCargaSharepointApp.escolherArquivos(this)"></label>
          <button type="button" class="btn btn-secondary" style="height:40px" ${nProntas && !this.gravando ? "" : "disabled"} onclick="OrionCargaSharepointApp.importar()">Importar forecasts (${nProntas})</button>
        </div></div>
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#105436;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : ""}
      ${this.lendo || this.gravando || this.passo ? `<div style="text-align:center;padding:16px;color:#64748b;"><div class="spinner" style="margin:0 auto 10px;"></div>${this.esc(this.passo || "Aguarde…")}</div>` : ""}
      ${!this.ehAdmin() ? `<div style="font-size:0.75rem;color:#92400e;margin-bottom:8px">Você pode conferir as planilhas e o de-para; só administrador grava a carga.</div>` : ""}
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:12px">
        ${card("Pastas lidas", this.pastas ? this.pastas.length : "—", "Forecast - N+M")}
        ${card("Pendências", this.pastas ? pend.length : "—", "nomes sem vínculo no Integra")}
        ${card("Selecionados", nSel, "vínculos prontos para salvar")}</div>
      ${this.pastas ? `<div class="or-sec" style="font-weight:700;color:#105436;margin:8px 0 6px">Pastas encontradas</div>
        <div class="cc-scroll"><table class="cc-table"><colgroup><col style="width:44px"><col style="width:190px"><col style="width:60px"><col style="width:80px"><col style="width:140px"><col style="width:80px"><col style="width:140px"><col></colgroup>
          <thead><tr><th></th><th>Pasta</th><th class="is-right">Obras</th><th class="is-right">Linhas desp.</th><th class="is-right">Despesas</th><th class="is-right">Linhas rec.</th><th class="is-right">Receitas</th><th>Situação</th></tr></thead>
          <tbody>${linhasPastas}</tbody></table></div>${this.fora.length ? `<div style="font-size:0.7rem;color:#64748b;margin-top:4px">${this.fora.length} arquivo(s) fora de pastas "Forecast - N+M" ignorado(s).</div>` : ""}` : ""}
      ${this.pastas ? `<div style="display:flex;align-items:center;gap:10px;margin:16px 0 6px"><div style="font-weight:700;color:#105436">Pendências de mapeamento (de-para)</div>
          ${pend.length ? `<input id="ocs-busca" class="idx-select" style="height:34px;width:260px" placeholder="Buscar por nome ou tipo…" value="${this.esc(this.busca)}" oninput="OrionCargaSharepointApp.setBusca(this.value)">` : ""}
          <button type="button" class="btn btn-primary" style="height:34px;margin-left:auto" onclick="OrionCargaSharepointApp.salvarDepara()">Salvar selecionados</button></div>
        ${pend.length ? `<div class="cc-scroll" style="max-height:420px"><table class="cc-table"><colgroup><col style="width:130px"><col><col style="width:420px"></colgroup>
          <thead><tr><th>Tipo</th><th>Nome na planilha</th><th>Vincular com o Integra</th></tr></thead><tbody>${linhasPend || `<tr><td colspan="3" style="text-align:center;padding:14px">Nenhuma pendência para a busca.</td></tr>`}</tbody></table></div>
          <datalist id="ocs-l-cc">${optsCc}</datalist><datalist id="ocs-l-pl">${optsPl}</datalist>`
        : `<div style="padding:16px;text-align:center;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font-size:0.8rem">Nenhuma pendência. Tudo pronto para a carga.</div>`}` : ""}`;
  }
};
window.OrionCargaSharepointApp = OrionCargaSharepointApp;
