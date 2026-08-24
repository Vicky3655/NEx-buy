// Initialize Telegram Mini App
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#0f051d');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#0f051d');
}

// Initial Sample UNN Listings
const defaultProducts = [
  {
    id: 1,
    sellerId: "usr_1",
    title: "GST 101 & 103 Textbook Pack",
    price: 3500,
    category: "Academics",
    location: "Mary Slessor Hostel",
    contact: "@chidubem_unn",
    image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80",
    desc: "Complete first year package with summarized past questions.",
    boosted: true
  },
  {
    id: 2,
    sellerId: "usr_2",
    title: "HP Pavilion 15 (8GB RAM / 256 SSD)",
    price: 185000,
    category: "Gadgets",
    location: "Franco Hostel",
    contact: "@emeka_tech",
    image: "https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=400&q=80",
    desc: "Battery health is good. Suitable for coding and assignments.",
    boosted: false
  },
  {
    id: 3,
    sellerId: "usr_1",
    title: "Vintage Denim Jacket",
    price: 7000,
    category: "Fashion",
    location: "Nkrumah Hostel",
    contact: "@ngozi_unn",
    image: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&q=80",
    desc: "Oversized, UNN campus style.",
    boosted: false
  }
];

// Persistent App State
let products = JSON.parse(localStorage.getItem('nexbuy_products')) || defaultProducts;
let currentCategory = 'All';
let currentUser = null; // populated only after a verified Telegram + Supabase sign-in
let isLightMode = localStorage.getItem('nexbuy_theme') === 'light';

// Current uploaded image in Base64 (from phone storage)
let currentUploadedImageBase64 = null;

// ============================================================
// SUPABASE + TELEGRAM-REQUIRED AUTH
//
// Nexbuy is a Telegram Mini App, so sign-in is now Telegram-only:
// the old email/matric/password form is retired because there is
// no backend behind it that could ever check a password safely.
// Instead, on every load we take Telegram's signed `initData`,
// hand it to a Supabase Edge Function that verifies it (that's the
// only place your bot token lives), and get back a short-lived
// token tied to a row in a `profiles` table.
//
// Nothing here touches index.html or style.css: the Supabase SDK
// is loaded dynamically, and every new screen (the "open in
// Telegram" gate, the loading state, the one-time hostel picker)
// is built from elements that already exist in your stylesheet
// (.auth-card, .input-group, .btn-primary, .restriction-box, etc).
// ============================================================

// TODO: replace with your project's own values (Project Settings -> API)
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";

let sbClient = null;          // set once the Supabase SDK has loaded
let cachedToken = null;       // the current signed-in JWT
let cachedTokenExpiresAt = 0; // epoch ms

// Loads the Supabase JS SDK from a CDN at runtime, so index.html
// never needs a new <script> tag.
function loadSupabaseSdk() {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load the Supabase SDK'));
    document.head.appendChild(script);
  });
}

// Sends Telegram's initData to the telegram-auth Edge Function and
// caches the token it returns. Uses plain fetch (not sbClient) on
// purpose, since this call has to work even before/without a signed
// session, and must never depend on the very token it's fetching.
async function requestTelegramSession() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = tg && tg.initData;
  if (!initData) {
    throw new Error('not-in-telegram');
  }

  if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
    throw new Error(
      "app.js still has placeholder Supabase values — replace SUPABASE_URL and SUPABASE_ANON_KEY near the top of the file with your real project's values."
    );
  }

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ initData })
    });
  } catch (networkErr) {
    // fetch() itself throws for DNS failures, offline devices, blocked
    // requests, etc. — before there's any HTTP response to read.
    throw new Error(`Could not reach Supabase (${networkErr.message}). Check SUPABASE_URL and your connection.`);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.token) {
    // Supabase's own gateway (e.g. when "Verify JWT" blocks the request
    // before your code runs) doesn't always use the same {error} shape
    // your function returns, so check a few common fields before falling
    // back to the raw HTTP status.
    const reason = data.error || data.message || data.msg || `HTTP ${response.status}`;
    throw new Error(`Sign-in failed: ${reason}`);
  }

  cachedToken = data.token;
  cachedTokenExpiresAt = data.expiresAt;
  return data;
}

// Passed to createClient as the `accessToken` hook: the Supabase
// client calls this on its own whenever it needs to authenticate a
// request (e.g. updating your profile), so a fresh token is fetched
// automatically once the cached one is close to expiring.
async function getValidAccessToken() {
  const now = Date.now();
  if (cachedToken && cachedTokenExpiresAt - now > 30000) {
    return cachedToken;
  }
  try {
    await requestTelegramSession();
  } catch (err) {
    console.error('Could not refresh Telegram session:', err);
    return null;
  }
  return cachedToken;
}

function mapProfileToUser(profile) {
  return {
    id: profile.id,
    name: profile.display_name || profile.telegram_first_name || "UNN Student",
    location: profile.location || "",
    telegram: profile.telegram_username ? `@${profile.telegram_username}` : "@unn_student",
    canSell: profile.can_sell !== false,
    tier: profile.tier || "Free Student",
    points: profile.points ?? 100
  };
}

// Runs the whole sign-in flow: verify Telegram -> load/create the
// profile -> either finish signing in or ask for a hostel just once.
async function initAuth() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = tg && tg.initData;

  if (!initData) {
    renderTelegramGate();
    return;
  }

  renderAuthLoading("Verifying your Telegram account…");

  try {
    const { profile } = await requestTelegramSession();
    currentUser = mapProfileToUser(profile);

    if (!profile.location) {
      renderLocationSetup(profile);
    } else {
      showMainApp();
    }
  } catch (err) {
    console.error("Telegram sign-in failed:", err);
    renderAuthError(err && err.message ? err.message : "We couldn't verify your Telegram account. Please try again.");
  }
}

// ---- Auth-card UI states (all built from existing CSS classes) ----

function hideLegacyAuthForms() {
  const toggle = document.querySelector('.auth-toggle');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  if (toggle) toggle.classList.add('hidden');
  if (loginForm) loginForm.classList.add('hidden');
  if (registerForm) registerForm.classList.add('hidden');
}

function getAuthFlowContainer() {
  let el = document.getElementById('tg-auth-flow');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tg-auth-flow';
    const card = document.querySelector('.auth-card');
    if (card) card.appendChild(el);
  }
  return el;
}

function renderTelegramGate() {
  const el = getAuthFlowContainer();
  el.innerHTML = `
    <div style="text-align:center; padding: 4px 0 6px;">
      <div class="upload-icon-circle" style="margin: 0 auto 14px;">
        <i class="fa-brands fa-telegram"></i>
      </div>
      <strong style="display:block; font-size:14px; color: var(--text-white); margin-bottom:8px;">
        Open Nexbuy inside Telegram
      </strong>
      <p class="hint" style="font-size:12px; line-height:1.6;">
        Nexbuy only works as a Telegram Mini App, since that's how we verify
        you're a real UNN student. Please launch it from the Nexbuy bot or
        channel link inside Telegram.
      </p>
    </div>
  `;
}

function renderAuthLoading(message) {
  const el = getAuthFlowContainer();
  el.innerHTML = `
    <div style="text-align:center; padding: 8px 0 4px;">
      <i class="fa-solid fa-circle-notch fa-spin" style="font-size:26px; color: var(--neon-magenta);"></i>
      <p class="hint" style="margin-top:12px;">${message}</p>
    </div>
  `;
}

function renderAuthError(message) {
  const el = getAuthFlowContainer();
  el.innerHTML = `
    <div class="restriction-box" style="margin-bottom:14px;">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        <strong>Sign-in problem</strong>
        <p>${message}</p>
      </div>
    </div>
    <button type="button" class="btn-primary" onclick="initAuth()">
      <span>Try Again</span><i class="fa-solid fa-rotate-right"></i>
    </button>
  `;
}

function renderLocationSetup(profile) {
  const el = getAuthFlowContainer();
  const firstName = (profile.telegram_first_name || '').trim();
  el.innerHTML = `
    <p class="hint" style="text-align:center; font-size:13px; line-height:1.6; margin-bottom:14px;">
      <strong style="color:var(--text-white);">Hi${firstName ? ' ' + firstName : ''}! One last thing —</strong><br>
      where do you stay on campus?
    </p>
    <form id="location-setup-form">
      <div class="input-group">
        <label>Campus / Hostel Location</label>
        <div class="input-box">
          <i class="fa-solid fa-location-dot"></i>
          <select id="setup-location" required>
            <option value="Franco Hostel">Franco Hostel (UNN)</option>
            <option value="Mary Slessor Hostel">Mary Slessor Hostel</option>
            <option value="Nkrumah Hostel">Nkrumah Hostel</option>
            <option value="Hilltop Nsukka">Hilltop Area</option>
            <option value="Odenigwe">Odenigwe</option>
            <option value="UNEC Campus">UNEC Campus</option>
          </select>
        </div>
      </div>
      <button type="submit" class="btn-primary">
        <span>Continue to Nexbuy</span><i class="fa-solid fa-arrow-right"></i>
      </button>
    </form>
  `;
  document.getElementById('location-setup-form').addEventListener('submit', handleLocationSetup);
}

async function handleLocationSetup(e) {
  e.preventDefault();
  const location = document.getElementById('setup-location').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const { error } = await sbClient.from('profiles').update({ location }).eq('id', currentUser.id);
    if (error) throw error;
    currentUser.location = location;
    showMainApp();
  } catch (err) {
    console.error(err);
    showToast("Couldn't save that, please try again.");
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  renderProducts();
  hideLegacyAuthForms();

  try {
    await loadSupabaseSdk();
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      },
      accessToken: getValidAccessToken
    });
  } catch (err) {
    console.error('Could not load the Supabase SDK:', err);
    renderAuthError('Could not reach Nexbuy servers. Check your connection and try again.');
    return;
  }

  await initAuth();
});

// ================= THEME TOGGLE (DARK / LIGHT) =================
function initTheme() {
  if (isLightMode) {
    document.body.classList.add('light-mode');
    updateThemeIcon(true);
  } else {
    document.body.classList.remove('light-mode');
    updateThemeIcon(false);
  }
}

function toggleTheme() {
  isLightMode = !isLightMode;
  if (isLightMode) {
    document.body.classList.add('light-mode');
    localStorage.setItem('nexbuy_theme', 'light');
    updateThemeIcon(true);
    showToast("Switched to Light Theme");
  } else {
    document.body.classList.remove('light-mode');
    localStorage.setItem('nexbuy_theme', 'dark');
    updateThemeIcon(false);
    showToast("Switched to Dark Theme");
  }
}

function updateThemeIcon(isLight) {
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-mode-label');
  if (icon) {
    icon.className = isLight ? "fa-solid fa-moon" : "fa-solid fa-sun";
  }
  if (label) {
    label.innerText = isLight ? "Light Mode" : "Dark Mode";
  }
}

function showMainApp() {
  document.getElementById('auth-container').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  if (currentUser) {
    document.getElementById('nav-user-name').innerText = currentUser.name.split(' ')[0];
    updateProfileUI();
  }
}

function handleLogout() {
  // Telegram sign-in is required, so there's no separate account to log
  // out of — this just clears the cached session and re-verifies you
  // against Telegram again (useful if your profile ever looks stale).
  cachedToken = null;
  cachedTokenExpiresAt = 0;
  currentUser = null;
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('auth-container').classList.remove('hidden');
  showToast("Refreshing your Nexbuy session…");
  initAuth();
}

// ================= VIEW SWITCHER =================
function switchView(viewId) {
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
  });

  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  const navMap = {
    'home-view': 0,
    'sell-view': 1,
    'web3-view': 2,
    'profile-view': 3
  };

  const items = document.querySelectorAll('.bottom-nav .nav-item');
  if (items[navMap[viewId]]) {
    items[navMap[viewId]].classList.add('active');
  }

  if (viewId === 'profile-view') {
    updateProfileUI();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ================= 📸 PHONE IMAGE UPLOAD HANDLER =================
// Reads phone image & compresses using HTML5 Canvas to prevent storage crash
function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast("Please upload an image file (PNG, JPG, etc.)");
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.src = e.target.result;

    img.onload = function() {
      // Compress image to max 700px width/height and 0.75 JPEG quality
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const maxDim = 700;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to compressed Base64 Data URL
      currentUploadedImageBase64 = canvas.toDataURL('image/jpeg', 0.75);

      // Display Preview & Hide Placeholder
      document.getElementById('image-preview').src = currentUploadedImageBase64;
      document.getElementById('upload-placeholder').classList.add('hidden');
      document.getElementById('image-preview-container').classList.remove('hidden');
      showToast("Photo attached successfully!");
    };
  };
  reader.readAsDataURL(file);
}

// Remove the selected image preview
function removeSelectedImage(event) {
  if (event) event.stopPropagation(); // Prevents re-opening the file dialog
  currentUploadedImageBase64 = null;
  document.getElementById('post-file-input').value = "";
  document.getElementById('image-preview').src = "";
  document.getElementById('image-preview-container').classList.add('hidden');
  document.getElementById('upload-placeholder').classList.remove('hidden');
}

// ================= MARKETPLACE CONTROLLERS =================
function setCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.classList.toggle('active', pill.innerText.trim() === (cat === 'Academics' ? 'Books & Notes' : cat));
  });
  filterProducts();
}

function filterProducts() {
  const query = document.getElementById('search-input').value.toLowerCase();
  
  const filtered = products.filter(item => {
    const matchesCat = (currentCategory === 'All' || item.category === currentCategory);
    const matchesQuery = item.title.toLowerCase().includes(query) || 
                         item.location.toLowerCase().includes(query) ||
                         item.desc.toLowerCase().includes(query);
    return matchesCat && matchesQuery;
  });

  renderProductGrid(filtered);
}

function renderProducts() {
  renderProductGrid(products);
}

function renderProductGrid(items) {
  const grid = document.getElementById('product-grid');
  document.getElementById('product-count').innerText = `${items.length} items`;

  if (items.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <p>No listings found. Post your item now!</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(product => {
    const tgLink = formatTelegramLink(product.contact, product.title);

    return `
      <div class="product-card ${product.boosted ? 'boosted' : ''}">
        ${product.boosted ? `<span class="boost-tag"><i class="fa-solid fa-bolt"></i> Boosted</span>` : ''}
        <img src="${product.image}" alt="${product.title}" class="product-img" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80'">
        <div class="product-info">
          <span class="product-category-tag">${product.category}</span>
          <h5 class="product-title" title="${product.title}">${product.title}</h5>
          <div class="product-loc">
            <i class="fa-solid fa-location-dot"></i>
            <span>${product.location}</span>
          </div>
          <div class="product-price">₦${Number(product.price).toLocaleString()}</div>
          <a href="${tgLink}" target="_blank" class="btn-contact">
            <i class="fa-brands fa-telegram"></i> Chat on Telegram
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function formatTelegramLink(contact, productTitle) {
  const cleanContact = String(contact).trim().replace('@', '');
  const message = encodeURIComponent(`Hi, I saw your listing on Nexbuy: "${productTitle}". Is it still available?`);
  
  if (cleanContact.startsWith('0') || cleanContact.startsWith('234') || cleanContact.startsWith('+')) {
    const phone = cleanContact.replace(/\D/g, '').replace(/^0/, '234');
    return `https://t.me/+${phone}`;
  }
  return `https://t.me/${cleanContact}?text=${message}`;
}

// ================= POST PRODUCT HANDLER =================
function handlePostProduct(e) {
  e.preventDefault();

  const title = document.getElementById('post-title').value;
  const price = document.getElementById('post-price').value;
  const category = document.getElementById('post-category').value;
  const location = document.getElementById('post-location').value;
  let contact = document.getElementById('post-contact').value.trim();
  const desc = document.getElementById('post-desc').value;

  if (!contact.startsWith('@') && !contact.match(/^\d+$/)) {
    contact = '@' + contact;
  }

  // Use uploaded phone image, or fallback to high quality category stock image
  let image = currentUploadedImageBase64;

  if (!image) {
    const fallbackImages = {
      'Academics': 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=400&q=80',
      'Gadgets': 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400&q=80',
      'Fashion': 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=400&q=80',
      'Hostel': 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=400&q=80'
    };
    image = fallbackImages[category] || fallbackImages['Gadgets'];
  }

  const newProduct = {
    id: Date.now(),
    sellerId: currentUser ? currentUser.id : "usr_guest",
    title,
    price,
    category,
    location,
    contact,
    image,
    desc,
    boosted: false
  };

  products.unshift(newProduct);
  saveProducts();

  // Reset form and upload dropzone
  document.getElementById('sell-form').reset();
  removeSelectedImage();

  showToast("Listing published on UNN Marketplace!");
  switchView('home-view');
  renderProducts();
}

// ================= ENHANCED PROFILE CONTROLLER =================
function updateProfileUI() {
  if (!currentUser) return;

  document.getElementById('prof-name').innerText = currentUser.name;
  document.getElementById('prof-hostel').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${currentUser.location} • UNN`;
  document.getElementById('prof-tg-handle').innerText = currentUser.telegram || "@unn_student";
  document.getElementById('prof-vendor-tier').innerText = currentUser.tier || "Free";
  document.getElementById('prof-nex-points').innerText = currentUser.points || 150;

  const myItems = products.filter(p => p.sellerId === currentUser.id);
  document.getElementById('prof-active-listings').innerText = myItems.length;

  const myItemsContainer = document.getElementById('user-own-listings');
  if (myItems.length === 0) {
    myItemsContainer.innerHTML = `
      <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 12px; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-glass);">
        You haven't posted any products yet.
      </div>`;
  } else {
    myItemsContainer.innerHTML = myItems.map(item => `
      <div class="own-item-card">
        <div class="own-item-info">
          <img src="${item.image}" alt="${item.title}" class="own-item-thumb">
          <div>
            <strong>${item.title}</strong>
            <span>₦${Number(item.price).toLocaleString()} • ${item.category}</span>
          </div>
        </div>
        <button class="btn-delete-own" onclick="deleteMyProduct(${item.id})">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `).join('');
  }
}

function deleteMyProduct(id) {
  if (confirm("Do you want to delete this listing?")) {
    products = products.filter(p => p.id !== id);
    saveProducts();
    updateProfileUI();
    renderProducts();
    showToast("Listing deleted.");
  }
}

// ================= STORAGE HELPERS =================
function saveProducts() {
  localStorage.setItem('nexbuy_products', JSON.stringify(products));
}

function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

