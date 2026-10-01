import type {NavPoint} from "../types"
import {isIsoDate} from "./marketDate"

/** Conservative warning, not a determination that a source value is wrong. */
export function navQualityIssue(points: NavPoint[]): string | null {
  for(let i=0;i<points.length;i++) {
    const point=points[i]
    if(!isIsoDate(point.date)||!Number.isFinite(point.nav)||point.nav<=0)return "NAV history contains an invalid observation."
    if(i) {
      const previous=points[i-1]
      if(point.date<=previous.date)return "NAV dates are duplicated or out of order."
      if(Math.abs(point.nav/previous.nav-1)>=0.5)return `NAV changed by 50% or more between ${previous.date} and ${point.date}. Source verification is needed before calculating returns.`
    }
  }
  return null
}


export class NavQualityError extends Error {}
