/**
 * Database connection pool configuration for MySQL
 * Creates a connection pool for efficient database operations
 * Used by: auth.js, server.js for all database operations
 * Dependencies: mysql2/promise for async MySQL operations
 * 
 * Configuration optimized for:
 * - High concurrency (50 connections)
 * - 150 homepage users + 100 authenticated users
 * - Fast timeout handling for better UX
 * - Automatic reconnection and connection management
 */
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: "sql.freedb.tech",
    user: "freedb_sharma",
    password: "mvvbvpD?mgEfqQ2",
    database: "freedb_shashank",
    connectionLimit: 50, // Reduced for better resource management
    acquireTimeout: 30000, // Faster timeout for high concurrency
    timeout: 30000,
    queueLimit: 150, // Accommodate 150 homepage users
    reconnect: true,
    idleTimeout: 180000, // 3 minutes idle timeout
    maxIdle: 25, // Keep fewer idle connections
    supportBigNumbers: true,
    bigNumberStrings: true,
    charset: 'utf8mb4'
});

module.exports = pool;
