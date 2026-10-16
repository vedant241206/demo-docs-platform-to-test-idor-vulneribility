# PaperNest

PaperNest is a lightweight, clean local document upload platform built with vanilla HTML, CSS, JavaScript, and a small Node.js + Express backend with SQLite storage.

The codebase is structured to be readable and easy to audit for security analysis tools.

---

## Architecture Overview

- **Frontend**: Plain HTML5, CSS3, and Vanilla JavaScript (`index.html`, `dashboard.html`, `style.css`, `app.js`).
- **Backend**: Small Node.js Express application (`server.js`).
- **Database**: SQLite3 (`data/papernest.sqlite`) storing only accounts and document metadata (filename, size, MIME type, upload timestamp, file path).
- **File Storage**: Local uploads folder (`uploads/`), created automatically on server startup.
- **Session Management**: Server-side sessions using `express-session` with `httpOnly` cookies and strict ownership validation derived directly from the authenticated session.

---

## Directory Structure

```text
├── index.html           # Authentication interface (sign in & registration)
├── dashboard.html       # Document management dashboard
├── style.css            # Clean, professional document-platform styling
├── app.js               # Frontend interactions, drag-and-drop, and API calls
├── server.js            # Express backend with auth & document endpoints
├── test.js              # Automated test suite for authentication and protected routes
├── test-fixture.js      # Automated test for controlled preview IDOR scenario
├── package.json         # Minimal project dependencies and scripts
├── .env.example         # Environment variable template
├── data/                # Persistent SQLite database folder (auto-created)
└── uploads/             # Local stored documents directory (auto-created)
```

---

## Quickstart

### 1. Installation

Ensure Node.js (v18+) is installed, then run:

```bash
npm install
```

### 2. Running PaperNest

To run in standard secure mode:

```bash
npm start
```

Open your browser and navigate to:
```
http://localhost:3000
```

---

## Running Automated Tests

Run the standard baseline security tests (verifies registration, upload, isolation, and access control):

```bash
npm test
```

Run the controlled preview fixture test (verifies the isolated IDOR reproduction and ensures other routes remain secure):

```bash
npm run test:fixture
```

---

## Manual End-to-End Demonstration Guide

Follow these steps to demonstrate isolated accounts and the controlled preview fixture:

### Step 1: Start the Application (Default Mode)
```bash
npm start
```

### Step 2: Open Two Separate Browser Sessions
- Open Browser Session 1 (e.g., standard browser window).
- Open Browser Session 2 (e.g., Private/Incognito browser window).

### Step 3: Register Account A and Upload a Document
1. In Browser 1, visit `http://localhost:3000`.
2. Register as `alice@example.com` (password: `password123`).
3. Upload a document (e.g., `q1_report.txt` or a PDF/image).
4. Note its Document ID or preview it.

### Step 4: Register Account B and Upload a Document
1. In Browser 2 (Incognito), visit `http://localhost:3000`.
2. Register as `bob@example.com` (password: `password456`).
3. Upload a document (e.g., `notes.txt`).

### Step 5: Verify Isolation
- In Browser 1, Alice only sees her own uploaded document.
- In Browser 2, Bob only sees his own uploaded document.
- In Browser 2, if Bob tries to preview Alice's document by issuing `GET /api/documents/1/preview`, the server returns `HTTP 403 Forbidden`.

### Step 6: Enable the Controlled Local-Only Fixture
To reproduce and demonstrate the IDOR scenario for security repair tools:
1. Stop the server (`Ctrl + C`).
2. Start the server with the local fixture flag enabled:
   - **PowerShell (Windows)**:
     ```powershell
     $env:ENABLE_VULNERABLE_PREVIEW_FIXTURE="true"; node server.js
     ```
   - **Command Prompt (CMD)**:
     ```cmd
     set ENABLE_VULNERABLE_PREVIEW_FIXTURE=true && node server.js
     ```
   - **Bash / macOS / Linux**:
     ```bash
     ENABLE_VULNERABLE_PREVIEW_FIXTURE=true npm start
     ```
3. A console banner will indicate: `[SECURITY FIXTURE ACTIVE] Controlled vulnerable preview fixture enabled.`
*(Note: If `NODE_ENV=production`, the server will refuse to activate this fixture).*

### Step 7: Demonstrate Controlled IDOR Behavior
1. Log into Browser 2 as Bob.
2. Alter the document preview request URL in your browser or via `fetch`/curl:
   ```
   http://localhost:3000/api/documents/1/preview
   ```
3. Because the fixture is active, Bob can view Alice's document preview.

### Step 8: Verify Other Protected Operations
Even with the preview fixture active:
- `GET /api/documents/1/download` returns `HTTP 403 Forbidden` for Bob.
- `DELETE /api/documents/1` returns `HTTP 403 Forbidden` for Bob.
- Document ownership enforcement remains intact on all other endpoints.

---

## Free Hosted Storage Alternative (Supabase Storage)

The initial implementation uses local storage on your laptop without needing third-party credentials.

If you later want to migrate from local laptop disk storage to a free hosted cloud storage provider, **Supabase Storage** is recommended (it provides 1 GB free storage and 2 GB free bandwidth per month).

### Step-by-Step Setup Guide for Supabase:

1. **Create an Account and Project**:
   - Go to [supabase.com](https://supabase.com) and sign up for a free account.
   - Click **New Project**, choose a project name (e.g., `papernest-storage`), set a secure database password, and pick a region near you.

2. **Create a Storage Bucket**:
   - In your Supabase Dashboard, navigate to the **Storage** section in the left sidebar.
   - Click **New Bucket**.
   - Set the bucket name to `documents`.
   - Keep **Public bucket** toggled **OFF** so that files are not exposed to the public internet.

3. **Obtain API Credentials**:
   - In your Supabase Dashboard, go to **Project Settings** (gear icon) > **API**.
   - Locate and copy:
     - **Project URL** (e.g., `https://xyzcompany.supabase.co`)
     - **Service Role Secret Key** (`service_role` under Project API keys). *Note: Use the service role key only on your backend server to allow uploading and reading files securely, never in client-side code.*

4. **Configure Environment Variables**:
   Add the following variables to your `.env` file:
   ```env
   STORAGE_PROVIDER=supabase
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   SUPABASE_BUCKET=documents
   ```

5. **Connecting the Backend (When Ready to Migrate)**:
   - Install the Supabase client:
     ```bash
     npm install @supabase/supabase-js
     ```
   - In `server.js`, configure upload handling to pipe multer buffers directly to Supabase Storage:
     ```javascript
     const { createClient } = require('@supabase/supabase-js');
     const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

     // Uploading to Supabase
     const { data, error } = await supabase.storage
       .from(process.env.SUPABASE_BUCKET)
       .upload(`user_${userId}/${storedName}`, fileBuffer, {
         contentType: mimeType
       });

     // Downloading/Streaming from Supabase
     const { data: fileBlob, error } = await supabase.storage
       .from(process.env.SUPABASE_BUCKET)
       .download(storedPath);
     ```

*(Currently, local storage is active and functioning out-of-the-box without requiring any cloud setup).*
