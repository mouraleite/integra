/* Conversão objeto do Integra <-> linha de tabela do Supabase (migração do Firebase).
   Cada tabela tem um "mapa": { tabela, chave, campos: { campoDoFront: "coluna" | ["coluna", "tipo"] } }.
   - Gravar: campo listado vai para a coluna (com o tipo convertido); campo não listado vai para "extra" (jsonb).
   - Ler: o contrário; o conteúdo de "extra" volta como campos do objeto.
   Tipos: ms (epoch em ms <-> timestamptz), iso (texto ISO <-> timestamptz), data (AAAA-MM-DD <-> date),
          bool (vira true/false), bool01 (grava boolean, devolve 1/0), num, int, texto, json (sem conversão).
          Acrescentados para a área cobrança (não mudam os tipos acima):
          horaSP (texto "AAAA-MM-DD HH:MM:SS.mmm" sem fuso, hora de São Paulo <-> timestamptz; volta no mesmo formato),
          dataBR ("DD/MM/AAAA" ou AAAA-MM-DD -> date; volta "DD/MM/AAAA"),
          textos (lista de textos <-> text[]; ao contrário de "ids", não converte "123" em número na volta).
   Funciona no navegador (window.DadosBase) e no Node (require), para o importador da Fase 4 usar os mesmos mapas. */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.DadosBase = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function vazio(v) {
    return v === undefined || v === null || v === "";
  }

  function paraMs(v) {
    if (vazio(v)) return null;
    if (typeof v === "number") return v || null;
    if (typeof v === "object" && v) {
      if (typeof v.toMillis === "function") return v.toMillis();
      if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
      if (v.iso) return Date.parse(v.iso) || null;
    }
    if (/^\d{11,14}$/.test(String(v))) return Number(v);
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  function paraBanco(v, tipo) {
    switch (tipo) {
      case "ms":
      case "iso": {
        const ms = paraMs(v);
        return ms ? new Date(ms).toISOString() : null;
      }
      case "horaSP": {
        if (vazio(v)) return null;
        const m = typeof v === "string" && v.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/);
        // Sem fuso: hora de São Paulo (UTC-3; sem horário de verão desde 2019).
        const ms = m ? Date.parse(m[1] + "T" + m[2] + "-03:00") : paraMs(v);
        return ms ? new Date(ms).toISOString() : null;
      }
      case "dataBR":
      case "data": {
        if (vazio(v)) return null;
        const s = String(v);
        let m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return m ? m[3] + "-" + m[2] + "-" + m[1] : null;
      }
      case "bool":
      case "bool01":
        if (v === undefined || v === null) return null;
        if (typeof v === "string") return ["true", "1", "s", "sim"].indexOf(v.trim().toLowerCase()) >= 0;
        return !!v;
      case "num":
      case "int": {
        if (vazio(v)) return null;
        const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
        if (!isFinite(n)) return null;
        return tipo === "int" ? Math.round(n) : n;
      }
      case "texto":
      case "idTexto":
        return v === undefined || v === null ? null : String(v);
      case "ids":
      case "textos":
        return Array.isArray(v) ? v.filter(function (x) { return x !== null && x !== undefined; }).map(String) : null;
      default:
        return v === undefined ? null : v;
    }
  }

  function doBanco(v, tipo) {
    if (v === null || v === undefined) return v;
    switch (tipo) {
      case "ms":
        return Date.parse(v) || null;
      case "iso":
        return new Date(Date.parse(v)).toISOString();
      case "bool01":
        return v ? 1 : 0;
      case "horaSP": {
        const ms = Date.parse(v);
        if (!ms) return null;
        return new Date(ms - 3 * 3600000).toISOString().replace("T", " ").replace("Z", "");
      }
      case "dataBR": {
        const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[3] + "/" + m[2] + "/" + m[1] : v;
      }
      case "num":
      case "int":
        return typeof v === "string" ? Number(v) : v;
      case "ids":
        return Array.isArray(v) ? v.map(numeroSePuder) : v;
      case "idTexto": // id que era número no Firestore: grava texto, devolve número
        return numeroSePuder(v);
      default:
        return v;
    }
  }

  // "123" -> 123 (ids que no Firestore eram número); o resto fica texto (inclusive "0012").
  function numeroSePuder(v) {
    return typeof v === "string" && /^-?(0|[1-9]\d{0,14})$/.test(v) ? Number(v) : v;
  }

  function campos(mapa) {
    if (mapa._campos) return mapa._campos;
    const lista = Object.keys(mapa.campos || {}).map(function (campo) {
      const d = mapa.campos[campo];
      return Array.isArray(d) ? { campo: campo, coluna: d[0], tipo: d[1] } : { campo: campo, coluna: d, tipo: null };
    });
    Object.defineProperty(mapa, "_campos", { value: lista, enumerable: false });
    return lista;
  }

  // objeto do front -> linha da tabela. "id" do documento vai para mapa.chave (padrão "id").
  function paraLinha(mapa, obj, id) {
    const linha = {};
    const extra = {};
    const conhecidos = {};
    const chave = mapa.chave || "id";
    campos(mapa).forEach(function (c) {
      conhecidos[c.campo] = true;
      if (!Object.prototype.hasOwnProperty.call(obj || {}, c.campo)) return;
      const v = obj[c.campo];
      const convertido = paraBanco(v, c.tipo);
      linha[c.coluna] = convertido;
      // Valor que não cabe no tipo da coluna (ex.: objeto onde se esperava número) não se perde: vai para extra.
      if (convertido === null && !vazio(v) && c.tipo) extra[c.campo] = v;
    });
    Object.keys(obj || {}).forEach(function (k) {
      if (conhecidos[k] || k === "id" || obj[k] === undefined) return;
      extra[k] = obj[k];
    });
    if (id !== undefined && id !== null) linha[chave] = String(id);
    else if (obj && obj.id !== undefined && obj.id !== null && !conhecidos.id) linha[chave] = String(obj.id);
    if (mapa.semExtra !== true) linha.extra = extra;
    return linha;
  }

  // linha da tabela -> objeto do front, com "id".
  function paraObjeto(mapa, linha) {
    if (!linha) return null;
    const obj = {};
    const extra = linha.extra && typeof linha.extra === "object" ? linha.extra : {};
    Object.keys(extra).forEach(function (k) { obj[k] = extra[k]; });
    campos(mapa).forEach(function (c) {
      if (Object.prototype.hasOwnProperty.call(linha, c.coluna)) {
        const v = doBanco(linha[c.coluna], c.tipo);
        if (v !== null && v !== undefined) obj[c.campo] = v;
      }
    });
    const chave = mapa.chave || "id";
    if (linha[chave] !== undefined && linha[chave] !== null && obj.id === undefined) {
      obj.id = mapa.chaveNumerica ? numeroSePuder(linha[chave]) : linha[chave];
    }
    return obj;
  }

  // Id no formato do Firestore (20 caracteres), para os lugares que usavam addDoc.
  function novoId() {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(20);
    const c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : require("crypto").webcrypto;
    c.getRandomValues(bytes);
    let s = "";
    for (let i = 0; i < 20; i++) s += abc[bytes[i] % abc.length];
    return s;
  }

  // Imitação mínima do DocumentSnapshot/QuerySnapshot do Firestore, para trocar chamadas sem reescrever quem lê.
  function snapDoc(id, dados) {
    return {
      id: id,
      exists: function () { return dados !== null && dados !== undefined; },
      data: function () { return dados === null || dados === undefined ? undefined : dados; },
    };
  }

  function snapLista(docs) {
    return {
      docs: docs,
      size: docs.length,
      empty: docs.length === 0,
      forEach: function (fn) { docs.forEach(fn); },
    };
  }

  // Lê tudo de uma consulta do Supabase em páginas (o padrão da API é devolver no máximo 1000 linhas).
  async function lerTudo(montar, pagina) {
    const tam = pagina || 1000;
    const todas = [];
    for (let de = 0; ; de += tam) {
      const r = await montar().range(de, de + tam - 1);
      if (r.error) throw r.error;
      const linhas = r.data || [];
      todas.push.apply(todas, linhas);
      if (linhas.length < tam) break;
    }
    return todas;
  }

  return { paraLinha: paraLinha, paraObjeto: paraObjeto, paraBanco: paraBanco, doBanco: doBanco, paraMs: paraMs,
           snapDoc: snapDoc, snapLista: snapLista, lerTudo: lerTudo, novoId: novoId, numeroSePuder: numeroSePuder };
});
