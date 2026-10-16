/**
 * PaperNest IDOR Fixture Verification Test
 * Tests that when ENABLE_VULNERABLE_PREVIEW_FIXTURE=true:
 * 1. Account B CAN preview Account A's document (IDOR condition demonstrated).
 * 2. Protected download and delete routes STILL enforce ownership checks.
 */

const http = require('http');

// Enable fixture environment variable before requiring server
process.env.ENABLE_VULNERABLE_PREVIEW_FIXTURE = 'true';
process.env.NODE_ENV = 'development';

const { app } = require('./server');
const TEST_PORT = 3101;
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

async function runFixtureTest() {
  console.log('Starting Controlled IDOR Fixture verification test...\n');

  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });

  try {
    // 1. Register/Login User A
    const regA = await request({ path: '/api/auth/register', method: 'POST' }, {
      email: 'fixture_alice@example.com',
      password: 'password123'
    });
    let cookieA = regA.cookie;
    if (regA.statusCode === 409) {
      const loginA = await request({ path: '/api/auth/login', method: 'POST' }, {
        email: 'fixture_alice@example.com',
        password: 'password123'
      });
      cookieA = loginA.cookie;
    }

    // 2. Register/Login User B
    const regB = await request({ path: '/api/auth/register', method: 'POST' }, {
      email: 'fixture_bob@example.com',
      password: 'password456'
    });
    let cookieB = regB.cookie;
    if (regB.statusCode === 409) {
      const loginB = await request({ path: '/api/auth/login', method: 'POST' }, {
        email: 'fixture_bob@example.com',
        password: 'password456'
      });
      cookieB = loginB.cookie;
    }

    // 3. User A uploads a private document
    const uploadPayloadA = createMultipartBody('document', 'alice_secret_roadmap.txt', 'SECRET ROADMAP 2026 FOR ALICE ONLY');
    const uploadResA = await request({
      path: '/api/documents/upload',
      method: 'POST',
      isMultipart: true,
      headers: {
        'Content-Type': uploadPayloadA.contentType,
        'Content-Length': uploadPayloadA.buffer.length
      }
    }, uploadPayloadA.buffer, cookieA);

    const docAId = uploadResA.json.document.id;
    console.log(`✓ Account A uploaded private document ID: ${docAId}`);

    // 4. Test: Bob requests Alice's document preview under active fixture
    console.log(`[TEST] Account B attempting to preview Account A's document (ID: ${docAId}) via fixture...`);
    const previewRes = await request({
      path: `/api/documents/${docAId}/preview`,
      method: 'GET'
    }, null, cookieB);

    if (previewRes.statusCode === 200 && previewRes.body.includes('SECRET ROADMAP 2026 FOR ALICE ONLY')) {
      console.log('✓ [DEMONSTRATION CONFIRMED] IDOR reproduced: Account B received Account A\'s document preview (HTTP 200).');
    } else {
      throw new Error(`Expected HTTP 200 with Alice's content, got status ${previewRes.statusCode}: ${previewRes.body}`);
    }

    // 5. Test: Download route must STILL block Bob
    console.log('[TEST] Checking that download route STILL enforces ownership...');
    const downloadRes = await request({
      path: `/api/documents/${docAId}/download`,
      method: 'GET'
    }, null, cookieB);

    if (downloadRes.statusCode !== 403) {
      throw new Error(`Expected HTTP 403 on download, but received ${downloadRes.statusCode}`);
    }
    console.log('✓ Download route blocked Account B (HTTP 403 Forbidden).');

    // 6. Test: Delete route must STILL block Bob
    console.log('[TEST] Checking that delete route STILL enforces ownership...');
    const deleteRes = await request({
      path: `/api/documents/${docAId}`,
      method: 'DELETE'
    }, null, cookieB);

    if (deleteRes.statusCode !== 403) {
      throw new Error(`Expected HTTP 403 on delete, but received ${deleteRes.statusCode}`);
    }
    console.log('✓ Delete route blocked Account B (HTTP 403 Forbidden).');

    console.log('\n======================================================');
    console.log('CONTROLLED IDOR FIXTURE BEHAVIOR VERIFIED SUCCESSFULLY!');
    console.log('======================================================\n');
  } finally {
    server.close();
  }
}

runFixtureTest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ Fixture test failed:', err);
  process.exit(1);
});
