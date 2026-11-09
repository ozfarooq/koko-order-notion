import { motion, MotionConfig } from 'framer-motion'

// Shared motion language: short, soft, and switched off for "reduce motion" users (reducedMotion="user")
export const ease = [0.22, 1, 0.36, 1]

export function MotionProvider({ children }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.28, ease }}>{children}</MotionConfig>
}

// Wraps each page: fades/slides in on navigation
export function Page({ children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// Lists: children stagger in
export const listParent = { hidden: {}, show: { transition: { staggerChildren: 0.035 } } }
export const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease } },
}

export { motion }
