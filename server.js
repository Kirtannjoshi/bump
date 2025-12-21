/**
 * BUMP - Real-time Chat Server
 * Node.js + Express + Socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all network interfaces

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|pdf|doc|docx|txt|zip/;
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        const mimetype = allowedTypes.test(file.mimetype.split('/')[1]) || allowedTypes.test(ext);
        if (mimetype) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

// Serve static files
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json({ limit: '50mb' }));

// ========================================
// DATA STORAGE (File-based for persistence)
// ========================================

const DATA_FILE = path.join(__dirname, 'data', 'database.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'));
}

// Initialize or load database
function loadDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading database:', error);
    }
    return { users: [], messages: {}, conversations: {} };
}

function saveDatabase(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving database:', error);
    }
}

let db = loadDatabase();

// In-memory tracking
const onlineUsers = new Map(); // socketId -> { userId, username }
const userSockets = new Map(); // userId -> socketId

// ========================================
// HELPER FUNCTIONS
// ========================================

function generateAvatar(seed, style = 'avataaars') {
    return `https://api.dicebear.com/7.x/${style}/svg?seed=${seed}`;
}

function sanitizeUser(user) {
    const { password, ...safeUser } = user;
    return safeUser;
}

function getConversationId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

function broadcastOnlineUsers() {
    const onlineList = Array.from(onlineUsers.values());
    io.emit('online_users', onlineList);
}

// ========================================
// REST API ENDPOINTS
// ========================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register new user
app.post('/api/register', async (req, res) => {
    try {
        const { username, fullName, email, password, avatarStyle } = req.body;

        // Validation
        if (!username || !fullName || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if username exists
        const existingUser = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
        }

        // Check if email exists
        const existingEmail = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (existingEmail) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user with selected avatar style
        const style = avatarStyle || 'avataaars';
        const newUser = {
            id: uuidv4(),
            username: username.toLowerCase(),
            fullName,
            email: email.toLowerCase(),
            password: hashedPassword,
            bio: 'Hey there! I am using Bump.',
            status: 'offline',
            avatar: generateAvatar(username, style),
            avatarStyle: style,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };

        db.users.push(newUser);
        saveDatabase(db);

        res.status(201).json({ 
            success: true, 
            user: sanitizeUser(newUser) 
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('Login attempt for:', username);

        if (!username || !password) {
            console.log('Missing username or password');
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Reload database to get latest data
        db = loadDatabase();

        // Allow login with username OR email
        const user = db.users.find(u => 
            u.username.toLowerCase() === username.toLowerCase() || 
            u.email.toLowerCase() === username.toLowerCase()
        );
        if (!user) {
            console.log('User not found:', username);
            return res.status(401).json({ error: 'User not found' });
        }

        console.log('User found:', user.username, 'checking password...');

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            console.log('Invalid password for user:', username);
            return res.status(401).json({ error: 'Invalid password' });
        }

        console.log('Login successful for:', username);

        // Update last seen
        user.lastSeen = new Date().toISOString();
        saveDatabase(db);

        res.json({ 
            success: true, 
            user: sanitizeUser(user) 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all users (for search)
app.get('/api/users', (req, res) => {
    const users = db.users.map(sanitizeUser);
    res.json(users);
});

// Get user by ID
app.get('/api/users/:id', (req, res) => {
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json(sanitizeUser(user));
});

// Update user profile
app.put('/api/users/:id', (req, res) => {
    const userIndex = db.users.findIndex(u => u.id === req.params.id);
    if (userIndex === -1) {
        return res.status(404).json({ error: 'User not found' });
    }

    const { fullName, email, bio, status, avatar } = req.body;
    
    if (fullName) db.users[userIndex].fullName = fullName;
    if (email) db.users[userIndex].email = email;
    if (bio !== undefined) db.users[userIndex].bio = bio;
    if (status) db.users[userIndex].status = status;
    if (avatar) db.users[userIndex].avatar = avatar;

    saveDatabase(db);
    res.json(sanitizeUser(db.users[userIndex]));
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { senderId, receiverId } = req.body;
        const fileUrl = `/uploads/${req.file.filename}`;
        const fileType = getFileType(req.file.mimetype);
        
        // If senderId and receiverId provided, create a message
        if (senderId && receiverId) {
            const convId = getConversationId(senderId, receiverId);
            
            const message = {
                id: uuidv4(),
                conversationId: convId,
                senderId,
                receiverId,
                text: '',
                fileUrl,
                fileName: req.file.originalname,
                fileSize: req.file.size,
                fileType,
                timestamp: new Date().toISOString(),
                read: false,
                delivered: false
            };
            
            // Save to database
            if (!db.messages[convId]) {
                db.messages[convId] = [];
            }
            db.messages[convId].push(message);
            saveDatabase(db);
            
            // Get sender info
            const sender = db.users.find(u => u.id === senderId);
            
            // Send to receiver if online
            const receiverSocketId = userSockets.get(receiverId);
            if (receiverSocketId) {
                message.delivered = true;
                io.to(receiverSocketId).emit('receive_message', {
                    ...message,
                    sender: sender ? sanitizeUser(sender) : null
                });
            }
            
            // Send to sender's socket as well
            const senderSocketId = userSockets.get(senderId);
            if (senderSocketId) {
                io.to(senderSocketId).emit('message_sent', message);
                io.to(senderSocketId).emit('receive_message', {
                    ...message,
                    sender: sender ? sanitizeUser(sender) : null
                });
            }
            
            console.log(`Media message from ${senderId} to ${receiverId}: ${fileType}`);
            
            res.json({
                success: true,
                message,
                file: {
                    url: fileUrl,
                    name: req.file.originalname,
                    size: req.file.size,
                    type: fileType
                }
            });
        } else {
            res.json({
                success: true,
                file: {
                    url: fileUrl,
                    name: req.file.originalname,
                    size: req.file.size,
                    type: fileType,
                    mimetype: req.file.mimetype
                }
            });
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Helper function to determine file type
function getFileType(mimetype) {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'document';
}

// Delete message
app.delete('/api/messages/:messageId', (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId } = req.body;
        
        if (!messageId || !userId) {
            return res.status(400).json({ error: 'Message ID and User ID required' });
        }
        
        // Find and delete the message
        let deleted = false;
        Object.keys(db.messages).forEach(convId => {
            const msgIndex = db.messages[convId].findIndex(m => m.id === messageId);
            if (msgIndex !== -1) {
                const msg = db.messages[convId][msgIndex];
                // Only allow sender to delete their own message
                if (msg.senderId === userId) {
                    // If it's a file, delete the file too
                    if (msg.fileUrl) {
                        const filePath = path.join(__dirname, msg.fileUrl);
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    }
                    db.messages[convId].splice(msgIndex, 1);
                    deleted = true;
                    saveDatabase(db);
                }
            }
        });
        
        if (deleted) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Message not found or not authorized' });
        }
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ error: 'Could not delete message' });
    }
});

// Get conversations for a user
app.get('/api/conversations/:userId', (req, res) => {
    const userId = req.params.userId;
    const conversations = [];

    // Find all conversations involving this user
    Object.keys(db.messages).forEach(convId => {
        if (convId.includes(userId)) {
            const messages = db.messages[convId];
            if (messages.length > 0) {
                const otherUserId = convId.split('_').find(id => id !== userId);
                const otherUser = db.users.find(u => u.id === otherUserId);
                
                if (otherUser) {
                    const lastMessage = messages[messages.length - 1];
                    const unreadCount = messages.filter(m => 
                        m.senderId !== userId && !m.read
                    ).length;

                    conversations.push({
                        id: convId,
                        user: sanitizeUser(otherUser),
                        lastMessage,
                        unreadCount,
                        updatedAt: lastMessage.timestamp
                    });
                }
            }
        }
    });

    // Sort by most recent
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(conversations);
});

// Get messages for a conversation
app.get('/api/messages/:oderId/:receiverId', (req, res) => {
    const convId = getConversationId(req.params.userId, req.params.receiverId);
    const messages = db.messages[convId] || [];
    res.json(messages);
});

// ========================================
// SOCKET.IO REAL-TIME EVENTS
// ========================================

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // User comes online
    socket.on('user_online', (userData) => {
        const { userId, username, fullName, avatar } = userData;
        
        onlineUsers.set(socket.id, { userId, username, fullName, avatar });
        userSockets.set(userId, socket.id);

        // Update user status in database
        const user = db.users.find(u => u.id === userId);
        if (user) {
            user.status = 'online';
            user.lastSeen = new Date().toISOString();
            saveDatabase(db);
        }

        // Join personal room
        socket.join(userId);

        // Broadcast online status
        broadcastOnlineUsers();
        socket.broadcast.emit('user_status_changed', { userId, status: 'online' });

        console.log(`User online: ${username} (${userId})`);
    });

    // User goes offline
    socket.on('disconnect', () => {
        const userData = onlineUsers.get(socket.id);
        
        if (userData) {
            const { userId, username } = userData;
            
            // Update database
            const user = db.users.find(u => u.id === userId);
            if (user) {
                user.status = 'offline';
                user.lastSeen = new Date().toISOString();
                saveDatabase(db);
            }

            onlineUsers.delete(socket.id);
            userSockets.delete(userId);

            // Broadcast offline status
            broadcastOnlineUsers();
            socket.broadcast.emit('user_status_changed', { userId, status: 'offline' });

            console.log(`User offline: ${username}`);
        }
    });

    // Send message
    socket.on('send_message', (data) => {
        const { senderId, receiverId, text } = data;
        const convId = getConversationId(senderId, receiverId);

        const message = {
            id: uuidv4(),
            conversationId: convId,
            senderId,
            receiverId,
            text,
            timestamp: new Date().toISOString(),
            read: false,
            delivered: false
        };

        // Save to database
        if (!db.messages[convId]) {
            db.messages[convId] = [];
        }
        db.messages[convId].push(message);
        saveDatabase(db);

        // Get sender info
        const sender = db.users.find(u => u.id === senderId);

        // Send to receiver if online
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
            message.delivered = true;
            io.to(receiverSocketId).emit('receive_message', {
                ...message,
                sender: sender ? sanitizeUser(sender) : null
            });
        }

        // Confirm to sender
        socket.emit('message_sent', message);

        console.log(`Message from ${senderId} to ${receiverId}: ${text.substring(0, 30)}...`);
    });

    // Typing indicator
    socket.on('typing_start', ({ senderId, receiverId }) => {
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_typing', { userId: senderId });
        }
    });

    socket.on('typing_stop', ({ senderId, receiverId }) => {
        const receiverSocketId = userSockets.get(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_stopped_typing', { userId: senderId });
        }
    });

    // Mark messages as read
    socket.on('mark_read', ({ userId, otherUserId }) => {
        const convId = getConversationId(userId, otherUserId);
        const messages = db.messages[convId];

        if (messages) {
            let updated = false;
            messages.forEach(msg => {
                if (msg.receiverId === userId && !msg.read) {
                    msg.read = true;
                    updated = true;
                }
            });

            if (updated) {
                saveDatabase(db);
                
                // Notify the other user
                const otherSocketId = userSockets.get(otherUserId);
                if (otherSocketId) {
                    io.to(otherSocketId).emit('messages_read', { 
                        userId, 
                        conversationId: convId 
                    });
                }
            }
        }
    });

    // Update user status manually
    socket.on('update_status', ({ userId, status }) => {
        const user = db.users.find(u => u.id === userId);
        if (user) {
            user.status = status;
            saveDatabase(db);
            io.emit('user_status_changed', { userId, status });
        }
    });

    // Get chat history
    socket.on('get_messages', ({ userId, otherUserId }, callback) => {
        const convId = getConversationId(userId, otherUserId);
        const messages = db.messages[convId] || [];
        callback(messages);
    });
});

// ========================================
// START SERVER
// ========================================

// Get local IP address
function getLocalIP() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

server.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║          ⚡ BUMP Chat Server Running ⚡              ║
║                                                      ║
║    Local:    http://localhost:${PORT}                   ║
║    Network:  http://${localIP}:${PORT}                 ║
║                                                      ║
║    Share the Network URL with others on your WiFi!   ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
    `);
});
