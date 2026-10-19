import approved from '../assets/approved-media.json';

type Entry = (typeof approved.media)[number];
export interface ApprovedFile { id: string; publicPath: string; sha256: string; entry: Entry }
/** Every shipped file in the approval manifest; frame sequences expand to their frames. */
export const approvedFiles: ApprovedFile[] = approved.media.flatMap((entry): ApprovedFile[] =>
  'frames' in entry && Array.isArray(entry.frames)
    ? entry.frames.map((frame, index) => ({ id: `${entry.id}-f${String(index).padStart(2, '0')}`, publicPath: frame.publicPath, sha256: frame.sha256, entry }))
    : [{ id: entry.id, publicPath: entry.publicPath!, sha256: entry.sha256!, entry }]);
