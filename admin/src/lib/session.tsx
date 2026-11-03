import { createContext, useContext } from 'react'
import type { Me } from './types'

export const SessionCtx = createContext<Me>({
  username: '', role: 'viewer', role_label: '', dev_mode: false, environment: '', is_owner: false, permissions: [], limits: {}, key: '',
})
export const useMe = () => useContext(SessionCtx)

/** Hides UI the admin can't use. The server checks every permission again on each request. */
export const hasPerm = (me: Me, ...perms: string[]) => me.is_owner || perms.some((p) => me.permissions.includes(p))
export const useCan = (...perms: string[]) => hasPerm(useMe(), ...perms)
/** can change the catalog/shop data (used by older pages for edit buttons) */
export const useCanManage = () => useCan('products.edit', 'orders.status')
