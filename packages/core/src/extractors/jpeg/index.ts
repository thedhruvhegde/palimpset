import type { Extractor, GhostKind } from '../../types.ts';
import { trailingGhosts } from '../../shared/trailing.ts';
import { walkJpeg } from './walk.ts';

/** JPEG extractor. Like PNG, `detects` grows only as features are implemented (G6). */
export const jpegExtractor: Extractor = {
  kind: 'jpeg',
  detects: ['trailing-data'] satisfies GhostKind[],
  async extract(bytes, ctx) {
    const walk = walkJpeg(bytes, ctx.signal);
    if (walk.eoiEnd === undefined) {
      walk.warnings.push({ code: 'no-end-marker', message: 'no EOI marker, so trailing data could not be checked' });
      return { ghosts: [], warnings: walk.warnings, unchecked: ['trailing-data', 'recovered-image'] };
    }
    const ghosts = walk.eoiEnd < bytes.length ? await trailingGhosts(bytes, walk.eoiEnd, 'jpeg', ctx) : [];
    return { ghosts, warnings: walk.warnings, unchecked: [] };
  },
};
