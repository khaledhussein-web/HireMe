import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getNotificationPreferences,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationPreferences,
} from '../api/platform.js'

const eventLabels = {
  registration_verified: 'Registration verification',
  application_submitted: 'Application submitted',
  application_status_changed: 'Application status changed',
  candidate_shortlisted: 'Candidate shortlisted',
  interview_scheduled: 'Interview scheduled',
  interview_updated: 'Interview updated',
  new_matching_job: 'New matching job',
  job_deadline_approaching: 'Job deadline approaching',
  employer_approved: 'Employer approved',
  subscription_expiring: 'Subscription expiring',
}

function timeAgo(value) {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function NotificationCenter() {
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [preferences, setPreferences] = useState(null)
  const [eventTypes, setEventTypes] = useState([])
  const [message, setMessage] = useState('')

  async function refresh() {
    try {
      const data = await getNotifications()
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch {
      // The next poll will recover after a transient API failure.
    }
  }

  useEffect(() => {
    const initialRefresh = window.setTimeout(refresh, 0)
    const poll = window.setInterval(refresh, 30000)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [])

  async function openSettings() {
    setShowSettings(true)
    setMessage('')
    if (preferences) return
    const data = await getNotificationPreferences()
    setPreferences(data.preferences)
    setEventTypes(data.eventTypes)
  }

  async function openNotification(notification) {
    if (!notification.readAt) {
      await markNotificationRead(notification.id)
      setNotifications((current) => current.map((item) =>
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
      ))
      setUnreadCount((current) => Math.max(0, current - 1))
    }
    if (notification.actionUrl?.startsWith('/')) {
      setIsOpen(false)
      navigate(notification.actionUrl)
    }
  }

  async function readAll() {
    await markAllNotificationsRead()
    setUnreadCount(0)
    setNotifications((current) => current.map((item) => ({
      ...item,
      readAt: item.readAt ?? new Date().toISOString(),
    })))
  }

  async function savePreferences() {
    const data = await saveNotificationPreferences(preferences)
    setPreferences((current) => ({ ...current, ...data.preferences }))
    setMessage(data.message)
  }

  function toggleEvent(type) {
    setPreferences((current) => ({
      ...current,
      eventPreferences: {
        ...current.eventPreferences,
        [type]: current.eventPreferences?.[type] === false,
      },
    }))
  }

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        type="button"
        className="notification-trigger"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">Notifications</span>
        {unreadCount > 0 && <b>{unreadCount > 99 ? '99+' : unreadCount}</b>}
      </button>
      {isOpen && (
        <section className="notification-panel" aria-label="Notification center">
          <header>
            <div>
              <strong>{showSettings ? 'Notification settings' : 'Notifications'}</strong>
              <span>{showSettings ? 'Choose how HireMe contacts you.' : `${unreadCount} unread`}</span>
            </div>
            <button type="button" onClick={showSettings ? () => setShowSettings(false) : openSettings}>
              {showSettings ? 'Back' : 'Settings'}
            </button>
          </header>
          {showSettings ? (
            <div className="notification-settings">
              {!preferences ? <p>Loading settings...</p> : (
                <>
                  <label>
                    <input type="checkbox" checked={preferences.inAppEnabled} onChange={() => setPreferences((current) => ({ ...current, inAppEnabled: !current.inAppEnabled }))} />
                    <span><strong>In-app notifications</strong><small>Show alerts in this notification center.</small></span>
                  </label>
                  <label>
                    <input type="checkbox" checked={preferences.emailEnabled} onChange={() => setPreferences((current) => ({ ...current, emailEnabled: !current.emailEnabled }))} />
                    <span><strong>Email notifications</strong><small>Send alerts to your account email.</small></span>
                  </label>
                  <label className="future-channel">
                    <input type="checkbox" disabled />
                    <span><strong>SMS</strong><small>Planned for a future release.</small></span>
                  </label>
                  <label className="future-channel">
                    <input type="checkbox" disabled />
                    <span><strong>WhatsApp</strong><small>Planned for a future release.</small></span>
                  </label>
                  <div className="notification-event-list">
                    <strong>Events</strong>
                    {eventTypes.map((type) => (
                      <label key={type}>
                        <input type="checkbox" checked={preferences.eventPreferences?.[type] !== false} onChange={() => toggleEvent(type)} />
                        <span>{eventLabels[type] ?? type.replaceAll('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                  {message && <p className="notification-save-message">{message}</p>}
                  <button className="btn btn-primary" type="button" onClick={savePreferences}>Save preferences</button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="notification-feed">
                {notifications.map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    className={notification.readAt ? '' : 'unread'}
                    onClick={() => openNotification(notification)}
                  >
                    <span className="notification-dot" aria-hidden="true" />
                    <span>
                      <strong>{notification.title}</strong>
                      {notification.body && <small>{notification.body}</small>}
                      <time>{timeAgo(notification.createdAt)}</time>
                    </span>
                  </button>
                ))}
                {notifications.length === 0 && <p>No notifications yet.</p>}
              </div>
              {unreadCount > 0 && <button className="notification-read-all" type="button" onClick={readAll}>Mark all as read</button>}
            </>
          )}
        </section>
      )}
    </div>
  )
}
