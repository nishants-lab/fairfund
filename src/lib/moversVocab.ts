/**
 * Vocabulary for the Movers question box. Every phrase is written lowercase, with
 * "&" spelled "and", hyphens as spaces and digits split from letters, the same way
 * the question is normalised (see tokenize in moversQuery.ts).
 */
import type { Measure, View } from './moversState'

export interface MeasureWord { m: Measure; order?: 'desc' | 'asc'; sign?: 'pos' | 'neg'; pct?: boolean; field?: boolean }
export interface Theme { label: string; re: RegExp; sector?: string }

/** Fund themes, matched on the fund name; `sector` is the stock sector the same word means. */
export const THEMES: Record<string, Theme> = {
  banking: { label: 'Banking & financial', re: /\b(bank|banking|financial|finance|bfsi|fin serv|financials)\b/i, sector: 'Financial' },
  pharma: { label: 'Pharma & healthcare', re: /(pharma|health)/i, sector: 'Healthcare' },
  tech: { label: 'Technology', re: /\b(it|technology|tech|digital|information technology|telecom)\b/i, sector: 'Technology' },
  infra: { label: 'Infrastructure', re: /infra/i, sector: 'Industrials' },
  consumption: { label: 'Consumption', re: /(consum|fmcg)/i, sector: 'Consumer Staples' },
  energy: { label: 'Energy & power', re: /(energy|power|oil|gas)\b/i, sector: 'Energy & Utilities' },
  psu: { label: 'PSU', re: /\b(psu|cpse|public sector|pse)\b/i },
  manufacturing: { label: 'Manufacturing', re: /manufactur/i, sector: 'Industrials' },
  defence: { label: 'Defence', re: /defen[cs]e/i },
  auto: { label: 'Auto', re: /\b(auto|automotive|mobility|ev)\b/i, sector: 'Consumer Discretionary' },
  realty: { label: 'Real estate', re: /(realty|real estate|reit|housing)/i, sector: 'Real Estate' },
  esg: { label: 'ESG', re: /\besg\b|sustainab/i },
  mnc: { label: 'MNC', re: /\bmnc\b/i },
  businessCycle: { label: 'Business cycle', re: /business cycle/i },
  innovation: { label: 'Innovation', re: /innovat/i },
  quality: { label: 'Quality', re: /quality/i },
  momentumFactor: { label: 'Momentum strategy', re: /momentum/i },
  lowVol: { label: 'Low volatility', re: /low vol/i },
  equalWeight: { label: 'Equal weight', re: /equal weight/i },
  us: { label: 'US', re: /(nasdaq|s&p 500|\bus\b|u\.s\.|america|nyse)/i },
  china: { label: 'China', re: /china/i },
  japan: { label: 'Japan', re: /japan/i },
  taiwan: { label: 'Taiwan', re: /taiwan/i },
  emerging: { label: 'Emerging markets', re: /emerging/i },
  nifty50: { label: 'Nifty 50', re: /nifty ?50\b/i },
  next50: { label: 'Nifty Next 50', re: /next ?50/i },
  sensex: { label: 'Sensex', re: /sensex/i },
  nifty500: { label: 'Nifty 500', re: /nifty ?500/i },
  midcap150: { label: 'Midcap 150', re: /midcap ?150/i },
  smallcap250: { label: 'Smallcap 250', re: /smallcap ?250/i },
  commodities: { label: 'Commodities', re: /commodit/i, sector: 'Materials' },
  metals: { label: 'Metals', re: /metal/i, sector: 'Materials' },
  chemicals: { label: 'Chemicals', re: /chemical/i, sector: 'Materials' },
  transport: { label: 'Transport & logistics', re: /(transport|logistic)/i },
  tourism: { label: 'Tourism', re: /(touris|hospitality|travel)/i },
  capitalMarkets: { label: 'Capital markets', re: /capital market/i, sector: 'Financial' },
  rural: { label: 'Rural', re: /rural/i },
  exports: { label: 'Exports', re: /export/i },
  specialSituations: { label: 'Special situations', re: /special situation/i },
  dividendTheme: { label: 'Dividend', re: /dividend/i },
}

export const THEME_WORDS: [string, string][] = [
  ['bank|banks|banking|financial|financials|financial services|bfsi|finance|fintech|lender|lenders|nbfc|nbfcs', 'banking'],
  ['pharma|pharmaceutical|pharmaceuticals|healthcare|health care|health|hospital|hospitals', 'pharma'],
  ['it fund|it funds|it sector|it index|it stocks|nifty it|information technology|technology|tech|digital|software|telecom', 'tech'],
  ['infra|infrastructure', 'infra'],
  ['consumption|consumer|fmcg', 'consumption'],
  ['energy|power|oil|oil and gas|utilities', 'energy'],
  ['psu|psus|public sector|cpse|government companies', 'psu'],
  ['manufacturing', 'manufacturing'],
  ['defence|defense', 'defence'],
  ['auto|autos|automobile|automobiles|automotive|ev|electric vehicle|mobility', 'auto'],
  ['realty|real estate|reit|reits|housing|property', 'realty'],
  ['esg|sustainable|sustainability', 'esg'],
  ['mnc|mncs|multinational', 'mnc'],
  ['business cycle|business cycles', 'businessCycle'],
  ['innovation|innovative', 'innovation'],
  ['quality', 'quality'],
  ['momentum fund|momentum funds|momentum index|momentum strategy|momentum 30|momentum 50', 'momentumFactor'],
  ['low volatility|low vol', 'lowVol'],
  ['equal weight|equal weighted', 'equalWeight'],
  ['us|usa|united states|american|america|nasdaq|nasdaq 100|s and p|s and p 500|sp 500|s p 500', 'us'],
  ['china|chinese', 'china'], ['japan|japanese', 'japan'], ['taiwan', 'taiwan'],
  ['emerging|emerging market|emerging markets', 'emerging'],
  ['nifty 50|nifty fifty', 'nifty50'], ['next 50|nifty next 50|junior', 'next50'], ['sensex|bse 30|bse sensex', 'sensex'],
  ['nifty 500', 'nifty500'], ['midcap 150|mid cap 150', 'midcap150'], ['smallcap 250|small cap 250', 'smallcap250'],
  ['commodity|commodities', 'commodities'], ['metal|metals|steel', 'metals'], ['chemical|chemicals', 'chemicals'],
  ['transport|transportation|logistics', 'transport'], ['tourism|travel|hospitality|hotels', 'tourism'],
  ['capital market|capital markets', 'capitalMarkets'], ['rural', 'rural'], ['export|exports', 'exports'],
  ['special situation|special situations', 'specialSituations'],
]

export const CATEGORY_WORDS: [string, string][] = [
  ['large cap|largecap|large caps|largecaps|bluechip|blue chip|bluechips|large company|large companies', 'Large Cap'],
  ['mid cap|midcap|mid caps|midcaps|mid sized|mid size|midsize', 'Mid Cap'],
  ['small cap|smallcap|small caps|smallcaps|small companies|small company', 'Small Cap'],
  ['flexi cap|flexicap|flexi caps|flexi|flexible cap|flexible', 'Flexi Cap'],
  ['multi cap|multicap|multi caps|multicaps', 'Multi Cap'],
  ['large and mid cap|large and midcap|large mid cap|large midcap|large and mid|large and mid caps|large mid', 'Large & Mid Cap'],
  ['focused|focus|concentrated', 'Focused'],
  ['elss|tax saver|tax saving|tax savers|tax saving funds|80 c|tax', 'ELSS'],
  ['value|contra|contrarian|value contra|value and contra', 'Value/Contra'],
  ['dividend yield|dividend|dividends', 'Dividend Yield'],
  ['sectoral|thematic|sector fund|sector funds|theme|themes|thematic funds|sectoral and thematic|sectoral thematic|sectorals', 'Sectoral/Thematic'],
  ['international|global|overseas|foreign|world|offshore', 'International'],
  ['liquid|liquid funds|cash fund|cash funds', 'Liquid'],
  ['money market|money markets|mmf', 'Money Market'],
  ['arbitrage|arb', 'Arbitrage'],
]
/** Index counterpart of an active category, used for "small cap index funds". */
export const INDEX_CATEGORY: Record<string, string[]> = {
  'Small Cap': ['Index-SmallCap'], 'Mid Cap': ['Index-MidCap'], 'Sectoral/Thematic': ['Index-Sectoral/Thematic'],
  'Large Cap': ['Index Funds'], 'Flexi Cap': ['Index-Other'], 'Multi Cap': ['Index-Other'],
}

/** Fund houses by the names people use; AMFI names are added automatically. */
export const AMC_ALIASES: [string, string][] = [
  ['aditya birla|absl|birla|aditya birla sun life|absl mf|birla sun life', 'Aditya Birla Sun Life'],
  ['ppfas|parag parikh|parag|ppfas mf', 'PPFAS'],
  ['bandhan|idfc|idfc mf', 'Bandhan'],
  ['hsbc|l and t mf|lnt mf|l and t mutual fund', 'HSBC'],
  ['sundaram|principal', 'Sundaram'],
  ['groww|indiabulls', 'Groww'],
  ['dsp|dsp blackrock', 'DSP'],
  ['baroda bnp|baroda|bnp|bnp paribas|baroda bnp paribas', 'Baroda BNP Paribas'],
  ['icici|ipru|icici pru|icici prudential', 'ICICI Prudential'],
  ['nippon|nippon india|reliance mf|reliance mutual fund', 'Nippon India'],
  ['motilal|motilal oswal|mosl', 'Motilal Oswal'],
  ['navi|essel', 'Navi'],
  ['mahindra manulife|manulife|mahindra mf', 'Mahindra Manulife'],
  ['kotak|kotak mahindra|kotak mf', 'Kotak Mahindra'],
  ['mirae|mirae asset', 'Mirae Asset'],
  ['franklin|templeton|franklin india|franklin templeton', 'Franklin Templeton'],
  ['canara|robeco|canara robeco', 'Canara Robeco'],
  ['whiteoak|white oak|whiteoak capital|white oak capital', 'WhiteOak Capital'],
  ['jio|jio blackrock|jioblackrock', 'Jio BlackRock'],
  ['bajaj|bajaj finserv|bajaj mf', 'Bajaj Finserv'],
  ['bank of india|boi|boi axa|bank of india mf', 'Bank of India'],
  ['jm|jm financial', 'JM Financial'],
  ['lic|lic mf|lic mutual fund', 'LIC'],
  ['trustmf|trust mf|trust mutual fund', 'Trust'],
  ['quant|quant mf', 'quant'],
  ['quantum|quantum mf', 'Quantum'],
  ['wealth company|the wealth company', 'The Wealth Company'],
  ['old bridge|oldbridge', 'Old Bridge'],
  ['pgim|pgim india', 'PGIM India'],
  ['union|union mf', 'Union'],
  ['angel one|angel one mf', 'Angel One'],
  ['capitalmind|capital mind', 'Capitalmind'],
  ['choice mf|choice mutual fund', 'Choice'],
  ['ask mf|ask mutual fund|ask fund', 'ASK'],
  ['nj|nj mf', 'NJ'],
  ['edelweiss', 'Edelweiss'], ['invesco', 'Invesco'], ['axis', 'Axis'], ['hdfc', 'HDFC'], ['sbi', 'SBI'], ['tata', 'Tata'],
  ['uti', 'UTI'], ['iti', 'ITI'], ['taurus', 'Taurus'], ['samco', 'Samco'], ['shriram', 'Shriram'], ['helios', 'Helios'],
  ['zerodha', 'Zerodha'], ['abakkus', 'Abakkus'], ['alphagrep|alpha grep', 'AlphaGrep'], ['carnelian', 'Carnelian'], ['unifi', 'Unifi'],
]
/** AMC names that are everyday words; only their aliases above count. */
export const GENERIC_AMC_WORDS = new Set(['ask', 'choice', 'trust', 'the', 'old', 'bank', 'one', 'capital', 'india', 'wealth', 'company', 'angel'])

/** Stocks by the names people use. Matched against our stock list by name. */
export const STOCK_ALIASES: [string, string][] = [
  ['tcs', 'tata consultancy'], ['ril|reliance', 'reliance industries'], ['sbi|state bank', 'state bank of india'],
  ['l and t|lnt|larsen', 'larsen and toubro'], ['hul|hindustan unilever', 'hindustan unilever'], ['m and m', 'mahindra and mahindra'],
  ['airtel|bharti', 'bharti airtel'], ['kotak bank', 'kotak mahindra bank'], ['sun pharma', 'sun pharmaceutical'],
  ['hcl|hcl tech', 'hcl technologies'], ['zomato|eternal', 'zomato'], ['paytm', 'one 97'], ['policybazaar|policy bazaar', 'pb fintech'],
  ['mcx', 'multi commodity exchange'], ['nykaa', 'fsn e commerce'], ['dmart|d mart', 'avenue supermarts'], ['hal', 'hindustan aeronautics'],
  ['bel', 'bharat electronics'], ['maruti', 'maruti suzuki'], ['m and m financial', 'mahindra and mahindra financial'],
  ['indusind', 'indusind bank'], ['ultratech', 'ultratech cement'], ['asian paints', 'asian paints'], ['jio financial', 'jio financial'],
]

/** Measure words. Order/sign here are what the word itself means ("outflows" = most negative first). */
export const MEASURE_WORDS: [string, MeasureWord][] = [
  ['inflow|inflows|net inflow|net inflows|flows|flow|net flows|net flow|money in|money flowed in|money came in|fresh money|new money|net sales|sales|investor money|investments|mobilised|mobilized|collections|subscriptions|money poured|attracted|attract|gathered|pulled in|got money|received money|net buying by investors|net new money|money|most money|more money|money coming in|money coming|coming in|money flowing in|flowing in|positive flow|positive flows|positive inflow|positive inflows|net positive|buying by investors|received|receive|receiving|went into|flowed into|poured into|came into|went in|investors are buying|investors buying|investors are pouring|investors pouring|investors love|investors are adding|investors adding|investors flocking|investors are flocking|investors are investing|investors investing', { m: 'flow', field: true }],
  ['outflow|outflows|net outflow|net outflows|redemption|redemptions|withdrawal|withdrawals|money out|money left|money went out|pulled out|investors left|bled|bleeding|outgo|net selling by investors|money going out|going out|money leaving|leaving|money flowing out|flowing out|negative flow|negative flows|negative inflow|negative inflows|net negative|lost investors|redeemed|selling by investors|investors are dumping|investors dumping|investors are selling|investors selling|investors are exiting|investors exiting|investors are leaving|investors leaving|investors pulling out|investors are pulling out|investors redeeming|investors are redeeming|investors fleeing|investors are fleeing|investors quitting', { m: 'flow', order: 'asc', sign: 'neg', field: true }],
  ['aum|assets|asset size|size|fund size|corpus|assets under management|asset base|aum size', { m: 'aum', field: true }],
  ['aum change|change in aum|aum changes|changes in aum|size change|change in size|aum moved|aum movement', { m: 'aumChange', order: 'desc', field: true }],
  ['aum growth|growth in aum|grew|grown|grow|growing|expanded|got bigger|added assets|gained assets|rose in size|increase in aum|aum increase|aum rose|aum grew|aum up|bigger now', { m: 'aumChange', order: 'desc', sign: 'pos', field: true }],
  ['fastest growing|fastest grown|grew fastest|fastest growth|grew the fastest', { m: 'aumChange', order: 'desc', pct: true }],
  ['shrank|shrunk|shrinking|shrink|got smaller|lost assets|aum fall|aum drop|aum fell|aum decline|contracted|decline in aum|fall in aum', { m: 'aumChange', order: 'asc', sign: 'neg', field: true }],
  ['return|returns|performance|performing|performer|performers|performed|cagr|gains|gain|annualised return|annualized return|growth rate|rise|appreciation|yield|yielded|delivered|returning|returned|earned|earning', { m: 'cagr', field: true }],
  ['positive returns|positive return|in the green|made money|making money|profitable|in profit', { m: 'cagr', order: 'desc', sign: 'pos', field: true }],
  ['gainers|top gainers|biggest gainers|winners by return', { m: 'cagr', order: 'desc', field: true }],
  ['losers|top losers|biggest losers|losers by return', { m: 'cagr', order: 'asc', field: true }],
  ['negative returns|negative return|in the red|lost money|losing money|loss making|lost value|in loss|in losses|losses|loss', { m: 'cagr', order: 'asc', sign: 'neg', field: true }],
  ['outperform|outperformed|outperformers|beat category|beat the category|vs category|versus category|above category|relative return|excess return|beat peers|beat their peers|ahead of category|category median|beat|beats|beating|beating category|beating the category|beating peers|beating their category|outperforming|outperformance|better than category|better than peers|ahead of peers', { m: 'vsCategory', order: 'desc', field: true }],
  ['underperform|underperformed|underperformers|lagged|lagging|laggards|below category|trailed|underperforming|underperformance|behind category|behind peers|worse than category|worse than peers|trailing category', { m: 'vsCategory', order: 'asc', sign: 'neg', field: true }],
  ['sharpe|sharpe ratio|risk adjusted|risk adjusted return|risk adjusted returns|reward to risk', { m: 'sharpe', field: true }],
  ['sortino|sortino ratio|downside adjusted', { m: 'sortino', field: true }],
  ['volatility|volatile|swings|swingy|variability|standard deviation|std dev|risky|riskiest|risk', { m: 'volatility', field: true }],
  ['safest|least risky|least volatile|stable|stablest|most stable|steadiest|steady', { m: 'volatility', order: 'asc' }],
  ['drawdown|drawdowns|max drawdown|maximum drawdown|biggest fall|worst fall|crash|fall from peak|decline from peak|max loss|maximum loss|peak to trough|deepest fall', { m: 'drawdown', field: true }],
  ['alpha|jensen alpha', { m: 'alpha', field: true }],
  ['score|scores|fairfund score|rating|ratings|rated|top rated|highest rated|best rated', { m: 'score', field: true }],
  ['rank change|rank changes|rank changed|change in rank|changes in rank|rank move|rank moves|rank movers|rank mover|rank movement|rank shift|rank shifts|ranking change|ranking changes|ranking moves', { m: 'rankMove', order: 'desc', field: true }],
  ['climbed|climbers|climber|climb|climbing|moved up|rose in rank|gained rank|rank gain|rank gains|improved rank|improvers|improver|improved|improving|upgraded|up the ranks|rank improvement|rank up|rank rose|risers|gainers in rank', { m: 'rankMove', order: 'desc', sign: 'pos', field: true }],
  ['slipped|slipping|fallers|faller|fell in rank|dropped in rank|lost rank|rank fall|rank drop|rank drops|rank decline|downgraded|down the ranks|slid|slide|rank fell|rank down|decliners|worsened|deteriorated', { m: 'rankMove', order: 'asc', sign: 'neg', field: true }],
  ['rank|ranks|ranking|rankings|ranked|top ranked|highest ranked|number 1|no 1|rank 1|best ranked|category rank|position', { m: 'rankNow', field: true }],
  ['momentum|heating up|heating|hot|hotter|accelerating|accelerated|picking up|running hot|recent vs long term|short term vs long term|1 y vs 3 y|1 y vs 5 y|trending|trending up|on fire|gaining momentum|gathering pace', { m: 'momentum', order: 'desc' }],
  ['cooling|cooling off|cooled|slowing|slowed|losing steam|losing momentum|decelerating|running cold|cold', { m: 'momentum', order: 'asc', sign: 'neg' }],
  ['expense|expenses|expense ratio|expense ratios|ter|ters|cost|costs|fee|fees|charges|charge|total expense ratio', { m: 'ter', field: true }],
  ['cheap|cheapest|cheaper funds|low cost|lowest cost|least expensive|low fee|low fees|lowest fee|lowest fees|cheapest funds', { m: 'ter', order: 'asc' }],
  ['expensive|costly|costliest|priciest|pricey|highest fee|highest fees|most expensive', { m: 'ter', order: 'desc' }],
  ['cut fees|cut fee|cut cost|cut costs|cut expense|cut expenses|cut ter|fee cut|fee cuts|cost cut|ter cut|reduced expense|reduced expenses|reduced ter|reduced fees|lowered expense|lowered fees|lowered ter|expense fell|expense dropped|got cheaper|became cheaper|cheaper|expense reduction|ter reduction|cost reduction|fee cuts|ter cuts|expense cuts|cost cuts|fee reduction|fee reductions|cheaper now|slashed fees|slashed expense', { m: 'terChange', order: 'asc', sign: 'neg', field: true }],
  ['raised fees|raised fee|raised expense|raised ter|fee hike|fee hikes|ter hike|cost hike|increased expense|increased fees|increased ter|hiked|expense rose|got costlier|became costlier|costlier|more expensive|expense increase|ter increase|expense hike|expense hikes|ter hikes|cost hikes|fee increase|fee increases|raised costs|raised charges|costlier now', { m: 'terChange', order: 'desc', sign: 'pos', field: true }],
  ['change in expense|expense change|expense changes|ter change|ter changes|cost change|cost changes|fee change|fee changes|changes in expense|changes in ter|changes in fees|expense ratio change|expense ratio changes|changed expense|changed fees|repriced|repricing', { m: 'terChange', order: 'desc', field: true }],
]

export const MANAGER_WORDS: [string, 'joined' | 'left' | 'any'][] = [
  ['manager|managers|fund manager|fund managers|management|manager change|manager changes|management change|management changes|changed manager|changed managers|change in manager|change of manager|manager churn|manager turnover|who manages|managed by', 'any'],
  ['new manager|new managers|manager joined|managers joined|joined|took over|appointed|new fund manager|new fund managers|added manager|manager added|got a new manager|new management|joins|joining|joinee|joinees|new joinee|newly appointed|appointment|appointments|onboarded|inducted', 'joined'],
  ['manager left|managers left|left|departed|departure|departures|quit|resigned|resignation|manager exit|manager exits|manager departure|lost manager|lost a manager|lost managers|lost their manager|lost their fund manager|lost its manager|lost its fund manager|lost their managers|lost fund manager|manager moved|stepped down|steps down|moved on|exited manager|manager quit|manager resigned', 'left'],
]

export const STOCK_WORDS = 'stock|stocks|share|shares|holding|holdings|portfolio|portfolios|position|positions|companies|company|names|scrip|scrips|equities held|bets|picks'
export const STOCK_VERBS: [string, 'buy' | 'sell' | 'added' | 'exited'][] = [
  ['bought|buy|buying|buys|purchased|purchase|purchasing|accumulated|accumulating|accumulate|picked|picking|loaded up|increased stake|raised stake|topped up|topping up|added to|adding to|upped|increased|increasing|overweight|favourite stock|favorite stock|most bought|net bought|net buying|buyers|buyer|net buyers|bought into|backing', 'buy'],
  ['added|adding|adds|new position|new positions|new entries|new entry|initiated|initiate|fresh position|fresh positions|new stock|new stocks|new bets|entered|entry|new additions|new holding|new holdings', 'added'],
  ['sold|sell|selling|sells|offloaded|offloading|dumped|dumping|trimmed|trimming|trim|reduced|reducing|cut stake|reduced stake|pared|booked profit|booked profits|profit booking|lightened|decreased|decreasing|underweight|net sold|net selling|most sold|sellers|seller|net sellers|offload|dump|exiting partly', 'sell'],
  ['exited|exit|exiting|exits|fully exited|completely sold|sold out|removed|dropped|closed position|closed positions', 'exited'],
]

export const ORDER_WORDS: [string, 'desc' | 'asc' | 'good' | 'bad', (Measure | undefined)?][] = [
  ['highest|most|top|biggest|largest|max|maximum|greatest|strongest|leading|heaviest|highest ever|record|the most|more|higher|bigger|larger|major|big|large|huge|massive|leaders|leader|toppers|chart toppers|frontrunners|front runners|peak|tops|the highest|the biggest|the largest', 'desc'],
  ['lowest|least|bottom|smallest|min|minimum|weakest|fewest|lightest|lower|less|smaller|tiny|small|the least|the lowest|the smallest|tail|tail end', 'asc'],
  ['best|outstanding|winning|good|great|strong|better|excellent|stellar|solid|impressive', 'good'],
  ['top performing|best performing|top performers|best performers|top performer|best performer', 'good', 'cagr'],
  ['worst|weak|poor|poorest|losing|bad|terrible|worse|weakest performing|disappointing', 'bad'],
  ['worst performing|bottom performing|worst performers|worst performer|poor performers|poorly performing|underperforming funds', 'bad', 'cagr'],
  ['popular|most popular|in demand|favourite|favorite|most loved|sought after|loved|preferred|most preferred', 'desc', 'flow'],
  ['unpopular|least popular|out of favour|out of favor|shunned|abandoned', 'asc', 'flow'],
]

export const GROUP_WORDS: [string, 'category' | 'amc' | 'sector' | 'theme' | 'fund'][] = [
  ['which theme|which themes|by theme|theme wise|themewise|per theme|each theme|across themes|which sector funds|which thematic|which sectoral', 'theme'],
  ['which category|which categories|by category|category wise|categories|per category|each category|every category|across categories|segment|segments|which segment|category level|categorywise|fund categories|fund types|which type|which types|types of funds|kind of funds', 'category'],
  ['which amc|which amcs|by amc|amc wise|amcs|amcwise|fund house|fund houses|which fund house|which fund houses|asset manager|asset managers|per amc|each amc|amc level|mutual fund house|mutual fund houses|fund companies|mutual fund companies|which mutual fund|which mutual funds|which company|which companies|by fund house|amc', 'amc'],
  ['which sector|which sectors|sectors|by sector|sector wise|sectorwise|industries|industry|which industry|which industries|sector', 'sector'],
]

export const NOT_COVERED: [string, string][] = [
  ['hybrid|hybrids|balanced|balanced advantage|baf|dynamic asset allocation|multi asset|multi asset allocation|aggressive hybrid|conservative hybrid|equity savings', 'Hybrid funds are not part of FairFund yet.'],
  ['gold|silver|precious metals', 'Gold and silver funds are not part of FairFund yet.'],
  ['gilt|corporate bond|credit risk|overnight|dynamic bond|short duration|ultra short|low duration|medium duration|long duration|banking and psu debt|banking and psu fund|banking and psu funds|floater|bond|bonds|g sec|gsec|target maturity', 'Only liquid and money market funds are covered on the debt side.'],
  ['etf|etfs|exchange traded', 'ETFs are not part of FairFund; index funds are.'],
  ['ulip|ulips|nps|ppf|fixed deposit|fd|fds|insurance|crypto|bitcoin|pms|aif', 'FairFund covers mutual funds only.'],
  ['direct plan|direct plans|regular plan|regular plans|direct|regular|idcw|dividend option|dividend payout|growth option|growth plan|payout|reinvestment', 'FairFund tracks the direct growth plan of each fund; figures here are for that plan.'],
  ['fund of funds|fof|fofs', 'Funds of funds that invest abroad are listed under International; other funds of funds are not covered.'],
  ['nav|navs|price|nav change', 'Movers works with month-end size, flows, costs, ranks and returns; for a fund\'s NAV open its page.'],
  ['exit load|exit loads|lock in|lockin|sip|sips|minimum investment|min sip|lumpsum', 'Exit loads and investment minimums are on each fund\'s page.'],
]

export const ADVICE_WORDS = 'should i|should we|shall i|should one|do i buy|do i invest|recommend|recommendation|recommendations|recommended|advice|advise|suggest|suggestion|suggestions|worth buying|worth investing|worth it|good investment|good to invest|good to buy|safe to invest|best fund to buy|best funds to buy|best fund to invest|best funds to invest|best to invest|invest now|buy now|right time|which to buy|where to invest|where should i invest|what to buy|guaranteed|sure shot|which should i|which is better|which one is better|is it better|better to invest|better option|better choice|good choice|safe bet|can i invest|switch to|should switch'

export const COUNT_WORDS = 'how many|number of|count of|count|how much of|total number'
export const AGG_WORDS: [string, 'total' | 'average'][] = [
  ['total|sum|overall|combined|altogether|aggregate|in total|net total|cumulative', 'total'],
  ['average|avg|mean|typical|median|on average|averages', 'average'],
]
export const NEG_WORDS = 'not|never|no|non|excluding|exclude|excludes|excluded|except|without|other than|apart from|besides|but not|ex|minus|leaving out|barring|sans|isn t|aren t|don t|nothing from|avoid|skip|ignore'
export const TYPE_WORDS: [string, 'index' | 'active'][] = [
  ['index|index fund|index funds|indices|passive|passives|passively managed|tracker|trackers|index tracking', 'index'],
  ['active|actively managed|active funds|non index|non passive|stock picking|stock pickers', 'active'],
]
export const YOUNG_WORDS: [string, 'only' | 'exclude'][] = [
  ['new fund|new funds|newly launched|new launch|new launches|recently launched|recent launches|young|young funds|launched this year|launched recently|new schemes|new scheme|recent funds|latest funds|nfo|nfos|just launched', 'only'],
  ['established|older funds|old funds|with track record|with a track record|long track record|mature|seasoned|veteran', 'exclude'],
]
export const RISK_WORDS: [string, string[]][] = [
  ['very high risk|very risky', ['Very High']],
  ['high risk|high risk funds', ['High', 'Very High']],
  ['moderately high risk|moderately high', ['Moderately High']],
  ['moderate risk|medium risk', ['Moderate']],
  ['low to moderate risk|low to moderate', ['Low to Moderate']],
  ['low risk|low risk funds|lower risk|conservative', ['Low to Moderate', 'Moderate']],
]

/** Comparators; the third field marks the ones that include the bound ("at least 1,000 cr"). */
export const CMP_WORDS: [string, 'gt' | 'lt', boolean][] = [
  ['above|over|more than|greater than|higher than|exceeding|exceeds|exceed|exceeded|beyond|upwards of|larger than|bigger than|in excess of|gt|more then|greater then', 'gt', false],
  ['at least|minimum of|min of|not less than|no less than|atleast|gte|or more|and above|or above|and over|or higher', 'gt', true],
  ['below|under|less than|lower than|smaller than|cheaper than|less then|lower then|lt|beneath', 'lt', false],
  ['at most|maximum of|max of|up to|upto|within|not more than|no more than|lte|capped at|or less|and below|or below|or lower', 'lt', true],
]
/** Every risk grade a fund can carry, mildest first. */
export const RISK_LEVELS = ['Low', 'Low to Moderate', 'Moderate', 'Moderately High', 'High', 'Very High']

export const UNIT_WORDS: [string, string][] = [
  ['cr|crore|crores|crs', 'cr'], ['lakh crore|lakh crores|lac crore|lakh cr|lac cr|l cr|lakh|lakhs|lac|lacs', 'lcr'],
  ['k cr|k crore|thousand crore|thousand crores|k|thousand', 'kcr'], ['billion|bn', 'bn'], ['million|mn', 'mn'],
  ['percent|per cent|pc|pct|percentage|pts|points|point|percentage points', 'pct'], ['bps|basis points|basis point|bp', 'bps'],
  ['month|months|mo|mos|m|mth|mths|mnth|mnths', 'months'], ['year|years|yr|yrs|y|yrly|annual', 'years'], ['quarters|qtrs', 'quarters'],
  ['week|weeks|day|days', 'days'],
]
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50, hundred: 100, dozen: 12, couple: 2, few: 5, handful: 5,
}
export const MONTHS: [string, number][] = [
  ['january|jan', 1], ['february|feb', 2], ['march|mar', 3], ['april|apr', 4], ['may', 5], ['june|jun', 6], ['july|jul', 7],
  ['august|aug', 8], ['september|sep|sept', 9], ['october|oct', 10], ['november|nov', 11], ['december|dec', 12],
]
export const TIME_WORDS: [string, { win?: number; horizon?: '1Y' | '3Y' | '5Y'; note?: string }][] = [
  ['last month|past month|this month|previous month|month on month|mom|monthly|recent month|latest month|in a month|over a month|one month|single month', { win: 1 }],
  ['last quarter|past quarter|this quarter|previous quarter|quarter|quarterly|qoq|three months|last three months|past three months|recent quarter|latest quarter|sep quarter|september quarter', { win: 3 }],
  ['half year|half yearly|last half year|past half year|six months|last six months|past six months|first half|second half', { win: 6 }],
  ['this year|ytd|year to date|so far this year|calendar year|this calendar year', { win: 6, horizon: '1Y' }],
  ['last year|past year|one year|a year|yearly|annually|over a year|in a year|trailing year|ttm|twelve months', { horizon: '1Y', win: 12 }],
  ['three years|three year', { horizon: '3Y' }],
  ['five years|five year|long term|long run|longer term', { horizon: '5Y' }],
  ['today|yesterday|this week|last week|daily|weekly|week|days', { win: 1, note: 'Flows, sizes and costs are disclosed monthly, so the latest month is shown.' }],
]

export const FILLER = new Set(('which what whats who whom whose show shows showing me list lists give gives find get display tell the a an of in for with that had has have having was were is are be been being did do does done got see saw seen fund funds scheme schemes mutual mf mfs by on at from during among amongst all any please i want to and or my our their its them those these this there where how much many than so far as per each every across vs versus compared relative recently recent latest current currently now ever also only just some very really within into about s one ones look looking can could would will kindly let us we you your here it').split(' '))
export const VIEW_LABEL: Record<View, string> = {
  flows: 'Money flows', size: 'Fund size', returns: 'Returns', rank: 'Category rank', momentum: 'Return momentum',
  cost: 'Costs', managers: 'Manager changes', stocks: 'Portfolio moves', debt: 'Debt / Cash',
}
