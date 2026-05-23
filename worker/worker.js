/**
 * Enersia Proxy Worker
 * Proxy seguro entre o frontend e a API Anthropic.
 * A ANTHROPIC_API_KEY nunca fica exposta no frontend.
 *
 * Rotas:
 *   POST /analisar  — análise de fatura (PDF ou imagem) com Claude
 *   POST /chat      — chat KAROL com Claude Haiku
 *   OPTIONS *       — preflight CORS
 *
 * Deploy:
 *   wrangler deploy
 *   wrangler secret put ANTHROPIC_API_KEY
 */

const ALLOWED_ORIGINS = ['https://www.enersia.pt', 'https://enersia.pt'];

const PRECOS_FALLBACK = {
  edp:      '0.1817',
  galp:     '0.1284',
  golden:   '0.1256',
  coop:     '0.1267',
  plenitude:'0.1289',
  iber:     '0.1298',
  repsol:   '0.1302',
  endesa:   '0.1310',
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

function getCORSHeaders(origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

// ---------------------------------------------------------------------------
// Preços — Single Source of Truth
// ---------------------------------------------------------------------------

async function carregarPrecosEnergia() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://raw.githubusercontent.com/geralenersia-source/enersia/principal/precos.json?t=${Date.now()}`;
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
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = getCORSHeaders(origin);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Apenas POST é aceite nas rotas de dados
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Método não permitido.' }, 405, cors);
    }

    const { pathname } = new URL(request.url);

    if (pathname === '/analisar') return handleAnalisar(request, env, cors);
    if (pathname === '/chat')     return handleChat(request, env, cors);

    return jsonResponse({ error: 'Rota não encontrada.' }, 404, cors);
  },
};
