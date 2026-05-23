/**
 * ENERSIA — KAROL v2 · Componente único de chat
 * Inject via:  <script src="/assets/js/karol.js"></script>
 * Nenhuma outra dependência necessária.
 */
(function () {
  'use strict';

  const WORKER_URL = 'https://enersia-proxy.geralenersia.workers.dev';
  const AVATAR     = '/assets/brand/enersia-karol-avatar.png';

  /* ── Preços fallback ─────────────────────────────────────── */
  const _FB = {
    edp:'0.1817', galp:'0.1284', golden:'0.1256', coop:'0.1267',
    plenitude:'0.1289', iber:'0.1298', repsol:'0.1302', endesa:'0.1310'
  };
  let _precos = {..._FB};

  /* ── System prompt v2 ────────────────────────────────────── */
  const SYS_BASE = `És a KAROL, consultora energética IA da ENERSIA — plataforma independente. Não somos a EDP nem nenhuma comercializadora.

IDENTIDADE E TOM
• PT-PT europeu rigoroso — jamais português brasileiro
• Inteligente, sofisticada, acolhedora; tom Revolut + Notion: competente e moderno, nunca robótico
• Nunca uses Markdown. Nunca uses asteriscos, hashtags, negrito ou backticks. Responde sempre em texto simples e humano.
• Emoji com moderação, só quando natural
• Máximo 3 linhas por resposta + 1 pergunta curta. Uma pergunta de cada vez.
• Memória activa: lembras tudo o que o utilizador disse. Nunca repetes perguntas respondidas.

OBJECTIVO PRINCIPAL
Criar curiosidade sobre o valor real da fatura. Gerar percepção subtil de perda. Conduzir naturalmente à análise da fatura. Nunca pressionar — a conversa deve parecer consultiva.

PREÇOS ACTUAIS (€/kWh — fonte ERSE, actualizados automaticamente):
EDP: {{edp}} | Galp: {{galp}} | Goldenergy: {{golden}} | Coopérnico: {{coop}} | Plenitude: {{plenitude}} | Iberdrola: {{iber}} | Repsol: {{repsol}} | Endesa: {{endesa}}
REGRA: usa EXCLUSIVAMENTE estes preços. Nunca uses preços memorizados.

LINKS DISPONÍVEIS:
• Análise de fatura: https://enersia.pt/analisar-fatura
• WhatsApp / dúvidas: https://wa.me/351910322702

MODO FAMILIAR — detecta: casa, apartamento, família, luz em casa, EDP em casa
Abertura: "Olá! Sou a KAROL, consultora energética da ENERSIA 😊\nMuitas famílias em Portugal pagam acima do necessário na energia sem perceber.\nÉ para casa ou para uma empresa?"
Fluxo: comercializadora actual → valor fatura aproximado → propor análise gratuita → https://enersia.pt/analisar-fatura

MODO EMPRESARIAL — detecta: restaurante, hotel, empresa, escritório, loja, fábrica, clínica, armazém
Abertura contextual (menciona o tipo de negócio): "[Tipo de negócio] normalmente têm bastante margem de optimização — especialmente nos horários de pico.\nO teu consumo mensal fica acima ou abaixo de 500€?"
Fluxo: consumo mensal → horário → nome + telefone → "Vou pedir ao nosso especialista para te contactar ainda hoje."
WhatsApp final: https://wa.me/351910322702

MODO EDUCATIVO — detecta: bi-horário, BTN, potência contratada, OMIE, solar, mudança de comercializadora
Explica simplesmente. Termina sempre com: "Queres que analise a tua situação concreta?"

MICRO COPY — respostas humanizadas:
• Hesita: "Sem problema 😊 A análise é gratuita — e normalmente percebe-se rapidamente se existe margem."
• Não sei: "Tranquilo 😄 Uma estimativa já ajuda bastante. Quanto pagas por mês, aproximadamente?"
• Desconfiado: "Somos independentes — não somos a EDP nem nenhuma comercializadora. O nosso interesse é encontrar a melhor tarifa para ti."
• Já trocou: "Faz sentido verificar na mesma — o mercado mudou muito nos últimos meses e pode haver opções ainda melhores."

EXEMPLOS DE RESPOSTA:
"Pago muito de luz" → "Isso acontece mais do que imaginas 😅\nPosso comparar a tua situação com as tarifas actuais e perceber onde está a perda.\nÉ para casa ou para empresa?"
"Quanto custa a Goldenergy?" → "Neste momento está em {{golden}}€/kWh — uma das mais competitivas do mercado.\nQual é a tua comercializadora actual?"
"O que é bi-horário?" → "É uma tarifa com preços diferentes consoante a hora — mais barato à noite e fins-de-semana.\nPara quem usa máquinas à noite ou carrega veículo eléctrico, pode fazer sentido.\nQueres saber se é boa opção para ti?"
"Tenho um restaurante" → "Restaurantes com funcionamento contínuo costumam ter bastante margem de optimização 😊\nO teu consumo mensal fica acima ou abaixo de 500€?"

REGRAS ABSOLUTAS:
• Nunca inventar preços
• Nunca prometer poupanças sem ver fatura
• Se não souberes: https://wa.me/351910322702
• Sempre PT-PT
• ZERO Markdown — texto simples, nunca asteriscos ou hashtags`;

  function buildSys(p) {
    return SYS_BASE
      .replace(/\{\{edp\}\}/g,       p.edp       || _FB.edp)
      .replace(/\{\{galp\}\}/g,      p.galp      || _FB.galp)
      .replace(/\{\{golden\}\}/g,    p.golden    || _FB.golden)
      .replace(/\{\{coop\}\}/g,      p.coop      || _FB.coop)
      .replace(/\{\{plenitude\}\}/g, p.plenitude || _FB.plenitude)
      .replace(/\{\{iber\}\}/g,      p.iber      || _FB.iber)
      .replace(/\{\{repsol\}\}/g,    p.repsol    || _FB.repsol)
      .replace(/\{\{endesa\}\}/g,    p.endesa    || _FB.endesa);
  }

  /* ── Carregar precos.json (silencioso se falhar) ─────────── */
  (async function loadPrecos() {
    try {
      const r = await fetch(
        'https://raw.githubusercontent.com/geralenersia-source/enersia/principal/precos.json?t=' + Date.now(),
        { signal: AbortSignal.timeout(5000) }
      );
      if (!r.ok) return;
      const data = await r.json();
      const c = data.comercializadoras || {};
      _precos = {
        edp:       data.edp       || String(c['EDP']?.preco_kwh          || _FB.edp),
        galp:      data.galp      || String(c['Galp Energia']?.preco_kwh || _FB.galp),
        golden:    data.golden    || String(c['Goldenergy']?.preco_kwh   || _FB.golden),
        coop:      data.coop      || String(c['Coopérnico']?.preco_kwh   || _FB.coop),
        plenitude: data.plenitude || String(c['Plenitude']?.preco_kwh    || _FB.plenitude),
        iber:      data.iber      || String(c['Iberdrola']?.preco_kwh    || _FB.iber),
        repsol:    data.repsol    || String(c['Repsol']?.preco_kwh       || _FB.repsol),
        endesa:    data.endesa    || String(c['Endesa']?.preco_kwh       || _FB.endesa),
      };
    } catch (_) {}
  })();

  /* ── Sanitizar markdown ──────────────────────────────────── */
  function sanitizeMd(txt) {
    return txt
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/__([^_]*)__/g, '$1')
      .replace(/_([^_]*)_/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ── Estado ──────────────────────────────────────────────── */
  var _open = false;
  var _hist = [];

  /* ── CSS ─────────────────────────────────────────────────── */
  var CSS = [
    '@keyframes k-pulse-ring{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.7);opacity:0}}',
    '@keyframes k-chat-in{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '@keyframes k-blink{0%,100%{opacity:1}50%{opacity:.15}}',
    '@keyframes k-dot{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-5px);opacity:1}}',
    '.k-wrap{position:fixed;bottom:26px;right:26px;z-index:9000;display:flex;flex-direction:column;align-items:flex-end;gap:12px}',
    '.k-win{width:370px;background:#111827;border:1px solid rgba(255,255,255,.12);border-radius:24px;',
    '  box-shadow:0 40px 120px rgba(0,0,0,.75),0 0 0 1px rgba(79,124,255,.08);',
    '  overflow:hidden;display:none;flex-direction:column;max-height:580px}',
    '.k-win.k-open{display:flex;animation:k-chat-in .3s cubic-bezier(.16,1,.3,1)}',
    '.k-hdr{background:linear-gradient(135deg,#060a12,#0d1c38);padding:16px 18px;',
    '  display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;position:relative}',
    '.k-hdr::after{content:"";position:absolute;bottom:0;left:0;right:0;height:1px;',
    '  background:linear-gradient(90deg,transparent,rgba(79,124,255,.45),rgba(0,194,255,.3),transparent)}',
    '.k-hdr-av{width:44px;height:44px;border-radius:50%;border:2px solid rgba(0,194,255,.35);',
    '  flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.k-hdr-av img{width:44px;height:44px;object-fit:cover;object-position:center top}',
    '.k-hdr-name{font-family:Syne,sans-serif;font-size:14px;font-weight:800;color:#F5F7FA}',
    '.k-hdr-status{font-size:10px;color:#00C2FF;display:flex;align-items:center;gap:5px;margin-top:2px}',
    '.k-online{width:5px;height:5px;border-radius:50%;background:#00E59B;animation:k-blink 2s infinite}',
    '.k-close{margin-left:auto;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.07);',
    '  color:#94A3B8;display:flex;align-items:center;justify-content:center;font-size:16px;',
    '  cursor:pointer;border:none;transition:all .2s;flex-shrink:0;font-family:sans-serif;line-height:1}',
    '.k-close:hover{background:rgba(255,255,255,.14);color:#F5F7FA}',
    '.k-msgs{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:14px;background:#070B14}',
    '.k-msgs::-webkit-scrollbar{width:3px}',
    '.k-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:2px}',
    '.k-msg{display:flex;gap:9px;align-items:flex-end}',
    '.k-u{flex-direction:row-reverse}',
    '.k-av{width:30px;height:30px;border-radius:50%;background:#1B2435;flex-shrink:0;',
    '  display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '.k-av img{width:30px;height:30px;object-fit:cover;object-position:center top}',
    '.k-av-u{background:#4F7CFF;font-family:Syne,sans-serif;font-size:11px;font-weight:800;color:#fff}',
    '.k-bub{max-width:82%;padding:11px 15px;font-size:13px;line-height:1.65;font-family:"DM Sans",Inter,system-ui,sans-serif}',
    '.k-bub-b{background:#161D2E;border:1px solid rgba(255,255,255,.07);border-radius:4px 16px 16px 16px;color:#F5F7FA}',
    '.k-bub-u{background:#4F7CFF;color:#fff;border-radius:16px 4px 16px 16px}',
    '.k-dots{display:flex;align-items:center;gap:5px;padding:4px 0}',
    '.k-dots span{width:7px;height:7px;border-radius:50%;background:#64748B;animation:k-dot 1.2s ease-in-out infinite}',
    '.k-dots span:nth-child(2){animation-delay:.2s}.k-dots span:nth-child(3){animation-delay:.4s}',
    '.k-qr{display:flex;flex-wrap:wrap;gap:7px;padding:10px 14px 12px}',
    '.k-qr-btn{background:#161D2E;border:1px solid rgba(255,255,255,.12);color:#F5F7FA;',
    '  padding:7px 14px;border-radius:99px;font-size:11.5px;font-weight:500;cursor:pointer;',
    '  transition:all .2s;white-space:nowrap;font-family:"DM Sans",Inter,system-ui,sans-serif}',
    '.k-qr-btn:hover{background:#4F7CFF;border-color:#4F7CFF;color:#fff}',
    '.k-inp-row{display:flex;align-items:center;gap:9px;padding:12px 14px;',
    '  border-top:1px solid rgba(255,255,255,.07);background:#111827;flex-shrink:0}',
    '.k-input{flex:1;background:#070B14;border:1px solid rgba(255,255,255,.07);border-radius:99px;',
    '  padding:10px 18px;font-size:13px;color:#F5F7FA;font-family:"DM Sans",Inter,system-ui,sans-serif;',
    '  outline:none;transition:border .2s}',
    '.k-input:focus{border-color:rgba(79,124,255,.45)}',
    '.k-input::placeholder{color:#475569}',
    '.k-send{width:38px;height:38px;border-radius:50%;background:#4F7CFF;color:#fff;',
    '  display:flex;align-items:center;justify-content:center;cursor:pointer;',
    '  transition:all .2s;flex-shrink:0;border:none}',
    '.k-send:hover{background:#3B65E8;transform:scale(1.08)}',
    '.k-fab-wrap{position:relative;display:inline-block}',
    '.k-fab{width:64px;height:64px;border-radius:50%;border:2px solid rgba(79,124,255,.45);',
    '  cursor:pointer;box-shadow:0 8px 32px rgba(0,0,0,.5),0 0 0 6px rgba(79,124,255,.08);',
    '  transition:all .3s;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center}',
    '.k-fab::before{content:"";position:absolute;inset:-8px;border-radius:50%;',
    '  border:1.5px solid rgba(79,124,255,.22);animation:k-pulse-ring 2.8s ease-out infinite}',
    '.k-fab:hover{transform:scale(1.09)}',
    '.k-fab img{width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:center top}',
    '.k-badge{position:absolute;top:-3px;right:-3px;width:20px;height:20px;border-radius:50%;',
    '  background:#00E59B;border:2px solid #070B14;display:flex;align-items:center;justify-content:center;',
    '  font-family:"JetBrains Mono",monospace;font-size:9px;font-weight:900;color:#070B14;z-index:1}',
    '@media(max-width:480px){',
    '  .k-win{width:calc(100vw - 32px)}',
    '  .k-wrap{bottom:16px;right:14px}',
    '}'
  ].join('\n');

  /* ── Injectar UI ─────────────────────────────────────────── */
  function injectUI() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.className = 'k-wrap';
    wrap.innerHTML =
      '<div class="k-win" id="kWin">' +
        '<div class="k-hdr">' +
          '<div class="k-hdr-av"><img src="' + AVATAR + '" alt="KAROL"></div>' +
          '<div>' +
            '<div class="k-hdr-name">KAROL</div>' +
            '<div class="k-hdr-status"><span class="k-online"></span>Online &middot; Consultora Energ&eacute;tica IA</div>' +
          '</div>' +
          '<button class="k-close" onclick="karolToggle()" aria-label="Fechar chat">&times;</button>' +
        '</div>' +
        '<div class="k-msgs" id="kMsgs"></div>' +
        '<div class="k-qr" id="kQr">' +
          '<button class="k-qr-btn" onclick="karolSendQ(\'Quero analisar a minha fatura\')">Analisar fatura</button>' +
          '<button class="k-qr-btn" onclick="karolSendQ(\'Tenho uma empresa\')">Empresa</button>' +
          '<button class="k-qr-btn" onclick="karolSendQ(\'Tenho interesse em solar\')">Solar</button>' +
          '<button class="k-qr-btn" onclick="window.open(\'https://wa.me/351910322702\',\'_blank\')">WhatsApp</button>' +
        '</div>' +
        '<div class="k-inp-row">' +
          '<input id="kInput" class="k-input" placeholder="Escreva aqui..." onkeydown="if(event.key===\'Enter\')karolSend()">' +
          '<button class="k-send" onclick="karolSend()" aria-label="Enviar">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="k-fab-wrap">' +
        '<div class="k-badge" id="kBadge">1</div>' +
        '<div class="k-fab" onclick="karolToggle()" title="Falar com KAROL" role="button" aria-label="Abrir chat KAROL">' +
          '<img src="' + AVATAR + '" alt="KAROL">' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
  }

  /* ── Mensagem no chat ────────────────────────────────────── */
  function addMsg(txt, role) {
    var m = document.getElementById('kMsgs');
    if (!m) return;
    var d = document.createElement('div');
    d.className = 'k-msg' + (role === 'u' ? ' k-u' : '');
    var sanitized = role === 'u' ? txt : sanitizeMd(txt).replace(/\n/g, '<br>');
    if (role === 'u') {
      d.innerHTML =
        '<div class="k-bub k-bub-u">' + sanitized + '</div>' +
        '<div class="k-av k-av-u">U</div>';
    } else {
      d.innerHTML =
        '<div class="k-av"><img src="' + AVATAR + '" alt="KAROL" style="width:30px;height:30px;border-radius:50%;object-fit:cover;object-position:center top"></div>' +
        '<div class="k-bub k-bub-b">' + sanitized + '</div>';
    }
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }

  function showTyping() {
    var m = document.getElementById('kMsgs');
    if (!m) return;
    var d = document.createElement('div');
    d.className = 'k-msg'; d.id = 'kTyp';
    d.innerHTML =
      '<div class="k-av"><img src="' + AVATAR + '" alt="KAROL" style="width:30px;height:30px;border-radius:50%;object-fit:cover;object-position:center top"></div>' +
      '<div class="k-bub k-bub-b"><div class="k-dots"><span></span><span></span><span></span></div></div>';
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }

  /* ── Chamada ao Worker /chat ─────────────────────────────── */
  async function getReply(msg) {
    _hist.push({ role: 'user', content: msg });
    try {
      var r = await fetch(WORKER_URL + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: _hist, system: buildSys(_precos) })
      });
      var data = await r.json();
      var reply = data.reply || 'Erro técnico. WhatsApp: wa.me/351910322702';
      _hist.push({ role: 'assistant', content: reply });
      return reply;
    } catch (_) {
      return 'Erro técnico. WhatsApp: wa.me/351910322702';
    }
  }

  /* ── API pública ─────────────────────────────────────────── */
  window.karolToggle = function () {
    _open = !_open;
    var w = document.getElementById('kWin');
    if (!w) return;
    _open ? w.classList.add('k-open') : w.classList.remove('k-open');
    if (_open) {
      var badge = document.getElementById('kBadge');
      if (badge) badge.style.display = 'none';
      setTimeout(function () {
        var inp = document.getElementById('kInput');
        if (inp) inp.focus();
      }, 300);
    }
  };

  window.karolSend = async function () {
    var inp = document.getElementById('kInput');
    if (!inp) return;
    var msg = inp.value.trim();
    if (!msg) return;
    inp.value = '';
    var qr = document.getElementById('kQr');
    if (qr) qr.style.display = 'none';
    addMsg(msg, 'u');
    showTyping();
    var reply = await getReply(msg);
    var typ = document.getElementById('kTyp');
    if (typ) typ.remove();
    addMsg(reply, 'bot');
  };

  window.karolSendQ = async function (msg) {
    var qr = document.getElementById('kQr');
    if (qr) qr.style.display = 'none';
    addMsg(msg, 'u');
    showTyping();
    var reply = await getReply(msg);
    var typ = document.getElementById('kTyp');
    if (typ) typ.remove();
    addMsg(reply, 'bot');
  };

  /* ── Inicializar ─────────────────────────────────────────── */
  function init() {
    // Só injectar se não existir já outro widget KAROL
    if (document.getElementById('kWin')) return;
    injectUI();
    addMsg('Olá! Sou a KAROL, consultora energética da ENERSIA 😊\nMuitas famílias e empresas em Portugal pagam acima do necessário na energia.\nÉ para casa ou para uma empresa?', 'bot');
    setTimeout(function () {
      if (!sessionStorage.getItem('karol_v2')) {
        karolToggle();
        sessionStorage.setItem('karol_v2', '1');
      }
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
