"""Turn .tmp-test/landing-shots/*.png into public/screens/*.jpg for the landing page."""
from pathlib import Path
from PIL import Image

for f in sorted(Path(".tmp-test/landing-shots").glob("*.png")):
    out = Path("public/screens") / (f.stem + ".jpg")
    Image.open(f).convert("RGB").save(out, "JPEG", quality=82, optimize=True, progressive=True)
    print(f.stem, Image.open(out).size, out.stat().st_size // 1024, "KB")
