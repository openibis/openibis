import sys
import PyPDF2
r=PyPDF2.PdfReader(sys.argv[1])
txt=" ".join([p.extract_text() for p in r.pages if p.extract_text()])
print(txt[:8000])
