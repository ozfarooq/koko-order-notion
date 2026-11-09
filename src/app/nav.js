import {
  LayoutDashboard, ClipboardList, Kanban, PlusCircle, Users, Store, FileText, Images, Contact, Shirt,
  Truck, ReceiptText, Settings, Building2,
} from 'lucide-react'

// Screens switched on as each phase ships
export const FEATURES = { dashboard: false, customers: true, catalogue: true }

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
          { to: `/resellers/${r.id}/settings`, label: 'Settings', icon: Settings, when: can('resellers:manage') },
        ].filter((i) => i.when !== false),
      })),
    })
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
