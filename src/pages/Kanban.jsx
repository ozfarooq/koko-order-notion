import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, closestCorners,
} from '@dnd-kit/core'
import { RefreshCw, PlusCircle, Calendar, Link2, ArrowUp, ArrowDown, Kanban as KanbanIcon, Shirt } from 'lucide-react'
import { getOrders, updateOrder, STATUS_OPTIONS } from '../data/storage'
import { PageHeader, Skeleton, ErrorBanner, money } from '../ui/kit'
import { ease } from '../ui/motion'
import { useAuth } from '../auth/AuthContext'

// Board column order follows the tailoring flow
const COLUMNS = ['New', 'In Tailoring', 'Ready', 'Out for Delivery', 'Payment Pending', 'Paid', 'Cancelled', 'Returned']
  .map((v) => STATUS_OPTIONS.find((s) => s.value === v))
const SORTS = [{ value: 'deliveryDate', label: 'Delivery date' }, { value: 'orderDate', label: 'Order date' }, { value: 'customer', label: 'Customer' }]
const fmtShort = (d) => (d ? new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) : null)
const overdue = (o) => o.deliveryDate && o.deliveryDate < new Date().toISOString().slice(0, 10) && !['Paid', 'Cancelled', 'Returned'].includes(o.status)

export function BoardCard({ order, dragging, overlay }) {
  const img = order.items?.find((i) => i.imageUrl)?.imageUrl
  return (
    <div className={`rounded-xl border border-line bg-surface p-3 shadow-soft transition ${overlay ? 'rotate-2 scale-105 shadow-lift ring-2 ring-plum-300' : 'hover:-translate-y-0.5 hover:shadow-lift'} ${dragging ? 'opacity-30' : ''}`}>
      <div className="flex gap-3">
        <div className="h-14 w-11 flex-shrink-0 overflow-hidden rounded-md bg-subtle2">
          {img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} /> : <div className="flex h-full items-center justify-center text-faint"><Shirt size={16} /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{order.customer}</p>
          <p className="line-clamp-2 text-[11px] leading-snug text-muted">{order.items?.map((i) => `${i.product}${i.size ? ` (${i.size})` : ''}`).join(', ') || order.product}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px]">
        <span className="tabular-nums font-medium font-semibold text-accent">{order.orderNumber}</span>
        {order.deliveryDate && (
          <span className={`flex items-center gap-1 ${overdue(order) ? 'font-semibold text-rose-600' : 'text-faint'}`}><Calendar size={11} />{fmtShort(order.deliveryDate)}</span>
        )}
      </div>
      {order.balanceDue > 0 && (
        <span className="mt-1.5 inline-block rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">Due {money(order.balanceDue)}</span>
      )}
    </div>
  )
}

function DraggableCard({ order, onOpen, disabled }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: order.id, data: { order }, disabled })
  return (
    <motion.div layout layoutId={order.id} transition={{ duration: 0.3, ease }} ref={setNodeRef} {...attributes} {...listeners}
      onClick={() => !isDragging && onOpen(order.id)} className={`touch-manipulation ${disabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}>
      <BoardCard order={order} dragging={isDragging} />
    </motion.div>
  )
}

function Column({ col, orders, onOpen, canDrag }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.value })
  const total = orders.reduce((s, o) => s + (Number(o.amount) || 0), 0)
  return (
    <div ref={setNodeRef}
      className={`flex w-[78vw] max-w-[300px] flex-shrink-0 snap-start flex-col rounded-2xl border transition sm:w-72 ${isOver ? 'border-plum-300 bg-plum-50/70 dark:bg-plum-900/30' : 'border-transparent bg-subtle/70'}`}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
        <p className="flex-1 text-sm font-semibold text-ink">{col.label}</p>
        <span className="rounded-full bg-surface px-2 text-xs font-semibold text-muted">{orders.length}</span>
      </div>
      {total > 0 && <p className="px-3 pb-2 text-[11px] text-faint">{money(total)}</p>}
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3" style={{ minHeight: 80 }}>
        {orders.map((o) => <DraggableCard key={o.id} order={o} onOpen={onOpen} disabled={!canDrag} />)}
        {orders.length === 0 && <div className={`rounded-xl border-2 border-dashed py-6 text-center text-[11px] ${isOver ? 'border-plum-300 text-accent' : 'border-line text-faint'}`}>Drop here</div>}
      </div>
    </div>
  )
}

export default function Kanban() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const canDrag = can('orders:write')
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [sortBy, setSortBy] = useState('deliveryDate')
  const [sortDir, setSortDir] = useState('asc')
  const [showClosed, setShowClosed] = useState(false)

  // Mouse: drag after 6px; touch: press-and-hold so the board can still scroll sideways
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setOrders(await getOrders()) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => {
    const key = (o) => (sortBy === 'customer' ? (o.customer || '').toLowerCase() : o[sortBy] || '9999')
    const g = Object.fromEntries(COLUMNS.map((c) => [c.value, []]))
    orders.forEach((o) => g[o.status]?.push(o))
    Object.values(g).forEach((list) => list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * (sortDir === 'asc' ? 1 : -1)))
    return g
  }, [orders, sortBy, sortDir])

  const visibleColumns = showClosed ? COLUMNS : COLUMNS.filter((c) => !['Paid', 'Cancelled', 'Returned'].includes(c.value))
  const activeOrder = orders.find((o) => o.id === activeId)

  const handleDragEnd = async ({ active, over }) => {
    setActiveId(null)
    if (!over) return
    const order = orders.find((o) => o.id === active.id)
    const status = over.id
    if (!order || order.status === status) return
    setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status } : o)))
    try {
      await updateOrder(order.id, { status })
      toast.success(`${order.orderNumber} → ${status}`)
    } catch (err) {
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: order.status } : o)))
      toast.error(`Couldn't move ${order.orderNumber}: ${err.message}`)
    }
  }

  const share = () => navigator.clipboard.writeText(`${window.location.origin}/board`)
    .then(() => toast.success('Public board link copied')).catch(() => toast.error("Couldn't copy the link"))

  const active = orders.filter((o) => !['Paid', 'Cancelled', 'Returned'].includes(o.status)).length

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4 pb-2 sm:p-6 sm:pb-3 lg:px-8">
        <PageHeader
          eyebrow="Retail" title="Status Board" icon={KanbanIcon}
          subtitle={`${active} in progress · ${canDrag ? 'drag cards to change status (press and hold on a phone)' : 'view only'}`}
          actions={
            <>
              <button className="btn-secondary" onClick={share}><Link2 size={14} />Share</button>
              <button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
              {can('orders:write') && <button className="btn-primary" onClick={() => navigate('/orders/new')}><PlusCircle size={15} />New order</button>}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Sort</span>
          <select className="input w-auto py-1.5" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="btn-icon border border-line bg-surface" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} aria-label="Sort direction">
            {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" className="accent-plum-600" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show paid, cancelled &amp; returned
          </label>
        </div>
        <ErrorBanner onRetry={load}>{error}</ErrorBanner>
      </div>

      {loading ? (
        <div className="flex gap-3 overflow-hidden px-4 sm:px-6 lg:px-8">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-96 w-72 flex-shrink-0" />)}</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={({ active }) => setActiveId(active.id)} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="flex flex-1 snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-6 sm:scroll-px-6 sm:px-6 lg:scroll-px-8 lg:px-8">
            {visibleColumns.map((c) => (
              <Column key={c.value} col={c} orders={grouped[c.value]} onOpen={(id) => navigate(`/orders/${id}`)} canDrag={canDrag} />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22,1,0.36,1)' }}>
            {activeOrder ? <BoardCard order={activeOrder} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
