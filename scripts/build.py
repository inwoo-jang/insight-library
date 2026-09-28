"""Build the offline archive from the Markdown notes in the workspace root."""
import hashlib
import json
import sys
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

try:
    import markdown
except ImportError:
    raise SystemExit('Markdown이 필요합니다. python3 -m pip install -r requirements.txt')

ROOT = Path(__file__).resolve().parent.parent
catalog = json.loads((ROOT / 'web/catalog.json').read_text())
# Entries for notes kept off the public repo (see .gitignore) live in catalog.local.json.
local_catalog = ROOT / 'web/catalog.local.json'
PUBLIC = '--public' in sys.argv
LOCAL_ONLY = set(json.loads(local_catalog.read_text())) if local_catalog.exists() else set()
if local_catalog.exists() and not PUBLIC:
    catalog |= json.loads(local_catalog.read_text())
OUTPUT = Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else ROOT / 'index.html'


def extract_links(raw):
    links = []
    # Images are not article sources. Collect titled links first, then bare URLs.
    without_images = re.sub(r'!\[[^\]]*\]\([^\n]+?\)', '', raw)
    candidates = re.findall(r'\[([^\]]+)\]\((https?://[^\s)]+)\)', without_images)
    for url in re.findall(r'https?://[^\s<>\)\]]+', without_images):
        if url not in [item[1] for item in candidates]:
            candidates.append((unquote(urlsplit(url).path.split('/')[-1]) or urlsplit(url).netloc, url))
    for label, url in candidates:
        if url not in [item['url'] for item in links]:
            links.append({'label': label, 'url': url, 'domain': urlsplit(url).netloc})
    return links


def render(raw):
    # Hard line breaks inside blockquotes keep the "> key: value" header readable.
    content = markdown.markdown(raw, extensions=['tables', 'fenced_code', 'sane_lists', 'toc', 'nl2br'])
    # The reader supplies its own title.
    return re.sub(r'<h1[^>]*>.*?</h1>', '', content, count=1, flags=re.S)


def field(raw, name):
    match = re.search(rf'^>\s*{name}:\s*(.+)$', raw, re.M)
    return match[1].strip() if match else ''


HEADER_FIELDS = ('정리일', '기준일', '산업', '출처', '발행일', '태그', '묶음', '상태', '원문 언어', '성격', '함께 읽은 글', '함께 본 자료')


def strip_header(raw):
    """Drop date/source lines from the leading '>' block; the reader shows them in its meta line.

    Remaining lines (caveats such as 정리 범위) stay as a short note."""
    lines = raw.split('\n')
    start = next((i for i, l in enumerate(lines) if l.startswith('>')), None)
    if start is None or start > 3:
        return raw
    end = start
    while end < len(lines) and lines[end].startswith('>'):
        end += 1
    kept = [l for l in lines[start:end] if l.strip('> ').strip() and not re.match(r'>\s*(' + '|'.join(HEADER_FIELDS) + r'):', l)]
    return '\n'.join(lines[:start] + kept + lines[end:])


notes = []
for path in sorted((ROOT / 'notes').glob('*.md')):
    if PUBLIC and path.name in LOCAL_ONLY:
        continue
    raw = path.read_text()
    meta = catalog.get(path.name, {})
    title = re.search(r'^# (.+)', raw, re.M)
    date = re.search(r'정리일:\s*(\d{4}-\d{2}-\d{2})', raw)
    links = extract_links(raw)
    content = render(strip_header(raw))
    published = re.search(r'발행일:\s*(\d{4}-\d{2}-\d{2})', raw)
    pdf = re.search(r'\]\((?:\./)?([^)/]+\.pdf)\)', raw)
    notes.append({
        'id': meta.get('id', 'note-' + hashlib.sha256(path.name.encode()).hexdigest()[:12]),
        'title': meta.get('title', title[1] if title else path.stem),
        'fullTitle': title[1] if title else path.stem,
        'summary': meta.get('summary', '새로 추가한 인사이트입니다. 본문을 열어 읽어보세요.'),
        'category': meta.get('category', '기타'),
        'source': meta.get('source', '개인 메모'),
        'sourceNote': meta.get('sourceNote', ''),
        'date': date[1] if date else '',
        'tags': meta.get('tags', []),
        'featured': meta.get('featured', False),
        'series': meta.get('series', ''),
        'seriesOrder': meta.get('seriesOrder', 0),
        'cover': meta.get('cover', ''),
        'coverWord': meta.get('coverWord', ''),
        'industry': meta.get('industry', ''),
        'published': published[1] if published else '',
        'type': meta.get('type', ''),
        'pdf': quote('notes/' + pdf[1]) if pdf and (ROOT / 'notes' / pdf[1]).exists() else '',
        'file': path.name,
        'fileUrl': quote('notes/' + path.name),
        'minutes': max(1, round(len(raw) / 650)),
        'links': links, 'html': content, 'text': raw,
    })
notes.sort(key=lambda note: note['seriesOrder'])
notes.sort(key=lambda note: note['date'], reverse=True)
attachments = [{'name': p.name, 'url': quote('notes/' + p.name), 'size': f'{p.stat().st_size / 1024 / 1024:.1f} MB'} for p in sorted((ROOT / 'notes').glob('*.pdf'))]
# Company research lives in companies/. Files starting with "_" are the comparison page and the template.
companies = []
for path in sorted((ROOT / 'companies').glob('[!_]*.md')):
    raw = path.read_text()
    title = re.search(r'^# (.+)', raw, re.M)[1]
    summary = re.search(r'\*\*한 줄 요약:\*\*\s*(.+?)\s*$', raw, re.M)
    companies.append({
        'id': 'company-' + path.stem,
        'name': title.split(' — ')[0],
        'title': title,
        'industry': field(raw, '산업'),
        'date': field(raw, '정리일'),
        'asOf': field(raw, '기준일'),
        'summary': summary[1] if summary else '',
        'file': 'companies/' + path.name,
        'fileUrl': quote('companies/' + path.name),
        'minutes': max(1, round(len(raw) / 650)),
        # The header lines show up in the reader's meta line instead.
        'links': extract_links(raw), 'html': render(re.sub(r'^\*\*한 줄 요약:\*\*.*\n(근거:.*\n)?', '', strip_header(raw), flags=re.M)), 'text': raw,
    })
data = json.dumps({'notes': notes, 'attachments': attachments, 'companies': companies}, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
template = (ROOT / 'web/template.html').read_text()
page = template.replace('<!-- ARCHIVE_DATA -->', '<script id="archive-data" type="application/json">' + data + '</script>')
OUTPUT.write_text(page)
print(f'index.html 생성 완료: 인사이트 {len(notes)}편, 기업 {len(companies)}곳, 참고 PDF {len(attachments)}개')
