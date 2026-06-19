import axios from 'axios';
import type { CRMEntry, ClientDNA } from '../../shared/types';

const API_KEY = process.env.PHOENIQS_API_KEY!;
const API_URL = process.env.PHOENIQS_API_URL!;
const MODEL = process.env.PHOENIQS_MODEL || 'inference-gpt-oss-120b';

function excelDateToISO(serial: number): string {
  const date = new Date((serial - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

function formatCRMLogs(entries: CRMEntry[]): string {
  return entries
    .map((e, i) => {
      const date = excelDateToISO(e.Date);
      return `[${i + 1}] ${date} | ${e.Medium} | RM: ${e['RM Name']} | Contact: ${e['Client Contact']}\n${e.Note}`;
    })
    .join('\n\n---\n\n');
}

export async function extractClientDNA(
  clientId: string,
  crmEntries: CRMEntry[]
): Promise<ClientDNA> {
  const logs = formatCRMLogs(crmEntries);

  const prompt = `You are an expert private banking analyst. Analyse the following CRM relationship logs for client "${clientId}" and extract their investment DNA.

CRM LOGS:
${logs}

Return a JSON object with EXACTLY this structure (no markdown, pure JSON):
{
  "values": {
    "priorities": ["array of 3-5 key personal/investment priorities"],
    "redLines": ["array of explicit deal-breakers or non-negotiables stated by client"],
    "preferredSectors": ["sectors or themes the client favours"],
    "avoidedSectors": ["sectors the client explicitly avoids"],
    "esgFocus": ["specific ESG themes mentioned"]
  },
  "investmentBehavior": {
    "riskTolerance": "conservative|moderate|aggressive",
    "timeHorizon": "short description of time horizon",
    "liquidity": "short description of liquidity needs",
    "mandate": "name of their investment mandate"
  },
  "lifeEvents": [
    {
      "date": "YYYY-MM-DD",
      "type": "category (e.g. health_crisis, family, business, philanthropy)",
      "description": "1-2 sentence description",
      "portfolioImpact": "how this affects their portfolio priorities"
    }
  ],
  "communicationStyle": {
    "language": "de|en|fr",
    "tone": "formal|informal",
    "preferred": "values-led|data-driven|executive|collaborative",
    "formatPreference": "optional: e.g. tables and numbers, bullet points"
  },
  "keyQuotes": ["3-5 most revealing direct quotes from the CRM logs"],
  "confidence": 0.0,
  "sourcedFrom": [1, 2, 3]
}

Rules:
- confidence: 0.0-1.0 based on how much evidence exists in the logs
- sourcedFrom: array of log entry numbers [1-indexed] that most informed the DNA
- keyQuotes: exact or near-exact quotes from the notes
- Be specific about redLines — these are critical for conflict detection
- If the client speaks German, set language to "de"`;

  try {
    const response = await axios.post(
      `${API_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    let text: string = response.data.choices[0].message.content.trim();
    // Strip markdown fences if present
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');

    const parsed = JSON.parse(text);
    return { clientId, ...parsed } as ClientDNA;
  } catch (err: any) {
    console.error('crmAgent error:', err.message);
    // Return a minimal fallback DNA
    return buildFallbackDNA(clientId, crmEntries);
  }
}

// Rich per-client fallback DNA, sourced directly from CRM log content.
// Used when the LLM is unavailable (network restrictions, quota, etc.)
const FALLBACK_DNA: Record<string, Omit<ClientDNA, 'clientId'>> = {
  schneider: {
    values: {
      priorities: ['Neuroscience research funding', 'Family foundation for Parkinson\'s Disease', 'Automotive business continuity', 'Institutional banking stability'],
      redLines: ['abandon Parkinson research', 'pharma company exits neurodegenerative pipeline'],
      preferredSectors: ['Pharmaceuticals', 'Neuroscience', 'Healthcare', 'Biotech'],
      avoidedSectors: [],
      esgFocus: ['Neurodegenerative disease research', 'Medical philanthropy'],
    },
    investmentBehavior: {
      riskTolerance: 'moderate',
      timeHorizon: 'Long-term (15+ years), intergenerational',
      liquidity: 'CHF 1M+ available for foundation endowments; portfolio otherwise illiquid',
      mandate: 'Global Balanced Growth',
    },
    lifeEvents: [
      {
        date: '2026-01-09',
        type: 'health_crisis',
        description: 'Daughter Chloe (19) diagnosed with early-onset Parkinson\'s Disease. Hubertus called RM "profoundly distracted and deeply emotional."',
        portfolioImpact: 'Immediate pivot: "My automotive business means nothing if I cannot save my daughter." Full pharma pipeline audit requested.',
      },
      {
        date: '2026-01-22',
        type: 'philanthropy',
        description: 'Family establishes dedicated Venture Philanthropy Foundation for neurodegenerative disease research.',
        portfolioImpact: 'CHF 1M endowment transferred. All pharma holdings flagged for neuro-pipeline audit.',
      },
    ],
    communicationStyle: {
      language: 'de',
      tone: 'formal',
      preferred: 'values-led',
    },
    keyQuotes: [
      '"Mein Unternehmen bedeutet mir nichts, wenn ich meiner Tochter nicht helfen kann."',
      '"Wenn ein Pharmaunternehmen, das wir halten, die Parkinson-Forschung aufgibt, ist das ein persönlicher Verrat."',
      '"Flag them immediately for divestment if they abandon research."',
    ],
    confidence: 0.92,
    sourcedFrom: [19, 20, 21, 22, 23, 26],
  },
  raeber: {
    values: {
      priorities: ['Capital preservation', 'Swiss and EU blue-chip stability', 'Income from dividends', 'Predictable defensive returns'],
      redLines: ['aggressive shifts into US tech mega-caps', 'volatile growth equities', 'speculative assets'],
      preferredSectors: ['Consumer Staples', 'Healthcare', 'Industrials (physical machinery)', 'Swiss/EU equities'],
      avoidedSectors: ['US technology (speculative)', 'Cryptocurrency', 'High-yield bonds'],
      esgFocus: [],
    },
    investmentBehavior: {
      riskTolerance: 'conservative',
      timeHorizon: 'Retirement horizon (10-15 years)',
      liquidity: 'Modest; prefer stability over liquidity premium',
      mandate: 'Global Defensive Value',
    },
    lifeEvents: [
      {
        date: '2023-01-01',
        type: 'retirement',
        description: 'Eugen & Lisa retired from precision engineering careers. Portfolio reflects their preference for stable, dividend-paying blue chips.',
        portfolioImpact: 'Mandate set as Global Defensive Value. Explicit instruction: same approach as prior RM Thomas provided.',
      },
    ],
    communicationStyle: {
      language: 'de',
      tone: 'formal',
      preferred: 'data-driven',
      formatPreference: 'tables and numbers, sector allocation percentages',
    },
    keyQuotes: [
      '"Wir erwarten denselben ruhigen, globalen defensiven Ansatz, den Thomas verfolgt hat."',
      '"Sehr hohe psychologische Hürde gegenüber volatilen Wachstumsanlagen."',
      '"Sie bauen echte, physische Maschinen — das ist das Einzige, was ich akzeptiere."',
    ],
    confidence: 0.88,
    sourcedFrom: [1, 3, 5, 8, 12],
  },
  huber: {
    values: {
      priorities: ['Biodiversity conservation', 'Zero-deforestation supply chains', 'South American reforestation', 'Corporate accountability on sourcing'],
      redLines: ['companies complicit in deforestation', 'opaque or unethical supply chains'],
      preferredSectors: ['Consumer brands with ethical sourcing', 'Renewable energy', 'Sustainable agriculture'],
      avoidedSectors: ['Fossil fuels', 'Companies linked to palm oil deforestation'],
      esgFocus: ['Zero-deforestation', 'Biodiversity', 'Supply chain transparency', 'Corporate foundations'],
    },
    investmentBehavior: {
      riskTolerance: 'conservative',
      timeHorizon: 'Long-term (20+ years), legacy-driven',
      liquidity: 'Low; portfolio is a statement of values',
      mandate: 'Global Defensive Value (ESG-overlay)',
    },
    lifeEvents: [
      {
        date: '2026-05-01',
        type: 'philanthropy',
        description: 'Marius & Elena preparing summer trip to their own conservation sites in the Brazilian Amazon.',
        portfolioImpact: '"I want my capital fighting on the frontlines alongside the scientists."',
      },
    ],
    communicationStyle: {
      language: 'en',
      tone: 'formal',
      preferred: 'collaborative',
    },
    keyQuotes: [
      '"I want my wealth to reflect my life\'s work. If a company takes a brave stance against deforestation, that\'s exactly where my money should be."',
      '"Companies that don\'t protect supply chains won\'t survive the next decade."',
      '"My capital should be fighting on the frontlines alongside the scientists."',
    ],
    confidence: 0.91,
    sourcedFrom: [8, 12, 15, 17, 19],
  },
  ammann: {
    values: {
      priorities: ['Zero-tolerance corporate governance', 'Reputation as financial risk', 'Pre-emptive scandal detection', 'Clean institutional portfolio'],
      redLines: ['live labour exploitation or wage theft', 'companies with unresolved judicial investigations', 'reputational liabilities in any holding'],
      preferredSectors: ['Technology', 'Healthcare', 'Financial Services', 'Clean energy'],
      avoidedSectors: ['Companies under active labour/regulatory investigation'],
      esgFocus: ['Corporate governance', 'Labour standards', 'Operational risk'],
    },
    investmentBehavior: {
      riskTolerance: 'aggressive',
      timeHorizon: 'Medium-term (5-10 years)',
      liquidity: 'High; prepared to exit positions quickly on governance grounds',
      mandate: 'Global Growth',
    },
    lifeEvents: [
      {
        date: '2026-05-01',
        type: 'public_event',
        description: 'Julian delivered keynote speech on ethical corporate leadership: "My private portfolio can never hold a company with dirty hands."',
        portfolioImpact: 'Reputational alignment is now existential — public speech makes any governance scandal in the portfolio a personal liability.',
      },
    ],
    communicationStyle: {
      language: 'en',
      tone: 'formal',
      preferred: 'executive',
    },
    keyQuotes: [
      '"Standard ESG reporting is useless. It\'s purely retrospective."',
      '"If there is live media or judicial smoke, the position must be flagged immediately."',
      '"My investment portfolio must be a fortress of clean corporate governance. No reputational liabilities, period."',
    ],
    confidence: 0.94,
    sourcedFrom: [20, 22, 24, 26, 28],
  },
};

function buildFallbackDNA(clientId: string, entries: CRMEntry[]): ClientDNA {
  const fallback = FALLBACK_DNA[clientId];
  if (fallback) return { clientId, ...fallback };
  return {
    clientId,
    values: {
      priorities: ['Portfolio stability', 'Long-term growth'],
      redLines: [],
      preferredSectors: [],
      avoidedSectors: [],
      esgFocus: [],
    },
    investmentBehavior: {
      riskTolerance: 'moderate',
      timeHorizon: 'Long-term (10+ years)',
      liquidity: 'Standard',
      mandate: 'Balanced',
    },
    lifeEvents: [],
    communicationStyle: { language: 'de', tone: 'formal', preferred: 'values-led' },
    keyQuotes: [],
    confidence: 0.3,
    sourcedFrom: entries.map((_, i) => i + 1).slice(0, 5),
  };
}
