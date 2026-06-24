require('dotenv').config();
const app = require('../backend/src/server');

// Vercel calls this with the full URL path e.g. /api/login.
// Strip the /api prefix so Express routes match their original paths (/login, /history, etc.)
module.exports = (req, res) => {
  req.url = req.url.replace(/^\/api/, '') || '/';
  app(req, res);
};
