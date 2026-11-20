/* Envio de anexos grandes para o Sienge.
   A Vercel recusa requisições acima de ~4,5 MB (FUNCTION_PAYLOAD_TOO_LARGE), então o navegador
   sobe o arquivo para o Storage do Integra (bucket "arquivos" do Supabase, pasta anexos_temp/) e manda aqui só o
   link (/arquivo?p=...). O servidor baixa o arquivo com a service role e faz o POST multipart no Sienge com as
   credenciais da Vercel. */
const { encodeSiengePath } = require('./sienge-proxy');
const { supabaseAdmin } = require('../../lib/supabase-admin');
const DadosBase = require('../../js/nucleo/dados-base.js');
const LIMITE_ARQUIVO = 80 * 1024 * 1024;
const DESTINO_OK = /^(units|customers)\/\d+\/attachments\?description=[^&]*$/;

function responder(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 64 * 1024) { reject(new Error('Pedido grande demais.')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); } catch (e) { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

// Só aceita arquivo do bucket do Integra dentro de anexos_temp/. Devolve o caminho ou null.
function caminhoValido(url) {
  const caminho = DadosBase.caminhoStorage(String(url || ''));
  return caminho && /^anexos_temp\/[\w.-]+$/.test(caminho) ? caminho : null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (String(req.method || '').toUpperCase() !== 'POST') return responder(res, 405, { error: 'Use POST.' });

  let corpo;
  try { corpo = await lerJson(req); } catch (e) { return responder(res, 400, { error: e.message }); }

  const destino = String(corpo.caminho || '');
  if (!DESTINO_OK.test(destino)) return responder(res, 400, { error: 'Destino do anexo inválido.' });
  const caminho = caminhoValido(corpo.url);
  if (!caminho) return responder(res, 400, { error: 'Link do arquivo inválido.' });

  const user = process.env.SIENGE_API_USER || '';
  const pass = process.env.SIENGE_API_PASSWORD || '';
  if (!user || !pass) return responder(res, 500, { error: 'Credenciais do Sienge não configuradas no servidor.' });

  let arquivo;
  try {
    const r = await supabaseAdmin().storage.from('arquivos').download(DadosBase.chaveStorage(caminho));
    if (r.error || !r.data) return responder(res, 502, { error: 'Não foi possível ler o arquivo temporário.' });
    arquivo = Buffer.from(await r.data.arrayBuffer());
  } catch (e) {
    return responder(res, 502, { error: 'Falha ao ler o arquivo temporário.' });
  }
  if (!arquivo.length) return responder(res, 400, { error: 'Arquivo vazio.' });
  if (arquivo.length > LIMITE_ARQUIVO) return responder(res, 413, { error: 'Arquivo acima de 80 MB.' });

  const nome = String(corpo.fileName || 'anexo').replace(/[\r\n"\\]/g, "'").slice(0, 200);
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(corpo.mime || '')) ? corpo.mime : 'application/octet-stream';
  const boundary = '----CrmAnexos' + Date.now().toString(16);
  const multipart = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + nome + '"\r\nContent-Type: ' + mime + '\r\n\r\n', 'latin1'),
    arquivo,
    Buffer.from('\r\n--' + boundary + '--\r\n', 'latin1')
  ]);

  const alvo = 'https://api.sienge.com.br' + encodeSiengePath('/mouraleite/public/api/v1/' + destino);
  try {
    const s = await fetch(alvo, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64'),
        Accept: 'application/json',
        'Content-Type': 'multipart/form-data; boundary=' + boundary
      },
      body: multipart
    });
    const texto = await s.text();
    res.statusCode = s.status;
    res.setHeader('Content-Type', s.headers.get('content-type') || 'application/json; charset=utf-8');
    const loc = s.headers.get('location');
    if (loc) res.setHeader('Location', loc);
    return res.end(texto);
  } catch (e) {
    return responder(res, 502, { error: 'Falha ao conectar ao Sienge.' });
  }
};
