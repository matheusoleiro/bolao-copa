/**
 * Cloudflare Worker — Proxy + Cache + Fallback persistente para football-data.org
 *
 * CAMADAS:
 *  1. Cache de borda (Cache API, TTL 30s/5min) — reduz chamadas repetidas
 *     em janelas curtas, compartilhado entre usuários.
 *  2. KV "last good response" (sem TTL) — se a origem falhar (erro, 429,
 *     timeout), devolve a última resposta válida conhecida em vez de erro.
 *
 * REQUISITO: este Worker precisa de um KV Namespace vinculado com o nome
 * "BOLAO_KV". Para criar e vincular:
 *   1. Cloudflare Dashboard -> Workers & Pages -> seu Worker -> Settings -> Variables
 *   2. Na secao "KV Namespace Bindings", clique "Add binding"
 *   3. Variable name: BOLAO_KV
 *   4. KV namespace: crie um novo (ex: "bolao-cache") ou selecione existente
 *   5. Save and deploy
 */

const API_TOKEN = '7c8dee4d630e4758a5a6cc7ff9304206';
const COMPETITION_ID = 2000; // World Cup 2026
const BASE_URL = 'https://api.football-data.org/v4';

const TTL = {
  matches: 30,      // segundos
  standings: 300,
  scorers: 300,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    const status = url.searchParams.get('status');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // ── ROTA: /gerar-zoeira ──────────────────────────────────────────────
    // Recebe POST com JSON dos dados do jogo + ranking, chama o Gemini
    // Flash (free tier) e devolve o texto gerado pra usar no WhatsApp.
    // A GEMINI_API_KEY fica como variável de ambiente secreta no Worker
    // (nunca exposta no código do app que roda no navegador).
    if (url.pathname === '/gerar-zoeira' || path === 'gerar-zoeira') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Use POST' }, 405);
      }
      if (!env.GROQ_API_KEY) {
        return jsonResponse({ error: 'GROQ_API_KEY não configurada no Worker' }, 500);
      }
      try {
        const dados = await request.json();
        const texto = await gerarZoeiraComGemini(dados, env.GROQ_API_KEY);
        return jsonResponse({ texto });
      } catch (e) {
        return jsonResponse({ error: e.message }, 500);
      }
    }

    if (!path) {
      return jsonResponse({ error: 'Missing ?path= parameter' }, 400);
    }

    let originUrl, ttl, cacheKey, kvKey;

    if (path === 'matches') {
      originUrl = `${BASE_URL}/competitions/${COMPETITION_ID}/matches`;
      if (status) originUrl += `?status=${status}`;
      ttl = TTL.matches;
      cacheKey = `matches:${status || 'all'}`;
      kvKey = `lastgood:matches:${status || 'all'}`;
    } else if (path === 'standings') {
      originUrl = `${BASE_URL}/competitions/${COMPETITION_ID}/standings`;
      ttl = TTL.standings;
      cacheKey = 'standings';
      kvKey = 'lastgood:standings';
    } else if (path === 'scorers') {
      originUrl = `${BASE_URL}/competitions/${COMPETITION_ID}/scorers?limit=20`;
      ttl = TTL.scorers;
      cacheKey = 'scorers';
      kvKey = 'lastgood:scorers';
    } else {
      return jsonResponse({ error: 'Invalid path' }, 400);
    }

    // CAMADA 1: Cache de borda (rapido, 30s/5min)
    const cache = caches.default;
    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = `/cache/${cacheKey}`;
    cacheUrl.search = '';
    const cacheRequestKey = new Request(cacheUrl.toString(), { method: 'GET' });

    let cached = await cache.match(cacheRequestKey);
    if (cached) {
      const resp = new Response(cached.body, cached);
      resp.headers.set('X-Cache', 'HIT');
      resp.headers.set('Access-Control-Allow-Origin', '*');
      resp.headers.set('Access-Control-Expose-Headers', 'X-Cache, X-Origin-Status');
      return resp;
    }

    // CAMADA 2: busca na origem
    try {
      const originResponse = await fetch(originUrl, {
        headers: { 'X-Auth-Token': API_TOKEN },
      });

      if (!originResponse.ok) {
        return await serveFallback(env, kvKey, originResponse.status, ctx);
      }

      const data = await originResponse.json();
      const body = JSON.stringify(data);

      const response = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-Cache, X-Origin-Status',
          'Cache-Control': `public, max-age=${ttl}`,
          'X-Cache': 'MISS',
        },
      });

      // Salva no cache de borda (30s/5min) sempre.
      ctx.waitUntil(cache.put(cacheRequestKey, response.clone()));

      // Salva no KV (fallback permanente) com THROTTLE: o KV free tier
      // permite só 1.000 escritas/dia. Sem throttle, com TTL de borda de
      // 30s, isso geraria ~2.880 escritas/dia SÓ pro endpoint "matches"
      // (1 escrita a cada MISS) — bem acima do limite.
      // O fallback não precisa estar atualizado a cada 30s; "alguns
      // minutos de idade" é mais que suficiente pra uma emergência (origem
      // fora do ar). Por isso só escrevemos se a última escrita pra essa
      // chave foi há mais de KV_WRITE_MIN_INTERVAL segundos.
      if (env.BOLAO_KV) {
        ctx.waitUntil(maybeWriteKV(env.BOLAO_KV, kvKey, body));
      }

      return response;
    } catch (err) {
      return await serveFallback(env, kvKey, 0, ctx, err.message);
    }
  },
};

// Intervalo mínimo entre escritas no KV pra uma mesma chave (segundos).
// 5 minutos -> no máximo 12 escritas/hora = 288/dia por chave. Com até ~6
// chaves distintas em uso (matches:all, matches:IN_PLAY, standings,
// scorers, etc), fica bem abaixo do limite de 1.000 escritas/dia do
// tier gratuito do Workers KV.
const KV_WRITE_MIN_INTERVAL = 300;

/**
 * Escreve `body` em `kvKey` apenas se a última escrita pra essa chave foi
 * há mais de KV_WRITE_MIN_INTERVAL segundos (ou nunca aconteceu). O
 * timestamp da última escrita fica em `${kvKey}:ts`.
 *
 * 1 leitura extra por chamada (custo desprezível: 100k leituras/dia no
 * free tier) evita centenas/milhares de escritas desnecessárias por dia.
 */
async function maybeWriteKV(kv, kvKey, body) {
  const now = Date.now();
  const tsKey = `${kvKey}:ts`;
  const lastTs = await kv.get(tsKey);
  if (lastTs && (now - Number(lastTs)) < KV_WRITE_MIN_INTERVAL * 1000) {
    return; // escrita recente o suficiente, pula
  }
  await kv.put(kvKey, body);
  await kv.put(tsKey, String(now));
}

async function serveFallback(env, kvKey, originStatus, ctx, errMsg) {
  if (!env.BOLAO_KV) {
    return jsonResponse(
      { error: 'Origin failed and no KV configured', originStatus, errMsg },
      502
    );
  }

  const fallback = await env.BOLAO_KV.get(kvKey);
  if (fallback) {
    return new Response(fallback, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Cache, X-Origin-Status',
        'X-Cache': 'FALLBACK',
        'X-Origin-Status': String(originStatus),
      },
    });
  }

  return jsonResponse(
    { error: 'Origin failed and no fallback available', originStatus, errMsg },
    502
  );
}

/**
 * Chama o Groq (Llama 3.3 70B, free tier) com o contexto do jogo + ranking
 * e retorna o texto de "zoeira" pronto pra colar no resumo do WhatsApp.
 */
async function gerarZoeiraComGemini(dados, apiKey) {
  const {
    jogo, ranking, ousados, percMaioria, maioriaLabel, feedDestaques,
  } = dados;

  const rankingTxt = ranking.map(r =>
    `${r.pos}º ${r.name} — ${r.pts}pts${r.ganho > 0 ? ` (+${r.ganho} nesse jogo)` : ''}`
  ).join('\n');

  const ousadosTxt = ousados.length
    ? ousados.map(o =>
        `- ${o.name} apostou ${o.palpite} — ${o.acertou ? 'ACERTOU a zebra! 🔥' : 'não deu...'}`
      ).join('\n')
    : 'Ninguém foi ousado nesse jogo.';

  const baseHardcoded = feedDestaques.length
    ? feedDestaques.join('\n')
    : '(sem destaques adicionais)';

  const prompt = `Você é o narrador de um bolão de futebol entre amigos brasileiros.
Seu estilo é engraçado, descontraído, cheio de zoeira mas sem ser ofensivo — tipo amigo narrando o jogo no grupo do WhatsApp.
Use gírias brasileiras, emojis e seja criativo. Textos curtos, impactantes, no estilo Twitter/Instagram.
Escreva EM PORTUGUÊS BRASILEIRO.

JOGO: ${jogo.time1} ${jogo.gols1} x ${jogo.gols2} ${jogo.time2}

RANKING ATUAL (top 5):
${rankingTxt}

QUEM FOI OUSADO (apostou contra a maioria de ${percMaioria}% que escolheu ${maioriaLabel}):
${ousadosTxt}

DESTAQUES IDENTIFICADOS PELO SISTEMA:
${baseHardcoded}

Gere EXATAMENTE dois blocos de texto, separados pelos marcadores abaixo.
Não escreva nada fora dos marcadores.

=== FEED ===
(5 a 7 frases curtas estilo feed social — highlights do jogo, placares, quem ganhou pontos, reações engraçadas)

=== REPLAY ===
(2 a 4 frases sobre quem foi ousado no palpite — se acertou, exalte; se errou, faça zoeira carinhosa; termine com uma frase de encerramento tipo "Coragem ou loucura?")`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 512,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const texto = result?.choices?.[0]?.message?.content;
  if (!texto) throw new Error('Groq não retornou texto');
  return texto;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
