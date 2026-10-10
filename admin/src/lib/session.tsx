import { createContext, useContext } from 'react'
import type { Me, Role } from './types'

export const SessionCtx = createContext<Me>({ username: '', role: 'support', role_label: '', dev_mode: false, environment: '' })
export const useMe = () => useContext(SessionCtx)
export const can = (role: Role, ...allowed: Role[]) => allowed.includes(role)
/** owner/admin can change the shop; support only works with tickets and reads data */
export const useCanManage = () => can(useMe().role, 'owner', 'admin')
