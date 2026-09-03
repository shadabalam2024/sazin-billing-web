require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { logError } = require('./logger');

const app = express();

// Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
app.use(helmet());

// CORS — strict: only allow the configured origin; deny all others if not set
const allowedOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-auth-token']
}));
app.use(express.json({ limit: '5mb' }));

app.use(require('./routes/meta'));
app.use(require('./routes/auth'));
app.use(require('./routes/billing'));
app.use(require('./routes/clients'));
app.use(require('./routes/catalog'));
app.use(require('./routes/backup'));
app.use(require('./routes/inventory'));
app.use(require('./routes/purchases'));
app.use(require('./routes/expenses'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/quotes'));
app.use(require('./routes/templates'));
app.use(require('./routes/users'));
app.use(require('./routes/reports'));

// Safety net for anything that slips past a route's own try/catch
// (thrown synchronously, from middleware, or an unhandled rejection).
app.use((err, req, res, next) => {
  logError(req, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: 'An internal error occurred.' });
});

// Export for Vercel serverless (api/index.js requires this).
// When run directly (node src/server.js) for local dev, also start the HTTP server.
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅  SAZIN Billing backend running on http://localhost:${PORT}`));
}
