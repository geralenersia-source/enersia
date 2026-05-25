/**
 * ENERSIA — Banner de Cookies RGPD
 * Injecta automaticamente o banner em todas as páginas.
 * Não depende de nenhuma biblioteca externa.
 * z-index: 9999 — posição fixed bottom
 */
(function () {
  'use strict';

  var LS_KEY = 'enersia_cookie_consent';

  // Já tem preferência guardada — não mostrar banner
  if (localStorage.getItem(LS_KEY)) return;

  // Nas páginas de cookies/privacidade/termos não mostrar banner automaticamente
  var path = window.location.pathname;
  if (path === '/cookies' || path === '/privacidade' || path === '/termos' ||
      path.indexOf('/cookies') !== -1 || path.indexOf('/privacidade') !== -1 || path.indexOf('/termos') !== -1) {
    return;
  }

  /* ── CSS ──────────────────────────────────────────────────── */
  var css = [
    '#ecb{',
    '  position:fixed;bottom:0;left:0;right:0;z-index:9999;',
    '  background:#0D111B;border-top:1px solid rgba(79,124,255,.22);',
    '  padding:14px 24px;',
    '  display:flex;align-items:center;gap:16px;flex-wrap:wrap;',
    '  font-family:"DM Sans",system-ui,sans-serif;',
    '  box-shadow:0 -8px 40px rgba(0,0,0,.55),0 -1px 0 rgba(79,124,255,.12);',
    '  animation:ecbIn .35s cubic-bezier(.16,1,.3,1);',
    '}',
    '@keyframes ecbIn{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}',
    '.ecb-txt{',
    '  margin:0;font-size:13px;color:#94A3B8;flex:1;min-width:200px;line-height:1.55;',
    '}',
    '.ecb-txt a{color:#4F7CFF;text-decoration:none}',
    '.ecb-txt a:hover{text-decoration:underline}',
    '.ecb-btns{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;align-items:center}',
    '.ecb-btn{',
    '  padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;',
    '  cursor:pointer;border:none;transition:background .2s,color .2s;',
    '  font-family:"DM Sans",system-ui,sans-serif;line-height:1;white-space:nowrap;',
    '}',
    '.ecb-accept{background:#4F7CFF;color:#fff}',
    '.ecb-accept:hover{background:#3B65E8}',
    '.ecb-reject{background:transparent;color:#94A3B8;border:1px solid rgba(255,255,255,.12)}',
    '.ecb-reject:hover{background:rgba(255,255,255,.06);color:#F5F7FA}',
    '.ecb-prefs{',
    '  background:transparent;color:#64748B;border:1px solid rgba(255,255,255,.07);font-size:12px;',
    '  padding:7px 14px;',
    '}',
    '.ecb-prefs:hover{color:#94A3B8;border-color:rgba(255,255,255,.14)}',
    '@media(max-width:600px){',
    '  #ecb{flex-direction:column;align-items:flex-start;padding:14px 16px;gap:12px}',
    '  .ecb-btns{width:100%}',
    '  .ecb-btn{flex:1;text-align:center}',
    '  .ecb-accept,.ecb-reject{flex:1}',
    '  .ecb-prefs{width:100%;text-align:center;flex:none}',
    '}',
  ].join('');

  /* ── Injectar CSS ─────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ── Criar banner ─────────────────────────────────────────── */
  var banner = document.createElement('div');
  banner.id = 'ecb';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Aviso de cookies');
  banner.innerHTML =
    '<p class="ecb-txt">' +
      'Utilizamos cookies essenciais para o funcionamento da plataforma. ' +
      'Consulte a nossa <a href="/privacidade">Política de Privacidade</a> e a ' +
      '<a href="/cookies">Política de Cookies</a>.' +
    '</p>' +
    '<div class="ecb-btns">' +
      '<button class="ecb-btn ecb-accept" id="ecbAccept">Aceitar</button>' +
      '<button class="ecb-btn ecb-reject" id="ecbReject">Rejeitar</button>' +
      '<button class="ecb-btn ecb-prefs" id="ecbPrefs">Preferências</button>' +
    '</div>';

  /* ── Handlers ─────────────────────────────────────────────── */
  function hideBanner() {
    banner.style.animation = 'none';
    banner.style.transition = 'opacity .25s,transform .25s';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(8px)';
    setTimeout(function () {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 280);
  }

  function inject() {
    if (document.getElementById('ecb')) return;
    document.body.appendChild(banner);

    document.getElementById('ecbAccept').addEventListener('click', function () {
      localStorage.setItem(LS_KEY, 'all');
      hideBanner();
    });

    document.getElementById('ecbReject').addEventListener('click', function () {
      localStorage.setItem(LS_KEY, 'essential');
      hideBanner();
    });

    document.getElementById('ecbPrefs').addEventListener('click', function () {
      window.location.href = '/cookies';
    });
  }

  /* ── Injectar quando DOM estiver pronto ───────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();
