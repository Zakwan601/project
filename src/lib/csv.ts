export type CsvCell = string | number | boolean | null | undefined

export function escapeCsvCell(value: CsvCell) {
  let text = value == null ? '' : String(value)
  // Prevent spreadsheet applications from interpreting user-controlled values as formulas.
  if (/^[=+\-@]/.test(text)) text = String.fromCharCode(39) + text
  return `"${text.replace(/"/g, '""')}"`
}

export function downloadCsv(filename: string, rows: CsvCell[][]) {
  const csv = rows
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}