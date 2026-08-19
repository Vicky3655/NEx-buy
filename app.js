// Initialize Telegram Mini App
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  if (tg.setHeaderColor) tg.setHeaderColor('#0f051d');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#0f051d');
}

// Admin Passcode (Default for UNN Admin is 1960 or admin123)
const ADMIN_PASSCODE = "1960";

// Mock Registered UNN Users Database
const initialUsers = [
  {
    id: "usr_1",
    name: "Chidubem Okeke",
    location: "Mary Slessor Hostel",
    phone: "08123456789",
    canSell: true,
    isMonetized: true, // Pro Vendor Tier
    tier: "Pro Vendor (₦2,500/mo)"
  },
  {
    id: "usr_2",
    name: "Emeka Alozie",
    location: "Franco Hostel",
    phone: "08087654321",
    canSell: true,
    isMonetized: false,
    tier: "Free Student"
  },
  {
    id: "usr_3",
    name: "Ngozi Eze",
    location: "Nkrumah Hostel",
    phone: "09011223344",
    canSell: false, // Restricted by admin
    isMonetized: false,
    tier: "Restricted"
  }
];

// Initial Listings Database
const defaultProducts = [
  {
    id: 1,
    sellerId: "usr_1",
    title: "GST 101 & 103 Textbook Pack",
    price: 3500,
    category: "Academics",
    location: "Mary Slessor Hostel",
    contact: "08123456789",
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
    contact: "08087654321",
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
    contact: "09011223344",
    image: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&q=80",
    desc: "Oversized, UNN campus style.",
    boosted: false
  }
];

// Persistent State
let users = JSON.parse(localStorage.getItem('nexbuy_users')) || initialUsers;
let products = JSON.parse(localStorage.getItem('nexbuy_products')) || defaultProducts;
let currentCategory = 'All';
let currentUser = JSON.parse(localStorage.getItem('nexbuy_user')) || null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    showMainApp();
  }
  renderProducts();
});

// ================= AUTH CONTROLLERS =================
function switchAuthTab(type) {
  const loginBtn = document.getElementById('tab-login-btn');
  const regBtn = document.getElementById('tab-register-btn');
  const loginForm = document.getElementById('login-form');
  const regForm = document.getElementById('register-form');

  if (type === 'login') {
    loginBtn.classList.add('active');
    regBtn.classList.remove('active');
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
  } else {
    regBtn.classList.add('active');
    loginBtn.classList.remove('active');
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
  }
}

function handleLogin(e) {
  e.preventDefault();
  const loginId = document.getElementById('login-id').value;
  
  // Find or create current active session
  let matched = users.find(u => u.phone.includes(loginId) || u.name.toLowerCase().includes(loginId.toLowerCase()));
  
  if (!matched) {
    matched = {
      id: "usr_" + Date.now(),
      name: loginId.includes('@') ? loginId.split('@')[0] : "UNN Student",
      location: "Mary Slessor Hostel",
      phone: "080" + Math.floor(10000000 + Math.random() * 90000000),
      canSell: true,
      isMonetized: false,
      tier: "Free Student"
    };
    users.push(matched);
    saveUsers();
  }

  currentUser = matched;
  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Welcome back to Nexbuy UNN!");
  showMainApp();
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const location = document.getElementById('reg-location').value;
  const phone = document.getElementById('reg-phone').value;

  const newUser = {
    id: "usr_" + Date.now(),
    name,
    location,
    phone,
    canSell: true, // Default enabled
    isMonetized: false,
    tier: "Free Student"
  };

  users.push(newUser);
  saveUsers();

  currentUser = newUser;
  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("UNN Student Account Created!");
  showMainApp();
}

function handleTelegramQuickAuth() {
  let tgName = "UNN Lion Scholar";
  let tgPhone = "08199283741";

  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
    const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
    tgName = `${tgUser.first_name} ${tgUser.last_name || ''}`.trim();
  }

  currentUser = {
    id: "usr_tg_" + Date.now(),
    name: tgName,
    location: "Franco / Mary Slessor",
    phone: tgPhone,
    canSell: true,
    isMonetized: false,
    tier: "Free Student"
  };

  users.push(currentUser);
  saveUsers();
  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Connected via Telegram!");
  showMainApp();
}

function showMainApp() {
  document.getElementById('auth-container').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  
  if (currentUser) {
    // Sync session with users DB
    const freshData = users.find(u => u.id === currentUser.id);
    if (freshData) currentUser = freshData;

    document.getElementById('nav-user-name').innerText = currentUser.name.split(' ')[0];
    document.getElementById('prof-name').innerText = currentUser.name;
    document.getElementById('prof-hostel').innerText = `${currentUser.location} • UNN`;
    document.getElementById('user-selling-status').innerText = currentUser.canSell ? "Allowed" : "Suspended";
    document.getElementById('user-tier-status').innerText = currentUser.isMonetized ? "Pro VIP" : "Free";
    
    // Update Sell view form state based on permission
    updateSellerPermissionUI();
  }
}

function handleLogout() {
  localStorage.removeItem('nexbuy_user');
  currentUser = null;
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('auth-container').classList.remove('hidden');
  showToast("Signed out.");
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

  if (viewId === 'admin-view') {
    renderAdminDashboard();
  }

  if (viewId === 'sell-view') {
    updateSellerPermissionUI();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Check seller permission status
function updateSellerPermissionUI() {
  const isAllowed = currentUser ? currentUser.canSell : true;
  const restrictionBanner = document.getElementById('sell-restriction-banner');
  const postSubmitBtn = document.getElementById('post-submit-btn');

  if (!isAllowed) {
    restrictionBanner.classList.remove('hidden');
    postSubmitBtn.disabled = true;
    postSubmitBtn.style.opacity = '0.5';
    postSubmitBtn.style.cursor = 'not-allowed';
  } else {
    restrictionBanner.classList.add('hidden');
    postSubmitBtn.disabled = false;
    postSubmitBtn.style.opacity = '1';
    postSubmitBtn.style.cursor = 'pointer';
  }
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

  grid.innerHTML = items.map(product => `
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
        <a href="https://wa.me/234${formatPhone(product.contact)}?text=Hi,%20I%20am%20interested%20in%20your%20listing%20on%20Nexbuy:%20${encodeURIComponent(product.title)}" 
           target="_blank" class="btn-contact">
          <i class="fa-brands fa-whatsapp"></i> Chat Seller
        </a>
      </div>
    </div>
  `).join('');
}

function handlePostProduct(e) {
  e.preventDefault();

  if (currentUser && !currentUser.canSell) {
    showToast("Error: Your selling permission is disabled by Admin.");
    return;
  }

  const title = document.getElementById('post-title').value;
  const price = document.getElementById('post-price').value;
  const category = document.getElementById('post-category').value;
  const location = document.getElementById('post-location').value;
  const contact = document.getElementById('post-contact').value;
  let image = document.getElementById('post-image').value.trim();
  const desc = document.getElementById('post-desc').value;

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
    boosted: currentUser ? currentUser.isMonetized : false
  };

  products.unshift(newProduct);
  saveProducts();

  document.getElementById('sell-form').reset();
  showToast("Listing published on UNN Marketplace!");
  switchView('home-view');
  renderProducts();
}

// ================= ADMIN DASHBOARD & MONITOR LOGIC =================
function promptAdminAccess() {
  const pin = prompt("Enter SuperAdmin Access PIN (Default PIN: 1960):");
  if (pin === ADMIN_PASSCODE) {
    showToast("Access Granted. Welcome Admin!");
    switchView('admin-view');
  } else if (pin !== null) {
    showToast("Incorrect Admin PIN.");
  }
}

function renderAdminDashboard() {
  // 1. Calculate Mini Market Monitor Metrics
  const totalGMV = products.reduce((acc, p) => acc + Number(p.price || 0), 0);
  const activeSellersCount = users.filter(u => u.canSell).length;
  const monetizedVendorsCount = users.filter(u => u.isMonetized).length;
  const platformRevenue = (monetizedVendorsCount * 2500) + (products.filter(p => p.boosted).length * 500);

  document.getElementById('adm-metric-gmv').innerText = `₦${totalGMV.toLocaleString()}`;
  document.getElementById('adm-metric-revenue').innerText = `₦${platformRevenue.toLocaleString()}`;
  document.getElementById('adm-metric-listings').innerText = products.length;
  document.getElementById('adm-metric-sellers').innerText = activeSellersCount;

  // 2. Render Users with Selling & Monetization Controls
  const usersListContainer = document.getElementById('admin-users-list');
  usersListContainer.innerHTML = users.map(user => `
    <div class="user-admin-card">
      <div class="user-row-top">
        <div class="user-info-meta">
          <strong>${user.name}</strong>
          <span>${user.location} • ${user.phone}</span>
        </div>
        <span class="badge-sub" style="color: ${user.isMonetized ? '#00f0ff' : '#b8a9cf'}">
          ${user.tier}
        </span>
      </div>

      <div class="user-admin-actions">
        <!-- Permission Toggle: Grant / Revoke Selling -->
        <button class="btn-pill-toggle ${user.canSell ? 'enabled' : 'disabled'}" 
                onclick="toggleUserSellingPermission('${user.id}')">
          <i class="fa-solid ${user.canSell ? 'fa-check' : 'fa-ban'}"></i>
          <span>${user.canSell ? 'Sell Allowed' : 'Sell Blocked'}</span>
        </button>

        <!-- Monetization Button: Assign Pro Vendor Tier -->
        <button class="btn-monetize ${user.isMonetized ? 'pro' : ''}" 
                onclick="toggleUserMonetization('${user.id}')">
          <i class="fa-solid fa-gem"></i>
          <span>${user.isMonetized ? 'Pro Vendor (₦2.5k)' : 'Upgrade to Pro'}</span>
        </button>
      </div>
    </div>
  `).join('');

  // 3. Render Product Moderation Feed
  const listingsContainer = document.getElementById('admin-listings-list');
  listingsContainer.innerHTML = products.map(item => `
    <div class="listing-admin-card">
      <div class="user-row-top">
        <div class="user-info-meta">
          <strong>${item.title}</strong>
          <span>₦${Number(item.price).toLocaleString()} • ${item.location}</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-outline-sm" style="margin:0; padding:4px 8px;" onclick="toggleBoostListing(${item.id})">
            <i class="fa-solid fa-bolt"></i> ${item.boosted ? 'Unboost' : 'Boost (₦500)'}
          </button>
          <button class="btn-del-listing" onclick="adminDeleteProduct(${item.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// Admin Action: Grant / Revoke Selling Permission
function toggleUserSellingPermission(userId) {
  const user = users.find(u => u.id === userId);
  if (user) {
    user.canSell = !user.canSell;
    saveUsers();
    renderAdminDashboard();
    showToast(`Selling permission for ${user.name} is now ${user.canSell ? 'ENABLED' : 'DISABLED'}.`);
  }
}

// Admin Action: Monetize / Upgrade User
function toggleUserMonetization(userId) {
  const user = users.find(u => u.id === userId);
  if (user) {
    user.isMonetized = !user.isMonetized;
    user.tier = user.isMonetized ? "Pro Vendor (₦2,500/mo)" : "Free Student";
    saveUsers();
    renderAdminDashboard();
    showToast(`${user.name} status updated to: ${user.tier}`);
  }
}

// Admin Action: Moderate / Delete Listing
function adminDeleteProduct(productId) {
  if (confirm("Are you sure you want to remove this listing from UNN marketplace?")) {
    products = products.filter(p => p.id !== productId);
    saveProducts();
    renderAdminDashboard();
    renderProducts();
    showToast("Listing removed by Admin.");
  }
}

// Admin Action: Toggle Featured / Boosted Listing
function toggleBoostListing(productId) {
  const product = products.find(p => p.id === productId);
  if (product) {
    product.boosted = !product.boosted;
    saveProducts();
    renderAdminDashboard();
    renderProducts();
    showToast(`Listing ${product.boosted ? 'BOOSTED' : 'UNBOOSTED'}.`);
  }
}

// ================= STORAGE HELPERS =================
function saveUsers() {
  localStorage.setItem('nexbuy_users', JSON.stringify(users));
}

function saveProducts() {
  localStorage.setItem('nexbuy_products', JSON.stringify(products));
}

function formatPhone(phone) {
  return String(phone).replace(/^0/, '').replace(/\D/g, '');
}

function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}
