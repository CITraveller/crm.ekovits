import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.port!=='55432')throw Error('This helper only configures the dedicated local development database');
url.pathname='/postgres';const pool=new pg.Pool({connectionString:url.href});
try{if(!(await pool.query("SELECT 1 FROM pg_database WHERE datname='crm_module'")).rowCount)await pool.query('CREATE DATABASE crm_module');fs.writeFileSync('.local/login.txt','Orbit CRM local sign-in\nEmail: '+process.env.ADMIN_EMAIL+'\nPassword: '+process.env.ADMIN_PASSWORD+'\n');console.log('Dedicated database and local sign-in file ready.');}finally{await pool.end();}
