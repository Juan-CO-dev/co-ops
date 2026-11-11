import "server-only";
import type { AuthContext } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import { readVendorMailRow, vendorMailAssetEntries, VendorMailError } from "./vendor-mail";

export async function signVendorMailAsset(ctx: AuthContext, id: string, assetId: string) {
  const row = await readVendorMailRow(ctx, id);
  const asset = vendorMailAssetEntries(row).find(entry => entry.id === assetId);
  if (!asset?.path || asset.omitted) throw new VendorMailError(404, "not_found");
  // Arbitrary external content is always downloaded, never rendered as trusted HTML.
  const { data, error } = await getServiceRoleClient().storage.from("receipts").createSignedUrl(asset.path, 60, { download: asset.filename });
  if (error || !data?.signedUrl) throw new VendorMailError(503, "asset_unavailable");
  return { signed_url: data.signedUrl, expires_in: 60, filename: asset.filename, content_type: asset.contentType };
}
