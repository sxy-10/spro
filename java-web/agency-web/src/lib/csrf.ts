/** XSRF-TOKEN 是本项目唯一允许 JS 读取的 Cookie，它只是 CSRF token，不含任何身份信息。 */
export function readCookie(name: string): string | null {
  const prefix = `${name}=`
  const hit = document.cookie.split('; ').find((item) => item.startsWith(prefix))
  return hit ? decodeURIComponent(hit.slice(prefix.length)) : null
}

export function xsrfToken(): string {
  return readCookie('XSRF-TOKEN') ?? ''
}
