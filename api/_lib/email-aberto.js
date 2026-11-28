/* Rastreio de abertura dos e-mails da Central (imagem 1x1 no fim do e-mail).
   Rota pública (o leitor de e-mail do cliente não tem login): só grava se a assinatura "t" bater com o id "e"
   (HMAC com o CRON_SECRET, gerada no envio). Responde sempre a mesma imagem, com ou sem registro, para não
   revelar se o id existe. Grava a primeira e a última abertura e quantas vezes abriu.
   Atenção: alguns leitores baixam a imagem sozinhos (ex.: Apple Mail com proteção de privacidade), e quem
   bloqueia imagens não registra abertura. Por isso a tela mostra a abertura separada da confirmação de leitura. */
const crypto = require("crypto");
const { lerDoc, gravarCampos, tokenAbertura } = require("./central-email-enviar");

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function imagem(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Content-Length", GIF.length);
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.end(GIF);
}

function igual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

module.exports = async function handler(req, res) {
  try {
    const u = new URL(String(req.url || ""), "https://x");
    const id = String(u.searchParams.get("e") || "").slice(0, 300);
    const t = String(u.searchParams.get("t") || "");
    if (id && /^[\w-]+$/.test(id) && igual(t, tokenAbertura(id))) {
      const doc = await lerDoc("central_email_envios/" + id);
      if (doc && doc.status === "enviado") {
        const agora = new Date().toISOString();
        const campos = { aberturas: (Number(doc.aberturas) || 0) + 1, ultimaAbertura: agora };
        if (!doc.primeiraAbertura) campos.primeiraAbertura = agora;
        await gravarCampos("central_email_envios/" + id, campos);
      }
    }
  } catch (e) {
    console.warn("[email-aberto] " + String((e && e.message) || e).slice(0, 160));
  }
  imagem(res);
};
