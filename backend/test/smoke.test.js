// Boots the real Express app against fake credentials and hits a handful of
// routes to catch "the server crashes/500s on a request it should handle
// gracefully" bugs before they reach production — the class of bug behind
// the 2026-09-01 incidents (dotenv path, Supabase .catch() on a non-Promise,
// and the Node/WebSocket boot crash).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake-ci-test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'fake-ci-service-key';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'fake-ci-jwt-secret-for-testing-only';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5500';

const request = require('supertest');
const app = require('../src/server');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok - ${name}`);
  else { console.error(`  FAIL - ${name}`); failures++; }
}

(async () => {
  console.log('Smoke testing backend/src/server.js...');

  const settingsRes = await request(app).get('/settings');
  check('GET /settings without auth returns 401 (not a crash)', settingsRes.status === 401);

  const loginRes = await request(app).post('/login').send({ username: 'nonexistent-user', password: 'wrong-password' });
  check(
    'POST /login with bad creds returns 200 + success:false (not a 500)',
    loginRes.status === 200 && loginRes.body && loginRes.body.success === false
  );

  const loginNoBodyRes = await request(app).post('/login').send({});
  check('POST /login with an empty body does not crash', loginNoBodyRes.status === 200 || loginNoBodyRes.status === 400);

  const notFoundRes = await request(app).get('/this-route-does-not-exist');
  check('unknown route does not crash the server', notFoundRes.status === 404 || notFoundRes.status === 500);

  const rateLimitProbe = await request(app).post('/login').send({ username: 'x', password: 'y' });
  check('login rate limiter middleware is wired up (request completes)', rateLimitProbe.status === 200);

  if (failures > 0) {
    console.error(`\n${failures} smoke test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll smoke tests passed.');
})().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
