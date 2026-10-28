let token = '';
export const isLoggedIn = () => Boolean(token);
export const clearSession = () => { token = ''; };
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2,'0')).join('');
export async function request(path: string, method = 'GET', body?: unknown, key = crypto.randomUUID()): Promise<any> {
  const headers: Record<string,string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const raw = body === undefined ? undefined : JSON.stringify(body);
  if (['POST','PATCH','PUT'].includes(method)) {
    headers['Idempotency-Key'] = key;
    if (token) {
      const timestamp = new Date().toISOString(), nonce = crypto.randomUUID();
      const bytes = new TextEncoder();
      const digest = hex(await crypto.subtle.digest('SHA-256',bytes.encode(raw ?? '{}')));
      const signingKey = await crypto.subtle.importKey('raw',bytes.encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      headers['X-Timestamp']=timestamp; headers['X-Nonce']=nonce;
      headers['X-Signature']=hex(await crypto.subtle.sign('HMAC',signingKey,bytes.encode(`${method}\n/v1${path}\n${timestamp}\n${nonce}\n${digest}`)));
    }
  }
  const response = await fetch(`/v1${path}`, {method, headers, body:raw});
  if(response.status===204) return null;
  const result = await response.json();
  if(response.status===401) clearSession();
  if(!response.ok || result.code!==0) throw new Error(`${result.message ?? '请求失败'}（追踪号：${result.trace_id ?? '-'}）`);
  return result.data;
}
export async function login(mobile: string,password: string) {
  const data=await request('/auth/login','POST',{mobile,password});
  token=data.token;
  return request(`/users/${data.user_id}`);
}
export const register = (mobile: string,password: string) => request('/auth/register','POST',{mobile,password});
export async function logout() { await request('/auth/logout','POST',{}); clearSession(); }
