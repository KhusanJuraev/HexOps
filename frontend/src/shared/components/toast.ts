import { createContext, useContext } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastInput {
  message: string
  tone?: ToastTone
}

export type ShowToast = (toast: ToastInput) => void

export const ToastContext = createContext<ShowToast | null>(null)

/** `const toast = useToast(); toast({ message, tone: 'error' })` */
export function useToast(): ShowToast {
  const show = useContext(ToastContext)
  if (!show) throw new Error('useToast must be used inside ToastProvider')
  return show
}
