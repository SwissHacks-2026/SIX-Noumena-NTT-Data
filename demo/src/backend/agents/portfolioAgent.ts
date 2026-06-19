import axios from 'axios';
import type { RawHolding, Holding } from '../../shared/types';

const SIX_TOKEN = process.env.SIX_MCP_TOKEN!;
const SIX_URL = process.env.SIX_MCP_URL!;

// In-memory price cache (60s TTL)
const priceCache = new Map<string, { price: number; currency: string; change: number; ts: number }>();
const CACHE_TTL = 60_000;

async function callSixTool(toolName: string, args: Record<string, unknown>) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
  const res = await axios.post(SIX_URL, body, {
    headers: {
      Authorization: `Bearer ${SIX_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    timeout: 10000,
  });

  // Handle SSE wrapping
  let data = res.data;
  if (typeof data === 'string') {
    const match = data.match(/data:\s*(\{[\s\S]*\})/);
    if (match) data = JSON.parse(match[1]);
  }

  const content = data?.result?.content;
  if (!content) return null;
  const text = Array.isArray(content) ? content.map((c: any) => c.text).join('') : content;
  return text;
}

async function getSIXPrice(valor: string, mic: string): Promise<{ price: number; currency: string; change: number } | null> {
  if (!valor || !mic) return null;
  const key = `${valor}_${mic}`;
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { price: cached.price, currency: cached.currency, change: cached.change };
  }
  try {
    const text = await callSixTool('end_of_day_snapshot', { listing_id: key });
    if (!text) return null;
    // Parse tab-delimited response
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return null;
    const headers = lines[0].split('\t').map((h: string) => h.trim());
    const vals = lines[1].split('\t').map((v: string) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h: string, i: number) => (row[h] = vals[i]));

    const price = parseFloat(row['Close'] || row['Last'] || row['Price'] || '0');
    const prev = parseFloat(row['PrevClose'] || row['PreviousClose'] || '0');
    const currency = row['Currency'] || row['Ccy'] || 'CHF';
    const change = prev > 0 ? ((price - prev) / prev) * 100 : 0;

    if (price > 0) {
      priceCache.set(key, { price, currency, change, ts: Date.now() });
      return { price, currency, change };
    }
    return null;
  } catch {
    return null;
  }
}

async function getYahooPrice(ticker: string): Promise<{ price: number; currency: string; change: number } | null> {
  if (!ticker) return null;
  const cached = priceCache.get(`yahoo_${ticker}`);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { price: cached.price, currency: cached.currency, change: cached.change };
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
    const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const result = res.data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const price = meta.regularMarketPrice || meta.previousClose;
    const prev = meta.chartPreviousClose || meta.previousClose;
    const currency = meta.currency || 'USD';
    const change = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    if (price > 0) {
      priceCache.set(`yahoo_${ticker}`, { price, currency, change, ts: Date.now() });
      return { price, currency, change };
    }
    return null;
  } catch {
    return null;
  }
}

export async function enrichHoldings(rawHoldings: RawHolding[]): Promise<Holding[]> {
  const equities = rawHoldings.filter(h => h.ISIN && h['Asset Class'] === 'Equities');

  const totalCHF = rawHoldings.reduce((s, h) => s + (h['Current (CHF)'] || 0), 0);

  // Enrich up to 15 equity positions in parallel (avoid rate limits)
  const priceResults = await Promise.all(
    equities.slice(0, 15).map(async (h) => {
      let priceData = null;
      let source: 'SIX' | 'Yahoo' | 'stored' = 'stored';

      if (h.Valor && h.MIC) {
        priceData = await getSIXPrice(h.Valor, h.MIC);
        if (priceData) source = 'SIX';
      }
      if (!priceData && h['Yahoo Ticker']) {
        priceData = await getYahooPrice(h['Yahoo Ticker']);
        if (priceData) source = 'Yahoo';
      }

      return { isin: h.ISIN, priceData, source };
    })
  );

  const priceMap = new Map(priceResults.map(r => [r.isin, r]));

  return rawHoldings
    .filter(h => h.ISIN)
    .map(h => {
      const enriched = priceMap.get(h.ISIN);
      const priceData = enriched?.priceData ?? null;
      return {
        isin: h.ISIN,
        name: h['Issuer / Asset'],
        assetClass: h['Asset Class'],
        subAssetClass: h['Sub-Asset Class'],
        industryGroup: h['Industry Group'],
        region: h.Region,
        ticker: h['Yahoo Ticker'],
        valor: h.Valor,
        mic: h.MIC,
        targetCHF: h['Target (CHF)'] || 0,
        currentCHF: h['Current (CHF)'] || 0,
        currentPrice: priceData?.price ?? null,
        currency: priceData?.currency ?? 'CHF',
        priceChange: priceData ? (priceData.price * (1 - priceData.change / 100)) - priceData.price : null,
        priceChangePercent: priceData?.change ?? null,
        portfolioWeight: totalCHF > 0 ? ((h['Current (CHF)'] || 0) / totalCHF) * 100 : 0,
        priceSource: enriched?.source ?? 'stored',
      } as Holding;
    });
}
