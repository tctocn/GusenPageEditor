"""Mirror explicit static dependencies; never execute bundles or call business APIs."""
from pathlib import Path, PurePosixPath
from urllib.parse import urljoin, urlsplit, unquote
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import subprocess, hashlib, json, re, os

BASE = 'http://gme.gusen.steel56.com.cn'
ENTRY = BASE + '/guthon/index.html'
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'platform-assets'
OUTPUT.mkdir(parents=True, exist_ok=True)
EXTENSIONS = {'.html','.js','.css','.json','.png','.jpg','.jpeg','.gif','.svg','.webp','.ico','.woff','.woff2','.ttf','.eot','.otf','.wasm','.cur'}
records, failures, references, skipped = {}, {}, {}, set()

class Links(HTMLParser):
    def __init__(self): super().__init__(); self.refs = []
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and ((tag == 'script' and key == 'src') or (tag == 'link' and key == 'href') or (tag in ('img','source') and key == 'src')):
                self.refs.append(value)

def normalize(reference, origin):
    if not reference or reference.startswith(('data:', '#', 'blob:')): return None
    reference = reference.strip().replace('\\/', '/')
    url = urljoin(origin, reference)
    parts = urlsplit(url)
    base = urlsplit(BASE)
    decoded = unquote(parts.path)
    if (parts.scheme, parts.netloc) != (base.scheme, base.netloc):
        skipped.add(url); return None
    if not decoded.startswith('/guthon/') or '..' in PurePosixPath(decoded).parts or '\\' in decoded or any(ord(c) < 32 for c in decoded): return None
    if PurePosixPath(decoded).suffix.lower() not in EXTENSIONS: return None
    if parts.query:  # Avoid collisions between query-dependent assets.
        skipped.add(url); return None
    return BASE + parts.path

def find_refs(url, data):
    ext = PurePosixPath(urlsplit(url).path).suffix.lower()
    if ext not in ('.html','.js','.css'): return []
    text = data.decode('utf-8',errors='replace')
    refs = []
    if ext == '.html':
        parser = Links(); parser.feed(text)
        refs.extend((value,url) for value in parser.refs)
    elif ext == '.css':
        refs.extend((match.group(1).strip().strip('\"\''),url) for match in re.finditer(r'url\(\s*([^)]*)\)',text))
        refs.extend((match.group(1),url) for match in re.finditer(r'@import\s+[\"\']([^\"\']+)',text))
    else:
        # Webpack emitted asset modules resolve against its public path, not /js/.
        refs.extend((match.group(1),BASE+'/guthon/') for match in re.finditer(r'\b[\w$]+\.p\s*\+\s*[\"\']([^\"\']+)[\"\']',text))
        refs.extend((match.group(1),BASE) for match in re.finditer(r'[\"\'](/guthon/[^\"\'\s<>]+)[\"\']',text))
        # Webpack's async chunk map may contain chunks absent from HTML prefetch links.
        for match in re.finditer(r'\{((?:\s*\"[^\"]+\"\s*:\s*\"[^\"]+\"\s*,?)+)\}\[[\w$]+\]\+\"\.(js|css)\"',text):
            try: mapping = json.loads('{'+match.group(1)+'}')
            except ValueError: continue
            kind=match.group(2)
            for chunk, digest in mapping.items():
                if re.fullmatch(r'[\w-]+',chunk) and re.fullmatch(r'[a-f0-9]{6,64}',digest):
                    refs.append((kind+'/'+chunk+'.'+digest+'.'+kind,BASE+'/guthon/'))
    result=[]
    for ref, origin in refs:
        target=normalize(ref,origin)
        if target:
            references.setdefault(target,set()).add(url)
            result.append(target)
    return result

def fetch(url):
    relative=urlsplit(url).path.lstrip('/')
    target=OUTPUT / relative
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.name+'.download')
    result=subprocess.run(['curl','--fail','--silent','--show-error','--retry','2','--connect-timeout','10','--max-time','50','--max-filesize','52428800',
                           '--output',str(temporary),'--write-out','%{http_code}\t%{content_type}',url],capture_output=True,text=True)
    if result.returncode:
        if temporary.exists(): temporary.unlink()
        return url, None, result.stderr.strip()[-400:]
    status, _, content_type=result.stdout.partition('\t')
    if status!='200':
        if temporary.exists(): temporary.unlink()
        return url,None,'Unexpected HTTP '+status
    data=temporary.read_bytes()
    if PurePosixPath(relative).suffix != '.html' and (content_type.startswith('text/html') or data.lstrip()[:15].lower().startswith(b'<!doctype html')):
        temporary.unlink();return url,None,'Server returned HTML instead of asset'
    os.replace(temporary,target)
    return url, (data, {'url':url,'path':relative,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'contentType':content_type}), None

def main():
    pending={ENTRY,BASE+'/guthon/editor.worker.js',BASE+'/guthon/ts.worker.js'};seen=set();round_number=0
    while pending:
        if len(seen)+len(pending)>1500: raise RuntimeError('Asset count exceeds safety bound')
        round_number+=1;batch=sorted(pending);pending=set();seen.update(batch)
        with ThreadPoolExecutor(max_workers=6) as executor:
            for url, result, error in executor.map(fetch,batch):
                if error:
                    failures[url]=error; continue
                data, record=result;records[url]=record
                pending.update(target for target in find_refs(url,data) if target not in seen)
        print(f'第 {round_number} 轮：成功 {len(records)}，失败 {len(failures)}，待下载 {len(pending)}',flush=True)
    # Verify entry still references the same build at the end of the crawl.
    check=subprocess.run(['curl','--fail','--silent','--show-error','--max-time','20',ENTRY],capture_output=True)
    stable=check.returncode==0 and hashlib.sha256(check.stdout).hexdigest()==records.get(ENTRY,{}).get('sha256')
    for url, record in records.items():
        data=(OUTPUT/record['path']).read_bytes()
        assert hashlib.sha256(data).hexdigest()==record['sha256']
        record['referencedBy']=sorted(references.get(url,set()))
    manifest={'sourceEntry':ENTRY+'#/gdpaas/dev/modules','downloadedAtUtc':datetime.now(timezone.utc).isoformat(),
              'entryUnchangedDuringDownload':stable,'explicitDependencyClosureComplete':not failures and stable,
              'limitation':'Only explicit HTML/CSS/Webpack static references are mirrored. Runtime-built URLs, API responses and server-supplied resources are not included. This snapshot is not an offline-adapted designer package.',
              'fileCount':len(records),'totalBytes':sum(item['bytes'] for item in records.values()),
              'files':sorted(records.values(),key=lambda item:item['path']),
              'failures':[{'url':url,'error':error,'referencedBy':sorted(references.get(url,set()))} for url,error in sorted(failures.items())],
              'externalOrQueryReferences':sorted(skipped)}
    (OUTPUT/'snapshot.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({key:manifest[key] for key in ['fileCount','totalBytes','entryUnchangedDuringDownload','explicitDependencyClosureComplete']},ensure_ascii=False),flush=True)
    if failures: print('失败记录见 snapshot.json',flush=True)
    if not records.get(ENTRY): raise SystemExit(1)

if __name__=='__main__': main()
