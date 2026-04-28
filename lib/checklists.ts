/**
 * Checklist instance lifecycle — Phase 6.
 *
 * Functions:
 *   - getOrCreateInstance(templateId, locationId, date)
 *   - completeItem(instanceId, templateItemId, userId, payload)
 *     - Validates min_role_level <= user level
 *     - Marks any prior completion of same item as superseded (service role)
 *   - submitBatch(instanceId, completionIds, userId)
 *   - confirmInstance(instanceId, pin, incompleteReasons[])
 *     - Validates PIN against pin_hash
 *     - Inserts checklist_incomplete_reasons
 *     - Updates instance status + confirmed_at + confirmed_by
 *   - rejectIfPrepLocked(instanceId)
 *     - Enforces single_submission_only for prep templates
 */
export {};
