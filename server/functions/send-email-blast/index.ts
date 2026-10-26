import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")||"";
const SUPABASE_ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const SUPABASE_SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY")||"";
const FROM_EMAIL=Deno.env.get("FROM_EMAIL")||"Patriot Peptides USA <onboarding@resend.dev>";
const REPLY_TO_EMAIL=Deno.env.get("REPLY_TO_EMAIL")||"info@patriotpeptides-usa.com";
const SITE_URL=Deno.env.get("SITE_URL")||"https://www.patriotpeptides-usa.com";
const LOGO_URL=Deno.env.get("LOGO_URL")||`${SITE_URL}/img/patriot-lockup.png`;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
type Rec=Record<string,any>;

function json(body:Rec,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}})}
function esc(v:any){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function lines(v:any){return esc(v).split(/\r?\n/).filter(Boolean).map(line=>`<p style="margin:0 0 13px;color:#24303b;font-size:16px;line-height:1.7">${line}</p>`).join("")}
function textLines(v:any){return String(v??"").trim()}
function email(v:any){const value=String(v??"").trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?value:""}
function safeUrl(v:any){const value=String(v??"").trim();if(!value)return"";const candidate=/^[a-z][a-z0-9+.-]*:\/\//i.test(value)?value:`https://${value}`;try{const parsed=new URL(candidate);return ["http:","https:"].includes(parsed.protocol)?parsed.toString():""}catch{return""}}
function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,"0")).join("")}
async function unsubscribeToken(address:string){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(address)))}
function equalToken(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
function serviceHeaders(){return{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,"Content-Type":"application/json"}}
async function rest(path:string,options:RequestInit={}){const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{...serviceHeaders(),...(options.headers||{})}});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.message||data?.error||`Database request failed (${response.status}).`);return data}
async function unsubscribePage(req:Request,url:URL){
  const address=email(url.searchParams.get("email"));const token=String(url.searchParams.get("token")||"");
  if(!address||!token||!equalToken(token,await unsubscribeToken(address)))return new Response("Invalid unsubscribe link.",{status:400,headers:{...cors,"Content-Type":"text/plain; charset=utf-8"}});
  await rest(`customer_profiles?email=ilike.${encodeURIComponent(address)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({marketing_opt_in:false,marketing_opt_out:true,marketing_opt_out_at:new Date().toISOString(),marketing_source:"email_unsubscribe"})});
  await rest(`manual_customers?email=ilike.${encodeURIComponent(address)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({marketing_opt_in:false,marketing_opt_out:true,marketing_opt_out_at:new Date().toISOString(),marketing_source:"email_unsubscribe"})});
  const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Email Preferences</title></head><body style="margin:0;background:#f4f2ed;font-family:Arial,Helvetica,sans-serif;color:#24303b"><main style="max-width:620px;margin:60px auto;background:#fff;border:1px solid #C7CCD4;padding:34px;text-align:center"><img src="${esc(LOGO_URL)}" alt="Patriot Peptides USA" style="max-width:245px;width:70%;height:auto;margin:0 auto 25px"><h1 style="font-family:Georgia,'Times New Roman',serif;color:#12266E;font-weight:500">You have been unsubscribed</h1><p>${esc(address)} will no longer receive Patriot Peptides USA email blasts.</p><p style="margin-top:22px"><a href="${esc(SITE_URL)}/account.html" style="color:#12266E;font-weight:700">Manage account preferences</a></p></main></body></html>`;
  return new Response(html,{status:200,headers:{...cors,"Content-Type":"text/html; charset=utf-8"}});
}
async function requireAdmin(req:Request){
  const authorization=req.headers.get("Authorization")||"";if(!authorization.startsWith("Bearer "))throw new Error("Admin sign-in required.");
  const userResponse=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_ANON_KEY,Authorization:authorization}});const user=await userResponse.json().catch(()=>null);if(!userResponse.ok||!user?.id)throw new Error("Admin session is invalid or expired.");
  const query=new URLSearchParams({select:"user_id,email,is_active",is_active:"eq.true",limit:"1",or:`(user_id.eq.${user.id},email.ilike.${user.email||""})`});
  const admins=await rest(`admin_users?${query.toString()}`);if(!Array.isArray(admins)||!admins.length)throw new Error("Admin access denied.");return user;
}
async function uploadBlastImage(payload:Rec){
 const mime=String(payload.image_type||"").toLowerCase();
 if(!["image/png","image/jpeg","image/webp","image/gif"].includes(mime))throw new Error("Invalid image format.");
 const base64=String(payload.image_base64||"");
 if(!base64||base64.length>7100000)throw new Error("Image must be less than 5 MB.");
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
 if(bytes.length>5242880)throw new Error("Image must be less than 5 MB.");
 const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[mime];
 const key=crypto.randomUUID()+"."+ext;
 const response=await fetch(SUPABASE_URL+"/storage/v1/object/email-blast-images/"+key,{method:"POST",headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+SUPABASE_SERVICE_ROLE_KEY,"Content-Type":mime,"x-upsert":"false"},body:bytes});
 if(!response.ok)throw new Error("Image upload failed.");
 return json({ok:true,image_url:SUPABASE_URL+"/storage/v1/object/public/email-blast-images/"+key});
}
function cleanContent(payload:Rec){
  const content={subject:String(payload.subject||"").trim().slice(0,140),category:String(payload.category||"Patriot Peptides USA Update").trim().slice(0,80),headline:String(payload.headline||"").trim().slice(0,140),message:String(payload.message||"").trim().slice(0,3000),featureLabel:String(payload.feature_label||"").trim().slice(0,80),featureTitle:String(payload.feature_title||"").trim().slice(0,160),featureBody:String(payload.feature_body||"").trim().slice(0,3000),buttonText:String(payload.button_text||"").trim().slice(0,60),buttonUrl:safeUrl(payload.button_url),finalNote:String(payload.final_note||"").trim().slice(0,1200),imageUrl:safeUrl(payload.image_url)};
  if(!content.subject||!content.headline||!content.message)throw new Error("Subject, headline, and opening message are required.");if(Boolean(content.buttonText)!==Boolean(content.buttonUrl))throw new Error("Button text and button link must be provided together.");return content;
}
function buildEmail(content:Rec,profile:Rec,unsubscribeUrl:string){
  const name=String(profile.first_name||"").trim()||"there";
  const feature=content.featureTitle||content.featureBody?`<div style="margin:24px 0;padding:24px;border:1px solid #e8e3da;border-radius:8px;background:#faf9f6">${content.featureLabel?`<p style="margin:0 0 8px;color:#C8102E;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase">${esc(content.featureLabel)}</p>`:""}${content.featureTitle?`<h2 style="margin:0 0 12px;color:#12266E;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:1.25;font-weight:500">${esc(content.featureTitle)}</h2>`:""}${lines(content.featureBody)}</div>`:"";
  const image=content.imageUrl?`<p style="margin:22px 0"><img src="${esc(content.imageUrl)}" alt="Email image" width="560" style="display:block;width:560px;max-width:100%;height:auto;border:0;border-radius:8px"></p>`:"";
  const button=content.buttonText?`<p style="margin:26px 0"><a href="${esc(content.buttonUrl)}" style="display:inline-block;padding:13px 22px;border-radius:5px;background:#12266E;color:#fff;text-decoration:none;font-weight:700">${esc(content.buttonText)}</a></p>`:"";
  const html=`<!doctype html><html><body style="margin:0;padding:0;background:#f4f2ed"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f4f2ed"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#fff;border:1px solid #e3ded3;border-radius:12px;overflow:hidden"><tr><td align="center" style="padding:28px 24px 24px;border-bottom:1px solid #C7CCD4"><a href="${esc(SITE_URL)}"><img src="${esc(LOGO_URL)}" width="245" alt="Patriot Peptides USA" style="display:block;width:245px;max-width:72%;height:auto;border:0"></a></td></tr><tr><td style="padding:36px 34px 38px;font-family:Arial,Helvetica,sans-serif"><p style="margin:0 0 12px;color:#C8102E;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${esc(content.category)}</p><h1 style="margin:0 0 18px;color:#12266E;font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1.12;font-weight:500">${esc(content.headline)}</h1><p style="margin:0 0 15px;color:#24303b;font-size:16px;line-height:1.7">Hi ${esc(name)},</p>${lines(content.message)}${image}${feature}${button}${content.finalNote?`<div style="margin-top:20px;color:#66717d;font-size:13px;line-height:1.65">${lines(content.finalNote)}</div>`:""}</td></tr><tr><td style="padding:24px 34px 26px;background:#12266E;font-family:Arial,Helvetica,sans-serif"><p style="margin:0 0 8px;color:#fff;font-size:14px;font-weight:700">Patriot Peptides USA</p><p style="margin:0 0 14px;color:#C7CCD4;font-size:13px;line-height:1.6">Products and information are provided for research purposes only. Not for human consumption.</p><p style="margin:0;color:#c9d1d9;font-size:12px;line-height:1.7"><a href="${esc(SITE_URL)}" style="color:#fff;text-decoration:none">patriotpeptides-usa.com</a> &nbsp;|&nbsp; <a href="mailto:${esc(REPLY_TO_EMAIL)}" style="color:#fff;text-decoration:none">${esc(REPLY_TO_EMAIL)}</a></p><p style="margin:14px 0 0;color:#9eabb7;font-size:11px;line-height:1.6">You are receiving this email because you subscribed to Patriot Peptides USA updates. <a href="${esc(unsubscribeUrl)}" style="color:#C7CCD4">Unsubscribe</a></p></td></tr></table></td></tr></table></body></html>`;
  const text=[content.headline,`Hi ${name},`,textLines(content.message),content.featureTitle,textLines(content.featureBody),content.buttonText&&content.buttonUrl?`${content.buttonText}: ${content.buttonUrl}`:"",textLines(content.finalNote),`Unsubscribe: ${unsubscribeUrl}`].filter(Boolean).join("\n\n");return{html,text};
}
async function eligibleProfiles(requested:string[]){
  const [rows,manual]=await Promise.all([rest("customer_profiles?select=email,first_name,last_name,marketing_opt_in,marketing_opt_out"),rest("manual_customers?select=email,first_name,last_name,marketing_opt_in,marketing_opt_out")]);
  const primary=(Array.isArray(rows)?rows:[]),additional=(Array.isArray(manual)?manual:[]);
  const byEmail=new Map([...additional,...primary].filter(row=>row.marketing_opt_in===true&&row.marketing_opt_out!==true&&email(row.email)).map(row=>[email(row.email),row]));
  // Any unsubscribed matching address blocks sending, even if duplicated in another source.
  const blocked=new Set([...primary,...additional].filter(row=>row.marketing_opt_out===true&&email(row.email)).map(row=>email(row.email)));
  return requested.filter(address=>!blocked.has(address)).map(address=>byEmail.get(address)).filter(Boolean);
}
async function sendBatches(messages:Rec[]){const ids:Rec[]=[];for(let index=0;index<messages.length;index+=100){const response=await fetch("https://api.resend.com/emails/batch",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(messages.slice(index,index+100))});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data?.message||data?.error||`Email provider rejected a batch (${response.status}).`);ids.push(...(Array.isArray(data?.data)?data.data:[]))}return ids}

serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  const url=new URL(req.url);
  try{
    if(url.searchParams.has("email")&&url.searchParams.has("token"))return await unsubscribePage(req,url);
    if(req.method!=="POST")return json({ok:false,error:"Method not allowed."},405);
    const admin=await requireAdmin(req);const payload=await req.json().catch(()=>({}));if(payload.action==="upload_image")return await uploadBlastImage(payload);const content=cleanContent(payload);
    if(payload.preview_only===true){const previewAddress=email(admin.email)||"preview@example.com";const token=await unsubscribeToken(previewAddress);const unsubscribeUrl=`${SUPABASE_URL}/functions/v1/send-email-blast?email=${encodeURIComponent(previewAddress)}&token=${token}`;return json({ok:true,preview:{subject:content.subject,...buildEmail(content,{first_name:"Preview"},unsubscribeUrl)}})}
    if(!RESEND_API_KEY)throw new Error("Email provider is not configured.");
    const requested=[...new Set((Array.isArray(payload.recipients)?payload.recipients:[]).map(email).filter(Boolean))];if(!requested.length)throw new Error("Select at least one recipient.");if(requested.length>500)throw new Error("A single blast is limited to 500 selected recipients.");
    const profiles=await eligibleProfiles(requested);if(!profiles.length)throw new Error("None of the selected recipients are currently subscribed.");
    const messages=[];for(const profile of profiles){const address=email(profile.email);const token=await unsubscribeToken(address);const unsubscribeUrl=`${SUPABASE_URL}/functions/v1/send-email-blast?email=${encodeURIComponent(address)}&token=${token}`;const built=buildEmail(content,profile,unsubscribeUrl);messages.push({from:FROM_EMAIL,to:[address],reply_to:REPLY_TO_EMAIL,subject:content.subject,html:built.html,text:built.text,headers:{"List-Unsubscribe":`<${unsubscribeUrl}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"},tags:[{name:"message_type",value:"email_blast"}]})}
    const ids=await sendBatches(messages);return json({ok:true,sent_count:profiles.length,excluded_count:requested.length-profiles.length,email_ids:ids.map(item=>item?.id).filter(Boolean)});
  }catch(error){return json({ok:false,error:error instanceof Error?error.message:String(error)},error instanceof Error&&/required|select|provided|limited|subscribed/i.test(error.message)?400:500)}
});
