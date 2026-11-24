import { Composition } from 'remotion'
import { FundBuying, totalFrames, type VideoProps } from './FundBuying'
import props from './props.json'

export const Root = () => (
  <Composition
    id="FundBuying"
    component={FundBuying}
    durationInFrames={totalFrames(props as VideoProps)}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={props as VideoProps}
    calculateMetadata={({ props: p }) => ({ durationInFrames: totalFrames(p) })}
  />
)
