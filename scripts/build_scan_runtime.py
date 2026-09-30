"""Publish code only. Never recursively copy config, credentials or .env files."""
import importlib.util
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def build():
    # RapidFuzz includes an official Python implementation. Ship that exact
    # implementation, not Windows native extensions or a replacement scorer.
    spec = importlib.util.find_spec('rapidfuzz')
    if spec is None:
        raise RuntimeError('rapidfuzz doit être installé pour préparer le moteur navigateur')
    package = Path(spec.origin).parent
    from importlib.metadata import version, distribution
    if version('rapidfuzz') != '3.14.6':
        raise RuntimeError('Utiliser RapidFuzz 3.14.6')
    target = ROOT / 'web' / 'scan-vendor' / 'rapidfuzz-3.14.6.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for source in sorted(package.rglob('*.py')):
            archive.write(source, 'rapidfuzz/' + str(source.relative_to(package)).replace('\\', '/'))
        for file in distribution('rapidfuzz').files or []:
            if 'license' in str(file).lower() and not str(file).endswith('/'):
                archive.write(distribution('rapidfuzz').locate_file(file), 'LICENSE')


if __name__ == '__main__':
    build()
