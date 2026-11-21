#!/usr/bin/env python3
"""Turn the artifact page (shulchan-kitim.html) into the installed app's index.html:
the PDF libraries come from the app's own lib/ folder instead of the internet."""
import sys, re
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
swaps = {
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js': 'lib/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js': 'lib/pdf.min.js',
    "'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'": "'lib/pdf.worker.min.js'",
}
for a, b in swaps.items():
    if a not in s: sys.exit(f'missing: {a}')
    s = s.replace(a, b)
if 'SHULCHAN_KITIM_APP' not in s: sys.exit('marker missing')
m = re.search(r'const APP_VERSION = (\d+);', s)
if not m: sys.exit('APP_VERSION missing')
open(dst, 'w', encoding='utf-8').write(s)
print('ok, version', m.group(1))
