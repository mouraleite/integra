/* Órion (transição) › Carga do Órion — importa de uma vez tudo o que as telas vindas do Órion usam.
 * Uma única escolha de arquivos (todos os .json da pasta .carga_orion), uma prévia de tudo e um botão "Importar tudo".
 * Usa as mesmas rotinas de importação de cada tela (nada de regra nova):
 *   1. Premissas da viabilidade e Fechamento de meses (OrionPremissasApp)
 *   2. Departamentos do orçamento (OrionDepartamentosApp)
 *   3. Orçamentos e forecasts, com vendas e histórico (OrionOrcamentosApp)
 *   4. Viabilidades, com fases, dados físicos e datas (OrionViabilidadesApp)
 *   5. Obras do Acompanhamento de empreendimentos (centros de custo acompanhados, fase, parceria e terreno informado)
 * Só administrador. O que já existe no Integra só é substituído se marcar "substituir". */
const OrionCargaApp = {
  etapa: "inicio",   // inicio | lendo | previa | gravando | fim
  erro: "",
  passos: [],
  depto: null,       // { temDados, versao, substituir, resultado }
  timer: null,

  root() { return document.getElementById("orion-carga-root"); },
  esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); },
  ehAdmin() { return typeof window.isCrmSuperAdmin === "function" && window.isCrmSuperAdmin(); },
  apps() {
    return { P: window.OrionPremissasApp, D: window.OrionDepartamentosApp, O: window.OrionOrcamentosApp, V: window.OrionViabilidadesApp };
  },

  init() { this.estilos(); this.render(); },

  estilos() {
    if (document.getElementById("oc-estilos")) return;
    const st = document.createElement("style");
    st.id = "oc-estilos";
    // As prévias são as das próprias telas; os botões delas ficam escondidos aqui (o botão é o "Importar tudo").
    st.textContent = `#orion-carga-root .oc-prev button { display:none !important; }
      #orion-carga-root .oc-bloco { margin-bottom:14px; }
      #orion-carga-root .oc-bloco h4 { margin:0 0 6px; font-size:0.85rem; color:#105436; }`;
    document.head.appendChild(st);
  },

  escolher() { const i = document.getElementById("oc-arquivos"); if (i) i.click(); },

  async lerArquivos(files) {
    if (!this.ehAdmin()) return;
    const { P, D, O, V } = this.apps();
    if (!P || !D || !O || !V) { this.erro = "Alguma tela do Órion (transição) não carregou. Recarregue a página."; return this.render(); }
    this.etapa = "lendo";
    this.erro = "";
    this.render();
    try {
      await V.carregar(); // lista das viabilidades que já estão no Integra (para não regravar sem querer)
      await P.lerArquivos(files);
      await D.lerArquivos(files);
      const atual = await window.OrionStore.ler("departamentos", null);
      this.depto = { temDados: !!(atual.versao > 0 && atual.itens && (atual.itens.departamentos || []).length), versao: atual.versao, substituir: false, resultado: "" };
      await O.lerArquivos(files);
      await V.lerArquivos(files);
      await this.lerObras(files);
      this.etapa = "previa";
    } catch (e) {
      this.erro = e.message || String(e);
      this.etapa = "inicio";
    }
    this.render();
  },

  /** Centros de custo do Órion que o Acompanhamento de empreendimentos usa (cost_centers.json + curva do terreno em standard_curves.json). */
  async lerObras(files) {
    this.obras = null;
    const ler = async (nome) => { const f = [...(files || [])].find((x) => x.name === nome); if (!f) return null; const j = JSON.parse(await f.text()); return Array.isArray(j) ? j : (j && j.linhas) || []; };
    const ccs = await ler("cost_centers.json");
    if (!ccs) return;
    const curvas = {};
    ((await ler("standard_curves.json")) || []).forEach((c) => { let v = c.valores_meses_json; if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { v = null; } } if (v && Array.isArray(v.meses)) curvas[c.id] = v.meses.map(Number); });
    const pct = (x) => { const n = Number(String(x == null ? "" : x).replace("%", "").replace(",", ".")); return isNaN(n) ? 0 : n; };
    const itens = ccs.filter((c) => c && String(c.id_sienge || "").trim()).map((c) => {
      let cd = c.custom_data; if (typeof cd === "string") { try { cd = JSON.parse(cd); } catch (e) { cd = {}; } } cd = cd || {};
      let ar = c.apportionment_rules; if (typeof ar === "string") { try { ar = JSON.parse(ar); } catch (e) { ar = []; } }
      return { cc: String(c.id_sienge).replace(/\D/g, ""), nome: String(c.nome || ""), acompanhar: !!c.track_in_dashboard, fase: String(c.project_phase || ""),
        cidade: String(cd.__cidade_sienge || ""), participacao: pct(cd["Participação"]), participacao_rateio: pct(cd["Participação Rateio"]), parceria_orion: cd.partnership_config_id || c.partnership_config_id || null,
        terreno: Number(c.manual_land_cost) > 0 ? { valor: Number(c.manual_land_cost), curva: curvas[cd.land_payment_curve_id] || null, inicio: cd.land_payment_start_date || null } : null,
        rateio: Array.isArray(ar) ? ar : [] };
    });
    const atual = await window.OrionStore.ler("acompanhamento_obras", []);
    this.obras = { itens, versao: atual.versao || 0, acompanhadas: itens.filter((x) => x.acompanhar).length, resultado: "" };
  },

  marcarDepto(v) { if (this.depto) this.depto.substituir = !!v; },

  async importarTudo() {
    if (!this.ehAdmin() || this.etapa !== "previa") return;
    const { P, D, O, V } = this.apps();
    this.etapa = "gravando";
    this.passos = [];
    this.timer = setInterval(() => this.render(), 800);
    const passo = async (nome, fn) => {
      this.passos.push({ nome, status: "gravando…" });
      this.render();
      const p = this.passos[this.passos.length - 1];
      try { p.status = (await fn()) || "ok"; } catch (e) { p.status = "parou com erro: " + (e.message || String(e)); }
      this.render();
    };
    if (P.carga) await passo("Premissas da viabilidade e fechamento de meses", async () => { await P.confirmarCarga(); return (P.carga || []).map((c) => `${c.rotulo}: ${c.resultado}`).join(" · "); });
    if (D.carga) await passo("Departamentos do orçamento", async () => {
      if (this.depto.temDados && !this.depto.substituir) return "mantido (já tinha dados no Integra)";
      const atual = await window.OrionStore.ler("departamentos", null);
      await window.OrionStore.gravar("departamentos", D.carga.cad, atual.versao);
      D.carga.resultado = `importado: ${D.carga.cad.departamentos.length} departamentos`;
      D.dados = null;
      return D.carga.resultado;
    });
    if (O.carga) await passo("Orçamentos e forecasts", async () => { await O.confirmarCarga(); return O.carga.itens.map((c) => `${c.tipo}: ${c.resultado}`).join(" · "); });
    if (V.carga) await passo("Viabilidades", async () => { await V.confirmarCarga(); return V.carga.resultado; });
    if (this.obras) await passo("Obras do Acompanhamento de empreendimentos", async () => {
      const atual = await window.OrionStore.ler("acompanhamento_obras", []);
      await window.OrionStore.gravar("acompanhamento_obras", this.obras.itens, atual.versao);
      return `importado: ${this.obras.itens.length} centros de custo, ${this.obras.acompanhadas} acompanhados no painel`;
    });
    clearInterval(this.timer);
    this.timer = null;
    // o resultado fica nesta tela; as outras telas voltam ao normal (sem a prévia da carga aberta)
    [P, D, O, V].forEach((a) => { if (a) { a.carga = null; try { a.render(); } catch (e) { /* tela não aberta */ } } });
    this.etapa = "fim";
    this.render();
  },

  recomecar() {
    const { P, D, O, V } = this.apps();
    [P, D, O, V].forEach((a) => { if (a) a.carga = null; });
    this.etapa = "inicio";
    this.passos = [];
    this.depto = null;
    this.render();
  },

  htmlPrevia() {
    const { P, D, O, V } = this.apps();
    const bloco = (titulo, app, extra) => `<div class="oc-bloco"><h4>${titulo}</h4>${app && app.carga ? `<div class="oc-prev">${app.htmlCarga()}</div>${extra || ""}` : `<div style="font-size:0.78rem;color:#b91c1c">Nenhum arquivo desta parte foi reconhecido${app && (app.erros || app.erro) ? ": " + this.esc([].concat(app.erros || app.erro || []).join(" ")) : "."}</div>`}</div>`;
    const dep = this.depto && this.depto.temDados ? `<label style="font-size:0.8rem"><input type="checkbox" ${this.depto.substituir ? "checked" : ""} onchange="OrionCargaApp.marcarDepto(this.checked)"> Já existem departamentos no Integra: substituir pelos do Órion</label>` : "";
    return bloco("1. Premissas da viabilidade e fechamento de meses", P) +
      bloco("2. Departamentos do orçamento", D, dep) +
      bloco("3. Orçamentos e forecasts", O) +
      bloco("4. Viabilidades", V) +
      `<div class="oc-bloco"><h4>5. Obras do Acompanhamento de empreendimentos</h4>${this.obras ? `<div style="font-size:0.8rem">${this.obras.itens.length} centros de custo do Órion, ${this.obras.acompanhadas} marcados para o painel de acompanhamento (com fase, participação da parceria e terreno informado).</div>` : `<div style="font-size:0.78rem;color:#b91c1c">Sem cost_centers.json na seleção.</div>`}</div>`;
  },

  render() {
    const root = this.root();
    if (!root) return;
    if (!this.ehAdmin()) { root.innerHTML = `<div style="padding:12px">Só administrador faz a carga do Órion.</div>`; return; }
    let corpo = "";
    if (this.etapa === "inicio") corpo = `<div style="font-size:0.85rem;color:#334155;margin-bottom:10px">Clique em <b>Escolher arquivos</b>, entre na pasta <code>.carga_orion</code> (ou <code>.carga_orion_TESTE</code>), aperte <b>Ctrl+A</b> para selecionar todos e clique em Abrir. Aparece a prévia de tudo; nada é gravado antes de clicar em <b>Importar tudo</b>.</div>
      <button type="button" class="btn btn-primary" style="height:40px" onclick="OrionCargaApp.escolher()">Escolher arquivos</button>`;
    else if (this.etapa === "lendo") corpo = `<div style="text-align:center;padding:30px;color:#64748b;"><div class="spinner" style="margin:0 auto 15px;"></div><p>Lendo os arquivos e conferindo com o que já está no Integra…</p></div>`;
    else if (this.etapa === "previa") corpo = `<div style="display:flex;gap:8px;margin-bottom:12px">
        <button type="button" class="btn btn-primary" style="height:40px" onclick="OrionCargaApp.importarTudo()">Importar tudo</button>
        <button type="button" class="btn btn-secondary" style="height:40px" onclick="OrionCargaApp.recomecar()">Cancelar</button></div>${this.htmlPrevia()}`;
    else corpo = `<div class="cc-scroll"><table class="cc-table"><colgroup><col style="width:300px"><col></colgroup>
        <thead><tr><th>Parte</th><th>Resultado</th></tr></thead>
        <tbody>${this.passos.map((p) => `<tr><td>${this.esc(p.nome)}</td><td style="white-space:normal">${this.esc(p.status)}</td></tr>`).join("")}</tbody></table></div>
        ${this.etapa === "fim" ? `<div style="margin-top:10px;font-size:0.85rem">Pronto. Abra as telas para conferir. <button type="button" class="btn btn-secondary" style="height:40px;margin-left:8px" onclick="OrionCargaApp.recomecar()">Nova carga</button></div>` : `<div style="margin-top:10px;color:#64748b;font-size:0.8rem">Gravando… não feche esta tela.</div>`}`;
    root.innerHTML = `<input type="file" id="oc-arquivos" accept=".json" multiple style="display:none" onchange="OrionCargaApp.lerArquivos(this.files)">
      <div style="padding:8px 12px;border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;margin-bottom:12px;font-size:0.78rem">Carga dos dados do ML Órion para as telas de transição. Grava só nas coleções novas do Órion no Integra (orion_…); não altera os cadastros do Integra.</div>
      ${this.erro ? `<div style="padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:12px">${this.esc(this.erro)}</div>` : ""}
      ${corpo}`;
  }
};

window.OrionCargaApp = OrionCargaApp;
