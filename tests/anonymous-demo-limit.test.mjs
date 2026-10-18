import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';

// The lib imports next/server (NextResponse) for the cookie setter; the
// pure encode/decode helpers under test don't need it, so stub it out.
// node:crypto is real and resolved via a CJS require passed into the
// transpiled module scope.
let js = ts.transpileModule(fs.readFileSync('src/lib/anonymousDemoLimit.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
js = js.replace('require("next/server")', '({ NextResponse: class {} })');
const api = {};
new Function('exports', 'require', js)(api, createRequire(import.meta.url));

const SECRET = 'test-secret-0123456789abcdef';

function withSecret(secret, fn) {
  const prev = process.env.ANONYMOUS_DEMO_COOKIE_SECRET;
  if (secret === undefined) delete process.env.ANONYMOUS_DEMO_COOKIE_SECRET;
  else process.env.ANONYMOUS_DEMO_COOKIE_SECRET = secret;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.ANONYMOUS_DEMO_COOKIE_SECRET;
    else process.env.ANONYMOUS_DEMO_COOKIE_SECRET = prev;
  }
}

test('signed round-trip preserves usage', () => {
  withSecret(SECRET, () => {
    const encoded = api.encodeAnonymousDemoUsage(3);
    assert.match(encoded, /\./, 'signed format carries a signature');
    assert.equal(api.decodeAnonymousDemoUsage(encoded), 3);
  });
});

test('forged usage is rejected', () => {
  withSecret(SECRET, () => {
    const encoded = api.encodeAnonymousDemoUsage(2);
    const dot = encoded.indexOf('.');
    const forged = JSON.stringify({ used: 0, v: 1 }) + encoded.slice(dot);
    assert.equal(api.decodeAnonymousDemoUsage(forged), 5);
  });
});

test('tampered signature is rejected', () => {
  withSecret(SECRET, () => {
    const encoded = api.encodeAnonymousDemoUsage(2);
    const dot = encoded.indexOf('.');
    assert.equal(api.decodeAnonymousDemoUsage(encoded.slice(0, dot + 1) + 'bogus'), 5);
  });
});

test('legacy unsigned cookie is rejected once a secret is configured', () => {
  withSecret(SECRET, () => {
    assert.equal(api.decodeAnonymousDemoUsage(JSON.stringify({ used: 1 })), 5);
  });
});

test('legacy unsigned cookie still works without a secret (dev fallback)', () => {
  withSecret(undefined, () => {
    const encoded = api.encodeAnonymousDemoUsage(4);
    assert.doesNotMatch(encoded, /\./);
    assert.equal(api.decodeAnonymousDemoUsage(encoded), 4);
  });
});

test('usage clamps and malformed signed cookies fail closed', () => {
  withSecret(SECRET, () => {
    assert.equal(api.decodeAnonymousDemoUsage(api.encodeAnonymousDemoUsage(99)), 5);
    assert.equal(api.decodeAnonymousDemoUsage('not-a-cookie'), 5);
    assert.equal(api.decodeAnonymousDemoUsage(''), 5);
  });
});

test('request quota accepts new visitors and blocks tampered cookies', () => {
  withSecret(SECRET, () => {
    assert.equal(api.checkAnonymousDemoUsage(new Request('https://example.com')).allowed, true);
    const signed = api.encodeAnonymousDemoUsage(4);
    const request = (value) => new Request('https://example.com', {
      headers: { cookie: `other=value; ${api.anonymousDemoUsageCookie}=${encodeURIComponent(value)}` },
    });
    assert.equal(api.checkAnonymousDemoUsage(request(signed)).used, 4);
    assert.equal(api.checkAnonymousDemoUsage(request(signed.replace('"used":4', '"used":0'))).allowed, false);
    assert.equal(api.checkAnonymousDemoUsage(request(api.encodeAnonymousDemoUsage(5))).allowed, false);
  });
});
