/* Mudança de endereço do Integra (virada do Firebase para o Supabase).
   Só age no endereço antigo de produção; as bolhas de teste e o endereço novo não são afetados.
   - BLOQUEAR = false (até a virada): aviso uma vez por dia neste navegador, dizendo quando o endereço muda.
     Até a virada todos continuam usando o endereço atual (os dados só passam para o novo no dia da virada).
   - BLOQUEAR = true (ligar no dia da virada, depois da carga dos dados): o endereço antigo mostra o aviso
     e leva para o novo; não dá mais para usar o antigo. */
(function () {
  "use strict";
  var NOVO = "https://integra-mouraleite.vercel.app/";
  var NOVO_TEXTO = "integra-mouraleite.vercel.app";
  var ANTIGOS = ["crm-gestao.vercel.app"];
  var DIA_VIRADA = "segunda-feira, 30/11/2026";
  var BLOQUEAR = true;

  /* Prévia pela tela de gestão de pop-ups: mesmo aviso, em qualquer endereço, sem marcar "já vi hoje". */
  window.PopupPrevias = window.PopupPrevias || {};
  window.PopupPrevias["mudanca-endereco"] = function () { montarAviso(); };

  var host = String(location.hostname || "").toLowerCase();
  if (ANTIGOS.indexOf(host) < 0) return;

  function hojeIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function caixa(conteudo, comFechar) {
    var antigo = document.getElementById("aviso-endereco");
    if (antigo) antigo.remove();
    var ov = document.createElement("div");
    ov.id = "aviso-endereco";
    ov.setAttribute("role", "alertdialog");
    ov.setAttribute("aria-labelledby", "aviso-endereco-titulo");
    ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Outfit,Segoe UI,sans-serif;";
    ov.innerHTML = '<div style="width:520px;max-width:100%;background:#fff;border-radius:10px;border-top:5px solid #105436;box-shadow:0 18px 40px rgba(0,0,0,.25);padding:22px 24px;">'
      + conteudo
      + '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px;">'
      + (comFechar ? '<button type="button" id="aviso-endereco-ok" style="height:38px;padding:0 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-weight:700;cursor:pointer;">Entendi</button>' : "")
      + '<a href="' + NOVO + '" style="height:38px;padding:0 16px;border-radius:8px;background:#105436;color:#fff;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;"'
      + (comFechar ? ' target="_blank" rel="noopener noreferrer">Abrir o endereço novo</a>' : '>Ir para o endereço novo</a>')
      + "</div></div>";
    document.body.appendChild(ov);
    var ok = document.getElementById("aviso-endereco-ok");
    if (ok) ok.addEventListener("click", function () { ov.remove(); });
    return ov;
  }

  function endereco() {
    return '<div style="margin:12px 0;padding:12px 14px;border-radius:8px;background:#e7f6ee;color:#105436;font-size:1.05rem;font-weight:800;text-align:center;word-break:break-all;">' + NOVO_TEXTO + "</div>";
  }

  /* "Já vi hoje" fica num cookie que vence à meia-noite. O localStorage do Integra vive cheio (notas e caches)
     e a gravação falhava em silêncio: o aviso voltava a cada Ctrl+F5. O localStorage continua como reserva. */
  var COOKIE = "crm_aviso_end30";
  function jaViuHoje() {
    var hoje = hojeIso();
    try {
      var achou = document.cookie.split(";").some(function (p) { return p.trim() === COOKIE + "=" + hoje; });
      if (achou) return true;
    } catch (e) {}
    try { return localStorage.getItem("crm_aviso_endereco_30_" + hoje) === "visto"; } catch (e) { return false; }
  }
  function marcarVisto() {
    var hoje = hojeIso();
    try {
      var fim = new Date();
      fim.setHours(23, 59, 59, 0);
      document.cookie = COOKIE + "=" + hoje + "; expires=" + fim.toUTCString() + "; path=/; SameSite=Lax"
        + (location.protocol === "https:" ? "; Secure" : "");
    } catch (e) {}
    try { localStorage.setItem("crm_aviso_endereco_30_" + hoje, "visto"); } catch (e) {}
  }

  function avisar() {
    if (jaViuHoje()) return;
    montarAviso();
    marcarVisto();
  }

  function montarAviso() {
    caixa('<h3 id="aviso-endereco-titulo" style="margin:0 0 10px;color:#105436;font-size:1.15rem;">O Integra vai mudar de endereço</h3>'
      + '<p style="margin:0 0 8px;color:#1c2e24;font-size:0.92rem;line-height:1.45;">A partir de <strong>' + DIA_VIRADA + "</strong>, o Integra passa a funcionar neste endereço:</p>"
      + endereco()
      + '<p style="margin:0 0 6px;color:#1c2e24;font-size:0.9rem;line-height:1.45;"><strong>Até lá, continue usando este endereço normalmente.</strong> Salve o endereço novo nos favoritos para usar a partir de segunda-feira, 30/11.</p>'
      + '<p style="margin:0;color:#64748b;font-size:0.82rem;line-height:1.4;">O login continua o mesmo (conta Microsoft da empresa).</p>', true);
  }

  function bloquear() {
    caixa('<h3 id="aviso-endereco-titulo" style="margin:0 0 10px;color:#105436;font-size:1.15rem;">O Integra mudou de endereço</h3>'
      + '<p style="margin:0 0 8px;color:#1c2e24;font-size:0.92rem;line-height:1.45;">Este endereço não é mais usado. Acesse o Integra por aqui:</p>'
      + endereco()
      + '<p style="margin:0;color:#64748b;font-size:0.82rem;line-height:1.4;">Você será levado ao endereço novo em alguns segundos. Atualize seus favoritos.</p>', false);
    setTimeout(function () { location.replace(NOVO); }, 6000);
  }

  function iniciar() {
    if (BLOQUEAR) bloquear();
    else setTimeout(avisar, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
