// Initialize Telegram Mini App
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#0f051d');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#0f051d');
}

// Persistent App State
let products = [];           // approved listings only, fetched from Supabase
let myListings = [];         // the signed-in user's own listings (approved + pending)
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
// Instead, on every load (and for every write), we take Telegram's
// signed `initData` and hand it to a Supabase Edge Function, which
// re-verifies it (that's the only place your bot token lives) and
// then does the actual database work itself using the service-role
// key. The browser never holds a Supabase session or token at all —
// there's nothing to keep in sync, refresh, or get rejected by a
// project's particular key configuration.
//
// Nothing here touches index.html or style.css: every new screen
// (the "open in Telegram" gate, the loading state, the one-time
// hostel picker) is built from elements that already exist in your
// stylesheet (.auth-card, .input-group, .btn-primary, .restriction-box).
// ============================================================

// TODO: replace with your project's own values (Project Settings -> API)
const SUPABASE_URL = "https://tartoasyifwxgfgfurep.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhcnRvYXN5aWZ3eGdmZ2Z1cmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MDQzODcsImV4cCI6MjA5OTk4MDM4N30.TUjeSDs0zCCPiPtGjOBxghjOIyZfkga8nLoV39Fbj6k";

// All "Chat on Telegram" buttons route here now, not to each seller's own
// contact — the admin is the point of contact for every listing (fits the
// commission model: the admin coordinates the sale rather than buyer and
// seller dealing directly). Sellers' own contact info is still collected
// and stored, and shown to the admin in the moderation dashboard, so
// there's still a way to actually reach them to arrange things.
const ADMIN_TELEGRAM_CONTACT = "@IfeyBuild";

// Used for the "Nexbuy UNN Support" item in Profile settings, which opens
// WhatsApp rather than Telegram. Country code + number, digits only — no
// "+", spaces, or leading zero (e.g. Nigerian 0801... becomes 234801...).
const ADMIN_WHATSAPP_NUMBER = "2349039096726";

// Calls a Supabase Edge Function with plain fetch — no Supabase SDK, no
// client-side session. Every privileged action re-proves who's calling by
// sending Telegram's initData fresh each time; the function verifies it
// server-side before touching the database.
async function callEdgeFunction(name, body) {
  if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
    throw new Error(
      "app.js still has placeholder Supabase values — replace SUPABASE_URL and SUPABASE_ANON_KEY near the top of the file with your real project's values."
    );
  }

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    // fetch() itself throws for DNS failures, offline devices, blocked
    // requests, etc. — before there's any HTTP response to read.
    throw new Error(`Could not reach Supabase (${networkErr.message}). Check SUPABASE_URL and your connection.`);
  }

  const rawText = await response.text();
  let data = {};
  let parseFailed = false;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      parseFailed = true;
    }
  }

  if (!response.ok) {
    // Supabase's own gateway (e.g. when "Verify JWT" blocks the request
    // before your code runs) doesn't always use the same {error} shape
    // your function returns, so check a few common fields before falling
    // back to the raw HTTP status.
    const reason = data.error || data.message || data.msg || `HTTP ${response.status}`;
    throw new Error(`${name} failed: ${reason}`);
  }

  if (parseFailed) {
    throw new Error(`${name} returned an unreadable response (HTTP ${response.status}, ${rawText.length} bytes) — the payload may be too large or truncated.`);
  }

  return data;
}

function getTelegramInitData() {
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = tg && tg.initData;
  if (!initData) throw new Error('not-in-telegram');
  return initData;
}

async function requestTelegramSession() {
  const initData = getTelegramInitData();
  return callEdgeFunction('telegram-auth', { initData });
}

async function updateLocation(location) {
  const initData = getTelegramInitData();
  return callEdgeFunction('update-location', { initData, location });
}

async function postProductRemote(fields) {
  const initData = getTelegramInitData();
  return callEdgeFunction('manage-product', { initData, action: 'create', ...fields });
}

async function deleteProductRemote(productId) {
  const initData = getTelegramInitData();
  return callEdgeFunction('manage-product', { initData, action: 'delete', productId });
}

// Reads the public marketplace feed straight from Supabase's Data API
// (PostgREST) with the anon key — no session needed here, since Row Level
// Security on the products table already only exposes approved=true rows
// to anonymous readers. This is the ONE place the app talks to Supabase's
// REST API directly rather than through an Edge Function, since it's a
// plain public read with nothing to verify.
async function fetchApprovedProducts() {
  if (SUPABASE_URL.includes('YOUR-PROJECT-REF') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
    return [];
  }

  const url = `${SUPABASE_URL}/rest/v1/products?select=*&approved=eq.true&sold=eq.false&order=created_at.desc`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
  } catch (err) {
    console.error('Could not load marketplace listings:', err);
    return [];
  }

  if (!response.ok) {
    console.error('Could not load marketplace listings, HTTP', response.status);
    return [];
  }

  return response.json();
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
  if (localStorage.getItem('nexbuy_logged_out') === 'true') {
    renderLoggedOut();
    return;
  }

  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = tg && tg.initData;

  if (!initData) {
    renderTelegramGate();
    return;
  }

  renderAuthLoading("Verifying your Telegram account…");

  try {
    const { profile, myListings: ownListings } = await requestTelegramSession();
    currentUser = mapProfileToUser(profile);
    myListings = ownListings || [];

    if (!profile.location) {
      renderLocationSetup(profile);
    } else {
      products = await fetchApprovedProducts();
      renderProducts();
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
        you're a real UNN student. 
      </p>
    </div>
  `;
}

function renderLoggedOut() {
  const el = getAuthFlowContainer();
  el.innerHTML = `
    <div style="text-align:center; padding: 4px 0 6px;">
      <div class="upload-icon-circle" style="margin: 0 auto 14px;">
        <i class="fa-solid fa-right-from-bracket"></i>
      </div>
      <strong style="display:block; font-size:14px; color: var(--text-white); margin-bottom:8px;">
        You've signed out of Nexbuy
      </strong>
      <p class="hint" style="font-size:12px; line-height:1.6; margin-bottom:16px;">
        Tap below to sign back in with your Telegram account.
      </p>
      <button type="button" class="btn-tg" onclick="handleSignInAgain()">
        <i class="fa-brands fa-telegram"></i> Sign In with Telegram
      </button>
    </div>
  `;
}

function handleSignInAgain() {
  localStorage.removeItem('nexbuy_logged_out');
  initAuth();
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
            <option value="Eni-Njoku Hostel">Eni-Njoku Hostel (UNN)</option>
            <option value="Bello Hostel">Bello Hostel</option>
            <option value="Presidential Hostel">Presidential Hostel</option>
            <option value="Nkrumah Hostel">Nkrumah Hostel</option>
            <option value="Hilltop Nsukka">Hilltop Area</option>
            <option value="Odenigwe">Odenigwe</option>
            <option value="ODIM Area">ODIM Area</option>
            <option value="UNEC Campus">UNEC Campus</option>
            <option value="Others">Others</option>
          </select>
        </div>
      </div>
      <div id="location-setup-error" class="hidden"></div>
      <button type="submit" class="btn-primary">
        <span>Continue to Nexbuy</span><i class="fa-solid fa-arrow-right"></i>
      </button>
    </form>
  `;
  document.getElementById('location-setup-form').addEventListener('submit', handleLocationSetup);
}

function showLocationSetupError(message) {
  const el = document.getElementById('location-setup-error');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="restriction-box" style="margin-bottom:14px;">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div>
        <strong>Couldn't save</strong>
        <p>${message}</p>
      </div>
    </div>
  `;
}

async function handleLocationSetup(e) {
  e.preventDefault();
  const location = document.getElementById('setup-location').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const { profile } = await updateLocation(location);
    currentUser = mapProfileToUser(profile);
    products = await fetchApprovedProducts();
    renderProducts();
    showMainApp();
  } catch (err) {
    console.error(err);
    showLocationSetupError(err && err.message ? err.message : 'Please try again.');
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  renderProducts();
  hideLegacyAuthForms();
  wireSupportLink();
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
  // Telegram will always have fresh initData ready the instant the app is
  // open, so without this flag "logging out" would just re-verify and
  // land you right back in — indistinguishable from doing nothing. The
  // flag is what makes it stick until you explicitly choose to sign back
  // in, including across fully closing and reopening the Mini App.
  localStorage.setItem('nexbuy_logged_out', 'true');
  currentUser = null;
  myListings = [];
  products = [];
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('auth-container').classList.remove('hidden');
  renderLoggedOut();
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
  if (viewId === 'sell-view') {
    updateSellAccessUI();
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

// The public grid is approved-only, but a user should still see their own
// pending listing somewhere obvious rather than it vanishing until
// approved — so it's merged in here, just for them, clearly marked.
function getDisplayProducts() {
  const safeProducts = products.filter(p => p && p.id);
  const safeListings = myListings.filter(p => p && p.id);
  const approvedIds = new Set(safeProducts.map(p => p.id));
  const myPending = currentUser
    ? safeListings.filter(p => !p.approved && !approvedIds.has(p.id))
    : [];
  return [...myPending, ...safeProducts];
}

function filterProducts() {
  const query = document.getElementById('search-input').value.toLowerCase();
  
  const filtered = getDisplayProducts().filter(item => {
    const matchesCat = (currentCategory === 'All' || item.category === currentCategory);
    const matchesQuery = item.title.toLowerCase().includes(query) || 
                         item.location.toLowerCase().includes(query) ||
                         (item.description || '').toLowerCase().includes(query);
    return matchesCat && matchesQuery;
  });

  renderProductGrid(filtered);
}

function renderProducts() {
  renderProductGrid(getDisplayProducts());
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
    const isMinePending = !!(currentUser && product.seller_id === currentUser.id && !product.approved);
    const tgLink = formatTelegramLink(ADMIN_TELEGRAM_CONTACT, product.title);

    return `
      <div class="product-card ${isMinePending ? 'boosted' : ''}" ${isMinePending ? 'style="border-color: var(--neon-amber); box-shadow: 0 0 15px rgba(245, 158, 11, 0.25); cursor:pointer;" ' : 'style="cursor:pointer;" '}onclick="openProductDetail('${product.id}')">
        ${isMinePending ? `<span class="boost-tag" style="background: var(--neon-amber);"><i class="fa-solid fa-clock"></i> Awaiting Approval</span>` : ''}
        <img src="${product.image}" alt="${product.title}" class="product-img" onerror="this.src='https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80'">
        <div class="product-info">
          <span class="product-category-tag">${product.category}</span>
          <h5 class="product-title" title="${product.title}">${product.title}</h5>
          <div class="product-loc">
            <i class="fa-solid fa-location-dot"></i>
            <span>${product.location}</span>
          </div>
          <div class="product-price">₦${Number(product.price).toLocaleString()}</div>
          ${isMinePending
            ? `<div class="btn-contact" style="opacity:0.55; background: var(--text-muted);"><i class="fa-solid fa-hourglass-half"></i> Pending Review</div>`
            : `<a href="${tgLink}" target="_blank" class="btn-contact" onclick="event.stopPropagation()"><i class="fa-brands fa-telegram"></i> Chat on Telegram</a>`
          }
        </div>
      </div>
    `;
  }).join('');
}

// ================= PRODUCT DETAIL VIEW =================
// Built entirely in JS from elements/classes that already exist in
// style.css, so there's nothing new to add there — this just gives
// buyers a full-size photo and the full description, which the compact
// grid card has no room for.
function ensureProductDetailOverlay() {
  let el = document.getElementById('product-detail-overlay');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'product-detail-overlay';
  el.className = 'hidden';
  el.style.cssText = 'position:fixed; inset:0; background:rgba(5,2,10,0.75); backdrop-filter:blur(4px); z-index:500; display:flex; align-items:flex-end; justify-content:center;';
  el.addEventListener('click', (e) => {
    if (e.target === el) closeProductDetail();
  });

  el.innerHTML = `
    <div style="background: var(--bg-card-solid); width:100%; max-width:480px; max-height:88vh; overflow-y:auto; border-radius: 22px 22px 0 0; box-shadow: 0 -10px 40px rgba(121,40,202,0.35);">
      <div style="position:relative;">
        <img id="pd-image" style="width:100%; height:220px; object-fit:cover; display:block; border-radius:22px 22px 0 0; background:#110522;">
        <button onclick="closeProductDetail()" style="position:absolute; top:12px; right:12px; width:34px; height:34px; border-radius:50%; background:rgba(15,5,29,0.75); border:1px solid var(--border-glass); color:#fff; font-size:15px;">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <span id="pd-pending-tag" class="boost-tag hidden" style="background: var(--neon-amber);"><i class="fa-solid fa-clock"></i> Awaiting Approval</span>
        <button onclick="openImageLightbox(document.getElementById('pd-image').src)" style="position:absolute; bottom:12px; right:12px; background:rgba(15,5,29,0.75); border:1px solid var(--border-glass); color:#fff; font-size:11px; font-weight:700; padding:7px 12px; border-radius:20px; display:flex; align-items:center; gap:6px;">
          <i class="fa-solid fa-expand"></i> View Full Image
        </button>
      </div>
      <div style="padding:18px;">
        <span id="pd-category" class="product-category-tag"></span>
        <h3 id="pd-title" style="font-size:18px; font-weight:800; margin:6px 0; color:var(--text-white);"></h3>
        <div class="product-loc" style="margin-bottom:10px;"><i class="fa-solid fa-location-dot"></i> <span id="pd-location"></span></div>
        <div id="pd-price" style="font-size:20px; font-weight:800; color:var(--text-white); margin-bottom:14px;"></div>
        <p id="pd-description" style="font-size:13px; color:var(--text-muted); line-height:1.6; margin-bottom:18px;"></p>
        <a id="pd-contact" href="#" target="_blank" class="btn-contact" style="padding:12px; text-decoration:none;"></a>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

// Full-screen, uncropped view of the photo — object-fit:contain here
// (instead of the cover crop used everywhere else) is what actually shows
// its full length rather than cutting off a tall/portrait shot.
function ensureImageLightbox() {
  let el = document.getElementById('image-lightbox');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'image-lightbox';
  el.className = 'hidden';
  el.style.cssText = 'position:fixed; inset:0; background:rgba(5,2,10,0.95); z-index:600; display:flex; align-items:center; justify-content:center; padding:24px;';
  el.addEventListener('click', () => closeImageLightbox());

  el.innerHTML = `
    <img id="lightbox-image" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px;">
    <button onclick="closeImageLightbox()" style="position:absolute; top:20px; right:20px; width:38px; height:38px; border-radius:50%; background:rgba(255,255,255,0.1); border:1px solid var(--border-glass); color:#fff; font-size:17px;">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
  document.body.appendChild(el);
  return el;
}

function openImageLightbox(imageSrc) {
  const el = ensureImageLightbox();
  document.getElementById('lightbox-image').src = imageSrc;
  el.classList.remove('hidden');
}

function closeImageLightbox() {
  const el = document.getElementById('image-lightbox');
  if (el) el.classList.add('hidden');
}

function openProductDetail(productId) {
  const product = getDisplayProducts().find(p => String(p.id) === String(productId));
  if (!product) return;

  const el = ensureProductDetailOverlay();
  const isMinePending = !!(currentUser && product.seller_id === currentUser.id && !product.approved);

  document.getElementById('pd-image').src = product.image;
  document.getElementById('pd-category').innerText = product.category;
  document.getElementById('pd-title').innerText = product.title;
  document.getElementById('pd-location').innerText = product.location;
  document.getElementById('pd-price').innerText = `₦${Number(product.price).toLocaleString()}`;
  document.getElementById('pd-description').innerText = product.description || 'No description provided.';
  document.getElementById('pd-pending-tag').classList.toggle('hidden', !isMinePending);

  const contactBtn = document.getElementById('pd-contact');
  if (isMinePending) {
    contactBtn.removeAttribute('href');
    contactBtn.style.pointerEvents = 'none';
    contactBtn.style.opacity = '0.55';
    contactBtn.style.background = 'var(--text-muted)';
    contactBtn.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> Pending Review`;
  } else {
    contactBtn.href = formatTelegramLink(ADMIN_TELEGRAM_CONTACT, product.title);
    contactBtn.style.pointerEvents = '';
    contactBtn.style.opacity = '';
    contactBtn.style.background = '';
    contactBtn.innerHTML = `<i class="fa-brands fa-telegram"></i> Chat on Telegram`;
  }

  el.classList.remove('hidden');
}

function closeProductDetail() {
  const el = document.getElementById('product-detail-overlay');
  if (el) el.classList.add('hidden');
}

function formatTelegramLink(contact, productTitle) {
  const cleanContact = String(contact).trim().replace('@', '');
  const message = encodeURIComponent(`Hi, I'm interested in this Nexbuy listing: "${productTitle}". Is it still available?`);
  
  if (cleanContact.startsWith('0') || cleanContact.startsWith('234') || cleanContact.startsWith('+')) {
    const phone = cleanContact.replace(/\D/g, '').replace(/^0/, '234');
    return `https://t.me/+${phone}`;
  }
  return `https://t.me/${cleanContact}?text=${message}`;
}

// Opens a link outside the Mini App. Telegram's own WebApp SDK provides
// openLink specifically for this (a plain <a target="_blank"> can behave
// inconsistently inside Telegram's in-app browser), so that's used when
// available, falling back to a normal new tab otherwise.
function openExternalLink(url) {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && typeof tg.openLink === 'function') {
    tg.openLink(url);
  } else {
    window.open(url, '_blank');
  }
}

function openSupportChat() {
  const message = encodeURIComponent("Hi, I need help with Nexbuy.");
  openExternalLink(`https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${message}`);
}

// index.html's Support row has its click behavior inline in the markup
// (showToast(...)) — this overrides it in JS at startup rather than
// editing that file, matching how the rest of this app avoids touching
// index.html/style.css.
function wireSupportLink() {
  document.querySelectorAll('.setting-item').forEach(el => {
    if (el.textContent.includes('Nexbuy UNN Support')) {
      el.onclick = openSupportChat;
    }
  });
}

// ================= POST PRODUCT HANDLER =================
async function handlePostProduct(e) {
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

  const submitBtn = document.getElementById('post-submit-btn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const { product } = await postProductRemote({
      title, price, category, location, contact, image, description: desc
    });

    if (!product || !product.id) {
      throw new Error('Server did not return the created listing — please try again.');
    }

    // manage-product no longer echoes the image back (see server-side
    // change) — we already have it locally from the upload, so re-attach
    // it here rather than needing a second round trip.
    product.image = image;

    myListings.unshift(product);

    // Reset form and upload dropzone
    document.getElementById('sell-form').reset();
    removeSelectedImage();

    showToast("Submitted! Your listing is pending admin approval.");
    switchView('home-view');
    renderProducts();
  } catch (err) {
    console.error(err);
    showToast(err && err.message ? err.message : "Couldn't post that, please try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ================= ENHANCED PROFILE CONTROLLER =================
function updateProfileUI() {
  if (!currentUser) return;

  document.getElementById('prof-name').innerText = currentUser.name;
  document.getElementById('prof-hostel').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${currentUser.location} • UNN`;
  document.getElementById('prof-tg-handle').innerText = currentUser.telegram || "@unn_student";
  document.getElementById('prof-vendor-tier').innerText = currentUser.tier || "Free";
  document.getElementById('prof-nex-points').innerText = currentUser.points || 150;

  const safeListings = myListings.filter(p => p && p.id);
  document.getElementById('prof-active-listings').innerText = safeListings.length;

  const myItemsContainer = document.getElementById('user-own-listings');
  if (safeListings.length === 0) {
    myItemsContainer.innerHTML = `
      <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 12px; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-glass);">
        You haven't posted any products yet.
      </div>`;
  } else {
    myItemsContainer.innerHTML = safeListings.map(item => `
      <div class="own-item-card">
        <div class="own-item-info">
          <img src="${item.image}" alt="${item.title}" class="own-item-thumb">
          <div>
            <strong>${item.title}</strong>
            <span>₦${Number(item.price).toLocaleString()} • ${item.category}</span>
            ${item.sold
              ? `<span class="boost-tag" style="position:static; display:inline-block; margin-top:4px; background: var(--neon-green);"><i class="fa-solid fa-circle-check"></i> Sold</span>`
              : item.approved
                ? ''
                : `<span class="boost-tag" style="position:static; display:inline-block; margin-top:4px; background: var(--neon-amber);"><i class="fa-solid fa-clock"></i> Pending approval</span>`
            }
          </div>
        </div>
        <button class="btn-delete-own" onclick="deleteMyProduct('${item.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `).join('');
  }

  updateSellAccessUI();
}

// Shows the (previously unused) "Selling Restricted" banner and hides the
// post form for anyone the admin hasn't approved to sell yet.
function updateSellAccessUI() {
  const banner = document.getElementById('sell-restriction-banner');
  const form = document.getElementById('sell-form');
  if (!banner || !form) return;

  const canSell = !!(currentUser && currentUser.canSell);
  banner.classList.toggle('hidden', canSell);
  form.classList.toggle('hidden', !canSell);
}

async function deleteMyProduct(id) {
  if (!confirm("Do you want to delete this listing?")) return;

  try {
    await deleteProductRemote(id);
    myListings = myListings.filter(p => p.id !== id);
    products = products.filter(p => p.id !== id);
    updateProfileUI();
    renderProducts();
    showToast("Listing deleted.");
  } catch (err) {
    console.error(err);
    showToast(err && err.message ? err.message : "Couldn't delete that, please try again.");
  }
}

// ================= STORAGE HELPERS =================
function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

