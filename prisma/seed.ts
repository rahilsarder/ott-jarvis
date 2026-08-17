import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/crypto';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@jarvis.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123';

  await prisma.jarvisUser.upsert({
    where: { email },
    update: { passwordHash: hashPassword(password) },
    create: { email, passwordHash: hashPassword(password) },
  });

  console.log(`Seeded Jarvis admin: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
