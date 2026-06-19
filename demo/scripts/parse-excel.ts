import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '../../data');
const OUT_DIR = path.join(__dirname, '../src/data');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function readSheet(wb: XLSX.WorkBook, name: string) {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ── CRM ──────────────────────────────────────────────────────────────────────
const crmWb = XLSX.readFile(path.join(DATA_DIR, 'SwissHacks CRM.xlsx'));
console.log('CRM sheets:', crmWb.SheetNames);

const clients: Record<string, any[]> = {};
for (const sheet of crmWb.SheetNames) {
  const rows = readSheet(crmWb, sheet);
  if (rows) {
    const key = sheet.toLowerCase().replace('crm ', '').trim();
    clients[key] = rows;
    console.log(`  ${sheet}: ${rows.length} rows, keys:`, rows[0] ? Object.keys(rows[0]) : []);
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'clients.json'), JSON.stringify(clients, null, 2));
console.log('Written clients.json');

// ── Portfolio Construction ────────────────────────────────────────────────────
const portWb = XLSX.readFile(path.join(DATA_DIR, 'SwissHacks Portfolio Construction.xlsx'));
console.log('\nPortfolio sheets:', portWb.SheetNames);

for (const sheet of portWb.SheetNames) {
  const rows = readSheet(portWb, sheet);
  if (rows && rows.length > 0) {
    console.log(`  ${sheet}: ${rows.length} rows, keys:`, Object.keys(rows[0] as object).slice(0, 10));
  }
}

// Parse portfolios (Defensive, Balanced, Growth)
const portfolios: Record<string, any[]> = {};
for (const sheet of portWb.SheetNames) {
  const lower = sheet.toLowerCase();
  if (lower.includes('defensive') || lower.includes('balanced') || lower.includes('growth')) {
    const rows = readSheet(portWb, sheet) as any[];
    if (rows) {
      const key = lower.replace('sample portfolio ', '').trim();
      portfolios[key] = rows.filter(r => r['Issuer'] || r['ISIN'] || r['Valor']);
    }
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'portfolios.json'), JSON.stringify(portfolios, null, 2));
console.log('Written portfolios.json');

// Parse CIO recommendation list
const cioSheet = portWb.SheetNames.find(s => s.toLowerCase().includes('cio') || s.toLowerCase().includes('recommendation'));
if (cioSheet) {
  const cioRows = readSheet(portWb, cioSheet) as any[];
  const cioList = cioRows ? cioRows.filter(r => r['Rating'] || r['Issuer'] || r['ISIN']) : [];
  fs.writeFileSync(path.join(OUT_DIR, 'cio-list.json'), JSON.stringify(cioList, null, 2));
  console.log(`Written cio-list.json (${cioList.length} entries)`);
  if (cioList[0]) console.log('  Keys:', Object.keys(cioList[0]));
}

// Parse portfolio strategies
const stratSheet = portWb.SheetNames.find(s => s.toLowerCase().includes('strateg'));
if (stratSheet) {
  const stratRows = readSheet(portWb, stratSheet);
  fs.writeFileSync(path.join(OUT_DIR, 'portfolio-strategies.json'), JSON.stringify(stratRows, null, 2));
  console.log(`Written portfolio-strategies.json`);
  if (stratRows && stratRows[0]) console.log('  Keys:', Object.keys(stratRows[0] as object).slice(0, 12));
}
