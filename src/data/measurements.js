// Tailoring measurements (inches), stored in orders.measurements (JSONB) next to free-text notes.
// Older orders only have `additionalNotes`; every field here is optional.
export const MEASUREMENT_FIELDS = [
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'shoulder', label: 'Shoulder' },
  { key: 'armhole', label: 'Armhole' },
  { key: 'sleeveLength', label: 'Sleeve length' },
  { key: 'bicep', label: 'Bicep' },
  { key: 'wrist', label: 'Wrist' },
  { key: 'shirtLength', label: 'Shirt length' },
  { key: 'neck', label: 'Neck' },
  { key: 'trouserLength', label: 'Trouser length' },
  { key: 'thigh', label: 'Thigh' },
  { key: 'bottom', label: 'Trouser bottom' },
]

export const SIZE_OPTIONS = ['X-Small', 'Small', 'Medium', 'Large', 'X-Large', 'Custom']

export const hasMeasurements = (m) =>
  !!m && (MEASUREMENT_FIELDS.some((f) => m[f.key]) || !!(m.additionalNotes || '').trim())
