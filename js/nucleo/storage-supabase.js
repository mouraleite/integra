/* Arquivos do Integra no Supabase Storage (bucket privado "arquivos"). Substitui o js/nucleo/firebase-config.js.
   As telas continuam chamando as mesmas funções do Firebase Storage, agora feitas sobre o Supabase:
     const { ref, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata } = window.firebaseCollections;
     const r = ref(window.firebaseStorage, "pasta/arquivo.pdf");
     await uploadBytes(r, blob, { contentType });  const url = await getDownloadURL(r);  // "/arquivo?p=pasta%2Farquivo.pdf"
   - O caminho é o mesmo de antes; a chave do objeto no bucket é DadosBase.chaveStorage(caminho) (sem acento etc.).
   - getDownloadURL devolve o link /arquivo?p=<caminho> (api/_lib/arquivo.js confere o login pelo cookie e redireciona
     para um link assinado). O link não vence: pode ser gravado no banco.
   - Com login: usa window.sb (token do usuário; regras do bucket só liberam usuário ATIVO).
   - Sem login (vistoria.html, cliente de fora): defina window.STORAGE_SEM_LOGIN = true antes deste script. Só aceita
     upload em vistorias/<id>/..., por link de upload assinado pedido a /api/vistoria-publica.
   Depende de window.DadosBase (dados-base.js). */
(function () {
  "use strict";
  const BUCKET = "arquivos";

  function base() {
    if (!window.DadosBase) throw new Error("dados-base.js não carregado.");
    return window.DadosBase;
  }
  function limpar(caminho) {
    return String(caminho || "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");
  }
  function chave(caminho) {
    return base().chaveStorage(limpar(caminho));
  }

  // Espera o cliente do Supabase (supabase-client.js é módulo e carrega depois).
  let esperando = null;
  function cliente() {
    if (window.sb) return Promise.resolve(window.sb);
    if (!esperando) {
      esperando = new Promise((ok, falha) => {
        const t = setTimeout(() => falha(new Error("Armazenamento de arquivos indisponível. Recarregue a página.")), 15000);
        window.addEventListener("supabase-pronto", () => { clearTimeout(t); ok(window.sb); }, { once: true });
      });
      esperando.catch(() => { esperando = null; });
    }
    return esperando;
  }
  async function bucket() {
    const sb = await cliente();
    if (typeof window.sbToken === "function") await window.sbToken();
    return sb.storage.from(BUCKET);
  }
  function checar(r, oque) {
    if (r && r.error) {
      const e = new Error((oque ? oque + ": " : "") + (r.error.message || String(r.error)));
      e.code = r.error.statusCode === "404" || /not found/i.test(r.error.message || "") ? "storage/object-not-found" : "storage/unknown";
      throw e;
    }
    return r ? r.data : null;
  }

  // ---- Referência no formato do Firebase ({ fullPath, name, bucket, parent }) ----
  function criarRef(caminho) {
    const fullPath = limpar(caminho);
    const partes = fullPath ? fullPath.split("/") : [];
    const r = {
      fullPath,
      name: partes.length ? partes[partes.length - 1] : "",
      bucket: BUCKET,
      toString() { return "supabase://" + BUCKET + "/" + fullPath; },
    };
    Object.defineProperty(r, "parent", { get() { return partes.length ? criarRef(partes.slice(0, -1).join("/")) : null; } });
    Object.defineProperty(r, "root", { get() { return criarRef(""); } });
    return r;
  }
  // ref(storage, "a/b") ou ref(outraRef, "c") (relativo) ou ref(storage) (raiz).
  function ref(origem, caminho) {
    const pai = origem && typeof origem.fullPath === "string" ? origem.fullPath : "";
    if (caminho === undefined || caminho === null) return criarRef(pai);
    const s = String(caminho);
    // Aceita também link de download (antigo do Firebase ou /arquivo?p=...).
    if (/^(https?:|gs:|\/arquivo\?|\/proxy-storage\/)/.test(s)) {
      const c = base().caminhoStorage(s);
      if (!c) throw new Error("Link de arquivo de fora do Integra: " + s);
      return criarRef(c);
    }
    return criarRef(pai ? pai + "/" + s : s);
  }

  // ---- Upload sem login (vistoria pública) ----
  async function enviarSemLogin(r, dados, tipo) {
    const m = /^vistorias\/([A-Za-z0-9_-]{1,128})\//.exec(r.fullPath);
    if (!m) throw new Error("Envio de arquivo sem login só é permitido para fotos da vistoria.");
    const pedido = await fetch("/api/vistoria-publica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "upload", id: m[1], caminho: r.fullPath }),
    });
    let j = null;
    try { j = await pedido.json(); } catch (e) {}
    if (!pedido.ok || !j || !j.url) throw new Error((j && j.error) || "Não foi possível preparar o envio da foto (" + pedido.status + ").");
    const envio = await fetch(j.url, {
      method: "PUT",
      headers: { "Content-Type": tipo || "application/octet-stream", "x-upsert": "false" },
      body: dados,
    });
    if (!envio.ok) throw new Error("Falha ao enviar a foto (" + envio.status + ").");
  }

  // ---- Funções no formato do firebase/storage ----
  async function uploadBytes(r, dados, meta) {
    const corpo = dados instanceof Blob ? dados
      : (dados instanceof ArrayBuffer || ArrayBuffer.isView(dados)) ? new Blob([dados]) : dados;
    const tipo = (meta && meta.contentType) || (corpo && corpo.type) || "application/octet-stream";
    if (window.STORAGE_SEM_LOGIN) {
      await enviarSemLogin(r, corpo, tipo);
    } else {
      const b = await bucket();
      checar(await b.upload(chave(r.fullPath), corpo, { contentType: tipo, upsert: true, cacheControl: "3600" }), "envio do arquivo");
    }
    return { ref: r, metadata: { fullPath: r.fullPath, name: r.name, bucket: BUCKET, contentType: tipo, size: corpo && corpo.size } };
  }

  async function getDownloadURL(r) {
    return base().urlStorage(r.fullPath);
  }

  async function deleteObject(r) {
    const b = await bucket();
    checar(await b.remove([chave(r.fullPath)]), "exclusão do arquivo");
  }

  // Um nível da pasta: { items: [refs de arquivos], prefixes: [refs de subpastas] }.
  async function listAll(r) {
    const b = await bucket();
    const pasta = chave(r.fullPath);
    const items = [];
    const prefixes = [];
    for (let de = 0; ; de += 1000) {
      const lista = checar(await b.list(pasta, { limit: 1000, offset: de, sortBy: { column: "name", order: "asc" } }), "lista da pasta") || [];
      lista.forEach((o) => {
        if (!o || !o.name || o.name === ".emptyFolderPlaceholder") return;
        const caminho = (pasta ? pasta + "/" : "") + o.name;
        if (o.id === null || o.id === undefined) prefixes.push(criarRef(caminho));
        else items.push(criarRef(caminho));
      });
      if (lista.length < 1000) break;
    }
    return { items, prefixes };
  }

  async function getMetadata(r) {
    const b = await bucket();
    const k = chave(r.fullPath);
    const i = k.lastIndexOf("/");
    const pasta = i >= 0 ? k.slice(0, i) : "";
    const nome = i >= 0 ? k.slice(i + 1) : k;
    const lista = checar(await b.list(pasta, { limit: 100, search: nome }), "dados do arquivo") || [];
    const o = lista.find((x) => x && x.name === nome && x.id);
    if (!o) {
      const e = new Error("Arquivo não encontrado: " + r.fullPath);
      e.code = "storage/object-not-found";
      throw e;
    }
    const meta = o.metadata || {};
    return {
      bucket: BUCKET, fullPath: r.fullPath, name: r.name,
      size: Number(meta.size) || 0, contentType: meta.mimetype || "",
      timeCreated: o.created_at || "", updated: o.updated_at || o.created_at || "",
    };
  }

  window.firebaseStorage = { bucket: BUCKET, supabase: true };
  window.firebaseCollections = Object.assign(window.firebaseCollections || {}, {
    ref, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata,
  });
  window.ArquivosIntegra = { ref, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata, chave };
  window.dispatchEvent(new Event("storage-pronto"));
})();
