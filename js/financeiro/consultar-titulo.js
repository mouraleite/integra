/* Contas a Pagar > Consultar título: resumo de um título do Sienge pelo número.
   Só leitura. Usa GET /bills/{billId} e as consultas do mesmo título (parcelas, apropriações,
   impostos e anexos). Cada parte que falhar mostra o aviso no próprio bloco, sem derrubar o resto. */
(function () {
  const ConsultarTituloApp = {
    numero: "",
    estado: "inicio", // inicio | carregando | ok | erro
    erro: "",
    dados: null,
    _seq: 0,

    esc(v) {
      return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },

    pick(o, ks) {
      if (!o || typeof o !== "object") return null;
      for (const k of ks) if (o[k] != null && o[k] !== "") return o[k];
      return null;
    },

    num(v) {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },

    lista(res) {
      if (Array.isArray(res)) return res;
      const l = res && (res.results || res.data || res.installments);
      return Array.isArray(l) ? l : [];
    },

    dataBr(v) {
      const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + "/" + m[2] + "/" + m[1] : "—";
    },

    dataHoraBr(v) {
      const s = String(v || "");
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      return m ? m[3] + "/" + m[2] + "/" + m[1] + " " + m[4] + ":" + m[5] : this.dataBr(s);
    },

    moeda(v) {
      const n = this.num(v);
      if (n == null) return "—";
      return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    },

    doc(v) {
      const d = String(v || "").replace(/\D/g, "");
      if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
      if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
      return String(v || "");
    },

    fold(v) {
      return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    },

    erroMsg(e) {
      const msg = String((e && e.message) || e || "");
      const st = Number(e && e.status);
      if (st === 404 || /\b404\b/.test(msg)) return "não encontrado";
      if (st === 403 || /\b403\b/.test(msg)) return "sem permissão no usuário da API";
      return msg || "falha na consulta";
    },

    async get(path) {
      if (typeof window.siengeFetchWithRetry !== "function") throw new Error("Conexão com o Sienge não carregada.");
      return window.siengeFetchWithRetry(path, 3);
    },

    /* Tenta a consulta; em erro devolve { erro } para o bloco mostrar o aviso. */
    async tentar(path) {
      try { return { res: await this.get(path) }; } catch (e) { return { erro: this.erroMsg(e) }; }
    },

    nomeCentroCusto(id) {
      if (id == null || id === "") return "";
      try {
        const lista = JSON.parse(localStorage.getItem("crm_cost_centers_data") || "[]");
        const hit = Array.isArray(lista) && lista.find((c) => c && String(c.id) === String(id));
        return (hit && hit.name) || "";
      } catch (e) { return ""; }
    },

    parcelaPaga(p) {
      const blob = this.fold([p.situation, p.status, p.installmentStatus, p.paymentStatus].filter(Boolean).join(" "));
      if (/parcial/.test(blob)) return "parcial";
      if (!/nao pag|em aberto/.test(blob) && /\bpag[oa]\b|paid|quit|liquid|baixad/.test(blob)) return "pago";
      const saldo = this.num(this.pick(p, ["balanceAmount", "openBalance"]));
      if (saldo != null && saldo <= 0.004) return "pago";
      return "aberto";
    },

    async buscar(valor) {
      const id = String(valor == null ? this.numero : valor).replace(/\D/g, "");
      this.numero = id;
      if (!id) {
        this.estado = "erro";
        this.erro = "Digite o número do título.";
        this.dados = null;
        this.render();
        return;
      }
      const seq = ++this._seq;
      this.estado = "carregando";
      this.erro = "";
      this.dados = null;
      this.render();
      const enc = encodeURIComponent(id);
      let bill;
      try {
        bill = await this.get("/bills/" + enc);
      } catch (e) {
        if (seq !== this._seq) return;
        const m = this.erroMsg(e);
        this.estado = "erro";
        this.erro = m === "não encontrado" ? "Título " + id + " não encontrado no Sienge."
          : (m === "sem permissão no usuário da API" ? "O usuário da API do Sienge não tem permissão para consultar títulos." : "Não consegui buscar o título: " + m);
        this.render();
        return;
      }
      if (seq !== this._seq) return;
      if (!bill || typeof bill !== "object") {
        this.estado = "erro";
        this.erro = "Título " + id + " não encontrado no Sienge.";
        this.render();
        return;
      }
      const credorId = this.pick(bill, ["creditorId"]);
      const empresaId = this.pick(bill, ["debtorId", "companyId"]);
      const [parc, aprop, obras, impostos, anexos, credor, empresa] = await Promise.all([
        this.tentar("/bills/" + enc + "/installments?limit=200"),
        this.tentar("/bills/" + enc + "/budget-categories"),
        this.tentar("/bills/" + enc + "/buildings-cost"),
        this.tentar("/bills/" + enc + "/taxes?limit=100"),
        this.tentar("/bills/" + enc + "/attachments"),
        credorId != null ? this.tentar("/creditors/" + encodeURIComponent(credorId)) : Promise.resolve({}),
        empresaId != null ? this.tentar("/companies/" + encodeURIComponent(empresaId)) : Promise.resolve({})
      ]);
      if (seq !== this._seq) return;
      this.dados = { id, bill, parc, aprop, obras, impostos, anexos, credor, empresa };
      this.estado = "ok";
      this.render();
    },

    filtroHtml() {
      return `
        <div class="cc-toolbar ctit-toolbar">
          <form class="ctit-busca" onsubmit="event.preventDefault(); ConsultarTituloApp.buscar(document.getElementById('ctit-numero').value);">
            <label class="ctit-label" for="ctit-numero">Número do título</label>
            <div class="ctit-linha">
              <input id="ctit-numero" class="form-control ctit-input" inputmode="numeric" autocomplete="off"
                placeholder="Ex.: 15418" value="${this.esc(this.numero)}">
              <button type="submit" class="btn btn-primary cc-atualizar">
                <i data-lucide="search" style="width:16px;"></i> Consultar
              </button>
            </div>
          </form>
        </div>`;
    },

    corpoHtml() {
      if (this.estado === "inicio") {
        return `<p class="ctit-vazio">Digite o número do título do contas a pagar e clique em Consultar.</p>`;
      }
      if (this.estado === "carregando") {
        return `<div class="ml-load ctit-load" role="status" aria-live="polite">
          <div class="loading-spinner" aria-hidden="true"></div>
          <div class="loading-status-text">Consultando o título ${this.esc(this.numero)} no Sienge…</div>
          <div class="ml-load-track"><div class="loading-progress-bar"></div></div>
        </div>`;
      }
      if (this.estado === "erro") return `<p class="ctit-vazio is-erro">${this.esc(this.erro)}</p>`;
      return this.resumoHtml();
    },

    resumoHtml() {
      const d = this.dados;
      const b = d.bill;
      const parcelas = d.parc.erro ? [] : this.lista(d.parc.res);
      const credor = d.credor && d.credor.res;
      const empresa = d.empresa && d.empresa.res;

      const total = this.num(this.pick(b, ["totalInvoiceAmount", "amount", "originalAmount"]));
      const somaParc = parcelas.reduce((t, p) => t + (this.num(this.pick(p, ["amount", "originalAmount", "value"])) || 0), 0);
      const temSaldo = parcelas.some((p) => this.num(this.pick(p, ["balanceAmount", "openBalance"])) != null);
      const saldo = temSaldo ? parcelas.reduce((t, p) => {
        const s = this.num(this.pick(p, ["balanceAmount", "openBalance"]));
        return t + (s != null ? s : (this.parcelaPaga(p) === "pago" ? 0 : (this.num(this.pick(p, ["amount", "originalAmount"])) || 0)));
      }, 0) : null;
      const sits = parcelas.map((p) => this.parcelaPaga(p));
      let situacao = "—";
      let sitClasse = "";
      if (sits.length) {
        if (sits.every((s) => s === "pago")) { situacao = "Pago"; sitClasse = "is-pago"; }
        else if (sits.some((s) => s !== "aberto")) { situacao = "Parcialmente pago"; sitClasse = "is-parcial"; }
        else { situacao = "Em aberto"; sitClasse = "is-aberto"; }
      }

      const credorNome = (credor && this.pick(credor, ["name", "tradeName", "fantasyName"])) || this.pick(b, ["creditorName"]) || "";
      const credorDoc = credor && this.pick(credor, ["cnpj", "cpf", "cpfCnpj", "documentNumber"]);
      const empresaNome = (empresa && this.pick(empresa, ["name", "tradeName"])) || this.pick(b, ["debtorName", "companyName"]) || "";
      const ccId = this.pick(b, ["costCenterId"]);
      const docTipo = this.pick(b, ["documentIdentificationId"]);
      const docNome = this.pick(b, ["documentIdentificationName"]);
      const docNum = this.pick(b, ["documentNumber"]);

      const item = (rot, val) => `<div class="ctit-item"><span>${this.esc(rot)}</span><strong>${val}</strong></div>`;
      const cartao = (rot, val, cls) => `<div class="ctit-kpi ${cls || ""}"><span>${this.esc(rot)}</span><strong>${val}</strong></div>`;

      const kpis = `
        <div class="ctit-kpis">
          ${cartao("Título", this.esc(d.id))}
          ${cartao("Valor do título", this.moeda(total != null ? total : (parcelas.length ? somaParc : null)))}
          ${cartao("Saldo a pagar", saldo != null ? this.moeda(Math.max(0, saldo)) : "—")}
          ${cartao("Situação", this.esc(situacao), sitClasse)}
        </div>`;

      const geral = `
        <section class="ctit-bloco">
          <h3>Dados do título</h3>
          <div class="ctit-grade">
            ${item("Credor", this.esc(credorNome ? credorNome + (credorId(b) ? " (" + credorId(b) + ")" : "") : (credorId(b) || "—")))}
            ${item("CPF/CNPJ do credor", this.esc(credorDoc ? this.doc(credorDoc) : "—"))}
            ${item("Empresa", this.esc(empresaNome ? empresaNome + " (" + this.pick(b, ["debtorId", "companyId"]) + ")" : (this.pick(b, ["debtorId", "companyId"]) || "—")))}
            ${item("Centro de custo", this.esc(ccId != null ? ccId + (this.nomeCentroCusto(ccId) ? " - " + this.nomeCentroCusto(ccId) : "") : "—"))}
            ${item("Documento", this.esc([docTipo, docNome && docNome !== docTipo ? docNome : ""].filter(Boolean).join(" - ") || "—"))}
            ${item("Número do documento", this.esc(docNum || "—"))}
            ${item("Emissão", this.dataBr(this.pick(b, ["issueDate"])))}
            ${item("Parcelas", this.esc(this.pick(b, ["installmentsNumber"]) || parcelas.length || "—"))}
            ${item("Desconto", this.moeda(this.pick(b, ["discount"])))}
            ${item("Status no Sienge", this.esc(this.pick(b, ["status", "situation"]) || "—"))}
            ${item("Origem", this.esc(this.pick(b, ["origin", "originId"]) || "—"))}
            ${item("Cadastrado por", this.esc([this.pick(b, ["registeredBy", "registeredUserId"]), this.pick(b, ["registeredDate"]) ? "em " + this.dataHoraBr(this.pick(b, ["registeredDate"])) : ""].filter(Boolean).join(" ") || "—"))}
            ${item("Alterado por", this.esc([this.pick(b, ["changedBy", "changedUserId"]), this.pick(b, ["changedDate"]) ? "em " + this.dataHoraBr(this.pick(b, ["changedDate"])) : ""].filter(Boolean).join(" ") || "—"))}
          </div>
          ${this.pick(b, ["notes", "observation"]) ? `<div class="ctit-obs"><span>Observação</span><p>${this.esc(this.pick(b, ["notes", "observation"]))}</p></div>` : ""}
        </section>`;

      function credorId(bill) {
        const v = bill && bill.creditorId;
        return v != null && v !== "" ? String(v) : "";
      }

      return kpis + geral
        + this.parcelasHtml(d.parc, parcelas)
        + this.apropriacoesHtml(d.aprop, d.obras)
        + this.impostosHtml(d.impostos)
        + this.anexosHtml(d.anexos);
    },

    avisoBloco(r) {
      return r && r.erro ? `<p class="ctit-aviso">Não consegui consultar: ${this.esc(r.erro)}.</p>` : "";
    },

    tabela(cols, cab, linhas, vazio) {
      return `<div class="cc-scroll ctit-scroll"><table class="cc-table ctit-table">
        <colgroup>${cols.map((w) => w ? `<col style="width:${w}">` : "<col>").join("")}</colgroup>
        <thead><tr>${cab}</tr></thead>
        <tbody>${linhas || `<tr><td colspan="${cols.length}" style="text-align:center;padding:30px;">${this.esc(vazio)}</td></tr>`}</tbody>
      </table></div>`;
    },

    parcelasHtml(r, parcelas) {
      if (r.erro && r.erro !== "não encontrado") {
        return `<section class="ctit-bloco"><h3>Parcelas</h3>${this.avisoBloco(r)}</section>`;
      }
      const rotulo = { pago: "Paga", parcial: "Parcialmente paga", aberto: "Em aberto" };
      const linhas = parcelas.map((p) => {
        const sit = this.parcelaPaga(p);
        const textoSit = this.pick(p, ["situation", "status"]) || rotulo[sit];
        const pagoEm = this.pick(p, ["paymentDate", "payOffDate", "dischargeDate"]);
        return `<tr>
          <td class="is-center">${this.esc(this.pick(p, ["installmentNumber", "installmentId", "id"]) || "—")}</td>
          <td class="is-center">${this.dataBr(this.pick(p, ["dueDate"]))}</td>
          <td class="is-right">${this.moeda(this.pick(p, ["amount", "originalAmount", "value"]))}</td>
          <td class="is-right">${this.moeda(this.pick(p, ["balanceAmount", "openBalance"]))}</td>
          <td class="is-center">${pagoEm ? this.dataBr(pagoEm) : "—"}</td>
          <td><span class="ctit-selo is-${sit}">${this.esc(textoSit)}</span></td>
        </tr>`;
      }).join("");
      return `<section class="ctit-bloco"><h3>Parcelas</h3>
        ${this.tabela(["70px", "110px", "", "", "110px", "190px"],
          `<th class="is-center">Parcela</th><th class="is-center">Vencimento</th><th class="is-right">Valor</th><th class="is-right">Saldo</th><th class="is-center">Pago em</th><th>Situação</th>`,
          linhas, "Nenhuma parcela encontrada.")}
      </section>`;
    },

    apropriacoesHtml(rFin, rObra) {
      const fin = rFin.erro ? [] : this.lista(rFin.res);
      const obra = rObra.erro ? [] : this.lista(rObra.res);
      const pct = (v) => { const n = this.num(v); return n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) + "%"; };
      const linhasFin = fin.map((a) => {
        const cc = this.pick(a, ["costCenterId"]);
        const nomeCc = this.nomeCentroCusto(cc);
        const plano = [this.pick(a, ["paymentCategoriesId", "financialCategoryId"]), this.pick(a, ["paymentCategoriesName", "financialCategoryName"])].filter(Boolean).join(" - ");
        return `<tr>
          <td>${this.esc(cc != null ? cc + (nomeCc ? " - " + nomeCc : "") : "—")}</td>
          <td>${this.esc(plano || "—")}</td>
          <td class="is-right">${pct(this.pick(a, ["percentage", "rate", "financialCategoryRate"]))}</td>
        </tr>`;
      }).join("");
      const linhasObra = obra.map((a) => `<tr>
          <td>${this.esc(this.pick(a, ["buildingId"]) || "—")}</td>
          <td>${this.esc(this.pick(a, ["buildingUnitId"]) || "—")}</td>
          <td>${this.esc(this.pick(a, ["costEstimationSheetId", "costEstimationSheetName"]) || "—")}</td>
          <td class="is-right">${pct(this.pick(a, ["percentage", "rate"]))}</td>
        </tr>`).join("");
      const avisoFin = rFin.erro && rFin.erro !== "não encontrado" ? this.avisoBloco(rFin) : "";
      const blocoObra = (obra.length || (rObra.erro && rObra.erro !== "não encontrado"))
        ? `<h4>Apropriação por obra</h4>${rObra.erro && rObra.erro !== "não encontrado" ? this.avisoBloco(rObra) : this.tabela(["", "", "", "100px"],
            `<th>Obra</th><th>Unidade construtiva</th><th>Planilha</th><th class="is-right">%</th>`, linhasObra, "")}`
        : "";
      return `<section class="ctit-bloco"><h3>Apropriações</h3>
        ${avisoFin || this.tabela(["", "", "100px"],
          `<th>Centro de custo</th><th>Plano financeiro</th><th class="is-right">%</th>`,
          linhasFin, "Nenhuma apropriação financeira encontrada.")}
        ${blocoObra}
      </section>`;
    },

    impostosHtml(r) {
      if (r.erro && r.erro !== "não encontrado") {
        return `<section class="ctit-bloco"><h3>Impostos retidos</h3>${this.avisoBloco(r)}</section>`;
      }
      const lista = r.erro ? [] : this.lista(r.res);
      const linhas = lista.filter((t) => t && typeof t === "object").map((t) => `<tr>
          <td>${this.esc(this.pick(t, ["taxName", "name", "description", "taxDescription", "taxAcronym", "acronym", "taxTypeName", "taxId", "id"]) || "—")}</td>
          <td class="is-right">${this.moeda(this.pick(t, ["taxableBaseAmount", "taxBase", "baseAmount", "calculationBase"]))}</td>
          <td class="is-right">${this.num(this.pick(t, ["rate", "taxRate", "aliquot"])) != null ? this.esc(this.num(this.pick(t, ["rate", "taxRate", "aliquot"])).toLocaleString("pt-BR")) + "%" : "—"}</td>
          <td class="is-right">${this.moeda(this.pick(t, ["amount", "value", "taxAmount", "retainedAmount"]))}</td>
        </tr>`).join("");
      return `<section class="ctit-bloco"><h3>Impostos retidos</h3>
        ${this.tabela(["", "", "100px", ""],
          `<th>Imposto</th><th class="is-right">Base</th><th class="is-right">Alíquota</th><th class="is-right">Valor</th>`,
          linhas, "Nenhum imposto retido neste título.")}
      </section>`;
    },

    anexosHtml(r) {
      if (r.erro && r.erro !== "não encontrado") {
        return `<section class="ctit-bloco"><h3>Anexos</h3>${this.avisoBloco(r)}</section>`;
      }
      const lista = r.erro ? [] : this.lista(r.res);
      const linhas = lista.filter((a) => a && typeof a === "object").map((a) => `<tr>
          <td>${this.esc(this.pick(a, ["name", "fileName"]) || "—")}</td>
          <td>${this.esc(this.pick(a, ["description"]) || "—")}</td>
        </tr>`).join("");
      return `<section class="ctit-bloco"><h3>Anexos</h3>
        ${this.tabela(["", ""], `<th>Arquivo</th><th>Descrição</th>`, linhas, "Nenhum anexo neste título.")}
      </section>`;
    },

    render() {
      const root = document.getElementById("consultar-titulo-root");
      if (!root) return;
      root.innerHTML = `<div class="cc-page ctit-page">${this.filtroHtml()}<div id="ctit-corpo">${this.corpoHtml()}</div></div>`;
      if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
      const inp = document.getElementById("ctit-numero");
      if (inp && this.estado !== "carregando") {
        inp.addEventListener("input", () => { this.numero = inp.value; });
        if (this.estado === "inicio") inp.focus();
      }
    },

    init() {
      this.render();
    }
  };

  window.ConsultarTituloApp = ConsultarTituloApp;
  document.addEventListener("tabChanged", (e) => {
    if (e.detail === "consultar-titulo") ConsultarTituloApp.init();
  });
})();
