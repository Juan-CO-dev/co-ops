/**
 * Photo upload / read — Phase 6.
 *
 * uploadPhoto(file, { relatedTable, relatedId, category, caption? }):
 *   - Generates storage_path: photos/{related_table}/{related_id}/{uuid}.{ext}
 *   - Uploads to Supabase Storage (bucket: report-photos)
 *   - Inserts report_photos row
 *   - Returns ReportPhoto
 *
 * getPhotoUrl(photoId): signed URL via service role
 * getPhotosFor(relatedTable, relatedId): ReportPhoto[]
 */
export {};
