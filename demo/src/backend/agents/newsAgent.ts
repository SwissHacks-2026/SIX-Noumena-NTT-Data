import axios from 'axios';
import type { ClientDNA, Holding, NewsAlert } from '../../shared/types';

const NEWSAPI_KEY = process.env.NEWSAPI_KEY!;
const NEWSAI_URL = process.env.NEWSAI_API_URL!;

// 15-minute cache for real news
const newsCache = new Map<string, { alerts: NewsAlert[]; ts: number }>();
const CACHE_TTL = 15 * 60_000;

// ── Demo trigger events (always injected for reliable demo) ───────────────────
const MOCK_TRIGGERS: Record<string, NewsAlert> = {
  schneider: {
    id: 'mock-schneider-001',
    headline: 'Roche Holding AG schliesst neurologische Forschungsabteilung — strategischer Rückzug aus ZNS-Bereich',
    summary:
      'Roche Holding AG hat angekündigt, seine gesamte Abteilung für neurologische und ZNS-Forschung zum Ende des Quartals zu schliessen. Das Unternehmen begründet den Schritt mit einer strategischen Neuausrichtung auf Onkologie und seltene Krankheiten. Alle laufenden Parkinson- und Alzheimer-Forschungsprogramme werden eingestellt.',
    source: 'Reuters',
    publishedAt: '2026-05-28T09:15:00Z',
    url: 'https://reuters.com/mock/roche-neuro-closure',
    sentiment: 'negative',
    sentimentScore: -0.82,
    relevanceScore: 0.97,
    affectedISINs: ['CH0012032048'],
    affectedSectors: ['Health Care', 'Pharmaceuticals'],
    alertType: 'conflict',
    isMock: true,
  },
  raeber: {
    id: 'mock-raeber-001',
    headline: 'Private Banking CIO Tactical Update: Shift from Defensive Value to US Technology Mega-Caps',
    summary:
      'The CIO office has issued a tactical asset allocation update for Q3 2026, recommending a reduction in Defensive Value (Consumer Staples & Healthcare) exposure by 8-12% to fund positions in Microsoft, Apple, NVIDIA, and Alphabet. The update cites AI-driven productivity tailwinds and recommends immediate portfolio rebalancing for all mandates.',
    source: 'Internal CIO Research',
    publishedAt: '2026-05-15T08:00:00Z',
    sentiment: 'neutral',
    sentimentScore: 0.1,
    relevanceScore: 0.95,
    affectedISINs: [],
    affectedSectors: ['Consumer Staples', 'Health Care'],
    alertType: 'mandate_conflict',
    isMock: true,
  },
  huber: {
    id: 'mock-huber-001',
    headline: 'Unilever Announces Historic Palm Oil Policy: Zero-Deforestation Supplier Cut-Off and €80M Brazilian Reforestation Foundation',
    summary:
      'Unilever PLC has announced an industry-first commitment: all suppliers linked to palm oil deforestation will be removed from the supply chain by December 2026. Simultaneously, Unilever launches the "Unilever Amazon Restoration Foundation" with an €80M initial endowment to fund reforestation of degraded rainforest in the Amazon basin, in direct partnership with local conservation organizations.',
    source: 'Financial Times',
    publishedAt: '2026-05-22T10:30:00Z',
    url: 'https://ft.com/mock/unilever-deforestation',
    sentiment: 'positive',
    sentimentScore: 0.91,
    relevanceScore: 0.98,
    affectedISINs: ['GB00B10RZP78'],
    affectedSectors: ['Consumer Staples', 'ESG'],
    alertType: 'opportunity',
    isMock: true,
  },
  ammann: {
    id: 'mock-ammann-001',
    headline: 'Amazon Hit by Federal Labour Investigation: Systematic Wage Theft and Safety Violations in US Distribution Centres',
    summary:
      'The US Department of Labor has opened a formal investigation into Amazon.com Inc. following evidence of systematic wage theft, illegal overtime practices, and unreported safety violations across 23 distribution centres in 14 states. Judicial documents allege over 18,000 affected workers and potential back-pay liability exceeding USD 340M. The Senate Labour Committee has scheduled emergency hearings.',
    source: 'Wall Street Journal',
    publishedAt: '2026-06-03T11:45:00Z',
    url: 'https://wsj.com/mock/amazon-labour-scandal',
    sentiment: 'negative',
    sentimentScore: -0.89,
    relevanceScore: 0.96,
    affectedISINs: ['US0231351067'],
    affectedSectors: ['Consumer Discretionary', 'Technology'],
    alertType: 'conflict',
    isMock: true,
  },
};

async function fetchRealNews(query: string, limit = 5): Promise<NewsAlert[]> {
  const cacheKey = query.toLowerCase().replace(/\s+/g, '_').slice(0, 60);
  const cached = newsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.alerts;

  try {
    const res = await axios.post(
      `${NEWSAI_URL}/article/getArticles`,
      {
        apiKey: NEWSAPI_KEY,
        keyword: query,
        articlesCount: limit,
        articlesSortBy: 'date',
        articlesSortByAsc: false,
        dataType: ['news'],
        lang: 'eng',
        resultType: 'articles',
        includeArticleTitle: true,
        includeArticleSummary: true,
        includeArticleEventUri: true,
        includeArticleSource: true,
        includeArticleBasicInfo: true,
        includeArticleSentiment: true,
      },
      { timeout: 8000 }
    );

    const articles = res.data?.articles?.results ?? [];
    const alerts: NewsAlert[] = articles.map((a: any, i: number) => ({
      id: `real-${cacheKey}-${i}`,
      headline: a.title || '',
      summary: (a.summary || a.body || '').slice(0, 350),
      source: a.source?.title || 'News',
      publishedAt: a.dateTime || new Date().toISOString(),
      url: a.url,
      sentiment: a.sentiment > 0.15 ? 'positive' : a.sentiment < -0.15 ? 'negative' : 'neutral',
      sentimentScore: a.sentiment ?? 0,
      relevanceScore: 0.6,
      affectedISINs: [],
      affectedSectors: [],
      alertType: 'market' as const,
      isMock: false,
    }));

    newsCache.set(cacheKey, { alerts, ts: Date.now() });
    return alerts;
  } catch {
    return [];
  }
}

async function scoreLLMRelevance(
  alert: NewsAlert,
  dna: ClientDNA
): Promise<number> {
  // Simple heuristic scoring against DNA (no LLM call for speed)
  const text = `${alert.headline} ${alert.summary}`.toLowerCase();
  let score = alert.relevanceScore;

  for (const priority of dna.values.priorities) {
    if (text.includes(priority.toLowerCase().split(' ')[0])) score = Math.min(1, score + 0.05);
  }
  for (const redLine of dna.values.redLines) {
    if (text.includes(redLine.toLowerCase().split(' ')[0])) score = Math.min(1, score + 0.1);
  }
  for (const esg of dna.values.esgFocus) {
    if (text.includes(esg.toLowerCase().split(' ')[0])) score = Math.min(1, score + 0.05);
  }

  return Math.round(score * 100) / 100;
}

export async function fetchRelevantAlerts(
  clientId: string,
  dna: ClientDNA,
  holdings: Holding[]
): Promise<NewsAlert[]> {
  const results: NewsAlert[] = [];

  // Always inject the mock trigger for this client
  const mockTrigger = MOCK_TRIGGERS[clientId];
  if (mockTrigger) results.push(mockTrigger);

  // Build real news queries from top equity holdings
  const equities = holdings
    .filter(h => h.assetClass === 'Equities' && h.ticker)
    .slice(0, 5);

  const realNewsPromises = equities.map(h =>
    fetchRealNews(`${h.name} ${h.industryGroup || ''}`.trim(), 3)
  );
  const realNewsArrays = await Promise.all(realNewsPromises);
  const realNews = realNewsArrays.flat();

  // Score and filter
  const scored = await Promise.all(
    realNews.map(async a => ({ ...a, relevanceScore: await scoreLLMRelevance(a, dna) }))
  );

  const relevant = scored
    .filter(a => a.relevanceScore >= 0.5)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 4);

  results.push(...relevant);
  return results;
}
