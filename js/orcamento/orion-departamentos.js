/* Configurações gerais › Departamentos do orçamento — vindo do ML Órion (Apoio › Departamentos e matriz de permissões).
 * Para cada departamento: diretoria, centros de custo e planos financeiros em que pode orçar, e usuários.
 * Regra de lançamento igual à do Órion (OrionOrcamentoCalc.lancamentoPermitido).
 * Grava em orion_config/departamentos: itens = { departamentos, produtoPlano, depara, nomesCc, nomesPlano }.
 * Editar exige sub_cfg_apoio_departamentos_orcamento_editar (administrador sempre pode). */
const OrionDepartamentosApp = {
  dados: null,
  sel: null,
  alterado: false,
  carregando: false,
  salvando: false,
  erros: [],
  aviso: "",
  carga: null,

  C() { return window.OrionOrcamentoCalc; },
  root() { return document.getElementById("orion-departamentos-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  ehAdmin() { return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin(); },
  podeEditar() {
    if (this.ehAdmin()) return true;
    return typeof window.hasCrmPerm === "function" && window.hasCrmPerm("sub_cfg_apoio_departamentos_orcamento_editar");
  },

  VAZIO() { return { departamentos: [], produtoPlano: [], depara: [], nomesCc: {}, nomesPlano: {} }; },

  init() {
    this.render();
    if (!this.dados) this.carregar();
  },

  async carregar() {
    this.carregando = true;
    this.erros = [];
    this.render();
    try {
      this.dados = await window.OrionStore.ler("departamentos", this.VAZIO());
      this.alterado = false;
    } catch (e) { this.erros = [e.message || String(e)]; }
    this.carregando = false;
    this.render();
  },

  cad() { return this.dados ? this.dados.itens : this.VAZIO(); },
  dep() { return this.cad().departamentos.find((d) => String(d.id) === String(this.sel)) || null; },
  selecionar(id) { this.sel = id; this.render(); },

  /** "10100; 10200" -> ["10100","10200"] (só dígitos, sem repetidos) */
  codigos(txt) {
    const v = String(txt || "").split(/[;,\s]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean);
    return [...new Set(v)].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  },

  setCampo(campo, valor) {
    const d = this.dep();
    if (!d || !this.podeEditar()) return;
    if (campo === "ccs" || campo === "planos") d[campo] = this.codigos(valor);
    else if (campo === "usuarios") d.usuarios = [...new Set(String(valor || "").split(/[;,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))].sort();
    else if (campo === "ativo") d.ativo = !!valor;
    else d[campo] = String(valor);
    this.alterado = true;
    this.aviso = "";
    this.render();
  },

  novo() {
    if (!this.podeEditar()) return;
    const nome = (window.prompt("Nome do novo departamento:") || "").trim();
    if (!nome) return;
    const cad = this.cad();
    if (cad.departamentos.some((d) => d.nome.toLowerCase() === nome.toLowerCase())) { this.erros = [`Já existe o departamento "${nome}".`]; return this.render(); }
    const id = "n" + Date.now();
    cad.departamentos.push({ id, nome, ativo: true, residual: false, diretoria: "", ccs: [], planos: [], usuarios: [] });
    cad.departamentos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    this.sel = id;
    this.alterado = true;
    this.render();
  },

  async salvar() {
    if (!this.podeEditar() || !this.dados) return;
    this.salvando = true;
    this.erros = [];
    this.render();
    try {
      this.dados.versao = await window.OrionStore.gravar("departamentos", this.dados.itens, this.dados.versao);
      this.alterado = false;
      this.aviso = "Salvo.";
    } catch (e) { this.erros = [e.message || String(e)]; }
    this.salvando = false;
    this.render();
  },

  /* ----- carga inicial ----- */
  escolher() { const i = document.getElementById("od-arquivos"); if (i) i.click(); },
  async lerArquivos(files) {
    const arquivos = [];
    for (const f of Array.from(files || [])) { try { arquivos.push(JSON.parse(await f.text())); } catch (e) { /* ignora */ } }
    const tabs = new Set(arquivos.map((a) => a && a.tabela));
    if (!tabs.has("departamentos")) {
      this.erros = ["Escolha os arquivos da pasta .carga_orion: departamentos.json, departamento_cost_centers.json, departamento_planos.json, user_departamentos.json, diretorias.json, depara_autorizacao_departamento.json, produto_plano_financeiro.json, cost_centers.json, planos_financeiros.json e users.json."];
      return this.render();
    }
    const faltam = ["cost_centers", "planos_financeiros", "departamento_planos", "departamento_cost_centers", "users"].filter((t) => !tabs.has(t));
    const cad = this.C().prepararDepartamentos(arquivos);
    this.carga = { cad, faltam, resultado: "" };
    this.erros = [];
    this.render();
  },
  async confirmarCarga() {
    if (!this.ehAdmin() || !this.carga) return;
    const atual = await window.OrionStore.ler("departamentos", null);
    const temDados = atual.versao > 0 && atual.itens && (atual.itens.departamentos || []).length;
    if (temDados && !window.confirm("Já existem departamentos no Integra. Substituir pelos do Órion?")) { this.carga.resultado = "mantido (já tinha dados)"; return this.render(); }
    try {
      await window.OrionStore.gravar("departamentos", this.carga.cad, atual.versao);
      this.carga.resultado = `importado: ${this.carga.cad.departamentos.length} departamentos`;
      this.dados = null;
      await this.carregar();
    } catch (e) { this.carga.resultado = "não importado: " + (e.message || String(e)); this.render(); }
  },
  fecharCarga() { this.carga = null; this.render(); },

  htmlCarga() {
    if (!this.carga) return "";
    const c = this.carga.cad;
    const linhas = c.departamentos.map((d) => `<tr><td>${this.esc(d.nome)}</td><td>${this.esc(d.diretoria)}</td><td class="is-center">${d.ativo ? "sim" : "não"}</td><td class="is-right">${d.ccs.length}</td><td class="is-right">${d.planos.length}</td><td class="is-right">${d.usuarios.length}</td></tr>`).join("");
    return `<div style="padding:12px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;margin-bottom:12px;font-size:0.8rem">
      <b>Importar do Órion</b> — ${c.departamentos.length} departamentos, ${c.depara.length} nomes do Sienge no de-para, ${c.produtoPlano.length} vínculos centro de custo × plano.
      ${this.carga.faltam.length ? `<div style="color:#b91c1c;margin-top:4px">Faltam: ${this.carga.faltam.map((t) => t + ".json").join(", ")}.</div>` : ""}
      <div class="cc-scroll" style="margin-top:8px;max-height:300px"><table class="cc-table"><colgroup><col><col style="width:200px"><col style="width:60px"><col style="width:80px"><col style="width:80px"><col style="width:80px"></colgroup>
      <thead><tr><th>Departamento</th><th>Diretoria</th><th class="is-center">Ativo</th><th class="is-right">C. custo</th><th class="is-right">Planos</th><th class="is-right">Usuários</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        ${this.carga.resultado ? "" : `<button type="button" class="btn btn-primary" onclick="OrionDepartamentosApp.confirmarCarga()">Confirmar importação</button>`}
        <button type="button" class="btn btn-secondary" onclick="OrionDepartamentosApp.fecharCarga()">${this.carga.resultado ? "Fechar" : "Cancelar"}</button>
        <span>${this.esc(this.carga.resultado)}</span>
      </div></div>`;
  },

  htmlLista() {
    const cad = this.cad();
    const linhas = cad.departamentos.map((d) => `<tr style="cursor:pointer;${String(d.id) === String(this.sel) ? "outline:2px solid #1b8253" : ""}" onclick="OrionDepartamentosApp.selecionar('${this.esc(d.id)}')">
      <td>${this.esc(d.nome)}${d.residual ? " <small>(residual)</small>" : ""}</td><td>${this.esc(d.diretoria)}</td>
      <td class="is-center">${d.ativo ? "sim" : "não"}</td><td class="is-right">${d.ccs.length}</td><td class="is-right">${d.planos.length}</td><td class="is-right">${d.usuarios.length}</td></tr>`).join("");
    return `<div class="cc-scroll" style="max-height:420px"><table class="cc-table">
      <colgroup><col><col style="width:200px"><col style="width:60px"><col style="width:80px"><col style="width:80px"><col style="width:80px"></colgroup>
      <thead><tr><th>Departamento</th><th>Diretoria</th><th class="is-center">Ativo</th><th class="is-right">C. custo</th><th class="is-right">Planos</th><th class="is-right">Usuários</th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="6" style="text-align:center;padding:30px">Nenhum departamento. Faça a carga do Órion ou inclua um novo.</td></tr>`}</tbody></table></div>`;
  },

  htmlDetalhe() {
    const d = this.dep();
    if (!d) return `<div style="margin-top:12px;font-size:0.8rem;color:#64748b">Clique num departamento para ver e editar os centros de custo, planos e usuários.</div>`;
    const cad = this.cad();
    const ed = this.podeEditar();
    const dis = ed ? "" : " disabled";
    const nomes = (lista, mapa) => lista.map((c) => `${this.esc(c)} ${this.esc((mapa || {})[c] || "")}`).join("<br>");
    const ta = (campo, lista) => `<textarea${dis} style="width:100%;min-height:70px;box-sizing:border-box;border:1px solid #d6e2db;border-radius:6px;padding:6px;font-size:0.75rem" onchange="OrionDepartamentosApp.setCampo('${campo}', this.value)">${this.esc(lista.join("; "))}</textarea>`;
    const desconhecidos = (lista, mapa) => lista.filter((c) => !(mapa || {})[c]);
    const dc = desconhecidos(d.ccs, cad.nomesCc), dp = desconhecidos(d.planos, cad.nomesPlano);
    return `<div style="margin-top:14px;padding:12px;border:1px solid #e2e8f0;border-radius:8px">
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:240px"><label class="ml-emp-filter-label">Departamento</label><input${dis} class="idx-select" style="width:100%;height:36px" value="${this.esc(d.nome)}" onchange="OrionDepartamentosApp.setCampo('nome', this.value)"></div>
        <div style="width:240px"><label class="ml-emp-filter-label">Diretoria</label><input${dis} class="idx-select" style="width:100%;height:36px" value="${this.esc(d.diretoria)}" onchange="OrionDepartamentosApp.setCampo('diretoria', this.value)"></div>
        <label style="display:flex;gap:6px;align-items:center;height:36px"><input type="checkbox"${dis} ${d.ativo ? "checked" : ""} onchange="OrionDepartamentosApp.setCampo('ativo', this.checked)"> Ativo</label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div style="font-weight:800;color:#105436;font-size:0.8rem">Centros de custo (${d.ccs.length}) — códigos do Sienge, separados por ;</div>${ta("ccs", d.ccs)}
          ${dc.length ? `<div style="color:#b91c1c;font-size:0.72rem">Sem nome no cadastro: ${this.esc(dc.join(", "))}</div>` : ""}
          <div class="cc-scroll" style="max-height:180px;margin-top:6px;padding:6px;font-size:0.72rem">${nomes(d.ccs, cad.nomesCc) || "—"}</div></div>
        <div><div style="font-weight:800;color:#105436;font-size:0.8rem">Planos financeiros (${d.planos.length}) — códigos do Sienge, separados por ;</div>${ta("planos", d.planos)}
          ${dp.length ? `<div style="color:#b91c1c;font-size:0.72rem">Sem nome no cadastro: ${this.esc(dp.join(", "))}</div>` : ""}
          <div class="cc-scroll" style="max-height:180px;margin-top:6px;padding:6px;font-size:0.72rem">${nomes(d.planos, cad.nomesPlano) || "—"}</div></div>
      </div>
      <div style="margin-top:10px"><div style="font-weight:800;color:#105436;font-size:0.8rem">Usuários (${d.usuarios.length}) — e-mails separados por ;</div>${ta("usuarios", d.usuarios)}</div>
      <div style="margin-top:8px;font-size:0.72rem;color:#64748b">Regra do Órion: o departamento só orça nos planos listados aqui${cad.produtoPlano.length ? " e, além disso, o plano precisa estar liberado para o centro de custo" : ""}.</div>
    </div>`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.C() || !window.OrionStore) { root.innerHTML = `<div style="padding:12px;color:#991b1b">Arquivos da tela não carregaram. Recarregue a página.</div>`; return; }
    const ed = this.podeEditar();
    root.innerHTML = `
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${ed ? `<button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionDepartamentosApp.novo()">Incluir departamento</button>` : ""}
        ${ed && this.alterado ? `<button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionDepartamentosApp.carregar()">Descartar</button>` : ""}
        ${ed ? `<button type="button" class="btn btn-primary" style="height:40px" ${this.salvando || !this.alterado ? "disabled" : ""} onclick="OrionDepartamentosApp.salvar()">${this.salvando ? "Salvando..." : "Salvar"}</button>` : ""}
        ${this.ehAdmin() ? `<button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionDepartamentosApp.escolher()">Importar do Órion</button><input type="file" id="od-arquivos" accept=".json" multiple style="display:none" onchange="OrionDepartamentosApp.lerArquivos(this.files)">` : ""}
        <button type="button" class="btn btn-primary cc-atualizar" style="height:40px" ${this.carregando ? "disabled" : ""} onclick="OrionDepartamentosApp.carregar()">Atualizar</button>
      </div>
      ${this.erros.length ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.erros.map((e) => this.esc(e)).join("<br>")}</div>` : ""}
      ${this.aviso ? `<div style="padding:10px 14px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;margin-bottom:12px">${this.esc(this.aviso)}</div>` : ""}
      ${this.htmlCarga()}
      ${!this.dados ? `<div style="text-align:center;padding:40px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Carregando...</p></div>` : this.htmlLista() + this.htmlDetalhe()}`;
    if (window.lucide) window.lucide.createIcons();
  }
};

window.OrionDepartamentosApp = OrionDepartamentosApp;
