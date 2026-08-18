import type { CustomerServicePolicyRecord } from "@jarvis/shared";

export function customerWidgetScript(policy: CustomerServicePolicyRecord): string {
  const config = JSON.stringify({ name: policy.widgetName, welcome: policy.widgetWelcome }).replace(/</g, "\\u003c");
  return `(() => {
  if (window.__jarvisCustomerChat) return;
  window.__jarvisCustomerChat = true;
  const script = document.currentScript;
  const base = new URL(script.dataset.jarvisUrl || script.src, location.href).origin;
  const config = ${config};
  const host = document.createElement('div');
  host.id = 'jarvis-customer-chat';
  document.body.appendChild(host);
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = \`<style>
    :host{all:initial;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f7f8fb}
    button,input,textarea{font:inherit} *{box-sizing:border-box}
    .launcher{position:fixed;right:22px;bottom:22px;width:58px;height:58px;border:0;border-radius:18px;background:linear-gradient(145deg,#8b5cf6,#5b35cc);color:white;box-shadow:0 18px 50px rgba(56,31,128,.4);cursor:pointer;font-size:24px;z-index:2147483646}
    .panel{position:fixed;right:22px;bottom:92px;width:min(380px,calc(100vw - 28px));height:min(610px,calc(100vh - 120px));display:none;grid-template-rows:auto 1fr auto;border:1px solid rgba(255,255,255,.12);border-radius:22px;overflow:hidden;background:#12131a;box-shadow:0 30px 90px rgba(0,0,0,.48);z-index:2147483647}
    .panel.open{display:grid}.head{padding:18px 18px 15px;background:linear-gradient(135deg,rgba(139,92,246,.28),rgba(18,19,26,.8));border-bottom:1px solid rgba(255,255,255,.09)}
    .title{font-weight:700;font-size:15px}.online{margin-top:4px;color:#b9bac6;font-size:12px}.online:before{content:'';display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:#4ade80}
    .messages{overflow:auto;padding:18px;display:flex;flex-direction:column;gap:10px}.bubble{max-width:84%;padding:10px 12px;border-radius:15px;font-size:14px;line-height:1.45;white-space:pre-wrap}.agent{align-self:flex-start;background:#22232d;border:1px solid rgba(255,255,255,.08);border-bottom-left-radius:5px}.customer{align-self:flex-end;background:#7652df;border-bottom-right-radius:5px}
    .start{padding:14px;overflow:auto}.start p{margin:0 0 14px;color:#c8c9d2;font-size:14px;line-height:1.5}.field{width:100%;margin:0 0 9px;border:1px solid rgba(255,255,255,.11);border-radius:10px;background:#1b1c24;color:white;padding:10px 11px;outline:none}.field:focus{border-color:#8b5cf6}.start textarea{min-height:92px;resize:vertical}.primary{width:100%;border:0;border-radius:10px;padding:11px;background:#805adf;color:white;font-weight:650;cursor:pointer}.primary:disabled{opacity:.55}
    .composer{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,.09)}.composer textarea{flex:1;min-height:42px;max-height:110px;resize:none;margin:0}.send{width:44px;border:0;border-radius:11px;background:#805adf;color:white;cursor:pointer}.error{color:#fb7185;font-size:12px;margin-top:8px}
    @media(max-width:520px){.panel{right:14px;bottom:84px}.launcher{right:14px;bottom:14px}}
  </style><button class="launcher" aria-label="Open customer chat">✦</button><section class="panel" aria-label="Customer chat"><header class="head"><div class="title"></div><div class="online">Available now</div></header><div class="content"></div><div class="composer" hidden><textarea class="field" aria-label="Message" placeholder="Write a message…"></textarea><button class="send" aria-label="Send">➤</button></div></section>\`;
  const $ = (s) => root.querySelector(s); const panel=$('.panel'), content=$('.content'), composer=$('.composer');
  $('.title').textContent=config.name; $('.launcher').onclick=()=>panel.classList.toggle('open');
  let state; try{state=JSON.parse(localStorage.getItem('jarvis-chat')||'null')}catch{};
  const escapeHtml=(v)=>{const d=document.createElement('div');d.textContent=v;return d.innerHTML};
  const showStart=()=>{content.className='content start';content.innerHTML='<p>'+escapeHtml(config.welcome)+'</p><input class="field name" placeholder="Your name" maxlength="300"><input class="field email" type="email" placeholder="Email (optional)" maxlength="320"><textarea class="field first" placeholder="How can we help?"></textarea><button class="primary begin">Start conversation</button><div class="error"></div>';$('.begin').onclick=start};
  const render=(messages)=>{content.className='content messages';content.innerHTML='<div class="bubble agent">'+escapeHtml(config.welcome)+'</div>'+messages.filter(m=>m.direction!=='internal').map(m=>'<div class="bubble '+(m.direction==='outbound'?'agent':'customer')+'">'+escapeHtml(m.body)+'</div>').join('');content.scrollTop=content.scrollHeight;composer.hidden=false};
  async function request(path,init){const r=await fetch(base+path,{...init,headers:{'Content-Type':'application/json',...(init&&init.headers)}});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Chat is unavailable.');return r.json()}
  async function start(){const btn=$('.begin'),error=$('.error');btn.disabled=true;error.textContent='';try{const out=await request('/widget/conversations',{method:'POST',body:JSON.stringify({customerName:$('.name').value,customerEmail:$('.email').value,body:$('.first').value})});state={id:out.conversationId,token:out.token};localStorage.setItem('jarvis-chat',JSON.stringify(state));await poll()}catch(e){error.textContent=e.message}finally{btn.disabled=false}}
  async function poll(){if(!state)return showStart();try{const out=await request('/widget/conversations/'+encodeURIComponent(state.id)+'?token='+encodeURIComponent(state.token));render(out.messages)}catch{localStorage.removeItem('jarvis-chat');state=null;showStart()}}
  async function send(){const box=$('.composer textarea'),body=box.value.trim();if(!body)return;box.disabled=true;try{await request('/widget/conversations/'+encodeURIComponent(state.id)+'/messages',{method:'POST',body:JSON.stringify({token:state.token,body})});box.value='';await poll()}catch(e){alert(e.message)}finally{box.disabled=false;box.focus()}}
  $('.send').onclick=send;$('.composer textarea').onkeydown=(e)=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
  state?poll():showStart(); setInterval(()=>{if(state)poll()},2500);
})();`;
}

export function customerWidgetDemo(origin: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Jarvis chat demo</title><style>body{margin:0;min-height:100vh;background:radial-gradient(circle at 75% 15%,#2b1d55 0,transparent 34%),#0d0e13;color:#f7f8fb;font:16px Inter,system-ui;padding:8vw}.eyebrow{color:#a78bfa;text-transform:uppercase;letter-spacing:.14em;font-size:12px}.hero{max-width:720px;margin-top:20vh}h1{font-size:clamp(42px,7vw,82px);line-height:.95;margin:18px 0}p{max-width:560px;color:#b8bac5;line-height:1.7}</style></head><body><main class="hero"><div class="eyebrow">Live website preview</div><h1>Your customers can talk to Jarvis here.</h1><p>This is the embeddable support experience. Open the purple button to begin a persistent, real-time conversation.</p></main><script src="${origin}/widget/customer-chat.js" data-jarvis-url="${origin}" async></script></body></html>`;
}
