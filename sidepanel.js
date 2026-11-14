/* English Study — side panel controller */
(() => {
  'use strict';

  const STORAGE_STATE = 'studyState';
  const STORAGE_SETTINGS = 'settings';
  const MAX_SENTENCES = 120;
  const INTENT_MAX_AGE = 120000;

  const DEFAULT_SETTINGS = {
    engine: 'auto',
    rate: 1,
    voicePrefs: {},
    enhanceOcr: true,
    autoTranslate: true,
    vocabLimit: 45
  };

  const state = {
    text: '',
    processedText: '',
    translation: '',
    sentences: [],
    vocab: [],
    targetLang: 'bn',
    sourceTitle: '',
    sourceUrl: '',
    updatedAt: 0,
    updating: false,
    ocrBusy: false,
    ocrRunId: 0,
    abortController: null,
    activeSpeaker: null,
    seenIntents: new Set(),
    sortMode: 'source',
    search: '',
    settings: { ...DEFAULT_SETTINGS }
  };

  const els = {};
  const IDS = [
    'helpBtn', 'settingsBtn', 'statusDot', 'statusText', 'sourceChip',
    'tabReaderBtn', 'tabVocabBtn', 'tabExportBtn', 'readerTabBadge', 'vocabTabBadge',
    'mainScroll', 'panel-reader', 'panel-vocab', 'panel-export',
    'cropBtn', 'screenshotCropBtn', 'imageBtn', 'imageInput',
    'ocrProgress', 'ocrBar', 'ocrStatus', 'ocrPercent',
    'sourceText', 'clearBtn', 'textStats', 'saveState', 'editorNotice',
    'updateBtn', 'updateSpinner', 'updateLabel', 'targetLang',
    'translationEmpty', 'translationLoading', 'translationProgressText',
    'translationBody', 'translationText', 'copyTranslationBtn', 'engineHint',
    'speakEnglishUsBtn', 'speakEnglishUkBtn', 'speakTranslationBtn', 'translationVoiceLabel',
    'playPauseBtn', 'stopBtn', 'playbackState', 'rateValue', 'rateSlider',
    'sentencesCard', 'sentenceCount', 'playAllEnglishBtn', 'playAllTranslationBtn', 'sentenceList',
    'vocabCount', 'vocabSearch', 'vocabSortBtn', 'vocabProgress', 'vocabBar',
    'vocabProgressText', 'vocabEmpty', 'vocabList', 'retryVocabBtn',
    'exportMeta', 'exportEnglish', 'exportTranslation', 'exportTranslationLabel',
    'exportSentences', 'exportVocab', 'exportStats', 'downloadTxtBtn', 'copyAllBtn',
    'quickEnglishBtn', 'quickTranslationBtn', 'quickVocabBtn', 'printPdfBtn',
    'dataWords', 'dataSentences', 'dataVocab', 'dataUpdated',
    'nowPlaying', 'nowPlayingLabel', 'nowPlayingMode', 'npPauseBtn', 'npStopBtn', 'toastHost',
    'settingsDialog', 'settingsCloseBtn', 'ttsEngineSelect', 'voiceUsSelect',
    'voiceUkSelect', 'voiceBnSelect', 'testUsBtn', 'testUkBtn', 'testBnBtn',
    'enhanceOcrCheckbox', 'autoTranslateCheckbox', 'vocabLimitSelect',
    'clearCacheBtn', 'resetOcrBtn', 'clearAllBtn',
    'helpDialog', 'helpCloseBtn', 'openExtensionsBtn',
    'choiceDialog', 'choiceTitle', 'choiceMessage', 'choiceButtons'
  ];

  let initPromise = null;
  let saveTimer = null;
  let saveLabelTimer = null;
  let rateSaveTimer = null;

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  function cacheElements() {
    IDS.forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function $(id) {
    return els[id] || document.getElementById(id);
  }

  /* ------------------------------------------------------------------ */
  /* Authentication gate (additive)                                      */
  /* ------------------------------------------------------------------ */

  function authAllowed() {
    try {
      return window.AppAuthUI ? window.AppAuthUI.isAllowed() : true;
    } catch (error) {
      return true;
    }
  }

  function logActivity(action, detail) {
    try {
      if (window.AppAuthUI && window.AppAuthUI.logActivity) {
        window.AppAuthUI.logActivity(action, detail);
      }
    } catch (error) {
      /* Activity logging must never break a study action. */
    }
  }

  async function init() {
    cacheElements();
    if (window.AppAuthUI) {
      try {
        await window.AppAuthUI.init();
      } catch (error) {
        console.warn('[English Study] auth init:', error);
      }
    }
    populateLanguageSelect();
    bindStaticEvents();
    bindTtsCallbacks();
    await loadSettings();
    await restoreStudy();
    renderAll();
    setStatus('প্রস্তুত', 'ready');
    refreshExportPreview();
    startVoiceWarmup();
    await consumePendingIntent();
  }

  function startVoiceWarmup() {
    try {
      if (AppTTS.getVoices('en').length) {
        populateVoiceSelects();
      }
    } catch (error) {
      /* Ignore. */
    }
    setTimeout(() => {
      try {
        populateVoiceSelects();
      } catch (error) {
        /* Ignore. */
      }
    }, 700);
  }

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  async function loadSettings() {
    let stored = {};
    try {
      const data = await chrome.storage.local.get([STORAGE_SETTINGS]);
      stored = data && data[STORAGE_SETTINGS] ? data[STORAGE_SETTINGS] : {};
    } catch (error) {
      console.warn('[English Study] settings load:', error);
    }

    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if (!['auto', 'cloud', 'browser'].includes(merged.engine)) {
      merged.engine = 'auto';
    }
    merged.rate = clamp(Number(merged.rate) || 1, 0.5, 1.8);
    if (!merged.voicePrefs || typeof merged.voicePrefs !== 'object') {
      merged.voicePrefs = {};
    }
    merged.vocabLimit = [30, 45, 60].includes(Number(merged.vocabLimit))
      ? Number(merged.vocabLimit)
      : 45;
    merged.enhanceOcr = merged.enhanceOcr !== false;
    merged.autoTranslate = merged.autoTranslate !== false;
    state.settings = merged;

    AppTTS.setEngine(merged.engine);
    AppTTS.setRate(merged.rate);
    AppTTS.setVoicePrefs(merged.voicePrefs);

    $('ttsEngineSelect').value = merged.engine;
    $('rateSlider').value = String(merged.rate);
    $('enhanceOcrCheckbox').checked = Boolean(merged.enhanceOcr);
    $('autoTranslateCheckbox').checked = Boolean(merged.autoTranslate);
    $('vocabLimitSelect').value = String(merged.vocabLimit);
    updateRateUI(merged.rate);
    populateVoiceSelects();
  }

  function saveSettings() {
    try {
      const result = chrome.storage.local.set({ [STORAGE_SETTINGS]: state.settings });
      if (result && typeof result.catch === 'function') {
        result.catch((error) => console.warn('[English Study] settings save:', error));
      }
    } catch (error) {
      console.warn('[English Study] settings save:', error);
    }
  }

  async function restoreStudy() {
    let saved = null;
    try {
      const data = await chrome.storage.local.get([STORAGE_STATE]);
      saved = data && data[STORAGE_STATE] ? data[STORAGE_STATE] : null;
    } catch (error) {
      console.warn('[English Study] state load:', error);
    }
    if (!saved) {
      return;
    }

    state.text = typeof saved.text === 'string' ? saved.text : '';
    state.translation = typeof saved.translation === 'string' ? saved.translation : '';
    state.processedText = typeof saved.processedText === 'string' ? saved.processedText : state.text;
    state.sourceTitle = typeof saved.sourceTitle === 'string' ? saved.sourceTitle : '';
    state.sourceUrl = typeof saved.sourceUrl === 'string' ? saved.sourceUrl : '';
    state.updatedAt = Number(saved.updatedAt) || 0;
    state.targetLang = languageExists(saved.targetLang) ? saved.targetLang : 'bn';

    state.sentences = Array.isArray(saved.sentences)
      ? saved.sentences
        .filter((item) => item && typeof item.en === 'string' && item.en.trim())
        .map((item) => ({
          en: String(item.en),
          tr: String(item.tr || ''),
          error: String(item.error || ''),
          pending: false
        }))
      : [];

    state.vocab = Array.isArray(saved.vocab)
      ? saved.vocab
        .filter((item) => item && typeof item.word === 'string' && item.word.trim())
        .map((item) => ({
          word: String(item.word),
          meaning: String(item.meaning || ''),
          pron: String(item.pron || ''),
          ipa: String(item.ipa || ''),
          audio: String(item.audio || ''),
          count: Number(item.count) || 1,
          error: String(item.error || ''),
          pending: false
        }))
      : [];

    $('sourceText').value = state.text;
    $('targetLang').value = state.targetLang;
    updateLanguageLabels();
  }

  function saveStateSoon() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(saveStateNow, 450);
  }

  function saveStateNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const payload = {
      [STORAGE_STATE]: {
        text: state.text,
        processedText: state.processedText,
        translation: state.translation,
        sentences: state.sentences.map((item) => ({
          en: item.en,
          tr: item.tr,
          error: item.error
        })),
        vocab: state.vocab.filter((item) => !item.pending).map((item) => ({
          word: item.word,
          meaning: item.meaning,
          pron: item.pron,
          ipa: item.ipa,
          audio: item.audio,
          count: item.count,
          error: item.error
        })),
        targetLang: state.targetLang,
        sourceTitle: state.sourceTitle,
        sourceUrl: state.sourceUrl,
        updatedAt: state.updatedAt
      }
    };

    try {
      const result = chrome.storage.local.set(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => console.warn('[English Study] state save:', error));
      }
    } catch (error) {
      console.warn('[English Study] state save:', error);
    }

    const label = $('saveState');
    if (label) {
      label.textContent = '✓ সংরক্ষিত';
      if (saveLabelTimer) {
        clearTimeout(saveLabelTimer);
      }
      saveLabelTimer = setTimeout(() => {
        if (label) {
          label.textContent = '';
        }
      }, 1600);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Language / settings UI                                              */
  /* ------------------------------------------------------------------ */

  function populateLanguageSelect() {
    const select = $('targetLang');
    select.replaceChildren();
    AppTranslate.LANGUAGES.forEach((language) => {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = `${language.name} (${language.english})`;
      select.appendChild(option);
    });
    select.value = state.targetLang;
  }

  function languageExists(code) {
    return AppTranslate.LANGUAGES.some((language) => language.code === code);
  }

  function updateLanguageLabels() {
    const name = AppTranslate.languageName(state.targetLang);
    $('translationVoiceLabel').textContent = name;
    $('exportTranslationLabel').textContent = `${name} অনুবাদ`;
  }

  function populateVoiceSelects() {
    const prefs = state.settings.voicePrefs || {};
    fillVoiceSelect($('voiceUsSelect'), 'en-US', prefs['en-US'] || '');
    fillVoiceSelect($('voiceUkSelect'), 'en-GB', prefs['en-GB'] || '');
    fillVoiceSelect($('voiceBnSelect'), 'bn', prefs['bn-BD'] || prefs.bn || '');
  }

  function fillVoiceSelect(select, prefix, selected) {
    if (!select) {
      return;
    }
    const current = selected || select.value || '';
    select.replaceChildren();
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'Auto — সেরা ভয়েস';
    select.appendChild(auto);

    let voices = [];
    try {
      voices = AppTTS.getVoices(prefix);
    } catch (error) {
      voices = [];
    }

    voices.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} — ${voice.lang}${voice.default ? ' (default)' : ''}`;
      select.appendChild(option);
    });

    const exists = Array.from(select.options).some((option) => option.value === current);
    select.value = exists ? current : '';
  }

  function readVoicePrefs() {
    const prefs = {};
    const us = $('voiceUsSelect').value;
    const uk = $('voiceUkSelect').value;
    const bn = $('voiceBnSelect').value;
    if (us) {
      prefs['en-US'] = us;
    }
    if (uk) {
      prefs['en-GB'] = uk;
    }
    if (bn) {
      prefs['bn-BD'] = bn;
    }
    return prefs;
  }

  function updateRateUI(rate) {
    const value = clamp(Number(rate) || 1, 0.5, 1.8);
    const rounded = Math.round(value * 100) / 100;
    const label = Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
    $('rateValue').textContent = `${label}x`;
    $('rateSlider').value = String(value);
    document.querySelectorAll('.rate-preset').forEach((button) => {
      const preset = Number(button.dataset.rate);
      button.classList.toggle('active', Math.abs(preset - value) < 0.001);
    });
  }

  function setRate(rate, { immediate = false } = {}) {
    const value = clamp(Number(rate) || 1, 0.5, 1.8);
    state.settings.rate = value;
    AppTTS.setRate(value);
    updateRateUI(value);
    if (immediate) {
      if (rateSaveTimer) {
        clearTimeout(rateSaveTimer);
      }
      rateSaveTimer = setTimeout(saveSettings, 350);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tabs / status / toasts / dialogs                                    */
  /* ------------------------------------------------------------------ */

  function switchTab(name) {
    const tabs = [
      { key: 'reader', button: $('tabReaderBtn'), panel: $('panel-reader') },
      { key: 'vocab', button: $('tabVocabBtn'), panel: $('panel-vocab') },
      { key: 'export', button: $('tabExportBtn'), panel: $('panel-export') }
    ];
    tabs.forEach((tab) => {
      const active = tab.key === name;
      tab.button.classList.toggle('active', active);
      tab.button.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.panel.classList.toggle('active', active);
    });
    if (name === 'export') {
      refreshExportPreview();
    }
    $('mainScroll').scrollTop = 0;
  }

  function setStatus(text, kind = 'ready') {
    const dot = $('statusDot');
    dot.className = `status-dot ${kind}`;
    $('statusText').textContent = text;
  }

  function setSourceChip() {
    const chip = $('sourceChip');
    const title = String(state.sourceTitle || '').trim();
    const url = String(state.sourceUrl || '').trim();
    if (!title && !url) {
      chip.hidden = true;
      chip.textContent = '';
      chip.removeAttribute('title');
      return;
    }
    let label = '';
    if (url) {
      try {
        label = new URL(url).hostname.replace(/^www\./, '');
      } catch (error) {
        label = '';
      }
    }
    if (!label) {
      label = title || 'সোর্স';
    }
    chip.hidden = false;
    chip.textContent = AppText.truncate(label, 40);
    chip.title = title || url;
  }

  function showToast(message, options = {}) {
    const { type = 'info', timeout = 4400, action = null } = options;
    const host = $('toastHost');
    if (!host) {
      return;
    }
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '⛔' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = icons[type] || icons.info;

    const text = document.createElement('div');
    text.className = 'toast-text';
    text.textContent = String(message || '');

    toast.appendChild(icon);
    toast.appendChild(text);

    if (action && typeof action.run === 'function') {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'toast-action';
      actionButton.textContent = action.label || 'ঠিক আছে';
      actionButton.addEventListener('click', () => {
        remove();
        try {
          action.run();
        } catch (error) {
          console.warn('[English Study] toast action:', error);
        }
      });
      toast.appendChild(actionButton);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'বন্ধ করুন');
    close.textContent = '✕';
    let removed = false;
    const remove = () => {
      if (removed) {
        return;
      }
      removed = true;
      toast.remove();
    };
    close.addEventListener('click', remove);
    toast.appendChild(close);

    host.appendChild(toast);
    while (host.children.length > 4) {
      host.firstElementChild.remove();
    }
    if (timeout > 0) {
      setTimeout(remove, timeout);
    }
  }

  function showChoice({ title, message, buttons }) {
    return new Promise((resolve) => {
      const dialog = $('choiceDialog');
      $('choiceTitle').textContent = title || 'নিশ্চিত করুন';
      $('choiceMessage').textContent = message || '';
      const host = $('choiceButtons');
      host.replaceChildren();

      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          dialog.close();
        } catch (error) {
          /* Ignore. */
        }
        resolve(value);
      };

      (Array.isArray(buttons) ? buttons : []).forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `btn ${entry.className || 'btn-soft'}`;
        button.textContent = entry.label || 'ঠিক আছে';
        button.addEventListener('click', () => finish(entry.value));
        host.appendChild(button);
      });

      dialog.addEventListener('close', () => finish(null), { once: true });
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    });
  }

  function openDialog(dialog) {
    if (!dialog) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) {
      return;
    }
    try {
      dialog.close();
    } catch (error) {
      dialog.removeAttribute('open');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Text state / rendering                                              */
  /* ------------------------------------------------------------------ */

  function countWords(text) {
    const matches = String(text || '').match(/[A-Za-z][A-Za-z'’\-]*/g);
    return matches ? matches.length : 0;
  }

  function updateTextStats() {
    const text = $('sourceText').value;
    const words = countWords(text);
    const chars = text.length;
    $('textStats').textContent = `${AppText.bnNumber(words)} শব্দ • ${AppText.bnNumber(chars)} অক্ষর`;
  }

  function updateDirtyState() {
    const value = $('sourceText').value;
    const hasText = Boolean(value.trim());
    const dirty = value !== state.processedText;
    $('editorNotice').hidden = !(dirty && hasText && !state.updating);
    $('updateBtn').disabled = state.updating || !hasText;
    $('clearBtn').disabled = state.updating || (!hasText && !state.translation);
  }

  function setUpdateBusy(busy) {
    state.updating = busy;
    $('updateSpinner').hidden = !busy;
    $('updateLabel').textContent = busy
      ? '⏳ অনুবাদ ও শব্দার্থ তৈরি হচ্ছে…'
      : '🔄 অনুবাদ ও শব্দার্থ আপডেট করুন';
    $('updateBtn').disabled = busy || !$('sourceText').value.trim();
    $('clearBtn').disabled = busy;
    $('targetLang').disabled = busy;
    $('retryVocabBtn').disabled = busy;
    updateDirtyState();
  }

  function renderTranslation(progressText) {
    const hasTranslation = Boolean(String(state.translation || '').trim());
    const body = $('translationBody');
    const empty = $('translationEmpty');
    const loading = $('translationLoading');

    body.hidden = !hasTranslation;
    $('translationText').textContent = state.translation || '';
    empty.hidden = hasTranslation || state.updating;
    loading.hidden = hasTranslation || !state.updating;
    if (state.updating) {
      $('translationProgressText').textContent = progressText || 'অনুবাদ হচ্ছে…';
    }
    $('speakTranslationBtn').disabled = !hasTranslation;
    $('copyTranslationBtn').disabled = !hasTranslation;
  }

  function renderSentences() {
    const card = $('sentencesCard');
    const list = $('sentenceList');
    list.replaceChildren();
    const items = Array.isArray(state.sentences) ? state.sentences : [];
    card.hidden = !items.length;
    $('sentenceCount').textContent = `${AppText.bnNumber(items.length)} বাক্য`;
    $('playAllEnglishBtn').disabled = !items.length;
    $('playAllTranslationBtn').disabled = !items.some((item) => item && item.tr);

    items.forEach((item, index) => {
      const cardNode = document.createElement('div');
      cardNode.className = 'sentence-card';
      if (item.pending) {
        cardNode.classList.add('pending');
      }
      cardNode.dataset.index = String(index);

      const englishRow = document.createElement('div');
      englishRow.className = 'sentence-en';

      const number = document.createElement('span');
      number.className = 'sentence-num';
      number.textContent = AppText.bnNumber(index + 1);

      const english = document.createElement('span');
      english.className = 'sentence-text';
      english.dir = 'ltr';
      english.textContent = item.en;

      const speakers = document.createElement('span');
      speakers.className = 'sentence-speakers';
      const speakEnglish = document.createElement('button');
      speakEnglish.type = 'button';
      speakEnglish.className = 'speaker-btn';
      speakEnglish.dataset.action = 'speak-en';
      speakEnglish.dataset.index = String(index);
      speakEnglish.title = 'ইংরেজি উচ্চারণ';
      speakEnglish.textContent = '🔊 EN';
      speakers.appendChild(speakEnglish);

      englishRow.appendChild(number);
      englishRow.appendChild(english);
      englishRow.appendChild(speakers);
      cardNode.appendChild(englishRow);

      if (item.pending) {
        const pendingRow = document.createElement('div');
        pendingRow.className = 'sentence-tr';
        const arrow = document.createElement('span');
        arrow.className = 'sentence-arrow';
        arrow.textContent = '↳';
        const pending = document.createElement('div');
        pending.className = 'vocab-pending';
        const lineWide = document.createElement('div');
        lineWide.className = 'skeleton-line wide';
        const lineShort = document.createElement('div');
        lineShort.className = 'skeleton-line short';
        pending.appendChild(lineWide);
        pending.appendChild(lineShort);
        pendingRow.appendChild(arrow);
        pendingRow.appendChild(pending);
        cardNode.appendChild(pendingRow);
      } else if (item.tr) {
        const translationRow = document.createElement('div');
        translationRow.className = 'sentence-tr';
        const arrow = document.createElement('span');
        arrow.className = 'sentence-arrow';
        arrow.textContent = '↳';
        const translated = document.createElement('span');
        translated.className = 'sentence-tr-text';
        translated.dir = 'auto';
        translated.lang = state.targetLang;
        translated.textContent = item.tr;
        const speakTranslation = document.createElement('button');
        speakTranslation.type = 'button';
        speakTranslation.className = 'speaker-btn';
        speakTranslation.dataset.action = 'speak-tr';
        speakTranslation.dataset.index = String(index);
        speakTranslation.title = 'অনুবাদ শুনুন';
        speakTranslation.textContent = '🔊';
        translationRow.appendChild(arrow);
        translationRow.appendChild(translated);
        translationRow.appendChild(speakTranslation);
        cardNode.appendChild(translationRow);
      } else {
        const errorRow = document.createElement('div');
        errorRow.className = 'sentence-error';
        const message = document.createElement('span');
        message.textContent = 'এই বাক্যের অনুবাদ পাওয়া যায়নি';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'speaker-btn';
        retry.dataset.action = 'retry-sentence';
        retry.dataset.index = String(index);
        retry.textContent = '🔄 আবার';
        errorRow.appendChild(message);
        errorRow.appendChild(retry);
        cardNode.appendChild(errorRow);
      }

      list.appendChild(cardNode);
    });

    updateTabBadges();
  }

  function filteredVocab() {
    const query = state.search.trim().toLowerCase();
    let items = state.vocab.slice();
    if (query) {
      items = items.filter((item) => {
        const haystack = `${item.word || ''} ${item.pron || ''} ${item.meaning || ''}`.toLowerCase();
        return haystack.includes(query);
      });
    }
    if (state.sortMode === 'alpha') {
      items.sort((a, b) => String(a.word || '').localeCompare(String(b.word || ''), 'en', { sensitivity: 'base' }));
    }
    return items;
  }

  function renderVocab() {
    const list = $('vocabList');
    const items = filteredVocab();
    const total = state.vocab.length;
    list.replaceChildren();

    $('vocabCount').textContent = `${AppText.bnNumber(total)} শব্দ`;
    $('vocabEmpty').hidden = total > 0 || state.updating;

    if (total > 0 && items.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-state';
      const text = document.createElement('p');
      text.textContent = 'এই খোঁজে কোনো শব্দ পাওয়া যায়নি।';
      note.appendChild(text);
      list.appendChild(note);
    }

    items.forEach((item) => {
      const index = state.vocab.indexOf(item);
      const row = document.createElement('div');
      row.className = 'vocab-item';

      const speaker = document.createElement('button');
      speaker.type = 'button';
      speaker.className = 'vocab-speak';
      speaker.dataset.index = String(index);
      speaker.title = 'উচ্চারণ ও অর্থ শুনুন';
      speaker.textContent = '🔊';
      speaker.disabled = item.pending || !item.meaning;

      const main = document.createElement('div');
      main.className = 'vocab-main';

      if (item.pending) {
        const pending = document.createElement('div');
        pending.className = 'vocab-pending';
        const lineWide = document.createElement('div');
        lineWide.className = 'skeleton-line wide';
        const lineShort = document.createElement('div');
        lineShort.className = 'skeleton-line short';
        pending.appendChild(lineWide);
        pending.appendChild(lineShort);
        main.appendChild(pending);
      } else {
        const line = document.createElement('div');
        line.className = 'vocab-line';

        const word = document.createElement('span');
        word.className = 'vocab-word';
        word.textContent = item.word || '';

        const pron = document.createElement('span');
        pron.className = 'vocab-pron';
        pron.textContent = ` (${item.pron || '—'})`;

        const equals = document.createElement('span');
        equals.className = 'vocab-eq';
        equals.textContent = '=';

        const meaning = document.createElement('span');
        meaning.className = 'vocab-meaning';
        meaning.textContent = item.meaning || '—';

        line.appendChild(word);
        line.appendChild(pron);
        line.appendChild(equals);
        line.appendChild(meaning);
        main.appendChild(line);

        if (item.ipa || item.count > 1) {
          const sub = document.createElement('div');
          sub.className = 'vocab-sub';
          if (item.ipa) {
            const ipa = document.createElement('span');
            ipa.className = 'ipa';
            ipa.textContent = item.ipa;
            sub.appendChild(ipa);
          }
          if (item.count > 1) {
            const count = document.createElement('span');
            count.textContent = `${AppText.bnNumber(item.count)} বার এসেছে`;
            sub.appendChild(count);
          }
          main.appendChild(sub);
        }

        if (item.error || !item.meaning) {
          const error = document.createElement('div');
          error.className = 'vocab-error';
          const text = document.createElement('span');
          text.textContent = item.error ? 'অর্থ লোড করা যায়নি' : 'অর্থ পাওয়া যায়নি';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'speaker-btn';
          retry.dataset.action = 'retry-word';
          retry.dataset.index = String(index);
          retry.textContent = '🔄';
          error.appendChild(text);
          error.appendChild(retry);
          main.appendChild(error);
        }
      }

      row.appendChild(speaker);
      row.appendChild(main);
      list.appendChild(row);
    });

    $('retryVocabBtn').hidden = state.updating || !state.vocab.some((item) => !item.pending && (!item.meaning || item.error));
    updateTabBadges();
  }

  function updateTabBadges() {
    const sentences = state.sentences.length;
    const vocab = state.vocab.length;
    $('readerTabBadge').hidden = sentences === 0;
    $('readerTabBadge').textContent = AppText.bnNumber(sentences);
    $('vocabTabBadge').hidden = vocab === 0;
    $('vocabTabBadge').textContent = AppText.bnNumber(vocab);
  }

  function renderAll() {
    updateTextStats();
    renderTranslation();
    renderSentences();
    renderVocab();
    updateDirtyState();
    updateLanguageLabels();
    updateVoiceAvailability();
    updateExportSummary();
    setSourceChip();
  }

  function updateVoiceAvailability() {
    const hasText = Boolean(state.text.trim());
    const hasTranslation = Boolean(state.translation.trim());
    $('speakEnglishUsBtn').disabled = !hasText;
    $('speakEnglishUkBtn').disabled = !hasText;
    $('speakTranslationBtn').disabled = !hasTranslation;
    $('playPauseBtn').disabled = !hasText && !hasTranslation && !state.sentences.length;
  }

  function applyText(text, meta = {}) {
    const value = String(text || '').replace(/\r\n?/g, '\n').trim();
    stopSpeaking();
    state.text = value;
    state.processedText = '';
    state.translation = '';
    state.sentences = [];
    state.vocab = [];
    state.updatedAt = 0;
    if (meta.sourceTitle !== undefined) {
      state.sourceTitle = String(meta.sourceTitle || '');
    }
    if (meta.sourceUrl !== undefined) {
      state.sourceUrl = String(meta.sourceUrl || '');
    }

    $('sourceText').value = value;
    renderAll();
    refreshExportPreview();
    updateDirtyState();
    saveStateSoon();
  }
  /* ------------------------------------------------------------------ */
  /* Background messaging / intents                                      */
  /* ------------------------------------------------------------------ */

  async function sendBackground(type, extra = {}) {
    try {
      const result = await chrome.runtime.sendMessage({ type, ...extra });
      return result && typeof result === 'object' ? result : { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function consumePendingIntent() {
    const result = await sendBackground('CONSUME_PENDING');
    if (result && result.intent) {
      handleIntent(result.intent);
    }
  }

  function handleIntent(intent) {
    if (!intent || typeof intent !== 'object') {
      return;
    }
    const id = String(intent.id || '');
    if (id) {
      if (state.seenIntents.has(id)) {
        return;
      }
      state.seenIntents.add(id);
    }
    if (intent.createdAt && Date.now() - Number(intent.createdAt) > INTENT_MAX_AGE) {
      return;
    }

    switchTab('reader');

    if (intent.type === 'selection' && String(intent.text || '').trim()) {
      applyText(intent.text, {
        sourceTitle: intent.title || state.sourceTitle,
        sourceUrl: intent.url || state.sourceUrl
      });
      setStatus('সিলেকশন এডিটরে যোগ হয়েছে', 'ready');
      showToast('সিলেকশনটি এডিটরে যোগ হয়েছে। অনুবাদ তৈরি হচ্ছে…', { type: 'success' });
      runUpdate();
      return;
    }

    if (intent.type === 'crop') {
      if (intent.title || intent.url) {
        state.sourceTitle = String(intent.title || state.sourceTitle || '');
        state.sourceUrl = String(intent.url || state.sourceUrl || '');
        setSourceChip();
      }
      startOverlayCrop();
    }
  }

  function handleIncoming(message) {
    if (!message || typeof message.type !== 'string') {
      return;
    }
    switch (message.type) {
      case 'INTENT':
        handleIntent(message.intent);
        break;
      case 'CROP_CAPTURED':
        onOverlayCaptured(message);
        break;
      case 'CROP_PAGE_DONE':
        onScreenshotCropped(message);
        break;
      case 'CROP_FAILED':
        clearCropWatchdog();
        setScanBusy(false);
        setStatus('স্ক্রিনশট নেওয়া যায়নি', 'error');
        showToast(message.error || 'স্ক্রিনশট নেওয়া যায়নি। আবার চেষ্টা করুন।', { type: 'error' });
        break;
      case 'CROP_CANCELLED':
        clearCropWatchdog();
        setScanBusy(false);
        if (!state.ocrBusy) {
          setStatus('ক্রপ বাতিল হয়েছে', 'warning');
        }
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Crop + OCR                                                          */
  /* ------------------------------------------------------------------ */

  function setScanBusy(busy) {
    $('cropBtn').disabled = busy;
    $('screenshotCropBtn').disabled = busy;
    $('imageBtn').disabled = busy;
  }

  function armCropWatchdog() {
    clearCropWatchdog();
    state.cropWatchdog = setTimeout(() => {
      state.cropWatchdog = null;
      if (state.ocrBusy) {
        return;
      }
      setScanBusy(false);
      setStatus('ক্রপ সমাপ্ত হয়নি', 'warning');
    }, 180000);
  }

  function clearCropWatchdog() {
    if (state.cropWatchdog) {
      clearTimeout(state.cropWatchdog);
      state.cropWatchdog = null;
    }
  }

  async function startOverlayCrop() {
    if (!authAllowed()) {
      return;
    }
    if (state.ocrBusy) {
      showToast('OCR চলছে — শেষ হওয়ার পরে আবার চেষ্টা করুন।', { type: 'warning' });
      return;
    }
    setStatus('ক্রপ ওভারলে চালু হচ্ছে…', 'busy');
    setScanBusy(true);
    const result = await sendBackground('START_OVERLAY');
    if (result && result.ok) {
      setStatus('পেজে ইংরেজি অংশটি মাউস দিয়ে টেনে সিলেক্ট করুন', 'busy');
      armCropWatchdog();
      return;
    }
    if (result && result.fallback) {
      showToast(result.error || 'এই পেজে ওভারলে চালু করা যাচ্ছে না — স্ক্রিনশট ক্রপ ব্যবহার করা হচ্ছে।', { type: 'warning' });
      await openScreenshotCrop();
      return;
    }
    setScanBusy(false);
    setStatus('ক্রপ ওভারলে চালু করা যায়নি', 'error');
    showToast(result?.error || 'ক্রপ ওভারলে চালু করা যায়নি।', { type: 'error' });
  }

  async function openScreenshotCrop() {
    if (!authAllowed()) {
      return;
    }
    if (state.ocrBusy) {
      showToast('OCR চলছে — শেষ হওয়ার পরে আবার চেষ্টা করুন।', { type: 'warning' });
      return;
    }
    setStatus('স্ক্রিনশট নেওয়া হচ্ছে…', 'busy');
    setScanBusy(true);
    const result = await sendBackground('OPEN_CROP_PAGE');
    if (result && result.ok) {
      setStatus('নতুন ট্যাবে অংশ নির্বাচন করে “স্ক্যান” চাপুন', 'busy');
      armCropWatchdog();
      return;
    }
    setScanBusy(false);
    setStatus('স্ক্রিনশট ক্রপ খোলা যায়নি', 'error');
    showToast(result?.error || 'স্ক্রিনশট ক্রপ খোলা যায়নি।', { type: 'error' });
  }

  async function onOverlayCaptured(payload) {
    clearCropWatchdog();
    if (!payload || !payload.dataUrl || !payload.rect || !payload.viewport) {
      setScanBusy(false);
      showToast('ক্রপ করা অংশটি পাওয়া যায়নি।', { type: 'error' });
      return;
    }
    try {
      const cropped = await cropScreenshot(payload);
      await scanDataUrl(cropped, {
        sourceTitle: payload.title || '',
        sourceUrl: payload.url || ''
      });
    } catch (error) {
      setScanBusy(false);
      setStatus('ক্রপ করা যায়নি', 'error');
      showToast(error?.message || 'ক্রপ করা যায়নি।', { type: 'error' });
    }
  }

  async function onScreenshotCropped(payload) {
    clearCropWatchdog();
    if (!payload || !payload.dataUrl) {
      setScanBusy(false);
      showToast('ক্রপ করা ছবি পাওয়া যায়নি।', { type: 'error' });
      return;
    }
    await scanDataUrl(payload.dataUrl, {
      sourceTitle: payload.title || '',
      sourceUrl: payload.url || ''
    });
  }

  function cropScreenshot(payload) {
    return loadImage(payload.dataUrl).then((image) => {
      const viewport = payload.viewport;
      const rect = payload.rect;
      const scaleX = image.naturalWidth / Math.max(1, Number(viewport.width) || 1);
      const scaleY = image.naturalHeight / Math.max(1, Number(viewport.height) || 1);

      const sx = clamp(Math.floor(Number(rect.x) * scaleX), 0, image.naturalWidth - 1);
      const sy = clamp(Math.floor(Number(rect.y) * scaleY), 0, image.naturalHeight - 1);
      const right = clamp(
        Math.ceil((Number(rect.x) + Number(rect.width)) * scaleX),
        sx + 1,
        image.naturalWidth
      );
      const bottom = clamp(
        Math.ceil((Number(rect.y) + Number(rect.height)) * scaleY),
        sy + 1,
        image.naturalHeight
      );
      const width = right - sx;
      const height = bottom - sy;

      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 6 || height < 6) {
        throw new Error('নির্বাচিত অংশটি খুব ছোট। আবার বড় করে সিলেক্ট করুন।');
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) {
        throw new Error('ছবি প্রসেস করা যায়নি।');
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sx, sy, width, height, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('ছবিটি পড়া যায়নি।'));
          return;
        }
        resolve(image);
      };
      image.onerror = () => reject(new Error('ছবিটি লোড করা যায়নি।'));
      image.src = src;
    });
  }

  function chooseImage() {
    if (!authAllowed()) {
      return;
    }
    if (state.ocrBusy) {
      showToast('OCR চলছে — শেষ হওয়ার পরে আবার চেষ্টা করুন।', { type: 'warning' });
      return;
    }
    $('imageInput').value = '';
    $('imageInput').click();
  }

  async function handleImagePicked(event) {
    const file = event?.target?.files && event.target.files[0] ? event.target.files[0] : null;
    if (!file) {
      return;
    }
    if (!/^image\//i.test(file.type || '')) {
      showToast('শুধু ছবি ফাইল (PNG, JPG) নির্বাচন করুন।', { type: 'error' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showToast('ছবিটি ২৫ MB-এর বেশি। ছোট ছবি ব্যবহার করুন।', { type: 'error' });
      return;
    }
    try {
      setStatus('ছবি প্রস্তুত হচ্ছে…', 'busy');
      const dataUrl = await readFileAsDataUrl(file);
      await scanDataUrl(dataUrl, { sourceTitle: file.name, sourceUrl: '' });
    } catch (error) {
      setScanBusy(false);
      setStatus('ছবি পড়া যায়নি', 'error');
      showToast(error?.message || 'ছবি পড়া যায়নি।', { type: 'error' });
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('ছবিটি পড়া যায়নি।'));
      reader.readAsDataURL(file);
    });
  }

  function showOcrProgress(percent, label) {
    const value = clamp(Math.round(Number(percent) || 0), 0, 100);
    $('ocrProgress').hidden = false;
    $('ocrBar').style.width = `${value}%`;
    $('ocrPercent').textContent = `${AppText.bnNumber(value)}%`;
    if (label) {
      $('ocrStatus').textContent = label;
    }
  }

  async function scanDataUrl(dataUrl, meta = {}) {
    if (!authAllowed()) {
      return;
    }
    if (state.ocrBusy) {
      showToast('OCR ইতিমধ্যে চলছে — একটু অপেক্ষা করুন।', { type: 'warning' });
      return;
    }
    if (!dataUrl) {
      showToast('OCR করার জন্য কোনো ছবি পাওয়া যায়নি।', { type: 'error' });
      return;
    }

    clearCropWatchdog();
    state.ocrBusy = true;
    state.ocrRunId += 1;
    const runId = state.ocrRunId;
    setScanBusy(true);
    showOcrProgress(0, 'OCR ইঞ্জিন প্রস্তুত হচ্ছে…');
    setStatus('লেখা স্ক্যান হচ্ছে…', 'busy');

    try {
      const result = await AppOCR.recognize(dataUrl, {
        enhance: Boolean(state.settings.enhanceOcr),
        onProgress: (progress) => {
          if (runId !== state.ocrRunId) {
            return;
          }
          showOcrProgress(progress?.percent || 0, progress?.label || 'OCR চলছে…');
        }
      });

      if (runId !== state.ocrRunId) {
        return;
      }

      showOcrProgress(100, 'OCR সম্পন্ন');
      const text = String(result?.text || '').trim();
      if (!text) {
        setStatus('কোনো লেখা পাওয়া যায়নি', 'warning');
        showToast('ছবিতে পড়ার মতো ইংরেজি লেখা পাওয়া যায়নি। পরিষ্কার বা বড় ছবি দিয়ে চেষ্টা করুন।', {
          type: 'warning',
          timeout: 6000
        });
        return;
      }

      applyText(text, {
        sourceTitle: meta.sourceTitle || state.sourceTitle,
        sourceUrl: meta.sourceUrl !== undefined ? meta.sourceUrl : state.sourceUrl
      });
      const confidence = Math.round(Number(result?.confidence) || 0);
      setStatus(`OCR সম্পন্ন${confidence ? ` (${AppText.bnNumber(confidence)}% নিশ্চিত)` : ''}`, 'ready');
      logActivity('ocr', 'OCR স্ক্যান — ' + text.length + ' অক্ষর' + (confidence ? ' (' + confidence + '%)' : ''));
      showToast('OCR সম্পন্ন। লেখা যাচাই করে দরকার হলে এডিট করুন।', { type: 'success' });

      if (state.settings.autoTranslate) {
        await delay(350);
        runUpdate();
      }
    } catch (error) {
      if (runId !== state.ocrRunId) {
        return;
      }
      setStatus('OCR ব্যর্থ হয়েছে', 'error');
      showToast(error?.message || 'OCR করা যায়নি। আবার চেষ্টা করুন।', { type: 'error', timeout: 6000 });
    } finally {
      if (runId === state.ocrRunId) {
        state.ocrBusy = false;
        setScanBusy(false);
        setTimeout(() => {
          if (runId === state.ocrRunId) {
            $('ocrProgress').hidden = true;
          }
        }, 900);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Update: translation + sentences + vocabulary                        */
  /* ------------------------------------------------------------------ */

  async function runUpdate() {
    const value = $('sourceText').value;
    const text = String(value || '').trim();
    if (!text) {
      showToast('আগে ইংরেজি লেখা স্ক্যান করুন বা টাইপ করুন।', { type: 'warning' });
      return;
    }
    if (!authAllowed()) {
      return;
    }

    const previous = {
      translation: state.translation,
      sentences: state.sentences,
      vocab: state.vocab
    };

    abortCurrentUpdate();
    const controller = new AbortController();
    state.abortController = controller;

    state.text = value;
    state.translation = '';
    state.sentences = [];
    state.vocab = [];
    setUpdateBusy(true);
    renderTranslation('অনুবাদ শুরু হচ্ছে…');
    renderSentences();
    renderVocab();
    setStatus('অনুবাদ ও শব্দার্থ তৈরি হচ্ছে…', 'busy');
    updateExportSummary();

    try {
      const paragraphs = AppText.splitParagraphs(text);
      let sentences = [];
      paragraphs.forEach((paragraph) => {
        AppText.splitSentences(paragraph).forEach((sentence) => {
          if (sentence.trim()) {
            sentences.push(sentence.trim());
          }
        });
      });

      if (!sentences.length && text) {
        sentences = [text.replace(/\s+/g, ' ').trim()];
      }
      if (sentences.length > MAX_SENTENCES) {
        sentences = sentences.slice(0, MAX_SENTENCES);
        showToast('লেখাটি বড় — প্রথম ১২০টি বাক্যের লাইন-বাই-বাই অনুবাদ তৈরি হচ্ছে।', {
          type: 'warning',
          timeout: 6000
        });
      }

      state.sentences = sentences.map((sentence) => ({
        en: sentence,
        tr: '',
        error: '',
        pending: true
      }));
      renderSentences();
      updateExportSummary();

      renderTranslation('সম্পূর্ণ অনুবাদ হচ্ছে…');
      const fullParts = await AppTranslate.translateMany(paragraphs, state.targetLang, {
        signal: controller.signal,
        concurrency: 2,
        onProgress: (done, total) => {
          if (controller.signal.aborted) {
            return;
          }
          renderTranslation(`সম্পূর্ণ অনুবাদ হচ্ছে… ${AppText.bnNumber(done)}/${AppText.bnNumber(total)}`);
        }
      });

      if (controller.signal.aborted) {
        return;
      }

      const translatedParagraphs = fullParts.map((part) => (part.ok ? part.text : '')).filter(Boolean);
      if (!translatedParagraphs.length) {
        throw new Error('TRANSLATION_FAILED');
      }
      state.translation = translatedParagraphs.join('\n\n');
      renderTranslation();

      if (state.sentences.length) {
        renderTranslation('লাইন-বাই-লাইন অনুবাদ হচ্ছে…');
        const sentenceResults = await AppTranslate.translateMany(
          state.sentences.map((item) => item.en),
          state.targetLang,
          {
            signal: controller.signal,
            concurrency: 3,
            onProgress: (done, total) => {
              if (controller.signal.aborted) {
                return;
              }
              renderTranslation(`লাইন-বাই-লাইন অনুবাদ… ${AppText.bnNumber(done)}/${AppText.bnNumber(total)}`);
            }
          }
        );

        if (controller.signal.aborted) {
          return;
        }

        sentenceResults.forEach((result, index) => {
          const item = state.sentences[index];
          if (!item) {
            return;
          }
          item.pending = false;
          if (result.ok && result.text) {
            item.tr = result.text;
            item.error = '';
          } else {
            item.tr = '';
            item.error = result.error || 'TRANSLATION_FAILED';
          }
        });
        renderSentences();
        updateExportSummary();
      }

      renderTranslation('শব্দভান্ডারের অর্থ তৈরি হচ্ছে…');
      try {
        await buildVocabNow(controller.signal);
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) {
          throw error;
        }
        console.warn('[English Study] vocabulary:', error);
        showToast('শব্দভান্ডার তৈরি করা যায়নি — অনুবাদ ঠিক আছে।', { type: 'warning' });
      }

      if (controller.signal.aborted) {
        return;
      }

      state.processedText = value;
      state.updatedAt = Date.now();
      $('editorNotice').hidden = true;
      renderAll();
      saveStateNow();
      refreshExportPreview();
      setStatus('অনুবাদ ও শব্দার্থ প্রস্তুত', 'ready');
      logActivity(
        'translation',
        'অনুবাদ তৈরি — ' + state.sentences.length + ' বাক্য, ' + state.vocab.length + ' শব্দ, '
          + String(state.targetLang || '').toUpperCase()
      );

      const failedSentences = state.sentences.filter((item) => item.error).length;
      if (failedSentences) {
        showToast(`অনুবাদ প্রস্তুত, তবে ${AppText.bnNumber(failedSentences)}টি বাক্য পাওয়া যায়নি।`, {
          type: 'warning',
          timeout: 6000
        });
      } else {
        showToast('অনুবাদ ও শব্দভান্ডার প্রস্তুত হয়েছে।', { type: 'success' });
      }
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.warn('[English Study] update:', error);
      if (!state.translation && previous.translation) {
        state.translation = previous.translation;
        state.sentences = previous.sentences;
        state.vocab = previous.vocab;
      }
      if (state.sentences.some((item) => item.pending)) {
        state.sentences = state.sentences.map((item) => (
          item.pending ? { ...item, pending: false, error: 'TRANSLATION_FAILED' } : item
        ));
      }
      renderAll();
      updateExportSummary();
      setStatus('অনুবাদ ব্যর্থ হয়েছে', 'error');
      showToast('অনুবাদ করা যায়নি। ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।', {
        type: 'error',
        timeout: 6000
      });
    } finally {
      if (state.abortController === controller) {
        state.abortController = null;
        setUpdateBusy(false);
        renderTranslation();
        renderVocab();
        updateDirtyState();
        updateExportSummary();
        refreshExportPreview();
      }
    }
  }

  function abortCurrentUpdate() {
    if (state.abortController) {
      try {
        state.abortController.abort();
      } catch (error) {
        /* Ignore. */
      }
      state.abortController = null;
    }
  }

  async function buildVocabNow(signal) {
    const words = AppText.extractKeyWords(state.text, state.settings.vocabLimit);
    if (!words.length) {
      state.vocab = [];
      renderVocab();
      return;
    }

    state.vocab = words.map((entry) => ({
      word: entry.word,
      lookup: entry.lookup,
      count: entry.count,
      meaning: '',
      pron: '',
      ipa: '',
      audio: '',
      error: '',
      pending: true
    }));
    renderVocab();
    setVocabProgress(true, 0, words.length);

    try {
      const results = await AppTranslate.buildVocabulary(words, {
        signal,
        concurrency: 3,
        onResult: (result, index) => {
          if (signal?.aborted) {
            return;
          }
          const base = state.vocab[index] || {};
          state.vocab[index] = {
            ...base,
            ...result,
            pending: false,
            error: result?.error || ''
          };
          renderVocab();
        },
        onProgress: (done, total) => {
          if (signal?.aborted) {
            return;
          }
          setVocabProgress(true, done, total);
        }
      });

      if (signal?.aborted) {
        throw abortError();
      }

      state.vocab = results.map((result, index) => ({
        ...(state.vocab[index] || {}),
        ...result,
        pending: false,
        error: result?.error || ''
      }));
      renderVocab();
    } finally {
      if (!signal?.aborted) {
        setVocabProgress(false);
      }
    }
  }

  function setVocabProgress(visible, done, total) {
    $('vocabProgress').hidden = !visible;
    if (!visible) {
      $('vocabBar').style.width = '100%';
      return;
    }
    const percent = total ? clamp(Math.round((done / total) * 100), 0, 100) : 0;
    $('vocabBar').style.width = `${percent}%`;
    $('vocabProgressText').textContent = total
      ? `শব্দার্থ তৈরি হচ্ছে… ${AppText.bnNumber(done)}/${AppText.bnNumber(total)}`
      : 'শব্দার্থ তৈরি হচ্ছে…';
  }

  async function retrySentence(index) {
    const item = state.sentences[index];
    if (!item || state.updating) {
      return;
    }
    setStatus('বাক্যটির অনুবাদ হচ্ছে…', 'busy');
    try {
      const translated = await AppTranslate.translate(item.en, state.targetLang, 'en');
      item.tr = translated;
      item.error = '';
      item.pending = false;
      renderSentences();
      saveStateSoon();
      setStatus('অনুবাদ যোগ হয়েছে', 'ready');
    } catch (error) {
      item.error = error?.message || 'TRANSLATION_FAILED';
      renderSentences();
      setStatus('বাক্য অনুবাদ ব্যর্থ', 'error');
      showToast('এই বাক্যটির অনুবাদ পাওয়া যায়নি।', { type: 'error' });
    }
  }

  async function retryWord(index) {
    const item = state.vocab[index];
    if (!item || state.updating) {
      return;
    }
    setStatus('শব্দের অর্থ খোঁজা হচ্ছে…', 'busy');
    try {
      const info = await AppTranslate.fetchWordInfo(item.word, { force: true });
      state.vocab[index] = {
        ...item,
        ...info,
        count: item.count || 1,
        pending: false,
        error: info?.error || ''
      };
      renderVocab();
      saveStateSoon();
      setStatus('শব্দের অর্থ প্রস্তুত', 'ready');
    } catch (error) {
      state.vocab[index] = {
        ...item,
        pending: false,
        error: error?.message || 'WORD_FAILED'
      };
      renderVocab();
      setStatus('শব্দের অর্থ পাওয়া যায়নি', 'error');
      showToast('এই শব্দের অর্থ আনা যায়নি।', { type: 'error' });
    }
  }

  function abortError() {
    try {
      return new DOMException('Aborted', 'AbortError');
    } catch (error) {
      const fallback = new Error('Aborted');
      fallback.name = 'AbortError';
      return fallback;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  /* ------------------------------------------------------------------ */
  /* Voice playback                                                      */
  /* ------------------------------------------------------------------ */

  function bindTtsCallbacks() {
    AppTTS.setOnState((snapshot) => updatePlaybackUI(snapshot));
    AppTTS.setOnError((message) => {
      showToast(message || 'ভয়েস চালাতে সমস্যা হয়েছে।', { type: 'error', timeout: 6000 });
    });
    AppTTS.setOnFallback(() => {
      showToast('Cloud ভয়েস পাওয়া যায়নি — ব্রাউজারের সেরা ভয়েস ব্যবহার করা হচ্ছে।', {
        type: 'warning',
        timeout: 5000
      });
    });
    AppTTS.setOnVoicesChanged(() => {
      populateVoiceSelects();
    });
  }

  function setActiveSpeaker(button) {
    clearActiveSpeaker();
    if (button) {
      state.activeSpeaker = button;
      button.classList.add('active', 'speaking');
    }
  }

  function clearActiveSpeaker() {
    const button = state.activeSpeaker;
    state.activeSpeaker = null;
    if (button && button.isConnected) {
      button.classList.remove('active', 'speaking');
    }
  }

  function speakSource(lang, button) {
    if (!authAllowed()) {
      return;
    }
    const text = String(state.text || '').trim();
    if (!text) {
      showToast('আগে ইংরেজি লেখা স্ক্যান বা টাইপ করুন।', { type: 'warning' });
      return;
    }
    setActiveSpeaker(button);
    const label = lang === 'en-GB' ? 'ইংরেজি (UK)' : 'ইংরেজি (US)';
    const started = AppTTS.speakText(text, lang, { label });
    if (!started) {
      clearActiveSpeaker();
      showToast('শোনানোর মতো লেখা পাওয়া যায়নি।', { type: 'warning' });
    }
  }

  function speakTranslated(button) {
    if (!authAllowed()) {
      return;
    }
    const text = String(state.translation || '').trim();
    if (!text) {
      showToast('আগে অনুবাদ তৈরি করুন।', { type: 'warning' });
      return;
    }
    setActiveSpeaker(button);
    const lang = AppTranslate.ttsLanguage(state.targetLang);
    const label = `${AppTranslate.languageName(state.targetLang)} অনুবাদ`;
    const started = AppTTS.speakText(text, lang, { label });
    if (!started) {
      clearActiveSpeaker();
      showToast('শোনানোর মতো অনুবাদ পাওয়া যায়নি।', { type: 'warning' });
    }
  }

  function speakSentence(index, which) {
    if (!authAllowed()) {
      return;
    }
    const item = state.sentences[index];
    if (!item) {
      return;
    }
    const text = which === 'tr' ? String(item.tr || '').trim() : String(item.en || '').trim();
    if (!text) {
      showToast('এই অংশের লেখা এখনও প্রস্তুত নয়।', { type: 'warning' });
      return;
    }
    const lang = which === 'tr' ? AppTranslate.ttsLanguage(state.targetLang) : 'en-US';
    const label = `বাক্য ${AppText.bnNumber(index + 1)}`;
    const started = AppTTS.speakText(text, lang, { label });
    if (!started) {
      showToast('শোনানো যায়নি।', { type: 'warning' });
    }
  }

  function playAllEnglish() {
    if (!authAllowed()) {
      return;
    }
    const segments = state.sentences
      .filter((item) => item && item.en)
      .map((item) => ({ text: item.en, lang: 'en-US', label: 'সব ইংরেজি বাক্য' }));
    if (!segments.length) {
      showToast('শোনানোর মতো বাক্য নেই।', { type: 'warning' });
      return;
    }
    clearActiveSpeaker();
    AppTTS.speakSegments(segments, { label: 'সব ইংরেজি বাক্য' });
  }

  function playAllTranslation() {
    if (!authAllowed()) {
      return;
    }
    const segments = state.sentences
      .filter((item) => item && item.tr)
      .map((item) => ({
        text: item.tr,
        lang: AppTranslate.ttsLanguage(state.targetLang),
        label: 'সব অনুবাদ'
      }));
    if (!segments.length) {
      showToast('অনুবাদের বাক্য এখনও প্রস্তুত নয়।', { type: 'warning' });
      return;
    }
    clearActiveSpeaker();
    AppTTS.speakSegments(segments, { label: 'সব অনুবাদ' });
  }

  function speakVocab(index) {
    if (!authAllowed()) {
      return;
    }
    const item = state.vocab[index];
    if (!item || !item.word) {
      return;
    }
    const segments = [{
      text: item.word,
      lang: 'en-US',
      label: item.word,
      audioUrl: /^https?:\/\//i.test(item.audio || '') ? item.audio : ''
    }];
    if (item.meaning) {
      segments.push({
        text: item.meaning,
        lang: AppTranslate.ttsLanguage(state.targetLang),
        label: item.word
      });
    }
    const started = AppTTS.speakSegments(segments, { label: item.word });
    if (!started) {
      showToast('এই শব্দটি শোনানো যায়নি।', { type: 'warning' });
    }
  }

  function playDefault() {
    if (String(state.text || '').trim()) {
      speakSource('en-US', $('speakEnglishUsBtn'));
      return;
    }
    if (String(state.translation || '').trim()) {
      speakTranslated($('speakTranslationBtn'));
      return;
    }
    showToast('শোনানোর মতো কোনো লেখা নেই।', { type: 'warning' });
  }

  function handlePlayPause() {
    if (AppTTS.isActive()) {
      AppTTS.toggle();
      return;
    }
    playDefault();
  }

  function stopSpeaking() {
    try {
      AppTTS.stop();
    } catch (error) {
      /* Ignore. */
    }
    clearActiveSpeaker();
  }

  function updatePlaybackUI(snapshot) {
    const status = snapshot && snapshot.status ? snapshot.status : 'idle';
    const active = ['loading', 'playing', 'speaking', 'paused'].includes(status);
    const paused = status === 'paused';

    $('playPauseBtn').textContent = paused ? '▶' : active ? '⏸' : '▶';
    $('npPauseBtn').textContent = paused ? '▶' : '⏸';
    $('stopBtn').disabled = !active;
    $('nowPlaying').hidden = !active;
    $('nowPlaying').classList.toggle('is-paused', paused);

    const app = document.querySelector('.app');
    if (app) {
      app.classList.toggle('has-player', active);
    }

    if (status === 'error') {
      $('playbackState').textContent = 'সমস্যা';
    } else if (paused) {
      $('playbackState').textContent = 'বিরতি';
    } else if (active) {
      $('playbackState').textContent = status === 'loading' ? 'প্রস্তুত হচ্ছে…' : 'পড়া হচ্ছে…';
    } else {
      $('playbackState').textContent = 'বন্ধ';
    }

    if (snapshot && snapshot.label) {
      $('nowPlayingLabel').textContent = snapshot.label;
    }

    const mode = snapshot && snapshot.mode;
    $('nowPlayingMode').textContent = mode === 'cloud'
      ? 'Google Cloud voice'
      : mode === 'browser'
        ? 'Browser voice'
        : 'Natural voice';

    if (!active) {
      clearActiveSpeaker();
    }
    updateEngineHint(snapshot);
  }

  function updateEngineHint(snapshot) {
    let label = 'Natural TTS';
    const mode = snapshot && snapshot.mode;
    if (mode === 'cloud') {
      label = 'Google Cloud voice';
    } else if (mode === 'browser') {
      label = 'Browser voice';
    } else if (state.settings.engine === 'cloud') {
      label = 'Cloud TTS';
    } else if (state.settings.engine === 'browser') {
      label = 'Browser voice';
    }
    $('engineHint').textContent = label;
  }

  /* ------------------------------------------------------------------ */
  /* TXT export                                                          */
  /* ------------------------------------------------------------------ */

  function selectedSections() {
    return {
      meta: $('exportMeta').checked,
      english: $('exportEnglish').checked,
      translation: $('exportTranslation').checked,
      sentences: $('exportSentences').checked,
      vocab: $('exportVocab').checked
    };
  }

  function allSections() {
    return { meta: true, english: true, translation: true, sentences: true, vocab: true };
  }

  function sentenceLine(item) {
    return `${item.en}${item.tr ? `\n   ↳ ${item.tr}` : ''}`;
  }

  function vocabLine(item) {
    return `${item.word} (${item.pron || '—'}) = ${item.meaning || '—'}`;
  }

  function buildTxt(sections) {
    const parts = [];
    const langName = AppTranslate.languageName(state.targetLang);

    if (sections.meta) {
      const lines = ['English Study — Study Note'];
      if (state.sourceTitle) {
        lines.push(`শিরোনাম: ${state.sourceTitle}`);
      }
      if (state.sourceUrl) {
        lines.push(`সোর্স: ${state.sourceUrl}`);
      }
      lines.push(`অনুবাদের ভাষা: ${langName}`);
      lines.push(`তারিখ: ${AppText.formatDateBn(new Date())}`);
      parts.push(lines.join('\n'));
    }

    if (sections.english && state.text.trim()) {
      parts.push(`===== মূল ইংরেজি প্যাসেজ =====\n\n${state.text.trim()}`);
    }

    if (sections.translation && state.translation.trim()) {
      parts.push(`===== ${langName} অনুবাদ =====\n\n${state.translation.trim()}`);
    }

    if (sections.sentences) {
      const items = state.sentences.filter((item) => item && item.en);
      if (items.length) {
        const lines = items.map((item, index) => `${AppText.bnNumber(index + 1)}. ${sentenceLine(item)}`);
        parts.push(`===== লাইন-বাই-লাইন অনুবাদ =====\n\n${lines.join('\n\n')}`);
      }
    }

    if (sections.vocab) {
      const items = state.vocab.filter((item) => item && item.word && !item.pending);
      if (items.length) {
        parts.push(`===== শব্দভান্ডার =====\n\n${items.map(vocabLine).join('\n')}`);
      }
    }

    return parts.length ? `${parts.join('\n\n\n')}\n` : '';
  }

  function updateExportSummary() {
    const words = countWords(state.text);
    const sentences = state.sentences.length;
    const vocab = state.vocab.length;

    $('dataWords').textContent = AppText.bnNumber(words);
    $('dataSentences').textContent = AppText.bnNumber(sentences);
    $('dataVocab').textContent = AppText.bnNumber(vocab);
    $('dataUpdated').textContent = state.updatedAt
      ? `সর্বশেষ আপডেট: ${AppText.formatDateBn(new Date(state.updatedAt))}`
      : 'এখনও আপডেট হয়নি';

    const sections = selectedSections();
    const count = Object.keys(sections).filter((key) => sections[key]).length;
    const chars = state.text.length +
      (sections.translation ? state.translation.length : 0) +
      state.sentences.reduce((sum, item) => sum + item.en.length + (item.tr || '').length, 0) +
      state.vocab.reduce((sum, item) => sum + (item.word || '').length + (item.meaning || '').length, 0);

    $('exportStats').textContent = `${AppText.bnNumber(count)}টি অংশ নির্বাচিত • প্রায় ${AppText.bnNumber(chars)} অক্ষর • ${AppText.bnNumber(words)} শব্দ`;
    $('printPdfBtn').disabled = !state.text.trim();

    const hasAnything = state.text.trim() || state.translation.trim() || state.sentences.length || state.vocab.length;
    $('downloadTxtBtn').disabled = !hasAnything;
    $('copyAllBtn').disabled = !hasAnything;
    $('quickEnglishBtn').disabled = !state.text.trim();
    $('quickTranslationBtn').disabled = !state.translation.trim();
    $('quickVocabBtn').disabled = !state.vocab.some((item) => item && !item.pending);
  }

  function refreshExportPreview() {
    updateExportSummary();
  }

  function exportFileName(suffix) {
    const base = AppText.safeFileName(state.sourceTitle || 'English-Study');
    return `${base}-${suffix}-${AppText.timestampForFile()}.txt`;
  }

  function downloadTxt() {
    if (!authAllowed()) {
      return;
    }
    const sections = selectedSections();
    if (!Object.keys(sections).some((key) => sections[key])) {
      showToast('TXT ফাইলে রাখার জন্য অন্তত একটি অংশ টিক দিন।', { type: 'warning' });
      return;
    }
    const content = buildTxt(sections);
    if (!content.trim()) {
      showToast('নির্বাচিত অংশগুলোতে এখনও কোনো লেখা নেই।', { type: 'warning' });
      return;
    }
    AppText.downloadText(content, exportFileName('study'));
    logActivity('export_txt', 'TXT ফাইল ডাউনলোড (' + content.length + ' অক্ষর)');
    showToast('TXT ফাইল ডাউনলোড হয়েছে।', { type: 'success' });
  }

  function quickExport(kind) {
    if (!authAllowed()) {
      return;
    }
    const sections = {
      meta: false,
      english: kind === 'english',
      translation: kind === 'translation',
      sentences: false,
      vocab: kind === 'vocab'
    };
    const content = buildTxt(sections);
    if (!content.trim()) {
      showToast('এই অংশে এখনও কোনো লেখা নেই।', { type: 'warning' });
      return;
    }
    AppText.downloadText(content, exportFileName(kind));
    logActivity('export_txt', 'দ্রুত ডাউনলোড: ' + kind + ' (' + content.length + ' অক্ষর)');
    showToast('ডাউনলোড সম্পন্ন হয়েছে।', { type: 'success' });
  }

  async function copyAll() {
    if (!authAllowed()) {
      return;
    }
    const content = buildTxt(allSections());
    if (!content.trim()) {
      showToast('কপি করার মতো কোনো লেখা নেই।', { type: 'warning' });
      return;
    }
    const ok = await AppText.copyText(content);
    if (ok) {
      logActivity('export_copy', 'সব লেখা কপি (' + content.length + ' অক্ষর)');
      showToast('সব লেখা কপি হয়েছে।', { type: 'success' });
    } else {
      showToast('কপি করা যায়নি। অনুগ্রহ করে TXT ডাউনলোড করুন।', { type: 'error' });
    }
  }

  async function copyTranslation() {
    if (!state.translation.trim()) {
      showToast('কপি করার মতো অনুবাদ নেই।', { type: 'warning' });
      return;
    }
    const ok = await AppText.copyText(state.translation);
    showToast(ok ? 'অনুবাদ কপি হয়েছে।' : 'কপি করা যায়নি।', {
      type: ok ? 'success' : 'error'
    });
  }

  async function printChart() {
    if (!authAllowed()) {
      return;
    }
    if (!state.text.trim()) {
      showToast('স্টাডি চার্ট তৈরির জন্য আগে লেখা স্ক্যান করুন।', { type: 'warning' });
      return;
    }
    const payload = {
      title: state.sourceTitle || 'English Study Note',
      sourceTitle: state.sourceTitle || '',
      sourceUrl: state.sourceUrl || '',
      text: state.text,
      translation: state.translation,
      targetLang: state.targetLang,
      langName: AppTranslate.languageName(state.targetLang),
      sentences: state.sentences
        .filter((item) => item && item.en)
        .map((item) => ({ en: item.en, tr: item.tr, error: item.error || '' })),
      vocab: state.vocab
        .filter((item) => item && item.word && !item.pending)
        .map((item) => ({
          word: item.word,
          pron: item.pron || '',
          meaning: item.meaning || '',
          ipa: item.ipa || ''
        })),
      createdAt: Date.now()
    };

    try {
      await chrome.storage.local.set({ printData: payload });
      await chrome.tabs.create({ url: chrome.runtime.getURL('print.html?auto=1') });
      logActivity('print_pdf', 'স্টাডি চার্ট প্রিন্ট/PDF — ' + payload.sentences.length + ' বাক্য');
      showToast('স্টাডি চার্ট নতুন ট্যাবে খোলা হয়েছে — Save as PDF বেছে নিন।', {
        type: 'success',
        timeout: 6000
      });
    } catch (error) {
      showToast(error?.message || 'স্টাডি চার্ট খোলা যায়নি।', { type: 'error' });
    }
  }
  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  async function clearNote() {
    if (state.updating) {
      showToast('আপডেট শেষ হওয়ার পরে লেখা মুছুন।', { type: 'warning' });
      return;
    }
    const hasContent = $('sourceText').value.trim() || state.translation || state.vocab.length || state.sentences.length;
    if (!hasContent) {
      return;
    }
    const choice = await showChoice({
      title: 'লেখা মুছবেন?',
      message: 'বর্তমান লেখা, অনুবাদ, লাইন-বাই-লাইন অর্থ ও শব্দভান্ডার মুছে যাবে।',
      buttons: [
        { label: 'হ্যাঁ, মুছুন', value: 'yes', className: 'btn-danger' },
        { label: 'বাতিল', value: 'no', className: 'btn-soft' }
      ]
    });
    if (choice !== 'yes') {
      return;
    }
    stopSpeaking();
    abortCurrentUpdate();
    setUpdateBusy(false);
    applyText('', { sourceTitle: '', sourceUrl: '' });
    setStatus('লেখা মুছে ফেলা হয়েছে', 'ready');
    saveStateNow();
    showToast('নোট মুছে ফেলা হয়েছে।', { type: 'success' });
  }

  async function retryVocabularyAll() {
    if (state.updating) {
      return;
    }
    if (!String(state.text || '').trim()) {
      showToast('আগে ইংরেজি লেখা দিন।', { type: 'warning' });
      return;
    }
    const button = $('retryVocabBtn');
    button.disabled = true;
    setStatus('শব্দভান্ডার আবার তৈরি হচ্ছে…', 'busy');
    try {
      await buildVocabNow(null);
      state.updatedAt = Date.now();
      renderVocab();
      updateExportSummary();
      saveStateNow();
      setStatus('শব্দভান্ডার প্রস্তুত', 'ready');
      showToast('শব্দভান্ডার আবার তৈরি হয়েছে।', { type: 'success' });
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }
      setStatus('শব্দভান্ডার তৈরি ব্যর্থ', 'error');
      showToast(error?.message || 'শব্দভান্ডার তৈরি করা যায়নি।', { type: 'error' });
    } finally {
      button.disabled = state.updating;
    }
  }

  async function resetAllData() {
    const choice = await showChoice({
      title: 'সব ডেটা মুছবেন?',
      message: 'সংরক্ষিত লেখা, অনুবাদ, শব্দভান্ডার, সেটিংস ও ক্যাশ — সবকিছু মুছে যাবে। এটি ফেরানো যাবে না।',
      buttons: [
        { label: 'হ্যাঁ, সব মুছুন', value: 'yes', className: 'btn-danger' },
        { label: 'বাতিল', value: 'no', className: 'btn-soft' }
      ]
    });
    if (choice !== 'yes') {
      return;
    }

    stopSpeaking();
    abortCurrentUpdate();
    clearCropWatchdog();
    state.ocrRunId += 1;
    state.ocrBusy = false;
    state.text = '';
    state.processedText = '';
    state.translation = '';
    state.sentences = [];
    state.vocab = [];
    state.sourceTitle = '';
    state.sourceUrl = '';
    state.updatedAt = 0;
    state.targetLang = 'bn';
    state.search = '';
    state.sortMode = 'source';
    state.seenIntents.clear();
    state.settings = { ...DEFAULT_SETTINGS, voicePrefs: {} };

    $('sourceText').value = '';
    $('targetLang').value = 'bn';
    $('vocabSearch').value = '';
    $('vocabSortBtn').textContent = 'A–Z';
    $('ocrProgress').hidden = true;
    $('vocabProgress').hidden = true;
    $('editorNotice').hidden = true;

    AppTTS.setEngine('auto');
    AppTTS.setRate(1);
    AppTTS.setVoicePrefs({});
    $('ttsEngineSelect').value = 'auto';
    $('rateSlider').value = '1';
    updateRateUI(1);
    $('enhanceOcrCheckbox').checked = true;
    $('autoTranslateCheckbox').checked = true;
    $('vocabLimitSelect').value = '45';

    try {
      await AppTranslate.clearCaches();
    } catch (error) {
      /* Ignore. */
    }
    try {
      await chrome.storage.local.clear();
    } catch (error) {
      console.warn('[English Study] clear storage:', error);
    }

    populateVoiceSelects();
    setUpdateBusy(false);
    renderAll();
    setStatus('সব ডেটা মুছে ফেলা হয়েছে', 'ready');
    showToast('সব সংরক্ষিত ডেটা মুছে ফেলা হয়েছে।', { type: 'success' });
  }

  async function clearTranslationCaches() {
    try {
      await AppTranslate.clearCaches();
      showToast('অনুবাদ ও শব্দের ক্যাশ মুছে ফেলা হয়েছে।', { type: 'success' });
    } catch (error) {
      showToast('ক্যাশ মোছা যায়নি।', { type: 'error' });
    }
  }

  async function resetOcrEngine() {
    if (state.ocrBusy) {
      showToast('OCR চলছে — শেষ হওয়ার পরে রিসেট করুন।', { type: 'warning' });
      return;
    }
    try {
      await AppOCR.reset();
      showToast('OCR ইঞ্জিন রিসেট হয়েছে। পরের স্ক্যানে আবার লোড হবে।', { type: 'success' });
    } catch (error) {
      showToast('OCR ইঞ্জিন রিসেট করা যায়নি।', { type: 'error' });
    }
  }

  function toggleVocabSort() {
    state.sortMode = state.sortMode === 'alpha' ? 'source' : 'alpha';
    $('vocabSortBtn').textContent = state.sortMode === 'alpha' ? 'আগের ক্রম' : 'A–Z';
    renderVocab();
  }

  /* ------------------------------------------------------------------ */
  /* Event wiring                                                        */
  /* ------------------------------------------------------------------ */

  function bindStaticEvents() {
    $('helpBtn').addEventListener('click', () => openDialog($('helpDialog')));
    $('settingsBtn').addEventListener('click', () => openDialog($('settingsDialog')));
    $('helpCloseBtn').addEventListener('click', () => closeDialog($('helpDialog')));
    $('settingsCloseBtn').addEventListener('click', () => closeDialog($('settingsDialog')));

    [$('settingsDialog'), $('helpDialog'), $('choiceDialog')].forEach((dialog) => {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
          closeDialog(dialog);
        }
      });
    });

    $('tabReaderBtn').addEventListener('click', () => switchTab('reader'));
    $('tabVocabBtn').addEventListener('click', () => switchTab('vocab'));
    $('tabExportBtn').addEventListener('click', () => switchTab('export'));

    $('cropBtn').addEventListener('click', startOverlayCrop);
    $('screenshotCropBtn').addEventListener('click', openScreenshotCrop);
    $('imageBtn').addEventListener('click', chooseImage);
    $('imageInput').addEventListener('change', handleImagePicked);

    $('sourceText').addEventListener('input', () => {
      state.text = $('sourceText').value;
      if (AppTTS.isActive()) {
        stopSpeaking();
      }
      updateTextStats();
      updateDirtyState();
      updateExportSummary();
      saveStateSoon();
    });

    $('clearBtn').addEventListener('click', clearNote);
    $('updateBtn').addEventListener('click', runUpdate);

    $('targetLang').addEventListener('change', () => {
      const value = $('targetLang').value;
      if (!languageExists(value)) {
        return;
      }
      state.targetLang = value;
      updateLanguageLabels();
      saveStateSoon();
      renderSentences();
      if (String(state.text || '').trim() && !state.updating) {
        runUpdate();
      }
    });

    $('copyTranslationBtn').addEventListener('click', copyTranslation);

    $('speakEnglishUsBtn').addEventListener('click', () => speakSource('en-US', $('speakEnglishUsBtn')));
    $('speakEnglishUkBtn').addEventListener('click', () => speakSource('en-GB', $('speakEnglishUkBtn')));
    $('speakTranslationBtn').addEventListener('click', () => speakTranslated($('speakTranslationBtn')));
    $('playPauseBtn').addEventListener('click', handlePlayPause);
    $('stopBtn').addEventListener('click', stopSpeaking);
    $('npPauseBtn').addEventListener('click', handlePlayPause);
    $('npStopBtn').addEventListener('click', stopSpeaking);

    $('rateSlider').addEventListener('input', () => {
      setRate($('rateSlider').value, { immediate: true });
    });
    $('rateSlider').addEventListener('change', () => {
      setRate($('rateSlider').value);
      saveSettings();
    });
    document.querySelectorAll('.rate-preset').forEach((button) => {
      button.addEventListener('click', () => {
        setRate(Number(button.dataset.rate), { immediate: true });
        saveSettings();
      });
    });

    $('playAllEnglishBtn').addEventListener('click', playAllEnglish);
    $('playAllTranslationBtn').addEventListener('click', playAllTranslation);

    $('sentenceList').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) {
        return;
      }
      const index = Number(button.dataset.index);
      if (!Number.isInteger(index)) {
        return;
      }
      const action = button.dataset.action;
      if (action === 'speak-en') {
        speakSentence(index, 'en');
      } else if (action === 'speak-tr') {
        speakSentence(index, 'tr');
      } else if (action === 'retry-sentence') {
        button.disabled = true;
        retrySentence(index);
      }
    });

    $('vocabSearch').addEventListener('input', () => {
      state.search = $('vocabSearch').value;
      renderVocab();
    });
    $('vocabSortBtn').addEventListener('click', toggleVocabSort);
    $('retryVocabBtn').addEventListener('click', retryVocabularyAll);

    $('vocabList').addEventListener('click', (event) => {
      const retry = event.target.closest('button[data-action="retry-word"]');
      if (retry) {
        const index = Number(retry.dataset.index);
        if (Number.isInteger(index)) {
          retry.disabled = true;
          retryWord(index);
        }
        return;
      }
      const speak = event.target.closest('button.vocab-speak');
      if (speak) {
        const index = Number(speak.dataset.index);
        if (Number.isInteger(index)) {
          setActiveSpeaker(speak);
          speakVocab(index);
        }
      }
    });

    ['exportMeta', 'exportEnglish', 'exportTranslation', 'exportSentences', 'exportVocab'].forEach((id) => {
      $(id).addEventListener('change', updateExportSummary);
    });

    $('downloadTxtBtn').addEventListener('click', downloadTxt);
    $('copyAllBtn').addEventListener('click', copyAll);
    $('quickEnglishBtn').addEventListener('click', () => quickExport('english'));
    $('quickTranslationBtn').addEventListener('click', () => quickExport('translation'));
    $('quickVocabBtn').addEventListener('click', () => quickExport('vocab'));
    $('printPdfBtn').addEventListener('click', printChart);

    $('ttsEngineSelect').addEventListener('change', () => {
      const engine = $('ttsEngineSelect').value;
      state.settings.engine = ['auto', 'cloud', 'browser'].includes(engine) ? engine : 'auto';
      AppTTS.setEngine(state.settings.engine);
      updateEngineHint(AppTTS.getSnapshot());
      saveSettings();
    });

    ['voiceUsSelect', 'voiceUkSelect', 'voiceBnSelect'].forEach((id) => {
      $(id).addEventListener('change', () => {
        state.settings.voicePrefs = readVoicePrefs();
        AppTTS.setVoicePrefs(state.settings.voicePrefs);
        saveSettings();
      });
    });

    $('testUsBtn').addEventListener('click', () => AppTTS.testVoice('en-US'));
    $('testUkBtn').addEventListener('click', () => AppTTS.testVoice('en-GB'));
    $('testBnBtn').addEventListener('click', () => AppTTS.testVoice('bn-BD'));

    $('enhanceOcrCheckbox').addEventListener('change', () => {
      state.settings.enhanceOcr = $('enhanceOcrCheckbox').checked;
      saveSettings();
    });
    $('autoTranslateCheckbox').addEventListener('change', () => {
      state.settings.autoTranslate = $('autoTranslateCheckbox').checked;
      saveSettings();
    });
    $('vocabLimitSelect').addEventListener('change', () => {
      const value = Number($('vocabLimitSelect').value);
      state.settings.vocabLimit = [30, 45, 60].includes(value) ? value : 45;
      saveSettings();
      showToast('শব্দভান্ডারের সীমা পরের আপডেটে প্রয়োগ হবে।', { type: 'info' });
    });

    $('clearCacheBtn').addEventListener('click', clearTranslationCaches);
    $('resetOcrBtn').addEventListener('click', resetOcrEngine);
    $('clearAllBtn').addEventListener('click', resetAllData);

    $('openExtensionsBtn').addEventListener('click', async () => {
      const result = await sendBackground('OPEN_EXTENSIONS_PAGE');
      if (!result || !result.ok) {
        showToast(result?.error || 'এক্সটেনশন পেজ খোলা যায়নি। ব্রাউজারের অ্যাড্রেস বারে chrome://extensions লিখুন।', {
          type: 'warning',
          timeout: 7000
        });
      }
    });

    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (document.querySelector('dialog[open]')) {
          return;
        }
        event.preventDefault();
        if (!state.updating) {
          runUpdate();
        }
      }
    });

    window.addEventListener('beforeunload', () => {
      try {
        AppTTS.stop();
      } catch (error) {
        /* Ignore. */
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((message) => {
    const run = () => {
      try {
        handleIncoming(message);
      } catch (error) {
        console.warn('[English Study] message handler:', error);
      }
    };
    if (initPromise) {
      initPromise.then(run).catch(() => {});
    } else {
      setTimeout(run, 0);
    }
    return false;
  });

  initPromise = init();
  initPromise.catch((error) => {
    console.error('[English Study] init failed:', error);
    try {
      setStatus('শুরু করা যায়নি — প্যানেল রিলোড করুন', 'error');
    } catch (statusError) {
      /* Ignore. */
    }
  });
})();
