"""Serve the library locally: add articles from tracked sources, draft notes with an AI CLI, edit notes.

Run with the project venv so the build step can import Markdown:
    .venv/bin/python scripts/serve.py        # http://127.0.0.1:8000

GET  /api/ping                    → {"ok": true}
GET  /api/feeds                   → new items per source that are not in the library yet
GET  /api/settings                → AI draft settings + which CLIs are installed
GET  /api/note?id=…               → Markdown source of a note (for the editor)
POST /api/add       {"url"}       → draft note + cover, catalog entry, rebuild
POST /api/draft     {"id"}        → rewrite a note's body from its source article with the AI CLI
POST /api/save      {"id","markdown"} → save an edited note, rebuild
POST /api/settings  {"engine","model"}
POST /api/test-engine {"engine","model"}
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from email.utils import parsedate_to_datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SOURCES_PATH = ROOT / 'web/sources.json'


def sources():
    return json.loads(SOURCES_PATH.read_text())


CATALOG_PATH = ROOT / 'web/catalog.json'
SETTINGS_PATH = ROOT / 'web/settings.json'
CATEGORIES = ('에이전트·개발', '클라우드·인프라', '산업·AX', '조직·거버넌스')
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'}


def fetch(url, timeout=15):
    request = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def text(value):
    return html.unescape(re.sub(r'<[^>]+>', '', value or '')).strip()


def meta(page, prop):
    match = re.search(rf'<meta[^>]+(?:property|name)="{prop}"[^>]+content="([^"]*)"', page)
    return html.unescape(match[1]).strip() if match else ''


def known_urls():
    """Every http link already written in a note, normalised without a trailing slash."""
    urls = set()
    for path in ROOT.glob('*.md'):
        for url in re.findall(r'https?://[^\s)\]>"]+', path.read_text()):
            urls.add(unquote(url).rstrip('/'))
    return urls


def load_catalog():
    return json.loads(CATALOG_PATH.read_text())


def save_catalog(catalog):
    # One entry per line keeps the file easy to diff and hand-edit.
    CATALOG_PATH.write_text('{\n' + ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in catalog.items()) + '\n}\n')


def rebuild():
    subprocess.run([sys.executable, str(ROOT / 'scripts/build.py')], check=True, capture_output=True)


def clean_title(title):
    """Drop site tags such as '[리포트 다운로드]', '| 9월 MI리포트', ' - SK AX'."""
    title = re.sub(r'\s+[-|｜]\s*SK AX\s*$', '', title or '')
    title = re.sub(r'^(\s*\[[^\]]{1,20}\]\s*)+', '', title)
    title = re.sub(r'\s*[|｜]\s*[^|｜]*(리포트|뉴스레터|웨비나|월호)\s*$', '', title)
    return title.strip().strip('"“”').strip()


def tidy_summary(value):
    """KT posts put an author line and a 'SUMMARY' box before the body; keep only the summary sentences."""
    value = re.sub(r'\s+', ' ', value or '').strip()
    if 'SUMMARY' in value:
        value = value.split('SUMMARY', 1)[1]
        value = re.split(r'\s?#\w', value, maxsplit=1)[0]
    if len(value) > 220:
        cut = max(value.rfind('다.', 0, 220), value.rfind('. ', 0, 220))
        value = value[:cut + 2] if cut > 80 else value[:220] + '…'
    return value.strip()


def headings(fragment):
    found = [text(h) for h in re.findall(r'<h[2-4][^>]*>(.*?)</h[2-4]>', fragment, re.S)]
    return [h for h in dict.fromkeys(found) if 4 <= len(h) <= 120][:12]


def article_text(fragment):
    """Readable text of an article body, for the drafting model. Boilerplate is only trimmed roughly."""
    raw = re.sub(r'<(script|style|nav|header|footer|svg|noscript|form)[^>]*>.*?</\1>', ' ', fragment, flags=re.S | re.I)
    raw = re.sub(r'<h([1-6])[^>]*>', lambda m: '\n' + '#' * int(m[1]) + ' ', raw)
    raw = re.sub(r'<li[^>]*>', '\n- ', raw)
    raw = re.sub(r'<(br|/p|/div|/h[1-6]|/li|/tr|/table)[^>]*>', '\n', raw, flags=re.I)
    lines = [re.sub(r'[ \t\xa0]+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', line))).strip() for line in raw.split('\n')]
    return '\n'.join(line for line in lines if len(line) > 1)[:30000]


# ── sources ──────────────────────────────────────────────────────────────

def skax_article(url):
    page = fetch(url).decode('utf-8', 'replace')
    title = re.search(r'<title>(.*?)</title>', page, re.S)
    body = page.split('</head>', 1)[-1]
    published = re.search(r'>\s*(20\d\d)\.(\d\d)\.(\d\d)\s*<', body)
    return {
        'url': url,
        'title': clean_title(text(title[1])) if title else '',
        'date': '-'.join(published.groups()) if published else '',
        'summary': meta(page, 'og:description'),
        'image': meta(page, 'og:image'),
        'headings': headings(body),
        'html': body,
    }


def skax_items(source, known):
    """SK AX loads its list in the browser, so probe article numbers above the newest one we have."""
    ids = [int(m) for u in known for m in re.findall(r'skax\.co\.kr/insight/trend/(\d+)', u)]
    start = max(ids, default=source.get('startId', 3800))
    candidates = [f'https://www.skax.co.kr/insight/trend/{n}' for n in range(start + 1, start + source.get('probe', 60))]

    def probe(url):
        try:
            return skax_article(url)
        except Exception:
            return None
    with ThreadPoolExecutor(24) as pool:
        return [item for item in pool.map(probe, candidates) if item and item['title']]


ATOM = '{http://www.w3.org/2005/Atom}'


def rss_items(source):
    """Items from an RSS 2.0 or Atom feed."""
    root = ET.fromstring(fetch(source['feed']))
    items = []
    entries = [(e, False) for e in root.iter('item')] or [(e, True) for e in root.iter(f'{ATOM}entry')]
    for entry, atom in entries:
        get = (lambda tag: entry.findtext(f'{ATOM}{tag}') or '') if atom else (lambda tag: entry.findtext(tag) or '')
        if atom:
            link_el = next((l for l in entry.findall(f'{ATOM}link') if l.get('rel') in (None, 'alternate')), None)
            link = link_el.get('href') if link_el is not None else ''
            raw = get('content') or get('summary')
            category = ' / '.join(c.get('term', '') for c in entry.findall(f'{ATOM}category'))
            published = (get('published') or get('updated'))[:10]
        else:
            link = get('link')
            raw = entry.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or get('description')
            category = html.unescape(get('category').strip())
            stamp = get('pubDate')
            try:
                published = parsedate_to_datetime(stamp).date().isoformat() if stamp else ''
            except (TypeError, ValueError):
                published = stamp[:10]
        if source.get('category') and category != source['category']:
            continue
        image = re.search(r'<img[^>]+src="([^"]+)"', raw or '')
        items.append({
            'url': link.strip(),
            'title': clean_title(text(get('title'))),
            'date': published,
            'summary': tidy_summary(text(re.sub(r'<(style|script)[^>]*>.*?</\1>', '', raw or '', flags=re.S))),
            'image': html.unescape(image[1]) if image else '',
            'category': category,
            'headings': headings(raw or ''),
            'html': raw or '',
        })
    return items


def feeds(source_id=None):
    known = known_urls()
    result = []
    for source in sources():
        if source_id and source['id'] != source_id:
            continue
        try:
            items = skax_items(source, known) if source['type'] == 'skax' else rss_items(source)
            error = ''
        except Exception as exc:
            items, error = [], str(exc)
        fresh = [{k: v for k, v in i.items() if k != 'html'} for i in items if unquote(i['url']).rstrip('/') not in known]
        fresh.sort(key=lambda i: i['date'], reverse=True)
        result.append({'id': source['id'], 'name': source['name'], 'home': source['home'], 'items': fresh[:12], 'error': error})
    return result


def source_for(url):
    host = urlsplit(url).netloc
    return next((s for s in sources() if urlsplit(s['home']).netloc == host or urlsplit(s.get('feed', '')).netloc == host), None)


def article(url):
    source = source_for(url)
    if source and source['type'] == 'skax':
        return source, skax_article(url)
    if source:
        for item in rss_items(source | {'category': ''}):
            if item['url'].rstrip('/') == url.rstrip('/'):
                page = fetch(url).decode('utf-8', 'replace')
                item['image'] = meta(page, 'og:image') or item['image']
                return source, item
    # Any other page: Open Graph tags plus the page body.
    page = fetch(url).decode('utf-8', 'replace')
    title = meta(page, 'og:title') or text((re.search(r'<title>(.*?)</title>', page, re.S) or ['', ''])[1])
    body = page.split('</head>', 1)[-1]
    return source, {'url': url, 'title': clean_title(title), 'date': meta(page, 'article:published_time')[:10],
                    'summary': tidy_summary(meta(page, 'og:description')), 'image': meta(page, 'og:image'),
                    'headings': headings(body), 'html': body}


def add_source(body):
    feed = str(body.get('feed', '')).strip()
    if not re.match(r'https?://', feed):
        raise ValueError('RSS·Atom 주소를 http 로 시작하게 넣어 주세요.')
    try:
        root = ET.fromstring(fetch(feed))
    except Exception as exc:
        raise ValueError(f'피드를 읽지 못했습니다: {exc}')
    home = root.findtext('channel/link') or next((l.get('href') for l in root.findall(f'{ATOM}link') if l.get('rel') in (None, 'alternate')), '') or feed
    title = text(root.findtext('channel/title') or root.findtext(f'{ATOM}title') or '')
    name = str(body.get('name') or '').strip() or title or urlsplit(feed).netloc
    listed = sources()
    source_id = re.sub(r'[^a-z0-9]+', '-', urlsplit(home).netloc.lower()).strip('-') or f'src{len(listed)}'
    if any(s['id'] == source_id for s in listed):
        raise ValueError('이미 등록된 플랫폼입니다.')
    listed.append({'id': source_id, 'name': name, 'type': 'rss', 'home': home, 'feed': feed, 'category': '',
                   'filePrefix': re.sub(r'[^A-Za-z0-9가-힣]', '', name)[:12] or 'WEB',
                   'category_label': body.get('category_label') if body.get('category_label') in CATEGORIES else '에이전트·개발',
                   'industry': str(body.get('industry') or '').strip()})
    SOURCES_PATH.write_text(json.dumps(listed, ensure_ascii=False, indent=2) + '\n')
    return listed


def remove_source(source_id):
    listed = [s for s in sources() if s['id'] != source_id]
    SOURCES_PATH.write_text(json.dumps(listed, ensure_ascii=False, indent=2) + '\n')
    return listed


# ── AI drafting ──────────────────────────────────────────────────────────

def settings():
    try:
        return {'engine': 'none', 'model': ''} | json.loads(SETTINGS_PATH.read_text())
    except (OSError, ValueError):
        return {'engine': 'none', 'model': ''}


def engines():
    found = {}
    home = os.path.expanduser('~')
    for name in ('claude', 'codex'):
        path = shutil.which(name) or next((p for p in (f'{home}/.local/bin/{name}', f'/opt/homebrew/bin/{name}', f'/usr/local/bin/{name}') if os.path.exists(p)), '')
        version = ''
        if path:
            try:
                version = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=15).stdout.strip().splitlines()[0]
            except Exception:
                pass
        found[name] = {'path': path, 'version': version}
    return found


def run_engine(prompt, stdin_text, conf=None):
    conf = conf or settings()
    engine = conf.get('engine')
    if engine not in ('claude', 'codex'):
        raise RuntimeError('AI 초안 엔진이 꺼져 있습니다. 마이페이지에서 켜 주세요.')
    path = engines()[engine]['path']
    if not path:
        raise RuntimeError(f'{engine} CLI 를 찾지 못했습니다.')
    # Run outside the library so the CLI does not pick up project instructions.
    workdir = tempfile.mkdtemp(prefix='insight-draft-')
    try:
        if engine == 'claude':
            cmd = [path, '-p', prompt, '--output-format', 'text', '--tools', '']
            if conf.get('model'):
                cmd += ['--model', conf['model']]
            done = subprocess.run(cmd, input=stdin_text, capture_output=True, text=True, timeout=420, cwd=workdir)
            if done.returncode != 0 or not done.stdout.strip():
                lines = (done.stderr or done.stdout).strip().splitlines()
                raise RuntimeError(lines[-1] if lines else 'Claude 응답이 비었습니다.')
            return done.stdout.strip()
        out = Path(workdir) / 'out.md'
        cmd = [path, 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--color', 'never', '-o', str(out)]
        if conf.get('model'):
            cmd += ['-m', conf['model']]
        done = subprocess.run(cmd + ['-'], input=f'{prompt}\n\n{stdin_text}', capture_output=True, text=True, timeout=420, cwd=workdir)
        if not out.exists() or not out.read_text().strip():
            errors = [line for line in (done.stdout + done.stderr).splitlines() if 'error' in line.lower()]
            message = errors[-1] if errors else 'Codex 응답이 비었습니다.'
            detail = re.search(r'"message":"([^"]+)"', message)
            raise RuntimeError(detail[1] if detail else message[-300:])
        return out.read_text().strip()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


DRAFT_RULES = """너는 개인 인사이트 서재의 편집자다. 표준 입력으로 받은 원문을 읽고, 아래 템플릿 파일의 규칙대로 한국어 노트 초안을 쓴다.
서재 주인은 산업·기업의 AI 전환(AX) 흐름을 파악하려고 이 노트를 읽는다.

규칙
- 원문에 있는 사실만 쓴다. 원문에 없는 수치·성과·일정을 만들지 않는다. 원문에 없는 성과는 "(원문에 없음)".
- 발표·계획·시연·전망과 실제 운영 성과를 구분한다. 회사 홍보 문구는 '회사 설명'으로 귀속한다.
- 확인 과정(열지 못함, 대조함 등)은 쓰지 않는다. 사실만 쓴다.
- 한다/이다 체. 간결하게. 머리말·맺음말·코드블록 없이 아래 출력 형식만 낸다.
- 글의 성격에 맞는 유형(사례 | 정책·규제 | 기술·연구 | 전략·트렌드 | 동료 공유)을 하나 고르고, 그 유형의 '한 문장 인사이트' 문형을 원문 근거로 빈칸 없이 채운다. '작은 실험'·'검증해 볼 것'은 구체적인 제안으로 채운다.
- 제목에는 발행처 이름·리포트 회차(예: 'SK AX 9월 MI리포트')를 넣지 않는다. 내용의 핵심만 담는다.
- 한 문장 인사이트는 문형 그대로 1~2문장, 200자 이내로 쓴다. 빈칸에 채운 핵심 구절 2~4개를 **굵게** 감싼다. 수치를 나열하지 않는다(수치는 원문 요약·가운데 섹션에).
- 본문은 템플릿의 공통 뼈대 순서를 따른다: 한 문장 인사이트 → 원문 요약 → 유형별 가운데 섹션 → 읽고 얻은 관점 → 적용 질문 → 읽을 때 주의할 점.
- '(초안 …)' 같은 표시나 안내 문구를 넣지 않는다.

출력 형식
TITLE: <다듬은 제목>
CARD_TITLE: <카드용 짧은 제목, 25자 내외>
SUMMARY: <카드용 요약 1~2문장, 90자 내외>
CATEGORY: <에이전트·개발 | 클라우드·인프라 | 산업·AX | 조직·거버넌스 중 하나>
TYPE: <사례 | 정책·규제 | 기술·연구 | 전략·트렌드 | 동료 공유>
TAGS: <키워드 3개, 쉼표로>
---
## 한 문장 인사이트
...(이하 템플릿 순서대로 ## 섹션들)

=== 템플릿 파일 ===
"""


def draft_prompt():
    # Read on every draft so edits to rules.md / templates.md apply right away.
    return (DRAFT_RULES + (ROOT / 'web/templates.md').read_text()
            + '\n\n=== 편집 규칙 (web/rules.md) ===\n' + (ROOT / 'web/rules.md').read_text())


def ai_draft(item):
    source_text = article_text(item.get('html', ''))
    reply = run_engine(draft_prompt(), f"제목: {item.get('title', '')}\n발행일: {item.get('date', '')}\n출처: {item.get('url', '')}\n\n{source_text}")
    head, _, body = reply.partition('\n---\n')
    if not body.strip().startswith('##'):
        raise RuntimeError('AI 응답 형식이 예상과 달라 초안을 넣지 않았습니다.')
    fields = dict(re.findall(r'^([A-Z_]+):\s*(.+)$', head, re.M))
    return fields, body.strip()


def apply_fields(entry, fields):
    if fields.get('CARD_TITLE'):
        entry['title'] = fields['CARD_TITLE'].strip()
    if fields.get('SUMMARY'):
        entry['summary'] = fields['SUMMARY'].strip()
    if fields.get('TAGS'):
        entry['tags'] = [tag.strip() for tag in fields['TAGS'].split(',') if tag.strip()][:3]
    if fields.get('CATEGORY', '').strip() in CATEGORIES:
        entry['category'] = fields['CATEGORY'].strip()
    if fields.get('TYPE'):
        entry['type'] = fields['TYPE'].strip()





def skeleton(item):
    outline = ''.join(f'- {h}\n' for h in item.get('headings') or [])
    return ("## 한 문장 인사이트\n\n(유형별 문형을 채운다 — web/templates.md 참고)\n\n"
            f"## 원문 요약\n\n**원문 소개:** {item.get('summary') or '(원문 소개 문구 없음)'}\n\n"
            "(원문을 읽고 핵심을 3~5줄로 정리한다. 회사 발표·계획과 실제 적용을 구분한다.)\n\n"
            + (f'## 원문 목차\n\n{outline}\n' if outline else '')
            + "## 읽고 얻은 관점\n\n(내 생각을 적는다.)\n\n## 적용 질문\n\n(내 프로젝트에서 확인해 볼 질문을 적는다.)\n\n## 읽을 때 주의할 점\n\n(발표·계획과 실제 성과를 구분해 적는다.)")


# ── add / redraft / save ─────────────────────────────────────────────────

def slugify(title):
    slug = re.sub(r'[^0-9A-Za-z가-힣]+', '-', title).strip('-')
    return slug[:40].rstrip('-') or 'note'


def add(url):
    url = url.strip()
    if unquote(url).rstrip('/') in known_urls():
        raise ValueError('이미 서재에 있는 글입니다.')
    source, item = article(url)
    if not item.get('title'):
        raise ValueError('제목을 찾지 못했습니다. 주소를 확인해 주세요.')
    fields, body, draft_error = {}, '', ''
    if settings().get('engine') in ('claude', 'codex'):
        try:
            fields, body = ai_draft(item)
            item['title'] = clean_title(fields.get('TITLE') or item['title'])
        except Exception as exc:
            draft_error = str(exc)

    today = date.today()
    name = source['name'] if source else urlsplit(url).netloc
    prefix = source['filePrefix'] if source else 'WEB'
    filename = f"{today:%y%m%d}_{prefix}-{slugify(item['title'])}.md"
    note_id = f"{prefix.lower()}-{today:%y%m%d}-{abs(hash(url)) % 100000}"

    cover = ''
    if item.get('image'):
        try:
            data = fetch(item['image'])
            ext = '.png' if data[:4] == b'\x89PNG' else '.webp' if data[8:12] == b'WEBP' else '.jpg'
            cover_path = ROOT / 'web/covers' / f'{note_id}{ext}'
            cover_path.write_bytes(data)
            cover = f'web/covers/{cover_path.name}'
        except Exception:
            cover = ''

    (ROOT / filename).write_text(
        f"# {item['title']}\n\n> 정리일: {today.isoformat()}\n> 출처: [{name}]({url})\n"
        f"> 발행일: {item.get('date') or '미확인'}\n\n---\n\n"
        f"{body or skeleton(item)}\n")

    catalog = load_catalog()
    entry = {'id': note_id, 'category': source['category_label'] if source else '기타', 'source': name,
             'title': item['title'], 'summary': item.get('summary') or '', 'tags': ['초안'],
             'industry': source['industry'] if source else '', **({'cover': cover} if cover else {})}
    apply_fields(entry, fields)
    catalog[filename] = entry
    save_catalog(catalog)
    rebuild()
    return {'id': note_id, 'file': filename, 'drafted': bool(body), 'draftError': draft_error}


def note_file(note_id):
    filename = next((f for f, v in load_catalog().items() if v.get('id') == note_id), None)
    if not filename or not (ROOT / filename).exists():
        raise ValueError('노트를 찾지 못했습니다.')
    return filename


def redraft(note_id):
    """Rewrite a note's title and body from its source article, keeping the header lines."""
    filename = note_file(note_id)
    raw = (ROOT / filename).read_text()
    url = re.search(r'^> 출처: \[[^\]]*\]\((https?://[^)]+)\)', raw, re.M)
    if not url:
        raise ValueError('노트 머리에 원문 주소(> 출처: [..](https://..))가 없습니다.')
    _, item = article(url[1])
    fields, body = ai_draft(item)
    title = clean_title(fields.get('TITLE') or item['title'])
    header = re.search(r'^(> .*\n)+', raw, re.M)[0]
    header = re.sub(r'^> 상태: .*\n', '', header, flags=re.M)
    # Keep the date/source prefix of the file name, refresh the slug from the new title.
    prefix = re.match(r'^(\d{6}_[^-]+)-', filename)
    new_name = f'{prefix[1]}-{slugify(title)}.md' if prefix else filename
    if new_name != filename and (ROOT / new_name).exists():
        new_name = filename
    (ROOT / filename).unlink()
    (ROOT / new_name).write_text(f'# {title}\n\n{header}\n---\n\n{body}\n')
    catalog = {(new_name if k == filename else k): v for k, v in load_catalog().items()}
    apply_fields(catalog[new_name], fields)
    if not fields.get('CARD_TITLE'):
        catalog[new_name]['title'] = title
    save_catalog(catalog)
    rebuild()
    return {'id': note_id}


def save_note(note_id, markdown):
    filename = note_file(note_id)
    if not markdown.strip().startswith('# '):
        raise ValueError('첫 줄은 "# 제목" 이어야 합니다.')
    (ROOT / filename).write_text(markdown.rstrip() + '\n')
    rebuild()
    return {'id': note_id}


# ── server ───────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        # The page may be opened from another local port (e.g. VS Code Live Server).
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        route, _, query = self.path.partition('?')
        try:
            if route == '/api/ping':
                return self.send_json(200, {'ok': True})
            if route == '/api/feeds':
                return self.send_json(200, {'sources': feeds(parse_qs(query).get('source', [None])[0])})
            if route == '/api/sources':
                return self.send_json(200, {'sources': sources()})
            if route == '/api/settings':
                return self.send_json(200, {'settings': settings(), 'engines': engines()})
            if route == '/api/note':
                note_id = parse_qs(query).get('id', [''])[0]
                return self.send_json(200, {'id': note_id, 'markdown': (ROOT / note_file(note_id)).read_text()})
        except ValueError as exc:
            return self.send_json(400, {'error': str(exc)})
        return super().do_GET()

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
            if self.path == '/api/add':
                if not re.match(r'https?://', body.get('url', '')):
                    raise ValueError('http 로 시작하는 주소를 넣어 주세요.')
                return self.send_json(200, add(body['url']))
            if self.path == '/api/draft':
                return self.send_json(200, redraft(str(body.get('id', ''))))
            if self.path == '/api/save':
                return self.send_json(200, save_note(str(body.get('id', '')), str(body.get('markdown', ''))))
            if self.path == '/api/sources':
                if body.get('action') == 'remove':
                    return self.send_json(200, {'sources': remove_source(str(body.get('id', '')))})
                return self.send_json(200, {'sources': add_source(body)})
            if self.path == '/api/settings':
                conf = {'engine': body.get('engine') if body.get('engine') in ('claude', 'codex', 'none') else 'none',
                        'model': str(body.get('model') or '').strip()[:80]}
                SETTINGS_PATH.write_text(json.dumps(conf, ensure_ascii=False, indent=2) + '\n')
                return self.send_json(200, {'settings': conf})
            if self.path == '/api/test-engine':
                conf = {'engine': body.get('engine'), 'model': str(body.get('model') or '').strip()}
                reply = run_engine('표준 입력의 문장을 그대로 한 번만 출력해. 다른 말은 하지 마.', '연결 확인: 인사이트 서재', conf)
                return self.send_json(200, {'reply': reply[:200]})
            return self.send_json(404, {'error': 'not found'})
        except ValueError as exc:
            self.send_json(400, {'error': str(exc)})
        except RuntimeError as exc:
            self.send_json(502, {'error': str(exc)})
        except Exception as exc:
            self.send_json(500, {'error': f'처리하지 못했습니다: {exc}'})

    def log_message(self, fmt, *args):
        if '/api/' in (args[0] if args else ''):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f'인사이트 서재: http://127.0.0.1:{port}  (종료: Ctrl+C)')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
