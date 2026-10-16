// Cookie only: Lighthouse retains cookies while clearing the HTTP cache each run.
// Uses actual provider traffic. These reports never replace activation on the real Pixel.
module.exports = async browser => {
  const url=process.env.LANDING_PERF_URL || 'http://localhost:44170/';
  const page = await browser.newPage();
  await page.deleteCookie({name:'landing_consent',url});
  if(process.env.LANDING_PERF_CONSENT === 'accepted')
    await page.setCookie({name:'landing_consent',value:'accepted',url});
  await page.close();
};
