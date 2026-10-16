function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getQueryParamUserId() {
  const params = new URLSearchParams(window.location.search);
  const qId = params.get('id');
  if (qId) return qId.replace(/["']/g, '');

  const decodedPath = decodeURIComponent(window.location.pathname);
  const match = decodedPath.match(/id[=:]?["']?(\d+)["']?/i);
  if (match) return match[1];

  const anyDigitMatch = decodedPath.match(/(\d+)/);
  if (anyDigitMatch) return anyDigitMatch[1];

  return null;
}

function blockUnauthorizedAccess() {
  document.body.innerHTML = '';
  document.body.style.backgroundColor = '#fff';
  window.alert('Your access is temporily blocked, contact admin to continue.');
}

if (document.getElementById('login-form')) {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const authAlert = document.getElementById('auth-alert');

  function showAlert(msg, isError = true) {
    authAlert.textContent = msg;
    authAlert.className = `alert ${isError ? 'alert-danger' : 'alert-success'}`;
    authAlert.style.display = 'block';
  }

  function hideAlert() {
    authAlert.style.display = 'none';
  }

  fetch('/api/auth/me')
    .then(res => res.json())
    .then(data => {
      if (data.authenticated) {
        window.location.href = `/id="${data.user.id}"/document.html`;
      }
    })
    .catch(() => {});

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.add('active');
    registerForm.classList.remove('active');
    hideAlert();
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
    hideAlert();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const submitBtn = document.getElementById('btn-login-submit');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (res.ok) {
        window.location.href = `/id="${data.user.id}"/document.html`;
      } else {
        showAlert(data.error || 'Failed to sign in. Please verify your credentials.');
      }
    } catch (err) {
      showAlert('Network error. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const submitBtn = document.getElementById('btn-register-submit');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();

      if (res.ok) {
        showAlert('Account created successfully! Redirecting...', false);
        setTimeout(() => {
          window.location.href = `/id="${data.user.id}"/document.html`;
        }, 800);
      } else {
        showAlert(data.error || 'Registration failed.');
      }
    } catch (err) {
      showAlert('Network error. Please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
}

if (document.getElementById('doc-list-body')) {
  const userDisplay = document.getElementById('user-display');
  const btnLogout = document.getElementById('btn-logout');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const progressContainer = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const docTable = document.getElementById('doc-table');
  const docListBody = document.getElementById('doc-list-body');
  const emptyState = document.getElementById('empty-state');
  const dashAlert = document.getElementById('dash-alert');

  const previewModal = document.getElementById('preview-modal');
  const previewModalTitle = document.getElementById('preview-modal-title');
  const previewModalBody = document.getElementById('preview-modal-body');
  const previewModalClose = document.getElementById('preview-modal-close');

  function showDashAlert(msg, isError = true) {
    dashAlert.textContent = msg;
    dashAlert.className = `alert ${isError ? 'alert-danger' : 'alert-success'}`;
    dashAlert.style.display = 'block';
    setTimeout(() => {
      dashAlert.style.display = 'none';
    }, 5000);
  }

  async function initDashboard() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (!res.ok || !data.authenticated) {
        window.location.href = '/index.html';
        return;
      }
      const requestedUserId = getQueryParamUserId();
      if (requestedUserId && String(requestedUserId) !== String(data.user.id)) {
        blockUnauthorizedAccess();
        return;
      }
      userDisplay.textContent = data.user.email;
      loadDocuments();
    } catch (err) {
      window.location.href = '/index.html';
    }
  }

  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/index.html';
    }
  });

  async function loadDocuments() {
    try {
      const requestedUserId = getQueryParamUserId();
      const apiUrl = requestedUserId ? `/api/documents?id=${encodeURIComponent(requestedUserId)}` : '/api/documents';
      const res = await fetch(apiUrl);
      if (res.status === 403) {
        blockUnauthorizedAccess();
        return;
      }
      if (!res.ok) throw new Error('Could not load documents');
      const docs = await res.json();

      docListBody.innerHTML = '';
      if (!docs || docs.length === 0) {
        docTable.style.display = 'none';
        emptyState.style.display = 'block';
      } else {
        emptyState.style.display = 'none';
        docTable.style.display = 'table';

        docs.forEach(doc => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>
              <div class="doc-title-cell">
                <span>📄</span>
                <strong>${escapeHtml(doc.filename)}</strong>
              </div>
            </td>
            <td>${formatFileSize(doc.filesize)}</td>
            <td>${formatDate(doc.created_at)}</td>
            <td style="text-align: right;">
              <div class="doc-actions" style="justify-content: flex-end;">
                <button class="btn btn-secondary btn-sm" onclick="previewDocument(${doc.id}, '${escapeQuotes(doc.filename)}')">Preview</button>
                <a class="btn btn-secondary btn-sm" href="/api/documents/${doc.id}/download" download="${escapeQuotes(doc.filename)}">Download</a>
                <button class="btn btn-danger btn-sm" onclick="deleteDocument(${doc.id})">Delete</button>
              </div>
            </td>
          `;
          docListBody.appendChild(row);
        });
      }
    } catch (err) {
      showDashAlert(err.message, true);
    }
  }

  previewModalClose.addEventListener('click', () => {
    previewModal.classList.remove('active');
    previewModalBody.innerHTML = '';
  });

  window.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      previewModal.classList.remove('active');
      previewModalBody.innerHTML = '';
    }
  });

  window.previewDocument = async function(id, filename) {
    previewModalTitle.textContent = filename || `Document #${id}`;
    previewModalBody.innerHTML = '<p style="padding: 1rem; color: var(--text-muted);">Loading preview...</p>';
    previewModal.classList.add('active');

    try {
      const res = await fetch(`/api/documents/${id}/preview`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        if (res.status === 403) {
          blockUnauthorizedAccess();
          return;
        }
        previewModalBody.innerHTML = `<div class="alert alert-danger" style="margin: 1rem;">${errorData.error || 'Failed to load preview.'}</div>`;
        return;
      }

      const contentType = res.headers.get('Content-Type') || '';
      if (contentType.startsWith('image/')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        previewModalBody.innerHTML = `<div style="text-align:center;"><img src="${url}" alt="Preview" style="max-width:100%; max-height:500px; border-radius:4px; object-fit:contain;"></div>`;
      } else if (contentType.includes('application/pdf')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        previewModalBody.innerHTML = `<iframe class="preview-frame" src="${url}"></iframe>`;
      } else if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) {
        const text = await res.text();
        const pre = document.createElement('pre');
        pre.className = 'preview-text';
        pre.textContent = text;
        previewModalBody.innerHTML = '';
        previewModalBody.appendChild(pre);
      } else {
        previewModalBody.innerHTML = `
          <div style="text-align: center; padding: 2rem;">
            <p style="margin-bottom: 1rem; color: var(--text-muted);">Inline preview is not supported for this file format (${contentType}).</p>
            <a href="/api/documents/${id}/download" class="btn btn-primary">Download File Instead</a>
          </div>
        `;
      }
    } catch (err) {
      previewModalBody.innerHTML = `<div class="alert alert-danger" style="margin: 1rem;">Network error fetching preview.</div>`;
    }
  };

  window.deleteDocument = async function(id) {
    if (!confirm('Are you sure you want to delete this document?')) {
      return;
    }
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        showDashAlert('Document deleted successfully', false);
        loadDocuments();
      } else {
        showDashAlert(data.error || 'Failed to delete document', true);
      }
    } catch (err) {
      showDashAlert('Failed to delete document', true);
    }
  };

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  function uploadFile(file) {
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = `Uploading ${file.name}: 0%`;

    const formData = new FormData();
    formData.append('document', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents/upload', true);

    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = percent + '%';
        progressText.textContent = `Uploading ${file.name}: ${percent}%`;
      }
    };

    xhr.onload = function() {
      progressContainer.style.display = 'none';
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          showDashAlert('Document uploaded successfully!', false);
          loadDocuments();
        } else {
          showDashAlert(res.error || 'Upload failed', true);
        }
      } catch (e) {
        showDashAlert('Error processing upload response', true);
      }
    };

    xhr.onerror = function() {
      progressContainer.style.display = 'none';
      showDashAlert('Network error during upload', true);
    };

    xhr.send(formData);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m];
    });
  }

  function escapeQuotes(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  initDashboard();
}
