"""정리 완료 Excel(1행 제목, 2행 요약, 3행 헤더)을 회귀 테스트용 JSON으로 변환한다.

사용법: py scripts/xlsx_to_expected.py "samples/결과.xlsx" "samples/원본 CSV 이름"
결과: samples/expected/<원본 CSV 이름>.json  (필요하면 같은 이름의 .meta.json을 직접 작성)
필요: py -m pip install openpyxl
"""
import json
import os
import sys

import openpyxl

src, csv_name = sys.argv[1], os.path.splitext(os.path.basename(sys.argv[2]))[0]
wb = openpyxl.load_workbook(src)
out = []
for ws in wb.worksheets:
    rows = [['' if c is None else str(c) for c in r] for r in ws.iter_rows(values_only=True)]
    out.append({'name': ws.title, 'title': rows[0][0], 'summary': rows[1][0], 'columns': rows[2], 'rows': rows[3:]})
os.makedirs('samples/expected', exist_ok=True)
dst = f'samples/expected/{csv_name}.json'
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)
print(dst)
