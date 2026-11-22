import re, sys
f, rule = sys.argv[1], sys.argv[2]
hours, shapes, cell, prem = [], [], {}, {}
h = s = None
for ln in open(f):
    m = re.match(r"entered ([\d.]+) hours", ln)
    if m: h = m.group(1); hours.append(h); continue
    m = re.match(r"  (each side priced near [\d.]+|sold [\d.]+ % away): mean premium collected\s+([\d.]+), sold on average\s+([\d.]+) % away", ln)
    if m:
        s = m.group(1).replace("each side priced near ", "prem ").replace("sold ", "").replace(" away", "")
        if s not in shapes: shapes.append(s)
        prem[(h, s)] = (m.group(2), m.group(3)); continue
    m = re.match(r"      (\S+)\s+n=\s*(\d+) mean=\s*([+-][\d.]+) win=\s*(\d+)% worst=\s*([+-][\d.]+) total=\s*[+-]\d+ \| first half\s*([+-]\d+), second half\s*([+-]\d+)", ln)
    if m and m.group(1) == rule:
        cell[(h, s)] = (m.group(3), m.group(4), m.group(5), "++" if int(m.group(6)) > 0 and int(m.group(7)) > 0 else "x")
print(f"{f}  rule {rule}: mean / % positive / worst / both halves positive (++); under it: premium collected, average % away")
print("h before " + "".join(f"{s:>26s}" for s in shapes))
for h in hours:
    print(f"{h:>8s} " + "".join(("%26s" % " ".join(cell[(h, s)])) if (h, s) in cell else " " * 26 for s in shapes))
    print(f"{'':8s} " + "".join(("%26s" % ("(%s, %s %%)" % prem[(h, s)])) if (h, s) in prem else " " * 26 for s in shapes))
