const { computeInvoice } = require('./gst');

// Converts a stored document/record into the shape gst.js's computeInvoice
// expects (mirrors the pre-multi-docType schema for backward compatibility
// with older records saved before the `lines` format existed).
function recordToInvoice(record, settings) {
  let lines;
  if (Array.isArray(record.lines)) {
    lines = record.lines.map(l => ({
      description: l.description || 'Item',
      hsn: l.hsn || settings.defaultHsn,
      qty: Number(l.billedQty != null ? l.billedQty : l.qty) || 0,
      unit: l.unit || 'Sq.Ft',
      rate: Number(l.rate) || 0,
      discountPct: Number(l.discountPct) || 0,
      gstRate: Number(l.gstRate != null ? l.gstRate : settings.defaultGstRate)
    }));
  } else {
    const gstRate = Number(record.gstRate) || 0;
    lines = (record.measurements || []).map(m => ({
      description: 'Item', hsn: settings.defaultHsn,
      qty: (Number(m.area) || 0) * (Number(m.quantity) || 1),
      unit: 'Sq.Ft', rate: Number(m.cost) || 0, discountPct: 0, gstRate
    }));
  }
  return {
    placeOfSupplyStateCode: record.placeOfSupplyStateCode || settings.stateCode,
    placeOfSupplyState: record.placeOfSupplyState || settings.stateName,
    lines
  };
}

function grandTotalOf(record, settings) {
  return computeInvoice(recordToInvoice(record, settings), settings).grandTotal;
}

function salesRecords(records) {
  return records.filter(r => !r.docType || r.docType === 'invoice');
}

module.exports = { recordToInvoice, grandTotalOf, salesRecords };
