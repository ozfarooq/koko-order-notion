import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  HelpCircle, Search, LayoutDashboard, Store, Truck, ReceiptText, FileText, Images, Barcode, Calculator,
  CalendarClock, ShieldCheck, MessageCircleQuestion, KeyRound, ArrowRight, Users, Undo2, Wallet, ClipboardEdit, Settings,
} from 'lucide-react'
import { getResellers } from '../../data/storage'
import { useAuth } from '../../auth/AuthContext'
import { PageHeader } from '../../ui/kit'

const f2 = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Steps({ items }) {
  return (
    <ol className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-plum-50 text-xs font-semibold text-accent dark:bg-plum-900/40">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  )
}

function Term({ k, children }) {
  return <div className="grid gap-1 py-2 sm:grid-cols-[150px_1fr] sm:gap-4"><dt className="font-semibold text-ink">{k}</dt><dd>{children}</dd></div>
}

function Go({ to, children }) {
  return <Link to={to} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">{children}<ArrowRight size={13} /></Link>
}

// Everything the reseller's own login can see. Their logins are view-only, so the guide never
// asks them to change anything: sales, returns and payments are recorded by Koko.
function sectionsFor({ base, name, cur, pct, prefix, showMoney }) {
  const keep = 100 - pct
  // Worked example: gross 650, designer discount 65, alteration 30
  const gross = 650, disc = 65, alt = 30, net = gross - disc, comm = Math.round(net * pct) / 100, payable = net - comm - alt
  const code = `${prefix || 'KOATLR'}-017`

  return [
    {
      id: 'start', title: 'Getting started', icon: LayoutDashboard, keywords: 'login sign in password menu phone dark mode',
      body: (
        <>
          <p>This is your view of the Koko Atelier pieces at {name}. It's always up to date: whenever Koko records a handover, a sale or a payment, you see it here straight away.</p>
          <Steps items={[
            <>Sign in with the username and password Koko gave you.</>,
            <>Use the menu on the left (on a phone, the tabs at the bottom and <b>More</b>) to move between pages.</>,
            <>Change your password any time with <b>Change password</b> at the bottom of the menu.</>,
            <>The moon/sun button at the top switches between light and dark mode.</>,
          ]} />
          <p className="rounded-lg bg-subtle px-3 py-2 text-sm"><ShieldCheck size={14} className="mr-1 inline text-emerald-600" />Your login is <b>view only</b>. You can look, search, download and print, but nothing you do here can change the records. See <a href="#changes" className="font-semibold text-accent">Reporting sales and changes</a>.</p>
        </>
      ),
    },
    {
      id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard, keywords: 'home summary owed payable reminder banner best sellers activity',
      body: (
        <>
          <p>Your home page, with the big picture at a glance. <Go to={base}>Open dashboard</Go></p>
          <dl className="divide-y divide-line">
            <Term k="At store">Pieces with you now, and what they're worth at their selling price.</Term>
            <Term k="Sold, awaiting payment">Pieces you've sold that haven't been paid to Koko yet.</Term>
            <Term k="Paid">Sold pieces already paid for.</Term>
            <Term k="Returned">Pieces sent back to Koko.</Term>
            {showMoney && <Term k="Reminder banner">A red banner such as <i>"October 2026 statement: {cur} 1,151.00 due"</i> appears for each finished month that isn't fully paid yet. <b>View &amp; download</b> opens that month's statement.</Term>}
            {showMoney && <Term k="Sales by month">The last six months: pieces sold, what's payable, what's been received, and a <b>Paid / Part paid / Due</b> badge.</Term>}
            <Term k="Latest activity">The most recent sales and returns.</Term>
            <Term k="Best sellers">The designs that have sold most.</Term>
          </dl>
        </>
      ),
    },
    {
      id: 'stock', title: 'My Stock', icon: Store, keywords: 'stock pieces status search size invoice code at store sold paid returned',
      body: (
        <>
          <p>Every piece Koko has sent you, one line per piece. <Go to={`${base}/stock`}>Open My Stock</Go></p>
          <dl className="divide-y divide-line">
            <Term k="At store">With you and available to sell.</Term>
            <Term k="Sold">You've sold it; payment to Koko is due on that month's statement.</Term>
            <Term k="Paid">Sold and paid for.</Term>
            <Term k="Returned">Sent back to Koko.</Term>
          </dl>
          <p>Use the search box to find a piece by <b>design name, size, code or your invoice number</b>, and the status buttons above the list to show just one status.</p>
        </>
      ),
    },
    {
      id: 'handovers', title: 'Handovers (shipments)', icon: Truck, keywords: 'shipment delivery batch handover received check',
      body: (
        <>
          <p>Each shipment Koko has sent you, with its date and the pieces in it. Use it to check a delivery against what arrived. <Go to={`${base}/handovers`}>Open Handovers</Go></p>
          <p>If something is missing or different, tell Koko before approving the shipment, so the records match.</p>
        </>
      ),
    },
    showMoney && {
      id: 'statements', title: 'Statements & payments', icon: ReceiptText, keywords: 'statement month pdf download print payment received due paid',
      body: (
        <>
          <p>The same layout as your monthly sales sheet: date, invoice number, code, design, gross price, discounts, net price, alteration/laundry, commission and net payable. <Go to={`${base}/statements`}>Open Statements</Go></p>
          <Steps items={[
            <><b>Month by month</b> at the top lists every month with its totals and a <b>Paid / Part paid / Due</b> badge. Click a month to see its statement.</>,
            <>Or choose the month from the drop-down above the statement (<b>All sales</b> shows everything).</>,
            <><b>Download … statement</b> saves it as a PDF to check against your own sheet or keep for your records. <b>Print</b> prints it.</>,
            <>The <b>Payments</b> tab lists each payment Koko received from you: the date, the amount, which month's sales it covered and how many pieces.</>,
          ]} />
        </>
      ),
    },
    showMoney && {
      id: 'money', title: 'How the amounts are worked out', icon: Calculator, keywords: 'commission net payable discount alteration laundry calculation formula',
      body: (
        <>
          <p>Every sold piece is worked out the same way, matching your sales sheet:</p>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line tabular-nums">
                <tr><td className="px-4 py-2">Gross price</td><td className="px-4 py-2 text-muted">the price Koko set for the piece</td><td className="px-4 py-2 text-right">{cur} {f2(gross)}</td></tr>
                <tr><td className="px-4 py-2">− Discounts</td><td className="px-4 py-2 text-muted">designer discount and/or {name} discount</td><td className="px-4 py-2 text-right">{f2(disc)}</td></tr>
                <tr className="bg-subtle font-semibold"><td className="px-4 py-2">= Net price</td><td className="px-4 py-2" /><td className="px-4 py-2 text-right">{f2(net)}</td></tr>
                <tr><td className="px-4 py-2">− Commission</td><td className="px-4 py-2 text-muted">{pct}% of the net price, yours to keep</td><td className="px-4 py-2 text-right">{f2(comm)}</td></tr>
                <tr><td className="px-4 py-2">− Alteration / laundry</td><td className="px-4 py-2 text-muted">charges for that piece, if any</td><td className="px-4 py-2 text-right">{f2(alt)}</td></tr>
                <tr className="bg-subtle font-semibold"><td className="px-4 py-2">= Net payable to Koko</td><td className="px-4 py-2" /><td className="px-4 py-2 text-right text-accent">{cur} {f2(payable)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted">So on the net price you keep {pct}% and Koko receives {keep}%, less any alteration or laundry charge. The commission rate is the one agreed when each shipment was handed over.</p>
        </>
      ),
    },
    {
      id: 'codes', title: 'Codes & barcodes', icon: Barcode, keywords: 'barcode code till sku size koatlr scan label',
      body: (
        <>
          <p>Each Koko design has one code, and the barcode for the till adds the size:</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[['Small', 'S'], ['Medium', 'M'], ['Large', 'L'], ['X-Small', 'XS'], ['X-Large', 'XL'], ['Custom', 'C']].map(([size, s]) => (
              <div key={s} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{size}</span><span className="font-mono font-semibold text-ink">{code}-{s}</span></div>
            ))}
          </div>
          <dl className="divide-y divide-line">
            <Term k="Same design and size">Share one barcode. Two Smalls of {code} are both <span className="font-mono">{code}-S</span>, quantity 2.</Term>
            <Term k="New designs">Get the next number once you approve the shipment.</Term>
            <Term k="Where to find them">The <b>Product sheet</b> has a <b>Codes for the till</b> table: every barcode with its design, size, quantity and price.</Term>
          </dl>
          <p>Please use the same code on your sales sheet, so sales match up quickly.</p>
        </>
      ),
    },
    {
      id: 'reports', title: 'Inventory report & product sheet', icon: Images, keywords: 'report print pdf photos prices product sheet inventory sizes',
      body: (
        <dl className="divide-y divide-line">
          <Term k="Inventory report">Pieces by design, size and status, with totals. <Go to={`${base}/reports/inventory`}>Open</Go></Term>
          <Term k="Product sheet">Photos and prices of everything at the store, the codes for the till, and what has sold. <b>Print / Save PDF</b> to share with your team. <Go to={`${base}/reports/product-sheet`}>Open</Go></Term>
        </dl>
      ),
    },
    {
      id: 'month', title: 'Your monthly routine', icon: CalendarClock, keywords: 'monthly routine process sales sheet payment steps cycle',
      body: (
        <Steps items={[
          <>At the start of each month, send Koko your sales sheet for the month before, with the date, invoice number, code, discounts and alteration/laundry for each sale.</>,
          <>Koko records it. Those pieces change to <b>Sold</b>, and the month appears on your statement.</>,
          <>Open <b>Statements</b>, pick the month and check the totals against your sheet. Download the PDF if you want a copy.</>,
          <>Make the payment and send Koko the confirmation, saying which month it's for.</>,
          <>Once Koko records it, the pieces change to <b>Paid</b>, the payment shows under <b>Payments</b>, and the reminder disappears from your dashboard.</>,
        ]} />
      ),
    },
    {
      id: 'changes', title: 'Reporting sales and changes', icon: KeyRound, keywords: 'change edit wrong mistake return sale report contact view only',
      body: (
        <>
          <p>Your login can't change anything, so the records stay the same for both sides. To get something updated, send it to Koko:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Sales:</b> your monthly sales sheet.</li>
            <li><b>Returns:</b> which pieces (design and size) you're sending back, and why.</li>
            <li><b>Payments:</b> the payment confirmation and the month it covers.</li>
            <li><b>A mistake you've spotted:</b> the design, size and what looks wrong.</li>
          </ul>
          <p>You'll see the change here as soon as Koko records it.</p>
        </>
      ),
    },
    {
      id: 'faq', title: 'Questions', icon: MessageCircleQuestion, keywords: 'faq question help why',
      body: (
        <dl className="divide-y divide-line">
          <Term k="A sale I reported isn't showing">Koko may not have recorded your sheet yet. Click <b>Refresh</b> on the dashboard, and ask Koko if it's still missing.</Term>
          {showMoney && <Term k="The statement total differs from my sheet">Compare the lines one by one: usually a discount or alteration charge is missing on one side. Send Koko the line that differs.</Term>}
          {showMoney && <Term k="A month says Due but I paid">Payments show once Koko has received and recorded them. Send the confirmation if you haven't already.</Term>}
          <Term k="I can't find a piece">Search by design name, code or invoice number on <b>My Stock</b>, with <b>All</b> selected so returned pieces show too.</Term>
          <Term k="Can more of our staff have logins?">Yes. Ask Koko, and each person gets their own view-only login.</Term>
        </dl>
      ),
    },
  ].filter(Boolean)
}

// For Koko's own team (owner, manager, staff): how to run this reseller. Never shown to reseller logins.
function teamSectionsFor({ base, name, can }) {
  const money = can('fc:money'), write = can('fc:write'), manage = can('resellers:manage')
  return [
    write && {
      id: 'team-handover', title: 'Sending a shipment', icon: Truck, team: true, keywords: 'handover shipment record send stock studio',
      body: (
        <Steps items={[
          <>Open <Go to={`${base}/handovers`}>Handovers</Go> and choose <b>Record a handover</b>.</>,
          <>Add each design with its size, quantity and price in the reseller's currency. Pieces ready at the studio are used first; the rest are recorded as made for this shipment.</>,
          <>Save. The pieces show as <b>At store</b> for {name} straight away.</>,
          <>Any design new to {name} is listed in the message. Once they approve the shipment, give it a code (see <a href="#team-codes" className="font-semibold text-accent">Codes and reseller settings</a>).</>,
        ]} />
      ),
    },
    write && money && {
      id: 'team-sales', title: 'Recording their monthly sales', icon: ClipboardEdit, team: true, keywords: 'enter sales statement sheet sold discount alteration invoice',
      body: (
        <Steps items={[
          <>When {name}'s sales sheet arrives, open <Go to={`${base}/statements`}>Statements</Go> and the <b>Enter sales</b> tab.</>,
          <>Quickest: <b>Choose file</b> under <i>Import {name}'s sales sheet</i> and pick their Excel. Each sale is matched by code and design; pick a size where asked, then <b>Add</b>. Sales already entered are recognised and left out.</>,
          <>Or by hand: under <b>At the store</b>, find the design by collection or search, and tap its size. Each tap adds a sale line.</>,
          <>Fill in the sale date, invoice number, code, discounts and alteration/laundry from their sheet. Net payable updates as you type.</>,
          <>Click <b>Record sales</b>. The pieces change to <b>Sold</b> and appear under <b>Recorded sales</b>, grouped by month. Click any sale there to view or correct it.</>,
          <>Check the <b>Statement</b> tab for that month against the totals on their sheet.</>,
        ]} />
      ),
    },
    write && money && {
      id: 'team-payment', title: 'Recording a payment', icon: Wallet, team: true, keywords: 'payment received bank pkr proof month difference reason',
      body: (
        <Steps items={[
          <>On <b>Statements</b>, click <b>Record payment</b> next to the month in <b>Month by month</b>, or use the <b>Payments</b> tab and <b>Record a payment</b>.</>,
          <>Check the ticked pieces, the date received and <b>For sales in</b> (the month it settles).</>,
          <>Enter the amount. If it differs from the statement, give a reason: bank charges, a return, exchange difference or rounding.</>,
          <>Add the <b>PKR received</b> when the bank credit shows, now or later with the pencil icon. {name} never sees the PKR amount or rate.</>,
          <>Attach the statement and payment email as proof. The pieces change to <b>Paid</b>, and the reminder leaves {name}'s dashboard.</>,
        ]} />
      ),
    },
    write && {
      id: 'team-returns', title: 'Pieces coming back', icon: Undo2, team: true, keywords: 'return returned back reason stock',
      body: (
        <Steps items={[
          <>Open <Go to={`${base}/stock`}>Stock</Go> and tick the pieces coming back: pieces at the store, or returned pieces marked <i>Not in studio stock yet</i>. Click <b>Back to studio</b>.</>,
          <>Tick <b>Damaged</b> on any damaged piece, say what's wrong and, if you like, an asking price in PKR.</>,
          <>For pieces still at the store, enter the return date and reason. Click <b>Move to studio</b>: they show as Returned for {name} and At Studio in Inventory.</>,
          <>Remove {name}'s barcode tag from each piece. To sell one, open it in <Go to="/inventory">Inventory</Go> and click <b>Sell this piece</b>.</>,
        ]} />
      ),
    },
    manage && {
      id: 'team-codes', title: 'Codes and reseller settings', icon: Settings, team: true, keywords: 'codes barcode prefix next number reserved settings commission currency',
      body: (
        <>
          <p>In <Go to={`${base}/settings`}>Settings</Go>, under <b>Codes &amp; barcodes</b>:</p>
          <dl className="divide-y divide-line">
            <Term k="Prefix and number">{name}'s own series, e.g. KOATLR and 17. The next new design gets KOATLR-017; the till barcode adds the size.</Term>
            <Term k="Reserved designs">Already shipped but without a confirmed code. Use <b>Enter code</b> once {name} confirms it.</Term>
            <Term k="Next number">Only for a design new to {name}, after they approve the shipment.</Term>
            <Term k="Commission %">A change applies to new handovers only; stock already sent keeps its agreed rate.</Term>
          </dl>
        </>
      ),
    },
    can('users:manage') && {
      id: 'team-logins', title: 'Giving the reseller a login', icon: Users, team: true, keywords: 'user login access account password reseller staff',
      body: (
        <>
          <Steps items={[
            <>Open <Go to="/users">Users</Go> and choose <b>Add user</b>.</>,
            <>Pick the role <b>Reseller</b> and choose <b>{name}</b>.</>,
            <>Set a username and password and share them with the person. Each member of their staff should have their own login.</>,
          ]} />
          <p className="text-sm text-muted">Reseller logins only see their own stock, handovers, statements, payments (without PKR), reports and this guide, and can't change anything.</p>
        </>
      ),
    },
  ].filter(Boolean)
}

export default function ResellerHelp() {
  const { resellerId } = useParams()
  const { can, user } = useAuth()
  const isTeam = user?.role !== 'reseller'
  const [reseller, setReseller] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => { getResellers().then((list) => setReseller(list.find((r) => String(r.id) === String(resellerId)) || null)).catch(() => {}) }, [resellerId])

  const sections = useMemo(() => {
    const base = `/resellers/${resellerId}`
    const theirs = sectionsFor({
      base, name: reseller?.name || 'your store', cur: reseller?.currency || 'AED',
      pct: Number(reseller?.commissionPct) || 30, prefix: reseller?.codePrefix, showMoney: can('fc:money'),
    })
    return isTeam ? [...teamSectionsFor({ base, name: reseller?.name || 'the reseller', can }), ...theirs] : theirs
  }, [reseller, resellerId, isTeam]) // eslint-disable-line react-hooks/exhaustive-deps
  const term = q.trim().toLowerCase()
  const shown = term ? sections.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(term)) : sections

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow={reseller?.name || 'Reseller'} title={isTeam ? 'Reseller help' : 'Help'} icon={HelpCircle}
        subtitle={isTeam ? `How the Koko team runs ${reseller?.name || 'this reseller'}, and the guide their login shows` : 'How to use your Koko Atelier view: stock, statements, payments and codes'} />
      {isTeam && (
        <p className="rounded-xl border border-plum-200 bg-plum-50/60 px-4 py-3 text-sm text-ink dark:border-plum-900/50 dark:bg-plum-900/20">
          <b>For the Koko team:</b> sections marked <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Team</span> explain how to run {reseller?.name || 'this reseller'} and are only shown to Koko logins. The rest is exactly what {reseller?.name || 'the reseller'}'s own login sees.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search help" />
          </div>
          <nav className="hidden space-y-0.5 lg:block">
            {shown.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-soft transition hover:bg-subtle hover:text-ink">
                <s.icon size={14} className={s.team ? 'text-accent' : 'text-faint'} /><span className="flex-1">{s.title}</span>{s.team && <span className="text-[9px] font-semibold uppercase tracking-wider text-accent">Team</span>}
              </a>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 space-y-4">
          {shown.length === 0 && <p className="card p-6 text-sm text-muted">Nothing matches "{q}". Try another word, or ask Koko.</p>}
          {shown.map((s) => (
            <section key={s.id} id={s.id} className="card scroll-mt-4 p-5 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2.5 font-display text-xl font-semibold text-ink">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-plum-50 text-accent dark:bg-plum-900/40"><s.icon size={16} /></span>{s.title}
                {s.team && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">Team</span>}
              </h2>
              <div className="space-y-3 text-[15px] leading-relaxed text-ink-soft">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
