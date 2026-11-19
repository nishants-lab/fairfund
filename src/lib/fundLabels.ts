import type { Fund } from '../types'

// Fund name without the generic words, so the part that tells two funds apart
// (Nifty 50 vs Nifty 500, Mid Cap vs Flexi Cap) is always kept.
export function shortName(f: Fund): string {
  const n = f.name
    .replace(/\s*\((formerly|erstwhile)[^)]*\)/gi, '')
    .replace(/\s+Fund of Funds?\b/gi, ' FoF')
    .replace(/\s*-\s*(Direct|Regular)( Plan)?( - Growth| Growth)?$/i, '')
    .replace(/\s+(Index\s+)?Fund\s*-\s*/gi, ' ')
    .replace(/\s+(Index\s+)?Fund$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return n || f.name
}

// One-word label for column headers and legends. Falls back to the short name
// when two of the compared funds would get the same word (two HDFC funds).
export function oneWord(f: Fund, all: Fund[] = [f]): string {
  const word = (x: Fund) => {
    let n = x.name
    for (const w of [' Fund', ' - Direct', ' Plan', ' Growth', ' Large Cap', ' Large', ' Cap', 'Index']) {
      n = n.split(w)[0]
    }
    return (n.trim() || x.name).split(' ')[0]
  }
  const mine = word(f)
  return all.some(x => x.code !== f.code && word(x) === mine) ? shortName(f) : mine
}
