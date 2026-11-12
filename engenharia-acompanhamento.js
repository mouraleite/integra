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
  const NUVEM = { colecao: "engenharia_acompanhamento", doc: "obras" };
  /* Carga inicial da planilha "Previsão término obras" (aba Ver 26-08-26), último dia de cada mês.
     Só entra quando ainda não existe nada salvo na nuvem. "idem" no Lazer = mesma data da Infraestrutura. */
  const CARGA_INICIAL = [
    { id: "13900", infra: "2026-08-31", lazer: "2026-11-30", cliente: "2027-01-31", tvoCliente: "2027-01-31", lo: "2027-04-30", tvoContrato: "2028-12-31" },
    { id: "14000", infra: "2026-09-30", lazer: "2027-01-31", cliente: "2027-01-31", tvoCliente: "2027-01-31", lo: "2027-04-30", tvoContrato: "2028-12-31" },
    { id: "14703", infra: "2027-08-31", lazer: "2027-08-31", cliente: "2027-11-30", tvoCliente: "2027-11-30", lo: "2028-03-31", tvoContrato: "2029-01-31" },
    { id: "14704", infra: "2028-03-31", lazer: "2028-03-31", cliente: "2028-03-31", tvoCliente: "2028-03-31", lo: "2028-07-31", tvoContrato: "2029-01-31" },
    { id: "16103", infra: "2027-09-30", lazer: "", cliente: "2027-06-30", tvoCliente: "2028-03-31", lo: "2028-03-31", tvoContrato: "2028-02-29" },
    { id: "17701", infra: "2028-05-31", lazer: "2028-05-31", cliente: "2028-05-31", tvoCliente: "2028-08-31", lo: "2028-11-30", tvoContrato: "2030-06-30" },
    { id: "15300", infra: "2029-08-31", lazer: "2030-08-31", cliente: "2029-11-30", tvoCliente: "2030-02-28", lo: "", tvoContrato: "2030-02-28" }
  ];

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

    quando(ms) {
      const n = Number(ms);
      if (!n) return "";
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return "";
      const p = (x) => String(x).padStart(2, "0");
      return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " às " + p(d.getHours()) + ":" + p(d.getMinutes());
    },

    textoInserido(ms) {
      const t = this.quando(ms);
      return t ? "Inserido em " + t : "Inserido em data não registrada";
    },

    foto(linha) {
      const f = { em: Number(linha && linha.inseridoEm) || 0 };
      DATAS.forEach((c) => { f[c.key] = String((linha && linha[c.key]) || ""); });
      return f;
    },

    datasIguais(a, b) {
      return DATAS.every((c) => String((a && a[c.key]) || "") === String((b && b[c.key]) || ""));
    },

    aplicarVersao(anterior, linha, agora) {
      const agoraMs = agora || Date.now();
      const proxima = { id: String(linha.id), nome: linha.nome || "", inseridoEm: agoraMs, historico: [] };
      DATAS.forEach((c) => { proxima[c.key] = String(linha[c.key] || ""); });
      if (!anterior) return proxima;
      const historico = Array.isArray(anterior.historico) ? anterior.historico.map((h) => Object.assign({}, h)) : [];
      if (this.datasIguais(anterior, proxima)) proxima.inseridoEm = Number(anterior.inseridoEm) || 0;
      else {
        historico.push(this.foto(anterior));
        proxima.inseridoEm = agoraMs;
      }
      proxima.historico = historico;
      return proxima;
    },

    marcosLeitura(fonte) {
      return DATAS.map((c, i) => `
        <div class="aobra-marco" title="${this.esc(c.label)}">
          <span class="aobra-marco-n">${i + 1}</span>
          <span class="aobra-marco-nome">${this.esc(c.label)}</span>
          <span class="aobra-marco-data">${this.esc(this.dataBr(fonte && fonte[c.key]))}</span>
        </div>`).join("");
    },

    htmlHistorico(linha) {
      const lista = (linha && Array.isArray(linha.historico) ? linha.historico : []).slice().reverse();
      const itens = lista.length
        ? lista.map((h) => `
          <article class="aobra-hist-item">
            <p class="aobra-quando">${this.esc(this.textoInserido(h.em))}</p>
            <div class="aobra-tempo aobra-tempo-leitura" aria-label="Linha do tempo anterior">${this.marcosLeitura(h)}</div>
          </article>`).join("")
        : `<p class="aobra-hist-vazio">Nenhuma linha do tempo anterior.</p>`;
      return `
        <section class="aobra-passado" aria-label="Linhas do tempo anteriores">
          <div class="aobra-bloco-topo">
            <span class="aobra-selo">Anteriores</span>
          </div>
          <div class="aobra-hist">${itens}</div>
        </section>`;
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
      this.carregarNuvem();
    },

    localAt() {
      try { return Number(localStorage.getItem(KEY + "_at")) || 0; } catch (e) { return 0; }
    },

    gravarLocal(at) {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.linhas));
        localStorage.setItem(KEY + "_at", String(at || Date.now()));
      } catch (e) {}
    },

    gravar() {
      const at = Date.now();
      this.gravarLocal(at);
      this.salvarNuvem(at);
    },

    async salvarNuvem(at) {
      const fx = window.firebaseCollections;
      const db = window.firebaseDb;
      if (!this.podeEditar() || !fx || !db || typeof fx.setDoc !== "function") return;
      try {
        await fx.setDoc(fx.doc(db, NUVEM.colecao, NUVEM.doc), { linhas: this.linhas, savedAt: at || Date.now() });
      } catch (e) {
        console.warn("[Acompanhamento de obra] Não foi possível salvar na nuvem:", e);
      }
    },

    async carregarNuvem(tentativa) {
      const fx = window.firebaseCollections;
      const db = window.firebaseDb;
      if (!fx || !db || typeof fx.getDoc !== "function") {
        if ((tentativa || 0) < 20) setTimeout(() => this.carregarNuvem((tentativa || 0) + 1), 500);
        return;
      }
      let snap;
      try {
        snap = await fx.getDoc(fx.doc(db, NUVEM.colecao, NUVEM.doc));
      } catch (e) {
        console.warn("[Acompanhamento de obra] Não foi possível ler da nuvem:", e);
        return;
      }
      const existe = snap && (typeof snap.exists === "function" ? snap.exists() : !!snap.exists);
      const data = existe && typeof snap.data === "function" ? snap.data() : null;
      const local = this.localAt();
      if (data && Array.isArray(data.linhas)) {
        const nuvemAt = Number(data.savedAt) || 0;
        if (nuvemAt >= local || !this.linhas.length) {
          this.linhas = data.linhas.filter((r) => r && r.id);
          this.gravarLocal(nuvemAt);
        } else {
          this.salvarNuvem(local);
        }
      } else if (!existe) {
        if (!this.linhas.length) {
          this.linhas = CARGA_INICIAL.map((r) => Object.assign({}, r));
          this.completarNomes();
        }
        if (this.podeEditar()) this.gravar();
      }
      if (!document.getElementById("aobra-busca")) this.render();
    },

    cmpId(a, b) {
      const na = Number(a && a.id);
      const nb = Number(b && b.id);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String((a && a.id) || "").localeCompare(String((b && b.id) || ""), "pt-BR", { numeric: true });
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
      const campo = this.ordem || "id";
      const dir = this.direcao === "desc" ? -1 : 1;
      return this.linhas.slice().sort((a, b) => {
        if (campo === "id") return this.cmpId(a, b) * dir;
        const cmp = String(a[campo] || "").localeCompare(String(b[campo] || ""), "pt-BR");
        return cmp * dir || this.cmpId(a, b);
      });
    },

    init() {
      this.ordem = "id";
      this.direcao = "asc";
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
      const blocoAgora = atual
        ? `<section class="aobra-bloco-agora" aria-label="Linha do tempo que está valendo">
            <div class="aobra-bloco-topo">
              <span class="aobra-selo aobra-selo-agora">Valendo agora</span>
              <span class="aobra-quando">${this.esc(this.textoInserido(atual.inseridoEm))}</span>
            </div>
            <div class="aobra-tempo" aria-label="Linha do tempo das previsões">${marcos}</div>
          </section>
          ${this.htmlHistorico(atual)}`
        : `<p class="aobra-quando">A data de inserção fica registrada ao salvar.</p>
          <div class="aobra-tempo" aria-label="Linha do tempo das previsões">${marcos}</div>`;
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
            ${blocoAgora}
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
      const rascunho = { id: id, nome: this.nomeDe(id) };
      DATAS.forEach((c) => { rascunho[c.key] = ler(c.key); });
      if (this.editando) {
        const idx = this.linhas.findIndex((r) => String(r.id) === String(this.editando));
        const anterior = idx >= 0 ? this.linhas[idx] : null;
        const linha = this.aplicarVersao(anterior, rascunho);
        if (idx >= 0) this.linhas[idx] = linha;
        else this.linhas.push(linha);
      } else this.linhas.push(this.aplicarVersao(null, rascunho));
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
