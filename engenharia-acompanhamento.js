/* Acompanhamento de obra: id da obra e as datas de previsão. */
(function () {
  const KEY = "crm_engenharia_acompanhamento_obra";
  const COLUNAS = [
    { key: "id", label: "ID da obra" },
    { key: "infra", label: "Previsão término obras Infraestrutura" },
    { key: "lazer", label: "Previsão término obras Lazer" },
    { key: "cliente", label: "Previsão término obras Cliente" },
    { key: "tvoCliente", label: "Previsão TVO Cliente" },
    { key: "lo", label: "Previsão LO" },
    { key: "tvoContrato", label: "Prazo máximo legal (TVO Contrato)" }
  ];
  const DATAS = COLUNAS.filter((c) => c.key !== "id");

  const AcompanhamentoObraApp = {
    linhas: [],
    carregado: false,
    ordem: "id",
    direcao: "asc",
    editando: null,

    podeEditar() {
      if (typeof window.hasCrmPerm !== "function") return false;
      return window.hasCrmPerm("sub_eng_geral_acompanhamento_editar");
    },

    esc(v) {
      return String(v == null ? "" : v)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },

    dataBr(iso) {
      const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + "/" + m[2] + "/" + m[1] : "—";
    },

    carregar() {
      if (this.carregado) return;
      this.carregado = true;
      let lista = [];
      try { lista = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { lista = []; }
      this.linhas = Array.isArray(lista) ? lista.filter((r) => r && r.id) : [];
    },

    gravar() {
      const raw = JSON.stringify(this.linhas);
      try { localStorage.setItem(KEY, raw); } catch (e) {}
    },

    ordenar(campo) {
      if (this.ordem === campo) this.direcao = this.direcao === "asc" ? "desc" : "asc";
      else {
        this.ordem = campo;
        this.direcao = "asc";
      }
      this.render();
    },

    linhasOrdenadas() {
      const campo = this.ordem;
      const dir = this.direcao === "desc" ? -1 : 1;
      return this.linhas.slice().sort((a, b) => {
        if (campo === "id") return (Number(a.id) - Number(b.id)) * dir;
        return String(a[campo] || "").localeCompare(String(b[campo] || "")) * dir;
      });
    },

    init() {
      this.carregar();
      this.render();
    },

    render() {
      const root = document.getElementById("engenharia-acompanhamento-root");
      if (!root) return;
      this.carregar();
      const edita = this.podeEditar();
      const linhas = this.linhasOrdenadas();
      const th = (col) => `<th class="${col.key === "id" ? "" : "is-center"}" onclick="AcompanhamentoObraApp.ordenar('${col.key}')" style="cursor:pointer;user-select:none;">${this.esc(col.label)} <i data-lucide="chevrons-up-down" style="width:11px;vertical-align:middle;"></i></th>`;
      const corpo = linhas.length
        ? linhas.map((r) => `
          <tr>
            <td><strong>${this.esc(r.id)}</strong></td>
            ${DATAS.map((c) => `<td class="is-center">${this.esc(this.dataBr(r[c.key]))}</td>`).join("")}
            <td class="aobra-acoes">${edita ? `
              <button type="button" class="tvig-ico" title="Editar" onclick="AcompanhamentoObraApp.abrir('${this.esc(r.id)}')">
                <i data-lucide="pencil" style="width:15px;height:15px;"></i>
              </button>
              <button type="button" class="tvig-ico is-danger" title="Excluir" onclick="AcompanhamentoObraApp.excluir('${this.esc(r.id)}')">
                <i data-lucide="trash-2" style="width:15px;height:15px;"></i>
              </button>` : ""}</td>
          </tr>`).join("")
        : `<tr><td colspan="8" style="text-align:center;padding:28px;color:#64748b;">Nenhuma obra informada.</td></tr>`;
      root.innerHTML = `
        <div class="cc-page">
          <div class="cc-toolbar">
            <p class="aobra-help">Informe o id da obra e as datas de previsão de cada etapa.</p>
            <div class="cc-toolbar-actions">
              ${edita ? `<button type="button" class="btn btn-primary cc-atualizar" onclick="AcompanhamentoObraApp.abrir('')">Adicionar obra</button>` : ""}
            </div>
          </div>
          <div class="cc-scroll">
            <table class="cc-table aobra-table">
              <colgroup>
                <col class="aobra-id">
                ${DATAS.map(() => "<col>").join("")}
                <col class="aobra-acao">
              </colgroup>
              <thead>
                <tr>
                  ${COLUNAS.map(th).join("")}
                  <th class="is-right">Ações</th>
                </tr>
              </thead>
              <tbody>${corpo}</tbody>
            </table>
          </div>
        </div>
        <div id="aobra-overlay" class="modal-overlay" onclick="if (event.target === this) AcompanhamentoObraApp.fechar()"></div>`;
      if (window.lucide) window.lucide.createIcons();
    },

    abrir(id) {
      if (!this.podeEditar()) return;
      const atual = id ? this.linhas.find((r) => String(r.id) === String(id)) : null;
      this.editando = atual ? String(atual.id) : "";
      const ov = document.getElementById("aobra-overlay");
      if (!ov) return;
      const campo = (key, label, tipo, valor) => `
        <label class="${key === "id" ? "aobra-id" : ""}">${this.esc(label)}
          <input type="${tipo}" id="aobra-${key}" value="${this.esc(valor || "")}" ${key === "id" ? 'inputmode="numeric" autocomplete="off"' : ""}>
        </label>`;
      ov.innerHTML = `
        <div class="modal-box aobra-modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>${atual ? "Obra " + this.esc(atual.id) : "Nova obra"}</h3>
            <button type="button" class="btn btn-fechar" onclick="AcompanhamentoObraApp.fechar()">Fechar</button>
          </div>
          <div class="aobra-form">
            ${campo("id", "ID da obra", "text", atual ? atual.id : "")}
            ${DATAS.map((c) => campo(c.key, c.label, "date", atual ? atual[c.key] : "")).join("")}
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:16px;">
            <button type="button" class="btn btn-primary" onclick="AcompanhamentoObraApp.salvar()">Salvar</button>
          </div>
        </div>`;
      ov.classList.add("active");
      const idInput = document.getElementById("aobra-id");
      if (idInput) idInput.focus();
    },

    fechar() {
      const ov = document.getElementById("aobra-overlay");
      if (!ov) return;
      ov.classList.remove("active");
      ov.innerHTML = "";
      this.editando = null;
    },

    salvar() {
      if (!this.podeEditar()) return;
      const ler = (key) => {
        const el = document.getElementById("aobra-" + key);
        return el ? String(el.value || "").trim() : "";
      };
      const id = ler("id").replace(/\D/g, "");
      if (!id) {
        alert("Informe o id da obra.");
        return;
      }
      const outro = this.linhas.find((r) => String(r.id) === id && String(r.id) !== String(this.editando || ""));
      if (outro) {
        alert("Esta obra já está na tabela.");
        return;
      }
      const linha = { id: id };
      DATAS.forEach((c) => { linha[c.key] = ler(c.key); });
      if (this.editando) {
        const idx = this.linhas.findIndex((r) => String(r.id) === String(this.editando));
        if (idx >= 0) this.linhas[idx] = linha;
        else this.linhas.push(linha);
      } else this.linhas.push(linha);
      this.gravar();
      this.fechar();
      this.render();
    },

    async excluir(id) {
      if (!this.podeEditar()) return;
      const msg = "Excluir o acompanhamento da obra " + id + "?";
      const ok = typeof window.mouraConfirm === "function" ? await window.mouraConfirm(msg) : confirm(msg);
      if (!ok) return;
      this.linhas = this.linhas.filter((r) => String(r.id) !== String(id));
      this.gravar();
      this.render();
    }
  };

  window.AcompanhamentoObraApp = AcompanhamentoObraApp;
  document.addEventListener("tabChanged", (e) => {
    if (e.detail === "engenharia-acompanhamento") AcompanhamentoObraApp.init();
  });
})();
