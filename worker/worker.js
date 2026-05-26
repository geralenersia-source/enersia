/**
 * Enersia Proxy Worker
 * Proxy seguro entre o frontend e a API Anthropic.
 * A ANTHROPIC_API_KEY nunca fica exposta no frontend.
 *
 * Rotas:
 *   POST /analisar       — análise de fatura (PDF ou imagem) com Claude
 *   POST /chat           — chat KAROL com Claude Haiku
 *   POST /precos-update  — atualizar precos.json no GitHub
 *   OPTIONS *            — preflight CORS
 *
 * Deploy:
 *   wrangler deploy
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler secret put BREVO_API_KEY
 *   wrangler secret put ENERSIA_UPDATE_SECRET
 *   wrangler secret put GITHUB_TOKEN
 */

const ALLOWED_ORIGINS = [
  'https://enersia.pt',
  'https://www.enersia.pt',
  'https://enersia.pages.dev',
];

const PRECOS_FALLBACK = {
  edp:      '0.1337',
  galp:     '0.1443',
  golden:   '0.1290',
  coop:     '0.1779',
  plenitude:'0.1383',
  iber:     '0.1382',
  repsol:   '0.1424',
  endesa:   '0.1438',
};

const PRECOS_REPO = {
  owner:  'geralenersia-source',
  repo:   'enersia',
  branch: 'main',
  file:   'precos.json',
};

const ANALISE_PROMPT_BASE =
  'Analisa esta fatura de energia portuguesa e devolve APENAS um objeto JSON válido, ' +
  'sem texto antes nem depois, sem markdown e sem crases. ' +
  'Campos obrigatórios: comercializadora, periodo, total_fatura número, consumo_kwh número, ' +
  'poupanca_mensal_estimada número, percentagem_poupanca número, recomendacao_comercializador, ' +
  'motivo_recomendacao sem quebras de linha, analise_detalhada sem quebras de linha, ' +
  'urgencia Alta Media ou Baixa. ' +
  'Para estimativa de poupança, usa os preços indicados abaixo. ' +
  'Se algum dado não existir na fatura, estima com prudência e explica no campo analise_detalhada.';

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function getCORSHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Secret',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function extractJSON(text) {
  // T1: parse direto
  try { return JSON.parse(text.trim()); } catch (_) {}

  // T2: remover markdown code fences
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}

  // T3: extrair bloco {} do texto
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (_) {}
  }

  return null;
}

function validarUpdateSecret(request, env, cors) {
  const secret = request.headers.get('X-Secret') ?? '';
  if (!env.ENERSIA_UPDATE_SECRET || secret !== env.ENERSIA_UPDATE_SECRET) {
    return jsonResponse({ error: 'Nao autorizado.' }, 401, cors);
  }
  return null;
}

function dataLisboa(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dataHoraLisboa(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function atualizacaoFoiHoje(precosData, hojeLisboa = dataLisboa()) {
  const updatedDateLisboa = dataLisboa(precosData?.updatedAt);
  return Boolean(updatedDateLisboa && updatedDateLisboa === hojeLisboa);
}

// ---------------------------------------------------------------------------
// Preços — Single Source of Truth
// ---------------------------------------------------------------------------

async function carregarPrecosEnergia() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://raw.githubusercontent.com/geralenersia-source/enersia/main/precos.json?t=${Date.now()}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const c = data.comercializadoras || {};
    const precos = {
      edp:       String(data.edp       ?? c['EDP']?.preco_kwh          ?? PRECOS_FALLBACK.edp),
      galp:      String(data.galp      ?? c['Galp Energia']?.preco_kwh  ?? PRECOS_FALLBACK.galp),
      golden:    String(data.golden    ?? c['Goldenergy']?.preco_kwh    ?? PRECOS_FALLBACK.golden),
      coop:      String(data.coop      ?? c['Coopérnico']?.preco_kwh    ?? PRECOS_FALLBACK.coop),
      plenitude: String(data.plenitude ?? c['Plenitude']?.preco_kwh     ?? PRECOS_FALLBACK.plenitude),
      iber:      String(data.iber      ?? c['Iberdrola']?.preco_kwh     ?? PRECOS_FALLBACK.iber),
      repsol:    String(data.repsol    ?? c['Repsol']?.preco_kwh        ?? PRECOS_FALLBACK.repsol),
      endesa:    String(data.endesa    ?? c['Endesa']?.preco_kwh        ?? PRECOS_FALLBACK.endesa),
    };
    console.log('[ENERSIA] Preços carregados do precos.json');
    return precos;
  } catch (_) {
    clearTimeout(timeoutId);
    console.warn('[ENERSIA] Falha ao carregar precos.json. Usando fallback.');
    return { ...PRECOS_FALLBACK };
  }
}

function gerarPrecosTexto(precos) {
  return (
    'PREÇOS ACTUAIS ENERSIA:\n' +
    `EDP Comercial: €${precos.edp}/kWh\n` +
    `Galp Energia: €${precos.galp}/kWh\n` +
    `Gold Energy: €${precos.golden}/kWh\n` +
    `Coopérnico: €${precos.coop}/kWh\n` +
    `Plenitude: €${precos.plenitude}/kWh\n` +
    `Iberdrola: €${precos.iber}/kWh\n` +
    `Repsol: €${precos.repsol}/kWh\n` +
    `Endesa: €${precos.endesa}/kWh\n` +
    '\nREGRA: usa exclusivamente estes preços para calcular poupança. Nunca uses preços memorizados.'
  );
}

// ---------------------------------------------------------------------------
// Brevo — email de confirmação (fire-and-forget)
// ---------------------------------------------------------------------------

async function enviarEmailConfirmacao(env, nome, email, resultado) {
  if (!env.BREVO_API_KEY) return; // secret não configurado — ignorar silenciosamente
  try {
    const comercializadora = resultado?.comercializadora ?? 'desconhecida';
    const poupancaRaw = resultado?.poupanca_mensal_estimada;
    const poupanca = poupancaRaw != null ? Number(poupancaRaw).toFixed(2) : '–';
    const recomendacao = resultado?.recomendacao_comercializador ?? '–';

    const htmlContent =
      '<div style="font-family:Arial,sans-serif;background:#070B14;color:#F5F7FA;padding:32px;border-radius:12px;max-width:560px;margin:0 auto">' +
      '<div style="text-align:center;margin-bottom:24px">' +
      '<span style="font-size:22px;font-weight:700;color:#4F7CFF">ENERSIA</span>' +
      '</div>' +
      '<h2 style="color:#F5F7FA;font-size:18px;margin:0 0 16px">Olá ' + nome + ', a tua análise está pronta ⚡</h2>' +
      '<p style="color:#94A3B8;font-size:14px;line-height:1.6;margin:0 0 20px">' +
      'Analisámos a tua fatura da <strong style="color:#F5F7FA">' + comercializadora + '</strong> e encontrámos oportunidades de poupança.' +
      '</p>' +
      '<div style="background:rgba(79,124,255,.10);border:1px solid rgba(79,124,255,.25);border-radius:10px;padding:16px 20px;margin-bottom:20px">' +
      '<table style="width:100%;border-collapse:collapse">' +
      '<tr><td style="color:#94A3B8;font-size:13px">Poupança mensal estimada</td>' +
      '<td style="text-align:right;color:#00E59B;font-weight:700;font-size:16px">' + poupanca + ' €/mês</td></tr>' +
      '<tr><td style="color:#94A3B8;font-size:13px;padding-top:8px">Comercializadora recomendada</td>' +
      '<td style="text-align:right;color:#4F7CFF;font-weight:600;font-size:14px;padding-top:8px">' + recomendacao + '</td></tr>' +
      '</table>' +
      '</div>' +
      '<p style="color:#64748B;font-size:12px;line-height:1.5;margin:0 0 16px">' +
      'Acede a <a href="https://enersia.pt/analisar-fatura" style="color:#4F7CFF;text-decoration:none">enersia.pt</a> para consultar os detalhes completos.' +
      '</p>' +
      '<hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:20px 0">' +
      '<p style="color:#475569;font-size:11px;text-align:center;margin:0">' +
      'ENERSIA · Plataforma independente de análise energética · ' +
      '<a href="https://enersia.pt/privacidade" style="color:#475569">Privacidade</a>' +
      '</p>' +
      '</div>';

    const payload = {
      sender: { name: 'ENERSIA', email: 'geral@enersia.pt' },
      to: [{ email: email, name: nome }],
      subject: '⚡ A tua análise ENERSIA está pronta — poupança estimada: ' + poupanca + ' €/mês',
      htmlContent: htmlContent,
    };

    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('Brevo email error (non-blocking):', e.message);
  }
}

// ---------------------------------------------------------------------------
// Route: POST /analisar
// ---------------------------------------------------------------------------

async function handleAnalisar(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Corpo do pedido inválido (JSON esperado).' }, 400, cors);
  }

  const { base64, mediaType, contentType, nome, email, tel, distrito } = body;

  // Validação dos campos obrigatórios
  if (!base64)   return jsonResponse({ error: 'Ficheiro obrigatório (base64).' }, 400, cors);
  if (!nome)     return jsonResponse({ error: 'Nome obrigatório.' }, 400, cors);
  if (!email)    return jsonResponse({ error: 'Email obrigatório.' }, 400, cors);
  if (!tel)      return jsonResponse({ error: 'Telefone obrigatório.' }, 400, cors);
  if (!distrito) return jsonResponse({ error: 'Distrito obrigatório.' }, 400, cors);

  const mimeType = mediaType || contentType || 'application/pdf';
  const isPDF = mimeType === 'application/pdf';

  // Carregar preços do Single Source of Truth
  const precos = await carregarPrecosEnergia();
  const precosTexto = gerarPrecosTexto(precos);
  const promptFinal = ANALISE_PROMPT_BASE + '\n\n' + precosTexto;

  // Construir bloco de conteúdo para a API Anthropic
  const contentBlock = isPDF
    ? {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)
            ? mimeType
            : 'image/jpeg',
          data: base64,
        },
      };

  const anthropicPayload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [contentBlock, { type: 'text', text: promptFinal }],
      },
    ],
  };

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,       // nunca sai do Worker
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',        // suporte a PDF
      },
      body: JSON.stringify(anthropicPayload),
    });
  } catch (e) {
    console.error('Anthropic fetch error:', e.message);
    return jsonResponse({ error: 'Erro ao contactar serviço de análise. Tente novamente.' }, 502, cors);
  }

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.text().catch(() => '');
    console.error('Anthropic HTTP', anthropicRes.status, errBody.substring(0, 300));
    return jsonResponse({ error: 'Erro na análise (serviço externo). Tente novamente.' }, 502, cors);
  }

  const anthropicData = await anthropicRes.json().catch(() => null);
  const rawText = anthropicData?.content?.[0]?.text ?? '';

  const resultado = extractJSON(rawText);
  if (!resultado || (!resultado.comercializadora && !resultado.total_fatura)) {
    console.error('JSON extraction failed. Raw:', rawText.substring(0, 300));
    return jsonResponse(
      { error: 'Não foi possível extrair a análise. Tente com uma imagem mais nítida ou em PDF.' },
      422,
      cors
    );
  }

  // Email de confirmação — fire-and-forget (não bloqueia a resposta)
  enviarEmailConfirmacao(env, nome, email, resultado).catch(() => {});

  return jsonResponse(resultado, 200, cors);
}

// ---------------------------------------------------------------------------
// Route: POST /chat  (KAROL)
// ---------------------------------------------------------------------------

async function handleChat(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Corpo do pedido inválido.' }, 400, cors);
  }

  const { messages, system } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonResponse({ error: 'Campo messages obrigatório e não vazio.' }, 400, cors);
  }

  const anthropicPayload = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    ...(system ? { system } : {}),
    messages,
  };

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicPayload),
    });
  } catch (_) {
    return jsonResponse({ reply: 'Erro técnico. WhatsApp: wa.me/351910322702' }, 502, cors);
  }

  if (!anthropicRes.ok) {
    return jsonResponse({ reply: 'Erro técnico. WhatsApp: wa.me/351910322702' }, 502, cors);
  }

  const data = await anthropicRes.json().catch(() => null);
  const reply = data?.content?.[0]?.text ?? 'Erro técnico. WhatsApp: wa.me/351910322702';
  return jsonResponse({ reply }, 200, cors);
}

// ---------------------------------------------------------------------------
// Route: POST /precos-update
// ---------------------------------------------------------------------------

async function carregarPrecosPublicos() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://raw.githubusercontent.com/${PRECOS_REPO.owner}/${PRECOS_REPO.repo}/${PRECOS_REPO.branch}/${PRECOS_REPO.file}?t=${Date.now()}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function handlePrecosStatus(request, env, cors) {
  const unauthorized = validarUpdateSecret(request, env, cors);
  if (unauthorized) return unauthorized;

  let precosData;
  try {
    precosData = await carregarPrecosPublicos();
  } catch (e) {
    console.error('[ENERSIA/precos-status] Falha ao carregar precos.json:', e.message);
    return jsonResponse({ error: 'Erro ao consultar estado dos precos.', detail: e.message }, 502, cors);
  }

  const todayLisbon = dataLisboa();
  const updatedDateLisbon = dataLisboa(precosData?.updatedAt);
  const updatedToday = atualizacaoFoiHoje(precosData, todayLisbon);

  return jsonResponse({
    ok: true,
    updatedToday,
    todayLisbon,
    updatedAt: precosData?.updatedAt || null,
    updatedAtLisbon: dataHoraLisboa(precosData?.updatedAt),
    updatedDateLisbon,
    timezone: 'Europe/Lisbon',
  }, 200, cors);
}

async function handlePrecosUpdate(request, env, cors) {
  // ── 1. Validar secret do pedido ──────────────────────────────────────────
  const secret = request.headers.get('X-Secret') ?? '';
  if (!env.ENERSIA_UPDATE_SECRET || secret !== env.ENERSIA_UPDATE_SECRET) {
    return jsonResponse({ error: 'Não autorizado.' }, 401, cors);
  }

  // ── 2. Validar GITHUB_TOKEN ───────────────────────────────────────────────
  if (!env.GITHUB_TOKEN) {
    console.error('[ENERSIA/precos-update] GITHUB_TOKEN ausente no Worker secret');
    return jsonResponse({
      error: 'GITHUB_TOKEN ausente no Worker secret.',
      hint:  'Execute: wrangler secret put GITHUB_TOKEN',
    }, 500, cors);
  }

  // ── 3. Ler payload ────────────────────────────────────────────────────────
  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Payload inválido (JSON esperado).' }, 400, cors);
  }
  console.log('[ENERSIA/precos-update] Payload recebido:', JSON.stringify(payload));

  // ── 4. Validar campos obrigatórios ────────────────────────────────────────
  const campos = ['edp', 'galp', 'golden', 'coop', 'plenitude', 'iber', 'repsol', 'endesa'];
  for (const campo of campos) {
    const val = parseFloat(payload[campo]);
    if (!payload[campo] || isNaN(val) || val <= 0) {
      return jsonResponse({ error: `Campo inválido ou em falta: ${campo}` }, 400, cors);
    }
  }

  // ── 5. Construir novo conteúdo ────────────────────────────────────────────
  const novoConteudo = {
    edp:       String(payload.edp),
    galp:      String(payload.galp),
    golden:    String(payload.golden),
    coop:      String(payload.coop),
    plenitude: String(payload.plenitude),
    iber:      String(payload.iber),
    repsol:    String(payload.repsol),
    endesa:    String(payload.endesa),
    updatedAt: new Date().toISOString(),
    updatedAtLisbon: dataHoraLisboa(),
    source:    payload.source || 'ERSE / atualização automática ENERSIA',
  };

  const OWNER  = PRECOS_REPO.owner;
  const REPO   = PRECOS_REPO.repo;
  const BRANCH = PRECOS_REPO.branch;
  const FILE   = PRECOS_REPO.file;
  const GH_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

  // Headers conformes à GitHub REST API v2022-11-28
  const ghHeaders = {
    'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent':           'ENERSIA-Worker',
  };

  // ── 6. Obter SHA actual do ficheiro ───────────────────────────────────────
  console.log(`[ENERSIA/precos-update] GET SHA — repo: ${OWNER}/${REPO}, path: ${FILE}, branch: ${BRANCH}`);

  let sha;
  try {
    const res = await fetch(`${GH_API}?ref=${BRANCH}`, { headers: ghHeaders });
    console.log(`[ENERSIA/precos-update] GitHub GET status: ${res.status}`);

    if (!res.ok) {
      let ghErr = {};
      try { ghErr = await res.json(); } catch (_) {}
      console.error(`[ENERSIA/precos-update] GitHub GET falhou ${res.status}:`, JSON.stringify(ghErr));
      return jsonResponse({
        error:             'Erro ao obter SHA do GitHub.',
        github_status:     res.status,
        github_message:    ghErr.message          || 'sem mensagem',
        documentation_url: ghErr.documentation_url || null,
        repo:              `${OWNER}/${REPO}`,
        path_usado:        FILE,
        branch_usada:      BRANCH,
        hint: res.status === 401
          ? 'Token inválido ou expirado — verifique GITHUB_TOKEN.'
          : res.status === 403
          ? 'Token sem permissão Contents:Write no repo geralenersia-source/enersia.'
          : res.status === 404
          ? 'Repositório ou ficheiro não encontrado — verifique owner/repo/path/branch.'
          : 'Consulte os logs do Worker (wrangler tail) para mais detalhes.',
      }, 502, cors);
    }

    const ghFile = await res.json();
    sha = ghFile.sha;
    console.log(`[ENERSIA/precos-update] SHA obtido: ${sha}`);

    let precosAtuais = null;
    try {
      const conteudoAtual = atob((ghFile.content || '').replace(/\s/g, ''));
      precosAtuais = JSON.parse(conteudoAtual);
    } catch (e) {
      console.warn('[ENERSIA/precos-update] Nao foi possivel ler updatedAt atual:', e.message);
    }

    const todayLisbon = dataLisboa();
    if (atualizacaoFoiHoje(precosAtuais, todayLisbon)) {
      console.log(`[ENERSIA/precos-update] Ignorado: precos ja atualizados em ${todayLisbon} Europe/Lisbon`);
      return jsonResponse({
        ok: false,
        skipped: true,
        reason: 'already_updated_today',
        message: 'Precos ja atualizados hoje. Nenhuma alteracao efetuada.',
        todayLisbon,
        updatedAt: precosAtuais.updatedAt,
        updatedAtLisbon: dataHoraLisboa(precosAtuais.updatedAt),
        timezone: 'Europe/Lisbon',
        repo: `${OWNER}/${REPO}`,
        branch: BRANCH,
        path: FILE,
      }, 200, cors);
    }
  } catch (e) {
    console.error('[ENERSIA/precos-update] Erro de rede no GET:', e.message);
    return jsonResponse({ error: 'Erro de rede ao contactar GitHub.', detail: e.message }, 502, cors);
  }

  // ── 7. Actualizar ficheiro via PUT ────────────────────────────────────────
  const conteudoBase64 = btoa(JSON.stringify(novoConteudo, null, 2));
  console.log(`[ENERSIA/precos-update] PUT precos.json — branch: ${BRANCH}, updatedAt: ${novoConteudo.updatedAt}`);

  try {
    const res = await fetch(GH_API, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore: atualizar precos.json automaticamente — ${novoConteudo.updatedAt.slice(0, 10)}`,
        content: conteudoBase64,
        sha,
        branch: BRANCH,
      }),
    });
    console.log(`[ENERSIA/precos-update] GitHub PUT status: ${res.status}`);

    if (!res.ok) {
      let ghErr = {};
      try { ghErr = await res.json(); } catch (_) {}
      console.error(`[ENERSIA/precos-update] GitHub PUT falhou ${res.status}:`, JSON.stringify(ghErr));
      return jsonResponse({
        error:             'Erro ao actualizar precos.json no GitHub.',
        github_status:     res.status,
        github_message:    ghErr.message          || 'sem mensagem',
        documentation_url: ghErr.documentation_url || null,
        repo:              `${OWNER}/${REPO}`,
        path_usado:        FILE,
        branch_usada:      BRANCH,
        hint: res.status === 422
          ? 'SHA desactualizado — conflito de concorrência, tente novamente.'
          : res.status === 403
          ? 'Token sem permissão Contents:Write no repo geralenersia-source/enersia.'
          : 'Consulte os logs do Worker (wrangler tail) para mais detalhes.',
      }, 502, cors);
    }
  } catch (e) {
    console.error('[ENERSIA/precos-update] Erro de rede no PUT:', e.message);
    return jsonResponse({ error: 'Erro de rede ao actualizar GitHub.', detail: e.message }, 502, cors);
  }

  // ── 8. Sucesso ────────────────────────────────────────────────────────────
  console.log('[ENERSIA/precos-update] precos.json actualizado com sucesso:', novoConteudo.updatedAt);
  return jsonResponse({
    ok:        true,
    skipped:   false,
    message:   'precos.json actualizado com sucesso.',
    updatedAt: novoConteudo.updatedAt,
    updatedAtLisbon: novoConteudo.updatedAtLisbon,
    timezone:  'Europe/Lisbon',
    repo:      `${OWNER}/${REPO}`,
    branch:    BRANCH,
    path:      FILE,
  }, 200, cors);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const cors = getCORSHeaders(request);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Apenas POST é aceite nas rotas de dados
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método não permitido.' }, 405, cors);
    }

    const { pathname } = new URL(request.url);

    if (pathname === '/analisar')       return handleAnalisar(request, env, cors);
    if (pathname === '/chat')           return handleChat(request, env, cors);
    if (pathname === '/precos-status')  return handlePrecosStatus(request, env, cors);
    if (pathname === '/precos-update')  return handlePrecosUpdate(request, env, cors);

    return jsonResponse({ error: 'Rota não encontrada.' }, 404, cors);
  },
};
