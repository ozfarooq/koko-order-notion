import { useEffect, useMemo, useState } from 'react'
import {
  HelpCircle, Search, Compass, LayoutDashboard, PlusCircle, ListChecks, ClipboardList, Globe, Gift, Kanban, Contact, Shirt,
  Boxes, Store, Users, MessageCircleQuestion,
} from 'lucide-react'
import { getResellers } from '../data/storage'
import { useAuth } from '../auth/AuthContext'
import { PageHeader } from '../ui/kit'
import { Steps, Term, Go } from './resellers/ResellerHelp'

// The guide for Koko's own team. Each person sees the sections for what their role can do.
function sectionsFor({ can, resellers }) {
  const money = can('dashboard:money')
  return [
    {
      id: 'start', title: 'Getting around', icon: Compass, keywords: 'menu search ctrl k phone dark password role login',
      body: (
        <>
          <Steps items={[
            <>The menu on the left has everything you can use; on a phone use the tabs at the bottom and <b>More</b>.</>,
            <>Press <b>Ctrl K</b> (or tap the search bar) to jump to any order, customer, design or page by typing a few letters: an order number, a name or a phone number.</>,
            <>The moon/sun button switches dark mode. <b>Change password</b> is at the bottom of the menu.</>,
          ]} />
          <dl className="divide-y divide-line">
            <Term k="Owner">Everything, including users, commission rates and settings.</Term>
            <Term k="Manager">Orders (including delete), customers, catalogue, revenue, resellers with money, inventory.</Term>
            <Term k="Staff">Create and edit orders and customers, inventory, reseller stock without money.</Term>
            <Term k="Reseller">A view-only login for one store (e.g. Collage) with its own Help.</Term>
          </dl>
        </>
      ),
    },
    can('orders:read') && {
      id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, keywords: 'dashboard revenue balance overdue deliveries best sellers chart',
      body: (
        <>
          <p>How the business is doing at a glance. <Go to="/dashboard">Open dashboard</Go></p>
          <dl className="divide-y divide-line">
            {money && <Term k="Revenue this month">Sales orders by order date. PR / gift orders and cancelled or returned orders never count.</Term>}
            {money && <Term k="Balance outstanding">What customers still owe, with <b>Unpaid balances by age</b> lower down (0–30, 31–60, 60+ days).</Term>}
            <Term k="In progress / Due this week">Orders being made, and deliveries coming up or overdue.</Term>
            <Term k="Best collections, sellers, sources">What sells and where customers come from (references like Walkin or Outstation).</Term>
            <Term k="Resellers">Stock at each store, what's owed, and sales and payments by month.</Term>
          </dl>
        </>
      ),
    },
    can('orders:write') && {
      id: 'new-order', title: 'Taking an order', icon: PlusCircle, keywords: 'new order customer measurements price advance balance studio stock size',
      body: (
        <Steps items={[
          <>Click <Go to="/orders/new">New Order</Go>. Start typing the customer's name or phone: a repeat customer fills in with their details and <b>latest measurements</b>; otherwise enter a new one.</>,
          <><b>Add product</b> picks a design from the catalogue (price comes from the website; change it per line if needed). <b>+ Custom item</b> is for anything not in the catalogue.</>,
          <>Set the size and quantity. If a matching piece is already at the studio (a sample or a return), tick the box under the line to send that piece instead of stitching a new one.</>,
          <>Fill in measurements, the delivery date, the sales channel (Studio, WhatsApp, Instagram, Shopify…) and a reference if someone referred them.</>,
          <>Under <b>Payment</b>, the total adds up from the lines; enter the <b>advance paid</b> and the balance due is worked out. Save.</>,
        ]} />
      ),
    },
    can('orders:read') && {
      id: 'statuses', title: 'Order statuses', icon: ListChecks, keywords: 'status new tailoring ready payment pending paid delivery returned cancelled',
      body: (
        <>
          <dl className="divide-y divide-line">
            <Term k="New">Taken, not started yet.</Term>
            <Term k="In Tailoring">Being stitched.</Term>
            <Term k="Ready">Finished, waiting for payment or delivery.</Term>
            <Term k="Payment Pending">Ready, waiting for the balance.</Term>
            <Term k="Paid">Fully paid; the balance clears.</Term>
            <Term k="Out for Delivery">Sent to the customer.</Term>
            <Term k="Returned / Cancelled">Taken off revenue. A returned order can put its pieces back into studio stock.</Term>
          </dl>
          <p>Change a status on the order page, or drag the card on the <Go to="/kanban">Status Board</Go>.</p>
        </>
      ),
    },
    can('orders:read') && {
      id: 'order-page', title: 'The order page', icon: ClipboardList, keywords: 'order page pdf receipt whatsapp edit delete activity',
      body: (
        <dl className="divide-y divide-line">
          <Term k="PDF">The customer's receipt, with photos of their outfit and a one-line description from the catalogue.</Term>
          <Term k="WhatsApp">Opens a chat with the customer.</Term>
          <Term k="Edit">Change items, prices, dates, measurements or payment.</Term>
          {can('orders:delete') && <Term k="Delete">Only for orders entered by mistake; returned or cancelled orders should keep their status instead.</Term>}
          <Term k="Activity">Who changed what, and when.</Term>
        </dl>
      ),
    },
    can('orders:write') && {
      id: 'website', title: 'Website orders', icon: Globe, keywords: 'shopify website import online order',
      body: (
        <p>On <Go to="/orders">Orders</Go>, <b>Import from website</b> brings in kokoatelier.com orders from the last 60 days with their customer, items and payment. Orders already imported are skipped, so it's safe to run any time.</p>
      ),
    },
    can('orders:write') && {
      id: 'pr', title: 'PR / gift orders', icon: Gift, keywords: 'pr gift influencer free value instagram',
      body: (
        <p>For outfits sent free to an influencer, switch the order type to <b>PR / gift</b> and add their handle. The total stays 0 and it never counts as revenue; each line's price is recorded as the <b>value given</b> (use <b>Use website price</b> if it shows 0). It still appears as work on the Status Board.</p>
      ),
    },
    can('orders:read') && {
      id: 'board', title: 'Status Board', icon: Kanban, keywords: 'board kanban drag columns share screen',
      body: (
        <p>Every open order as a card in its status column. Drag a card to move it on. <b>Share</b> copies a full-screen board link, handy for a screen in the studio; it only opens for logged-in staff. <Go to="/kanban">Open the board</Go></p>
      ),
    },
    can('customers:read') && {
      id: 'customers', title: 'Customers', icon: Contact, keywords: 'customer profile merge duplicate measurements spend balance whatsapp',
      body: (
        <dl className="divide-y divide-line">
          <Term k="Find">Search by name, phone, city or email on <Go to="/customers">Customers</Go>.</Term>
          <Term k="Profile">Their orders, total spend, average order, balance owed, favourite designs and latest measurements. <b>New order</b> starts one with everything filled in.</Term>
          {can('customers:write') && <Term k="Edit">Fix a name, phone or address; their orders follow.</Term>}
          {can('customers:merge') && <Term k="Merge">The same person entered twice? On the profile you keep, use <b>Merge</b> and pick the duplicate; its orders move across.</Term>}
        </dl>
      ),
    },
    can('products:read') && {
      id: 'catalogue', title: 'Catalogue', icon: Shirt, keywords: 'catalogue collection design price photo sync shopify csv receipt description',
      body: (
        <dl className="divide-y divide-line">
          <Term k="Collections">Every design by collection, with its price and photos. <Go to="/catalogue">Open catalogue</Go></Term>
          {can('catalog:write') && <Term k="Sync from website">Brings in new collections and designs and refreshes prices and photos from kokoatelier.com. You see what will change first.</Term>}
          {can('catalog:write') && <Term k="Import CSV">For designs hidden on the website: export products from Shopify and import the file.</Term>}
          <Term k="A design's page">Its photos for receipts, the <b>receipt description</b> (one line, editable), retail sales and what's at resellers.</Term>
        </dl>
      ),
    },
    can('inventory:read') && {
      id: 'inventory', title: 'Inventory', icon: Boxes, keywords: 'inventory sample stock damaged sell bulk being made shoot return',
      body: (
        <>
          <p>What's physically at the studio, in three tabs. <Go to="/inventory">Open inventory</Go></p>
          <dl className="divide-y divide-line">
            <Term k="Samples">One shoot sample per design, for any collection. <b>Missing a sample</b> shows designs without one; <b>Add samples</b> adds many at once. Click a sample to send it to a shoot, bring it back, or <b>Sell</b> it.</Term>
            <Term k="Studio stock">Returns from resellers or customers and spare pieces, for sale (damaged ones show their label and asking price), plus pieces ready for the next shipment. <b>Sell</b> opens a new order for that exact piece.</Term>
            <Term k="Being made">Pieces being stitched for a reseller shipment; tick the finished ones and <b>Mark ready</b>.</Term>
            <Term k="Damaged">Mark damaged asks whether it can still be sold (label and price) or is written off.</Term>
          </dl>
        </>
      ),
    },
    can('fc:read') && resellers.length > 0 && {
      id: 'resellers', title: 'Resellers', icon: Store, keywords: 'reseller collage consignment handover statement payment codes barcode',
      body: (
        <>
          <p>Each reseller has its own menu: Dashboard, Stock, Handovers, Statements, reports, Settings and a <b>Reseller help</b> page that explains shipments, monthly sales (including importing their sales sheet), payments, returns and codes step by step.</p>
          <ul className="list-disc space-y-1 pl-5">
            {resellers.map((r) => <li key={r.id}><Go to={`/resellers/${r.id}/help`}>{r.name}: Reseller help</Go></li>)}
          </ul>
        </>
      ),
    },
    can('users:manage') && {
      id: 'users', title: 'Users and logins', icon: Users, keywords: 'user login password unlock role staff reseller account',
      body: (
        <Steps items={[
          <>On <Go to="/users">Users</Go>, <b>Add user</b>, choose the role (and the store, for a reseller login), and set a password to share with them.</>,
          <>Forgotten password: edit the user and type a new one. Too many wrong passwords lock a login for 15 minutes; <b>Unlock</b> clears it straight away.</>,
          <>Everything anyone changes is recorded, so give each person their own login.</>,
        ]} />
      ),
    },
    {
      id: 'faq', title: 'Questions', icon: MessageCircleQuestion, keywords: 'faq question help problem wrong missing',
      body: (
        <dl className="divide-y divide-line">
          {can('orders:write') && <Term k="A price or item is wrong">Open the order and click <b>Edit</b>.</Term>}
          {can('customers:merge') && <Term k="A customer appears twice">Merge them from the profile you keep.</Term>}
          {can('orders:write') && <Term k="A website order is missing">Run <b>Import from website</b> on Orders (it covers the last 60 days).</Term>}
          {can('products:read') && <Term k="The receipt has no outfit photo">The design needs photos in the catalogue; run <b>Sync from website</b> or check the design's page.</Term>}
          <Term k="Something looks wrong">Each order, piece and payment has a history of changes; check it, or ask the owner.</Term>
        </dl>
      ),
    },
  ].filter(Boolean)
}

export default function Help() {
  const { can } = useAuth()
  const [resellers, setResellers] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => { if (can('fc:read')) getResellers().then(setResellers).catch(() => {}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => sectionsFor({ can, resellers }), [resellers]) // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase()
  const shown = term ? sections.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(term)) : sections

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Koko Atelier CRM" title="Help" icon={HelpCircle} subtitle="How to take orders, look after customers, keep the catalogue and inventory, and run resellers" />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help" />
          </div>
          <nav className="hidden space-y-0.5 lg:block">
            {shown.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition hover:bg-subtle hover:text-ink">
                <s.icon size={14} className="text-faint" />{s.title}
              </a>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 space-y-4">
          {shown.length === 0 && <p className="card p-6 text-sm text-muted">Nothing matches "{q}". Try another word.</p>}
          {shown.map((s) => (
            <section key={s.id} id={s.id} className="card scroll-mt-4 p-5 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-semibold text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum-50 text-accent dark:bg-plum-900/40"><s.icon size={16} /></span>{s.title}
              </h2>
              <div className="space-y-3 text-[15px] leading-relaxed text-ink-soft">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
