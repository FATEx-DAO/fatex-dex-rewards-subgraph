import { ClaimRewards as ClaimRewardsEvent } from '../types/FateRewardController/FateRewardControllerProtocol'
import {
  Transaction,
  Claim,
  UserEpoch0TotalLockedRewardsByPool,
  UserEpoch0TotalLockedRewards,
  RewardsMetadata,
} from '../types/schema'
import { BigDecimal, BigInt } from '@graphprotocol/graph-ts'
import { getFatePriceUsd } from './pricing'
import { ONE_BI, ZERO_BD, ZERO_BI } from './helpers'

let ONE_ETH_IN_WEI = BigDecimal.fromString('1000000000000000000')

export function handleClaimRewards(event: ClaimRewardsEvent): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction == null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.save()
  }

  let claim = new Claim(event.transaction.hash.toHexString().concat('-').concat(event.logIndex.toString()))
  claim.transaction = event.transaction.hash.toHexString()
  claim.user = event.params.user
  claim.poolId = event.params.pid
  claim.amountFate = event.params.amount.divDecimal(ONE_ETH_IN_WEI)
  claim.amountUSD = claim.amountUSD.times(getFatePriceUsd())

  let metadata = RewardsMetadata.load(event.address.toHexString())
  if (metadata == null) {
    metadata = new RewardsMetadata(event.address.toHexString())
    metadata.claimCount = ZERO_BI
    metadata.fateClaimed = ZERO_BD
    metadata.fateClaimedUsd = ZERO_BD
    metadata.numberOfUniqueUsers = ZERO_BI
  }
  metadata.claimCount = metadata.claimCount.plus(ONE_BI)
  metadata.fateClaimed = metadata.fateClaimed.plus(claim.amountFate)
  metadata.fateClaimedUsd = metadata.fateClaimedUsd.plus(claim.amountUSD)

  let userRewardsByPool = UserEpoch0TotalLockedRewardsByPool.load(claim.user.toHexString().concat('-').concat(claim.poolId.toString()))
  if (userRewardsByPool == null) {
    userRewardsByPool = new UserEpoch0TotalLockedRewardsByPool(claim.user.toHexString().concat('-').concat(claim.poolId.toString()))
    userRewardsByPool.user = claim.user
    userRewardsByPool.poolId = claim.poolId
    userRewardsByPool.amountFate = ZERO_BD
    userRewardsByPool.amountUSD = ZERO_BD
  }
  userRewardsByPool.amountFate = userRewardsByPool.amountFate.plus(claim.amountFate)
  userRewardsByPool.amountUSD = userRewardsByPool.amountUSD.plus(claim.amountUSD)

  let userRewards = UserEpoch0TotalLockedRewards.load(claim.user.toHexString())
  let isNewUser = false
  if (userRewards == null) {
    isNewUser = true
    userRewards = new UserEpoch0TotalLockedRewards(claim.user.toHexString())
    userRewards.user = claim.user
    userRewards.amountFate = ZERO_BD
    userRewards.amountUSD = ZERO_BD
  }
  userRewards.amountFate = userRewards.amountFate.plus(claim.amountFate)
  userRewards.amountUSD = userRewards.amountFate.plus(claim.amountUSD)

  if (isNewUser) {
    metadata.numberOfUniqueUsers = metadata.numberOfUniqueUsers.plus(ONE_BI)
  }

  metadata.save()
  userRewardsByPool.save()
  userRewards.save()
  claim.save()
}
