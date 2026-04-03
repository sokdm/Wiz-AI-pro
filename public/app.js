const API_URL = 'http://localhost:8090/api';
let currentToken = localStorage.getItem('wizToken');
let currentUser = null;
let statusCheckInterval = null;
let currentSessionId = null;
let countdownInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initScrollAnimations();
    initCounters();
    
    if (currentToken) {
        loadUser();
    } else {
        loadCommands();
    }
    
    setupNavigation();
    setupCommandCategories();
});

function setupNavigation() {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            showPage(page);
            document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });
}

function setupCommandCategories() {
    document.querySelectorAll('.cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterCommands(btn.dataset.cat);
        });
    });
}

function initParticles() {
    const container = document.getElementById('particles');
    if (!container) return;
    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: absolute;
            width: ${Math.random() * 3 + 1}px;
            height: ${Math.random() * 3 + 1}px;
            background: rgba(138,43,226,${Math.random() * 0.5});
            border-radius: 50%;
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
            animation: float ${Math.random() * 10 + 5}s infinite;
        `;
        container.appendChild(particle);
    }
}

function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('animate');
        });
    }, { threshold: 0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
}

function initCounters() {
    document.querySelectorAll('.stat-number').forEach(counter => {
        const target = parseInt(counter.dataset.count);
        let current = 0;
        const timer = setInterval(() => {
            current += target / 50;
            if (current >= target) {
                counter.textContent = target + (counter.textContent.includes('%') ? '%' : '+');
                clearInterval(timer);
            } else {
                counter.textContent = Math.floor(current);
            }
        }, 30);
    });
}

// Auth
function showLogin() {
    closeModals();
    const modal = document.getElementById('loginModal');
    if (modal) modal.classList.remove('hidden');
}

function showRegister() {
    closeModals();
    const modal = document.getElementById('registerModal');
    if (modal) modal.classList.remove('hidden');
}

function closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername')?.value;
    const password = document.getElementById('loginPassword')?.value;
    
    if (!username || !password) {
        alert('Please enter username and password');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        if (data.error) {
            alert(data.error);
            return;
        }
        
        currentToken = data.token;
        localStorage.setItem('wizToken', currentToken);
        currentUser = data.user;
        closeModals();
        showDashboard();
    } catch (err) {
        alert('Login failed: ' + err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername')?.value;
    const email = document.getElementById('regEmail')?.value;
    const password = document.getElementById('regPassword')?.value;
    
    if (!username || !email || !password) {
        alert('Please fill all fields');
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        
        const data = await res.json();
        if (data.error) {
            alert(data.error);
            return;
        }
        
        currentToken = data.token;
        localStorage.setItem('wizToken', currentToken);
        currentUser = data.user;
        closeModals();
        showDashboard();
    } catch (err) {
        alert('Registration failed: ' + err.message);
    }
}

async function loadUser() {
    try {
        const res = await fetch(`${API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        currentUser = data.user;
    } catch (err) {
        logout();
    }
}

function logout() {
    currentToken = null;
    currentUser = null;
    localStorage.removeItem('wizToken');
    location.reload();
}

// Dashboard
function showDashboard() {
    document.getElementById('hero')?.classList.add('hidden');
    document.getElementById('features')?.classList.add('hidden');
    document.getElementById('commands')?.classList.add('hidden');
    document.getElementById('dashboard')?.classList.remove('hidden');
    document.getElementById('navActions')?.classList.add('hidden');
    document.getElementById('navUser')?.classList.remove('hidden');
    document.getElementById('userName').textContent = currentUser?.username || 'User';
    
    showPage('overview');
    loadDashboardData();
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const selectedPage = document.getElementById(`page-${page}`);
    if (selectedPage) selectedPage.classList.add('active');
    
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.sidebar-link[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    if (page === 'commands') loadDashboardCommands();
    if (page === 'servers') loadServers();
    if (page === 'overview') loadDashboardData();
}

async function loadDashboardData() {
    try {
        const res = await fetch(`${API_URL}/dashboard/stats`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        
        document.getElementById('statMessages').textContent = data.stats?.messagesProcessed || 0;
        document.getElementById('statCommands').textContent = data.stats?.commandsUsed || 0;
        document.getElementById('statGroups').textContent = data.stats?.groupsManaged || 0;
        document.getElementById('statUptime').textContent = Math.floor((data.uptime || 0) / 3600) + 'h';
        
        if (currentUser?.whatsappSession?.connected) updateConnectionUI(true);
    } catch (err) {
        console.error('Failed to load dashboard data:', err);
    }
}

// WhatsApp Connection - FIXED
function updatePhoneExample() {
    const country = document.getElementById('countryCode')?.value;
    const examples = {
        '234': 'Example: 8012345678 (without +234)',
        '1': 'Example: 2015550123',
        '44': 'Example: 7700900123',
        '91': 'Example: 9876543210',
        '27': 'Example: 831234567',
        '254': 'Example: 712345678',
        '233': 'Example: 201234567',
        '255': 'Example: 712345678',
        '256': 'Example: 712345678',
        '20': 'Example: 1012345678',
        '212': 'Example: 612345678',
        '251': 'Example: 911234567',
        'other': 'Enter full number with country code'
    };
    const el = document.getElementById('phoneExample');
    if (el) el.textContent = examples[country] || 'Enter your phone number';
}

async function startPairing() {
    const countryCode = document.getElementById('countryCode')?.value;
    const phoneInput = document.getElementById('phoneInput')?.value;
    
    if (!phoneInput) {
        alert('Please enter your phone number');
        return;
    }
    
    const phoneNumber = phoneInput.trim().replace(/[^0-9]/g, '');
    if (phoneNumber.length < 7) {
        alert('Please enter a valid phone number');
        return;
    }
    
    let fullNumber = countryCode === 'other' ? phoneNumber : countryCode + phoneNumber;
    
    const btn = document.querySelector('#connectionForm .btn');
    if (btn) {
        btn.innerHTML = '<span>Connecting...</span>';
        btn.disabled = true;
    }
    
    try {
        const res = await fetch(`${API_URL}/whatsapp/pair`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({ phoneNumber: fullNumber })
        });
        
        const data = await res.json();
        if (data.error) {
            alert(data.error);
            if (btn) {
                btn.innerHTML = '<span>🔗 Connect WhatsApp</span>';
                btn.disabled = false;
            }
            return;
        }
        
        currentSessionId = data.sessionId;
        
        document.getElementById('connectionForm')?.classList.add('hidden');
        document.getElementById('connectionResult')?.classList.remove('hidden');
        
        const pairingCode = document.getElementById('pairingCode');
        const qrImage = document.getElementById('qrImage');
        const qrLoading = document.getElementById('qrLoading');
        const connText = document.getElementById('connectionText');
        
        if (pairingCode) pairingCode.textContent = '------';
        if (qrImage) {
            qrImage.src = '';
            qrImage.style.display = 'none';
        }
        if (qrLoading) qrLoading.style.display = 'block';
        if (connText) connText.textContent = 'Initializing connection...';
        
        startCountdown();
        startStatusCheck(data.sessionId);
        
    } catch (err) {
        alert('Connection failed: ' + err.message);
        if (btn) {
            btn.innerHTML = '<span>🔗 Connect WhatsApp</span>';
            btn.disabled = false;
        }
    }
}

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    let seconds = 120;
    
    countdownInterval = setInterval(() => {
        seconds--;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const el = document.getElementById('countdown');
        if (el) el.textContent = `⏱️ Code expires in: ${mins}:${secs.toString().padStart(2, '0')}`;
        
        if (seconds <= 0) {
            clearInterval(countdownInterval);
            const el = document.getElementById('countdown');
            if (el) el.textContent = '⏱️ Code expired. Please try again.';
        }
    }, 1000);
}

function startStatusCheck(sessionId) {
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    let attempts = 0;
    
    statusCheckInterval = setInterval(async () => {
        attempts++;
        if (attempts > 60) {
            clearInterval(statusCheckInterval);
            const el = document.getElementById('connectionText');
            if (el) el.textContent = 'Connection timeout. Please try again.';
            return;
        }
        
        try {
            const res = await fetch(`${API_URL}/whatsapp/status/${sessionId}`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            
            const data = await res.json();
            const pairingCodeEl = document.getElementById('pairingCode');
            const qrImage = document.getElementById('qrImage');
            const qrLoading = document.getElementById('qrLoading');
            const connText = document.getElementById('connectionText');
            
            // Update pairing code
            if (data.pairingCode && data.pairingCode !== '------' && pairingCodeEl && pairingCodeEl.textContent !== data.pairingCode) {
                pairingCodeEl.textContent = data.pairingCode;
                if (connText) connText.innerHTML = '✅ <b>Pairing code ready!</b> Enter in WhatsApp now';
                showResultTab('code');
            }
            
            // Update QR code - FIXED
            if (data.qrCode && qrImage) {
                if (qrLoading) qrLoading.style.display = 'none';
                qrImage.src = data.qrCode;
                qrImage.style.display = 'block';
            }
            
            if (data.connected) {
                clearInterval(countdownInterval);
                updateConnectionUI(true);
                clearInterval(statusCheckInterval);
            }
            
        } catch (err) {
            console.error('Status check failed:', err);
        }
    }, 2000);
}

function updateConnectionUI(connected) {
    if (!connected) return;
    
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.classList.add('connected');
        const statusText = statusEl.querySelector('.status-text');
        const statusIcon = statusEl.querySelector('.status-icon');
        if (statusText) statusText.innerHTML = '✅ <b>Connected to WhatsApp</b>';
        if (statusIcon) statusIcon.textContent = '📱';
    }
    const result = document.getElementById('connectionResult');
    if (result) result.classList.add('hidden');
    
    const form = document.getElementById('connectionForm');
    if (form) {
        form.innerHTML = `
            <div style="text-align: center; padding: 30px 20px;">
                <div style="font-size: 64px; margin-bottom: 15px;">✅</div>
                <p style="color: var(--success); font-size: 18px; margin-bottom: 10px; font-weight: 600;">WhatsApp Connected!</p>
                <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 25px;">Your bot is now active</p>
                <button class="btn btn-outline btn-full" onclick="disconnectWhatsApp()" style="max-width: 200px;">Disconnect</button>
            </div>
        `;
        form.classList.remove('hidden');
    }
}

async function disconnectWhatsApp() {
    try {
        await fetch(`${API_URL}/whatsapp/disconnect`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        location.reload();
    } catch (err) {
        alert('Failed to disconnect');
    }
}

function showResultTab(tab) {
    const tabs = document.querySelectorAll('.result-tab');
    const contents = document.querySelectorAll('.result-content');
    
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.add('hidden'));
    
    if (tab === 'code' && tabs[0]) {
        tabs[0].classList.add('active');
        const codeTab = document.getElementById('codeTab');
        if (codeTab) codeTab.classList.remove('hidden');
    } else if (tabs[1]) {
        tabs[1].classList.add('active');
        const qrTab = document.getElementById('qrTab');
        if (qrTab) qrTab.classList.remove('hidden');
    }
}

// Commands
async function loadCommands() {
    try {
        const res = await fetch(`${API_URL}/commands`, {
            headers: currentToken ? { 'Authorization': `Bearer ${currentToken}` } : {}
        });
        const data = await res.json();
        renderCommands(data.commands || []);
    } catch (err) {
        renderCommands([
            { name: 'tagall', category: 'group' },
            { name: 'ai', category: 'ai' },
            { name: 'sticker', category: 'media' },
            { name: 'joke', category: 'fun' },
            { name: 'help', category: 'utility' }
        ]);
    }
}

function renderCommands(commands) {
    const grid = document.getElementById('commandsGrid');
    if (!grid) return;
    grid.innerHTML = commands.map(cmd => `
        <div class="command-item" data-cat="${cmd.category}">
            <span class="cmd-name">.${cmd.name}</span>
            <span class="cmd-desc">${cmd.category}</span>
        </div>
    `).join('');
}

function filterCommands(category) {
    document.querySelectorAll('.command-item').forEach(item => {
        item.style.display = (category === 'all' || item.dataset.cat === category) ? 'flex' : 'none';
    });
}

async function loadDashboardCommands() {
    const list = document.getElementById('dashboardCommands');
    if (!list) return;
    try {
        const res = await fetch(`${API_URL}/commands`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        const commands = data.commands || [];
        list.innerHTML = commands.map(cmd => `
            <div class="command-item">
                <span class="cmd-name">.${cmd.name}</span>
                <span class="cmd-desc">${cmd.category}${cmd.adminOnly ? ' • Admin' : ''}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('Failed to load dashboard commands:', err);
    }
}

// Settings
async function saveSettings() {
    const settings = {
        autoReply: document.getElementById('settingAutoReply')?.checked || false,
        welcomeMessage: document.getElementById('settingWelcome')?.checked || false,
        aiMode: document.getElementById('settingAiMode')?.checked || false,
        autoRead: document.getElementById('settingAutoRead')?.checked || false
    };
    
    try {
        await fetch(`${API_URL}/whatsapp/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify(settings)
        });
        alert('✅ Settings saved successfully!');
    } catch (err) {
        alert('❌ Failed to save settings');
    }
}

// Servers
async function loadServers() {
    const grid = document.getElementById('serversGrid');
    if (!grid) return;
    
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading servers...</div>';
    
    try {
        const res = await fetch(`${API_URL}/servers`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        const servers = data.servers || [];
        const current = data.current || 'ng-1';
        
        grid.innerHTML = servers.map(server => `
            <div class="server-card ${server.id === current ? 'active' : ''}" onclick="selectServer('${server.id}')">
                <div class="server-status ${server.status}"></div>
                <h4>${server.name}</h4>
                <p>📍 ${server.location}</p>
                <span class="ping">⚡ ${server.ping}</span>
            </div>
        `).join('');
    } catch (err) {
        grid.innerHTML = `
            <div class="server-card active" onclick="selectServer('ng-1')">
                <div class="server-status online"></div>
                <h4>Nigeria Server 1</h4>
                <p>📍 Lagos</p>
                <span class="ping">⚡ 15ms</span>
            </div>
            <div class="server-card" onclick="selectServer('ng-2')">
                <div class="server-status online"></div>
                <h4>Nigeria Server 2</h4>
                <p>📍 Abuja</p>
                <span class="ping">⚡ 22ms</span>
            </div>
        `;
    }
}

function selectServer(serverId) {
    document.querySelectorAll('.server-card').forEach(card => card.classList.remove('active'));
    if (event?.currentTarget) event.currentTarget.classList.add('active');
    alert(`Server ${serverId} selected!`);
}

// Utility
function scrollToFeatures() {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
}

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) closeModals();
}
