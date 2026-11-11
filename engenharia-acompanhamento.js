/* Acompanhamento de obra: empreendimento e as datas de previsão, em linha do tempo. */
(function () {
  const KEY = "crm_engenharia_acompanhamento_obra";
  const COLUNAS = [
    { key: "id", label: "Empreendimento" },
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
    _emps: null,
    _empsPromise: null,

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

    fold(v) {
      return String(v || "")
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    },

    dataBr(iso) {
      const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + "/" + m[2] + "/" + m[1] : "—";
    },

    nomeExibicao(e) {
      const bruto = e && (e.name || e.description || e.costCenterName || "");
      return String(bruto).trim().toLocaleUpperCase("pt-BR");
    },

    filtrarEmpreendimentos(lista) {
      const app = window.EstoqueComercialApp;
      if (app && typeof app.filterEmpreendimentosLikeRelacionamento === "function") {
        return app.filterEmpreendimentosLikeRelacionamento(lista);
      }
      return (lista || []).filter((c) => c && /^[12]/.test(String(c.id || "").trim()));
    },

    async listaEmpreendimentos() {
      if (this._emps && this._emps.length) return this._emps;
      if (!this._empsPromise) {
        this._empsPromise = this.buscarEmpreendimentos().finally(() => {
          this._empsPromise = null;
        });
      }
      return this._empsPromise;
    },

    async buscarEmpreendimentos() {
      const svc = window.SiengeApiService;
      let raw = [];
      try {
        if (svc && typeof svc.getCostCenters === "function") raw = await svc.getCostCenters();
        else if (window.AnexosState && Array.isArray(window.AnexosState.enterprises)) raw = window.AnexosState.enterprises;
      } catch (e) {
        raw = [];
      }
      const lista = this.filtrarEmpreendimentos(raw || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
      if (lista.length) this._emps = lista;
      return this._emps || lista;
    },

    nomeDe(id) {
      const e = (this._emps || []).find((x) => String(x.id) === String(id));
      if (e) return this.nomeExibicao(e);
      const linha = this.linhas.find((r) => String(r.id) === String(id));
      return linha && linha.nome ? String(linha.nome) : "";
    },

    rotulo(r) {
      const nome = (r && r.nome) || this.nomeDe(r && r.id);
      if (!r || !r.id) return "";
      return nome ? r.id + " - " + nome : String(r.id);
    },

    completarNomes() {
      if (!this._emps || !this._emps.length) return false;
      let mudou = false;
      this.linhas.forEach((r) => {
        const nome = this.nomeDe(r.id);
        if (nome && r.nome !== nome) {
          r.nome = nome;
          mudou = true;
        }
      });
      if (mudou) this.gravar();
      return mudou;
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
      this.listaEmpreendimentos().then(() => {
        const mudou = this.completarNomes();
        if ((mudou || this._emps) && !document.getElementById("aobra-busca")) this.render();
      }).catch(() => {});
    },

    render() {
      const root = document.getElementById("engenharia-acompanhamento-root");
      if (!root) return;
      this.carregar();
      const edita = this.podeEditar();
      const linhas = this.linhasOrdenadas();
      const th = (col) => `<th class="${col.key === "id" ? "" : "is-center"}" onclick="AcompanhamentoObraApp.ordenar('${col.key}')" style="cursor:pointer;user-select:none;">${this.esc(col.label)} <i data-lucide="chevrons-up-down" style="width:11px;vertical-align:middle;"></i></th>`;
      const corpo = linhas.length
        ? linhas.map((r) => {
          const rotulo = this.rotulo(r);
          return `
          <tr>
            <td class="aobra-emp" title="${this.esc(rotulo)}"><strong>${this.esc(rotulo)}</strong></td>
            ${DATAS.map((c) => `<td class="is-center">${this.esc(this.dataBr(r[c.key]))}</td>`).join("")}
            <td class="aobra-acoes">${edita ? `
              <button type="button" class="tvig-ico" title="Editar" onclick="AcompanhamentoObraApp.abrir('${this.esc(r.id)}')">
                <i data-lucide="pencil" style="width:15px;height:15px;"></i>
              </button>
              <button type="button" class="tvig-ico is-danger" title="Excluir" onclick="AcompanhamentoObraApp.excluir('${this.esc(r.id)}')">
                <i data-lucide="trash-2" style="width:15px;height:15px;"></i>
              </button>` : ""}</td>
          </tr>`;
        }).join("")
        : `<tr><td colspan="8" style="text-align:center;padding:28px;color:#64748b;">Nenhuma obra informada.</td></tr>`;
      root.innerHTML = `
        <div class="cc-page">
          <div class="cc-toolbar">
            <p class="aobra-help">Escolha o empreendimento e preencha as datas na ordem da linha do tempo.</p>
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
      const nomeAtual = atual ? (atual.nome || this.nomeDe(atual.id)) : "";
      const busca = atual ? (nomeAtual ? atual.id + " - " + nomeAtual : String(atual.id)) : "";
      const marcos = DATAS.map((c, i) => `
        <label class="aobra-marco" title="${this.esc(c.label)}">
          <span class="aobra-marco-n">${i + 1}</span>
          <span class="aobra-marco-nome">${this.esc(c.label)}</span>
          <input type="date" id="aobra-${c.key}" value="${this.esc(atual ? atual[c.key] : "")}">
        </label>`).join("");
      ov.innerHTML = `
        <div class="modal-box aobra-modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>${atual ? this.esc(busca) : "Nova obra"}</h3>
            <button type="button" class="btn btn-fechar" onclick="AcompanhamentoObraApp.fechar()">Fechar</button>
          </div>
          <div class="aobra-form">
            <label class="aobra-campo">Empreendimento
              <div class="aobra-combo">
                <input type="text" id="aobra-busca" placeholder="Digite ID, nome ou escolha na lista..." value="${this.esc(busca)}" autocomplete="off">
                <input type="hidden" id="aobra-id" value="${this.esc(atual ? atual.id : "")}">
                <button type="button" class="btn btn-outline aobra-chevron" id="aobra-abrir-lista" title="Abrir lista">
                  <i data-lucide="chevron-down" style="width:16px;height:16px;"></i>
                </button>
                <div id="aobra-sugestoes" class="aobra-sugestoes" style="display:none;"></div>
              </div>
            </label>
            <div class="aobra-tempo" aria-label="Linha do tempo das previsões">
              ${marcos}
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:16px;">
            <button type="button" class="btn btn-primary" onclick="AcompanhamentoObraApp.salvar()">Salvar</button>
          </div>
        </div>`;
      ov.classList.add("active");
      this.ligarBusca();
      if (window.lucide) window.lucide.createIcons();
      const buscaInput = document.getElementById("aobra-busca");
      if (buscaInput) buscaInput.focus();
      this.listaEmpreendimentos().catch(() => {});
    },

    ligarBusca() {
      const input = document.getElementById("aobra-busca");
      const btn = document.getElementById("aobra-abrir-lista");
      const box = document.getElementById("aobra-sugestoes");
      if (input) {
        input.addEventListener("focus", () => this.abrirLista(true));
        input.addEventListener("input", () => {
          const hid = document.getElementById("aobra-id");
          if (hid) hid.value = "";
          this.mostrarSugestoes(input.value, false);
        });
      }
      if (btn) {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.alternarLista();
        });
      }
      if (box && !box._ligado) {
        box._ligado = true;
        box.addEventListener("mousedown", (ev) => {
          const item = ev.target.closest(".aobra-sug-item");
          if (!item) return;
          ev.preventDefault();
          this.escolher(item.getAttribute("data-id"));
        });
      }
      if (!this._fora) {
        this._fora = (ev) => {
          const combo = ev.target && ev.target.closest && ev.target.closest(".aobra-combo");
          const lista = document.getElementById("aobra-sugestoes");
          if (!combo && lista) lista.style.display = "none";
        };
        document.addEventListener("click", this._fora);
      }
    },

    abrirLista(mostrarTudo) {
      const box = document.getElementById("aobra-sugestoes");
      if (box && !this._emps) {
        box.innerHTML = `<div class="aobra-sug-vazio">Carregando empreendimentos...</div>`;
        box.style.display = "block";
      }
      this.listaEmpreendimentos().then(() => {
        const atual = document.getElementById("aobra-busca");
        if (!atual) return;
        this.mostrarSugestoes(atual.value, mostrarTudo);
      }).catch(() => {
        const atual = document.getElementById("aobra-busca");
        if (atual) this.mostrarSugestoes(atual.value, mostrarTudo);
      });
    },

    alternarLista() {
      const box = document.getElementById("aobra-sugestoes");
      if (!box) return;
      if (box.style.display === "block") {
        box.style.display = "none";
        return;
      }
      this.abrirLista(true);
    },

    mostrarSugestoes(val, mostrarTudo) {
      const box = document.getElementById("aobra-sugestoes");
      if (!box) return;
      if (!this._emps) {
        box.innerHTML = `<div class="aobra-sug-vazio">Nenhum empreendimento encontrado</div>`;
        box.style.display = "block";
        return;
      }
      const termo = this.fold(val);
      let filtrados = this._emps.slice();
      if (!mostrarTudo && !termo) {
        box.style.display = "none";
        return;
      }
      if (termo) {
        filtrados = filtrados.filter((e) => {
          const id = String(e.id || "");
          const nome = this.fold(this.nomeExibicao(e));
          return nome.indexOf(termo) >= 0 || id.indexOf(String(val || "").trim()) >= 0 || this.fold(id + " - " + this.nomeExibicao(e)).indexOf(termo) >= 0;
        });
      }
      filtrados = filtrados.slice(0, mostrarTudo && !termo ? 80 : 20);
      if (!filtrados.length) {
        box.innerHTML = `<div class="aobra-sug-vazio">Nenhum empreendimento encontrado</div>`;
        box.style.display = "block";
        return;
      }
      box.innerHTML = filtrados.map((e) => {
        const id = String(e.id);
        const nome = this.nomeExibicao(e);
        return `<button type="button" class="aobra-sug-item" data-id="${this.esc(id)}">
          <span class="aobra-sug-id">${this.esc(id)}</span>
          <span class="aobra-sug-nome">${this.esc(nome)}</span>
        </button>`;
      }).join("");
      box.style.display = "block";
    },

    escolher(id) {
      const e = (this._emps || []).find((x) => String(x.id) === String(id));
      if (!e) return;
      const nome = this.nomeExibicao(e);
      const hid = document.getElementById("aobra-id");
      const input = document.getElementById("aobra-busca");
      const box = document.getElementById("aobra-sugestoes");
      if (hid) hid.value = String(e.id);
      if (input) input.value = e.id + " - " + nome;
      if (box) box.style.display = "none";
    },

    idEscolhido() {
      const hid = document.getElementById("aobra-id");
      const direto = hid ? String(hid.value || "").replace(/\D/g, "") : "";
      if (direto) return direto;
      const input = document.getElementById("aobra-busca");
      const texto = this.fold(input ? input.value : "");
      if (!texto) return "";
      const hit = (this._emps || []).find((e) => {
        const id = String(e.id);
        const nome = this.fold(this.nomeExibicao(e));
        return texto === id || texto === nome || texto === this.fold(id + " - " + this.nomeExibicao(e));
      });
      return hit ? String(hit.id) : "";
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
      const id = this.idEscolhido();
      if (!id) {
        alert("Escolha o empreendimento na lista.");
        return;
      }
      const outro = this.linhas.find((r) => String(r.id) === id && String(r.id) !== String(this.editando || ""));
      if (outro) {
        alert("Este empreendimento já está na tabela.");
        return;
      }
      const linha = { id: id, nome: this.nomeDe(id) };
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
      const rotulo = this.rotulo({ id: id, nome: this.nomeDe(id) });
      const msg = "Excluir o acompanhamento de " + rotulo + "?";
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
