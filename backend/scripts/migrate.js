const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');
const { Client } = require('pg');

// Load environment variables
const envPaths = [
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

// Locate migration SQL file
const migrationFilePaths = [
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261014101323_create_chatbot_tables.sql'),
  path.join(__dirname, '..', '..', 'supabase_schema.sql')
];

let sqlPath = migrationFilePaths.find(p => fs.existsSync(p));
if (!sqlPath) {
  console.error('❌ Could not locate migration SQL file.');
  process.exit(1);
}

const sqlContent = fs.readFileSync(sqlPath, 'utf8');

// Extract Project Ref
const supabaseUrl = process.env.SUPABASE_URL || '';
const projectRefMatch = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
const projectRef = projectRefMatch ? projectRefMatch[1] : 'zzbjjrsoqtlmgehgbnkz';

function askPassword(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(promptText, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function runMigration() {
  console.log(`=======================================================`);
  console.log(`⚡ Supabase Database Migration Runner`);
  console.log(`📁 Migration File: ${path.basename(sqlPath)}`);
  console.log(`📡 Project Ref: ${projectRef}`);
  console.log(`=======================================================`);

  let dbUrl = process.env.DATABASE_URL;
  let dbPassword = process.env.SUPABASE_DB_PASSWORD || process.argv[2];

  if (!dbUrl && !dbPassword) {
    console.log(`\n🔑 Database Password Required:`);
    console.log(`To connect directly to PostgreSQL on Supabase, enter the database`);
    console.log(`password you created when creating your Supabase project.\n`);
    dbPassword = await askPassword(`Enter Supabase Database Password: `);
    if (!dbPassword) {
      console.error(`\n❌ Password cannot be empty.`);
      console.log(`💡 Tip: You can also set SUPABASE_DB_PASSWORD in backend/.env or run with:`);
      console.log(`   npm run db:migrate -- <your-password>\n`);
      process.exit(1);
    }
  }

  // Construct connection URL if not provided directly
  if (!dbUrl) {
    const encodedPassword = encodeURIComponent(dbPassword);
    dbUrl = `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`;
  }

  console.log(`\n⏳ Connecting to Supabase PostgreSQL database...`);
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    await client.connect();
    console.log(`✅ Connected successfully to remote database.`);

    console.log(`⏳ Executing migration script...`);
    await client.query(sqlContent);
    console.log(`✅ Migration SQL executed successfully.`);

    // Verify tables
    const checkTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('chats', 'messages');
    `);

    const tables = checkTables.rows.map(r => r.table_name);
    console.log(`\n📋 Verification of Created Tables:`);
    console.log(`  ${tables.includes('chats') ? '✅' : '❌'} public.chats`);
    console.log(`  ${tables.includes('messages') ? '✅' : '❌'} public.messages`);

    // Check Row Level Security
    const checkRLS = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename IN ('chats', 'messages');
    `);
    console.log(`🔒 Row Level Security (RLS) Status:`);
    checkRLS.rows.forEach(r => {
      console.log(`  ${r.rowsecurity ? '✅' : '❌'} ${r.tablename}: RLS ${r.rowsecurity ? 'Enabled' : 'Disabled'}`);
    });

    console.log(`\n=======================================================`);
    console.log(`🎉 Supabase Migration Complete! All tables are ready.`);
    console.log(`=======================================================\n`);
  } catch (err) {
    console.error(`\n❌ Migration failed:`, err.message);
    if (err.message.includes('password authentication failed')) {
      console.error(`💡 The database password was incorrect. Check your Supabase database password in Project Settings -> Database.`);
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('ETIMEDOUT')) {
      console.error(`💡 Connection timed out. You may also run the migration directly in the Supabase Dashboard SQL Editor.`);
    }
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

runMigration();
