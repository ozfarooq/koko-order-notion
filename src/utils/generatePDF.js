import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const fmt = (date) =>
  date
    ? new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

const pkr = (val) => `PKR ${Number(val || 0).toLocaleString()}`

// Color scheme — dark charcoal with warm gold accents
const DARK  = '#1C1C2E'
const MID   = '#2D2D44'
const GOLD  = '#C9A96E'
const LIGHT = '#F7F6F3'
const WHITE = '#FFFFFF'

function buildMeasurementsSection(m) {
  if (!m) return ''

  const rawText = (m.additionalNotes || '').trim()
  if (!rawText) return ''

  const html = rawText.replace(/\n/g, '<br/>')

  return `
  <div style="background:${LIGHT};border-radius:10px;padding:20px;border:1px solid #E8E4DC;margin-bottom:18px;">
    <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;color:${GOLD};margin-bottom:12px;">Measurements</div>
    <div style="font-size:11px;color:#374151;line-height:1.6;">${html}</div>
  </div>`
}

function buildPDFHTML(order, logoDataUrl) {
  const m = order.measurements || {}
  const measurementsHTML = buildMeasurementsSection(m)
  const hasMeasurements = measurementsHTML.trim() !== ''

  return `
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;width:794px;background:${WHITE};color:${DARK};margin:0;box-sizing:border-box;">

    <!-- Header — table layout avoids html2canvas flex issues -->
    <div style="background:linear-gradient(135deg,${DARK} 0%,${MID} 100%);padding:22px 40px;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="vertical-align:middle;">
          <table style="border-collapse:collapse;"><tr>
            <td style="vertical-align:middle;padding-right:14px;">
              <div style="width:60px;height:60px;border-radius:50%;overflow:hidden;border:2px solid rgba(201,169,110,0.5);background:#fff;">
                ${logoDataUrl
                  ? `<img src="${logoDataUrl}" style="width:60px;height:60px;object-fit:cover;display:block;" />`
                  : `<div style="width:60px;height:60px;line-height:60px;text-align:center;background:#2D2D44;font-size:22px;font-weight:900;color:#C9A96E;">K</div>`
                }
              </div>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:22px;font-weight:800;color:${WHITE};letter-spacing:1px;">Koko Atelier</div>
              <div style="font-size:9px;color:${GOLD};letter-spacing:4px;text-transform:uppercase;margin-top:3px;">Order Receipt</div>
            </td>
          </tr></table>
        </td>
        <td style="vertical-align:middle;text-align:right;">
          <div style="font-family:monospace;font-size:18px;font-weight:700;color:${WHITE};margin-bottom:4px;">${order.orderNumber}</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-bottom:6px;">Order Date: ${fmt(order.orderDate)}</div>
          <div style="display:inline-block;padding:3px 14px;background:rgba(201,169,110,0.2);border:1px solid rgba(201,169,110,0.5);border-radius:20px;font-size:9px;color:${GOLD};font-weight:700;letter-spacing:2px;text-transform:uppercase;">${order.status}</div>
        </td>
      </tr></table>
    </div>

    <!-- Body -->
    <div style="padding:20px 40px;">

      <!-- Customer + Payment row — table layout -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;"><tr>
        <td style="vertical-align:top;padding-right:14px;">
          <div style="background:${LIGHT};border-radius:10px;padding:16px;border:1px solid #E8E4DC;">
            <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;color:${GOLD};margin-bottom:10px;">Customer Information</div>
            <div style="font-size:15px;font-weight:700;color:${DARK};margin-bottom:6px;">${order.customer || '—'}</div>
            ${order.email   ? `<div style="font-size:11px;color:#555;margin-bottom:3px;">&#9993;&nbsp;${order.email}</div>` : ''}
            ${order.phone   ? `<div style="font-size:11px;color:#555;margin-bottom:3px;">&#9742;&nbsp;${order.phone}</div>` : ''}
            ${order.address ? `<div style="font-size:11px;color:#666;margin-top:6px;line-height:1.5;">${order.address.replace(/\n/g, '<br/>')}</div>` : ''}
          </div>
        </td>
        <td style="vertical-align:top;width:210px;">
          <div style="background:${LIGHT};border-radius:10px;padding:16px;border:1px solid #E8E4DC;">
            <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;color:${GOLD};margin-bottom:10px;">Payment Summary</div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="font-size:11px;color:#666;padding-bottom:6px;">Total Amount</td><td style="font-size:11px;font-weight:600;color:${DARK};text-align:right;padding-bottom:6px;">${pkr(order.amount)}</td></tr>
              <tr><td style="font-size:11px;color:#666;padding-bottom:6px;">Advance Paid</td><td style="font-size:11px;font-weight:600;color:#2D8653;text-align:right;padding-bottom:6px;">${pkr(order.advancePaid)}</td></tr>
            </table>
            <div style="height:1px;background:#DDD8D0;margin:6px 0;"></div>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="font-size:12px;font-weight:700;color:${DARK};">Balance Due</td><td style="font-size:13px;font-weight:800;color:${Number(order.balanceDue) > 0 ? '#C0392B' : '#2D8653'};text-align:right;">${pkr(order.balanceDue)}</td></tr>
            </table>
            ${order.paymentNotes ? `<div style="margin-top:8px;padding:7px;background:#FFF8EC;border-radius:6px;border:1px solid #E8D9B0;font-size:10px;color:#7A5C1E;line-height:1.5;">${order.paymentNotes}</div>` : ''}
          </div>
        </td>
      </tr></table>

      <!-- Order Details — table layout -->
      <div style="background:${LIGHT};border-radius:10px;padding:16px;border:1px solid #E8E4DC;margin-bottom:14px;">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2.5px;color:${GOLD};margin-bottom:10px;">Order Details</div>
        <table style="width:100%;border-collapse:collapse;"><tr>
          <td style="vertical-align:top;">
            <div style="font-size:8px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Product</div>
            <div style="font-size:13px;font-weight:600;color:${DARK};line-height:1.5;white-space:pre-wrap;">${order.product || '—'}</div>
          </td>
          <td style="vertical-align:top;width:190px;">
            <table style="border-collapse:collapse;">
              ${order.size ? `<tr><td style="padding-bottom:10px;"><div style="font-size:8px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Size</div><div style="font-size:13px;font-weight:600;color:${DARK};">${order.size}</div></td></tr>` : ''}
              ${order.quantity != null ? `<tr><td style="padding-bottom:10px;"><div style="font-size:8px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Quantity</div><div style="font-size:13px;font-weight:600;color:${DARK};">${order.quantity}</div></td></tr>` : ''}
              <tr><td><div style="font-size:8px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">Delivery Date</div><div style="font-size:13px;font-weight:600;color:${DARK};">${fmt(order.deliveryDate)}</div></td></tr>
            </table>
          </td>
        </tr></table>
        ${order.specialInstructions ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid #E8E4DC;">
          <div style="font-size:8px;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Special Instructions</div>
          <div style="font-size:11px;color:#374151;line-height:1.6;">${order.specialInstructions}</div>
        </div>` : ''}
      </div>

      <!-- Measurements -->
      ${hasMeasurements ? measurementsHTML : ''}

    </div>

    <!-- Footer — table layout -->
    <div style="background:${DARK};padding:14px 40px;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="vertical-align:middle;">
          <div style="font-size:12px;font-weight:700;color:${WHITE};">Thank you for choosing Koko Atelier</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px;">Your order is in good hands.</div>
        </td>
        <td style="vertical-align:middle;text-align:right;">
          <div style="font-size:10px;color:${GOLD};margin-bottom:2px;">&#127760;&nbsp;www.kokoatelier.com</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-bottom:2px;">&#128247;&nbsp;@kokoatelierpk</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.6);">&#128242;&nbsp;+92 313 4730467</div>
        </td>
      </tr></table>
    </div>
  </div>`
}

// Pre-loads the logo at its native resolution and returns a data URL.
// This bypasses html2canvas's lossy image downsampling.
async function loadLogoDataUrl(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
      resolve(c.toDataURL('image/jpeg', 1.0))
    }
    img.onerror = () => resolve(null)
    img.src = src + '?v=' + Date.now()   // bust cache
  })
}

export async function generateOrderPDF(order) {
  // Load logo at native resolution first
  const logoDataUrl = await loadLogoDataUrl('/kokoLogo.jpg')

  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:white;width:794px;'
  container.innerHTML = buildPDFHTML(order, logoDataUrl)
  document.body.appendChild(container)

  await new Promise((r) => setTimeout(r, 300))

  const element = container.firstElementChild
  const canvas = await html2canvas(element, {
    scale: 3,          // higher scale = sharper logo + text
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    width: 794,
    windowWidth: 794,
    logging: false,
  })

  document.body.removeChild(container)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()
  const scale = 3
  const imgW = canvas.width / scale
  const imgH = canvas.height / scale
  const ratio = pdfW / imgW
  const scaledH = imgH * ratio

  if (scaledH <= pdfH) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, scaledH)
  } else {
    let yPos = 0, pageNum = 0
    while (yPos < imgH) {
      if (pageNum > 0) pdf.addPage()
      const sliceH = Math.min(pdfH / ratio, imgH - yPos)
      const sc = document.createElement('canvas')
      sc.width = canvas.width; sc.height = sliceH * scale
      sc.getContext('2d').drawImage(canvas, 0, yPos * scale, canvas.width, sliceH * scale, 0, 0, canvas.width, sliceH * scale)
      pdf.addImage(sc.toDataURL('image/png'), 'PNG', 0, 0, pdfW, sliceH * ratio)
      yPos += sliceH; pageNum++
    }
  }

  pdf.save(`${order.orderNumber}-${(order.customer || 'order').replace(/\s+/g, '-')}.pdf`)
}

// ── Summary PDF for multiple orders ──────────────────────────────────────────
function buildSummaryHTML(orders) {
  const rows = orders.map((o, i) => `
    <tr style="background:${i % 2 === 0 ? WHITE : '#F9F8F6'};">
      <td style="padding:8px 10px;font-family:monospace;font-size:10px;font-weight:700;color:${DARK};white-space:nowrap;">${o.orderNumber || '—'}</td>
      <td style="padding:8px 10px;font-size:10px;color:${DARK};">${o.customer || '—'}</td>
      <td style="padding:8px 10px;font-size:10px;color:#374151;white-space:pre-wrap;">${o.product || '—'}</td>
      <td style="padding:8px 10px;font-size:10px;color:#374151;text-align:center;">${o.size || '—'}</td>
      <td style="padding:8px 10px;font-size:10px;color:#374151;text-align:center;">${o.quantity != null ? o.quantity : '—'}</td>
      <td style="padding:8px 10px;font-size:10px;color:#374151;white-space:nowrap;">${fmt(o.deliveryDate)}</td>
      <td style="padding:8px 10px;font-size:10px;font-weight:600;color:${DARK};white-space:nowrap;">${pkr(o.amount)}</td>
      <td style="padding:8px 10px;font-size:10px;font-weight:700;white-space:nowrap;color:${Number(o.balanceDue) > 0 ? '#C0392B' : '#2D8653'};">${pkr(o.balanceDue)}</td>
      <td style="padding:8px 10px;">
        <span style="padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;background:rgba(201,169,110,0.15);color:${GOLD};">${o.status || '—'}</span>
      </td>
    </tr>`).join('')

  const today = new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })

  return `
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;width:1100px;background:${WHITE};color:${DARK};">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,${DARK} 0%,${MID} 100%);padding:24px 36px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:20px;font-weight:800;color:${WHITE};letter-spacing:1px;">Koko Atelier</div>
        <div style="font-size:9px;color:${GOLD};letter-spacing:4px;text-transform:uppercase;margin-top:3px;">Order Summary</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;color:rgba(255,255,255,0.6);">Generated: ${today}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px;">${orders.length} order${orders.length !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <!-- Table -->
    <div style="padding:24px 36px;">
      <table style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;border:1px solid #E8E4DC;">
        <thead>
          <tr style="background:${DARK};">
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Order</th>
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Customer</th>
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Product</th>
            <th style="padding:10px;text-align:center;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Size</th>
            <th style="padding:10px;text-align:center;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Qty</th>
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Delivery</th>
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Amount</th>
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Balance</th>
            <th style="padding:10px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${GOLD};">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <!-- Footer -->
    <div style="background:${DARK};padding:14px 36px;display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:10px;color:rgba(255,255,255,0.5);">Koko Atelier &mdash; www.kokoatelier.com</div>
      <div style="font-size:10px;color:rgba(255,255,255,0.5);">@kokoatelierpk &nbsp;|&nbsp; +92 313 4730467</div>
    </div>
  </div>`
}

export async function generateSummaryPDF(orders) {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:white;width:1100px;'
  container.innerHTML = buildSummaryHTML(orders)
  document.body.appendChild(container)

  await new Promise((r) => setTimeout(r, 200))

  const canvas = await html2canvas(container.firstElementChild, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    width: 1100,
    windowWidth: 1100,
    logging: false,
  })

  document.body.removeChild(container)

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()
  const scale = 2
  const imgW = canvas.width / scale
  const imgH = canvas.height / scale
  const ratio = pdfW / imgW
  const scaledH = imgH * ratio

  if (scaledH <= pdfH) {
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, scaledH)
  } else {
    let yPos = 0, pageNum = 0
    while (yPos < imgH) {
      if (pageNum > 0) pdf.addPage()
      const sliceH = Math.min(pdfH / ratio, imgH - yPos)
      const sc = document.createElement('canvas')
      sc.width = canvas.width; sc.height = sliceH * scale
      sc.getContext('2d').drawImage(canvas, 0, yPos * scale, canvas.width, sliceH * scale, 0, 0, canvas.width, sliceH * scale)
      pdf.addImage(sc.toDataURL('image/png'), 'PNG', 0, 0, pdfW, sliceH * ratio)
      yPos += sliceH; pageNum++
    }
  }

  const dateStr = new Date().toISOString().split('T')[0]
  pdf.save(`koko-order-summary-${dateStr}.pdf`)
}
