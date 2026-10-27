// PST_EDGE_FUNCTION_PATCH_V7_EMAIL_BRAND_REFRESH
// v60 (Oct 27, 2026, Patriot): short phone-first emails (status, progress bar, only the needed action, one button); hard-coded SMS gateway removed.
// v52 (owner app 5.8): adds the owner's "Promos in emails" block (pst_email_promos) above the footer of customer emails.
// Everything else is unchanged from v51. A promo problem never stops an email: on any error the block is left out.
// On the staging project (STAGING below) it never emails or texts anyone; on the live project STAGING is false.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Patriot Peptides USA <onboarding@resend.dev>";
const REPLY_TO_EMAIL = Deno.env.get("REPLY_TO_EMAIL") || "info@patriotpeptides-usa.com";
const SITE_URL = Deno.env.get("SITE_URL") || "https://www.patriotpeptides-usa.com";
const LOGO_URL = Deno.env.get("LOGO_URL") || `${SITE_URL}/img/patriot-lockup.png`;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN_ALERT_EMAILS = Deno.env.get("ADMIN_ALERT_EMAILS") || "";
const STAGING = (Deno.env.get("STAGING") ?? "") === "1";

const NAVY = "#12266E";
const NAVY_DEEP = "#0A1020";
const GOLD = "#C8102E";
const GOLD_SOFT = "#C7CCD4";
const INK = "#24303b";
const MUTED = "#66717d";
const LINE = "#e8e3da";
const SOFT = "#faf9f6";
const SUCCESS = "#0f8a3b";
const WARNING = "#b7791f";
const DANGER = "#bd0000";
const BODY_FONT = "Arial,Helvetica,sans-serif";
const HEADING_FONT = "Georgia,'Times New Roman',serif";

const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

type Rec = Record<string, any>;
function esc(v:any){return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");}
function money(v:any){const n=Number(v||0); return `$${n.toFixed(2)}`;}
function first(...vals:any[]){for(const v of vals){const s=String(v ?? "").trim(); if(s) return s;} return "";}
function num(v:any){if(typeof v==="number") return Number.isFinite(v)?v:0; const n=Number(String(v??"").replace(/[^0-9.-]/g,"")); return Number.isFinite(n)?n:0;}
function cleanName(v:any){const s=String(v??"").trim().replace(/\s+/g," "); if(!s||s.includes("@")) return ""; if(["customer","guest","unknown","n/a","na","none","null","undefined"].includes(s.toLowerCase())) return ""; return s;}
function joined(...vals:any[]){return cleanName(vals.map(v=>String(v??"").trim()).filter(Boolean).join(" "));}
function customerName(payload:Rec, order:Rec, profile:Rec={}){const vals=[payload.customer_name,payload.customerName,payload.name,order.customer_name,order.customerName,order.name,profile.full_name,profile.name,joined(payload.first_name,payload.last_name),joined(payload.firstName,payload.lastName),joined(order.first_name,order.last_name),joined(profile.first_name,profile.last_name)]; for(const v of vals){const n=cleanName(v); if(n) return n;} return "Customer";}
async function profileFor(email:string,payload:Rec,order:Rec){if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY) return {}; const uid=first(payload.user_id,payload.userId,payload.customer_id,payload.customerId,payload.profile_id,payload.profileId,order.user_id,order.userId,order.customer_id,order.customerId,order.profile_id,order.profileId); const headers={apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`}; async function get(url:string){const r=await fetch(url,{headers}); if(!r.ok) return {}; const rows=await r.json().catch(()=>[]); return Array.isArray(rows)&&rows[0]?rows[0]:{};} try{if(uid){const row=await get(`${SUPABASE_URL}/rest/v1/customer_profiles?select=*&user_id=eq.${encodeURIComponent(uid)}&limit=1`); if(Object.keys(row).length) return row;} if(email){const row=await get(`${SUPABASE_URL}/rest/v1/customer_profiles?select=*&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`); if(Object.keys(row).length) return row;}}catch(_){} return {};}
function items(payload:Rec){const raw=payload.items||payload.order_items||payload.orderItems||payload.lineItems||[]; return Array.isArray(raw)?raw:[];}
function itemName(i:Rec){return first(i.display_name,i.product_name,i.productName,i.name,i.displayName,i.label,i.sku,i.product_key,"Product");}
async function enrichEmailItems(raw:Rec[]):Promise<Rec[]>{
  if(!raw.length||!SUPABASE_SERVICE_ROLE_KEY)return raw;
  const ids=[...new Set(raw.map(i=>first(i.product_id,i.productId)).filter(Boolean))];
  const keys=[...new Set(raw.map(i=>first(i.product_key,i.productKey)).filter(Boolean))];
  const headers={apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`};
  const catalog:Rec[]=[];
  for(const [field,values] of [["id",ids],["product_key",keys]] as [string,string[]][]){
    if(!values.length)continue;
    const query=values.map(v=>'"'+v.replace(/"/g,"")+'"').join(",");
    const url=`${SUPABASE_URL}/rest/v1/product_catalog?select=id,product_key,display_name,sort_name,strength&${field}=in.(${encodeURIComponent(query)})`;
    const res=await fetch(url,{headers});if(res.ok){const records=await res.json();if(Array.isArray(records))catalog.push(...records);}
  }
  return raw.map(i=>{
    const product=catalog.find(p=>(i.product_id||i.productId)&&String(p.id)===String(i.product_id||i.productId))||
      catalog.find(p=>first(i.product_key,i.productKey)&&String(p.product_key)===first(i.product_key,i.productKey));
    if(!product)return i;
    return {...i,display_name:first(product.display_name,i.display_name,i.product_name),sort_name:first(product.sort_name,i.sort_name),strength:first(product.strength,i.product_strength,i.strength),product_key:first(product.product_key,i.product_key)};
  });
}
function itemQty(i:Rec){return Number(i.quantity ?? i.qty ?? i.count ?? 1)||1;}
function itemPrice(i:Rec){return Number(i.unit_price ?? i.unitPrice ?? i.price ?? i.sale_price ?? 0)||0;}
function itemTotal(i:Rec){const n=Number(i.line_total ?? i.lineTotal ?? i.total ?? NaN); return Number.isNaN(n)?itemQty(i)*itemPrice(i):n;}
function stripQrText(v:any){return String(v??"").split(/\r?\n/).map(s=>s.trim()).filter(line=>{if(!line)return false; const l=line.toLowerCase(); const has=/https?:\/\/|data:image\//i.test(line); const qr=l.includes("qr")||l.includes("image"); if(has&&qr) return false; if(/^data:image\//i.test(line)) return false; return true;}).join("\n");}
function payment(payload:Rec){const p=payload.payment||payload.payment_method_details||payload.paymentDetails||{}; const method=first(payload.payment_method,payload.paymentMethod,payload.selected_payment_method,payload.selectedPaymentMethod,p.method,p.display_name,p.displayName,p.name); const status=first(payload.payment_status,payload.paymentStatus,p.status,"Pending"); const accountLabel=first(payload.payment_account_label,payload.paymentAccountLabel,p.account_label,p.accountLabel,"Send payment to"); const accountValue=first(payload.payment_account,payload.paymentAccount,p.payment_destination,p.destination,p.account,p.accountValue,p.handle,p.wallet,p.email,p.phone); const qrCodeUrl=first(payload.payment_qr_url,payload.paymentQrUrl,p.qr_url,p.qrCodeUrl,p.qr_image_url); const instructions=stripQrText(first(payload.payment_instructions,payload.paymentInstructions,p.instructions,p.customerInstructions,payload.statusNote)); return {method,status,accountLabel,accountValue,qrCodeUrl,instructions,show:Boolean(method||accountValue||qrCodeUrl||instructions)};}
function trackingUrl(carrier:string,num:string,given=""){if(given) return given; if(!num) return ""; const n=encodeURIComponent(num); const c=String(carrier||"").toLowerCase(); if(c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`; if(c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`; if(c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`; return "";}

// ---- v52: partner / sale promos at the bottom of customer emails (owner app → More → Promos in emails) ----
const PROMO_TYPES_DEFAULT=["order_received","order_placed","payment_accepted","order_packed","order_shipped","shipment_update","order_delivered","shipment_delivered"];
function promoLink(u:string,type:string){try{const x=new URL(u); if(!/^https?:$/.test(x.protocol))return ""; if(!x.searchParams.has("utm_source")){x.searchParams.set("utm_source","patriotpeptides");x.searchParams.set("utm_medium","email");x.searchParams.set("utm_campaign",type||"order_email");} return x.toString();}catch(_){return "";}}
async function loadPromos(type:string, override:any){
  try{
    let rows:any[]=[];
    if(Array.isArray(override)) rows=override;
    else{
      if(!SUPABASE_SERVICE_ROLE_KEY) return [];
      const r=await fetch(`${SUPABASE_URL}/rest/v1/pst_email_promos?select=*&enabled=eq.true&order=sort.asc,created_at.asc&limit=10`,{headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`}});
      if(!r.ok) return []; rows=await r.json().catch(()=>[]); if(!Array.isArray(rows)) return [];
    }
    const today=new Date().toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
    return rows.filter(p=>p&&p.enabled!==false&&String(p.headline||"").trim()
      &&(!p.starts_on||String(p.starts_on)<=today)&&(!p.ends_on||String(p.ends_on)>=today)
      &&(Array.isArray(p.show_on)&&p.show_on.length?p.show_on:PROMO_TYPES_DEFAULT).includes(type)).slice(0,2);
  }catch(_){return [];}
}
function promoHtml(list:any[],type:string){
  if(!list.length) return "";
  return `<div style="margin-top:26px">${list.map(p=>{const link=promoLink(String(p.link_url||""),type), logo=String(p.logo_url||"").trim(); const kick=p.kind==="sale"?"From Patriot Peptides USA":"From our partner";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid ${GOLD_SOFT};border-radius:8px;background:${SOFT};margin:0 0 12px;font-family:${BODY_FONT}"><tr>${/^https:\/\//i.test(logo)?`<td width="64" style="width:64px;padding:14px 0 14px 14px;vertical-align:top"><img src="${esc(logo)}" alt="${esc(p.name||"")}" width="48" height="48" style="display:block;width:48px;height:48px;border-radius:10px;border:0"></td>`:""}<td style="padding:14px;vertical-align:top;color:${INK}"><p style="margin:0 0 4px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">${esc(kick)}</p><p style="margin:0 0 4px;font-family:${HEADING_FONT};font-size:18px;color:${NAVY}">${esc(p.headline)}</p>${p.body?`<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${INK}">${esc(p.body)}</p>`:""}${link?`<a href="${esc(link)}" style="display:inline-block;color:${NAVY};font-weight:700;font-size:14px;text-decoration:underline">${esc(p.link_text||"Learn more")}</a>`:""}</td></tr></table>`;}).join("")}</div>`;
}
function promoText(list:any[],type:string){return list.map(p=>[p.headline,p.body,promoLink(String(p.link_url||""),type)].filter(Boolean).join(" · ")).join("\n");}
async function configuredPaymentMethods(){
  if(!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Payment configuration is unavailable.");
  const response=await fetch(`${SUPABASE_URL}/rest/v1/site_payment_options?select=payment_methods&id=eq.1&limit=1`,{headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`}});
  if(!response.ok)throw new Error("Unable to load payment methods.");
  const rows=await response.json();const value=rows?.[0]?.payment_methods;
  const methods=Array.isArray(value)?value:(typeof value==="string"?JSON.parse(value):[]);
  return methods.filter((method:any)=>method.enabled===true||String(method.enabled).toLowerCase()==="true");
}
function emailList(v:any){return [...new Set(String(v??"").split(/[;,\n]/).map(e=>e.trim().toLowerCase()).filter(e=>e&&e.includes("@")))];}
async function adminEmails(){const manual=emailList(ADMIN_ALERT_EMAILS); if(manual.length)return manual; if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)return []; try{const r=await fetch(`${SUPABASE_URL}/rest/v1/admin_users?select=*`,{headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`}}); if(!r.ok)return []; const rows=await r.json().catch(()=>[]); return [...new Set((Array.isArray(rows)?rows:[]).filter(x=>x?.email&&(x.is_active===true||x.active===true||x.is_admin===true)).map(x=>String(x.email).trim().toLowerCase()).filter(x=>x.includes("@")))];}catch(_){return [];}}
async function sendMail(to:string[],subject:string,html:string,text:string){if(STAGING){console.log("STAGING email (not sent):",subject);return {ok:true,status:200,data:{id:null,staging:true}};}const recipients=[...new Set(to.map(e=>String(e||"").trim()).filter(Boolean))]; if(!recipients.length)return {ok:true,status:200,data:{skipped:true},skipped:true}; const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:FROM_EMAIL,to:recipients,reply_to:REPLY_TO_EMAIL,subject,html,text})}); const data=await r.json().catch(()=>({})); return {ok:r.ok,status:r.status,data};}

// ---- v60 (Oct 27, 2026): short, phone-first customer emails. One status line, a 4-step progress bar, only the
// action that matters for this email (pay / track / fix), items only where they help, one button to the order.
const RED = "#C8102E", BLUE = "#12266E", PAGE = "#f3f4f6";
const STEPS = ["Placed", "Paid", "Shipped", "Delivered"];
function cfg(type:string, orderNo:string){
  const o=orderNo?` · ${orderNo}`:"";
  // label, heading, subject, intro, tone, showTracking, showPayment, step (0-4, -1 none), items ("full"|"list"|"none"), preheader
  const c:any={
    account_created:["Account created","Welcome aboard","Welcome to Patriot Peptides USA","Your account is ready. Sign in any time to order and track your orders.",BLUE,false,false,-1,"none","Your account is ready."],
    inquiry_received:["Request received","We got your request",`We got your request${o}`,"Thanks. We'll look it over and get back to you shortly.",BLUE,false,false,-1,"full","We'll get back to you shortly."],
    order_placed:["Order placed","Thanks for your order",`Order received${o}`,"We've got it. Send payment below and we'll get it moving.",BLUE,false,true,1,"full","Send payment to get it moving."],
    order_received:["Order received","Thanks for your order",`Order received${o}`,"We've got it. Send payment below and we'll get it moving.",BLUE,false,true,1,"full","Send payment to get it moving."],
    awaiting_payment:["Payment needed","Payment needed",`Payment needed${o}`,"Your order is waiting on payment. It only takes a minute.",WARNING,false,true,1,"full","Your order is waiting on payment."],
    payment_accepted:["Payment received","Payment received",`Payment received${o}`,"Thank you. Your order is in line to be packed.",SUCCESS,false,false,2,"none","Your order is in line to be packed."],
    payment_declined:["Payment declined","We couldn't accept that payment",`Payment declined${o}`,"Reply to this email and we'll help you sort it out.",DANGER,false,false,1,"none","Reply and we'll help sort it out."],
    payment_issue:["Payment question","Quick question about your payment",`Quick payment question${o}`,"Reply to this email and we'll get it squared away.",WARNING,false,false,1,"none","We need to check one thing on your payment."],
    order_processing:["Processing","We're getting it ready",`Getting your order ready${o}`,"Your order is being prepared now.",BLUE,false,false,2,"none","Your order is being prepared."],
    order_packed:["Packed","Packed and ready to ship",`Packed${o}`,"Your order is packed and goes out with the next carrier pickup.",BLUE,false,false,2,"none","It goes out with the next pickup."],
    order_shipped:["Shipped","Your order shipped",`Shipped${o}`,"It's on the way.",SUCCESS,true,false,3,"list","It's on the way."],
    shipment_update:["Shipped","Part of your order shipped",`Part of your order shipped${o}`,"This box is on the way. Anything still pending ships separately.",SUCCESS,true,false,3,"list","This box is on the way."],
    order_delivered:["Delivered","Delivered",`Delivered${o}`,"Your order arrived. Thanks for choosing Patriot Peptides USA.",SUCCESS,false,false,4,"none","Your order arrived."],
    shipment_delivered:["Delivered","Delivered",`Delivered${o}`,"This shipment arrived. Anything else on the order is tracked separately.",SUCCESS,true,false,4,"list","This shipment arrived."],
    partial_shipment_delivered:["Partly delivered","Part of your order arrived",`Part of your order arrived${o}`,"The rest is on backorder and ships as soon as it's in.",SUCCESS,false,false,3,"list","The rest ships as soon as it's in."],
    order_rejected:["Not accepted","We couldn't complete this order",`We couldn't complete your order${o}`,"Reply to this email if you have any questions.",DANGER,false,false,-1,"none","Reply with any questions."],
    order_cancelled:["Cancelled","Order cancelled",`Order cancelled${o}`,"Your order has been cancelled. Reply to this email if that's a surprise.",DANGER,false,false,-1,"none","Your order has been cancelled."]};
  const x=c[type]||c.order_received;
  return {label:x[0],heading:x[1],subject:x[2],intro:x[3],tone:x[4],showTracking:x[5],showPayment:x[6],step:x[7],items:x[8],pre:x[9]};
}
function shell(inner:string, pre:string){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head><body style="margin:0;padding:0;background:${PAGE}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE}">${esc(pre)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE}"><tr><td align="center" style="padding:16px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;font-family:${BODY_FONT};color:${INK}">
<tr><td style="padding:18px 20px 14px;text-align:center"><a href="${esc(SITE_URL)}" style="text-decoration:none"><img src="${esc(LOGO_URL)}" alt="Patriot Peptides USA" height="38" style="display:inline-block;height:38px;width:auto;max-width:220px;border:0"></a></td></tr>
<tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:${RED}">&nbsp;</td></tr><tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:${BLUE}">&nbsp;</td></tr>
${inner}
<tr><td style="padding:16px 20px 20px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.5;text-align:center">Questions? Just reply to this email.<br>For research use only. Not for human consumption.</td></tr>
</table></td></tr></table></body></html>`;}
function btn(href:string,label:string,bg=BLUE){return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px auto 4px"><tr><td style="border-radius:8px;background:${bg}"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:8px">${esc(label)}</a></td></tr></table>`;}
function progress(step:number){if(step<0)return ""; return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 4px;table-layout:fixed"><tr>${STEPS.map((s,i)=>{const done=i<step, cur=i===step-1||(step===0&&i===0); const col=done?BLUE:"#d6d9de"; return `<td style="padding:0 2px;vertical-align:top;text-align:center"><div style="height:5px;border-radius:3px;background:${col}"></div><div style="margin-top:6px;font-size:11px;letter-spacing:.04em;color:${done?BLUE:MUTED};font-weight:${cur?"700":"400"}">${s}</div></td>`;}).join("")}</tr></table>`;}
function lineName(i:Rec){const s=first(i.strength,i.product_strength,i.productStrength); const n=itemName(i); return s&&!n.toLowerCase().includes(s.toLowerCase())?`${n} ${s}`:n;}
function itemList(rows:Rec[], prices:boolean){if(!rows.length)return ""; return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;border-top:1px solid ${LINE}">${rows.map(i=>`<tr><td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:14px;line-height:1.35"><span style="color:${MUTED}">${esc(itemQty(i))}×</span>&nbsp; ${esc(lineName(i))}</td>${prices?`<td align="right" style="padding:9px 0 9px 8px;border-bottom:1px solid ${LINE};font-size:14px;white-space:nowrap">${money(itemTotal(i))}</td>`:""}</tr>`).join("")}</table>`;}
function totalRows(a:any){const r=(l:string,v:string,st="")=>`<tr><td style="padding:3px 0;font-size:14px;color:${MUTED};${st}">${l}</td><td align="right" style="padding:3px 0;font-size:14px;white-space:nowrap;${st}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0">${r("Subtotal",money(a.subtotal))}${a.discount?r("Savings","−"+money(a.discount),`color:${SUCCESS}`):""}${r("Shipping",a.shipping?money(a.shipping):"Free")}${a.tax?r("Tax",money(a.tax)):""}<tr><td style="padding:8px 0 0;font-size:16px;font-weight:700;color:${BLUE}">Total</td><td align="right" style="padding:8px 0 0;font-size:16px;font-weight:700;color:${BLUE};white-space:nowrap">${money(a.total)}</td></tr></table>`;}
function card(inner:string,bg="#f7f8fa",bd=LINE){return `<div style="margin:16px 0 0;padding:14px 16px;border-radius:10px;background:${bg};border:1px solid ${bd}">${inner}</div>`;}
function payCard(p:any, orderNo:string, total:number){if(!p.show)return "";
  const to=p.accountValue?`<p style="margin:0 0 4px;font-size:15px">Send <b>${money(total)}</b> by <b>${esc(p.method||"your payment app")}</b> to</p><p style="margin:0 0 10px;font-size:20px;font-weight:700;color:${BLUE};word-break:break-all">${esc(p.accountValue)}</p>`:`<p style="margin:0 0 10px;font-size:15px">Send <b>${money(total)}</b>${p.method?` by <b>${esc(p.method)}</b>`:""}.</p>`;
  return card(`<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${RED}">How to pay</p>${to}<p style="margin:0;font-size:14px;line-height:1.45">In the payment note, put only <b>${esc(orderNo||"your order number")}</b>. Please don't list any product names.</p>${p.instructions&&!/order (number|#)|PP-O/i.test(p.instructions)?`<p style="margin:8px 0 0;font-size:13px;line-height:1.45;color:${MUTED};white-space:pre-line">${esc(p.instructions)}</p>`:""}${p.qrCodeUrl?`<p style="margin:12px 0 0;text-align:center"><img src="${esc(p.qrCodeUrl)}" alt="Scan to pay" width="160" style="width:160px;max-width:60%;height:auto;border-radius:8px;border:1px solid ${LINE};background:#fff;padding:6px"></p>`:""}`,"#fff8f8","#f3cdd3");}
function trackCard(a:any){if(!(a.trackingNumber||a.trackingUrl))return ""; return card(`<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${SUCCESS}">Tracking${a.carrier?` · ${esc(a.carrier)}`:""}</p>${a.trackingNumber?`<p style="margin:0;font-size:15px;font-weight:700;word-break:break-all">${esc(a.trackingNumber)}</p>`:""}${a.trackingUrl?btn(a.trackingUrl,"Track package",SUCCESS):""}`,"#f1f9f4","#cfe8d8");}
function customerEmail(args:any){
  const c=cfg(args.type,args.orderNo), account=args.type==="account_created", inquiry=args.type==="inquiry_received";
  const items=Array.isArray(args.items)?args.items:[], rest=Array.isArray(args.remainingItems)?args.remainingItems:[];
  const meta=args.orderNo?`<p style="margin:6px 0 0;font-size:13px;color:${MUTED}">${inquiry?"Request":"Order"} <b style="color:${INK}">${esc(args.orderNo)}</b>${args.total&&!account?` · ${money(args.total)}`:""}</p>`:"";
  const note=args.rejectionReason?card(`<p style="margin:0;font-size:14px;line-height:1.5">${esc(args.rejectionReason)}</p>`,"#fff8e6","#f0dcae"):"";
  const list=c.items==="full"?itemList(items,true)+totalRows(args):c.items==="list"?itemList(items,false):"";
  const pending=rest.length?card(`<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Still to come</p>${rest.map((i:Rec)=>`<p style="margin:2px 0;font-size:14px">${esc(itemQty(i))}× ${esc(lineName(i))}</p>`).join("")}`):"";
  const cta=account?btn(`${SITE_URL}/login.html`,"Sign in"):inquiry?"":btn(`${SITE_URL}/account.html#orders`,"View your order");
  const inner=`<tr><td style="padding:22px 20px 6px"><h1 style="margin:0;font-size:22px;line-height:1.25;font-weight:700;color:${c.tone}">${esc(c.heading)}</h1><p style="margin:8px 0 0;font-size:15px;line-height:1.5">${args.name?`Hi ${esc(args.name)}, ${esc(c.intro.charAt(0).toLowerCase()+c.intro.slice(1))}`:esc(c.intro)}</p>${meta}${progress(c.step)}${c.showPayment?payCard(args.payment,args.orderNo,args.total):""}${c.showTracking?trackCard(args):""}${note}${list}${pending}${cta}${args.promoHtml||""}</td></tr>`;
  const t=[c.heading+(args.orderNo?` · ${args.orderNo}`:""),"",args.name?`Hi ${args.name}, ${c.intro.charAt(0).toLowerCase()+c.intro.slice(1)}`:c.intro];
  if(c.showPayment&&args.payment?.show)t.push("",`Send ${money(args.total)}${args.payment.method?` by ${args.payment.method}`:""}${args.payment.accountValue?` to ${args.payment.accountValue}`:""}.`,`Put only ${args.orderNo||"your order number"} in the payment note.`);
  if(c.showTracking&&args.trackingNumber)t.push("",`Tracking${args.carrier?` (${args.carrier})`:""}: ${args.trackingNumber}`,args.trackingUrl||"");
  if(args.rejectionReason)t.push("",args.rejectionReason);
  if(c.items!=="none"&&items.length)t.push("",...items.map((i:Rec)=>`${itemQty(i)}x ${lineName(i)}${c.items==="full"?` ${money(itemTotal(i))}`:""}`));
  if(c.items==="full")t.push(`Total: ${money(args.total)}`);
  if(rest.length)t.push("","Still to come:",...rest.map((i:Rec)=>`${itemQty(i)}x ${lineName(i)}`));
  if(!inquiry)t.push("",account?`${SITE_URL}/login.html`:`View your order: ${SITE_URL}/account.html#orders`);
  if(args.promoText)t.push("",args.promoText);
  t.push("","Questions? Just reply to this email.");
  return {subject:c.subject,html:shell(inner,c.pre),text:t.filter((x,i,a)=>x!==""||a[i-1]!=="").join("\n"),label:c.label};
}
function adminHtml(a:any){
  const inquiry=a.inquiry===true;
  const inner=`<tr><td style="padding:22px 20px 6px"><p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${RED}">${inquiry?"New request":"New order"}</p><h1 style="margin:0;font-size:22px;line-height:1.25;color:${BLUE}">${esc(a.orderNo||"")}${!inquiry?` · ${money(a.total)}`:""}</h1><p style="margin:8px 0 0;font-size:15px">${esc(a.name||"Customer")} · <a href="mailto:${esc(a.email)}" style="color:${BLUE}">${esc(a.email)}</a></p>${!inquiry&&a.payment?.method?`<p style="margin:4px 0 0;font-size:14px;color:${MUTED}">Paying by ${esc(a.payment.method)} · ${esc(a.payment.status||"Pending")}</p>`:""}${itemList(a.items||[],!inquiry)}${!inquiry?totalRows(a):""}${btn(`${SITE_URL}/owner.html#orders`,"Open in the owner app")}</td></tr>`;
  return shell(inner, inquiry?"New request in your owner app.":`New order ${a.orderNo||""} · ${money(a.total)}`);
}

serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  try{
    const payload=await req.json().catch(()=>({}));
    if(payload.action==="payment_options"){
      const configured=await configuredPaymentMethods();
      return new Response(JSON.stringify({ok:true,methods:configured.map((m:any)=>({id:m.id,label:m.label})).filter((m:any)=>m.id&&m.label)}),{headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

    const order=payload.order||payload.orderData||payload.savedOrder||payload;
    const type=first(payload.type,payload.email_type,payload.emailType,"order_received");
    const preview=payload.preview_only===true||payload.previewOnly===true||payload.mode==="preview";
    if(!preview&&!STAGING&&!RESEND_API_KEY)throw new Error("Missing RESEND_API_KEY environment variable.");
    const email=first(payload.to,payload.email,payload.customer_email,payload.customerEmail,order.customer_email,order.customerEmail,order.email,order.shipping_email,order.contact_email,order.billing_email);
    if(!email)throw new Error("Missing customer email for order email.");
    const orderNo=first(payload.order_number,payload.orderNumber,payload.order_id,payload.orderId,payload.id,order.order_number,order.orderNumber,order.order_id,order.id);
    const prof=await profileFor(email,payload,order);
    const name=customerName(payload,order,prof);
    const customerNumberRaw=first(payload.customerNumber,payload.customer_number,order.customerNumber,order.customer_number,prof.customer_number);
    const customerNumber=customerNumberRaw?String(customerNumberRaw).startsWith("PP-C")?String(customerNumberRaw):`PP-C${customerNumberRaw}`:"";
    const its=await enrichEmailItems(items(payload));
    const subtotal=num(first(payload.subtotal,order.subtotal,payload.order_subtotal,order.order_subtotal,"0"));
    const discount=num(first(payload.discount_total,payload.discountTotal,payload.discount,order.discount_total,"0"));
    const shipping=num(first(payload.shipping_total,payload.shippingTotal,payload.shipping,order.shipping_total,order.shipping,"0"));
    const tax=num(first(payload.tax_total,payload.taxTotal,payload.tax,order.tax_total,order.tax,"0"));
    const total=num(first(payload.total,payload.order_total,payload.orderTotal,order.total,order.order_total,"0"));
    const carrier=first(payload.carrier,payload.tracking_carrier,payload.trackingCarrier,order.carrier,order.tracking_carrier);
    const trackingNumber=first(payload.trackingNumber,payload.tracking_number,payload.tracking,order.tracking_number,order.tracking);
    const turl=trackingUrl(carrier,trackingNumber,first(payload.trackingUrl,payload.tracking_url,order.tracking_url));
    let selectedMethod:any=null;
    const selectedPaymentLabel=first(payload.paymentMethod,payload.payment_method,order.payment_method);
    if(type==="order_received"&&selectedPaymentLabel){
      const configured=await configuredPaymentMethods();
      selectedMethod=configured.find((m:any)=>String(m.label).toLowerCase()===selectedPaymentLabel.toLowerCase()||String(m.id).toLowerCase()===selectedPaymentLabel.toLowerCase());
      if(!selectedMethod)throw new Error("The selected payment method is no longer available.");
    }
    const pay=payment({...order,...payload,...(selectedMethod?{
      paymentMethod:selectedMethod.label,
      paymentInstructions:selectedMethod.instructions||"",
      paymentQrUrl:selectedMethod.qrUrl||selectedMethod.qr_url||"",
      paymentAccount:selectedMethod.account||selectedMethod.handle||selectedMethod.wallet||"",
      paymentAccountLabel:selectedMethod.accountLabel||"Send payment to"
    }:{})});
    const promos=await loadPromos(String(type),preview&&Array.isArray(payload.promos_override)?payload.promos_override:null);
    const built=customerEmail({promoHtml:promoHtml(promos,String(type)),promoText:promoText(promos,String(type)),type,name,email,customerNumber,orderNo,items:its,subtotal,discount,shipping,tax,total,payment:pay,carrier,trackingNumber,trackingUrl:turl,remainingItems:Array.isArray(payload.remainingItems)?payload.remainingItems:[],rejectionReason:first(payload.rejectionReason,payload.rejection_reason,order.rejection_reason)});
    if(preview)return new Response(JSON.stringify({ok:true,preview_only:true,preview:{type,label:built.label,to:email,subject:built.subject,html:built.html,text:built.text}}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    const result=await sendMail([email],built.subject,built.html,built.text);
    if(!result.ok)return new Response(JSON.stringify({ok:false,error:result.data?.message||result.data?.error||"Customer email failed.",resend:result.data}),{status:result.status,headers:{...corsHeaders,"Content-Type":"application/json"}});
    let admin:any={ok:true,skipped:true,data:{}};
    let recipients:string[]=[];
    if(["order_received","order_placed","inquiry_received"].includes(String(type))){
      recipients=await adminEmails();
      if(recipients.length){
        const inquiry=String(type)==="inquiry_received";
        const html=adminHtml({orderNo,name,email,items:its,subtotal,discount,shipping,tax,total,payment:pay,inquiry});
        const subject=inquiry?`New request${orderNo?` · ${orderNo}`:""}`:`New order${orderNo?` · ${orderNo}`:""} · ${money(total)} · ${name||email}`;
        const textParts=[subject,`Customer: ${name}`,`Email: ${email}`];
        if(!inquiry)textParts.push(`Total: ${money(total)}`);
        textParts.push(`Owner app: ${SITE_URL}/owner.html#orders`);
        admin=await sendMail(recipients,subject,html,textParts.join("\n"));
      }
    }
    // v60: the hard-coded email-to-text gateway (a PST phone number) is removed. Jeff gets new-order alerts as app push notifications (pst-push).
    const sms:any={ok:true,skipped:true};
    return new Response(JSON.stringify({ok:true,type,email_id:result.data?.id||null,sms_alert:{ok:sms.ok,skipped:sms.skipped===true,email_id:sms.data?.id||null,error:sms.ok?null:(sms.data?.message||sms.data?.error||sms.error||'SMS gateway submission failed.')},admin_alert:{ok:admin.ok,skipped:admin.skipped===true,recipients,email_id:admin.data?.id||null,error:admin.ok?null:(admin.data?.message||admin.data?.error||"Admin alert email failed.")}}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:err?.message||String(err)}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
});
