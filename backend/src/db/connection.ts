import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '051001',
  database: process.env.DB_NAME || 'travel_agent_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true,
  timezone: '+08:00'
});

/**
 * 验证数据库连通性
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT 1 as is_alive');
    connection.release();
    const isHealthy = Array.isArray(rows) && rows.length > 0;
    if (isHealthy) {
      console.log('✅ [Database] MySQL 数据库连接成功 (travel_agent_db)');
    }
    return isHealthy;
  } catch (error: any) {
    console.error('❌ [Database] MySQL 数据库连接失败:', error.message);
    return false;
  }
}
