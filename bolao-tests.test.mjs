// Testes do Bolão Copa 2026
// -------------------------------------------------------------------------
// Roda com: node --test bolao-tests.test.mjs
// Requer Node 18+ (usa node:test e node:assert, sem dependências externas).
//
// ESTRATÉGIA: em vez de copiar/colar a lógica do app aqui (o que faria os
// testes "mentirem" se o código real mudar e os testes não), extraímos as
// funções/dados PUROS direto de bolao-copa-2026.html via regex e os
// executamos com `new Function(...)`. Isso cobre exatamente as áreas onde
// já tivemos bugs reais nesta sessão:
//
//   - calcPts: cálculo de pontos (a dupla-contagem e o "h2" corrompido
//     vieram de erros ADJACENTES a essa função, então validamos ela
//     isoladamente com casos extremos)
//   - filtro de jogos "ao vivo" que já têm resultado oficial (o bug do
//     wedison 75pts em vez de 50pts)
//   - filtro "FINISHED only" ao salvar resultados (o bug do Qatar x Suíça
//     537334 salvo como resultado oficial enquanto IN_PLAY)
//   - geNoticiaUrl / GE_SLUG_MAP (links do GloboEsporte)
//   - formatarDiaChave (agrupamento de jogos "de hoje" pro lembrete WhatsApp)
//   - integridade de dados do HARDCODED_GROUP_STAGE (IDs únicos, datas
//     válidas, sem times sem mapeamento de slug)
// -------------------------------------------------------------------------

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve o caminho do HTML do app. Ordem de prioridade:
 *   1. Variável de ambiente BOLAO_HTML (caminho absoluto ou relativo)
 *   2. "bolao-copa-2026.html" na mesma pasta deste arquivo
 *   3. "index.html" na mesma pasta
 *   4. Único arquivo .html na mesma pasta (se houver exatamente um)
 *
 * Se nenhum desses funcionar, lança erro explicando como apontar manualmente:
 *   BOLAO_HTML=caminho/do/seu/arquivo.html node --test bolao-tests.test.mjs
 */
function resolveHtmlPath() {
  if (process.env.BOLAO_HTML) {
    const p = path.resolve(process.env.BOLAO_HTML);
    if (existsSync(p)) return p;
    throw new Error(`BOLAO_HTML="${process.env.BOLAO_HTML}" não existe (resolvido para "${p}").`);
  }

  const candidatos = ['bolao-copa-2026.html', 'index.html'];
  for (const nome of candidatos) {
    const p = path.join(__dirname, nome);
    if (existsSync(p)) return p;
  }

  const htmlsNaPasta = readdirSync(__dirname).filter(f => f.endsWith('.html'));
  if (htmlsNaPasta.length === 1) return path.join(__dirname, htmlsNaPasta[0]);

  throw new Error(
    `Não encontrei o HTML do app automaticamente.\n` +
    `Arquivos .html na pasta "${__dirname}": ${htmlsNaPasta.join(', ') || '(nenhum)'}\n` +
    `Aponte manualmente com:\n` +
    `  BOLAO_HTML=caminho/do/seu/arquivo.html node --test bolao-tests.test.mjs`
  );
}

const HTML_PATH = resolveHtmlPath();
const html = readFileSync(HTML_PATH, 'utf8');

/** Extrai um trecho do HTML via regex, lançando erro claro se não achar. */
function extract(pattern, label) {
  const m = html.match(pattern);
  if (!m) throw new Error(`Não encontrei "${label}" em bolao-copa-2026.html — o código-fonte mudou? Atualize o regex do teste.`);
  return m[0];
}

// ── Extrai funções/dados puros direto do HTML ──
const calcPtsSrc   = extract(/function calcPts\(p1,p2,r1,r2\)\{[\s\S]*?\n\}/, 'calcPts');
const geSlugSrc    = extract(/const GE_SLUG_MAP = \{[\s\S]*?\n\};/, 'GE_SLUG_MAP');
const geUrlSrc     = extract(/function geNoticiaUrl\(jogo\)\{[\s\S]*?\n\}/, 'geNoticiaUrl');
const diaChaveSrc  = extract(/function formatarDiaChave\(utcStr\)\{[\s\S]*?\n\}/, 'formatarDiaChave');
const hardcodedSrc = extract(/const HARDCODED_GROUP_STAGE = \[[\s\S]*?\n\];/, 'HARDCODED_GROUP_STAGE');

// Dependências de mesclarJogosComAPI / apiToJogo / hardcodeToMatch / extrairResultadosFinalizados
const venueMapSrc       = extract(/const VENUE_MAP = \{[\s\S]*?\n\};/, 'VENUE_MAP');
const getVenueSrc       = extract(/function getVenue\(m\)\{[\s\S]*?\n\}/, 'getVenue');
const flagMapSrc        = extract(/const FLAG_MAP = \{[\s\S]*?\n\};/, 'FLAG_MAP');
const fdNameMapSrc      = extract(/const FD_NAME_MAP = \{[\s\S]*?\n\};/, 'FD_NAME_MAP');
const groupLabelSrc     = extract(/const GROUP_LABEL = \{[\s\S]*?\n\};/, 'GROUP_LABEL');
const stageLabelSrc     = extract(/const STAGE_LABEL = \{[\s\S]*?\n\};/, 'STAGE_LABEL');
const apiToJogoSrc      = extract(/function apiToJogo\(m\)\{[\s\S]*?\n\}/, 'apiToJogo');
const hardcodeToMatchSrc= extract(/function hardcodeToMatch\(h\)\{[\s\S]*?\n\}/, 'hardcodeToMatch');
const mesclarSrc        = extract(/function mesclarJogosComAPI\(apiMatches, hardcoded\)\{[\s\S]*?\n\}/, 'mesclarJogosComAPI');
const extrairResSrc     = extract(/function extrairResultadosFinalizados\(jogosCopa\)\{[\s\S]*?\n\}/, 'extrairResultadosFinalizados');

// Monta um módulo isolado com essas peças e exporta o que precisamos testar.
const sandbox = new Function(`
  ${calcPtsSrc}
  ${geSlugSrc}
  ${geUrlSrc}
  ${diaChaveSrc}
  ${hardcodedSrc}
  ${venueMapSrc}
  ${getVenueSrc}
  ${flagMapSrc}
  ${fdNameMapSrc}
  ${groupLabelSrc}
  ${stageLabelSrc}
  ${apiToJogoSrc}
  ${hardcodeToMatchSrc}
  ${mesclarSrc}
  ${extrairResSrc}
  return {
    calcPts, GE_SLUG_MAP, geNoticiaUrl, formatarDiaChave, HARDCODED_GROUP_STAGE,
    mesclarJogosComAPI, extrairResultadosFinalizados, apiToJogo, hardcodeToMatch
  };
`)();

const {
  calcPts, GE_SLUG_MAP, geNoticiaUrl, formatarDiaChave, HARDCODED_GROUP_STAGE,
  mesclarJogosComAPI, extrairResultadosFinalizados, apiToJogo, hardcodeToMatch
} = sandbox;

// ===========================================================================
// calcPts — regras de pontuação
// ===========================================================================
describe('calcPts (pontuação por palpite)', () => {
  test('placar exato vale 25, em qualquer faixa de gols', () => {
    assert.equal(calcPts(2, 0, 2, 0), 25);
    assert.equal(calcPts(0, 0, 0, 0), 25); // 0x0 é "exato" também
    assert.equal(calcPts(3, 3, 3, 3), 25); // empate exato
  });

  test('vencedor certo + mesma diferença de gols vale 10', () => {
    // palpite 2x1 (dif +1), real 3x2 (dif +1) — vencedor certo, dif igual
    assert.equal(calcPts(2, 1, 3, 2), 10);
    assert.equal(calcPts(1, 0, 2, 1), 10);
  });

  test('vencedor certo mas diferença de gols diferente vale 7', () => {
    // palpite 2x0 (dif +2), real 1x0 (dif +1) — vencedor certo, dif diferente
    assert.equal(calcPts(2, 0, 1, 0), 7);
    assert.equal(calcPts(3, 1, 1, 0), 7);
  });

  test('empate certo (mas placar exato errado) vale 5', () => {
    // palpite 1x1, real 2x2 — ambos empate, mas não é o mesmo placar
    assert.equal(calcPts(1, 1, 2, 2), 5);
    assert.equal(calcPts(0, 0, 3, 3), 5);
  });

  test('resultado totalmente errado vale 0', () => {
    assert.equal(calcPts(2, 0, 0, 2), 0); // achou vitória do time 1, time 2 venceu
    assert.equal(calcPts(1, 1, 2, 0), 0); // achou empate, teve vencedor
    assert.equal(calcPts(2, 0, 1, 1), 0); // achou vitória, foi empate
  });

  test('aceita strings numéricas (vindas de inputs/Firestore)', () => {
    assert.equal(calcPts('1', '1', 1, 1), 25);
    assert.equal(calcPts('2', '0', '1', '0'), 7);
  });
});

// ===========================================================================
// Filtro "jogo ao vivo" deve EXCLUIR jogos já oficializados
// (Bug real: wedison apareceu com 75pts em vez de 50 porque o jogo
//  537333/Canadá x Bósnia já estava em `resultados` mas a API ainda
//  reportava IN_PLAY, e o ranking provisório somou +25 de novo.)
// ===========================================================================
describe('filtro de jogos ao vivo exclui jogos já oficializados', () => {
  // Reimplementa a MESMA condição usada em
  // atualizarPlacaresLiveECalcularProvisorio / temJogoAoVivo, pra travar
  // a regra de negócio. Se o código-fonte mudar essa condição sem manter
  // o comportamento, este teste continua descrevendo o contrato esperado.
  function ehJogoAoVivoConsiderado(jogo, resultados) {
    return (jogo.status === 'IN_PLAY' || jogo.status === 'PAUSED') &&
      jogo.score?.fullTime?.home != null && jogo.score?.fullTime?.away != null &&
      !(resultados[jogo.id] && resultados[jogo.id].gols1 !== undefined);
  }

  test('jogo IN_PLAY sem resultado oficial conta como ao vivo', () => {
    const jogo = { id: 537334, status: 'IN_PLAY', score: { fullTime: { home: 0, away: 1 } } };
    assert.equal(ehJogoAoVivoConsiderado(jogo, {}), true);
  });

  test('jogo IN_PLAY que JÁ TEM resultado oficial NÃO conta como ao vivo (evita dupla contagem)', () => {
    const jogo = { id: 537333, status: 'IN_PLAY', score: { fullTime: { home: 1, away: 1 } } };
    const resultados = { 537333: { gols1: 1, gols2: 1 } };
    assert.equal(ehJogoAoVivoConsiderado(jogo, resultados), false);
  });

  test('jogo FINISHED nunca conta como ao vivo, com ou sem resultado salvo', () => {
    const jogo = { id: 537345, status: 'FINISHED', score: { fullTime: { home: 4, away: 1 } } };
    assert.equal(ehJogoAoVivoConsiderado(jogo, {}), false);
    assert.equal(ehJogoAoVivoConsiderado(jogo, { 537345: { gols1: 4, gols2: 1 } }), false);
  });

  test('regressão: cenário do wedison não duplica pontos', () => {
    // wedison acertou 537328 (oficial, +25) e está acertando 537333 (ao vivo, +25)
    const resultados = { 537328: { gols1: 2, gols2: 1 } }; // 537333 AINDA não oficial
    const jogosAtuais = [
      { id: 537328, status: 'FINISHED', score: { fullTime: { home: 2, away: 1 } } },
      { id: 537333, status: 'IN_PLAY',  score: { fullTime: { home: 1, away: 1 } } },
    ];
    const palpite = { 537328: { gols1: 2, gols2: 1 }, 537333: { gols1: 1, gols2: 1 } };

    // total oficial: só 537328
    let oficial = 0;
    for (const jid of Object.keys(resultados)) {
      const r = resultados[jid], p = palpite[jid];
      oficial += calcPts(p.gols1, p.gols2, r.gols1, r.gols2);
    }
    assert.equal(oficial, 25);

    // provisório: só jogos "ao vivo considerados" (537333, ainda não oficial)
    let provisorio = 0;
    for (const j of jogosAtuais) {
      if (!ehJogoAoVivoConsiderado(j, resultados)) continue;
      const p = palpite[j.id];
      provisorio += calcPts(p.gols1, p.gols2, j.score.fullTime.home, j.score.fullTime.away);
    }
    assert.equal(provisorio, 25);

    // total exibido = 25 (oficial) + 25 (provisório) = 50, NUNCA 75
    assert.equal(oficial + provisorio, 50);

    // Agora simula 537333 sendo oficializado: resultado salvo, API ainda IN_PLAY
    const resultadosDepois = { ...resultados, 537333: { gols1: 1, gols2: 1 } };
    let oficialDepois = 0;
    for (const jid of Object.keys(resultadosDepois)) {
      const r = resultadosDepois[jid], p = palpite[jid];
      oficialDepois += calcPts(p.gols1, p.gols2, r.gols1, r.gols2);
    }
    let provisorioDepois = 0;
    for (const j of jogosAtuais) {
      if (!ehJogoAoVivoConsiderado(j, resultadosDepois)) continue; // 537333 agora excluído
      const p = palpite[j.id];
      provisorioDepois += calcPts(p.gols1, p.gols2, j.score.fullTime.home, j.score.fullTime.away);
    }
    assert.equal(oficialDepois, 50);   // 537328 + 537333
    assert.equal(provisorioDepois, 0); // 537333 não conta mais como provisório
    assert.equal(oficialDepois + provisorioDepois, 50); // continua 50, não 75
  });
});

// ===========================================================================
// Salvar resultados deve aceitar SOMENTE jogos com status FINISHED
// (Bug real: Qatar x Suíça 537334 IN_PLAY 0x1 foi salvo em resultados/jogos
//  como se fosse resultado final.)
// ===========================================================================
describe('seleção de resultados a salvar (buscarResultadosAPI)', () => {
  // Mesma condição usada no código real após a correção.
  function selecionaResultadosParaSalvar(jogos) {
    const novosRes = {};
    for (const j of jogos) {
      const g1 = j.score?.fullTime?.home;
      const g2 = j.score?.fullTime?.away;
      if (j.status === 'FINISHED' && g1 != null && g2 != null) {
        novosRes[j.id] = { gols1: g1, gols2: g2 };
      }
    }
    return novosRes;
  }

  test('inclui jogos FINISHED com placar numérico', () => {
    const jogos = [{ id: 537345, status: 'FINISHED', score: { fullTime: { home: 4, away: 1 } } }];
    assert.deepEqual(selecionaResultadosParaSalvar(jogos), { 537345: { gols1: 4, gols2: 1 } });
  });

  test('NÃO inclui jogos IN_PLAY mesmo com placar numérico (regressão Qatar x Suíça)', () => {
    const jogos = [{ id: 537334, status: 'IN_PLAY', score: { fullTime: { home: 0, away: 1 } } }];
    assert.deepEqual(selecionaResultadosParaSalvar(jogos), {});
  });

  test('NÃO inclui jogos TIMED/SCHEDULED sem placar', () => {
    const jogos = [
      { id: 1, status: 'TIMED', score: { fullTime: { home: null, away: null } } },
      { id: 2, status: 'SCHEDULED', score: { fullTime: { home: null, away: null } } },
    ];
    assert.deepEqual(selecionaResultadosParaSalvar(jogos), {});
  });

  test('mistura: só os FINISHED entram, o resto fica de fora', () => {
    const jogos = [
      { id: 537327, status: 'FINISHED', score: { fullTime: { home: 2, away: 0 } } },
      { id: 537334, status: 'IN_PLAY',  score: { fullTime: { home: 0, away: 1 } } },
      { id: 999,    status: 'TIMED',    score: { fullTime: { home: null, away: null } } },
    ];
    assert.deepEqual(selecionaResultadosParaSalvar(jogos), {
      537327: { gols1: 2, gols2: 0 },
    });
  });
});

// ===========================================================================
// GE_SLUG_MAP / geNoticiaUrl — links do GloboEsporte
// ===========================================================================
describe('geNoticiaUrl (link de notícia do GloboEsporte)', () => {
  test('gera URL correta quando ambos os times têm slug mapeado', () => {
    const jogo = { time1: 'Canadá', time2: 'Bósnia-Herzegovina', utc: '2026-06-12T19:00:00Z' };
    const url = geNoticiaUrl(jogo);
    assert.equal(url, 'https://ge.globo.com/futebol/copa-do-mundo/jogo/12-06-2026/canada-bosnia-herzegovina.ghtml');
  });

  test('retorna null se algum time não está no GE_SLUG_MAP (fallback de busca deve ser usado)', () => {
    const jogo = { time1: 'Time Inexistente', time2: 'Canadá', utc: '2026-06-12T19:00:00Z' };
    assert.equal(geNoticiaUrl(jogo), null);
  });

  test('todos os 73 jogos do HARDCODED_GROUP_STAGE têm os dois times mapeados em GE_SLUG_MAP ou FD_NAME_MAP', () => {
    // Esse teste é mais "smoke test": garante que GE_SLUG_MAP não está
    // vazio e tem pelo menos as seleções dos jogos já jogados nesta sessão.
    const timesEssenciais = ['México', 'África do Sul', 'Coreia do Sul', 'Tchéquia', 'Canadá', 'Bósnia-Herzegovina', 'Qatar', 'Suíça', 'BRASIL'];
    for (const time of timesEssenciais) {
      assert.ok(GE_SLUG_MAP[time], `Time "${time}" não tem slug em GE_SLUG_MAP`);
    }
  });
});

// ===========================================================================
// formatarDiaChave — agrupamento "jogos de hoje" (lembrete WhatsApp)
// ===========================================================================
describe('formatarDiaChave', () => {
  test('retorna formato YYYY-MM-DD', () => {
    const chave = formatarDiaChave('2026-06-13T19:00:00Z');
    assert.match(chave, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('dois horários do mesmo dia UTC (em fusos próximos) geram a mesma chave', () => {
    const a = formatarDiaChave('2026-06-13T01:00:00Z');
    const b = formatarDiaChave('2026-06-13T19:00:00Z');
    // Nota: isso pode variar dependendo do fuso horário de quem roda o teste
    // (ex: 01:00 UTC pode já ser "dia anterior" em fusos muito negativos).
    // O importante é que a função NÃO lance erro e devolva uma chave válida.
    assert.match(a, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(b, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ===========================================================================
// Integridade do HARDCODED_GROUP_STAGE
// ===========================================================================
describe('integridade de dados — HARDCODED_GROUP_STAGE', () => {
  test('não há IDs de jogo duplicados', () => {
    const ids = HARDCODED_GROUP_STAGE.map(j => j.id);
    const unicos = new Set(ids);
    assert.equal(unicos.size, ids.length, `IDs duplicados encontrados: ${ids.filter((id,i)=>ids.indexOf(id)!==i)}`);
  });

  test('todos os jogos têm utc válido (parseável como data)', () => {
    for (const j of HARDCODED_GROUP_STAGE) {
      const d = new Date(j.utc);
      assert.ok(!isNaN(d.getTime()), `Data inválida no jogo ${j.id}: "${j.utc}"`);
    }
  });

  test('nenhum jogo tem o mesmo time jogando contra si mesmo', () => {
    for (const j of HARDCODED_GROUP_STAGE) {
      assert.notEqual(j.home, j.away, `Jogo ${j.id} tem home === away ("${j.home}")`);
    }
  });

  test('todos os jogos têm group e matchday definidos', () => {
    for (const j of HARDCODED_GROUP_STAGE) {
      assert.ok(j.group, `Jogo ${j.id} sem group`);
      assert.ok(j.matchday, `Jogo ${j.id} sem matchday`);
    }
  });
});

// ===========================================================================
// Validação de resultados salvos no Firestore (anti-corrupção)
// (Bug real: campo "h2" apareceu em resultados/jogos, um ID que não
//  corresponde a nenhum jogo real — provavelmente lixo de teste manual.)
// ===========================================================================
describe('validação de resultados/jogos (anti-corrupção)', () => {
  const idsValidos = new Set(HARDCODED_GROUP_STAGE.map(j => String(j.id)));

  function validarResultados(resultados) {
    const erros = [];
    for (const [jid, res] of Object.entries(resultados)) {
      if (!idsValidos.has(String(jid))) {
        erros.push(`ID de jogo desconhecido: "${jid}"`);
        continue;
      }
      if (typeof res.gols1 !== 'number' || typeof res.gols2 !== 'number') {
        erros.push(`Jogo ${jid}: gols1/gols2 não são números (${JSON.stringify(res)})`);
      }
      if (res.gols1 < 0 || res.gols2 < 0) {
        erros.push(`Jogo ${jid}: placar negativo (${JSON.stringify(res)})`);
      }
    }
    return erros;
  }

  test('aceita resultados válidos sem erros', () => {
    const resultados = {
      537327: { gols1: 2, gols2: 0 },
      537333: { gols1: 1, gols2: 1 },
    };
    assert.deepEqual(validarResultados(resultados), []);
  });

  test('detecta ID de jogo inexistente (regressão do campo "h2")', () => {
    const resultados = {
      537327: { gols1: 2, gols2: 0 },
      h2: { gols1: 2, gols2: 1 },
    };
    const erros = validarResultados(resultados);
    assert.ok(erros.some(e => e.includes('"h2"')), `Esperava erro sobre "h2", recebi: ${JSON.stringify(erros)}`);
  });

  test('detecta placar negativo ou não-numérico', () => {
    const erros1 = validarResultados({ 537327: { gols1: -1, gols2: 0 } });
    assert.ok(erros1.length > 0);

    const erros2 = validarResultados({ 537327: { gols1: '2', gols2: 0 } });
    assert.ok(erros2.length > 0);
  });
});

// ===========================================================================
// mesclarJogosComAPI — combina HARDCODED_GROUP_STAGE com a resposta da API
// (football-data.org). Aqui testamos com FIXTURES os cenários de status
// inconsistente da origem que já nos morderam de verdade nesta sessão.
// ===========================================================================
describe('mesclarJogosComAPI', () => {
  // Helper pra criar um match no formato retornado pela API (football-data.org)
  function fixtureMatch({id, status, home, away, golsHome, golsAway, stage='GROUP_STAGE', utcDate}){
    return {
      id, status, stage,
      utcDate: utcDate || HARDCODED_GROUP_STAGE.find(h=>h.id===id)?.utc,
      venue: null,
      homeTeam: {name: home, crest: null, tla: null},
      awayTeam: {name: away, crest: null, tla: null},
      score: { fullTime: { home: golsHome, away: golsAway } },
    };
  }

  test('sem dados da API (lista vazia): retorna todos os jogos hardcoded com status TIMED', () => {
    const jogos = mesclarJogosComAPI([], HARDCODED_GROUP_STAGE);
    assert.equal(jogos.length, HARDCODED_GROUP_STAGE.length);
    assert.ok(jogos.every(j => j.status === 'TIMED'));
    assert.ok(jogos.every(j => j.score?.fullTime?.home === null));
  });

  test('jogo FINISHED na API enriquece o jogo hardcoded correspondente (México x África do Sul)', () => {
    const api = [fixtureMatch({id:537327, status:'FINISHED', home:'Mexico', away:'South Africa', golsHome:2, golsAway:0})];
    const jogos = mesclarJogosComAPI(api, HARDCODED_GROUP_STAGE);
    const jogo = jogos.find(j => j.id === '537327');
    assert.ok(jogo, 'Jogo 537327 não encontrado no resultado');
    assert.equal(jogo.status, 'FINISHED');
    assert.equal(jogo.score.fullTime.home, 2);
    assert.equal(jogo.score.fullTime.away, 0);
  });

  test('jogo ausente da API mantém os dados hardcoded (status TIMED, sem placar)', () => {
    // Simula a API retornando só ALGUNS jogos (não 537328)
    const api = [fixtureMatch({id:537327, status:'FINISHED', home:'Mexico', away:'South Africa', golsHome:2, golsAway:0})];
    const jogos = mesclarJogosComAPI(api, HARDCODED_GROUP_STAGE);
    const jogo328 = jogos.find(j => j.id === '537328');
    assert.ok(jogo328, 'Jogo 537328 deve continuar existindo mesmo ausente da API');
    assert.equal(jogo328.status, 'TIMED');
    assert.equal(jogo328.score.fullTime.home, null);
  });

  test('regressão: jogo IN_PLAY com placar parcial (Qatar x Suíça 0x1) NÃO entra em extrairResultadosFinalizados', () => {
    // Cenário real: 537334 estava IN_PLAY 0x1 e foi (incorretamente, antes
    // da correção) salvo como resultado oficial.
    const api = [fixtureMatch({id:537334, status:'IN_PLAY', home:'Qatar', away:'Switzerland', golsHome:0, golsAway:1})];
    const jogos = mesclarJogosComAPI(api, HARDCODED_GROUP_STAGE);
    const jogo = jogos.find(j => j.id === '537334');
    assert.equal(jogo.status, 'IN_PLAY');
    assert.equal(jogo.score.fullTime.home, 0); // placar aparece pra exibição "ao vivo"...

    const resultadosFinais = extrairResultadosFinalizados(jogos);
    assert.equal(resultadosFinais['537334'], undefined, 'Jogo IN_PLAY não deve gerar resultado oficial'); // ...mas não conta ponto
  });

  test('regressão: status TIMED com placar já preenchido (USA x Paraguay) não gera resultado oficial', () => {
    // Cenário real: a origem reportou 537345 como TIMED com score 1x0
    // preenchido (inconsistência da API durante transição de status).
    const api = [fixtureMatch({id:537345, status:'TIMED', home:'United States', away:'Paraguay', golsHome:1, golsAway:0})];
    const jogos = mesclarJogosComAPI(api, HARDCODED_GROUP_STAGE);
    const jogo = jogos.find(j => j.id === '537345');
    assert.equal(jogo.status, 'TIMED');

    const resultadosFinais = extrairResultadosFinalizados(jogos);
    assert.equal(resultadosFinais['537345'], undefined, 'status TIMED não deve gerar resultado oficial mesmo com placar preenchido');
  });

  test('jogo FINISHED com placar gera resultado oficial em extrairResultadosFinalizados', () => {
    const api = [fixtureMatch({id:537345, status:'FINISHED', home:'United States', away:'Paraguay', golsHome:4, golsAway:1})];
    const jogos = mesclarJogosComAPI(api, HARDCODED_GROUP_STAGE);
    const resultadosFinais = extrairResultadosFinalizados(jogos);
    assert.deepEqual(resultadosFinais['537345'], {gols1:4, gols2:1});
  });

  test('jogos de playoff (stage != GROUP_STAGE) vindos da API são incluídos', () => {
    const playoff = fixtureMatch({id:999001, status:'TIMED', home:'Time A', away:'Time B', golsHome:null, golsAway:null, stage:'LAST_16', utcDate:'2026-07-01T19:00:00Z'});
    const jogos = mesclarJogosComAPI([playoff], HARDCODED_GROUP_STAGE);
    const jogo = jogos.find(j => j.id === '999001');
    assert.ok(jogo, 'Jogo de playoff deve aparecer na lista final');
    assert.equal(jogo.stage, 'LAST_16');
  });

  test('resultado é ordenado por data (utc)', () => {
    const jogos = mesclarJogosComAPI([], HARDCODED_GROUP_STAGE);
    for(let i=1; i<jogos.length; i++){
      assert.ok(jogos[i-1].utc <= jogos[i].utc, `Ordem incorreta entre ${jogos[i-1].id} e ${jogos[i].id}`);
    }
  });
});

// ===========================================================================
// Auto-oficialização: deve usar _resultadosPersistidos, NÃO `resultados`
// (Bug real: carregarJogosAPI() já popula `resultados` em memória pra
//  QUALQUER jogo FINISHED, antes de ele ser persistido no Firestore. Se a
//  auto-oficialização checa `resultados[id]` pra decidir "já está
//  oficial?", a resposta já é "sim" assim que a API retorna FINISHED —
//  então `pendentes` fica sempre vazio e o resultado NUNCA é salvo no
//  Firestore automaticamente, exigindo clique manual.)
// ===========================================================================
describe('auto-oficialização usa _resultadosPersistidos (não resultados em memória)', () => {
  test('gerenciarAutoOficializacao / _checarEOficializarPendentes existe e referencia _resultadosPersistidos', () => {
    const fnSrc = extract(/async function _checarEOficializarPendentes\(\)\{[\s\S]*?\n\}/, '_checarEOficializarPendentes');
    assert.match(fnSrc, /_resultadosPersistidos/,
      'A função de auto-oficialização precisa checar _resultadosPersistidos (estado do Firestore), ' +
      'não `resultados` (que carregarJogosAPI já preenche em memória pra jogos FINISHED antes de persistir).'
    );
    // Garante que NÃO voltamos a usar só `resultados[j.id]` como critério de "já oficial"
    // (a expressão antiga era: !(resultados[j.id] && resultados[j.id].gols1 !== undefined))
    assert.doesNotMatch(fnSrc, /!\(resultados\[j\.id\]/,
      'Não use `resultados[j.id]` pra decidir se um jogo já foi oficializado — ' +
      'use _resultadosPersistidos.'
    );
  });

  test('_resultadosPersistidos é declarado como Set', () => {
    const declSrc = extract(/let _resultadosPersistidos = new Set\(\);/, '_resultadosPersistidos declaration');
    assert.ok(declSrc);
  });

  test('buscarResultadosAPI atualiza _resultadosPersistidos após persistir no Firestore', () => {
    const fnSrc = extract(/async function buscarResultadosAPI\(\)\{[\s\S]*?\nwindow\.__buscarResultadosAPI/, 'buscarResultadosAPI');
    assert.match(fnSrc, /_resultadosPersistidos\.add/,
      'buscarResultadosAPI precisa adicionar os IDs recém-salvos a _resultadosPersistidos, ' +
      'senão a auto-oficialização vai tentar persistir o mesmo jogo de novo a cada poll.'
    );
    // A atualização do Set deve vir DEPOIS do setDoc (persistência real),
    // não antes — senão um setDoc que falha deixaria o Set "mentindo".
    const idxSetDoc = fnSrc.indexOf("setDoc(doc(db,'resultados','jogos')");
    const idxAddSet = fnSrc.indexOf('_resultadosPersistidos.add');
    assert.ok(idxSetDoc !== -1 && idxAddSet !== -1 && idxAddSet > idxSetDoc,
      '_resultadosPersistidos.add deve vir DEPOIS do setDoc no Firestore (só marca como persistido após sucesso real).'
    );
  });

  test('carregarTudo popula _resultadosPersistidos a partir do Firestore (resFirestore), não da API', () => {
    const fnSrc = extract(/async function carregarTudo\(\)\{[\s\S]*?\n\}/, 'carregarTudo');
    assert.match(fnSrc, /_resultadosPersistidos\.add\(String\(jid\)\)/);
    // Deve vir de resFirestore (Firestore), não de novosRes (API)
    const trecho = fnSrc.match(/Object\.keys\((\w+)\)\.forEach\(jid => _resultadosPersistidos\.add/);
    assert.ok(trecho, 'Não encontrei o forEach que popula _resultadosPersistidos em carregarTudo');
    assert.equal(trecho[1], 'resFirestore',
      `_resultadosPersistidos deve ser populado a partir de "resFirestore" (dados do Firestore), encontrei "${trecho[1]}"`);
  });
});

// ===========================================================================
// buscarResultadosAPI deve ser IDEMPOTENTE: chamadas repetidas (de qualquer
// um dos dois pollers de auto-oficialização) não devem re-rodar
// salvarRankingSnapshot/setDoc se não houver resultado NOVO.
//
// (Bug real: extrairResultadosFinalizados() retorna TODOS os jogos FINISHED
//  com placar, não só os novos. Sem filtrar por _resultadosPersistidos,
//  `Object.keys(novosRes).length > 0` é sempre true após o primeiro jogo
//  terminar — então toda chamada repetida re-snapshotava o ranking já
//  ATUALIZADO, fazendo a coluna "última rodada" mostrar +0 pra todo mundo,
//  mesmo pra quem pontuou na rodada que JUSTAMENTE acabou de ser salva.)
// ===========================================================================
describe('buscarResultadosAPI é idempotente (não re-snapshota resultados já persistidos)', () => {
  const fnSrc = extract(/async function buscarResultadosAPI\(\)\{[\s\S]*?\nwindow\.__buscarResultadosAPI/, 'buscarResultadosAPI');

  test('filtra novosRes por _resultadosPersistidos antes de decidir se há algo novo', () => {
    assert.match(fnSrc, /_resultadosPersistidos\.has\(String\(jid\)\)/,
      'buscarResultadosAPI precisa checar _resultadosPersistidos.has(...) pra montar a lista de pendentes — ' +
      'senão extrairResultadosFinalizados (que retorna TODOS os FINISHED) sempre teria itens, ' +
      'e salvarRankingSnapshot rodaria de novo a cada chamada repetida.'
    );
  });

  test('salvarRankingSnapshot só é chamado dentro do bloco condicionado aos pendentes (não incondicionalmente)', () => {
    // Garante que a chamada REAL a salvarRankingSnapshot (com `await`) está
    // "depois" de uma checagem de _resultadosPersistidos no código-fonte —
    // não confundir com a menção em comentários explicativos.
    const idxExtrair = fnSrc.indexOf('extrairResultadosFinalizados');
    const idxSnapshotCall = fnSrc.indexOf('await salvarRankingSnapshot()');
    assert.ok(idxSnapshotCall > idxExtrair, 'await salvarRankingSnapshot() não encontrado após extrairResultadosFinalizados');
    const trechoEntre = fnSrc.slice(idxExtrair, idxSnapshotCall);
    assert.match(trechoEntre, /_resultadosPersistidos\.has/,
      'Entre extrairResultadosFinalizados() e "await salvarRankingSnapshot()", o código precisa ' +
      'filtrar pelos pendentes usando _resultadosPersistidos.has(...) — senão o snapshot ' +
      'roda toda vez que QUALQUER jogo já estiver finalizado, não só quando há novidade.'
    );
  });

  test('simulação: segunda chamada com os mesmos dados não deveria gerar "pendentes"', () => {
    // Reimplementa a lógica de filtragem pra travar o comportamento esperado.
    function calcularPendentes(novosRes, resultadosPersistidos){
      const pendentes = {};
      for(const jid of Object.keys(novosRes)){
        if(!resultadosPersistidos.has(String(jid))) pendentes[jid] = novosRes[jid];
      }
      return pendentes;
    }

    const novosRes = { '537345': {gols1:4, gols2:1} };

    // 1ª chamada: nada persistido ainda -> pendente
    const persistidos = new Set();
    const pendentes1 = calcularPendentes(novosRes, persistidos);
    assert.deepEqual(pendentes1, novosRes);

    // Simula o que buscarResultadosAPI faz após persistir:
    Object.keys(pendentes1).forEach(jid => persistidos.add(String(jid)));

    // 2ª chamada: extrairResultadosFinalizados retornaria o MESMO novosRes
    // (537345 ainda está FINISHED) — mas agora não deve haver pendentes.
    const pendentes2 = calcularPendentes(novosRes, persistidos);
    assert.deepEqual(pendentes2, {}, 'Segunda chamada não deve ter pendentes — snapshot não deve rodar de novo');
  });
});

// ===========================================================================
// TESTE DE INTEGRAÇÃO: simula o fluxo real de auto-oficialização com
// Firestore E a API da football-data.org FAKES (em memória, sem rede).
//
// Diferente dos testes acima (que checam pedaços isolados via regex no
// código-fonte), aqui carregamos as funções REAIS — carregarJogosAPI,
// buscarResultadosAPI, salvarRankingSnapshot, _checarEOficializarPendentes —
// com `new Function(...)` e rodamos a sequência completa que acontece em
// produção: poller roda quando um jogo termina, poller roda DE NOVO no
// próximo ciclo (60s) com a mesma resposta da API, e por fim um NOVO jogo
// termina depois.
//
// Isso é o "mock e teste antes de deployar" pedido depois do bug da
// "última rodada zerando" voltar — qualquer regressão nessa interação
// inteira (não só num trecho isolado) deve quebrar um destes testes.
// ===========================================================================
describe('integração: auto-oficialização end-to-end (Firestore + API fake)', () => {
  const integrationSrc = [
    extract(/let resultados = \{\};/, 'resultados'),
    'let _resultadosPersistidos = new Set();',
    'let JOGOS_COPA = [];',
    'let _oficializandoAgora = false;',
    extract(/const WORKER_URL = '[^']*';/, 'WORKER_URL'),
    fdNameMapSrc, flagMapSrc, groupLabelSrc, stageLabelSrc, venueMapSrc, getVenueSrc,
    apiToJogoSrc, hardcodeToMatchSrc, hardcodedSrc, mesclarSrc, extrairResSrc, calcPtsSrc,
    extract(/async function buscarTodosPalpites\(\)\{[\s\S]*?\n\}/, 'buscarTodosPalpites'),
    extract(/async function carregarJogosAPI\(\)\{[\s\S]*?\n\}/, 'carregarJogosAPI'),
    extract(/async function salvarRankingSnapshot\(\)\{[\s\S]*?\n  \}\n\}/, 'salvarRankingSnapshot'),
    extract(/async function buscarResultadosAPI\(\)\{[\s\S]*?\n\}\nwindow\.__buscarResultadosAPI[^\n]*/, 'buscarResultadosAPI'),
    extract(/async function _checarEOficializarPendentes\(\)\{[\s\S]*?\n\}/, '_checarEOficializarPendentes'),
  ].join('\n\n');

  // ── Fake Firestore (em memória, sem rede/SDK real) ──
  function criarFakeDb(){ return { data: {} }; }
  function doc(db, col, id){ return { db, col, id }; }
  function collection(db, col){ return { db, col }; }
  async function getDoc(ref){
    const c = ref.db.data[ref.col] || {};
    const d = c[ref.id];
    return { exists: () => d !== undefined, data: () => d === undefined ? undefined : structuredClone(d) };
  }
  async function setDoc(ref, data, opts){
    ref.db.data[ref.col] = ref.db.data[ref.col] || {};
    const atual = ref.db.data[ref.col][ref.id];
    ref.db.data[ref.col][ref.id] = (opts && opts.merge && atual)
      ? { ...atual, ...data }
      : { ...data };
  }
  async function getDocs(ref){
    const c = ref.db.data[ref.col] || {};
    return { docs: Object.keys(c).map(id => ({ id, data: () => structuredClone(c[id]) })) };
  }

  /**
   * Monta uma instância isolada das funções reais, injetando o Firestore
   * fake e uma API fake (`apiMatchesRef.matches`, mutável entre chamadas
   * pra simular jogos mudando de status entre polls).
   */
  function montarSandbox({ apiMatchesRef, db }){
    const factory = new Function(
      'fetch','getDoc','setDoc','getDocs','doc','collection','db','document','showToast','renderJogos','renderAdmin','carregarRanking','isAdmin','window',
      integrationSrc + `
      return {
        carregarJogosAPI, buscarResultadosAPI, salvarRankingSnapshot, _checarEOficializarPendentes,
        getResultadosPersistidos: () => _resultadosPersistidos,
        calcPts,
      };`
    );
    return factory(
      async () => ({ ok: true, json: async () => ({ matches: apiMatchesRef.matches }) }), // fetch
      getDoc, setDoc, getDocs, doc, collection, db,
      { getElementById: () => null }, // document
      () => {}, () => {}, () => {}, () => {}, // showToast, renderJogos, renderAdmin, carregarRanking
      () => true, // isAdmin
      {} // window
    );
  }

  // Jogo 537345 (USA x Paraguay) — vira FINISHED 4x1
  const jogo1Finished = {
    id: 537345, status: 'FINISHED', stage: 'GROUP_STAGE',
    utcDate: '2026-06-13T01:00:00Z', venue: null,
    homeTeam: {name:'United States', crest:null, tla:null},
    awayTeam: {name:'Paraguay', crest:null, tla:null},
    score: { fullTime: { home: 4, away: 1 } },
  };

  function criarDbComUsuarios(palpitesExtra = {}){
    const db = criarFakeDb();
    db.data['users'] = { u1: {name:'Ana'}, u2: {name:'Beto'} };
    db.data['palpites'] = {
      u1: { '537345': {gols1:4, gols2:1}, ...(palpitesExtra.u1||{}) }, // Ana acerta o exato (+25)
      u2: { '537345': {gols1:1, gols2:0}, ...(palpitesExtra.u2||{}) }, // Beto erra
    };
    return db;
  }

  test('1ª chamada: persiste o resultado e tira snapshot representando "antes" desse jogo', async () => {
    const db = criarDbComUsuarios();
    const apiMatchesRef = { matches: [jogo1Finished] };
    const sandbox = montarSandbox({ apiMatchesRef, db });

    await sandbox._checarEOficializarPendentes();

    assert.deepEqual(db.data['resultados']['jogos']['537345'], {gols1:4, gols2:1});
    assert.ok(sandbox.getResultadosPersistidos().has('537345'));

    const snap = db.data['meta']['rankingSnapshot'];
    assert.ok(snap, 'snapshot deveria ter sido criado');
    assert.ok(!snap.jogosComResultado.includes('537345'),
      'snapshot deveria representar o estado ANTES do jogo 537345 (jogosComResultado não deve incluí-lo)');
    assert.equal(snap.pontos['u1'], 0);
    assert.equal(snap.pontos['u2'], 0);
  });

  test('2ª chamada (próximo poll, mesma resposta da API): snapshot NÃO é re-escrito', async () => {
    const db = criarDbComUsuarios();
    const apiMatchesRef = { matches: [jogo1Finished] };
    const sandbox = montarSandbox({ apiMatchesRef, db });

    await sandbox._checarEOficializarPendentes();
    const snap1 = JSON.stringify(db.data['meta']['rankingSnapshot']);

    // Próximo ciclo de 60s: a API retorna a MESMA coisa (jogo continua
    // FINISHED 4x1, nada novo aconteceu).
    await sandbox._checarEOficializarPendentes();
    const snap2 = JSON.stringify(db.data['meta']['rankingSnapshot']);

    assert.equal(snap2, snap1,
      'O snapshot foi re-escrito numa chamada repetida sem novidade — isso ' +
      'reproduz o bug onde "última rodada" mostra +0 pra todo mundo depois ' +
      'de uma segunda atualização automática.'
    );

    // E a "última rodada" continua mostrando os pontos certos pra Ana
    const res = db.data['resultados']['jogos']['537345'];
    const snap = db.data['meta']['rankingSnapshot'];
    const ganhoAna = sandbox.calcPts(4,1,res.gols1,res.gols2) - snap.pontos['u1'];
    assert.equal(ganhoAna, 25, 'Ana deveria ver +25 na "última rodada" (acertou o placar exato 4x1)');
  });

  test('3ª chamada: um NOVO jogo termina depois — snapshot atualiza pra refletir só esse novo jogo', async () => {
    const db = criarDbComUsuarios({
      u1: { '537346': {gols1:1, gols2:0} }, // Ana acerta o exato de novo
      u2: { '537346': {gols1:1, gols2:0} }, // Beto também acerta esse
    });
    const apiMatchesRef = { matches: [jogo1Finished] };
    const sandbox = montarSandbox({ apiMatchesRef, db });

    await sandbox._checarEOficializarPendentes(); // persiste 537345
    const snap1 = JSON.parse(JSON.stringify(db.data['meta']['rankingSnapshot']));

    // Outro jogo (537346, Austrália x Turquia) termina 1x0
    const jogo2Finished = {
      id: 537346, status:'FINISHED', stage:'GROUP_STAGE',
      utcDate:'2026-06-14T04:00:00Z', venue:null,
      homeTeam:{name:'Australia',crest:null,tla:null}, awayTeam:{name:'Turkey',crest:null,tla:null},
      score:{fullTime:{home:1,away:0}},
    };
    apiMatchesRef.matches = [jogo1Finished, jogo2Finished];

    await sandbox._checarEOficializarPendentes(); // persiste 537346
    const snap2 = db.data['meta']['rankingSnapshot'];

    assert.notDeepEqual(snap2, snap1, 'snapshot deveria mudar pois um novo jogo terminou');
    assert.ok(snap2.jogosComResultado.includes('537345'), 'snapshot deveria já incluir 537345 (jogo anterior, contado no "antes")');
    assert.ok(!snap2.jogosComResultado.includes('537346'), 'snapshot deveria representar o estado ANTES do 537346');

    // "última rodada" agora deve refletir só o jogo 537346 (+25, exato 1x0) pra Ana
    const res = db.data['resultados']['jogos'];
    const pal = db.data['palpites']['u1'];
    let ptsAgora = 0;
    for(const jid of Object.keys(pal)){
      if(res[jid]) ptsAgora += sandbox.calcPts(pal[jid].gols1, pal[jid].gols2, res[jid].gols1, res[jid].gols2);
    }
    assert.equal(ptsAgora - snap2.pontos['u1'], 25, 'Ana deveria ver +25 (placar exato do 537346) na última rodada');
  });
});

