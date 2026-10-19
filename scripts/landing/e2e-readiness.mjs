/** Next's listening message precedes lazy route initialization. Warm complete
 * responses before releasing concurrent browsers; never retry a broken route. */
export async function warmRoutes(urls,fetcher=fetch) {
 for(const url of urls) {
  const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  await response.text();
  if(response.status!==200)throw Error(`Landing readiness ${url}: HTTP ${response.status}`);
 }
}
