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
let currentUser = JSON.parse(localStorage.getItem('nexbuy_user')) || null;
let isLightMode = localStorage.getItem('nexbuy_theme') === 'light';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (currentUser) {
    showMainApp();
  }
  renderProducts();
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

  currentUser = {
    id: "usr_" + Date.now(),
    name: loginId.startsWith('@') ? loginId.replace('@', '') : "UNN Lion",
    location: "Mary Slessor Hostel",
    telegram: loginId.startsWith('@') ? loginId : `@${loginId.replace(/\s+/g, '_')}`,
    canSell: true,
    tier: "Free Student",
    points: 240
  };

  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Welcome to Nexbuy UNN!");
  showMainApp();
}

function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const location = document.getElementById('reg-location').value;
  let telegram = document.getElementById('reg-telegram').value.trim();

  if (!telegram.startsWith('@') && !telegram.match(/^\d+$/)) {
    telegram = '@' + telegram;
  }

  currentUser = {
    id: "usr_" + Date.now(),
    name,
    location,
    telegram,
    canSell: true,
    tier: "Free Student",
    points: 100
  };

  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("UNN Account Created!");
  showMainApp();
}

function handleTelegramQuickAuth() {
  let tgName = "UNN Scholar";
  let tgHandle = "@unn_lion";

  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
    const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
    tgName = `${tgUser.first_name} ${tgUser.last_name || ''}`.trim();
    tgHandle = tgUser.username ? `@${tgUser.username}` : `@user_${tgUser.id}`;
  }

  currentUser = {
    id: "usr_tg_" + Date.now(),
    name: tgName,
    location: "Franco / Mary Slessor",
    telegram: tgHandle,
    canSell: true,
    tier: "Free Student",
    points: 150
  };

  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Logged in via Telegram!");
  showMainApp();
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

  if (viewId === 'profile-view') {
    updateProfileUI();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
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

// Render Products with "Chat on Telegram"
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

// Generate direct Telegram chat link
function formatTelegramLink(contact, productTitle) {
  const cleanContact = String(contact).trim().replace('@', '');
  const message = encodeURIComponent(`Hi, I saw your listing on Nexbuy: "${productTitle}". Is it still available?`);
  
  if (cleanContact.startsWith('0') || cleanContact.startsWith('234') || cleanContact.startsWith('+')) {
    const phone = cleanContact.replace(/\D/g, '').replace(/^0/, '234');
    return `https://t.me/+${phone}`;
  }
  return `https://t.me/${cleanContact}?text=${message}`;
}

// Handle Post Product
function handlePostProduct(e) {
  e.preventDefault();

  const title = document.getElementById('post-title').value;
  const price = document.getElementById('post-price').value;
  const category = document.getElementById('post-category').value;
  const location = document.getElementById('post-location').value;
  let contact = document.getElementById('post-contact').value.trim();
  let image = document.getElementById('post-image').value.trim();
  const desc = document.getElementById('post-desc').value;

  if (!contact.startsWith('@') && !contact.match(/^\d+$/)) {
    contact = '@' + contact;
  }

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

  document.getElementById('sell-form').reset();
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

  // Filter and count current user's listings
  const myItems = products.filter(p => p.sellerId === currentUser.id);
  document.getElementById('prof-active-listings').innerText = myItems.length;

  // Render My Posted Items in Profile
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
