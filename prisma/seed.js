require('dotenv').config();
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client'); 

const dbUrl = process.env.DATABASE_URL || "file:./dev.db";
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const students = [
  { studentId: 10001, name: "Adithya K.", paidStatus: 1 },
  { studentId: 10002, name: "Sneha Roy", paidStatus: 1 },
  { studentId: 10003, name: "Rohan Sharma", paidStatus: 0 },
  { studentId: 10004, name: "Anjali Nair", paidStatus: 1 },
  { studentId: 10005, name: "Vikram Malhotra", paidStatus: 0 },
  { studentId: 10006, name: "Priya Patel", paidStatus: 1 },
  { studentId: 10007, name: "Kabir Singh", paidStatus: 1 },
  { studentId: 10008, name: "Meera Krishnan", paidStatus: 0 },
  { studentId: 10009, name: "Arjun Verma", paidStatus: 1 },
  { studentId: 10010, name: "Diya Sengupta", paidStatus: 1 }
];

async function main() {
  console.log("Clearing existing student and redemption records...");
  await prisma.mealRedemption.deleteMany({});
  await prisma.student.deleteMany({});
  
  console.log("Seeding student records into SQLite...");
  for (const student of students) {
    await prisma.student.create({
      data: student
    });
  }
  
  console.log(`Successfully seeded ${students.length} hostler students.`);
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
