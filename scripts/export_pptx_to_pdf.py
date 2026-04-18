"""Export submission/Resona.pptx to PDF using the installed PowerPoint app.

Why PDF: every phone opens it natively, renders fonts correctly even if
Alibaba PuHui 3.0 is not installed on the viewing device (embedded once
the PDF is generated), and presents fullscreen in any PDF reader.

Requires PowerPoint installed on Windows. Script drives it via COM.
Opening the app is visible for a few seconds, which is fine.

Usage:
    python scripts/export_pptx_to_pdf.py
    # writes submission/Resona.pdf
"""

from __future__ import annotations

from pathlib import Path
import sys

import comtypes.client

REPO_ROOT = Path(__file__).resolve().parent.parent
PPTX_PATH = REPO_ROOT / "submission" / "Resona.pptx"
PDF_PATH = REPO_ROOT / "submission" / "Resona.pdf"

# Microsoft.Office.Interop.PowerPoint.PpSaveAsFileType.ppSaveAsPDF = 32
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
        # WithWindow=0 keeps the presentation off-screen (faster, less noise).
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
