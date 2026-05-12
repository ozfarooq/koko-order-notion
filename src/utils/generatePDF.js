import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const fmt = (date) =>
  date
    ? new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

const pkr = (val) => `PKR ${Number(val || 0).toLocaleString()}`

function buildPDFHTML(order) {
  const m = order.measurements || {}

  const measurementRows = [
    ['Body Length',       m.bodyLength      ? `${m.bodyLength}"` : null],
    ['Shoulder',          m.shoulder        ? `${m.shoulder}"` : null],
    ['Upper Bust',        m.upperBust       || null],
    ['Bust',              m.bust            || null],
    ['High Waist',        m.highWaist       || null],
    ['Armhole',           m.armhole         || null],
    ['Muscle',            m.muscle          || null],
    ['Wrist',             m.wrist           || null],
    ['Sleeves Length',    m.sleevesLength   || null],
    ['Dress Full Length', m.dressFullLength || null],
    ['Lehanga Waist',     m.lehangaWaist    || null],
    ['Lehanga Length',    m.lehangaLength   || null],
  ].filter(([, v]) => v)

  const hasMeasurements = measurementRows.length > 0

  return `
  <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;width:794px;background:#fff;color:#1a1a2e;margin:0;box-sizing:border-box;">

    <!-- Header Banner -->
    <div style="background:linear-gradient(135deg,#1a1035 0%,#4c1d95 60%,#7c3aed 100%);padding:36px 48px;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:16px;">
        <img src="/kokoLogo.jpg" alt="Koko Atelier"
          style="height:72px;width:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.3);"
          onerror="this.style.display='none';document.getElementById('logo-fb').style.display='flex';" />
        <div id="logo-fb" style="display:none;height:72px;width:72px;border-radius:50%;background:rgba(255,255,255,0.15);align-items:center;justify-content:center;font-size:32px;font-weight:900;color:#fff;letter-spacing:-2px;">K</div>
        <div>
          <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Koko Atelier</div>
          <div style="font-size:10px;color:rgba(255,255,255,0.55);letter-spacing:4px;text-transform:uppercase;margin-top:3px;">Order Receipt</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:monospace;font-size:22px;font-weight:700;color:#fff;">${order.orderNumber}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px;">Order Date: ${fmt(order.orderDate)}</div>
        <div style="margin-top:8px;display:inline-block;padding:4px 14px;background:rgba(255,255,255,0.15);border-radius:20px;font-size:10px;color:#fff;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;">${order.status}</div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:36px 48px;">

      <!-- Two column top -->
      <div style="display:flex;gap:20px;margin-bottom:20px;">

        <!-- Customer -->
        <div style="flex:1;background:#f8f7ff;border-radius:12px;padding:20px;border:1px solid #ede9fe;">
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#7c3aed;margin-bottom:12px;">Customer Information</div>
          <div style="font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:8px;">${order.customer || '—'}</div>
          ${order.email   ? `<div style="font-size:11px;color:#555;margin-bottom:4px;">&#9993;&nbsp;${order.email}</div>` : ''}
          ${order.phone   ? `<div style="font-size:11px;color:#555;margin-bottom:4px;">&#9742;&nbsp;${order.phone}</div>` : ''}
          ${order.place   ? `<div style="font-size:11px;color:#555;margin-bottom:4px;">&#9679;&nbsp;${order.place}</div>` : ''}
          ${order.address ? `<div style="font-size:11px;color:#666;margin-top:8px;line-height:1.7;">${order.address.replace(/\n/g, '<br/>')}</div>` : ''}
        </div>

        <!-- Payment Summary -->
        <div style="width:220px;background:#f8f7ff;border-radius:12px;padding:20px;border:1px solid #ede9fe;">
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#7c3aed;margin-bottom:12px;">Payment Summary</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:11px;color:#666;">Total Amount</span>
            <span style="font-size:11px;font-weight:600;color:#1a1a2e;">${pkr(order.amount)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:11px;color:#666;">Advance Paid</span>
            <span style="font-size:11px;font-weight:600;color:#059669;">${pkr(order.advancePaid)}</span>
          </div>
          <div style="height:1px;background:#e5e7eb;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:12px;font-weight:700;color:#1a1a2e;">Balance Due</span>
            <span style="font-size:14px;font-weight:800;color:${Number(order.balanceDue) > 0 ? '#ea580c' : '#059669'};">${pkr(order.balanceDue)}</span>
          </div>
          ${order.paymentNotes ? `<div style="margin-top:10px;padding:8px;background:#fffbeb;border-radius:6px;font-size:10px;color:#92400e;line-height:1.6;">${order.paymentNotes}</div>` : ''}
        </div>
      </div>

      <!-- Product / Order Details -->
      <div style="background:#f8f7ff;border-radius:12px;padding:20px;border:1px solid #ede9fe;margin-bottom:20px;">
        <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#7c3aed;margin-bottom:12px;">Order Details</div>
        <div style="display:flex;gap:40px;">
          <div style="flex:1;">
            <div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Product</div>
            <div style="font-size:13px;font-weight:600;color:#1a1a2e;line-height:1.5;">${order.product || '—'}</div>
          </div>
          <div>
            <div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Delivery Date</div>
            <div style="font-size:13px;font-weight:600;color:#1a1a2e;">${fmt(order.deliveryDate)}</div>
          </div>
        </div>
        ${order.specialInstructions ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #ede9fe;">
          <div style="font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Special Instructions</div>
          <div style="font-size:11px;color:#374151;line-height:1.7;">${order.specialInstructions}</div>
        </div>` : ''}
      </div>

      ${hasMeasurements ? `
      <!-- Measurements -->
      <div style="background:#f8f7ff;border-radius:12px;padding:20px;border:1px solid #ede9fe;margin-bottom:20px;">
        <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#7c3aed;margin-bottom:14px;">Measurements</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
          ${measurementRows.map(([label, value]) => `
          <div style="background:#fff;border-radius:8px;padding:10px;border:1px solid #ede9fe;text-align:center;">
            <div style="font-size:8px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${label}</div>
            <div style="font-size:15px;font-weight:700;color:#4c1d95;">${value}</div>
          </div>`).join('')}
        </div>
        ${m.additionalNotes ? `<div style="margin-top:10px;font-size:10px;color:#6b7280;background:#fff;border-radius:6px;padding:10px;border:1px solid #ede9fe;line-height:1.6;">${m.additionalNotes}</div>` : ''}
      </div>` : ''}

    </div>

    <!-- Footer -->
    <div style="background:linear-gradient(135deg,#1a1035,#4c1d95);padding:20px 48px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:12px;font-weight:700;color:#fff;">Thank you for choosing Koko Atelier</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:2px;">Your order is in good hands.</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:rgba(255,255,255,0.45);">Generated ${new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      </div>
    </div>
  </div>`
}

export async function generateOrderPDF(order) {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;background:white;'
  container.innerHTML = buildPDFHTML(order)
  document.body.appendChild(container)

  await new Promise((r) => setTimeout(r, 500))

  const canvas = await html2canvas(container.firstElementChild, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    width: 794,
    windowWidth: 794,
  })

  document.body.removeChild(container)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()
  const imgW = canvas.width / 2
  const imgH = canvas.height / 2
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
      sc.width = canvas.width; sc.height = sliceH * 2
      sc.getContext('2d').drawImage(canvas, 0, yPos * 2, canvas.width, sliceH * 2, 0, 0, canvas.width, sliceH * 2)
      pdf.addImage(sc.toDataURL('image/png'), 'PNG', 0, 0, pdfW, sliceH * ratio)
      yPos += sliceH; pageNum++
    }
  }

  pdf.save(`${order.orderNumber}-${(order.customer || 'order').replace(/\s+/g, '-')}.pdf`)
}
