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

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Supabase's own gateway (e.g. when "Verify JWT" blocks the request
    // before your code runs) doesn't always use the same {error} shape
    // your function returns, so check a few common fields before falling
    // back to the raw HTTP status.
    const reason = data.error || data.message || data.msg || `HTTP ${response.status}`;
    throw new Error(`${name} failed: ${reason}`);
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

  const url = `${SUPABASE_URL}/rest/v1/products?select=*&approved=eq.true&order=created_at.desc`;
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
  // out of — this just re-verifies you against Telegram again (useful if
  // your profile ever looks stale).
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
  const approvedIds = new Set(products.map(p => p.id));
  const myPending = currentUser
    ? myListings.filter(p => !p.approved && !approvedIds.has(p.id))
    : [];
  return [...myPending, ...products];
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
    const tgLink = formatTelegramLink(product.contact, product.title);

    return `
      <div class="product-card ${isMinePending ? 'boosted' : ''}" ${isMinePending ? 'style="border-color: var(--neon-amber); box-shadow: 0 0 15px rgba(245, 158, 11, 0.25);"' : ''}>
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
            : `<a href="${tgLink}" target="_blank" class="btn-contact"><i class="fa-brands fa-telegram"></i> Chat on Telegram</a>`
          }
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

  document.getElementById('prof-active-listings').innerText = myListings.length;

  const myItemsContainer = document.getElementById('user-own-listings');
  if (myListings.length === 0) {
    myItemsContainer.innerHTML = `
      <div style="text-align: center; padding: 18px; color: var(--text-muted); font-size: 12px; background: var(--bg-card); border-radius: 12px; border: 1px solid var(--border-glass);">
        You haven't posted any products yet.
      </div>`;
  } else {
    myItemsContainer.innerHTML = myListings.map(item => `
      <div class="own-item-card">
        <div class="own-item-info">
          <img src="${item.image}" alt="${item.title}" class="own-item-thumb">
          <div>
            <strong>${item.title}</strong>
            <span>₦${Number(item.price).toLocaleString()} • ${item.category}</span>
            ${item.approved
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
