// ppu-owner-push (Nov 21 2026): push-only owner alerts for things whose bell entry (pst_inbox) the database already wrote,
// e.g. group order saves (ppu_group_notify_owner). Same devices, VAPID keys and pst_notify_prefs as pst-push.
//   POST {field, title, body, url, tag} + x-hook-key -> every owner device whose person hasn't switched pst_notify_prefs[field] off
// Deploy with verify_jwt off (it checks the hook key itself).
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Row = Record<string, any>;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const secret = async (key: string) => (await admin.from("pst_app_secrets").select("value").eq("key", key).maybeSingle()).data?.value as string | undefined;

Deno.serve(async req => {
  try {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const hook = req.headers.get("x-hook-key") || "";
    if (!hook || hook !== (await secret("hook_key"))) return json(401, { error: "bad hook key" });
    const pub = await secret("vapid_public"), priv = await secret("vapid_private");
    if (!pub || !priv) return json(200, { sent: 0, skipped: "no VAPID keys yet" });
    webpush.setVapidDetails(Deno.env.get("PUSH_CONTACT") ?? "https://www.patriotpeptides-usa.com", pub, priv);
    const b = await req.json().catch(() => ({}));
    const field = /^[a-z_]{2,30}$/.test(String(b.field || "")) ? String(b.field) : "new_orders";
    const p = { title: String(b.title || "").slice(0, 160), body: String(b.body || "").slice(0, 400), url: String(b.url || "owner.html").slice(0, 300), tag: String(b.tag || "").slice(0, 80) || undefined };
    const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("role", "owner");
    const ids = [...new Set((subs || []).map((s: Row) => s.user_id).filter(Boolean))];
    const { data: prefs } = ids.length ? await admin.from("pst_notify_prefs").select("*").eq("role", "owner").in("user_id", ids) : { data: [] };
    const off = new Set((prefs || []).filter((r: Row) => r[field] === false).map((r: Row) => r.user_id));
    let sent = 0;
    for (const s of (subs || []).filter((s: Row) => !off.has(s.user_id))) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 86400, urgency: "high" });
        sent++; await admin.from("pst_push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) await admin.from("pst_push_subscriptions").delete().eq("id", s.id);
        else await admin.from("pst_push_subscriptions").update({ fail_count: (s.fail_count || 0) + 1 }).eq("id", s.id);
      }
    }
    return json(200, { sent });
  } catch (e: any) { return json(500, { error: e?.message || "error" }); }
});
