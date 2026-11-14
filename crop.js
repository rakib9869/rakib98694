/* English Study — screenshot crop page logic */
(() => {
  'use strict';

  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const shot = document.getElementById('shot');
  const selection = document.getElementById('selection');
  const sizeLabel = document.getElementById('sizeLabel');
  const zoomLabel = document.getElementById('zoomLabel');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const fitBtn = document.getElementById('fitBtn');
  const scanBtn = document.getElementById('scanBtn');
  const closeBtn = document.getElementById('closeBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const selectionInfo = document.getElementById('selectionInfo');
  const loading = document.getElementById('loading');
  const errorBox = document.getElementById('errorBox');
  const errorText = document.getElementById('errorText');
  const errorCloseBtn = document.getElementById('errorCloseBtn');
  const working = document.getElementById('working');

  const state = {
    source: null,
    zoom: 1,
    fitMode: true,
    fitZoom: 1,
    dragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    selection: null,
    closed: false
  };

  init().catch((error) => showError(error?.message || String(error)));

  async function init() {
    bindEvents();
    try {
      const data = await chrome.storage.session.get('cropSource');
      state.source = data?.cropSource || null;
    } catch (error) {
      state.source = null;
    }

    if (!state.source || !state.source.dataUrl) {
      showError('স্ক্রিনশট পাওয়া যায়নি। সাইড প্যানেল থেকে আবার “স্ক্রিনশট ক্রপ” চেষ্টা করুন।');
      return;
    }

    await loadImage(state.source.dataUrl);
    loading.hidden = true;
    stage.hidden = false;
    fitToViewport();
  }

  function bindEvents() {
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);
    zoomInBtn.addEventListener('click', () => setZoom(state.zoom * 1.25));
    zoomOutBtn.addEventListener('click', () => setZoom(state.zoom / 1.25));
    fitBtn.addEventListener('click', fitToViewport);
    scanBtn.addEventListener('click', confirmCrop);
    closeBtn.addEventListener('click', cancelAndClose);
    cancelBtn.addEventListener('click', cancelAndClose);
    errorCloseBtn.addEventListener('click', cancelAndClose);
    viewport.addEventListener('wheel', onWheel, { passive: false });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      shot.onload = () => {
        if (!shot.naturalWidth || !shot.naturalHeight) {
          reject(new Error('ছবিটি খোলা যায়নি।'));
          return;
        }
        resolve();
      };
      shot.onerror = () => reject(new Error('ছবিটি লোড করা যায়নি।'));
      shot.src = src;
    });
  }

  function availableSize() {
    return {
      width: Math.max(100, viewport.clientWidth - 52),
      height: Math.max(100, viewport.clientHeight - 52)
    };
  }

  function computeFitZoom() {
    const area = availableSize();
    const widthZoom = area.width / shot.naturalWidth;
    const heightZoom = area.height / shot.naturalHeight;
    return Math.max(0.02, Math.min(1, widthZoom, heightZoom));
  }

  function fitToViewport() {
    if (!shot.naturalWidth) {
      return;
    }
    state.fitMode = true;
    state.fitZoom = computeFitZoom();
    setZoom(state.fitZoom, false);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = 0;
    });
  }

  function setZoom(nextZoom, keepCenter = true) {
    if (!shot.naturalWidth) {
      return;
    }
    const oldZoom = state.zoom;
    const area = availableSize();
    const centerX = (viewport.scrollLeft + area.width / 2) / oldZoom;
    const centerY = (viewport.scrollTop + area.height / 2) / oldZoom;

    state.zoom = clamp(nextZoom, 0.05, 4);
    if (Math.abs(state.zoom - state.fitZoom) > 0.005) {
      state.fitMode = false;
    }

    stage.style.width = `${Math.round(shot.naturalWidth * state.zoom)}px`;
    stage.style.height = `${Math.round(shot.naturalHeight * state.zoom)}px`;
    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    clearSelection();

    if (keepCenter) {
      requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, centerX * state.zoom - area.width / 2);
        viewport.scrollTop = Math.max(0, centerY * state.zoom - area.height / 2);
      });
    }
  }

  function onWheel(event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    if (event.deltaY < 0) {
      setZoom(state.zoom * 1.15);
    } else {
      setZoom(state.zoom / 1.15);
    }
  }

  function onResize() {
    if (!shot.naturalWidth) {
      return;
    }
    if (state.fitMode) {
      state.fitZoom = computeFitZoom();
      setZoom(state.fitZoom, false);
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    state.dragging = true;
    const point = stagePoint(event);
    state.startX = point.x;
    state.startY = point.y;
    state.currentX = point.x;
    state.currentY = point.y;
    clearSelection();
  }

  function onPointerMove(event) {
    if (!state.dragging) {
      return;
    }
    event.preventDefault();
    const point = stagePoint(event);
    state.currentX = point.x;
    state.currentY = point.y;
    paintSelection(normalizedSelection());
  }

  function onPointerUp(event) {
    if (!state.dragging) {
      return;
    }
    state.dragging = false;
    event.preventDefault();
    const target = normalizedSelection();
    if (!target || target.width < 6 || target.height < 6) {
      clearSelection();
      return;
    }
    paintSelection(target);
  }

  function stagePoint(event) {
    const bounds = stage.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left, 0, stage.clientWidth),
      y: clamp(event.clientY - bounds.top, 0, stage.clientHeight)
    };
  }

  function normalizedSelection() {
    const x = Math.min(state.startX, state.currentX);
    const y = Math.min(state.startY, state.currentY);
    const width = Math.abs(state.currentX - state.startX);
    const height = Math.abs(state.currentY - state.startY);
    if (width < 1 || height < 1) {
      return null;
    }
    return { x, y, width, height };
  }

  function paintSelection(target) {
    if (!target) {
      selection.hidden = true;
      state.selection = null;
      selectionInfo.textContent = 'কোনো অংশ নির্বাচন করা হয়নি';
      scanBtn.disabled = true;
      return;
    }

    state.selection = target;
    selection.hidden = false;
    selection.style.left = `${target.x}px`;
    selection.style.top = `${target.y}px`;
    selection.style.width = `${target.width}px`;
    selection.style.height = `${target.height}px`;

    const naturalWidth = Math.round(target.width / state.zoom);
    const naturalHeight = Math.round(target.height / state.zoom);
    sizeLabel.textContent = `${naturalWidth} × ${naturalHeight} px`;
    const labelBelow = target.y < 32;
    selection.classList.toggle('label-below', labelBelow);

    selectionInfo.textContent = `নির্বাচিত: ${naturalWidth} × ${naturalHeight} px`;
    scanBtn.disabled = naturalWidth < 6 || naturalHeight < 6;
  }

  function clearSelection() {
    state.selection = null;
    selection.hidden = true;
    scanBtn.disabled = true;
    selectionInfo.textContent = 'কোনো অংশ নির্বাচন করা হয়নি';
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelAndClose();
      return;
    }
    if (event.key === 'Enter' && state.selection) {
      event.preventDefault();
      confirmCrop();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setZoom(state.zoom * 1.25);
    }
    if (event.key === '-') {
      event.preventDefault();
      setZoom(state.zoom / 1.25);
    }
    if (event.key === '0') {
      event.preventDefault();
      fitToViewport();
    }
  }

  async function confirmCrop() {
    if (!state.selection || !state.selection.width || !state.source) {
      return;
    }
    scanBtn.disabled = true;
    working.hidden = false;

    try {
      const natural = {
        x: state.selection.x / state.zoom,
        y: state.selection.y / state.zoom,
        width: state.selection.width / state.zoom,
        height: state.selection.height / state.zoom
      };

      const marginX = Math.min(3, natural.x);
      const marginY = Math.min(3, natural.y);
      const sx = Math.max(0, Math.floor(natural.x - marginX));
      const sy = Math.max(0, Math.floor(natural.y - marginY));
      const right = Math.min(shot.naturalWidth, Math.ceil(natural.x + natural.width + marginX));
      const bottom = Math.min(shot.naturalHeight, Math.ceil(natural.y + natural.height + marginY));
      const sw = Math.max(1, right - sx);
      const sh = Math.max(1, bottom - sy);

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        throw new Error('ছবি প্রসেস করা যায়নি।');
      }
      context.fillStyle = '#fff';
      context.fillRect(0, 0, sw, sh);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(shot, sx, sy, sw, sh, 0, 0, sw, sh);

      const dataUrl = canvas.toDataURL('image/png');
      const payload = {
        type: 'CROP_PAGE_DONE',
        dataUrl,
        url: state.source.url || '',
        title: state.source.title || ''
      };

      try {
        await chrome.runtime.sendMessage(payload);
      } catch (messageError) {
        try {
          await chrome.storage.session.set({
            cropResult: {
              dataUrl,
              url: state.source.url || '',
              title: state.source.title || '',
              capturedAt: Date.now()
            }
          });
        } catch (storageError) {
          throw new Error('ক্রপ করা অংশ সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।');
        }
      }

      await closeSelf();
    } catch (error) {
      showError(error?.message || String(error));
      working.hidden = true;
      scanBtn.disabled = !state.selection;
    }
  }

  async function cancelAndClose() {
    if (state.closed) {
      return;
    }
    state.closed = true;
    try {
      await chrome.runtime.sendMessage({ type: 'CROP_PAGE_CANCELLED' });
    } catch (error) {
      /* Ignore and close directly. */
    }
    await closeSelf(true);
  }

  async function closeSelf(force = false) {
    if (!force) {
      state.closed = true;
    }
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    } catch (error) {
      /* Fall through to window.close(). */
    }
    window.close();
  }

  function showError(message) {
    loading.hidden = true;
    errorBox.hidden = false;
    errorText.textContent = message;
    working.hidden = true;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
