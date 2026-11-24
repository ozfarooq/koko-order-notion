import {
  LayoutDashboard, ClipboardList, Kanban, PlusCircle, Users, Store, FileText, Images, Contact, Shirt,
  Truck, ReceiptText, Settings, Building2, Boxes, HelpCircle, BookOpen, Settings2, BarChart3, Library, Receipt, ShoppingBasket, HandCoins, UserCog, Inbox, Banknote, Target, Cpu, Workflow, Palette, Database, Map, Landmark, Calculator, CalendarCheck, Scale,
} from 'lucide-react'

// Screens switched on as each phase ships
// finance: on everywhere (only owners and the Finance Manager role ever see it); VITE_FINANCE=0 switches it off
export const FEATURES = { dashboard: true, customers: true, catalogue: true, inventory: true, finance: import.meta.env.VITE_FINANCE !== '0' }

// One navigation model, used by the sidebar, the phone "More" sheet and the command palette.
// Items are filtered by permission; reseller sections are built from the resellers in the database.
export function buildNav({ can, user, resellers = [] }) {
  const sections = []
  const isReseller = user?.role === 'reseller'

  if (!isReseller && can('orders:read')) {
    sections.push({
      title: 'Retail',
      items: [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, when: FEATURES.dashboard },
        { to: '/orders', label: 'Orders', icon: ClipboardList, end: true },
        { to: '/kanban', label: 'Status Board', icon: Kanban },
        { to: '/orders/new', label: 'New Order', icon: PlusCircle, when: can('orders:write') },
        { to: '/customers', label: 'Customers', icon: Contact, when: FEATURES.customers && can('customers:read') },
        { to: '/catalogue', label: 'Catalogue', icon: Shirt, when: FEATURES.catalogue && can('products:read') },
      ].filter((i) => i.when !== false),
    })
  }

  if (!isReseller && FEATURES.inventory && can('inventory:read')) {
    sections.push({ title: 'Studio', items: [{ to: '/inventory', label: 'Inventory', icon: Boxes }] })
  }

  if (can('fc:read') && resellers.length) {
    sections.push({
      title: isReseller ? resellers[0]?.name || 'My Store' : 'Resellers',
      groups: resellers.map((r) => ({
        id: r.id,
        label: r.name,
        badge: r.atStore,
        base: `/resellers/${r.id}`,
        items: [
          { to: `/resellers/${r.id}`, label: 'Dashboard', icon: LayoutDashboard, end: true },
          { to: `/resellers/${r.id}/stock`, label: isReseller ? 'My Stock' : 'Stock', icon: Store },
          { to: `/resellers/${r.id}/handovers`, label: 'Handovers', icon: Truck },
          { to: `/resellers/${r.id}/statements`, label: 'Statements', icon: ReceiptText, when: can('fc:money') },
          { to: `/resellers/${r.id}/reports/inventory`, label: 'Inventory report', icon: FileText },
          { to: `/resellers/${r.id}/reports/product-sheet`, label: 'Product sheet', icon: Images },
          { to: `/resellers/${r.id}/help`, label: isReseller ? 'Help' : 'Reseller help', icon: HelpCircle },
          { to: `/resellers/${r.id}/settings`, label: 'Settings', icon: Settings, when: can('resellers:manage') },
        ].filter((i) => i.when !== false),
      })),
    })
  }

  if (FEATURES.finance && can('finance:read')) {
    sections.push({ title: 'Finance', items: [
      { to: '/finance', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/finance/inbox', label: 'Inbox', icon: Inbox },
      { to: '/finance/sales', label: 'Sales & receipts', icon: Banknote },
      { to: '/finance/bank', label: 'Bank reconciliation', icon: Landmark },
      { to: '/finance/expenses', label: 'Expenses', icon: Receipt },
      { to: '/finance/claims', label: 'Studio claims', icon: ShoppingBasket },
      { to: '/finance/payroll', label: 'Payroll', icon: HandCoins },
      { to: '/finance/people', label: 'Staff & suppliers', icon: UserCog },
      { to: '/finance/costing', label: 'Costing & pricing', icon: Calculator },
      { to: '/finance/close', label: 'Month-end close', icon: CalendarCheck },
      { to: '/finance/tax', label: 'Tax', icon: Scale },
      { to: '/finance/reports', label: 'Reports', icon: BarChart3 },
      { to: '/finance/notes', label: 'Notes pack', icon: FileText },
      { to: '/finance/ledgers', label: 'Ledgers', icon: Library },
      { to: '/finance/journals', label: 'Journals', icon: BookOpen },
      { to: '/finance/settings', label: 'Finance settings', icon: Settings2 },
    ] })
  }

  if (!isReseller && can('orders:read')) sections.push({ title: 'Help', items: [{ to: '/help', label: 'Help', icon: HelpCircle }] })

  // Product documents (docs/*.mdx): owners only
  if (can('docs:read')) {
    sections.push({ title: 'Product docs', items: [
      { to: '/docs/product-requirements', label: 'Product requirements', icon: Target },
      { to: '/docs/technical-requirements', label: 'Technical requirements', icon: Cpu },
      { to: '/docs/app-flow', label: 'App flow', icon: Workflow },
      { to: '/docs/design-brief', label: 'Design & brand', icon: Palette },
      { to: '/docs/database-schema', label: 'Database schema', icon: Database },
      { to: '/docs/implementation-plan', label: 'Implementation plan', icon: Map },
    ] })
  }

  if (can('users:manage')) {
    sections.push({ title: 'Admin', items: [
      { to: '/users', label: 'Users', icon: Users },
      { to: '/resellers/new', label: 'Add reseller', icon: Building2, when: can('resellers:manage') },
    ].filter((i) => i.when !== false) })
  }
  return sections
}

// Flat list of every destination (command palette)
export const flattenNav = (sections) =>
  sections.flatMap((s) => [
    ...(s.items || []).map((i) => ({ ...i, section: s.title })),
    ...(s.groups || []).flatMap((g) => g.items.map((i) => ({ ...i, label: `${g.label} · ${i.label}`, section: s.title }))),
  ])
