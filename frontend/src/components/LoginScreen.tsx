import { useState } from 'react';
import { login, register } from '../api';

export function LoginScreen({onLogin}:{onLogin:(user:any)=>void}) {
  const [mobile,setMobile]=useState(''), [password,setPassword]=useState('');
  const [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const submit=async(create:boolean)=>{
    setBusy(true); setError('');
    try { if(create) await register(mobile,password); onLogin(await login(mobile,password)); }
    catch(e) { setError(e instanceof Error?e.message:'登录失败'); }
    finally {setBusy(false);}
  };
  return <form className="screen-profile-container" onSubmit={e=>{e.preventDefault();void submit(false);}}>
    <h2>登录旅行规划</h2>
    <p>登录后可生成、保存和调整自己的行程。</p>
    <p><label>手机号 <input type="tel" autoComplete="tel" required pattern="1[0-9]{10}" value={mobile} onChange={e=>setMobile(e.target.value)} /></label></p>
    <p><label>密码 <input type="password" autoComplete="current-password" required minLength={8} maxLength={72} value={password} onChange={e=>setPassword(e.target.value)} /></label></p>
    {error&&<p role="alert">{error}</p>}
    <button disabled={busy} type="submit">{busy?'处理中…':'登录'}</button>{' '}
    <button disabled={busy||!/^1\d{10}$/.test(mobile)||password.length<8} type="button" onClick={()=>void submit(true)}>注册并登录</button>
  </form>;
}
