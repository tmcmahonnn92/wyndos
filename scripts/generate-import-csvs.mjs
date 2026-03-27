// generate-import-csvs.mjs
// Reads Window Cleaning Work.xlsx and outputs customer-data-import.csv + job-history-import.csv

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const xlsx = require('xlsx');

const wb = xlsx.readFile('Window Cleaning Work.xlsx');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseFreq(raw) {
  if (!raw && raw !== 0) return '4 weeks';
  const s = String(raw).toLowerCase().replace(/\s+/g, '');
  if (s.startsWith('12')) return '12 weeks';
  if (s.startsWith('8'))  return '8 weeks';
  return '4 weeks'; // default
}

function freqLabel(freq) {
  if (freq === '12 weeks') return '12-Weekly';
  if (freq === '8 weeks')  return '8-Weekly';
  return '4-Weekly';
}

// Excel serial date → ISO date string
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  const date = new Date((serial - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

// Month-column index → approximate visit date string for a given schedule year
// Columns 4-15 = Jan-Dec 2025.  Column 3 = the "Dec 2024" date (serial 45650 = 2024-12-23).
const COL_DATES = {
  3:  '2024-12-23',
  4:  '2025-01-20',
  5:  '2025-02-17',
  6:  '2025-03-17',
  7:  '2025-04-14',
  8:  '2025-05-12',
  9:  '2025-06-09',
  10: '2025-07-07',
  11: '2025-08-04',
  12: '2025-09-01',
  13: '2025-09-29',
  14: '2025-10-27',
  15: '2025-11-24',
};

function csvRow(fields) {
  return fields.map(f => {
    const s = String(f ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

// ---------------------------------------------------------------------------
// Sheet → area name mapping
// ---------------------------------------------------------------------------
const AREA_NAMES = {
  'langold':              'Langold',
  'Model way':            'Model Way',
  'RogersPortland':       'Rogers & Portland',
  'Creswell':             'Creswell',
  'Elmton rd':            'Elmton Road',
  'Bolsover and Clowne':  'Bolsover & Clowne',
  'edwinstowe':           'Edwinstowe',
  'welbeck and norton':   'Welbeck & Norton',
  'gatefordhemmingfield': 'Gateford & Hemmingfield',
  'Rhodesiacarlton rd':   'Rhodesia & Carlton Road',
  'dale close':           'Dale Close',
};

// ---------------------------------------------------------------------------
// Parse each sheet into a list of customer objects
// ---------------------------------------------------------------------------

function parseSheet(sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Find header row (has "Address" or "Cost" etc.)
  let headerRowIdx = rows.findIndex(r =>
    String(r[0]).toLowerCase() === 'address' || String(r[1]).toLowerCase() === 'cost'
  );
  if (headerRowIdx < 0) headerRowIdx = 0;

  const baseArea = AREA_NAMES[sheetName] || sheetName;
  const customers = [];

  // For Model way the address column contains just a number; track current street
  let currentStreet = '';
  const isModelWay = sheetName === 'Model way';

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const col0 = row[0];
    const col1 = row[1];
    const col2 = row[2];

    // Skip empty / totals rows
    if (col0 === '' && col1 === '') continue;
    if (String(col0).toLowerCase().includes('total')) continue;
    if (typeof col1 === 'number' && col0 === '') continue; // totals row

    // Sub-area header row in Model way (col0 = street name, col1 = empty)
    if (isModelWay && typeof col0 === 'string' && col0 !== '' && (col1 === '' || col1 === 0)) {
      // e.g. "Creswell - Model Lane" → "Model Lane, Creswell"
      currentStreet = col0
        .replace(/^Creswell\s*[-–]\s*/i, '')
        .trim() + ', Creswell';
      continue;
    }

    // Must have a price (col1 numeric)
    if (typeof col1 !== 'number' || col1 <= 0) continue;

    // Build address
    let address = '';
    if (isModelWay) {
      address = `${col0} ${currentStreet}`.trim();
    } else {
      address = String(col0).trim();
      if (!address) continue;
    }

    const rawFreq = col2;
    const freq = normaliseFreq(rawFreq);
    const price = col1;

    // New/proposed price is the last column if it has a value
    const lastNonEmpty = [...row].reverse().find(v => typeof v === 'number' && v > 0);
    const proposedPrice = (lastNonEmpty && lastNonEmpty !== price) ? lastNonEmpty : price;

    // Payment history columns
    const history = [];
    for (const [colIdx, date] of Object.entries(COL_DATES)) {
      const idx = Number(colIdx);
      if (idx >= row.length) continue;
      const val = String(row[idx]).toLowerCase().trim();
      if (!val || val === '' || val === 'skipped') continue;
      // "paid", "owing", "fronts" etc.
      const paid  = val === 'paid' || val === 'fronts';
      const notes = val === 'fronts' ? 'Front only' : (val === 'owing' ? 'Outstanding' : '');
      history.push({
        date,
        price,           // historical price = original price
        paidAmount: paid ? price : 0,
        paymentMethod: paid ? 'CASH' : '',
        notes,
      });
    }

    customers.push({ address, price: proposedPrice, freq, baseArea, history });
  }

  return customers;
}

// ---------------------------------------------------------------------------
// Determine per-area whether frequencies need splitting
// ---------------------------------------------------------------------------

function buildAreaMap(allCustomers) {
  // group by baseArea
  const byArea = {};
  for (const c of allCustomers) {
    (byArea[c.baseArea] = byArea[c.baseArea] || []).push(c);
  }

  for (const [area, customers] of Object.entries(byArea)) {
    const freqs = new Set(customers.map(c => c.freq));
    const needsSplit = freqs.size > 1;

    for (const c of customers) {
      c.area = needsSplit ? `${area} (${freqLabel(c.freq)})` : area;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const allCustomers = [];

for (const sheetName of Object.keys(AREA_NAMES)) {
  const parsed = parseSheet(sheetName);
  allCustomers.push(...parsed);
}

buildAreaMap(allCustomers);

// ---------------------------------------------------------------------------
// Write customer-data-import.csv
// ---------------------------------------------------------------------------
// Columns: Name,Address,Price,Area,Email,Phone,Notes,Job Name,Next Due Date,Payment Method,Advance Notice,Frequency

const custHeader = ['Name', 'Address', 'Price', 'Area', 'Email', 'Phone', 'Notes', 'Job Name', 'Next Due Date', 'Payment Method', 'Advance Notice', 'Frequency'];
const custLines = [custHeader.join(',')];

// Deduplicate by address (some sheets may overlap)
const seenAddresses = new Set();

function freqWeeks(freq) {
  if (freq === '12 weeks') return 12;
  if (freq === '8 weeks')  return 8;
  return 4;
}

for (const c of allCustomers) {
  const addr = c.address.toLowerCase().replace(/\s+/g, ' ').trim();
  if (seenAddresses.has(addr)) {
    console.warn(`DUPLICATE skipped: ${c.address}`);
    continue;
  }
  seenAddresses.add(addr);

  custLines.push(csvRow([
    c.address,                // Name = address (no personal names in spreadsheet)
    c.address,                // Address
    c.price.toFixed(2),       // Price (proposed/current)
    c.area,                   // Area (with freq suffix if mixed)
    '',                       // Email
    '',                       // Phone
    '',                       // Notes
    'Window Cleaning',        // Job Name
    '',                       // Next Due Date (scheduler will assign)
    'CASH',                   // Payment Method
    'false',                  // Advance Notice
    freqWeeks(c.freq),        // Frequency (weeks)
  ]));
}

writeFileSync('customer-data-import.csv', custLines.join('\n'), 'utf8');
console.log(`customer-data-import.csv → ${custLines.length - 1} customers`);

// ---------------------------------------------------------------------------
// Write job-history-import.csv
// ---------------------------------------------------------------------------
// Columns: Customer Name,Address,Date,Price,Paid,Payment Method,Notes

const histHeader = ['Customer Name', 'Address', 'Date', 'Price', 'Paid', 'Payment Method', 'Notes'];
const histLines = [histHeader.join(',')];

for (const c of allCustomers) {
  for (const h of c.history) {
    histLines.push(csvRow([
      c.address,               // Customer Name
      c.address,               // Address
      h.date,                  // Date
      h.price.toFixed(2),      // Price
      h.paidAmount.toFixed(2), // Paid
      h.paymentMethod,         // Payment Method
      h.notes,                 // Notes
    ]));
  }
}

writeFileSync('job-history-import.csv', histLines.join('\n'), 'utf8');
console.log(`job-history-import.csv → ${histLines.length - 1} history entries`);

// ---------------------------------------------------------------------------
// Summary of areas created
// ---------------------------------------------------------------------------
const areas = [...new Set(allCustomers.map(c => c.area))].sort();
console.log('\nAreas created:');
areas.forEach(a => {
  const count = allCustomers.filter(c => c.area === a).length;
  console.log(`  ${a}  (${count} customers)`);
});
