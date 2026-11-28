module.exports = async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Só baixa relatórios do Sienge (boleto, extrato). Esta rota não pede login, por isso não pode buscar outros sites.
  let destino;
  try { destino = new URL(String(url)); } catch (e) { destino = null; }
  const host = destino ? destino.hostname.toLowerCase() : '';
  if (!destino || destino.protocol !== 'https:' || !(host === 'sienge.com.br' || host.endsWith('.sienge.com.br'))) {
    return res.status(400).json({ error: 'Link não permitido: só relatórios do Sienge.' });
  }

  try {
    const fetchOptions = {
      method: 'GET',
      headers: {}
    };

    console.log(`[PROXY DOWNLOAD] Iniciando fetch para: ${url}`);
    
    // Faz a primeira requisição. Pode retornar 302 redirecionando para S3, 
    // ou já pode ser o arquivo final. O Node fetch() segue redirecionamentos por padrão.
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`Erro no servidor de origem: ${response.status} ${response.statusText}`);
    }

    const responseHeaders = new Headers(response.headers);
    res.setHeader('Access-Control-Allow-Origin', '*');

    let providedFilename = String(req.query.filename || 'extrato.pdf').replace(/[\r\n"]/g, '').trim();
    if (!providedFilename.toLowerCase().endsWith('.pdf')) providedFilename += '.pdf';
    const asciiName = providedFilename
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/[^\x20-\x7E]/g, '_');
    const utf8Name = encodeURIComponent(providedFilename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-'));
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`);

    const contentType = responseHeaders.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    } else {
      res.setHeader('Content-Type', 'application/pdf');
    }

    res.status(200);
    if (response.body) {
       const { Readable } = require('stream');
       return Readable.fromWeb(response.body).pipe(res);
    } else {
       return res.end();
    }

  } catch (error) {
    console.error('[PROXY DOWNLOAD] Erro:', error);
    res.status(500).json({ error: 'Falha ao baixar o arquivo', details: error.message });
  }
};
