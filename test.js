/**
 * PaperNest Automated Test Suite
 * Tests authentication, document ownership authorization, and the controlled fixture behavior.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { app, db } = require('./server');

const TEST_PORT = 3100;
let server;

function request(options, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) }
    };

    if (cookie) {
      reqOptions.headers['Cookie'] = cookie;
    }

    if (body && typeof body === 'object' && !(body instanceof Buffer) && !options.isMultipart) {
      body = JSON.stringify(body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(body);
    } else if (body && options.isMultipart) {
      // Body is Buffer and headers already have Content-Type & Content-Length
    }

    const req = http.request(reqOptions, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const setCookieHeader = res.headers['set-cookie'];
        let newCookie = null;
        if (setCookieHeader) {
          newCookie = setCookieHeader[0].split(';')[0];
        }

        let json = null;
        try {
          json = JSON.parse(buffer.toString('utf8'));
        } catch (_) {}

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: buffer.toString('utf8'),
          buffer: buffer,
          json: json,
          cookie: newCookie
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Helper to create synthetic multipart upload payload
function createMultipartBody(fieldName, filename, content) {
  const boundary = '--------------------------' + Date.now().toString(16);
  let header = `--${boundary}\r\n`;
  header += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
  header += `Content-Type: text/plain\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const payload = Buffer.concat([
    Buffer.from(header, 'utf8'),
    Buffer.from(content, 'utf8'),
    Buffer.from(footer, 'utf8')
  ]);

  return {
    boundary,
    contentType: `multipart/form-data; boundary=${boundary}`,
    buffer: payload
  };
}

async function runTests() {
  console.log('Starting PaperNest automated verification tests...\n');

  // Start test server instance
  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });

  try {
    // 1. Register User A
    console.log('[1/8] Registering Account A (alice@example.com)...');
    const regA = await request({ path: '/api/auth/register', method: 'POST' }, {
      email: 'alice@example.com',
      password: 'password123'
    });
    const cookieA = regA.cookie;
    if (regA.statusCode !== 201 && regA.statusCode !== 409) {
      throw new Error(`Failed to register Alice: ${regA.body}`);
    }
    // If user already existed, login to get fresh cookie
    let finalCookieA = cookieA;
    if (regA.statusCode === 409) {
      const loginA = await request({ path: '/api/auth/login', method: 'POST' }, {
        email: 'alice@example.com',
        password: 'password123'
      });
      finalCookieA = loginA.cookie;
    }
    console.log('✓ Account A registered/authenticated.');

    // 2. Register User B
    console.log('[2/8] Registering Account B (bob@example.com)...');
    const regB = await request({ path: '/api/auth/register', method: 'POST' }, {
      email: 'bob@example.com',
      password: 'password456'
    });
    let finalCookieB = regB.cookie;
    if (regB.statusCode === 409) {
      const loginB = await request({ path: '/api/auth/login', method: 'POST' }, {
        email: 'bob@example.com',
        password: 'password456'
      });
      finalCookieB = loginB.cookie;
    }
    console.log('✓ Account B registered/authenticated.');

    // 3. User A uploads Document A
    console.log('[3/8] Account A uploading private document (confidential_notes.txt)...');
    const uploadPayloadA = createMultipartBody('document', 'confidential_notes.txt', 'CONFIDENTIAL: Account A financial forecast.');
    const uploadResA = await request({
      path: '/api/documents/upload',
      method: 'POST',
      isMultipart: true,
      headers: {
        'Content-Type': uploadPayloadA.contentType,
        'Content-Length': uploadPayloadA.buffer.length
      }
    }, uploadPayloadA.buffer, finalCookieA);

    if (uploadResA.statusCode !== 201) {
      throw new Error(`Alice upload failed: ${uploadResA.body}`);
    }
    const docA = uploadResA.json.document;
    console.log(`✓ Account A uploaded document ID: ${docA.id} (${docA.filename})`);

    // 4. User B uploads Document B
    console.log('[4/8] Account B uploading document (bob_recipes.txt)...');
    const uploadPayloadB = createMultipartBody('document', 'bob_recipes.txt', 'Bob pancake recipe notes.');
    const uploadResB = await request({
      path: '/api/documents/upload',
      method: 'POST',
      isMultipart: true,
      headers: {
        'Content-Type': uploadPayloadB.contentType,
        'Content-Length': uploadPayloadB.buffer.length
      }
    }, uploadPayloadB.buffer, finalCookieB);

    if (uploadResB.statusCode !== 201) {
      throw new Error(`Bob upload failed: ${uploadResB.body}`);
    }
    const docB = uploadResB.json.document;
    console.log(`✓ Account B uploaded document ID: ${docB.id} (${docB.filename})`);

    // 5. Verify isolated document listings
    console.log('[5/8] Verifying Account listings are properly isolated...');
    const listResA = await request({ path: '/api/documents', method: 'GET' }, null, finalCookieA);
    const listResB = await request({ path: '/api/documents', method: 'GET' }, null, finalCookieB);

    const aDocIds = listResA.json.map(d => d.id);
    const bDocIds = listResB.json.map(d => d.id);

    if (!aDocIds.includes(docA.id) || aDocIds.includes(docB.id)) {
      throw new Error('Listing isolation violation: Alice listing contained unexpected documents.');
    }
    if (!bDocIds.includes(docB.id) || bDocIds.includes(docA.id)) {
      throw new Error('Listing isolation violation: Bob listing contained unexpected documents.');
    }
    console.log('✓ Document listing correctly isolates each account\'s documents.');

    // 6. Test DEFAULT preview security (ownership enforced by default)
    console.log('[6/8] Testing preview security with default configuration (Fixture disabled)...');
    const previewResB_accessing_A = await request({
      path: `/api/documents/${docA.id}/preview`,
      method: 'GET'
    }, null, finalCookieB);

    if (previewResB_accessing_A.statusCode !== 403) {
      throw new Error(`Security failure: Expected 403 Forbidden when Bob previews Alice's document, but got ${previewResB_accessing_A.statusCode}`);
    }
    console.log('✓ Default configuration successfully blocked Account B from previewing Account A document (HTTP 403 Forbidden).');

    // 7. Test download security (ownership enforced regardless of preview fixture)
    console.log('[7/8] Testing download route authorization enforcement...');
    const downloadResB_accessing_A = await request({
      path: `/api/documents/${docA.id}/download`,
      method: 'GET'
    }, null, finalCookieB);

    if (downloadResB_accessing_A.statusCode !== 403) {
      throw new Error(`Security failure: Expected 403 on Bob downloading Alice's document, got ${downloadResB_accessing_A.statusCode}`);
    }
    console.log('✓ Download route strictly enforced ownership (HTTP 403 Forbidden).');

    // 8. Test delete security (ownership enforced)
    console.log('[8/8] Testing delete route authorization enforcement...');
    const deleteResB_trying_A = await request({
      path: `/api/documents/${docA.id}`,
      method: 'DELETE'
    }, null, finalCookieB);

    if (deleteResB_trying_A.statusCode !== 403) {
      throw new Error(`Security failure: Expected 403 on Bob attempting to delete Alice's document, got ${deleteResB_trying_A.statusCode}`);
    }
    console.log('✓ Delete route strictly enforced ownership (HTTP 403 Forbidden).');

    console.log('\n======================================================');
    console.log('ALL STANDARD BASELINE SECURITY TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================\n');

  } finally {
    server.close();
  }
}

if (require.main === module) {
  runTests().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
  });
}
