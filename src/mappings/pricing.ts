/* eslint-disable prefer-const */
import { BigDecimal, Address, log } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, ADDRESS_ZERO } from './helpers'
import { UniswapV2PairProtocol } from '../types/FateRewardController/UniswapV2PairProtocol'
import { BigInt } from '@graphprotocol/graph-ts'

const WONE_ADDRESS = '0xcf664087a5bb0237a0bad6742852ec6c8d69a27a'
const WETH_ADDRESS = '0x6983d1e6def3690c4d616b13597a09e6193ea013'
const FATE_ADDRESS = '0xb2e2650dfdb7b2dec4a4455a375ffbfd926ce5fc'
const USDC_WONE_PAIR = '0xe4c5d745896bce117ab741de5df4869de8bbf32f'
const BUSD_WONE_PAIR = ADDRESS_ZERO
const USDT_WONE_PAIR = ADDRESS_ZERO
const FATE_WONE_PAIR = '0xdcd307ac265c4cf1fde5ffb7850de1ac03c15303'

function getOnePriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdcPair: UniswapV2PairProtocol | null = UniswapV2PairProtocol.bind(Address.fromString(USDC_WONE_PAIR)) // usdc is token0

  let busdPair: UniswapV2PairProtocol | null = BUSD_WONE_PAIR !== ADDRESS_ZERO
    ? UniswapV2PairProtocol.bind(Address.fromString(BUSD_WONE_PAIR))
    : null // busd is token1

  let usdtPair: UniswapV2PairProtocol | null = USDT_WONE_PAIR !== ADDRESS_ZERO
    ? UniswapV2PairProtocol.bind(Address.fromString(USDT_WONE_PAIR))
    : null // usdt is token0

  // all 3 have been created
  if (usdcPair !== null && busdPair !== null && usdtPair !== null) {
    let usdcReserves = usdcPair.getReserves()
    let usdcReserve0 = new BigDecimal(usdcReserves.value0.times(BigInt.fromI32(10).pow(12)))
    let usdcReserve1 = new BigDecimal(usdcReserves.value1)

    let busdReserves = busdPair.getReserves()
    let busdReserve0 = new BigDecimal(busdReserves.value0)
    let busdReserve1 = new BigDecimal(busdReserves.value1)

    let usdtReserves = usdtPair.getReserves()
    let usdtReserve0 = new BigDecimal(usdtReserves.value0.times(BigInt.fromI32(10).pow(12)))
    let usdtReserve1 = new BigDecimal(usdtReserves.value1)

    let totalLiquidityONE = usdcReserve1.plus(busdReserve0).plus(usdtReserve1)
    let usdcWeight = usdcReserve1.div(totalLiquidityONE)
    let busdWeight = busdReserve0.div(totalLiquidityONE)
    let usdtWeight = usdtReserve1.div(totalLiquidityONE)

    return (usdcReserve0.div(usdcReserve1)).times(usdcWeight)
      .plus((busdReserve1.div(busdReserve0)).times(busdWeight))
      .plus(usdtReserve0.div(usdtReserve1).times(usdtWeight))
    // dai and USDC have been created
  } else if (usdcPair !== null && busdPair !== null) {
    let usdcReserves = usdcPair.getReserves()
    let usdcReserve0 = new BigDecimal(usdcReserves.value0.times(BigInt.fromI32(10).pow(12)))
    let usdcReserve1 = new BigDecimal(usdcReserves.value1)

    let busdReserves = busdPair.getReserves()
    let busdReserve0 = new BigDecimal(busdReserves.value0)
    let busdReserve1 = new BigDecimal(busdReserves.value1)

    let totalLiquidityONE = usdcReserve1.plus(busdReserve0)
    let usdcWeight = usdcReserve1.div(totalLiquidityONE)
    let busdWeight = busdReserve0.div(totalLiquidityONE)

    return usdcReserve0.div(usdcReserve1).times(usdcWeight)
      .plus(busdReserve1.div(busdReserve0).times(busdWeight))
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    let usdcReserves = usdcPair.getReserves()
    let usdcReserve0 = new BigDecimal(usdcReserves.value0.times(BigInt.fromI32(10).pow(12)))
    let usdcReserve1 = new BigDecimal(usdcReserves.value1)

    return usdcReserve0.div(usdcReserve1)
  } else {
    return ZERO_BD
  }
}

export function getFatePriceUsd(): BigDecimal {
  let fateOnePair = UniswapV2PairProtocol.bind(Address.fromString(FATE_WONE_PAIR))
  let fateOneReservesResult = fateOnePair.try_getReserves()
  if (fateOneReservesResult.reverted) {
    log.error("Could not get FATE:ONE reserves due to reversion", [])
    return getFatePriceUsd()
  }

  let fateOneReserves = fateOneReservesResult.value
  let reserve0 = new BigDecimal(fateOneReserves.value0)
  let reserve1 = new BigDecimal(fateOneReserves.value1)
  let fateOnePrice = reserve1.div(reserve0)

  let onePriceUsd = getOnePriceInUSD()
  return onePriceUsd.times(fateOnePrice)
}
