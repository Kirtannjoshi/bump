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
    },
    
    getSoundUrlByType(type) {
        return this.soundUrls[type] || this.soundUrls.pop;
    }
};

// Play notification sound by type
function playNotificationSound(soundType) {
    const soundUrl = Settings.getSoundUrlByType(soundType);
    try {
        const audio = new Audio(soundUrl);
        audio.volume = 0.7;
        audio.play().catch(e => console.log('Sound play failed:', e));
    } catch (e) {
        console.log('Sound error:', e);
    }
}

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
    socket.on('message_deleted_everyone', handleMessageDeletedEveryone);
    
    // Friend request events
    socket.on('friend_request_received', handleFriendRequestReceived);
    socket.on('friend_request_accepted', handleFriendRequestAccepted);
}

// Handle incoming friend request
function handleFriendRequestReceived({ request, fromUser }) {
    showToast(`${fromUser?.fullName || 'Someone'} sent you a friend request!`, 'info');
    loadFriendRequests();
}

// Handle friend request accepted
function handleFriendRequestAccepted({ user }) {
    showToast(`${user?.fullName || 'Someone'} accepted your friend request!`, 'success');
    loadFriends();
    loadConversations();
}

// Handle message deletion from other user (delete for me by sender - just hide)
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

// Handle "delete for everyone" - show notice that message was deleted
function handleMessageDeletedEveryone({ messageId, conversationId, senderName }) {
    // Find the message in local state
    if (AppState.messages[conversationId]) {
        const msgIndex = AppState.messages[conversationId].findIndex(m => m.id === messageId);
        if (msgIndex !== -1) {
            // Mark as deleted for everyone
            AppState.messages[conversationId][msgIndex].deletedForEveryone = true;
            AppState.messages[conversationId][msgIndex].originalText = AppState.messages[conversationId][msgIndex].text;
            AppState.messages[conversationId][msgIndex].text = null;
            AppState.messages[conversationId][msgIndex].fileUrl = null;
        }
    }
    
    // Update the DOM to show deleted notice
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
        // Transform the message into a deleted placeholder
        msgEl.classList.add('message-deleted');
        
        // Find or create the content area
        const bubble = msgEl.querySelector('.message-bubble');
        const content = msgEl.querySelector('.message-content') || bubble;
        
        if (content) {
            content.innerHTML = `
                <i class="fas fa-ban deleted-notice-icon"></i>
                <span>This message was deleted</span>
            `;
        }
        
        // Remove action buttons
        const actions = msgEl.querySelector('.message-actions');
        if (actions) actions.remove();
        
        // Show toast notification
        showToast(`${senderName} deleted a message`, 'info');
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
    friends: [],
    friendRequests: [],
    selectedAvatarStyle: 'avataaars',
    selectedGender: 'male'
};

// Gender-based avatar recommendations
const GenderAvatars = {
    male: [
        { style: 'avataaars', label: 'Classic' },
        { style: 'adventurer', label: 'Adventure' },
        { style: 'bottts', label: 'Robot' },
        { style: 'personas', label: 'Persona' },
        { style: 'pixel-art', label: 'Pixel' },
        { style: 'thumbs', label: 'Thumbs' }
    ],
    female: [
        { style: 'lorelei', label: 'Lorelei' },
        { style: 'adventurer', label: 'Adventure' },
        { style: 'big-smile', label: 'Smile' },
        { style: 'avataaars', label: 'Classic' },
        { style: 'notionists', label: 'Notion' },
        { style: 'personas', label: 'Persona' }
    ],
    other: [
        { style: 'avataaars', label: 'Classic' },
        { style: 'adventurer', label: 'Adventure' },
        { style: 'bottts', label: 'Robot' },
        { style: 'lorelei', label: 'Lorelei' },
        { style: 'thumbs', label: 'Thumbs' },
        { style: 'shapes', label: 'Shapes' }
    ]
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
    DOM.inboxSidebar = document.getElementById('inbox-sidebar');
    DOM.chatList = document.getElementById('chat-list');
    DOM.chatSearch = document.getElementById('chat-search');
    DOM.userSearch = document.getElementById('user-search');
    DOM.searchResults = document.getElementById('search-results');
    DOM.newChatBtn = document.getElementById('new-chat-btn');
    
    // Inbox / Friends
    DOM.friendRequestsList = document.getElementById('friend-requests-list');
    DOM.friendsList = document.getElementById('friends-list');
    DOM.requestsCount = document.getElementById('requests-count');
    DOM.friendsCount = document.getElementById('friends-count');
    DOM.inboxBadge = document.getElementById('inbox-badge');
    
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
    DOM.chatWindow = document.getElementById('main-chats-view');
    DOM.emptyState = document.getElementById('empty-state');
    DOM.chatView = document.getElementById('chat-view');
    DOM.chatAvatar = document.getElementById('chat-avatar');
    DOM.chatUsername = document.getElementById('chat-username');
    DOM.chatWaveId = document.getElementById('chat-wave-id');
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
    
    // Delete Account Modal
    DOM.deleteAccountBtn = document.getElementById('delete-account-btn');
    DOM.deleteAccountModal = document.getElementById('delete-account-modal');
    DOM.closeDeleteAccountModal = document.getElementById('close-delete-account-modal');
    DOM.confirmDeleteUsername = document.getElementById('confirm-delete-username');
    DOM.cancelDeleteAccount = document.getElementById('cancel-delete-account');
    DOM.confirmDeleteAccount = document.getElementById('confirm-delete-account');
    
    // User Profile Modal
    DOM.userProfileModal = document.getElementById('user-profile-modal');
    DOM.closeUserProfileModal = document.getElementById('close-user-profile-modal');
    DOM.userProfileAvatarImg = document.getElementById('user-profile-avatar-img');
    DOM.userProfileName = document.getElementById('user-profile-name');
    DOM.userProfileUsername = document.getElementById('user-profile-username');
    DOM.userProfileBio = document.getElementById('user-profile-bio');
    DOM.userProfileStatusDot = document.getElementById('user-profile-status-dot');
    DOM.userProfileStatusText = document.getElementById('user-profile-status-text');
    DOM.sendMessageBtn = document.getElementById('send-message-btn');
    DOM.addFriendBtn = document.getElementById('add-friend-btn');
    DOM.muteUserBtn = document.getElementById('mute-user-btn');
    DOM.blockUserBtn = document.getElementById('block-user-btn');
    
    // Theme and Appearance
    DOM.themeButtons = document.querySelectorAll('.theme-btn, .theme-option-btn');
    DOM.colorButtons = document.querySelectorAll('.accent-color-btn');
    
    // Profile Wave ID
    DOM.myWaveId = document.getElementById('my-wave-id');
    
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

// Wave Protocol: Format username as ~username
function formatWaveId(username) {
    if (!username) return '~unknown';
    return `~${username.toLowerCase()}`;
}

// Generate Wave ID HTML with neon styling
function renderWaveId(username) {
    return `<span class="user-wave-id">${formatWaveId(username)}</span>`;
}

function generateAvatar(seed, style = 'avataaars') {
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`;
}

// Render avatar options based on selected gender
function renderAvatarsForGender(gender) {
    const container = document.getElementById('avatar-types-row');
    if (!container) return;
    
    const avatars = GenderAvatars[gender] || GenderAvatars.other;
    const username = document.getElementById('signup-username')?.value || 'preview';
    
    container.innerHTML = avatars.map((avatar, index) => `
        <button type="button" class="avatar-type-btn ${index === 0 ? 'active' : ''}" data-style="${avatar.style}">
            <img src="https://api.dicebear.com/7.x/${avatar.style}/svg?seed=${username}" alt="${avatar.label}">
        </button>
    `).join('');
    
    // Set first avatar as selected
    AppState.selectedAvatarStyle = avatars[0].style;
    const styleInput = document.getElementById('selected-avatar-style');
    if (styleInput) styleInput.value = avatars[0].style;
    
    // Add click handlers to new buttons
    container.querySelectorAll('.avatar-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.avatar-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.selectedAvatarStyle = btn.dataset.style;
            if (styleInput) styleInput.value = btn.dataset.style;
        });
    });
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
    const gender = AppState.selectedGender;

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
            fullName, username, email, password, avatarStyle, gender 
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
    
    // Update nav items
    DOM.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    
    DOM.mobileNavItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    
    // Update sidebar content - each view shows its own sidebar navigation
    DOM.chatsSidebar?.classList.toggle('active', view === 'chats');
    DOM.searchSidebar?.classList.toggle('active', view === 'search');
    DOM.profileSidebar?.classList.toggle('active', view === 'profile');
    DOM.settingsSidebar?.classList.toggle('active', view === 'settings');
    DOM.inboxSidebar?.classList.toggle('active', view === 'inbox');
    
    // Update main content views
    const mainViews = document.querySelectorAll('.main-view');
    mainViews.forEach(mv => mv.classList.remove('active'));
    
    const targetView = document.getElementById(`main-${view}-view`);
    if (targetView) {
        targetView.classList.add('active');
    } else {
        // Default to chats view
        document.getElementById('main-chats-view')?.classList.add('active');
    }
    
    // Mobile view classes - hide sidebar for settings/profile views
    document.body.classList.remove('mobile-view-settings', 'mobile-view-profile');
    if (window.innerWidth <= 768) {
        if (view === 'settings') {
            document.body.classList.add('mobile-view-settings');
        } else if (view === 'profile') {
            document.body.classList.add('mobile-view-profile');
        }
    }
    
    // View-specific actions
    if (view === 'profile') {
        updateProfileView();
        loadSidebarProfileView();
        // Load friends first, then update profile view with accurate count
        loadFriends().then(() => {
            updateMainProfileView();
        });
    }
    if (view === 'search') {
        loadAllUsers();
        loadMainSearchUsers();
    }
    if (view === 'settings') {
        loadSettings();
        loadMainSettingsView();
    }
    if (view === 'inbox') {
        loadFriendRequests();
        loadFriends();
        loadMainInboxView();
    }
    
    if (window.innerWidth <= 768) closeChatOnMobile();
}

// Update main profile view
function updateMainProfileView() {
    const user = getCurrentUser();
    if (!user) return;
    
    const avatar = document.getElementById('main-profile-avatar');
    const fullname = document.getElementById('main-profile-fullname');
    const waveId = document.getElementById('main-profile-wave-id');
    const bioDisplay = document.getElementById('main-profile-bio-display');
    const editFullname = document.getElementById('main-edit-fullname');
    const editUsername = document.getElementById('main-edit-username');
    const editEmail = document.getElementById('main-edit-email');
    const editBio = document.getElementById('main-edit-bio');
    const editStatus = document.getElementById('main-edit-status');
    
    if (avatar) avatar.src = user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
    if (fullname) fullname.textContent = user.fullname || user.username;
    if (waveId) waveId.textContent = user.username;
    if (bioDisplay) bioDisplay.textContent = user.bio || 'No bio yet';
    if (editFullname) editFullname.value = user.fullname || '';
    if (editUsername) editUsername.value = user.username || '';
    if (editEmail) editEmail.value = user.email || '';
    if (editBio) editBio.value = user.bio || '';
    if (editStatus) editStatus.value = user.status || 'online';
    
    // Update simplified stats - use AppState.friends for accurate count
    const friendsCount = document.getElementById('profile-friends-count');
    const memberSince = document.getElementById('profile-member-since');
    if (friendsCount) {
        // Use AppState.friends if available, otherwise fallback to user.friends
        const count = AppState.friends?.length ?? (user.friends || []).length;
        friendsCount.textContent = count;
    }
    if (memberSince && user.createdAt) {
        memberSince.textContent = new Date(user.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    
    // Hide edit section by default
    toggleProfileEditSection(false);
}

// Toggle profile edit section visibility
function toggleProfileEditSection(show) {
    const editSection = document.getElementById('profile-edit-section');
    const editBtn = document.getElementById('toggle-edit-profile-btn');
    
    if (show === undefined) {
        // Toggle
        show = editSection?.classList.contains('hidden');
    }
    
    if (editSection) {
        editSection.classList.toggle('hidden', !show);
    }
    if (editBtn) {
        editBtn.innerHTML = show ? '<i class="fas fa-times"></i> Cancel' : '<i class="fas fa-edit"></i> Edit Profile';
    }
}

// Load main settings view
function loadMainSettingsView() {
    const user = getCurrentUser();
    if (!user) return;
    
    // Update settings user info
    const avatar = document.getElementById('settings-main-avatar');
    const username = document.getElementById('settings-main-username');
    const accountAvatar = document.getElementById('settings-account-avatar');
    const accountName = document.getElementById('settings-account-name');
    const accountWave = document.getElementById('settings-account-wave');
    const accountUsernameDisplay = document.getElementById('settings-account-username-display');
    const accountEmailDisplay = document.getElementById('settings-account-email-display');
    
    const avatarUrl = user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
    
    // Sidebar settings user info
    const sidebarAvatar = document.getElementById('sidebar-settings-avatar');
    const sidebarUsername = document.getElementById('sidebar-settings-username');
    const sidebarWave = document.getElementById('sidebar-settings-wave');
    if (sidebarAvatar) sidebarAvatar.src = avatarUrl;
    if (sidebarUsername) sidebarUsername.textContent = user.fullname || user.username;
    if (sidebarWave) sidebarWave.textContent = '~' + user.username;
    
    // Main content settings
    if (accountAvatar) accountAvatar.src = avatarUrl;
    if (accountName) accountName.textContent = user.fullname || user.username;
    if (accountWave) accountWave.textContent = '~' + user.username;
    if (accountUsernameDisplay) accountUsernameDisplay.textContent = user.username;
    if (accountEmailDisplay) accountEmailDisplay.textContent = user.email;
    
    // Profile settings
    const displayName = document.getElementById('settings-main-display-name');
    const about = document.getElementById('settings-main-about');
    if (displayName) displayName.value = user.fullname || '';
    if (about) about.value = user.bio || '';
}

// Load sidebar profile view
function loadSidebarProfileView() {
    const user = getCurrentUser();
    if (!user) return;
    
    const avatarUrl = user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
    
    const sidebarAvatar = document.getElementById('sidebar-profile-avatar');
    const sidebarName = document.getElementById('sidebar-profile-name');
    const sidebarWave = document.getElementById('sidebar-profile-wave');
    
    if (sidebarAvatar) sidebarAvatar.src = avatarUrl;
    if (sidebarName) sidebarName.textContent = user.fullname || user.username;
    if (sidebarWave) sidebarWave.textContent = '~' + user.username;
}

// Load main inbox view
function loadMainInboxView() {
    // Friend requests and friends are already loaded by existing functions
    // This is for any additional inbox-specific UI updates
}

// Load main search users
function loadMainSearchUsers() {
    // Main search input handler
    const mainSearchInput = document.getElementById('main-user-search');
    if (mainSearchInput && !mainSearchInput.hasListener) {
        mainSearchInput.hasListener = true;
        mainSearchInput.addEventListener('input', debounce(async (e) => {
            const query = e.target.value.trim();
            const resultsContainer = document.getElementById('main-search-results');
            if (!resultsContainer) return;
            
            if (query.length < 2) {
                resultsContainer.innerHTML = `
                    <div class="empty-state-inline">
                        <i class="fas fa-user-friends"></i>
                        <p>Start typing to search for users</p>
                    </div>
                `;
                return;
            }
            
            try {
                const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
                const users = await response.json();
                renderMainSearchResults(users, resultsContainer);
            } catch (error) {
                console.error('Search error:', error);
            }
        }, 300));
    }
}

function renderMainSearchResults(users, container) {
    const currentUser = getCurrentUser();
    
    if (!users || users.length === 0) {
        container.innerHTML = `
            <div class="empty-state-inline">
                <i class="fas fa-search"></i>
                <p>No users found</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = users.map(user => {
        if (user.id === currentUser?.id) return '';
        
        const isFriend = currentUser?.friends?.includes(user.id);
        const isPending = currentUser?.pendingRequests?.includes(user.id);
        
        let actionBtn = '';
        if (isFriend) {
            actionBtn = '<button class="search-action-btn friend"><i class="fas fa-check"></i> Friends</button>';
        } else if (isPending) {
            actionBtn = '<button class="search-action-btn pending"><i class="fas fa-clock"></i> Pending</button>';
        } else {
            actionBtn = `<button class="search-action-btn add" onclick="event.stopPropagation(); sendFriendRequest('${user.id}')"><i class="fas fa-user-plus"></i> Add Friend</button>`;
        }
        
        return `
            <div class="search-result-card" onclick="showUserProfile('${user.id}')">
                <img src="${user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.username}" alt="" class="search-result-avatar" onclick="event.stopPropagation(); showUserProfile('${user.id}')">
                <div class="search-result-info" onclick="event.stopPropagation(); showUserProfile('${user.id}')">
                    <span class="search-result-name">${user.fullname || user.username}</span>
                    <span class="search-result-wave">~${user.username}</span>
                </div>
                ${actionBtn}
            </div>
        `;
    }).join('');
}

// Switch settings main tabs (called from sidebar)
function switchMainSettingsTab(tabName) {
    // Update sidebar nav items
    const sidebarItems = document.querySelectorAll('.settings-sidebar-item');
    sidebarItems.forEach(item => {
        item.classList.toggle('active', item.dataset.settingsTab === tabName);
    });
    
    // Update mobile tabs
    const mobileTabs = document.querySelectorAll('.settings-mobile-tab');
    mobileTabs.forEach((tab, index) => {
        const tabNames = ['account', 'profile', 'privacy', 'appearance', 'notifications'];
        tab.classList.toggle('active', tabNames[index] === tabName);
    });
    
    // Update main content tabs
    const tabs = document.querySelectorAll('.settings-main-tab');
    tabs.forEach(tab => {
        const tabId = tab.id.replace('settings-main-', '');
        tab.classList.toggle('active', tabId === tabName);
    });
}

// Switch profile tabs (called from sidebar)
function switchMainProfileTab(tabName) {
    // Update sidebar nav items
    const sidebarItems = document.querySelectorAll('.profile-sidebar-item');
    sidebarItems.forEach(item => {
        item.classList.toggle('active', item.dataset.profileTab === tabName);
    });
    
    // Update main content tabs
    const tabs = document.querySelectorAll('.profile-tab-content');
    tabs.forEach(tab => {
        const tabId = tab.id.replace('profile-tab-', '');
        tab.classList.toggle('active', tabId === tabName);
    });
    
    // Also update inline tabs if they exist
    document.querySelectorAll('.profile-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.profileTab === tabName);
    });
}

// Save settings main profile
function saveSettingsMainProfile() {
    const displayName = document.getElementById('settings-main-display-name')?.value;
    const about = document.getElementById('settings-main-about')?.value;
    
    const user = getCurrentUser();
    if (!user) return;
    
    socket.emit('updateProfile', {
        userId: user.id,
        fullname: displayName,
        bio: about
    });
    
    showToast('Profile updated!', 'success');
}

// Initialize main view tab handlers
function initMainViewTabs() {
    // Profile tabs
    document.querySelectorAll('.profile-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.profileTab;
            document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.profile-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`profile-tab-${tabName}`)?.classList.add('active');
        });
    });
    
    // Settings main nav
    document.querySelectorAll('.settings-main-nav-item').forEach(item => {
        if (item.dataset.settingsMain) {
            item.addEventListener('click', () => switchSettingsMainTab(item.dataset.settingsMain));
        }
    });
    
    // Inbox main tabs
    document.querySelectorAll('.inbox-main-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.inboxTab;
            document.querySelectorAll('.inbox-main-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.inbox-main-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`main-inbox-${tabName}`)?.classList.add('active');
        });
    });
    
    // Main save profile button
    document.getElementById('main-save-profile-btn')?.addEventListener('click', () => {
        const user = getCurrentUser();
        if (!user) return;
        
        socket.emit('updateProfile', {
            userId: user.id,
            fullname: document.getElementById('main-edit-fullname')?.value,
            email: document.getElementById('main-edit-email')?.value,
            bio: document.getElementById('main-edit-bio')?.value,
            status: document.getElementById('main-edit-status')?.value
        });
        
        showToast('Profile saved!', 'success');
        toggleProfileEditSection(false);
        
        // Update the display immediately
        const bioDisplay = document.getElementById('main-profile-bio-display');
        const fullnameDisplay = document.getElementById('main-profile-fullname');
        if (bioDisplay) bioDisplay.textContent = document.getElementById('main-edit-bio')?.value || 'No bio yet';
        if (fullnameDisplay) fullnameDisplay.textContent = document.getElementById('main-edit-fullname')?.value || user.username;
    });
    
    // Toggle edit profile button
    document.getElementById('toggle-edit-profile-btn')?.addEventListener('click', () => {
        toggleProfileEditSection();
    });
    
    // Cancel edit profile button
    document.getElementById('cancel-edit-profile-btn')?.addEventListener('click', () => {
        toggleProfileEditSection(false);
        updateMainProfileView(); // Reset form values
    });
    
    // Main change avatar button
    document.getElementById('main-change-avatar-btn')?.addEventListener('click', () => {
        document.getElementById('avatar-picker-modal')?.classList.remove('hidden');
    });
}

function openChatOnMobile() {
    if (window.innerWidth <= 768) {
        // Hide sidebar and show chat view on mobile
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content-area');
        const chatView = document.getElementById('chat-view');
        
        if (sidebar) sidebar.classList.add('mobile-hidden');
        if (mainContent) mainContent.classList.add('mobile-chat-active');
        if (chatView) chatView.classList.add('mobile-active');
        if (DOM.chatWindow) DOM.chatWindow.classList.add('active');
    }
}

function closeChatOnMobile() {
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content-area');
    const chatView = document.getElementById('chat-view');
    
    if (sidebar) sidebar.classList.remove('mobile-hidden');
    if (mainContent) mainContent.classList.remove('mobile-chat-active');
    if (chatView) chatView.classList.remove('mobile-active');
    if (DOM.chatWindow) DOM.chatWindow.classList.remove('active');
    
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
    
    // Theme buttons
    DOM.themeButtons?.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.dataset.theme;
            DOM.themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Remove existing theme classes
            document.body.classList.remove('theme-light', 'theme-midnight', 'theme-amoled');
            if (theme !== 'dark') {
                document.body.classList.add(`theme-${theme}`);
            }
            
            Settings.set('theme', theme);
            showToast(`Theme changed to ${theme}`, 'success');
        });
    });
    
    // Color accent buttons
    DOM.colorButtons?.forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.accent || btn.dataset.color;
            DOM.colorButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Map colors to accent names
            const colorMap = {
                '#6366F1': 'indigo',
                '#8B5CF6': 'purple',
                '#EC4899': 'pink',
                '#EF4444': 'red',
                '#10B981': 'green',
                '#F59E0B': 'amber',
                '#06B6D4': 'cyan',
                '#3B82F6': 'blue'
            };
            
            const accentName = colorMap[color] || 'indigo';
            document.body.removeAttribute('data-accent');
            if (accentName !== 'indigo') {
                document.body.setAttribute('data-accent', accentName);
            }
            
            Settings.set('accentColor', color);
            showToast('Accent color updated!', 'success');
        });
    });
    
    // Notification sound selection
    const soundButtons = document.querySelectorAll('.sound-option-btn');
    soundButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const sound = btn.dataset.sound;
            soundButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            Settings.set('soundType', sound);
            showToast(`Notification sound: ${sound}`, 'success');
            // Play preview
            playNotificationSound(sound);
        });
    });
    
    // Test sound button
    const testSoundBtn = document.getElementById('test-notification-sound');
    if (testSoundBtn) {
        testSoundBtn.addEventListener('click', () => {
            const currentSound = Settings.get('soundType') || 'pop';
            playNotificationSound(currentSound);
        });
    }
    
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
    
    // Delete account button
    DOM.deleteAccountBtn?.addEventListener('click', openDeleteAccountModal);
    DOM.closeDeleteAccountModal?.addEventListener('click', closeDeleteAccountModal);
    DOM.cancelDeleteAccount?.addEventListener('click', closeDeleteAccountModal);
    DOM.deleteAccountModal?.addEventListener('click', (e) => {
        if (e.target === DOM.deleteAccountModal) closeDeleteAccountModal();
    });
    
    DOM.confirmDeleteUsername?.addEventListener('input', (e) => {
        const currentUser = getCurrentUser();
        if (currentUser && e.target.value === currentUser.username) {
            DOM.confirmDeleteAccount.disabled = false;
        } else {
            DOM.confirmDeleteAccount.disabled = true;
        }
    });
    
    DOM.confirmDeleteAccount?.addEventListener('click', deleteAccount);
}

// ========================================
// DELETE ACCOUNT FUNCTIONALITY
// ========================================

function openDeleteAccountModal() {
    DOM.deleteAccountModal?.classList.remove('hidden');
    DOM.confirmDeleteUsername.value = '';
    DOM.confirmDeleteAccount.disabled = true;
}

function closeDeleteAccountModal() {
    DOM.deleteAccountModal?.classList.add('hidden');
    DOM.confirmDeleteUsername.value = '';
    DOM.confirmDeleteAccount.disabled = true;
}

async function deleteAccount() {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        showToast('No user logged in', 'error');
        return;
    }
    
    console.log('Deleting account for user:', currentUser.id);
    
    try {
        const result = await apiRequest(`/users/${currentUser.id}`, 'DELETE');
        console.log('Delete result:', result);
        
        // Disconnect socket first
        if (socket) {
            socket.emit('user_offline', { userId: currentUser.id });
            socket.disconnect();
        }
        
        // Clear all local storage using the correct function
        clearCurrentUser();
        localStorage.removeItem('bump_settings');
        
        showToast('Account deleted successfully', 'success');
        
        // Close the modal
        closeDeleteAccountModal();
        
        // Redirect to login
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (error) {
        console.error('Delete account error:', error);
        showToast(error.message || 'Failed to delete account', 'error');
    }
}

// ========================================
// USER PROFILE MODAL FUNCTIONALITY
// ========================================

let currentViewedUser = null;

// Old function - now redirects to the Discord-style modal
function openUserProfileModalLegacy(user) {
    if (!user) return;
    currentViewedUser = user;
    // Use the new Discord-style modal
    openDiscordUserProfileModal(user.id, user);
}

function closeUserProfileModal() {
    const modal = document.getElementById('user-profile-modal');
    if (modal) modal.classList.add('hidden');
    currentViewedUser = null;
}

function startChatFromModal() {
    if (!currentViewedUser) return;
    
    closeUserProfileModal();
    startChat(currentViewedUser);
}

function setupUserProfileModalListeners() {
    const closeBtn = document.getElementById('close-user-profile-modal');
    const modal = document.getElementById('user-profile-modal');
    const sendMessageBtn = document.getElementById('send-message-btn');
    const muteBtn = document.getElementById('mute-user-btn');
    const blockBtn = document.getElementById('block-user-btn');
    
    if (closeBtn) closeBtn.addEventListener('click', closeUserProfileModal);
    if (modal) modal.addEventListener('click', (e) => {
        if (e.target === modal) closeUserProfileModal();
    });
    
    if (sendMessageBtn) sendMessageBtn.addEventListener('click', startChatFromModal);
    
    if (muteBtn) muteBtn.addEventListener('click', () => toggleMuteUser());
    if (blockBtn) blockBtn.addEventListener('click', () => toggleBlockUser());
}

// ==========================================
// MUTE/BLOCK FUNCTIONALITY
// ==========================================

function toggleMuteUser() {
    if (!currentViewedUser) return;
    
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    const targetUserId = currentViewedUser.id;
    const isMuted = (currentUser.mutedUsers || []).includes(targetUserId);
    
    if (isMuted) {
        // Unmute
        socket.emit('unmute_user', { userId: currentUser.id, targetUserId });
        showToast(`Unmuted ${currentViewedUser.fullName || currentViewedUser.username}`, 'success', 'fa-bell');
        
        // Update local state
        if (currentUser.mutedUsers) {
            currentUser.mutedUsers = currentUser.mutedUsers.filter(id => id !== targetUserId);
        }
    } else {
        // Mute
        socket.emit('mute_user', { userId: currentUser.id, targetUserId });
        showToast(`Muted notifications from ${currentViewedUser.fullName || currentViewedUser.username}`, 'success', 'fa-bell-slash');
        
        // Update local state
        if (!currentUser.mutedUsers) currentUser.mutedUsers = [];
        currentUser.mutedUsers.push(targetUserId);
    }
    
    // Update button state
    updateMuteBlockButtonStates();
    localStorage.setItem('bump_user', JSON.stringify(currentUser));
}

function toggleBlockUser() {
    if (!currentViewedUser) return;
    
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    const targetUserId = currentViewedUser.id;
    const isBlocked = (currentUser.blockedUsers || []).includes(targetUserId);
    
    if (isBlocked) {
        // Unblock
        socket.emit('unblock_user', { userId: currentUser.id, targetUserId });
        showToast(`Unblocked ${currentViewedUser.fullName || currentViewedUser.username}`, 'success', 'fa-user-check');
        
        // Update local state
        if (currentUser.blockedUsers) {
            currentUser.blockedUsers = currentUser.blockedUsers.filter(id => id !== targetUserId);
        }
    } else {
        // Block
        socket.emit('block_user', { userId: currentUser.id, targetUserId });
        showToast(`Blocked ${currentViewedUser.fullName || currentViewedUser.username}`, 'warning', 'fa-ban');
        
        // Update local state
        if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
        currentUser.blockedUsers.push(targetUserId);
        
        // Also remove from friends
        if (currentUser.friends) {
            currentUser.friends = currentUser.friends.filter(id => id !== targetUserId);
        }
        
        closeUserProfileModal();
    }
    
    // Update button state
    updateMuteBlockButtonStates();
    localStorage.setItem('bump_user', JSON.stringify(currentUser));
}

function updateMuteBlockButtonStates() {
    if (!currentViewedUser) return;
    
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    const targetUserId = currentViewedUser.id;
    const isMuted = (currentUser.mutedUsers || []).includes(targetUserId);
    const isBlocked = (currentUser.blockedUsers || []).includes(targetUserId);
    
    // Update modal buttons
    const muteBtn = document.getElementById('mute-user-btn');
    const blockBtn = document.getElementById('block-user-btn');
    
    if (muteBtn) {
        muteBtn.innerHTML = isMuted 
            ? '<i class="fas fa-bell"></i><span>Unmute Notifications</span>'
            : '<i class="fas fa-bell-slash"></i><span>Mute Notifications</span>';
        muteBtn.classList.toggle('active', isMuted);
    }
    
    if (blockBtn) {
        blockBtn.innerHTML = isBlocked 
            ? '<i class="fas fa-user-check"></i><span>Unblock</span>'
            : '<i class="fas fa-ban"></i><span>Block</span>';
        blockBtn.classList.toggle('active', isBlocked);
    }
    
    // Update panel buttons
    const panelMuteBtn = document.getElementById('panel-mute-btn');
    const panelBlockBtn = document.getElementById('panel-block-btn');
    
    if (panelMuteBtn) {
        panelMuteBtn.innerHTML = isMuted 
            ? '<i class="fas fa-bell"></i><span>Unmute</span>'
            : '<i class="fas fa-bell-slash"></i><span>Mute</span>';
        panelMuteBtn.classList.toggle('active', isMuted);
    }
    
    if (panelBlockBtn) {
        panelBlockBtn.innerHTML = isBlocked 
            ? '<i class="fas fa-user-check"></i><span>Unblock</span>'
            : '<i class="fas fa-ban"></i><span>Block</span>';
        panelBlockBtn.classList.toggle('active', isBlocked);
    }
}

// Panel mute/block functions
function toggleMuteFromPanel() {
    toggleMuteUser();
}

function toggleBlockFromPanel() {
    toggleBlockUser();
}

// ==========================================
// MINI PROFILE CARD (Hover Card)
// ==========================================

let miniProfileTimeout = null;
let currentMiniProfileUser = null;

function showMiniProfile(userId, element) {
    // Clear any existing timeout
    if (miniProfileTimeout) {
        clearTimeout(miniProfileTimeout);
    }
    
    // Delay before showing
    miniProfileTimeout = setTimeout(async () => {
        try {
            const user = await apiRequest(`/users/${userId}`);
            if (!user) return;
            
            currentMiniProfileUser = user;
            
            const existingCard = document.getElementById('mini-profile-card');
            if (existingCard) existingCard.remove();
            
            const currentUser = getCurrentUser();
            const isFriend = currentUser?.friends?.includes(userId);
            
            const card = document.createElement('div');
            card.id = 'mini-profile-card';
            card.className = 'mini-profile-card';
            card.innerHTML = `
                <div class="mini-profile-banner"></div>
                <div class="mini-profile-avatar-wrap">
                    <img src="${user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.username}" alt="">
                    <span class="mini-status-dot ${user.status || 'offline'}"></span>
                </div>
                <div class="mini-profile-info">
                    <h4>${user.fullName || user.username}</h4>
                    <span class="mini-profile-wave">~${user.username}</span>
                    <p class="mini-profile-bio">${user.bio || 'No bio yet'}</p>
                </div>
                <div class="mini-profile-actions">
                    <button class="mini-action-btn primary" onclick="startChat('${userId}'); hideMiniProfile();">
                        <i class="fas fa-comment"></i>
                    </button>
                    <button class="mini-action-btn" onclick="showRightProfilePanel('${userId}'); hideMiniProfile();">
                        <i class="fas fa-user"></i>
                    </button>
                    ${!isFriend ? `<button class="mini-action-btn success" onclick="sendFriendRequest('${userId}'); hideMiniProfile();">
                        <i class="fas fa-user-plus"></i>
                    </button>` : ''}
                </div>
            `;
            
            // Position the card near the element
            const rect = element.getBoundingClientRect();
            card.style.position = 'fixed';
            card.style.left = `${rect.right + 10}px`;
            card.style.top = `${rect.top}px`;
            
            // Adjust if off screen
            document.body.appendChild(card);
            
            const cardRect = card.getBoundingClientRect();
            if (cardRect.right > window.innerWidth) {
                card.style.left = `${rect.left - cardRect.width - 10}px`;
            }
            if (cardRect.bottom > window.innerHeight) {
                card.style.top = `${window.innerHeight - cardRect.height - 10}px`;
            }
            
            // Add hover listeners to keep card visible
            card.addEventListener('mouseenter', () => {
                if (miniProfileTimeout) clearTimeout(miniProfileTimeout);
            });
            
            card.addEventListener('mouseleave', () => {
                hideMiniProfile();
            });
            
        } catch (error) {
            console.error('Error showing mini profile:', error);
        }
    }, 500);
}

function hideMiniProfile() {
    if (miniProfileTimeout) {
        clearTimeout(miniProfileTimeout);
        miniProfileTimeout = null;
    }
    
    const card = document.getElementById('mini-profile-card');
    if (card) {
        card.classList.add('fade-out');
        setTimeout(() => card.remove(), 200);
    }
    
    currentMiniProfileUser = null;
}

// ==========================================
// FULL PROFILE MODAL (Discord-style)
// ==========================================

function openFullProfile(userId) {
    // Close any existing mini profile
    hideMiniProfile();
    
    // Open the full Discord-style profile modal
    openDiscordUserProfileModal(userId);
}

// ========================================
// FRIENDS SYSTEM
// ========================================

async function loadFriendRequests() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        const requests = await apiRequest(`/friends/requests/${currentUser.id}`);
        AppState.friendRequests = requests;
        renderFriendRequests();
        updateInboxBadge();
    } catch (error) {
        console.error('Error loading friend requests:', error);
    }
}

async function loadFriends() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        const friends = await apiRequest(`/friends/${currentUser.id}`);
        AppState.friends = friends;
        renderFriendsList();
    } catch (error) {
        console.error('Error loading friends:', error);
    }
}

function renderFriendRequests() {
    const requestsList = document.getElementById('friend-requests-list');
    if (!requestsList) return;
    
    const requests = AppState.friendRequests || [];
    const noRequests = document.getElementById('no-requests');
    
    if (requests.length === 0) {
        if (noRequests) noRequests.style.display = 'flex';
        requestsList.innerHTML = `
            <div class="empty-state" id="no-requests">
                <i class="fas fa-user-clock"></i>
                <p>No pending requests</p>
            </div>
        `;
    } else {
        requestsList.innerHTML = requests.map(req => `
            <div class="friend-request-item" data-request-id="${req.id}">
                <img src="${req.fromUser?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default'}" alt="" class="friend-request-avatar">
                <div class="friend-request-info">
                    <div class="friend-request-name">${req.fromUser?.fullName || 'Unknown'}</div>
                    <div class="friend-request-username">@${req.fromUser?.username || 'unknown'}</div>
                </div>
                <div class="friend-request-actions">
                    <button class="btn-accept" onclick="acceptFriendRequest('${req.id}')">Accept</button>
                    <button class="btn-decline" onclick="rejectFriendRequest('${req.id}')">Ignore</button>
                </div>
            </div>
        `).join('');
    }
    
    // Update badges
    updateRequestsBadge();
    updateInboxBadge();
}

function renderFriendsList() {
    const friendsList = document.getElementById('friends-list');
    if (!friendsList) return;
    
    const friends = AppState.friends || [];
    const noFriends = document.getElementById('no-friends');
    
    if (friends.length === 0) {
        friendsList.innerHTML = `
            <div class="empty-state" id="no-friends">
                <i class="fas fa-user-friends"></i>
                <p>No friends yet</p>
                <button class="btn-text" onclick="switchView('search')">Find Friends</button>
            </div>
        `;
    } else {
        friendsList.innerHTML = friends.map(friend => `
            <div class="friend-item" data-user-id="${friend.id}" onclick="openChat('${friend.id}')">
                <img src="${friend.avatar}" alt="" class="friend-avatar">
                <div class="friend-info">
                    <div class="friend-name">${friend.fullName}</div>
                    <div class="friend-status ${isUserOnline(friend.id) ? 'online' : ''}">
                        ${isUserOnline(friend.id) ? 'Online' : 'Offline'}
                    </div>
                </div>
            </div>
        `).join('');
    }
}

function updateInboxBadge() {
    const count = (AppState.friendRequests || []).length;
    if (DOM.inboxBadge) {
        DOM.inboxBadge.textContent = count;
        DOM.inboxBadge.classList.toggle('hidden', count === 0);
    }
}

async function sendFriendRequest(toUserId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        await apiRequest('/friends/request', 'POST', {
            fromUserId: currentUser.id,
            toUserId
        });
        showToast('Friend request sent!', 'success');
        // Refresh search results to update button state
        if (DOM.userSearch?.value) {
            renderSearchResults(DOM.userSearch.value);
        }
    } catch (error) {
        showToast(error.message || 'Failed to send request', 'error');
    }
}

async function acceptFriendRequest(requestId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        await apiRequest('/friends/accept', 'POST', {
            requestId,
            userId: currentUser.id
        });
        showToast('Friend request accepted!', 'success');
        loadFriendRequests();
        loadFriends();
        loadConversations();
    } catch (error) {
        showToast(error.message || 'Failed to accept request', 'error');
    }
}

async function rejectFriendRequest(requestId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        await apiRequest('/friends/reject', 'POST', {
            requestId,
            userId: currentUser.id
        });
        showToast('Friend request rejected', 'info');
        loadFriendRequests();
    } catch (error) {
        showToast(error.message || 'Failed to reject request', 'error');
    }
}

async function getFriendshipStatus(otherUserId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return { status: 'none' };
    
    try {
        return await apiRequest(`/friends/status/${currentUser.id}/${otherUserId}`);
    } catch (error) {
        return { status: 'none' };
    }
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
    DOM.chatWaveId.textContent = formatWaveId(user.username);
    
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
    const isBump = bubbleStyle === 'bump';

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
        // Process text with URL link previews
        const textHtml = msg.text ? LinkPreviewManager.processTextWithLinks(msg.text) : '';
        
        // Check if message was deleted for everyone (show placeholder)
        if (msg.deletedForEveryone) {
            html += `
                <div class="message ${isSent ? 'sent' : 'received'} message-deleted" data-msg-id="${msg.id}" data-sender="${senderName}">
                    ${isBump ? `<img src="${senderAvatar}" alt="" class="message-avatar">` : ''}
                    <div class="message-bubble">
                        ${isBump ? `<div class="message-header"><span class="message-sender">${senderName}</span></div>` : ''}
                        <div class="message-content">
                            <i class="fas fa-ban deleted-notice-icon"></i>
                            <span>${isSent ? 'You deleted this message' : 'This message was deleted'}</span>
                        </div>
                    </div>
                </div>
            `;
            return;
        }
        
        // Message actions (delete, save) - always show for sent, download for media
        const hasMedia = msg.fileUrl && (msg.fileType === 'image' || msg.fileType === 'video');
        const actionsHtml = `
            <div class="message-actions">
                ${hasMedia ? `<button class="msg-action-btn save-btn" onclick="event.stopPropagation(); saveMedia('${msg.fileUrl}', '${msg.fileName || 'file'}')" title="Save to device"><i class="fas fa-download"></i></button>` : ''}
                ${isSent ? `<button class="msg-action-btn delete-btn" onclick="event.stopPropagation(); showDeleteModal('${msg.id}')" title="Delete message"><i class="fas fa-trash"></i></button>` : ''}
            </div>
        `;
        
        if (isBump) {
            // Bump Signature Style - 70% Discord + 30% Snapchat
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
        } else {
            // Classic Style - WhatsApp/Telegram bubbles
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
    const isBump = bubbleStyle === 'bump';
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
    // Process text with URL link previews
    const textHtml = message.text ? LinkPreviewManager.processTextWithLinks(message.text) : '';
    
    // Message actions
    const hasMedia = message.fileUrl && (message.fileType === 'image' || message.fileType === 'video');
    const actionsHtml = `
        <div class="message-actions">
            ${hasMedia ? `<button class="msg-action-btn save-btn" onclick="event.stopPropagation(); saveMedia('${message.fileUrl}', '${message.fileName || 'file'}')" title="Save to device"><i class="fas fa-download"></i></button>` : ''}
            ${isSent ? `<button class="msg-action-btn delete-btn" onclick="event.stopPropagation(); showDeleteModal('${message.id}')" title="Delete message"><i class="fas fa-trash"></i></button>` : ''}
        </div>
    `;

    const messageEl = document.createElement('div');
    messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
    messageEl.dataset.msgId = message.id;
    messageEl.dataset.sender = senderName;
    
    if (isBump) {
        // Bump Signature Style
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
    } else {
        // Classic Style
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
    
    // Reset to voice button after sending
    toggleVoiceSendButton();

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

// Toggle between Voice and Send button (WhatsApp style)
function toggleVoiceSendButton() {
    const messageInput = document.getElementById('message-input');
    const voiceBtn = document.getElementById('voice-btn');
    const sendBtn = document.getElementById('send-btn');
    
    if (!messageInput || !voiceBtn || !sendBtn) return;
    
    const hasText = messageInput.value.trim().length > 0;
    
    if (hasText) {
        voiceBtn.classList.add('hidden');
        sendBtn.classList.remove('hidden');
    } else {
        voiceBtn.classList.remove('hidden');
        sendBtn.classList.add('hidden');
    }
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
    const currentUser = getCurrentUser();
    const users = query 
        ? AppState.users.filter(u => 
            u.id !== currentUser?.id && (
                u.fullName.toLowerCase().includes(query.toLowerCase()) ||
                u.username.toLowerCase().includes(query.toLowerCase())
            )
          )
        : AppState.users.filter(u => u.id !== currentUser?.id);

    if (users.length === 0) {
        DOM.searchResults.innerHTML = `
            <div class="no-results">
                <i class="fas fa-user-slash"></i>
                <p>${query ? 'No users found' : 'No users yet'}</p>
            </div>
        `;
        return;
    }

    // Check friendship status for each user
    Promise.all(users.map(async user => {
        const status = await getFriendshipStatus(user.id);
        return { user, status: status.status };
    })).then(results => {
        DOM.searchResults.innerHTML = results.map(({ user, status }) => {
            let actionBtn = '';
            if (status === 'friends') {
                actionBtn = `<button class="add-friend-btn friends" disabled><i class="fas fa-check"></i> Friends</button>`;
            } else if (status === 'request_sent') {
                actionBtn = `<button class="add-friend-btn pending" disabled>Pending</button>`;
            } else if (status === 'request_received') {
                actionBtn = `<button class="add-friend-btn" onclick="event.stopPropagation(); switchView('inbox')">View Request</button>`;
            } else {
                actionBtn = `<button class="add-friend-btn" onclick="event.stopPropagation(); sendFriendRequest('${user.id}')"><i class="fas fa-user-plus"></i> Add</button>`;
            }
            
            return `
                <div class="search-result-item" data-user-id="${user.id}">
                    <img src="${user.avatar}" alt="${user.fullName}">
                    <div class="search-result-info">
                        <span class="search-result-name">${user.fullName}</span>
                        <span class="search-result-username">@${user.username}</span>
                    </div>
                    <div class="search-result-action">
                        ${actionBtn}
                    </div>
                </div>
            `;
        }).join('');

        DOM.searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => showUserProfile(item.dataset.userId));
        });
    });
}

// ========================================
// PROFILE
// ========================================

function updateProfileView() {
    const user = getCurrentUser();
    if (!user) return;

    const avatarUrl = user.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=default';
    
    if (DOM.myAvatar) DOM.myAvatar.src = avatarUrl;
    if (DOM.profileFullname) DOM.profileFullname.value = user.fullname || user.fullName || '';
    if (DOM.profileUsername) DOM.profileUsername.value = user.username || '';
    if (DOM.profileEmail) DOM.profileEmail.value = user.email || '';
    if (DOM.profileBio) DOM.profileBio.value = user.bio || '';
    if (DOM.profileStatus) DOM.profileStatus.value = user.status || 'online';
    
    // Update Wave ID
    if (DOM.myWaveId) {
        DOM.myWaveId.textContent = formatWaveId(user.username);
    }
    
    // Load theme and accent settings
    loadAppearanceSettings();
}

function loadAppearanceSettings() {
    const theme = Settings.get('theme') || 'dark';
    const accentColor = Settings.get('accentColor') || '#6366F1';
    const soundType = Settings.get('soundType') || 'pop';
    
    // Apply theme
    document.body.classList.remove('theme-dark', 'theme-midnight', 'theme-amoled', 'theme-light');
    if (theme !== 'dark') {
        document.body.classList.add(`theme-${theme}`);
    }
    
    // Set active theme button
    DOM.themeButtons?.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
    
    // Set active sound button
    document.querySelectorAll('.sound-option-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sound === soundType);
    });
    
    // Map colors to accent names
    const colorMap = {
        '#6366F1': 'indigo',
        '#8B5CF6': 'purple',
        '#EC4899': 'pink',
        '#EF4444': 'red',
        '#10B981': 'green',
        '#F59E0B': 'amber',
        '#06B6D4': 'cyan',
        '#3B82F6': 'blue'
    };
    
    const accentName = colorMap[accentColor] || 'indigo';
    document.body.removeAttribute('data-accent');
    if (accentName !== 'indigo') {
        document.body.setAttribute('data-accent', accentName);
    }
    
    // Set active color button (check both data-color and data-accent attributes)
    DOM.colorButtons?.forEach(btn => {
        const btnColor = btn.dataset.accent || btn.dataset.color;
        btn.classList.toggle('active', btnColor === accentColor);
    });
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

// ========================================
// FILE STAGING MANAGER
// Multi-file preview before sending
// ========================================

const FileStagingManager = {
    stagedFiles: [],
    
    init() {
        // DOM elements
        this.stagingArea = document.getElementById('file-staging-area');
        this.previewsContainer = document.getElementById('staging-previews');
        this.countLabel = this.stagingArea?.querySelector('.staging-count');
        this.clearBtn = document.getElementById('clear-staging-btn');
        this.sendBtn = document.getElementById('send-staged-files-btn');
        this.addMoreBtn = document.getElementById('add-more-files-btn');
        
        // Event listeners
        this.clearBtn?.addEventListener('click', () => this.clearAll());
        this.sendBtn?.addEventListener('click', () => this.sendAllFiles());
        this.addMoreBtn?.addEventListener('click', () => DOM.fileInput?.click());
    },
    
    addFiles(files) {
        for (const file of files) {
            const id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            this.stagedFiles.push({ id, file, preview: null });
            this.createPreview(id, file);
        }
        this.updateUI();
    },
    
    createPreview(id, file) {
        const item = document.createElement('div');
        item.className = 'staging-item';
        item.dataset.id = id;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'staging-remove-btn';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            this.removeFile(id);
        };
        
        if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            item.appendChild(img);
        } else if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = URL.createObjectURL(file);
            video.muted = true;
            item.appendChild(video);
        } else {
            // Document preview
            const docPreview = document.createElement('div');
            docPreview.className = 'staging-item-doc';
            const iconClass = this.getDocIcon(file.name);
            docPreview.innerHTML = `
                <i class="fas ${iconClass}"></i>
                <span>${file.name.length > 12 ? file.name.substring(0, 10) + '...' : file.name}</span>
            `;
            item.appendChild(docPreview);
        }
        
        item.appendChild(removeBtn);
        this.previewsContainer?.appendChild(item);
    },
    
    getDocIcon(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const icons = {
            pdf: 'fa-file-pdf',
            doc: 'fa-file-word',
            docx: 'fa-file-word',
            xls: 'fa-file-excel',
            xlsx: 'fa-file-excel',
            ppt: 'fa-file-powerpoint',
            pptx: 'fa-file-powerpoint',
            zip: 'fa-file-zipper',
            rar: 'fa-file-zipper',
            txt: 'fa-file-lines',
            mp3: 'fa-file-audio',
            wav: 'fa-file-audio'
        };
        return icons[ext] || 'fa-file';
    },
    
    removeFile(id) {
        this.stagedFiles = this.stagedFiles.filter(f => f.id !== id);
        const item = this.previewsContainer?.querySelector(`[data-id="${id}"]`);
        if (item) {
            item.style.animation = 'fadeOut 0.2s ease forwards';
            setTimeout(() => item.remove(), 200);
        }
        this.updateUI();
    },
    
    clearAll() {
        this.stagedFiles = [];
        if (this.previewsContainer) {
            this.previewsContainer.innerHTML = '';
        }
        this.updateUI();
    },
    
    async sendAllFiles() {
        if (this.stagedFiles.length === 0) return;
        
        const filesToSend = [...this.stagedFiles];
        this.clearAll();
        
        for (const { file } of filesToSend) {
            await MediaHandler.uploadFile(file);
        }
        
        showToast(`${filesToSend.length} file(s) sent!`, 'success');
    },
    
    updateUI() {
        if (!this.stagingArea) return;
        
        if (this.stagedFiles.length > 0) {
            this.stagingArea.classList.remove('hidden');
            if (this.countLabel) {
                this.countLabel.textContent = `${this.stagedFiles.length} file${this.stagedFiles.length > 1 ? 's' : ''} selected`;
            }
        } else {
            this.stagingArea.classList.add('hidden');
        }
    }
};

function setupMediaHandlers() {
    // Initialize File Staging Manager
    FileStagingManager.init();
    
    // Attach button - open file picker
    DOM.attachBtn?.addEventListener('click', () => {
        if (!AppState.selectedChat) {
            showToast('Please select a chat first', 'warning');
            return;
        }
        DOM.fileInput?.click();
    });
    
    // File input change - Stage files instead of sending immediately
    DOM.fileInput?.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            FileStagingManager.addFiles(files);
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
    
    // Camera input change - Send camera photos immediately (instant capture UX)
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
    
    // Apply bubble style to chat view (only 2 styles: classic and bump)
    const chatView = DOM.chatView;
    if (chatView) {
        chatView.classList.remove('bubble-classic', 'bubble-bump');
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

// ========================================
// LINK PREVIEW & MINI-BROWSER
// Detect URLs and render as interactive cards
// ========================================

const LinkPreviewManager = {
    urlRegex: /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/gi,
    
    // Sites that typically block iframes - always show OG card for these
    blockedDomains: [
        'facebook.com', 'fb.com', 'twitter.com', 'x.com', 'instagram.com', 
        'linkedin.com', 'tiktok.com', 'pinterest.com', 'reddit.com',
        'amazon.com', 'google.com', 'github.com', 'spotify.com', 
        'twitch.tv', 'netflix.com', 'discord.com', 'whatsapp.com', 
        'telegram.org', 'medium.com'
    ],
    
    // Detect URLs in text
    detectUrls(text) {
        if (!text) return [];
        const matches = text.match(this.urlRegex);
        return matches ? [...new Set(matches)] : [];
    },
    
    // Check if URL is YouTube
    isYouTube(url) {
        return url.includes('youtube.com') || url.includes('youtu.be');
    },
    
    // Extract YouTube video ID
    getYouTubeId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
            /youtube\.com\/shorts\/([^&\s?]+)/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    },
    
    // Check if site allows iframes
    allowsIframe(url) {
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            return !this.blockedDomains.some(domain => 
                hostname.includes(domain)
            );
        } catch {
            return false;
        }
    },
    
    // Get domain from URL
    getDomain(url) {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return url;
        }
    },
    
    // Get favicon URL
    getFavicon(url) {
        try {
            const hostname = new URL(url).hostname;
            return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
        } catch {
            return '';
        }
    },
    
    // Render YouTube embedded player
    renderYouTubeEmbed(url) {
        const videoId = this.getYouTubeId(url);
        if (!videoId) return this.renderLinkCard(url);
        
        return `
            <div class="youtube-embed">
                <div class="youtube-player">
                    <iframe 
                        src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1" 
                        frameborder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowfullscreen>
                    </iframe>
                </div>
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="youtube-link">
                    <i class="fab fa-youtube"></i> Watch on YouTube
                </a>
            </div>
        `;
    },
    
    // Render link as mini-browser card (with iframe) or OG card fallback
    renderLinkCard(url) {
        // Check for YouTube first
        if (this.isYouTube(url)) {
            return this.renderYouTubeEmbed(url);
        }
        
        const domain = this.getDomain(url);
        const favicon = this.getFavicon(url);
        const cardId = 'link-' + Math.random().toString(36).substr(2, 9);
        
        if (this.allowsIframe(url)) {
            // Mini-browser with iframe
            return `
                <div class="link-card" id="${cardId}">
                    <div class="link-card-header">
                        <img src="${favicon}" alt="" class="link-card-favicon" onerror="this.style.display='none'">
                        <span class="link-card-domain">${domain}</span>
                        <a href="${url}" target="_blank" rel="noopener noreferrer" class="link-card-open">
                            <i class="fas fa-external-link-alt"></i> Open
                        </a>
                    </div>
                    <div class="link-card-iframe-container">
                        <iframe src="${url}" class="link-card-iframe" sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe>
                        <div class="link-card-overlay" onclick="toggleLinkInteraction('${cardId}')">
                            <span><i class="fas fa-hand-pointer"></i> Click to interact</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Open Graph fallback card (simple link preview)
            return `
                <a href="${url}" target="_blank" rel="noopener noreferrer" class="og-card">
                    <div class="og-card-content">
                        <div class="og-card-title">${domain}</div>
                        <div class="og-card-description">${url}</div>
                        <div class="og-card-domain">
                            <img src="${favicon}" alt="" style="width:12px;height:12px;border-radius:2px" onerror="this.style.display='none'">
                            <span>${domain}</span>
                        </div>
                    </div>
                </a>
            `;
        }
    },
    
    // Convert text with URLs to HTML with link cards
    processTextWithLinks(text) {
        if (!text) return '';
        
        const urls = this.detectUrls(text);
        if (urls.length === 0) return escapeHtml(text);
        
        // Escape the text first
        let html = escapeHtml(text);
        
        // Replace URLs with clickable links + render cards after
        let linkCards = '';
        urls.forEach(url => {
            const escapedUrl = escapeHtml(url);
            html = html.replace(
                escapedUrl, 
                `<a href="${url}" target="_blank" rel="noopener noreferrer" class="inline-link">${escapedUrl}</a>`
            );
            // Add link card for first URL only to avoid clutter
            if (linkCards === '') {
                linkCards = this.renderLinkCard(url);
            }
        });
        
        return html + linkCards;
    }
};

// Toggle iframe interaction
function toggleLinkInteraction(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    
    const iframe = card.querySelector('.link-card-iframe');
    const overlay = card.querySelector('.link-card-overlay');
    
    if (iframe.classList.contains('interactive')) {
        iframe.classList.remove('interactive');
        overlay.style.display = 'flex';
    } else {
        iframe.classList.add('interactive');
        overlay.style.display = 'none';
    }
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

// ========================================
// DELETE MESSAGE MODAL SYSTEM
// ========================================
let pendingDeleteMessageId = null;

function showDeleteModal(messageId) {
    pendingDeleteMessageId = messageId;
    const modal = document.getElementById('delete-modal');
    modal.classList.remove('hidden');
    
    // Setup event listeners
    document.getElementById('delete-for-me-btn').onclick = () => deleteForMe();
    document.getElementById('delete-for-everyone-btn').onclick = () => deleteForEveryone();
    document.getElementById('delete-cancel-btn').onclick = () => hideDeleteModal();
    
    // Close on overlay click
    modal.onclick = (e) => {
        if (e.target === modal) hideDeleteModal();
    };
}

function hideDeleteModal() {
    document.getElementById('delete-modal').classList.add('hidden');
    pendingDeleteMessageId = null;
}

// Delete for Me - Only removes from local view
async function deleteForMe() {
    if (!pendingDeleteMessageId) return;
    
    const messageId = pendingDeleteMessageId;
    hideDeleteModal();
    
    // Remove from local state only (not from server)
    if (AppState.messages[AppState.selectedChat]) {
        AppState.messages[AppState.selectedChat] = AppState.messages[AppState.selectedChat].filter(m => m.id !== messageId);
    }
    
    // Remove from DOM with animation
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
        msgEl.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => msgEl.remove(), 300);
    }
    
    // Store locally deleted messages
    const deletedForMe = JSON.parse(localStorage.getItem('deletedForMe') || '[]');
    deletedForMe.push(messageId);
    localStorage.setItem('deletedForMe', JSON.stringify(deletedForMe));
    
    showToast('Message deleted for you', 'success');
}

// Delete for Everyone - Removes from server and notifies other user
async function deleteForEveryone() {
    if (!pendingDeleteMessageId) return;
    
    const messageId = pendingDeleteMessageId;
    const currentUser = getCurrentUser();
    hideDeleteModal();
    
    if (!currentUser || !AppState.selectedChat) return;
    
    try {
        const response = await fetch(`${CONFIG.API_URL}/messages/${messageId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: currentUser.id,
                deleteType: 'everyone'
            })
        });
        
        if (response.ok) {
            // Update local state - mark as deleted, don't remove
            if (AppState.messages[AppState.selectedChat]) {
                const msgIndex = AppState.messages[AppState.selectedChat].findIndex(m => m.id === messageId);
                if (msgIndex !== -1) {
                    AppState.messages[AppState.selectedChat][msgIndex].deletedForEveryone = true;
                    AppState.messages[AppState.selectedChat][msgIndex].text = null;
                    AppState.messages[AppState.selectedChat][msgIndex].fileUrl = null;
                }
            }
            
            // Update DOM to show "You deleted this message"
            const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
            if (msgEl) {
                msgEl.classList.add('message-deleted');
                const bubble = msgEl.querySelector('.message-bubble');
                const content = msgEl.querySelector('.message-content') || bubble;
                
                if (content) {
                    content.innerHTML = `
                        <i class="fas fa-ban deleted-notice-icon"></i>
                        <span>You deleted this message</span>
                    `;
                }
                
                // Remove action buttons
                const actions = msgEl.querySelector('.message-actions');
                if (actions) actions.remove();
            }
            
            showToast('Message deleted for everyone', 'success');
            
            // Notify other user via socket - they will see "message deleted" notice
            socket.emit('message_deleted_everyone', { 
                messageId, 
                conversationId: AppState.selectedChat,
                senderName: currentUser.fullName
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

// Legacy delete function - now shows modal
async function deleteMessage(messageId) {
    showDeleteModal(messageId);
}

async function showUserProfile(userId) {
    try {
        const user = await apiRequest(`/users/${userId}`);
        if (!user) {
            showToast('User not found', 'error');
            return;
        }
        
        // Show the right-side profile panel
        showProfilePanel(user);

        // Also update the old panel for compatibility (with null checks)
        if (DOM.panelAvatarImg) DOM.panelAvatarImg.src = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;
        if (DOM.panelFullname) DOM.panelFullname.textContent = user.fullName || user.username;
        if (DOM.panelUsername) DOM.panelUsername.textContent = user.username;
        if (DOM.panelBio) DOM.panelBio.textContent = user.bio || 'No bio yet';
        if (DOM.panelJoined) DOM.panelJoined.textContent = formatJoinDate(user.createdAt);

        if (DOM.profilePanel) DOM.profilePanel.dataset.userId = userId;
        
        // Update friend button state
        updatePanelFriendButton(user);
        
        // Setup panel action buttons
        setupPanelActions(user);
    } catch (error) {
        console.error('Profile error:', error);
        showToast('Could not load profile', 'error');
    }
}

// Show the right-side profile panel with user data
function showProfilePanel(user) {
    const panel = document.getElementById('profile-panel');
    if (!panel || !user) return;
    
    // Show the panel
    panel.classList.remove('hidden');
    AppState.isProfilePanelOpen = true;
    panel.dataset.userId = user.id;
    
    // Update avatar
    const avatarImg = document.getElementById('panel-avatar-img');
    if (avatarImg) avatarImg.src = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;
    
    // Update name and username
    const fullname = document.getElementById('panel-fullname');
    const username = document.getElementById('panel-username');
    if (fullname) fullname.textContent = user.fullName || user.username;
    if (username) username.textContent = user.username;
    
    // Update status dot
    const statusDot = document.getElementById('panel-status-dot');
    const statusText = document.getElementById('panel-status');
    const statusIndicator = document.getElementById('panel-status-indicator');
    const isOnline = isUserOnline(user.id);
    const status = isOnline ? 'online' : (user.status || 'offline');
    
    if (statusDot) {
        statusDot.className = 'panel-status-dot';
        if (status === 'away') statusDot.classList.add('away');
        else if (status === 'busy') statusDot.classList.add('busy');
        else if (status === 'offline' || !isOnline) statusDot.classList.add('offline');
    }
    
    if (statusIndicator) {
        statusIndicator.className = 'status-indicator';
        if (status === 'away') statusIndicator.classList.add('away');
        else if (status === 'busy') statusIndicator.classList.add('busy');
        else if (status === 'offline' || !isOnline) statusIndicator.classList.add('offline');
    }
    
    if (statusText) {
        const statusLabels = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' };
        statusText.textContent = statusLabels[status] || 'Offline';
    }
    
    // Update bio
    const bio = document.getElementById('panel-bio');
    if (bio) bio.textContent = user.bio || 'No bio yet';
    
    // Update join date
    const joined = document.getElementById('panel-joined');
    if (joined) {
        const date = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        }) : 'Unknown';
        joined.innerHTML = `<i class="fas fa-calendar"></i> ${date}`;
    }
    
    // Update friend button
    updatePanelFriendButton(user);
    
    // Setup message button
    const messageBtn = document.getElementById('panel-message-btn');
    if (messageBtn) {
        messageBtn.onclick = () => {
            closeProfilePanel();
            startChat(user.id);
        };
    }
    
    // Setup panel tab switching and actions
    setupPanelTabs();
    setupPanelActions(user);
}

function setupPanelTabs() {
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.onclick = () => {
            const tabName = tab.dataset.panelTab;
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`panel-tab-${tabName}`)?.classList.add('active');
        };
    });
}

function updatePanelFriendButton(user) {
    const addFriendBtn = document.getElementById('panel-add-friend-btn');
    if (!addFriendBtn) return;
    
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    const isFriend = AppState.friends?.some(f => f.id === user.id);
    const hasPendingRequest = AppState.friendRequests?.some(r => 
        (r.from === currentUser.id && r.to === user.id) || 
        (r.from === user.id && r.to === currentUser.id)
    );
    
    if (isFriend) {
        addFriendBtn.innerHTML = '<i class="fas fa-user-check"></i> Friends';
        addFriendBtn.className = 'btn-success panel-friend-btn friends';
        addFriendBtn.onclick = null;
    } else if (hasPendingRequest) {
        addFriendBtn.innerHTML = '<i class="fas fa-clock"></i> Pending';
        addFriendBtn.className = 'btn-success panel-friend-btn pending';
        addFriendBtn.onclick = null;
    } else {
        addFriendBtn.innerHTML = '<i class="fas fa-user-plus"></i> Add Friend';
        addFriendBtn.className = 'btn-success panel-friend-btn';
        addFriendBtn.onclick = () => sendFriendRequestFromPanel(user);
    }
}

async function sendFriendRequestFromPanel(user) {
    const currentUser = getCurrentUser();
    if (!currentUser || !user) return;
    
    try {
        await apiRequest('/friends/request', 'POST', {
            fromUserId: currentUser.id,
            toUserId: user.id
        });
        
        showToast(`Friend request sent to ${user.fullName}`, 'success');
        updatePanelFriendButton(user);
    } catch (error) {
        showToast(error.message || 'Failed to send friend request', 'error');
    }
}

function setupPanelActions(user) {
    const muteBtn = document.getElementById('panel-mute-btn');
    const blockBtn = document.getElementById('panel-block-btn');
    const viewFullBtn = document.getElementById('panel-view-full-btn');
    const addFriendBtn = document.getElementById('panel-add-friend-btn');
    
    // Store the user for mute/block actions
    currentViewedUser = user;
    
    if (muteBtn) {
        const currentUser = getCurrentUser();
        const isMuted = (currentUser?.mutedUsers || []).includes(user.id);
        updateMuteButton(muteBtn, isMuted);
        muteBtn.onclick = () => {
            currentViewedUser = user;
            const currentMuted = (getCurrentUser()?.mutedUsers || []).includes(user.id);
            toggleMuteUser();
            // Update button to opposite state immediately
            setTimeout(() => {
                updateMuteButton(muteBtn, !currentMuted);
            }, 50);
        };
    }
    
    if (blockBtn) {
        const currentUser = getCurrentUser();
        const isBlocked = (currentUser?.blockedUsers || []).includes(user.id);
        updateBlockButton(blockBtn, isBlocked);
        blockBtn.onclick = () => {
            currentViewedUser = user;
            const currentBlocked = (getCurrentUser()?.blockedUsers || []).includes(user.id);
            toggleBlockUser();
            // Update button to opposite state immediately
            setTimeout(() => {
                updateBlockButton(blockBtn, !currentBlocked);
            }, 50);
        };
    }
    
    // Friend/Unfriend button
    if (addFriendBtn) {
        updatePanelFriendButtonState(user.id, addFriendBtn);
        addFriendBtn.onclick = () => {
            toggleFriendship(user);
        };
    }
    
    if (viewFullBtn) {
        viewFullBtn.onclick = () => {
            closeProfilePanel();
            openDiscordUserProfileModal(user.id, user);
        };
    }
}

// Mute/Block Storage Functions - Use server-synced user data
function getMutedUsers() {
    const currentUser = getCurrentUser();
    return currentUser?.mutedUsers || [];
}

function getBlockedUsers() {
    const currentUser = getCurrentUser();
    return currentUser?.blockedUsers || [];
}

function isUserMuted(userId) {
    return getMutedUsers().includes(userId);
}

function isUserBlocked(userId) {
    return getBlockedUsers().includes(userId);
}

// Old-style toggle functions kept for compatibility but now using server sync
function toggleMuteUserOld(user, button) {
    currentViewedUser = user;
    toggleMuteUser();
    if (button) updateMuteButton(button, isUserMuted(user.id));
}

function toggleBlockUserOld(user, button) {
    currentViewedUser = user;
    toggleBlockUser();
}

function updateMuteButton(button, isMuted) {
    if (!button) return;
    if (isMuted) {
        button.innerHTML = '<i class="fas fa-bell"></i><span>Unmute</span>';
        button.classList.add('muted');
        button.classList.add('active');
    } else {
        button.innerHTML = '<i class="fas fa-bell-slash"></i><span>Mute</span>';
        button.classList.remove('muted');
        button.classList.remove('active');
    }
}

function updateBlockButton(button, isBlocked) {
    if (!button) return;
    if (isBlocked) {
        button.innerHTML = '<i class="fas fa-user-check"></i><span>Unblock</span>';
        button.classList.add('blocked');
        button.classList.add('active');
        button.classList.remove('danger');
    } else {
        button.innerHTML = '<i class="fas fa-ban"></i><span>Block</span>';
        button.classList.remove('blocked');
        button.classList.remove('active');
        button.classList.add('danger');
    }
}

// Update Panel Friend Button State
function updatePanelFriendButtonState(userId, button) {
    if (!button) return;
    
    const currentUser = getCurrentUser();
    const isFriend = AppState.friends && AppState.friends.some(f => f.id === userId);
    
    // Check for pending requests (both incoming and sent)
    const hasIncomingRequest = AppState.friendRequests && AppState.friendRequests.some(r => 
        r.fromId === userId
    );
    const hasSentRequest = (AppState.sentFriendRequests && AppState.sentFriendRequests.some(r => r.toId === userId)) ||
        (AppState.friendRequests && AppState.friendRequests.some(r => r.toId === userId));
    
    // Reset button state
    button.disabled = false;
    button.classList.remove('success', 'danger', 'secondary', 'pending', 'friends');
    
    if (isFriend) {
        button.innerHTML = '<i class="fas fa-user-times"></i>';
        button.title = 'Remove Friend';
        button.classList.add('danger');
    } else if (hasIncomingRequest) {
        button.innerHTML = '<i class="fas fa-user-check"></i>';
        button.title = 'Accept Friend Request';
        button.classList.add('success');
    } else if (hasSentRequest) {
        button.innerHTML = '<i class="fas fa-hourglass-half"></i>';
        button.title = 'Request Sent';
        button.classList.add('pending');
    } else {
        button.innerHTML = '<i class="fas fa-user-plus"></i>';
        button.title = 'Add Friend';
        button.classList.add('success');
    }
}

// Toggle Friendship (Friend/Unfriend)
async function toggleFriendship(user) {
    const currentUser = getCurrentUser();
    if (!currentUser || !user) return;
    
    const isFriend = AppState.friends && AppState.friends.some(f => f.id === user.id);
    
    if (isFriend) {
        // Unfriend
        try {
            const response = await fetch('/api/friends/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    friendId: user.id
                })
            });
            
            if (response.ok) {
                // Update local state
                AppState.friends = AppState.friends.filter(f => f.id !== user.id);
                showToast(`Removed ${user.fullName || user.username} from friends`, 'info', 'fa-user-minus');
                
                // Update button
                const addFriendBtn = document.getElementById('panel-add-friend-btn');
                if (addFriendBtn) {
                    updatePanelFriendButtonState(user.id, addFriendBtn);
                }
                
                // Refresh friends list
                loadFriends();
            } else {
                const data = await response.json();
                showToast(data.error || 'Failed to remove friend', 'error');
            }
        } catch (error) {
            console.error('Error removing friend:', error);
            showToast('Failed to remove friend', 'error');
        }
    } else {
        // Send friend request
        try {
            const response = await fetch('/api/friend-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromId: currentUser.id,
                    toId: user.id
                })
            });
            
            if (response.ok) {
                showToast(`Friend request sent to ${user.fullName || user.username}`, 'success', 'fa-user-plus');
                
                // Add to local pending requests
                if (!AppState.sentFriendRequests) AppState.sentFriendRequests = [];
                AppState.sentFriendRequests.push({ toId: user.id });
                
                // Update button to show pending state
                const addFriendBtn = document.getElementById('panel-add-friend-btn');
                if (addFriendBtn) {
                    addFriendBtn.innerHTML = '<i class="fas fa-hourglass-half"></i>';
                    addFriendBtn.title = 'Request Sent - Waiting for response';
                    addFriendBtn.classList.remove('success', 'danger');
                    addFriendBtn.classList.add('pending');
                    addFriendBtn.disabled = false; // Keep clickable to cancel if needed
                }
            } else {
                const data = await response.json();
                showToast(data.error || 'Failed to send request', 'error');
            }
        } catch (error) {
            console.error('Error sending friend request:', error);
            showToast('Failed to send friend request', 'error');
        }
    }
}

// Note: Mini profile hover card is defined earlier in this file

// ========================================
// FULL PROFILE MODAL (Detailed View)
// ========================================

function openFullProfileModal(user) {
    if (!user) return;
    
    // Close sidebar panel if open
    closeProfilePanel();
    
    // Show the full profile modal
    const modal = document.getElementById('full-profile-modal');
    if (!modal) {
        createFullProfileModal();
    }
    
    populateFullProfileModal(user);
    document.getElementById('full-profile-modal')?.classList.remove('hidden');
}

function createFullProfileModal() {
    const modal = document.createElement('div');
    modal.id = 'full-profile-modal';
    modal.className = 'modal full-profile-modal hidden';
    modal.innerHTML = `
        <div class="full-profile-container">
            <button class="full-profile-close" onclick="closeFullProfileModal()">
                <i class="fas fa-times"></i>
            </button>
            
            <!-- Banner -->
            <div class="full-profile-banner" id="full-banner"></div>
            
            <!-- Main Content -->
            <div class="full-profile-main">
                <!-- Left Column - Avatar & Actions -->
                <div class="full-profile-left">
                    <div class="full-avatar-wrapper">
                        <img id="full-avatar" src="" alt="" class="full-profile-avatar">
                        <span class="full-status-dot" id="full-status-dot"></span>
                    </div>
                    <h2 id="full-name">Username</h2>
                    <span class="full-wave-id" id="full-wave">~username</span>
                    <span class="full-status-text" id="full-status-text">Online</span>
                    
                    <div class="full-actions-grid">
                        <button class="full-action-btn primary" id="full-message-btn">
                            <i class="fas fa-comment"></i>
                            <span>Message</span>
                        </button>
                        <button class="full-action-btn success" id="full-friend-btn">
                            <i class="fas fa-user-plus"></i>
                            <span>Add Friend</span>
                        </button>
                    </div>
                    
                    <div class="full-secondary-actions">
                        <button class="full-sec-btn" id="full-mute-btn">
                            <i class="fas fa-bell-slash"></i>
                            <span>Mute</span>
                        </button>
                        <button class="full-sec-btn danger" id="full-block-btn">
                            <i class="fas fa-ban"></i>
                            <span>Block</span>
                        </button>
                    </div>
                </div>
                
                <!-- Right Column - Info -->
                <div class="full-profile-right">
                    <div class="full-section">
                        <h3>About Me</h3>
                        <p id="full-bio">No bio yet</p>
                    </div>
                    
                    <div class="full-section">
                        <h3>Member Since</h3>
                        <p id="full-joined"><i class="fas fa-calendar"></i> Unknown</p>
                    </div>
                    
                    <div class="full-section">
                        <h3>Mutual Friends</h3>
                        <div class="full-mutual-list" id="full-mutual-friends">
                            <span class="no-mutual">No mutual friends</span>
                        </div>
                    </div>
                    
                    <div class="full-section">
                        <h3>Roles</h3>
                        <div class="full-roles" id="full-roles">
                            <span class="role-badge member">Member</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    modal.onclick = (e) => {
        if (e.target === modal) closeFullProfileModal();
    };
    
    document.body.appendChild(modal);
}

function populateFullProfileModal(user) {
    const avatar = document.getElementById('full-avatar');
    const name = document.getElementById('full-name');
    const wave = document.getElementById('full-wave');
    const bio = document.getElementById('full-bio');
    const joined = document.getElementById('full-joined');
    const statusDot = document.getElementById('full-status-dot');
    const statusText = document.getElementById('full-status-text');
    const messageBtn = document.getElementById('full-message-btn');
    const friendBtn = document.getElementById('full-friend-btn');
    const muteBtn = document.getElementById('full-mute-btn');
    const blockBtn = document.getElementById('full-block-btn');
    
    if (avatar) avatar.src = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;
    if (name) name.textContent = user.fullName || user.username;
    if (wave) wave.textContent = '~' + user.username;
    if (bio) bio.textContent = user.bio || 'No bio yet';
    
    if (joined) {
        const date = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
        }) : 'Unknown';
        joined.innerHTML = `<i class="fas fa-calendar"></i> ${date}`;
    }
    
    // Status
    const isOnline = isUserOnline(user.id);
    const status = isOnline ? 'online' : (user.status || 'offline');
    
    if (statusDot) {
        statusDot.className = 'full-status-dot ' + status;
    }
    if (statusText) {
        const labels = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' };
        statusText.textContent = labels[status] || 'Offline';
        statusText.className = 'full-status-text ' + status;
    }
    
    // Message button
    if (messageBtn) {
        messageBtn.onclick = () => {
            closeFullProfileModal();
            startChat(user.id);
        };
    }
    
    // Friend button
    if (friendBtn) {
        updateFullFriendButton(user, friendBtn);
    }
    
    // Mute button
    if (muteBtn) {
        const isMuted = isUserMuted(user.id);
        updateMuteButton(muteBtn, isMuted);
        muteBtn.onclick = () => toggleMuteUser(user, muteBtn);
    }
    
    // Block button
    if (blockBtn) {
        const isBlocked = isUserBlocked(user.id);
        updateBlockButton(blockBtn, isBlocked);
        blockBtn.onclick = () => toggleBlockUser(user, blockBtn);
    }
}

function updateFullFriendButton(user, button) {
    const currentUser = getCurrentUser();
    if (!currentUser || !button) return;
    
    const isFriend = AppState.friends?.some(f => f.id === user.id);
    const hasPendingRequest = AppState.friendRequests?.some(r => 
        (r.from === currentUser.id && r.to === user.id) || 
        (r.from === user.id && r.to === currentUser.id)
    );
    
    if (isFriend) {
        button.innerHTML = '<i class="fas fa-user-check"></i><span>Friends</span>';
        button.className = 'full-action-btn friends';
        button.onclick = null;
    } else if (hasPendingRequest) {
        button.innerHTML = '<i class="fas fa-clock"></i><span>Pending</span>';
        button.className = 'full-action-btn pending';
        button.onclick = null;
    } else {
        button.innerHTML = '<i class="fas fa-user-plus"></i><span>Add Friend</span>';
        button.className = 'full-action-btn success';
        button.onclick = async () => {
            await sendFriendRequestFromPanel(user);
            updateFullFriendButton(user, button);
        };
    }
}

function closeFullProfileModal() {
    const modal = document.getElementById('full-profile-modal');
    if (modal) modal.classList.add('hidden');
}

function closeProfilePanel() {
    const panel = document.getElementById('profile-panel');
    if (panel) panel.classList.add('hidden');
    AppState.isProfilePanelOpen = false;
}

function startChatFromProfile() {
    const panel = document.getElementById('profile-panel');
    const userId = panel?.dataset.userId;
    if (!userId) return;

    closeProfilePanel();
    switchView('chats');
    startChat(userId);
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
// INBOX TABS
// ========================================

function initInboxTabs() {
    const tabs = document.querySelectorAll('.inbox-tab');
    const contents = document.querySelectorAll('.inbox-tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            
            // Update tab states
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update content visibility
            contents.forEach(c => c.classList.remove('active'));
            document.getElementById(`inbox-${targetTab}`)?.classList.add('active');
        });
    });
}

function updateRequestsBadge() {
    const badge = document.getElementById('requests-badge');
    const count = AppState.friendRequests?.length || 0;
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }
}

// ========================================
// INBOX FUNCTIONS
// ========================================

// Inbox message data
// Get personalized inbox messages
function getInboxMessages() {
    const currentUser = getCurrentUser();
    const userName = currentUser?.fullName?.split(' ')[0] || currentUser?.username || 'there';
    const waveId = currentUser?.username ? formatWaveId(currentUser.username) : '~user';
    
    return {
        welcome: {
            sender: 'Bump Team',
            verified: true,
            avatar: 'bump',
            time: 'Today',
            subject: `Welcome to Bump, ${userName}! 🎉`,
            preview: "Your journey starts now. Here's everything you need to know...",
            messages: [
                {
                    content: `
                        <p>Hey <strong>${userName}</strong>! 👋</p>
                        <p>Welcome to <strong>Bump</strong> - the next evolution of messaging.</p>
                        <p>Your Wave ID is: <code style="background: var(--primary-bg); color: var(--primary); padding: 4px 8px; border-radius: 4px; font-family: 'Orbitron', monospace;">${waveId}</code></p>
                    `,
                    time: 'Today at 12:00 PM'
                },
                {
                    content: `
                        <p><strong>Getting started is easy:</strong></p>
                        <ul>
                            <li>🔍 <strong>Find Friends</strong> - Search by username or Wave ID</li>
                            <li>➕ <strong>Connect</strong> - Send friend requests to start chatting</li>
                            <li>💬 <strong>Chat</strong> - Share photos, videos, voice notes & more</li>
                            <li>🎨 <strong>Customize</strong> - Make your profile uniquely yours</li>
                            <li>⚡ <strong>Settings</strong> - Choose themes, colors, and bubble styles</li>
                        </ul>
                    `,
                    time: 'Today at 12:00 PM'
                },
                {
                    content: `
                        <div class="highlight">
                            💡 <strong>Pro tip:</strong> Check out the new Appearance settings to customize your theme colors and chat style!
                        </div>
                        <p>Have fun connecting, ${userName}! 🚀</p>
                        <p style="color: var(--text-muted); font-size: 12px; margin-top: 16px;">— The Bump Team 💜</p>
                    `,
                    time: 'Today at 12:01 PM'
                }
            ]
        },
        update: {
            sender: 'Bump Updates',
            verified: true,
            avatar: 'bump',
            time: 'Dec 22, 2025',
            subject: 'New Features Just Dropped! ✨',
            preview: 'Check out what\'s new in Bump v1.0...',
            messages: [
                {
                    content: `
                        <p>Hey ${userName}! 🎊</p>
                        <p><strong>Bump Version 1.0 is here!</strong></p>
                        <p>We've been working hard to bring you the best messaging experience.</p>
                    `,
                    time: 'Dec 22, 2025 at 10:00 AM'
                },
                {
                    content: `
                        <p><strong>What's new in v1.0:</strong></p>
                        <ul>
                            <li>✅ <strong>Friend System</strong> - Add and manage your connections</li>
                            <li>📬 <strong>Inbox</strong> - All your notifications in one place</li>
                            <li>🎨 <strong>Themes & Colors</strong> - Dark, Midnight, AMOLED + accent colors</li>
                            <li>👤 <strong>User Profiles</strong> - View and interact with other users</li>
                            <li>🗑️ <strong>Delete Account</strong> - Full control over your data</li>
                            <li>🔗 <strong>Rich Link Previews</strong> - YouTube, websites & more</li>
                            <li>📷 <strong>Media Sharing</strong> - Photos, videos, and files</li>
                            <li>🎤 <strong>Voice Notes</strong> - Record and send audio messages</li>
                        </ul>
                    `,
                    time: 'Dec 22, 2025 at 10:00 AM'
                },
                {
                    content: `
                        <p>Thank you for being part of the Bump community! Your feedback helps us improve every day.</p>
                        <div class="highlight">
                            🐛 Found a bug? Use the <strong>Report Bug</strong> button in the Inbox footer!
                        </div>
                        <p style="color: var(--text-muted); font-size: 12px; margin-top: 16px;">— The Bump Team 💜</p>
                    `,
                    time: 'Dec 22, 2025 at 10:01 AM'
                }
            ]
        },
        tips: {
            sender: 'Bump Tips',
            verified: true,
            avatar: 'bump',
            time: 'Yesterday',
            subject: `${userName}, unlock the full Bump experience 🔓`,
            preview: 'Quick tips to get the most out of Bump...',
            messages: [
                {
                    content: `
                        <p>Hey ${userName}! 💡</p>
                        <p>Here are some tips to help you get the most out of Bump:</p>
                    `,
                    time: 'Yesterday at 3:00 PM'
                },
                {
                    content: `
                        <p><strong>Power User Tips:</strong></p>
                        <ul>
                            <li>🎨 Try the <strong>AMOLED</strong> theme for the deepest blacks</li>
                            <li>🎵 Customize notification sounds in Settings</li>
                            <li>📸 Tap the camera icon to take photos directly</li>
                            <li>🎤 Hold the mic button to record voice notes</li>
                            <li>👆 Long-press messages to delete them</li>
                            <li>🔔 Mute notifications for specific chats</li>
                        </ul>
                    `,
                    time: 'Yesterday at 3:00 PM'
                },
                {
                    content: `
                        <div class="highlight">
                            ⚡ <strong>Quick tip:</strong> Your Wave ID (${waveId}) is your unique identifier. Share it with friends to connect instantly!
                        </div>
                        <p>Happy chatting! 💜</p>
                    `,
                    time: 'Yesterday at 3:01 PM'
                }
            ]
        }
    };
}

// Open inbox viewer with thread-style messages
function openInboxViewer(messageId) {
    const viewer = document.getElementById('inbox-viewer');
    const content = document.getElementById('inbox-viewer-content');
    const senderEl = document.getElementById('inbox-viewer-sender');
    const badgeEl = document.getElementById('inbox-viewer-badge');
    
    const inboxMessages = getInboxMessages();
    const message = inboxMessages[messageId];
    if (!message) return;
    
    // Update header
    senderEl.textContent = message.sender;
    if (message.verified) {
        badgeEl.innerHTML = '<i class="fas fa-check-circle"></i> Verified';
        badgeEl.style.display = 'flex';
    } else {
        badgeEl.style.display = 'none';
    }
    
    // Build thread content
    let html = '';
    message.messages.forEach((msg, index) => {
        const isFirst = index === 0;
        html += `
            <div class="thread-message">
                ${isFirst ? `
                    <div class="thread-avatar">
                        <div class="thread-avatar-img ${message.avatar === 'system' ? 'system' : ''}">
                            ${message.avatar === 'bump' ? '<span>B</span>' : '<i class="fas fa-bell"></i>'}
                        </div>
                    </div>
                ` : '<div class="thread-avatar" style="width: 44px;"></div>'}
                <div class="thread-body">
                    ${isFirst ? `
                        <div class="thread-header">
                            <span class="thread-sender">${message.sender}</span>
                            ${message.verified ? '<i class="fas fa-check-circle thread-verified"></i>' : ''}
                            <span class="thread-time">${msg.time}</span>
                        </div>
                    ` : ''}
                    <div class="thread-content">${msg.content}</div>
                </div>
            </div>
        `;
    });
    
    // Add reactions
    html += `
        <div class="thread-reactions">
            <button class="thread-reaction" onclick="this.classList.toggle('active')">👍 <span>1</span></button>
            <button class="thread-reaction" onclick="this.classList.toggle('active')">❤️ <span>2</span></button>
            <button class="thread-reaction" onclick="this.classList.toggle('active')">🎉 <span>3</span></button>
        </div>
    `;
    
    content.innerHTML = html;
    viewer.classList.remove('hidden');
    
    // Mark as read
    document.querySelectorAll('.inbox-item').forEach(item => {
        if (item.onclick && item.onclick.toString().includes(messageId)) {
            item.classList.remove('unread');
        }
    });
}

// Close inbox viewer
function closeInboxViewer() {
    const viewer = document.getElementById('inbox-viewer');
    viewer.classList.add('hidden');
}

// Toggle inbox item expansion (legacy - for backwards compatibility)
function toggleInboxItem(element) {
    const isExpanded = element.classList.contains('expanded');
    
    // Close all other expanded items
    document.querySelectorAll('.inbox-item-wrap.expanded').forEach(item => {
        if (item !== element) {
            item.classList.remove('expanded');
        }
    });
    
    // Toggle current item
    element.classList.toggle('expanded');
    
    // Mark as read
    const inboxItem = element.querySelector('.inbox-item');
    if (inboxItem) {
        inboxItem.classList.remove('unread');
    }
}

// ========================================
// BUG REPORT MODAL
// ========================================

function showBugReportModal() {
    const modal = document.getElementById('bug-report-modal');
    if (modal) {
        modal.classList.remove('hidden');
        // Clear form
        document.getElementById('bug-description')?.value && (document.getElementById('bug-description').value = '');
        document.getElementById('bug-steps')?.value && (document.getElementById('bug-steps').value = '');
    }
}

function hideBugReportModal() {
    const modal = document.getElementById('bug-report-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function handleBugReport(e) {
    e.preventDefault();
    
    const description = document.getElementById('bug-description')?.value;
    const steps = document.getElementById('bug-steps')?.value;
    const severity = document.getElementById('bug-severity')?.value;
    
    if (!description) {
        showToast('Please describe the bug', 'error');
        return;
    }
    
    // In a real app, this would send to a server
    // For now, we'll just show a success message
    const currentUser = getCurrentUser();
    const report = {
        user: currentUser?.username || 'Anonymous',
        description,
        steps,
        severity,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
    };
    
    console.log('Bug Report Submitted:', report);
    
    hideBugReportModal();
    showToast('Bug report submitted! Thank you for your feedback 💜', 'success');
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

    // Gender selection during signup
    document.querySelectorAll('.gender-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            AppState.selectedGender = btn.dataset.gender;
            document.getElementById('selected-gender').value = btn.dataset.gender;
            renderAvatarsForGender(btn.dataset.gender);
        });
    });
    
    // Update avatar previews when username changes
    document.getElementById('signup-username')?.addEventListener('input', () => {
        renderAvatarsForGender(AppState.selectedGender);
    });
    
    // Initialize avatars for default gender
    renderAvatarsForGender('male');

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
    DOM.messageInput?.addEventListener('input', (e) => {
        handleTyping();
        // Toggle voice/send button based on input (WhatsApp style)
        toggleVoiceSendButton();
    });
    
    // Initialize voice/send button state
    toggleVoiceSendButton();

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
    
    // User Profile Modal
    setupUserProfileModalListeners();
    
    // File & Media handlers
    setupMediaHandlers();
    
    // Inbox tabs
    initInboxTabs();
    
    // Bug report form
    document.getElementById('bug-report-form')?.addEventListener('submit', handleBugReport);
    document.getElementById('bug-report-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'bug-report-modal') hideBugReportModal();
    });

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
        
        // Update mobile view classes on resize
        document.body.classList.remove('mobile-view-settings', 'mobile-view-profile');
        if (window.innerWidth <= 768) {
            if (AppState.currentView === 'settings') {
                document.body.classList.add('mobile-view-settings');
            } else if (AppState.currentView === 'profile') {
                document.body.classList.add('mobile-view-profile');
            }
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
        
        // Set the mobile header wave ID
        const mobileWaveId = document.getElementById('current-user-wave');
        if (mobileWaveId) {
            mobileWaveId.textContent = formatWaveId(currentUser.username);
        }

        switchView('chats');
        await loadConversations();
        await loadFriendRequests();
        await loadFriends();
        updateProfileView();
        loadSettings();
        updatePersonalizedInbox();
    } else {
        DOM.authContainer.classList.remove('hidden');
        DOM.appContainer.classList.add('hidden');
    }
}

// Update inbox with personalized content
function updatePersonalizedInbox() {
    const inboxMessages = getInboxMessages();
    
    // Update welcome subject
    const welcomeSubject = document.getElementById('welcome-subject');
    if (welcomeSubject && inboxMessages.welcome) {
        welcomeSubject.textContent = inboxMessages.welcome.subject;
    }
    
    // Update tips subject
    const tipsSubject = document.getElementById('tips-subject');
    if (tipsSubject && inboxMessages.tips) {
        tipsSubject.textContent = inboxMessages.tips.subject;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    initDOM();
    initSocket();
    await NotificationManager.init();
    setupEventListeners();
    initApp();
    initMainViewTabs();
    
    // Pre-load microphone permissions for voice notes
    preloadMicrophonePermission();
});

// Pre-request microphone permission for faster voice note recording
async function preloadMicrophonePermission() {
    try {
        // Check if permission already granted
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
        if (permissionStatus.state === 'prompt') {
            // Create a test stream to trigger permission prompt
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop immediately, we just wanted the permission
            stream.getTracks().forEach(track => track.stop());
            console.log('Microphone permission pre-loaded');
        }
    } catch (error) {
        // Silent fail - permission will be requested when user actually records
        console.log('Microphone pre-load skipped:', error.message);
    }
}

// ==========================================
// DISCORD-STYLE SETTINGS FUNCTIONS
// ==========================================

function openDiscordSettings() {
    const settingsPage = document.getElementById('discord-settings-page');
    const settingsSidebar = document.getElementById('settings-sidebar');
    const settingsSidebarHeader = document.getElementById('settings-sidebar-header');
    const settingsOpenPrompt = document.getElementById('settings-open-prompt');
    
    if (settingsPage) {
        settingsPage.classList.remove('hidden');
        
        // Hide the normal sidebar elements
        if (settingsSidebarHeader) settingsSidebarHeader.style.display = 'none';
        if (settingsOpenPrompt) settingsOpenPrompt.style.display = 'none';
        
        // Populate user info
        const currentUser = getCurrentUser();
        if (currentUser) {
            const avatar = document.getElementById('settings-user-avatar');
            const name = document.getElementById('settings-user-name');
            const accountAvatar = document.getElementById('account-avatar');
            const accountName = document.getElementById('account-name');
            const accountWaveId = document.getElementById('account-wave-id');
            const accountUsername = document.getElementById('account-username-display');
            const accountEmail = document.getElementById('account-email-display');
            
            const avatarUrl = currentUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${currentUser.username}`;
            
            if (avatar) avatar.src = avatarUrl;
            if (name) name.textContent = currentUser.displayName || currentUser.username;
            if (accountAvatar) accountAvatar.src = avatarUrl;
            if (accountName) accountName.textContent = currentUser.displayName || currentUser.username;
            if (accountWaveId) accountWaveId.textContent = formatWaveId(currentUser.username);
            if (accountUsername) accountUsername.textContent = currentUser.username;
            if (accountEmail) accountEmail.textContent = currentUser.email || 'Not set';
        }
    }
    
    // Listen for ESC key
    document.addEventListener('keydown', handleSettingsEscape);
}

function closeDiscordSettings() {
    const settingsPage = document.getElementById('discord-settings-page');
    const settingsSidebarHeader = document.getElementById('settings-sidebar-header');
    const settingsOpenPrompt = document.getElementById('settings-open-prompt');
    
    if (settingsPage) {
        settingsPage.classList.add('hidden');
    }
    
    // Show normal sidebar elements again
    if (settingsSidebarHeader) settingsSidebarHeader.style.display = '';
    if (settingsOpenPrompt) settingsOpenPrompt.style.display = '';
    
    document.removeEventListener('keydown', handleSettingsEscape);
}

function handleSettingsEscape(e) {
    if (e.key === 'Escape') {
        closeDiscordSettings();
    }
}

// Initialize Discord settings event listeners
function initDiscordSettings() {
    // Settings nav items
    const navItems = document.querySelectorAll('.settings-nav-item[data-settings-tab]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.settingsTab;
            switchSettingsTab(tab);
            
            // Update active state
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
    
    // Theme options
    const themeOptions = document.querySelectorAll('.theme-option');
    themeOptions.forEach(option => {
        option.addEventListener('click', () => {
            const theme = option.dataset.theme;
            applyTheme(theme);
            
            // Update active state
            themeOptions.forEach(o => {
                o.classList.remove('active');
                o.querySelector('.theme-swatch').textContent = '';
            });
            option.classList.add('active');
            option.querySelector('.theme-swatch').textContent = '✓';
            
            // Save preference
            localStorage.setItem('bump-theme', theme);
        });
    });
    
    // Accent colors
    const accentColors = document.querySelectorAll('.accent-color');
    accentColors.forEach(color => {
        color.addEventListener('click', () => {
            const accent = color.dataset.accent;
            applyAccentColor(accent);
            
            // Update active state
            accentColors.forEach(c => c.classList.remove('active'));
            color.classList.add('active');
            
            // Save preference
            localStorage.setItem('bump-accent', accent);
        });
    });
    
    // Logout button
    const logoutBtn = document.getElementById('settings-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Delete account button
    const deleteBtn = document.getElementById('settings-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            closeDiscordSettings();
            document.getElementById('delete-account-modal').classList.remove('hidden');
        });
    }
    
    // About me character counter
    const aboutTextarea = document.getElementById('profile-about');
    const charCount = document.getElementById('about-char-count');
    if (aboutTextarea && charCount) {
        aboutTextarea.addEventListener('input', () => {
            charCount.textContent = aboutTextarea.value.length;
        });
    }
}

function switchSettingsTab(tabName) {
    // Hide all tabs
    const allTabs = document.querySelectorAll('.settings-tab');
    allTabs.forEach(tab => tab.classList.remove('active'));
    
    // Show selected tab
    const selectedTab = document.getElementById(`settings-tab-${tabName}`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
}

function applyTheme(theme) {
    const root = document.documentElement;
    
    switch (theme) {
        case 'light':
            root.style.setProperty('--bg-primary', '#ffffff');
            root.style.setProperty('--bg-secondary', '#f2f3f5');
            root.style.setProperty('--bg-tertiary', '#e3e5e8');
            root.style.setProperty('--text-primary', '#060607');
            root.style.setProperty('--text-secondary', '#4f5660');
            root.style.setProperty('--border-color', '#e3e5e8');
            break;
        case 'dark':
            root.style.setProperty('--bg-primary', '#1a1a2e');
            root.style.setProperty('--bg-secondary', '#16162a');
            root.style.setProperty('--bg-tertiary', '#0f0f1a');
            root.style.setProperty('--text-primary', '#ffffff');
            root.style.setProperty('--text-secondary', 'rgba(255, 255, 255, 0.6)');
            root.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.1)');
            break;
        case 'midnight':
            root.style.setProperty('--bg-primary', '#0d1117');
            root.style.setProperty('--bg-secondary', '#161b22');
            root.style.setProperty('--bg-tertiary', '#21262d');
            root.style.setProperty('--text-primary', '#c9d1d9');
            root.style.setProperty('--text-secondary', '#8b949e');
            root.style.setProperty('--border-color', '#30363d');
            break;
        case 'amoled':
            root.style.setProperty('--bg-primary', '#000000');
            root.style.setProperty('--bg-secondary', '#0a0a0a');
            root.style.setProperty('--bg-tertiary', '#111111');
            root.style.setProperty('--text-primary', '#ffffff');
            root.style.setProperty('--text-secondary', '#888888');
            root.style.setProperty('--border-color', '#222222');
            break;
        case 'sync':
            // Match system preference
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                applyTheme('dark');
            } else {
                applyTheme('light');
            }
            break;
    }
}

function applyAccentColor(color) {
    document.documentElement.style.setProperty('--accent-color', color);
    
    // Also update neon purple for consistency
    document.documentElement.style.setProperty('--neon-purple', color);
}

// Load saved theme and accent on startup
function loadSavedAppearance() {
    const savedTheme = localStorage.getItem('bump-theme');
    const savedAccent = localStorage.getItem('bump-accent');
    
    if (savedTheme) {
        applyTheme(savedTheme);
        
        // Update UI to reflect saved theme
        const themeOption = document.querySelector(`.theme-option[data-theme="${savedTheme}"]`);
        if (themeOption) {
            document.querySelectorAll('.theme-option').forEach(o => {
                o.classList.remove('active');
                o.querySelector('.theme-swatch').textContent = '';
            });
            themeOption.classList.add('active');
            themeOption.querySelector('.theme-swatch').textContent = '✓';
        }
    }
    
    if (savedAccent) {
        applyAccentColor(savedAccent);
        
        // Update UI to reflect saved accent
        const accentBtn = document.querySelector(`.accent-color[data-accent="${savedAccent}"]`);
        if (accentBtn) {
            document.querySelectorAll('.accent-color').forEach(c => c.classList.remove('active'));
            accentBtn.classList.add('active');
        }
    }
}

// ==========================================
// DISCORD-STYLE USER PROFILE MODAL
// ==========================================

function openDiscordUserProfileModal(userId, userData = null) {
    const modal = document.getElementById('user-profile-modal');
    if (!modal) return;
    
    // Find the user - use passed data or find in allUsers
    const user = userData || allUsers.find(u => u.id === userId);
    if (!user) {
        console.error('User not found for profile modal:', userId);
        return;
    }
    
    // Store for action buttons
    currentViewedUser = user;
    
    // Populate modal
    const avatarImg = document.getElementById('user-profile-avatar-img');
    const nameEl = document.getElementById('user-profile-name');
    const usernameEl = document.getElementById('user-profile-username');
    const discriminatorEl = document.getElementById('user-profile-discriminator');
    const bioEl = document.getElementById('user-profile-bio');
    const statusDot = document.getElementById('user-profile-status-dot');
    const statusText = document.getElementById('user-profile-status-text');
    const joinedEl = document.getElementById('user-profile-joined');
    
    const avatarUrl = user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;
    
    if (avatarImg) avatarImg.src = avatarUrl;
    if (nameEl) nameEl.textContent = user.fullName || user.displayName || user.username;
    if (usernameEl) usernameEl.textContent = user.username;
    if (discriminatorEl) discriminatorEl.textContent = generateDiscriminator(user.username);
    if (bioEl) bioEl.textContent = user.bio || 'No bio yet';
    
    // Status
    const isOnline = user.online || isUserOnline(userId);
    if (statusDot) {
        statusDot.className = 'discord-status-dot';
        if (isOnline) {
            statusDot.classList.add('online');
            if (statusText) statusText.textContent = 'Online';
        } else {
            statusDot.classList.add('offline');
            if (statusText) statusText.textContent = 'Offline';
        }
    }
    
    // Joined date
    if (joinedEl && user.createdAt) {
        const date = new Date(user.createdAt);
        joinedEl.innerHTML = `<i class="fas fa-calendar"></i><span>${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>`;
    }
    
    // Store user id for actions
    modal.dataset.userId = userId;
    
    // Check friend status and update button
    updateDiscordFriendButtonState(userId);
    
    // Load mutual friends
    loadMutualFriends(userId);
    
    modal.classList.remove('hidden');
}

function generateDiscriminator(username) {
    // Generate a consistent 2-digit discriminator from username
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = ((hash << 5) - hash) + username.charCodeAt(i);
        hash = hash & hash;
    }
    return String(Math.abs(hash) % 100).padStart(2, '0');
}

function updateDiscordFriendButtonState(userId) {
    const addFriendBtn = document.getElementById('add-friend-btn');
    if (!addFriendBtn) return;
    
    const currentUser = getCurrentUser();
    
    // Check if already friends
    if (AppState.friends && AppState.friends.some(f => f.id === userId)) {
        addFriendBtn.innerHTML = '<i class="fas fa-user-check"></i>';
        addFriendBtn.title = 'Friends';
        addFriendBtn.classList.remove('success');
        addFriendBtn.classList.add('secondary');
        addFriendBtn.disabled = true;
    } 
    // Check if request pending
    else if (AppState.friendRequests && AppState.friendRequests.some(r => r.toId === userId || r.fromId === userId)) {
        addFriendBtn.innerHTML = '<i class="fas fa-clock"></i>';
        addFriendBtn.title = 'Request Pending';
        addFriendBtn.classList.remove('success');
        addFriendBtn.classList.add('secondary');
        addFriendBtn.disabled = true;
    }
    // Can add friend
    else {
        addFriendBtn.innerHTML = '<i class="fas fa-user-plus"></i>';
        addFriendBtn.title = 'Add Friend';
        addFriendBtn.classList.remove('secondary');
        addFriendBtn.classList.add('success');
        addFriendBtn.disabled = false;
    }
}

function loadMutualFriends(userId) {
    const mutualList = document.getElementById('mutual-friends-list');
    if (!mutualList) return;
    
    // For now, just show placeholder
    // In a full implementation, you'd compare friend lists
    mutualList.innerHTML = '<p class="discord-empty-state">No mutual friends</p>';
}

// Initialize profile modal tabs
function initProfileModalTabs() {
    const tabs = document.querySelectorAll('.discord-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update tab active state
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update content
            document.querySelectorAll('.discord-profile-tab-content').forEach(c => c.classList.remove('active'));
            const content = document.getElementById(`tab-${tabName}`);
            if (content) content.classList.add('active');
        });
    });
    
    // Close button
    const closeBtn = document.getElementById('close-user-profile-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('user-profile-modal').classList.add('hidden');
        });
    }
    
    // Send message button
    const sendMsgBtn = document.getElementById('send-message-btn');
    if (sendMsgBtn) {
        sendMsgBtn.addEventListener('click', () => {
            const modal = document.getElementById('user-profile-modal');
            const userId = modal.dataset.userId;
            if (userId) {
                modal.classList.add('hidden');
                startConversation(userId);
            }
        });
    }
    
    // Add friend button
    const addFriendBtn = document.getElementById('add-friend-btn');
    if (addFriendBtn) {
        addFriendBtn.addEventListener('click', () => {
            const modal = document.getElementById('user-profile-modal');
            const userId = modal.dataset.userId;
            if (userId) {
                sendFriendRequestById(userId);
            }
        });
    }
}

// Send friend request by user ID
async function sendFriendRequestById(userId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/friend-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromId: currentUser.id,
                toId: userId
            })
        });
        
        if (response.ok) {
            showToast('Friend request sent!', 'success');
            updateFriendButtonState(userId);
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to send request', 'error');
        }
    } catch (error) {
        console.error('Error sending friend request:', error);
        showToast('Failed to send friend request', 'error');
    }
}

// Track sent friend requests
let sentFriendRequests = [];

// Load sent friend requests
async function loadSentFriendRequests() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    
    try {
        const response = await fetch(`/api/friends/sent/${currentUser.id}`);
        if (response.ok) {
            sentFriendRequests = await response.json();
        }
    } catch (error) {
        console.error('Error loading sent requests:', error);
    }
}

// Initialize everything on DOM ready
const originalDOMContentLoaded = document.addEventListener;
document.addEventListener('DOMContentLoaded', () => {
    initDiscordSettings();
    initProfileModalTabs();
    loadSavedAppearance();
    loadSentFriendRequests();
});
