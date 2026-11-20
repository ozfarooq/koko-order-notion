// Saves an on-screen statement (or any report card) as a landscape A4 PDF, across pages if it is long.
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

export async function downloadElementPdf(el, filename) {
  const scale = 2
  const canvas = await html2canvas(el, {
    scale, useCORS: true, backgroundColor: '#FFFFFF', logging: false,
    width: el.scrollWidth, height: el.scrollHeight, windowWidth: Math.max(el.scrollWidth + 64, 1100),
    // Always the light look on paper, and nothing that's only for the screen
    onclone: (doc) => {
      doc.documentElement.classList.remove('dark')
      doc.querySelectorAll('[data-pdf-hide]').forEach((n) => n.remove())
      // Card as wide as its table, and plain digits (html2canvas spaces out tabular figures)
      doc.querySelectorAll('[data-pdf-root]').forEach((n) => { n.style.overflow = 'visible'; n.style.width = `${el.scrollWidth}px` })
      const style = doc.createElement('style')
      style.textContent = '* { font-variant-numeric: normal !important; font-feature-settings: normal !important; }'
      doc.head.appendChild(style)
    },
  })
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const margin = 24
  const pageW = pdf.internal.pageSize.getWidth() - margin * 2
  const pageH = pdf.internal.pageSize.getHeight() - margin * 2
  const ratio = pageW / canvas.width
  const sliceH = Math.floor(pageH / ratio)            // canvas pixels per page
  for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
    const h = Math.min(sliceH, canvas.height - y)
    const slice = document.createElement('canvas')
    slice.width = canvas.width; slice.height = h
    slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (page) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pageW, h * ratio)
  }
  pdf.save(filename)
}
