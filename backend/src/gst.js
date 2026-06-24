// ──────────────────────────────────────────────────────────────────────────
//  gst.js — GST tax engine for SAZIN TECH billing (dependency-free, drop-in)
//  Handles: per-line taxable value, discount, CGST/SGST vs IGST split by
//  place-of-supply, rate-wise tax summary, round-off, amount-in-words,
//  and financial-year-based invoice numbering that never reuses a number.
// ──────────────────────────────────────────────────────────────────────────

// Round to 2 decimals safely (avoids floating point dust like 17.999999)
function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// ── Compute one invoice's full tax breakup ──
// invoice = {
//   placeOfSupplyStateCode,           // e.g. "10" (Bihar). If === company.stateCode -> intra-state
//   lines: [{ description, hsn, qty, unit, rate, discountPct, gstRate }]
//   //   rate is price per unit (per sq ft for area items). qty is the multiplier.
// }
// company = { stateCode }
function computeInvoice(invoice, company) {
  const intraState =
    String(invoice.placeOfSupplyStateCode || company.stateCode) === String(company.stateCode);

  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
  const slabs = {}; // keyed by gstRate -> { taxable, cgst, sgst, igst }

  const lines = (invoice.lines || []).map(line => {
    const qty = Number(line.qty) || 0;
    const rate = Number(line.rate) || 0;
    const discountPct = Number(line.discountPct) || 0;
    const gstRate = Number(line.gstRate);          // e.g. 18
    const gross = qty * rate;
    const discount = r2(gross * discountPct / 100);
    const taxable = r2(gross - discount);

    let cgst = 0, sgst = 0, igst = 0;
    if (intraState) {
      cgst = r2(taxable * (gstRate / 2) / 100);
      sgst = cgst;
    } else {
      igst = r2(taxable * gstRate / 100);
    }

    totalTaxable += taxable; totalCgst += cgst; totalSgst += sgst; totalIgst += igst;

    const key = gstRate.toString();
    if (!slabs[key]) slabs[key] = { gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    slabs[key].taxable += taxable;
    slabs[key].cgst += cgst; slabs[key].sgst += sgst; slabs[key].igst += igst;

    return { ...line, gross: r2(gross), discount, taxable, cgst, sgst, igst };
  });

  totalTaxable = r2(totalTaxable);
  totalCgst = r2(totalCgst);
  totalSgst = r2(totalSgst);
  totalIgst = r2(totalIgst);
  const totalTax = r2(totalCgst + totalSgst + totalIgst);
  const beforeRound = r2(totalTaxable + totalTax);
  const grandTotal = Math.round(beforeRound);
  const roundOff = r2(grandTotal - beforeRound);

  // tidy slab totals
  Object.values(slabs).forEach(s => {
    s.taxable = r2(s.taxable); s.cgst = r2(s.cgst); s.sgst = r2(s.sgst); s.igst = r2(s.igst);
  });

  return {
    intraState, lines,
    totalTaxable, totalCgst, totalSgst, totalIgst, totalTax,
    roundOff, grandTotal,
    amountInWords: numberToWords(grandTotal),
    slabs: Object.values(slabs).sort((a, b) => a.gstRate - b.gstRate)
  };
}

// ── Indian-system number to words (rupees + paise) ──
function numberToWords(amount) {
  const num = Math.abs(Math.round(Number(amount) * 100)); // work in paise
  const rupees = Math.floor(num / 100);
  const paise = num % 100;

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function twoDigits(n) {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
  }
  function threeDigits(n) {
    const h = Math.floor(n / 100), rest = n % 100;
    return (h ? a[h] + ' Hundred' + (rest ? ' ' : '') : '') + (rest ? twoDigits(rest) : '');
  }

  function inWords(n) {
    if (n === 0) return 'Zero';
    let str = '';
    const crore = Math.floor(n / 10000000); n %= 10000000;
    const lakh = Math.floor(n / 100000); n %= 100000;
    const thousand = Math.floor(n / 1000); n %= 1000;
    const hundred = n;
    if (crore) str += threeDigits(crore) + ' Crore ';
    if (lakh) str += twoDigits(lakh) + ' Lakh ';
    if (thousand) str += twoDigits(thousand) + ' Thousand ';
    if (hundred) str += threeDigits(hundred);
    return str.trim();
  }

  let words = 'Rupees ' + inWords(rupees);
  if (paise > 0) words += ' and ' + twoDigits(paise) + ' Paise';
  return words + ' Only';
}

// ── Financial-year invoice number (Apr–Mar), monotonic, never reused ──
// state = { lastSeq, fyLabel }  (persisted by caller, e.g. in settings.json)
// prefix = e.g. "SAZIN"
function nextInvoiceNumber(state, prefix, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0=Jan
  // FY starts in April
  const fyStart = m >= 3 ? y : y - 1;
  const fyLabel = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
  let seq = (state && state.fyLabel === fyLabel ? state.lastSeq : 0) + 1;
  const number = `${prefix}/${fyLabel}/${String(seq).padStart(3, '0')}`;
  return { number, newState: { fyLabel, lastSeq: seq } };
}

module.exports = { computeInvoice, numberToWords, nextInvoiceNumber, r2 };
