import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const prismaDir = __dirname;
const sourcePrismaDir = path.resolve(process.cwd(), 'prisma');
const seedFiles = fs
  .readdirSync(sourcePrismaDir)
  .filter((file) => /^seed-.*\.ts$/.test(file))
  .sort((first, second) => {
    if (first === 'seed-regions-demo.ts') {
      return -1;
    }

    if (second === 'seed-regions-demo.ts') {
      return 1;
    }

    return first.localeCompare(second);
  });

for (const seedFile of seedFiles) {
  const seedPath =
    path.extname(__filename) === '.ts'
      ? path.join(sourcePrismaDir, seedFile)
      : path.join(prismaDir, seedFile.replace(/\.ts$/, '.js'));

  console.log(`Running ${path.relative(process.cwd(), seedPath)}...`);

  const result =
    path.extname(__filename) === '.ts'
      ? spawnSync('ts-node', ['-r', 'tsconfig-paths/register', seedPath], {
          stdio: 'inherit',
        })
      : spawnSync(
          process.execPath,
          ['-r', 'tsconfig-paths/register', seedPath],
          {
            stdio: 'inherit',
          },
        );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
