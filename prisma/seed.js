/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

let prisma;
const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl?.startsWith('postgresql://') || databaseUrl?.startsWith('postgres://')) {
  const { Pool } = require('pg');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
} else if (databaseUrl?.startsWith('file:')) {
  const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  prisma = new PrismaClient({ adapter });
} else {
  prisma = new PrismaClient();
}

async function main() {
  console.log('Generating password hash...');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('password123', salt);

  console.log('Flushing database...');
  await prisma.authenticator.deleteMany({});
  await prisma.mealRedemption.deleteMany({});
  await prisma.student.deleteMany({});
  await prisma.warden.deleteMany({});

  console.log('Seeding database with demo accounts...');

  // 1. Create Paid Student
  await prisma.student.upsert({
    where: { studentId: 10001 },
    update: {},
    create: {
      studentId: 10001,
      name: 'Elena Rodriguez (Paid)',
      paidStatus: 1, // Cleared
      passwordHash: passwordHash
    }
  });

  // 2. Create Unpaid Student
  await prisma.student.upsert({
    where: { studentId: 10002 },
    update: {},
    create: {
      studentId: 10002,
      name: 'Marcus Chen (Unpaid)',
      paidStatus: 0, // Suspended
      passwordHash: passwordHash
    }
  });

  // 3. Create Unregistered Demo Student
  await prisma.student.upsert({
    where: { studentId: 10003 },
    update: {},
    create: {
      studentId: 10003,
      name: 'Aisha Patel (New)',
      paidStatus: 1, // Cleared
      passwordHash: null
    }
  });

  // 4. Create Warden Account
  await prisma.warden.upsert({
    where: { username: 'warden_demo' },
    update: {},
    create: {
      username: 'warden_demo',
      name: 'Warden Demo',
      passwordHash: passwordHash
    }
  });

  console.log('Seeding completed successfully:');
  console.log(' - Student: 10001 (Paid) | Pass: password123');
  console.log(' - Student: 10002 (Unpaid) | Pass: password123');
  console.log(' - Student: 10003 (New) | Pass: <unregistered>');
  console.log(' - Warden: warden_demo | Pass: password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
