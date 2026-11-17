"""生成 PWA 所需的 PNG 图标，用浏览器渲染 icons/icon.svg。用法：python3 tools/make_icons.py
依赖：本机装有 Google Chrome / Chromium（macOS 路径已内置）。"""
import subprocess
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def shot(svg: str, size: int, dest: Path, pad: float = 0.0, bg: str = "transparent"):
    inner = int(size * (1 - 2 * pad))
    off = int(size * pad)
    html = (
        f"<html><body style='margin:0;background:{bg}'>"
        f"<div style='position:absolute;left:{off}px;top:{off}px;width:{inner}px;height:{inner}px'>{svg}</div></body></html>"
    )
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "i.html"
        f.write_text(html)
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
             f"--window-size={size},{size}", f"--screenshot={dest}", f"file://{f}"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )


def main():
    svg = (OUT / "icon.svg").read_text().replace("<svg ", "<svg width='100%' height='100%' ", 1)
    for size in (180, 192, 512):
        shot(svg, size, OUT / f"icon-{size}.png")
    # maskable：铺满黄色背景并留出安全区
    shot(svg, 512, OUT / "maskable-512.png", pad=0.1, bg="#ffd23f")
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
