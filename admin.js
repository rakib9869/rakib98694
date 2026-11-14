/* English Study — Admin Panel controller (v1.1)
 * Password-gated, memory-only session, audit-logged admin actions.
 * Uses the shared authentication engine in js/auth.js (no duplicated storage logic).
 */
(() => {
  'use strict';

  const Auth = window.AppAuth;
  if (!Auth) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif;color:#fda4af">auth.js লোড হয়নি — এক্সটেনশনটি আবার লোড করুন।</p>';
    return;
  }

  const H = Auth.helpers;
  const GRACE_MS = 30000;

  const state = {
    session: null,
    expiresAt: 0,
    setupMode: false,
    tab: 'dashboard',
    stats: null,
    users: [],
    promos: [],
    logs: [],
    logLoaded: false,
    recent: [],
    settings: null,
    device: null,
    network: null,
    adminRecord: null,
    timers: { session: null, tick: null },
    lastTouch: 0,
    dialog: null,
    refreshQueued: false,
    busy: false,
    locking: false
  };

  const VIEW_META = {
    dashboard: { title: 'ড্যাশবোর্ড', subtitle: 'সব ইউজার, মেয়াদ, প্রোমো ও লগ এক জায়গায়।' },
    users: { title: 'ইউজার ম্যানেজমেন্ট', subtitle: 'মেয়াদ নির্ধারণ, ব্যান/সাসপেন্ড, পাসওয়ার্ড রিসেট ও জোরপূর্বক লগআউট।' },
    promos: { title: 'প্রোমো কোড', subtitle: 'কোড তৈরি করুন ও প্রতিটির অ্যাক্টিভেশন সময়সীমা নিয়ন্ত্রণ করুন।' },
    logs: { title: 'লগ ও মনিটরিং', subtitle: 'ডিভাইস/মডেল, তারিখ-সময়, আইপি/লোকেশন ও ইন-অ্যাপ অ্যাক্টিভিটি।' },
    security: { title: 'নিরাপত্তা', subtitle: 'অ্যাডমিন পাসওয়ার্ড, ব্যাকআপ ও ডাটা রিসেট।' },
    settings: { title: 'সেটিংস', subtitle: 'লগইন বাধ্যবাধকতা, ট্রায়াল, সেশন ও লক পলিসি।' }
  };

  const els = {};

  function $(id) {
    if (!els[id]) {
      els[id] = document.getElementById(id);
    }
    return els[id];
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function bn(value) {
    return H.bnNum(value);
  }

  function fmt(ts) {
    return H.formatDate(ts);
  }

  function fmtShort(ts) {
    return H.formatShortDate(ts);
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                              */
  /* ------------------------------------------------------------------ */

  function toast(message, type) {
    const host = $('toastHost');
    if (!host) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'toast ' + (type || 'info');
    const icon = document.createElement('span');
    icon.textContent = type === 'success' ? '✅' : type === 'error' ? '⚠️' : type === 'warning' ? '🔔' : 'ℹ️';
    const text = document.createElement('span');
    text.textContent = String(message || '');
    item.appendChild(icon);
    item.appendChild(text);
    host.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    setTimeout(() => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 260);
    }, 3800);
  }

  /* ------------------------------------------------------------------ */
  /* Dialog system                                                       */
  /* ------------------------------------------------------------------ */

  function closeDialog(userInitiated) {
    const current = state.dialog;
    if (!current) {
      return;
    }
    state.dialog = null;
    current.el.remove();
    if (userInitiated && typeof current.onClose === 'function') {
      current.onClose();
    }
  }

  function openDialog(options) {
    closeDialog(false);

    const wrap = document.createElement('div');
    wrap.className = 'modal';

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', () => closeDialog(true));

    const card = document.createElement('section');
    card.className = 'modal-card' + (options.size === 'detail' ? ' detail' : '');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    const head = document.createElement('header');
    head.className = 'modal-head';
    const headCopy = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = options.title || '';
    headCopy.appendChild(title);
    if (options.subtitle) {
      const sub = document.createElement('p');
      sub.textContent = options.subtitle;
      headCopy.appendChild(sub);
    }
    head.appendChild(headCopy);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'বন্ধ করুন');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => closeDialog(true));
    head.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';
    if (options.body instanceof Node) {
      body.appendChild(options.body);
    } else if (typeof options.body === 'string') {
      body.innerHTML = options.body;
    }

    const foot = document.createElement('footer');
    foot.className = 'modal-foot';

    (options.actions || []).forEach((action) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = action.className || 'ghost-btn';
      btn.textContent = action.label || 'ঠিক আছে';
      btn.addEventListener('click', async () => {
        if (btn.disabled) {
          return;
        }
        if (typeof action.onClick !== 'function') {
          closeDialog(false);
          return;
        }
        btn.disabled = true;
        try {
          const result = await action.onClick();
          if (result !== false && !action.keepOpen) {
            closeDialog(false);
          }
        } catch (error) {
          toast(error?.message || 'কাজটি সম্পন্ন করা যায়নি।', 'error');
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
          }
        }
      });
      foot.appendChild(btn);
    });

    card.appendChild(head);
    card.appendChild(body);
    if (foot.childElementCount) {
      card.appendChild(foot);
    }
    wrap.appendChild(backdrop);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    state.dialog = { el: wrap, onClose: options.onClose };

    const focusTarget = body.querySelector('input, textarea, select, button');
    if (focusTarget) {
      setTimeout(() => focusTarget.focus({ preventScroll: true }), 60);
    }
  }

  function confirmDialog(options) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
        closeDialog(false);
      };

      const wrap = document.createElement('div');
      const note = document.createElement('p');
      note.className = 'dialog-note' + (options.danger ? ' danger' : '');
      note.textContent = options.message || '';
      wrap.appendChild(note);

      if (options.requireText) {
        const field = document.createElement('label');
        field.className = 'dialog-field';
        const label = document.createElement('span');
        label.textContent = 'নিশ্চিত করতে "' + options.requireText + '" লিখুন';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'confirmTextInput';
        input.autocomplete = 'off';
        input.placeholder = options.requireText;
        field.appendChild(label);
        field.appendChild(input);
        wrap.appendChild(field);
      }

      openDialog({
        title: options.title || 'নিশ্চিত করুন',
        subtitle: options.subtitle || '',
        body: wrap,
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
        actions: [
          { label: 'বাতিল', className: 'ghost-btn', onClick: () => finish(false) },
          {
            label: options.confirmLabel || 'হ্যাঁ, নিশ্চিত',
            className: options.danger === false ? 'primary-btn' : 'danger-btn',
            onClick: () => {
              if (options.requireText) {
                const input = document.getElementById('confirmTextInput');
                if (!input || input.value.trim() !== options.requireText) {
                  toast('নির্দিষ্ট লেখাটি হুবহু লিখুন।', 'warning');
                  return false;
                }
              }
              finish(true);
            }
          }
        ]
      });
    });
  }

  function showTempPassword(password) {
    const wrap = document.createElement('div');
    wrap.innerHTML = ''
      + '<p class="dialog-note">এই অস্থায়ী পাসওয়ার্ডটি ইউজারকে দিন। সে লগইন করে নিজের পাসওয়ার্ড বদলে নিতে পারবে। সব পুরনো সেশন বাতিল হয়েছে।</p>'
      + '<div class="temp-password"><code>' + esc(password) + '</code><button type="button" class="mini-btn" id="copyTempBtn">📋 কপি</button></div>';
    openDialog({
      title: 'অস্থায়ী পাসওয়ার্ড',
      body: wrap,
      actions: [{ label: 'ঠিক আছে', className: 'primary-btn' }]
    });
    const copyBtn = document.getElementById('copyTempBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(password);
          toast('পাসওয়ার্ড কপি হয়েছে।', 'success');
        } catch (error) {
          toast('কপি করা যায়নি — হাতে লিখে নিন।', 'warning');
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Gate                                                                */
  /* ------------------------------------------------------------------ */

  async function showGate(message, kind) {
    closeDialog(false);
    $('panel').hidden = true;
    $('gate').hidden = false;

    let hasPassword = true;
    try {
      hasPassword = await Auth.adminHasPassword();
    } catch (error) {
      hasPassword = true;
    }
    state.setupMode = !hasPassword;

    const title = $('gateTitle');
    const subtitle = $('gateSubtitle');
    const confirmWrap = $('gateConfirmWrap');
    const strength = $('gateStrength');
    const setupNote = $('gateSetup');
    const submitLabel = $('gateSubmitLabel');
    const password = $('gatePassword');
    const confirm = $('gateConfirm');
    const errorBox = $('gateError');

    if (!hasPassword) {
      if (title) title.textContent = 'অ্যাডমিন পাসওয়ার্ড সেটআপ';
      if (subtitle) subtitle.textContent = 'প্রথমবার ব্যবহারের জন্য একটি শক্তিশালী অ্যাডমিন পাসওয়ার্ড তৈরি করুন।';
      if (confirmWrap) confirmWrap.hidden = false;
      if (strength) strength.hidden = false;
      if (setupNote) setupNote.hidden = false;
      if (submitLabel) submitLabel.textContent = 'পাসওয়ার্ড সেভ করে প্রবেশ করুন';
    } else {
      if (title) title.textContent = 'অ্যাডমিন লগইন';
      if (subtitle) subtitle.textContent = 'শুধুমাত্র সঠিক অ্যাডমিন পাসওয়ার্ড দিয়েই এই প্যানেলে প্রবেশ করা যায়।';
      if (confirmWrap) confirmWrap.hidden = true;
      if (strength) strength.hidden = true;
      if (setupNote) setupNote.hidden = true;
      if (submitLabel) submitLabel.textContent = 'প্রবেশ করুন';
    }

    if (password) {
      password.value = '';
      password.placeholder = hasPassword ? 'আপনার গোপন অ্যাডমিন পাসওয়ার্ড' : 'কমপক্ষে ১০ অক্ষর, অক্ষর + সংখ্যা + চিহ্ন';
    }
    if (confirm) {
      confirm.value = '';
    }

    if (errorBox) {
      if (message) {
        errorBox.hidden = false;
        errorBox.textContent = message;
        errorBox.className = 'gate-error ' + (kind === 'success' ? '' : '');
        errorBox.style.borderColor = kind === 'success' ? 'rgba(16,185,129,0.4)' : '';
        errorBox.style.background = kind === 'success' ? 'rgba(16,185,129,0.12)' : '';
        errorBox.style.color = kind === 'success' ? '#6ee7b7' : '';
      } else {
        errorBox.hidden = true;
        errorBox.textContent = '';
      }
    }

    paintStrength($('gateStrengthText'), 0, '');
    await updateLockNote();
    setTimeout(() => {
      if ($('gatePassword')) {
        $('gatePassword').focus({ preventScroll: true });
      }
    }, 120);
  }

  async function updateLockNote() {
    const note = $('gateLock');
    if (!note) {
      return;
    }
    try {
      const record = await Auth.getAdminRecord();
      state.adminRecord = record;
      if (record && Number(record.lockUntil) > Date.now()) {
        const minutes = Math.max(1, Math.ceil((Number(record.lockUntil) - Date.now()) / 60000));
        note.textContent = '🔒 অনেকবার ভুল চেষ্টার কারণে লক করা আছে — ' + bn(minutes) + ' মিনিট পর আবার চেষ্টা করুন।';
        note.hidden = false;
      } else {
        note.hidden = true;
      }
    } catch (error) {
      note.hidden = true;
    }
  }

  async function onGateSubmit(event) {
    event.preventDefault();
    if (state.busy) {
      return;
    }
    const password = $('gatePassword') ? $('gatePassword').value : '';
    const confirm = $('gateConfirm') ? $('gateConfirm').value : '';
    const errorBox = $('gateError');

    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = '';
    }
    if (!password) {
      showGateError('অ্যাডমিন পাসওয়ার্ড দিন।');
      return;
    }

    state.busy = true;
    const submit = $('gateSubmit');
    if (submit) {
      submit.disabled = true;
      submit.classList.add('loading');
    }

    try {
      await loadDevice();
      const device = state.device || undefined;
      const network = state.network || undefined;

      if (state.setupMode) {
        if (String(password) !== String(confirm)) {
          showGateError('দুটি পাসওয়ার্ড মিলছে না।');
          return;
        }
        const setup = await Auth.adminSetup(password, confirm);
        if (!setup.ok) {
          showGateError(setup.error || 'পাসওয়ার্ড সেট করা যায়নি।');
          return;
        }
      }

      const result = await Auth.adminLogin(password, { device, network });
      if (!result || !result.ok) {
        showGateError((result && result.error) || 'অ্যাডমিন লগইন ব্যর্থ হয়েছে।');
        await updateLockNote();
        return;
      }

      if ($('gatePassword')) $('gatePassword').value = '';
      if ($('gateConfirm')) $('gateConfirm').value = '';
      await enterPanel();
    } catch (error) {
      showGateError(error?.message || 'অ্যাডমিন লগইন করা যায়নি।');
    } finally {
      state.busy = false;
      if (submit) {
        submit.disabled = false;
        submit.classList.remove('loading');
      }
    }
  }

  function showGateError(message) {
    const box = $('gateError');
    if (!box) {
      return;
    }
    box.hidden = false;
    box.textContent = message;
    box.style.borderColor = '';
    box.style.background = '';
    box.style.color = '';
  }

  /* ------------------------------------------------------------------ */
  /* Session / idle                                                     */
  /* ------------------------------------------------------------------ */

  async function enterPanel() {
    const session = await Auth.getAdminSession();
    if (!session) {
      await showGate('অ্যাডমিন সেশন পাওয়া যায়নি — আবার লগইন করুন।');
      return;
    }
    state.session = session;
    state.expiresAt = Number(session.expiresAt) || 0;
    state.locking = false;
    $('gate').hidden = true;
    $('panel').hidden = false;
    startSessionLoop();
    await loadCore();
    switchView(state.tab || 'dashboard');
    loadDevice().then(() => renderDeviceInfo()).catch(() => {});
    loadNetwork().then(() => renderDeviceInfo()).catch(() => {});
    toast('স্বাগতম — অ্যাডমিন প্যানেল প্রস্তুত।', 'success');
  }

  function startSessionLoop() {
    stopSessionLoop();
    state.timers.tick = setInterval(updateCountdown, 1000);
    state.timers.session = setInterval(checkSession, 20000);
    updateCountdown();
  }

  function stopSessionLoop() {
    if (state.timers.tick) {
      clearInterval(state.timers.tick);
      state.timers.tick = null;
    }
    if (state.timers.session) {
      clearInterval(state.timers.session);
      state.timers.session = null;
    }
  }

  async function checkSession() {
    const session = await Auth.getAdminSession();
    if (!session) {
      await lockPanel('নিষ্ক্রিয় সময়সীমা শেষ — আবার লগইন করুন।');
      return;
    }
    state.session = session;
    state.expiresAt = Number(session.expiresAt) || 0;
    updateCountdown();
  }

  function updateCountdown() {
    const chip = $('sessionChip');
    const bar = $('idleBar');
    if (!state.expiresAt) {
      if (chip) chip.textContent = '⏱ —';
      return;
    }
    const left = Math.max(0, state.expiresAt - Date.now());
    const minutes = Math.floor(left / 60000);
    const seconds = Math.floor((left % 60000) / 1000);
    if (chip) {
      chip.textContent = '⏱ ' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds + ' বাকি';
      chip.classList.toggle('warn', left <= 120000);
    }
    if (bar) {
      bar.hidden = left > 120000;
    }
    if (left <= 0) {
      lockPanel('অ্যাডমিন সেশন মেয়াদোত্তীর্ণ — আবার লগইন করুন।');
    }
  }

  async function touch() {
    if (!state.session || state.busy || state.locking) {
      return;
    }
    const now = Date.now();
    if (now - state.lastTouch < 20000) {
      return;
    }
    state.lastTouch = now;
    const session = await Auth.touchAdminSession();
    if (!session) {
      await lockPanel('অ্যাডমিন সেশন শেষ — আবার লগইন করুন।');
      return;
    }
    state.session = session;
    state.expiresAt = Number(session.expiresAt) || 0;
    updateCountdown();
  }

  async function lockPanel(message) {
    if (state.locking) {
      return;
    }
    state.locking = true;
    stopSessionLoop();
    state.session = null;
    state.expiresAt = 0;
    try {
      await Auth.adminLogout('অ্যাডমিন প্যানেল লক করা হয়েছে');
    } catch (error) {
      /* Session may already be gone. */
    }
    await showGate(message || 'লগইন প্রয়োজন।');
    state.locking = false;
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  async function init() {
    bindEvents();
    try {
      await Auth.init();
    } catch (error) {
      console.warn('[English Study admin] auth init:', error);
    }

    await loadDevice();
    loadNetwork().then(() => renderDeviceInfo()).catch(() => {});

    try {
      const session = await Auth.getAdminSession();
      if (session && Date.now() - Number(session.issuedAt || 0) <= GRACE_MS) {
        await enterPanel();
      } else {
        await showGate('');
      }
    } catch (error) {
      console.warn('[English Study admin] gate:', error);
      await showGate('লগইন স্ক্রিন লোড করা যায়নি — পেজটি রিফ্রেশ করুন।');
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        const keys = Object.keys(changes || {});
        if (!keys.some((key) => [Auth.KEYS.users, Auth.KEYS.promos, Auth.KEYS.logs, Auth.KEYS.settings, Auth.KEYS.admin].includes(key))) {
          return;
        }
        if (area === 'local' || !area) {
          queueRefresh();
        }
      });
    } catch (error) {
      /* Optional. */
    }

    try {
      chrome.runtime.onMessage.addListener((message) => {
        if (message && message.type === 'AUTH_BROADCAST') {
          queueRefresh();
        }
      });
    } catch (error) {
      /* Optional. */
    }
  }

  function queueRefresh() {
    if (state.refreshQueued) {
      return;
    }
    state.refreshQueued = true;
    setTimeout(async () => {
      state.refreshQueued = false;
      if (!state.session) {
        return;
      }
      await loadCore();
      renderCurrent();
    }, 320);
  }

  function bindEvents() {
    document.querySelectorAll('.side-nav .nav-item').forEach((button) => {
      button.addEventListener('click', () => switchView(button.getAttribute('data-view')));
    });

    document.addEventListener('click', (event) => {
      const go = event.target.closest('[data-go]');
      if (go) {
        switchView(go.getAttribute('data-go'));
      }
    });

    $('gateForm')?.addEventListener('submit', onGateSubmit);
    $('gatePassword')?.addEventListener('input', updateGateStrength);
    $('gateConfirm')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        onGateSubmit(event);
      }
    });
    $('gateCloseBtn')?.addEventListener('click', () => {
      window.close();
      setTimeout(() => {
        if (!window.closed) {
          toast('ট্যাবটি ম্যানুয়ালি বন্ধ করুন।', 'info');
        }
      }, 260);
    });

    document.querySelectorAll('[data-eye]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.getAttribute('data-eye'));
        if (!input) {
          return;
        }
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? '🙈' : '👁';
      });
    });

    $('sideLockBtn')?.addEventListener('click', () => lockPanel('আপনি নিজে প্যানেল লক করেছেন।'));
    $('refreshBtn')?.addEventListener('click', async () => {
      await loadCore();
      if (state.tab === 'logs') {
        await loadLogs();
      }
      renderCurrent();
      renderDeviceInfo();
      toast('ডেটা রিফ্রেশ হয়েছে।', 'info');
    });

    $('userSearch')?.addEventListener('input', () => {
      state.userQuery = $('userSearch').value;
      renderUsers();
    });
    $('userStatus')?.addEventListener('change', () => {
      state.userStatus = $('userStatus').value;
      renderUsers();
    });
    $('userSort')?.addEventListener('change', () => {
      state.userSort = $('userSort').value;
      renderUsers();
    });
    $('userCsvBtn')?.addEventListener('click', exportUsersCsv);

    $('usersBody')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) {
        return;
      }
      const id = button.getAttribute('data-id');
      const action = button.getAttribute('data-action');
      if (!id) {
        return;
      }
      if (action === 'detail') {
        await openUserDetail(id);
      } else if (action === 'expiry') {
        await openExpiryDialog(id);
      } else if (action === 'status') {
        await openStatusDialog(id);
      } else if (action === 'logout') {
        await forceLogoutUser(id);
      }
    });

    $('promoForm')?.addEventListener('submit', onCreatePromo);
    $('promoCode')?.addEventListener('input', () => {
      const input = $('promoCode');
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
    });
    $('promosBody')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-promo-action]');
      if (!button) {
        return;
      }
      const id = button.getAttribute('data-id');
      const action = button.getAttribute('data-promo-action');
      if (action === 'toggle') {
        await togglePromo(id);
      } else if (action === 'delete') {
        await deletePromo(id);
      } else if (action === 'copy') {
        const code = button.getAttribute('data-code') || '';
        try {
          await navigator.clipboard.writeText(code);
          toast('কোড কপি হয়েছে: ' + code, 'success');
        } catch (error) {
          toast('কপি করা যায়নি।', 'warning');
        }
      }
    });

    $('logApplyBtn')?.addEventListener('click', () => loadLogs(true));
    $('logGroup')?.addEventListener('change', () => loadLogs(true));
    $('logSearch')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        loadLogs(true);
      }
    });
    $('logCsvBtn')?.addEventListener('click', exportLogsCsv);
    $('logClearBtn')?.addEventListener('click', clearLogs);

    $('securityForm')?.addEventListener('submit', onChangeAdminPassword);
    $('secNew')?.addEventListener('input', () => {
      const value = $('secNew') ? $('secNew').value : '';
      paintStrength($('secStrengthText'), H.passwordScore(value), value);
    });
    $('backupBtn')?.addEventListener('click', exportBackup);
    $('resetBtn')?.addEventListener('click', factoryReset);

    $('settingsForm')?.addEventListener('submit', saveSettings);
    $('settingsReloadBtn')?.addEventListener('click', () => {
      fillSettings(state.settings);
      toast('ফর্ম রিসেট হয়েছে।', 'info');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.dialog) {
        closeDialog(true);
      }
    });

    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    document.addEventListener('scroll', touch, true);
  }

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */

  async function loadCore() {
    const [stats, rawUsers, promos, settings, recent] = await Promise.all([
      Auth.getStats(),
      Auth.listUsers(),
      Auth.listPromos(),
      Auth.getSettings(),
      Auth.listLogs({})
    ]);
    state.stats = stats;
    // Only show the password-free projection in the admin UI.
    state.users = rawUsers.map((user) => Auth.publicUser(user)).filter(Boolean);
    state.promos = promos;
    state.settings = settings;
    state.recent = recent.slice(0, 10);
    state.adminRecord = await Auth.getAdminRecord();
    fillSettings(settings);
    renderDashboard();
    renderUsers();
    renderPromos();
    renderSecurity();
    renderSystem();
  }

  async function loadLogs(force) {
    if (!force && state.logLoaded) {
      renderLogs();
      return;
    }
    const group = $('logGroup') ? $('logGroup').value : 'all';
    const search = $('logSearch') ? $('logSearch').value.trim() : '';
    const fromDate = $('logFrom') ? $('logFrom').value : '';
    const toDate = $('logTo') ? $('logTo').value : '';
    const from = fromDate ? new Date(fromDate + 'T00:00:00').getTime() : 0;
    const to = toDate ? new Date(toDate + 'T23:59:59').getTime() : 0;

    try {
      state.logs = await Auth.listLogs({ group, search, from, to });
      state.logLoaded = true;
    } catch (error) {
      state.logs = [];
    }
    renderLogs();
  }

  function renderDeviceInfo() {
    const device = state.device;
    const network = state.network;
    const label = device ? device.label + (device.screen ? ' • ' + device.screen : '') : '—';
    const net = network ? Auth.networkLabel(network) : (device ? 'লোড হচ্ছে…' : '—');
    if ($('dashDevice')) $('dashDevice').textContent = label;
    if ($('dashNetwork')) $('dashNetwork').textContent = net;
    if ($('dashSession')) $('dashSession').textContent = state.session
      ? 'সক্রিয় • ' + bn(Math.max(1, state.settings ? state.settings.adminIdleMinutes : 20)) + ' মিনিট নিষ্ক্রিয় সীমা'
      : '—';
    if ($('sideDevice')) $('sideDevice').textContent = device
      ? '💻 ' + device.label + (network && network.ip ? ' • ' + network.ip : '')
      : '—';
    if ($('secDevice')) $('secDevice').textContent = label;
    if ($('secNetwork')) $('secNetwork').textContent = net;
    if ($('dashManifest')) {
      try {
        const manifest = chrome.runtime.getManifest();
        $('dashManifest').textContent = 'v' + manifest.version;
      } catch (error) {
        $('dashManifest').textContent = '—';
      }
    }
  }

  async function loadDevice() {
    try {
      state.device = await Auth.getDeviceInfo();
    } catch (error) {
      state.device = null;
    }
  }

  async function loadNetwork() {
    try {
      state.network = await Auth.getNetworkInfo();
    } catch (error) {
      state.network = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                               */
  /* ------------------------------------------------------------------ */

  function switchView(name) {
    if (!VIEW_META[name]) {
      return;
    }
    state.tab = name;
    document.querySelectorAll('.side-nav .nav-item').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-view') === name);
    });
    ['dashboard', 'users', 'promos', 'logs', 'security', 'settings'].forEach((view) => {
      const section = $('view-' + view);
      if (section) {
        section.hidden = view !== name;
      }
    });
    if ($('viewTitle')) $('viewTitle').textContent = VIEW_META[name].title;
    if ($('viewSubtitle')) $('viewSubtitle').textContent = VIEW_META[name].subtitle;

    if (name === 'dashboard') renderDashboard();
    if (name === 'users') renderUsers();
    if (name === 'promos') renderPromos();
    if (name === 'logs') loadLogs(false);
    if (name === 'security') renderSecurity();
    if (name === 'settings') renderSystem();
    renderDeviceInfo();

    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      /* Ignore. */
    }
  }

  function renderCurrent() {
    if (!state.session) {
      return;
    }
    if (state.tab === 'dashboard') renderDashboard();
    else if (state.tab === 'users') renderUsers();
    else if (state.tab === 'promos') renderPromos();
    else if (state.tab === 'logs') {
      state.logLoaded = false;
      loadLogs(true);
    } else if (state.tab === 'security') renderSecurity();
    else if (state.tab === 'settings') renderSystem();
    renderDeviceInfo();
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                           */
  /* ------------------------------------------------------------------ */

  function renderDashboard() {
    const stats = state.stats;
    if (!stats) {
      return;
    }
    if ($('statTotal')) $('statTotal').textContent = bn(stats.total);
    if ($('statActive')) $('statActive').textContent = bn(stats.active);
    if ($('statExpired')) $('statExpired').textContent = bn(stats.expired);
    if ($('statBlocked')) $('statBlocked').textContent = bn(stats.banned + stats.suspended);
    if ($('statToday')) $('statToday').textContent = bn(stats.newToday);
    if ($('statLogins')) $('statLogins').textContent = bn(stats.loginsToday);
    if ($('statPromos')) $('statPromos').textContent = bn(stats.promosActive);
    if ($('statWeek')) $('statWeek').textContent = bn(stats.newWeek);

    const list = $('recentList');
    if (list) {
      list.replaceChildren();
      if (!state.recent.length) {
        const li = document.createElement('li');
        li.className = 'empty-row';
        li.textContent = 'এখনো কোনো লগ নেই।';
        list.appendChild(li);
      } else {
        state.recent.forEach((entry) => {
          const li = document.createElement('li');
          li.className = 'sev-' + severity(entry.action);

          const dot = document.createElement('span');
          dot.className = 'recent-dot';
          dot.setAttribute('aria-hidden', 'true');

          const body = document.createElement('div');
          body.className = 'recent-body';
          const head = document.createElement('strong');
          head.textContent = entry.label || entry.action;
          const time = document.createElement('span');
          time.textContent = fmt(entry.at);
          head.appendChild(time);

          const detail = document.createElement('p');
          detail.textContent = entry.detail || '—';

          const meta = document.createElement('small');
          meta.textContent = [
            entry.userName || (entry.actorType === 'admin' ? 'Admin' : entry.actorType === 'guest' ? 'Guest' : ''),
            entry.device && entry.device.label,
            entry.network && entry.network.ip
          ].filter(Boolean).join(' • ') || '—';

          body.appendChild(head);
          body.appendChild(detail);
          body.appendChild(meta);
          li.appendChild(dot);
          li.appendChild(body);
          list.appendChild(li);
        });
      }
    }
    renderDeviceInfo();
    renderSystem();
  }

  function severity(action) {
    if (/failed|banned|delete|reset|expired|block|revoked/i.test(action || '')) return 'bad';
    if (/suspend|force|lock|logout|expiry/i.test(action || '')) return 'warn';
    if (/login|register|activate|redeem|password_change/i.test(action || '')) return 'good';
    return 'info';
  }

  /* ------------------------------------------------------------------ */
  /* Users                                                               */
  /* ------------------------------------------------------------------ */

  function userState(user) {
    const now = Date.now();
    if (user.status === 'banned') {
      return { key: 'banned', label: 'ব্যান' };
    }
    if (user.status === 'suspended') {
      return { key: 'suspended', label: 'সাসপেন্ড' };
    }
    if (Number(user.expiresAt) > now) {
      return user.trial ? { key: 'trial', label: 'ট্রায়াল' } : { key: 'active', label: 'সক্রিয়' };
    }
    return { key: 'expired', label: 'মেয়াদোত্তীর্ণ' };
  }

  function filteredUsers() {
    const query = String(state.userQuery || '').trim().toLowerCase();
    const filter = state.userStatus || 'all';
    const now = Date.now();

    let users = state.users.slice();
    if (query) {
      users = users.filter((user) => {
        const haystack = [
          user.name, user.username, user.email, user.phone,
          user.lastLoginDevice && user.lastLoginDevice.label,
          user.lastLoginDevice && user.lastLoginDevice.ip
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }
    if (filter === 'active') {
      users = users.filter((user) => user.status === 'active' && Number(user.expiresAt) > now);
    } else if (filter === 'expired') {
      users = users.filter((user) => user.status === 'active' && Number(user.expiresAt) <= now);
    } else if (filter === 'trial') {
      users = users.filter((user) => user.trial && user.status === 'active');
    } else if (filter && filter !== 'all') {
      users = users.filter((user) => user.status === filter);
    }

    const sort = state.userSort || 'newest';
    users.sort((a, b) => {
      if (sort === 'oldest') return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      if (sort === 'expiry') return Number(a.expiresAt || 0) - Number(b.expiresAt || 0);
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'bn');
      if (sort === 'login') return Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0);
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
    return users;
  }

  function renderUsers() {
    const body = $('usersBody');
    if (!body) {
      return;
    }
    const users = filteredUsers();
    const active = state.users.filter((user) => user.status === 'active' && Number(user.expiresAt) > Date.now()).length;
    const expired = state.users.filter((user) => user.status === 'active' && Number(user.expiresAt) <= Date.now()).length;
    if ($('userSummary')) {
      $('userSummary').textContent = 'দেখানো হচ্ছে ' + bn(users.length) + ' / ' + bn(state.users.length)
        + ' • সক্রিয় ' + bn(active) + ' • মেয়াদোত্তীর্ণ ' + bn(expired)
        + ' • ব্যান ' + bn(state.stats ? state.stats.banned : 0);
    }

    if (!users.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty-row">কোনো ইউজার পাওয়া যায়নি।</td></tr>';
      return;
    }

    body.innerHTML = users.map((user) => {
      const st = userState(user);
      const days = user.expiresAt ? Math.ceil((Number(user.expiresAt) - Date.now()) / 86400000) : 0;
      const expiry = user.expiresAt
        ? '<strong>' + esc(fmtShort(user.expiresAt)) + '</strong><span>' + (days > 0 ? bn(days) + ' দিন বাকি' : 'শেষ হয়েছে') + '</span>'
        : '<strong>নির্ধারিত নয়</strong><span>প্রোমো কোড দিন</span>';
      const device = user.lastLoginDevice
        ? esc(user.lastLoginDevice.label || '—') + (user.lastLoginDevice.ip ? '<br><span class="cell-contact">' + esc(user.lastLoginDevice.ip) + '</span>' : '')
        : '<span class="cell-contact">—</span>';
      const contact = [
        user.email ? '<span>✉ ' + esc(user.email) + '</span>' : '',
        user.phone ? '<span>📱 ' + esc(user.phone) + '</span>' : '',
        user.username ? '<span>@' + esc(user.username) + '</span>' : ''
      ].filter(Boolean).join('') || '<span class="cell-contact">—</span>';

      return ''
        + '<tr>'
        + '<td class="cell-user"><strong>' + esc(user.name || 'User') + '</strong><span>' + esc(user.id) + '</span></td>'
        + '<td class="cell-contact">' + contact + '</td>'
        + '<td><span class="badge ' + st.key + '">' + esc(st.label) + '</span></td>'
        + '<td class="cell-expiry">' + expiry + '</td>'
        + '<td class="cell-contact">' + (user.lastLoginAt ? esc(fmt(user.lastLoginAt)) : '—') + '</td>'
        + '<td class="cell-device">' + device + '</td>'
        + '<td><div class="row-actions">'
        + '<button class="mini-btn" type="button" data-action="detail" data-id="' + esc(user.id) + '">বিস্তারিত</button>'
        + '<button class="mini-btn gold" type="button" data-action="expiry" data-id="' + esc(user.id) + '">মেয়াদ</button>'
        + '<button class="mini-btn" type="button" data-action="status" data-id="' + esc(user.id) + '">স্ট্যাটাস</button>'
        + '<button class="mini-btn danger" type="button" data-action="logout" data-id="' + esc(user.id) + '">লগআউট</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
  }

  async function openUserDetail(userId) {
    const user = Auth.publicUser(await Auth.findUser(userId));
    if (!user) {
      toast('ইউজার পাওয়া যায়নি।', 'error');
      return;
    }
    const st = userState(user);
    const days = user.expiresAt ? Math.max(0, Math.ceil((Number(user.expiresAt) - Date.now()) / 86400000)) : 0;
    const devices = Array.isArray(user.devices) ? user.devices : [];
    const promos = Array.isArray(user.promos) ? user.promos : [];

    let html = ''
      + '<div class="dialog-grid">'
      + '<div class="dialog-cell wide"><span>নাম / আইডি</span><strong>' + esc(user.name) + ' • ' + esc(user.id) + '</strong></div>'
      + '<div class="dialog-cell"><span>ইউজারনেম</span><strong>' + esc(user.username || '—') + '</strong></div>'
      + '<div class="dialog-cell"><span>স্ট্যাটাস</span><strong>' + esc(st.label) + (user.reason ? ' — ' + esc(user.reason) : '') + '</strong></div>'
      + '<div class="dialog-cell"><span>ইমেইল</span><strong>' + esc(user.email || '—') + '</strong></div>'
      + '<div class="dialog-cell"><span>ফোন</span><strong>' + esc(user.phone || '—') + '</strong></div>'
      + '<div class="dialog-cell"><span>তৈরি</span><strong>' + esc(fmt(user.createdAt)) + '</strong></div>'
      + '<div class="dialog-cell"><span>শেষ লগইন</span><strong>' + (user.lastLoginAt ? esc(fmt(user.lastLoginAt)) : '—') + '</strong></div>'
      + '<div class="dialog-cell"><span>মেয়াদ শেষ</span><strong>' + (user.expiresAt ? esc(fmt(user.expiresAt)) : 'নির্ধারিত নয়') + '</strong></div>'
      + '<div class="dialog-cell"><span>বাকি</span><strong>' + (days > 0 ? bn(days) + ' দিন' : 'শেষ') + '</strong></div>'
      + '<div class="dialog-cell"><span>মোট লগইন</span><strong>' + bn(user.loginCount || 0) + '</strong></div>'
      + '</div>';

    html += '<h4 style="margin:4px 0 7px;font-size:12px;color:#94a3b8">📱 ডিভাইস</h4>';
    if (!devices.length) {
      html += '<p class="dialog-note">কোনো ডিভাইস রেকর্ড নেই।</p>';
    } else {
      html += '<ul class="dialog-list">';
      devices.slice().reverse().forEach((device) => {
        html += '<li><span><strong>' + esc(device.label || 'Unknown') + '</strong><br>'
          + esc([device.os, device.browser, device.screen].filter(Boolean).join(' • ')) + '</span>'
          + '<span>' + esc(device.ip || '') + '<br>' + esc(fmtShort(device.lastSeen)) + '</span></li>';
      });
      html += '</ul>';
    }

    html += '<h4 style="margin:4px 0 7px;font-size:12px;color:#94a3b8">🎟️ ব্যবহৃত প্রোমো</h4>';
    if (!promos.length) {
      html += '<p class="dialog-note">এখনো কোনো প্রোমো কোড ব্যবহার করেননি।</p>';
    } else {
      html += '<ul class="dialog-list">';
      promos.slice().reverse().forEach((promo) => {
        html += '<li><strong>' + esc(promo.code) + '</strong><span>+' + bn(promo.days) + ' দিন • ' + esc(fmtShort(promo.at)) + '</span></li>';
      });
      html += '</ul>';
    }

    openDialog({
      title: 'ইউজার বিস্তারিত',
      subtitle: 'সব তথ্য এই ব্রাউজারের লোকাল ডাটাবেস থেকে নেওয়া।',
      size: 'detail',
      body: html,
      actions: [
        {
          label: '🔑 পাসওয়ার্ড রিসেট',
          className: 'ghost-btn',
          onClick: async () => {
            closeDialog(false);
            await resetUserPassword(user.id, user.name);
          }
        },
        {
          label: '🗑 ডিলিট',
          className: 'danger-btn',
          onClick: async () => {
            closeDialog(false);
            await deleteUser(user.id, user.name);
          }
        },
        {
          label: 'মেয়াদ বাড়ান',
          className: 'primary-btn',
          onClick: async () => {
            closeDialog(false);
            await openExpiryDialog(user.id);
          }
        }
      ]
    });
  }

  async function openExpiryDialog(userId) {
    const user = Auth.publicUser(await Auth.findUser(userId));
    if (!user) {
      toast('ইউজার পাওয়া যায়নি।', 'error');
      return;
    }
    const days = user.expiresAt ? Math.max(0, Math.ceil((Number(user.expiresAt) - Date.now()) / 86400000)) : 0;

    const wrap = document.createElement('div');
    wrap.innerHTML = ''
      + '<p class="dialog-note">বর্তমান মেয়াদ: <strong>' + (user.expiresAt ? esc(fmt(user.expiresAt)) : 'নির্ধারিত নয়')
      + '</strong> — ' + (days > 0 ? bn(days) + ' দিন বাকি' : 'অ্যাক্সেস বন্ধ') + '</p>'
      + '<div class="row-actions" style="margin-bottom:14px">'
      + [2, 3, 7, 30].map((n) => '<button type="button" class="mini-btn gold" data-days="' + n + '">+' + bn(n) + ' দিন</button>').join('')
      + '</div>'
      + '<label class="dialog-field"><span>নির্দিষ্ট তারিখ ও সময় পর্যন্ত</span>'
      + '<input id="expiryCustom" type="datetime-local" value="' + esc(localDatetime(user.expiresAt || Date.now() + 7 * 86400000)) + '"></label>'
      + '<p class="dialog-note">মেয়াদ শেষ হলে অ্যাক্সেস সাথে সাথে স্বয়ংক্রিয়ভাবে বন্ধ হয়ে যাবে (পরবর্তী রিফ্রেশে)।</p>';

    openDialog({
      title: 'মেয়াদ নির্ধারণ',
      subtitle: user.name,
      body: wrap,
      actions: [
        {
          label: 'মেয়াদ শেষ করুন',
          className: 'danger-btn',
          onClick: async () => {
            const result = await Auth.setUserExpiry(user.id, 0, 'অ্যাডমিন মেয়াদ শেষ করেছেন');
            await handleResult(result, 'মেয়াদ বন্ধ করা হয়েছে।');
          }
        },
        {
          label: 'এই তারিখে সেট করুন',
          className: 'primary-btn',
          onClick: async () => {
            const input = document.getElementById('expiryCustom');
            const value = input ? new Date(input.value).getTime() : 0;
            if (!value || Number.isNaN(value)) {
              toast('সঠিক তারিখ ও সময় দিন।', 'warning');
              return false;
            }
            const result = await Auth.setUserExpiry(user.id, value, 'অ্যাডমিন মেয়াদ নির্ধারণ: ' + fmt(value));
            await handleResult(result, 'মেয়াদ সেট হয়েছে: ' + fmt(value));
          }
        }
      ]
    });

    wrap.querySelectorAll('[data-days]').forEach((button) => {
      button.addEventListener('click', async () => {
        const n = Number(button.getAttribute('data-days'));
        // "Set to N days" = a fresh N-day validity from now, not an extension.
        const expiresAt = Date.now() + n * 86400000;
        button.disabled = true;
        const result = await Auth.updateUser(user.id, { expiresAt, trial: false }, {
          action: 'user_expiry_set',
          detail: 'অ্যাডমিন মেয়াদ নির্ধারণ: ' + bn(n) + ' দিন (' + fmt(expiresAt) + ' পর্যন্ত)'
        });
        await handleResult(result, 'মেয়াদ ' + bn(n) + ' দিন সেট করা হয়েছে।');
        closeDialog(false);
      });
    });
  }

  function localDatetime(ts) {
    const date = new Date(Number(ts) || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
      + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  async function openStatusDialog(userId) {
    const user = Auth.publicUser(await Auth.findUser(userId));
    if (!user) {
      toast('ইউজার পাওয়া যায়নি।', 'error');
      return;
    }
    const st = userState(user);
    const wrap = document.createElement('div');
    wrap.innerHTML = ''
      + '<p class="dialog-note">বর্তমান স্ট্যাটাস: <strong>' + esc(st.label) + '</strong>'
      + (user.reason ? ' — ' + esc(user.reason) : '') + '</p>'
      + '<label class="dialog-field"><span>কারণ (ঐচ্ছিক)</span>'
      + '<textarea id="statusReason" placeholder="যেমন: নিয়ম লঙ্ঘন / পেমেন্ট সমস্যা"></textarea></label>'
      + '<p class="dialog-note danger">ব্যান বা সাসপেন্ড করলে চলমান সেশন বাতিল হয়ে যায় এবং অ্যাক্সেস সাথে সাথে বন্ধ হয়।</p>';

    openDialog({
      title: 'স্ট্যাটাস নিয়ন্ত্রণ',
      subtitle: user.name,
      body: wrap,
      actions: [
        {
          label: '✅ সক্রিয় করুন',
          className: 'ghost-btn',
          onClick: async () => {
            const result = await Auth.updateUser(user.id, { status: 'active', reason: '' }, {
              action: 'user_unban',
              detail: 'ব্যান/সাসপেন্ড প্রত্যাহার'
            });
            await handleResult(result, 'অ্যাকাউন্ট আবার সক্রিয় করা হয়েছে।');
          }
        },
        {
          label: '⏸ সাসপেন্ড',
          className: 'ghost-btn',
          onClick: async () => {
            const reason = document.getElementById('statusReason')?.value || '';
            const result = await Auth.suspendUser(user.id, reason);
            await handleResult(result, 'অ্যাকাউন্ট সাসপেন্ড করা হয়েছে।');
          }
        },
        {
          label: '⛔ ব্যান করুন',
          className: 'danger-btn',
          onClick: async () => {
            const reason = document.getElementById('statusReason')?.value || '';
            const result = await Auth.banUser(user.id, reason);
            await handleResult(result, 'অ্যাকাউন্ট ব্যান করা হয়েছে।');
          }
        }
      ]
    });
  }

  async function forceLogoutUser(userId) {
    const user = Auth.publicUser(await Auth.findUser(userId));
    if (!user) {
      return;
    }
    const ok = await confirmDialog({
      title: 'সব ডিভাইস থেকে লগআউট?',
      message: user.name + ' — এর চলমান সব সেশন বাতিল হবে এবং তাকে আবার লগইন করতে হবে।',
      confirmLabel: 'লগআউট করুন'
    });
    if (!ok) {
      return;
    }
    const result = await Auth.forceLogout(userId);
    await handleResult(result, 'সব ডিভাইস থেকে লগআউট করা হয়েছে।');
  }

  async function resetUserPassword(userId, name) {
    const ok = await confirmDialog({
      title: 'পাসওয়ার্ড রিসেট করবেন?',
      message: name + ' — এর জন্য একটি অস্থায়ী পাসওয়ার্ড তৈরি হবে এবং সব সেশন বাতিল হবে।',
      confirmLabel: 'রিসেট করুন'
    });
    if (!ok) {
      return;
    }
    const result = await Auth.resetUserPassword(userId);
    if (!result.ok) {
      toast(result.error || 'পাসওয়ার্ড রিসেট করা যায়নি।', 'error');
      return;
    }
    await loadCore();
    renderCurrent();
    showTempPassword(result.password);
  }

  async function deleteUser(userId, name) {
    const ok = await confirmDialog({
      title: 'ইউজার ডিলিট করবেন?',
      message: name + ' — এর অ্যাকাউন্ট, সেশন ও সম্পর্কিত তথ্য স্থায়ীভাবে মুছে যাবে। এটি ফিরিয়ে আনা যাবে না।',
      confirmLabel: 'ডিলিট করুন',
      requireText: 'DELETE'
    });
    if (!ok) {
      return;
    }
    const result = await Auth.deleteUser(userId);
    await handleResult(result, 'ইউজার ডিলিট করা হয়েছে।');
  }

  async function handleResult(result, successText) {
    if (result && result.ok) {
      toast(successText || 'সম্পন্ন হয়েছে।', 'success');
      await loadCore();
      renderCurrent();
    } else {
      toast((result && result.error) || 'কাজটি সম্পন্ন করা যায়নি।', 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Promos                                                              */
  /* ------------------------------------------------------------------ */

  function renderPromos() {
    const body = $('promosBody');
    if (!body) {
      return;
    }
    const promos = state.promos;
    if ($('promoSummary')) {
      const active = promos.filter((promo) => promo.active && (!promo.expiresAt || Number(promo.expiresAt) > Date.now())).length;
      $('promoSummary').textContent = 'মোট ' + bn(promos.length) + ' • সক্রিয় ' + bn(active)
        + ' • মোট ব্যবহার ' + bn(promos.reduce((sum, promo) => sum + (Number(promo.usedCount) || 0), 0));
    }
    if (!promos.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty-row">এখনো কোনো প্রোমো কোড তৈরি করা হয়নি।</td></tr>';
      return;
    }
    body.innerHTML = promos.map((promo) => {
      const expired = promo.expiresAt && Number(promo.expiresAt) <= Date.now();
      const exhausted = promo.maxUses > 0 && Number(promo.usedCount) >= Number(promo.maxUses);
      const active = promo.active && !expired && !exhausted;
      return ''
        + '<tr>'
        + '<td><span class="promo-code">' + esc(promo.code) + '</span><br><span class="cell-contact">' + esc(promo.note || '') + '</span></td>'
        + '<td><strong>' + bn(promo.days) + '</strong> দিন</td>'
        + '<td>' + bn(promo.usedCount || 0) + ' / ' + (promo.maxUses > 0 ? bn(promo.maxUses) : '∞') + '</td>'
        + '<td class="cell-contact">' + (promo.expiresAt ? esc(fmtShort(promo.expiresAt)) : 'সীমাহীন') + '</td>'
        + '<td><span class="badge ' + (active ? 'active' : 'off') + '">' + (active ? 'সক্রিয়' : expired ? 'মেয়াদোত্তীর্ণ' : exhausted ? 'সীমা শেষ' : 'নিষ্ক্রিয়') + '</span></td>'
        + '<td class="cell-contact">' + esc(fmt(promo.createdAt)) + '</td>'
        + '<td><div class="row-actions">'
        + '<button class="mini-btn" type="button" data-promo-action="copy" data-code="' + esc(promo.code) + '">কপি</button>'
        + '<button class="mini-btn ' + (promo.active ? '' : 'good') + '" type="button" data-promo-action="toggle" data-id="' + esc(promo.id) + '">' + (promo.active ? 'নিষ্ক্রিয়' : 'সক্রিয়') + '</button>'
        + '<button class="mini-btn danger" type="button" data-promo-action="delete" data-id="' + esc(promo.id) + '">ডিলিট</button>'
        + '</div></td>'
        + '</tr>';
    }).join('');
  }

  async function onCreatePromo(event) {
    event.preventDefault();
    const message = $('promoMessage');
    if (message) {
      message.hidden = true;
    }
    const code = $('promoCode') ? $('promoCode').value.trim() : '';
    const days = $('promoDays') ? Number($('promoDays').value) : 0;
    const maxUses = $('promoMaxUses') ? Number($('promoMaxUses').value) : 0;
    const expiry = $('promoExpiry') ? $('promoExpiry').value : '';
    const note = $('promoNote') ? $('promoNote').value.trim() : '';
    const expiresAt = expiry ? new Date(expiry + 'T23:59:59').getTime() : 0;

    if (!code) {
      showPromoMessage('প্রোমো কোড লিখুন।', 'error');
      return;
    }
    if (!days || days < 1) {
      showPromoMessage('১ থেকে ৩৬৫০ দিনের মধ্যে মেয়াদ দিন।', 'error');
      return;
    }

    const button = $('promoCreateBtn');
    if (button) button.disabled = true;
    const result = await Auth.createPromo({ code, days, maxUses, expiresAt, note });
    if (button) button.disabled = false;

    if (!result.ok) {
      showPromoMessage(result.error || 'কোড তৈরি করা যায়নি।', 'error');
      return;
    }
    if ($('promoCode')) $('promoCode').value = '';
    if ($('promoNote')) $('promoNote').value = '';
    if ($('promoMaxUses')) $('promoMaxUses').value = '0';
    showPromoMessage('✅ কোড তৈরি হয়েছে: ' + result.promo.code + ' — ' + bn(result.promo.days) + ' দিন', 'success');
    toast('প্রোমো কোড তৈরি হয়েছে।', 'success');
    await loadCore();
    renderPromos();
  }

  function showPromoMessage(text, type) {
    const message = $('promoMessage');
    if (!message) {
      return;
    }
    message.hidden = false;
    message.textContent = text;
    message.className = 'form-message ' + (type || 'info');
  }

  async function togglePromo(id) {
    const promo = state.promos.find((item) => item.id === id);
    if (!promo) {
      return;
    }
    const active = !promo.active;
    const result = await Auth.updatePromo(id, { active }, 'promo_update',
      'প্রোমো কোড ' + promo.code + (active ? ' সক্রিয়' : ' নিষ্ক্রিয়') + ' করা হয়েছে');
    if (result.ok) {
      toast('কোড ' + (active ? 'সক্রিয়' : 'নিষ্ক্রিয়') + ' করা হয়েছে।', 'success');
      await loadCore();
      renderPromos();
    } else {
      toast(result.error || 'আপডেট করা যায়নি।', 'error');
    }
  }

  async function deletePromo(id) {
    const promo = state.promos.find((item) => item.id === id);
    if (!promo) {
      return;
    }
    const ok = await confirmDialog({
      title: 'প্রোমো কোড ডিলিট?',
      message: promo.code + ' — কোডটি স্থায়ীভাবে মুছে যাবে। ইতিমধ্যে ব্যবহার করা মেয়াদ অপরিবর্তিত থাকবে।',
      confirmLabel: 'ডিলিট করুন'
    });
    if (!ok) {
      return;
    }
    const result = await Auth.deletePromo(id);
    if (result.ok) {
      toast('প্রোমো কোড ডিলিট হয়েছে।', 'success');
      await loadCore();
      renderPromos();
    } else {
      toast(result.error || 'ডিলিট করা যায়নি।', 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Logs                                                                */
  /* ------------------------------------------------------------------ */

  function renderLogs() {
    const body = $('logsBody');
    if (!body) {
      return;
    }
    const logs = state.logs;
    if ($('logSummary')) {
      $('logSummary').textContent = 'দেখানো হচ্ছে ' + bn(Math.min(logs.length, 300)) + ' / ' + bn(logs.length)
        + ' লগ • পাসওয়ার্ড বা গোপন তথ্য লগে রাখা হয় না';
    }
    if (!logs.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-row">এই ফিল্টারে কোনো লগ পাওয়া যায়নি।</td></tr>';
      return;
    }
    body.innerHTML = logs.slice(0, 300).map((entry) => {
      const sev = severity(entry.action);
      const device = entry.device
        ? [entry.device.label, entry.device.os, entry.device.browser].filter(Boolean).join(' • ')
        : '—';
      const network = entry.network
        ? [entry.network.ip, entry.network.city, entry.network.region, entry.network.country].filter(Boolean).join(', ')
        : '—';
      const person = entry.actorType === 'admin'
        ? 'Admin'
        : (entry.userName || entry.targetName || 'Guest');
      return ''
        + '<tr>'
        + '<td class="log-time">' + esc(fmt(entry.at)) + '</td>'
        + '<td><span class="log-dot ' + sev + '"></span><span class="log-action">' + esc(entry.label || entry.action) + '</span></td>'
        + '<td class="cell-contact">' + esc(person) + '</td>'
        + '<td class="cell-device">' + esc(device) + '</td>'
        + '<td class="cell-contact">' + esc(network) + '</td>'
        + '<td class="log-detail">' + esc(entry.detail || '') + '</td>'
        + '</tr>';
    }).join('');
  }

  async function clearLogs() {
    const ok = await confirmDialog({
      title: 'সব লগ মুছবেন?',
      message: 'সব ডিভাইস, আইপি ও অ্যাক্টিভিটি লগ মুছে যাবে। শুধু "লগ মুছে ফেলা হয়েছে" — এই একটি এন্ট্রি থাকবে।',
      confirmLabel: 'লগ মুছুন'
    });
    if (!ok) {
      return;
    }
    await Auth.clearLogs();
    state.logLoaded = false;
    await loadLogs(true);
    await loadCore();
    toast('লগ মুছে ফেলা হয়েছে।', 'success');
  }

  function exportLogsCsv() {
    if (!state.logs.length) {
      toast('এক্সপোর্ট করার মতো লগ নেই।', 'warning');
      return;
    }
    const rows = [['time', 'action', 'actor', 'device', 'os', 'browser', 'ip', 'city', 'country', 'detail']];
    state.logs.forEach((entry) => {
      rows.push([
        new Date(Number(entry.at) || 0).toISOString(),
        entry.label || entry.action || '',
        entry.actorType === 'admin' ? 'Admin' : (entry.userName || entry.targetName || 'Guest'),
        entry.device?.label || '',
        entry.device?.os || '',
        entry.device?.browser || '',
        entry.network?.ip || '',
        entry.network?.city || '',
        entry.network?.country || '',
        entry.detail || ''
      ]);
    });
    downloadFile('english-study-logs-' + fileStamp() + '.csv', toCsv(rows), 'text/csv;charset=utf-8');
    toast('লগ CSV ডাউনলোড হয়েছে।', 'success');
  }

  function exportUsersCsv() {
    const users = filteredUsers();
    if (!users.length) {
      toast('এক্সপোর্ট করার মতো ইউজার নেই।', 'warning');
      return;
    }
    const rows = [['name', 'username', 'email', 'phone', 'status', 'created', 'expires', 'daysLeft', 'lastLogin', 'lastDevice', 'lastIp', 'logins']];
    users.forEach((user) => {
      rows.push([
        user.name || '',
        user.username || '',
        user.email || '',
        user.phone || '',
        userState(user).key,
        user.createdAt ? new Date(Number(user.createdAt)).toISOString() : '',
        user.expiresAt ? new Date(Number(user.expiresAt)).toISOString() : '',
        String(user.expiresAt ? Math.max(0, Math.ceil((Number(user.expiresAt) - Date.now()) / 86400000)) : 0),
        user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : '',
        user.lastLoginDevice?.label || '',
        user.lastLoginDevice?.ip || '',
        String(user.loginCount || 0)
      ]);
    });
    downloadFile('english-study-users-' + fileStamp() + '.csv', toCsv(rows), 'text/csv;charset=utf-8');
    toast('ইউজার CSV ডাউনলোড হয়েছে।', 'success');
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    if (/[",\n\r]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function toCsv(rows) {
    return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function fileStamp() {
    const date = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '-' + pad(date.getHours()) + pad(date.getMinutes());
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ------------------------------------------------------------------ */
  /* Security                                                            */
  /* ------------------------------------------------------------------ */

  function renderSecurity() {
    const record = state.adminRecord;
    if ($('secSetAt')) $('secSetAt').textContent = record && record.createdAt ? fmt(record.createdAt) : '—';
    if ($('secUpdatedAt')) $('secUpdatedAt').textContent = record && record.updatedAt ? fmt(record.updatedAt) : '—';
    if ($('secLastLogin')) $('secLastLogin').textContent = record && record.lastLoginAt ? fmt(record.lastLoginAt) : '—';
    if ($('secIdle')) {
      $('secIdle').textContent = state.settings ? bn(state.settings.adminIdleMinutes) + ' মিনিট নিষ্ক্রিয় থাকলে লগআউট' : '—';
    }
    if ($('secLock')) {
      if (record && Number(record.lockUntil) > Date.now()) {
        $('secLock').textContent = 'লক করা — ' + bn(Math.ceil((Number(record.lockUntil) - Date.now()) / 60000)) + ' মিনিট বাকি';
      } else {
        $('secLock').textContent = 'আনলকড';
      }
    }
    renderDeviceInfo();
    renderSystem();
  }

  function renderSystem() {
    if ($('sysVersion')) {
      try {
        const manifest = chrome.runtime.getManifest();
        $('sysVersion').textContent = 'English Study v' + manifest.version;
      } catch (error) {
        $('sysVersion').textContent = 'English Study';
      }
    }
    if (state.stats) {
      if ($('sysLogs')) $('sysLogs').textContent = bn(state.stats.logs);
      if ($('sysCounts')) $('sysCounts').textContent = bn(state.stats.total) + ' ইউজার • ' + bn(state.stats.promos) + ' প্রোমো';
    }
  }

  async function onChangeAdminPassword(event) {
    event.preventDefault();
    const message = $('secMessage');
    if (message) {
      message.hidden = true;
    }
    const current = $('secCurrent') ? $('secCurrent').value : '';
    const next = $('secNew') ? $('secNew').value : '';
    const confirm = $('secConfirm') ? $('secConfirm').value : '';

    if (!current || !next) {
      showSecMessage('বর্তমান ও নতুন পাসওয়ার্ড দিন।', 'error');
      return;
    }
    if (next !== confirm) {
      showSecMessage('নতুন পাসওয়ার্ড দুটি মিলছে না।', 'error');
      return;
    }
    const problems = H.passwordProblems(next, true);
    if (problems.length) {
      showSecMessage(problems.join(' • '), 'error');
      return;
    }

    const button = $('secSaveBtn');
    if (button) button.disabled = true;
    const result = await Auth.changeAdminPassword(current, next, confirm);
    if (button) button.disabled = false;

    if (!result.ok) {
      showSecMessage(result.error || 'পাসওয়ার্ড পরিবর্তন করা যায়নি।', 'error');
      return;
    }

    if ($('secCurrent')) $('secCurrent').value = '';
    if ($('secNew')) $('secNew').value = '';
    if ($('secConfirm')) $('secConfirm').value = '';
    paintStrength($('secStrengthText'), 0, '');
    stopSessionLoop();
    state.session = null;
    await Auth.adminLogout('অ্যাডমিন পাসওয়ার্ড পরিবর্তনের পর সেশন বন্ধ');
    await showGate('✅ অ্যাডমিন পাসওয়ার্ড পরিবর্তন হয়েছে। নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন।', 'success');
  }

  function showSecMessage(text, type) {
    const message = $('secMessage');
    if (!message) {
      return;
    }
    message.hidden = false;
    message.textContent = text;
    message.className = 'form-message ' + (type || 'info');
  }

  async function exportBackup() {
    try {
      const keys = Object.values(Auth.KEYS);
      const data = await chrome.storage.local.get(keys);
      const payload = {
        app: 'English Study',
        kind: 'auth-backup',
        exportedAt: Date.now(),
        version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '',
        data
      };
      downloadFile('english-study-auth-backup-' + fileStamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
      toast('ব্যাকআপ ডাউনলোড হয়েছে (পাসওয়ার্ড শুধু হ্যাশ আকারে)।', 'success');
    } catch (error) {
      toast('ব্যাকআপ তৈরি করা যায়নি।', 'error');
    }
  }

  async function factoryReset() {
    const ok = await confirmDialog({
      title: 'সব ডাটা রিসেট করবেন?',
      message: 'সব ইউজার অ্যাকাউন্ট, প্রোমো কোড, লগ ও চলমান সেশন মুছে যাবে। অ্যাডমিন পাসওয়ার্ড অপরিবর্তিত থাকবে। এই কাজ ফিরিয়ে আনা যাবে না।',
      confirmLabel: 'সব ডাটা মুছুন',
      requireText: 'RESET'
    });
    if (!ok) {
      return;
    }
    const result = await Auth.clearAllUserData();
    if (result.ok) {
      state.logLoaded = false;
      await loadCore();
      await loadLogs(true);
      renderCurrent();
      toast('সব ইউজার, প্রোমো ও লগ মুছে ফেলা হয়েছে।', 'success');
    } else {
      toast(result.error || 'রিসেট করা যায়নি।', 'error');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function fillSettings(settings) {
    if (!settings) {
      return;
    }
    if ($('setRequireLogin')) $('setRequireLogin').checked = settings.requireLogin !== false;
    if ($('setTrialDays')) $('setTrialDays').value = settings.trialDays;
    if ($('setSessionHours')) $('setSessionHours').value = settings.sessionHours;
    if ($('setMaxAttempts')) $('setMaxAttempts').value = settings.maxAttempts;
    if ($('setLockMinutes')) $('setLockMinutes').value = settings.lockMinutes;
    if ($('setAdminIdle')) $('setAdminIdle').value = settings.adminIdleMinutes;
    if ($('setDefaultDays')) $('setDefaultDays').value = settings.defaultActivateDays;
    if ($('setLogLimit')) $('setLogLimit').value = settings.logLimit;
  }

  async function saveSettings(event) {
    event.preventDefault();
    const button = $('settingsSaveBtn');
    if (button) button.disabled = true;

    const next = await Auth.saveSettings({
      requireLogin: $('setRequireLogin') ? $('setRequireLogin').checked : true,
      trialDays: Number($('setTrialDays') ? $('setTrialDays').value : 3),
      sessionHours: Number($('setSessionHours') ? $('setSessionHours').value : 12),
      maxAttempts: Number($('setMaxAttempts') ? $('setMaxAttempts').value : 5),
      lockMinutes: Number($('setLockMinutes') ? $('setLockMinutes').value : 10),
      adminIdleMinutes: Number($('setAdminIdle') ? $('setAdminIdle').value : 20),
      defaultActivateDays: Number($('setDefaultDays') ? $('setDefaultDays').value : 7),
      logLimit: Number($('setLogLimit') ? $('setLogLimit').value : 1500)
    });

    if (button) button.disabled = false;
    state.settings = next;
    fillSettings(next);
    renderSecurity();

    const message = $('settingsMessage');
    if (message) {
      message.hidden = false;
      message.className = 'form-message success';
      message.textContent = '✅ সেটিংস সেভ হয়েছে।';
      setTimeout(() => {
        if (message.isConnected) {
          message.hidden = true;
        }
      }, 4200);
    }
    toast('সেটিংস আপডেট হয়েছে।', 'success');
  }

  /* ------------------------------------------------------------------ */
  /* Password strength UI                                                */
  /* ------------------------------------------------------------------ */

  function paintStrength(label, score, value) {
    if (!label) {
      return;
    }
    const bars = label.parentElement ? label.parentElement.querySelectorAll('.gate-bars i') : [];
    bars.forEach((bar, index) => {
      bar.className = index < score ? 'on l' + score : '';
    });
    const texts = ['খুব দুর্বল', 'দুর্বল', 'মাঝারি', 'ভালো', 'শক্তিশালী'];
    label.textContent = value ? 'পাসওয়ার্ড শক্তি: ' + texts[score] : 'পাসওয়ার্ড শক্তি';
  }

  function updateGateStrength() {
    const value = $('gatePassword') ? $('gatePassword').value : '';
    paintStrength($('gateStrengthText'), H.passwordScore(value), value);
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  init().catch((error) => {
    console.error('[English Study admin] init:', error);
  });
})();
