// DB row (snake_case) <-> API object (camelCase) mappers, one per table.
// Pure functions, no I/O — kept separate so route handlers stay readable.

// Documents: convert DB row (snake_case) → API record (camelCase)
function toRecord(row) {
  if (!row) return null;
  return {
    invoiceNumber: row.invoice_number,
    docType: row.doc_type || 'invoice',
    date: row.date,
    dateStr: row.date_str || (row.date ? new Date(row.date).toLocaleDateString('en-IN') : ''),
    name: row.name,
    mobile: row.mobile,
    address: row.address,
    shipTo: row.ship_to || row.address,
    recipientGstin: row.recipient_gstin || '',
    placeOfSupplyState: row.place_of_supply_state || '',
    placeOfSupplyStateCode: row.place_of_supply_state_code || '',
    originalInvoice: row.original_invoice || '',
    lines: row.lines || [],
    paymentStatus: row.payment_status || 'unpaid',
    amountPaid: parseFloat(row.amount_paid) || 0,
    payments: row.payments || [],
    notes: row.notes || [],
    convertedFromQuote: row.converted_from_quote || '',
    createdBy: row.created_by || ''
  };
}

// Documents: convert API record (camelCase) → DB row (snake_case)
function fromRecord(record) {
  return {
    invoice_number: record.invoiceNumber,
    doc_type: record.docType || 'invoice',
    date: record.date || new Date().toISOString(),
    date_str: record.dateStr || '',
    name: record.name,
    mobile: record.mobile,
    address: record.address,
    ship_to: record.shipTo || record.address || '',
    recipient_gstin: record.recipientGstin || '',
    place_of_supply_state: record.placeOfSupplyState || '',
    place_of_supply_state_code: record.placeOfSupplyStateCode || '',
    original_invoice: record.originalInvoice || '',
    lines: record.lines || [],
    payment_status: record.paymentStatus || 'unpaid',
    amount_paid: parseFloat(record.amountPaid) || 0,
    payments: record.payments || [],
    notes: record.notes || [],
    converted_from_quote: record.convertedFromQuote || '',
    created_by: record.createdBy || ''
  };
}

// Purchases: DB row → API object
function toPurchase(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplier: row.supplier,
    supplierBillNo: row.supplier_bill_no || '',
    supplierState: row.supplier_state || '',
    isIntraState: row.is_intra_state !== false,
    items: row.items || [],
    totalAmount: parseFloat(row.total_amount) || 0,
    totalTaxable: parseFloat(row.total_taxable) || 0,
    totalCgst: parseFloat(row.total_cgst) || 0,
    totalSgst: parseFloat(row.total_sgst) || 0,
    totalIgst: parseFloat(row.total_igst) || 0,
    totalGst: parseFloat(row.total_gst) || 0,
    paymentStatus: row.payment_status || 'paid',
    amountPaid: parseFloat(row.amount_paid) || 0,
    payments: row.payments || [],
    notes: row.notes || '',
    date: row.date
  };
}

// Inventory: DB row → API object
function toInventory(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'General',
    unit: row.unit || 'Piece',
    costPrice: parseFloat(row.cost_price) || 0,
    sellingPrice: parseFloat(row.selling_price) || 0,
    stockQty: parseFloat(row.stock_qty) || 0,
    hsn: row.hsn || '',
    lowStockAlert: parseFloat(row.low_stock_alert) || 5,
    createdAt: row.created_at
  };
}

// Quotes: DB row → API object
function toQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    docType: 'quote',
    quoteNumber: row.quote_number,
    date: row.date,
    status: row.status || 'open',
    name: row.name,
    mobile: row.mobile,
    address: row.address,
    recipientGstin: row.recipient_gstin || '',
    placeOfSupplyState: row.place_of_supply_state || '',
    placeOfSupplyStateCode: row.place_of_supply_state_code || '',
    lines: row.lines || [],
    convertedToInvoice: row.converted_to_invoice || '',
    notes: row.notes || ''
  };
}

module.exports = { toRecord, fromRecord, toPurchase, toInventory, toQuote };
