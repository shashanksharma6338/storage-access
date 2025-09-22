const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs").promises;
const path = require("path");
const XLSX = require("xlsx");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const pool = require("./db");
const {
    initializeAuth,
    authenticateUser,
    verifySecurityAnswer,
    changePassword,
    getUserPermissions,
    updatePermission,
    getAllPermissions,
} = require("./auth");

const app = express();
const port = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Session configuration optimized for high concurrency and shared logins
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 8 * 60 * 60 * 1000, // 8 hours for shared login scenarios
        sameSite: 'lax'
    },
    name: 'sid',
    genid: () => {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    },
    // Memory store optimization for high concurrency
    store: new (require('express-session').MemoryStore)({
        checkPeriod: 86400000, // Clean up expired sessions every 24 hours
        max: 1000, // Maximum number of sessions to store
        dispose: (key, sess) => {
            console.log('Session disposed:', key);
        }
    })
}));

app.use(bodyParser.json());
// Serve static files
app.use(express.static('public'));

// Serve permissions management page
app.get('/permissions', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'permissions.html'));
});

// Serve storage dashboard page
app.get('/storage', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'storage-dashboard.html'));
});

// Visitor counter storage (in production, you'd want to use a database)
let visitorCount = 0;
const VISITOR_COUNT_FILE = path.join(__dirname, 'visitor_count.txt');

// Function to load visitor count from file
async function loadVisitorCount() {
    try {
        const data = await fs.readFile(VISITOR_COUNT_FILE, 'utf8');
        visitorCount = parseInt(data, 10) || 0;
        console.log(`Loaded visitor count: ${visitorCount}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Visitor count file not found, starting from 0.');
            visitorCount = 0;
        } else {
            console.error('Error loading visitor count:', error);
            visitorCount = 0; // Default to 0 if file is corrupted or unreadable
        }
    }
}

// Function to save visitor count to file
async function saveVisitorCount() {
    try {
        await fs.writeFile(VISITOR_COUNT_FILE, visitorCount.toString(), 'utf8');
        console.log(`Saved visitor count: ${visitorCount}`);
    } catch (error) {
        console.error('Error saving visitor count:', error);
    }
}

// Load visitor count on startup
loadVisitorCount();

// Set interval to save visitor count periodically (e.g., every 2 minutes)
setInterval(saveVisitorCount, 2 * 60 * 1000);

// Visitor counter endpoints
app.get("/api/public/visitor-count", async (req, res) => {
    try {
        // Increment visitor count
        visitorCount++;
        res.json({ count: visitorCount });
    } catch (error) {
        console.error("Visitor count error:", error);
        res.status(500).json({ error: "Failed to get visitor count" });
    }
});

app.get("/api/public/visitor-count-display", async (req, res) => {
    try {
        // Just return current count without incrementing
        res.json({ count: visitorCount });
    } catch (error) {
        console.error("Visitor count display error:", error);
        res.status(500).json({ error: "Failed to get visitor count" });
    }
});

// Public endpoints for homepage analytics with caching
app.get("/api/public/supply-orders", async (req, res) => {
    const { year } = req.query;
    const cacheKey = `public-supply-${year}`;

    try {
        // Check cache first
        const cachedData = getHomepageCachedData(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        const [rows] = await pool.query(
            `SELECT id, serial_no, supply_order_no, DATE_FORMAT(so_date, '%Y-%m-%d') as so_date, 
                    firm_name, nomenclature, quantity, 
                    DATE_FORMAT(original_date, '%Y-%m-%d') as original_date, 
                    build_up, maint, misc, delivery_done, financial_year 
             FROM supply_orders WHERE financial_year = ? ORDER BY serial_no`,
            [year],
        );

        // Cache the result
        setHomepageCachedData(cacheKey, rows);

        console.log(`Public API: Found ${rows.length} supply orders for year ${year}`);
        res.json(rows);
    } catch (error) {
        console.error("Public supply orders fetch error:", error);
        res.status(500).json({ error: "Failed to fetch supply orders" });
    }
});

app.get("/api/public/demand-orders", async (req, res) => {
    const { year } = req.query;
    const cacheKey = `public-demand-${year}`;

    try {
        // Check cache first
        const cachedData = getHomepageCachedData(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        const [rows] = await pool.query(
            `SELECT id, serial_no, DATE_FORMAT(demand_date, '%Y-%m-%d') as demand_date,
                    imms_demand_no, nomenclature, quantity, est_cost, supply_order_placed, financial_year 
             FROM demand_orders WHERE financial_year = ? ORDER BY serial_no`,
            [year],
        );

        // Cache the result
        setHomepageCachedData(cacheKey, rows);

        console.log(`Public API: Found ${rows.length} demand orders for year ${year}`);
        res.json(rows);
    } catch (error) {
        console.error("Public demand orders fetch error:", error);
        res.status(500).json({ error: "Failed to fetch demand orders" });
    }
});

app.get("/api/public/bill-orders", async (req, res) => {
    const { year } = req.query;
    const cacheKey = `public-bill-${year}`;

    try {
        // Check cache first
        const cachedData = getHomepageCachedData(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        const [rows] = await pool.query(
            `SELECT id, serial_no, DATE_FORMAT(bill_control_date, '%Y-%m-%d') as bill_control_date,
                    supply_order_no, build_up, maintenance, project_less_2cr, project_more_2cr, financial_year 
             FROM bill_orders WHERE financial_year = ? ORDER BY serial_no`,
            [year],
        );

        // Cache the result
        setHomepageCachedData(cacheKey, rows);

        console.log(`Public API: Found ${rows.length} bill orders for year ${year}`);
        res.json(rows);
    } catch (error) {
        console.error("Public bill orders fetch error:", error);
        res.status(500).json({ error: "Failed to fetch bill orders" });
    }
});

// Add endpoint to get all financial years
app.get("/api/public/financial-years", async (req, res) => {
    try {
        const [supplyYears] = await pool.query(
            "SELECT DISTINCT financial_year FROM supply_orders WHERE financial_year IS NOT NULL ORDER BY financial_year DESC"
        );
        const [demandYears] = await pool.query(
            "SELECT DISTINCT financial_year FROM demand_orders WHERE financial_year IS NOT NULL ORDER BY financial_year DESC"
        );
        const [billYears] = await pool.query(
            "SELECT DISTINCT financial_year FROM bill_orders WHERE financial_year IS NOT NULL ORDER BY financial_year DESC"
        );

        // Combine and deduplicate years
        const allYears = new Set([
            ...supplyYears.map(r => r.financial_year),
            ...demandYears.map(r => r.financial_year),
            ...billYears.map(r => r.financial_year)
        ]);

        const sortedYears = Array.from(allYears).sort((a, b) => b.localeCompare(a));
        console.log('Available financial years:', sortedYears);
        res.json(sortedYears);
    } catch (error) {
        console.error("Financial years fetch error:", error);
        res.status(500).json({ error: "Failed to fetch financial years" });
    }
});

// Add endpoint to get all data for yearly trends
app.get("/api/public/supply-orders-all", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM supply_orders ORDER BY financial_year DESC, serial_no ASC"
        );
        res.json(rows);
    } catch (error) {
        console.error("All supply orders fetch error:", error);
        res.status(500).json({ error: "Failed to fetch all supply orders" });
    }
});

app.get("/api/public/demand-orders-all", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM demand_orders ORDER BY financial_year DESC, serial_no ASC"
        );
        res.json(rows);
    } catch (error) {
        console.error("All demand orders fetch error:", error);
        res.status(500).json({ error: "Failed to fetch all demand orders" });
    }
});

app.get("/api/public/bill-orders-all", async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM bill_orders ORDER BY financial_year DESC, serial_no ASC"
        );
        res.json(rows);
    } catch (error) {
        console.error("All bill orders fetch error:", error);
        res.status(500).json({ error: "Failed to fetch all bill orders" });
    }
});

app.use("/backups/supply", express.static("backups/supply"));
app.use("/backups/demand", express.static("backups/demand"));
app.use("/backups/bill", express.static("backups/bill"));
app.use(
    "/backups/sanction-gen-project",
    express.static("backups/sanction-gen-project"),
);
app.use("/backups/sanction-misc", express.static("backups/sanction-misc"));
app.use(
    "/backups/sanction-training",
    express.static("backups/sanction-training"),
);

// Initialize authentication system
initializeAuth();

// Create storage access tracking table
async function initializeStorageTracking() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS storage_access_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_identifier VARCHAR(255),
                ip_address VARCHAR(45),
                user_agent TEXT,
                access_granted BOOLEAN DEFAULT TRUE,
                access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                session_data JSON,
                browser_info JSON,
                INDEX idx_user_identifier (user_identifier),
                INDEX idx_access_timestamp (access_timestamp),
                INDEX idx_ip_address (ip_address)
            )
        `);

        // Add additional columns if they don't exist
        try {
            await pool.query("ALTER TABLE storage_access_log ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255)");
            await pool.query("ALTER TABLE storage_access_log ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
        } catch (error) {
            // Columns might already exist
        }
    } catch (error) {
        console.error("Error initializing storage tracking:", error);
    }
}

initializeStorageTracking();

// WebSocket authentication middleware
io.use((socket, next) => {
    const sessionId = socket.handshake.auth.sessionId;
    if (sessionId) {
        socket.sessionId = sessionId;
        next();
    } else {
        next(new Error("Authentication required"));
    }
});

// Connection tracking for monitoring - optimized for 150 homepage + 100 login users
let activeConnections = 0;
const maxConnections = 300; // Optimize for actual concurrent users
let homepageConnections = 0;
let authenticatedConnections = 0;

// WebSocket connection handling optimized for high concurrency
io.on("connection", (socket) => {
    activeConnections++;

    // Check connection type for better resource allocation
    const isHomepageUser = socket.handshake.headers.referer?.includes('homepage.html');
    if (isHomepageUser) {
        homepageConnections++;
    } else {
        authenticatedConnections++;
    }

    if (activeConnections > maxConnections) {
        socket.emit('server-overload', { 
            message: 'Server at capacity, please try again in a few moments',
            retryAfter: 30000 
        });
        socket.disconnect();
        activeConnections--;
        if (isHomepageUser) homepageConnections--;
        else authenticatedConnections--;
        return;
    }

    console.log(`Client connected: ${socket.id} (Active: ${activeConnections}, Homepage: ${homepageConnections}, Auth: ${authenticatedConnections})`);

    socket.on("join-room", (room) => {
        socket.join(room);
        console.log(`Client ${socket.id} joined room: ${room}`);
    });

    socket.on("leave-room", (room) => {
        socket.leave(room);
        console.log(`Client ${socket.id} left room: ${room}`);
    });

    socket.on("join-gaming", () => {
        socket.join('gaming-room');
        console.log(`Client ${socket.id} joined gaming room`);
    });

    socket.on("leave-gaming", () => {
        socket.leave('gaming-room');
        console.log(`Client ${socket.id} left gaming room`);
    });

    socket.on("ludo-move", (data) => {
        const { gameId, pieceIndex, diceRoll } = data;
        const game = ludoGames.get(gameId);

        if (game && game.status === 'playing') {
            // Process Ludo move
            const currentPlayer = game.players[game.currentPlayerIndex];
            const piece = currentPlayer.pieces[pieceIndex];

            if (piece.position === -1 && diceRoll === 6) {
                piece.position = 0;
            } else if (piece.position >= 0) {
                piece.position = Math.min(piece.position + diceRoll, 56);
                if (piece.position === 56) {
                    currentPlayer.piecesInGoal++;
                }
            }

            // Check for game end
            if (currentPlayer.piecesInGoal === 4) {
                game.status = 'finished';
                game.winner = currentPlayer.name;
            }

            // Move to next player if not a 6
            if (diceRoll !== 6) {
                game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
            }

            game.diceRolled = false;
            game.lastDiceRoll = null;

            io.to('gaming-room').emit('ludo-move-made', { gameId, game });
        }
    });

    socket.on("disconnect", () => {
        activeConnections--;
        const isHomepageUser = socket.handshake.headers.referer?.includes('homepage.html');
        if (isHomepageUser) {
            homepageConnections--;
        } else {
            authenticatedConnections--;
        }

        console.log(`Client disconnected: ${socket.id} (Active: ${activeConnections}, Homepage: ${homepageConnections}, Auth: ${authenticatedConnections})`);

        // Only clean up game references for authenticated users
        if (!isHomepageUser) {
            for (let [gameId, game] of chessGames.entries()) {
                if (game.players.includes(socket.sessionId)) {
                    game.status = 'abandoned';
                    setTimeout(() => chessGames.delete(gameId), 300000);
                }
            }

            for (let [gameId, game] of ludoGames.entries()) {
                const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
                if (playerIndex !== -1) {
                    game.status = 'abandoned';
                    setTimeout(() => ludoGames.delete(gameId), 300000);
                }
            }

            for (let [gameId, game] of ticTacToeGames.entries()) {
                if (game.players.some(p => p.socketId === socket.id)) {
                    game.status = 'abandoned';
                    setTimeout(() => ticTacToeGames.delete(gameId), 300000);
                }
            }

            for (let [gameId, game] of unoGames.entries()) {
                if (game.players.some(p => p.socketId === socket.id)) {
                    game.status = 'abandoned';
                    setTimeout(() => unoGames.delete(gameId), 300000);
                }
            }
        }
    });
});

// Optimized cache for homepage data with memory management
const dataCache = new Map();
const homepageCache = new Map();
const CACHE_DURATION = 60000; // 1 minute for regular data
const HOMEPAGE_CACHE_DURATION = 30000; // 30 seconds for homepage data

function getCachedData(key) {
    const cached = dataCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function getHomepageCachedData(key) {
    const cached = homepageCache.get(key);
    if (cached && Date.now() - cached.timestamp < HOMEPAGE_CACHE_DURATION) {
        return cached.data;
    }
    return null;
}

function setCachedData(key, data) {
    dataCache.set(key, {
        data: data,
        timestamp: Date.now()
    });

    // Limit cache size to prevent memory overflow
    if (dataCache.size > 50) {
        const firstKey = dataCache.keys().next().value;
        dataCache.delete(firstKey);
    }
}

function setHomepageCachedData(key, data) {
    homepageCache.set(key, {
        data: data,
        timestamp: Date.now()
    });

    // Aggressive cleanup for homepage cache
    if (homepageCache.size > 20) {
        const firstKey = homepageCache.keys().next().value;
        homepageCache.delete(firstKey);
    }
}

/**
 * Broadcasts real-time data changes to connected WebSocket clients
 * @param {string} type - Type of data (supply, demand, bill)
 * @param {string} action - Action performed (create, update, delete)
 * @param {Object} data - The data that was changed
 * @param {string} financialYear - Financial year for targeted broadcast
 * Used by: CRUD operations on supply, demand, bill orders
 * Dependencies: socket.io for WebSocket communication
 */
function broadcastDataChange(type, action, data, financialYear) {
    const room = `${type}-${financialYear}`;

    // Clear relevant cache entries
    dataCache.delete(`${type}-${financialYear}`);
    dataCache.delete(`dashboard-overview-${financialYear}`);

    io.to(room).emit("data-change", {
        type,
        action,
        data,
        timestamp: new Date().toISOString()
    });
}

/**
 * Updates demand order status when supply order is linked via IMMS demand number
 * @param {string} imms_demand_no - The IMMS demand number to update
 * @param {string} financial_year - Financial year for the update
 * Used by: Supply order creation and update endpoints
 * Dependencies: db.js (pool) for database operations
 */
async function updateSupplyOrderPlacedStatus(imms_demand_no, financial_year) {
    if (imms_demand_no) {
        try {
            await pool.query(
                "UPDATE demand_orders SET supply_order_placed = 'Yes' WHERE imms_demand_no = ? AND financial_year = ?",
                [imms_demand_no, financial_year]
            );
        } catch (error) {
            console.error("Error updating supply order placed status:", error);
        }
    }
}

/**
 * Authentication middleware - checks if user has valid session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {Function} next - Express next function
 * Used by: All protected API endpoints
 * Dependencies: express-session for session management
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.status(401).json({ success: false, message: 'Session expired or not authenticated' });
    }
}

/**
 * Admin role middleware - checks if user has admin privileges
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * Used by: Admin-only endpoints (currently not actively used)
 * Dependencies: requireAuth middleware, session management
 */
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
}

/**
 * Super admin role middleware - checks if user has super admin privileges
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * Used by: Permission management endpoints (/api/permissions/*)
 * Dependencies: requireAuth middleware, session management
 */
function requireSuperAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'super_admin') {
        return next();
    } else {
        return res.status(403).json({ success: false, message: 'Super admin access required' });
    }
}

/**
 * Permission-based access control middleware - checks if user has specific permission
 * @param {string} permissionName - The permission name to check
 * @returns {Function} - Express middleware function
 * Used by: Feature-specific endpoints throughout the application
 * Dependencies: auth.js (getUserPermissions), session management
 */
function requirePermission(permissionName) {
    return async (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const userRole = req.session.user.role;

        // Super admins have all permissions
        if (userRole === 'super_admin') {
            return next();
        }

        const userPermissions = await getUserPermissions(userRole);

        if (userPermissions.includes(permissionName)) {
            return next();
        } else {
            return res.status(403).json({ success: false, message: 'Permission denied' });
        }
    };
}

// Create backup directories if they don't exist
const backupDirs = {
    supply: path.join(__dirname, "backups", "supply"),
    demand: path.join(__dirname, "backups", "demand"),
    bill: path.join(__dirname, "backups", "bill"),
    "sanction-gen-project": path.join(
        __dirname,
        "backups",
        "sanction-gen-project",
    ),
    "sanction-misc": path.join(__dirname, "backups", "sanction-misc"),
    "sanction-training": path.join(__dirname, "backups", "sanction-training"),
};
Object.values(backupDirs).forEach((dir) => fs.mkdir(dir, { recursive: true }));

// Auto-generate backup daily
async function createBackup(type) {
    const date = new Date().toISOString().split("T")[0];
    const backupFile = path.join(backupDirs[type], `backup_${date}.xlsx`);
    try {
        let tableName, sheetName;
        if (type.startsWith("sanction-")) {
            tableName = type.replace(/-/g, "_");
            sheetName = `${type.charAt(0).toUpperCase() + type.slice(1)} Codes`;
        } else {
            tableName = `${type}_orders`;
            sheetName = `${type.charAt(0).toUpperCase() + type.slice(1)} Orders`;
        }

        const [rows] = await pool.query(`SELECT * FROM ${tableName}`);
        const formattedRows = rows.map((row) => ({
            ...row,
            ...(type === "supply"
                ? {
                      original_date: row.original_date
                          ? row.original_date.toISOString().split("T")[0]
                          : "",
                      revised_date1: row.revised_date1
                          ? row.revised_date1.toISOString().split("T")[0]
                          : "",
                      revised_date2: row.revised_date2
                          ? row.revised_date2.toISOString().split("T")[0]
                          : "",
                      revised_date3: row.revised_date3
                          ? row.revised_date3.toISOString().split("T")[0]
                          : "",
                      actual_delivery_date: row.actual_delivery_date
                          ? row.actual_delivery_date.toISOString().split("T")[0]
                          : "",
                  }
                : type === "demand"
                  ? {
                        demand_date: row.demand_date
                            ? row.demand_date.toISOString().split("T")[0]
                            : "",
                        control_date: row.control_date
                            ? row.control_date.toISOString().split("T")[0]
                            : "",
                    }
                  : type === "bill"
                    ? {
                          bill_control_date: row.bill_control_date
                              ? row.bill_control_date
                                    .toISOString()
                                    .split("T")[0]
                              : "",
                          so_date: row.so_date
                              ? row.so_date.toISOString().split("T")[0]
                              : "",
                      }
                    : type.startsWith("sanction-")
                      ? {
                            date: row.date
                                ? row.date.toISOString().split("T")[0]
                                : "",
                            uo_date: row.uo_date
                                ? row.uo_date.toISOString().split("T")[0]
                                : "",
                        }
                      : {}),
        }));
        const worksheet = XLSX.utils.json_to_sheet(formattedRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        await fs.writeFile(
            backupFile,
            XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }),
        );

        // Delete backups older than 20 days
        const files = await fs.readdir(backupDirs[type]);
        const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        for (const file of files) {
            const filePath = path.join(backupDirs[type], file);
            const stats = await fs.stat(filePath);
            if (stats.mtime < twentyDaysAgo) {
                await fs.unlink(filePath);
            }
        }
    } catch (error) {
        console.error(`Error creating ${type} backup:`, error);
    }
}

// Schedule backups every day at midnight
setInterval(() => createBackup("supply"), 24 * 60 * 60 * 1000);
setInterval(() => createBackup("demand"), 24 * 60 * 60 * 1000);
setInterval(() => createBackup("bill"), 24 * 60 * 60 * 1000);
setInterval(() => createBackup("sanction-gen-project"), 24 * 60 * 60 * 1000);
setInterval(() => createBackup("sanction-misc"), 24 * 60 * 60 * 1000);
setInterval(() => createBackup("sanction-training"), 24 * 60 * 60 * 1000);
createBackup("supply"); // Run immediately on startup
createBackup("demand");
createBackup("bill");
createBackup("sanction-gen-project");
createBackup("sanction-misc");
createBackup("sanction-training");

// Authentication endpoints
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await authenticateUser(username, password);

        if (user) {
            // Create session
            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role || 'viewer'
            };

            // Get user permissions
            const permissions = await getUserPermissions(user.role || 'viewer');

            res.status(200).json({
                success: true,
                message: "Login successful",
                user: {
                    username: user.username,
                    role: user.role || 'viewer',
                    permissions: permissions
                }
            });
        } else {
            res.status(401).json({
                success: false,
                message: "Invalid credentials",
            });
        }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Gaming endpoints - only accessible with gaming credentials
app.get("/api/chess/games", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    // Return list of active games
    const games = Array.from(chessGames.values()).map(game => ({
        id: game.id,
        players: game.players,
        status: game.status,
        turn: game.turn,
        createdAt: game.createdAt
    }));

    res.json(games);
});

app.post("/api/chess/create", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const gameId = Date.now().toString();
    const newGame = {
        id: gameId,
        players: [req.session.user.username],
        board: initializeChessBoard(),
        turn: 'white',
        status: 'waiting',
        moves: [],
        createdAt: new Date().toISOString()
    };

    chessGames.set(gameId, newGame);

    res.json({ success: true, gameId, game: newGame });
});

app.post("/api/chess/join/:gameId", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.params;
    const game = chessGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (game.players.length >= 2) {
        return res.status(400).json({ success: false, message: 'Game is full' });
    }

    if (game.players.includes(req.session.user.username)) {
        return res.status(400).json({ success: false, message: 'Already in this game' });
    }

    game.players.push(req.session.user.username);
    game.status = 'playing';

    // Broadcast game update to all gaming clients
    io.to('gaming-room').emit('game-updated', { gameId, game });

    res.json({ success: true, game });
});

app.post("/api/chess/move", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId, from, to } = req.body;
    const game = chessGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (!game.players.includes(req.session.user.username)) {
        return res.status(403).json({ success: false, message: 'Not a player in this game' });
    }

    // Determine player color
    const playerColor = game.players[0] === req.session.user.username ? 'white' : 'black';

    if (game.turn !== playerColor) {
        return res.status(400).json({ success: false, message: 'Not your turn' });
    }

    // Validate and make move
    if (isValidMove(game.board, from, to, playerColor)) {
        makeMove(game.board, from, to);
        game.moves.push({ from, to, player: req.session.user.username, timestamp: new Date().toISOString() });
        game.turn = game.turn === 'white' ? 'black' : 'white';

        // Check for game end conditions
        if (isCheckmate(game.board, game.turn)) {
            game.status = 'finished';
            game.winner = playerColor;
        } else if (isStalemate(game.board, game.turn)) {
            game.status = 'draw';
        }

        // Broadcast move to all gaming clients
        io.to('gaming-room').emit('move-made', { gameId, move: { from, to }, game });

        res.json({ success: true, game });
    } else {
        res.status(400).json({ success: false, message: 'Invalid move' });
    }
});

// Ludo Game Endpoints
app.get("/api/ludo/games", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const games = Array.from(ludoGames.values()).map(game => ({
        id: game.id,
        players: game.players.map(p => ({ name: p.name })),
        maxPlayers: game.maxPlayers,
        status: game.status,
        createdAt: game.createdAt
    }));

    res.json(games);
});

app.post("/api/ludo/create", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const gameId = 'ludo_' + Date.now().toString();
    const newGame = {
        id: gameId,
        players: [{
            name: req.session.user.username,
            pieces: [
                { position: -1, id: 0 },
                { position: -1, id: 1 },
                { position: -1, id: 2 },
                { position: -1, id: 3 }
            ],
            piecesInGoal: 0
        }],
        maxPlayers: 4,
        status: 'waiting',
        currentPlayerIndex: 0,
        diceRolled: false,
        lastDiceRoll: null,
        board: null,
        createdAt: new Date().toISOString()
    };

    ludoGames.set(gameId, newGame);

    res.json({ success: true, gameId, game: newGame });
});

app.post("/api/ludo/join/:gameId", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.params;
    const game = ludoGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (game.players.length >= game.maxPlayers) {
        return res.status(400).json({ success: false, message: 'Game is full' });
    }

    if (game.players.some(p => p.name === req.session.user.username)) {
        return res.status(400).json({ success: false, message: 'Already in this game' });
    }

    game.players.push({
        name: req.session.user.username,
        pieces: [
            { position: -1, id: 0 },
            { position: -1, id: 1 },
            { position: -1, id: 2 },
            { position: -1, id: 3 }
        ],
        piecesInGoal: 0
    });

    io.to('gaming-room').emit('ludo-game-updated', { gameId, game });

    res.json({ success: true, game });
});

app.post("/api/ludo/start/:gameId", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.params;
    const { playerCount, addComputer, gameMode } = req.body;
    const game = ludoGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    game.maxPlayers = Math.min(Math.max(playerCount, 2), 8);
    game.gameMode = gameMode || 'multi';

    // Add computer players if requested and needed
    if (addComputer && game.players.length < game.maxPlayers) {
        const neededComputers = game.maxPlayers - game.players.length;
        const difficulties = ['Easy', 'Medium', 'Hard'];

        for (let i = 0; i < neededComputers; i++) {
            const difficulty = gameMode === 'single' ? 
                (req.body.difficulty || 'medium').charAt(0).toUpperCase() + (req.body.difficulty || 'medium').slice(1) :
                difficulties[i % difficulties.length];

            game.players.push({
                name: gameMode === 'single' ? `Computer (${difficulty})` : `Computer ${i + 1}`,
                isComputer: true,
                difficulty: gameMode === 'single' ? (req.body.difficulty || 'medium') : 'medium',
                pieces: [
                    { position: -1, id: 0 },
                    { position: -1, id: 1 },
                    { position: -1, id: 2 },
                    { position: -1, id: 3 }
                ],
                piecesInGoal: 0
            });
        }
    }

    game.status = 'playing';
    game.board = initializeLudoBoard();

    io.to('gaming-room').emit('ludo-game-started', { gameId, game });

    res.json({ success: true, game });
});

app.post("/api/ludo/roll/:gameId", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.params;
    const game = ludoGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer.name !== req.session.user.username) {
        return res.status(400).json({ success: false, message: 'Not your turn' });
    }

    if (game.diceRolled) {
        return res.status(400).json({ success: false, message: 'Dice already rolled' });
    }

    const diceRoll = Math.floor(Math.random() * 6) + 1;
    game.lastDiceRoll = diceRoll;
    game.diceRolled = true;

    // Auto-move for computer players or if only one valid move
    setTimeout(() => {
        if (currentPlayer.isComputer || getValidMoves(game, game.currentPlayerIndex, diceRoll).length === 0) {
            // Move to next player
            game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
            game.diceRolled = false;
            game.lastDiceRoll = null;
        }
    }, 1000);

    io.to('gaming-room').emit('ludo-dice-rolled', { gameId, diceRoll, game });

    res.json({ success: true, game, diceRoll });
});

// Tic-Tac-Toe Game Endpoints
app.get("/api/tictactoe/games", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const games = Array.from(ticTacToeGames.values()).map(game => ({
        id: game.id,
        players: game.players.map(p => p.name),
        status: game.status,
        currentPlayer: game.currentPlayer,
        createdAt: game.createdAt
    }));

    res.json(games);
});

app.post("/api/tictactoe/create", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const gameId = 'ttt_' + Date.now().toString();
    const newGame = {
        id: gameId,
        players: [{
            name: req.session.user.username,
            symbol: 'X'
        }],
        board: Array(9).fill(''),
        currentPlayer: 'X',
        status: 'waiting',
        winner: null,
        createdAt: new Date().toISOString()
    };

    ticTacToeGames.set(gameId, newGame);

    res.json({ success: true, gameId, game: newGame });
});

app.post("/api/tictactoe/join/:gameId", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.params;
    const game = ticTacToeGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (game.players.length >= 2) {
        return res.status(400).json({ success: false, message: 'Game is full' });
    }

    if (game.players.some(p => p.name === req.session.user.username)) {
        return res.status(400).json({ success: false, message: 'Already in this game' });
    }

    game.players.push({
        name: req.session.user.username,
        symbol: 'O'
    });
    game.status = 'playing';

    io.to('gaming-room').emit('tictactoe-game-updated', { gameId, game });

    res.json({ success: true, game });
});

app.post("/api/tictactoe/move", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId, position } = req.body;
    const game = ticTacToeGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (!game.players.some(p => p.name === req.session.user.username)) {
        return res.status(403).json({ success: false, message: 'Not a player in this game' });
    }

    const player = game.players.find(p => p.name === req.session.user.username);

    if (game.currentPlayer !== player.symbol) {
        return res.status(400).json({ success: false, message: 'Not your turn' });
    }

    if (game.board[position] !== '') {
        return res.status(400).json({ success: false, message: 'Position already taken' });
    }

    // Make the move
    game.board[position] = player.symbol;

    // Check for winner
    const winner = checkTicTacToeWinner(game.board);
    if (winner) {
        game.status = 'finished';
        game.winner = winner;
    } else if (game.board.every(cell => cell !== '')) {
        game.status = 'draw';
    } else {
        // Switch turns
        game.currentPlayer = game.currentPlayer === 'X' ? 'O' : 'X';
    }

    io.to('gaming-room').emit('tictactoe-move-made', { gameId, position, symbol: player.symbol, game });

    res.json({ success: true, game });
});

function checkTicTacToeWinner(board) {
    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6] // diagonals
    ];

    for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

// UNO Game Endpoints
app.get("/api/uno/games", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const games = Array.from(unoGames.values()).map(game => ({
        id: game.id,
        players: game.players.map(p => p.name),
        maxPlayers: game.maxPlayers,
        status: game.status,
        currentPlayer: game.currentPlayerIndex,
        createdAt: game.createdAt
    }));

    res.json(games);
});

app.post("/api/uno/create", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const gameId = 'uno_' + Date.now().toString();
    const newGame = {
        id: gameId,
        players: [{
            name: req.session.user.username,
            hand: [],
            saidUNO: false
        }],
        maxPlayers: 4,
        deck: [],
        discardPile: [],
        currentPlayerIndex: 0,
        currentColor: '',
        currentNumber: '',
        direction: 1,
        status: 'waiting',
        createdAt: new Date().toISOString()
    };

    unoGames.set(gameId, newGame);

    res.json({ success: true, gameId, game: newGame });
});

app.post("/api/uno/join/:gameId", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.params;
    const game = unoGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (game.players.length >= game.maxPlayers) {
        return res.status(400).json({ success: false, message: 'Game is full' });
    }

    if (game.players.some(p => p.name === req.session.user.username)) {
        return res.status(400).json({ success: false, message: 'Already in this game' });
    }

    game.players.push({
        name: req.session.user.username,
        hand: [],
        saidUNO: false
    });

    if (game.players.length >= 2) {
        game.status = 'playing';
        initializeUNOGame(game);
    }

    io.to('gaming-room').emit('uno-game-updated', { gameId, game });

    res.json({ success: true, game });
});

app.post("/api/uno/play-card", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId, cardIndex, chosenColor } = req.body;
    const game = unoGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer.name !== req.session.user.username) {
        return res.status(400).json({ success: false, message: 'Not your turn' });
    }

    if (cardIndex >= currentPlayer.hand.length) {
        return res.status(400).json({ success: false, message: 'Invalid card index' });
    }

    const card = currentPlayer.hand[cardIndex];

    // Validate card can be played
    if (!canPlayUNOCard(card, game.currentColor, game.currentNumber)) {
        return res.status(400).json({ success: false, message: 'Cannot play this card' });
    }

    // Play the card
    currentPlayer.hand.splice(cardIndex, 1);
    game.discardPile.push(card);

    // Update game state
    if (card.type === 'wild') {
        game.currentColor = chosenColor || 'red';
    } else {
        game.currentColor = card.color;
    }
    game.currentNumber = card.value;

    // Process card effects
    processUNOCardEffect(game, card);

    // Check for winner
    if (currentPlayer.hand.length === 0) {
        game.status = 'finished';
        game.winner = currentPlayer.name;
    } else {
        // Move to next player
        game.currentPlayerIndex = (game.currentPlayerIndex + game.direction + game.players.length) % game.players.length;
    }

    io.to('gaming-room').emit('uno-card-played', { gameId, card, game });

    res.json({ success: true, game });
});

app.post("/api/uno/draw-card", requireAuth, (req, res) => {
    if (req.session.user.role !== 'gamer') {
        return res.status(403).json({ success: false, message: 'Gaming access required' });
    }

    const { gameId } = req.body;
    const game = unoGames.get(gameId);

    if (!game) {
        return res.status(404).json({ success: false, message: 'Game not found' });
    }

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer.name !== req.session.user.username) {
        return res.status(400).json({ success: false, message: 'Not your turn' });
    }

    if (game.deck.length === 0) {
        reshuffleUNODeck(game);
    }

    if (game.deck.length > 0) {
        currentPlayer.hand.push(game.deck.pop());

        // Move to next player
        game.currentPlayerIndex = (game.currentPlayerIndex + game.direction + game.players.length) % game.players.length;
    }

    io.to('gaming-room').emit('uno-card-drawn', { gameId, game });

    res.json({ success: true, game });
});

function initializeUNOGame(game) {
    // Create UNO deck
    game.deck = createUNODeck();
    shuffleArray(game.deck);

    // Deal 7 cards to each player
    game.players.forEach(player => {
        player.hand = [];
        for (let i = 0; i < 7; i++) {
            player.hand.push(game.deck.pop());
        }
    });

    // Place first card
    let firstCard;
    do {
        firstCard = game.deck.pop();
    } while (firstCard.type === 'wild');

    game.discardPile = [firstCard];
    game.currentColor = firstCard.color;
    game.currentNumber = firstCard.value;
    game.currentPlayerIndex = 0;
    game.direction = 1;
}

function createUNODeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const numbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const specials = ['skip', 'reverse', 'draw2'];
    const deck = [];

    // Number cards
    colors.forEach(color => {
        // One 0 per color
        deck.push({ color, value: '0', type: 'number' });
        // Two of each 1-9 per color
        for (let i = 1; i <= 9; i++) {
            deck.push({ color, value: i.toString(), type: 'number' });
            deck.push({ color, value: i.toString(), type: 'number' });
        }
    });

    // Special cards (2 per color)
    colors.forEach(color => {
        specials.forEach(special => {
            deck.push({ color, value: special, type: 'special' });
            deck.push({ color, value: special, type: 'special' });
        });
    });

    // Wild cards (4 each)
    for (let i = 0; i < 4; i++) {
        deck.push({ color: 'wild', value: 'wild', type: 'wild' });
        deck.push({ color: 'wild', value: 'wild4', type: 'wild' });
    }

    return deck;
}

function canPlayUNOCard(card, currentColor, currentNumber) {
    if (card.type === 'wild') return true;
    return card.color === currentColor || card.value === currentNumber;
}

function processUNOCardEffect(game, card) {
    const nextPlayerIndex = (game.currentPlayerIndex + game.direction + game.players.length) % game.players.length;

    switch (card.value) {
        case 'skip':
            // Skip next player
            game.currentPlayerIndex = (nextPlayerIndex + game.direction + game.players.length) % game.players.length;
            break;
        case 'reverse':
            game.direction *= -1;
            if (game.players.length === 2) {
                // In 2-player game, reverse acts like skip
                game.currentPlayerIndex = (game.currentPlayerIndex + game.direction + game.players.length) % game.players.length;
            }
            break;
        case 'draw2':
            // Next player draws 2 cards and loses turn
            for (let i = 0; i < 2 && game.deck.length > 0; i++) {
                game.players[nextPlayerIndex].hand.push(game.deck.pop());
            }
            game.currentPlayerIndex = (nextPlayerIndex + game.direction + game.players.length) % game.players.length;
            break;
        case 'wild4':
            // Next player draws 4 cards and loses turn
            for (let i = 0; i < 4 && game.deck.length > 0; i++) {
                game.players[nextPlayerIndex].hand.push(game.deck.pop());
            }
            game.currentPlayerIndex = (nextPlayerIndex + game.direction + game.players.length) % game.players.length;
            break;
    }
}

function reshuffleUNODeck(game) {
    if (game.discardPile.length <= 1) return;

    const topCard = game.discardPile.pop();
    game.deck = game.discardPile;
    game.discardPile = [topCard];
    shuffleArray(game.deck);
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function initializeLudoBoard() {
    return Array(52).fill(null);
}

function getValidMoves(game, playerIndex, diceRoll) {
    const player = game.players[playerIndex];
    const validMoves = [];

    player.pieces.forEach((piece, pieceIndex) => {
        if (piece.position === -1 && diceRoll === 6) {
            // Can move piece out of home
            validMoves.push({ pieceIndex, from: -1, to: 0 });
        } else if (piece.position >= 0 && piece.position < 51) {
            const newPosition = piece.position + diceRoll;
            if (newPosition <= 56) {
                validMoves.push({ pieceIndex, from: piece.position, to: newPosition });
            }
        }
    });

    return validMoves;
}

// Chess game storage
const chessGames = new Map();

// Ludo game storage
const ludoGames = new Map();

// Tic-Tac-Toe game storage
const ticTacToeGames = new Map();

// UNO game storage
const unoGames = new Map();

// Chess game logic functions
function initializeChessBoard() {
    return [
        ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
        ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null],
        ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
        ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    ];
}

function isValidMove(board, from, to, playerColor) {
    const [fromRow, fromCol] = [parseInt(from[1]), from.charCodeAt(0) - 97];
    const [toRow, toCol] = [parseInt(to[1]), to.charCodeAt(0) - 97];

    // Basic bounds checking
    if (fromRow < 0 || fromRow > 7 || fromCol < 0 || fromCol > 7 ||
        toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) {
        return false;
    }

    const piece = board[7 - fromRow][fromCol];
    if (!piece) return false;

    // Check if piece belongs to current player
    const pieceColor = piece === piece.toUpperCase() ? 'white' : 'black';
    if (pieceColor !== playerColor) return false;

    // Basic move validation (simplified)
    return true;
}

function makeMove(board, from, to) {
    const [fromRow, fromCol] = [7 - parseInt(from[1]), from.charCodeAt(0) - 97];
    const [toRow, toCol] = [7 - parseInt(to[1]), to.charCodeAt(0) - 97];

    board[toRow][toCol] = board[fromRow][fromCol];
    board[fromRow][fromCol] = null;
}

function isCheckmate(board, color) {
    // Simplified checkmate detection
    return false;
}

function isStalemate(board, color) {
    // Simplified stalemate detection
    return false;
}

// Logout endpoint
app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, message: "Could not log out" });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ success: true, message: "Logged out successfully" });
    });
});

// Check session status
app.get("/api/session", (req, res) => {
    if (req.session && req.session.user) {
        res.status(200).json({
            success: true,
            user: req.session.user
        });
    } else {
        res.status(401).json({ success: false, message: "No active session" });
    }
});

// Extend session
app.post("/api/extend-session", requireAuth, (req, res) => {
    req.session.touch(); // This resets the session timeout
    res.status(200).json({ success: true, message: "Session extended" });
});

app.post("/api/verify-security", async (req, res) => {
    const { username, answer } = req.body;

    try {
        const isValid = await verifySecurityAnswer(username, answer);
        if (isValid) {
            res.status(200).json({ success: true });
        } else {
            res.status(400).json({ success: false, message: "Incorrect answer. Please try again." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Verification failed. Please try again." });
    }
});

app.post("/api/change-password", async (req, res) => {
    const { username, newPassword } = req.body;

    try {
        await changePassword(username, newPassword);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Permission management endpoints
app.get("/api/permissions", requireSuperAdmin, async (req, res) => {
    try {
        const permissions = await getAllPermissions();
        res.json(permissions);
    } catch (error) {
        console.error("Error fetching permissions:", error);
        res.status(500).json({ error: "Failed to fetch permissions" });
    }
});

app.post("/api/permissions/update", requireSuperAdmin, async (req, res) => {
    const { role, permissionName, enabled } = req.body;

    try {
        const success = await updatePermission(role, permissionName, enabled);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false, message: "Failed to update permission" });
        }
    } catch (error) {
        console.error("Error updating permission:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get("/api/user-permissions", requireAuth, async (req, res) => {
    try {
        const userRole = req.session.user.role;
        const permissions = await getUserPermissions(userRole);
        res.json({ permissions });
    } catch (error) {
        console.error("Error fetching user permissions:", error);
        res.status(500).json({ error: "Failed to fetch user permissions" });
    }
});

// Storage access tracking endpoints
app.post("/api/storage-access-request", async (req, res) => {
    const { userIdentifier, browserInfo, accessGranted = true } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
    const userAgent = req.headers['user-agent'];
    const forwardedFor = req.headers['x-forwarded-for'];

    try {
        // Enhanced session data collection
        const sessionData = {
            sessionId: req.sessionID || 'anonymous',
            cookies: req.headers.cookie ? req.headers.cookie.split(';').length : 0,
            acceptLanguage: req.headers['accept-language'],
            acceptEncoding: req.headers['accept-encoding'],
            connection: req.headers.connection,
            cacheControl: req.headers['cache-control'],
            upgradeInsecureRequests: req.headers['upgrade-insecure-requests'],
            dnt: req.headers.dnt,
            secFetchSite: req.headers['sec-fetch-site'],
            secFetchMode: req.headers['sec-fetch-mode'],
            secFetchUser: req.headers['sec-fetch-user'],
            secFetchDest: req.headers['sec-fetch-dest'],
            forwardedFor: forwardedFor,
            realIP: req.headers['x-real-ip'],
            originalIP: req.headers['x-original-forwarded-for']
        };

        await pool.query(
            "INSERT INTO storage_access_log (user_identifier, ip_address, user_agent, access_granted, browser_info, session_data) VALUES (?, ?, ?, ?, ?, ?)",
            [userIdentifier, ipAddress, userAgent, accessGranted, JSON.stringify(browserInfo), JSON.stringify(sessionData)]
        );

        console.log(`Storage access logged for user: ${userIdentifier} from IP: ${ipAddress}`);
        res.json({ success: true, message: "Access automatically granted" });
    } catch (error) {
        console.error("Error logging storage access:", error);
        res.status(500).json({ error: "Failed to log access" });
    }
});

app.get("/api/storage-access-logs", requireAuth, async (req, res) => {
    if (req.session.user.role !== 'storage_admin') {
        return res.status(403).json({ success: false, message: 'Storage admin access required' });
    }

    try {
        const [logs] = await pool.query(
            "SELECT * FROM storage_access_log WHERE access_granted = TRUE ORDER BY access_timestamp DESC"
        );
        res.json(logs);
    } catch (error) {
        console.error("Error fetching storage access logs:", error);
        res.status(500).json({ error: "Failed to fetch access logs" });
    }
});

app.get("/api/storage-file-access/:userId", requireAuth, async (req, res) => {
    if (req.session.user.role !== 'storage_admin') {
        return res.status(403).json({ success: false, message: 'Storage admin access required' });
    }

    const { userId } = req.params;
    
    try {
        // Get all directories and files from the project
        const projectRoot = __dirname;
        const userFiles = [];
        let totalSize = 0;

        async function scanDirectory(dirPath, relativePath = '') {
            try {
                const items = await fs.readdir(dirPath, { withFileTypes: true });
                
                for (const item of items) {
                    const fullPath = path.join(dirPath, item.name);
                    const relativeFilePath = path.join(relativePath, item.name);
                    
                    // Skip node_modules, .git, and other system directories
                    if (['node_modules', '.git', '.replit', 'backups'].includes(item.name)) {
                        continue;
                    }
                    
                    if (item.isDirectory()) {
                        await scanDirectory(fullPath, relativeFilePath);
                    } else {
                        try {
                            const stats = await fs.stat(fullPath);
                            const fileSizeInBytes = stats.size;
                            const fileSizeInKB = (fileSizeInBytes / 1024).toFixed(2);
                            const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
                            
                            let displaySize;
                            if (fileSizeInBytes < 1024) {
                                displaySize = `${fileSizeInBytes}B`;
                            } else if (fileSizeInBytes < 1024 * 1024) {
                                displaySize = `${fileSizeInKB}KB`;
                            } else {
                                displaySize = `${fileSizeInMB}MB`;
                            }
                            
                            totalSize += fileSizeInBytes;
                            
                            userFiles.push({
                                name: relativeFilePath,
                                fullPath: fullPath,
                                size: displaySize,
                                sizeBytes: fileSizeInBytes,
                                modified: stats.mtime.toISOString().split('T')[0],
                                type: path.extname(item.name) || 'file',
                                isReadable: true
                            });
                        } catch (statError) {
                            console.warn("Error getting file stats:", statError);
                        }
                    }
                }
            } catch (readError) {
                console.warn("Error reading directory:", readError);
            }
        }

        await scanDirectory(projectRoot);
        
        // Sort files by name
        userFiles.sort((a, b) => a.name.localeCompare(b.name));
        
        const totalSizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
        
        const fileData = {
            userId: userId,
            files: userFiles,
            totalSize: `${totalSizeInMB}MB`,
            totalFiles: userFiles.length,
            lastAccess: new Date().toISOString(),
            projectRoot: projectRoot
        };
        
        res.json(fileData);
    } catch (error) {
        console.error("Error accessing user files:", error);
        res.status(500).json({ error: "Failed to access user files" });
    }
});

// New endpoint to view file content
app.get("/api/storage-file-content/:userId/*", requireAuth, async (req, res) => {
    if (req.session.user.role !== 'storage_admin') {
        return res.status(403).json({ success: false, message: 'Storage admin access required' });
    }

    const filePath = req.params[0]; // Get the file path from the wildcard
    const fullPath = path.join(__dirname, filePath);
    
    try {
        // Security check: ensure the file is within the project directory
        const projectRoot = path.resolve(__dirname);
        const resolvedPath = path.resolve(fullPath);
        
        if (!resolvedPath.startsWith(projectRoot)) {
            return res.status(403).json({ error: "Access denied: File outside project scope" });
        }
        
        // Check if file exists
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
            return res.status(404).json({ error: "File not found" });
        }
        
        // Get file extension to determine if it's readable
        const ext = path.extname(filePath).toLowerCase();
        const textExtensions = ['.txt', '.js', '.json', '.html', '.css', '.md', '.sql', '.log', '.xml', '.yaml', '.yml', '.env', '.gitignore', '.py', '.java', '.c', '.cpp', '.h', '.php', '.rb', '.go', '.rs', '.sh', '.bat', '.ps1'];
        
        if (textExtensions.includes(ext) || stats.size < 1024 * 1024) { // Less than 1MB
            try {
                const content = await fs.readFile(fullPath, 'utf8');
                res.json({
                    filePath: filePath,
                    content: content,
                    size: stats.size,
                    modified: stats.mtime,
                    encoding: 'utf8',
                    isText: true
                });
            } catch (readError) {
                // If UTF-8 fails, try binary
                const content = await fs.readFile(fullPath);
                res.json({
                    filePath: filePath,
                    content: content.toString('base64'),
                    size: stats.size,
                    modified: stats.mtime,
                    encoding: 'base64',
                    isText: false
                });
            }
        } else {
            // For large files or binary files, provide metadata only
            res.json({
                filePath: filePath,
                content: "File too large or binary format. Download not supported in browser.",
                size: stats.size,
                modified: stats.mtime,
                encoding: 'metadata',
                isText: false
            });
        }
    } catch (error) {
        console.error("Error reading file content:", error);
        res.status(500).json({ error: "Failed to read file content" });
    }
});

// New endpoint to download files
app.get("/api/storage-file-download/:userId/*", requireAuth, async (req, res) => {
    if (req.session.user.role !== 'storage_admin') {
        return res.status(403).json({ success: false, message: 'Storage admin access required' });
    }

    const filePath = req.params[0];
    const fullPath = path.join(__dirname, filePath);
    
    try {
        // Security check
        const projectRoot = path.resolve(__dirname);
        const resolvedPath = path.resolve(fullPath);
        
        if (!resolvedPath.startsWith(projectRoot)) {
            return res.status(403).json({ error: "Access denied" });
        }
        
        // Check if file exists
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
            return res.status(404).json({ error: "File not found" });
        }
        
        // Set headers for download
        const fileName = path.basename(filePath);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stats.size);
        
        // Stream the file
        const fileStream = require('fs').createReadStream(fullPath);
        fileStream.pipe(res);
        
    } catch (error) {
        console.error("Error downloading file:", error);
        res.status(500).json({ error: "Failed to download file" });
    }
});

app.get("/api/supply-orders", requireAuth, async (req, res) => {
    const { year, sort = "serial_no" } = req.query;

    // Whitelist allowed sort columns to prevent SQL injection
    const allowedSortColumns = [
        "serial_no", "supply_order_no", "so_date", "firm_name", "nomenclature", 
        "quantity", "original_date", "revised_date1", "revised_date2", 
        "revised_date3", "build_up", "maint", "misc", "project_less_2cr", "project_more_2cr", "project_no_pdc", 
        "imms_demand_no", "actual_delivery_date", "procurement_mode", "delivery_done", "remarks"
    ];

    const safeSort = allowedSortColumns.includes(sort) ? sort : "serial_no";

    try {
        const [rows] = await pool.query(
            `SELECT id, serial_no, supply_order_no, DATE_FORMAT(so_date, '%Y-%m-%d') as so_date, 
                    firm_name, nomenclature, quantity, 
                    DATE_FORMAT(original_date, '%Y-%m-%d') as original_date, 
                    DATE_FORMAT(revised_date1, '%Y-%m-%d') as revised_date1, 
                    DATE_FORMAT(revised_date2, '%Y-%m-%d') as revised_date2, 
                    DATE_FORMAT(revised_date3, '%Y-%m-%d') as revised_date3, 
                    build_up, maint, misc, project_less_2cr, project_more_2cr, project_no_pdc, p_np, expenditure_head, rev_cap,
                    imms_demand_no, DATE_FORMAT(actual_delivery_date, '%Y-%m-%d') as actual_delivery_date,
                    procurement_mode, delivery_done, remarks, financial_year 
             FROM supply_orders WHERE financial_year = ? ORDER BY ${safeSort}`,
            [year],
        );
        console.log(`Found ${rows.length} supply orders for year ${year}`);
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch supply orders" });
    }
});

// New endpoint to get available supply orders for bill register dropdown
app.get("/api/available-supply-orders", requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT DISTINCT s.supply_order_no, DATE_FORMAT(s.so_date, '%Y-%m-%d') as so_date, s.financial_year, s.firm_name
             FROM supply_orders s
             LEFT JOIN bill_orders b ON s.supply_order_no = b.supply_order_no
             WHERE s.supply_order_no IS NOT NULL 
             AND s.supply_order_no != ''
             AND b.supply_order_no IS NULL
             ORDER BY s.financial_year DESC, s.supply_order_no`,
        );
        res.json(rows.map(row => ({
            value: row.supply_order_no,
            label: `${row.supply_order_no} (${row.financial_year}) - ${row.firm_name}`,
            so_date: row.so_date,
            financial_year: row.financial_year
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch available supply orders" });
    }
});

app.get("/api/demand-orders", requireAuth, async (req, res) => {
    const { year, sort = "serial_no" } = req.query;

    const allowedSortColumns = [
        "serial_no", "demand_date", "imms_demand_no", "mmg_control_no", 
        "nomenclature", "quantity", "expenditure_head", "rev_cap", 
        "procurement_mode", "est_cost", "imms_control_no", "supply_order_placed", "remarks"
    ];

    const safeSort = allowedSortColumns.includes(sort) ? sort : "serial_no";

    try {
        const [rows] = await pool.query(
            `SELECT id, serial_no, imms_demand_no, DATE_FORMAT(demand_date, '%Y-%m-%d') as demand_date, 
                    mmg_control_no, DATE_FORMAT(control_date, '%Y-%m-%d') as control_date, nomenclature, quantity, 
                    expenditure_head, code_head, rev_cap, procurement_mode, est_cost, imms_control_no, 
                    supply_order_placed, remarks, financial_year 
             FROM demand_orders WHERE financial_year = ? ORDER BY ${safeSort}`,
            [year],
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch demand orders" });
    }
});

app.get("/api/bill-orders", requireAuth, async (req, res) => {
    const { year, sort = "serial_no" } = req.query;

    const allowedSortColumns = [
        "serial_no", "bill_control_date", "firm_name", "supply_order_no", 
        "so_date", "project_no", "build_up", "maintenance", "project_less_2cr", 
        "project_more_2cr", "procurement_mode", "rev_cap", "date_amount_passed", 
        "ld_amount", "remarks"
    ];

    const safeSort = allowedSortColumns.includes(sort) ? sort : "serial_no";

    try {
        const [rows] = await pool.query(
            `SELECT id, serial_no, DATE_FORMAT(bill_control_date, '%Y-%m-%d') as bill_control_date, 
                    firm_name, supply_order_no, DATE_FORMAT(so_date, '%Y-%m-%d') as so_date, 
                    project_no, build_up, maintenance, project_less_2cr, project_more_2cr, 
                    procurement_mode, rev_cap, date_amount_passed, ld_amount, remarks, financial_year 
             FROM bill_orders WHERE financial_year = ? ORDER BY ${safeSort}`,
            [year],
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch bill orders" });
    }
});

app.get("/api/supply-orders/max-serial", async (req, res) => {
    const { year } = req.query;
    try {
        const [rows] = await pool.query(
            "SELECT MAX(serial_no) as maxSerialNo FROM supply_orders WHERE financial_year = ?",
            [year],
        );
        res.json({ maxSerialNo: rows[0].maxSerialNo || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/demand-orders/max-serial", async (req, res) => {
    const { year } = req.query;
    try {
        const [rows] = await pool.query(
            "SELECT MAX(serial_no) as maxSerialNo FROM demand_orders WHERE financial_year = ?",
            [year],
        );
        res.json({ maxSerialNo: rows[0].maxSerialNo || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/bill-orders/max-serial", async (req, res) => {
    const { year } = req.query;
    try {
        const [rows] = await pool.query(
            "SELECT MAX(serial_no) as maxSerialNo FROM bill_orders WHERE financial_year = ?",
            [year],
        );
        res.json({ maxSerialNo: rows[0].maxSerialNo || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/imms-demand-numbers", requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT DISTINCT imms_demand_no, financial_year FROM demand_orders WHERE supply_order_placed = 'No' AND imms_demand_no IS NOT NULL AND imms_demand_no != '' ORDER BY financial_year DESC, imms_demand_no",
        );
        res.json(rows.map(row => ({
            value: row.imms_demand_no,
            label: `${row.imms_demand_no} (${row.financial_year})`
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch IMMS demand numbers" });
    }
});

app.get("/api/supply-orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT * FROM supply_orders WHERE id = ?",
            [id],
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send("Not found");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/demand-orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT * FROM demand_orders WHERE id = ?",
            [id],
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send("Not found");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/bill-orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT * FROM bill_orders WHERE id = ?",
            [id],
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send("Not found");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/supply-orders", requireAuth, async (req, res) => {
    // Check if user has permission to add
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const data = req.body;
    try {
        const [result] = await pool.query(
            `INSERT INTO supply_orders (serial_no, supply_order_no, so_date, firm_name, nomenclature, quantity, 
                original_date, revised_date1, revised_date2, revised_date3, 
                build_up, maint, misc, project_less_2cr, project_more_2cr, project_no_pdc, p_np, expenditure_head, rev_cap, imms_demand_no, actual_delivery_date,
                procurement_mode, delivery_done, remarks, financial_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.serial_no || null,
                data.supply_order_no || null,
                data.so_date || null,
                (data.firm_name && data.firm_name !== 'null') ? data.firm_name : null,
                (data.nomenclature && data.nomenclature !== 'null') ? data.nomenclature : null,
                (data.quantity && data.quantity !== 'null') ? data.quantity : null,
                data.original_date || null,
                data.revised_date1 || null,
                data.revised_date2 || null,
                data.revised_date3 || null,
                (data.build_up && data.build_up !== 'null') ? data.build_up : null,
                (data.maint && data.maint !== 'null') ? data.maint : null,
                (data.misc && data.misc !== 'null') ? data.misc : null,
                data.project_less_2cr || null,
                data.project_more_2cr || null,
                (data.project_no_pdc && data.project_no_pdc !== 'null') ? data.project_no_pdc : null,
                data.p_np || null,
                data.expenditure_head || null,
                data.rev_cap || null,
                data.imms_demand_no || null,
                data.actual_delivery_date || null,
                (data.procurement_mode && data.procurement_mode !== 'null') ? data.procurement_mode : null,
                data.delivery_done || null,
                (data.remarks && data.remarks !== 'null') ? data.remarks : null,
                data.financial_year || null,
            ],
        );

        // Update supply order placed status if IMMS demand number is provided
        await updateSupplyOrderPlacedStatus(data.imms_demand_no, data.financial_year);

        // Broadcast the change to all connected clients
        broadcastDataChange('supply', 'create', { ...data, id: result.insertId }, data.financial_year);

        // Also emit a general data update event for homepage
        io.emit('homepage-data-update', {
            type: 'supply',
            action: 'create',
            financial_year: data.financial_year,
            timestamp: new Date().toISOString()
        });

        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/demand-orders", async (req, res) => {
    const data = req.body;
    try {
        await pool.query(
            `INSERT INTO demand_orders (serial_no, imms_demand_no, demand_date, mmg_control_no, control_date, nomenclature, quantity, 
                expenditure_head, code_head, rev_cap, procurement_mode, est_cost, imms_control_no, supply_order_placed, remarks, financial_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.serial_no || null,
                data.imms_demand_no || null,
                data.demand_date || null,
                data.mmg_control_no || null,
                data.control_date || null,
                data.nomenclature || null,
                data.quantity || null,
                data.expenditure_head || null,
                data.code_head || null,
                data.rev_cap || null,
                data.procurement_mode || null,
                data.est_cost || null,
                data.imms_control_no || null,
                data.supply_order_placed || 'No',
                data.remarks || null,
                data.financial_year || null,
            ],
        );

        // Emit homepage data update event
        io.emit('homepage-data-update', {
            type: 'demand',
            action: 'create',
            financial_year: data.financial_year,
            timestamp: new Date().toISOString()
        });

        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/bill-orders", async (req, res) => {
    const data = req.body;
    try {
        await pool.query(
            `INSERT INTO bill_orders (serial_no, bill_control_date, firm_name, supply_order_no, so_date, 
                project_no, build_up, maintenance, project_less_2cr, project_more_2cr, 
                procurement_mode, rev_cap, date_amount_passed, ld_amount, remarks, financial_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.serial_no || null,
                data.bill_control_date || null,
                (data.firm_name && data.firm_name !== 'null') ? data.firm_name : null,
                data.supply_order_no || null,
                data.so_date || null,
                (data.project_no && data.project_no !== 'null') ? data.project_no : null,
                (data.build_up && data.build_up !== 'null') ? data.build_up : null,
                (data.maintenance && data.maintenance !== 'null') ? data.maintenance : null,
                (data.project_less_2cr && data.project_less_2cr !== 'null') ? data.project_less_2cr : null,
                (data.project_more_2cr && data.project_more_2cr !== 'null') ? data.project_more_2cr : null,
                (data.procurement_mode && data.procurement_mode !== 'null') ? data.procurement_mode : null,
                data.rev_cap || null,
                (data.date_amount_passed && data.date_amount_passed !== 'null') ? data.date_amount_passed : null,
                (data.ld_amount && data.ld_amount !== 'null') ? data.ld_amount : null,
                (data.remarks && data.remarks !== 'null') ? data.remarks : null,
                data.financial_year || null,
            ],
        );

        // Emit homepage data update event
        io.emit('homepage-data-update', {
            type: 'bill',
            action: 'create',
            financial_year: data.financial_year,
            timestamp: new Date().toISOString()
        });

        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.put("/api/supply-orders/:id", requireAuth, async (req, res) => {
    // Check if user has permission to edit
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const data = req.body;
    try {
        await pool.query(
            `UPDATE supply_orders SET serial_no = ?, supply_order_no = ?, so_date = ?, firm_name = ?, nomenclature = ?, quantity = ?, 
                original_date = ?, revised_date1 = ?, revised_date2 = ?, revised_date3 = ?, 
                build_up = ?, maint = ?, misc = ?, project_less_2cr = ?, project_more_2cr = ?, project_no_pdc = ?, p_np = ?, expenditure_head = ?, rev_cap = ?, imms_demand_no = ?, 
                actual_delivery_date = ?, procurement_mode = ?, delivery_done = ?, remarks = ?, financial_year = ? 
             WHERE id = ?`,
            [
                data.serial_no || null,
                data.supply_order_no || null,
                data.so_date || null,
                (data.firm_name && data.firm_name !== 'null') ? data.firm_name : null,
                (data.nomenclature && data.nomenclature !== 'null') ? data.nomenclature : null,
                (data.quantity && data.quantity !== 'null') ? data.quantity : null,
                data.original_date || null,
                data.revised_date1 || null,
                data.revised_date2 || null,
                data.revised_date3 || null,
                (data.build_up && data.build_up !== 'null') ? data.build_up : null,
                (data.maint && data.maint !== 'null') ? data.maint : null,
                (data.misc && data.misc !== 'null') ? data.misc : null,
                data.project_less_2cr || null,
                data.project_more_2cr || null,
                (data.project_no_pdc && data.project_no_pdc !== 'null') ? data.project_no_pdc : null,
                data.p_np || null,
                data.expenditure_head || null,
                data.rev_cap || null,
                data.imms_demand_no || null,
                data.actual_delivery_date || null,
                (data.procurement_mode && data.procurement_mode !== 'null') ? data.procurement_mode : null,
                data.delivery_done || null,
                (data.remarks && data.remarks !== 'null') ? data.remarks : null,
                data.financial_year || null,
                id,
            ],
        );

        // Update supply order placed status if IMMS demand number is provided
        await updateSupplyOrderPlacedStatus(data.imms_demand_no, data.financial_year);

        // Broadcast the change to all connected clients
        broadcastDataChange('supply', 'update', { ...data, id }, data.financial_year);

        // Also emit a general data update event for homepage
        io.emit('homepage-data-update', {
            type: 'supply',
            action: 'update',
            financial_year: data.financial_year,
            timestamp: new Date().toISOString()
        });

        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.put("/api/demand-orders/:id", async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await pool.query(
            `UPDATE demand_orders SET serial_no = ?, imms_demand_no = ?, demand_date = ?, mmg_control_no = ?, control_date = ?, 
                nomenclature = ?, quantity = ?, expenditure_head = ?, code_head = ?, rev_cap = ?, 
                procurement_mode = ?, est_cost = ?, imms_control_no = ?, supply_order_placed = ?, remarks = ?, financial_year = ? 
             WHERE id = ?`,
            [
                data.serial_no || null,
                data.imms_demand_no || null,
                data.demand_date || null,
                data.mmg_control_no || null,
                data.control_date || null,
                data.nomenclature || null,
                data.quantity || null,
                data.expenditure_head || null,
                data.code_head || null,
                data.rev_cap || null,
                data.procurement_mode || null,
                data.est_cost || null,
                data.imms_control_no || null,
                data.supply_order_placed || null,
                data.remarks || null,
                data.financial_year || null,
                id,
            ],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.put("/api/bill-orders/:id", async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await pool.query(
            `UPDATE bill_orders SET serial_no = ?, bill_control_date = ?, firm_name = ?, supply_order_no = ?, so_date = ?, 
                project_no = ?, build_up = ?, maintenance = ?, project_less_2cr = ?, project_more_2cr = ?, 
                procurement_mode = ?, rev_cap = ?, date_amount_passed = ?, ld_amount = ?, remarks = ?, financial_year = ? 
             WHERE id = ?`,
            [
                data.serial_no || null,
                data.bill_control_date || null,
                (data.firm_name && data.firm_name !== 'null') ? data.firm_name : null,
                data.supply_order_no || null,
                data.so_date || null,
                (data.project_no && data.project_no !== 'null') ? data.project_no : null,
                (data.build_up && data.build_up !== 'null') ? data.build_up : null,
                (data.maintenance && data.maintenance !== 'null') ? data.maintenance : null,
                (data.project_less_2cr && data.project_less_2cr !== 'null') ? data.project_less_2cr : null,
                (data.project_more_2cr && data.project_more_2cr !== 'null') ? data.project_more_2cr : null,
                (data.procurement_mode && data.procurement_mode !== 'null') ? data.procurement_mode : null,
                data.rev_cap || null,
                (data.date_amount_passed && data.date_amount_passed !== 'null') ? data.date_amount_passed : null,
                (data.ld_amount && data.ld_amount !== 'null') ? data.ld_amount : null,
                (data.remarks && data.remarks !== 'null') ? data.remarks : null,
                data.financial_year || null,
                id,
            ],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.delete("/api/supply-orders/:id", requireAuth, async (req, res) => {
    // Check if user has permission to delete
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    try {
        // Get the financial year before deletion for broadcasting
        const [rows] = await pool.query("SELECT financial_year FROM supply_orders WHERE id = ?", [id]);
        const financialYear = rows[0]?.financial_year;

        await pool.query("DELETE FROM supply_orders WHERE id = ?", [id]);

        // Broadcast the change to all connected clients
        if (financialYear) {
            broadcastDataChange('supply', 'delete', { id }, financialYear);

            // Also emit a general data update event for homepage
            io.emit('homepage-data-update', {
                type: 'supply',
                action: 'delete',
                financial_year: financialYear,
                timestamp: new Date().toISOString()
            });
        }

        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.delete("/api/demand-orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM demand_orders WHERE id = ?", [id]);
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.delete("/api/bill-orders/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM bill_orders WHERE id = ?", [id]);
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/supply-orders/move/:id", requireAuth, async (req, res) => {
    // Check if user has permission to move rows
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const { direction, financial_year } = req.body;
    try {
        const [rows] = await pool.query(
            "SELECT id, serial_no FROM supply_orders WHERE financial_year = ? ORDER BY serial_no",
            [financial_year],
        );
        const currentIndex = rows.findIndex((row) => row.id == id);
        if (
            currentIndex === -1 ||
            (direction === "up" && currentIndex === 0) ||
            (direction === "down" && currentIndex === rows.length - 1)
        ) {
            return res.status(400).send("Cannot move row");
        }
        const swapIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        await pool.query(
            "UPDATE supply_orders SET serial_no = ? WHERE id = ?",
            [rows[swapIndex].serial_no, rows[currentIndex].id],
        );
        await pool.query(
            "UPDATE supply_orders SET serial_no = ? WHERE id = ?",
            [rows[currentIndex].serial_no, rows[swapIndex].id],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/demand-orders/move/:id", requireAuth, async (req, res) => {
    // Check if user has permission to move rows
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const { direction, financial_year } = req.body;
    try {
        const [rows] = await pool.query(
            "SELECT id, serial_no FROM demand_orders WHERE financial_year = ? ORDER BY serial_no",
            [financial_year],
        );
        const currentIndex = rows.findIndex((row) => row.id == id);
        if (
            currentIndex === -1 ||
            (direction === "up" && currentIndex === 0) ||
            (direction === "down" && currentIndex === rows.length - 1)
        ) {
            return res.status(400).send("Cannot move row");
        }
        const swapIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        await pool.query(
            "UPDATE demand_orders SET serial_no = ? WHERE id = ?",
            [rows[swapIndex].serial_no, rows[currentIndex].id],
        );
        await pool.query(
            "UPDATE demand_orders SET serial_no = ? WHERE id = ?",
            [rows[currentIndex].serial_no, rows[swapIndex].id],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/bill-orders/move/:id", requireAuth, async (req, res) => {
    // Check if user has permission to move rows
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const { direction, financial_year } = req.body;
    try {
        const [rows] = await pool.query(
            "SELECT id, serial_no FROM bill_orders WHERE financial_year = ? ORDER BY serial_no",
            [financial_year],
        );
        const currentIndex = rows.findIndex((row) => row.id == id);
        if (
            currentIndex === -1 ||
            (direction === "up" && currentIndex === 0) ||
            (direction === "down" && currentIndex === rows.length - 1)
        ) {
            return res.status(400).send("Cannot move row");
        }
        const swapIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        await pool.query("UPDATE bill_orders SET serial_no = ? WHERE id = ?", [
            rows[swapIndex].serial_no,
            rows[currentIndex].id,
        ]);
        await pool.query("UPDATE bill_orders SET serial_no = ? WHERE id = ?", [
            rows[currentIndex].serial_no,
            rows[swapIndex].id,
        ]);
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/supply-orders/import", async (req, res) => {
    const { data, financial_year } = req.body;
    try {
        for (const row of data) {
            await pool.query(
                `INSERT INTO supply_orders (serial_no, supply_order_no_date, firm_name, nomenclature, quantity, 
                    original_date, revised_date1, revised_date2, revised_date3, 
                    build_up, maint, misc, project_no_pdc, p_np, expenditure_head, rev_cap, actual_delivery_date,
                    procurement_mode, delivery_done, remarks, financial_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.serial_no || null,
                    row.supply_order_no_date || null,
                    row.firm_name || null,
                    row.nomenclature || null,
                    row.quantity || null,
                    row.original_date || null,
                    row.revised_date1 || null,
                    row.revised_date2 || null,
                    row.revised_date3 || null,
                    row.build_up || null,
                    row.maint || null,
                    row.misc || null,
                    row.project_no_pdc || null,
                    row.p_np || null,
                    row.expenditure_head || null,
                    row.rev_cap || null,
                    row.actual_delivery_date || null,
                    row.procurement_mode || null,
                    row.delivery_done || null,
                    row.remarks || null,
                    financial_year || null,
                ],
            );
        }
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/demand-orders/import", async (req, res) => {
    const { data, financial_year } = req.body;
    try {
        for (const row of data) {
            await pool.query(
                `INSERT INTO demand_orders (serial_no, group_demand_no, demand_date, mmg_control_no, control_date, nomenclature, quantity, 
                    expenditure_head, code_head, rev_cap, procurement_mode, est_cost, imms_control_no, remarks, financial_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.serial_no,
                    row.group_demand_no,
                    row.demand_date || null,
                    row.mmg_control_no,
                    row.control_date || null,
                    row.nomenclature,
                    row.quantity,
                    row.expenditure_head,
                    row.code_head,
                    row.rev_cap,
                    row.procurement_mode,
                    row.est_cost,
                    row.imms_control_no,
                    row.remarks,
                    financial_year,
                ],
            );
        }
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/bill-orders/import", async (req, res) => {
    const { data, financial_year } = req.body;
    try {
        for (const row of data) {
            await pool.query(
                `INSERT INTO bill_orders (serial_no, bill_control_date, firm_name, supply_order_no, so_date, 
                    project_no, build_up, maintenance, project_less_2cr, project_more_2cr, 
                    procurement_mode, rev_cap, date_amount_passed, ld_amount, remarks, financial_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.serial_no,
                    row.bill_control_date || null,
                    row.firm_name,
                    row.supply_order_no,
                    row.so_date || null,
                    row.project_no,
                    row.build_up,
                    row.maintenance,
                    row.project_less_2cr,
                    row.project_more_2cr,
                    row.procurement_mode,
                    row.rev_cap,
                    row.date_amount_passed,
                    row.ld_amount,
                    row.remarks,
                    financial_year,
                ],
            );
        }
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/supply-backups", async (req, res) => {
    try {
        const files = await fs.readdir(backupDirs.supply);
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/demand-backups", async (req, res) => {
    try {
        const files = await fs.readdir(backupDirs.demand);
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/bill-backups", async (req, res) => {
    try {
        const files = await fs.readdir(backupDirs.bill);
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-gen-project-backups", async (req, res) => {
    try {
        const files = await fs.readdir(backupDirs["sanction-gen-project"]);
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-misc-backups", async (req, res) => {
    try {
        const files = await fs.readdir(backupDirs["sanction-misc"]);
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-training-backups", async (req, res) => {
    try {
        const files = await fs.readdir(backupDirs["sanction-training"]);
        res.json(files);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

// Sanction Code Register API endpoints
app.get("/api/sanction-gen-project", async (req, res) => {
    const { year, sort = "serial_no" } = req.query;
    try {
        const [rows] = await pool.query(
            `SELECT id, serial_no, DATE_FORMAT(date, '%Y-%m-%d') as date, file_no, sanction_code, code, 
                    np_proj, power, code_head, rev_cap, amount, uo_no, 
                    DATE_FORMAT(uo_date, '%Y-%m-%d') as uo_date, amendment, financial_year 
             FROM sanction_gen_project WHERE financial_year = ? ORDER BY ${sort}`,
            [year],
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-misc", async (req, res) => {
    const { year, sort = "serial_no" } = req.query;
    try {
        const [rows] = await pool.query(
            `SELECT id, serial_no, DATE_FORMAT(date, '%Y-%m-%d') as date, file_no, sanction_code, code, 
                    np_proj, power, code_head, rev_cap, amount, uo_no, 
                    DATE_FORMAT(uo_date, '%Y-%m-%d') as uo_date, amendment, financial_year 
             FROM sanction_misc WHERE financial_year = ? ORDER BY ${sort}`,
            [year],
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-training", async (req, res) => {
    const { year, sort = "serial_no" } = req.query;
    try {
        const [rows] = await pool.query(
            `SELECT id, serial_no, DATE_FORMAT(date, '%Y-%m-%d') as date, file_no, sanction_code, code, 
                    np_proj, power, code_head, rev_cap, amount, uo_no, 
                    DATE_FORMAT(uo_date, '%Y-%m-%d') as uo_date, amendment, financial_year 
             FROM sanction_training WHERE financial_year = ? ORDER BY ${sort}`,
            [year],
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-gen-project/max-serial", async (req, res) => {
    const { year } = req.query;
    try {
        const [rows] = await pool.query(
            "SELECT MAX(serial_no) as maxSerialNo FROM sanction_gen_project WHERE financial_year = ?",
            [year],
        );
        res.json({ maxSerialNo: rows[0].maxSerialNo || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-misc/max-serial", async (req, res) => {
    const { year } = req.query;
    try {
        const [rows] = await pool.query(
            "SELECT MAX(serial_no) as maxSerialNo FROM sanction_misc WHERE financial_year = ?",
            [year],
        );
        res.json({ maxSerialNo: rows[0].maxSerialNo || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-training/max-serial", async (req, res) => {
    const { year } = req.query;
    try {
        const [rows] = await pool.query(
            "SELECT MAX(serial_no) as maxSerialNo FROM sanction_training WHERE financial_year = ?",
            [year],
        );
        res.json({ maxSerialNo: rows[0].maxSerialNo || 0 });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-gen-project/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT * FROM sanction_gen_project WHERE id = ?",
            [id],
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send("Not found");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-misc/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT * FROM sanction_misc WHERE id = ?",
            [id],
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send("Not found");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/api/sanction-training/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await pool.query(
            "SELECT * FROM sanction_training WHERE id = ?",
            [id],
        );
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send("Not found");
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-gen-project", async (req, res) => {
    const data = req.body;
    try {
        await pool.query(
            `INSERT INTO sanction_gen_project (serial_no, date, file_no, sanction_code, code, np_proj, power, 
                code_head, rev_cap, amount, uo_no, uo_date, amendment, financial_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.serial_no || null,
                data.date || null,
                data.file_no || null,
                data.sanction_code || null,
                data.code || null,
                data.np_proj || null,
                data.power || null,
                data.code_head || null,
                data.rev_cap || null,
                data.amount || null,
                data.uo_no || null,
                data.uo_date || null,
                data.amendment || null,
                data.financial_year || null,
            ],
        );
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-misc", async (req, res) => {
    const data = req.body;
    try {
        await pool.query(
            `INSERT INTO sanction_misc (serial_no, date, file_no, sanction_code, code, np_proj, power, 
                code_head, rev_cap, amount, uo_no, uo_date, amendment, financial_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.serial_no || null,
                data.date || null,
                data.file_no || null,
                data.sanction_code || null,
                data.code || null,
                data.np_proj || null,
                data.power || null,
                data.code_head || null,
                data.rev_cap || null,
                data.amount || null,
                data.uo_no || null,
                data.uo_date || null,
                data.amendment || null,
                data.financial_year || null,
            ],
        );
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-training", async (req, res) => {
    const data = req.body;
    try {
        await pool.query(
            `INSERT INTO sanction_training (serial_no, date, file_no, sanction_code, code, np_proj, power, 
                code_head, rev_cap, amount, uo_no, uo_date, amendment, financial_year) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.serial_no || null,
                data.date || null,
                data.file_no || null,
                data.sanction_code || null,
                data.code || null,
                data.np_proj || null,
                data.power || null,
                data.code_head || null,
                data.rev_cap || null,
                data.amount || null,
                data.uo_no || null,
                data.uo_date || null,
                data.amendment || null,
                data.financial_year || null,
            ],
        );
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.put("/api/sanction-gen-project/:id", async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await pool.query(
            `UPDATE sanction_gen_project SET serial_no = ?, date = ?, file_no = ?, sanction_code = ?, 
                code = ?, np_proj = ?, power = ?, code_head = ?, rev_cap = ?, amount = ?, 
                uo_no = ?, uo_date = ?, amendment = ?, financial_year = ? WHERE id = ?`,
            [
                data.serial_no || null,
                data.date || null,
                data.file_no || null,
                data.sanction_code || null,
                data.code || null,
                data.np_proj || null,
                data.power || null,
                data.code_head || null,
                data.rev_cap || null,
                data.amount || null,
                data.uo_no || null,
                data.uo_date || null,
                data.amendment || null,
                data.financial_year || null,
                id,
            ],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.put("/api/sanction-misc/:id", async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await pool.query(
            `UPDATE sanction_misc SET serial_no = ?, date = ?, file_no = ?, sanction_code = ?, 
                code = ?, np_proj = ?, power = ?, code_head = ?, rev_cap = ?, amount = ?, 
                uo_no = ?, uo_date = ?, amendment = ?, financial_year = ? WHERE id = ?`,
            [
                data.serial_no || null,
                data.date || null,
                data.file_no || null,
                data.sanction_code || null,
                data.code || null,
                data.np_proj || null,
                data.power || null,
                data.code_head || null,
                data.rev_cap || null,
                data.amount || null,
                data.uo_no || null,
                data.uo_date || null,
                data.amendment || null,
                data.financial_year || null,
                id,
            ],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.put("/api/sanction-training/:id", async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    try {
        await pool.query(
            `UPDATE sanction_training SET serial_no = ?, date = ?, file_no = ?, sanction_code = ?, 
                code = ?, np_proj = ?, power = ?, code_head = ?, rev_cap = ?, amount = ?, 
                uo_no = ?, uo_date = ?, amendment = ?, financial_year = ? WHERE id = ?`,
            [
                data.serial_no || null,
                data.date || null,
                data.file_no || null,
                data.sanction_code || null,
                data.code || null,
                data.np_proj || null,
                data.power || null,
                data.code_head || null,
                data.rev_cap || null,
                data.amount || null,
                data.uo_no || null,
                data.uo_date || null,
                data.amendment || null,
                data.financial_year || null,
                id,
            ],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.delete("/api/sanction-gen-project/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM sanction_gen_project WHERE id = ?", [id]);
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.delete("/api/sanction-misc/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM sanction_misc WHERE id = ?", [id]);
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.delete("/api/sanction-training/:id", async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM sanction_training WHERE id = ?", [id]);
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-gen-project/move/:id", requireAuth, async (req, res) => {
    // Check if user has permission to move rows
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const { direction, financial_year } = req.body;
    try {
        const [rows] = await pool.query(
            "SELECT id, serial_no FROM sanction_gen_project WHERE financial_year = ? ORDER BY serial_no",
            [financial_year],
        );
        const currentIndex = rows.findIndex((row) => row.id == id);
        if (
            currentIndex === -1 ||
            (direction === "up" && currentIndex === 0) ||
            (direction === "down" && currentIndex === rows.length - 1)
        ) {
            return res.status(400).send("Cannot move row");
        }
        const swapIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        await pool.query(
            "UPDATE sanction_gen_project SET serial_no = ? WHERE id = ?",
            [rows[swapIndex].serial_no, rows[currentIndex].id],
        );
        await pool.query(
            "UPDATE sanction_gen_project SET serial_no = ? WHERE id = ?",
            [rows[currentIndex].serial_no, rows[swapIndex].id],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-misc/move/:id", requireAuth, async (req, res) => {
    // Check if user has permission to move rows
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const { direction, financial_year } = req.body;
    try {
        const [rows] = await pool.query(
            "SELECT id, serial_no FROM sanction_misc WHERE financial_year = ? ORDER BY serial_no",
            [financial_year],
        );
        const currentIndex = rows.findIndex((row) => row.id == id);
        if (
            currentIndex === -1 ||
            (direction === "up" && currentIndex === 0) ||
            (direction === "down" && currentIndex === rows.length - 1)
        ) {
            return res.status(400).send("Cannot move row");
        }
        const swapIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        await pool.query(
            "UPDATE sanction_misc SET serial_no = ? WHERE id = ?",
            [rows[swapIndex].serial_no, rows[currentIndex].id],
        );
        await pool.query(
            "UPDATE sanction_misc SET serial_no = ? WHERE id = ?",
            [rows[currentIndex].serial_no, rows[swapIndex].id],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-training/move/:id", requireAuth, async (req, res) => {
    // Check if user has permission to move rows
    if (req.session.user.role === 'viewer') {
        return res.status(403).json({ success: false, message: 'Permission denied' });
    }
    const { id } = req.params;
    const { direction, financial_year } = req.body;
    try {
        const [rows] = await pool.query(
            "SELECT id, serial_no FROM sanction_training WHERE financial_year = ? ORDER BY serial_no",
            [financial_year],
        );
        const currentIndex = rows.findIndex((row) => row.id == id);
        if (
            currentIndex === -1 ||
            (direction === "up" && currentIndex === 0) ||
            (direction === "down" && currentIndex === rows.length - 1)
        ) {
            return res.status(400).send("Cannot move row");
        }
        const swapIndex =
            direction === "up" ? currentIndex - 1 : currentIndex + 1;
        await pool.query(
            "UPDATE sanction_training SET serial_no = ? WHERE id = ?",
            [rows[swapIndex].serial_no, rows[currentIndex].id],
        );
        await pool.query(
            "UPDATE sanction_training SET serial_no = ? WHERE id = ?",
            [rows[currentIndex].serial_no, rows[swapIndex].id],
        );
        res.status(200).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-gen-project/import", async (req, res) => {
    const { data, financial_year } = req.body;
    try {
        for (const row of data) {
            await pool.query(
                `INSERT INTO sanction_gen_project (serial_no, date, file_no, sanction_code, code, np_proj, power, 
                    code_head, rev_cap, amount, uo_no, uo_date, amendment, financial_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.serial_no,
                    row.date || null,
                    row.file_no,
                    row.sanction_code,
                    row.code,
                    row.np_proj,
                    row.power,
                    row.code_head,
                    row.rev_cap,
                    row.amount,
                    row.uo_no,
                    row.uo_date || null,
                    row.amendment,
                    financial_year,
                ],
            );
        }
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-misc/import", async (req, res) => {
    const { data, financial_year } = req.body;
    try {
        for (const row of data) {
            await pool.query(
                `INSERT INTO sanction_misc (serial_no, date, file_no, sanction_code, code, np_proj, power, 
                    code_head, rev_cap, amount, uo_no, uo_date, amendment, financial_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.serial_no,
                    row.date || null,
                    row.file_no,
                    row.sanction_code,
                    row.code,
                    row.np_proj,
                    row.power,
                    row.code_head,
                    row.rev_cap,
                    row.amount,
                    row.uo_no,
                    row.uo_date || null,
                    row.amendment,
                    financial_year,
                ],
            );
        }
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/api/sanction-training/import", async (req, res) => {
    const { data, financial_year } = req.body;
    try {
        for (const row of data) {
            await pool.query(
                `INSERT INTO sanction_training (serial_no, date, file_no, sanction_code, code, np_proj, power, 
                    code_head, rev_cap, amount, uo_no, uo_date, amendment, financial_year) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.serial_no,
                    row.date || null,
                    row.file_no,
                    row.sanction_code,
                    row.code,
                    row.np_proj,
                    row.power,
                    row.code_head,
                    row.rev_cap,
                    row.amount,
                    row.uo_no,
                    row.uo_date || null,
                    row.amendment,
                    financial_year,
                ],
            );
        }
        res.status(201).send();
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

// Dashboard analytics endpoints
app.get("/api/dashboard/overview", requireAuth, async (req, res) => {
    const { year } = req.query;
    try {
        const [supplyResult, demandResult, billResult] = await Promise.all([
            pool.query("SELECT COUNT(*) as count FROM supply_orders WHERE financial_year = ?", [year]),
            pool.query("SELECT COUNT(*) as count FROM demand_orders WHERE financial_year = ?", [year]),
            pool.query("SELECT COUNT(*) as count FROM bill_orders WHERE financial_year = ?", [year])
        ]);

        const [deliveredResult] = await pool.query(
            "SELECT COUNT(*) as count FROM supply_orders WHERE financial_year = ? AND delivery_done = 'Yes'", 
            [year]
        );

        const [totalValueResult] = await pool.query(
            "SELECT SUM(build_up + maintenance + project_less_2cr + project_more_2cr) as total FROM bill_orders WHERE financial_year = ?", 
            [year]
        );

        res.json({
            totalSupply: supplyResult[0][0].count,
            totalDemand: demandResult[0][0].count,
            totalBill: billResult[0][0].count,
            deliveredOrders: deliveredResult[0][0].count,
            totalValue: totalValueResult[0][0].total || 0
        });
    } catch (error) {
        console.error("Dashboard overview error:", error);
        res.status(500).json({ error: "Failed to fetch dashboard overview" });
    }
});

app.get("/api/dashboard/trends", requireAuth, async (req, res) => {
    const { year } = req.query;
    try {
        const [monthlySupply] = await pool.query(
            `SELECT DATE_FORMAT(original_date, '%Y-%m') as month, COUNT(*) as count 
             FROM supply_orders 
             WHERE financial_year = ? AND original_date IS NOT NULL 
             GROUP BY DATE_FORMAT(original_date, '%Y-%m') 
             ORDER BY month`, 
            [year]
        );

        const [monthlyDemand] = await pool.query(
            `SELECT DATE_FORMAT(demand_date, '%Y-%m') as month, COUNT(*) as count 
             FROM demand_orders 
             WHERE financial_year = ? AND demand_date IS NOT NULL 
             GROUP BY DATE_FORMAT(demand_date, '%Y-%m') 
             ORDER BY month`, 
            [year]
        );

        const [monthlyBill] = await pool.query(
            `SELECT DATE_FORMAT(bill_control_date, '%Y-%m') as month, COUNT(*) as count 
             FROM bill_orders 
             WHERE financial_year = ? AND bill_control_date IS NOT NULL 
             GROUP BY DATE_FORMAT(bill_control_date, '%Y-%m') 
             ORDER BY month`, 
            [year]
        );

        res.json({
            supply: monthlySupply[0],
            demand: monthlyDemand[0],
            bill: monthlyBill[0]
        });
    } catch (error) {
        console.error("Dashboard trends error:", error);
        res.status(500).json({ error: "Failed to fetch dashboard trends" });
    }
});

app.get("/api/dashboard/procurement-analysis", requireAuth, async (req, res) => {
    const { year } = req.query;
    try {
        const [procurementData] = await pool.query(
            `SELECT procurement_mode, COUNT(*) as count 
             FROM supply_orders 
             WHERE financial_year = ? 
             GROUP BY procurement_mode`, 
            [year]
        );

        res.json(procurementData[0]);
    } catch (error) {
        console.error("Procurement analysis error:", error);
        res.status(500).json({ error: "Failed to fetch procurement analysis" });
    }
});

app.get("/api/dashboard/firm-analysis", requireAuth, async (req, res) => {
    const { year } = req.query;
    try {
        const [firmData] = await pool.query(
            `SELECT firm_name, COUNT(*) as count 
             FROM supply_orders 
             WHERE financial_year = ? 
             GROUP BY firm_name 
             ORDER BY count DESC 
             LIMIT 10`, 
            [year]
        );

        res.json(firmData[0]);
    } catch (error) {
        console.error("Firm analysis error:", error);
        res.status(500).json({ error: "Failed to fetch firm analysis" });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
});

// Enhanced memory cleanup interval
setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - 300000;

    // Clean up abandoned games
    for (let [gameId, game] of chessGames.entries()) {
        if (game.status === 'abandoned' && new Date(game.createdAt).getTime() < fiveMinutesAgo) {
            chessGames.delete(gameId);
        }
    }

    for (let [gameId, game] of ludoGames.entries()) {
        if (game.status === 'abandoned' && new Date(game.createdAt).getTime() < fiveMinutesAgo) {
            ludoGames.delete(gameId);
        }
    }

    for (let [gameId, game] of ticTacToeGames.entries()) {
        if (game.status === 'abandoned' && new Date(game.createdAt).getTime() < fiveMinutesAgo) {
            ticTacToeGames.delete(gameId);
        }
    }

    for (let [gameId, game] of unoGames.entries()) {
        if (game.status === 'abandoned' && new Date(game.createdAt).getTime() < fiveMinutesAgo) {
            unoGames.delete(gameId);
        }
    }

    // Clean up expired cache entries
    const cacheExpiry = now - CACHE_DURATION;
    const homepageCacheExpiry = now - HOMEPAGE_CACHE_DURATION;

    for (let [key, value] of dataCache.entries()) {
        if (value.timestamp < cacheExpiry) {
            dataCache.delete(key);
        }
    }

    for (let [key, value] of homepageCache.entries()) {
        if (value.timestamp < homepageCacheExpiry) {
            homepageCache.delete(key);
        }
    }

    // Log memory usage with detailed connection info
    const memUsage = process.memoryUsage();
    console.log(`Memory Usage - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    console.log(`Connections - Total: ${activeConnections}, Homepage: ${homepageConnections}, Auth: ${authenticatedConnections}`);
    console.log(`Cache - Data: ${dataCache.size}, Homepage: ${homepageCache.size}`);
    console.log(`Games - Chess: ${chessGames.size}, Ludo: ${ludoGames.size}, TicTacToe: ${ticTacToeGames.size}, UNO: ${unoGames.size}`);
}, 60000); // Run every minute

// Graceful shutdown handlers to save visitor count
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, saving visitor count...');
    await saveVisitorCount();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, saving visitor count...');
    await saveVisitorCount();
    process.exit(0);
});

process.on('exit', () => {
    console.log('Process exiting...');
});

// Enhanced server startup with port conflict handling
const startServer = () => {
    server.listen(port, "0.0.0.0", () => {
        console.log(`Server running on http://0.0.0.0:${port}`);
    });

    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.log(
                `Port ${port} is already in use. Trying to kill existing process...`,
            );

            // For Replit environment, try a different port
            const newPort = port + 1;
            console.log(`Attempting to start server on port ${newPort}...`);

            server.listen(newPort, "0.0.0.0", () => {
                console.log(`Server running on http://0.0.0.0:${newPort}`);
            });

            server.on("error", (newErr) => {
                console.error(
                    "Failed to start server on alternative port:",
                    newErr,
                );
                process.exit(1);
            });
        } else {
            console.error("Server error:", err);
            process.exit(1);
        }
    });
};

startServer();