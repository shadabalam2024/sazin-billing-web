// ──────────────────────────────────────────────────────────────────────────
//  invoice-template.js — builds a GST-compliant "TAX INVOICE" (HTML for print/PDF)
//  Pulls company identity from `company` (your one-time Settings), computes tax
//  via gst.js, and lays out a legally-shaped Indian tax invoice.
// ──────────────────────────────────────────────────────────────────────────
const { computeInvoice } = require('./gst.js');

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');   // XSS-safe everywhere

const money = n => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function buildGstInvoiceHTML(record, company) {
  const calc = computeInvoice(record, company);
  const intra = calc.intraState;

  const DOCTYPE_LABELS = {
    'invoice': 'TAX INVOICE', 'proforma': 'PROFORMA INVOICE',
    'quote': 'QUOTATION / ESTIMATE', 'credit-note': 'CREDIT NOTE', 'debit-note': 'DEBIT NOTE'
  };
  const docLabel  = DOCTYPE_LABELS[record.docType || 'invoice'] || 'TAX INVOICE';
  const numLabel  = { 'quote': 'Quote No', 'proforma': 'Proforma No', 'credit-note': 'Credit Note No', 'debit-note': 'Debit Note No' }[record.docType] || 'Invoice No';
  const dateLabel = record.docType === 'quote' ? 'Quote Date' : record.docType === 'proforma' ? 'Proforma Date' : 'Invoice Date';
  const origRef   = (record.docType === 'credit-note' || record.docType === 'debit-note') && record.originalInvoice
    ? `<p><b>Against Invoice:</b> ${esc(record.originalInvoice)}</p>` : '';

  const colSpanForTax = intra ? 2 : 1;

  const lineRows = calc.lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(l.description)}</td>
      <td class="c">${esc(l.hsn)}</td>
      <td class="r">${Number(l.qty).toFixed(2)}</td>
      <td class="c">${esc(l.unit || '')}</td>
      <td class="r">${Number(l.rate).toFixed(2)}</td>
      <td class="r">${l.discount ? money(l.discount) : '—'}</td>
      <td class="r">${money(l.taxable)}</td>
    </tr>`).join('');

  // Rate-wise tax summary (HSN/rate slab table required on GST invoices)
  const taxSummaryRows = calc.slabs.map(s => `
    <tr>
      <td class="r">${money(s.taxable)}</td>
      ${intra
      ? `<td class="c">${s.gstRate / 2}%</td><td class="r">${money(s.cgst)}</td>
           <td class="c">${s.gstRate / 2}%</td><td class="r">${money(s.sgst)}</td>`
      : `<td class="c">${s.gstRate}%</td><td class="r">${money(s.igst)}</td>`}
      <td class="r">${money(intra ? s.cgst + s.sgst : s.igst)}</td>
    </tr>`).join('');

  return `<style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;}
    body{color:#000;background:#fff;font-size:12px;padding:16px;}
    .inv{border:1.5px solid #000;}
    .title{text-align:center;font-weight:800;font-size:15px;letter-spacing:1px;border-bottom:1.5px solid #000;padding:4px;}
    .sup{display:flex;border-bottom:1.5px solid #000;}
    .sup .logo{width:70px;display:flex;align-items:center;justify-content:center;border-right:1px solid #000;font-weight:800;font-size:10px;text-align:center;padding:4px;}
    .sup .det{flex:1;padding:6px 10px;}
    .sup h1{font-size:16px;font-weight:800;}
    .sup p{font-size:11px;line-height:1.35;}
    .meta{display:flex;border-bottom:1.5px solid #000;}
    .meta>div{flex:1;padding:6px 10px;}
    .meta>div:first-child{border-right:1px solid #000;}
    .meta b{display:inline-block;min-width:92px;}
    .parties{display:flex;border-bottom:1.5px solid #000;}
    .parties>div{flex:1;padding:6px 10px;}
    .parties>div:first-child{border-right:1px solid #000;}
    .parties .h{font-weight:700;font-size:10px;color:#444;text-transform:uppercase;margin-bottom:3px;}
    table{width:100%;border-collapse:collapse;}
    .items th{border:1px solid #000;padding:5px 4px;font-size:11px;background:#f0f0f0;}
    .items td{border:1px solid #555;padding:5px 4px;font-size:11px;}
    .items .c{text-align:center;} .items .r{text-align:right;}
    .totals{display:flex;border-top:1.5px solid #000;}
    .totals .words{flex:1.5;padding:8px 10px;border-right:1px solid #000;font-size:11px;}
    .totals .nums{flex:1;}
    .totals .nums table td{padding:4px 10px;font-size:11px;border-bottom:1px solid #ddd;}
    .totals .nums td.r{text-align:right;}
    .grand td{font-weight:800;font-size:13px;background:#f0f0f0;border-top:1px solid #000;}
    .taxsum{border-top:1.5px solid #000;}
    .taxsum th,.taxsum td{border:1px solid #555;padding:4px;font-size:10.5px;text-align:center;}
    .taxsum th{background:#f0f0f0;}
    .taxsum td.r{text-align:right;}
    .foot{display:flex;border-top:1.5px solid #000;}
    .foot .bank{flex:1.4;padding:8px 10px;border-right:1px solid #000;font-size:11px;line-height:1.5;}
    .foot .sign{flex:1;padding:8px 10px;text-align:center;display:flex;flex-direction:column;justify-content:space-between;}
    .foot .sign .for{font-weight:700;} .foot .sign .line{margin-top:34px;font-size:11px;}
    .decl{border-top:1px solid #000;padding:5px 10px;font-size:10px;color:#333;}
  </style>
  <div class="inv">
    <div class="title">${docLabel}</div>

    <div class="sup">
      <div class="logo">${company.logoText ? esc(company.logoText) : esc(company.name || '')}</div>
      <div class="det">
        <h1>${esc(company.name)}</h1>
        <p>${esc(company.address)}</p>
        <p><b>GSTIN:</b> ${esc(company.gstin)} &nbsp;|&nbsp; <b>State:</b> ${esc(company.stateName)} (${esc(company.stateCode)})</p>
        <p><b>Phone:</b> ${esc(company.phone)}${company.email ? ' &nbsp;|&nbsp; <b>Email:</b> ' + esc(company.email) : ''}</p>
      </div>
    </div>

    <div class="meta">
      <div>
        <p><b>${numLabel}:</b> ${esc(record.invoiceNumber)}</p>
        <p><b>${dateLabel}:</b> ${esc(record.dateStr)}</p>
        ${origRef}
      </div>
      <div>
        <p><b>Place of Supply:</b> ${esc(record.placeOfSupplyState)} (${esc(record.placeOfSupplyStateCode)})</p>
        <p><b>Reverse Charge:</b> No</p>
      </div>
    </div>

    <div class="parties">
      <div>
        <div class="h">Bill To</div>
        <p><b>${esc(record.name)}</b></p>
        <p>${esc(record.address)}</p>
        <p>Mobile: ${esc(record.mobile)}</p>
        ${record.recipientGstin ? `<p>GSTIN: ${esc(record.recipientGstin)}</p>` : '<p>GSTIN: Unregistered</p>'}
      </div>
      <div>
        <div class="h">Ship To</div>
        <p>${esc(record.shipTo || record.address)}</p>
      </div>
    </div>

    <table class="items">
      <thead><tr>
        <th style="width:28px">#</th><th>Description of Goods</th><th style="width:60px">HSN</th>
        <th style="width:62px">Qty</th><th style="width:46px">Unit</th>
        <th style="width:64px">Rate</th><th style="width:74px">Discount</th><th style="width:92px">Taxable Value</th>
      </tr></thead>
      <tbody>${lineRows}</tbody>
    </table>

    <div class="totals">
      <div class="words">
        <b>Amount Chargeable (in words):</b><br>${esc(calc.amountInWords)}
      </div>
      <div class="nums">
        <table>
          <tr><td>Taxable Value</td><td class="r">${money(calc.totalTaxable)}</td></tr>
          ${intra
      ? `<tr><td>CGST</td><td class="r">${money(calc.totalCgst)}</td></tr>
               <tr><td>SGST</td><td class="r">${money(calc.totalSgst)}</td></tr>`
      : `<tr><td>IGST</td><td class="r">${money(calc.totalIgst)}</td></tr>`}
          <tr><td>Round Off</td><td class="r">${calc.roundOff >= 0 ? '+' : '−'} ${money(Math.abs(calc.roundOff))}</td></tr>
          <tr class="grand"><td>Grand Total</td><td class="r">${money(calc.grandTotal)}</td></tr>
        </table>
      </div>
    </div>

    <table class="taxsum">
      <thead><tr>
        <th rowspan="2">Taxable Value</th>
        ${intra ? `<th colspan="2">CGST</th><th colspan="2">SGST</th>` : `<th colspan="2">IGST</th>`}
        <th rowspan="2">Total Tax</th>
      </tr><tr>
        ${intra ? `<th>Rate</th><th>Amt</th><th>Rate</th><th>Amt</th>` : `<th>Rate</th><th>Amt</th>`}
      </tr></thead>
      <tbody>${taxSummaryRows}</tbody>
    </table>

    <div class="foot">
      <div class="bank">
        <b>Bank Details</b><br>
        ${company.bankName ? `Bank: ${esc(company.bankName)}<br>` : ''}
        ${company.bankAccount ? `A/C No: ${esc(company.bankAccount)}<br>` : ''}
        ${company.bankIfsc ? `IFSC: ${esc(company.bankIfsc)}<br>` : ''}
        ${company.upi ? `UPI: ${esc(company.upi)}` : ''}
      </div>
      <div class="sign">
        <div class="for">For ${esc(company.name)}</div>
        <div class="line">Authorised Signatory</div>
      </div>
    </div>

    <div class="decl">
      ${esc(company.declaration || 'Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.')}
    </div>
  </div>`;
}

module.exports = { buildGstInvoiceHTML };
