"""Package the extension's local runtime files; no third-party packages needed."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
files = [
    root / "manifest.json",
    root / "index.html",
    root / "styles.css",
    root / "app.js",
    root / "README.md",
    root / "scripts" / "preview.py",
    *sorted((root / "lib").glob("*.js")),
    *sorted((root / "assets").glob("*")),
]
for file in files:
    if not file.is_file():
        raise FileNotFoundError(file)
output = root / "artifacts" / f"qipage-{manifest['version']}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(root))
print(f"Created {output} ({output.stat().st_size:,} bytes, {len(files)} files)")
