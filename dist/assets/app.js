(function () {
  'use strict';

  // ===== Configuration =====
  const API_BASE = window.location.origin;
  const EXAMPLES = [
    { file: 'table-1305dae7.webp', label: 'Table · Financial Summary' },
    { file: 'table-3ba1139c.webp', label: 'Table · Annual Report' },
    { file: 'handwriting-040745.jpg', label: 'Handwriting · Chinese' },
    { file: 'handwriting-042609.jpg', label: 'Handwriting · Chinese' },
    { file: 'page-9477c155-19b3-4f2d-ac18-ee3f8997d2f8.png', label: 'Formula · Research Paper' },
  ];

  // ===== State =====
  let currentEventId = 0;
  let activeController = null;
  let completedPages = [];
  let currentPage = 0;
  let totalPages = 0;
  let documentType = 'image';
  let currentFile = null;
  let batchStartPage = null;
  let batchEndPage = null;
  let pendingReconnect = false;
  let mockMode = false;

  // ===== DOM Elements =====
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const examplesGrid = document.getElementById('examples-grid');
  const resultsPanel = document.getElementById('results-panel');
  const toastContainer = document.getElementById('toast-container');

  // ===== Init =====
  function init() {
    setupUploadZone();
    setupExamples();
    checkMockMode();
  }

  function checkMockMode() {
    fetch(`${API_BASE}/healthz`)
      .then(r => r.json())
      .then(data => {
        mockMode = data.backend === 'mock';
        if (mockMode) {
          showToast('Running in demo mode (mock inference)', 'success');
        }
      })
      .catch(() => {
        showToast('Could not connect to backend', 'error');
      });
  }

  // ===== Upload Zone =====
  function setupUploadZone() {
    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    });
  }

  function handleFileSelect(file) {
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    const maxSize = 50 * 1024 * 1024;

    if (!validTypes.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp|pdf)$/i)) {
      showToast('Please upload a PNG, JPEG, WebP, or PDF file', 'error');
      return;
    }

    if (file.size > maxSize) {
      showToast('File must be smaller than 50 MB', 'error');
      return;
    }

    currentFile = file;
    startOCR(file);
  }

  // ===== Examples =====
  function setupExamples() {
    examplesGrid.innerHTML = '';
    EXAMPLES.forEach(ex => {
      const btn = document.createElement('button');
      btn.className = 'example-chip';
      btn.dataset.file = ex.file;
      btn.dataset.label = ex.label;
      btn.innerHTML = `
        <span class="example-thumb" style="background:linear-gradient(135deg,#059669,#0d9488)">
          <span class="example-tag">${ex.label.split(' · ')[0]}</span>
        </span>
        <span class="example-label">${ex.label.split(' · ')[1] || ex.label}</span>
      `;
      btn.addEventListener('click', () => loadExample(ex.file, ex.label));
      examplesGrid.appendChild(btn);
    });
  }

  function loadExample(filename, label) {
    showToast(`Loading example: ${label}`, 'success');
    showLoading('Preparing example…');

    fetch(`${API_BASE}/examples/${filename}`)
      .then(r => {
        if (!r.ok) throw new Error('Example not found');
        return r.blob();
      })
      .then(blob => {
        const ext = filename.split('.').pop();
        const file = new File([blob], filename, { type: blob.type || `image/${ext}` });
        currentFile = file;
        startOCR(file);
      })
      .catch(err => {
        hideLoading();
        showToast(`Could not load example: ${err.message}`, 'error');
      });
  }

  // ===== OCR Streaming =====
  function startOCR(file) {
    if (activeController) {
      activeController.abort();
    }

    completedPages = [];
    currentPage = 0;
    totalPages = 0;
    documentType = 'image';
    batchStartPage = null;
    batchEndPage = null;
    pendingReconnect = false;

    renderResultsPlaceholder('Starting analysis…');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('page_index', '0');
    formData.append('page_count', String(Math.min(4, 100)));

    showLoading('Processing document…');

    activeController = new AbortController();
    const eventId = ++currentEventId;

    fetch(`${API_BASE}/run_ocr`, {
      method: 'POST',
      body: formData,
      signal: activeController.signal,
      headers: {
        'Accept': 'text/event-stream',
      },
    }).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      hideLoading();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        return reader.read().then(({ done, value }) => {
          if (done) {
            if (eventId !== currentEventId) return;
            if (completedPages.length > 0 && !pendingReconnect) {
              handleStreamEnd();
            }
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          processSSE(buffer, eventId);
          buffer = '';
          read();
        });
      }

      read().catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Stream error:', err);
        if (eventId === currentEventId) {
          showToast(`Connection error: ${err.message}`, 'error');
          attemptReconnect();
        }
      });
    }).catch(err => {
      if (err.name === 'AbortError') return;
      hideLoading();
      console.error('Fetch error:', err);
      if (eventId === currentEventId) {
        showToast(`Failed to start OCR: ${err.message}`, 'error');
        renderResultsPlaceholder('Failed to process document. Please try again.');
      }
    });
  }

  function processSSE(text, eventId) {
    if (eventId !== currentEventId) return;

    const lines = text.split('\n');
    let currentData = '';
    let inData = false;

    for (const line of lines) {
      if (line.startsWith('data:')) {
        inData = true;
        currentData += line.slice(5).trim();
      } else if (line === '' && inData) {
        try {
          const payload = JSON.parse(currentData);
          handleStreamEvent(payload);
        } catch (e) {
          console.warn('Failed to parse SSE data:', currentData);
        }
        currentData = '';
        inData = false;
      } else if (line.startsWith(':') || line.trim() === '') {
        continue;
      } else {
        if (inData) {
          currentData += line;
        }
      }
    }

    if (inData && currentData) {
      try {
        const payload = JSON.parse(currentData);
        handleStreamEvent(payload);
      } catch (e) {
        console.warn('Failed to parse SSE data:', currentData);
      }
    }
  }

  function handleStreamEvent(payload) {
    const { event, pages, current_page, total_pages, document_type, page_preview, batch_start_page, batch_end_page } = payload;

    totalPages = total_pages || totalPages;
    documentType = document_type || documentType;
    currentPage = current_page || currentPage;
    batchStartPage = batch_start_page || batchStartPage;
    batchEndPage = batch_end_page || batchEndPage;

    switch (event) {
      case 'page_start':
        handlePageStart(pages[0], page_preview);
        break;
      case 'stream':
        handleStreamUpdate(pages[0]);
        break;
      case 'page_complete':
        handlePageComplete(pages[0]);
        break;
      case 'complete':
        handleBatchComplete(pages);
        break;
    }
  }

  function handlePageStart(page, preview) {
    const existingIndex = completedPages.findIndex(p => p.page_number === page.page_number);
    if (existingIndex >= 0) {
      completedPages[existingIndex] = page;
    } else {
      completedPages.push(page);
    }
    renderResults();
    updateStatusBar('Analyzing…', 'streaming', page);
  }

  function handleStreamUpdate(page) {
    const existingIndex = completedPages.findIndex(p => p.page_number === page.page_number);
    if (existingIndex >= 0) {
      completedPages[existingIndex] = page;
    } else {
      completedPages.push(page);
    }
    renderResults();
    updateStatusBar('Streaming…', 'streaming', page);
  }

  function handlePageComplete(page) {
    const existingIndex = completedPages.findIndex(p => p.page_number === page.page_number);
    if (existingIndex >= 0) {
      completedPages[existingIndex] = page;
    } else {
      completedPages.push(page);
    }
    renderResults();
    updateStatusBar('Complete', 'complete', page);
  }

  function handleBatchComplete(pages) {
    completedPages = pages;
    renderResults();
    updateStatusBar('All pages complete', 'complete', pages[0]);
    hideLoading();
    showToast('Document parsed successfully', 'success');
  }

  function handleStreamEnd() {
    updateStatusBar('Done', 'complete', completedPages[0]);
    hideLoading();
  }

  function attemptReconnect() {
    if (pendingReconnect) return;
    pendingReconnect = true;

    const incompletePage = completedPages.find(p => p.status !== 'complete');
    if (!incompletePage) {
      pendingReconnect = false;
      return;
    }

    showToast('Reconnecting…', 'success');
    setTimeout(() => {
      if (currentFile) {
        startOCRFromPage(currentFile, incompletePage.page_number - 1);
      }
    }, 1000);
  }

  function startOCRFromPage(file, pageIndex) {
    if (activeController) {
      activeController.abort();
    }

    activeController = new AbortController();
    const eventId = ++currentEventId;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('page_index', pageIndex);
    formData.append('page_count', Math.min(4, totalPages - pageIndex));

    showLoading(`Resuming from page ${pageIndex + 1}…`);

    fetch(`${API_BASE}/run_ocr`, {
      method: 'POST',
      body: formData,
      signal: activeController.signal,
      headers: { 'Accept': 'text/event-stream' },
    }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      hideLoading();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        return reader.read().then(({ done, value }) => {
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          processSSE(buffer, eventId);
          buffer = '';
          read();
        });
      }
      read();
    }).catch(err => {
      if (err.name === 'AbortError') return;
      hideLoading();
      showToast(`Reconnection failed: ${err.message}`, 'error');
    });
  }

  // ===== Rendering =====
  function renderResults() {
    if (completedPages.length === 0) {
      renderResultsPlaceholder('Starting analysis…');
      return;
    }

    const allComplete = completedPages.every(p => p.status === 'complete');
    const firstPage = completedPages[0];

    resultsPanel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'result-header';
    header.innerHTML = `
      <div class="result-meta">
        <span class="badge">${documentType === 'pdf' ? 'PDF' : 'Image'}</span>
        <span>Page ${currentPage} of ${totalPages || 1}</span>
        ${allComplete ? '<span class="badge">Complete</span>' : '<span class="badge" style="background:#fef3c7;color:#92400e;border-color:#fde68a;">Processing</span>'}
      </div>
      <div class="result-actions">
        <button class="action-btn" id="toggle-raw">Raw Markdown</button>
        <button class="action-btn primary" id="export-md">Export as .md</button>
      </div>
    `;
    resultsPanel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'result-body';
    body.id = 'result-body';

    if (allComplete) {
      const tabBar = document.createElement('div');
      tabBar.className = 'tab-bar';
      tabBar.innerHTML = `
        <button class="tab-button active" data-tab="rendered">Rendered</button>
        <button class="tab-button" data-tab="raw">Raw Markdown</button>
      `;
      body.appendChild(tabBar);

      const renderedContent = document.createElement('div');
      renderedContent.className = 'tab-content active';
      renderedContent.id = 'tab-rendered';
      renderedContent.innerHTML = renderCombinedMarkdown();
      body.appendChild(renderedContent);

      const rawContent = document.createElement('div');
      rawContent.className = 'tab-content';
      rawContent.id = 'tab-raw';
      rawContent.innerHTML = `<pre><code>${escapeHtml(getCombinedRawMarkdown())}</code></pre>`;
      body.appendChild(rawContent);

      setupTabs(tabBar);
    } else {
      body.innerHTML = renderCombinedMarkdown();
    }

    resultsPanel.appendChild(body);

    const statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    statusBar.id = 'status-bar';
    statusBar.innerHTML = `
      <span class="status-dot complete"></span>
      <span class="status-text">Ready</span>
      <span class="status-progress">Page ${currentPage} of ${totalPages || 1}</span>
    `;
    resultsPanel.appendChild(statusBar);

    setupActionButtons();
  }

  function renderCombinedMarkdown() {
    const allComplete = completedPages.every(p => p.status === 'complete');
    let html = '';

    completedPages.forEach((page, i) => {
      if (i > 0) {
        html += '<hr/>';
        html += `<p style="color:var(--color-slate-500);font-size:0.8rem;"><!-- Page ${page.page_number} --></p>`;
      }
      if (page.status === 'complete') {
        html += page.render_markdown || page.markdown || '';
      } else {
        html += page.render_markdown || '';
      }
    });

    if (html) {
      setTimeout(() => {
        if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
          MathJax.typesetPromise([`#result-body`]).catch(err => console.warn(err));
        }
      }, 50);
    }

    return html;
  }

  function getCombinedRawMarkdown() {
    return completedPages.map(p => p.markdown || '').join('\n\n---\n\n');
  }

  function renderResultsPlaceholder(text) {
    resultsPanel.innerHTML = `
      <div class="results-placeholder">
        <svg class="placeholder-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 12H15M9 16H15M9 8H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M20 7L12 4L4 7V17L12 20L4 17V7Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p class="placeholder-text">${text}</p>
      </div>
    `;
  }

  function updateStatusBar(text, status, page) {
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return;

    const dot = statusBar.querySelector('.status-dot');
    const textEl = statusBar.querySelector('.status-text');
    const progressEl = statusBar.querySelector('.status-progress');

    dot.className = 'status-dot ' + status;
    textEl.textContent = text;
    progressEl.textContent = `Page ${page?.page_number || currentPage} of ${totalPages || 1}`;
  }

  function setupTabs(tabBar) {
    const buttons = tabBar.querySelectorAll('.tab-button');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tabId = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');

        if (tabId === 'rendered' && typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
          MathJax.typesetPromise([`#tab-rendered`]).catch(err => console.warn(err));
        }
      });
    });
  }

  function setupActionButtons() {
    const exportBtn = document.getElementById('export-md');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const md = getCombinedRawMarkdown();
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'doculens-output.md';
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    const toggleRawBtn = document.getElementById('toggle-raw');
    if (toggleRawBtn) {
      toggleRawBtn.addEventListener('click', () => {
        const md = getCombinedRawMarkdown();
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'doculens-output.md';
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  // ===== Loading =====
  let loadingOverlay = null;

  function showLoading(text) {
    if (loadingOverlay) {
      loadingOverlay.querySelector('.loading-spinner').firstChild.textContent = text;
      return;
    }

    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <span class="loading-text">${text}</span>
      </div>
    `;
    document.body.appendChild(loadingOverlay);
  }

  function updateLoading(text) {
    if (loadingOverlay) {
      const textEl = loadingOverlay.querySelector('.loading-text');
      if (textEl) textEl.textContent = text;
    }
  }

  function hideLoading() {
    if (loadingOverlay) {
      loadingOverlay.remove();
      loadingOverlay = null;
    }
  }

  // ===== Toast =====
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg class="toast-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        ${type === 'success'
          ? '<path d="M5 12.5L10 17.5L19 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
          : '<path d="M18.36 6L12 12.36L5.64 6L5 6.64L12 13.64L19 6.64L18.36 6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        }
      </svg>
      <span>${message}</span>
    `;
    toastContainer.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ===== Utils =====
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Init =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.DocuLens = {
    startOCR,
    showToast,
    loadExample,
  };
})();
