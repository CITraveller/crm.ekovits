import dotenv from "dotenv";

dotenv.config();

const dbPassword = process.env.DB_PASSWORD;

export const env = {
  port: Number(process.env.PORT || 5000),
  clientUrl: process.env.CLIENT_URL || "http://127.0.0.1:5173",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  sessionSecret: process.env.SESSION_SECRET || process.env.DB_PASSWORD || "change-this-session-secret",
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "ekovits_invoice",
    user: process.env.DB_USER || "postgres",
    password: dbPassword && dbPassword !== "YOUR_POSTGRES_PASSWORD" ? dbPassword : ""
  }
};
