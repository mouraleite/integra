// BAIXA DE BOLETO NO BANCO
// O operador marca os boletos em "Boletos do Contrato", anexa o comprovante da baixa
// (print ou PDF do banco) e o sistema confere o documento. Com a baixa conferida,
// o Integra libera gerar outro boleto para aquelas parcelas.
// Registro: Firestore "boletos_baixa_banco" (um documento por boleto baixado).

const BoletoBaixa = {
  COL: "boletos_baixa_banco",
  TESSERACT_URL: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  _cache: {},      // titulo -> [registros]
  _carregando: {}, // titulo -> promise

  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },

  digitos(s) { return String(s || "").replace(/\D/g, ""); },
  semZeros(s) { return this.digitos(s).replace(/^0+/, ""); },

  /** Itaú (341): nosso número = carteira-livre do campo 1 + 6 primeiros do campo 2. */
  nossoNumeroDaLinha(linha) {
    const d = this.digitos(linha);
    if (d.length < 47 || d.slice(0, 3) !== "341") return "";
    return d.slice(7, 9) + d.slice(10, 16);
  },

  valorDaLinha(linha) {
    const d = this.digitos(linha);
    if (d.length < 47) return null;
    const c = parseInt(d.slice(37, 47), 10);
    return Number.isFinite(c) && c > 0 ? c / 100 : null;
  },

  /** "Seu número" do Itaú: título com 6 dígitos + parcela com 4 (ex.: 0142570371). */
  seuNumero(titulo, parcela) {
    return String(this.digitos(titulo)).padStart(6, "0") + String(this.digitos(parcela)).padStart(4, "0");
  },

  fmtValor(v) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v) || 0);
  },

  // ---------- registros ----------

  async carregar(titulo, forcar) {
    const t = String(titulo || "").trim();
    if (!t || !window.DadosCobranca) return [];
    if (!forcar && this._cache[t]) return this._cache[t];
    if (this._carregando[t]) return this._carregando[t];
    this._carregando[t] = window.DadosCobranca.tabela(this.COL).listar({ filtros: [["titulo", "eq", t]] })
      .then((lista) => {
        this._cache[t] = lista;
        return lista;
      })
      .catch((e) => { console.warn("[BoletoBaixa] carregar", e); return this._cache[t] || []; })
      .finally(() => { delete this._carregando[t]; });
    return this._carregando[t];
  },

  /** Baixa conferida para esta parcela e este boleto (mesma linha digitável). */
  temBaixa(titulo, installmentId, linha) {
    const lista = this._cache[String(titulo || "").trim()] || [];
    const d = this.digitos(linha);
    return lista.find((r) => {
      if (!(r.parcelas || []).map(String).includes(String(installmentId))) return false;
      return !d || !r.linha || this.digitos(r.linha) === d;
    }) || null;
  },

  // ---------- tela "Boletos do Contrato" ----------

  /** Chamado por loadCustomerBoletos depois de montar a tabela. */
  async prepararAba(container, titulo, customerId) {
    this._titulo = String(titulo || "");
    this._customerId = String(customerId || "");
    this._container = container;
    await this.carregar(this._titulo, true);
    this.pintarAba();
  },

  /** Chamado quando a linha digitável de uma parcela chega do Sienge. */
  linhaPronta(installmentId, linha, vencStr) {
    const tr = document.getElementById("row-inst-" + installmentId);
    if (!tr) return;
    tr.setAttribute("data-linha", this.digitos(linha));
    if (vencStr) tr.setAttribute("data-venc", vencStr);
    this.pintarAba();
  },

  pintarAba() {
    const box = this._container;
    if (!box || !document.body.contains(box)) return;
    box.querySelectorAll("tbody tr[id^='row-inst-']").forEach((tr) => {
      const instId = tr.id.replace("row-inst-", "");
      const linha = tr.getAttribute("data-linha") || "";
      const chk = tr.querySelector(".bolbx-chk");
      const tag = tr.querySelector(".bolbx-tag");
      const reg = linha ? this.temBaixa(this._titulo, instId, linha) : null;
      if (chk) {
        chk.disabled = !linha || !!reg;
        chk.title = reg ? "Baixa já informada" : (linha ? "Marcar para informar a baixa no banco" : "Aguardando o boleto no Sienge");
        if (chk.disabled) chk.checked = false;
      }
      if (tag) {
        tag.innerHTML = reg
          ? `<span class="bolbx-badge" title="Informada por ${this.esc(reg.informado_por_nome || reg.informado_por_email || "")} em ${this.esc(reg.informado_em ? new Date(reg.informado_em).toLocaleString("pt-BR") : "")}">Baixa informada</span>`
          : "";
      }
      // Boleto baixado no banco: some o Ver/Download do arquivo antigo.
      if (reg) {
        const acoes = document.getElementById("actions-col-" + instId);
        if (acoes && !acoes.querySelector(".bolbx-sem-arquivo")) {
          acoes.innerHTML = `<span class="bolbx-sem-arquivo" title="Gere um boleto novo na Simulação de Vencidas">Boleto baixado no banco</span>`;
        }
        const st = document.getElementById("status-badge-" + instId);
        if (st && !st.querySelector(".bolbx-st")) {
          st.innerHTML = `<span class="bolbx-st">Baixado no banco</span>`;
        }
      }
    });
    this.atualizarBotao();
  },

  /** Seleção por parcela. A conferência com o comprovante é feita depois, pelo boleto de cada parcela. */
  aoMarcar() {
    this.atualizarBotao();
  },

  atualizarBotao() {
    const box = this._container;
    if (!box) return;
    const btn = box.querySelector(".bolbx-btn");
    if (!btn) return;
    const n = box.querySelectorAll(".bolbx-chk:checked").length;
    btn.disabled = n === 0;
    btn.innerHTML = `<i data-lucide="file-check" style="width:14px;height:14px;"></i> Informar baixa no banco${n ? " (" + n + ")" : ""}`;
    if (window.lucide) lucide.createIcons();
  },

  /** Boletos marcados, agrupados pela linha digitável. */
  grupos() {
    const box = this._container;
    const mapa = new Map();
    if (!box) return [];
    box.querySelectorAll(".bolbx-chk:checked").forEach((c) => {
      const tr = c.closest("tr");
      const linha = tr.getAttribute("data-linha") || "";
      if (!mapa.has(linha)) {
        mapa.set(linha, {
          linha,
          nossoNumero: this.nossoNumeroDaLinha(linha),
          valor: this.valorDaLinha(linha),
          venc: tr.getAttribute("data-venc") || "",
          parcelas: []
        });
      }
      mapa.get(linha).parcelas.push({
        installmentId: tr.id.replace("row-inst-", ""),
        numero: tr.getAttribute("data-inst-num") || tr.id.replace("row-inst-", "")
      });
    });
    // Boleto juntado: parcelas do mesmo boleto que não foram marcadas (só para avisar).
    mapa.forEach((g) => {
      const marcadas = new Set(g.parcelas.map((p) => p.installmentId));
      g.naoMarcadas = [];
      if (!g.linha) return;
      box.querySelectorAll(`tbody tr[data-linha="${g.linha}"]`).forEach((tr) => {
        const id = tr.id.replace("row-inst-", "");
        if (!marcadas.has(id)) g.naoMarcadas.push(tr.getAttribute("data-inst-num") || id);
      });
    });
    return Array.from(mapa.values());
  },

  abrir() {
    const grupos = this.grupos();
    if (!grupos.length) { alert("Marque os boletos que tiveram baixa no banco."); return; }
    this._grupos = grupos;
    this._arquivo = null;
    const linhas = grupos.map((g) => `<tr>
        <td>${this.esc(g.parcelas.map((p) => p.numero).join(", "))}</td>
        <td>${this.esc(g.nossoNumero || "—")}</td>
        <td>${this.esc(g.venc || "—")}</td>
        <td class="is-right">${g.valor != null ? this.fmtValor(g.valor) : "—"}</td>
      </tr>`).join("");
    const juntados = grupos.filter((g) => g.naoMarcadas && g.naoMarcadas.length);
    const avisoJuntado = juntados.length
      ? `<div class="bolbx-aviso">${juntados.map((g) => `O boleto ${this.esc(g.nossoNumero || "")} também cobra a parcela ${this.esc(g.naoMarcadas.join(", "))}, que não foi marcada. A baixa no banco cancela o boleto inteiro; marque essa parcela também se quiser liberar um boleto novo para ela.`).join("<br>")}</div>`
      : "";
    const html = `<div class="tagsol-overlay" id="bolbx-overlay">
      <div class="tagsol-box" style="width:640px;">
        <div class="tagsol-head">
          <h3><i data-lucide="file-check" style="width:20px;"></i> Informar baixa no banco</h3>
          <button type="button" class="btn btn-fechar" onclick="BoletoBaixa.fechar()">Fechar</button>
        </div>
        <p class="bolbx-txt">Título <b>${this.esc(this._titulo)}</b>. Boletos marcados:</p>
        <div class="cc-scroll" style="max-height:180px;margin-bottom:12px;"><table class="cc-table">
          <colgroup><col><col style="width:120px"><col style="width:100px"><col style="width:110px"></colgroup>
          <thead><tr><th>Parcelas</th><th>Nosso número</th><th>Vencimento</th><th class="is-right">Valor</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table></div>
        ${avisoJuntado}
        <label class="bolbx-label">Comprovante da baixa no banco (print ou PDF)</label>
        <input type="file" id="bolbx-arquivo" accept="image/png,image/jpeg,application/pdf" onchange="BoletoBaixa.lerArquivo(this)">
        <div id="bolbx-resultado" class="bolbx-resultado"></div>
        <div class="tagsol-acoes" style="margin-top:12px;">
          <button type="button" class="btn btn-cancel" onclick="BoletoBaixa.fechar()">Cancelar</button>
          <button type="button" class="btn btn-primary" id="bolbx-confirmar" disabled onclick="BoletoBaixa.confirmar()"><i data-lucide="check" style="width:15px;"></i> Registrar baixa</button>
        </div>
      </div>
    </div>`;
    this.fechar();
    document.body.insertAdjacentHTML("beforeend", html);
    if (window.lucide) lucide.createIcons();
  },

  fechar() {
    const o = document.getElementById("bolbx-overlay");
    if (o) o.remove();
  },

  // ---------- leitura do comprovante ----------

  carregarTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (this._tessVoo) return this._tessVoo;
    this._tessVoo = new Promise((ok, falha) => {
      const sc = document.createElement("script");
      sc.src = this.TESSERACT_URL;
      sc.onload = () => ok();
      sc.onerror = () => { this._tessVoo = null; falha(new Error("Leitura de imagem indisponível")); };
      document.head.appendChild(sc);
    });
    return this._tessVoo;
  },

  async ocrImagem(fonte) {
    await this.carregarTesseract();
    const worker = await Tesseract.createWorker("por", 1);
    try {
      const { data } = await worker.recognize(fonte);
      return String((data && data.text) || "");
    } finally {
      try { await worker.terminate(); } catch (e) {}
    }
  },

  async textoDoArquivo(file) {
    const ehPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name);
    if (!ehPdf) {
      // Print pequeno: amplia antes do OCR para ler os números da tabela.
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((ok, falha) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = () => falha(new Error("Imagem inválida"));
          i.src = url;
        });
        const escala = img.width < 2000 ? 2 : 1;
        const canvas = document.createElement("canvas");
        canvas.width = img.width * escala;
        canvas.height = img.height * escala;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return await this.ocrImagem(canvas);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const lib = window["pdfjs-dist/build/pdf"] || window.pdfjsLib;
    if (!lib) throw new Error("Leitor de PDF indisponível");
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    let texto = "";
    for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      texto += tc.items.map((it) => it.str).join(" ") + "\n";
    }
    if (texto.replace(/\s/g, "").length > 30) return texto;
    // PDF só com imagem: lê pelo OCR.
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    return await this.ocrImagem(canvas);
  },

  /** Confere o texto do comprovante contra os boletos marcados. */
  conferir(texto, grupos, titulo) {
    const norm = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const numeros = (String(texto || "").match(/\d[\d.\-\/]{0,20}\d|\d/g) || [])
      .map((t) => this.semZeros(t)).filter(Boolean);
    const temNumero = (alvo) => {
      const a = this.semZeros(alvo);
      return !!a && numeros.some((n) => n === a || (n.length > a.length && n.indexOf(a) >= 0 && a.length >= 7));
    };
    const valores = (String(texto || "").match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [])
      .map((v) => Number(v.replace(/\./g, "").replace(",", ".")));
    const temValor = (v) => v != null && valores.some((x) => Math.abs(x - v) < 0.01);

    const ehBaixa = /baix(a|ar|ado)|cancel/.test(norm);
    const concluida = /sucesso|realizad|efetivad|conclu/.test(norm);
    const resultado = grupos.map((g) => {
      const porNosso = g.nossoNumero ? temNumero(g.nossoNumero) : false;
      const porSeu = g.parcelas.some((p) => temNumero(this.seuNumero(titulo, p.numero)));
      const valorOk = temValor(g.valor);
      const ok = porNosso || (porSeu && valorOk);
      let como = "";
      if (porNosso) como = "nosso número " + g.nossoNumero;
      else if (porSeu && valorOk) como = "seu número e valor";
      return { grupo: g, ok, como, porNosso, porSeu, valorOk };
    });
    return { ehBaixa, concluida, resultado, ok: ehBaixa && concluida && resultado.every((r) => r.ok) };
  },

  async lerArquivo(input) {
    const file = input && input.files && input.files[0];
    const out = document.getElementById("bolbx-resultado");
    const btn = document.getElementById("bolbx-confirmar");
    if (btn) btn.disabled = true;
    this._arquivo = null;
    this._conferencia = null;
    if (!file || !out) return;
    if (file.size > 10 * 1024 * 1024) { out.innerHTML = `<div class="bolbx-erro">Arquivo acima de 10 MB.</div>`; return; }
    out.innerHTML = `<div class="bolbx-lendo"><span class="loading-spinner" style="width:14px;height:14px;border:2px solid #105436;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite;"></span> Lendo o comprovante… (pode levar alguns segundos)</div>`;
    try {
      const texto = await this.textoDoArquivo(file);
      const c = this.conferir(texto, this._grupos || [], this._titulo);
      this._arquivo = file;
      this._conferencia = c;
      const linhas = c.resultado.map((r) => `<li class="${r.ok ? "is-ok" : "is-falha"}">
          Parcelas ${this.esc(r.grupo.parcelas.map((p) => p.numero).join(", "))}:
          ${r.ok ? "encontrado no comprovante (" + this.esc(r.como) + ")" : "não encontrado no comprovante"}
        </li>`).join("");
      const avisos = [];
      if (!c.ehBaixa) avisos.push("O documento não mostra uma operação de baixa ou cancelamento.");
      if (!c.concluida) avisos.push("O documento não mostra que a operação foi concluída (ex.: \"Operação solicitada com sucesso\").");
      out.innerHTML = `<ul class="bolbx-lista">${linhas}</ul>`
        + (avisos.length ? `<div class="bolbx-erro">${avisos.map((a) => this.esc(a)).join("<br>")}</div>` : "")
        + (c.ok
          ? `<div class="bolbx-ok">Comprovante conferido. Clique em Registrar baixa.</div>`
          : `<div class="bolbx-erro">O comprovante não confirma a baixa de todos os boletos marcados. Confira se é o print certo (com o nosso número visível) ou desmarque o boleto que não foi baixado.</div>`);
      if (btn) btn.disabled = !c.ok;
    } catch (e) {
      console.error("[BoletoBaixa] leitura", e);
      out.innerHTML = `<div class="bolbx-erro">Não foi possível ler o arquivo: ${this.esc(e && e.message ? e.message : e)}</div>`;
    }
  },

  // O comprovante continua no Storage do Firebase (migração dos arquivos é da Fase 4); o registro vai para o Supabase.
  async salvarArquivo(file) {
    try {
      const fc = window.firebaseCollections;
      if (!window.firebaseStorage || !fc || !fc.ref || !fc.uploadBytes) return "";
      const nomeSeguro = String(file.name || "comprovante").replace(/[^\w.\-]+/g, "_").slice(-60);
      const caminho = `boletos_baixa_banco/${this.digitos(this._titulo)}/${Date.now()}_${nomeSeguro}`;
      await fc.uploadBytes(fc.ref(window.firebaseStorage, caminho), file, { contentType: file.type || "application/octet-stream" });
      return caminho;
    } catch (e) {
      console.warn("[BoletoBaixa] comprovante não foi guardado", e);
      return "";
    }
  },

  async confirmar() {
    const c = this._conferencia;
    if (!c || !c.ok || !this._arquivo) return;
    const btn = document.getElementById("bolbx-confirmar");
    if (btn) { btn.disabled = true; btn.textContent = "Registrando..."; }
    try {
      const u = (window.AppState && AppState.currentUser) || {};
      const nome = typeof window.crmNomeReal === "function" ? window.crmNomeReal() : (u.name || "");
      const arquivo = await this.salvarArquivo(this._arquivo);
      const tab = window.DadosCobranca.tabela(this.COL);
      const agora = new Date().toISOString();
      for (const r of c.resultado) {
        await tab.criar({
          titulo: this._titulo,
          customerId: this._customerId,
          parcelas: r.grupo.parcelas.map((p) => String(p.installmentId)),
          parcelas_numero: r.grupo.parcelas.map((p) => String(p.numero)),
          linha: r.grupo.linha,
          nosso_numero: r.grupo.nossoNumero || "",
          valor: r.grupo.valor,
          vencimento: r.grupo.venc || "",
          conferido_por: r.como,
          comprovante: arquivo,
          comprovante_nome: String(this._arquivo.name || ""),
          informado_por_email: String(u.email || "").toLowerCase(),
          informado_por_nome: String(nome || ""),
          informado_em: agora
        });
      }
      await this.carregar(this._titulo, true);
      this.fechar();
      this.pintarAba();
      if (typeof window.recalcularSimulador === "function") {
        try { window.recalcularSimulador(); } catch (e) {}
      }
      alert("Baixa registrada. O Integra já pode gerar um novo boleto para essas parcelas na Simulação de Vencidas.");
    } catch (e) {
      console.error("[BoletoBaixa] registrar", e);
      alert("Não foi possível registrar a baixa: " + (e && e.message ? e.message : e));
      if (btn) { btn.disabled = false; btn.textContent = "Registrar baixa"; }
    }
  }
};

window.BoletoBaixa = BoletoBaixa;

(function cssBoletoBaixa() {
  if (document.getElementById("bolbx-css")) return;
  const st = document.createElement("style");
  st.id = "bolbx-css";
  st.textContent = `
    .bolbx-bar { display:flex; justify-content:flex-end; margin-top:8px; }
    .bolbx-bar .btn { height:34px; display:inline-flex; align-items:center; gap:6px; }
    .bolbx-badge { display:inline-block; margin-left:6px; padding:2px 6px; border-radius:4px; background:#e0f2fe; color:#075985; border:1px solid #bae6fd; font-size:0.7rem; font-weight:700; white-space:nowrap; }
    .bolbx-txt { font-size:0.85rem; color:#334155; margin:0 0 8px; }
    .bolbx-label { display:block; font-size:0.7rem; font-weight:700; color:#6d8c7c; text-transform:uppercase; margin-bottom:6px; }
    .bolbx-resultado { margin-top:10px; font-size:0.82rem; }
    .bolbx-lista { margin:0 0 8px; padding-left:18px; }
    .bolbx-lista li.is-ok { color:#105436; }
    .bolbx-lista li.is-falha { color:#b91c1c; font-weight:600; }
    .bolbx-ok { background:#e7f6ee; color:#105436; border-radius:6px; padding:8px 10px; }
    .bolbx-erro { background:#fee2e2; color:#991b1b; border-radius:6px; padding:8px 10px; margin-top:6px; }
    .bolbx-lendo { display:flex; align-items:center; gap:8px; color:#475569; }
    .bolbx-sem-arquivo { font-size:0.75rem; color:#64748b; font-style:italic; white-space:nowrap; }
    .bolbx-st { display:inline-block; padding:2px 6px; border-radius:4px; background:#e0f2fe; color:#075985; border:1px solid #bae6fd; font-size:0.75rem; font-weight:700; white-space:nowrap; }
    .bolbx-aviso { background:#fef3c7; color:#92400e; border-radius:6px; padding:8px 10px; margin-bottom:12px; font-size:0.8rem; }
  `;
  document.head.appendChild(st);
})();
