/**
 * BUMP - Real-time Chat Application
 * Frontend JavaScript with Socket.io
 * Features: Avatar Selection, Notifications, Settings
 */

// ========================================
// CONFIGURATION
// ========================================

const CONFIG = {
    SERVER_URL: window.location.origin,
    API_URL: window.location.origin + '/api'
};

// ========================================
// SETTINGS MANAGER
// ========================================

const Settings = {
    defaults: {
        notifications: true,
        sounds: true,
        soundType: 'pop',
        onlineStatus: true,
        readReceipts: true,
        avatarStyle: 'avataaars',
        bubbleStyle: 'rounded',
        chatBackground: 'default'
    },
    
    soundUrls: {
        pop: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
        ding: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',
        chime: 'https://assets.mixkit.co/active_storage/sfx/2309/2309-preview.mp3',
        bubble: 'https://assets.mixkit.co/active_storage/sfx/2357/2357-preview.mp3'
    },
    
    get(key) {
        const settings = JSON.parse(localStorage.getItem('bump_settings') || '{}');
        return settings[key] ?? this.defaults[key];
    },
    
    set(key, value) {
        const settings = JSON.parse(localStorage.getItem('bump_settings') || '{}');
        settings[key] = value;
        localStorage.setItem('bump_settings', JSON.stringify(settings));
    },
    
    getAll() {
        const stored = JSON.parse(localStorage.getItem('bump_settings') || '{}');
        return { ...this.defaults, ...stored };
    },
    
    getSoundUrl() {
        const type = this.get('soundType');
        return this.soundUrls[type] || this.soundUrls.pop;
    }
};

// ========================================
// NOTIFICATION MANAGER (IMPROVED)
// ========================================

const NotificationManager = {
    permission: 'default',
    audioContext: null,
    
    async init() {
        if ('Notification' in window) {
            this.permission = Notification.permission;
        }
        // Create audio context on user interaction
        document.addEventListener('click', () => this.initAudioContext(), { once: true });
        document.addEventListener('keydown', () => this.initAudioContext(), { once: true });
    },
    
    initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    
    async requestPermission() {
        if ('Notification' in window) {
            this.permission = await Notification.requestPermission();
            return this.permission === 'granted';
        }
        return false;
    },
    
    show(title, body, icon) {
        if (!Settings.get('notifications')) return;
        
        // Request permission if not granted
        if (this.permission !== 'granted') {
            this.requestPermission().then(granted => {
                if (granted) this.show(title, body, icon);
            });
            return;
        }
        
        // Don't show if app is focused
        if (document.hasFocus()) return;
        
        try {
            const notification = new Notification(title, {
                body,
                icon: icon || '/favicon.ico',
                badge: '/favicon.ico',
                tag: 'bump-message-' + Date.now(),
                renotify: true,
                requireInteraction: false,
                silent: false
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            setTimeout(() => notification.close(), 5000);
        } catch (e) {
            console.log('Notification error:', e);
        }
    },
    
    async playSound() {
        if (!Settings.get('sounds')) return;
        
        try {
            const audio = document.getElementById('notification-sound');
            if (audio) {
                audio.src = Settings.getSoundUrl();
                audio.currentTime = 0;
                audio.volume = 0.7;
                
                // Try multiple play strategies
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                    playPromise.catch(async () => {
                        // Fallback: Use Web Audio API
                        if (this.audioContext) {
                            try {
                                const response = await fetch(Settings.getSoundUrl());
                                const arrayBuffer = await response.arrayBuffer();
                                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                                const source = this.audioContext.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(this.audioContext.destination);
                                source.start(0);
                            } catch (e) {
                                console.log('Audio fallback failed:', e);
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.log('Sound error:', e);
        }
    }
};

// ========================================
// SOCKET CONNECTION
// ========================================

let socket = null;

function initSocket() {
    socket = io(CONFIG.SERVER_URL);

    socket.on('connect', () => {
        console.log('Connected to server');
        
        const currentUser = getCurrentUser();
        if (currentUser && Settings.get('onlineStatus')) {
            socket.emit('user_online', {
                userId: currentUser.id,
                username: currentUser.username,
                fullName: currentUser.fullName,
                avatar: currentUser.avatar
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showToast('Connection lost. Reconnecting...', 'warning');
    });

    socket.on('reconnect', () => {
        console.log('Reconnected to server');
        showToast('Reconnected!', 'success');
        
        const currentUser = getCurrentUser();
        if (currentUser && Settings.get('onlineStatus')) {
            socket.emit('user_online', {
                userId: currentUser.id,
                username: currentUser.username,
                fullName: currentUser.fullName,
                avatar: currentUser.avatar
            });
        }
    });

    socket.on('receive_message', handleIncomingMessage);
    socket.on('message_sent', handleMessageSent);
    socket.on('online_users', handleOnlineUsersUpdate);
    socket.on('user_status_changed', handleUserStatusChange);
    socket.on('user_typing', handleUserTyping);
    socket.on('user_stopped_typing', handleUserStoppedTyping);
    socket.on('messages_read', handleMessagesRead);
    socket.on('message_deleted', handleMessageDeleted);
}

// Handle message deletion from other user
function handleMessageDeleted({ messageId, conversationId }) {
    // Remove from local state
    if (AppState.messages[conversationId]) {
        AppState.messages[conversationId] = AppState.messages[conversationId].filter(m => m.id !== messageId);
    }
    // Remove from DOM
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
        msgEl.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => msgEl.remove(), 300);
    }
}

// ========================================
// API FUNCTIONS
// ========================================

async function apiRequest(endpoint, method = 'GET', data = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(`${CONFIG.API_URL}${endpoint}`, options);
    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || 'Request failed');
    }

    return result;
}

// ========================================
// LOCAL STORAGE
// ========================================

function getCurrentUser() {
    const userData = localStorage.getItem('bump_user');
    return userData ? JSON.parse(userData) : null;
}

function setCurrentUser(user) {
    localStorage.setItem('bump_user', JSON.stringify(user));
}

function clearCurrentUser() {
    localStorage.removeItem('bump_user');
}

// ========================================
// APP STATE
// ========================================

const AppState = {
    currentView: 'chats',
    selectedChat: null,
    selectedUser: null,
    isProfilePanelOpen: false,
    onlineUsers: new Set(),
    typingUsers: new Set(),
    conversations: [],
    messages: {},
    users: [],
    selectedAvatarStyle: 'avataaars'
};

// ========================================
// DOM ELEMENTS
// ========================================

const DOM = {};

function initDOM() {
    // Auth
    DOM.authContainer = document.getElementById('auth-container');
    DOM.appContainer = document.getElementById('app-container');
    DOM.loginForm = document.getElementById('login-form');
    DOM.signupForm = document.getElementById('signup-form');
    DOM.showSignup = document.getElementById('show-signup');
    DOM.showLogin = document.getElementById('show-login');
    
    // Navigation
    DOM.navItems = document.querySelectorAll('.nav-item[data-view]');
    DOM.mobileNavItems = document.querySelectorAll('.mobile-nav-item[data-view]');
    DOM.logoutBtn = document.getElementById('logout-btn');
    
    // Sidebar
    DOM.chatsSidebar = document.getElementById('chats-sidebar');
    DOM.searchSidebar = document.getElementById('search-sidebar');
    DOM.profileSidebar = document.getElementById('profile-sidebar');
    DOM.settingsSidebar = document.getElementById('settings-sidebar');
    DOM.chatList = document.getElementById('chat-list');
    DOM.chatSearch = document.getElementById('chat-search');
    DOM.userSearch = document.getElementById('user-search');
    DOM.searchResults = document.getElementById('search-results');
    DOM.newChatBtn = document.getElementById('new-chat-btn');
    
    // Avatar Selection
    DOM.avatarTypeBtns = document.querySelectorAll('.avatar-type-btn');
    DOM.selectedAvatarStyle = document.getElementById('selected-avatar-style');
    DOM.settingsAvatarGrid = document.getElementById('settings-avatar-grid');
    
    // Profile
    DOM.myAvatar = document.getElementById('my-avatar');
    DOM.profileFullname = document.getElementById('profile-fullname');
    DOM.profileUsername = document.getElementById('profile-username');
    DOM.profileEmail = document.getElementById('profile-email');
    DOM.profileBio = document.getElementById('profile-bio');
    DOM.profileStatus = document.getElementById('profile-status');
    DOM.saveProfileBtn = document.getElementById('save-profile-btn');
    DOM.changeAvatarBtn = document.getElementById('change-avatar-btn');
    
    // Settings
    DOM.notificationsToggle = document.getElementById('notifications-toggle');
    DOM.soundsToggle = document.getElementById('sounds-toggle');
    DOM.soundTypeSelect = document.getElementById('sound-type-select');
    DOM.testSoundBtn = document.getElementById('test-sound-btn');
    DOM.onlineStatusToggle = document.getElementById('online-status-toggle');
    DOM.readReceiptsToggle = document.getElementById('read-receipts-toggle');
    DOM.aboutAppBtn = document.getElementById('about-app');
    DOM.logoutSettingsBtn = document.getElementById('logout-settings-btn');
    DOM.aboutModal = document.getElementById('about-modal');
    DOM.closeAboutModal = document.getElementById('close-about-modal');
    
    // Chat Window
    DOM.chatWindow = document.querySelector('.chat-window');
    DOM.emptyState = document.getElementById('empty-state');
    DOM.chatView = document.getElementById('chat-view');
    DOM.chatAvatar = document.getElementById('chat-avatar');
    DOM.chatUsername = document.getElementById('chat-username');
    DOM.chatStatus = document.getElementById('chat-status');
    DOM.chatMessages = document.getElementById('chat-messages');
    DOM.messageInput = document.getElementById('message-input');
    DOM.sendBtn = document.getElementById('send-btn');
    DOM.viewProfileBtn = document.getElementById('view-profile-btn');
    DOM.mobileBackBtn = document.getElementById('mobile-back-btn');
    
    // Profile Panel
    DOM.profilePanel = document.getElementById('profile-panel');
    DOM.closePanelBtn = document.getElementById('close-panel-btn');
    DOM.panelAvatarImg = document.getElementById('panel-avatar-img');
    DOM.panelFullname = document.getElementById('panel-fullname');
    DOM.panelUsername = document.getElementById('panel-username');
    DOM.panelStatus = document.getElementById('panel-status');
    DOM.panelBio = document.getElementById('panel-bio');
    DOM.panelEmail = document.getElementById('panel-email');
    DOM.panelJoined = document.getElementById('panel-joined');
    DOM.panelMessageBtn = document.getElementById('panel-message-btn');
    
    // Modal
    DOM.newChatModal = document.getElementById('new-chat-modal');
    DOM.newChatSearch = document.getElementById('new-chat-search');
    DOM.newChatUserList = document.getElementById('new-chat-user-list');
    DOM.modalClose = document.querySelector('.modal-close');
    
    // Avatar Picker Modal
    DOM.avatarPickerModal = document.getElementById('avatar-picker-modal');
    DOM.avatarPreview = document.getElementById('avatar-preview');
    DOM.avatarPickerGrid = document.getElementById('avatar-picker-grid');
    DOM.randomizeAvatarBtn = document.getElementById('randomize-avatar-btn');
    DOM.saveAvatarBtn = document.getElementById('save-avatar-btn');
    DOM.closeAvatarModal = document.getElementById('close-avatar-modal');
    
    // File & Media
    DOM.attachBtn = document.getElementById('attach-btn');
    DOM.cameraBtn = document.getElementById('camera-btn');
    DOM.voiceBtn = document.getElementById('voice-btn');
    DOM.fileInput = document.getElementById('file-input');
    DOM.cameraInput = document.getElementById('camera-input');
    
    // Chat Appearance Settings
    DOM.bubbleStyleSelect = document.getElementById('bubble-style-select');
    DOM.chatBgSelect = document.getElementById('chat-bg-select');
    
    // Toast
    DOM.toastContainer = document.getElementById('toast-container');
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 86400000 && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 172800000) return 'Yesterday';
    if (diff < 604800000) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMessageTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 86400000 && date.getDate() === now.getDate()) return 'Today';
    if (diff < 172800000) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatJoinDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type]} toast-icon"></i>
        <span class="toast-message">${message}</span>
    `;
    
    DOM.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function isUserOnline(userId) {
    return AppState.onlineUsers.has(userId);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function generateAvatar(seed, style = 'avataaars') {
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`;
}

// ========================================
// SOCKET EVENT HANDLERS
// ========================================

function handleIncomingMessage(data) {
    const { sender, ...message } = data;
    const currentUser = getCurrentUser();
    
    if (!currentUser) return;

    const convKey = message.senderId;
    if (!AppState.messages[convKey]) {
        AppState.messages[convKey] = [];
    }
    AppState.messages[convKey].push(message);

    if (AppState.selectedChat === message.senderId) {
        appendMessage(message);
        
        if (Settings.get('readReceipts')) {
            socket.emit('mark_read', {
                userId: currentUser.id,
                otherUserId: message.senderId
            });
        }
    } else {
        // Show notification for new message
        const notificationText = message.fileUrl 
            ? (message.fileType === 'image' ? '📷 Sent a photo' : 
               message.fileType === 'video' ? '🎥 Sent a video' :
               message.fileType === 'audio' ? '🎤 Sent a voice message' : '📎 Sent a file')
            : message.text;
        
        NotificationManager.show(
            sender?.fullName || 'New Message',
            notificationText,
            sender?.avatar
        );
        NotificationManager.playSound();
        showToast(`New message from ${sender?.fullName || 'Someone'}`, 'info');
    }

    loadConversations();
}

function handleMessageSent(message) {
    const convKey = message.receiverId;
    if (AppState.messages[convKey]) {
        const msgIndex = AppState.messages[convKey].findIndex(m => m.id === message.id);
        if (msgIndex !== -1) {
            AppState.messages[convKey][msgIndex] = message;
        }
    }
}

function handleOnlineUsersUpdate(users) {
    AppState.onlineUsers = new Set(users.map(u => u.userId));
    updateOnlineStatus();
}

function handleUserStatusChange({ userId, status }) {
    if (status === 'online') {
        AppState.onlineUsers.add(userId);
    } else {
        AppState.onlineUsers.delete(userId);
    }
    updateOnlineStatus();
}

function handleUserTyping({ userId }) {
    AppState.typingUsers.add(userId);
    updateTypingIndicator();
}

function handleUserStoppedTyping({ userId }) {
    AppState.typingUsers.delete(userId);
    updateTypingIndicator();
}

function handleMessagesRead({ userId, conversationId }) {
    if (AppState.selectedChat) {
        renderMessages(AppState.selectedChat);
    }
}

function updateOnlineStatus() {
    document.querySelectorAll('.chat-item').forEach(item => {
        const userId = item.dataset.userId;
        const indicator = item.querySelector('.status-indicator');
        if (indicator) {
            indicator.className = `status-indicator ${isUserOnline(userId) ? 'online' : 'offline'}`;
        }
    });

    if (AppState.selectedChat && AppState.selectedUser) {
        const statusEl = DOM.chatStatus;
        if (isUserOnline(AppState.selectedChat)) {
            statusEl.textContent = 'Online';
            statusEl.className = 'user-status online';
        } else {
            statusEl.textContent = 'Offline';
            statusEl.className = 'user-status offline';
        }
    }
}

function updateTypingIndicator() {
    if (AppState.selectedChat && AppState.typingUsers.has(AppState.selectedChat)) {
        DOM.chatStatus.innerHTML = `
            <span class="typing-indicator">
                <span></span><span></span><span></span>
            </span>
            typing...
        `;
        DOM.chatStatus.className = 'user-status typing';
    } else if (AppState.selectedChat) {
        updateOnlineStatus();
    }
}

// ========================================
// AUTHENTICATION
// ========================================

async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    try {
        const result = await apiRequest('/login', 'POST', { username, password });
        
        setCurrentUser(result.user);
        showToast(`Welcome back, ${result.user.fullName}!`, 'success');
        
        if (Settings.get('onlineStatus')) {
            socket.emit('user_online', {
                userId: result.user.id,
                username: result.user.username,
                fullName: result.user.fullName,
                avatar: result.user.avatar
            });
        }
        
        initApp();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function handleSignup(e) {
    e.preventDefault();
    
    const fullName = document.getElementById('signup-fullname').value.trim();
    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const avatarStyle = AppState.selectedAvatarStyle;

    if (!fullName || !username || !email || !password) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    if (password.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
    }

    try {
        const result = await apiRequest('/register', 'POST', { 
            fullName, username, email, password, avatarStyle 
        });
        
        setCurrentUser(result.user);
        Settings.set('avatarStyle', avatarStyle);
        showToast(`Welcome to Bump, ${result.user.fullName}!`, 'success');
        
        if (Settings.get('onlineStatus')) {
            socket.emit('user_online', {
                userId: result.user.id,
                username: result.user.username,
                fullName: result.user.fullName,
                avatar: result.user.avatar
            });
        }
        
        initApp();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function handleLogout() {
    const currentUser = getCurrentUser();
    
    if (currentUser && socket) {
        socket.emit('user_offline', { userId: currentUser.id });
    }
    
    clearCurrentUser();
    
    DOM.appContainer.classList.add('hidden');
    DOM.authContainer.classList.remove('hidden');
    
    DOM.loginForm.reset();
    DOM.signupForm.reset();
    
    AppState.selectedChat = null;
    AppState.selectedUser = null;
    AppState.conversations = [];
    AppState.messages = {};
    
    showToast('Logged out successfully', 'success');
}

// ========================================
// NAVIGATION
// ========================================

function switchView(view) {
    AppState.currentView = view;
    
    DOM.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    
    DOM.mobileNavItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    
    DOM.chatsSidebar?.classList.toggle('active', view === 'chats');
    DOM.searchSidebar?.classList.toggle('active', view === 'search');
    DOM.profileSidebar?.classList.toggle('active', view === 'profile');
    DOM.settingsSidebar?.classList.toggle('active', view === 'settings');
    
    if (view === 'profile') updateProfileView();
    if (view === 'search') loadAllUsers();
    if (view === 'settings') loadSettings();
    
    if (window.innerWidth <= 768) closeChatOnMobile();
}

function openChatOnMobile() {
    if (window.innerWidth <= 768 && DOM.chatWindow) {
        DOM.chatWindow.classList.add('active');
    }
}

function closeChatOnMobile() {
    if (DOM.chatWindow) {
        DOM.chatWindow.classList.remove('active');
    }
    AppState.selectedChat = null;
    AppState.selectedUser = null;
    DOM.chatView?.classList.add('hidden');
    DOM.emptyState?.classList.remove('hidden');
}

function openAboutModal() {
    DOM.aboutModal?.classList.remove('hidden');
}

function closeAboutModalFunc() {
    DOM.aboutModal?.classList.add('hidden');
}

// ========================================
// SETTINGS
// ========================================

function loadSettings() {
    const settings = Settings.getAll();
    
    if (DOM.notificationsToggle) DOM.notificationsToggle.checked = settings.notifications;
    if (DOM.soundsToggle) DOM.soundsToggle.checked = settings.sounds;
    if (DOM.soundTypeSelect) DOM.soundTypeSelect.value = settings.soundType || 'pop';
    if (DOM.onlineStatusToggle) DOM.onlineStatusToggle.checked = settings.onlineStatus;
    if (DOM.readReceiptsToggle) DOM.readReceiptsToggle.checked = settings.readReceipts;
    if (DOM.bubbleStyleSelect) DOM.bubbleStyleSelect.value = settings.bubbleStyle || 'rounded';
    if (DOM.chatBgSelect) DOM.chatBgSelect.value = settings.chatBackground || 'default';
    
    // Apply appearance settings
    applyChatAppearance();
}

function setupSettingsListeners() {
    DOM.notificationsToggle?.addEventListener('change', async (e) => {
        Settings.set('notifications', e.target.checked);
        if (e.target.checked) {
            await NotificationManager.requestPermission();
        }
        showToast(`Notifications ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
    });
    
    DOM.soundsToggle?.addEventListener('change', (e) => {
        Settings.set('sounds', e.target.checked);
        showToast(`Sounds ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
    });
    
    DOM.soundTypeSelect?.addEventListener('change', (e) => {
        Settings.set('soundType', e.target.value);
        showToast(`Sound type changed to ${e.target.value}`, 'success');
    });
    
    DOM.testSoundBtn?.addEventListener('click', () => {
        const audio = document.getElementById('notification-sound');
        if (audio) {
            audio.src = Settings.getSoundUrl();
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
    });
    
    DOM.onlineStatusToggle?.addEventListener('change', (e) => {
        Settings.set('onlineStatus', e.target.checked);
        const currentUser = getCurrentUser();
        if (currentUser && socket) {
            if (e.target.checked) {
                socket.emit('user_online', {
                    userId: currentUser.id,
                    username: currentUser.username,
                    fullName: currentUser.fullName,
                    avatar: currentUser.avatar
                });
            } else {
                socket.emit('user_offline', { userId: currentUser.id });
            }
        }
        showToast(`Online status ${e.target.checked ? 'visible' : 'hidden'}`, 'success');
    });
    
    DOM.readReceiptsToggle?.addEventListener('change', (e) => {
        Settings.set('readReceipts', e.target.checked);
        showToast(`Read receipts ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
    });
    
    // Avatar style selection in settings
    DOM.settingsAvatarGrid?.querySelectorAll('.avatar-style-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const style = btn.dataset.style;
            const currentUser = getCurrentUser();
            if (!currentUser) return;
            
            const newAvatar = generateAvatar(currentUser.username, style);
            
            try {
                await apiRequest(`/users/${currentUser.id}`, 'PUT', { avatar: newAvatar });
                setCurrentUser({ ...currentUser, avatar: newAvatar });
                DOM.myAvatar.src = newAvatar;
                Settings.set('avatarStyle', style);
                
                DOM.settingsAvatarGrid.querySelectorAll('.avatar-style-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                showToast('Avatar style updated!', 'success');
            } catch (error) {
                showToast(error.message, 'error');
            }
        });
    });
}

// ========================================
// CONVERSATIONS & CHAT LIST
// ========================================

async function loadConversations() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    try {
        const conversations = await apiRequest(`/conversations/${currentUser.id}`);
        AppState.conversations = conversations;
        renderChatList();
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

function renderChatList(filter = '') {
    const conversations = filter 
        ? AppState.conversations.filter(c => 
            c.user.fullName.toLowerCase().includes(filter.toLowerCase()) ||
            c.user.username.toLowerCase().includes(filter.toLowerCase())
          )
        : AppState.conversations;

    if (conversations.length === 0) {
        DOM.chatList.innerHTML = `
            <div class="no-results">
                <i class="fas fa-comments"></i>
                <p>${filter ? 'No chats found' : 'No conversations yet. Start a new chat!'}</p>
            </div>
        `;
        return;
    }

    DOM.chatList.innerHTML = conversations.map(conv => `
        <div class="chat-item ${AppState.selectedChat === conv.user.id ? 'active' : ''}" data-user-id="${conv.user.id}">
            <div class="chat-item-avatar">
                <img src="${conv.user.avatar}" alt="${conv.user.fullName}">
                <span class="status-indicator ${isUserOnline(conv.user.id) ? 'online' : 'offline'}"></span>
            </div>
            <div class="chat-item-info">
                <div class="chat-item-header">
                    <span class="chat-item-name">${conv.user.fullName}</span>
                    <span class="chat-item-time">${formatTime(conv.lastMessage?.timestamp)}</span>
                </div>
                <div class="chat-item-unread">
                    <span class="chat-item-preview">${conv.lastMessage?.text || 'No messages yet'}</span>
                    ${conv.unreadCount > 0 ? `<span class="unread-badge">${conv.unreadCount}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    DOM.chatList.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', () => openChat(item.dataset.userId));
    });
}

// ========================================
// CHAT & MESSAGES
// ========================================

async function openChat(userId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    AppState.selectedChat = userId;

    let user = AppState.conversations.find(c => c.user.id === userId)?.user;
    
    if (!user) {
        try {
            user = await apiRequest(`/users/${userId}`);
        } catch (error) {
            showToast('User not found', 'error');
            return;
        }
    }

    AppState.selectedUser = user;

    DOM.emptyState.classList.add('hidden');
    DOM.chatView.classList.remove('hidden');

    DOM.chatAvatar.src = user.avatar;
    DOM.chatUsername.textContent = user.fullName;
    
    if (isUserOnline(userId)) {
        DOM.chatStatus.textContent = 'Online';
        DOM.chatStatus.className = 'user-status online';
    } else {
        DOM.chatStatus.textContent = 'Offline';
        DOM.chatStatus.className = 'user-status offline';
    }

    await loadMessages(userId);

    if (Settings.get('readReceipts')) {
        socket.emit('mark_read', {
            userId: currentUser.id,
            otherUserId: userId
        });
    }

    renderChatList();
    DOM.messageInput.focus();
    openChatOnMobile();
}

async function loadMessages(userId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    socket.emit('get_messages', { 
        userId: currentUser.id, 
        otherUserId: userId 
    }, (messages) => {
        AppState.messages[userId] = messages;
        renderMessages(userId);
    });
}

function renderMessages(userId) {
    const messages = AppState.messages[userId] || [];
    const currentUser = getCurrentUser();
    const bubbleStyle = Settings.get('bubbleStyle');
    const isDiscord = bubbleStyle === 'discord';
    const isSnapchat = bubbleStyle === 'snapchat';

    if (messages.length === 0) {
        DOM.chatMessages.innerHTML = `
            <div class="no-results">
                <i class="fas fa-paper-plane"></i>
                <p>No messages yet. Say hello!</p>
            </div>
        `;
        return;
    }

    let lastDate = null;
    let html = '';
    const otherUser = AppState.selectedUser;

    messages.forEach((msg, index) => {
        const msgDate = formatDate(msg.timestamp);

        if (msgDate !== lastDate) {
            html += `<div class="date-divider"><span>${msgDate}</span></div>`;
            lastDate = msgDate;
        }

        const isSent = msg.senderId === currentUser.id;
        const showReadReceipt = isSent && Settings.get('readReceipts');
        const senderName = isSent ? currentUser.fullName : (otherUser?.fullName || 'User');
        const senderAvatar = isSent ? currentUser.avatar : (otherUser?.avatar || '');
        
        let statusHtml = '';
        if (showReadReceipt) {
            if (msg.read) {
                statusHtml = `<span class="message-status-wrap"><i class="fas fa-check-double message-status read"></i><span class="message-seen-text">Seen</span></span>`;
            } else {
                statusHtml = `<i class="fas fa-check message-status"></i>`;
            }
        }
        
        // Check for media content
        const mediaHtml = msg.fileUrl ? renderMediaMessage(msg) : '';
        const textHtml = msg.text ? escapeHtml(msg.text) : '';
        
        // Message actions (delete, save) - always show for sent, download for media
        const hasMedia = msg.fileUrl && (msg.fileType === 'image' || msg.fileType === 'video');
        const actionsHtml = `
            <div class="message-actions">
                ${hasMedia ? `<button class="msg-action-btn save-btn" onclick="event.stopPropagation(); saveMedia('${msg.fileUrl}', '${msg.fileName || 'file'}')" title="Save to device"><i class="fas fa-download"></i></button>` : ''}
                ${isSent ? `<button class="msg-action-btn delete-btn" onclick="event.stopPropagation(); deleteMessage('${msg.id}')" title="Delete message"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        `;
        
        if (isDiscord) {
            html += `
                <div class="message ${isSent ? 'sent' : 'received'}" data-msg-id="${msg.id}" data-sender="${senderName}">
                    <img src="${senderAvatar}" alt="" class="message-avatar">
                    <div class="message-bubble">
                        <div class="message-header">
                            <span class="message-sender">${senderName}</span>
                            <span class="message-timestamp">${formatMessageTime(msg.timestamp)}</span>
                        </div>
                        <div class="message-content">${mediaHtml}${textHtml}</div>
                        ${actionsHtml}
                    </div>
                </div>
            `;
        } else if (isSnapchat) {
            html += `
                <div class="message ${isSent ? 'sent' : 'received'}" data-msg-id="${msg.id}" data-sender="${senderName}">
                    <div class="message-bubble">
                        ${mediaHtml}
                        ${textHtml}
                        ${actionsHtml}
                    </div>
                    <span class="message-time">
                        ${isSent ? '' : statusHtml}
                        ${msg.read && isSent ? '<span class="snap-delivered"><i class="fas fa-play"></i> Delivered</span>' : ''}
                    </span>
                </div>
            `;
        } else {
            html += `
                <div class="message ${isSent ? 'sent' : 'received'}" data-msg-id="${msg.id}" data-sender="${senderName}">
                    <div class="message-bubble">
                        ${mediaHtml}
                        ${textHtml}
                        ${actionsHtml}
                    </div>
                    <span class="message-time">
                        ${formatMessageTime(msg.timestamp)}
                        ${statusHtml}
                    </span>
                </div>
            `;
        }
    });

    DOM.chatMessages.innerHTML = html;
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    
    // Apply appearance settings
    applyChatAppearance();
}

function appendMessage(message) {
    const currentUser = getCurrentUser();
    const isSent = message.senderId === currentUser.id;
    const showReadReceipt = isSent && Settings.get('readReceipts');
    const bubbleStyle = Settings.get('bubbleStyle');
    const isDiscord = bubbleStyle === 'discord';
    const isSnapchat = bubbleStyle === 'snapchat';
    const otherUser = AppState.selectedUser;
    const senderName = isSent ? currentUser.fullName : (otherUser?.fullName || 'User');
    const senderAvatar = isSent ? currentUser.avatar : (otherUser?.avatar || '');

    let statusHtml = '';
    if (showReadReceipt) {
        if (message.read) {
            statusHtml = `<span class="message-status-wrap"><i class="fas fa-check-double message-status read"></i><span class="message-seen-text">Seen</span></span>`;
        } else {
            statusHtml = `<i class="fas fa-check message-status"></i>`;
        }
    }
    
    // Check for media content
    const mediaHtml = message.fileUrl ? renderMediaMessage(message) : '';
    const textHtml = message.text ? escapeHtml(message.text) : '';
    
    // Message actions
    const hasMedia = message.fileUrl && (message.fileType === 'image' || message.fileType === 'video');
    const actionsHtml = `
        <div class="message-actions">
            ${hasMedia ? `<button class="msg-action-btn save-btn" onclick="event.stopPropagation(); saveMedia('${message.fileUrl}', '${message.fileName || 'file'}')" title="Save to device"><i class="fas fa-download"></i></button>` : ''}
            ${isSent ? `<button class="msg-action-btn delete-btn" onclick="event.stopPropagation(); deleteMessage('${message.id}')" title="Delete message"><i class="fas fa-trash"></i></button>` : ''}
        </div>
    `;

    const messageEl = document.createElement('div');
    messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
    messageEl.dataset.msgId = message.id;
    messageEl.dataset.sender = senderName;
    
    if (isDiscord) {
        messageEl.innerHTML = `
            <img src="${senderAvatar}" alt="" class="message-avatar">
            <div class="message-bubble">
                <div class="message-header">
                    <span class="message-sender">${senderName}</span>
                    <span class="message-timestamp">${formatMessageTime(message.timestamp)}</span>
                </div>
                <div class="message-content">${mediaHtml}${textHtml}</div>
                ${actionsHtml}
            </div>
        `;
    } else if (isSnapchat) {
        messageEl.innerHTML = `
            <div class="message-bubble">
                ${mediaHtml}
                ${textHtml}
                ${actionsHtml}
            </div>
            <span class="message-time">
                ${message.read && isSent ? '<span class="snap-delivered"><i class="fas fa-play"></i> Delivered</span>' : ''}
            </span>
        `;
    } else {
        messageEl.innerHTML = `
            <div class="message-bubble">
                ${mediaHtml}
                ${textHtml}
                ${actionsHtml}
            </div>
            <span class="message-time">
                ${formatMessageTime(message.timestamp)}
                ${statusHtml}
            </span>
        `;
    }

    DOM.chatMessages.appendChild(messageEl);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function sendMessage() {
    const text = DOM.messageInput.value.trim();
    const currentUser = getCurrentUser();

    if (!text || !AppState.selectedChat || !currentUser) return;

    const message = {
        senderId: currentUser.id,
        receiverId: AppState.selectedChat,
        text
    };

    socket.emit('send_message', message);

    const localMessage = {
        id: Date.now().toString(),
        ...message,
        timestamp: new Date().toISOString(),
        read: false
    };

    if (!AppState.messages[AppState.selectedChat]) {
        AppState.messages[AppState.selectedChat] = [];
    }
    AppState.messages[AppState.selectedChat].push(localMessage);
    appendMessage(localMessage);

    DOM.messageInput.value = '';

    socket.emit('typing_stop', {
        senderId: currentUser.id,
        receiverId: AppState.selectedChat
    });
}

let typingTimeout = null;

function handleTyping() {
    const currentUser = getCurrentUser();
    if (!currentUser || !AppState.selectedChat) return;

    socket.emit('typing_start', {
        senderId: currentUser.id,
        receiverId: AppState.selectedChat
    });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing_stop', {
            senderId: currentUser.id,
            receiverId: AppState.selectedChat
        });
    }, 2000);
}

// ========================================
// USER SEARCH
// ========================================

async function loadAllUsers() {
    try {
        const users = await apiRequest('/users');
        const currentUser = getCurrentUser();
        AppState.users = users.filter(u => u.id !== currentUser?.id);
        renderSearchResults('');
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function renderSearchResults(query) {
    const users = query 
        ? AppState.users.filter(u => 
            u.fullName.toLowerCase().includes(query.toLowerCase()) ||
            u.username.toLowerCase().includes(query.toLowerCase())
          )
        : AppState.users;

    if (users.length === 0) {
        DOM.searchResults.innerHTML = `
            <div class="no-results">
                <i class="fas fa-user-slash"></i>
                <p>${query ? 'No users found' : 'No users yet'}</p>
            </div>
        `;
        return;
    }

    DOM.searchResults.innerHTML = users.map(user => `
        <div class="search-result-item" data-user-id="${user.id}">
            <img src="${user.avatar}" alt="${user.fullName}">
            <div class="search-result-info">
                <span class="search-result-name">${user.fullName}</span>
                <span class="search-result-username">@${user.username}</span>
            </div>
        </div>
    `).join('');

    DOM.searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => showUserProfile(item.dataset.userId));
    });
}

// ========================================
// PROFILE
// ========================================

function updateProfileView() {
    const user = getCurrentUser();
    if (!user) return;

    DOM.myAvatar.src = user.avatar;
    DOM.profileFullname.value = user.fullName;
    DOM.profileUsername.value = user.username;
    DOM.profileEmail.value = user.email;
    DOM.profileBio.value = user.bio || '';
    DOM.profileStatus.value = user.status || 'online';
}

async function saveProfile() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const updates = {
        fullName: DOM.profileFullname.value.trim(),
        email: DOM.profileEmail.value.trim(),
        bio: DOM.profileBio.value.trim(),
        status: DOM.profileStatus.value
    };

    try {
        const updatedUser = await apiRequest(`/users/${currentUser.id}`, 'PUT', updates);
        setCurrentUser({ ...currentUser, ...updatedUser });
        
        socket.emit('update_status', {
            userId: currentUser.id,
            status: updates.status
        });
        
        showToast('Profile updated!', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Avatar Picker State
const AvatarPicker = {
    currentStyle: 'avataaars',
    currentSeed: '',
    
    open() {
        const currentUser = getCurrentUser();
        if (!currentUser) return;
        
        this.currentSeed = currentUser.username || Math.random().toString(36).substr(2, 9);
        this.currentStyle = Settings.get('avatarStyle') || 'avataaars';
        
        this.updatePreview();
        this.highlightActiveStyle();
        
        DOM.avatarPickerModal?.classList.remove('hidden');
    },
    
    close() {
        DOM.avatarPickerModal?.classList.add('hidden');
    },
    
    selectStyle(style) {
        this.currentStyle = style;
        this.updatePreview();
        this.highlightActiveStyle();
    },
    
    randomize() {
        this.currentSeed = Math.random().toString(36).substr(2, 9);
        this.updatePreview();
        this.updatePickerImages();
    },
    
    updatePreview() {
        const url = generateAvatar(this.currentSeed, this.currentStyle);
        DOM.avatarPreview.src = url;
    },
    
    updatePickerImages() {
        document.querySelectorAll('.avatar-picker-btn').forEach(btn => {
            const style = btn.dataset.style;
            const img = btn.querySelector('img');
            if (img) {
                img.src = generateAvatar(this.currentSeed, style);
            }
        });
    },
    
    highlightActiveStyle() {
        document.querySelectorAll('.avatar-picker-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === this.currentStyle);
        });
    },
    
    async save() {
        const currentUser = getCurrentUser();
        if (!currentUser) return;
        
        const newAvatar = generateAvatar(this.currentSeed, this.currentStyle);
        
        try {
            await apiRequest(`/users/${currentUser.id}`, 'PUT', { avatar: newAvatar });
            setCurrentUser({ ...currentUser, avatar: newAvatar });
            Settings.set('avatarStyle', this.currentStyle);
            DOM.myAvatar.src = newAvatar;
            this.close();
            showToast('Avatar updated!', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        }
    }
};

function changeAvatar() {
    AvatarPicker.open();
}

// ========================================
// FILE & MEDIA HANDLING
// ========================================

const MediaHandler = {
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingStartTime: null,
    
    async uploadFile(file) {
        const currentUser = getCurrentUser();
        if (!currentUser || !AppState.selectedChat) {
            showToast('Please select a chat first', 'error');
            return null;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('senderId', currentUser.id);
        formData.append('receiverId', AppState.selectedChat);
        
        try {
            showToast('Uploading...', 'info');
            
            const response = await fetch(`${CONFIG.API_URL}/upload`, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'Upload failed');
            }
            
            // Add message to local state and render it
            if (result.message) {
                if (!AppState.messages[AppState.selectedChat]) {
                    AppState.messages[AppState.selectedChat] = [];
                }
                AppState.messages[AppState.selectedChat].push(result.message);
                appendMessage(result.message);
            }
            
            showToast('File sent!', 'success');
            loadConversations(); // Refresh conversation list
            return result;
        } catch (error) {
            showToast(error.message, 'error');
            return null;
        }
    },
    
    async startVoiceRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            this.audioChunks = [];
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            this.mediaRecorder.onstop = async () => {
                if (this.audioChunks.length > 0) {
                    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
                    await this.uploadFile(audioFile);
                }
                
                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };
            
            this.mediaRecorder.start(100); // Collect data every 100ms
            this.updateRecordingUI(true);
            showToast('Recording...', 'info');
            
            // Start timer
            this.recordingTimer = setInterval(() => {
                this.updateRecordingTime();
            }, 1000);
            
        } catch (error) {
            console.error('Recording error:', error);
            showToast('Microphone access denied', 'error');
        }
    },
    
    stopVoiceRecording(cancel = false) {
        if (!this.mediaRecorder || !this.isRecording) return;
        
        clearInterval(this.recordingTimer);
        this.isRecording = false;
        
        if (cancel) {
            this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            this.audioChunks = [];
            showToast('Recording cancelled', 'warning');
        } else {
            this.mediaRecorder.stop();
        }
        
        this.updateRecordingUI(false);
    },
    
    updateRecordingUI(isRecording) {
        const inputContainer = document.querySelector('.chat-input-container');
        const voiceBtn = DOM.voiceBtn;
        
        if (isRecording) {
            inputContainer?.classList.add('recording-mode');
            voiceBtn?.classList.add('recording');
            voiceBtn.innerHTML = '<i class="fas fa-stop"></i>';
        } else {
            inputContainer?.classList.remove('recording-mode');
            voiceBtn?.classList.remove('recording');
            voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
    },
    
    updateRecordingTime() {
        const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        
        const recordingTime = document.querySelector('.recording-time');
        if (recordingTime) {
            recordingTime.textContent = `${minutes}:${seconds}`;
        }
    },
    
    async captureCamera() {
        // Trigger the camera input
        if (DOM.cameraInput) {
            DOM.cameraInput.click();
        }
    }
};

function setupMediaHandlers() {
    // Attach button - open file picker
    DOM.attachBtn?.addEventListener('click', () => {
        if (!AppState.selectedChat) {
            showToast('Please select a chat first', 'warning');
            return;
        }
        DOM.fileInput?.click();
    });
    
    // File input change
    DOM.fileInput?.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            for (const file of files) {
                await MediaHandler.uploadFile(file);
            }
            e.target.value = ''; // Reset input
        }
    });
    
    // Camera button
    DOM.cameraBtn?.addEventListener('click', () => {
        if (!AppState.selectedChat) {
            showToast('Please select a chat first', 'warning');
            return;
        }
        DOM.cameraInput?.click();
    });
    
    // Camera input change
    DOM.cameraInput?.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            await MediaHandler.uploadFile(files[0]);
            e.target.value = ''; // Reset input
        }
    });
    
    // Voice button
    DOM.voiceBtn?.addEventListener('click', () => {
        if (!AppState.selectedChat) {
            showToast('Please select a chat first', 'warning');
            return;
        }
        
        if (MediaHandler.isRecording) {
            MediaHandler.stopVoiceRecording();
        } else {
            MediaHandler.startVoiceRecording();
        }
    });
    
    // Bubble style setting
    DOM.bubbleStyleSelect?.addEventListener('change', (e) => {
        const style = e.target.value;
        Settings.set('bubbleStyle', style);
        applyChatAppearance();
        showToast('Bubble style updated!', 'success');
    });
    
    // Chat background setting
    DOM.chatBgSelect?.addEventListener('change', (e) => {
        const bg = e.target.value;
        Settings.set('chatBackground', bg);
        applyChatAppearance();
        showToast('Chat background updated!', 'success');
    });
}

function applyChatAppearance() {
    const bubbleStyle = Settings.get('bubbleStyle');
    const chatBg = Settings.get('chatBackground');
    
    // Apply bubble style to chat view
    const chatView = DOM.chatView;
    if (chatView) {
        chatView.classList.remove('bubble-rounded', 'bubble-cozy', 'bubble-compact', 'bubble-modern', 'bubble-snapchat', 'bubble-minimal', 'bubble-ios', 'bubble-discord');
        chatView.classList.add(`bubble-${bubbleStyle}`);
    }
    
    // Apply background to messages container
    const chatMessages = DOM.chatMessages;
    if (chatMessages) {
        chatMessages.classList.remove('bg-default', 'bg-darker', 'bg-gradient', 'bg-pattern', 'bg-midnight', 'bg-forest');
        chatMessages.classList.add(`bg-${chatBg}`);
    }
}

function renderMediaMessage(message) {
    if (!message.fileUrl) return '';
    
    const fileType = message.fileType || 'document';
    const fileName = message.fileName || 'File';
    const fileSize = message.fileSize ? formatFileSize(message.fileSize) : '';
    const fullUrl = message.fileUrl.startsWith('/') ? message.fileUrl : '/' + message.fileUrl;
    
    if (fileType === 'image') {
        return `
            <div class="message-media" onclick="openMediaPreview('${fullUrl}', 'image')">
                <img src="${fullUrl}" alt="Image" loading="lazy" onerror="this.style.display='none'">
            </div>
        `;
    }
    
    if (fileType === 'video') {
        return `
            <div class="message-media">
                <video src="${fullUrl}" controls playsinline preload="metadata"></video>
            </div>
        `;
    }
    
    if (fileType === 'audio') {
        const audioId = 'audio-' + (message.id || Date.now());
        return `
            <div class="message-audio" data-audio-id="${audioId}">
                <button class="audio-play-btn" onclick="toggleAudioPlay('${audioId}', '${fullUrl}')">
                    <i class="fas fa-play"></i>
                </button>
                <div class="audio-info">
                    <div class="audio-waveform" id="waveform-${audioId}">
                        ${generateWaveformBars()}
                    </div>
                    <div class="audio-progress-container" onclick="seekAudio(event, '${audioId}')">
                        <div class="audio-progress" id="progress-${audioId}"></div>
                    </div>
                </div>
                <span class="audio-time" id="time-${audioId}">0:00</span>
                <audio id="${audioId}" src="${fullUrl}" preload="metadata" style="display:none"></audio>
            </div>
        `;
    }
    
    // Document
    const iconClass = getDocumentIcon(fileName);
    return `
        <div class="message-document">
            <i class="fas ${iconClass}"></i>
            <div class="message-document-info">
                <span class="message-document-name">${escapeHtml(fileName)}</span>
                <span class="message-document-size">${fileSize}</span>
            </div>
            <a href="${fullUrl}" download="${fileName}" class="icon-btn" title="Download">
                <i class="fas fa-download"></i>
            </a>
        </div>
    `;
}

function generateWaveformBars() {
    let bars = '';
    for (let i = 0; i < 20; i++) {
        const height = Math.floor(Math.random() * 16) + 8;
        bars += `<div class="audio-waveform-bar" style="height: ${height}px"></div>`;
    }
    return bars;
}

function getDocumentIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const icons = {
        pdf: 'fa-file-pdf',
        doc: 'fa-file-word',
        docx: 'fa-file-word',
        xls: 'fa-file-excel',
        xlsx: 'fa-file-excel',
        ppt: 'fa-file-powerpoint',
        pptx: 'fa-file-powerpoint',
        zip: 'fa-file-archive',
        rar: 'fa-file-archive',
        txt: 'fa-file-alt',
        js: 'fa-file-code',
        html: 'fa-file-code',
        css: 'fa-file-code',
        json: 'fa-file-code'
    };
    return icons[ext] || 'fa-file';
}

// Audio Player Functions
const audioPlayers = {};

function toggleAudioPlay(audioId, src) {
    let audio = document.getElementById(audioId);
    const btn = document.querySelector(`[data-audio-id="${audioId}"] .audio-play-btn`);
    
    if (!audio) {
        audio = new Audio(src);
        audio.id = audioId;
        document.body.appendChild(audio);
    }
    
    // Pause all other audio
    Object.keys(audioPlayers).forEach(id => {
        if (id !== audioId && audioPlayers[id]) {
            audioPlayers[id].pause();
            const otherBtn = document.querySelector(`[data-audio-id="${id}"] .audio-play-btn`);
            if (otherBtn) {
                otherBtn.innerHTML = '<i class="fas fa-play"></i>';
                otherBtn.classList.remove('playing');
            }
        }
    });
    
    audioPlayers[audioId] = audio;
    
    if (audio.paused) {
        audio.play().then(() => {
            btn.innerHTML = '<i class="fas fa-pause"></i>';
            btn.classList.add('playing');
        }).catch(e => {
            console.error('Audio play error:', e);
            showToast('Could not play audio', 'error');
        });
        
        audio.ontimeupdate = () => updateAudioProgress(audioId);
        audio.onended = () => {
            btn.innerHTML = '<i class="fas fa-play"></i>';
            btn.classList.remove('playing');
            const progress = document.getElementById(`progress-${audioId}`);
            if (progress) progress.style.width = '0%';
        };
        audio.onloadedmetadata = () => updateAudioTime(audioId);
    } else {
        audio.pause();
        btn.innerHTML = '<i class="fas fa-play"></i>';
        btn.classList.remove('playing');
    }
}

function updateAudioProgress(audioId) {
    const audio = document.getElementById(audioId) || audioPlayers[audioId];
    const progress = document.getElementById(`progress-${audioId}`);
    const timeEl = document.getElementById(`time-${audioId}`);
    
    if (audio && progress) {
        const percent = (audio.currentTime / audio.duration) * 100;
        progress.style.width = `${percent}%`;
    }
    
    if (audio && timeEl) {
        const remaining = audio.duration - audio.currentTime;
        if (!isNaN(remaining)) {
            const mins = Math.floor(remaining / 60);
            const secs = Math.floor(remaining % 60).toString().padStart(2, '0');
            timeEl.textContent = `${mins}:${secs}`;
        }
    }
}

function updateAudioTime(audioId) {
    const audio = document.getElementById(audioId) || audioPlayers[audioId];
    const timeEl = document.getElementById(`time-${audioId}`);
    
    if (audio && timeEl && !isNaN(audio.duration)) {
        const mins = Math.floor(audio.duration / 60);
        const secs = Math.floor(audio.duration % 60).toString().padStart(2, '0');
        timeEl.textContent = `${mins}:${secs}`;
    }
}

function seekAudio(event, audioId) {
    const audio = document.getElementById(audioId) || audioPlayers[audioId];
    if (!audio) return;
    
    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    audio.currentTime = percent * audio.duration;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / (1024 * 1024)) + ' MB';
}

function openMediaPreview(url, type) {
    let modal = document.getElementById('media-preview-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'media-preview-modal';
        modal.className = 'media-preview-modal';
        modal.innerHTML = `
            <button class="media-preview-close" onclick="closeMediaPreview()">&times;</button>
            <div class="media-preview-content"></div>
        `;
        document.body.appendChild(modal);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeMediaPreview();
            }
        });
    }
    
    const content = modal.querySelector('.media-preview-content');
    const fullUrl = url.startsWith('/') ? url : '/' + url;
    
    if (type === 'image') {
        content.innerHTML = `<img src="${fullUrl}" alt="Preview" style="max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 8px;">`;
    } else if (type === 'video') {
        content.innerHTML = `<video src="${fullUrl}" controls autoplay style="max-width: 90vw; max-height: 90vh; border-radius: 8px;"></video>`;
    }
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeMediaPreview() {
    const modal = document.getElementById('media-preview-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        const video = modal.querySelector('video');
        if (video) video.pause();
    }
}

// Save media to device
function saveMedia(url, filename) {
    const fullUrl = url.startsWith('/') ? url : '/' + url;
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = filename || 'download';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download started!', 'success');
}

// Delete message
async function deleteMessage(messageId) {
    const currentUser = getCurrentUser();
    if (!currentUser || !AppState.selectedChat) return;
    
    // Show confirmation
    if (!confirm('Delete this message?')) return;
    
    try {
        const response = await fetch(`${CONFIG.API_URL}/messages/${messageId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        
        if (response.ok) {
            // Remove from local state
            if (AppState.messages[AppState.selectedChat]) {
                AppState.messages[AppState.selectedChat] = AppState.messages[AppState.selectedChat].filter(m => m.id !== messageId);
            }
            
            // Remove from DOM
            const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
            if (msgEl) {
                msgEl.style.animation = 'fadeOut 0.3s ease forwards';
                setTimeout(() => msgEl.remove(), 300);
            }
            
            showToast('Message deleted', 'success');
            
            // Notify other user via socket
            socket.emit('message_deleted', { 
                messageId, 
                conversationId: AppState.selectedChat 
            });
        } else {
            const result = await response.json();
            showToast(result.error || 'Could not delete message', 'error');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Could not delete message', 'error');
    }
}

async function showUserProfile(userId) {
    try {
        const user = await apiRequest(`/users/${userId}`);

        DOM.panelAvatarImg.src = user.avatar;
        DOM.panelFullname.textContent = user.fullName;
        DOM.panelUsername.textContent = '@' + user.username;
        DOM.panelStatus.textContent = isUserOnline(userId) ? '🟢 Online' : '⚫ Offline';
        DOM.panelBio.textContent = user.bio || 'No bio yet';
        DOM.panelEmail.textContent = user.email;
        DOM.panelJoined.textContent = 'Joined ' + formatJoinDate(user.createdAt);

        DOM.profilePanel.dataset.userId = userId;
        DOM.profilePanel.classList.remove('hidden');
        AppState.isProfilePanelOpen = true;
    } catch (error) {
        showToast('Could not load profile', 'error');
    }
}

function closeProfilePanel() {
    DOM.profilePanel.classList.add('hidden');
    AppState.isProfilePanelOpen = false;
}

function startChatFromProfile() {
    const userId = DOM.profilePanel.dataset.userId;
    if (!userId) return;

    closeProfilePanel();
    switchView('chats');
    openChat(userId);
}

// ========================================
// NEW CHAT MODAL
// ========================================

async function openNewChatModal() {
    DOM.newChatModal.classList.remove('hidden');
    DOM.newChatSearch.value = '';
    
    try {
        const users = await apiRequest('/users');
        const currentUser = getCurrentUser();
        const filteredUsers = users.filter(u => u.id !== currentUser?.id);
        renderNewChatUsers(filteredUsers);
    } catch (error) {
        console.error('Error loading users:', error);
    }
    
    DOM.newChatSearch.focus();
}

function closeNewChatModal() {
    DOM.newChatModal.classList.add('hidden');
}

function renderNewChatUsers(users) {
    if (users.length === 0) {
        DOM.newChatUserList.innerHTML = `
            <div class="no-results">
                <i class="fas fa-user-slash"></i>
                <p>No users found</p>
            </div>
        `;
        return;
    }

    DOM.newChatUserList.innerHTML = users.map(user => `
        <div class="user-list-item" data-user-id="${user.id}">
            <img src="${user.avatar}" alt="${user.fullName}">
            <div class="user-list-item-info">
                <span class="user-list-item-name">${user.fullName}</span>
                <span class="user-list-item-username">@${user.username}</span>
            </div>
        </div>
    `).join('');

    DOM.newChatUserList.querySelectorAll('.user-list-item').forEach(item => {
        item.addEventListener('click', () => {
            closeNewChatModal();
            openChat(item.dataset.userId);
        });
    });
}

// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {
    // Auth form switching
    DOM.showSignup?.addEventListener('click', (e) => {
        e.preventDefault();
        DOM.loginForm.classList.remove('active');
        DOM.signupForm.classList.add('active');
    });

    DOM.showLogin?.addEventListener('click', (e) => {
        e.preventDefault();
        DOM.signupForm.classList.remove('active');
        DOM.loginForm.classList.add('active');
    });

    // Auth forms
    DOM.loginForm?.addEventListener('submit', handleLogin);
    DOM.signupForm?.addEventListener('submit', handleSignup);

    // Avatar selection during signup
    DOM.avatarTypeBtns?.forEach(btn => {
        btn.addEventListener('click', () => {
            DOM.avatarTypeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.selectedAvatarStyle = btn.dataset.style;
            if (DOM.selectedAvatarStyle) {
                DOM.selectedAvatarStyle.value = btn.dataset.style;
            }
        });
    });

    // Logout
    DOM.logoutBtn?.addEventListener('click', handleLogout);
    DOM.logoutSettingsBtn?.addEventListener('click', handleLogout);

    // Navigation
    DOM.navItems.forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });
    
    DOM.mobileNavItems.forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });
    
    DOM.mobileBackBtn?.addEventListener('click', closeChatOnMobile);

    // Chat search
    DOM.chatSearch?.addEventListener('input', (e) => renderChatList(e.target.value));

    // User search
    DOM.userSearch?.addEventListener('input', (e) => renderSearchResults(e.target.value));

    // New chat
    DOM.newChatBtn?.addEventListener('click', openNewChatModal);
    DOM.modalClose?.addEventListener('click', closeNewChatModal);
    DOM.newChatModal?.addEventListener('click', (e) => {
        if (e.target === DOM.newChatModal) closeNewChatModal();
    });

    DOM.newChatSearch?.addEventListener('input', async (e) => {
        const query = e.target.value.toLowerCase();
        try {
            const users = await apiRequest('/users');
            const currentUser = getCurrentUser();
            const filtered = users.filter(u => 
                u.id !== currentUser?.id &&
                (u.fullName.toLowerCase().includes(query) || 
                 u.username.toLowerCase().includes(query))
            );
            renderNewChatUsers(filtered);
        } catch (error) {
            console.error('Error searching users:', error);
        }
    });

    // Profile
    DOM.saveProfileBtn?.addEventListener('click', saveProfile);
    DOM.changeAvatarBtn?.addEventListener('click', changeAvatar);

    // Chat
    DOM.sendBtn?.addEventListener('click', sendMessage);
    DOM.messageInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    DOM.messageInput?.addEventListener('input', handleTyping);

    DOM.viewProfileBtn?.addEventListener('click', () => {
        if (AppState.selectedChat) showUserProfile(AppState.selectedChat);
    });

    // Profile panel
    DOM.closePanelBtn?.addEventListener('click', closeProfilePanel);
    DOM.panelMessageBtn?.addEventListener('click', startChatFromProfile);
    
    // About modal
    DOM.aboutAppBtn?.addEventListener('click', openAboutModal);
    DOM.closeAboutModal?.addEventListener('click', closeAboutModalFunc);
    DOM.aboutModal?.addEventListener('click', (e) => {
        if (e.target === DOM.aboutModal) closeAboutModalFunc();
    });

    // Avatar Picker Modal
    DOM.closeAvatarModal?.addEventListener('click', () => AvatarPicker.close());
    DOM.randomizeAvatarBtn?.addEventListener('click', () => AvatarPicker.randomize());
    DOM.saveAvatarBtn?.addEventListener('click', () => AvatarPicker.save());
    DOM.avatarPickerModal?.addEventListener('click', (e) => {
        if (e.target === DOM.avatarPickerModal) AvatarPicker.close();
    });
    
    // Avatar style buttons in picker
    document.querySelectorAll('.avatar-picker-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            AvatarPicker.selectStyle(btn.dataset.style);
        });
    });

    // Settings
    setupSettingsListeners();
    
    // File & Media handlers
    setupMediaHandlers();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (!DOM.newChatModal?.classList.contains('hidden')) closeNewChatModal();
            if (!DOM.aboutModal?.classList.contains('hidden')) closeAboutModalFunc();
            if (!DOM.avatarPickerModal?.classList.contains('hidden')) AvatarPicker.close();
            if (AppState.isProfilePanelOpen) closeProfilePanel();
        }
    });
    
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && DOM.chatWindow) {
            DOM.chatWindow.classList.remove('active');
        }
    });
}

// ========================================
// INITIALIZATION
// ========================================

async function initApp() {
    const currentUser = getCurrentUser();

    if (currentUser) {
        DOM.authContainer.classList.add('hidden');
        DOM.appContainer.classList.remove('hidden');

        switchView('chats');
        await loadConversations();
        updateProfileView();
        loadSettings();
    } else {
        DOM.authContainer.classList.remove('hidden');
        DOM.appContainer.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initDOM();
    initSocket();
    await NotificationManager.init();
    setupEventListeners();
    initApp();
});
