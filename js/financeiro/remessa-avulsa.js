/**
 * Contas a Receber · Remessa avulsa
 * Mesma leitura da planilha GERAÇÃO DE BOLETO AVULSO:
 * extrato CT/TC no vencimento, sem recebimento e sem boleto (sentToScripturalCharge = false),
 * situação Normal no income, condição Parcelas Mensais ou Parcela Acordo (origem CO).
 * Entrada, sinal (SI/SA) e parcela única ficam de fora.
 */
const RemessaAvulsaApp = {
  state: {
    inited: false,
    loading: false,
    geracao: 0,
    de: "",
    ate: "",
    empresas: [],
    empOpen: false,
    empQuery: "",
    busca: "",
    sort: "conta",
    dir: "asc",
    status: "",
    progresso: 0,
    erro: "",
    linhas: [],
    contas: {},
    analisou: false,
    origem: "",
    // Abas (Parcelas / Configurações), envio do boleto por e-mail e configuração do texto.
    aba: "parcelas",
    cfg: null,
    envios: {},
    sel: new Set(),
    enviando: false,
    pulado: ""
  },

  /* Texto padrão do e-mail do boleto (o mesmo do Sienge). O servidor usa o mesmo padrão quando a configuração
     ainda não foi gravada (api/_lib/remessa-avulsa-email.js). Variáveis no formato do Sienge. */
  CFG_PADRAO: {
    remetente: "recebimentos@mouraleite.com.br",
    cc: "",
    assunto: "Boleto Mensal: <dtCobranca> | Moura Leite Loteamentos",
    corpo: "Olá, <nmCliente>.\n\nSeu boleto referente a parcela de <dtCobranca> já está disponível em anexo.\nCidade e loteamento: <nmEmpreend> | Quadra/Lote: <nuUnidade>\n\n🔑 Como acessar o boleto:\n1. Abra o arquivo do boleto;\n2. Insira a senha solicitada (seu CPF ou CNPJ completo, sem pontos e traços);\n3. O pagamento pode ser realizado a partir de 1 hora após o recebimento deste e-mail.\n⚠️ Antes de concluir o pagamento, confira se os dados do beneficiário correspondem às informações do boleto.\n\n📲 Canais de atendimento Moura Leite:\nTelefone/WhatsApp: 4020-2109\nE-mail: relacionamento@mouraleite.com.br\nPortal do Cliente: https://www.mouraleite.com.br/portaldocliente/\n\n✨ Indique e Ganhe:\nAgora que você já conquistou seu lote, que tal indicar amigos e familiares? Seus indicados compram com desconto, e você recebe R$ 500 por venda concretizada.\nSaiba mais em mouraleite.com.br/indique-e-ganhe\n\nAtenciosamente,\n\nMoura Leite Loteamentos"
  },

  VARS_EMAIL: [
    { token: "<nmCliente>", label: "Nome do cliente" },
    { token: "<dtCobranca>", label: "Vencimento da parcela" },
    { token: "<nmEmpreend>", label: "Empreendimento" },
    { token: "<nuUnidade>", label: "Quadra/Lote" }
  ],

  CAIXAS: [
    { valor: "recebimentos@mouraleite.com.br", rotulo: "recebimentos@mouraleite.com.br" },
    { valor: "", rotulo: "Caixa padrão do Integra" }
  ],

  /** Unidade(s) do título no extrato do Sienge (campo units), usada no texto do e-mail. */
  unidadesDe(bill, item) {
    for (const row of [bill, item]) {
      if (!row) continue;
      if (typeof row.units === "string" && row.units.trim()) return row.units.trim();
      if (Array.isArray(row.units)) {
        const nomes = row.units.map((u) => u && (u.name || u.unitName || u.id)).filter(Boolean);
        if (nomes.length) return nomes.join(", ");
      }
      if (row.unitName) return String(row.unitName);
    }
    return "";
  },

  chave(r) {
    return String(r.titulo) + "_" + String(r.parcela);
  },

  COLS: [
    { id: "conta", label: "Conta" },
    { id: "empresa", label: "Empresa" },
    { id: "cc", label: "Centro de Custo" },
    { id: "empreendimento", label: "Empreendimento" },
    { id: "titulo", label: "Título" },
    { id: "parcela", label: "Parcela" },
    { id: "clienteId", label: "Id cliente" },
    { id: "cliente", label: "Cliente" },
    { id: "vencimento", label: "Vencimento" }
  ],

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  pad(n) {
    return String(n).padStart(2, "0");
  },

  iso(d) {
    return d.getFullYear() + "-" + this.pad(d.getMonth() + 1) + "-" + this.pad(d.getDate());
  },

  mesCorrente() {
    const hoje = new Date();
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 12);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 12);
    return { de: this.iso(ini), ate: this.iso(fim) };
  },

  fmtData(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  },

  empresasLista() {
    const lista = (window.AppState && AppState.companies) || [];
    return lista.map((c) => ({
      id: String(c.id),
      label: String(c.id) + " - " + String(c.name || c.tradeName || "").toUpperCase()
    }));
  },

  init() {
    const mes = this.mesCorrente();
    if (!this.state.de) this.state.de = mes.de;
    if (!this.state.ate) this.state.ate = mes.ate;
    this.state.inited = true;
    this.render();
    this.carregarEmpresas();
    this.carregarBatimento();
    if (!this.state.cfg) this.carregarConfig();
  },

  /* ---------- Pop-up do back office ----------
     No login, em dia útil, quando o batimento das 7h de hoje achou parcelas sem boleto (fora o primeiro dia útil,
     que é o da remessa mensal). "Lembrar mais tarde" esconde até a próxima entrada; "Abrir Remessa avulsa" leva
     para a tela e não mostra mais hoje. Só para o operador de cobrança back office (administrador não recebe). */
  AVISO_KEY: "crm_remav_aviso_",

  async avisar(previa) {
    const u = (window.AppState && AppState.currentUser) || null;
    if (!previa) {
      if (!(typeof window.isCobrancaBackOfficeUser === "function" && window.isCobrancaBackOfficeUser(u))) return;
      if (typeof window.hasCrmPerm === "function" && !window.hasCrmPerm("sub_fin_cr_remessa_avulsa_acessar")) return;
    }
    const hoje = this.iso(new Date());
    if (!previa) {
      try {
        if (localStorage.getItem(this.AVISO_KEY + hoje) === "1") return;
        if (sessionStorage.getItem(this.AVISO_KEY + hoje) === "depois") return;
      } catch (e) {}
    }
    let total = 0;
    let quando = "";
    if (previa) {
      total = 12;
      quando = hoje.split("-").reverse().join("/") + " 07:02";
    } else {
      // O banco pode ainda não estar pronto logo depois do login.
      for (let i = 0; i < 20 && !(window.DadosNucleo && typeof window.DadosNucleo.lerConfig === "function"); i++) await new Promise((r) => setTimeout(r, 1000));
      if (!window.DadosNucleo || typeof window.DadosNucleo.lerConfig !== "function") return;
      try {
        // Supabase: o batimento das 7h fica em configuracoes (remessa_avulsa_batimento/atual).
        const snap = await window.DadosNucleo.lerConfig("atual", "remessa_avulsa_batimento");
        const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
        if (!existe) return;
        const d = snap.data() || {};
        if (d.date !== hoje || !d.done || d.pulado || !Array.isArray(d.linhas)) return;
        total = Number(d.total) || d.linhas.length;
        const at = d.at ? new Date(d.at) : null;
        quando = at && !isNaN(at.getTime()) ? at.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "";
      } catch (e) {
        return;
      }
    }
    if (!total) return;
    this.abrirAviso(total, quando, !!previa);
  },

  abrirAviso(total, quando, previa) {
    if (!previa && typeof window.PopupAtivo === "function" && !window.PopupAtivo("remessa-avulsa")) return;
    let pop = document.getElementById("remav-aviso");
    if (pop) pop.remove();
    pop = document.createElement("div");
    pop.id = "remav-aviso";
    pop.className = "cem-modal";
    pop.dataset.previa = previa ? "1" : "";
    pop.innerHTML = `<div class="cem-card cem-card-aviso" role="dialog" aria-modal="true" aria-labelledby="remav-aviso-tit">
      <div class="cem-head"><h3 id="remav-aviso-tit">Boletos avulsos para gerar</h3></div>
      <div class="cem-body">
        <p style="margin:0 0 10px;color:#334155;">O batimento das 7h${quando ? " (" + this.esc(quando) + ")" : ""} encontrou <b>${Number(total).toLocaleString("pt-BR")} parcela(s)</b> deste mês sem boleto gerado.</p>
        <p style="margin:0;color:#475569;font-size:0.88rem;line-height:1.45;">Gere os boletos avulsos no Sienge e depois envie cada boleto por e-mail na Remessa avulsa, pela caixa <b>${this.esc(((this.state.cfg || this.CFG_PADRAO).remetente) || "padrão do Integra")}</b>, com o texto padrão.</p>
      </div>
      <div class="cem-foot" style="justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-outline" onclick="RemessaAvulsaApp.avisoDepois()">Lembrar mais tarde</button>
        <button type="button" class="btn btn-primary" onclick="RemessaAvulsaApp.avisoAbrir()">Abrir Remessa avulsa</button>
      </div>
    </div>`;
    document.body.appendChild(pop);
  },

  avisoFechar() {
    const pop = document.getElementById("remav-aviso");
    const previa = !!(pop && pop.dataset.previa === "1");
    if (pop) pop.remove();
    return previa;
  },

  avisoDepois() {
    if (this.avisoFechar()) return;
    try { sessionStorage.setItem(this.AVISO_KEY + this.iso(new Date()), "depois"); } catch (e) {}
  },

  avisoAbrir() {
    if (this.avisoFechar()) return;
    try { localStorage.setItem(this.AVISO_KEY + this.iso(new Date()), "1"); } catch (e) {}
    if (typeof window.switchTab === "function") window.switchTab("remessa-avulsa", "Remessa avulsa");
  },

  async carregarEmpresas() {
    if (this.empresasLista().length) return;
    if (!window.SiengeApiService || typeof SiengeApiService.getCompanies !== "function") return;
    try {
      const lista = await SiengeApiService.getCompanies();
      if (window.AppState) AppState.companies = lista || [];
      this.pintarEmpresas();
    } catch (e) {}
  },

  render() {
    const root = document.getElementById("remessa-avulsa-root");
    if (!root) return;
    const st = this.state;
    // Abas: Parcelas (a remessa e o envio do boleto) e Configurações (título, caixa e texto do e-mail).
    const aba = (id, ico, rot) => `<button type="button" role="tab" aria-selected="${st.aba === id}" class="ml-tab ${st.aba === id ? "is-active" : ""}" onclick="RemessaAvulsaApp.setAba('${id}')"><i data-lucide="${ico}"></i> ${rot}</button>`;
    const abas = `<div class="ml-tabs remav-abas" role="tablist">${aba("parcelas", "list", "Parcelas")}${aba("config", "settings", "Configurações")}</div>`;
    if (st.aba === "config") {
      root.innerHTML = abas + this.configHtml();
      this.ligarConfig();
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    // 27/11/2026: tela no padrão do Integra. Filtros, busca e ações numa linha; regra em nota recolhível;
    // KPIs compactos com o status do batimento; tabela cc-table (cabeçalho verde fixo, zebra, valores alinhados).
    root.innerHTML = abas + `
      <div class="remav-painel">
        <div class="remav-filtros">
          <div id="remav-emp"></div>
          <label class="remav-campo">Início<input type="date" id="remav-de" value="${this.esc(st.de)}"></label>
          <label class="remav-campo">Fim<input type="date" id="remav-ate" value="${this.esc(st.ate)}"></label>
          <label class="remav-campo remav-busca">Buscar<input type="search" id="remav-busca" placeholder="Título, cliente ou empreendimento" value="${this.esc(st.busca)}"></label>
          <div class="remav-acoes">
            <button type="button" class="btn btn-primary cc-atualizar" id="remav-analisar"><i data-lucide="refresh-cw" style="width:14px;height:14px;"></i> Analisar</button>
            <button type="button" class="btn btn-excel" id="remav-excel" title="Exportar a tabela atual para Excel" ${st.linhas.length ? "" : "disabled"}><i data-lucide="download" style="width:14px;height:14px;"></i> Exportar em Excel</button>
            <button type="button" class="btn btn-outline remav-enviar" id="remav-enviar" title="Enviar por e-mail o boleto das parcelas marcadas (o boleto precisa já estar gerado no Sienge)" onclick="RemessaAvulsaApp.enviarSelecionados()" disabled><i data-lucide="mail" style="width:14px;height:14px;"></i> <span id="remav-enviar-rot">Enviar por e-mail</span></button>
          </div>
        </div>
        <details class="remav-regra">
          <summary><i data-lucide="info" style="width:13px;height:13px;"></i> Quais parcelas entram?</summary>
          <p>Parcelas do período que ainda não têm boleto nem recebimento, com situação Normal e condição Parcelas Mensais ou Parcela Acordo. Entrada, sinal e parcela única não entram. Cliente com financiamento em aberto também fica de fora. O batimento do mês corrente roda todo dia às 7h. A conta é a cadastrada no centro de custo.</p>
        </details>
      </div>
      <div class="remav-resumo">
        <div id="remav-kpis" class="remav-kpis"></div>
        <div id="remav-status" class="remav-status"></div>
      </div>
      <div class="cc-scroll remav-scroll">
        <table class="cc-table remav-tabela" id="remav-tabela">
          <colgroup><col style="width:34px"><col style="width:8%"><col style="width:14%"><col style="width:6%"><col style="width:15%"><col style="width:6%"><col style="width:6%"><col style="width:7%"><col><col style="width:8%"><col style="width:150px"></colgroup>
          <thead><tr id="remav-head"></tr></thead>
          <tbody id="remav-body"></tbody>
        </table>
      </div>`;
    this.ligar();
    this.pintarEmpresas();
    this.pintarKpis();
    this.pintarStatus();
    this.pintarTabela();
    if (window.lucide) window.lucide.createIcons();
  },

  ligar() {
    const de = document.getElementById("remav-de");
    const ate = document.getElementById("remav-ate");
    const busca = document.getElementById("remav-busca");
    const analisar = document.getElementById("remav-analisar");
    const excel = document.getElementById("remav-excel");
    if (de) de.addEventListener("change", () => { this.state.de = de.value; });
    if (ate) ate.addEventListener("change", () => { this.state.ate = ate.value; });
    if (busca) busca.addEventListener("input", () => {
      this.state.busca = busca.value;
      this.pintarTabela();
      this.pintarKpis();
    });
    if (analisar) analisar.addEventListener("click", () => this.analisar());
    if (excel) excel.addEventListener("click", () => this.exportar());
    if (window.MlEmpresaFilter) {
      MlEmpresaFilter.bind("remav-empresas", {
        toggleOpen: () => {
          this.state.empOpen = !this.state.empOpen;
          this.pintarEmpresas();
        },
        setQuery: (q) => {
          this.state.empQuery = q;
          const list = document.getElementById("remav-empresas-list");
          if (list && window.MlEmpresaFilter) {
            list.innerHTML = MlEmpresaFilter.listHtml({
              id: "remav-empresas",
              items: this.empresasLista(),
              selectedIds: this.state.empresas,
              query: q
            });
          }
        },
        toggleId: (id, on) => {
          const set = new Set(this.state.empresas.map(String));
          if (on) set.add(String(id));
          else set.delete(String(id));
          this.state.empresas = Array.from(set);
          this.pintarEmpresas();
          this.pintarTabela();
          this.pintarKpis();
        },
        selectAll: () => {
          this.state.empresas = this.empresasLista().map((e) => e.id);
          this.pintarEmpresas();
          this.pintarTabela();
          this.pintarKpis();
        },
        selectNone: () => {
          this.state.empresas = [];
          this.pintarEmpresas();
          this.pintarTabela();
          this.pintarKpis();
        }
      });
    }
  },

  pintarEmpresas() {
    const host = document.getElementById("remav-emp");
    if (!host || !window.MlEmpresaFilter) return;
    host.innerHTML = MlEmpresaFilter.html({
      id: "remav-empresas",
      label: "Empresas",
      items: this.empresasLista(),
      selectedIds: this.state.empresas,
      open: this.state.empOpen,
      query: this.state.empQuery,
      emptyMeansAll: true
    });
    if (window.lucide) window.lucide.createIcons();
    if (this.state.empOpen && this.state.empQuery) {
      const input = document.getElementById("remav-empresas-search");
      if (input) {
        input.focus();
        const n = input.value.length;
        try { input.setSelectionRange(n, n); } catch (e) {}
      }
    }
  },

  visiveis() {
    const q = String(this.state.busca || "").trim().toLowerCase();
    const emp = new Set(this.state.empresas.map(String));
    let rows = this.state.linhas.filter((r) => !emp.size || emp.has(String(r.empresaId)));
    if (q) {
      rows = rows.filter((r) => {
        const blob = [r.conta, r.empresa, r.cc, r.empreendimento, r.titulo, r.parcela, r.clienteId, r.cliente].join(" ").toLowerCase();
        return blob.indexOf(q) >= 0;
      });
    }
    const col = this.state.sort;
    const dir = this.state.dir === "desc" ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const va = String(a[col] == null ? "" : a[col]);
      const vb = String(b[col] == null ? "" : b[col]);
      const na = Number(va);
      const nb = Number(vb);
      if (va !== "" && vb !== "" && Number.isFinite(na) && Number.isFinite(nb) && String(na) === va && String(nb) === vb) {
        return (na - nb) * dir;
      }
      return va.localeCompare(vb, "pt-BR", { numeric: true }) * dir;
    });
    return rows;
  },

  pintarKpis() {
    const box = document.getElementById("remav-kpis");
    if (!box) return;
    if (!this.state.analisou) {
      box.innerHTML = "";
      return;
    }
    const rows = this.visiveis();
    const titulos = new Set(rows.map((r) => r.titulo));
    const clientes = new Set(rows.map((r) => r.clienteId || r.cliente));
    const card = (rotulo, valor, ico) => `
      <div class="remav-kpi"><span class="remav-kpi-ico"><i data-lucide="${ico}"></i></span><div><label>${rotulo}</label><strong>${Number(valor || 0).toLocaleString("pt-BR")}</strong></div></div>`;
    box.innerHTML = card("Parcelas", rows.length, "list") + card("Títulos", titulos.size, "file-text") + card("Clientes", clientes.size, "users");
    if (window.lucide) window.lucide.createIcons();
  },

  pintarStatus() {
    const box = document.getElementById("remav-status");
    if (!box) return;
    // O carregamento aparece dentro da tabela (pintarTabela); aqui fica só a linha de status.
    if (this.state.loading) {
      box.innerHTML = "";
    } else if (this.state.erro) {
      box.innerHTML = `<span class="remav-tag is-erro"><i data-lucide="alert-triangle" style="width:13px;height:13px;"></i> ${this.esc(this.state.erro)}</span>`;
    } else if (this.state.pulado === "primeiro-dia-util" && !this.state.analisou) {
      box.innerHTML = `<span class="remav-tag"><i data-lucide="calendar" style="width:13px;height:13px;"></i> Hoje é o primeiro dia útil do mês: é o dia da remessa mensal, então o batimento das 7h não roda. Analisar lê o Sienge se precisar.</span>`;
    } else if (this.state.origem === "7h" && this.state.batimentoEm) {
      box.innerHTML = `<span class="remav-tag"><i data-lucide="clock" style="width:13px;height:13px;"></i> Batimento das 7h · ${this.esc(this.state.batimentoEm)}. Analisar lê o Sienge de novo.</span>`;
    } else {
      box.innerHTML = "";
    }
    if (window.lucide) window.lucide.createIcons();
  },

  th(col) {
    const centro = ["cc", "titulo", "parcela", "clienteId", "vencimento"].indexOf(col.id) >= 0;
    const ativo = this.state.sort === col.id;
    const ico = ativo ? (this.state.dir === "desc" ? "chevron-down" : "chevron-up") : "chevrons-up-down";
    return `<th class="${centro ? "is-center" : ""}${ativo ? " is-sorted" : ""}" onclick="RemessaAvulsaApp.ordenar('${col.id}')" style="cursor:pointer;user-select:none;">${this.esc(col.label === "Centro de Custo" ? "C. custo" : col.label)} <i data-lucide="${ico}" style="width:11px;height:11px;vertical-align:-1px;opacity:${ativo ? 1 : 0.6};"></i></th>`;
  },

  pintarTabela() {
    const head = document.getElementById("remav-head");
    const body = document.getElementById("remav-body");
    if (!head || !body) return;
    const visiveis = this.state.loading || !this.state.analisou ? [] : this.visiveis();
    const marcaveis = visiveis.filter((r) => !this.enviado(r));
    const todasMarcadas = marcaveis.length > 0 && marcaveis.every((r) => this.state.sel.has(this.chave(r)));
    head.innerHTML = `<th class="is-center"><input type="checkbox" title="Marcar todas as parcelas ainda não enviadas" ${todasMarcadas ? "checked" : ""} ${marcaveis.length ? "" : "disabled"} onchange="RemessaAvulsaApp.marcarTodas(this.checked)"></th>`
      + this.COLS.map((c) => this.th(c)).join("") + `<th class="is-center">E-mail do boleto</th>`;
    if (this.state.loading) {
      const w = Math.max(8, Math.min(100, this.state.progresso || 8));
      body.innerHTML = `<tr><td colspan="11" class="remav-vazio">
        <div class="ml-load" style="margin:8px auto;">
          <div class="loading-spinner" aria-hidden="true"></div>
          <div class="loading-status-text">${this.esc(this.state.status || "Analisando…")}</div>
          <div class="ml-load-track"><div class="loading-progress-bar" style="width:${w}%"></div></div>
        </div></td></tr>`;
    } else if (!this.state.analisou) {
      body.innerHTML = `<tr><td colspan="11" class="remav-vazio">Escolha o período e clique em Analisar.</td></tr>`;
    } else {
      const rows = visiveis;
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="11" class="remav-vazio">Nenhuma parcela elegível nesse período.</td></tr>`;
      } else {
        body.innerHTML = rows.map((r) => `<tr>
          <td class="is-center">${this.enviado(r) || this.vencida(r) ? "" : `<input type="checkbox" ${this.state.sel.has(this.chave(r)) ? "checked" : ""} onchange="RemessaAvulsaApp.marcar('${this.esc(this.chave(r))}', this.checked)">`}</td>
          <td title="${this.esc(r.conta || "")}">${this.esc(r.conta || "—")}</td>
          <td title="${this.esc(r.empresa)}">${this.esc(r.empresa)}</td>
          <td class="is-center">${this.esc(r.cc)}</td>
          <td title="${this.esc(r.empreendimento)}">${this.esc(r.empreendimento)}</td>
          <td class="is-center">${this.esc(r.titulo)}</td>
          <td class="is-center">${this.esc(r.parcela)}</td>
          <td class="is-center">${this.esc(r.clienteId)}</td>
          <td title="${this.esc(r.cliente)}">${this.esc(r.cliente)}</td>
          <td class="is-center">${this.esc(this.fmtData(r.vencimento))}</td>
          <td class="is-center remav-email-cel">${this.celulaEnvio(r)}</td>
        </tr>`).join("");
      }
    }
    this.pintarBotaoEnviar();
    const excel = document.getElementById("remav-excel");
    if (excel) excel.disabled = this.state.loading || !this.visiveis().length;
    const analisar = document.getElementById("remav-analisar");
    if (analisar) analisar.disabled = !!this.state.loading;
    if (window.lucide) window.lucide.createIcons();
  },

  ordenar(col) {
    if (this.state.sort === col) this.state.dir = this.state.dir === "asc" ? "desc" : "asc";
    else {
      this.state.sort = col;
      this.state.dir = "asc";
    }
    this.pintarTabela();
  },

  etapa(texto, progresso) {
    this.state.status = texto;
    this.state.progresso = progresso;
    this.pintarStatus();
    // O progresso aparece dentro da tabela: atualiza só a linha de carga, sem refazer o cabeçalho.
    const txt = document.querySelector("#remav-body .loading-status-text");
    const bar = document.querySelector("#remav-body .loading-progress-bar");
    if (txt && bar) {
      txt.textContent = texto || "Analisando…";
      bar.style.width = Math.max(8, Math.min(100, progresso || 8)) + "%";
    } else if (this.state.loading) {
      this.pintarTabela();
    }
  },

  dias(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12).getTime();
  },

  meio(de, ate) {
    const a = this.dias(de);
    const b = this.dias(ate);
    const m = new Date(a + Math.floor((b - a) / 2));
    const mid = this.iso(m);
    const next = new Date(m);
    next.setDate(next.getDate() + 1);
    return { mid: mid, next: this.iso(next) };
  },

  async bulk(path) {
    const once = window.siengeFetchWithRetry;
    if (typeof once !== "function") throw new Error("API Sienge indisponível.");
    const payload = await once(path, 4);
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  },

  async bulkPeriodo(montar, de, ate, depth) {
    try {
      return await this.bulk(montar(de, ate));
    } catch (err) {
      if (Number(err && err.status) !== 507 || de >= ate || depth > 8) throw err;
      const corte = this.meio(de, ate);
      if (!corte.mid || corte.mid < de || corte.mid >= ate || corte.next > ate) throw err;
      const esq = await this.bulkPeriodo(montar, de, corte.mid, depth + 1);
      const dir = await this.bulkPeriodo(montar, corte.next, ate, depth + 1);
      return esq.concat(dir);
    }
  },

  nomeEmpresa(id, fallback) {
    if (typeof getCompanyName === "function" && id) {
      const nome = getCompanyName(id, true);
      if (nome && nome.indexOf("Empresa #") !== 0) return nome;
    }
    return String(fallback || (id ? ("Empresa " + id) : "")).toUpperCase();
  },

  nomeCc(id, fallback) {
    if (typeof getCostCenterName === "function" && id) {
      const nome = getCostCenterName(id);
      if (nome) return String(nome).replace(/^(?:C\.C\.\s*)?(?:\d+\s*-\s*)+/i, "").trim().toUpperCase();
    }
    return String(fallback || "").toUpperCase();
  },

  async mapaContas() {
    const mapa = {};
    const app = window.CentrosCustoApp;
    if (!app || typeof app.carregarContasParceria !== "function") return mapa;
    try {
      const remoto = await app.carregarContasParceria();
      Object.keys(remoto || {}).forEach((id) => {
        const c = remoto[id] && remoto[id].conta;
        if (!c || !c.numero) return;
        const ag = String(c.agencia || "").trim();
        mapa[String(id)] = "Agencia: " + ag + " C/C: " + String(c.numero).trim();
      });
    } catch (e) {}
    return mapa;
  },

  obj(v) {
    return v && typeof v === "object" ? v : null;
  },

  titulosDoExtrato(row) {
    if (!row || typeof row !== "object") return [];
    if (row.billReceivableId || row.receivableBillId || Array.isArray(row.installments)) return [row];
    const nested = row.billsReceivable || row.bills;
    return Array.isArray(nested) ? nested : [];
  },

  semRecebimento(inst) {
    const recs = inst && inst.receipts;
    if (!recs) return true;
    const lista = Array.isArray(recs) ? recs : [recs];
    if (!lista.length) return true;
    return lista.every((r) => !r || r.type == null || String(r.type).trim() === "");
  },

  boletoNaoGerado(inst) {
    const v = inst && inst.sentToScripturalCharge;
    return v === false || v === "false" || v === 0 || v === "0";
  },

  situacaoNormal(valor) {
    return String(valor || "").trim().toLowerCase() === "normal";
  },

  condicaoElegivel(id, descricao) {
    const d = String(descricao || "");
    const i = String(id || "");
    if (d.indexOf("Entrada") >= 0) return false;
    if (i.indexOf("SI") >= 0) return false;
    if (d.indexOf("Unica") >= 0 || d.indexOf("Única") >= 0) return false;
    if (i.indexOf("SA") >= 0) return false;
    if (d === "Parcelas Mensais") return true;
    if (d.indexOf("Parcela Acordo") >= 0) return true;
    return false;
  },

  termoDaLinha(row) {
    const termo = this.obj(row && row.paymentTerm) || {};
    return {
      id: termo.id != null ? termo.id : (row && (row.paymentTermId || row.conditionType)),
      descricao: termo.descrition || termo.description || termo.name || ""
    };
  },

  soDigitos(v) {
    return String(v == null ? "" : v).replace(/\D/g, "");
  },

  async financiamentosAbertos() {
    const titulos = new Set();
    const clientes = new Set();
    const app = window.FinanciamentoApp;
    if (!app || typeof app.listOpenProcesses !== "function") return { titulos, clientes };
    try { if (app.puxarNuvem) await app.puxarNuvem(true); } catch (e) {}
    app.listOpenProcesses().forEach((row) => {
      const proc = row && row.proc;
      if (!proc) return;
      const titulo = this.soDigitos(proc.titulo);
      const cliente = this.soDigitos(proc.customerId);
      if (titulo) titulos.add(titulo);
      if (cliente) clientes.add(cliente);
    });
    return { titulos, clientes };
  },

  semFinanciamento(linhas, fin) {
    return linhas.filter((r) => !fin.titulos.has(this.soDigitos(r.titulo)) && !fin.clientes.has(this.soDigitos(r.clienteId)));
  },

  async carregarBatimento() {
    if (this.state.analisou || this.state.loading) return;
    // Supabase: o batimento das 7h fica em configuracoes ("remessa_avulsa_batimento/atual").
    if (!window.DadosNucleo || typeof window.DadosNucleo.lerConfig !== "function") return;
    const mes = this.mesCorrente();
    try {
      const snap = await window.DadosNucleo.lerConfig("atual", "remessa_avulsa_batimento");
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      if (!existe || this.state.analisou || this.state.loading) return;
      const data = snap.data() || {};
      // Primeiro dia útil do mês: o batimento das 7h não roda (é o dia da remessa mensal).
      if (data.pulado === "primeiro-dia-util" && data.date === this.iso(new Date())) {
        this.state.pulado = data.pulado;
        this.pintarStatus();
        return;
      }
      if (!data.done || data.de !== mes.de || data.ate !== mes.ate || !Array.isArray(data.linhas)) return;
      const fin = await this.financiamentosAbertos();
      if (this.state.analisou || this.state.loading) return;
      const contas = await this.mapaContas();
      this.state.de = mes.de;
      this.state.ate = mes.ate;
      this.state.linhas = this.semFinanciamento(data.linhas, fin).map((r) => ({
        conta: r.conta || contas[String(r.cc)] || "",
        empresaId: r.empresaId,
        empresa: this.nomeEmpresa(r.empresaId, r.empresa),
        cc: r.cc,
        empreendimento: this.nomeCc(r.cc, r.empreendimento),
        titulo: r.titulo,
        parcela: r.parcela,
        clienteId: r.clienteId,
        cliente: r.cliente,
        unidade: r.unidade || "",
        vencimento: r.vencimento
      }));
      this.state.analisou = true;
      this.state.origem = "7h";
      this.carregarEnvios();
      const quando = data.at ? new Date(data.at) : null;
      this.state.batimentoEm = quando && !isNaN(quando.getTime())
        ? quando.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : this.fmtData(data.date);
      this.render();
    } catch (e) {}
  },

  async analisar() {
    const de = String((document.getElementById("remav-de") || {}).value || this.state.de || "");
    const ate = String((document.getElementById("remav-ate") || {}).value || this.state.ate || "");
    this.state.de = de;
    this.state.ate = ate;
    if (!de || !ate || de > ate) {
      this.state.erro = "Informe o início e o fim do vencimento.";
      this.pintarStatus();
      return;
    }
    const dias = Math.round((this.dias(ate) - this.dias(de)) / 86400000) + 1;
    if (dias > 62) {
      this.state.erro = "O período pode ter no máximo 62 dias. A consulta da planilha é a do mês do vencimento.";
      this.pintarStatus();
      return;
    }
    const geracao = ++this.state.geracao;
    this.state.loading = true;
    this.state.erro = "";
    this.state.analisou = false;
    this.etapa("Lendo o extrato do período…", 18);
    this.pintarTabela();
    try {
      const extratoPath = (ini, fim) => "/bulk-data/v1/customer-extract-history?startDueDate=" + encodeURIComponent(ini)
        + "&endDueDate=" + encodeURIComponent(fim)
        + "&documentsId=" + encodeURIComponent("CT,TC")
        + "&includeRemadeInstallments=false&includeCanceledInstallments=false&includeRevokedInstallments=false&includeRenegotiatedDischarge=false";
      const incomePath = (ini, fim) => "/bulk-data/v1/income?startDate=" + encodeURIComponent(ini)
        + "&endDate=" + encodeURIComponent(fim)
        + "&selectionType=D";
      const condicaoPath = (ini, fim) => incomePath(ini, fim) + "&originsIds=CO";
      const extrato = await this.bulkPeriodo(extratoPath, de, ate, 0);
      if (geracao !== this.state.geracao) return;
      this.etapa("Lendo a situação dos títulos…", 48);
      const income = await this.bulkPeriodo(incomePath, de, ate, 0);
      if (geracao !== this.state.geracao) return;
      this.etapa("Lendo as condições de pagamento…", 72);
      const condicoes = await this.bulkPeriodo(condicaoPath, de, ate, 0);
      if (geracao !== this.state.geracao) return;
      this.etapa("Montando a remessa…", 90);
      const contas = await this.mapaContas();
      const situacao = new Map();
      income.forEach((row) => {
        const id = String(row && (row.billId || row.receivableBillId || row.billReceivableId) || "");
        if (!id) return;
        if (!situacao.has(id)) situacao.set(id, new Set());
        situacao.get(id).add(String(row.defaulterSituation || ""));
      });
      const termos = new Map();
      condicoes.forEach((row) => {
        const titulo = String(row && (row.billId || row.receivableBillId) || "");
        const parcela = String(row && (row.installmentId != null ? row.installmentId : row.installmentNumber) || "");
        if (!titulo || !parcela) return;
        const termo = this.termoDaLinha(row);
        const chave = titulo + "|" + parcela;
        if (!termos.has(chave)) termos.set(chave, []);
        termos.get(chave).push(termo);
      });
      const vistos = new Set();
      const linhas = [];
      extrato.forEach((item) => {
        this.titulosDoExtrato(item).forEach((bill) => {
          const titulo = String(bill.billReceivableId || bill.receivableBillId || "");
          if (!titulo) return;
          const sits = situacao.get(titulo);
          if (!sits) return;
          let normal = false;
          sits.forEach((s) => { if (this.situacaoNormal(s)) normal = true; });
          if (!normal) return;
          const empresaObj = this.obj(bill.company) || this.obj(item.company);
          const ccObj = this.obj(bill.costCenter) || this.obj(item.costCenter);
          const cliObj = this.obj(bill.customer) || this.obj(item.customer);
          const empresaId = String((empresaObj && (empresaObj.id || empresaObj.companyId)) || bill.companyId || item.companyId || "");
          const ccId = String((ccObj && (ccObj.id || ccObj.costCenterId)) || bill.costCenterId || item.costCenterId || "");
          const clienteId = String((cliObj && cliObj.id) || bill.clientId || bill.customerId || "");
          const cliente = String((cliObj && (cliObj.name || cliObj.tradeName)) || bill.clientName || "");
          (bill.installments || []).forEach((inst) => {
            if (!inst || !this.boletoNaoGerado(inst) || !this.semRecebimento(inst)) return;
            const venc = String(inst.dueDate || inst.originalDueDate || "").slice(0, 10);
            if (!venc || venc < de || venc > ate) return;
            const parcela = String(inst.id != null ? inst.id : (inst.installmentId != null ? inst.installmentId : ""));
            if (!parcela) return;
            const lista = termos.get(titulo + "|" + parcela) || [];
            if (!lista.some((t) => this.condicaoElegivel(t.id, t.descricao))) return;
            const chave = titulo + "|" + parcela;
            if (vistos.has(chave)) return;
            vistos.add(chave);
            linhas.push({
              conta: contas[ccId] || "",
              empresaId: empresaId,
              empresa: this.nomeEmpresa(empresaId, empresaObj && empresaObj.name),
              cc: ccId,
              empreendimento: this.nomeCc(ccId, ccObj && ccObj.name),
              titulo: titulo,
              parcela: parcela,
              clienteId: clienteId,
              cliente: cliente.toUpperCase(),
              unidade: this.unidadesDe(bill, item),
              vencimento: venc
            });
          });
        });
      });
      linhas.sort((a, b) => String(a.conta).localeCompare(b.conta, "pt-BR")
        || String(a.empresa).localeCompare(b.empresa, "pt-BR")
        || String(a.cc).localeCompare(b.cc, "pt-BR", { numeric: true })
        || String(a.cliente).localeCompare(b.cliente, "pt-BR"));
      if (geracao !== this.state.geracao) return;
      const fin = await this.financiamentosAbertos();
      if (geracao !== this.state.geracao) return;
      this.state.linhas = this.semFinanciamento(linhas, fin);
      this.state.origem = "";
      this.state.contas = contas;
      this.state.analisou = true;
      this.state.loading = false;
      this.state.status = "";
      this.pintarStatus();
      this.pintarKpis();
      this.pintarTabela();
      this.carregarEnvios();
    } catch (e) {
      if (geracao !== this.state.geracao) return;
      this.state.loading = false;
      this.state.erro = (e && e.message) || "Não foi possível ler o Sienge.";
      this.pintarStatus();
      this.pintarTabela();
    }
  },

  /* ---------- Envio do boleto por e-mail ----------
     O back office gera o boleto avulso no Sienge; aqui o Integra busca a 2ª via (PDF) e manda para o e-mail do
     cliente pela caixa configurada, com o texto da aba Configurações. Envios ficam em remessa_avulsa_envios. */
  setAba(id) {
    this.state.aba = id === "config" ? "config" : "parcelas";
    if (this.state.aba === "config" && !this.state.cfg) this.carregarConfig();
    this.render();
  },

  enviado(r) {
    const e = this.state.envios[this.chave(r)];
    return !!(e && e.status === "enviado");
  },

  /** Vencimento antes de hoje: o boleto não vai por e-mail; o operador contata o cliente para gerar em outra data. */
  vencida(r) {
    const d = new Date();
    const hoje = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return !!(r && r.vencimento && String(r.vencimento).slice(0, 10) < hoje);
  },

  async contatarCliente(k) {
    const r = this.state.linhas.find((x) => this.chave(x) === k);
    if (!r) return;
    if (typeof window.viewCustomerCard !== "function") {
      alert("A ficha do cliente não está disponível nesta página. Atualize (Ctrl+F5).");
      return;
    }
    await window.viewCustomerCard(r.clienteId, r.titulo, r.titulo);
  },

  celulaEnvio(r) {
    const e = this.state.envios[this.chave(r)];
    const k = this.esc(this.chave(r));
    if (e && e.status === "enviado") {
      const quando = e.em ? new Date(e.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "";
      return `<span class="remav-env is-ok" title="Enviado para ${this.esc(e.para || "")}${e.por ? " por " + this.esc(e.por) : ""}">Enviado ${this.esc(quando)}</span>
        <button type="button" class="remav-env-btn" title="Enviar de novo" onclick="RemessaAvulsaApp.enviarUm('${k}', true)"><i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i></button>`;
    }
    if (e && e.status === "enviando") return `<span class="remav-env">Enviando…</span>`;
    if (this.vencida(r)) {
      return `<span class="remav-env is-vencido" title="Vencimento já passou: o boleto não pode ir por e-mail. Contate o cliente para gerar o boleto em outra data e registre em Ocorrências e Promessas.">Vencido</span>
        <button type="button" class="remav-env-btn is-texto is-contato" title="Abrir a ficha do cliente para contatar e registrar em Ocorrências e Promessas" onclick="RemessaAvulsaApp.contatarCliente('${k}')"><i data-lucide="phone" style="width:13px;height:13px;"></i> Contatar cliente</button>`;
    }
    const erro = e && e.status === "erro" ? `<span class="remav-env is-erro" title="${this.esc(e.erro || "")}">Erro</span>` : "";
    return `${erro}<button type="button" class="remav-env-btn is-texto" title="Enviar o boleto desta parcela por e-mail" onclick="RemessaAvulsaApp.enviarUm('${k}', false)" ${this.state.enviando ? "disabled" : ""}><i data-lucide="mail" style="width:13px;height:13px;"></i> ${e && e.status === "erro" ? "Tentar de novo" : "Enviar"}</button>`;
  },

  marcar(k, on) {
    if (on) this.state.sel.add(k);
    else this.state.sel.delete(k);
    this.pintarTabela();
  },

  marcarTodas(on) {
    this.visiveis().forEach((r) => {
      if (this.enviado(r) || this.vencida(r)) return;
      if (on) this.state.sel.add(this.chave(r));
      else this.state.sel.delete(this.chave(r));
    });
    this.pintarTabela();
  },

  pintarBotaoEnviar() {
    const btn = document.getElementById("remav-enviar");
    const rot = document.getElementById("remav-enviar-rot");
    if (!btn) return;
    const n = this.visiveis().filter((r) => this.state.sel.has(this.chave(r)) && !this.enviado(r) && !this.vencida(r)).length;
    btn.disabled = !n || this.state.enviando || this.state.loading;
    if (rot) rot.textContent = this.state.enviando ? "Enviando…" : (n ? "Enviar por e-mail (" + n + ")" : "Enviar por e-mail");
  },

  async carregarEnvios() {
    // Supabase: cada envio fica em configuracoes (remessa_avulsa_envios/<título>_<parcela>), gravado pelo servidor.
    if (!window.DadosNucleo || typeof window.DadosNucleo.listarDocs !== "function") return;
    try {
      const snap = await window.DadosNucleo.listarDocs("remessa_avulsa_envios");
      const mapa = {};
      snap.forEach((d) => {
        const v = d.data() || {};
        const venc = String(v.vencimento || "");
        if (venc && (venc < this.state.de || venc > this.state.ate)) return;
        mapa[d.id] = v;
      });
      // Mantém o que acabou de ser enviado nesta tela e ainda não voltou da leitura.
      Object.keys(this.state.envios).forEach((k) => { if (!mapa[k] && this.state.envios[k].status !== "enviando") mapa[k] = this.state.envios[k]; });
      this.state.envios = mapa;
      this.pintarTabela();
    } catch (e) {
      console.warn("[Remessa avulsa] envios", e);
    }
  },

  async enviarUm(k, reenviar) {
    const r = this.state.linhas.find((x) => this.chave(x) === k);
    if (!r) return;
    await this.enviar([r], !!reenviar);
  },

  async enviarSelecionados() {
    const rows = this.visiveis().filter((r) => this.state.sel.has(this.chave(r)) && !this.enviado(r) && !this.vencida(r));
    if (!rows.length) return;
    await this.enviar(rows, false);
  },

  async enviar(rows, reenviar) {
    if (this.state.enviando) return;
    const vencidas = (rows || []).filter((r) => this.vencida(r));
    if (vencidas.length) {
      alert("Parcela com vencimento já passado não pode ter o boleto enviado por e-mail. Contate o cliente para gerar o boleto em outra data e registre em Ocorrências e Promessas.");
      rows = rows.filter((r) => !this.vencida(r));
      if (!rows.length) return;
    }
    // Pede o login já no clique (abre a janela da Microsoft se o token não renovou sozinho).
    const auth = window.MouraAuth;
    let pedidoToken = Promise.resolve("");
    try {
      if (auth && typeof auth.getIntegraTokenInterativo === "function") pedidoToken = auth.getIntegraTokenInterativo();
      else if (auth && typeof auth.getIntegraToken === "function") pedidoToken = auth.getIntegraToken();
    } catch (e) {}
    const cfg = this.state.cfg || this.CFG_PADRAO;
    const caixa = cfg.remetente || "caixa padrão do Integra";
    const pergunta = (reenviar ? "Enviar de novo" : "Enviar") + " o boleto de " + rows.length + " parcela(s) por e-mail, pela caixa " + caixa + "?\n\nO boleto precisa já estar gerado no Sienge; sem ele a parcela volta com erro.";
    const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(pergunta) : false;
    if (!ok) return;
    let token = "";
    try { token = await pedidoToken; } catch (e) { token = ""; }
    this.state.enviando = true;
    rows.forEach((r) => { this.state.envios[this.chave(r)] = { status: "enviando" }; });
    this.pintarTabela();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Integra-Token"] = token;
    let enviados = 0;
    const erros = [];
    try {
      for (let i = 0; i < rows.length; i += 10) {
        const lote = rows.slice(i, i + 10);
        const itens = lote.map((r) => ({ titulo: r.titulo, parcela: r.parcela, clienteId: r.clienteId, cliente: r.cliente, empreendimento: r.empreendimento, unidade: r.unidade || "", vencimento: r.vencimento }));
        let body = {};
        try {
          const res = await fetch("/api/remessa-avulsa-email", { method: "POST", headers, body: JSON.stringify({ itens, reenviar: !!reenviar }) });
          body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || ("HTTP " + res.status));
        } catch (e) {
          lote.forEach((r) => { this.state.envios[this.chave(r)] = { status: "erro", erro: (e && e.message) || String(e) }; });
          erros.push((e && e.message) || String(e));
          continue;
        }
        (body.resultados || []).forEach((x) => {
          const k = String(x.titulo) + "_" + String(x.parcela);
          if (x.status === "enviado" || x.status === "ja-enviado") {
            this.state.envios[k] = { status: "enviado", em: x.em || new Date().toISOString(), para: x.para || "" };
            this.state.sel.delete(k);
            if (x.status === "enviado") enviados += 1;
          } else {
            this.state.envios[k] = { status: "erro", erro: x.erro || "Erro no envio." };
            erros.push(x.erro || "Erro no envio.");
          }
        });
      }
    } finally {
      this.state.enviando = false;
      this.pintarTabela();
    }
    const msg = enviados + " boleto(s) enviado(s)." + (erros.length ? " " + erros.length + " com erro: " + Array.from(new Set(erros)).slice(0, 3).join(" | ") : "");
    if (typeof window.showToast === "function") window.showToast(msg, erros.length ? "warning" : "success");
    else alert(msg);
    this.carregarEnvios();
  },

  /* ---------- Configurações do e-mail ---------- */
  async carregarConfig() {
    let salvo = null;
    try {
      // Supabase: config/remessa_avulsa_email em configuracoes (a mesma chave que o servidor lê no envio).
      if (window.DadosNucleo && typeof window.DadosNucleo.lerConfig === "function") {
        const snap = await window.DadosNucleo.lerConfig("remessa_avulsa_email");
        if (snap && snap.exists()) salvo = snap.data() || null;
      }
    } catch (e) {
      console.warn("[Remessa avulsa] configuração", e);
    }
    this.state.cfg = Object.assign({}, this.CFG_PADRAO, salvo || {});
    if (this.state.aba === "config") this.render();
  },

  configHtml() {
    const c = this.state.cfg;
    if (!c) return `<div class="remav-painel"><p class="remav-vazio-txt">Carregando a configuração…</p></div>`;
    const caixas = this.CAIXAS.map((x) => `<option value="${this.esc(x.valor)}"${String(c.remetente || "") === x.valor ? " selected" : ""}>${this.esc(x.rotulo)}</option>`).join("");
    const vars = this.VARS_EMAIL.map((v) => `<button type="button" class="cem-var" title="Inserir ${this.esc(v.token)} no texto" onclick="RemessaAvulsaApp.inserirVar('${this.esc(v.token)}')">${this.esc(v.label)} <small>${this.esc(v.token)}</small></button>`).join("");
    return `<div class="remav-painel remav-cfg">
        <div class="remav-cfg-grade">
          <label class="remav-campo">Enviar de<select id="remav-cfg-de">${caixas}</select></label>
          <label class="remav-campo">Cópia (CC)<input id="remav-cfg-cc" value="${this.esc(c.cc || "")}" placeholder="Separe por vírgula"></label>
          <label class="remav-campo remav-cfg-span">Título do e-mail<input id="remav-cfg-assunto" value="${this.esc(c.assunto || "")}"></label>
          <label class="remav-campo remav-cfg-span">Corpo do e-mail<textarea id="remav-cfg-corpo" rows="18">${this.esc(c.corpo || "")}</textarea></label>
        </div>
        <aside class="remav-cfg-lado">
          <h4>Variáveis do Sienge</h4>
          <p>Clique para inserir no corpo. No envio, cada uma vira o dado da parcela.</p>
          <div class="remav-cfg-vars">${vars}</div>
          <h4>Prévia</h4>
          <div id="remav-cfg-previa" class="remav-cfg-previa"></div>
        </aside>
      </div>
      <div class="remav-cfg-rodape">
        <span>${c.atualizadoPor ? "Última alteração: " + this.esc(c.atualizadoPor) + (c.atualizadoEm ? " · " + this.esc(new Date(c.atualizadoEm).toLocaleString("pt-BR")) : "") : "Texto padrão do Sienge (ainda não alterado)."} O boleto vai em anexo, em PDF.</span>
        <div>
          <button type="button" class="btn btn-outline" onclick="RemessaAvulsaApp.restaurarConfig()">Restaurar texto do Sienge</button>
          <button type="button" class="btn btn-primary" onclick="RemessaAvulsaApp.salvarConfig()"><i data-lucide="save" style="width:14px;height:14px;"></i> Salvar</button>
        </div>
      </div>`;
  },

  ligarConfig() {
    ["remav-cfg-assunto", "remav-cfg-corpo"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => this.previaConfig());
    });
    this.previaConfig();
  },

  /** Prévia com uma parcela de exemplo (ou a primeira da tabela, se já analisada). */
  previaConfig() {
    const box = document.getElementById("remav-cfg-previa");
    if (!box) return;
    const r = this.state.linhas[0] || { cliente: "MARIA JOSE DE OLIVEIRA", vencimento: "2026-12-10", empreendimento: "ITU - TERRAS DE ITU", unidade: "Q 12 L 08" };
    const nome = String(r.cliente || "").toLowerCase().split(/\s+/).map((p, i) => (i > 0 && /^(de|da|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
    const v = { "<nmCliente>": nome, "<dtCobranca>": this.fmtData(r.vencimento), "<nmEmpreend>": r.empreendimento || "—", "<nuUnidade>": r.unidade || "—" };
    const aplicar = (s) => { let t = String(s || ""); Object.keys(v).forEach((k) => { t = t.split(k).join(v[k]); }); return t; };
    const assunto = aplicar((document.getElementById("remav-cfg-assunto") || {}).value);
    const corpo = aplicar((document.getElementById("remav-cfg-corpo") || {}).value);
    box.innerHTML = `<div class="remav-cfg-previa-tit"><b>Título:</b> ${this.esc(assunto)}</div><div>${this.esc(corpo).replace(/\r?\n/g, "<br>")}</div><div class="remav-cfg-anexo">📎 Boleto ${this.esc(r.titulo || "12345")}-${this.esc(r.parcela || "4")}.pdf</div>`;
  },

  inserirVar(token) {
    const el = document.getElementById("remav-cfg-corpo");
    if (!el) return;
    const i = el.selectionStart || 0;
    const f = el.selectionEnd || 0;
    el.value = el.value.slice(0, i) + token + el.value.slice(f);
    el.focus();
    el.setSelectionRange(i + token.length, i + token.length);
    this.previaConfig();
  },

  async restaurarConfig() {
    const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm("Voltar o título e o texto para o padrão do Sienge? A mudança só vale depois de Salvar.") : false;
    if (!ok) return;
    const a = document.getElementById("remav-cfg-assunto");
    const c = document.getElementById("remav-cfg-corpo");
    if (a) a.value = this.CFG_PADRAO.assunto;
    if (c) c.value = this.CFG_PADRAO.corpo;
    this.previaConfig();
  },

  async salvarConfig() {
    const val = (id) => String((document.getElementById(id) || {}).value || "");
    const assunto = val("remav-cfg-assunto").trim();
    const corpo = val("remav-cfg-corpo");
    if (!assunto || !corpo.trim()) {
      alert("Informe o título e o corpo do e-mail.");
      return;
    }
    const cc = val("remav-cfg-cc").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const ruins = cc.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (ruins.length) {
      alert("E-mail inválido na cópia: " + ruins.join(", "));
      return;
    }
    const u = (window.AppState && AppState.currentUser) || {};
    const dados = {
      remetente: val("remav-cfg-de").trim().toLowerCase(),
      cc: cc.join(", "),
      assunto,
      corpo,
      atualizadoPor: String(u.name || u.email || ""),
      atualizadoEm: new Date().toISOString()
    };
    if (!window.DadosNucleo || typeof window.DadosNucleo.gravarConfig !== "function") {
      alert("O banco não está disponível agora. Tente de novo em instantes.");
      return;
    }
    try {
      await window.DadosNucleo.gravarConfig("remessa_avulsa_email", dados, { merge: true });
      this.state.cfg = Object.assign({}, this.CFG_PADRAO, dados);
      if (typeof window.showToast === "function") window.showToast("Configuração do e-mail salva.", "success");
      this.render();
    } catch (e) {
      alert("Não consegui salvar a configuração: " + ((e && e.message) || e));
    }
  },

  async exportar() {
    const rows = this.visiveis();
    if (!rows.length) return;
    const inv = window.InvestimentoApp;
    if (!inv || typeof inv.ensureExcelJS !== "function") {
      alert("A exportação em Excel não está disponível nesta tela.");
      return;
    }
    const ExcelJS = await inv.ensureExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = "CRM Moura Leite";
    const porEmpresa = new Map();
    rows.forEach((r) => {
      const id = r.empresaId || "0";
      if (!porEmpresa.has(id)) porEmpresa.set(id, []);
      porEmpresa.get(id).push(r);
    });
    const used = new Set();
    const headers = this.COLS.map((c) => c.label);
    let logo = null;
    try { logo = await inv.logoDataUrl(); } catch (e) { logo = null; }
    for (const [id, lista] of porEmpresa) {
      const nome = inv.excelSheetName(id, used);
      const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", xSplit: 1, ySplit: 4, showGridLines: false }] });
      ws.getColumn(1).width = 34;
      ws.getColumn(2).width = 36;
      ws.getColumn(3).width = 16;
      ws.getColumn(4).width = 32;
      ws.getColumn(5).width = 14;
      ws.getColumn(6).width = 12;
      ws.getColumn(7).width = 14;
      ws.getColumn(8).width = 36;
      ws.getColumn(9).width = 16;
      ws.mergeCells("A1:A2");
      const titulo = ws.getCell("A1");
      titulo.value = "Remessa avulsa\n" + this.fmtData(this.state.de) + " a " + this.fmtData(this.state.ate);
      inv.excelPaint(titulo, {
        font: { size: 14, bold: true, color: { argb: "FF475569" } },
        align: { vertical: "middle", horizontal: "left", wrapText: true, indent: 8 }
      });
      ws.getRow(1).height = 28;
      ws.getRow(2).height = 22;
      ws.getRow(3).height = 8;
      const kpis = [["Parcelas", lista.length], ["Títulos", new Set(lista.map((r) => r.titulo)).size], ["Clientes", new Set(lista.map((r) => r.clienteId || r.cliente)).size]];
      kpis.forEach((par, i) => {
        const col = 4 + i;
        const rot = ws.getCell(1, col);
        rot.value = par[0];
        inv.excelPaint(rot, { font: { size: 8, bold: true, color: { argb: "FF94A3B8" } }, align: { horizontal: "right", vertical: "middle" } });
        const val = ws.getCell(2, col);
        val.value = par[1];
        inv.excelPaint(val, { font: { size: 12, bold: true, color: { argb: "FF105436" } }, align: { horizontal: "right", vertical: "middle" } });
      });
      const head = ws.getRow(4);
      head.height = 20;
      headers.forEach((h, i) => {
        const cell = head.getCell(i + 1);
        cell.value = h;
        inv.excelPaint(cell, {
          font: { size: 9, bold: true, color: { argb: "FFFFFFFF" } },
          fill: "FF334155",
          align: { vertical: "middle", horizontal: i >= 2 && i <= 6 || i === 8 ? "right" : "left" },
          border: true
        });
      });
      lista.forEach((r) => {
        const line = ws.addRow([
          r.conta || "",
          r.empresa,
          r.cc,
          r.empreendimento,
          r.titulo,
          r.parcela,
          r.clienteId,
          r.cliente,
          r.vencimento ? new Date(r.vencimento + "T12:00:00") : null
        ]);
        line.eachCell((cell, col) => {
          const opts = {
            font: { size: 9, color: { argb: "FF0F172A" } },
            border: true,
            align: { vertical: "middle", horizontal: col >= 3 && col <= 7 ? "right" : "left" }
          };
          if (col === 9) opts.numFmt = "dd/mm/yyyy";
          inv.excelPaint(cell, opts);
        });
      });
      const foot = ws.addRow([]);
      const rodape = ws.addRow([inv.generatedAtLabel(new Date())]);
      inv.excelPaint(rodape.getCell(1), { font: { size: 8, italic: true, color: { argb: "FF64748B" } } });
      void foot;
      if (logo && logo.dataUrl) {
        const img = wb.addImage({ base64: logo.dataUrl, extension: logo.extension || "png" });
        ws.addImage(img, { tl: { col: 0, row: 0 }, ext: { width: 58, height: 58 } });
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Remessa_avulsa_" + this.state.de + "_" + this.state.ate + ".xlsx";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
};

document.addEventListener("tabChanged", function (e) {
  if (e.detail === "remessa-avulsa" && window.RemessaAvulsaApp) RemessaAvulsaApp.init();
});

window.RemessaAvulsaApp = RemessaAvulsaApp;

// Prévia na Gestão de pop-ups: o mesmo pop-up, com número de exemplo; os botões só fecham.
window.PopupPrevias = window.PopupPrevias || {};
window.PopupPrevias["remessa-avulsa"] = function () { RemessaAvulsaApp.avisar(true); };
