/**
 * Writes the OpenAPI 3 contract to openapi/openapi.json (committed), so a frontend can
 * generate types without a running server:
 *   npx openapi-typescript ../teslapool-backend/openapi/openapi.json -o src/lib/api-types.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import '../src/app'; // importing the modules registers every schema and path
import { openApiDocument } from '../src/docs/openapi';

const out = path.join(__dirname, '../openapi/openapi.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
const doc = openApiDocument();
console.log(`Wrote ${path.relative(process.cwd(), out)}: ${Object.keys(doc.paths).length} paths, ${Object.keys(doc.components?.schemas ?? {}).length} schemas`);
