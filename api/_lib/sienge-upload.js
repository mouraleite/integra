/* Envio de anexos grandes para o Sienge.
   A Vercel recusa requisições acima de ~4,5 MB (FUNCTION_PAYLOAD_TOO_LARGE), então o navegador
   sobe o arquivo para o Firebase Storage (pasta anexos_temp/) e manda aqui só o link.
   O servidor baixa o arquivo e faz o POST multipart no Sienge com as credenciais da Vercel. */
const { encodeSiengePath } = require('./sienge-proxy');

const BUCKET = 'crm-gestao-mldu.firebasestorage.app';
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

// Só aceita link de download do bucket do Integra, dentro de anexos_temp/.
function linkValido(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return false;
  const base = '/v0/b/' + BUCKET + '/o/';
  if (!u.pathname.startsWith(base)) return false;
  let objeto = '';
  try { objeto = decodeURIComponent(u.pathname.slice(base.length)); } catch (e) { return false; }
  return /^anexos_temp\/[\w.-]+$/.test(objeto);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (String(req.method || '').toUpperCase() !== 'POST') return responder(res, 405, { error: 'Use POST.' });

  let corpo;
  try { corpo = await lerJson(req); } catch (e) { return responder(res, 400, { error: e.message }); }

  const destino = String(corpo.caminho || '');
  if (!DESTINO_OK.test(destino)) return responder(res, 400, { error: 'Destino do anexo inválido.' });
  if (!linkValido(corpo.url)) return responder(res, 400, { error: 'Link do arquivo inválido.' });

  const user = process.env.SIENGE_API_USER || '';
  const pass = process.env.SIENGE_API_PASSWORD || '';
  if (!user || !pass) return responder(res, 500, { error: 'Credenciais do Sienge não configuradas no servidor.' });

  let arquivo;
  try {
    const r = await fetch(corpo.url);
    if (!r.ok) return responder(res, 502, { error: 'Não foi possível ler o arquivo temporário (HTTP ' + r.status + ').' });
    arquivo = Buffer.from(await r.arrayBuffer());
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
