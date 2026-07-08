import axios from 'axios'

// Base URL is read from Vite env (.env). Falls back to local dev so
// running `npm run dev` without a .env still works out of the box.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

let accessToken = null

export function setToken(t) { accessToken = t }
export function clearToken() { accessToken = null }

api.interceptors.request.use((config) => {
  // Never send the literal string 'demo' — it's not a valid JWT
  if (accessToken && accessToken !== 'demo') config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

let refreshing = null

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    // Never retry the refresh endpoint itself — avoid infinite loop
    if (original.url?.includes('/auth/refresh') || original.url?.includes('/auth/login')) {
      return Promise.reject(err)
    }
    if (err.response?.status === 401 && !original._retry) {
      // No real token — don't attempt refresh, let the store fallback handle it
      if (!accessToken || accessToken === 'demo') {
        return Promise.reject(err)
      }
      original._retry = true
      if (!refreshing) {
        refreshing = api.post('/auth/refresh').then(r => {
          setToken(r.data.accessToken)
          refreshing = null
        }).catch(() => {
          clearToken()
          refreshing = null
          window.location.href = '/login'
        })
      }
      await refreshing
      return api(original)
    }
    return Promise.reject(err)
  }
)

export default api
