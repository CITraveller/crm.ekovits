// Inspect ZIP central-directory sizes before ExcelJS decompresses an XLSX file.
// Reject ZIP64, encrypted files, and archives larger than the in-memory budget.
export function validateWorkbookArchive(buffer) {
  let end = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65557);
    i--
  ) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw Error("Choose a valid .xlsx workbook");
  const count = buffer.readUInt16LE(end + 10),
    size = buffer.readUInt32LE(end + 12),
    offset = buffer.readUInt32LE(end + 16);
  if (count > 2000 || count === 65535 || offset + size > end)
    throw Error("Workbook archive exceeds supported limits");
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (
      cursor + 46 > buffer.length ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    )
      throw Error("Invalid workbook archive");
    const flags = buffer.readUInt16LE(cursor + 8),
      uncompressed = buffer.readUInt32LE(cursor + 24);
    if (flags & 1)
      throw Error("Password-protected workbooks are not supported");
    total += uncompressed;
    if (total > 40 * 1024 * 1024)
      throw Error("Expanded workbook exceeds the 40 MB limit");
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
    if (cursor > offset + size)
      throw Error("Invalid workbook archive directory");
  }
}
