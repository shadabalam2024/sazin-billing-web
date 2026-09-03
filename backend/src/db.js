const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  process.exit(1);
}

// Service-role key bypasses Row Level Security — keep it server-side only.
// Realtime is unused by this app, but the client initializes it eagerly and
// crashes on Node <22 without a global WebSocket — hand it the `ws` package
// as a transport so `npm run dev` works on older Node without behavior change.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false }, realtime: { transport: require('ws') } }
);

module.exports = supabase;
