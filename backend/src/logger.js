// Log an error with the route that threw it, so production logs are traceable
// without needing to guess which handler failed.
function logError(req, err) {
  console.error(`[${req.method} ${req.originalUrl}]`, err);
}

module.exports = { logError };
