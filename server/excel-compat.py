import io
import sys
from openpyxl import load_workbook

try:
    source = io.BytesIO(sys.stdin.buffer.read())

    workbook = load_workbook(
        source,
        read_only=False,
        data_only=True,
        keep_vba=False
    )

    output = io.BytesIO()
    workbook.save(output)
    sys.stdout.buffer.write(output.getvalue())

except Exception as exc:
    print(f"Excel compatibility reader: {exc}", file=sys.stderr)
    sys.exit(1)
