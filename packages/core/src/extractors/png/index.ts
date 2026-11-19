import type { Extractor, GhostKind } from '../../types.ts';
import { trailingGhosts } from '../../shared/trailing.ts';
import { walkPng } from './walk.ts';

/**
 * PNG extractor. `detects` lists ONLY what is implemented today, so every other kind the
 * format can carry is honestly reported as unchecked (G6). Grow it as image-ghosts tasks land.
 */
export const pngExtractor: Extractor = {
  kind: 'png',
  detects: ['trailing-data'] satisfies GhostKind[],
  async extract(bytes, ctx) {
    const walk = walkPng(bytes, ctx.signal);
    const unchecked: GhostKind[] = [];
    if (walk.iendEnd === undefined) {
      walk.warnings.push({ code: 'no-end-marker', message: 'no IEND chunk, so trailing data could not be checked' });
      unchecked.push('trailing-data', 'recovered-image');
      return { ghosts: [], warnings: walk.warnings, unchecked };
    }
    const ghosts = walk.iendEnd < bytes.length ? await trailingGhosts(bytes, walk.iendEnd, 'png', ctx) : [];
    return { ghosts, warnings: walk.warnings, unchecked };
  },
};
