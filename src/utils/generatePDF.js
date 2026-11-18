import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { MEASUREMENT_FIELDS } from '../data/measurements'

const fmt = (date) =>
  date ? new Date(date).toLocaleDateString('en-PK', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
const pkr = (val) => `PKR ${Number(val || 0).toLocaleString()}`
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// "Porcelain & Wine" palette, same as the website
const C = {
  canvas: '#FAF8F9', sand: '#F3E9EC', line: '#ECE6E9', ink: '#1C1A1F', muted: '#7A7480',
  coral: '#7B2D45', alert: '#D9473A', white: '#FFFFFF', obsidian: '#1C1A1F',
}
const CHIP = {
  Paid: ['#DCFCE7', '#15803D'], 'Payment Pending': ['#FEF3C7', '#B45309'], 'In Tailoring': ['#FEF3C7', '#B45309'],
  Ready: ['#F6E6EB', '#7B2D45'], 'Out for Delivery': ['#F0EDF1', '#4B4651'], Cancelled: ['#FDECEA', '#D9473A'],
  Returned: ['#F0EDF1', '#625C68'], New: ['#F5EEDF', '#7A5A22'],
}
// html2canvas draws text ~5px lower than the browser, so a half-height line-height centres it in the PDF
const pill = (text, bg, fg, extra = '') =>
  `<span style="display:inline-block;height:20px;line-height:10px;padding:0 11px;border-radius:10px;background:${bg};color:${fg};font-size:10px;${extra}">${text}</span>`
const chip = (status) => {
  const [bg, fg] = CHIP[status] || CHIP.New
  return pill(esc(status || '—'), bg, fg, 'font-weight:600;letter-spacing:.3px;')
}
const FONT = `font-family:Inter,'Helvetica Neue',Arial,sans-serif;`
const label = (t, extra = '') => `<div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1.6px;color:${C.muted};${extra}">${t}</div>`

// A card with a sand header strip, like the website's tables
const card = (title, body, extra = '') => `
  <div style="background:${C.white};border:1px solid ${C.line};border-radius:12px;overflow:hidden;${extra}">
    <div style="background:${C.sand};padding:8px 16px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1.8px;color:${C.coral};">${title}</div>
    <div style="padding:14px 16px;">${body}</div>
  </div>`

const PAGE_W = 794, PAGE_H = 1123 // A4 at 96 dpi

function header(logos, right) {
  const brand = logos.emblem
    ? `<table style="border-collapse:collapse;"><tr>
         <td style="vertical-align:middle;padding-right:14px;"><img src="${logos.emblem}" style="height:58px;width:auto;display:block;" /></td>
         ${logos.wordmark ? `<td style="vertical-align:middle;"><img src="${logos.wordmark}" style="height:40px;width:auto;display:block;" /></td>` : ''}
       </tr></table>`
    : `<div style="font-size:20px;font-weight:600;letter-spacing:5px;color:${C.ink};">KOKO ATELIER</div>`
  return `
  <div style="background:${C.white};padding:24px 44px 20px;border-bottom:1px solid ${C.line};">
    <table style="width:100%;border-collapse:collapse;"><tr>
      <td style="vertical-align:middle;">${brand}</td>
      <td style="vertical-align:middle;text-align:right;">${right}</td>
    </tr></table>
  </div>
  <div style="height:3px;background:${C.coral};"></div>`
}

function footer(left) {
  return `
  <div style="position:absolute;left:0;right:0;bottom:0;">
    <div style="height:1px;background:${C.line};margin:0 44px;"></div>
    <table style="width:100%;border-collapse:collapse;"><tr>
      <td style="padding:14px 0 18px 44px;vertical-align:middle;">${left}</td>
      <td style="padding:14px 44px 18px 0;vertical-align:middle;text-align:right;font-size:10px;color:${C.muted};line-height:1.7;">
        <span style="color:${C.ink};font-weight:600;">kokoatelier.com</span>
        &nbsp;<span style="color:${C.sand};">|</span>&nbsp; @kokoatelierpk
        &nbsp;<span style="color:${C.sand};">|</span>&nbsp; +92 313 4730467
      </td>
    </tr></table>
  </div>`
}

function measurements(m) {
  if (!m) return ''
  const fields = MEASUREMENT_FIELDS.filter((f) => m[f.key])
  const notes = (m.additionalNotes || '').trim()
  if (!notes && !fields.length) return ''
  const grid = fields.length
    ? '<table style="width:100%;border-collapse:collapse;"><tr>' + fields.map((f, i) => (i && i % 6 === 0 ? '</tr><tr>' : '') +
        `<td style="padding:4px 8px 8px 0;vertical-align:top;width:16.6%;">${label(esc(f.label), 'letter-spacing:1px;font-size:8px;')}<div style="font-size:14px;font-weight:600;color:${C.ink};margin-top:2px;">${esc(m[f.key])}&Prime;</div></td>`).join('') + '</tr></table>'
    : ''
  const text = notes ? `<div style="font-size:11px;color:${C.ink};line-height:1.6;${grid ? `margin-top:6px;padding-top:8px;border-top:1px solid ${C.line};` : ''}">${esc(notes).replace(/\n/g, '<br/>')}</div>` : ''
  return card('Measurements', grid + text, 'margin-top:16px;')
}

function itemsTable(order) {
  const items = order.items || []
  if (!items.length) return `<div style="font-size:13px;font-weight:600;color:${C.ink};white-space:pre-wrap;">${esc(order.product) || '—'}</div>`
  const th = (t, align = 'left') => `<td style="padding:0 0 8px;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1.4px;color:${C.muted};text-align:${align};">${t}</td>`
  return `<table style="width:100%;border-collapse:collapse;">
    <tr>${th('Piece')}${th('Size')}${th('Qty', 'center')}${th('Amount', 'right')}</tr>
    ${items.map((i) => `<tr>
      <td style="padding:8px 0;border-top:1px solid ${C.line};font-size:12px;font-weight:600;color:${C.ink};">${esc(i.product)}${i.collection ? `<div style="font-size:9px;font-weight:400;color:${C.muted};margin-top:1px;">${esc(i.collection)}</div>` : ''}</td>
      <td style="padding:8px 0;border-top:1px solid ${C.line};font-size:11px;color:${C.ink};">${esc(i.size || '—')}</td>
      <td style="padding:8px 0;border-top:1px solid ${C.line};font-size:11px;color:${C.ink};text-align:center;">${i.quantity}</td>
      <td style="padding:8px 0;border-top:1px solid ${C.line};font-size:11px;color:${C.ink};text-align:right;white-space:nowrap;">${i.unitPrice != null ? pkr(i.unitPrice * i.quantity) : '—'}</td>
    </tr>`).join('')}
  </table>`
}

// Each piece with its website photos and one-line description, so the client sees what they ordered.
// `photos` maps an item index to its photos as data URLs (see loadPhotos); pieces without photos are left out.
function outfit(order, photos = {}) {
  const items = (order.items || []).map((i, k) => ({ ...i, pics: photos[k] || [] })).filter((i) => i.pics.length)
  if (!items.length) return ''
  // Smaller photos when there are several pieces, so the receipt stays on one page
  const [w, h] = items.length === 1 ? [150, 200] : items.length === 2 ? [112, 150] : [84, 112]
  const rows = items.map((i, k) => `
    <table style="width:100%;border-collapse:collapse;${k ? `margin-top:14px;padding-top:14px;border-top:1px solid ${C.line};` : ''}"><tr>
      <td style="vertical-align:top;padding-right:18px;">
        ${i.collection ? label(esc(i.collection), 'margin-bottom:4px;') : ''}
        <div style="font-size:${items.length === 1 ? 18 : 15}px;font-weight:600;color:${C.ink};letter-spacing:-.2px;">${esc(i.product)}</div>
        ${i.tagline ? `<div style="font-size:11px;font-style:italic;color:${C.muted};line-height:1.6;margin-top:6px;">${esc(i.tagline)}</div>` : ''}
        <div style="margin-top:10px;font-size:10px;color:${C.ink};">
          ${i.size ? pill(`Size · ${esc(i.size)}`, C.canvas, C.ink, 'margin-right:4px;') : ''}
          ${i.quantity > 1 ? pill(`× ${i.quantity}`, C.canvas, C.ink) : ''}
        </div>
      </td>
      ${i.pics.map((src) => `<td style="vertical-align:top;width:${w}px;padding-left:10px;">
        <div style="width:${w}px;height:${h}px;border-radius:8px;background:${C.canvas} url('${src}') center top / cover no-repeat;"></div></td>`).join('')}
    </tr></table>`).join('')
  return card(items.length === 1 ? 'Your outfit' : 'Your outfits', rows, 'margin-top:16px;')
}

export function buildPDFHTML(order, logos, photos) {
  const balance = Number(order.balanceDue) || 0
  const right = `
    ${label('Order receipt', 'margin-bottom:4px;')}
    <div style="font-size:22px;font-weight:600;color:${C.ink};letter-spacing:-.3px;">${esc(order.orderNumber)}</div>
    ${order.shopifyOrderNumber ? `<div style="font-size:10px;color:${C.muted};margin-top:2px;">Shopify ${esc(order.shopifyOrderNumber)}</div>` : ''}
    <div style="margin-top:8px;">${chip(order.status)}</div>`

  const customer = `
    <div style="font-size:15px;font-weight:600;color:${C.ink};">${esc(order.customer) || '—'}</div>
    <div style="font-size:11px;color:${C.ink};line-height:1.7;margin-top:6px;">
      ${order.phone ? `${esc(order.phone)}<br/>` : ''}${order.email ? `${esc(order.email)}<br/>` : ''}
      ${order.address || order.city ? `<span style="color:${C.muted};">${esc([order.address, order.city].filter(Boolean).join(', '))}</span>` : ''}
    </div>`
  const dates = `
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding-bottom:10px;">${label('Order date')}<div style="font-size:13px;font-weight:600;color:${C.ink};margin-top:3px;">${fmt(order.orderDate)}</div></td></tr>
      <tr><td style="padding-bottom:10px;">${label('Delivery date')}<div style="font-size:13px;font-weight:600;color:${C.ink};margin-top:3px;">${fmt(order.deliveryDate)}</div></td></tr>
      ${order.channel ? `<tr><td>${label('Channel')}<div style="font-size:13px;font-weight:600;color:${C.ink};margin-top:3px;">${esc(order.channel)}</div></td></tr>` : ''}
    </table>`
  const row = (k, v, color = C.ink, bold = 500) => `<tr><td style="padding:5px 0;font-size:11px;color:${C.muted};">${k}</td><td style="padding:5px 0;font-size:12px;font-weight:${bold};color:${color};text-align:right;white-space:nowrap;">${v}</td></tr>`
  const totals = order.orderType === 'PR' ? `
    <div style="background:${C.white};border:1px solid ${C.line};border-radius:12px;padding:16px 18px;box-shadow:0 1px 2px rgba(44,44,42,.06);">
      ${label('Complimentary', 'margin-bottom:6px;')}
      <div style="font-size:13px;font-weight:600;color:${C.ink};line-height:1.5;">A gift from Koko Atelier${order.prHandle ? ` for ${esc(order.prHandle)}` : ''}</div>
      <div style="height:1px;background:${C.line};margin:10px 0 8px;"></div>
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="font-size:12px;font-weight:600;color:${C.ink};">Amount due</td>
        <td style="font-size:18px;font-weight:600;color:#15803D;text-align:right;white-space:nowrap;">${pkr(0)}</td>
      </tr></table>
    </div>` : `
    <div style="background:${C.white};border:1px solid ${C.line};border-radius:12px;padding:16px 18px;box-shadow:0 1px 2px rgba(44,44,42,.06);">
      <table style="width:100%;border-collapse:collapse;">
        ${row('Order total', pkr(order.amount))}
        ${row('Paid', pkr(order.advancePaid), '#15803D')}
      </table>
      <div style="height:1px;background:${C.line};margin:6px 0 8px;"></div>
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="font-size:12px;font-weight:600;color:${C.ink};">Balance due</td>
        <td style="font-size:18px;font-weight:600;color:${balance > 0 ? C.alert : '#15803D'};text-align:right;white-space:nowrap;letter-spacing:-.3px;">${pkr(balance)}</td>
      </tr></table>
      ${order.paymentNotes ? `<div style="margin-top:10px;font-size:10px;color:${C.muted};line-height:1.5;">${esc(order.paymentNotes)}</div>` : ''}
    </div>`

  return `
  <div style="${FONT}position:relative;width:${PAGE_W}px;min-height:${PAGE_H}px;background:${C.canvas};color:${C.ink};box-sizing:border-box;padding-bottom:70px;">
    ${header(logos, right)}
    <div style="padding:24px 44px 0;">
      <table style="width:100%;border-collapse:collapse;"><tr>
        <td style="vertical-align:top;padding-right:16px;">${card('Customer', customer)}</td>
        <td style="vertical-align:top;width:220px;">${card('Dates', dates)}</td>
      </tr></table>

      ${outfit(order, photos)}

      <table style="width:100%;border-collapse:collapse;margin-top:16px;"><tr>
        <td style="vertical-align:top;padding-right:16px;">${card('Order details', itemsTable(order) +
          (order.specialInstructions ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid ${C.line};">${label('Special instructions')}<div style="font-size:11px;color:${C.ink};line-height:1.6;margin-top:4px;">${esc(order.specialInstructions).replace(/\n/g, '<br/>')}</div></div>` : ''))}</td>
        <td style="vertical-align:top;width:220px;">${totals}</td>
      </tr></table>

      ${measurements(order.measurements)}
    </div>
    ${footer(`<div style="font-size:12px;font-weight:600;color:${C.ink};">Thank you for choosing Koko Atelier</div><div style="font-size:10px;color:${C.muted};margin-top:2px;">Each piece is made to measure for you.</div>`)}
  </div>`
}

// Brand images as PNG data URLs (keeps transparency and full resolution in the canvas)
async function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      c.getContext('2d').drawImage(img, 0, 0)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}
export const loadLogos = async () => {
  const [emblem, wordmark] = await Promise.all([loadImage('/brand/emblem.png'), loadImage('/brand/wordmark.png')])
  return { emblem, wordmark }
}

// Product photos as data URLs (3 per piece, resized by Shopify's CDN). A photo that fails is skipped.
async function photoData(url) {
  try {
    const sized = url.includes('cdn.shopify.com') ? `${url}${url.includes('?') ? '&' : '?'}width=480` : url
    const res = await Promise.race([fetch(sized), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))])
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob) })
  } catch { return null }
}
export async function loadPhotos(order) {
  const entries = await Promise.all((order.items || []).map(async (i, k) => {
    const urls = (i.images?.length ? i.images : i.imageUrl ? [i.imageUrl] : []).slice(0, 3)
    return [k, (await Promise.all(urls.map(photoData))).filter(Boolean)]
  }))
  return Object.fromEntries(entries)
}

// Renders HTML off-screen and saves it as a PDF, slicing onto extra pages when it's taller than one
async function renderPDF(html, { width, orientation, filename, scale = 3 }) {
  if (document.fonts?.ready) await document.fonts.ready
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:-10000px;top:0;z-index:-1;width:${width}px;`
  container.innerHTML = html
  document.body.appendChild(container)
  await new Promise((r) => setTimeout(r, 250))
  const canvas = await html2canvas(container.firstElementChild, { scale, useCORS: true, backgroundColor: C.canvas, width, windowWidth: width, logging: false })
  document.body.removeChild(container)

  const pdf = new jsPDF({ orientation, unit: 'px', format: 'a4', hotfixes: ['px_scaling'] })
  const pdfW = pdf.internal.pageSize.getWidth(), pdfH = pdf.internal.pageSize.getHeight()
  // Slightly too tall (e.g. several pieces with photos): shrink onto one page rather than spill a sliver
  const fit = pdfH / ((canvas.height / canvas.width) * pdfW)
  if (fit < 1 && fit > 0.8) {
    pdf.setFillColor(C.canvas); pdf.rect(0, 0, pdfW, pdfH, 'F')
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pdfW - pdfW * fit) / 2, 0, pdfW * fit, pdfH)
    return pdf.save(filename)
  }
  const ratio = pdfW / (canvas.width / scale)
  const sliceH = Math.floor((pdfH / ratio) * scale)
  for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
    const h = Math.min(sliceH, canvas.height - y)
    if (h < scale * 4) break // ignore a sliver of rounding
    const sc = document.createElement('canvas')
    sc.width = canvas.width; sc.height = h
    sc.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (page) pdf.addPage()
    pdf.setFillColor(C.canvas); pdf.rect(0, 0, pdfW, pdfH, 'F')
    pdf.addImage(sc.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, (h / scale) * ratio)
  }
  pdf.save(filename)
}

export async function generateOrderPDF(order) {
  const [logos, photos] = await Promise.all([loadLogos(), loadPhotos(order)])
  const html = buildPDFHTML(order, logos, photos)
  await renderPDF(html, { width: PAGE_W, orientation: 'portrait', filename: `${order.orderNumber}-${(order.customer || 'order').replace(/\s+/g, '-')}.pdf` })
}

// ── Summary PDF for multiple orders ──────────────────────────────────────────
const SUMMARY_W = 1123, SUMMARY_H = 794 // A4 landscape

export function buildSummaryHTML(orders, logos) {
  const td = (v, extra = '') => `<td style="padding:9px 10px;font-size:10px;color:${C.ink};border-top:1px solid ${C.line};vertical-align:top;${extra}">${v}</td>`
  const rows = orders.map((o) => `<tr style="background:${C.white};">
      ${td(`<b style="font-weight:600;color:${C.coral};">${esc(o.orderNumber) || '—'}</b>${o.shopifyOrderNumber ? `<div style="font-size:9px;color:${C.muted};">Shopify ${esc(o.shopifyOrderNumber)}</div>` : ''}`, 'white-space:nowrap;')}
      ${td(esc(o.customer) || '—', 'font-weight:500;')}
      ${td(esc((o.items || []).map((i) => i.product).join(', ') || o.product || '—'))}
      ${td(esc((o.items || []).map((i) => i.size).filter(Boolean).join(', ') || o.size || '—'), 'text-align:center;')}
      ${td(o.quantity != null ? o.quantity : '—', 'text-align:center;')}
      ${td(fmt(o.deliveryDate), 'white-space:nowrap;')}
      ${td(pkr(o.amount), 'white-space:nowrap;text-align:right;')}
      ${td(pkr(o.balanceDue), `white-space:nowrap;text-align:right;font-weight:600;color:${Number(o.balanceDue) > 0 ? C.alert : '#15803D'};`)}
      ${td(chip(o.status))}
    </tr>`).join('')
  const th = (t, align = 'left') => `<th style="padding:9px 10px;text-align:${align};font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:1.6px;color:${C.ink};">${t}</th>`
  const total = orders.reduce((s, o) => s + (Number(o.amount) || 0), 0)
  const balance = orders.reduce((s, o) => s + (Number(o.balanceDue) || 0), 0)
  const right = `${label('Order summary', 'margin-bottom:4px;')}
    <div style="font-size:18px;font-weight:600;color:${C.ink};">${orders.length} order${orders.length !== 1 ? 's' : ''}</div>
    <div style="font-size:10px;color:${C.muted};margin-top:2px;">Generated ${fmt(new Date())}</div>`
  return `
  <div style="${FONT}position:relative;width:${SUMMARY_W}px;min-height:${SUMMARY_H}px;background:${C.canvas};color:${C.ink};padding-bottom:64px;box-sizing:border-box;">
    ${header(logos, right)}
    <div style="padding:22px 44px 0;">
      <div style="border:1px solid ${C.line};border-radius:12px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:${C.sand};">${th('Order')}${th('Customer')}${th('Pieces')}${th('Size', 'center')}${th('Qty', 'center')}${th('Delivery')}${th('Amount', 'right')}${th('Balance', 'right')}${th('Status')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <table style="border-collapse:collapse;margin:14px 0 0 auto;"><tr>
        <td style="padding:12px 18px;background:${C.white};border:1px solid ${C.line};border-radius:12px;">${label('Total')}<div style="font-size:15px;font-weight:600;margin-top:2px;">${pkr(total)}</div></td>
        <td style="width:12px;"></td>
        <td style="padding:12px 18px;background:${C.white};border:1px solid ${C.line};border-radius:12px;">${label('Balance due')}<div style="font-size:15px;font-weight:600;margin-top:2px;color:${balance > 0 ? C.alert : '#15803D'};">${pkr(balance)}</div></td>
      </tr></table>
    </div>
    ${footer(`<div style="font-size:11px;font-weight:600;color:${C.ink};">Koko Atelier</div>`)}
  </div>`
}

export async function generateSummaryPDF(orders) {
  const html = buildSummaryHTML(orders, await loadLogos())
  await renderPDF(html, { width: SUMMARY_W, orientation: 'landscape', scale: 2, filename: `koko-order-summary-${new Date().toISOString().split('T')[0]}.pdf` })
}
