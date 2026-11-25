/* Central de e-mail da cobrança.
   O operador grava o texto com variáveis, escolhe a tag da fila e quantos dias depois do vencimento o cliente entra na fila do dia. */
const CentralEmailApp = {
  state: { templates: [], pronto: false, aba: "templates" },

  VARIAVEIS: [
    { token: "{{saudacao}}", label: "Bom dia / Boa tarde", grupo: "Saudação" },
    { token: "{{primeiro_nome}}", label: "Primeiro nome", grupo: "Cliente" },
    { token: "{{nome}}", label: "Nome completo", grupo: "Cliente" },
    { token: "{{unidade}}", label: "Unidade", grupo: "Imóvel" },
    { token: "{{empreendimento}}", label: "Empreendimento", grupo: "Imóvel" },
    { token: "{{cidade}}", label: "Cidade", grupo: "Imóvel" },
    { token: "{{titulo}}", label: "Título", grupo: "Imóvel" },
    { token: "{{vencimento}}", label: "Vencimento", grupo: "Parcelas" },
    { token: "{{texto_abertas}}", label: "Parcelas em aberto", grupo: "Parcelas" },
    { token: "{{ordinal_proxima}}", label: "Próxima parcela", grupo: "Parcelas" },
    { token: "{{vencimento_proxima}}", label: "Vencimento da próxima", grupo: "Parcelas" },
    { token: "{{quadro_parcelas}}", label: "Quadro de parcelas vencidas", grupo: "Parcelas" },
    { token: "{{extrato}}", label: "Extrato em anexo (PDF)", grupo: "Anexo" }
  ],

  TEXTO_EXTRATO: "Segue em anexo o extrato financeiro atualizado.",
  PARCELAS_EXEMPLO: [
    { numero: 3, tipo: "E2", vencimento: "2026-10-10", dias: 39, semJuros: 340.2, corrigido: 356.87 },
    { numero: 4, tipo: "E2", vencimento: "2026-11-10", dias: 8, semJuros: 340.2, corrigido: 342.1 }
  ],

  EXEMPLO: {
    primeiro_nome: "Nonata",
    nome: "NONATA NAYARA DE ARAÚJO MESQUITA",
    unidade: "Q 12 L 08",
    empreendimento: "Terras de Itu",
    cidade: "Itu",
    vencimento: "10/10/2026",
    texto_abertas: "01 parcela em aberto",
    ordinal_proxima: "2ª",
    vencimento_proxima: "10/11",
    titulo: "16752"
  },

  esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  podeEditar() {
    if (typeof window.hasCrmPerm !== "function") return true;
    return !!window.hasCrmPerm("sub_fin_cr_central_email_editar");
  },

  eu() {
    const u = (typeof window.crmUsuarioAcesso === "function" && window.crmUsuarioAcesso())
      || (window.AppState && window.AppState.currentUser)
      || {};
    return {
      email: String(u.email || "").trim().toLowerCase(),
      nome: String(u.name || "").replace(/ no usuário .+$/i, "").trim()
    };
  },

  souAdmin() {
    const u = (window.AppState && window.AppState.currentUser) || null;
    return typeof window.isCrmAdministrator === "function" && window.isCrmAdministrator(u);
  },

  /* Caixas de onde o e-mail pode sair. Vazio = caixa padrão do Integra (GRAPH_MAILBOX na Vercel).
     Cada caixa extra também precisa estar em GRAPH_MAILBOXES_EXTRAS na Vercel; sem isso o servidor recusa o envio. */
  CAIXAS_ENVIO: [
    { valor: "", rotulo: "Caixa padrão do Integra" },
    { valor: "recebimentos@mouraleite.com.br", rotulo: "recebimentos@mouraleite.com.br" }
  ],

  caixaValida(v) {
    const alvo = String(v || "").trim().toLowerCase();
    return this.CAIXAS_ENVIO.some((c) => c.valor === alvo) ? alvo : "";
  },

  rotuloCaixa(v) {
    const c = this.CAIXAS_ENVIO.find((x) => x.valor === this.caixaValida(v));
    return c ? c.rotulo : this.CAIXAS_ENVIO[0].rotulo;
  },

  assinatura(t) {
    return [t && t.nome, t && t.assunto, t && t.corpo, t && t.tag, t && t.diasVencido,
      (t && t.destino) || "contrato", (t && t.para) || "", (t && t.cc) || "", (t && t.remetente) || ""].join("\u0001");
  },

  // Lista de e-mails válidos, sem repetição, a partir de texto separado por vírgula, ponto e vírgula ou espaço.
  listaEmails(texto) {
    const vistos = new Set();
    return String(texto || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || vistos.has(e)) return false;
      vistos.add(e);
      return true;
    });
  },

  emailsInvalidos(texto) {
    return String(texto || "").split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  },

  // Para quem vai o e-mail daquele cliente: e-mails do contrato ou o e-mail escolhido no template.
  destinatarios(t, client) {
    const para = t && t.destino === "fixo" ? this.listaEmails(t.para) : this.listaEmails(this.emailDe(client));
    return { para, cc: this.listaEmails(t && t.cc) };
  },

  iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },

  dataBr(iso) {
    const p = String(iso || "").slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "";
  },

  dataDeMs(ms) {
    if (!ms) return "";
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return "";
    return this.dataBr(this.iso(d));
  },

  dataMais(dias) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + (Number(dias) || 0));
    return this.dataBr(this.iso(d));
  },

  titulo(texto) {
    return String(texto || "").toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  },

  ordinal(n) {
    return Math.max(1, Number(n) || 1) + "ª";
  },

  tags() {
    const G = window.FILA_QUEUE_GROUPS || {};
    const vistos = {};
    return Object.keys(G).map((k) => {
      const id = Number(G[k]);
      if (vistos[id]) return null;
      vistos[id] = true;
      const meta = typeof window.getFilaQueueGroupMeta === "function" ? window.getFilaQueueGroupMeta(id) : null;
      return { id, label: (meta && meta.label) || k };
    }).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label, "pt"));
  },

  rotuloTag(id) {
    const n = Number(id);
    const achou = this.tags().find((t) => t.id === n);
    return achou ? achou.label : "Tag";
  },

  diasAtraso(client, tag) {
    const G = window.FILA_QUEUE_GROUPS || {};
    const n = Number(tag);
    if (n === G.ACORDO_JURIDICO || n === G.REENVIAR_JURIDICO || n === G.ACORDO_INTERNO_QUEBRADO) {
      const acordo = Number(client && client.agreementDaysDelay);
      if (acordo > 0) return acordo;
    }
    return Number(client && client.maxDaysDelay) || 0;
  },

  contextoCliente(client) {
    const nome = String((client && client.customerName) || "").trim();
    const primeiro = (nome.split(/\s+/)[0] || "");
    let cidade = "";
    let empreendimento = "";
    if (client && typeof window.resolveCityRuleId === "function") {
      const r = window.resolveCityRuleId(client.costCenterId) || {};
      cidade = this.titulo(r.city || "");
    }
    if (client && typeof window.findCachedCostCenter === "function") {
      const cc = window.findCachedCostCenter(client.costCenterId);
      empreendimento = String((cc && (cc.name || cc.enterpriseName)) || "").trim();
    }
    const qtd = Math.max(0, Number(client && client.billCount) || 0);
    const texto = qtd === 1 ? "01 parcela em aberto" : String(qtd).padStart(2, "0") + " parcelas em aberto";
    return {
      primeiro_nome: this.titulo(primeiro) || "—",
      nome: nome || "—",
      unidade: String((client && client.unitName) || "").trim() || "—",
      empreendimento: empreendimento || "—",
      cidade: cidade || "—",
      vencimento: this.dataDeMs(client && client.oldestDueDateMs) || "—",
      texto_abertas: texto,
      ordinal_proxima: this.ordinal(qtd + 1),
      vencimento_proxima: "—",
      titulo: String((client && client.saleId) || "").trim() || "—"
    };
  },

  /** Parcelas vencidas do título com o valor sem juros e o corrigido (base do Sienge carregada na fila). */
  parcelasDe(client) {
    const lista = typeof window.listInstallmentsForSiCheck === "function" ? window.listInstallmentsForSiCheck(client) : [];
    return (lista || []).map((i) => {
      const sem = Number(i.correctedValueWithoutAdditions != null ? i.correctedValueWithoutAdditions : (i.currentBalance || i.originalValue));
      const cor = Number(i.correctedValueWithAdditions != null ? i.correctedValueWithAdditions : sem);
      return {
        numero: String(i.installmentNumber || i.number || i.installmentId || ""),
        tipo: String(i.conditionType || ""),
        vencimento: String(i.dueDate || i.due || "").slice(0, 10),
        dias: Number(i.daysOfDelay) || 0,
        semJuros: Number.isFinite(sem) ? Math.round(sem * 100) / 100 : 0,
        corrigido: Number.isFinite(cor) ? Math.round(cor * 100) / 100 : 0
      };
    }).filter((x) => x.dias > 0 && x.semJuros > 0)
      .sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  },

  money(n) {
    return "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },

  /** Quadro igual ao que o servidor coloca no e-mail. */
  quadroHtml(parcelas) {
    const lista = (parcelas || []).slice(0, 60);
    if (!lista.length) return `<em style="color:#64748b;">(sem parcelas vencidas carregadas)</em>`;
    const td = "padding:6px 10px;border:1px solid #d1d5db;font-size:13px;";
    const th = td + "background:#105436;color:#ffffff;text-align:left;";
    let tSem = 0;
    let tCor = 0;
    const linhas = lista.map((p) => {
      tSem += Number(p.semJuros) || 0;
      tCor += Number(p.corrigido) || 0;
      return `<tr><td style="${td}">${this.esc(p.numero + (p.tipo ? " (" + p.tipo + ")" : ""))}</td><td style="${td}">${this.esc(this.dataBr(p.vencimento))}</td><td style="${td}text-align:right;">${this.esc(p.dias)}</td><td style="${td}text-align:right;">${this.esc(this.money(p.semJuros))}</td><td style="${td}text-align:right;">${this.esc(this.money(p.corrigido))}</td></tr>`;
    }).join("");
    return `<table style="border-collapse:collapse;margin:8px 0;"><thead><tr><th style="${th}">Parcela</th><th style="${th}">Vencimento</th><th style="${th}">Dias em atraso</th><th style="${th}">Valor sem juros</th><th style="${th}">Valor corrigido</th></tr></thead><tbody>${linhas}<tr><td colspan="3" style="${td}font-weight:bold;">Total</td><td style="${td}text-align:right;font-weight:bold;">${this.esc(this.money(tSem))}</td><td style="${td}text-align:right;font-weight:bold;">${this.esc(this.money(tCor))}</td></tr></tbody></table>`;
  },

  /** Texto do e-mail em HTML (o mesmo que o servidor monta): escapa o texto e coloca quadro e extrato. */
  htmlEmail(texto, ctx, parcelas) {
    let t = this.aplicar(String(texto || "").split("{{quadro_parcelas}}").join("\u0000Q\u0000").split("{{extrato}}").join("\u0000E\u0000"), ctx);
    t = this.esc(t).replace(/\r?\n/g, "<br>");
    return t.split("\u0000Q\u0000").join(this.quadroHtml(parcelas)).split("\u0000E\u0000").join(this.esc(this.TEXTO_EXTRATO));
  },

  temExtrato(t) {
    return /\{\{extrato\}\}/.test(String((t && t.corpo) || "") + String((t && t.assunto) || ""));
  },

  // Bom dia até 11h59, boa tarde até 17h59, boa noite depois, pela hora em que o e-mail é montado.
  saudacao(agora) {
    const h = (agora || new Date()).getHours();
    return h < 12 ? "Bom dia" : (h < 18 ? "Boa tarde" : "Boa noite");
  },

  aplicar(texto, ctx) {
    let s = String(texto || "");
    if (ctx === "assunto") ctx = null;
    s = s.split("{{saudacao}}").join(this.saudacao());
    s = s.replace(/\{\{retorno:(\d+)\}\}/g, (_, n) => this.dataMais(Number(n)));
    const dados = ctx || this.EXEMPLO;
    Object.keys(dados).forEach((k) => {
      s = s.split("{{" + k + "}}").join(dados[k] == null || dados[k] === "" ? "—" : String(dados[k]));
    });
    return s;
  },

  emailDe(client) {
    const id = client && client.customerId;
    const c = window.AppState && window.AppState.customers && window.AppState.customers[id];
    const email = String((c && c.email) || "").trim();
    if (!email || email === "N/D") return "";
    return email;
  },

  tagReenviar() {
    return Number((window.FILA_QUEUE_GROUPS || {}).REENVIAR_JURIDICO);
  },

  // Em 23/11/2026 a régua de reenvio também leva quem está com 41 dias.
  // Nos outros dias vale só o dia gravado no template (31).
  excecao41Hoje() {
    return this.hojeIso() === "2026-11-23";
  },

  clientesDoTemplate(t) {
    const lista = window.rawClientList || [];
    const tag = Number(t.tag);
    const alvo = Number(t.diasVencido);
    if (!Number.isFinite(tag) || !Number.isFinite(alvo)) return [];
    const reenviar = this.tagReenviar();
    const hoje41 = tag === reenviar && this.excecao41Hoje();
    return lista.filter((c) => {
      if (typeof window.getFilaQueueGroup !== "function") return false;
      if (Number(window.getFilaQueueGroup(c)) !== tag) return false;
      const dias = this.diasAtraso(c, tag);
      if (dias === alvo) return true;
      return hoje41 && dias === 41;
    });
  },

  normalizar(lista) {
    const tags = new Set(this.tags().map((t) => t.id));
    return (Array.isArray(lista) ? lista : []).map((t) => {
      const tinha = t && (t.status === "pendente" || t.status === "aprovado");
      const status = tinha ? t.status : (t && t.ativo === false ? "pendente" : "aprovado");
      const ativo = status === "aprovado" && (tinha ? !!(t && t.ativo) : t.ativo !== false);
      return {
        id: String((t && t.id) || ""),
        nome: String((t && t.nome) || "").trim(),
        assunto: String((t && t.assunto) || "").trim(),
        corpo: String((t && t.corpo) || ""),
        tag: tags.has(Number(t && t.tag)) ? Number(t.tag) : "",
        diasVencido: Math.max(0, Math.round(Number(t && t.diasVencido) || 0)),
        destino: t && t.destino === "fixo" ? "fixo" : "contrato",
        para: this.listaEmails(t && t.para).join(", "),
        cc: this.listaEmails(t && t.cc).join(", "),
        remetente: this.caixaValida(t && t.remetente),
        status: status,
        ativo: status === "pendente" ? false : ativo,
        criadoPorEmail: String((t && t.criadoPorEmail) || "").trim().toLowerCase(),
        criadoPorNome: String((t && t.criadoPorNome) || "").trim(),
        aprovadoEm: String((t && t.aprovadoEm) || ""),
        avisoCriador: !!(t && t.avisoCriador)
      };
    }).filter((t) => t.id && t.nome);
  },

  lerLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem("crm_central_email") || "null");
      return this.normalizar(raw && raw.templates);
    } catch (e) {
      return [];
    }
  },

  async lerRemoto() {
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.getDoc) return null;
    try {
      const snap = await fc.getDoc(fc.doc(window.firebaseDb, "config", "central_email"));
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : snap.exists);
      if (!existe) return null;
      return this.normalizar((snap.data() || {}).templates);
    } catch (e) {
      console.warn("[Central e-mail] leitura", e);
      return null;
    }
  },

  async carregar() {
    const local = this.lerLocal();
    const remoto = await this.lerRemoto();
    this.state.templates = remoto || local;
    this.state.pronto = true;
    try { localStorage.setItem("crm_central_email", JSON.stringify({ templates: this.state.templates })); } catch (e) {}
  },

  async gravar() {
    const dados = { templates: this.state.templates };
    try { localStorage.setItem("crm_central_email", JSON.stringify(dados)); } catch (e) {}
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.setDoc) return;
    try {
      await fc.setDoc(fc.doc(window.firebaseDb, "config", "central_email"), dados, { merge: true });
    } catch (e) {
      console.warn("[Central e-mail] gravação", e);
    }
  },

  async abrir() {
    if (!this.state.pronto) await this.carregar();
    this.render();
  },

  setAba(id) {
    this.state.aba = ["fila", "acompanhamento"].indexOf(id) >= 0 ? id : "templates";
    this.render();
    if (this.state.aba === "fila") this.lerEnviosDoDia().then(() => { if (this.state.aba === "fila") this.render(); });
    if (this.state.aba === "acompanhamento") this.abrirAcompanhamento();
  },

  abasHtml() {
    const atual = this.state.aba;
    const item = (id, icon, label) => `<button type="button" role="tab" aria-selected="${atual === id}" class="ml-tab ${atual === id ? "is-active" : ""}" onclick="CentralEmailApp.setAba('${id}')"><i data-lucide="${icon}"></i> ${label}</button>`;
    return `<div class="ml-tabs cem-tabs" role="tablist">${item("templates", "file-text", "Templates")}${item("fila", "send", "Fila do dia")}${item("acompanhamento", "list-checks", "Acompanhamento")}</div>`;
  },

  /* ---------- Acompanhamento dos e-mails enviados ----------
     Lê central_email_envios por período (campo "dia"), filtra por título/cliente/template/situação e mostra
     entrega, confirmação de leitura (Outlook) e abertura (imagem de rastreio). As confirmações chegam por e-mail
     na caixa de envio e são lidas por /api/central-email-confirmacoes (chamado ao abrir a aba, no máximo a cada
     10 minutos, e pelo botão Atualizar confirmações). */
  acomp() {
    if (!this.state.acomp) {
      const hoje = this.hojeIso();
      const d = new Date(hoje + "T12:00:00");
      d.setDate(d.getDate() - 6);
      this.state.acomp = { de: this.iso(d), ate: hoje, busca: "", template: "", situacao: "", lista: [], carregando: false, msg: "", atualizando: false };
    }
    return this.state.acomp;
  },

  async abrirAcompanhamento() {
    await this.carregarAcompanhamento();
    let ultima = 0;
    try { ultima = Number(sessionStorage.getItem("crm_cem_conf_em") || 0); } catch (e) {}
    if (Date.now() - ultima > 10 * 60 * 1000) this.atualizarConfirmacoes(true);
  },

  async carregarAcompanhamento() {
    const a = this.acomp();
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.getDocs || !fc.query || !fc.where) { a.msg = "O banco ainda não respondeu. Tente de novo em instantes."; this.render(); return; }
    a.carregando = true;
    this.render();
    try {
      const de = a.de <= a.ate ? a.de : a.ate;
      const ate = a.de <= a.ate ? a.ate : a.de;
      const snap = await fc.getDocs(fc.query(fc.collection(window.firebaseDb, "central_email_envios"), fc.where("dia", ">=", de), fc.where("dia", "<=", ate)));
      const lista = [];
      snap.forEach((d) => lista.push(Object.assign({ id: d.id }, d.data() || {})));
      lista.sort((x, y) => String(y.em || "").localeCompare(String(x.em || "")));
      a.lista = lista;
      a.msg = "";
    } catch (e) {
      console.warn("[Central e-mail] acompanhamento", e);
      a.msg = "Não foi possível carregar os envios.";
    } finally {
      a.carregando = false;
      if (this.state.aba === "acompanhamento") this.render();
    }
  },

  async atualizarConfirmacoes(silencioso) {
    const a = this.acomp();
    if (a.atualizando) return;
    a.atualizando = true;
    if (!silencioso) { a.msg = "Lendo as confirmações na caixa de envio…"; this.render(); }
    try {
      const auth = window.MouraAuth;
      const token = auth && typeof auth.getIntegraToken === "function" ? await auth.getIntegraToken() : "";
      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-Integra-Token"] = token;
      const res = await fetch("/api/central-email-confirmacoes", { method: "POST", headers, body: JSON.stringify({ dias: 30 }) });
      const body = await res.json().catch(() => ({}));
      try { sessionStorage.setItem("crm_cem_conf_em", String(Date.now())); } catch (e) {}
      if (!res.ok) {
        a.msg = "Não foi possível ler as confirmações: " + (body.error || ("HTTP " + res.status));
      } else if (body.erros && body.erros.length) {
        a.msg = "Algumas caixas não puderam ser lidas: " + body.erros.join(" | ")
          + (/403|Access/i.test(body.erros.join(" ")) ? " (falta a permissão Application Mail.Read no escopo \"Caixa IntegrA\")" : "");
      } else {
        const r = body.resumo || {};
        const novas = (r.leitura || 0) + (r.entregue || 0) + (r.retransmitido || 0) + (r.nao_entregue || 0) + (r.nao_lida || 0);
        a.msg = silencioso ? "" : (novas ? novas + " confirmação(ões) nova(s) registrada(s)." : "Nenhuma confirmação nova.");
      }
      await this.carregarAcompanhamento();
    } catch (e) {
      a.msg = "Não foi possível ler as confirmações agora.";
      this.render();
    } finally {
      a.atualizando = false;
    }
  },

  filtroAcomp(campo, valor) {
    const a = this.acomp();
    a[campo] = String(valor || "");
    if (campo === "de" || campo === "ate") { this.carregarAcompanhamento(); return; }
    this.render();
    if (campo === "busca") {
      const el = document.getElementById("cem-ac-busca");
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  },

  dataHora(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  },

  // Situação de cada etapa do envio, já com o texto e a cor da etiqueta.
  etapasEnvio(e) {
    const envio = e.status === "enviado"
      ? { cls: "ok", txt: "Enviado " + this.dataHora(e.em) }
      : { cls: "erro", txt: "Erro no envio", dica: e.erro || "" };
    let entrega = { cls: "", txt: e.status === "enviado" ? "Aguardando" : "—" };
    if (e.naoEntregueEm) entrega = { cls: "erro", txt: "Não entregue " + this.dataHora(e.naoEntregueEm), dica: e.naoEntregueMotivo || "" };
    else if (e.entregaEm) entrega = e.entregaTipo === "retransmitido"
      ? { cls: "ok", txt: "Recebido pelo servidor " + this.dataHora(e.entregaEm), dica: "O servidor do cliente recebeu, mas não informa a entrega na caixa." }
      : { cls: "ok", txt: "Entregue " + this.dataHora(e.entregaEm) };
    let leitura = { cls: "", txt: e.status === "enviado" ? "Sem confirmação" : "—" };
    if (e.leituraConfirmadaEm) leitura = { cls: "ok", txt: "Confirmada " + this.dataHora(e.leituraConfirmadaEm) };
    else if (e.naoLidaEm) leitura = { cls: "erro", txt: "Excluído sem ler " + this.dataHora(e.naoLidaEm) };
    let abertura = { cls: "", txt: e.status === "enviado" ? (e.rastreio ? "Não aberto" : "Sem rastreio") : "—" };
    if (e.primeiraAbertura) abertura = { cls: "ok", txt: "Aberto " + (Number(e.aberturas) > 1 ? e.aberturas + "× · " : "") + this.dataHora(e.primeiraAbertura) };
    return { envio, entrega, leitura, abertura };
  },

  listaAcompanhamento() {
    const a = this.acomp();
    const termo = this.norm(a.busca);
    const digitos = String(a.busca || "").replace(/\D/g, "");
    return (a.lista || []).filter((e) => {
      if (a.template && e.templateId !== a.template) return false;
      if (termo) {
        const nome = this.norm(e.clienteNome || "");
        const okTitulo = digitos && String(e.titulo || "").indexOf(digitos) >= 0;
        if (!okTitulo && nome.indexOf(termo) < 0) return false;
      }
      switch (a.situacao) {
        case "erro": return e.status !== "enviado";
        case "nao_entregue": return !!e.naoEntregueEm;
        case "lido": return !!e.leituraConfirmadaEm;
        case "aberto": return !!e.primeiraAbertura;
        case "sem_abertura": return e.status === "enviado" && !e.primeiraAbertura && !e.leituraConfirmadaEm;
        default: return true;
      }
    });
  },

  norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  },

  acompanhamentoHtml() {
    const a = this.acomp();
    const lista = this.listaAcompanhamento();
    const etq = (x) => `<span class="cem-env ${x.cls}"${x.dica ? ` title="${this.esc(x.dica)}"` : ""}>${this.esc(x.txt)}</span>`;
    const nomeTemplate = (e) => e.templateNome || ((this.achar(e.templateId) || {}).nome) || e.templateId || "—";
    const opcoesTemplate = this.state.templates.map((t) => `<option value="${this.esc(t.id)}"${a.template === t.id ? " selected" : ""}>${this.esc(t.nome)}</option>`).join("");
    const sit = [["", "Todas as situações"], ["lido", "Leitura confirmada"], ["aberto", "Abertos"], ["sem_abertura", "Sem abertura nem leitura"], ["nao_entregue", "Não entregues"], ["erro", "Erro no envio"]]
      .map(([v, r]) => `<option value="${v}"${a.situacao === v ? " selected" : ""}>${r}</option>`).join("");
    const linhas = lista.map((e) => {
      const s = this.etapasEnvio(e);
      return `<tr>
        <td class="is-center">${this.esc(this.dataHora(e.em) || e.dia || "")}</td>
        <td title="${this.esc(e.clienteNome || "")}"><strong>${this.esc(e.clienteNome || "Cliente " + (e.customerId || ""))}</strong><br><small class="cem-cc">Título ${this.esc(e.titulo || "—")}</small></td>
        <td title="${this.esc(nomeTemplate(e))}">${this.esc(nomeTemplate(e))}</td>
        <td class="cem-para">${this.esc(e.para || "—")}<br><small class="cem-cc">De: ${this.esc(e.caixa || (e.de === "padrao" ? "caixa padrão" : e.de) || "—")}</small></td>
        <td class="cem-etapas">${etq(s.envio)}</td>
        <td class="cem-etapas">${etq(s.entrega)}</td>
        <td class="cem-etapas">${etq(s.leitura)}</td>
        <td class="cem-etapas">${etq(s.abertura)}</td>
        <td class="is-right cem-acoes">
          <button type="button" class="tvig-ico" title="Ver o e-mail enviado" onclick="CentralEmailApp.verEnvio('${this.esc(e.id)}')"><i data-lucide="eye" style="width:15px;height:15px;"></i></button>
          <button type="button" class="tvig-ico" title="Baixar PDF com o e-mail e as confirmações" onclick="CentralEmailApp.pdfEnvio('${this.esc(e.id)}')"><i data-lucide="file-down" style="width:15px;height:15px;"></i></button>
        </td>
      </tr>`;
    }).join("");
    const total = (a.lista || []).length;
    return `<div class="cem-ac-filtros">
        <label>De<input type="date" class="cem-campo" value="${this.esc(a.de)}" onchange="CentralEmailApp.filtroAcomp('de', this.value)"></label>
        <label>Até<input type="date" class="cem-campo" value="${this.esc(a.ate)}" onchange="CentralEmailApp.filtroAcomp('ate', this.value)"></label>
        <label class="cem-ac-busca">Título ou cliente<input type="search" id="cem-ac-busca" class="cem-campo" placeholder="Ex.: 13928 ou Glenda" value="${this.esc(a.busca)}" oninput="CentralEmailApp.filtroAcomp('busca', this.value)"></label>
        <label>Template<select class="cem-campo" onchange="CentralEmailApp.filtroAcomp('template', this.value)"><option value="">Todos</option>${opcoesTemplate}</select></label>
        <label>Situação<select class="cem-campo" onchange="CentralEmailApp.filtroAcomp('situacao', this.value)">${sit}</select></label>
        <button type="button" class="btn btn-primary cc-atualizar" onclick="CentralEmailApp.atualizarConfirmacoes(false)"${a.atualizando ? " disabled" : ""}><i data-lucide="refresh-cw"></i> ${a.atualizando ? "Lendo…" : "Atualizar confirmações"}</button>
      </div>
      <p class="cem-ac-info">${a.carregando ? "Carregando…" : `${lista.length} de ${total} envio(s) no período.`} Entrega e leitura chegam por e-mail na caixa de envio e dependem do servidor e do leitor do cliente; a abertura vem da imagem de rastreio e não aparece se o cliente bloquear imagens.${a.msg ? ` <strong>${this.esc(a.msg)}</strong>` : ""}</p>
      <div class="cc-scroll"><table class="cc-table is-confortavel cem-tabela">
        <colgroup><col style="width:112px"><col style="width:17%"><col style="width:13%"><col><col style="width:118px"><col style="width:128px"><col style="width:128px"><col style="width:128px"><col style="width:76px"></colgroup>
        <thead><tr><th class="is-center">Envio</th><th>Cliente</th><th>Template</th><th>Para</th><th>Situação</th><th>Entrega</th><th>Leitura (Outlook)</th><th>Abertura</th><th class="is-right">Ações</th></tr></thead>
        <tbody>${linhas || `<tr><td colspan="9" style="text-align:center;padding:30px;white-space:normal;">${a.carregando ? "Carregando…" : "Nenhum e-mail encontrado com esses filtros."}</td></tr>`}</tbody>
      </table></div>`;
  },

  acharEnvio(id) {
    return ((this.acomp().lista) || []).find((e) => e.id === id) || null;
  },

  resumoEnvioHtml(e) {
    const s = this.etapasEnvio(e);
    const linha = (r, v) => `<tr><td style="padding:5px 8px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:700;width:34%;">${r}</td><td style="padding:5px 8px;border:1px solid #e2e8f0;">${v}</td></tr>`;
    return `<table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:12px;">
      ${linha("Cliente", this.esc(e.clienteNome || "Cliente " + (e.customerId || "")))}
      ${linha("Título", this.esc(e.titulo || "—"))}
      ${linha("Template", this.esc(e.templateNome || ((this.achar(e.templateId) || {}).nome) || e.templateId || "—"))}
      ${linha("De", this.esc(e.caixa || e.de || "—"))}
      ${linha("Para", this.esc(e.para || "—"))}
      ${e.cc ? linha("Cópia", this.esc(e.cc)) : ""}
      ${linha("Envio", this.esc(s.envio.txt) + (s.envio.dica ? " · " + this.esc(s.envio.dica) : ""))}
      ${linha("Entrega", this.esc(s.entrega.txt) + (s.entrega.dica ? " · " + this.esc(s.entrega.dica) : ""))}
      ${linha("Confirmação de leitura", this.esc(s.leitura.txt))}
      ${linha("Abertura (rastreio)", this.esc(s.abertura.txt) + (e.ultimaAbertura && Number(e.aberturas) > 1 ? " · última " + this.esc(this.dataHora(e.ultimaAbertura)) : ""))}
      ${linha("Extrato anexado", e.extrato ? "Sim" : "Não")}
    </table>`;
  },

  verEnvio(id) {
    const e = this.acharEnvio(id);
    if (!e) return;
    this.fecharModal();
    const pop = document.createElement("div");
    pop.id = "cem-modal";
    pop.className = "cem-modal";
    pop.innerHTML = `<div class="cem-card" role="dialog" aria-labelledby="cem-titulo">
      <div class="cem-head"><h3 id="cem-titulo">E-mail enviado</h3>
        <div style="display:flex;gap:8px;"><button type="button" class="btn btn-excel" onclick="CentralEmailApp.pdfEnvio('${this.esc(e.id)}')"><i data-lucide="file-down"></i> PDF</button>
        <button type="button" class="btn btn-fechar" onclick="CentralEmailApp.fecharModal()">Fechar</button></div></div>
      <div class="cem-body">${this.resumoEnvioHtml(e)}
        <div class="cem-previa"><p style="margin:0 0 8px;"><strong>Assunto:</strong> ${this.esc(e.assunto || "—")}</p>
        <div id="cem-envio-corpo"></div></div>
      </div></div>`;
    document.body.appendChild(pop);
    const corpo = pop.querySelector("#cem-envio-corpo");
    if (corpo) {
      if (e.html) corpo.innerHTML = this.htmlSeguro(e.html);
      else corpo.textContent = "O texto deste e-mail não foi guardado (envios anteriores a 25/11/2026).";
    }
    if (window.lucide) window.lucide.createIcons({ root: pop });
  },

  // O HTML guardado é o montado pelo servidor (texto escapado + quadro de parcelas). Por segurança, tira script,
  // eventos e links javascript antes de mostrar.
  htmlSeguro(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");
    tpl.content.querySelectorAll("script,iframe,object,embed,link,meta,style").forEach((n) => n.remove());
    tpl.content.querySelectorAll("*").forEach((n) => {
      Array.from(n.attributes).forEach((at) => {
        if (/^on/i.test(at.name) || /^\s*javascript:/i.test(at.value)) n.removeAttribute(at.name);
      });
    });
    const div = document.createElement("div");
    div.appendChild(tpl.content.cloneNode(true));
    return div.innerHTML;
  },

  async pdfEnvio(id) {
    const e = this.acharEnvio(id);
    if (!e) return;
    if (!window.jspdf || typeof window.html2canvas !== "function") { this.aviso("O gerador de PDF ainda não carregou. Tente de novo em instantes."); return; }
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#1f2937;";
    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #105436;padding-bottom:10px;margin-bottom:14px;">
        <div><div style="font-size:18px;font-weight:800;color:#105436;">Comprovante de envio de e-mail</div>
        <div style="font-size:11px;color:#64748b;">Central de e-mail do IntegrA · gerado em ${this.esc(this.dataHora(new Date().toISOString()))}</div></div>
        <div style="font-size:12px;font-weight:800;color:#105436;">Moura Leite</div></div>
      ${this.resumoEnvioHtml(e)}
      <div style="font-size:12px;margin:6px 0 8px;"><strong>Assunto:</strong> ${this.esc(e.assunto || "—")}</div>
      <div id="cem-pdf-corpo" style="border:1px solid #e2e8f0;border-radius:6px;padding:14px;"></div>
      <p style="font-size:10px;color:#64748b;margin-top:12px;">Entrega e leitura: confirmações enviadas pelo servidor e pelo leitor de e-mail do destinatário, quando ele as gera. Abertura: registrada quando o leitor do destinatário carregou a imagem de rastreio do e-mail.</p>`;
    const corpo = box.querySelector("#cem-pdf-corpo");
    if (e.html) corpo.innerHTML = this.htmlSeguro(e.html);
    else corpo.textContent = "O texto deste e-mail não foi guardado (envios anteriores a 25/11/2026).";
    document.body.appendChild(box);
    try {
      const canvas = await window.html2canvas(box, { scale: 2, useCORS: true, backgroundColor: "#ffffff", logging: false, imageTimeout: 4000 });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p", "mm", "a4");
      const larg = pdf.internal.pageSize.getWidth();
      const alt = pdf.internal.pageSize.getHeight();
      const pxPorPagina = Math.floor(canvas.width * (alt / larg));
      for (let y = 0, pagina = 0; y < canvas.height; y += pxPorPagina, pagina++) {
        const fatia = document.createElement("canvas");
        fatia.width = canvas.width;
        fatia.height = Math.min(pxPorPagina, canvas.height - y);
        fatia.getContext("2d").drawImage(canvas, 0, y, canvas.width, fatia.height, 0, 0, canvas.width, fatia.height);
        if (pagina) pdf.addPage("a4", "p");
        pdf.addImage(fatia.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, larg, fatia.height * (larg / canvas.width));
      }
      pdf.save("E-mail " + String(e.titulo || "") + " " + String(e.dia || "") + ".pdf");
    } catch (err) {
      console.error("[Central e-mail] PDF", err);
      this.aviso("Não foi possível gerar o PDF.");
    } finally {
      box.remove();
    }
  },

  situacao(t) {
    if (!t || t.status !== "aprovado") return "Pendente";
    return t.ativo ? "Ligada" : "Desligada";
  },

  tabelaHtml() {
    const pode = this.podeEditar();
    const admin = this.souAdmin();
    // Régua: interruptor (verde Ligada / cinza Desligada) para o administrador; os demais veem a etiqueta.
    const regua = (t) => {
      if (t.status !== "aprovado") {
        return admin
          ? `<button type="button" class="cem-aprovar" onclick="CentralEmailApp.abrirAprovacao('${this.esc(t.id)}')"><i data-lucide="check" style="width:14px;height:14px;"></i> Aprovar</button>`
          : `<span class="cem-sit is-pendente">Aguardando aprovação</span>`;
      }
      if (!admin) return `<span class="cem-sit ${t.ativo ? "is-on" : "is-off"}">${t.ativo ? "Ligada" : "Desligada"}</span>`;
      return `<button type="button" role="switch" aria-checked="${t.ativo ? "true" : "false"}" class="cem-switch${t.ativo ? " is-on" : ""}"
        title="${t.ativo ? "Clique para desligar a régua" : "Clique para ligar a régua"}" onclick="CentralEmailApp.alternarAtivo('${this.esc(t.id)}')">
        <span class="cem-switch-trilho"><span class="cem-switch-bola"></span></span><span class="cem-switch-txt">${t.ativo ? "Ligada" : "Desligada"}</span></button>`;
    };
    const linhas = this.state.templates.map((t) => `<tr class="${t.status === "aprovado" && !t.ativo ? "cem-desligada" : ""}">
      <td title="${this.esc(t.nome)}"><strong>${this.esc(t.nome)}</strong>${t.criadoPorNome ? `<br><small class="cem-cc">Criado por ${this.esc(t.criadoPorNome)}</small>` : ""}</td>
      <td title="${this.esc(this.rotuloTag(t.tag))}" class="cem-quebra">${this.esc(this.rotuloTag(t.tag))}</td>
      <td class="is-center"><span class="cem-dias">${this.esc(t.diasVencido)}</span></td>
      <td class="cem-para">${this.esc(t.destino === "fixo" ? (t.para || "—") : "E-mails do contrato")}${t.cc ? `<br><small class="cem-cc">Cópia: ${this.esc(t.cc)}</small>` : ""}<br><small class="cem-cc">De: ${this.esc(this.rotuloCaixa(t.remetente))}</small></td>
      <td class="is-center cem-regua">${regua(t)}</td>
      <td class="is-right cem-acoes">
        <button type="button" class="tvig-ico" title="Ver" onclick="CentralEmailApp.verTemplate('${this.esc(t.id)}')"><i data-lucide="eye" style="width:15px;height:15px;"></i></button>
        ${pode ? `<button type="button" class="tvig-ico" title="Editar" onclick="CentralEmailApp.editar('${this.esc(t.id)}')"><i data-lucide="pencil" style="width:15px;height:15px;"></i></button>
        <button type="button" class="tvig-ico is-danger" title="Excluir" onclick="CentralEmailApp.excluir('${this.esc(t.id)}')"><i data-lucide="trash-2" style="width:15px;height:15px;"></i></button>` : ""}
      </td>
    </tr>`).join("");
    return `<div class="cc-scroll"><table class="cc-table is-confortavel cem-tabela">
      <colgroup><col style="width:22%"><col style="width:22%"><col style="width:82px"><col><col style="width:150px"><col style="width:110px"></colgroup>
      <thead><tr><th>Template</th><th>Tag</th><th class="is-center">Dias vencido</th><th>Para</th><th class="is-center">Régua</th><th class="is-right">Ações</th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="6" style="text-align:center;padding:30px;">Nenhum template. Crie o texto, escolha a tag e quantos dias depois do vencimento.</td></tr>`}</tbody>
    </table></div>`;
  },

  filaHtml() {
    const ativos = this.state.templates.filter((t) => t.ativo);
    if (!ativos.length) return `<p class="cem-vazio">Nenhuma régua ligada. O administrador liga a régua ao aprovar o template.</p>`;
    if (!(window.rawClientList || []).length) {
      return `<p class="cem-vazio">A fila de cobrança ainda não foi carregada nesta sessão. Abra a Fila de Cobrança para a central localizar quem completa os dias de atraso hoje.</p>`;
    }
    return ativos.map((t) => {
      const gente = this.clientesDoTemplate(t);
      const linhas = gente.map((c, i) => `<tr>
        <td title="${this.esc(c.customerName || "")}">${this.esc(c.customerName || "—")}</td>
        <td>${this.esc(c.unitName || "—")}</td>
        <td class="cem-para">${this.esc(this.destinatarios(t, c).para.join(", ") || (t.destino === "fixo" ? "—" : "E-mail do cliente no Sienge"))}</td>
        <td>${(() => { const e = this.envioDe(t, c); if (!e) return `<span class="cem-env">Aguardando</span>`; if (e.status === "enviado") return `<span class="cem-env ok" title="${this.esc(e.para || "")}">Enviado ${this.esc(String(e.em || "").slice(11, 16))}</span>`; return `<span class="cem-env erro" title="${this.esc(e.erro || "")}">Erro</span>`; })()}</td>
        <td class="is-right cem-acoes"><button type="button" class="tvig-ico" title="Ver e-mail" onclick="CentralEmailApp.verCliente('${this.esc(t.id)}', ${i})"><i data-lucide="eye" style="width:15px;height:15px;"></i></button></td>
      </tr>`).join("");
      return `<section class="cem-bloco">
        <h4>${this.esc(t.nome)}</h4>
        <p>${this.esc(this.rotuloTag(t.tag))} · ${this.esc(t.diasVencido)} dia(s) depois de vencido · ${gente.length} cliente(s) hoje${t.cc ? " · Cópia: " + this.esc(t.cc) : ""}</p>
        <div class="cc-scroll"><table class="cc-table is-confortavel cem-tabela">
          <colgroup><col style="width:28%"><col style="width:110px"><col><col style="width:120px"><col style="width:70px"></colgroup>
          <thead><tr><th>Cliente</th><th>Unidade</th><th>E-mail</th><th>Envio de hoje</th><th class="is-right">Ações</th></tr></thead>
          <tbody>${linhas || `<tr><td colspan="5" style="text-align:center;padding:30px;">Ninguém completa esse atraso hoje.</td></tr>`}</tbody>
        </table></div>
      </section>`;
    }).join("");
  },

  render() {
    const root = document.getElementById("central-email-root");
    if (!root) return;
    const pode = this.podeEditar();
    const corpo = this.state.aba === "fila"
      ? this.filaHtml()
      : (this.state.aba === "acompanhamento"
        ? this.acompanhamentoHtml()
        : `<div class="cem-topo">${pode ? `<button type="button" class="btn btn-primary" onclick="CentralEmailApp.editar('')"><i data-lucide="plus"></i> Novo template</button>` : ""}</div>${this.tabelaHtml()}`);
    root.innerHTML = `
      <p class="cem-intro">O operador escreve o e-mail com variáveis. Ao salvar, a régua fica desligada até o administrador aprovar. A tag define o grupo da fila, e os dias dizem quando o título vencido entra na fila do dia.</p>
      ${this.abasHtml()}
      <div class="cem-painel">${corpo}</div>`;
    if (window.lucide) window.lucide.createIcons({ root: root });
  },

  achar(id) {
    return this.state.templates.find((t) => t.id === id) || null;
  },

  editar(id) {
    if (!this.podeEditar()) return;
    const atual = id ? this.achar(id) : null;
    const podeLigar = !!(atual && atual.status === "aprovado" && this.souAdmin());
    const destino = atual && atual.destino === "fixo" ? "fixo" : "contrato";
    this.fecharModal();
    const tags = this.tags().map((t) => `<option value="${t.id}"${atual && Number(atual.tag) === t.id ? " selected" : ""}>${this.esc(t.label)}</option>`).join("");
    const grupos = [];
    this.VARIAVEIS.forEach((v) => {
      let g = grupos.find((x) => x.nome === v.grupo);
      if (!g) {
        g = { nome: v.grupo, itens: [] };
        grupos.push(g);
      }
      g.itens.push(v);
    });
    const botoes = grupos.map((g) => `<section class="cem-var-grupo"><h4>${this.esc(g.nome)}</h4>${g.itens.map((v) => `<button type="button" class="cem-var" onclick="CentralEmailApp.inserir('${v.token}')">${this.esc(v.label)}</button>`).join("")}</section>`).join("");
    const pop = document.createElement("div");
    pop.id = "cem-modal";
    pop.className = "cem-modal";
    pop.innerHTML = `<div class="cem-card" role="dialog" aria-modal="true" aria-labelledby="cem-titulo">
      <div class="cem-head">
        <h3 id="cem-titulo">${atual ? "Editar template" : "Novo template"}</h3>
        <button type="button" class="btn btn-fechar" onclick="CentralEmailApp.fecharModal()">Fechar</button>
      </div>
      <div class="cem-body">
        <div class="cem-editor">
          <div class="cem-escrever">
            <div class="cem-grade">
              <label>Nome<input id="cem-nome" class="cem-campo" value="${this.esc(atual ? atual.nome : "")}"></label>
              <label>Tag<select id="cem-tag" class="cem-campo">${tags}</select></label>
              <label class="cem-span">Título do e-mail<input id="cem-assunto" class="cem-campo" value="${this.esc(atual ? atual.assunto : "")}"></label>
              <label>Dias depois de vencido<input id="cem-dias" class="cem-campo" type="number" min="0" step="1" value="${atual ? atual.diasVencido : 5}"></label>
              <div class="cem-ativo">
                <span class="cem-rotulo">Régua</span>
                <label class="moura-switch"${podeLigar ? "" : ` title="${atual && atual.status === "aprovado" ? "Só o administrador liga ou desliga a régua." : "A régua só pode ser ligada depois que o administrador aprovar o template."}"`}>
                  <input type="checkbox" id="cem-ativo"${atual && atual.ativo ? " checked" : ""}${podeLigar ? "" : " disabled"}>
                  <span class="moura-switch-track" aria-hidden="true"></span>
                  <span class="moura-switch-text">${atual && atual.ativo ? "Ativada" : "Desativada"}</span>
                </label>
              </div>
            </div>
            <div class="cem-dest">
              <span class="cem-rotulo">Enviar para</span>
              <div class="cem-dest-opcoes" role="radiogroup">
                <label class="cem-radio"><input type="radio" name="cem-destino" value="contrato"${destino === "contrato" ? " checked" : ""} onchange="CentralEmailApp.trocarDestino()"> E-mails do contrato</label>
                <label class="cem-radio"><input type="radio" name="cem-destino" value="fixo"${destino === "fixo" ? " checked" : ""} onchange="CentralEmailApp.trocarDestino()"> E-mail selecionado</label>
              </div>
              <label class="cem-dest-campo" id="cem-para-wrap"${destino === "fixo" ? "" : " hidden"}>E-mail de destino<input id="cem-para" class="cem-campo" placeholder="nome@empresa.com.br" value="${this.esc(atual ? atual.para : "")}"></label>
              <label class="cem-dest-campo">Cópia (CC)<input id="cem-cc" class="cem-campo" placeholder="Separe os e-mails por vírgula" value="${this.esc(atual ? atual.cc : "")}"></label>
              <label class="cem-dest-campo">Enviar de<select id="cem-de" class="cem-campo">${this.CAIXAS_ENVIO.map((c) => `<option value="${this.esc(c.valor)}"${this.caixaValida(atual && atual.remetente) === c.valor ? " selected" : ""}>${this.esc(c.rotulo)}</option>`).join("")}</select></label>
            </div>
            <p class="cem-legenda">${atual && atual.status === "aprovado" ? "Se alterar o título, o texto, a tag ou os dias, o template volta para o administrador e a régua desliga." : "Ao salvar, a régua fica desligada até o administrador aprovar."}</p>
            <label class="cem-bloco-campo">Texto<textarea id="cem-corpo" class="cem-campo">${this.esc(atual ? atual.corpo : "")}</textarea></label>
            <p class="cem-legenda">Prévia com um cliente de exemplo. Na fila do dia, nome, unidade, empreendimento, cidade e vencimento saem do contrato.</p>
            <div id="cem-previa" class="cem-previa"></div>
          </div>
          <aside class="cem-vars-lado">
            <h4>Variáveis</h4>
            ${botoes}
            <section class="cem-var-grupo">
              <h4>Data de retorno</h4>
              <label class="cem-retorno">Dias depois do envio
                <input id="cem-retorno" type="number" min="0" step="1" value="5">
              </label>
              <button type="button" class="cem-var" onclick="CentralEmailApp.inserirRetorno()">Inserir data de retorno</button>
            </section>
          </aside>
        </div>
      </div>
      <div class="cem-foot"><button type="button" class="btn btn-primary" onclick="CentralEmailApp.salvar('${this.esc(atual ? atual.id : "")}')">Salvar</button></div>
    </div>`;
    document.body.appendChild(pop);
    const chave = document.getElementById("cem-ativo");
    if (chave) chave.addEventListener("change", () => {
      const txt = chave.parentElement && chave.parentElement.querySelector(".moura-switch-text");
      if (txt) txt.textContent = chave.checked ? "Ativada" : "Desativada";
    });
    const corpo = document.getElementById("cem-corpo");
    if (corpo) corpo.addEventListener("input", () => this.atualizarPreview());
    ["cem-assunto", "cem-retorno"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => this.atualizarPreview());
    });
    this.atualizarPreview();
  },

  trocarDestino() {
    const marcado = document.querySelector('input[name="cem-destino"]:checked');
    const wrap = document.getElementById("cem-para-wrap");
    if (wrap) wrap.hidden = !(marcado && marcado.value === "fixo");
  },

  async alternarAtivo(id) {
    if (!this.souAdmin()) return;
    const t = this.achar(id);
    if (!t || t.status !== "aprovado") return;
    t.ativo = !t.ativo;
    if (t.ativo) t.avisoCriador = false;
    await this.gravar();
    this.render();
  },

  fecharModal() {
    const pop = document.getElementById("cem-modal");
    if (pop) pop.remove();
  },

  inserir(token) {
    const el = document.getElementById("cem-corpo");
    if (!el) return;
    const i = el.selectionStart || 0;
    const f = el.selectionEnd || 0;
    el.value = el.value.slice(0, i) + token + el.value.slice(f);
    const p = i + token.length;
    el.focus();
    el.setSelectionRange(p, p);
    this.atualizarPreview();
  },

  inserirRetorno() {
    const n = document.getElementById("cem-retorno");
    const dias = Math.max(0, Math.round(Number(n && n.value) || 0));
    this.inserir("{{retorno:" + dias + "}}");
  },

  atualizarPreview() {
    const previa = document.getElementById("cem-previa");
    const corpo = document.getElementById("cem-corpo");
    const assunto = document.getElementById("cem-assunto");
    if (!previa) return;
    const titulo = this.aplicar(String((assunto && assunto.value) || "").split("{{quadro_parcelas}}").join("").split("{{extrato}}").join(""), this.EXEMPLO);
    const anexo = /\{\{extrato\}\}/.test(String((corpo && corpo.value) || "") + String((assunto && assunto.value) || ""));
    previa.innerHTML = (titulo ? `<strong>Título:</strong> ${this.esc(titulo)}<br><br>` : "")
      + this.htmlEmail(corpo && corpo.value, this.EXEMPLO, this.PARCELAS_EXEMPLO)
      + (anexo ? `<br><br><span style="color:#105436;font-weight:700;">📎 Extrato ${this.esc(this.EXEMPLO.titulo)}.pdf (anexado no envio)</span>` : "");
  },

  async salvar(id) {
    if (!this.podeEditar()) return;
    const nome = String((document.getElementById("cem-nome") || {}).value || "").trim();
    const assunto = String((document.getElementById("cem-assunto") || {}).value || "").trim();
    const corpo = String((document.getElementById("cem-corpo") || {}).value || "");
    const tag = Number((document.getElementById("cem-tag") || {}).value);
    const dias = Math.round(Number((document.getElementById("cem-dias") || {}).value));
    if (!nome || !assunto || !corpo.trim() || !Number.isFinite(tag) || !Number.isFinite(dias) || dias < 0) {
      this.aviso("Informe o nome, o título do e-mail, o texto, a tag e os dias depois de vencido.");
      return;
    }
    const marcado = document.querySelector('input[name="cem-destino"]:checked');
    const destino = marcado && marcado.value === "fixo" ? "fixo" : "contrato";
    const paraTxt = String((document.getElementById("cem-para") || {}).value || "");
    const ccTxt = String((document.getElementById("cem-cc") || {}).value || "");
    const ruins = this.emailsInvalidos((destino === "fixo" ? paraTxt + "," : "") + ccTxt);
    if (ruins.length) {
      this.aviso("E-mail inválido: " + ruins.join(", ") + ".");
      return;
    }
    if (destino === "fixo" && !this.listaEmails(paraTxt).length) {
      this.aviso("Informe o e-mail de destino ou escolha E-mails do contrato.");
      return;
    }
    const anterior = id ? this.achar(id) : null;
    const quem = this.eu();
    const item = {
      id: id || ("cem_" + Date.now().toString(36)),
      nome, assunto, corpo, tag, diasVencido: dias,
      destino,
      para: destino === "fixo" ? this.listaEmails(paraTxt).join(", ") : "",
      cc: this.listaEmails(ccTxt).join(", "),
      remetente: this.caixaValida((document.getElementById("cem-de") || {}).value),
      criadoPorEmail: (anterior && anterior.criadoPorEmail) || quem.email,
      criadoPorNome: (anterior && anterior.criadoPorNome) || quem.nome,
      status: "pendente",
      ativo: false,
      aprovadoEm: "",
      avisoCriador: false
    };
    if (anterior && this.assinatura(anterior) === this.assinatura(item)) {
      item.status = anterior.status || "pendente";
      item.ativo = item.status === "aprovado" && !!anterior.ativo;
      item.aprovadoEm = anterior.aprovadoEm || "";
      item.avisoCriador = !!anterior.avisoCriador;
      // Interruptor do modal: só o administrador liga ou desliga, e só template aprovado.
      const chave = document.getElementById("cem-ativo");
      if (chave && !chave.disabled && this.souAdmin() && item.status === "aprovado") {
        item.ativo = !!chave.checked;
        if (item.ativo) item.avisoCriador = false;
      }
    }
    const resto = this.state.templates.filter((t) => t.id !== item.id);
    this.state.templates = resto.concat([item]);
    await this.gravar();
    this.fecharModal();
    this.render();
  },

  aviso(texto) {
    let el = document.getElementById("cem-aviso");
    if (!el) {
      el = document.createElement("p");
      el.id = "cem-aviso";
      el.className = "cem-aviso";
      const body = document.querySelector("#cem-modal .cem-body");
      if (body) body.prepend(el);
    }
    el.textContent = texto;
  },

  async excluir(id) {
    if (!this.podeEditar()) return;
    const t = this.achar(id);
    if (!t) return;
    const pergunta = "Excluir o template " + t.nome + "?";
    const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(pergunta) : confirm(pergunta);
    if (!ok) return;
    this.state.templates = this.state.templates.filter((item) => item.id !== id);
    await this.gravar();
    this.render();
  },

  abrirLeitura(titulo, texto) {
    this.fecharModal();
    const pop = document.createElement("div");
    pop.id = "cem-modal";
    pop.className = "cem-modal";
    pop.innerHTML = `<div class="cem-card" role="dialog" aria-modal="true" aria-labelledby="cem-titulo">
      <div class="cem-head">
        <h3 id="cem-titulo">${this.esc(titulo)}</h3>
        <button type="button" class="btn btn-fechar" onclick="CentralEmailApp.fecharModal()">Fechar</button>
      </div>
      <div class="cem-body"><div id="cem-leitura" class="cem-previa"></div></div>
      <div class="cem-foot"><button type="button" class="btn btn-primary" onclick="CentralEmailApp.copiar()">Copiar</button></div>
    </div>`;
    document.body.appendChild(pop);
    const caixa = document.getElementById("cem-leitura");
    if (caixa) caixa.innerHTML = texto;
  },

  verTemplate(id) {
    const t = this.achar(id);
    if (!t) return;
    const assunto = this.aplicar(String(t.assunto || "").split("{{quadro_parcelas}}").join("").split("{{extrato}}").join(""), this.EXEMPLO);
    this.abrirLeitura(t.nome, (assunto ? `<strong>${this.esc(assunto)}</strong><br><br>` : "") + this.htmlEmail(t.corpo, this.EXEMPLO, this.PARCELAS_EXEMPLO)
      + (this.temExtrato(t) ? `<br><br><span style="color:#105436;font-weight:700;">📎 Extrato em PDF anexado no envio</span>` : ""));
  },

  verCliente(id, indice) {
    const t = this.achar(id);
    if (!t) return;
    const c = this.clientesDoTemplate(t)[indice];
    if (!c) return;
    const ctx = this.contextoCliente(c);
    const assunto = this.aplicar(String(t.assunto || "").split("{{quadro_parcelas}}").join("").split("{{extrato}}").join(""), ctx);
    const dest = this.destinatarios(t, c);
    const cab = "De: " + this.esc(this.rotuloCaixa(t.remetente)) + "<br>"
      + (dest.para.length ? "Para: " + this.esc(dest.para.join(", ")) + "<br>" : (t.destino === "fixo" ? "" : "Para: e-mail do cliente no Sienge<br>"))
      + (dest.cc.length ? "Cópia: " + this.esc(dest.cc.join(", ")) + "<br>" : "");
    this.abrirLeitura(c.customerName || t.nome, `<span style="color:#64748b;">${cab}</span><br>` + (assunto ? `<strong>${this.esc(assunto)}</strong><br><br>` : "")
      + this.htmlEmail(t.corpo, ctx, this.parcelasDe(c))
      + (this.temExtrato(t) ? `<br><br><span style="color:#105436;font-weight:700;">📎 Extrato ${this.esc(ctx.titulo)}.pdf</span>` : ""));
  },

  async copiar() {
    const caixa = document.getElementById("cem-leitura");
    if (!caixa) return;
    const html = caixa.innerHTML;
    const texto = caixa.innerText;
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([texto], { type: "text/plain" }) })]);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(texto);
      }
    } catch (e) {}
  },

  /* ---------- Envio automático das réguas ligadas ----------
     Quando a fila do dia está carregada, manda ao servidor os clientes de cada régua aprovada e ligada.
     O servidor monta o e-mail pelo template aprovado, anexa o extrato e envia; um envio por régua, cliente e título por dia.
     Só roda na produção: os ambientes de teste usam dados reais e não podem mandar e-mail para cliente. */
  hojeIso() {
    return this.iso(new Date());
  },

  naProducao() {
    return String(location.hostname || "").toLowerCase() === "crm-gestao.vercel.app";
  },

  async lerEnviosDoDia() {
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.getDocs || !fc.query || !fc.where) return {};
    const mapa = {};
    try {
      const snap = await fc.getDocs(fc.query(fc.collection(window.firebaseDb, "central_email_envios"), fc.where("dia", "==", this.hojeIso())));
      snap.forEach((d) => {
        const v = d.data() || {};
        mapa[v.templateId + "|" + v.customerId + "|" + v.titulo] = v;
      });
    } catch (e) {
      console.warn("[Central e-mail] envios do dia", e);
    }
    this.state.envios = mapa;
    return mapa;
  },

  envioDe(t, c) {
    const m = this.state.envios || {};
    return m[t.id + "|" + String(c.customerId || "") + "|" + String(c.saleId || "")] || null;
  },

  async dispararDoDia() {
    if (this._disparando || !this.naProducao()) return;
    if (!(window.rawClientList || []).length) return;
    const chave = "crm_cem_disparo_" + this.hojeIso();
    const chave41 = "crm_cem_41_" + this.hojeIso();
    const forcar41 = this.excecao41Hoje();
    try {
      if (!forcar41 && Number(localStorage.getItem(chave) || 0) > Date.now() - 30 * 60 * 1000) return;
      if (forcar41 && localStorage.getItem(chave41) === "1") return;
    } catch (e) {}
    this._disparando = true;
    try {
      if (!this.state.pronto) await this.carregar();
      await this.sincronizarTags();
      const ligados = this.state.templates.filter((t) => t.status === "aprovado" && t.ativo);
      if (!ligados.length) return;
      const feitos = await this.lerEnviosDoDia();
      const itens = [];
      ligados.forEach((t) => {
        this.clientesDoTemplate(t).forEach((c) => {
          if (!c || !c.customerId || !c.saleId) return;
          const v = feitos[t.id + "|" + String(c.customerId) + "|" + String(c.saleId)];
          if (v && v.status === "enviado") return;
          const ctx = this.contextoCliente(c);
          delete ctx.titulo;
          itens.push({ templateId: t.id, customerId: String(c.customerId), titulo: String(c.saleId), ctx, parcelas: this.parcelasDe(c) });
        });
      });
      try { localStorage.setItem(chave, String(Date.now())); } catch (e) {}
      let mudouTag = false;
      let enviou41 = false;
      const auth = window.MouraAuth;
      const token = auth && typeof auth.getIntegraToken === "function" ? await auth.getIntegraToken() : "";
      const headers = { "Content-Type": "application/json" };
      if (token) headers["X-Integra-Token"] = token;
      for (let i = 0; i < itens.length; i += 8) {
        try {
          const res = await fetch("/api/central-email-enviar", { method: "POST", headers, body: JSON.stringify({ itens: itens.slice(i, i + 8) }) });
          if (res.status === 503) break;
          const body = await res.json().catch(() => null);
          const resultados = (body && body.resultados) || [];
          for (const r of resultados) {
            if (!r || (r.status !== "enviado" && r.status !== "ja-enviado") || !this.templateEhReenviar(r.templateId)) continue;
            await this.marcarAlterarSubjudice(r.customerId, r.titulo);
            mudouTag = true;
            enviou41 = true;
          }
        } catch (e) {
          console.warn("[Central e-mail] envio", e);
        }
      }
      if (forcar41 && enviou41) {
        try { localStorage.setItem(chave41, "1"); } catch (e) {}
      }
      if (itens.length) await this.lerEnviosDoDia();
      if (mudouTag && typeof loadDashboardData === "function" && window.AppState && AppState.defaultersLoaded && !window._isDefaultersLoading) {
        try { loadDashboardData(false); } catch (e) {}
      }
      if (document.getElementById("central-email-root") && this.state.aba === "fila") this.render();
      if (document.getElementById("regua-email-templates")) this.pintarPainelRegua();
    } finally {
      this._disparando = false;
    }
  },

  pendentes() {
    return this.state.templates.filter((t) => t.status !== "aprovado");
  },

  chaveVisto(t) {
    return "crm_cem_visto_" + this.eu().email + "_" + t.id + "_" + (t.aprovadoEm || "");
  },

  visto(t) {
    try { return localStorage.getItem(this.chaveVisto(t)) === "1"; } catch (e) { return false; }
  },

  marcarVisto(t) {
    try { localStorage.setItem(this.chaveVisto(t), "1"); } catch (e) {}
  },

  avisosDoCriador() {
    const email = this.eu().email;
    if (!email) return [];
    return this.state.templates.filter((t) => t.status === "aprovado" && !t.ativo && t.avisoCriador && t.criadoPorEmail === email && !this.visto(t));
  },

  async avisar() {
    if (this._avisando || !this.eu().email) return;
    this._avisando = true;
    try {
    if (!this.state.pronto) {
      try { await this.carregar(); } catch (e) { return; }
    }
    if (document.getElementById("cem-modal")) return;
    let sessao = "";
    try { sessao = sessionStorage.getItem("crm_cem_aprov_sessao") || ""; } catch (e) {}
    if (this.souAdmin() && this.pendentes().length && sessao !== "1") {
      this.abrirAprovacao("");
      return;
    }
    const meus = this.avisosDoCriador();
    if (meus.length) this.abrirAvisoCriador(meus);
    } finally {
      this._avisando = false;
    }
  },

  abrirAprovacao(id) {
    if (!this.souAdmin()) return;
    const lista = id ? this.pendentes().filter((t) => t.id === id) : this.pendentes();
    if (!lista.length) return;
    this.fecharModal();
    const blocos = lista.map((t) => `<section class="cem-bloco">
      <h4>${this.esc(t.nome)}</h4>
      <p>${this.esc(this.rotuloTag(t.tag))} · ${this.esc(t.diasVencido)} dia(s) depois de vencido${t.criadoPorNome ? " · " + this.esc(t.criadoPorNome) : ""}</p>
      <p>${this.esc(t.assunto)}</p>
      <div class="cem-aprova-linha">
        <label class="moura-switch">
          <input type="checkbox" id="cem-ligar-${this.esc(t.id)}">
          <span class="moura-switch-track" aria-hidden="true"></span>
          <span class="moura-switch-text">Ligar a régua</span>
        </label>
        <button type="button" class="btn btn-primary btn-sm" onclick="CentralEmailApp.aprovar('${this.esc(t.id)}')">Aprovar</button>
      </div>
    </section>`).join("");
    const pop = document.createElement("div");
    pop.id = "cem-modal";
    pop.className = "cem-modal";
    pop.innerHTML = `<div class="cem-card cem-card-aviso" role="dialog" aria-modal="true" aria-labelledby="cem-titulo">
      <div class="cem-head">
        <h3 id="cem-titulo">Aprovar template</h3>
        <button type="button" class="btn btn-fechar" id="cem-aprov-fechar">Fechar</button>
      </div>
      <div class="cem-body">
        <p class="cem-legenda">A régua só liga se o interruptor estiver ligado na hora de aprovar. Sem isso, o template fica aprovado e a régua continua desligada.</p>
        ${blocos}
      </div>
    </div>`;
    document.body.appendChild(pop);
    pop.querySelector("#cem-aprov-fechar").addEventListener("click", () => {
      try { sessionStorage.setItem("crm_cem_aprov_sessao", "1"); } catch (e) {}
      this.fecharModal();
    });
  },

  async aprovar(id) {
    if (!this.souAdmin()) return;
    const t = this.achar(id);
    if (!t) return;
    const liga = document.getElementById("cem-ligar-" + id);
    t.status = "aprovado";
    t.ativo = !!(liga && liga.checked);
    t.aprovadoEm = new Date().toISOString();
    t.avisoCriador = !t.ativo;
    await this.gravar();
    const ainda = this.pendentes();
    if (ainda.length && document.getElementById("cem-modal")) this.abrirAprovacao("");
    else this.fecharModal();
    if (document.getElementById("central-email-root")) this.render();
  },

  abrirAvisoCriador(lista) {
    const itens = lista || [];
    if (!itens.length) return;
    this.fecharModal();
    const blocos = itens.map((t) => `<section class="cem-bloco">
      <h4>${this.esc(t.nome)}</h4>
      <p>O template foi aprovado, mas a régua continua desligada. Deseja fazer alguma modificação antes de ligar?</p>
      <button type="button" class="btn btn-primary btn-sm" onclick="CentralEmailApp.modificarAprovado('${this.esc(t.id)}')">Modificar</button>
    </section>`).join("");
    const pop = document.createElement("div");
    pop.id = "cem-modal";
    pop.className = "cem-modal";
    pop.innerHTML = `<div class="cem-card cem-card-aviso" role="dialog" aria-modal="true" aria-labelledby="cem-titulo">
      <div class="cem-head">
        <h3 id="cem-titulo">Template aprovado</h3>
        <button type="button" class="btn btn-fechar" id="cem-criador-fechar">Fechar</button>
      </div>
      <div class="cem-body">${blocos}</div>
    </div>`;
    document.body.appendChild(pop);
    pop.querySelector("#cem-criador-fechar").addEventListener("click", () => {
      itens.forEach((t) => this.marcarVisto(t));
      this.fecharModal();
    });
  },

  modificarAprovado(id) {
    const t = this.achar(id);
    if (t) this.marcarVisto(t);
    this.fecharModal();
    this.editar(id);
  },

  templateEhReenviar(id) {
    const t = this.achar(String(id || ""));
    const g = this.tagReenviar();
    return !!(t && Number.isFinite(g) && Number(t.tag) === g);
  },

  gravarCacheTags() {
    try { localStorage.setItem("crm_acordo_email_tag", JSON.stringify(window.acordoEmailTags || {})); } catch (e) {}
  },

  async marcarAlterarSubjudice(customerId, titulo) {
    if (typeof window.acordoEmailTagChave !== "function") return;
    const k = window.acordoEmailTagChave(customerId, titulo);
    if (!k) return;
    window.acordoEmailTags = window.acordoEmailTags || {};
    window.acordoEmailTags[k] = true;
    this.gravarCacheTags();
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.setDoc) return;
    try {
      await fc.setDoc(fc.doc(window.firebaseDb, "acordo_email_tag", k), {
        customerId: String(customerId || ""),
        titulo: String(titulo || ""),
        tag: "Acordo Judicial - Alterar p/ Sub judice Sienge",
        em: new Date().toISOString()
      });
    } catch (e) {
      console.warn("[Central e-mail] tag sub judice", e);
    }
  },

  async sincronizarTags() {
    const fc = window.firebaseCollections;
    if (!window.firebaseDb || !fc || !fc.getDocs) return;
    window.acordoEmailTags = window.acordoEmailTags || {};
    const antes = Object.keys(window.acordoEmailTags).length;
    try {
      const snap = await fc.getDocs(fc.collection(window.firebaseDb, "acordo_email_tag"));
      snap.forEach((d) => { window.acordoEmailTags[d.id] = true; });
    } catch (e) {
      console.warn("[Central e-mail] leitura da tag", e);
      return;
    }
    this.gravarCacheTags();
    if (this._disparando) return;
    if (Object.keys(window.acordoEmailTags).length !== antes
      && typeof loadDashboardData === "function"
      && window.AppState && AppState.defaultersLoaded && !window._isDefaultersLoading) {
      try { loadDashboardData(false); } catch (e2) {}
    }
  },

  async painelRegua() {
    if (!this.state.pronto) {
      try { await this.carregar(); } catch (e) {}
    }
    this.pintarPainelRegua();
  },

  pintarPainelRegua() {
    const root = document.getElementById("regua-email-templates");
    if (!root) return;
    const reenviar = this.tagReenviar();
    const linhas = this.state.templates.map((t) => {
      const gente = (window.rawClientList || []).length ? this.clientesDoTemplate(t) : null;
        const leva = Number(t.tag) === reenviar && gente
        ? `<div style="margin-top:4px;font-size:0.75rem;color:#9a3412;">${gente.length} título(s) entram neste disparo.${this.excecao41Hoje() ? " Hoje também entra quem está com 41 dias." : ""}</div>`
        : "";
      return `<tr>
        <td>${this.esc(t.nome)}${leva}</td>
        <td>${this.esc(this.rotuloTag(t.tag))}</td>
        <td>${this.esc(t.diasVencido)}</td>
        <td>${this.esc(this.situacao(t))}</td>
        <td class="is-right"><button type="button" class="tvig-ico" title="Ver" onclick="CentralEmailApp.verTemplate('${this.esc(t.id)}')"><i data-lucide="eye" style="width:15px;height:15px;"></i></button></td>
      </tr>`;
    }).join("");
    const fila = (window.rawClientList || []).length
      ? ""
      : `<p style="margin:0 0 12px;font-size:0.8rem;color:#64748b;">Abra a Fila de Cobrança nesta sessão para ver quantos títulos entram no disparo.</p>`;
    root.innerHTML = `
      <div style="border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;">
        <div style="padding:14px 16px 10px;">
          <h3 style="font-size:1.05rem;color:#1e293b;margin:0 0 8px;display:flex;align-items:center;gap:8px;">
            <i data-lucide="mail" style="color:var(--color-primary);width:18px;height:18px;"></i> Templates da régua
          </h3>
          <p style="margin:0 0 8px;font-size:0.85rem;color:#475569;line-height:1.45;">Para teste. O olho abre o e-mail com o cliente de exemplo, o mesmo texto que sai no envio.</p>
          <p style="margin:0;font-size:0.85rem;color:#475569;line-height:1.45;">Acordo judicial quebrado: o e-mail sai aos 31 dias de atraso. Só em 23/11/2026 também sai para quem está com 41 dias. Depois do envio, como no Sienge o título não está sub judice, a tag da fila passa a <strong>Acordo Judicial - Alterar p/ Sub judice Sienge</strong>. O envio sai quando o template está aprovado e a régua ligada.</p>
        </div>
        <div style="padding:0 16px 16px;">
          ${fila}
          <div class="table-container">
            <table class="custom-table" style="font-size:0.85rem;">
              <thead><tr>
                <th style="background:#004E33;color:#fff;">Template</th>
                <th style="background:#004E33;color:#fff;">Tag</th>
                <th style="background:#004E33;color:#fff;">Dias vencido</th>
                <th style="background:#004E33;color:#fff;">Régua</th>
                <th style="background:#004E33;color:#fff;text-align:right;">Ações</th>
              </tr></thead>
              <tbody>${linhas || `<tr><td colspan="5">Nenhum template gravado. O texto fica na Central de e-mail.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    if (window.lucide) window.lucide.createIcons({ root: root });
  }
};

window.CentralEmailApp = CentralEmailApp;

document.addEventListener("tabChanged", function (e) {
  if (!window.CentralEmailApp) return;
  if (e && e.detail === "central-email") CentralEmailApp.abrir();
  if (e && e.detail === "configuracoes") CentralEmailApp.painelRegua();
});

document.addEventListener("DOMContentLoaded", function () {
  let tentativas = 0;
  const tentar = function () {
    tentativas += 1;
    const app = window.CentralEmailApp;
    const u = typeof window.crmUsuarioAcesso === "function" ? window.crmUsuarioAcesso() : (window.AppState && window.AppState.currentUser);
    if (!app || !u || !u.email) {
      if (tentativas < 20) setTimeout(tentar, 1000);
      return;
    }
    app.avisar();
  };
  setTimeout(tentar, 2500);
  if (window.CentralEmailApp) CentralEmailApp.sincronizarTags();
  // Envio automático das réguas: confere a cada 2 minutos se a fila do dia já está carregada.
  setInterval(function () {
    if (window.CentralEmailApp) CentralEmailApp.dispararDoDia().catch(() => {});
  }, 120000);
});
