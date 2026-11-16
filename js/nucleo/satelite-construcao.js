/* Indício de construção pela imagem de satélite.
   Lê a imagem (Google, zoom 20, ~14 cm por pixel) num raio de 4 m em volta do ponto do lote e mede:
   - claros e lisos (laje, telha clara, parede): % de pixels claros e pouco saturados;
   - contraste interno (desvio do brilho) e bordas: construção tem bordas retas e sombras de parede;
   - brilho e saturação médios: telhado alaranjado liso é mais claro que qualquer terreno vazio.
   Calibrado em 16/11/2026 com 145 lotes conferidos visualmente (12400, 12800, 13900 e 14100):
   96% de acerto entre os decididos, 9 de 145 em dúvida. Limite conhecido: laje cinza lisa que cobre
   todo o raio é igual a terra cinza e sai como "vazio". É indício, não substitui a vistoria. */
(function () {
  const Z = 20;
  const TILE = 256;
  const RAIO_M = 4;
  const VERSAO = 1;
  const COLECAO = "satelite_indicio";

  function pxGlobal(lat, lng) {
    const n = TILE * Math.pow(2, Z);
    const r = lat * Math.PI / 180;
    return { x: (lng + 180) / 360 * n, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n };
  }

  function metrosPorPixel(lat) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, Z);
  }

  /* Poucos tiles em memória: os lotes são processados em ordem espacial e vizinhos reaproveitam. */
  const tiles = new Map();
  const MAX_TILES = 160;
  function tile(x, y) {
    const k = x + "/" + y;
    if (tiles.has(k)) {
      const v = tiles.get(k);
      tiles.delete(k);
      tiles.set(k, v);
      return v;
    }
    const s = Math.abs(x + y) % 4;
    const p = fetch("https://mt" + s + ".google.com/vt/lyrs=s&x=" + x + "&y=" + y + "&z=" + Z)
      .then((r) => {
        if (!r.ok) throw new Error("imagem " + r.status);
        return r.blob();
      })
      .then((b) => createImageBitmap(b));
    p.catch(() => tiles.delete(k));
    tiles.set(k, p);
    while (tiles.size > MAX_TILES) {
      const velho = tiles.keys().next().value;
      const pv = tiles.get(velho);
      tiles.delete(velho);
      if (pv) pv.then((img) => { if (img && img.close) img.close(); }).catch(() => {});
    }
    return p;
  }

  async function recorte(x0, y0, x1, y1) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
    const cv = document.createElement("canvas");
    cv.width = x1 - x0;
    cv.height = y1 - y0;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const jobs = [];
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) {
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) {
        jobs.push(tile(tx, ty).then((img) => ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0)));
      }
    }
    await Promise.all(jobs);
    return { data: ctx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height, x0: x0, y0: y0 };
  }

  function medidas(img, W, H, cx, cy, rad) {
    const L = new Float32Array(W * H);
    const S = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      S[i] = mx ? (mx - mn) / mx : 0;
    }
    let n = 0, sL = 0, sL2 = 0, sS = 0, claro = 0, borda = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > rad * rad) continue;
        const i = y * W + x;
        n++;
        sL += L[i];
        sL2 += L[i] * L[i];
        sS += S[i];
        if (L[i] > 175 && S[i] < 0.25) claro++;
        if (Math.hypot(L[i + 1] - L[i - 1], L[i + W] - L[i - W]) > 45) borda++;
      }
    }
    if (!n) return null;
    const mL = sL / n;
    return {
      mL: mL,
      sdL: Math.sqrt(Math.max(0, sL2 / n - mL * mL)),
      mS: sS / n,
      claro: claro * 100 / n,
      borda: borda * 100 / n
    };
  }

  /** "C" = indício de construção, "V" = sem indício (vazio/terraplanagem), "?" = dúvida. */
  function classificar(f) {
    const nota = Math.max(f.sdL / 45, f.claro / 25, (f.claro + f.borda) / 32);
    let r = "V";
    if (nota >= 1.15) r = "C";
    else if (nota >= 0.85) r = "?";
    else if (f.mL >= 175 && f.mS >= 0.28) r = "?";
    return { r: r, nota: Math.round(nota * 100) / 100 };
  }

  async function analisarPonto(lat, lng) {
    const c = pxGlobal(lat, lng);
    const rad = RAIO_M / metrosPorPixel(lat);
    const m = rad + 3;
    const rc = await recorte(c.x - m, c.y - m, c.x + m, c.y + m);
    const f = medidas(rc.data, rc.w, rc.h, c.x - rc.x0, c.y - rc.y0, rad);
    if (!f) return { r: "", nota: 0 };
    return classificar(f);
  }

  /**
   * lotes: [{ nome, lat, lng }]. Devolve { nome: { r, nota } }.
   * aoAvancar(feitos, total) para a barra de progresso.
   */
  async function analisarLotes(lotes, aoAvancar) {
    const lista = (lotes || []).filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lng)).map((l) => {
      const p = pxGlobal(l.lat, l.lng);
      return Object.assign({ tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) }, l);
    });
    lista.sort((a, b) => (a.ty - b.ty) || (a.tx - b.tx));
    const out = {};
    let pos = 0, feitos = 0;
    const trabalhar = async () => {
      while (pos < lista.length) {
        const l = lista[pos++];
        try {
          out[l.nome] = await analisarPonto(l.lat, l.lng);
        } catch (e) {
          out[l.nome] = { r: "", nota: 0, erro: true };
        }
        feitos++;
        if (aoAvancar) aoAvancar(feitos, lista.length);
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(trabalhar));
    return out;
  }

  async function lerSalvo(empId) {
    const fx = window.firebaseCollections;
    if (!fx || !window.firebaseDb) return null;
    try {
      const snap = await fx.getDoc(fx.doc(window.firebaseDb, COLECAO, String(empId)));
      const d = snap.exists() ? snap.data() : null;
      return d && d.versao === VERSAO && d.lotes ? d : null;
    } catch (e) {
      return null;
    }
  }

  async function salvar(empId, lotes, kmzAt) {
    const fx = window.firebaseCollections;
    if (!fx || !window.firebaseDb || !fx.setDoc) return;
    const u = (window.AppState && window.AppState.currentUser) || {};
    const compacto = {};
    Object.keys(lotes).forEach((k) => { if (lotes[k] && lotes[k].r) compacto[k] = lotes[k].r + "|" + lotes[k].nota; });
    try {
      await fx.setDoc(fx.doc(window.firebaseDb, COLECAO, String(empId)), {
        versao: VERSAO,
        em: new Date().toISOString(),
        por: u.name || u.nome || "",
        kmzAt: kmzAt || "",
        lotes: compacto
      });
    } catch (e) {
      console.warn("[Satélite] não salvou o resultado", e);
    }
  }

  function abrirSalvo(d) {
    const out = {};
    Object.keys((d && d.lotes) || {}).forEach((k) => {
      const p = String(d.lotes[k]).split("|");
      out[k] = { r: p[0], nota: Number(p[1]) || 0 };
    });
    return out;
  }

  window.SatConstrucao = { analisarPonto, analisarLotes, lerSalvo, salvar, abrirSalvo, RAIO_M, VERSAO };
})();
