// Business dashboard: retail revenue, balances, workload and reseller summary in one call.
// Dates are Pakistan dates; cancelled and returned orders never count as revenue.
import { neon } from '@neondatabase/serverless'
import { num } from './db.js'
import { can } from './auth.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const q = (text) => db().query(text)

const LIVE = `o.status NOT IN ('Cancelled','Returned')`
// PR / gift orders are still work to stitch, but never sales
const SALE = `o.order_type = 'Sale'`
const OPEN_WORK = `('New','In Tailoring','Ready')`
const TODAY = `(now() AT TIME ZONE 'Asia/Karachi')::date`
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null)

export async function dashboard(user) {
  const [kpi, months, statuses, collections, products, references, aging, upcoming, resellers, saleMonths, payments] = await Promise.all([
    q(`SELECT
        COALESCE(sum(amount_pkr) FILTER (WHERE date_trunc('month', order_date) = date_trunc('month', ${TODAY})), 0) AS rev_this,
        COALESCE(sum(amount_pkr) FILTER (WHERE date_trunc('month', order_date) = date_trunc('month', ${TODAY} - interval '1 month')), 0) AS rev_last,
        count(*) FILTER (WHERE ${SALE} AND date_trunc('month', order_date) = date_trunc('month', ${TODAY}))::int AS orders_this,
        count(*) FILTER (WHERE ${SALE} AND date_trunc('month', order_date) = date_trunc('month', ${TODAY} - interval '1 month'))::int AS orders_last,
        count(*) FILTER (WHERE NOT ${SALE} AND date_trunc('month', order_date) = date_trunc('month', ${TODAY}))::int AS pr_this,
        (SELECT COALESCE(sum(i.quantity * i.unit_price_pkr), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE ${LIVE} AND NOT ${SALE} AND date_trunc('month', o.order_date) = date_trunc('month', ${TODAY})) AS pr_value_this,
        COALESCE(sum(balance_due_pkr) FILTER (WHERE balance_due_pkr > 0), 0) AS outstanding,
        count(*) FILTER (WHERE balance_due_pkr > 0)::int AS owing,
        count(*) FILTER (WHERE status IN ${OPEN_WORK} OR status = 'Out for Delivery')::int AS in_progress,
        count(*) FILTER (WHERE status IN ${OPEN_WORK} AND delivery_date BETWEEN ${TODAY} AND ${TODAY} + 7)::int AS due_week,
        count(*) FILTER (WHERE status IN ${OPEN_WORK} AND delivery_date < ${TODAY})::int AS overdue
      FROM orders o WHERE ${LIVE}`),
    q(`SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE(sum(o.amount_pkr), 0) AS revenue, COALESCE(sum(o.advance_paid_pkr), 0) AS collected, count(o.id)::int AS orders
       FROM generate_series(date_trunc('month', ${TODAY}) - interval '11 months', date_trunc('month', ${TODAY}), interval '1 month') m
       LEFT JOIN orders o ON date_trunc('month', o.order_date) = m AND ${LIVE} AND ${SALE}
       GROUP BY m ORDER BY m`),
    q(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`),
    q(`SELECT COALESCE(c.name, 'Separates') AS name, sum(i.quantity)::int AS pieces, COALESCE(sum(i.quantity * i.unit_price_pkr), 0) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id AND ${LIVE} AND ${SALE}
       LEFT JOIN products p ON p.id = i.product_id LEFT JOIN collections c ON c.id = p.collection_id
       WHERE i.product_id IS NOT NULL GROUP BY 1 ORDER BY pieces DESC, revenue DESC LIMIT 8`),
    q(`SELECT p.id, p.name, p.image_url, sum(i.quantity)::int AS pieces, COALESCE(sum(i.quantity * i.unit_price_pkr), 0) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id AND ${LIVE} AND ${SALE} JOIN products p ON p.id = i.product_id
       GROUP BY p.id ORDER BY pieces DESC, revenue DESC LIMIT 6`),
    q(`SELECT COALESCE(NULLIF(trim(reference), ''), 'Not recorded') AS name, count(*)::int AS orders, COALESCE(sum(amount_pkr), 0) AS revenue
       FROM orders o WHERE ${LIVE} AND ${SALE} GROUP BY 1 ORDER BY orders DESC LIMIT 8`),
    q(`SELECT CASE WHEN ${TODAY} - COALESCE(order_date, created_at::date) <= 30 THEN '0–30 days'
                   WHEN ${TODAY} - COALESCE(order_date, created_at::date) <= 60 THEN '31–60 days' ELSE '60+ days' END AS bucket,
              count(*)::int AS orders, sum(balance_due_pkr) AS amount
       FROM orders o WHERE ${LIVE} AND balance_due_pkr > 0 GROUP BY 1`),
    q(`SELECT o.id, o.order_number, o.status, o.delivery_date, c.name AS customer, o.delivery_date < ${TODAY} AS overdue
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.status IN ${OPEN_WORK} AND o.delivery_date IS NOT NULL AND o.delivery_date <= ${TODAY} + 14
       ORDER BY o.delivery_date LIMIT 10`),
    q(`SELECT r.id, r.name, r.currency,
              count(*) FILTER (WHERE d.status = 'At Store')::int AS at_store,
              COALESCE(sum(d.price) FILTER (WHERE d.status = 'At Store'), 0) AS stock_value,
              count(*) FILTER (WHERE d.status = 'Sold')::int AS unpaid,
              COALESCE(sum(d.net_to_koko) FILTER (WHERE d.status = 'Sold'), 0) AS owed,
              count(*) FILTER (WHERE d.status IN ('Sold','Paid') AND date_trunc('month', d.sold_on) = date_trunc('month', ${TODAY}))::int AS sold_month,
              COALESCE(sum(d.net_to_koko) FILTER (WHERE d.status IN ('Sold','Paid') AND date_trunc('month', d.sold_on) = date_trunc('month', ${TODAY})), 0) AS net_month,
              (SELECT COALESCE(sum(amount), 0) FROM reseller_payments rp WHERE rp.reseller_id = r.id AND date_trunc('month', rp.paid_on) = date_trunc('month', ${TODAY})) AS received_month,
              (SELECT sum(amount_pkr) FROM reseller_payments rp WHERE rp.reseller_id = r.id AND date_trunc('month', rp.paid_on) = date_trunc('month', ${TODAY})) AS received_month_pkr
       FROM resellers r LEFT JOIN consignment_items_detail d ON d.reseller_id = r.id
       GROUP BY r.id ORDER BY r.name`),
    // Reseller sales by the month they sold in, and each payment with the month it settles
    q(`SELECT reseller_id, to_char(sold_on, 'YYYY-MM') AS month, count(*)::int AS pieces,
              sum(net_to_koko) AS payable, COALESCE(sum(net_to_koko) FILTER (WHERE status = 'Paid'), 0) AS paid
       FROM consignment_items_detail WHERE status IN ('Sold','Paid') AND sold_on IS NOT NULL
       GROUP BY 1, 2`),
    q(`SELECT rp.reseller_id, rp.id, rp.paid_on::text AS paid_on, rp.amount, rp.amount_pkr,
              to_char(COALESCE(rp.period,
                (SELECT mode() WITHIN GROUP (ORDER BY date_trunc('month', ci.sold_on)) FROM consignment_items ci WHERE ci.payment_id = rp.id),
                date_trunc('month', rp.paid_on)), 'YYYY-MM') AS month
       FROM reseller_payments rp ORDER BY rp.paid_on DESC, rp.id DESC`),
  ])

  const money = can(user, 'dashboard:money')
  const fcMoney = money && can(user, 'fc:money')
  const m = (v) => (money ? num(v) : null)
  const k = kpi[0]
  const order = ['0–30 days', '31–60 days', '60+ days']

  // Last 3 sale months per reseller: payable, received (AED and PKR) and whether it's settled
  const resellerMonths = (rid) => {
    const rows = new Map()
    saleMonths.filter((r) => r.reseller_id === rid).forEach((r) => rows.set(r.month, { month: r.month, pieces: r.pieces, payable: num(r.payable), due: num(r.payable) - num(r.paid), received: 0, receivedPkr: null }))
    payments.filter((p) => p.reseller_id === rid).forEach((p) => {
      if (!rows.has(p.month)) rows.set(p.month, { month: p.month, pieces: 0, payable: 0, due: 0, received: 0, receivedPkr: null })
      const r = rows.get(p.month)
      r.received += num(p.amount)
      if (p.amount_pkr != null) r.receivedPkr = (r.receivedPkr || 0) + num(p.amount_pkr)
    })
    return [...rows.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3).map((r) => ({
      month: r.month, pieces: r.pieces, payable: Math.round(r.payable * 100) / 100, received: r.received, receivedPkr: r.receivedPkr,
      status: !r.pieces || r.due < 0.5 ? 'Paid' : r.due < r.payable - 0.5 ? 'Part paid' : 'Due',
    }))
  }
  const lastPayment = (rid) => {
    const p = payments.find((x) => x.reseller_id === rid)
    return p ? { paidOn: p.paid_on, amount: num(p.amount), amountPkr: p.amount_pkr == null ? null : num(p.amount_pkr), month: p.month } : null
  }

  return {
    today: iso((await q(`SELECT ${TODAY} AS d`))[0].d),
    showMoney: money,
    kpis: {
      revenueThisMonth: m(k.rev_this), revenueLastMonth: m(k.rev_last),
      ordersThisMonth: k.orders_this, ordersLastMonth: k.orders_last,
      prThisMonth: k.pr_this, prValueThisMonth: m(k.pr_value_this),
      outstanding: m(k.outstanding), owingOrders: k.owing,
      inProgress: k.in_progress, dueThisWeek: k.due_week, overdue: k.overdue,
    },
    months: months.map((r) => ({ month: r.month, revenue: m(r.revenue), collected: m(r.collected), orders: r.orders })),
    statuses: Object.fromEntries(statuses.map((r) => [r.status, r.n])),
    collections: collections.map((r) => ({ name: r.name, pieces: r.pieces, revenue: m(r.revenue) })),
    products: products.map((r) => ({ id: r.id, name: r.name, imageUrl: r.image_url, pieces: r.pieces, revenue: m(r.revenue) })),
    references: references.map((r) => ({ name: r.name, orders: r.orders, revenue: m(r.revenue) })),
    aging: order.map((b) => { const r = aging.find((x) => x.bucket === b); return { bucket: b, orders: r?.orders || 0, amount: m(r?.amount || 0) } }),
    upcoming: upcoming.map((r) => ({ id: r.id, orderNumber: r.order_number, status: r.status, deliveryDate: iso(r.delivery_date), customer: r.customer, overdue: r.overdue })),
    resellers: can(user, 'fc:read') ? resellers.map((r) => ({
      id: r.id, name: r.name, currency: r.currency, atStore: r.at_store, unpaid: r.unpaid, soldThisMonth: r.sold_month,
      stockValue: fcMoney ? num(r.stock_value) : null, owed: fcMoney ? num(r.owed) : null, netThisMonth: fcMoney ? num(r.net_month) : null,
      receivedThisMonth: fcMoney ? num(r.received_month) : null, receivedThisMonthPkr: fcMoney ? num(r.received_month_pkr) : null,
      months: fcMoney ? resellerMonths(r.id) : [], lastPayment: fcMoney ? lastPayment(r.id) : null,
    })) : [],
  }
}
