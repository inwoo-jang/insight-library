'use strict';
const {notes, attachments, companies = []} = JSON.parse(document.getElementById('archive-data').textContent);
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = (value) => /^https?:\/\//i.test(value) ? escapeHTML(value) : '#';
const categories = [...new Set(notes.map(n => n.category))];
const industries = [...new Set(companies.map(c => c.industry).concat(notes.map(n => n.industry)).filter(Boolean))];
const seriesNames = [...new Set(notes.filter(n => n.series).map(n => n.series))];
const bookmarkIcon = '<svg viewBox="0 0 14 18" aria-hidden="true"><path d="M2 1.5h10v15l-5-3.4-5 3.4z"/></svg>';
const external = (url, label, className = '') => `<a class="${className}" href="${safeURL(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} ↗</a>`;
let saved = new Set();
try { const stored = JSON.parse(localStorage.getItem('insight-library-saved') || '[]'); if (Array.isArray(stored)) saved = new Set(stored.filter(id => notes.some(n => n.id === id))); } catch (_) { /* Storage can be disabled for file pages. Reading still works. */ }
let state = {view:'all', category:'전체', query:'', sort:'newest'};
let currentNote = null;
let openingElement = null;
let toastTimer;

// 기준일: the original's publish date when known, otherwise the date it was filed.
const baseDate = (note) => note.published || note.date || '';
const dateLabel = (note) => note.date ? note.date.replaceAll('-', '.') : '정리일 미기록';
const seriesPart = (note) => {
  if (!note.series) return '';
  const total = notes.filter(n => n.series === note.series && n.seriesOrder > 0).length;
  return note.seriesOrder ? `${note.series} ${note.seriesOrder}/${total}` : `${note.series} 종합`;
};
const meta = (note) => `<span class="cat">${escapeHTML(note.category)}</span><span class="dot"></span><time${baseDate(note) ? ` datetime="${baseDate(note)}"` : ''}>${dateLabel({date: baseDate(note)})}</time><span class="dot"></span><span>${escapeHTML(note.source)}</span>`;
function cover(note, {badge = false, eager = false} = {}) {
  const tone = categories.indexOf(note.category) % 5;
  const img = src => `<img src="${escapeHTML(src)}" alt="" ${eager ? '' : 'loading="lazy"'} decoding="async">`;
  // A series hub shows its articles' images as a collage.
  const collage = note.cover === 'collage' ? notes.filter(n => n.series === note.series && n.seriesOrder > 0 && n.cover && n.cover !== 'collage').sort((a, b) => a.seriesOrder - b.seriesOrder).slice(0, 4) : [];
  const inner = collage.length
    ? `<div class="collage">${collage.map(n => img(n.cover)).join('')}</div>`
    : note.cover && note.cover !== 'collage' ? img(note.cover)
    : `<div class="cover-type" style="--tone-bg:var(--tone-${tone});--tone-ink:var(--tone-${tone}-ink)"><small>${escapeHTML(note.category)}</small><b>${escapeHTML(note.coverWord || note.title.slice(0, 4))}</b></div>`;
  return `<div class="cover">${inner}${badge && note.series ? `<span class="series-badge">${escapeHTML(seriesPart(note))}</span>` : ''}</div>`;
}
const bookmark = (note, inline = false) => `<button class="bookmark${inline ? ' inline' : ''}" data-save="${escapeHTML(note.id)}" aria-pressed="${saved.has(note.id)}" aria-label="${escapeHTML(note.title)} ${saved.has(note.id) ? '저장 해제' : '저장'}">${bookmarkIcon}${inline ? (saved.has(note.id) ? '저장됨' : '저장') : ''}</button>`;

const uniqueSources = new Map();
for (const note of notes) for (const link of note.links) { if (!uniqueSources.has(link.url)) uniqueSources.set(link.url, {...link, note}); }
$('#saved-count').textContent = saved.size;
$('#filters').innerHTML = ['전체', ...categories].map(c => `<button class="filter${c === '전체' ? ' active' : ''}" data-category="${escapeHTML(c)}" aria-pressed="${c === '전체'}">${escapeHTML(c)}</button>`).join('');
$('#footer-topics').innerHTML = categories.map(c => `<button class="footer-link" data-category="${escapeHTML(c)}">${escapeHTML(c)}</button>`).join('');
$('#footer-series').innerHTML = seriesNames.map(s => { const hub = notes.find(n => n.series === s && !n.seriesOrder) || notes.find(n => n.series === s); return `<a class="footer-link" href="#note/${hub.id}">${escapeHTML(s)}</a>`; }).join('') || '<span class="footer-link">—</span>';

// Recent: newest first, one card per series (its hub), up to three.
const recent = [];
for (const note of [...notes].sort((a, b) => b.date.localeCompare(a.date) || (a.series ? a.seriesOrder : 99) - (b.series ? b.seriesOrder : 99))) {
  if (recent.length === 3) break;
  if (note.series && recent.some(r => r.series === note.series)) continue;
  recent.push(note);
}
$('#featured-section').innerHTML = `<div class="section-label"><h2>최근 추가</h2></div><div class="recent">${recent.map(note => `<article class="recent-item"><a href="#note/${note.id}" tabindex="-1" aria-hidden="true">${cover(note, {eager: true})}</a><div><div class="meta">${meta(note)}</div><h3><a href="#note/${note.id}">${escapeHTML(note.title)}</a></h3>${note.series ? `<span class="recent-series">${escapeHTML(seriesPart(note))}${note.seriesOrder ? '' : ` · ${notes.filter(n => n.series === note.series).length - 1}편`}</span>` : ''}</div></article>`).join('')}</div>`;
const industryTone = (industry) => `--tone-bg:var(--tone-${industries.indexOf(industry) % 5});--tone-ink:var(--tone-${industries.indexOf(industry) % 5}-ink)`;
const companyCover = (c) => `<div class="cover company-cover"><div class="cover-type" style="${industryTone(c.industry)}"><small>${escapeHTML(c.industry)} · 기업 리서치</small><b>${escapeHTML(c.name)}</b></div></div>`;
let industryFilter = '전체';
function renderCompanies() {
  $('#industry-filters').innerHTML = ['전체', ...industries].map(i => `<button class="filter${i === industryFilter ? ' active' : ''}" data-industry="${escapeHTML(i)}" aria-pressed="${i === industryFilter}">${escapeHTML(i)}</button>`).join('');
  const shown = industryFilter === '전체' ? industries : [industryFilter];
  $('#industry-groups').innerHTML = shown.map(industry => {
    const cs = companies.filter(c => c.industry === industry);
    const related = sorted(notes.filter(n => n.industry === industry)).filter(n => !n.series || !n.seriesOrder || !notes.some(h => h.series === n.series && !h.seriesOrder && h.industry === industry));
    const labels = cs.length ? `<ul class="company-labels">${cs.map(c => `<li><a href="#note/${c.id}">${escapeHTML(c.name)}</a><span>${escapeHTML(c.summary)}</span></li>`).join('')}</ul>` : '';
    const noteCards = related.map(n => `<article class="card">${bookmark(n)}<a href="#note/${n.id}" tabindex="-1" aria-hidden="true">${cover(n, {badge: true})}</a><div class="meta">${meta(n)}</div><h3><a href="#note/${n.id}">${escapeHTML(n.title)}</a></h3><p class="excerpt">${escapeHTML(n.summary)}</p></article>`);
    return `<section class="industry"><div class="industry-title"><h2>${escapeHTML(industry)}</h2><span>기업 ${cs.length}곳 · 인사이트 ${notes.filter(n => n.industry === industry).length}편</span></div>${labels}${noteCards.length ? `<div class="grid">${noteCards.join('')}</div>` : ''}</section>`;
  }).join('');
}
// Links between Markdown files become in-page routes; everything else opens outside.
function fixLinks(root) {
  root.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; return; }
    if (/\.md$/i.test(href)) {
      const name = decodeURIComponent(href.replace(/^(\.\.?\/)+/, '')).normalize('NFC').split('/').pop();
      const linked = [...notes, ...companies].find(n => n.file.normalize('NFC').split('/').pop() === name);
      if (linked) a.href = `#note/${linked.id}`; else a.removeAttribute('href');
    } else if (/\.pdf$/i.test(href)) { a.href = 'notes/' + href.replace(/^\.\//, '').replace(/^notes\//, ''); a.target = '_blank'; }
    else if (!href.startsWith('#')) a.removeAttribute('href');
  });
}


function matches(note) {
  const query = state.query.normalize('NFC').toLocaleLowerCase().trim();
  const haystack = [note.title, note.summary, note.source, note.category, note.series, ...note.tags, note.text].join(' ').normalize('NFC').toLocaleLowerCase();
  return (state.category === '전체' || note.category === state.category) && query.split(/\s+/).every(term => haystack.includes(term)) && (state.view !== 'saved' || saved.has(note.id));
}
function sorted(list) {
  return list.sort((a, b) => {
    if (state.sort === 'title') return a.title.localeCompare(b.title, 'ko');
    const da = baseDate(a), db = baseDate(b);
    if (da !== db) {
      if (!da || !db) return da ? -1 : 1;
      return state.sort === 'oldest' ? da.localeCompare(db) : db.localeCompare(da);
    }
    // Same day: a series stays together (hub first), standalone notes after it.
    const rank = n => n.series ? `0${n.series}${String(n.seriesOrder).padStart(2, '0')}` : `1${n.file}`;
    return rank(a).localeCompare(rank(b));
  });
}
function render() {
  const browsing = state.view === 'all' && !state.query && state.category === '전체';
  const visible = sorted(notes.filter(matches));
  const companyView = state.view === 'companies' || state.view === 'mypage';
  $('#featured-section').hidden = !browsing;
  for (const el of ['.hero', '.collection']) $(el).hidden = companyView;
  $('#companies-section').hidden = state.view !== 'companies';
  $('#mypage-section').hidden = state.view !== 'mypage';
  if (state.view === 'mypage') renderMyPage();
  if (companyView) { if (state.view === 'companies') renderCompanies(); document.querySelectorAll('.nav-link[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === state.view); }); return; }
  document.querySelectorAll('.nav-link[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === state.view); b.setAttribute('aria-pressed', b.dataset.view === state.view); });
  document.querySelectorAll('.filter[data-category]').forEach(b => { b.classList.toggle('active', b.dataset.category === state.category); b.setAttribute('aria-pressed', b.dataset.category === state.category); });
  let count = visible.length;
  if (state.view === 'sources') {
    const ids = new Set(notes.filter(matches).map(n => n.id));
    // One card per site: the first link seen for a domain represents it, with the notes that cite it.
    const byDomain = new Map();
    for (const link of uniqueSources.values()) {
      if (!ids.has(link.note.id) || !/^https?:/i.test(link.url)) continue;
      const domain = link.domain.replace(/^(www|m)\./, '');
      if (!byDomain.has(domain)) byDomain.set(domain, {link, domain, notes: new Set()});
      byDomain.get(domain).notes.add(link.note);
    }
    const sites = [...byDomain.values()].sort((a, b) => b.notes.size - a.notes.size || a.domain.localeCompare(b.domain));
    count = sites.length;
    $('#cards').innerHTML = sites.map(({link, domain, notes: cited}) => { const first = [...cited][0]; return `<article class="card source-card"><div class="meta"><span class="cat">${escapeHTML(first.source)}</span><span class="dot"></span><span class="domain">${escapeHTML(domain)}</span></div><h3>${external(`${new URL(link.url).origin}/`, domain)}</h3><p class="excerpt">관련 인사이트 ${cited.size}편${first.sourceNote ? ` · ${escapeHTML(first.sourceNote)}` : ''}</p><a class="note-link" href="#note/${first.id}">${escapeHTML(first.title)} →</a></article>`; }).join('');
  } else {
    $('#cards').innerHTML = visible.map(note => `<article class="card">${bookmark(note)}<a href="#note/${note.id}" tabindex="-1" aria-hidden="true">${cover(note, {badge: true})}</a><div class="meta">${meta(note)}</div><h3><a href="#note/${note.id}">${escapeHTML(note.title)}</a></h3><p class="excerpt">${escapeHTML(note.summary)}</p><div class="tags">${note.tags.map(t => `<span>#${escapeHTML(t)}</span>`).join('')}</div></article>`).join('');
  }
  const heading = {all: '모든 인사이트', saved: '저장한 글', sources: '출처 모음'}[state.view];
  $('#collection-title').innerHTML = `${heading}<small>${count}</small>`;
  $('#result-status').textContent = `${count}개의 ${state.view === 'sources' ? '출처' : '인사이트'}가 표시됩니다.`;
  $('#empty').hidden = count !== 0;
  $('#empty h3').textContent = state.view === 'saved' && !saved.size ? '다시 읽고 싶은 글을 저장해 보세요.' : '아직 발견한 인사이트가 없어요.';
  $('#empty p').textContent = state.view === 'saved' && !saved.size ? '카드 오른쪽 위의 책갈피를 누르면 여기에 모입니다.' : '다른 검색어를 입력하거나 필터를 바꿔보세요.';
}
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 2600); }
function toggleSave(id) {
  if (!notes.some(n => n.id === id)) return;
  saved.has(id) ? saved.delete(id) : saved.add(id);
  let persistent = true;
  try { localStorage.setItem('insight-library-saved', JSON.stringify([...saved])); } catch (_) { persistent = false; }
  $('#saved-count').textContent = saved.size;
  render();
  if (currentNote) $('#reader-actions').innerHTML = readerActions(currentNote);
  toast(persistent ? (saved.has(id) ? '다시 읽을 글에 저장했어요.' : '저장을 해제했어요.') : '현재 창에서만 저장됩니다. 브라우저 저장소를 사용할 수 없어요.');
}
const readerActions = note => `<span id="reader-tools" class="reader-actions"></span>${note.isCompany ? '' : bookmark(note, true)}${note.pdf ? `<a href="${escapeHTML(note.pdf)}" download>원문 PDF ↓</a>` : ''}<a href="${escapeHTML(note.fileUrl)}" download>Markdown ↓</a>${note.links[0] ? external(note.links[0].url, note.sourceNote.includes('미확인') ? '참고 링크' : '원문') : ''}`;
function openNote(id) {
  const company = companies.find(c => c.id === id);
  const note = company ? {...company, fullTitle: company.title, title: company.name, sourceNote: '', isCompany: true} : notes.find(n => n.id === id);
  if (!note) { toast('해당 인사이트를 찾을 수 없어요.'); return; }
  if (!$('#reader').open) openingElement = document.activeElement;
  currentNote = note;
  $('#reader-meta').innerHTML = note.isCompany
    ? `<span class="cat">${escapeHTML(note.industry)}</span><span class="dot"></span><span>정리 ${dateLabel(note)}</span><span class="dot"></span><span>기준일 ${dateLabel({date: note.asOf})}</span><span class="dot"></span><span>약 ${note.minutes}분</span>`
    : `<span class="cat">${escapeHTML(note.category)}</span><span class="dot"></span><span>${escapeHTML(note.source)}</span>${note.published ? `<span class="dot"></span><span>원문 발행 ${dateLabel({date: note.published})}</span>` : ''}<span class="dot"></span><span>정리 ${dateLabel(note)}</span><span class="dot"></span><span>약 ${note.minutes}분</span>`;
  $('#reader-title').textContent = note.fullTitle;
  $('#reader-bar-title').textContent = note.title;
  $('#reader-summary').textContent = note.summary;
  $('#reader-actions').innerHTML = readerActions(note);
  renderReaderTools(note);
  $('#reader-cover').innerHTML = note.isCompany ? '' : cover(note, {eager: true});
  $('#reader-cover').hidden = note.isCompany;
  const fragment = document.createElement('template');
  fragment.innerHTML = note.html;
  fixLinks(fragment.content);
  // The cover already shows the lead image, so drop it from the body.
  const images = [...fragment.content.querySelectorAll('img')];
  if (note.cover && images[0]) images.shift().closest('p')?.remove();
  // Remote images load when online; offline they fall back to a link to the original.
  images.forEach(img => {
    const src = img.getAttribute('src') || '';
    if (!/^https?:\/\//i.test(src)) { img.remove(); return; }
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => { const a = document.createElement('a'); a.className = 'original-image'; a.href = src; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = `원문 이미지 보기: ${img.alt || '참고 이미지'} ↗`; img.replaceWith(a); }, {once: true});
  });
  fragment.content.querySelectorAll('table').forEach(table => { const wrap = document.createElement('div'); wrap.className = 'table-scroll'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', '표, 좌우로 스크롤할 수 있습니다'); table.before(wrap); wrap.append(table); });
  // '한 문장 인사이트' is the point of the note: lift it into a highlighted box under the title.
  const insightHead = [...fragment.content.querySelectorAll('h2')].find(h => h.textContent.trim().startsWith('한 문장 인사이트'));
  $('#reader-insight').replaceChildren();
  if (insightHead) {
    const label = document.createElement('p'); label.className = 'insight-label'; label.textContent = '한 문장 인사이트';
    $('#reader-insight').append(label);
    let node = insightHead.nextSibling;
    while (node && node.nodeName !== 'H2') { const next = node.nextSibling; $('#reader-insight').append(node); node = next; }
    insightHead.remove();
  }
  $('#reader-insight').hidden = !insightHead;
  $('#reader-summary').hidden = Boolean(insightHead);
  // '읽을 때 주의할 점' reads as a footnote: move it to the end in small type.
  const caveatHead = [...fragment.content.querySelectorAll('h2')].find(h => h.textContent.trim().startsWith('읽을 때 주의할 점'));
  let caveats = null;
  if (caveatHead) {
    caveats = document.createElement('aside');
    caveats.className = 'caveats';
    const label = document.createElement('p'); label.className = 'caveats-label'; label.textContent = '읽을 때 주의할 점';
    caveats.append(label);
    let node = caveatHead.nextSibling;
    while (node && !(node.nodeName === 'H2')) { const next = node.nextSibling; caveats.append(node); node = next; }
    caveatHead.remove();
  }
  // Leftover draft markers are not shown.
  fragment.content.querySelectorAll('p, li').forEach(el => { if (/^\(초안 — .*\)$/.test(el.textContent.trim())) el.remove(); });
  $('#reader-content').replaceChildren(fragment.content);
  if (caveats) $('#reader-content').append(caveats);
  const headings = [...$('#reader-content').querySelectorAll('h2')];
  $('#reader-toc').innerHTML = headings.map((heading, i) => { heading.id = `section-${i}`; return `<a href="#section-${i}" data-section="section-${i}">${escapeHTML(heading.textContent)}</a>`; }).join('');
  $('.toc').hidden = headings.length < 2;
  $('.article-body').classList.toggle('no-toc', headings.length < 2);
  const sameIndustry = note.isCompany ? [...companies.filter(c => c.industry === note.industry && c.id !== note.id), ...notes.filter(n => n.industry === note.industry)] : [];
  const siblings = note.series ? notes.filter(n => n.series === note.series).sort((a, b) => a.seriesOrder - b.seriesOrder) : [];
  $('#reader-series').innerHTML = note.isCompany ? (sameIndustry.length ? `<h2>같은 산업 · ${escapeHTML(note.industry)}</h2><div class="series-list">${sameIndustry.map(n => `<a class="series-item" href="#note/${n.id}">${n.industry && companies.includes(n) ? companyCover(n) : cover(n)}<div><span>${escapeHTML(companies.includes(n) ? n.industry : n.source)}</span><strong>${escapeHTML(companies.includes(n) ? n.name : n.title)}</strong></div></a>`).join('')}</div>` : '') : siblings.length > 1 ? `<h2>${escapeHTML(note.series)} 시리즈</h2><div class="series-list">${siblings.map(n => `<a class="series-item" href="#note/${n.id}"${n === note ? ' aria-current="true"' : ''}>${cover(n)}<div><span>${escapeHTML(seriesPart(n))}</span><strong>${escapeHTML(n.title)}</strong></div></a>`).join('')}</div>` : '';
  // Only list sources the body doesn't already link to.
  const inBody = new Set([...$('#reader-content').querySelectorAll('a[href^="http"]')].map(a => a.href.replace(/\/$/, '')));
  const extra = note.links.filter(link => !inBody.has(new URL(link.url).href.replace(/\/$/, '')));
  $('#reader-sources').innerHTML = extra.length ? `<h2>출처</h2>${note.sourceNote ? `<p>${escapeHTML(note.sourceNote)}</p>` : ''}${extra.map(link => external(link.url, link.label)).join('')}` : '';
  if (!$('#reader').open) $('#reader').showModal();
  document.body.classList.add('reading');
  $('#reader').scrollTop = 0;
  $('#reader-title').focus({preventScroll: true});
  document.title = `${note.title} — 인사이트 서재`;
}
function route() {
  if (location.hash.startsWith('#note/')) openNote(decodeURIComponent(location.hash.slice(6)));
  else if ($('#reader').open) $('#reader').close();
}
function goHome(view = 'all', category = '전체') {
  if ($('#reader').open) $('#reader').close();
  state = {...state, view, category, query: ''};
  $('#search').value = '';
  render();
}
document.addEventListener('click', event => {
  const save = event.target.closest('[data-save]');
  if (save) { event.preventDefault(); toggleSave(save.dataset.save); const scope = $('#reader').open ? $('#reader-actions') : $('#cards'); scope.querySelector(`[data-save="${save.dataset.save}"]`)?.focus(); return; }
  const view = event.target.closest('[data-view]');
  if (view) { goHome(view.dataset.view); if (view.dataset.view === 'companies' || view.dataset.view === 'mypage') window.scrollTo({top: 0}); else if (view.dataset.view !== 'all') $('.collection').scrollIntoView({behavior: 'smooth', block: 'start'}); return; }
  const industry = event.target.closest('[data-industry]');
  if (industry) { industryFilter = industry.dataset.industry; renderCompanies(); return; }
  const category = event.target.closest('[data-category]');
  if (category) { const fromFooter = category.classList.contains('footer-link'); state.category = category.dataset.category; if (fromFooter) { state.view = 'all'; state.query = ''; $('#search').value = ''; } render(); if (fromFooter) $('.collection').scrollIntoView({behavior: 'smooth', block: 'start'}); return; }
  const section = event.target.closest('[data-section]');
  if (section) { event.preventDefault(); document.getElementById(section.dataset.section)?.scrollIntoView({behavior: 'smooth', block: 'start'}); return; }
  const noteLink = event.target.closest('a[href^="#note/"]');
  if (noteLink && location.hash === noteLink.getAttribute('href')) { event.preventDefault(); route(); return; }
  if (event.target.closest('.brand, .footer-mark')) { event.preventDefault(); goHome(); window.scrollTo({top: 0, behavior: 'smooth'}); }
});
$('#search').addEventListener('input', e => { state.query = e.target.value; render(); });
$('#nav-search').addEventListener('click', () => { window.scrollTo({top: 0, behavior: 'smooth'}); $('#search').focus({preventScroll: true}); });
$('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
$('#reset').addEventListener('click', () => { state.query = ''; state.category = '전체'; if (state.view === 'saved' && !saved.size) state.view = 'all'; $('#search').value = ''; render(); $('#search').focus(); });
$('#reader-close').addEventListener('click', () => $('#reader').close());
$('#reader').addEventListener('scroll', () => {
  const reader = $('#reader');
  $('.reader-bar').classList.toggle('scrolled', reader.scrollTop > 240);
  let current = null;
  reader.querySelectorAll('#reader-content h2').forEach(h => { if (h.getBoundingClientRect().top < 120) current = h.id; });
  reader.querySelectorAll('.toc a').forEach(a => a.classList.toggle('current', a.dataset.section === current));
}, {passive: true});
$('#reader').addEventListener('close', () => { document.body.classList.remove('reading'); currentNote = null; document.title = '인사이트 서재 — 장인우의 기록'; if (location.hash.startsWith('#note/')) history.replaceState(null, '', location.pathname + location.search); if (openingElement?.isConnected) openingElement.focus({preventScroll: true}); });
document.addEventListener('keydown', e => { if (e.key === '/' && !$('#reader').open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); } });
// ── 새 소식 추가: needs scripts/serve.py (same origin, or 127.0.0.1:8005 when opened elsewhere) ──
// Adding, AI drafts and editing run only on this computer (scripts/serve.py). The published site is read-only.
const isLocal = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (!isLocal) document.querySelectorAll('#nav-add, [data-view="mypage"]').forEach(el => el.remove());
const apiBases = location.protocol.startsWith('http') ? ['', 'http://127.0.0.1:8005'] : ['http://127.0.0.1:8005'];
let apiBase = null;
async function findApi() {
  if (!isLocal) return null;
  if (apiBase !== null) return apiBase;
  for (const base of apiBases) {
    try { const r = await fetch(`${base}/api/ping`, {cache: 'no-store'}); if (r.ok) return (apiBase = base); } catch (_) { /* try next */ }
  }
  return null;
}
function addStatus(message, error = false) { $('#add-status').textContent = message; $('#add-status').classList.toggle('error', error); }
async function addArticle(url, button) {
  const base = await findApi();
  if (base === null) return;
  if (button) { button.disabled = true; button.textContent = '추가 중…'; }
  addStatus('원문을 가져와 초안을 쓰는 중이에요… AI 초안을 켰다면 1~2분 걸려요.');
  try {
    const r = await fetch(`${base}/api/add`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url})});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || '추가하지 못했어요.');
    addStatus(data.drafted ? 'AI 초안까지 썼어요. 새 노트를 엽니다.' : data.draftError ? `추가했지만 AI 초안은 실패했어요: ${data.draftError}` : '추가했어요. 새 노트를 엽니다.');
    if (data.draftError) await new Promise(r => setTimeout(r, 2500));
    location.href = `${location.pathname}#note/${data.id}`;
    setTimeout(() => location.reload(), 300);
  } catch (err) {
    addStatus(err.message, true);
    if (button) { button.disabled = false; button.textContent = '추가'; }
  }
}
async function openAdd() {
  $('#add-dialog').showModal();
  addStatus('');
  const base = await findApi();
  if (base === null) {
    $('#add-form').hidden = true;
    $('#add-feeds').innerHTML = `<div class="add-help">새 소식 추가는 서재를 로컬 서버로 열었을 때 동작해요.<br>폴더의 <code>서재-열기.command</code> 를 더블클릭하거나, 터미널에서 <code>.venv/bin/python scripts/serve.py</code> 를 실행한 뒤 다시 눌러 주세요.</div>`;
    return;
  }
  $('#add-form').hidden = false;
  $('#add-source').hidden = true; $('#add-feeds').innerHTML = ''; $('#add-more').hidden = true;
  try {
    const {sources: list, routine} = await api('/api/sources');
    addSources = list;
    const groups = [...new Set(list.map(s => s.group || '기타'))];
    $('#add-platforms').classList.remove('picked');
    $('#add-platforms').innerHTML = groups.map(g => `<div class="add-group"><h3>${escapeHTML(g)}</h3><div class="filters">${list.filter(s => (s.group || '기타') === g).map(s => `<button class="filter" data-source="${escapeHTML(s.id)}" aria-pressed="false">${escapeHTML(s.name)}${s.type === 'link' ? ' ↗' : ''}</button>`).join('')}</div></div>`).join('')
      + (routine ? `<div class="routine"><h3>${escapeHTML(routine.title)}</h3><table>${routine.rows.map(r => `<tr><td>${escapeHTML(r.when)}</td><td>${escapeHTML(r.where)}</td><td>${escapeHTML(r.result)}</td></tr>`).join('')}</table><p>${escapeHTML(routine.question)}</p></div>` : '');
  } catch (err) { $('#add-feeds').innerHTML = `<p class="feed-empty">${escapeHTML(err.message)}</p>`; }
}
let addSources = [];
let feedState = null;
const PAGE_SIZE = 15;
function feedItemHTML(i) {
  return `<div class="feed-item"><div class="feed-thumb"${i.image ? ` style="background-image:url('${safeURL(i.image)}')"` : ''}></div><div><div class="meta">${i.date ? `<time>${escapeHTML(i.date.replaceAll('-', '.'))}</time>` : ''}${i.category ? `${i.date ? '<span class="dot"></span>' : ''}<span>${escapeHTML(i.category)}</span>` : ''}</div><strong>${external(i.url, i.title)}</strong></div><button class="pill dark" data-add-url="${escapeHTML(i.url)}">추가</button></div>`;
}
function renderFeed() {
  if (!feedState) return;
  const q = $('#add-search').value.normalize('NFC').toLocaleLowerCase().trim();
  const matched = feedState.items.filter(i => !q || `${i.title} ${i.summary || ''}`.normalize('NFC').toLocaleLowerCase().includes(q));
  const shown = matched.slice(0, feedState.visible);
  $('#add-feeds').innerHTML = feedState.error ? `<p class="feed-empty">불러오지 못했어요: ${escapeHTML(feedState.error)}</p>`
    : shown.length ? shown.map(feedItemHTML).join('')
    : `<p class="feed-empty">${q ? '검색 결과가 없어요. 더보기로 이전 글을 더 불러와 보세요.' : '새 글이 없어요. 모두 서재에 있습니다.'}</p>`;
  const more = matched.length > shown.length || feedState.hasMore;
  $('#add-more').hidden = !more || Boolean(feedState.error);
  $('#add-more').textContent = matched.length > shown.length ? `더보기 (${matched.length - shown.length})` : '이전 글 더 불러오기';
}
async function fetchPage(id, page) {
  const {sources: [s]} = await api(`/api/feeds?source=${encodeURIComponent(id)}&page=${page}`);
  return s;
}
async function loadSource(id) {
  const source = addSources.find(s => s.id === id);
  document.querySelectorAll('[data-source]').forEach(b => { b.classList.toggle('active', b.dataset.source === id); b.setAttribute('aria-pressed', b.dataset.source === id); });
  $('#add-source').hidden = false;
  $('#add-source-desc').innerHTML = `${escapeHTML(source.desc || '')} ${external(source.home, '사이트 열기')}`;
  $('#add-search').value = '';
  $('#add-search').closest('label').hidden = source.type === 'link';
  $('#add-more').hidden = true;
  if (source.type === 'link') {
    feedState = null;
    $('#add-feeds').innerHTML = '<p class="feed-empty">이 사이트는 새 글 목록을 불러올 수 없어요. 사이트에서 읽고, 추가할 글 주소를 위 입력칸에 붙여넣으세요.</p>';
    return;
  }
  const request = Symbol(id);
  feedState = {id, request, items: [], page: 0, hasMore: false, visible: PAGE_SIZE, error: ''};
  $('#add-feeds').innerHTML = `<p class="feed-empty">아직 서재에 없는 글을 찾는 중이에요…${source.type === 'skax' ? ' (SK AX 는 30초 정도 걸려요)' : ''}</p>`;
  try {
    const s = await fetchPage(id, 1);
    if (feedState?.request !== request) return;
    Object.assign(feedState, {items: s.items, page: 1, hasMore: s.hasMore, error: s.error});
  } catch (err) { if (feedState?.request === request) feedState.error = err.message; }
  if (feedState?.request === request) renderFeed();
}
$('#add-more').addEventListener('click', async () => {
  if (!feedState) return;
  const q = $('#add-search').value.trim();
  const matchedCount = feedState.items.filter(i => !q || `${i.title} ${i.summary || ''}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())).length;
  if (matchedCount > feedState.visible) { feedState.visible += PAGE_SIZE; renderFeed(); return; }
  if (!feedState.hasMore) return;
  const state = feedState;
  $('#add-more').disabled = true; $('#add-more').textContent = '불러오는 중…';
  try {
    const s = await fetchPage(state.id, state.page + 1);
    if (feedState !== state) return;
    const seen = new Set(state.items.map(i => i.url));
    const fresh = s.items.filter(i => !seen.has(i.url));
    state.items.push(...fresh);
    state.page += 1;
    state.hasMore = s.hasMore && fresh.length > 0;
    state.visible += PAGE_SIZE;
  } catch (err) { toast(err.message); }
  $('#add-more').disabled = false;
  renderFeed();
});
$('#add-search').addEventListener('input', () => { if (feedState) { feedState.visible = PAGE_SIZE; renderFeed(); } });
$('#nav-add')?.addEventListener('click', openAdd);
$('#add-close').addEventListener('click', () => $('#add-dialog').close());
$('#add-form').addEventListener('submit', e => { e.preventDefault(); addArticle($('#add-url').value, e.submitter); });
$('#add-platforms').addEventListener('click', e => { const b = e.target.closest('[data-source]'); if (b) loadSource(b.dataset.source); });
$('#add-feeds').addEventListener('click', e => { const b = e.target.closest('[data-add-url]'); if (b) addArticle(b.dataset.addUrl, b); });

// ── 편집 · AI 다시 쓰기 (로컬 서버가 켜져 있을 때만 보인다) ──
async function renderReaderTools(note) {
  if (note.isCompany || (await findApi()) === null || currentNote !== note) return;
  const hasSource = /^> 출처: \[[^\]]*\]\(https?:/m.test(note.text);
  $('#reader-tools').innerHTML = `<button class="tool" data-tool="edit">편집</button>${hasSource ? '<button class="tool" data-tool="redraft">AI로 다시 쓰기</button>' : ''}`;
}
async function api(path, payload) {
  const base = await findApi();
  if (base === null) throw new Error('로컬 서버가 꺼져 있어요. 서재-열기.command 로 열어 주세요.');
  const r = payload === undefined ? await fetch(`${base}${path}`, {cache: 'no-store'}) : await fetch(`${base}${path}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || '요청이 실패했어요.');
  return data;
}
const reloadTo = id => { location.href = `${location.pathname}#note/${id}`; setTimeout(() => location.reload(), 200); };
document.addEventListener('click', async event => {
  const tool = event.target.closest('[data-tool]');
  if (!tool || !currentNote) return;
  const note = currentNote;
  if (tool.dataset.tool === 'edit') {
    try { await openEditor(note); } catch (err) { toast(err.message); }
  }
  if (tool.dataset.tool === 'redraft') {
    if (!confirm('원문을 다시 읽어 제목과 본문을 AI 초안으로 새로 씁니다. 직접 고친 내용은 덮어씁니다. 계속할까요?')) return;
    tool.disabled = true; tool.textContent = 'AI가 쓰는 중… (1~2분)';
    try { await api('/api/draft', {id: note.id}); reloadTo(note.id); }
    catch (err) { toast(err.message); tool.disabled = false; tool.textContent = 'AI로 다시 쓰기'; }
  }
});
$('#edit-close').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-cancel').addEventListener('click', () => $('#edit-dialog').close());
$('#edit-save').addEventListener('click', async () => {
  const id = $('#edit-dialog').dataset.id;
  $('#edit-status').textContent = '저장하는 중…';
  try { await api('/api/save', {id, markdown: editorMarkdown()}); reloadTo(id); }
  catch (err) { $('#edit-status').textContent = err.message; }
});

// ── 섹션 편집기: 제목 + (부제목, 내용) 섹션. 저장할 때 Markdown 으로 되돌린다 ──
let editorPreamble = '';
async function openEditor(note) {
  const {markdown} = await api(`/api/note?id=${encodeURIComponent(note.id)}`);
  const lines = markdown.split('\n');
  const titleIndex = lines.findIndex(l => l.startsWith('# '));
  const firstSection = lines.findIndex(l => l.startsWith('## '));
  $('#edit-heading').value = titleIndex >= 0 ? lines[titleIndex].slice(2).trim() : note.fullTitle;
  // Header lines (정리일·출처·발행일) and anything before the first section stay as they are.
  editorPreamble = lines.slice(titleIndex + 1, firstSection < 0 ? lines.length : firstSection).join('\n').trim();
  const html = document.createElement('template');
  html.innerHTML = note.html;
  const sections = [];
  let current = null;
  for (const node of [...html.content.childNodes]) {
    if (node.nodeName === 'H2') { current = {title: node.textContent.trim(), nodes: []}; sections.push(current); }
    else if (current) current.nodes.push(node);
  }
  $('#edit-sections').replaceChildren(...sections.map(s => sectionEditor(s.title, s.nodes)));
  $('#edit-status').textContent = '';
  $('#edit-dialog').dataset.id = note.id;
  $('#edit-dialog').showModal();
}
function sectionEditor(title = '', nodes = []) {
  const box = document.createElement('section');
  box.className = 'edit-section';
  box.innerHTML = `<div class="edit-section-head"><input class="edit-section-title" type="text" placeholder="부제목" aria-label="부제목"><button type="button" data-move="-1" title="위로">↑</button><button type="button" data-move="1" title="아래로">↓</button><button type="button" data-remove-section title="섹션 삭제">삭제</button></div><div class="edit-content" contenteditable="true" aria-label="세부 내용"></div>`;
  box.querySelector('.edit-section-title').value = title;
  const content = box.querySelector('.edit-content');
  nodes.forEach(n => content.append(n.cloneNode(true)));
  if (!content.textContent.trim()) content.innerHTML = '<p><br></p>';
  return box;
}
$('#edit-add-section').addEventListener('click', () => { const s = sectionEditor(); $('#edit-sections').append(s); s.querySelector('input').focus(); });
$('#edit-sections').addEventListener('click', e => {
  const box = e.target.closest('.edit-section');
  if (!box) return;
  if (e.target.closest('[data-remove-section]') && confirm('이 섹션을 삭제할까요?')) box.remove();
  const move = e.target.closest('[data-move]');
  if (move) {
    const sibling = move.dataset.move === '-1' ? box.previousElementSibling : box.nextElementSibling;
    if (sibling) move.dataset.move === '-1' ? sibling.before(box) : sibling.after(box);
  }
});
// Toolbar acts on the current selection inside a section's content.
document.querySelector('.edit-toolbar').addEventListener('mousedown', e => e.preventDefault());
document.querySelector('.edit-toolbar').addEventListener('click', e => {
  const button = e.target.closest('[data-cmd]');
  if (!button) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.anchorNode?.parentElement?.closest('.edit-content')) { toast('편집할 내용을 먼저 선택하세요.'); return; }
  const cmd = button.dataset.cmd;
  if (cmd === 'bold' && !document.queryCommandState('bold')) document.execCommand('bold');
  if (cmd === 'thin' && document.queryCommandState('bold')) document.execCommand('bold');
  if (cmd === 'bullet') document.execCommand('insertUnorderedList');
  if (cmd === 'mark' || cmd === 'unmark') {
    const range = sel.getRangeAt(0);
    if (cmd === 'mark' && !range.collapsed) {
      const mark = document.createElement('mark');
      mark.append(range.extractContents());
      mark.querySelectorAll('mark').forEach(m => m.replaceWith(...m.childNodes));
      range.insertNode(mark);
    } else {
      const within = sel.anchorNode.parentElement.closest('mark');
      const marks = new Set([within, ...[...document.querySelectorAll('.edit-content mark')].filter(m => range.intersectsNode(m))].filter(Boolean));
      marks.forEach(m => m.replaceWith(...m.childNodes));
    }
  }
});
function inlineMarkdown(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.textContent.replace(/\s+/g, ' '); continue; }
    if (n.nodeType !== 1) continue;
    const inner = inlineMarkdown(n);
    const tag = n.nodeName;
    const bg = n.style?.backgroundColor;
    if (tag === 'STRONG' || tag === 'B' || (tag === 'SPAN' && /bold|[6-9]00/.test(n.style?.fontWeight || ''))) out += inner.trim() ? `**${inner.trim()}**` : inner;
    else if (tag === 'MARK' || (tag === 'SPAN' && bg && !/transparent|rgba\(0, 0, 0, 0\)/.test(bg))) out += inner.trim() ? `<mark>${inner.trim()}</mark>` : inner;
    else if (tag === 'EM' || tag === 'I') out += inner.trim() ? `*${inner.trim()}*` : inner;
    else if (tag === 'CODE') out += '`' + n.textContent + '`';
    else if (tag === 'A') out += `[${inner}](${n.getAttribute('href') || ''})`;
    else if (tag === 'BR') out += '\n';
    else if (tag === 'IMG') out += `![${n.getAttribute('alt') || ''}](${n.getAttribute('src') || ''})`;
    else out += inner;
  }
  return out;
}
function blockMarkdown(root) {
  const blocks = [];
  // Python-Markdown needs 4-space indentation for anything nested inside a list item.
  const list = (el, depth) => {
    const ordered = el.nodeName === 'OL';
    const pad = '    '.repeat(depth);
    [...el.children].forEach((li, i) => {
      let first = true;
      const line = text => {
        const clean = text.trim().replace(/\s*\n\s*/g, '<br>');
        if (!clean) return;
        if (first) { blocks.push(`${pad}${ordered ? `${i + 1}.` : '-'} ${clean}`); first = false; }
        else blocks.push('', `${pad}    ${clean}`);
      };
      let inline = document.createElement('span');
      const flush = () => { line(inlineMarkdown(inline)); inline = document.createElement('span'); };
      for (const child of [...li.childNodes]) {
        const tag = child.nodeName;
        if (tag === 'UL' || tag === 'OL') { flush(); if (first) { blocks.push(`${pad}${ordered ? `${i + 1}.` : '-'}`); first = false; } list(child, depth + 1); }
        else if (tag === 'BLOCKQUOTE') { flush(); blocks.push(...blockMarkdown(child).split('\n').map(l => `${pad}    > ${l}`.trimEnd())); }
        else if (tag === 'P') { flush(); line(inlineMarkdown(child)); }
        else inline.append(child.cloneNode(true));
      }
      flush();
    });
  };
  const cells = row => '| ' + [...row.children].map(c => inlineMarkdown(c).trim().replace(/\s*\n\s*/g, '<br>').replace(/\|/g, '\\|')).join(' | ') + ' |';
  for (const n of root.childNodes) {
    if (n.nodeType === 3) { if (n.textContent.trim()) blocks.push(n.textContent.trim()); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.nodeName;
    if (tag === 'UL' || tag === 'OL') { list(n, 0); blocks.push(''); }
    else if (/^H[3-6]$/.test(tag)) blocks.push('#'.repeat(+tag[1]) + ' ' + inlineMarkdown(n).trim(), '');
    else if (tag === 'BLOCKQUOTE') blocks.push(blockMarkdown(n).split('\n').map(l => l ? `> ${l}` : '>').join('\n'), '');
    else if (tag === 'HR') blocks.push('---', '');
    else if (tag === 'PRE') blocks.push('```\n' + n.textContent.replace(/\n$/, '') + '\n```', '');
    else if (tag === 'TABLE' || n.classList?.contains('table-scroll')) {
      const table = tag === 'TABLE' ? n : n.querySelector('table');
      const rows = [...table.querySelectorAll('tr')];
      if (rows.length) { blocks.push(cells(rows[0]), '|' + [...rows[0].children].map(() => '---').join('|') + '|', ...rows.slice(1).map(cells), ''); }
    }
    else if (tag === 'DIV' && n.querySelector('p, ul, ol, table')) blocks.push(blockMarkdown(n), '');
    else { const text = inlineMarkdown(n).split('\n').map(l => l.trim()).join('\n').trim(); if (text) blocks.push(text, ''); }
  }
  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function editorMarkdown() {
  const parts = [`# ${$('#edit-heading').value.trim()}`, '', editorPreamble, ''];
  for (const box of document.querySelectorAll('#edit-sections .edit-section')) {
    const title = box.querySelector('.edit-section-title').value.trim();
    const body = blockMarkdown(box.querySelector('.edit-content'));
    if (!title && !body) continue;
    parts.push(`## ${title || '제목 없음'}`, '', body, '');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── 마이페이지: AI 초안 엔진 ──
async function renderMyPage() {
  const status = (m, error = false) => { $('#engine-status').textContent = m; $('#engine-status').classList.toggle('error', error); };
  let data;
  try { data = await api('/api/settings'); }
  catch (err) { $('#engine-options').innerHTML = ''; status(err.message, true); return; }
  const {settings: conf, engines: found} = data;
  const option = (value, name, info) => `<label class="engine-option"><input type="radio" name="engine" value="${value}"${conf.engine === value ? ' checked' : ''}${info && !info.path ? ' disabled' : ''}><strong>${name}</strong><small>${info ? (info.path ? escapeHTML(info.version || info.path) : '설치되지 않음') : '추가만 하고 초안은 직접 씀'}</small></label>`;
  $('#engine-options').innerHTML = option('claude', 'Claude Code', found.claude) + option('codex', 'Codex CLI', found.codex) + option('none', '사용 안 함');
  $('#engine-model').value = conf.model || '';
  renderSources();
  status(conf.engine === 'none' ? 'AI 초안이 꺼져 있어요.' : `현재: ${conf.engine === 'claude' ? 'Claude Code' : 'Codex CLI'}${conf.model ? ` · ${conf.model}` : ''}`);
}
async function renderSources() {
  try {
    const {sources: list} = await api('/api/sources');
    $('#source-list').innerHTML = list.map(s => `<li><span>${escapeHTML(s.name)}<small>${escapeHTML(s.feed || s.home)}</small></span><button data-remove-source="${escapeHTML(s.id)}">삭제</button></li>`).join('');
  } catch (err) { $('#source-status').textContent = err.message; }
}
$('#source-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-remove-source]');
  if (!b || !confirm('이 플랫폼을 목록에서 뺄까요? 이미 추가한 노트는 그대로 남아요.')) return;
  try { await api('/api/sources', {action: 'remove', id: b.dataset.removeSource}); renderSources(); } catch (err) { $('#source-status').textContent = err.message; }
});
$('#source-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#source-status').textContent = '피드를 확인하는 중…';
  try {
    await api('/api/sources', {feed: $('#source-feed').value, name: $('#source-name').value, category_label: $('#source-category').value, industry: $('#source-industry').value});
    e.target.reset(); $('#source-status').textContent = '추가했어요. + 버튼에서 고를 수 있어요.'; renderSources();
  } catch (err) { $('#source-status').textContent = err.message; }
});
const chosenEngine = () => ({engine: document.querySelector('input[name=engine]:checked')?.value || 'none', model: $('#engine-model').value.trim()});
$('#engine-save').addEventListener('click', async () => {
  try { await api('/api/settings', chosenEngine()); toast('저장했어요.'); renderMyPage(); }
  catch (err) { $('#engine-status').textContent = err.message; }
});
$('#engine-test').addEventListener('click', async () => {
  const conf = chosenEngine();
  if (conf.engine === 'none') { $('#engine-status').textContent = '엔진을 먼저 고르세요.'; return; }
  $('#engine-status').classList.remove('error'); $('#engine-status').textContent = '연결 확인 중…';
  try { const {reply} = await api('/api/test-engine', conf); $('#engine-status').textContent = `연결됨 — 응답: ${reply}`; }
  catch (err) { $('#engine-status').classList.add('error'); $('#engine-status').textContent = `연결 실패 — ${err.message}`; }
});

window.addEventListener('hashchange', route);
render();
route();
