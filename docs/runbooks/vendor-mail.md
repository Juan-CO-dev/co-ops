MERGE GATE: apply + verify 0297 in prod first; this code stores application/json assets and writes 0297 columns

# Vendor mail

Migration 0297 remains an unapplied file in this change. CC applies and verifies it before merging the application change. Verify that the receipts bucket is private, accepts all MIME types, and has a 41943040-byte file limit.

Vendor fetches share a 40 MiB message budget. Archive-only body/header entries and unsupported MIME types never enter the receipt parser. Storage failures fail ingest before a receipt is inserted; archive_error describes completed archive omissions only (`size` or `unavailable`).

The inbound health list includes skipped catering messages routed by the catering address, so operators can redrive the pre-cutover backlog.
