"""Turn .tmp-test/guide-shots/*.png into public/screens/guide/*.webp (desktop 1280 wide, phone 600 wide)."""
from pathlib import Path
from PIL import Image

src, out = Path(".tmp-test/guide-shots"), Path("public/screens/guide")
out.mkdir(parents=True, exist_ok=True)
for f in sorted(src.glob("*.png")):
    im = Image.open(f).convert("RGB")
    if f.name.startswith("p-"):
        im = im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS)
    im.save(out / (f.stem + ".webp"), "WEBP", quality=80, method=6)
    print(f.stem, (out / (f.stem + ".webp")).stat().st_size // 1024, "KB")
