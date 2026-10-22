/**
 * A fixed question-box context for the Movers parser tests: the real category and AMC
 * lists, a handful of fund names (already normalised, former names included) and a
 * small stock list. Fixed so the tests do not move when the monthly data does.
 */
import type { ParseContext } from '../../src/lib/moversQuery'

export const CATEGORIES = ['Arbitrage', 'Dividend Yield', 'ELSS', 'Flexi Cap', 'Focused', 'Index Funds', 'Index-MidCap', 'Index-Other',
  'Index-Sectoral/Thematic', 'Index-SmallCap', 'International', 'Large & Mid Cap', 'Large Cap', 'Liquid', 'Mid Cap', 'Money Market',
  'Multi Cap', 'Sectoral/Thematic', 'Small Cap', 'Value/Contra']

export const AMCS = ['ASK', 'Abakkus', 'Aditya Birla Sun Life', 'AlphaGrep', 'Angel One', 'Axis', 'Bajaj Finserv', 'Bandhan', 'Bank of India',
  'Baroda BNP Paribas', 'Canara Robeco', 'Capitalmind', 'Carnelian', 'Choice', 'DSP', 'Edelweiss', 'Franklin Templeton', 'Groww', 'HDFC',
  'HSBC', 'Helios', 'ICICI Prudential', 'ITI', 'Invesco', 'JM Financial', 'Jio BlackRock', 'Kotak Mahindra', 'LIC', 'Mahindra Manulife',
  'Mirae Asset', 'Motilal Oswal', 'NJ', 'Navi', 'Nippon India', 'Old Bridge', 'PGIM India', 'PPFAS', 'Quantum', 'SBI', 'Samco', 'Shriram',
  'Sundaram', 'Tata', 'Taurus', 'The Wealth Company', 'Trust', 'UTI', 'Unifi', 'Union', 'WhiteOak Capital', 'Zerodha', 'quant']

export const FUND_NAMES = [
  'hdfc flexicap fund', 'hdfc smallcap fund', 'hdfc midcap fund hdfc midcap opportunities fund', 'hdfc defence fund',
  'bandhan smallcap fund idfc', 'parag parikh flexicap fund ppfas', 'uti nifty 50 index fund', 'nippon india pharma fund reliance',
  'nippon india smallcap fund reliance', 'sbi contra fund', 'sbi psu fund', 'axis largecap fund axis bluechip fund',
  'kotak midcap fund kotak emerging equity fund', 'quant active fund', 'quant smallcap fund', 'quant elss tax saver fund',
  'motilal oswal nifty 50 index fund mosl', 'motilal oswal nifty next 50 index fund mosl', 'motilal oswal nifty midcap 150 index fund mosl',
  'motilal oswal nifty smallcap 250 index fund mosl', 'motilal oswal nifty 500 index fund mosl', 'motilal oswal midcap fund mosl',
  'motilal oswal nasdaq 100 fof mosl', 'icici prudential bharat 22 fof ipru', 'tata digital india fund',
  'whiteoak capital midcap fund', 'franklin india flexicap fund', 'dsp smallcap fund blackrock', 'invesco india smallcap fund',
  'icici prudential psu bank index fund ipru',
]

export const STOCKS = [
  ['hdfc-bank-ltd', 'HDFC Bank Ltd', 'Financial'], ['icici-bank-ltd', 'ICICI Bank Ltd', 'Financial'],
  ['infosys-ltd', 'Infosys Ltd', 'Technology'], ['reliance-industries-ltd', 'Reliance Industries Ltd', 'Energy & Utilities'],
  ['tata-consultancy-services-ltd', 'Tata Consultancy Services Ltd', 'Technology'], ['state-bank-of-india', 'State Bank of India', 'Financial'],
  ['zomato-ltd', 'Zomato Ltd', 'Technology'], ['dixon-technologies-india-ltd', 'Dixon Technologies (India) Ltd', 'Consumer Discretionary'],
  ['tata-motors-ltd', 'Tata Motors Ltd', 'Consumer Discretionary'], ['adani-ports-and-special-economic-zone-ltd', 'Adani Ports and Special Economic Zone Ltd', 'Industrials'],
  ['adani-power-ltd', 'Adani Power Ltd', 'Energy & Utilities'], ['bandhan-bank-ltd', 'Bandhan Bank Ltd', 'Financial'],
  ['icici-prudential-life-insurance-company-ltd', 'ICICI Prudential Life Insurance Company Ltd', 'Financial'],
  ['sun-pharmaceutical-industries-ltd', 'Sun Pharmaceutical Industries Ltd', 'Healthcare'], ['larsen-and-toubro-ltd', 'Larsen & Toubro Ltd', 'Industrials'],
].map(([key, name, sector]) => ({ key, name, sector }))

export function moversContext(): ParseContext {
  return { categories: CATEGORIES, amcs: AMCS, fundNames: FUND_NAMES, stocks: STOCKS, refMonth: '2026-09', firstMonth: '2026-05' }
}
