async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  })
  if (res.status === 401) { window.location.href = '/admin/login'; return }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  get:    (url)          => apiFetch(url),
  post:   (url, body)    => apiFetch(url, { method: 'POST', body }),
  put:    (url, body)    => apiFetch(url, { method: 'PUT', body }),
  delete: (url)          => apiFetch(url, { method: 'DELETE' }),
  upload: (url, formData)=> apiFetch(url, { method: 'POST', headers: {}, body: formData }),
}

let toastTimer
export function toast(message, type = 'success') {
  let el = document.getElementById('toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = message
  el.className = `show ${type}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000)
}
