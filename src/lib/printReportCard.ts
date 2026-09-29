const PRINT_ROOT_ID = 'report-card-print-root'
const PAGE_STYLE_ID = 'report-card-page-style'

export function printReportCard() {
  const source = document.querySelector<HTMLElement>('.result-sheet')
  if (!source) return

  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.getElementById(PAGE_STYLE_ID)?.remove()

  const printRoot = document.createElement('div')
  printRoot.id = PRINT_ROOT_ID
  printRoot.setAttribute('aria-hidden', 'true')
  printRoot.appendChild(source.cloneNode(true))

  const pageStyle = document.createElement('style')
  pageStyle.id = PAGE_STYLE_ID
  pageStyle.textContent = '@page { size: A4 portrait; margin: 0; }'

  const previousTitle = document.title
  const cleanup = () => {
    document.body.classList.remove('report-card-printing')
    document.title = previousTitle
    printRoot.remove()
    pageStyle.remove()
  }

  document.head.appendChild(pageStyle)
  document.body.appendChild(printRoot)
  document.body.classList.add('report-card-printing')
  document.title = ' '
  window.addEventListener('afterprint', cleanup, { once: true })

  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.print())
  })
}
