/* English Study — in-page crop overlay. Loaded on demand with chrome.scripting. */
(() => {
  'use strict';

  if (window.__englishStudyOverlayActive) {
    return;
  }
  window.__englishStudyOverlayActive = true;

  const host = document.createElement('div');
  host.id = '__english_study_crop_overlay__';
  host.style.cssText =
    'all:initial !important;position:fixed !important;inset:0 !important;' +
    'z-index:2147483647 !important;display:block !important;pointer-events:auto !important;';
  host.tabIndex = -1;

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .root {
        position: fixed;
        inset: 0;
        overflow: hidden;
        cursor: crosshair;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        font-family: "Nirmala UI", "Noto Sans Bengali", "Segoe UI", system-ui, sans-serif;
      }
      .shade {
        position: absolute;
        background: rgba(9, 14, 30, 0.52);
        pointer-events: none;
        transition: background 0.15s ease;
      }
      .selection {
        position: absolute;
        border: 2px solid #fbbf24;
        background: transparent;
        box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.7), 0 8px 30px rgba(0, 0, 0, 0.25);
        pointer-events: none;
      }
      .selection::before,
      .selection::after {
        content: "";
        position: absolute;
        inset: -6px;
        border: 1px solid rgba(251, 191, 36, 0.45);
        border-radius: 4px;
      }
      .toolbar {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(17, 24, 39, 0.96);
        color: #f8fafc;
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.14);
        pointer-events: auto;
        cursor: default;
        z-index: 5;
      }
      .dims {
        font: 600 12px/1.2 "Segoe UI", system-ui, sans-serif;
        color: #cbd5e1;
        white-space: nowrap;
        padding: 0 2px;
      }
      .toolbar button {
        appearance: none;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        padding: 8px 12px;
        font: 700 13px/1 "Nirmala UI", "Noto Sans Bengali", "Segoe UI", sans-serif;
        white-space: nowrap;
        transition: transform 0.12s ease, filter 0.12s ease;
      }
      .toolbar button:hover { filter: brightness(1.08); }
      .toolbar button:active { transform: scale(0.97); }
      .confirm { background: #f59e0b; color: #111827; }
      .cancel { background: rgba(255, 255, 255, 0.12); color: #f8fafc; }
      .hint {
        position: absolute;
        left: 50%;
        top: 22px;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.96);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        padding: 10px 16px;
        font: 600 13px/1.35 "Nirmala UI", "Noto Sans Bengali", "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.35);
        max-width: min(560px, calc(100vw - 32px));
        text-align: center;
        pointer-events: none;
        z-index: 6;
      }
      .hint b { color: #fbbf24; }
      .hint small { display: block; margin-top: 3px; color: #cbd5e1; font-weight: 400; }
      .hidden { display: none !important; }
    </style>
    <div class="root" part="root">
      <div class="shade full"></div>
      <div class="shade top hidden"></div>
      <div class="shade bottom hidden"></div>
      <div class="shade left hidden"></div>
      <div class="shade right hidden"></div>
      <div class="selection hidden"></div>
      <div class="toolbar hidden">
        <span class="dims"></span>
        <button type="button" class="confirm">✓ স্ক্যান করুন</button>
        <button type="button" class="cancel">✕ বাতিল</button>
      </div>
      <div class="hint">
        যে ইংরেজি অংশটি দরকার, মাউস দিয়ে টেনে সিলেক্ট করুন
        <small>Esc চাপলে বাতিল হবে</small>
      </div>
    </div>
  `;

  const root = shadow.querySelector('.root');
  const fullShade = shadow.querySelector('.shade.full');
  const shades = {
    top: shadow.querySelector('.shade.top'),
    bottom: shadow.querySelector('.shade.bottom'),
    left: shadow.querySelector('.shade.left'),
    right: shadow.querySelector('.shade.right')
  };
  const selectionEl = shadow.querySelector('.selection');
  const toolbar = shadow.querySelector('.toolbar');
  const dims = shadow.querySelector('.dims');
  const hint = shadow.querySelector('.hint');
  const confirmBtn = shadow.querySelector('.confirm');
  const cancelBtn = shadow.querySelector('.cancel');

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let dragging = false;
  let rect = null;
  let finished = false;

  function viewport() {
    return {
      width: Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1),
      height: Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1)
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizedRect() {
    const vp = viewport();
    const x = clamp(Math.min(startX, currentX), 0, vp.width);
    const y = clamp(Math.min(startY, currentY), 0, vp.height);
    const width = clamp(Math.abs(currentX - startX), 0, vp.width - x);
    const height = clamp(Math.abs(currentY - startY), 0, vp.height - y);
    return { x, y, width, height };
  }

  function paint(target) {
    const vp = viewport();
    if (!target || target.width < 2 || target.height < 2) {
      fullShade.classList.remove('hidden');
      Object.values(shades).forEach((el) => el.classList.add('hidden'));
      selectionEl.classList.add('hidden');
      toolbar.classList.add('hidden');
      hint.classList.remove('hidden');
      rect = null;
      return;
    }

    fullShade.classList.add('hidden');
    hint.classList.add('hidden');
    selectionEl.classList.remove('hidden');
    toolbar.classList.remove('hidden');

    const { x, y, width, height } = target;
    selectionEl.style.left = `${x}px`;
    selectionEl.style.top = `${y}px`;
    selectionEl.style.width = `${width}px`;
    selectionEl.style.height = `${height}px`;

    shades.top.classList.remove('hidden');
    shades.top.style.left = '0px';
    shades.top.style.top = '0px';
    shades.top.style.width = `${vp.width}px`;
    shades.top.style.height = `${y}px`;

    shades.bottom.classList.remove('hidden');
    shades.bottom.style.left = '0px';
    shades.bottom.style.top = `${y + height}px`;
    shades.bottom.style.width = `${vp.width}px`;
    shades.bottom.style.height = `${Math.max(0, vp.height - y - height)}px`;

    shades.left.classList.remove('hidden');
    shades.left.style.left = '0px';
    shades.left.style.top = `${y}px`;
    shades.left.style.width = `${x}px`;
    shades.left.style.height = `${height}px`;

    shades.right.classList.remove('hidden');
    shades.right.style.left = `${x + width}px`;
    shades.right.style.top = `${y}px`;
    shades.right.style.width = `${Math.max(0, vp.width - x - width)}px`;
    shades.right.style.height = `${height}px`;

    dims.textContent = `${Math.round(width)} × ${Math.round(height)} px`;

    const toolbarWidth = 230;
    const toolbarHeight = 46;
    let top = y + height + 10;
    if (top + toolbarHeight > vp.height - 8) {
      top = y - toolbarHeight - 10;
    }
    top = clamp(top, 8, Math.max(8, vp.height - toolbarHeight - 8));
    const left = clamp(x, 8, Math.max(8, vp.width - toolbarWidth - 8));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    rect = target;
  }

  function onPointerDown(event) {
    if (finished || event.button !== 0) {
      return;
    }
    if (event.composedPath().some((node) => node === toolbar)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startX = clamp(event.clientX, 0, viewport().width);
    startY = clamp(event.clientY, 0, viewport().height);
    currentX = startX;
    currentY = startY;
    paint(null);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
  }

  function onPointerMove(event) {
    if (!dragging || finished) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    currentX = clamp(event.clientX, 0, viewport().width);
    currentY = clamp(event.clientY, 0, viewport().height);
    paint(normalizedRect());
  }

  function onPointerUp(event) {
    if (!dragging || finished) {
      return;
    }
    dragging = false;
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    const target = normalizedRect();
    if (target.width < 8 || target.height < 8) {
      paint(null);
      return;
    }
    paint(target);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
    if (event.key === 'Enter' && rect) {
      event.preventDefault();
      event.stopPropagation();
      confirm();
    }
  }

  function confirm() {
    if (finished) {
      return;
    }
    const target = rect || null;
    if (!target || target.width < 8 || target.height < 8) {
      return;
    }
    finished = true;
    const vp = viewport();
    const payload = {
      type: 'OVERLAY_CROP',
      rect: {
        x: Math.round(target.x * 100) / 100,
        y: Math.round(target.y * 100) / 100,
        width: Math.round(target.width * 100) / 100,
        height: Math.round(target.height * 100) / 100
      },
      viewport: { width: vp.width, height: vp.height }
    };
    cleanup();
    setTimeout(() => {
      try {
        const result = chrome.runtime.sendMessage(payload);
        if (result && typeof result.catch === 'function') {
          result.catch(() => {});
        }
      } catch (error) {
        /* Extension context may have been reloaded. */
      }
    }, 190);
  }

  function cancel() {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();
    try {
      const result = chrome.runtime.sendMessage({ type: 'OVERLAY_CANCELLED' });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (error) {
      /* Ignore. */
    }
  }

  function cleanup() {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onResize, true);
    if (host.isConnected) {
      host.remove();
    }
    window.__englishStudyOverlayActive = false;
  }

  function onResize() {
    if (rect) {
      paint(null);
    }
  }

  root.addEventListener('pointerdown', onPointerDown, true);
  confirmBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
  cancelBtn.addEventListener('pointerdown', (event) => event.stopPropagation());
  confirmBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    confirm();
  });
  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onResize, true);

  document.documentElement.appendChild(host);
  host.focus({ preventScroll: true });
})();
