/**
 * Contas a Receber · Importar acionamentos
 * Lê a planilha da cobrança terceirizada e grava a posição registrada
 * em Ocorrências e promessas, uma vez por título da célula.
 */
const ImportarAcionamentosApp = {
  PERM: "sub_fin_cr_importar_acionamentos",
  state: { linhas: [], lendo: false, gravando: false, aviso: "", resumo: "" },

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  },

  norm(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\./g, " ")
      .replace(/[^A-Za-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  },

  normHeader(s) {
    return this.norm(s).toLowerCase();
  },

  usuarios() {
    const lista = typeof window.getCrmUsersList === "function" ? window.getCrmUsersList() : [];
    return (lista || []).filter((u) => u && String(u.status || "ATIVO").toUpperCase() !== "INATIVO");
  },

  operadorDaPlanilha(nomePlanilha) {
    const alvo = this.norm(nomePlanilha);
    const users = this.usuarios();
    let melhor = null;
    let nota = 0;
    users.forEach((u) => {
      const nome = this.norm(u.name);
      const sienge = this.norm(u.sienge_user);
      let s = 0;
      if (alvo && (nome === alvo || sienge === alvo)) s = 100;
      else if (alvo && (nome.indexOf(alvo) === 0 || sienge.indexOf(alvo) === 0)) s = 80;
      else {
        const partes = alvo.split(" ").filter((p) => p.length > 2);
        if (partes.length && partes.every((p) => nome.indexOf(p) >= 0 || sienge.indexOf(p) >= 0)) s = 60;
      }
      if (s > nota) {
        nota = s;
        melhor = u;
      }
    });
    if (melhor && nota >= 60) return { nome: melhor.name, email: melhor.email || "", fallback: false, planilha: nomePlanilha };
    const thai = users.find((u) => this.norm(u.name).indexOf("THAIANE") >= 0 || this.norm(u.sienge_user).indexOf("THAIANE") >= 0);
    return {
      nome: (thai && thai.name) || "THAIANE CORDEIRO",
      email: (thai && thai.email) || "",
      fallback: true,
      planilha: nomePlanilha
    };
  },

  titulosDaCelula(valor) {
    const vistos = new Set();
    String(valor == null ? "" : valor)
      .split(/[·•|;,\n/]+/)
      .forEach((parte) => {
        const id = String(parte).replace(/\D/g, "");
        if (id) vistos.add(id);
      });
    return Array.from(vistos);
  },

  parseDataHora(valor) {
    if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString();
    const s = String(valor || "").trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (br) {
      const d = new Date(+br[3], +br[2] - 1, +br[1], +(br[4] || 0), +(br[5] || 0), +(br[6] || 0));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) {
      const d = new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 12), +(iso[5] || 0), +(iso[6] || 0));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
  },

  parseDia(valor) {
    if (valor instanceof Date && !isNaN(valor.getTime())) {
      const y = valor.getFullYear();
      const m = String(valor.getMonth() + 1).padStart(2, "0");
      const d = String(valor.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + d;
    }
    const s = String(valor || "").trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return br[3] + "-" + br[2] + "-" + br[1];
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    return "";
  },

  hojeIso() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  },

  numero(valor) {
    if (typeof valor === "number") return valor;
    const s = String(valor || "").trim();
    if (!s) return 0;
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : Number(s) || 0;
  },

  moeda(n) {
    return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },

  chave(dataHora, titulo, texto) {
    const base = [dataHora, titulo, texto].join("|");
    let h = 0;
    for (let i = 0; i < base.length; i++) h = Math.imul(h, 31) + base.charCodeAt(i) | 0;
    return "imp-ac-" + (h >>> 0).toString(36) + "-" + String(titulo);
  },

  coluna(row, nome) {
    const alvo = this.normHeader(nome);
    const keys = Object.keys(row || {});
    const hit = keys.find((k) => this.normHeader(k) === alvo);
    return hit ? row[hit] : "";
  },

  async lerArquivo(file) {
    if (typeof XLSX === "undefined") throw new Error("A leitura de Excel não carregou. Atualize a página.");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    const linhas = [];
    rows.forEach((row, idx) => {
      const titulos = this.titulosDaCelula(this.coluna(row, "Título") || this.coluna(row, "Titulo"));
      const posicao = String(this.coluna(row, "Posição registrada") || this.coluna(row, "Posicao registrada") || "").trim();
      const responsavel = String(this.coluna(row, "Responsável") || this.coluna(row, "Responsavel") || "").trim();
      const cliente = String(this.coluna(row, "Cliente") || "").trim();
      const situacao = String(this.coluna(row, "Situação registrada") || this.coluna(row, "Situacao registrada") || "").trim();
      const quando = this.parseDataHora(this.coluna(row, "Data e hora"));
      const combinada = this.parseDia(this.coluna(row, "Data combinada"));
      const valor = this.numero(this.coluna(row, "Valor do acordo"));
      const op = this.operadorDaPlanilha(responsavel);
      if (!titulos.length) {
        linhas.push({
          linha: idx + 2, titulo: "", cliente, responsavel, operador: op.nome, fallback: op.fallback,
          email: op.email, situacao, posicao, quando, combinada, valor, erro: "Sem título"
        });
        return;
      }
      titulos.forEach((titulo) => {
        linhas.push({
          linha: idx + 2, titulo, cliente, responsavel, operador: op.nome, fallback: op.fallback,
          email: op.email, situacao, posicao, quando, combinada, valor, erro: posicao ? "" : "Sem posição registrada"
        });
      });
    });
    return linhas;
  },

  listasLocais() {
    const app = window.AppState || {};
    return [].concat(window.rawClientList || [], window.clientList || [], app.sales || [], app.defaultersBills || []);
  },

  acharLocal(titulo) {
    const t = typeof window.normalizeTituloId === "function" ? window.normalizeTituloId(titulo) : String(titulo || "");
    if (!t) return null;
    const norm = (v) => (typeof window.normalizeTituloId === "function" ? window.normalizeTituloId(v) : String(v || "").replace(/\D/g, ""));
    return this.listasLocais().find((c) => {
      if (!c) return false;
      return [c.saleId, c.id, c.receivableBillId, c.billReceivableId].some((v) => norm(v) === t);
    }) || null;
  },

  async acharTitulo(titulo) {
    const local = this.acharLocal(titulo);
    if (local && (local.customerId || local.clientId)) return local;
    if (typeof window.relFindTituloLocal === "function") {
      const achou = window.relFindTituloLocal(titulo);
      if (achou && achou.customerId) return achou;
    }
    if (typeof window.relSiengeGet === "function") {
      const bill = await window.relSiengeGet("/accounts-receivable/receivable-bills/" + encodeURIComponent(titulo));
      if (bill && bill.customerId) return bill;
    }
    return null;
  },

  textoOcorrencia(linha) {
    const partes = [linha.posicao];
    if (linha.valor > 0) partes.push("Valor do acordo: " + this.moeda(linha.valor));
    return partes.filter(Boolean).join("\n");
  },

  montarOcorrencia(linha, ficha) {
    const texto = this.textoOcorrencia(linha);
    const combinada = linha.combinada && linha.combinada >= this.hojeIso() ? linha.combinada : "";
    const customerId = ficha.customerId || ficha.clientId;
    return {
      id: this.chave(linha.quando, linha.titulo, texto),
      date: linha.quando,
      author: linha.operador,
      authorEmail: linha.email || "",
      saleId: String(linha.titulo),
      receivableBillId: String(ficha.receivableBillId || ficha.id || linha.titulo),
      contractId: ficha.contractId || ficha.contractNumber || ficha.documentNumber || null,
      unitId: ficha.unitId || null,
      customerId: customerId,
      text: texto,
      promiseDate: combinada || null,
      promiseStatus: combinada ? "Pendente" : null,
      canal: linha.situacao || "Acionamento",
      iniciativa: "Ativo",
      pinned: false,
      importado: true,
      updatedAt: new Date().toISOString(),
      attachments: []
    };
  },

  async gravar() {
    const prontas = this.state.linhas.filter((l) => !l.erro);
    if (!prontas.length || this.state.gravando) return;
    this.state.gravando = true;
    this.state.aviso = "";
    this.render();
    const cache = new Map();
    let gravadas = 0;
    let repetidas = 0;
    let semTitulo = 0;
    const porCliente = new Map();
    try {
      for (let i = 0; i < prontas.length; i++) {
        const linha = prontas[i];
        this.state.aviso = "Consultando títulos " + (i + 1) + " de " + prontas.length;
        this.pintarAviso();
        let ficha = cache.get(linha.titulo);
        if (ficha === undefined) {
          try { ficha = await this.acharTitulo(linha.titulo); }
          catch (e) { ficha = null; }
          cache.set(linha.titulo, ficha || null);
        }
        if (!ficha || !(ficha.customerId || ficha.clientId)) {
          semTitulo++;
          linha.erro = "Título não encontrado";
          continue;
        }
        const occ = this.montarOcorrencia(linha, ficha);
        const key = String(occ.customerId);
        if (!porCliente.has(key)) porCliente.set(key, []);
        const lista = porCliente.get(key);
        if (!lista.some((item) => item.id === occ.id)) lista.push(occ);
      }
      let n = 0;
      for (const [customerId, novas] of porCliente) {
        n++;
        this.state.aviso = "Gravando cliente " + n + " de " + porCliente.size;
        this.pintarAviso();
        if (!window.AppState.notes) window.AppState.notes = {};
        const atual = typeof window.getCustomerNotesList === "function"
          ? window.getCustomerNotesList(window.AppState.notes, customerId)
          : (window.AppState.notes[customerId] || []);
        const incluir = novas.filter((occ) => !atual.some((item) => item && item.id === occ.id));
        repetidas += novas.length - incluir.length;
        if (!incluir.length) continue;
        window.AppState.notes[customerId] = atual.concat(incluir);
        if (typeof window.saveNotesToFirebase === "function") await window.saveNotesToFirebase(customerId);
        else localStorage.setItem("crm_moura_notes", JSON.stringify(window.AppState.notes));
        gravadas += incluir.length;
      }
      this.state.resumo = gravadas + " ocorrência(s) gravada(s)"
        + (repetidas ? " · " + repetidas + " já estavam no título" : "")
        + (semTitulo ? " · " + semTitulo + " título(s) não encontrado(s)" : "");
      this.state.aviso = "";
    } catch (err) {
      this.state.aviso = "";
      this.state.resumo = "A gravação parou: " + ((err && err.message) || err);
    }
    this.state.gravando = false;
    this.render();
  },

  pintarAviso() {
    const el = document.getElementById("iac-aviso");
    if (el) el.textContent = this.state.aviso || this.state.resumo || "";
  },

  async ler() {
    const input = document.getElementById("iac-arquivo");
    const file = input && input.files && input.files[0];
    if (!file) {
      this.state.aviso = "Escolha a planilha de acionamentos.";
      this.render();
      return;
    }
    this.state.lendo = true;
    this.state.resumo = "";
    this.state.aviso = "Lendo a planilha…";
    this.render();
    try {
      this.state.linhas = await this.lerArquivo(file);
      const n = this.state.linhas.filter((l) => !l.erro).length;
      this.state.aviso = n
        ? n + " título(s) pronto(s) para gravar."
        : "Nenhuma linha com título e posição registrada.";
    } catch (err) {
      this.state.linhas = [];
      this.state.aviso = (err && err.message) || "Não foi possível ler a planilha.";
    }
    this.state.lendo = false;
    this.render();
  },

  render() {
    const root = document.getElementById("importar-acionamentos-root");
    if (!root) return;
    const s = this.state;
    const prontas = s.linhas.filter((l) => !l.erro).length;
    const fallback = s.linhas.filter((l) => l.fallback && !l.erro).length;
    const linhas = s.linhas.map((l) => `
      <tr>
        <td class="is-right">${this.esc(l.titulo || "—")}</td>
        <td>${this.esc(l.cliente || "—")}</td>
        <td>${this.esc(l.responsavel || "—")}</td>
        <td>${this.esc(l.operador)}${l.fallback ? " · cadastro da terceirizada" : ""}</td>
        <td>${this.esc(l.situacao || "—")}</td>
        <td class="iac-pos">${this.esc(l.posicao || "—")}</td>
        <td>${l.erro ? this.esc(l.erro) : (l.combinada && l.combinada >= this.hojeIso() ? "Promessa " + this.esc(l.combinada.split("-").reverse().join("/")) : "Ocorrência")}</td>
      </tr>`).join("");
    root.innerHTML = `
      <style>
        #importar-acionamentos-root .iac-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        #importar-acionamentos-root .iac-bar input[type=file] { height: 38px; }
        #importar-acionamentos-root .iac-bar .btn { height: 38px; }
        #importar-acionamentos-root td.iac-pos { white-space: normal; }
        #importar-acionamentos-root .iac-nota { margin: 8px 0 0; color: #5e6b66; font-size: 0.82rem; }
      </style>
      <div class="search-filter-panel">
        <div class="iac-bar">
          <input type="file" id="iac-arquivo" accept=".xlsx,.xls">
          <button type="button" class="btn btn-primary" ${s.lendo || s.gravando ? "disabled" : ""} onclick="ImportarAcionamentosApp.ler()">Ler planilha</button>
          <button type="button" class="btn btn-primary" ${!prontas || s.gravando || s.lendo ? "disabled" : ""} onclick="ImportarAcionamentosApp.gravar()">Gravar</button>
        </div>
        <p class="iac-nota">A posição registrada entra em Ocorrências e promessas, no nome do responsável cadastrado no Integra. Sem cadastro, fica no nome da Thaiane. Vários títulos na mesma célula geram um registro em cada um. Data combinada de hoje ou futura vira promessa pendente.</p>
        <p class="iac-nota" id="iac-aviso">${this.esc(s.aviso || s.resumo || "")}${fallback ? " · " + fallback + " no nome da Thaiane" : ""}</p>
      </div>
      ${s.linhas.length ? `
      <div class="cc-scroll">
        <table class="cc-table iac-table">
          <colgroup>
            <col style="width:90px"><col style="width:18%"><col style="width:14%"><col style="width:18%"><col style="width:12%"><col><col style="width:120px">
          </colgroup>
          <thead>
            <tr>
              <th class="is-right">Título</th>
              <th>Cliente</th>
              <th>Responsável</th>
              <th>Operador</th>
              <th>Situação</th>
              <th>Posição registrada</th>
              <th>Registro</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>` : ""}`;
  },

  init() {
    if (!document.getElementById("importar-acionamentos-root")) return;
    this.render();
  }
};

window.ImportarAcionamentosApp = ImportarAcionamentosApp;

window.crmGarantirImportarAcionamentos = function(profileName, perms) {
  const kind = typeof window.crmProfileKind === "function" ? window.crmProfileKind(profileName) : "";
  const admin = typeof window.isCrmAdminProfileName === "function" && window.isCrmAdminProfileName(profileName);
  if (!admin && kind !== "back_office" && kind !== "terceirizado") return perms;
  const out = Object.assign({}, perms || {});
  let mudou = false;
  ["acessar", "visualizar", "editar"].forEach((flag) => {
    const key = ImportarAcionamentosApp.PERM + "_" + flag;
    if (out[key] !== true) {
      out[key] = true;
      mudou = true;
    }
  });
  if (mudou) ImportarAcionamentosApp.persistirPerfil(profileName, out);
  return out;
};

ImportarAcionamentosApp.persistirPerfil = function(profileName, perms) {
  const kind = typeof window.crmProfileKind === "function" ? window.crmProfileKind(profileName) : "";
  const admin = typeof window.isCrmAdminProfileName === "function" && window.isCrmAdminProfileName(profileName);
  let id = typeof window.resolveCrmProfileId === "function" ? window.resolveCrmProfileId(profileName) : "";
  if (admin) {
    const candidatos = [id, "admin", "administrador"].filter(Boolean);
    id = candidatos.find((c) => {
      try { return !!localStorage.getItem("crm_perms_" + c); } catch (e) { return false; }
    }) || "admin";
  } else if (!id && kind === "back_office") id = "operador_cobranca_back_office";
  else if (!id && kind === "terceirizado") id = "operador_cobranca_terceirizado";
  if (!id) return;
  const marca = ImportarAcionamentosApp.PERM + ":" + id;
  if (ImportarAcionamentosApp._gravouPerm && ImportarAcionamentosApp._gravouPerm[marca]) return;
  ImportarAcionamentosApp._gravouPerm = ImportarAcionamentosApp._gravouPerm || {};
  ImportarAcionamentosApp._gravouPerm[marca] = true;
  const payload = Object.assign({}, perms, { _savedAt: Date.now() });
  try { localStorage.setItem("crm_perms_" + id, JSON.stringify(payload)); } catch (e) {}
  if (typeof window.persistCrmProfilePermsNow === "function") {
    window.persistCrmProfilePermsNow(id, payload).catch((err) => {
      if (ImportarAcionamentosApp._gravouPerm) delete ImportarAcionamentosApp._gravouPerm[marca];
      console.warn("[Importar acionamentos] permissão", id, err);
    });
  }
};

if (typeof window.applyMenuPermissions === "function") window.applyMenuPermissions();

document.addEventListener("tabChanged", function (e) {
  if (e.detail === "importar-acionamentos") ImportarAcionamentosApp.init();
});
