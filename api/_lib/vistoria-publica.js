/* Link público da vistoria (vistoria.html, cliente/vistoriador SEM login no Integra).
   O banco não tem acesso anônimo (RLS em tudo), então a página fala com esta rota, que usa a service role
   (lib/supabase-admin.js) e devolve/aceita só o mínimo. Fica FORA do ROTAS_COM_LOGIN do gateway: a proteção é
   o id da vistoria (aleatório, não dá para adivinhar) + as conferências abaixo.
   Ver docs/mapa-tabelas/engenharia-comercial.md, decisão 1.

   GET  /api/vistoria-publica?id=<id>  ou  ?ids=<id1>,<id2>,...  (até MAX_IDS)
        200 { vistorias: [{ id, status, aberta, cidade, empreendimento, unidade, costCenterId, titulo, tituloKey,
                            createdAt, loteCoords: {lat, lng} | null }] }
        404 se nenhuma vistoria existe. Ids que não existem são omitidos.
        Só as vistorias abertas (solicitada / aguardando_fotos) trazem loteCoords; o casamento do lote com o KMZ
        do empreendimento é feito aqui, para não mandar os pontos de todos os lotes para o navegador.
   POST /api/vistoria-publica  { id, respostas: {possuiAgua, possuiEnergia, possuiEntulho, permiteAcesso,
                                 estagioObra, observacoes}, fotoFrente, fotoMeioFundo?, fotoFundoFrente? }
        As fotos são o CAMINHO no Storage (vistorias/<id>/frente_<ts>.jpeg ...), não a URL.
   POST /api/vistoria-publica  { acao: "upload", id, caminho }  -> { url } link de upload assinado da foto (bucket
        "arquivos" do Supabase); só para vistoria aberta e caminho no formato acima.
        200 { ok: true } | 400 dados inválidos | 404 não existe | 409 já enviada/concluída | 429 muitas tentativas.
        Chama public.enviar_vistoria com a service role. */
const { supabaseAdmin } = require("../../lib/supabase-admin");
const DadosBase = require("../../js/nucleo/dados-base.js");

const MAX_IDS = 30;
const MAX_CORPO = 16 * 1024;
const STATUS_ABERTOS = new Set(["solicitada", "aguardando_fotos"]);
const SIM_NAO = new Set(["sim", "nao"]);
const ESTAGIOS = new Set([
  "Sem construção", "Terraplanagem", "Alicerce", "Apenas muro", "Altura de laje", "Telhado",
  "Casa pronta sem acabamento", "Casa pronta"
]);
// Mesmos prefixos que vistoria.js usa no upload.
const FOTOS = { fotoFrente: "frente", fotoMeioFundo: "meio_fundo", fotoFundoFrente: "fundo_frente" };
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

// ---- Limite simples por IP (memória da instância; zera quando a função reinicia) ----
const LIMITES = { GET: { max: 60, janela: 60 * 1000 }, POST: { max: 10, janela: 60 * 1000 } };
const contagem = new Map();

function ipDe(req) {
  const h = req.headers || {};
  const xff = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || String(h["x-real-ip"] || "") || ((req.socket && req.socket.remoteAddress) || "") || "?";
}

function passouDoLimite(req, metodo) {
  const lim = LIMITES[metodo];
  if (!lim) return false;
  const agora = Date.now();
  const chave = metodo + "|" + ipDe(req);
  let c = contagem.get(chave);
  if (!c || agora - c.inicio > lim.janela) c = { inicio: agora, n: 0 };
  c.n++;
  contagem.set(chave, c);
  if (contagem.size > 5000) {
    // Limpeza: tira as janelas vencidas para o mapa não crescer sem fim.
    for (const [k, v] of contagem) if (agora - v.inicio > 60 * 1000) contagem.delete(k);
  }
  return c.n > lim.max;
}

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.end(JSON.stringify(obj));
}

function lerBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let tamanho = 0;
    let parou = false;
    req.on("data", (c) => {
      if (parou) return;
      tamanho += c.length;
      if (tamanho > MAX_CORPO) {
        parou = true;
        const e = new Error("Pedido grande demais.");
        e.status = 413;
        reject(e);
        try { req.destroy(); } catch (x) {}
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (parou) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) {
        const err = new Error("Pedido inválido.");
        err.status = 400;
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function parametros(req) {
  try { return new URL(String(req.url || ""), "http://local").searchParams; } catch (e) { return new URLSearchParams(); }
}

// Casa a unidade da vistoria com um placemark do KMZ (mesma regra que a página usava no navegador).
function acharCoordenadas(placemarks, unidade, costCenterId) {
  const lista = Array.isArray(placemarks) ? placemarks : [];
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const unitNameRaw = norm(unidade);
  const empIdRaw = String(costCenterId || "").replace(/\D/g, "");
  const u = String(unidade || "").trim();
  const candidatos = Array.from(new Set([
    u, u.toUpperCase(), u.toLowerCase(), u.replace(/-/g, ""),
    `${empIdRaw}-${u}`, `${empIdRaw}${u}`, `${empIdRaw}-${u.toUpperCase()}`, `${empIdRaw}${u.toUpperCase()}`
  ]));
  let achado = null;
  for (const item of lista) {
    if (!item) continue;
    const nome = String(item.name || "").trim();
    const nomeRaw = norm(nome);
    const casa = candidatos.some((c) => {
      const cn = norm(c);
      return nomeRaw === cn || nomeRaw.includes(cn) || cn.includes(nomeRaw) || nome.toUpperCase().includes(String(c).toUpperCase());
    });
    if (casa || nomeRaw === unitNameRaw || nomeRaw.includes(unitNameRaw) || unitNameRaw.includes(nomeRaw)) {
      achado = item;
      break;
    }
  }
  if (!achado || typeof achado.coords !== "string") return null;
  const partes = achado.coords.trim().split(/\s+/)[0].split(",");
  const lng = parseFloat(partes[0]);
  const lat = parseFloat(partes[1]);
  return partes.length >= 2 && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function tratarGet(req, res) {
  const p = parametros(req);
  const bruto = p.get("ids") || p.get("id") || "";
  const ids = Array.from(new Set(bruto.split(",").map((s) => s.trim()).filter(Boolean)));
  if (!ids.length) return responder(res, 400, { error: "Informe o id da vistoria." });
  if (ids.length > MAX_IDS) return responder(res, 400, { error: "Ids demais no link." });
  if (ids.some((id) => !ID_VALIDO.test(id))) return responder(res, 404, { error: "Vistoria não encontrada." });

  const db = supabaseAdmin();
  // Lista branca de colunas: nada de cliente, contrato, solicitante etc.
  const r = await db.from("vistorias")
    .select("id, status, cidade, empreendimento, unidade, cost_center_id, titulo, titulo_key, criado_em")
    .in("id", ids);
  if (r.error) throw r.error;
  const linhas = r.data || [];
  if (!linhas.length) return responder(res, 404, { error: "Vistoria não encontrada." });

  // KMZ só dos empreendimentos das vistorias abertas (uma leitura por empreendimento).
  const ccs = Array.from(new Set(linhas.filter((l) => STATUS_ABERTOS.has(l.status) && l.cost_center_id)
    .map((l) => String(l.cost_center_id))));
  const kmz = new Map();
  if (ccs.length) {
    const k = await db.from("kmz_coordinates").select("id, placemarks").in("id", ccs);
    if (k.error) console.warn("[vistoria-publica] kmz: " + k.error.message);
    else (k.data || []).forEach((l) => kmz.set(String(l.id), l.placemarks));
  }

  const ordem = new Map(ids.map((id, i) => [id, i]));
  const vistorias = linhas
    .sort((a, b) => ordem.get(a.id) - ordem.get(b.id))
    .map((l) => {
      const aberta = STATUS_ABERTOS.has(l.status);
      return {
        id: l.id, status: l.status, aberta,
        cidade: l.cidade || "", empreendimento: l.empreendimento || "", unidade: l.unidade || "",
        costCenterId: l.cost_center_id || "", titulo: l.titulo || "", tituloKey: l.titulo_key || "",
        createdAt: l.criado_em || null,
        loteCoords: aberta && l.cost_center_id
          ? acharCoordenadas(kmz.get(String(l.cost_center_id)), l.unidade, l.cost_center_id)
          : null
      };
    });
  return responder(res, 200, { vistorias });
}

function texto(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

// Confere as respostas do questionário (os mesmos valores dos selects de vistoria.html).
function validarRespostas(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const out = {
    possuiAgua: texto(r.possuiAgua, 10), possuiEnergia: texto(r.possuiEnergia, 10),
    possuiEntulho: texto(r.possuiEntulho, 10), permiteAcesso: texto(r.permiteAcesso, 10),
    estagioObra: texto(r.estagioObra, 60), observacoes: texto(r.observacoes, 2000)
  };
  if (!SIM_NAO.has(out.possuiAgua) || !SIM_NAO.has(out.possuiEnergia) || !SIM_NAO.has(out.possuiEntulho)
    || !SIM_NAO.has(out.permiteAcesso) || !ESTAGIOS.has(out.estagioObra)) return null;
  return out;
}

// Caminho tem que ser vistorias/<id>/<prefixo>_<timestamp>.jpeg (o que a página gera). Nada de URL ou "..".
function validarFoto(caminho, id, prefixo) {
  if (caminho === undefined || caminho === null || caminho === "") return { ok: true, valor: null };
  if (typeof caminho !== "string" || caminho.length > 300) return { ok: false };
  const esperado = new RegExp("^vistorias/" + id.replace(/[-]/g, "\\-") + "/" + prefixo + "_\\d{10,16}\\.jpe?g$");
  return esperado.test(caminho) ? { ok: true, valor: caminho } : { ok: false };
}

// POST { acao: "upload", id, caminho: "vistorias/<id>/<frente|meio_fundo|fundo_frente>_<ts>.jpeg" }
// -> 200 { url } : link de upload assinado do bucket "arquivos" (uso único; a página faz PUT da foto nele).
// Só para vistoria aberta e só nos caminhos que a página gera. js/nucleo/storage-supabase.js chama isto.
async function prepararUpload(res, id, caminho) {
  const valido = Object.keys(FOTOS).some((campo) => {
    const v = validarFoto(caminho, id, FOTOS[campo]);
    return v.ok && v.valor;
  });
  if (!valido) return responder(res, 400, { error: "Caminho da foto inválido." });
  const db = supabaseAdmin();
  const r = await db.from("vistorias").select("id, status").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return responder(res, 404, { error: "Vistoria não encontrada." });
  if (!STATUS_ABERTOS.has(r.data.status)) return responder(res, 409, { error: "Esta vistoria já foi enviada." });
  const up = await db.storage.from("arquivos").createSignedUploadUrl(DadosBase.chaveStorage(caminho));
  if (up.error || !up.data || !up.data.signedUrl) throw (up.error || new Error("sem link de upload"));
  return responder(res, 200, { url: up.data.signedUrl });
}

async function tratarPost(req, res) {
  let corpo;
  try {
    corpo = await lerBody(req);
  } catch (e) {
    return responder(res, e.status || 400, { error: e.message || "Pedido inválido." });
  }
  const id = typeof (corpo && corpo.id) === "string" ? corpo.id.trim() : "";
  if (!ID_VALIDO.test(id)) return responder(res, 400, { error: "Vistoria inválida." });

  if (corpo.acao === "upload") return prepararUpload(res, id, corpo.caminho);

  const respostas = validarRespostas(corpo.respostas);
  if (!respostas) return responder(res, 400, { error: "Preencha todas as perguntas do questionário." });

  const fotos = {};
  for (const campo of Object.keys(FOTOS)) {
    const v = validarFoto(corpo[campo], id, FOTOS[campo]);
    if (!v.ok) return responder(res, 400, { error: "Foto inválida (" + campo + ")." });
    fotos[campo] = v.valor;
  }
  if (!fotos.fotoFrente) return responder(res, 400, { error: "A foto da frente do lote é obrigatória." });

  const db = supabaseAdmin();
  const r = await db.from("vistorias").select("id, status").eq("id", id).maybeSingle();
  if (r.error) throw r.error;
  if (!r.data) return responder(res, 404, { error: "Vistoria não encontrada." });
  if (!STATUS_ABERTOS.has(r.data.status)) return responder(res, 409, { error: "Esta vistoria já foi enviada." });

  const rpc = await db.rpc("enviar_vistoria", {
    p_id: id, p_respostas: respostas, p_foto_frente: fotos.fotoFrente,
    p_foto_meio_fundo: fotos.fotoMeioFundo, p_foto_fundo_frente: fotos.fotoFundoFrente
  });
  if (rpc.error) throw rpc.error;
  if (rpc.data !== true) return responder(res, 409, { error: "Esta vistoria já foi enviada." });
  return responder(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  const metodo = String(req.method || "").toUpperCase();
  if (metodo === "OPTIONS") return responder(res, 204, {});
  if (metodo !== "GET" && metodo !== "POST") return responder(res, 405, { error: "Método não permitido." });
  if (passouDoLimite(req, metodo)) {
    res.setHeader("Retry-After", "60");
    return responder(res, 429, { error: "Muitas tentativas. Aguarde um minuto e tente de novo." });
  }
  try {
    return metodo === "GET" ? await tratarGet(req, res) : await tratarPost(req, res);
  } catch (e) {
    console.error("[vistoria-publica] " + ((e && e.message) || e));
    return responder(res, 500, { error: "Não foi possível acessar a vistoria agora. Tente de novo." });
  }
};

// Exportados só para teste.
module.exports._teste = { acharCoordenadas, validarFoto, validarRespostas, contagem };
