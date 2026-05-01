import { create } from 'zustand'
import type { AIAlert, ApprovalItem, ChatMessage } from '@/types'
import { generateId } from '@/lib/utils'

interface AppStore {
  // Sidebar
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void

  // Alerts
  alerts: AIAlert[]
  resolveAlert: (id: string) => void

  // Approvals
  approvals: ApprovalItem[]
  approveItem: (id: string) => void
  rejectItem: (id: string, notes?: string) => void

  // Chat
  chatMessages: ChatMessage[]
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string
  updateChatMessage: (id: string, updates: Partial<ChatMessage>) => void
  clearChat: () => void

  // Global loading
  globalLoading: boolean
  setGlobalLoading: (v: boolean) => void

  // Notifications
  notifications: Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>
  addNotification: (message: string, type: 'success' | 'error' | 'info') => void
  removeNotification: (id: string) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),

  alerts: [],
  resolveAlert: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) =>
        a.id === id ? { ...a, resolved: true, resolved_at: new Date().toISOString() } : a
      ),
    })),

  approvals: [],
  approveItem: (id) =>
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id ? { ...a, status: 'approved' as const, reviewed_at: new Date().toISOString() } : a
      ),
    })),
  rejectItem: (id, notes) =>
    set((s) => ({
      approvals: s.approvals.map((a) =>
        a.id === id
          ? { ...a, status: 'rejected' as const, reviewed_at: new Date().toISOString(), reviewer_notes: notes }
          : a
      ),
    })),

  chatMessages: [],
  addChatMessage: (msg) => {
    const id = generateId()
    set((s) => ({
      chatMessages: [
        ...s.chatMessages,
        { ...msg, id, timestamp: new Date().toISOString() },
      ],
    }))
    return id
  },
  updateChatMessage: (id, updates) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
    })),
  clearChat: () => set({ chatMessages: [] }),

  globalLoading: false,
  setGlobalLoading: (v) => set({ globalLoading: v }),

  notifications: [],
  addNotification: (message, type) => {
    const id = generateId()
    set((s) => ({ notifications: [...s.notifications, { id, message, type }] }))
    setTimeout(() => {
      get().removeNotification(id)
    }, 4000)
  },
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
}))
