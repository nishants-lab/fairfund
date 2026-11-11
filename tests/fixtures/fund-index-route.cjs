const assert = require('node:assert/strict');

async function routeFundIndex(context, data) {
  await context.route('**/src/data/funds.json*', route => route.fulfill({contentType:'text/javascript',body:'export default '+JSON.stringify(data)}));
  await context.route('**/assets/fund-data-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const exports = /export\{(\w+) as (\w+)\};?\s*$/.exec(source);
    assert(exports, 'the fund-data chunk must export only its data object');
    await route.fulfill({response,contentType:'text/javascript',body:`const data=${JSON.stringify(data)};export {data as ${exports[2]}};`});
  });
}
module.exports = { routeFundIndex };
