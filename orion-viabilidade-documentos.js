/* Órion (transição) › Viabilidades › aba Documentos — vinda do ML Órion (DocumentsTab, "Documentos do Projeto (GED)"):
 * anexar arquivo, baixar, renomear e excluir, por fase da viabilidade.
 * Arquivos no armazenamento do Integra (orion/viabilidades/<viabilidade>/fase_<n>/…); a lista fica na coleção nova
 * orion_viabilidade_documentos (um documento por viabilidade), separada da viabilidade para não conflitar com a edição das premissas.
 * Os documentos que estavam no SharePoint do Órion não vêm automaticamente: anexe aqui os que forem necessários. */
Object.assign(window.OrionViabilidadesApp, {
  COL_DOCS: "orion_viabilidade_documentos",
  docsCache: {},

  docsLista(id) { return this.docsCache[id] || null; },

  async docsCarregar(id) {
    const fc = window.firebaseCollections;
    try {
      const s = await fc.getDoc(fc.doc(window.firebaseDb, this.COL_DOCS, String(id)));
      this.docsCache[id] = s.exists() ? (s.data().itens || []) : [];
    } catch (e) { this.docsCache[id] = []; this.docsErro = e.message || String(e); }
    this.render();
  },

  /** Altera a lista em transação (duas pessoas anexando ao mesmo tempo não se apagam). */
  async docsGravar(id, fn) {
    const fc = window.firebaseCollections;
    const ref = fc.doc(window.firebaseDb, this.COL_DOCS, String(id));
    const quem = (window.OrionStore && window.OrionStore.usuario()) || "";
    let nova = null;
    await fc.runTransaction(window.firebaseDb, async (tx) => {
      const s = await tx.get(ref);
      const atual = s.exists() ? (s.data().itens || []) : [];
      nova = fn(atual.slice());
      tx.set(ref, { viabilidade: String(id), itens: nova, alterado_por: quem, alterado_em: new Date().toISOString() });
    });
    this.docsCache[id] = nova;
  },

  async docsAnexar(input) {
    const files = [...(input.files || [])];
    input.value = "";
    const d = this.aberto && this.aberto.doc;
    if (!d || !files.length) return;
    const fc = window.firebaseCollections, st = window.firebaseStorage;
    if (!st || !fc.ref || !fc.uploadBytes || !fc.getDownloadURL) { this.docsErro = "O armazenamento de arquivos do Integra não está disponível nesta página."; return this.render(); }
    const fase = this.aberto.fase || 0;
    this.docsEnviando = true; this.docsErro = ""; this.render();
    try {
      for (const f of files) {
        if (f.size > 25 * 1024 * 1024) throw new Error(`O arquivo ${f.name} tem mais de 25 MB.`);
        const idArq = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const caminho = `orion/viabilidades/${d._id}/fase_${fase}/${idArq}_${f.name.replace(/[^\w.\- ]+/g, "_")}`;
        const r = fc.ref(st, caminho);
        await fc.uploadBytes(r, f, { contentType: f.type || "application/octet-stream" });
        const url = await fc.getDownloadURL(r);
        const quem = (window.OrionStore && window.OrionStore.usuario()) || "";
        await this.docsGravar(d._id, (l) => l.concat([{ id: idArq, nome: f.name, caminho, url, tamanho: f.size, tipo: f.type || "", fase, em: new Date().toISOString(), por: quem }]));
      }
      this.docsAviso = files.length === 1 ? "Documento anexado." : `${files.length} documentos anexados.`;
    } catch (e) { this.docsErro = e.message || String(e); }
    this.docsEnviando = false;
    this.render();
  },

  async docsRenomear(idArq) {
    const d = this.aberto && this.aberto.doc; if (!d) return;
    const x = (this.docsLista(d._id) || []).find((y) => y.id === idArq); if (!x) return;
    const novo = window.prompt("Novo nome do documento:", x.nome);
    if (!novo || novo.trim() === x.nome) return;
    try { await this.docsGravar(d._id, (l) => l.map((y) => (y.id === idArq ? Object.assign({}, y, { nome: novo.trim() }) : y))); this.docsAviso = "Documento renomeado."; } catch (e) { this.docsErro = e.message || String(e); }
    this.render();
  },

  async docsExcluir(idArq) {
    const d = this.aberto && this.aberto.doc; if (!d) return;
    const x = (this.docsLista(d._id) || []).find((y) => y.id === idArq); if (!x) return;
    if (!window.confirm(`Excluir o documento "${x.nome}"? O arquivo é apagado do armazenamento e não pode ser recuperado.`)) return;
    const fc = window.firebaseCollections, st = window.firebaseStorage;
    try {
      await this.docsGravar(d._id, (l) => l.filter((y) => y.id !== idArq));
      if (st && fc.deleteObject && x.caminho) { try { await fc.deleteObject(fc.ref(st, x.caminho)); } catch (e) { /* já removido da lista; o arquivo pode já não existir */ } }
      this.docsAviso = "Documento excluído.";
    } catch (e) { this.docsErro = e.message || String(e); }
    this.render();
  },

  htmlDocumentos() {
    const d = this.aberto && this.aberto.doc;
    if (!d) return "";
    const lista = this.docsLista(d._id);
    if (!lista) { this.docsCarregar(d._id); return `<div style="padding:20px;color:#64748b">Carregando documentos…</div>`; }
    const fases = (this.fasesDe ? this.fasesDe(d) : []) || [];
    const fase = this.aberto.fase || 0;
    const daFase = lista.filter((x) => Number(x.fase || 0) === Number(fase)).sort((a, b) => String(b.em).localeCompare(String(a.em)));
    const pode = this.podeEditar ? this.podeEditar() : false;
    const tam = (n) => (n >= 1048576 ? (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
    const data = (s) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
    const sel = fases.length > 1 ? `<div><label class="ml-emp-filter-label">Fase</label><select class="idx-select" style="height:40px" onchange="OrionViabilidadesApp.aberto.fase=Number(this.value);OrionViabilidadesApp.render()">${fases.map((x, i) => `<option value="${i}" ${i === fase ? "selected" : ""}>${this.esc(x.nome || x.name || "Fase " + (i + 1))}</option>`).join("")}</select></div>` : "";
    return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div><div style="font-weight:700;color:#105436">Documentos do projeto (GED)</div><div style="font-size:0.75rem;color:#64748b">Anexe estudos, plantas, matrículas, contratos e demais arquivos desta ${fases.length > 1 ? "fase" : "viabilidade"}. Os documentos que estavam no SharePoint do Órion não são copiados automaticamente.</div></div>
        <div style="display:flex;gap:8px;align-items:flex-end">${sel}
          ${pode ? `<label class="btn btn-primary" style="height:40px;display:inline-flex;align-items:center;cursor:pointer;margin:0">${this.docsEnviando ? "Enviando…" : "Anexar arquivo"}<input id="ov-docs-arq" type="file" multiple style="display:none" ${this.docsEnviando ? "disabled" : ""} onchange="OrionViabilidadesApp.docsAnexar(this)"></label>` : ""}</div></div>
      ${this.docsErro ? `<div style="padding:8px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;margin-bottom:8px;font-size:0.8rem">${this.esc(this.docsErro)}</div>` : ""}
      ${this.docsAviso ? `<div style="padding:8px 12px;border:1px solid #bbf7d0;background:#f0fdf4;color:#105436;border-radius:8px;margin-bottom:8px;font-size:0.8rem">${this.esc(this.docsAviso)}</div>` : ""}
      ${daFase.length ? `<div class="cc-scroll"><table class="cc-table"><colgroup><col><col style="width:90px"><col style="width:140px"><col style="width:200px"><col style="width:300px"></colgroup>
        <thead><tr><th>Documento</th><th class="is-right">Tamanho</th><th>Anexado em</th><th>Por</th><th></th></tr></thead>
        <tbody>${daFase.map((x) => `<tr><td title="${this.esc(x.nome)}">📄 ${this.esc(x.nome)}</td><td class="is-right">${tam(Number(x.tamanho) || 0)}</td><td>${data(x.em)}</td><td>${this.esc(x.por || "")}</td>
          <td class="is-right" style="overflow:visible;white-space:nowrap"><a class="btn btn-secondary" style="height:28px;font-size:0.72rem;display:inline-flex;align-items:center;text-decoration:none" href="${this.esc(x.url)}" target="_blank" rel="noopener">Baixar</a>
          ${pode ? `<button type="button" class="btn btn-secondary" style="height:28px;font-size:0.72rem" onclick="OrionViabilidadesApp.docsRenomear('${this.esc(x.id)}')">Renomear</button><button type="button" class="btn btn-secondary" style="height:28px;font-size:0.72rem;color:#b91c1c" onclick="OrionViabilidadesApp.docsExcluir('${this.esc(x.id)}')">Excluir</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : `<div style="padding:30px;text-align:center;border:1px dashed #cbd5e1;border-radius:8px;color:#64748b;font-size:0.85rem">Nenhum documento anexado${fases.length > 1 ? " nesta fase" : ""}.</div>`}`;
  }
});
