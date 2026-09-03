// Unit tests for the pure tax/invoicing math in backend/src/gst.js — the
// part of the app where a silent bug is worst (wrong tax on a real invoice),
// and the part the earlier smoke tests don't touch at all since they only
// exercise HTTP routes, not calculation correctness.
const assert = require('assert');
const { computeInvoice, numberToWords, nextInvoiceNumber, r2 } = require('../src/gst');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err.message}`);
    failures++;
  }
}

console.log('Testing backend/src/gst.js...');

// ── r2 ──
test('r2 rounds away floating point dust', () => {
  assert.strictEqual(r2(0.1 + 0.2), 0.3);
  assert.strictEqual(r2(17.999999), 18);
  assert.strictEqual(r2(10.005), 10.01);
});

// ── computeInvoice: intra-state (CGST+SGST) ──
test('intra-state invoice splits tax evenly into CGST + SGST', () => {
  const invoice = {
    placeOfSupplyStateCode: '07',
    lines: [{ qty: 10, rate: 100, discountPct: 0, gstRate: 18 }]
  };
  const result = computeInvoice(invoice, { stateCode: '07' });
  assert.strictEqual(result.intraState, true);
  assert.strictEqual(result.totalTaxable, 1000);
  assert.strictEqual(result.totalCgst, 90);
  assert.strictEqual(result.totalSgst, 90);
  assert.strictEqual(result.totalIgst, 0);
  assert.strictEqual(result.totalTax, 180);
  assert.strictEqual(result.grandTotal, 1180);
});

// ── computeInvoice: inter-state (IGST only) ──
test('inter-state invoice charges IGST only, no CGST/SGST', () => {
  const invoice = {
    placeOfSupplyStateCode: '10',
    lines: [{ qty: 10, rate: 100, discountPct: 0, gstRate: 18 }]
  };
  const result = computeInvoice(invoice, { stateCode: '07' });
  assert.strictEqual(result.intraState, false);
  assert.strictEqual(result.totalCgst, 0);
  assert.strictEqual(result.totalSgst, 0);
  assert.strictEqual(result.totalIgst, 180);
  assert.strictEqual(result.totalTax, 180);
});

// ── computeInvoice: discount applied before tax ──
test('discount reduces the taxable value before GST is applied', () => {
  const invoice = {
    placeOfSupplyStateCode: '07',
    lines: [{ qty: 1, rate: 1000, discountPct: 10, gstRate: 18 }]
  };
  const result = computeInvoice(invoice, { stateCode: '07' });
  // gross 1000, 10% discount -> taxable 900, GST 18% of 900 = 162 (81+81)
  assert.strictEqual(result.lines[0].discount, 100);
  assert.strictEqual(result.totalTaxable, 900);
  assert.strictEqual(result.totalTax, 162);
});

// ── computeInvoice: multiple GST rates aggregate into separate slabs ──
test('lines with different GST rates produce separate rate-wise slabs', () => {
  const invoice = {
    placeOfSupplyStateCode: '07',
    lines: [
      { qty: 1, rate: 100, discountPct: 0, gstRate: 18 },
      { qty: 1, rate: 100, discountPct: 0, gstRate: 12 }
    ]
  };
  const result = computeInvoice(invoice, { stateCode: '07' });
  assert.strictEqual(result.slabs.length, 2);
  assert.strictEqual(result.slabs[0].gstRate, 12);
  assert.strictEqual(result.slabs[1].gstRate, 18);
  assert.strictEqual(result.totalTaxable, 200);
});

// ── computeInvoice: round-off ──
test('grand total rounds to the nearest rupee and reports the round-off', () => {
  const invoice = {
    placeOfSupplyStateCode: '07',
    lines: [{ qty: 1, rate: 100.4, discountPct: 0, gstRate: 18 }]
  };
  const result = computeInvoice(invoice, { stateCode: '07' });
  // taxable 100.4, tax 18.072 -> before round 118.472 -> grand total 118, round off -0.47
  assert.strictEqual(result.grandTotal, Math.round(result.totalTaxable + result.totalTax));
  const beforeRound = r2(result.totalTaxable + result.totalTax);
  assert.strictEqual(r2(result.grandTotal - beforeRound), result.roundOff);
});

// ── computeInvoice: no lines ──
test('an invoice with no lines produces all-zero totals, not a crash', () => {
  const result = computeInvoice({ placeOfSupplyStateCode: '07', lines: [] }, { stateCode: '07' });
  assert.strictEqual(result.totalTaxable, 0);
  assert.strictEqual(result.grandTotal, 0);
  assert.strictEqual(result.slabs.length, 0);
});

// ── numberToWords ──
test('numberToWords spells out rupees and paise correctly', () => {
  assert.strictEqual(numberToWords(0), 'Rupees Zero Only');
  assert.strictEqual(numberToWords(1180), 'Rupees One Thousand One Hundred Eighty Only');
  assert.strictEqual(numberToWords(100000), 'Rupees One Lakh Only');
  assert.strictEqual(numberToWords(1180.50), 'Rupees One Thousand One Hundred Eighty and Fifty Paise Only');
});

// ── nextInvoiceNumber ──
test('invoice numbers increment sequentially within the same financial year', () => {
  const first = nextInvoiceNumber(null, 'SAZIN', new Date('2026-06-15'));
  assert.strictEqual(first.number, 'SAZIN/26-27/001');
  const second = nextInvoiceNumber(first.newState, 'SAZIN', new Date('2026-06-16'));
  assert.strictEqual(second.number, 'SAZIN/26-27/002');
});

test('invoice sequence resets to 001 when the financial year rolls over (April 1)', () => {
  const marchState = nextInvoiceNumber(null, 'SAZIN', new Date('2027-03-31')).newState;
  assert.strictEqual(marchState.fyLabel, '26-27');
  const aprilResult = nextInvoiceNumber(marchState, 'SAZIN', new Date('2027-04-01'));
  assert.strictEqual(aprilResult.newState.fyLabel, '27-28');
  assert.strictEqual(aprilResult.number, 'SAZIN/27-28/001');
});

if (failures > 0) {
  console.error(`\n${failures} gst.js test(s) failed.`);
  process.exit(1);
}
console.log('\nAll gst.js tests passed.');
