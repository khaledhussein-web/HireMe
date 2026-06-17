import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
  verifyEmail as verifyEmailRequest,
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

  const login = useCallback(async (credentials) => {
    const data = await loginRequest(credentials)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    await logoutRequest()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const data = await getCurrentUser()
    setUser(data.user)
    return data.user
  }, [])

  const verifyEmail = useCallback(async (token) => {
    const data = await verifyEmailRequest(token)
    setUser(data.user)
    return data
  }, [])

  const updateUser = useCallback((nextUser) => {
    setUser(nextUser)
  }, [])

  const value = useMemo(
    () => ({
      user,
      isLoading,
      login,
      logout,
      refreshUser,
      verifyEmail,
      updateUser,
    }),
    [
      isLoading,
      login,
      logout,
      refreshUser,
      updateUser,
      user,
      verifyEmail,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
