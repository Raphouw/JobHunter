"""Vendor the supplied CV editor and its pinned browser dependencies."""
from pathlib import Path
import re
import sys
import urllib.request

root = Path(__file__).resolve().parents[1] / 'web/src/components/CVs'
root.mkdir(parents=True, exist_ok=True)
src = Path(sys.argv[1]).read_text(encoding='utf-8').replace('localStorage', 'editorStorage')
src = src.replace("'oninput', ", '')
src = src.replace('calc(${startPct} - 0px)', '${startPct}')
src = src.replace('calc(${endPct} - ${borderWidth}px)', '${Math.max(0,(sideEnd-borderWidth)/bodyWidth*100).toFixed(4)}%')
src = src.replace('calc(${stop} - ${borderPx}px)', '${Math.max(0,(sideWidth-borderPx)/pageWidth*100).toFixed(4)}%')
src = src.replace("editorStorage.getItem('cv-data-v16')); const a", "editorStorage.getItem('cv-data-v17')); const a")
a = src.index('  injectProfile() {')
b = src.index('\n};', a)
src = src[:a] + '''  injectProfile() {
    this.applyPreset('tech-pro');
    document.getElementById('cv-name').innerText = 'Prénom Nom';
    document.getElementById('cv-title').innerText = 'Poste recherché';
    document.getElementById('cv-contacts').innerHTML = '';
    document.getElementById('cv-main-col').innerHTML = '';
    document.getElementById('cv-sidebar-col').innerHTML = '';
    UI.addContact('✉', 'prenom.nom@example.com');
    UI.addSection('main', 'timeline', 'Expériences');
    UI.addSection('main', 'timeline', 'Formation');
    UI.addSection('side', 'tags', 'Compétences');
    this.recordState();
  }''' + src[b:]
src = re.sub(r'filename:`CV_.*?\.pdf`,', "filename:(window.cvDocumentTitle || 'Mon CV').replace(/[^a-zA-Z0-9À-ÿ _.-]/g,'_')+'.pdf',", src)
src = src.replace('<head>', '<head><script>const editorStorage = (() => { const data = new Map(); return { getItem:k=>data.get(k)||null, setItem:(k,v)=>data.set(k,String(v)), removeItem:k=>data.delete(k) }; })();</script>', 1)
for url in re.findall(r'<script src="([^"]+)"></script>', src):
    content = urllib.request.urlopen(url, timeout=30).read().decode('utf-8')
    name = url.rsplit('/', 1)[-1]
    # Keep licenses inside each pinned distribution, inline to avoid opaque-origin asset/CORS issues.
    content = re.sub(r'<(?=/script|script|!--)', r'\\x3c', content, flags=re.I)
    if name in {'purify.min.js', 'html2pdf.bundle.min.js'}:
        (root / 'vendor').mkdir(exist_ok=True)
        (root / 'vendor' / name).write_text(content, encoding='utf-8')
    inline = '' if name == 'html2pdf.bundle.min.js' else '<script>/* vendor:'+name+' */'+content+'</script>'
    src = src.replace('<script src="'+url+'"></script>', inline)
    print('Bundled', name)
(root / 'editor.html').write_text(src, encoding='utf-8')
