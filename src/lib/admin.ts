export const ADMIN_CREDENTIALS = {
  email: import.meta.env.VITE_ADMIN_EMAIL ?? '',
  password: import.meta.env.VITE_ADMIN_PASSWORD ?? '',
} as const
