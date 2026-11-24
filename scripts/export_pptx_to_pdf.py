from __future__ import annotations

from pathlib import Path
import sys

import comtypes.client

REPO_ROOT = Path(__file__).resolve().parent.parent
PPTX_PATH = REPO_ROOT / "submission" / "Resona.pptx"
PDF_PATH = REPO_ROOT / "submission" / "Resona.pdf"

PP_SAVE_AS_PDF = 32


def main() -> None:
    if not PPTX_PATH.exists():
        print(f"missing source: {PPTX_PATH}")
        sys.exit(1)

    print(f"opening PowerPoint...")
    app = comtypes.client.CreateObject("PowerPoint.Application")
    # PowerPoint COM requires the window to be visible on some versions.
    try:
        app.Visible = 1
    except Exception:
        pass

    try:
        print(f"loading {PPTX_PATH.name}...")
        pres = app.Presentations.Open(str(PPTX_PATH), WithWindow=0)
        print(f"exporting to {PDF_PATH.name}...")
        pres.SaveAs(str(PDF_PATH), PP_SAVE_AS_PDF)
        pres.Close()
    finally:
        app.Quit()

    size_kb = PDF_PATH.stat().st_size // 1024
    print(f"wrote {PDF_PATH}  ({size_kb} KB)")


if __name__ == "__main__":
    main()
