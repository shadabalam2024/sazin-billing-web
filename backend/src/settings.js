const supabase = require('./db');

// ── Default company settings ──
const DEFAULT_SETTINGS = {
  name: 'Sazin Tech',
  address: 'New Delhi',
  gstin: '', stateName: 'Delhi', stateCode: '07',
  phone: '', email: '', logoText: 'ST',
  bankName: '', bankAccount: '', bankIfsc: '', upi: '',
  declaration: 'Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  invoicePrefix: 'SAZIN', defaultHsn: '3925', defaultGstRate: 18,
  smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', smtpFrom: ''
};

async function readSettings() {
  const { data, error } = await supabase.from('settings').select('data').eq('id', 1).single();
  if (error) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(data?.data || {}) };
}

async function writeSettings(s) {
  await supabase.from('settings').upsert({ id: 1, data: s });
}

module.exports = { DEFAULT_SETTINGS, readSettings, writeSettings };
