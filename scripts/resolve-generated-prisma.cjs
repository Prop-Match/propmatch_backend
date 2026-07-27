// Prisma's custom TypeScript generator emits relative `.js` specifiers while
// this repository keeps only the corresponding `.ts` sources. ts-node's CJS
// resolver does not remap those specifiers, so do it only for generated Prisma
// modules used by the maintenance reindex command.
const Module = require('module');
const path = require('path');

const originalResolveFilename = Module._resolveFilename;
const generatedPrismaPath = `${path.sep}generated${path.sep}prisma${path.sep}`;

Module._resolveFilename = function resolveGeneratedPrismaTs(
  request,
  parent,
  isMain,
  options,
) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    const isGeneratedPrismaImport = parent?.filename?.includes(generatedPrismaPath);
    if (isGeneratedPrismaImport && request.endsWith('.js')) {
      return originalResolveFilename.call(
        this,
        `${request.slice(0, -3)}.ts`,
        parent,
        isMain,
        options,
      );
    }
    throw error;
  }
};
