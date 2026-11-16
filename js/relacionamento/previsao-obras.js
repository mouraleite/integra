/* Relacionamento > Previsão de obras: versão resumida do Acompanhamento de obra da Engenharia.
   Só leitura. Mostra a última previsão de término de obra e de TVO (colunas "Cliente" da Engenharia)
   e avisa quando essas duas datas mudaram, com as datas que valiam antes. */
(function () {
  const NUVEM = { colecao: "engenharia_acompanhamento", doc: "obras" };
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  const PrevisaoObrasApp = {
    linhas: [],
    estado: "inicio",
    erro: "",

    esc(v) {
      return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    },

    iso(v) {
      const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[0] : "";
    },

    dataBr(iso) {
      const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + "/" + m[2] + "/" + m[1] : "—";
    },

    mesAno(iso) {
      const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
      return m ? MESES[Number(m[2]) - 1] + "/" + m[1] : "—";
    },

    quando(ms) {
      const d = new Date(Number(ms));
      if (!Number(ms) || Number.isNaN(d.getTime())) return "";
      const p = (x) => String(x).padStart(2, "0");
      return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
    },

    /** "faltam 8 meses", "este mês" ou "previsto para mês passado". */
    prazo(iso) {
      const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
      if (!m) return "";
      const hoje = new Date();
      const meses = (Number(m[1]) - hoje.getFullYear()) * 12 + (Number(m[2]) - 1 - hoje.getMonth());
      if (meses === 0) return "este mês";
      if (meses < 0) return "previsão já passou";
      if (meses === 1) return "falta 1 mês";
      return "faltam " + meses + " meses";
    },

    /**
     * Última vez em que término de obra (cliente) ou TVO (tvoCliente) mudou.
     * historico guarda as versões anteriores, da mais antiga para a mais nova; a linha é a versão atual.
     */
    ultimaMudanca(linha) {
      const versoes = (Array.isArray(linha.historico) ? linha.historico : [])
        .map((h) => ({ em: Number(h.em) || 0, cliente: this.iso(h.cliente), tvo: this.iso(h.tvoCliente) }));
      versoes.push({ em: Number(linha.inseridoEm) || 0, cliente: this.iso(linha.cliente), tvo: this.iso(linha.tvoCliente) });
      for (let i = versoes.length - 1; i > 0; i--) {
        const atual = versoes[i];
        const antes = versoes[i - 1];
        if (atual.cliente !== antes.cliente || atual.tvo !== antes.tvo) {
          return { em: atual.em, cliente: antes.cliente, tvo: antes.tvo, mudouObra: atual.cliente !== antes.cliente, mudouTvo: atual.tvo !== antes.tvo };
        }
      }
      return null;
    },

    rotulo(linha) {
      const nome = String(linha.nome || "").trim();
      const partes = nome.split(/\s+-\s+/);
      if (partes.length >= 2) return { cidade: partes[0], nome: partes.slice(1).join(" - ") };
      return { cidade: "", nome: nome || String(linha.id) };
    },

    async carregar() {
      this.estado = "carregando";
      this.render();
      const fx = window.firebaseCollections;
      const db = window.firebaseDb;
      if (!fx || !db || typeof fx.getDoc !== "function") {
        this.estado = "erro";
        this.erro = "A conexão com o banco ainda não está pronta. Tente abrir a tela de novo.";
        this.render();
        return;
      }
      try {
        const snap = await fx.getDoc(fx.doc(db, NUVEM.colecao, NUVEM.doc));
        const existe = snap && (typeof snap.exists === "function" ? snap.exists() : !!snap.exists);
        const data = existe ? (snap.data() || {}) : {};
        this.linhas = (Array.isArray(data.linhas) ? data.linhas : [])
          .filter((r) => r && r.id && (this.iso(r.cliente) || this.iso(r.tvoCliente)))
          .sort((a, b) => (this.iso(a.cliente) || "9999").localeCompare(this.iso(b.cliente) || "9999")
            || String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }));
        this.estado = "pronto";
      } catch (e) {
        this.estado = "erro";
        this.erro = "Não consegui ler as previsões da Engenharia: " + ((e && e.message) || e);
      }
      this.render();
    },

    marco(n, titulo, iso, mudou) {
      return `
        <div class="pobra-marco${mudou ? " is-mudou" : ""}">
          <span class="pobra-marco-n">${n}</span>
          <span class="pobra-marco-titulo">${this.esc(titulo)}</span>
          <span class="pobra-marco-mes">${this.esc(this.mesAno(iso))}</span>
          <span class="pobra-marco-prazo">${this.esc(this.prazo(iso))}</span>
        </div>`;
    },

    cartao(linha) {
      const r = this.rotulo(linha);
      const mud = this.ultimaMudanca(linha);
      const obra = this.iso(linha.cliente);
      const tvo = this.iso(linha.tvoCliente);
      const alerta = mud ? `
        <div class="pobra-alerta" role="note">
          <i data-lucide="alert-triangle"></i>
          <div>
            <strong>Previsões alteradas${mud.em ? " em " + this.esc(this.quando(mud.em)) : ""}.</strong>
            <span>Antes: término de obra ${this.esc(this.dataBr(mud.cliente))} e TVO ${this.esc(this.dataBr(mud.tvo))}.</span>
          </div>
        </div>` : "";
      return `
        <article class="pobra-card">
          <header class="pobra-card-topo">
            <span class="pobra-id">${this.esc(linha.id)}</span>
            <div class="pobra-nome">
              <strong title="${this.esc(r.nome)}">${this.esc(r.nome)}</strong>
              ${r.cidade ? `<span>${this.esc(r.cidade)}</span>` : ""}
            </div>
          </header>
          <div class="pobra-tempo">
            ${this.marco(1, "Previsão término de obra", obra, mud && mud.mudouObra)}
            ${this.marco(2, "Previsão TVO", tvo, mud && mud.mudouTvo)}
          </div>
          ${alerta}
        </article>`;
    },

    filtro: "TODOS",
    busca: "",

    corpoHtml() {
      if (this.estado === "carregando" || this.estado === "inicio") {
        return `<p class="pobra-vazio">Carregando as previsões…</p>`;
      }
      if (this.estado === "erro") return `<p class="pobra-vazio is-erro">${this.esc(this.erro)}</p>`;
      if (!this.linhas.length) return `<p class="pobra-vazio">Nenhuma previsão cadastrada pela Engenharia.</p>`;
      const norm = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const termo = norm(this.busca).trim();
      let lista = this.filtro === "TODOS" ? this.linhas : this.linhas.filter((l) => String(l.id) === this.filtro);
      if (termo) lista = lista.filter((l) => norm(l.id + " " + (l.nome || "")).indexOf(termo) >= 0);
      if (!lista.length) return `<p class="pobra-vazio">Nenhum empreendimento encontrado.</p>`;
      return `<div class="pobra-grade">${lista.map((l) => this.cartao(l)).join("")}</div>`;
    },

    filtroHtml() {
      if (this.estado !== "pronto" || !this.linhas.length || !window.MlSelectUnico) return "";
      const itens = this.linhas.slice()
        .sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR", { numeric: true }))
        .map((l) => ({ id: String(l.id), label: String(l.nome || l.id) }));
      if (this.filtro !== "TODOS" && !itens.some((i) => i.id === this.filtro)) this.filtro = "TODOS";
      return `<div class="pobra-filtro">${MlSelectUnico.html({
        id: "pobra-emp",
        label: "Empreendimento",
        items: itens,
        selectedId: this.filtro,
        todos: { id: "TODOS", label: "Todos os empreendimentos" },
        placeholder: "Buscar empreendimento: ID, cidade ou nome…",
        largura: "420px"
      })}</div>`;
    },

    render() {
      const root = document.getElementById("relacionamento-obras-root");
      if (!root) return;
      const corpo = `<div id="pobra-corpo">${this.corpoHtml()}</div>`;
      root.innerHTML = `
        <div class="cc-page pobra-page">
          ${this.filtroHtml()}
          <section class="pobra-legenda" aria-label="O que significa cada data">
            <div class="pobra-legenda-item">
              <span class="pobra-marco-n">1</span>
              <p><strong>Término de obra — Atestado de Conclusão de Obras (Sabesp).</strong>
              A Sabesp emite esse documento depois de vistoriar e aceitar as redes de água e esgoto. Ele confirma que o sistema está apto a operar e que as ligações podem ser liberadas. É o primeiro marco, porque a Prefeitura precisa dele para emitir o TVO.</p>
            </div>
            <div class="pobra-legenda-item">
              <span class="pobra-marco-n">2</span>
              <p><strong>TVO — Termo de Verificação de Obras (Prefeitura Municipal).</strong>
              Depois do aceite da Sabesp e das demais concessionárias, a Prefeitura vistoria a infraestrutura do loteamento e emite o TVO, atestando que as obras foram executadas conforme o projeto aprovado. Com o TVO emitido, o cliente já pode protocolar a aprovação do projeto da casa na Prefeitura e começar a construir.</p>
            </div>
          </section>
          ${corpo}
        </div>`;
      if (document.getElementById("pobra-emp") && window.MlSelectUnico) {
        const repintar = () => {
          const alvo = document.getElementById("pobra-corpo");
          if (alvo) alvo.innerHTML = this.corpoHtml();
          if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
        };
        MlSelectUnico.bind("pobra-emp", {
          onSelect: (id) => {
            this.filtro = String(id || "TODOS");
            this.busca = "";
            // "Todos" deixa o campo vazio, pronto para buscar.
            if (this.filtro === "TODOS") {
              const inp = document.getElementById("pobra-emp-input");
              if (inp) { inp.value = ""; inp.title = ""; }
            }
            repintar();
          }
        });
        const input = document.getElementById("pobra-emp-input");
        if (input) {
          // Campo de busca: os cartões filtram enquanto a pessoa digita.
          if (this.filtro === "TODOS") input.value = this.busca || "";
          input.addEventListener("input", () => {
            this.filtro = "TODOS";
            this.busca = input.value;
            repintar();
          });
          // Ao sair do campo sem escolher na lista, mantém o que foi digitado (o componente voltaria para "Todos").
          input.addEventListener("blur", () => setTimeout(() => {
            if (this.filtro === "TODOS") input.value = this.busca || "";
          }, 200));
        }
      }
      if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
    },

    init() {
      this.carregar();
    }
  };

  window.PrevisaoObrasApp = PrevisaoObrasApp;
  document.addEventListener("tabChanged", (e) => {
    if (e.detail === "relacionamento_obras") PrevisaoObrasApp.init();
  });
})();
