// PST_EDGE_FUNCTION_PATCH_V7_EMAIL_BRAND_REFRESH
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
const ADMIN_ORDERS_URL = Deno.env.get("ADMIN_ORDERS_URL") || `${SITE_URL}/admin.html`;

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
function itemDetails(i:Rec){const original=first(i.sort_name,i.sortName);const strength=first(i.strength,i.product_strength,i.productStrength);const key=first(i.product_key,i.productKey,i.item_number);return [original,strength?"Strength: "+strength:"",key?"Item #: "+key:""].filter(Boolean).map(esc).join("<br>");}
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
function payment(payload:Rec){const p=payload.payment||payload.payment_method_details||payload.paymentDetails||{}; const method=first(payload.payment_method,payload.paymentMethod,payload.selected_payment_method,payload.selectedPaymentMethod,p.method,p.display_name,p.displayName,p.name); const status=first(payload.payment_status,payload.paymentStatus,p.status,"Pending"); const accountLabel=first(payload.payment_account_label,payload.paymentAccountLabel,p.account_label,p.accountLabel,"Send payment to"); const accountValue=first(payload.payment_account,payload.paymentAccount,p.payment_destination,p.destination,p.account,p.accountValue,p.handle,p.wallet,p.email,p.phone); const qrCodeUrl=first(payload.payment_qr_url,payload.paymentQrUrl,p.qr_url,p.qrCodeUrl,p.qr_image_url); const instructions=stripQrText(first(payload.payment_instructions,payload.paymentInstructions,payment.payment_note,p.instructions,p.customerInstructions,payload.statusNote)); return {method,status,accountLabel,accountValue,qrCodeUrl,instructions,show:Boolean(method||accountValue||qrCodeUrl||instructions)};}
function trackingUrl(carrier:string,num:string,given=""){if(given) return given; if(!num) return ""; const n=encodeURIComponent(num); const c=String(carrier||"").toLowerCase(); if(c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`; if(c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`; if(c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`; return "";}
function cfg(type:string, orderNo:string){const s=orderNo?` #${orderNo}`:""; const c:any={account_created:["Account Created","Account Created","Welcome to Patriot Peptides USA","Your Patriot Peptides USA account has been created. If email confirmation is required, please confirm your email before logging in.",NAVY,false,false],inquiry_received:["Inquiry Received","Inquiry Received",`Patriot Peptides USA Inquiry Received${s}`,"We received your inquiry. Our team will review it and follow up.",NAVY,false,false],order_placed:["Order Placed","Order Placed",`Patriot Peptides USA Order Placed${s}`,"Your order has been placed and sent to our team for review.",NAVY,false,true],order_received:["Order Received","Order Received",`Patriot Peptides USA Order Received${s}`,"We received your order. It is currently pending review/payment verification.",NAVY,false,true],awaiting_payment:["Awaiting Payment","Awaiting Payment",`Payment Needed for Patriot Peptides USA Order${s}`,"Your order is awaiting payment. Please use the payment instructions below to complete payment.",WARNING,false,true],payment_accepted:["Payment Accepted","Payment Accepted",`Payment Accepted for Patriot Peptides USA Order${s}`,"Your payment has been received and accepted. Your order is now moving into processing.",SUCCESS,false,false],payment_declined:["Payment Declined","Payment Declined",`Payment Declined for Patriot Peptides USA Order${s}`,"Your payment could not be accepted. Please contact support so we can help resolve it.",DANGER,false,false],payment_issue:["Payment Needs Review","Payment Needs Review",`Payment Review Needed for Patriot Peptides USA Order${s}`,"We need to review or confirm your payment before the order can continue processing.",WARNING,false,false],order_processing:["Processing","Order Processing",`Patriot Peptides USA Order Processing${s}`,"Your order is now being processed.",NAVY,false,false],order_packed:["Packed","Order Packed",`Patriot Peptides USA Order Packed${s}`,"Your order has been packed and is awaiting carrier shipping.",NAVY,false,false],shipment_update:["Shipment Update","Shipment Confirmation",`Patriot Peptides USA Shipment Update${s}`,"Your package has shipped. Any items still pending will be sent separately.",SUCCESS,true,false],shipment_delivered:["Shipment Delivered","Your Shipment Has Been Delivered",`Patriot Peptides USA Shipment Delivered${s}`,"The items in this shipment have been delivered. Any other shipments or outstanding items are tracked separately.",SUCCESS,true,false],partial_shipment_delivered:["Partial Delivery","Part of Your Order Has Arrived",`Patriot Peptides USA Partial Delivery${s}`,"A portion of your order has been delivered. The remaining items are still on backorder and will ship separately when available.",SUCCESS,false,false],order_shipped:["Shipped","Your Order Has Shipped",`Patriot Peptides USA Order Shipped${s}`,"Your order has shipped. Tracking details are below.",SUCCESS,true,false],order_delivered:["Delivered","Order Delivered",`Patriot Peptides USA Order Delivered${s}`,"Your order has been marked delivered.",SUCCESS,true,false],order_rejected:["Rejected","Order Rejected",`Patriot Peptides USA Order Rejected${s}`,"Your order could not be accepted or completed. Contact us if you have questions.",DANGER,false,false],order_cancelled:["Cancelled","Order Cancelled",`Patriot Peptides USA Order Cancelled${s}`,"Your order has been cancelled. Contact us if you have questions.",DANGER,false,false]}; const x=c[type]||c.order_received; return {label:x[0],heading:x[1],subject:x[2],intro:x[3],tone:x[4],showTracking:x[5],showPayment:x[6]};}

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
function header(){return `<div style="padding:28px 24px 24px;text-align:center;border-bottom:1px solid ${GOLD_SOFT};background:#fff"><img src="${esc(LOGO_URL)}" alt="Patriot Peptides USA" style="display:block;max-width:250px;width:68%;height:auto;margin:0 auto"></div>`;}
function footer(){return `<div style="margin-top:28px;padding:16px;border-top:1px solid ${LINE};background:${SOFT};color:${MUTED};font-family:${BODY_FONT};font-size:13px;line-height:1.6">Products are listed for research purposes only. Not for human consumption.<br>Questions? Reply to this email or contact <a href="mailto:${esc(REPLY_TO_EMAIL)}" style="color:${NAVY};font-weight:700;text-decoration:none">${esc(REPLY_TO_EMAIL)}</a>.</div>`;}
function itemRows(rows:Rec[]){if(!rows.length)return `<tr><td colspan="4" style="padding:10px;border-bottom:1px solid ${LINE};color:${MUTED}">No line items were provided.</td></tr>`; return rows.map(i=>{const sku=first(i.sku,i.product_id,i.productKey,i.product_key); return `<tr><td width="52%" style="width:52%;padding:10px 8px;border-bottom:1px solid ${LINE};vertical-align:top;overflow-wrap:anywhere;word-break:break-word;color:${INK}"><strong>${esc(itemName(i))}</strong><br><span style="color:${MUTED};font-size:12px;line-height:1.5">${itemDetails(i)}</span></td><td width="12%" style="width:12%;padding:10px 4px;border-bottom:1px solid ${LINE};text-align:center;white-space:nowrap;color:${INK}">${esc(itemQty(i))}</td><td width="18%" style="width:18%;padding:10px 4px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;color:${INK}">${money(itemPrice(i))}</td><td width="18%" style="width:18%;padding:10px 4px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;font-weight:800;color:${NAVY}">${money(itemTotal(i))}</td></tr>`}).join("");}
function orderTable(rows:Rec[]){return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid ${LINE};font-family:${BODY_FONT}"><colgroup><col width="52%"><col width="12%"><col width="18%"><col width="18%"></colgroup><thead><tr style="background:${SOFT};color:${NAVY}"><th width="52%" style="width:52%;padding:10px 8px;text-align:left;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Item</th><th width="12%" style="width:12%;padding:10px 4px;text-align:center;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Qty</th><th width="18%" style="width:18%;padding:10px 4px;text-align:right;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Unit</th><th width="18%" style="width:18%;padding:10px 4px;text-align:right;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Total</th></tr></thead><tbody>${itemRows(rows)}</tbody></table>`;}
function inquiryItemRows(rows:Rec[]){if(!rows.length)return `<tr><td colspan="2" style="padding:10px;border-bottom:1px solid ${LINE};color:${MUTED}">No requested items were provided.</td></tr>`; return rows.map(i=>{const sku=first(i.sku,i.product_id,i.productKey,i.product_key); return `<tr><td width="82%" style="width:82%;padding:10px 8px;border-bottom:1px solid ${LINE};vertical-align:top;overflow-wrap:anywhere;word-break:break-word;color:${INK}"><strong>${esc(itemName(i))}</strong><br><span style="color:${MUTED};font-size:12px;line-height:1.5">${itemDetails(i)}</span></td><td width="18%" style="width:18%;padding:10px 8px;border-bottom:1px solid ${LINE};text-align:center;white-space:nowrap;color:${INK}">${esc(itemQty(i))}</td></tr>`}).join("");}
function inquiryTable(rows:Rec[]){return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid ${LINE};font-family:${BODY_FONT}"><colgroup><col width="82%"><col width="18%"></colgroup><thead><tr style="background:${SOFT};color:${NAVY}"><th width="82%" style="width:82%;padding:10px 8px;text-align:left;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Requested Item</th><th width="18%" style="width:18%;padding:10px 8px;text-align:center;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Qty</th></tr></thead><tbody>${inquiryItemRows(rows)}</tbody></table>`;}
function inquiryPricedRows(rows:Rec[]){if(!rows.length)return `<tr><td colspan="4" style="padding:10px;border-bottom:1px solid ${LINE};color:${MUTED}">No requested items were provided.</td></tr>`; return rows.map(i=>{const sku=first(i.sku,i.product_id,i.productKey,i.product_key); return `<tr><td width="52%" style="width:52%;padding:10px 8px;border-bottom:1px solid ${LINE};vertical-align:top;overflow-wrap:anywhere;word-break:break-word;color:${INK}"><strong>${esc(itemName(i))}</strong>${sku?`<br><span style="color:${MUTED};font-size:12px">Item: ${esc(sku)}</span>`:""}</td><td width="12%" style="width:12%;padding:10px 4px;border-bottom:1px solid ${LINE};text-align:center;white-space:nowrap;color:${INK}">${esc(itemQty(i))}</td><td width="18%" style="width:18%;padding:10px 4px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;color:${INK}">${money(itemPrice(i))}</td><td width="18%" style="width:18%;padding:10px 4px;border-bottom:1px solid ${LINE};text-align:right;white-space:nowrap;font-weight:800;color:${NAVY}">${money(itemTotal(i))}</td></tr>`}).join("");}
function inquiryPricedTable(rows:Rec[], subtotal:number, shipping:number, total:number){return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid ${LINE};font-family:${BODY_FONT}"><colgroup><col width="52%"><col width="12%"><col width="18%"><col width="18%"></colgroup><thead><tr style="background:${SOFT};color:${NAVY}"><th width="52%" style="width:52%;padding:10px 8px;text-align:left;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Requested Item</th><th width="12%" style="width:12%;padding:10px 4px;text-align:center;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Qty</th><th width="18%" style="width:18%;padding:10px 4px;text-align:right;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Price</th><th width="18%" style="width:18%;padding:10px 4px;text-align:right;border-bottom:1px solid ${GOLD_SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Est. Total</th></tr></thead><tbody>${inquiryPricedRows(rows)}</tbody></table><div style="margin-top:16px;border-top:1px solid ${GOLD_SOFT};padding-top:12px;font-family:${BODY_FONT};color:${INK}"><p style="margin:5px 0;text-align:right"><strong>Merchandise:</strong> ${money(subtotal)}</p><p style="margin:5px 0;text-align:right"><strong>Shipping:</strong> ${shipping===0?"Free":money(shipping)}</p><p style="margin:12px 0 0;text-align:right;font-size:18px;color:${NAVY}"><strong>Estimated Total:</strong> ${money(total)}</p><p style="margin:8px 0 0;text-align:right;font-size:12px;line-height:1.5;color:${MUTED}">Pricing is provided for informational purposes and may change when our team follows up.</p></div>`;}
function totals(p:{subtotal:number;discount:number;shipping:number;tax:number;total:number}){return `<div style="margin-top:18px;border-top:1px solid ${GOLD_SOFT};padding-top:14px;max-width:100%;box-sizing:border-box;font-family:${BODY_FONT};color:${INK}"><p style="margin:6px 0;text-align:right"><strong>Subtotal:</strong> ${money(p.subtotal)}</p>${p.discount?`<p style="margin:6px 0;text-align:right;color:${SUCCESS}"><strong>Discount:</strong> -${money(p.discount)}</p>`:""}<p style="margin:6px 0;text-align:right"><strong>Shipping:</strong> ${money(p.shipping)}</p><p style="margin:6px 0;text-align:right"><strong>Estimated Tax:</strong> ${money(p.tax)}</p><p style="margin:12px 0 0;text-align:right;font-size:20px;color:${NAVY}"><strong>Grand Total:</strong> ${money(p.total)}</p></div>`;}
function paymentBlock(p:any, orderNo:string){if(!p.show)return ""; return `<div style="margin:22px 0;padding:18px;border:1px solid ${GOLD_SOFT};border-radius:8px;background:${SOFT};font-family:${BODY_FONT};color:${INK}"><h2 style="margin:0 0 10px;font-family:${HEADING_FONT};font-size:21px;font-weight:500;color:${NAVY}">Payment Instructions</h2>${p.method?`<p style="margin:6px 0"><strong>Payment Method:</strong> ${esc(p.method)}</p>`:""}${p.status?`<p style="margin:6px 0"><strong>Payment Status:</strong> ${esc(p.status)}</p>`:""}${p.accountValue?`<p style="margin:6px 0"><strong>${esc(p.accountLabel)}:</strong> ${esc(p.accountValue)}</p>`:""}${p.instructions?`<p style="margin:12px 0 0;line-height:1.5;white-space:pre-line">${esc(p.instructions)}</p>`:""}<p style="margin:12px 0 0;line-height:1.5"><strong>Please include your order number:</strong> ${esc(orderNo||"your order number")}</p>${p.qrCodeUrl?`<div style="margin-top:16px"><div style="margin:0 0 12px;padding:12px 14px;border:1px solid #bd0000;border-radius:6px;background:#fff5f5;color:#8a0000;font-weight:800;line-height:1.45"><strong>Important:</strong> Do not list peptides or peptide products anywhere in the payment notes. Use only your order number if a payment note is required.</div><div style="text-align:center"><p style="margin:0 0 8px;font-weight:700;color:${NAVY}">Scan to pay</p><img src="${esc(p.qrCodeUrl)}" alt="Payment QR code" style="max-width:220px;width:100%;height:auto;border:1px solid ${LINE};border-radius:8px;background:#fff;padding:8px"></div></div>`:""}</div>`;}
function customerEmail(args:any){
  const c=cfg(args.type,args.orderNo);
  const account=args.type==="account_created";
  const inquiry=args.type==="inquiry_received";
  const shipment=args.type==="shipment_update"||args.type==="partial_shipment_delivered"||args.type==="shipment_delivered";
  const track=c.showTracking&&(args.trackingNumber||args.trackingUrl||args.carrier)?`<div style="margin:18px 0;padding:16px;border-radius:8px;background:#f0f9f4;border:1px solid rgba(15,138,59,.22);font-family:${BODY_FONT};color:${INK}"><h2 style="margin:0 0 10px;font-family:${HEADING_FONT};font-size:20px;font-weight:500;color:${SUCCESS}">Tracking Details</h2>${args.carrier?`<p style="margin:6px 0"><strong>Carrier:</strong> ${esc(args.carrier)}</p>`:""}${args.trackingNumber?`<p style="margin:6px 0"><strong>Tracking Number:</strong> ${esc(args.trackingNumber)}</p>`:""}${args.trackingUrl?`<p style="margin:14px 0 0"><a href="${esc(args.trackingUrl)}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:4px">Track Package</a></p>`:""}</div>`:"";
  const note=args.rejectionReason?`<div style="margin:18px 0;padding:14px;border-radius:8px;background:#fff8e6;border:1px solid rgba(183,121,31,.24);color:#7a4a00;font-family:${BODY_FONT}"><strong>Note:</strong><br>${esc(args.rejectionReason)}</div>`:"";
  const numberLabel=inquiry?"Inquiry Number":"Order Number";
  const summaryHeading=shipment?(args.type==="partial_shipment_delivered"||args.type==="shipment_delivered"?"Items Delivered":"Items in This Shipment"):(inquiry?"Inquiry Summary":"Order Summary");
  const summaryBody=shipment?`${orderTable(args.items)}${(args.remainingItems||[]).length?`<div style="margin-top:18px;padding:14px;border:1px solid ${GOLD_SOFT};border-radius:8px"><strong>Still Pending / Backordered</strong><div style="margin-top:7px">${(args.remainingItems||[]).map((i:Rec)=>`<div>${esc(itemName(i))} · ${esc(first(i.strength,i.product_strength))} × ${esc(itemQty(i))}</div>`).join("")}</div></div>`:(args.type==="shipment_delivered"?"":"<p style=\"margin-top:16px\">All items on this order have now shipped.</p>")}`:(inquiry?inquiryPricedTable(args.items,args.subtotal,args.shipping,args.total):`${orderTable(args.items)}${totals(args)}`);
  const html=`<div style="font-family:${BODY_FONT};color:${INK};background:#fff;max-width:760px;margin:0 auto;border:1px solid ${LINE};border-radius:10px;overflow:hidden">${header()}<div style="padding:28px 24px;box-sizing:border-box;max-width:100%"><p style="margin:0 0 10px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Patriot Peptides USA</p><h1 style="margin:0 0 10px;font-family:${HEADING_FONT};font-size:30px;line-height:1.15;font-weight:500;color:${c.tone}">${esc(c.heading)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 16px;color:${INK}">Hi ${esc(args.name||"Customer")}, ${esc(c.intro)}</p><div style="margin:0 0 20px;padding:14px;border-top:1px solid ${GOLD_SOFT};border-bottom:1px solid ${GOLD_SOFT};background:#fff;color:${INK}">${args.orderNo?`<p style="margin:4px 0"><strong style="color:${NAVY}">${numberLabel}:</strong> ${esc(args.orderNo)}</p>`:""}${args.customerNumber?`<p style="margin:4px 0"><strong style="color:${NAVY}">Customer Number:</strong> ${esc(args.customerNumber)}</p>`:""}</div>${c.showPayment?paymentBlock(args.payment,args.orderNo):""}${track}${note}${account?`<p style="margin:22px 0"><a href="${esc(SITE_URL)}/login.html" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border:1px solid ${NAVY};border-radius:4px">Log In</a></p>`:`<h2 style="margin:26px 0 10px;font-family:${HEADING_FONT};font-size:22px;font-weight:500;color:${NAVY}">${summaryHeading}</h2>${summaryBody}`}${args.promoHtml||""}${footer()}</div></div>`;
  const textParts=[`Patriot Peptides USA ${c.label}${args.orderNo?` #${args.orderNo}`:""}`,`Customer: ${args.name}`,c.intro,args.trackingNumber?`Tracking Number: ${args.trackingNumber}`:""];
  if(inquiry)textParts.push(...args.items.map((item:Rec)=>`${itemQty(item)} x ${itemName(item)} at ${money(itemPrice(item))} = ${money(itemTotal(item))}`),`Merchandise: ${money(args.subtotal)}`,`Shipping: ${args.shipping===0?"Free":money(args.shipping)}`,`Estimated Total: ${money(args.total)}`);
  else if(shipment)textParts.push(...args.items.flatMap((i:Rec)=>[`${itemName(i)} — ${first(i.sort_name,i.sortName)}`,`Strength: ${first(i.strength,i.product_strength,i.productStrength)}`,`Item #: ${first(i.product_key,i.productKey,i.item_number)}`,`${args.type==="shipment_delivered"?"Qty delivered":"Qty shipped"}: ${itemQty(i)}`]),...(args.remainingItems||[]).map((i:Rec)=>`Pending: ${itemName(i)} × ${itemQty(i)}`));
  else textParts.push(...args.items.flatMap((i:Rec)=>[`${itemName(i)} — ${first(i.sort_name,i.sortName)}`,`Strength: ${first(i.strength,i.product_strength,i.productStrength)}`,`Item #: ${first(i.product_key,i.productKey,i.item_number)}`,`Qty: ${itemQty(i)} · Unit: ${money(itemPrice(i))} · Line: ${money(itemTotal(i))}`]),`Total: ${money(args.total)}`);
  if(args.promoText)textParts.push("",args.promoText);
  return {subject:c.subject,html,text:textParts.filter(Boolean).join("\n"),label:c.label};
}
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

async function sendGmailGateway(to:string, subject:string, body:string){
  if(STAGING) return {ok:true,skipped:true};
  const clientId=Deno.env.get("GMAIL_CLIENT_ID")||"";
  const clientSecret=Deno.env.get("GMAIL_CLIENT_SECRET")||"";
  const refreshToken=Deno.env.get("GMAIL_REFRESH_TOKEN")||"";
  if(!clientId||!clientSecret||!refreshToken) return {ok:false,error:"Gmail OAuth secrets missing"};
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"})
  });
  const tokenJson=await tokenRes.json().catch(()=>({}));
  if(!tokenRes.ok||!tokenJson.access_token) return {ok:false,error:"Gmail authorization failed",status:tokenRes.status};
  const message=["To: "+to,"Subject: "+subject,"MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","",""+body].join("\r\n");
  const bytes=new TextEncoder().encode(message);
  let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
  const raw=btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const sendRes=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{
    method:"POST",headers:{"Authorization":"Bearer "+tokenJson.access_token,"Content-Type":"application/json"},
    body:JSON.stringify({raw})
  });
  const sent=await sendRes.json().catch(()=>({}));
  return sendRes.ok?{ok:true,data:{id:sent.id}}:{ok:false,error:"Gmail send failed",status:sendRes.status};
}

function adminHtml(a:any){
  const inquiry=a.inquiry===true;
  const heading=inquiry?"New Inquiry Alert":"New Order Alert";
  const intro=inquiry
    ?`A new Patriot Peptides USA inquiry${a.orderNo?` <strong>#${esc(a.orderNo)}</strong>`:""} was submitted.`
    :`A new Patriot Peptides USA order${a.orderNo?` <strong>#${esc(a.orderNo)}</strong>`:""} was placed.`;
  const detail=inquiry?"Inquiry Items":"Order Items";
  const itemSummary=inquiry?inquiryTable(a.items):`${orderTable(a.items)}${totals(a)}`;
  const paymentInfo=inquiry?"":`${a.payment.method?`<p style="margin:6px 0"><strong style="color:${NAVY}">Payment Method:</strong> ${esc(a.payment.method)}</p>`:""}${a.payment.status?`<p style="margin:6px 0"><strong style="color:${NAVY}">Payment Status:</strong> ${esc(a.payment.status)}</p>`:""}`;
  return `<div style="font-family:${BODY_FONT};color:${INK};background:#fff;max-width:760px;margin:0 auto;border:1px solid ${LINE};border-radius:10px;overflow:hidden">${header()}<div style="padding:28px 24px;box-sizing:border-box;max-width:100%"><p style="margin:0 0 10px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Admin Alert</p><h1 style="margin:0 0 10px;font-family:${HEADING_FONT};font-size:30px;line-height:1.15;font-weight:500;color:${NAVY}">${heading}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 16px">${intro}</p><div style="margin:18px 0;padding:16px;border-top:1px solid ${GOLD_SOFT};border-bottom:1px solid ${GOLD_SOFT};background:${SOFT}"><p style="margin:6px 0"><strong style="color:${NAVY}">Customer:</strong> ${esc(a.name)}</p><p style="margin:6px 0"><strong style="color:${NAVY}">Email:</strong> ${esc(a.email)}</p>${paymentInfo}</div><h2 style="margin:24px 0 10px;font-family:${HEADING_FONT};font-size:22px;font-weight:500;color:${NAVY}">${detail}</h2>${itemSummary}<div style="margin-top:24px;text-align:center"><a href="${esc(ADMIN_ORDERS_URL)}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border:1px solid ${NAVY};border-radius:4px">Open Admin Orders</a></div></div></div>`;
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
        const subject=inquiry?`New Patriot Peptides USA Inquiry${orderNo?` #${orderNo}`:""}`:`New Patriot Peptides USA Order${orderNo?` #${orderNo}`:""}`;
        const textParts=[subject,`Customer: ${name}`,`Email: ${email}`];
        if(!inquiry)textParts.push(`Total: ${money(total)}`);
        textParts.push(`Admin Orders: ${ADMIN_ORDERS_URL}`);
        admin=await sendMail(recipients,subject,html,textParts.join("\n"));
      }
    }
    // New-order SMS via Gmail -> Mint Mobile/T-Mobile email-to-text gateway.
    // Independent of customer and admin email deliveries.
    let sms:any={ok:true,skipped:true};
    if(["order_received","order_placed"].includes(String(type))){
      const smsSubject="PST ORDER";
      const smsText=[
        "PST NEW ORDER",
        orderNo?"#"+orderNo:"",
        name,
        money(total),
        "Payment: "+first(pay.status,"Pending")
      ].filter(Boolean).join("\n");
      try{
        sms=await sendGmailGateway("2544987249@tmomail.net",smsSubject,smsText);
      }catch(error){sms={ok:false,error:"Gmail notification unavailable"};}
    }
    return new Response(JSON.stringify({ok:true,type,email_id:result.data?.id||null,sms_alert:{ok:sms.ok,skipped:sms.skipped===true,email_id:sms.data?.id||null,error:sms.ok?null:(sms.data?.message||sms.data?.error||sms.error||'SMS gateway submission failed.')},admin_alert:{ok:admin.ok,skipped:admin.skipped===true,recipients,email_id:admin.data?.id||null,error:admin.ok?null:(admin.data?.message||admin.data?.error||"Admin alert email failed.")}}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }catch(err){
    return new Response(JSON.stringify({ok:false,error:err?.message||String(err)}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
});
