export function userDestination(user) {
  if (!user) return '/login'
  return user.nextRoute || '/'
}
