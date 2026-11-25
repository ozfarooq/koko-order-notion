// In-app confirm and question dialogs (instead of the browser's own pop-ups). Call from anywhere:
//   if (!(await confirmDialog('Delete this draft?'))) return
//   const reason = await promptDialog({ title: 'Void this expense?', label: 'Reason', required: true })
// <DialogHost /> is mounted once near the root of the app.
import { useEffect, useRef, useState } from 'react'
import { Modal, Field } from './kit'

let push = null
const queue = []
const open = (d) => new Promise((resolve) => { const item = { ...d, resolve }; if (push) push(item); else queue.push(item) })

// The first sentence (up to ? or .) is the title, the rest the explanation
function split(text) {
  const m = String(text).match(/^(.+?[?.])\s+([\s\S]+)$/)
  return m ? { title: m[1], message: m[2] } : { title: String(text), message: '' }
}
const DANGER = /^(delete|remove|void|reject|undo|ignore|reverse|discard|switch off)/i

export function confirmDialog(text, opts = {}) {
  const { title, message } = opts.title ? { title: opts.title, message: text } : split(text)
  return open({ kind: 'confirm', title, message, confirmLabel: opts.confirmLabel || 'Yes', cancelLabel: opts.cancelLabel || 'Cancel', danger: opts.danger ?? DANGER.test(title) })
}
// Resolves to the trimmed text, or null when cancelled (or left empty when required)
export function promptDialog({ title, message = '', label = '', defaultValue = '', placeholder = '', required = false, confirmLabel = 'Save', danger } = {}) {
  return open({ kind: 'prompt', title, message, label, defaultValue, placeholder, required, confirmLabel, cancelLabel: 'Cancel', danger: danger ?? DANGER.test(title || '') })
}

export function DialogHost() {
  const [current, setCurrent] = useState(null)
  const [value, setValue] = useState('')
  const input = useRef(null)
  const pending = useRef([])
  useEffect(() => {
    push = (item) => setCurrent((c) => { if (c) { pending.current.push(item); return c } return item })
    if (queue.length) { const [first, ...rest] = queue.splice(0); pending.current.push(...rest); setCurrent(first) }
    return () => { push = null }
  }, [])
  useEffect(() => { if (current) { setValue(current.defaultValue || ''); setTimeout(() => input.current?.focus(), 50) } }, [current])
  const close = (result) => {
    current?.resolve(result)
    setCurrent(pending.current.shift() || null)
  }
  if (!current) return null
  const isPrompt = current.kind === 'prompt'
  const ok = () => {
    if (!isPrompt) return close(true)
    const v = value.trim()
    if (current.required && !v) return input.current?.focus()
    close(v || null)
  }
  return (
    <Modal open onClose={() => close(isPrompt ? null : false)} size="sm" title={current.title}
      footer={<>
        <button className="btn-secondary" onClick={() => close(isPrompt ? null : false)}>{current.cancelLabel}</button>
        <button className={current.danger ? 'btn-primary bg-rose-700 hover:bg-rose-800' : 'btn-primary'} onClick={ok} disabled={isPrompt && current.required && !value.trim()}>{current.confirmLabel}</button>
      </>}>
      {(current.message || isPrompt) && (
        <div className="space-y-3 p-5 text-sm text-ink-soft">
          {current.message && <p className="whitespace-pre-line">{current.message}</p>}
          {isPrompt && (
            <Field label={current.label}>
              <input ref={input} className="input" value={value} placeholder={current.placeholder} onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok() } }} />
            </Field>
          )}
        </div>
      )}
    </Modal>
  )
}
