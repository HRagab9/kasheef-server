
// ============================================================
//  FILE 3: server.js  (Node.js / Express)
//  مُحسَّن لـ Lovable + Meta Business Manager
//  Deploy على Railway في 5 دقائق
// ============================================================
//
//  DEPLOY STEPS:
//  1. أنشئ مجلد جديد وحط فيه هذا الملف
//  2. npm init -y
//  3. npm install express axios body-parser dotenv cors crypto
//  4. أنشئ .env (شوف الأسفل)
//  5. ارفع على GitHub
//  6. railway.app → New Project → Deploy from GitHub
//  7. Add Environment Variables في Railway
//
// ============================================================

require('dotenv').config({ path: './.env/.env' });
const express    = require('express');
const axios      = require('axios');
const bodyParser = require('body-parser');
const crypto     = require('crypto');
const cors       = require('cors');

const app = express();

// ── CORS — Lovable domains ────────────────────────────────────
app.use(cors({
  origin: [
    /\.lovable\.app$/,
    /\.lovableproject\.com$/,
    'https://kasheef.com',
    'https://www.kasheef.com',
    /localhost/,
  ],
  credentials: true,
}));

app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ── ENV ───────────────────────────────────────────────────────
// .env file — أنشئه في نفس مجلد server.js:
//
// PORT=3000
// META_VERIFY_TOKEN=kasheef_verify_2025
// META_APP_SECRET=paste_from_developers_facebook_com
// META_PAGE_ACCESS_TOKEN=EAAxxxxxxxxx
// META_PAGE_ID=your_page_id_number
// WHATSAPP_PHONE_ID=your_phone_number_id
// WHATSAPP_TOKEN=EAAxxxxxxxxx
// API_KEY=kasheef_live_make_this_secret
//
// في Railway: Settings → Variables → أضف نفس المتغيرات

const {
  PORT = 3000,
  META_VERIFY_TOKEN = 'kasheef_verify_2025',
  META_APP_SECRET,
  META_PAGE_ACCESS_TOKEN,
  META_PAGE_ID,
  WHATSAPP_PHONE_ID,
  WHATSAPP_TOKEN,
  API_KEY = 'kasheef_live_test',
} = process.env;

// ── IN-MEMORY DB (replace with Supabase/MongoDB in production) 
const db = {
  leads:  [],
  events: [],
  stats:  { total: 0, hot: 0, warm: 0, cold: 0, waCount: 0 },
};

// ============================================================
//  AI SCORING ENGINE
// ============================================================
function scoreLeadAI(lead) {
  let score = 0;

  // Timing (max 35)
  score += ({ 'خلال شهر': 35, '1-3 شهور': 25, '3-6 شهور': 15, 'بس بشوف': 5 }[lead.timing] || 8);

  // Goal (max 30)
  score += ({ 'استثمار عقاري': 28, 'شراء للسكن': 25, 'وسيط عقاري': 20, 'إيجار': 12 }[lead.goal] || 10);

  // Budget (max 25)
  score += ({
    'أكثر من 5 مليون': 25, '3-5 مليون': 20,
    '1-3 مليون':        14, 'أقل من مليون': 8,
  }[lead.budget] || 8);

  // Source bonus
  score += ({ aqarmap: 15, website: 8, lovable_website: 8, facebook: 5, instagram: 5, tiktok: 3 }[lead.source] || 2);

  // Area bonus
  score += ({ 'العاصمة الإدارية الجديدة': 5, 'القاهرة الجديدة': 4, 'الشيخ زايد': 3 }[lead.area] || 1);

  const final  = Math.min(score, 99);
  const status = final >= 70 ? 'hot' : final >= 45 ? 'warm' : 'cold';
  return { score: final, status };
}

// ============================================================
//  WHATSAPP AUTO-MESSAGE
// ============================================================
async function sendWA(phone, name, status, area, goal) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return;

  // Normalize Egyptian number → international format
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('0')) p = '20' + p.slice(1);
  if (!p.startsWith('+')) p = '+' + p;

  const msgs = {
    hot:  `أهلاً ${name}! 🔥\n\nشكراً لاهتمامك بـ Kasheef App!\n\nبناءً على اهتمامك بـ ${goal} في ${area || 'مصر'}، فريقنا هيتواصل معاك خلال ساعتين بأفضل العروض.\n\n📲 حمّل التطبيق:\nkasheef.app/download`,
    warm: `أهلاً ${name}! 😊\n\nشكراً لاهتمامك بـ Kasheef!\n\nهنبعتلك محتوى مفيد عن عقارات ${area || 'مصر'} خلال الأيام الجاية.\n\n📲 kasheef.app/download`,
    cold: `أهلاً ${name}! 🏠\n\nشكراً لزيارة Kasheef!\n\nلما تكون جاهز للبحث، إحنا هنا.\n\n📲 kasheef.app/download`,
  };

 try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: p,
        type: 'template',
        template: {
          name: 'kasheef_welcome',
          language: { code: 'ar' },
          components: [{
            type: 'body',
            parameters: [{ type: 'text', text: name }]
          }]
        },
      },

      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    db.stats.waCount++;
    console.log(`[WA] ✓ Sent to ${name} (${status})`);
  } catch (e) {
    console.error('[WA] Error:', e.response?.data?.error || e.message);
  }
}

// ============================================================
//  PROCESS LEAD
// ============================================================
async function processLead(raw) {
  const { score, status } = scoreLeadAI(raw);
  const lead = { id: `K${Date.now()}`, ...raw, score, status, createdAt: new Date().toISOString() };
  db.leads.unshift(lead);
  db.stats.total++;
  db.stats[status]++;
  addEvent(raw.source, `${lead.name} — Score ${score} (${status.toUpperCase()})`);

  if (lead.phone) await sendWA(lead.phone, lead.name, status, lead.area, lead.goal);

  console.log(`[LEAD] ${lead.name} | ${score} | ${status} | ${lead.source}`);
  return lead;
}

function addEvent(src, msg) {
  db.events.unshift({ src, msg, time: new Date().toISOString() });
  if (db.events.length > 200) db.events.pop();
}

// ── Auth middleware ───────────────────────────────────────────
function auth(req, res, next) {
  const k = req.headers['x-api-key'] || req.query.api_key;
  if (k !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ============================================================
//  ROUTES
// ============================================================

// Health
app.get('/', (req, res) => res.json({ status: 'online', service: 'Kasheef Lead Server', stats: db.stats }));

// ── Lovable / Website Lead ────────────────────────────────────
app.post('/api/leads', auth, async (req, res) => {
  try {
    const b = req.body;
    // Track non-lead events (page_view, clicks etc.)
    if (b.event && !['lead', 'Lead'].includes(b.event)) {
      addEvent(b.siteId || 'website', `Event: ${b.event}`);
      return res.json({ ok: true });
    }
    if (!b.name && !b.phone) return res.status(400).json({ error: 'name or phone required' });
    const lead = await processLead({ ...b, source: b.source || 'lovable_website' });
    res.json({ status: 'success', lead_id: lead.id, score: lead.score, status: lead.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET Leads (for dashboard) ─────────────────────────────────
app.get('/api/leads', auth, (req, res) => {
  let leads = db.leads;
  if (req.query.status) leads = leads.filter(l => l.status === req.query.status);
  res.json({ leads: leads.slice(0, 100), stats: db.stats });
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const bySource = {};
  db.leads.forEach(l => {
    bySource[l.source] = bySource[l.source] || { total: 0, hot: 0, warm: 0, cold: 0 };
    bySource[l.source].total++;
    bySource[l.source][l.status]++;
  });
  res.json({ ...db.stats, by_source: bySource, recent: db.events.slice(0, 20) });
});

// ── Post event ────────────────────────────────────────────────
app.post('/api/events', (req, res) => {
  addEvent(req.body.siteId || 'web', req.body.event || 'unknown');
  res.json({ ok: true });
});

// ============================================================
//  META WEBHOOK — Facebook + Instagram Lead Ads
// ============================================================

// Verification (GET)
app.get('/webhook/meta', (req, res) => {
  if (
    req.query['hub.mode']         === 'subscribe' &&
    req.query['hub.verify_token'] === META_VERIFY_TOKEN
  ) {
    console.log('[META] ✓ Webhook verified');
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// Lead events (POST)
app.post('/webhook/meta', async (req, res) => {
  // Verify signature from Meta
  if (META_APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'] || '';
    const expected = 'sha256=' + crypto
      .createHmac('sha256', META_APP_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) return res.sendStatus(403);
  }
  res.sendStatus(200); // Must respond fast

  const { object, entry = [] } = req.body;
  if (object !== 'page') return;

  for (const page of entry) {
    for (const change of (page.changes || [])) {
      if (change.field === 'leadgen') {
        fetchMetaLead(change.value);
      }
    }
  }
});

async function fetchMetaLead({ leadgen_id, page_id, form_id, ad_id }) {
  if (!META_PAGE_ACCESS_TOKEN) return;
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v18.0/${leadgen_id}`,
      { params: { access_token: META_PAGE_ACCESS_TOKEN, fields: 'field_data,created_time,ad_name,campaign_name' } }
    );

    const f = {};
    (data.field_data || []).forEach(d => { f[d.name] = d.values?.[0] || ''; });

    // Determine source: facebook or instagram
    const source = page_id === META_PAGE_ID ? 'facebook' : 'instagram';

    await processLead({
      name:    f.full_name    || f.name    || 'Meta Lead',
      phone:   f.phone_number || f.phone,
      email:   f.email,
      area:    f.area || f.region || f.city,
      goal:    f.goal || f.purpose || f.interest,
      budget:  f.budget,
      timing:  f.timing || f.when,
      source,
      ad:      data.ad_name,
      campaign:data.campaign_name,
    });
  } catch (e) {
    console.error('[META] Lead fetch error:', e.response?.data || e.message);
  }
}

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`🚀 Kasheef Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/`);
});