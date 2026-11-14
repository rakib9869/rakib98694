/* English Study — printable study chart logic */
(() => {
  'use strict';

  const sheet = document.getElementById('sheet');
  const chart = document.getElementById('chart');
  const emptyState = document.getElementById('emptyState');
  const printBtn = document.getElementById('printBtn');
  const closeBtn = document.getElementById('closeBtn');
  const emptyCloseBtn = document.getElementById('emptyCloseBtn');

  const chartTitle = document.getElementById('chartTitle');
  const chartDate = document.getElementById('chartDate');
  const metaSource = document.getElementById('metaSource');
  const metaStats = document.getElementById('metaStats');
  const englishSection = document.getElementById('englishSection');
  const englishBody = document.getElementById('englishBody');
  const translationSection = document.getElementById('translationSection');
  const translationBody = document.getElementById('translationBody');
  const translationHeading = document.getElementById('translationHeading');
  const sentencesSection = document.getElementById('sentencesSection');
  const sentenceBody = document.getElementById('sentenceBody');
  const sentenceTranslationHead = document.getElementById('sentenceTranslationHead');
  const vocabSection = document.getElementById('vocabSection');
  const vocabBody = document.getElementById('vocabBody');
  const footerDate = document.getElementById('footerDate');

  let data = null;
  let printed = false;

  printBtn.addEventListener('click', () => window.print());
  closeBtn.addEventListener('click', closeTab);
  emptyCloseBtn.addEventListener('click', closeTab);

  init().catch((error) => showEmpty(error?.message || String(error)));

  async function init() {
    let stored = null;
    try {
      const result = await chrome.storage.local.get('printData');
      stored = result?.printData || null;
    } catch (error) {
      stored = null;
    }

    if (!stored || !stored.text || !String(stored.text).trim()) {
      showEmpty('স্টাডি চার্ট ডেটা পাওয়া যায়নি।');
      return;
    }

    data = stored;
    render(stored);
    emptyState.hidden = true;
    chart.hidden = false;

    if (new URLSearchParams(location.search).get('auto') === '1') {
      try {
        await document.fonts.ready;
      } catch (error) {
        /* Ignore font readiness issues. */
      }
      setTimeout(() => {
        if (!printed) {
          printed = true;
          window.print();
        }
      }, 650);
    }
  }

  function render(payload) {
    const title = clean(payload.sourceTitle) || 'English Study Note';
    const now = new Date();
    document.title = title === 'English Study Note' ? title : `English Study — ${title}`;

    chartTitle.textContent = title;
    chartDate.textContent = formatDate(now);
    footerDate.textContent = `Generated: ${formatDate(now)}`;
    metaStats.textContent = buildStats(payload);

    if (payload.sourceUrl) {
      const label = document.createElement('span');
      label.textContent = 'Source: ';
      const source = document.createElement('span');
      if (/^https?:\/\//i.test(payload.sourceUrl)) {
        const link = document.createElement('a');
        link.href = payload.sourceUrl;
        link.textContent = payload.sourceUrl;
        source.appendChild(link);
      } else {
        source.textContent = payload.sourceUrl;
      }
      metaSource.replaceChildren(label, source);
    } else {
      metaSource.textContent = 'Source: English Study Side Panel';
    }

    const langName = clean(payload.langName) || 'বাংলা';
    const isBengali = payload.targetLang === 'bn' || langName === 'বাংলা';

    appendParagraphs(englishBody, payload.text);
    if (!payload.text.trim()) {
      englishSection.hidden = true;
    }

    if (payload.translation && payload.translation.trim()) {
      translationHeading.textContent = isBengali ? 'বাংলা অনুবাদ' : `${langName} অনুবাদ`;
      appendParagraphs(translationBody, payload.translation);
      translationBody.setAttribute('lang', payload.targetLang || 'bn');
    } else {
      translationSection.hidden = true;
    }

    const sentences = Array.isArray(payload.sentences) ? payload.sentences : [];
    const usableSentences = sentences.filter((item) => item && item.en);
    if (usableSentences.length) {
      sentenceTranslationHead.textContent = isBengali ? 'বাংলা অর্থ' : `${langName} অনুবাদ`;
      usableSentences.forEach((item, index) => {
        const row = document.createElement('tr');

        const numCell = document.createElement('td');
        numCell.className = 'num';
        numCell.textContent = String(index + 1);

        const englishCell = document.createElement('td');
        englishCell.className = 'english';
        englishCell.textContent = item.en || '';

        const translationCell = document.createElement('td');
        translationCell.className = 'translation';
        translationCell.dir = 'auto';
        translationCell.setAttribute('lang', payload.targetLang || 'bn');
        translationCell.textContent = item.tr || (item.error ? '—' : '…');

        row.append(numCell, englishCell, translationCell);
        sentenceBody.appendChild(row);
      });
    } else {
      sentencesSection.hidden = true;
    }

    const vocab = Array.isArray(payload.vocab) ? payload.vocab : [];
    const usableVocab = vocab.filter((item) => item && item.word && (item.meaning || item.pron));
    if (usableVocab.length) {
      usableVocab.forEach((item) => {
        const box = document.createElement('div');
        box.className = 'vocab-box';

        const line = document.createElement('div');

        const word = document.createElement('span');
        word.className = 'vocab-word';
        word.textContent = item.word;

        const pron = document.createElement('span');
        pron.className = 'vocab-pron';
        pron.textContent = item.pron ? ` ${item.pron}` : '';

        const eq = document.createElement('span');
        eq.className = 'vocab-eq';
        eq.textContent = ' = ';

        const meaning = document.createElement('span');
        meaning.className = 'vocab-meaning';
        meaning.textContent = item.meaning || '—';

        line.append(word, pron, eq, meaning);
        box.appendChild(line);

        if (item.ipa) {
          const ipa = document.createElement('div');
          ipa.className = 'vocab-ipa';
          ipa.textContent = item.ipa;
          box.appendChild(ipa);
        }

        vocabBody.appendChild(box);
      });
    } else {
      vocabSection.hidden = true;
    }

    if (englishSection.hidden && translationSection.hidden && sentencesSection.hidden && vocabSection.hidden) {
      showEmpty('প্রিন্ট করার মতো কোনো লেখা পাওয়া যায়নি।');
    }
  }

  function appendParagraphs(container, text) {
    const value = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!value) {
      return;
    }
    const paragraphs = value
      .split(/\n\s*\n+/)
      .map((part) => part.replace(/\n+/g, ' ').trim())
      .filter(Boolean);

    if (!paragraphs.length) {
      return;
    }

    paragraphs.forEach((part) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = part;
      container.appendChild(paragraph);
    });
  }

  function buildStats(payload) {
    const text = String(payload.text || '');
    const wordCount = (text.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
    const sentenceCount = Array.isArray(payload.sentences) ? payload.sentences.length : 0;
    const vocabCount = Array.isArray(payload.vocab) ? payload.vocab.length : 0;
    const parts = [`${wordCount} words`];
    if (sentenceCount) {
      parts.push(`${sentenceCount} sentences`);
    }
    if (vocabCount) {
      parts.push(`${vocabCount} key words`);
    }
    return parts.join('  •  ');
  }

  function formatDate(date) {
    try {
      return date.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return date.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function showEmpty(message) {
    chart.hidden = true;
    sheet.classList.add('is-empty');
    emptyState.hidden = false;
    const paragraph = emptyState.querySelector('p');
    if (paragraph && message) {
      paragraph.textContent = message;
    }
  }

  async function closeTab() {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    } catch (error) {
      /* Fall through. */
    }
    window.close();
  }

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
})();
