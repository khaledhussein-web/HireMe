import { useEffect, useMemo, useState } from 'react'
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
} from '../api/auth.js'
import { AuthContext } from './auth-context.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isActive = true

    async function restoreSession() {
      try {
        const data = await getCurrentUser()
        if (isActive) setUser(data.user)
      } catch (error) {
        if (error.status === 401) {
          try {
            const data = await refreshSession()
            if (isActive) setUser(data.user)
          } catch {
            if (isActive) setUser(null)
          }
        } else if (isActive) {
          setUser(null)
        }
      } finally {
        if (isActive) setIsLoading(false)
      }
    }

    restoreSession()
    return () => {
      isActive = false
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      isLoading,
      async login(credentials) {
        const data = await loginRequest(credentials)
        setUser(data.user)
        return data.user
      },
      async logout() {
        await logoutRequest()
        setUser(null)
      },
      updateUser(nextUser) {
        setUser(nextUser)
      },
    }),
    [isLoading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
