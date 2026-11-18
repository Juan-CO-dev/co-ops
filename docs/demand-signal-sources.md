# Demand-signal sources for Washington, DC (item 4 PR 2)

Researched 2026-11-18. Juan's instruction: **free sources only**, as many as can be found, each with its URL, what it gives, whether its terms were read, and whether the gate should allow it. Paid services are listed separately at the end, for Pete.

This file is the readable copy. The data itself is `docs/seed/demand-sources-dc-2026-11-18.json` (plus the NWS definition in `lib/demand-signals/nws-shared.ts`); `tests/demand-signals-sources.test.ts` fails if a source is in one and not the other.

## How to read it

- **Every source ships `unverified`.** Registering a source grants nothing. The app requests nothing from a source, and uses nothing stored from it, until a Manager of Operations, the Owner or the CGS marks its current definition **verified** (Tier B, audited with who and when).
- **Only one adapter exists: NWS.** Every other row is registered so the decision is on record; building its adapter is a later PR.
- **Terms status** says whether the official terms page was read on 2026-11-18 and a sentence quoted. The pages were read through a page-fetch tool, so **whoever marks a source verified re-reads its terms page first**. That is what the mark is for.
- **Gate** is the recommendation recorded with the source:

| Gate | Meaning | Can it be marked verified? | Count |
|---|---|---|---|
| Allow | Terms read; they permit our internal operational use | Yes | 2 |
| Allow with conditions | Terms read; allowed if the listed conditions are met (a key, a rate, attribution, no raw archive) | Yes | 7 |
| Not yet: terms unread | A real feed, but nobody has read terms that settle it | No. Read the terms, then register a new definition | 14 |
| By hand only | No machine feed (a web page or a PDF). A GM or above enters these events by hand | No | 22 |
| Refuse | The terms forbid automated or commercial use, or could not be read at all | No | 10 |

55 sources in all. A source's gate is part of its definition: changing it (for example after someone reads the terms) is a new definition, which is unverified until marked.

**Not a source:** federal holidays are computed in code from the statute (5 U.S.C. 6103: the eleven holidays, the Friday observance of a Saturday holiday, Inauguration Day every fourth year). No feed is involved.

## Allow (2)

| Source (id) | What it gives | Terms | Notes |
|---|---|---|---|
| [U.S. Senate tentative legislative schedule](https://www.senate.gov/legislative/2026_schedule.htm) (`senate_schedule`) | Days the Senate expects to be in session or in recess. Session days bring staff and visitors to Capitol Hill. | VERIFIED. [Terms](https://www.senate.gov/general/privacy.htm): "Information presented on this site is considered public information and may be distributed or copied" | Condition: Poll rarely (the schedule changes a few times a year). Condition: The URL carries the year: a new definition is needed each January. Tentative and changes. Pro forma sessions are not real attendance. |
| [Open Data DC: DDOT TOPS public space and occupancy permits](https://opendata.dc.gov/) (`dc_open_data_tops`) | Permitted street and lane closures (construction, block parties, events) that block access near a shop. | VERIFIED. [Terms](https://dc.gov/page/terms-and-conditions-use-district-data): "You can copy, modify, distribute, and perform the data, even for commercial purposes, all without asking permission." | Condition: Credit DDOT / Open Data DC where shown (requested, not required). DDOT warns that the US Park Police, Capitol Police, NPS and the Architect of the Capitol can close roads without it reaching this dataset. One catalogue lists the dataset as CC BY 4.0 rather than CC0; attribution satisfies both. |

## Allow with conditions (7)

| Source (id) | What it gives | Terms | Notes |
|---|---|---|---|
| [National Weather Service API (api.weather.gov)](https://www.weather.gov/documentation/services-web-api) (`nws`) | Hourly forecast for about seven days and active watches, warnings and advisories for a point. | VERIFIED. [Terms](https://www.weather.gov/documentation/services-web-api): "All of the information presented via the API is intended to be open data, free to use for any purpose." | The ONLY source with an adapter in this PR. The hourly forecast reaches about 6.5 days. Needs an identifying User-Agent. |
| [WMATA developer API, GTFS and GTFS-realtime](https://developer.wmata.com/) (`wmata_api`) | Rail and bus incidents, advisories and elevator outages. A disruption changes commuter foot traffic near a station. | VERIFIED. [Terms](https://developer.wmata.com/license): "revocable license to download, use, reproduce, and redistribute WMATA's Transit Data within your Application" | Condition: Our own registered key (the public demo key is for limited testing only). Condition: No sharing of the data outside the application's users; no WMATA marks or implied endorsement. Condition: On termination every stored copy of WMATA data must be deleted: store derived facts only (a disruption on a date), never raw payloads in an append-only table. Condition: Respect the call limits of the key's tier. The licence is revocable. Exact endpoint URLs sit behind the developer portal and were not read; a definition with the real endpoints is needed before an adapter is built. |
| [Capital Bikeshare GBFS](https://capitalbikeshare.com/system-data) (`capital_bikeshare_gbfs`) | Live bike and dock counts per station: a weak proxy for foot traffic near a shop. | VERIFIED. [Terms](https://capitalbikeshare.com/data-license-agreement): "grants to you a non-exclusive, royalty-free, limited, perpetual license to access, reproduce" | Condition: Internal use only: the data may not be hosted, published or sold as a stand-alone dataset. Condition: No implied endorsement. Not a forward signal, and history exists only if we store snapshots. Low priority. |
| [National Park Service API: events at the National Mall](https://www.nps.gov/subjects/developer/guides.htm) (`nps_events`) | NPS-run programmes at National Mall and Memorial Parks. | VERIFIED. [Terms](https://www.nps.gov/aboutus/disclaimer.htm): "a citation or acknowledgement of the National Park Service as the source is appreciated" | Condition: Our own key. Condition: Credit the National Park Service where shown. Condition: Stay under 1,000 requests an hour. It lists ranger programmes, not the permitted demonstrations and festivals that move demand. Those are entered by hand. |
| [BALLDONTLIE sports API (free tier)](https://www.balldontlie.io/) (`balldontlie`) | Game schedules for MLB, NHL, NFL, WNBA and others. | VERIFIED. [Terms](https://www.balldontlie.io/terms.html): "You may use Data you lawfully obtain for any lawful personal or commercial purpose, subject to these Terms." | Condition: Our own key. Condition: Stay inside 5 requests a minute. Condition: Confirm which schedule endpoints the free tier includes before building an adapter (NBA needs a paid plan). Which schedule endpoints are free was not verified. |
| [Ticketmaster Discovery API](https://developer.ticketmaster.com/) (`ticketmaster_discovery`) | Events by venue and date for Capital One Arena, The Anthem, the 9:30 Club, Audi Field and Nationals Park (their tickets are sold through it). | VERIFIED. [Terms](https://developer.ticketmaster.com/support/terms-of-use/): "Cache or store any Event Content other than for reasonable periods in order to provide the service you are providing." | Condition: Our own key, inside the daily quota. Condition: No permanent archive of event content: keep only derived facts (date, venue, size class) and re-fetch. Condition: Internal use only; nothing that replaces Ticketmaster. The quote is from the list of things a developer must NOT do. The caching clause conflicts with an append-only table of raw event content: an adapter must be designed around that before this is marked verified. |
| [GDELT Project news API](https://www.gdeltproject.org/) (`gdelt`) | Searchable world news coverage: could surface a planned march, strike or closure. | VERIFIED. [Terms](https://www.gdeltproject.org/about.html): "any use or redistribution of the data must include a citation to the GDELT Project and a link to this website" | Condition: Cite the GDELT Project with a link wherever its data is shown. Condition: At most one request every 5 seconds. Headlines are not events: turning coverage into a dated event needs a reviewed rule or a person. Automatic discovery from news is a later PR. |

## Not yet: terms unread (14)

| Source (id) | What it gives | Terms | Notes |
|---|---|---|---|
| [NOAA NCEI observed weather (Access Data Service, CDO v2)](https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation) (`ncei_observed`) | Observed daily temperature and precipitation: the actuals needed to score a weather signal (hindsight evidence only, E0). | UNVERIFIED | No terms sentence was read on an official page (the NCEI Open Data Policy is a PDF that was not read). Test queries for Reagan National returned an empty list, so the station and dataset parameters are unproven. PR 3 builds this adapter only after a person reads the policy. |
| [OPM federal operating status (DC area)](https://www.opm.gov/policy-data-oversight/snow-dismissal-procedures/current-status/) (`opm_operating_status`) | Open, delayed or closed status for federal offices in the DC area. A closure or delay removes much of the weekday lunch crowd. | UNVERIFIED | The API page carries no terms or licence statement. It is a weather and emergency dismissal status: it does NOT establish a government shutdown (a lapse in appropriations), which is entered by hand. With telework, Open does not mean people are downtown. |
| [OPM federal holidays calendar](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/) (`opm_federal_holidays`) | Observed federal holiday dates through 2030, including the Friday or Monday a weekend holiday is observed on. | UNVERIFIED | No terms statement on the page. The app already computes federal holidays from the statute (5 U.S.C. 6103) with no feed; this calendar would only confirm observed days. One-off closures by executive order may be missing. |
| [Congress.gov API (daily Congressional Record)](https://api.congress.gov/) (`congress_api`) | Days on which Congress actually held proceedings (after the fact). | UNVERIFIED | No licence statement was found on the API pages. It records the past, so it cannot be known at the decision. |
| [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1) (`federal_register_api`) | Executive orders and notices, such as a one-off federal closure day. | UNVERIFIED | The documentation and legal pages redirected to an access-request page for automated clients, so the terms were not read. Not a shutdown signal. |
| [WMATA service advisory RSS feeds](https://www.wmata.com/rider_tools/metro_service_status/) (`wmata_rss`) | Rail and bus advisories with no key. | UNVERIFIED | Whether the developer licence covers these public feeds is not stated anywhere that was read. |
| [DC government news feeds (Mayor, DDOT, MPD)](https://dc.gov/) (`dc_gov_rss`) | Press releases, including DDOT weekly traffic advisories and MPD special-event closures. | UNVERIFIED ([page read](https://dc.gov/page/terms-and-conditions-use), not conclusive) | The same page says the licence does not apply to District or state produced material, so it is ambiguous for these releases. Free text: a person or a later reviewed parser must turn an item into an event. |
| [DC Public Schools calendar](https://dcps.dc.gov/page/dcps-calendars) (`dcps_calendar`) | School days, breaks and half days: family traffic and the availability of student staff. | UNVERIFIED | No terms specific to the calendar; the dc.gov terms are ambiguous for District material and the feed is hosted by Google. Event titles are free text: a person must say which mean no school. |
| [George Washington University events calendar](https://calendar.gwu.edu/) (`gwu_events_ics`) | Campus events near the Dupont / Foggy Bottom shop. | UNVERIFIED | Terms not read. About 1 MB of mostly small events: low signal without filtering. |
| [Audi Field events calendar (D.C. United and other events)](https://audifield.com/events/) (`audi_field_ics`) | Every event at Audi Field: matches, concerts and others. | UNVERIFIED | The site publishes no terms of use (a privacy policy only). A published calendar feed, but nobody has confirmed we may store it. Do not scrape mlssoccer.com (its terms forbid it). |
| [TheSportsDB (free tier)](https://www.thesportsdb.com/) (`thesportsdb`) | Upcoming events per team or league. | UNVERIFIED | The terms page could not be read. The free key returns one result per call and home events only. |
| [RunSignup race API](https://runsignup.com/API) (`runsignup_api`) | Races by state, city and date: road races close streets and bring crowds. | UNVERIFIED | The page describes an open API licence but says content stays under the normal service agreements; the separate API Terms were not read. Only covers races registered there, virtual ones included. |
| [National Cherry Blossom Festival events calendar](https://nationalcherryblossomfestival.org/) (`ncbf_ics`) | Festival events (parade, kite festival, Petalpalooza) across three weeks each spring. | UNVERIFIED | A terms-of-use page exists and was not read. |
| [Google News RSS search](https://news.google.com/) (`google_news_rss`) | Headlines for a search query. | UNVERIFIED | Undocumented. Google's terms forbid automated access against its machine-readable instructions, and the robots file for the feed was not read. |

## By hand only (22)

| Source (id) | What it gives | Terms | Notes |
|---|---|---|---|
| [U.S. House legislative calendar](https://www.majorityleader.gov/house-legislative-calendar-2026/) (`house_calendar`) | Days the House plans to be in session. | UNVERIFIED | PDF only; no terms read. A person enters recess weeks by hand. |
| [AlertDC (DC HSEMA)](https://hsema.dc.gov/page/alertdc) (`alertdc`) | Emergency, severe weather, utility outage and government closing alerts for DC. | UNVERIFIED | No public feed or API. A manager may subscribe and enter what matters by hand. |
| [MPD traffic advisories (special events, motorcades, demonstrations)](https://mpdc.dc.gov/newsroom) (`mpd_traffic_advisories`) | Narrative street closures for parades, races and demonstrations: closures the permit dataset misses. | UNVERIFIED | No feed. Times change between versions of one advisory. A manager enters the event by hand. |
| [Mayor's Special Events Task Group calendar (DC HSEMA)](https://hsema.dc.gov/page/msetg-special-events-calendar) (`hsema_msetg_calendar`) | The city's own list of permitted special events with date, hours and place: the best single forward list of street events. | UNVERIFIED | A PDF whose file name changes with every revision; it was not opened directly. Events on federal land may be missing. |
| [National Mall permitted demonstrations and festivals](https://www.nps.gov/nama/planyourvisit/permitsandreservations.htm) (`nps_mall_permits`) | Marches, rallies and festivals on the Mall (more than 4,000 permitted activities a year). | UNVERIFIED | No list or feed of permitted events was found. A manager enters large ones by hand. |
| [DC public charter school calendars](https://dcpcsb.org/school-profiles/) (`dc_charter_calendars`) | Each charter school's own academic calendar. | UNVERIFIED | One calendar per school and no citywide feed. |
| [University academic calendars (GWU, Georgetown, Howard, American, Catholic)](https://www.gwu.edu/academic-calendar) (`university_academic_calendars`) | Move-in, breaks, finals and commencement: about six dates a year per school. | UNVERIFIED | Web pages only. A manager enters the few dates that matter. |
| [Washington Nationals downloadable schedule](https://www.mlb.com/nationals/schedule/downloadable-schedule) (`nationals_schedule_download`) | Home game dates and start times for the season. | UNVERIFIED | MLB's terms allow private, non-commercial use only: a person downloads it once a season and enters home games. |
| [NBA schedule (Washington Wizards)](https://www.nba.com/wizards/schedule) (`nba_wizards_schedule`) | Wizards home games at Capital One Arena. | UNVERIFIED | The NBA terms bar use in a commercial product or service. Entered by hand, or found through a ticketing source once one is verified. |
| [Washington Mystics schedule](https://mystics.wnba.com/schedule) (`wnba_mystics_schedule`) | Mystics home games. | UNVERIFIED | No feed found; terms not read. |
| [Washington Commanders schedule](https://www.commanders.com/schedule/) (`nfl_commanders_schedule`) | Nine or ten home games a year (Landover). | UNVERIFIED | The NFL terms forbid commercial use and systematic retrieval. A manager enters the home dates. |
| [Washington Spirit schedule](https://www.washingtonspirit.com/schedule/) (`nwsl_spirit_schedule`) | Spirit home matches at Audi Field. | UNVERIFIED | The site refused automated access; terms not read. |
| [Capital One Arena event calendar](https://www.capitalonearena.com/events) (`capital_one_arena`) | Games and concerts at the arena. | UNVERIFIED | No feed; terms not found. |
| [Nationals Park non-game events](https://www.mlb.com/nationals/ballpark/events) (`nationals_park_events`) | Concerts and other events at the ballpark. | UNVERIFIED | MLB terms apply. |
| [The Anthem event calendar](https://www.theanthemdc.com/) (`the_anthem`) | Concerts at The Anthem (The Wharf). | UNVERIFIED | No feed and no published terms. |
| [9:30 Club event calendar](https://www.930.com/) (`nine_thirty_club`) | Concerts at the 9:30 Club. | UNVERIFIED | A small room: probably a weak signal. No feed. |
| [Kennedy Center calendar](https://www.kennedy-center.org/) (`kennedy_center`) | Performances at the Kennedy Center. | UNVERIFIED | The calendar and terms pages refused automated access. |
| [Smithsonian events](https://www.si.edu/events) (`smithsonian_events`) | Museum events on and near the Mall. | UNVERIFIED | The events and terms pages refused automated access. Smithsonian Open Access covers collections, not events. |
| [Running in the USA race listings](https://www.runningintheusa.com/) (`running_in_the_usa`) | A broad list of local races. | UNVERIFIED | No API. Its robots file refuses automated reuse. |
| [Major annual races (Marine Corps Marathon, Cherry Blossom Ten Mile, Rock 'n' Roll DC)](https://www.marinemarathon.com/) (`major_annual_races`) | The few races that close large parts of the city. | UNVERIFIED | A handful of dates a year: entered by hand. |
| [Capital Pride parade and festival](https://www.capitalpride.org/) (`capital_pride`) | The June parade and festival, both near the Dupont shop. | UNVERIFIED | Two dates a year: entered by hand. |
| [PoPville neighbourhood feed](https://www.popville.com/) (`popville_rss`) | Neighbourhood news and street-level notices. | UNVERIFIED | Its robots file disallows AI crawlers and its terms were not read. A person may read it. |

## Refuse (10)

| Source (id) | What it gives | Terms | Notes |
|---|---|---|---|
| [MLB Stats API (Washington Nationals schedule)](https://www.mlb.com/) (`mlb_statsapi`) | The Nationals schedule with dates and venue. | VERIFIED. [Terms](https://www.mlb.com/official-information/terms-of-use): "Only individual, non-commercial, non-bulk use of the Materials is permitted and any other use of the Materials is prohibited without prior written authorization from MLBAM." | The quote is MLB's copyright notice (gdx.mlb.com/components/copyright.txt); the MLB terms of use also prohibit automated scripts. Home games are entered by hand (about 81 a season) from the team's downloadable schedule. |
| [NHL web API (Washington Capitals schedule)](https://www.nhl.com/) (`nhl_api_web`) | The Capitals season schedule. | VERIFIED. [Terms](https://www.nhl.com/info/terms-of-service): "only for non-commercial, informational, personal use" | Undocumented, and the NHL terms prohibit scraping and entering content into a database. Entered by hand. |
| [ESPN site API (unofficial)](https://www.espn.com/) (`espn_site_api`) | Schedules for every league from one undocumented endpoint. | VERIFIED. [Terms](https://disneytermsofuse.com/english/): "access, monitor, copy or extract the Disney Products using a robot, spider, script, or other automated means" | Undocumented, and its terms forbid automated access and commercial use. |
| [SeatGeek Platform API](https://seatgeek.com/) (`seatgeek_api`) | Events by venue, were its terms to allow it. | UNVERIFIED | The API terms and the developer portal could not be read. Refused until someone reads them. |
| [Eventbrite API](https://www.eventbrite.com/platform/api) (`eventbrite_api`) | Public event search no longer exists. | VERIFIED. [Terms](https://www.eventbrite.com/platform/api): "Access to this API was shut down at 11:59 pm PT on Thursday, December 12, 2019." | There is nothing to collect. |
| [Bandsintown API](https://www.bandsintown.com/) (`bandsintown_api`) | Concert dates per artist. | UNVERIFIED | Its help pages say each key is tied to one artist and the data is not meant for other uses without approval. The data terms could not be read. |
| [Events DC (Walter E. Washington Convention Center and other venues)](https://eventsdc.com/events) (`events_dc`) | Conventions and events at the Convention Center, which drive large lunch demand nearby. | VERIFIED. [Terms](https://eventsdc.com/terms-use): "will not use any robot, spider, or other automatic device" | Automated collection is forbidden without written permission. A manager reads the public calendar and enters large conventions by hand. |
| [WTOP news feed](https://wtop.com/) (`wtop_rss`) | Local news for the Washington area. | VERIFIED. [Terms](https://wtop.com/terms-of-use/): "The systematic retrieval of any of the Content to create or compile" | The quote is from a list of prohibited uses; the terms allow private, non-commercial use only. A person may read it. |
| [Washington Post local feed](https://www.washingtonpost.com/) (`wapo_local_rss`) | Local news for the Washington area. | UNVERIFIED | The terms page refused automated access. Refused until someone reads it. |
| [Nager.Date public holiday API](https://date.nager.at/) (`nager_date`) | Public holidays by country and year. | VERIFIED. [Terms](https://nagerholidays.com/legal/termsofservice): "For commercial purposes we require active sponsorship." | Not free for a business, and not needed: federal holidays are computed in code. |

## What could not be read on 2026-11-18

Stated so nobody takes silence for approval:

- **WMATA:** the page with the official rate limits and the exact endpoint URLs (the developer portal is a script-rendered app).
- **NCEI:** the Open Data Policy PDF; and the test queries returned empty lists.
- **OPM:** no terms page was found for the operating-status API or the holidays calendar.
- **Federal Register:** the documentation and legal pages redirect automated clients to an access-request page.
- **Open Data DC:** the site's own terms pages rendered empty; the terms quoted are from dc.gov.
- **Sites that refused automated access:** Smithsonian events and terms, Kennedy Center, Washington Spirit, SeatGeek, Washington Post terms, Running in the USA terms.
- **Not opened:** the HSEMA special-events PDF, the House calendar PDF, the RunSignup API Terms, the Cherry Blossom Festival terms, the Howard, American and Catholic calendars.
- **NWS alerts:** the alert shape was read from a live alert elsewhere in the country; DC had no active alert that day.

## Paid services that would make this better (for Pete; nothing is bought, nothing is built)

Prices are what each provider's public page said on 2026-11-18. "Not published" means the page asks you to contact sales.

| Service | What it would add over the free sources | Published price |
|---|---|---|
| [PredictHQ](https://www.predicthq.com/pricing) | One ranked, de-duplicated feed of events (sports, concerts, conventions, school holidays, severe weather) with attendance and impact estimates. It replaces most of the "by hand only" rows above | Not published (free trial, then sales) |
| [Ticketmaster Discovery, partner tier](https://developer.ticketmaster.com/) | A higher quota than the free 5,000 calls a day | No paid tier found; increases are case by case |
| [BestTime.app](https://besttime.app/subscription/pricing) | Hour-by-hour busyness forecasts for a venue or a street (a "popular times" alternative) | From $29 a month plus $0.04 per credit; $99 a month plus usage; 50 venues for $96 a month; enterprise from about $2,000 a month |
| [Placer.ai](https://www.placer.ai/pricing) | Measured foot traffic past each shop and at nearby venues | Not published (custom, contact sales; no free trial) |
| [Unacast](https://www.unacast.com/pricing) | Foot-traffic datasets | Not published |
| [SafeGraph](https://www.safegraph.com/pricing) | Places and spend data | Not published (annual fee by rows and rights) |
| [Dewey](https://www.deweydata.io/pricing) | Research access to location datasets | $3,600 a year for a researcher seat; the rates are negotiated for academic research, so likely not open to a business |
| [OpenWeather One Call](https://openweathermap.org/price) | Forecast and long weather history from one API, with a stated service level | First 1,000 calls a day free, then $0.0015 a call; monthly plans $40, $180, $470, $1,200 |
| [Visual Crossing](https://www.visualcrossing.com/weather-data-editions/) | Historical and forecast weather in one API (would replace the unverified NCEI source for scoring) | No dollar price on the page read (a cost calculator); free tier of 1,000 records a query |
| [Tomorrow.io](https://www.tomorrow.io/weather-api/) | Street-level forecasts and alerts | No dollar price on the page read; enterprise by quote |
| [AccuWeather API](https://developer.accuweather.com/pricing) | Minute-by-minute precipitation | Not readable (the packages page refused access) |
| [The Weather Company](https://www.weathercompany.com/weather-data-apis/) | Enterprise weather data | Not published on the page read (a free trial is offered) |
| [Meteomatics](https://www.meteomatics.com/en/pricing/) | High-resolution weather | Not published |
| [SportsDataIO](https://sportsdata.io/) | Licensed schedules for every league (the league sites themselves refuse automated use) | Not published |
| [Sportradar](https://developer.sportradar.com/) | Official league data | Not published (business accounts only) |
| [TheSportsDB, paid](https://www.thesportsdb.com/pricing) | Full schedules and higher limits than its free key | $9 a month (single developer), $20 a month (small business) |
| [BALLDONTLIE, paid](https://www.balldontlie.io/) | More endpoints and leagues than its free tier | $9.99 or $39.99 a month per league; $299.99 a month for everything |
| [NewsAPI.org](https://newsapi.org/pricing) | Headline search across outlets | Free for development only; $449 a month (business) |
| [Event Registry](https://newsapi.ai/plans) | News already clustered into events | From $90 a month (5,000 tokens) to $3,000 a month |
| [Mediastack](https://mediastack.com/pricing) | A simple news API | Free tier is non-commercial; $24.99, $99.99, $249.99 a month |
| Nager.Date sponsorship | A holiday API for commercial use | Sponsorship required; not needed (holidays are computed) |
| Meetup Pro | Its API is a Pro benefit | Not read |
| Data Axle, Datassential, Black Box Intelligence, OpenTable / Resy data | Restaurant benchmarks and reservations data | Could not be read |

**The one that would change the most:** an events feed with attendance estimates (PredictHQ is the known one). Nearly every event row above is "by hand only" because the venues, leagues and the convention centre forbid automated collection. Second: measured foot traffic (Placer.ai or BestTime). The free weather source is already good.
