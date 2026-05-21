import * as XLSX from 'xlsx'

const PICKUP_ADDRESS_ID = 468603

// Normalize phone to Pakistani local format: 03XXXXXXXXX
function normalizePhone(phone) {
  if (!phone) return ''
  const digits = phone.replace(/[\s\-().+]/g, '')
  if (digits.startsWith('92') && digits.length >= 12) return '0' + digits.slice(2)
  return digits
}

// Extract clean product name + size from product string
// e.g. "Shab-e-Siyah (X-Large) × 1" → { name: "Shab-e-Siyah", size: "X-LARGE" }
function parseProduct(productStr, fallbackSize) {
  if (!productStr) return { name: '', size: '' }
  const firstLine = productStr.split('\n')[0].trim()
  const m = firstLine.match(/^(.+?)\s*\(([^)]+)\)\s*[×x]\s*\d+$/)
  if (m) return { name: m[1].trim(), size: m[2].trim().toUpperCase() }
  return { name: firstLine, size: (fallbackSize || '').toUpperCase() }
}

export function generateCourierExcel(orders) {
  const headers = [
    'Pickup Address ID',
    'Show Information on Air Waybill',
    'Consignee City Name',
    'Consignee Name',
    'Consignee Address',
    'Consignee Phone Number 1 (03000000000)',
    'Consignee Phone Number 2 (03000000000)',
    'Consignee Email Address',
    'Consignee Address Latitude',
    'Consignee Address Longitude',
    'Self Collection',
    'Order ID',
    'Order Date (YYYY-MM-DD)',
    'Item Product Type ID',
    'Item Description',
    'Item Quantity',
    'Item Insurance',
    'Product Value',
    'Special Instructions',
    'Estimated Weight (kg)',
    'Mode of Shipment ID',
    'Same Day Timing ID',
    'Collection Amount',
    'Mode of Payment ID',
    'Charges Mode ID',
    'Pieces',
    'Shipper Reference Number 1',
    'Shipper Reference Number 2',
    'Shipper Reference Number 3',
    'Shipper Reference Number 4',
    'Shipper Reference Number 5',
    'Open Ship',
    'Parcel Value',
  ]

  const rows = orders.map((order) => {
    const { name: productName, size } = parseProduct(order.product, order.size)
    const itemDescription = `${order.orderNumber} - ${productName}${size ? ' ' + size : ''}`
    const orderDate = order.orderDate || ''
    const productValue = Number(order.amount) || 0
    const collectionAmount = Number(order.balanceDue) || 0

    return [
      PICKUP_ADDRESS_ID,           // Pickup Address ID
      'Yes',                       // Show Information on Air Waybill
      order.city || '',            // Consignee City Name
      order.customer || '',        // Consignee Name
      order.address || '',         // Consignee Address
      normalizePhone(order.phone), // Consignee Phone Number 1
      '',                          // Consignee Phone Number 2
      order.email || '',           // Consignee Email Address
      '',                          // Consignee Address Latitude
      '',                          // Consignee Address Longitude
      'No',                        // Self Collection
      order.orderNumber || '',     // Order ID
      orderDate,                   // Order Date
      1,                           // Item Product Type ID
      itemDescription,             // Item Description
      1,                           // Item Quantity
      'No',                        // Item Insurance
      productValue,                // Product Value
      '',                          // Special Instructions
      1,                           // Estimated Weight (kg)
      1,                           // Mode of Shipment ID
      1,                           // Same Day Timing ID
      collectionAmount,            // Collection Amount
      1,                           // Mode of Payment ID
      4,                           // Charges Mode ID
      1,                           // Pieces
      '',                          // Shipper Reference Number 1
      '',                          // Shipper Reference Number 2
      '',                          // Shipper Reference Number 3
      '',                          // Shipper Reference Number 4
      '',                          // Shipper Reference Number 5
      'No',                        // Open Ship
      productValue,                // Parcel Value
    ]
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  // Auto-width columns
  const colWidths = headers.map((h, i) => {
    const maxLen = Math.max(
      h.length,
      ...rows.map((r) => String(r[i] ?? '').length)
    )
    return { wch: Math.min(maxLen + 2, 60) }
  })
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Courier Booking')

  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `courier-booking-${date}.xlsx`)
}
