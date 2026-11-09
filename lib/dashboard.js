// Business dashboard: retail revenue, balances, workload and reseller summary in one call.
// Dates are Pakistan dates; cancelled and returned orders never count as revenue.
import { neon } from '@neondatabase/serverless'
import { num } from './db.js'
import { can } from './auth.js'

let _sql
const db = () => (_sql ??= neon(process.env.DATABASE_URL))
const q = (text) => db().query(text)

const LIVE = `o.status NOT IN ('Cancelled','Returned')`
const OPEN_WORK = `('New','In Tailoring','Ready')`
const TODAY = `(now() AT TIME ZONE 'Asia/Karachi')::date`
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null)

export async function dashboard(user) {
  const [kpi, months, statuses, collections, products, references, aging, upcoming, resellers] = await Promise.all([
    q(`SELECT
        COALESCE(sum(amount_pkr) FILTER (WHERE date_trunc('month', order_date) = date_trunc('month', ${TODAY})), 0) AS rev_this,
        COALESCE(sum(amount_pkr) FILTER (WHERE date_trunc('month', order_date) = date_trunc('month', ${TODAY} - interval '1 month')), 0) AS rev_last,
        count(*) FILTER (WHERE date_trunc('month', order_date) = date_trunc('month', ${TODAY}))::int AS orders_this,
        count(*) FILTER (WHERE date_trunc('month', order_date) = date_trunc('month', ${TODAY} - interval '1 month'))::int AS orders_last,
        COALESCE(sum(balance_due_pkr) FILTER (WHERE balance_due_pkr > 0), 0) AS outstanding,
        count(*) FILTER (WHERE balance_due_pkr > 0)::int AS owing,
        count(*) FILTER (WHERE status IN ${OPEN_WORK} OR status = 'Out for Delivery')::int AS in_progress,
        count(*) FILTER (WHERE status IN ${OPEN_WORK} AND delivery_date BETWEEN ${TODAY} AND ${TODAY} + 7)::int AS due_week,
        count(*) FILTER (WHERE status IN ${OPEN_WORK} AND delivery_date < ${TODAY})::int AS overdue
      FROM orders o WHERE ${LIVE}`),
    q(`SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE(sum(o.amount_pkr), 0) AS revenue, COALESCE(sum(o.advance_paid_pkr), 0) AS collected, count(o.id)::int AS orders
       FROM generate_series(date_trunc('month', ${TODAY}) - interval '11 months', date_trunc('month', ${TODAY}), interval '1 month') m
       LEFT JOIN orders o ON date_trunc('month', o.order_date) = m AND ${LIVE}
       GROUP BY m ORDER BY m`),
    q(`SELECT status, count(*)::int AS n FROM orders GROUP BY status`),
    q(`SELECT COALESCE(c.name, 'Separates') AS name, sum(i.quantity)::int AS pieces, COALESCE(sum(i.quantity * i.unit_price_pkr), 0) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id AND ${LIVE}
       LEFT JOIN products p ON p.id = i.product_id LEFT JOIN collections c ON c.id = p.collection_id
       WHERE i.product_id IS NOT NULL GROUP BY 1 ORDER BY pieces DESC, revenue DESC LIMIT 8`),
    q(`SELECT p.id, p.name, p.image_url, sum(i.quantity)::int AS pieces, COALESCE(sum(i.quantity * i.unit_price_pkr), 0) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id AND ${LIVE} JOIN products p ON p.id = i.product_id
       GROUP BY p.id ORDER BY pieces DESC, revenue DESC LIMIT 6`),
    q(`SELECT COALESCE(NULLIF(trim(reference), ''), 'Not recorded') AS name, count(*)::int AS orders, COALESCE(sum(amount_pkr), 0) AS revenue
       FROM orders o WHERE ${LIVE} GROUP BY 1 ORDER BY orders DESC LIMIT 8`),
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
              COALESCE(sum(d.net_to_koko) FILTER (WHERE d.status IN ('Sold','Paid') AND date_trunc('month', d.sold_on) = date_trunc('month', ${TODAY})), 0) AS net_month
       FROM resellers r LEFT JOIN consignment_items_detail d ON d.reseller_id = r.id
       GROUP BY r.id ORDER BY r.name`),
  ])

  const money = can(user, 'dashboard:money')
  const fcMoney = money && can(user, 'fc:money')
  const m = (v) => (money ? num(v) : null)
  const k = kpi[0]
  const order = ['0–30 days', '31–60 days', '60+ days']

  return {
    today: iso((await q(`SELECT ${TODAY} AS d`))[0].d),
    showMoney: money,
    kpis: {
      revenueThisMonth: m(k.rev_this), revenueLastMonth: m(k.rev_last),
      ordersThisMonth: k.orders_this, ordersLastMonth: k.orders_last,
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
    })) : [],
  }
}
