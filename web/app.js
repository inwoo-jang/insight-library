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
    } else if (/\.pdf$/i.test(href)) { a.href = href.replace(/^\.\//, ''); a.target = '_blank'; }
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
// ── 새 소식 추가: needs scripts/serve.py (same origin, or 127.0.0.1:8000 when opened elsewhere) ──
// Adding, AI drafts and editing run only on this computer (scripts/serve.py). The published site is read-only.
const isLocal = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (!isLocal) document.querySelectorAll('#nav-add, [data-view="mypage"]').forEach(el => el.remove());
const apiBases = location.protocol.startsWith('http') ? ['', 'http://127.0.0.1:8000'] : ['http://127.0.0.1:8000'];
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
  try {
    const {sources: list} = await api('/api/sources');
    let chosen = null;
    try { chosen = localStorage.getItem('insight-add-source'); } catch (_) { /* optional */ }
    if (!list.some(s => s.id === chosen)) chosen = list[0]?.id;
    $('#add-platforms').innerHTML = list.map(s => `<button class="filter" data-source="${escapeHTML(s.id)}">${escapeHTML(s.name)}</button>`).join('');
    $('#add-feeds').innerHTML = '';
    if (chosen) loadSource(chosen);
  } catch (err) { $('#add-feeds').innerHTML = `<p class="feed-empty">${escapeHTML(err.message)}</p>`; }
}
let feedRequest = 0;
async function loadSource(id) {
  try { localStorage.setItem('insight-add-source', id); } catch (_) { /* optional */ }
  document.querySelectorAll('[data-source]').forEach(b => { b.classList.toggle('active', b.dataset.source === id); b.setAttribute('aria-pressed', b.dataset.source === id); });
  const request = ++feedRequest;
  $('#add-feeds').innerHTML = `<p class="feed-empty">아직 서재에 없는 글을 찾는 중이에요…${id === 'skax' ? ' (SK AX 는 30초 정도 걸려요)' : ''}</p>`;
  try {
    const {sources: [s]} = await api(`/api/feeds?source=${encodeURIComponent(id)}`);
    if (request !== feedRequest) return;
    $('#add-feeds').innerHTML = `<section class="feed"><div class="feed-head"><h3>${escapeHTML(s.name)}</h3>${external(s.home, '사이트')}</div>${s.error ? `<p class="feed-empty">불러오지 못했어요: ${escapeHTML(s.error)}</p>` : s.items.length ? s.items.map(i => `<div class="feed-item"><div class="feed-thumb"${i.image ? ` style="background-image:url('${safeURL(i.image)}')"` : ''}></div><div><div class="meta"><time>${escapeHTML(i.date.replaceAll('-', '.'))}</time>${i.category ? `<span class="dot"></span><span>${escapeHTML(i.category)}</span>` : ''}</div><strong>${external(i.url, i.title)}</strong></div><button class="pill dark" data-add-url="${escapeHTML(i.url)}">추가</button></div>`).join('') : '<p class="feed-empty">새 글이 없어요. 모두 서재에 있습니다.</p>'}</section>`;
  } catch (err) {
    if (request === feedRequest) $('#add-feeds').innerHTML = `<p class="feed-empty">목록을 불러오지 못했어요: ${escapeHTML(err.message)}</p>`;
  }
}
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
    try {
      const {markdown} = await api(`/api/note?id=${encodeURIComponent(note.id)}`);
      $('#edit-text').value = markdown; $('#edit-status').textContent = '';
      $('#edit-dialog').dataset.id = note.id; $('#edit-dialog').showModal(); $('#edit-text').focus();
    } catch (err) { toast(err.message); }
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
  try { await api('/api/save', {id, markdown: $('#edit-text').value}); reloadTo(id); }
  catch (err) { $('#edit-status').textContent = err.message; }
});

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
