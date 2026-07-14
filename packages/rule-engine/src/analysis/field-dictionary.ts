/**
 * Allow-list of known condition field names, derived from the real ai.fixmsg.properties
 * (70 distinct plain fields) with the two known typos removed so they get flagged:
 *   - "oderValueUSD"  (should be "orderValueUSD")  — line 205
 *   - "echangeCode"   (should be "exchangeCode")   — line 239
 *
 * Maintained against the trading platform's real supported-field list. Unknown fields are
 * reported as warnings (not errors), because this dictionary may lag the platform.
 */
export const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  'adv', 'aggression', 'algoEnv', 'algorithm', 'avgTradeCount', 'basket', 'caiid_str',
  'clientAlgorithm', 'compositeExchangeCode', 'dark_mid_price_mode', 'doCash', 'doClose',
  'doOpen', 'end_to_close', 'end_to_cont_end', 'enforceRegSHO', 'exchMktGrp', 'exchangeCode',
  'execution_style', 'fixmsg', 'has9009', 'inClose9015', 'indexTrackerAdaptionMode',
  'indexTrackerAdaptionStr', 'isIPO', 'limitPriceStrUsed', 'marketCapUSD', 'maxLitPartLevel',
  'maxPartLevel', 'minPartLevel', 'moc_mode', 'moc_rate', 'moc_rate_type', 'monitor_period',
  'moo_mode', 'moo_rate_type', 'noPMOpen', 'now_to_close', 'opened', 'orderSizeADV',
  'orderTag', 'orderValueUSD', 'pair_balance_mode', 'pair_balance_ratio', 'parentRelayAlgo',
  'passive_only', 'price', 'prorate_mode', 'queue_mode', 'regSHOState', 'roundLotSize',
  'side', 'size', 'spread', 'start_open', 'start_to_close', 'start_to_cont_begin',
  'start_to_earliest_auction', 'start_to_moc', 'start_to_moo', 'stockType', 'stripedBasketID',
  'symbol', 'syntheticVClose', 'targetPartLevel', 'use_ioi_exclusively', 'wouldDarkOnly',
  'wouldPercentageRaw', 'wouldVenue',
]);

/**
 * True when a field refers to a FIX tag rather than an order attribute, e.g.
 * "tag9012(164)", "tag9001", "fixTag(109)", "9012(IGNORE_ARROWST_CHECK)".
 * These are always valid in form and are not checked against the dictionary.
 */
export function isTagLikeField(field: string): boolean {
  return (
    /^(tag)?\d{2,4}(\(.*\))?$/.test(field) ||
    /^tag\d+/.test(field) ||
    /^fixTag\(/.test(field) ||
    /^\d+\(/.test(field)
  );
}
