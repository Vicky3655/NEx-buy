// Initialize Telegram Mini App
if (window.Telegram && window.Telegram.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  // Match Telegram theme colors with Nexbuy
  if (tg.setHeaderColor) tg.setHeaderColor('#0f051d');
  if (tg.setBackgroundColor) tg.setBackgroundColor('#0f051d');
}

// Initial Sample Data around UNN & Nsukka
const defaultProducts = [
  {
    id: 1,
    title: "GST 101 & 103 Textbook Pack",
    price: 3500,
    category: "Academics",
    location: "Mary Slessor Hostel",
    contact: "08012345678",
    image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80",
    desc: "Complete first year package with summarized past questions."
  },
  {
    id: 2,
    title: "HP Pavilion 15 (8GB RAM / 256 SSD)",
    price: 185000,
    category: "Gadgets",
    location: "Franco Hostel (UNN)",
    contact: "08087654321",
    image: "https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=400&q=80",
    desc: "Battery health is good. Suitable for coding and assignments."
  },
  {
    id: 3,
    title: "Mini Table Refrigerator",
    price: 48000,
    category: "Hostel",
    location: "Hilltop Area, Nsukka",
    contact: "08123456789",
    image: "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=400&q=80",
    desc: "Moving out after graduation. Works perfectly."
  },
  {
    id: 4,
    title: "Vintage Denim Jacket",
    price: 7000,
    category: "Fashion",
    location: "Nkrumah Hostel",
    contact: "09011223344",
    image: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=400&q=80",
    desc: "Oversized, UNN campus style."
  }
];

// App State
let products = JSON.parse(localStorage.getItem('nexbuy_products')) || defaultProducts;
let currentCategory = 'All';
let currentUser = JSON.parse(localStorage.getItem('nexbuy_user')) || null;

// Initialize App View
document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    showMainApp();
  }
  renderProducts();
});

// Switch Auth View Tabs (Login / Register)
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

// Handle Sign In
function handleLogin(e) {
  e.preventDefault();
  const loginId = document.getElementById('login-id').value;
  currentUser = {
    name: loginId.includes('@') ? loginId.split('@')[0] : "UNN Lion",
    location: "UNN Nsukka Campus",
    phone: "08012345678"
  };
  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Welcome back to Nexbuy!");
  showMainApp();
}

// Handle Registration
function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const location = document.getElementById('reg-location').value;
  const phone = document.getElementById('reg-phone').value;

  currentUser = { name, location, phone };
  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Account Created Successfully!");
  showMainApp();
}

// Telegram Fast Auth (Takes Telegram User data if available)
function handleTelegramQuickAuth() {
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe?.user) {
    const tgUser = window.Telegram.WebApp.initDataUnsafe.user;
    currentUser = {
      name: `${tgUser.first_name} ${tgUser.last_name || ''}`.trim(),
      location: "UNN Campus",
      phone: tgUser.username ? `@${tgUser.username}` : "Telegram User"
    };
  } else {
    currentUser = {
      name: "UNN Scholar",
      location: "Franco / Mary Slessor",
      phone: "080-TELEGRAM"
    };
  }
  localStorage.setItem('nexbuy_user', JSON.stringify(currentUser));
  showToast("Logged in via Telegram!");
  showMainApp();
}

// Show Main Dashboard
function showMainApp() {
  document.getElementById('auth-container').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  
  if (currentUser) {
    document.getElementById('nav-user-name').innerText = currentUser.name.split(' ')[0];
    document.getElementById('prof-name').innerText = currentUser.name;
    document.getElementById('prof-hostel').innerText = `${currentUser.location} • UNN`;
  }
}

// Handle Logout
function handleLogout() {
  localStorage.removeItem('nexbuy_user');
  currentUser = null;
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('auth-container').classList.remove('hidden');
  showToast("Signed out.");
}

// Navigation Tabs Switcher
function switchView(viewId) {
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('active');
  });

  const targetPanel = document.getElementById(viewId);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // Update Bottom Nav active indicator
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

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Filter Categories
function setCategory(cat) {
  currentCategory = cat;
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.classList.toggle('active', pill.innerText.trim() === (cat === 'Academics' ? 'Books & Notes' : cat));
  });
  filterProducts();
}

// Filter & Search Logic
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

// Render Products
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
        <p>No listings found. Be the first to post!</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(product => `
    <div class="product-card">
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

// Format Phone helper for WhatsApp link
function formatPhone(phone) {
  return phone.replace(/^0/, '').replace(/\D/g, '');
}

// Handle Posting New Listing
function handlePostProduct(e) {
  e.preventDefault();

  const title = document.getElementById('post-title').value;
  const price = document.getElementById('post-price').value;
  const category = document.getElementById('post-category').value;
  const location = document.getElementById('post-location').value;
  const contact = document.getElementById('post-contact').value;
  let image = document.getElementById('post-image').value.trim();
  const desc = document.getElementById('post-desc').value;

  if (!image) {
    // Default image if student doesn't provide URL
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
    title,
    price,
    category,
    location,
    contact,
    image,
    desc
  };

  products.unshift(newProduct);
  localStorage.setItem('nexbuy_products', JSON.stringify(products));

  document.getElementById('sell-form').reset();
  showToast("Listing published on UNN Marketplace!");
  
  // Return to marketplace view
  switchView('home-view');
  renderProducts();
}

// Toast helper
function showToast(text) {
  const toast = document.getElementById('toast');
  toast.innerText = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}
