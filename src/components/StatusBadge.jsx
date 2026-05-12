import { getStatusMeta } from '../data/storage'

export default function StatusBadge({ status, size = 'sm' }) {
  const meta = getStatusMeta(status)
  const padding = size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${meta.color} ${padding}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {status}
    </span>
  )
}
